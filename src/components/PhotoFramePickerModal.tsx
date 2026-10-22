/**
 * PhotoFramePickerModal — origen del Modo Foto cuando se entra desde el menú
 * "Editor de fotos". En vez de exigir una foto seleccionada (M-27), lista los
 * frames del diseño: elegir uno lo rasteriza a una copia pixel (2×, vía
 * rasterizeFrame) y abre el revelado sobre esa copia. El diseño original no
 * se toca hasta que se aplica la variante (y al aplicar entra como capa
 * nueva encima — ver handlePhotoApplyToLayer en EditorV2).
 *
 * La miniatura usa el MISMO rasterizador que el export de video/covers
 * (frameCapture.ts), así la vista previa es fiel al resultado real.
 */

import { useEffect, useState } from "react";
import type { FrameData } from "./DesignFrame";
import { rasterizeFrame } from "../lib/frameCapture";

interface PhotoFramePickerModalProps {
  frames: FrameData[];
  /** Hay una capa de imagen seleccionada en el lienzo → atajo al flujo clásico. */
  hasSelectedPhoto: boolean;
  selectedPhotoName: string | null;
  /** Frame en curso de rasterización (bloquea doble click; estado en el padre). */
  busyFrameId: string | null;
  onPickFrame: (frame: FrameData) => void;
  onOpenSelectedPhoto: () => void;
  onClose: () => void;
}

/** Lado máx de la miniatura en px reales — barato y nítido en la grilla. */
const THUMB_SIDE = 320;

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  width: "min(720px, calc(100vw - 48px))", maxHeight: "calc(100vh - 64px)",
  background: "#101010", border: "1px solid rgba(200,184,152,0.18)", borderRadius: 10,
  display: "flex", flexDirection: "column", overflow: "hidden",
  boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
};

const smallBtn: React.CSSProperties = {
  fontSize: 11, padding: "5px 10px", borderRadius: 4,
  border: "1px solid rgba(200,184,152,0.2)", background: "rgba(200,184,152,0.06)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};

const muted: React.CSSProperties = { fontSize: 11, lineHeight: 1.5, color: "#8a8577" };

export function PhotoFramePickerModal({
  frames, hasSelectedPhoto, selectedPhotoName, busyFrameId,
  onPickFrame, onOpenSelectedPhoto, onClose,
}: PhotoFramePickerModalProps) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Miniaturas en serie (rasterizar en paralelo satura memoria en diseños
  // grandes). El flag cancela el loop si el modal se desmonta a medio camino.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const frame of frames) {
        if (cancelled) return;
        const scale = Math.max(0.08, Math.min(0.35, THUMB_SIDE / Math.max(frame.width, frame.height)));
        try {
          const canvas = await rasterizeFrame(
            { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background: frame.background || "transparent" },
            scale,
          );
          if (cancelled) return;
          const url = canvas.toDataURL("image/jpeg", 0.72);
          setThumbs(prev => ({ ...prev, [frame.id]: url }));
        } catch {
          if (cancelled) return;
          setFailed(prev => ({ ...prev, [frame.id]: true }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [frames]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Elegir origen del Modo Foto">
      <div style={cardStyle}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c8b898" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v12H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, color: "#c8b898" }}>MODO FOTO — ELEGIR ORIGEN</span>
          <div style={{ flex: 1 }} />
          <button type="button" style={smallBtn} onClick={onClose} aria-label="Cerrar">Cerrar</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* atajo: foto ya seleccionada en el lienzo → flujo clásico intacto */}
          {hasSelectedPhoto && (
            <button
              type="button"
              onClick={onOpenSelectedPhoto}
              style={{ ...smallBtn, display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "9px 12px", borderColor: "rgba(159,214,178,0.35)", color: "#9fd6b2" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="M4 17l5-5 4 4 3-2 4 3" />
              </svg>
              <span>
                Editar la foto seleccionada{selectedPhotoName ? ` — ${selectedPhotoName}` : ""}
              </span>
            </button>
          )}

          {/* frames → copia pixel */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, color: "#b0aa98", marginBottom: 8 }}>
              Frames del diseño — se rasterizan para revelarlos como pixel
            </div>
            {frames.length === 0 ? (
              <div style={{ ...muted, padding: "12px 0" }}>
                Este diseño no tiene frames. Para editar una foto puntual, selecciónala en el lienzo y usa "Editar foto".
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {frames.map(frame => {
                  const busy = busyFrameId === frame.id;
                  const thumb = thumbs[frame.id];
                  return (
                    <button
                      key={frame.id}
                      type="button"
                      disabled={busyFrameId != null}
                      onClick={() => onPickFrame(frame)}
                      title={busy ? "Rasterizando…" : `Rasterizar "${frame.name}" y abrir en Modo Foto`}
                      style={{
                        textAlign: "left", cursor: busyFrameId != null ? "wait" : "pointer",
                        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden",
                        background: "#161616", padding: 0, fontFamily: "inherit", color: "inherit",
                        opacity: busyFrameId != null && !busy ? 0.5 : 1,
                      }}
                    >
                      <div style={{ width: "100%", aspectRatio: "4 / 3", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                        {thumb ? (
                          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        ) : failed[frame.id] ? (
                          <span style={muted}>Sin vista previa</span>
                        ) : (
                          <span style={muted}>{busy ? "Rasterizando…" : "Generando…"}</span>
                        )}
                      </div>
                      <div style={{ padding: "7px 9px" }}>
                        <div style={{ fontSize: 11, color: "#e0d6c0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{frame.name || "Frame"}</div>
                        <div style={{ ...muted, marginTop: 2 }}>{frame.width}×{frame.height}{busy ? " — procesando" : ""}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={muted}>
            El frame se convierte en una copia pixel (2×) y se abre en el revelado: luz, color, curvas, máscaras, pincel y capas de composición. El diseño original no se toca hasta que apliques — y al aplicar, el resultado entra como capa nueva encima.
          </div>
        </div>
      </div>
    </div>
  );
}
