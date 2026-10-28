import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, TouchEvent as ReactTouchEvent } from "react";
import type { FrameData } from "./DesignFrame";
import { buildHtmlCanvasSrcDoc } from "./HtmlCanvas";
import { IconChevronLeft, IconChevronRight, IconX } from "../shared/icons";

interface DesignPresentationProps {
  frames: FrameData[];
  initialFrameId: string | null;
  onClose: () => void;
}

function PresentationSlide({ frame, compact }: { frame: FrameData; compact: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [fontReadyFrameId, setFontReadyFrameId] = useState<string | null>(null);

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

  const markFontsReady = () => {
    const frameId = frame.id;
    const fontSet = iframeRef.current?.contentDocument?.fonts;
    if (!fontSet) {
      setFontReadyFrameId(frameId);
      return;
    }
    void fontSet.ready.catch(() => undefined).then(() => setFontReadyFrameId(frameId));
  };

  return (
    <div ref={stageRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: "grid", placeItems: "center", overflow: "hidden", padding: compact ? 8 : 20 }}>
      <div style={{ width: frame.width * scale, height: frame.height * scale, position: "relative", flexShrink: 0, boxShadow: "0 20px 64px rgba(0,0,0,0.45)" }}>
        <iframe
          ref={iframeRef}
          key={frame.id}
          title={`Presentación: ${frame.name}`}
          sandbox="allow-same-origin"
          srcDoc={buildHtmlCanvasSrcDoc(frame.html, frame.css, frame.width, frame.height, { includeInteractionBridge: false })}
          onLoad={markFontsReady}
          style={{
            position: "absolute", inset: 0, width: frame.width, height: frame.height,
            border: "none", display: "block", pointerEvents: "none",
            transform: `scale(${scale})`, transformOrigin: "top left",
            background: frame.background, opacity: fontReadyFrameId === frame.id ? 1 : 0,
            transition: "opacity 120ms ease-out",
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
  // Chrome compacto en pantallas chicas — mismo criterio que la barra móvil
  // del editor (ancho <768px).
  const [compact, setCompact] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setCompact(window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Fullscreen es un extra, no un requisito: iOS no permite fullscreen de
  // elementos y el overlay fixed ya cubre la pantalla, así que un rechazo se
  // ignora. Solo cerramos al SALIR de fullscreen si llegamos a entrar —
  // cerrar en el primer fullscreenchange cerraría el visor en móviles que
  // disparan el evento sin que el usuario pida salir.
  const enteredFullscreenRef = useRef(false);

  const close = () => {
    const doc = document as FsDocument;
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    onClose();
  };

  useEffect(() => {
    const root = rootRef.current as FsElement | null;
    root?.focus();
    const doc = document as FsDocument;
    if (root && !doc.fullscreenElement && !doc.webkitFullscreenElement) {
      try {
        const request = root.requestFullscreen
          ? root.requestFullscreen()
          : root.webkitRequestFullscreen
            ? root.webkitRequestFullscreen()
            : null;
        if (request && typeof (request as Promise<void>).then === "function") void (request as Promise<void>).catch(() => {});
      } catch { /* el overlay fixed cubre igual */ }
    }

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
      const doc = document as FsDocument;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        enteredFullscreenRef.current = true;
        return;
      }
      if (enteredFullscreenRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, [frames.length, onClose]);

  // ── Mobile: swipe horizontal cambia de frame; un tap corto sobre la
  //    diapositiva avanza (el iframe es pointer-events:none, el toque cae
  //    aquí). Los botones siguen para quien prefiere apuntar. ──
  const touchStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
  };
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || (event.target as HTMLElement | null)?.closest?.("button")) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.at;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      setIndex((value) => Math.min(frames.length - 1, Math.max(0, value + (dx < 0 ? 1 : -1))));
    } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && elapsed < 400) {
      setIndex((value) => Math.min(frames.length - 1, value + 1));
    }
  };

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
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        position: "fixed", inset: 0, zIndex: 10000, background: "#050505", color: "#fff",
        display: "flex", flexDirection: "column", outline: "none", fontFamily: "Inter, system-ui, sans-serif",
        touchAction: "manipulation", WebkitTapHighlightColor: "transparent", userSelect: "none",
      }}
    >
      <div style={{ height: compact ? 44 : 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: compact ? "0 10px" : "0 14px", background: "rgba(8,8,8,0.86)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeFrame.name}</div>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 11, marginTop: 2 }}>{positionLabel}</div>
        </div>
        <button type="button" onClick={close} aria-label="Cerrar presentación" title="Cerrar presentación (Esc)" style={controlStyle(compact)}>
          <IconX size={17} />
        </button>
      </div>

      <PresentationSlide frame={activeFrame} compact={compact} />

      <div style={{ minHeight: compact ? 56 : 64, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 16px", paddingTop: 8, paddingBottom: "calc(8px + env(safe-area-inset-bottom))", background: "rgba(8,8,8,0.86)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={!canGoBack} aria-label="Frame anterior" title="Anterior (←)" style={controlStyle(compact)}>
          <IconChevronLeft size={18} />
        </button>
        <span aria-live="polite" style={{ minWidth: 52, textAlign: "center", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.75)" }}>{positionLabel}</span>
        <button type="button" onClick={() => setIndex((value) => Math.min(frames.length - 1, value + 1))} disabled={!canGoForward} aria-label="Siguiente frame" title="Siguiente (→ o Espacio)" style={controlStyle(compact)}>
          <IconChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

/** webkit-prefixed fullscreen — iPads viejos solo exponen el prefijo. */
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

const controlStyle = (compact: boolean): CSSProperties => ({
  width: compact ? 40 : 34, height: compact ? 40 : 34, flexShrink: 0,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: 0, border: "1px solid rgba(255,255,255,0.18)", borderRadius: 7,
  background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer",
});
