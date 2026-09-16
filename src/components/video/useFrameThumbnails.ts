/**
 * useFrameThumbnails — cheap static PNG renders of each frame, cached by
 * content hash. Shared by the Video Mode media panel and the timeline's
 * take clips (extracted from the v1 overlay so every surface shows the
 * SAME thumbnails without re-rasterizing).
 */

import { useEffect, useRef, useState } from "react";
import { rasterizeFrame } from "../../lib/frameCapture";
import type { FrameData } from "../DesignFrame";

export function useFrameThumbnails(frames: FrameData[], targetHeight = 96): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const doneRef = useRef<Set<string>>(new Set());
  const stamp = frames.map(f => `${f.id}:${(f.contentHash || "").slice(0, 8)}`).join("|");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const f of frames) {
        if (cancelled) return;
        if (doneRef.current.has(f.id)) continue;
        doneRef.current.add(f.id);
        try {
          const scale = Math.min(1, targetHeight / Math.max(1, f.height));
          const canvas = await rasterizeFrame(
            { html: f.html, css: f.css, width: f.width, height: f.height, background: f.background },
            scale,
          );
          const url = canvas.toDataURL("image/png");
          if (cancelled) return;
          setThumbs(prev => (prev[f.id] ? prev : { ...prev, [f.id]: url }));
        } catch {
          doneRef.current.delete(f.id); // allow a retry on next stamp
          /* thumbnail is cosmetic — skip failures */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, targetHeight]);

  return thumbs;
}
