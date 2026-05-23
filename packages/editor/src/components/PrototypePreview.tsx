import { useState, useEffect, useCallback, useRef } from "react";
import type { PrototypeTransition } from "@futuraria/shared";
import type { PrototypeActions } from "../hooks/usePrototype";
import type { FrameInfo } from "../hooks/useCanvas";
import { getTransitionCSS, getDeviceDimensions } from "../hooks/usePrototype";

// ─── Props ───────────────────────────────────────────────────────

interface Props {
  prototype: PrototypeActions;
  frames: FrameInfo[];
  /** Render a frame's content as React elements. Called for each visible frame. */
  renderFrame: (frameId: string, width: number, height: number) => React.ReactNode;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────

export function PrototypePreview({ prototype, frames, renderFrame, onClose }: Props) {
  const [currentFrameId, setCurrentFrameId] = useState<string | null>(
    prototype.previewFrameIdRef.current,
  );
  const [overlays, setOverlays] = useState<
    Array<{ frameId: string; position: { x: number; y: number } }>
  >([]);
  const [device, setDevice] = useState<"phone" | "tablet" | "desktop">(
    prototype.previewDeviceRef.current,
  );
  const [transitioning, setTransitioning] = useState(false);
  const [transitionStyle, setTransitionStyle] = useState<React.CSSProperties>({});
  const [prevFrameId, setPrevFrameId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with prototype state
  useEffect(() => {
    setCurrentFrameId(prototype.previewFrameIdRef.current);
    setOverlays([...prototype.activeOverlaysRef.current]);
  }, [prototype]);

  // Keyboard: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        prototype.stopPreview();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prototype, onClose]);

  // Device change
  const handleDeviceChange = useCallback(
    (d: "phone" | "tablet" | "desktop") => {
      setDevice(d);
      prototype.setPreviewDevice(d);
    },
    [prototype],
  );

  // Navigate with transition
  const handleNavigate = useCallback(
    (frameId: string, transition?: PrototypeTransition) => {
      if (!transition || transition.type === "instant") {
        prototype.navigateToFrame(frameId, transition);
        setCurrentFrameId(frameId);
        setOverlays([...prototype.activeOverlaysRef.current]);
        return;
      }

      // Start exit transition
      setTransitioning(true);
      setPrevFrameId(currentFrameId);
      const exitCSS = getTransitionCSS(transition).exiting;
      setTransitionStyle(exitCSS);

      // After exit, switch frame and start enter transition
      setTimeout(() => {
        prototype.navigateToFrame(frameId, transition);
        setCurrentFrameId(frameId);
        setOverlays([...prototype.activeOverlaysRef.current]);
        const enterCSS = getTransitionCSS(transition).entering;
        setTransitionStyle(enterCSS);

        // Clear transition after animation completes
        setTimeout(() => {
          setTransitioning(false);
          setPrevFrameId(null);
          setTransitionStyle({});
        }, transition.duration + 50);
      }, transition.duration);
    },
    [prototype, currentFrameId],
  );

  // Expose navigate to prototype for executeTrigger
  useEffect(() => {
    // Patch the prototype's navigateToFrame to use our transition-aware version
    const originalNavigate = prototype.navigateToFrame;
    (prototype as any)._previewNavigate = handleNavigate;

    return () => {
      delete (prototype as any)._previewNavigate;
    };
  }, [prototype, handleNavigate]);

  const dims = getDeviceDimensions(device);
  const currentFrame = frames.find((f) => f.id === currentFrameId);

  if (!currentFrame) {
    return (
      <div className="proto-preview-overlay">
        <div className="proto-preview-empty">
          No frame selected for preview
          <button
            className="proto-preview-close"
            onClick={() => {
              prototype.stopPreview();
              onClose();
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="proto-preview-overlay" ref={containerRef}>
      {/* Top bar */}
      <div className="proto-preview-topbar">
        <div className="proto-preview-topbar-left">
          <button
            className="proto-preview-close"
            onClick={() => {
              prototype.stopPreview();
              onClose();
            }}
          >
            ✕ Close Preview
          </button>
          <span className="proto-preview-frame-name">{currentFrame.name}</span>
        </div>

        <div className="proto-preview-topbar-center">
          <div className="proto-device-selector">
            {(["phone", "tablet", "desktop"] as const).map((d) => (
              <button
                key={d}
                className={`proto-device-btn ${device === d ? "active" : ""}`}
                onClick={() => handleDeviceChange(d)}
                title={getDeviceDimensions(d).label}
              >
                {d === "phone" ? "📱" : d === "tablet" ? "📱" : "🖥️"}
              </button>
            ))}
          </div>
        </div>

        <div className="proto-preview-topbar-right">
          <span className="proto-preview-size">
            {dims.width} × {dims.height}
          </span>
        </div>
      </div>

      {/* Preview container */}
      <div className="proto-preview-content">
        {/* Device frame */}
        <div
          className={`proto-device-frame proto-device-${device}`}
          style={{
            width: dims.width,
            height: dims.height,
          }}
        >
          {/* Frame content with transitions */}
          <div className="proto-frame-container" style={{ position: "relative", width: "100%", height: "100%" }}>
            {/* Current frame */}
            <div
              className="proto-frame-content"
              style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                ...(transitioning && prevFrameId ? transitionStyle : {}),
              }}
            >
              {renderFrame(currentFrameId!, dims.width, dims.height)}
            </div>

            {/* Previous frame (for exit animation) */}
            {transitioning && prevFrameId && (
              <div
                className="proto-frame-content proto-frame-exiting"
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  ...getTransitionCSS({ type: "dissolve", duration: 0, easing: "linear" }).exiting,
                }}
              >
                {renderFrame(prevFrameId, dims.width, dims.height)}
              </div>
            )}
          </div>

          {/* Overlay frames */}
          {overlays.map((overlay) => {
            const overlayFrame = frames.find((f) => f.id === overlay.frameId);
            if (!overlayFrame) return null;
            return (
              <div
                key={overlay.frameId}
                className="proto-overlay-frame"
                style={{
                  position: "absolute",
                  left: overlay.position.x,
                  top: overlay.position.y,
                  pointerEvents: "auto",
                }}
              >
                <div className="proto-overlay-content">
                  {renderFrame(overlay.frameId, dims.width, dims.height)}
                </div>
                <button
                  className="proto-overlay-close"
                  onClick={() => {
                    prototype.closeOverlay(overlay.frameId);
                    setOverlays([...prototype.activeOverlaysRef.current]);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* Interactive overlay — captures click/hover events */}
          <PreviewInteractionLayer
            prototype={prototype}
            currentFrameId={currentFrameId!}
            onNavigate={handleNavigate}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Preview Interaction Layer ───────────────────────────────────

function PreviewInteractionLayer({
  prototype,
  currentFrameId,
  onNavigate,
}: {
  prototype: PrototypeActions;
  currentFrameId: string;
  onNavigate: (frameId: string, transition?: PrototypeTransition) => void;
}) {
  // This layer renders invisible clickable areas over elements that have interactions
  // In a real implementation, this would map to actual canvas positions
  // For now, we provide the interaction mechanism

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // In preview mode, we check if the click target has a layerId
      // that maps to an interaction. This is a simplified version.
      const target = e.target as HTMLElement;
      const layerId = target.getAttribute("data-layer-id");
      if (layerId) {
        prototype.executeTrigger(layerId, "click");
      }
    },
    [prototype],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const layerId = target.getAttribute("data-layer-id");
      if (layerId) {
        prototype.executeTrigger(layerId, "hover");
      }
    },
    [prototype],
  );

  return (
    <div
      className="proto-interaction-layer"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    >
      {/* Interactive elements would be rendered here based on interactions */}
    </div>
  );
}
