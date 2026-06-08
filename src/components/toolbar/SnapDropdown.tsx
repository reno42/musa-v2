import { useState, useRef, useEffect } from "react";

type SnapDropdownProps = Record<string, never>;

export function SnapDropdown(_props: SnapDropdownProps) {
  const [open, setOpen] = useState(false);
  const [snapOn, setSnapOn] = useState(false);
  const [gridSize, setGridSizeLocal] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const callCanvas = (method: string, ...args: any[]) => {
    const ctrl = (window as any).__canvasControls;
    if (ctrl?.[method]) ctrl[method](...args);
  };

  const handleToggleSnap = () => {
    const next = !snapOn;
    setSnapOn(next);
    callCanvas("toggleSnap", next);
  };

  const handleGridSize = (size: number) => {
    setGridSizeLocal(size);
    callCanvas("setGridSize", size);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={`tool-btn${snapOn ? " active" : ""}`}
        onClick={() => setOpen((p) => !p)}
        title={`Snap: ${snapOn ? "ON" : "OFF"} (grid: ${gridSize}px)`}
        aria-label="Snap settings"
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        {snapOn && (
          <span
            style={{
              position: "absolute",
              top: 1,
              right: 1,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#4ade80",
            }}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            left: 48,
            top: 0,
            background: "#16161e",
            border: "1px solid #2a2a3a",
            borderRadius: 8,
            padding: "8px 0",
            minWidth: 160,
            zIndex: 100,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {/* Snap toggle */}
          <button
            type="button"
            onClick={handleToggleSnap}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 12px",
              border: "none",
              background: "transparent",
              color: snapOn ? "#4ade80" : "#7a7668",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 28,
                height: 16,
                borderRadius: 8,
                background: snapOn ? "#4ade80" : "#3a3a4a",
                position: "relative",
                transition: "background 0.15s",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: snapOn ? 14 : 2,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.15s",
                }}
              />
            </span>
            Snap {snapOn ? "ON" : "OFF"}
          </button>

          <div
            style={{
              margin: "4px 12px",
              height: 1,
              background: "#2a2a3a",
            }}
          />

          {/* Grid size */}
          <div
            style={{
              padding: "4px 12px 2px",
              fontSize: 10,
              color: "#7a7668",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Grid Size
          </div>
          {[25, 50, 100].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => handleGridSize(size)}
              style={{
                display: "block",
                width: "100%",
                padding: "5px 12px 5px 24px",
                border: "none",
                background: gridSize === size ? "rgba(200,184,152,0.15)" : "transparent",
                color: gridSize === size ? "#c8b898" : "#7a7668",
                cursor: "pointer",
                fontSize: 12,
                textAlign: "left",
              }}
            >
              {size}px
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
