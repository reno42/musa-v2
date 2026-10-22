import { useEffect, useMemo, useRef, useState } from "react";
import type { FrameData } from "./DesignFrame";
import { buildHtmlCanvasSrcDoc } from "./HtmlCanvas";
import { IconChevronLeft, IconChevronRight, IconX } from "../shared/icons";

interface DesignPresentationProps {
  frames: FrameData[];
  initialFrameId: string | null;
  onClose: () => void;
}

function PresentationSlide({ frame }: { frame: FrameData }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => {
      const { width, height } = stage.getBoundingClientRect();
      setScale(Math.min(width / frame.width, height / frame.height, 1));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [frame.height, frame.width]);

  return (
    <div ref={stageRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: "grid", placeItems: "center", overflow: "hidden", padding: 20 }}>
      <div style={{ width: frame.width * scale, height: frame.height * scale, position: "relative", flexShrink: 0, boxShadow: "0 20px 64px rgba(0,0,0,0.45)" }}>
        <iframe
          key={frame.id}
          title={`Presentación: ${frame.name}`}
          sandbox="allow-same-origin"
          srcDoc={buildHtmlCanvasSrcDoc(frame.html, frame.css, frame.width, frame.height, { includeInteractionBridge: false })}
          style={{
            position: "absolute", inset: 0, width: frame.width, height: frame.height,
            border: "none", display: "block", pointerEvents: "none",
            transform: `scale(${scale})`, transformOrigin: "top left",
            background: frame.background,
          }}
        />
      </div>
    </div>
  );
}

/** Full-screen, read-only playback for a design's ordered frames. */
export function DesignPresentation({ frames, initialFrameId, onClose }: DesignPresentationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => Math.max(0, frames.findIndex((frame) => frame.id === initialFrameId)));
  const activeFrame = frames[index] ?? frames[0];
  const canGoBack = index > 0;
  const canGoForward = index < frames.length - 1;

  const close = () => {
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    onClose();
  };

  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
    if (root && !document.fullscreenElement && root.requestFullscreen) void root.requestFullscreen().catch(() => {});

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        setIndex((value) => Math.min(frames.length - 1, value + 1));
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setIndex(Math.max(0, frames.length - 1));
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [frames.length, onClose]);

  const positionLabel = useMemo(() => `${index + 1} / ${frames.length}`, [index, frames.length]);
  if (!activeFrame) return null;

  return (
    <div
      ref={rootRef}
      className="design-presentation"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Modo presentación"
      style={{
        position: "fixed", inset: 0, zIndex: 10000, background: "#050505", color: "#fff",
        display: "flex", flexDirection: "column", outline: "none", fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 14px", background: "rgba(8,8,8,0.86)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeFrame.name}</div>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 11, marginTop: 2 }}>{positionLabel}</div>
        </div>
        <button type="button" onClick={close} aria-label="Cerrar presentación" title="Cerrar presentación (Esc)" style={controlStyle}>
          <IconX size={17} />
        </button>
      </div>

      <PresentationSlide frame={activeFrame} />

      <div style={{ height: 64, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 16px", background: "rgba(8,8,8,0.86)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={!canGoBack} aria-label="Frame anterior" title="Anterior (←)" style={controlStyle}>
          <IconChevronLeft size={18} />
        </button>
        <span aria-live="polite" style={{ minWidth: 52, textAlign: "center", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.75)" }}>{positionLabel}</span>
        <button type="button" onClick={() => setIndex((value) => Math.min(frames.length - 1, value + 1))} disabled={!canGoForward} aria-label="Siguiente frame" title="Siguiente (→ o Espacio)" style={controlStyle}>
          <IconChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

const controlStyle = {
  width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: 0, border: "1px solid rgba(255,255,255,0.18)", borderRadius: 7,
  background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer",
} as const;
