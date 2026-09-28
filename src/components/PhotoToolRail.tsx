/**
 * PhotoToolRail — REQ-PHOTO-FASE4.2b: barra de herramientas vertical estilo
 * Photoshop para el Modo Foto. Iconos SVG inline (convención del repo: cero
 * emojis en UI), tooltips con nombre + atajo, separadores por familia.
 *
 * Herramientas de retoque (corrector/parche/tampón) son implementación
 * client-side simplificada v1: muestreo del propio revelado + feather —
 * NO healing generativo (eso queda en F4.4 BYOK). Documentado en el req.
 */
import type { CSSProperties } from "react";

export type PhotoTool =
  | "move" | "marquee" | "lasso" | "wand"
  | "crop" | "eyedropper"
  | "heal" | "patch" | "clone"
  | "brush" | "eraser" | "fill" | "blur" | "dodge" | "burn"
  | "masks"
  | "hand" | "zoom";

export interface PhotoToolDef {
  id: PhotoTool;
  label: string;
  key: string;
  /** familia de pintura: opera sobre la capa activa del Modo Componer */
  paint?: boolean;
  /** selección: construye/usa la máscara de selección */
  selection?: boolean;
}

export const PHOTO_TOOLS: PhotoToolDef[] = [
  { id: "move", label: "Mover capa", key: "V" },
  { id: "marquee", label: "Marco rectangular", key: "M", selection: true },
  { id: "lasso", label: "Lazo", key: "L", selection: true },
  { id: "wand", label: "Varita mágica", key: "W", selection: true },
  { id: "crop", label: "Recortar", key: "C" },
  { id: "eyedropper", label: "Cuentagotas", key: "I" },
  { id: "heal", label: "Pincel corrector (v1: remuestreo del entorno)", key: "J", paint: true },
  { id: "patch", label: "Parche (arrastra la selección a su origen)", key: "P", paint: true, selection: true },
  { id: "clone", label: "Tampón de clonar (Alt+clic define el origen)", key: "S", paint: true },
  { id: "brush", label: "Pincel", key: "B", paint: true },
  { id: "eraser", label: "Borrador", key: "E", paint: true },
  { id: "fill", label: "Bote de pintura", key: "G", paint: true },
  { id: "blur", label: "Desenfoque", key: "U", paint: true },
  { id: "dodge", label: "Exponer (aclarar)", key: "O", paint: true },
  { id: "burn", label: "Quemar (oscurecer)", key: "N", paint: true },
  { id: "masks", label: "Máscaras de revelado (radial/lineal/pincel)", key: "K" },
  { id: "hand", label: "Mano (pan)", key: "H" },
  { id: "zoom", label: "Zoom (Alt+clic aleja)", key: "Z" },
];

export const TOOL_BY_KEY = new Map(PHOTO_TOOLS.map(t => [t.key.toLowerCase(), t.id]));
export const isPaintTool = (t: PhotoTool) => !!PHOTO_TOOLS.find(x => x.id === t)?.paint;

const I = (d: string, extra?: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {extra}
  </svg>
);

const TOOL_ICONS: Record<PhotoTool, React.ReactNode> = {
  move: I("M5 3l14 8-6 1.5L16 19l-3 1.4-3-6.4L5 17z"),
  marquee: I("M4 4h16v16H4z", <path d="M4 8v8M20 8v8M8 4h8M8 20h8" strokeDasharray="3 3" />),
  lasso: I("M12 4c4.4 0 8 2.5 8 5.6 0 3.1-3.6 5.6-8 5.6-1.3 0-2.6-.2-3.7-.6M8.3 14.6C5.6 13.7 4 11.8 4 9.6 4 6.5 7.6 4 12 4M9 15.5c-.5 1.6.2 2.7-1 4M11.5 15.9c-.2 1.5.4 2.5-.4 4.1"),
  wand: I("M6 18L16 8", <path d="M15 3v2M21 9h-2M19.5 4.5l-1.4 1.4M18 13l-1-1M8 4l.9 1.8L10.7 6.7 8.9 7.6 8 9.4 7.1 7.6 5.3 6.7 7.1 5.8z" strokeWidth="1.3" />),
  crop: I("M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"),
  eyedropper: I("M19.3 4.7a2.4 2.4 0 00-3.4 0L13 7.6l-1.4-1.4-1.8 1.8 6.2 6.2 1.8-1.8-1.4-1.4 2.9-2.9a2.4 2.4 0 000-3.4zM11 9.5L4.5 16c-.6.6-.9 1.4-.9 2.2V20h1.8c.8 0 1.6-.3 2.2-.9L14 12.5"),
  heal: I("M7.5 13.5l6-6M4.9 10.9l3.4-3.4a2.4 2.4 0 013.4 0l4.8 4.8a2.4 2.4 0 010 3.4l-3.4 3.4a2.4 2.4 0 01-3.4 0l-4.8-4.8a2.4 2.4 0 010-3.4z", <path d="M10 11l3 3M13 11l-3 3" strokeWidth="1.3" />),
  patch: I("M4 8h9v9H4zM13 8l3-3h4v4l-3 3M15 15l5 5M20 15l-5 5"),
  clone: I("M8 21h8M12 17v4M7 13h10l1.5 4h-13zM9 13V9a3 3 0 016 0v4"),
  brush: I("M20 4c-3 1-7.6 4.6-9.8 7.6l2.2 2.2C15.4 11.6 19 7 20 4zM9.3 12.6c-1.8.3-3 1.6-3.1 3.6-.1 1.5-1 2.3-2.2 2.8 1.2 1 2.7 1.3 4.1 1 2-.4 3.3-1.8 3.4-3.7"),
  eraser: I("M7 21h13M5.5 16.5L14 8a2.4 2.4 0 013.4 0l2.1 2.1a2.4 2.4 0 010 3.4L13 20H8.6l-3.1-3.1a2.4 2.4 0 010-3.4z"),
  fill: I("M12 3l7.5 7.5a2 2 0 010 2.8l-4.2 4.2a2 2 0 01-2.8 0L5 10M4 20s2-2.7 2-4a2 2 0 014 0c0 1.3-2 4-2 4z", <path d="M19 15s1.5 2 1.5 3a1.5 1.5 0 01-3 0c0-1 1.5-3 1.5-3z" strokeWidth="1.3" />),
  blur: I("M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z", <path d="M9 14c.8 1 1.6 1.4 3 1.4s2.2-.4 3-1.4" strokeWidth="1.3" />),
  dodge: I("M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"),
  burn: I("M12 22c-3.9 0-6-2.4-6-5.4 0-4.2 4.5-5.8 3.5-11.6 3 1.3 4.5 3.9 4.5 6 1-.7 1.5-1.8 1.5-3 1.7 1.7 2.5 4 2.5 6.3 0 4.1-2.1 7.7-6 7.7z"),
  masks: I("M12 3a9 9 0 100 18 9 9 0 000-18z", <path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" />),
  hand: I("M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5v-1a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7m0-3.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6.5 7-3 0-4.4-1.2-6-3.6L5 14.6c-.9-1.3.7-3 2-2l1 1.2"),
  zoom: I("M10.5 3a7.5 7.5 0 105.3 12.8L21 21M10.5 3a7.5 7.5 0 015.3 12.8M10.5 7v7M7 10.5h7"),
};

const railBtn = (active: boolean): CSSProperties => ({
  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 5, border: `1px solid ${active ? "rgba(200,184,152,0.55)" : "transparent"}`,
  background: active ? "rgba(200,184,152,0.16)" : "transparent",
  color: active ? "#f0e8d8" : "#9a9384", cursor: "pointer", padding: 0,
});

const sep: CSSProperties = { height: 1, width: 22, background: "rgba(255,255,255,0.08)", margin: "3px 0" };

/** Principio de familia → separador antes de estos ids. */
const FAMILY_STARTS = new Set(["move", "marquee", "crop", "heal", "brush", "masks", "hand"]);

export interface PhotoToolRailProps {
  tool: PhotoTool;
  disabled?: boolean;
  paintColor: string;
  onPick: (tool: PhotoTool) => void;
  onColor: (color: string) => void;
}

/** Rail vertical estilo Photoshop: iconos por familia + swatch de color abajo. */
export function PhotoToolRail(props: PhotoToolRailProps) {
  let lastGroup = 0;
  return (
    <div
      data-testid="photo-tool-rail"
      style={{
        flex: "0 0 44px", borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        padding: "8px 0", background: "#0d0d0d", overflowY: "auto",
        opacity: props.disabled ? 0.4 : 1, pointerEvents: props.disabled ? "none" : "auto",
      }}
    >
      {PHOTO_TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          {i > 0 && FAMILY_STARTS.has(t.id) && <span style={sep} />}
          <button
            type="button"
            aria-label={t.label}
            title={`${t.label} (${t.key})`}
            style={railBtn(props.tool === t.id)}
            onClick={() => props.onPick(t.id)}
          >
            {TOOL_ICONS[t.id]}
          </button>
        </span>
      ))}
      <span style={sep} />
      <label title="Color de primer plano (pincel/bote)" style={{ position: "relative", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <span style={{
          width: 20, height: 20, borderRadius: 4, background: props.paintColor,
          border: "1px solid rgba(255,255,255,0.35)", display: "block",
        }} />
        <input type="color" value={props.paintColor} onChange={e => props.onColor(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
      </label>
    </div>
  );
}
