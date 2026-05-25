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
  const { addToast } = useToast();

  const performSave = useCallback(async () => {
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

    // Serialize canvas (moved before try for catch fallback access)
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

    try {
      await apiFetch(`/api/templates/${templateId}`, {
        method: "PUT",
        body: JSON.stringify({
          canvas: { ...canvasJSON, viewport },
          ...extra,
        }),
      });

      setStatus("saved");

      // Reset to idle after 3 seconds
      setTimeout(() => {
        setStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 3000);
    } catch (err) {
      const msg = (err as Error).message || "";
      // Offline fallback: save to localStorage when API is unreachable
      saveLocal(templateId!, {
        canvas: { ...canvasJSON, viewport },
        ...extra,
        name: extra.name || "Untitled",
        width: extra.width || 1080,
        height: extra.height || 1080,
      });
      if (msg.includes("fetch") || msg.includes("NetworkError") || msg.includes("Failed to fetch")) {
        setStatus("saved"); // Silent offline save
      } else {
        console.error("[AutoSave] Save failed:", err);
        setStatus("error");
        addToast("error", "Auto-save failed", msg);
      }

      // Reset after 3s (saved) or 5s (error)
      setTimeout(() => {
        setStatus((prev) => (prev === "saved" || prev === "error" ? "idle" : prev));
      }, 3000);
    } finally {
      isSavingRef.current = false;

      // If a save was requested while we were saving, save again
      if (pendingRef.current) {
        pendingRef.current = false;
        setTimeout(performSave, 100);
      }
    }
  }, [fabricRef, templateId, getExtraData]);

  const scheduleSave = useCallback(() => {
    if (!enabled || !templateId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(performSave, debounceMs);
  }, [enabled, templateId, performSave, debounceMs]);

  // Attach canvas event listeners
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || !enabled || !templateId) return;

    const events = [
      "object:added",
      "object:removed",
      "object:modified",
      "object:moving",
      "object:scaling",
      "object:rotating",
    ] as const;

    // For moving/scaling/rotating, debounce on the "end" event (modified)
    // For added/removed, debounce immediately
    const onChange = () => scheduleSave();

    for (const event of events) {
      c.on(event, onChange);
    }

    return () => {
      for (const event of events) {
        c.off(event, onChange);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fabricRef, enabled, templateId, scheduleSave]);

  // Force save (for manual save triggers)
  const forceSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    performSave();
  }, [performSave]);

  return { status, forceSave };
}
