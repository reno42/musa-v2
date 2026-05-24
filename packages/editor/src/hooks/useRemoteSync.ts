import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";
import { useToast } from "../components/Toast";

interface RemoteSyncOptions {
  templateId: string | null;
  /** Polling interval in ms */
  intervalMs?: number;
  /** Called when external changes are detected */
  onExternalChange: (template: any) => void;
}

/**
 * Polls the API for external template changes (from agent edits).
 * Compares updated_at timestamp to detect remote modifications.
 */
export function useRemoteSync({
  templateId,
  intervalMs = 10000,
  onExternalChange,
}: RemoteSyncOptions) {
  const lastUpdatedAtRef = useRef<string>("");
  const dirtyRef = useRef(false); // local unsaved changes
  const [hasRemoteChanges, setHasRemoteChanges] = useState(false);
  const [remoteData, setRemoteData] = useState<any>(null);
  const lastErrorToastRef = useRef(0); // throttle error toasts
  const { addToast } = useToast();

  // Track local unsaved state
  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);
  const markClean = useCallback(() => { dirtyRef.current = false; }, []);

  useEffect(() => {
    if (!templateId) return;

    let timer: ReturnType<typeof setInterval>;

    const poll = async () => {
      try {
        const res = await apiFetch<{ data: any }>(`/api/templates/${templateId}`);
        const tpl = res.data;
        if (!tpl) return;

        // First poll: just record the current timestamp
        if (!lastUpdatedAtRef.current) {
          lastUpdatedAtRef.current = tpl.metadata?.updatedAt || "";
          return;
        }

        // Detect external change
        const remoteUpdated = tpl.metadata?.updatedAt || "";
        if (remoteUpdated && remoteUpdated !== lastUpdatedAtRef.current) {
          lastUpdatedAtRef.current = remoteUpdated;
          setHasRemoteChanges(true);
          setRemoteData(tpl);

          if (!dirtyRef.current) {
            // No local changes: auto-apply
            onExternalChange(tpl);
            setHasRemoteChanges(false);
            setRemoteData(null);
          }
        }
      } catch {
        // Throttle error toasts: max one every 30 seconds
        const now = Date.now();
        if (now - lastErrorToastRef.current > 30000) {
          lastErrorToastRef.current = now;
          addToast("warning", "Sync unavailable", "Cannot check for remote changes right now");
        }
      }
    };

    // Initial poll after 3 seconds (let local load finish)
    const initialTimer = setTimeout(poll, 3000);
    timer = setInterval(poll, intervalMs);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [templateId, intervalMs, onExternalChange]);

  const acceptRemoteChanges = useCallback(() => {
    if (remoteData) {
      onExternalChange(remoteData);
    }
    setHasRemoteChanges(false);
    setRemoteData(null);
  }, [remoteData, onExternalChange]);

  const dismissRemoteChanges = useCallback(() => {
    setHasRemoteChanges(false);
    setRemoteData(null);
  }, []);

  return {
    hasRemoteChanges,
    remoteData,
    acceptRemoteChanges,
    dismissRemoteChanges,
    markDirty,
    markClean,
  };
}
