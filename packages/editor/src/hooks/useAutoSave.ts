import { useEffect, useRef, useCallback, useState } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { apiFetch } from "../lib/supabase";
import { useToast } from "../components/Toast";
import { saveLocal } from "../lib/templateApi";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  fabricRef: React.RefObject<FabricCanvas | null>;
  templateId: string | null;
  /** Extra data to include in the save payload */
  getExtraData?: () => Record<string, any>;
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Whether auto-save is enabled */
  enabled?: boolean;
}

/**
 * Hook that detects Fabric.js canvas changes and auto-saves to the API.
 *
 * Listens to: object:added, object:removed, object:modified,
 * object:moved, object:scaled, object:rotated
 *
 * Debounces saves by 2 seconds (configurable).
 * Skips save if canvas is empty.
 * Shows status: Saving... / Saved ✓ / Error saving
 */
const CANVAS_EVENTS = [
  "object:added",
  "object:removed",
  "object:modified",
  "object:moving",
  "object:scaling",
  "object:rotating",
] as const;

export function useAutoSave({
  fabricRef,
  templateId,
  getExtraData,
  debounceMs = 2000,
  enabled = true,
}: UseAutoSaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const pendingRef = useRef(false);
  const loadingRef = useRef(false);
  const { addToast } = useToast();

  const performSave = useCallback(async () => {
    if (loadingRef.current) return;
    const c = fabricRef.current;
    if (!c || !templateId || isSavingRef.current) {
      if (!templateId) return;
      pendingRef.current = true;
      return;
    }

    // Check if canvas has any user objects (exclude grid, guides, frame visuals)
    const userObjects = c.getObjects().filter(
      (o: any) => !o.isGridLine && !o.isGuideLine && !o.isFrameLabel
    );
    if (userObjects.length === 0) return;

    isSavingRef.current = true;
    setStatus("saving");

    // Serialize canvas
    const canvasJSON = (c.toJSON as any)([
      "layerId", "layerName", "frameId", "isFrameVisual", "isFrameBg",
      "isClosedPath", "isFrameLabel", "imageFilters", "styleId",
      "componentId", "isComponentInstance", "constraints", "autoLayout",
      "resizingMode", "overrides",
    ]);
    const viewport = {
      x: c.viewportTransform[4],
      y: c.viewportTransform[5],
      zoom: c.getZoom(),
    };
    const extra = getExtraData?.() || {};

    const payload = {
      canvas: { ...canvasJSON, viewport },
      ...extra,
      name: extra.name || "Untitled",
      width: extra.width || 1080,
      height: extra.height || 1080,
    };

    // ── DUAL WRITE: always save to localStorage first (instant) ──
    saveLocal(templateId!, payload);

    // ── Then try API (best effort for cloud sync) ──
    try {
      await apiFetch(`/api/templates/${templateId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      setStatus("saved");
      // Update localStorage timestamp to mark API-synced
      saveLocal(templateId!, { ...payload, _apiSynced: true });

      setTimeout(() => {
        setStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 3000);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("fetch") || msg.includes("NetworkError") || msg.includes("Failed to fetch")) {
        setStatus("saved"); // Already saved to localStorage
      } else {
        console.error("[AutoSave] API save failed (localStorage preserved):", err);
        setStatus("saved"); // Still show saved since localStorage has it
      }

      setTimeout(() => {
        setStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 3000);
    } finally {
      isSavingRef.current = false;

      if (pendingRef.current) {
        pendingRef.current = false;
        setTimeout(performSave, 100);
      }
    }
  }, [fabricRef, templateId, getExtraData]);

  const scheduleSave = useCallback(() => {
    if (loadingRef.current || !enabled || !templateId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(performSave, debounceMs);
  }, [enabled, templateId, performSave, debounceMs]);

  // ── Stable callback ref to avoid effect re-creation ──
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;

  // Attach canvas event listeners
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || !enabled || !templateId) return;

    const onChange = () => scheduleSaveRef.current();

    for (const event of CANVAS_EVENTS) {
      c.on(event, onChange);
    }

    return () => {
      for (const event of CANVAS_EVENTS) {
        c.off(event, onChange);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fabricRef, enabled, templateId]);

  // Force save (for manual save triggers)
  const forceSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    performSave();
  }, [performSave]);

  // Immediate sync save to localStorage only (for unmount / beforeunload)
  const flushSave = useCallback(() => {
    const c = fabricRef.current;
    if (!c || !templateId) return;

    const userObjects = c.getObjects().filter(
      (o: any) => !o.isGridLine && !o.isGuideLine && !o.isFrameLabel
    );
    if (userObjects.length === 0) return;

    const canvasJSON = (c.toJSON as any)([
      "layerId", "layerName", "frameId", "isFrameVisual", "isFrameBg",
      "isClosedPath", "isFrameLabel", "imageFilters", "styleId",
      "componentId", "isComponentInstance", "constraints", "autoLayout",
      "resizingMode", "overrides",
    ]);
    const viewport = {
      x: c.viewportTransform[4],
      y: c.viewportTransform[5],
      zoom: c.getZoom(),
    };
    const extra = getExtraData?.() || {};

    const payload = {
      canvas: { ...canvasJSON, viewport },
      ...extra,
      name: extra.name || "Untitled",
      width: extra.width || 1080,
      height: extra.height || 1080,
    };

    saveLocal(templateId!, payload);
  }, [fabricRef, templateId, getExtraData]);

  // Cancel any pending auto-save timer (call before template loading)
  const clearPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Control loading state to suppress auto-saves during template load
  const setLoading = useCallback((v: boolean) => {
    loadingRef.current = v;
    if (v) {
      // Cancel any pending save when starting load
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  return { status, forceSave, flushSave, clearPending, setLoading };
}
