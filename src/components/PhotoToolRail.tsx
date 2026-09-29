/**
 * PhotoToolRail — REQ-PHOTO-FASE4.2c: barra de herramientas vertical con el
 * ORDEN EXACTO y las variantes (flyout) de Photopea/Photoshop, + "Máscaras"
 * como botón extra al final (feature del Modo Foto, fuera del orden de la ref).
 *
 * Convención del repo: iconos SVG inline propios (cero emojis, cero assets de
 * terceros — los glifos imitan la referencia pero son dibujo propio).
 *
 * Interacción estilo Photopea: clic en el cuerpo = herramienta del grupo con
 * su última variante usada; clic en el triangulito (o clic derecho) abre el
 * menú de variantes. Las variantes marcadas "soon" avisan honestamente (sin
 * tools fantasma) y no cambian la selección.
 */
import { useState, type CSSProperties, type ReactNode } from "react";

export type PhotoGroupId =
  | "move" | "marquee" | "lasso" | "quicksel" | "crop" | "eyedropper"
  | "heal" | "brush" | "clone" | "history" | "eraser" | "gradient"
  | "blur" | "dodge" | "type" | "pen" | "pathsel" | "shapes"
  | "hand" | "zoom" | "masks";

export interface PhotoVariantDef {
  id: string;
  label: string;
  /** "soon" = aparece en el flyout pero avisa que llega en una fase posterior */
  status?: "ok" | "soon";
}

export interface PhotoToolGroupDef {
  id: PhotoGroupId;
  label: string;
  key: string;
  /** familia de pintura: opera sobre la capa activa del Modo Componer */
  paint?: boolean;
  /** selección: construye/usa la máscara de selección */
  selection?: boolean;
  variants: PhotoVariantDef[];
}

/** Orden EXACTO de la referencia (Photopea/Photoshop) + máscaras al final. */
export const PHOTO_TOOL_GROUPS: PhotoToolGroupDef[] = [
  { id: "move", label: "Mover", key: "V", variants: [
    { id: "move", label: "Mover" },
    { id: "artboard", label: "Mesas de trabajo", status: "soon" },
  ] },
  { id: "marquee", label: "Marco", key: "M", selection: true, variants: [
    { id: "rect", label: "Marco rectangular" },
    { id: "ellipse", label: "Marco elíptico" },
    { id: "row", label: "Fila de 1 px" },
    { id: "col", label: "Columna de 1 px" },
  ] },
  { id: "lasso", label: "Lazo", key: "L", selection: true, variants: [
    { id: "free", label: "Lazo" },
    { id: "poly", label: "Lazo poligonal" },
    { id: "magnetic", label: "Lazo magnético", status: "soon" },
  ] },
  { id: "quicksel", label: "Selección rápida", key: "W", selection: true, variants: [
    { id: "quick", label: "Selección rápida", status: "soon" },
    { id: "wand", label: "Varita mágica" },
  ] },
  { id: "crop", label: "Recortar", key: "C", variants: [
    { id: "crop", label: "Recorte" },
    { id: "perspective", label: "Perspectiva", status: "soon" },
    { id: "slice", label: "Segmentar", status: "soon" },
  ] },
  { id: "eyedropper", label: "Cuentagotas", key: "I", variants: [
    { id: "picker", label: "Cuentagotas" },
    { id: "sampler", label: "Muestras de color", status: "soon" },
    { id: "ruler", label: "Regla / notas", status: "soon" },
  ] },
  { id: "heal", label: "Pincel corrector", key: "J", paint: true, variants: [
    { id: "spot", label: "Corrector puntual" },
    { id: "heal", label: "Pincel corrector" },
    { id: "patch", label: "Parche (arrastra la selección)" },
    { id: "redeye", label: "Ojos rojos" },
  ] },
  { id: "brush", label: "Pincel", key: "B", paint: true, variants: [
    { id: "brush", label: "Pincel" },
    { id: "pencil", label: "Lápiz" },
    { id: "colorreplace", label: "Sustitución de color", status: "soon" },
    { id: "mixer", label: "Pincel mezclador", status: "soon" },
  ] },
  { id: "clone", label: "Tampón de clonar", key: "S", paint: true, variants: [
    { id: "clone", label: "Tampón de clonar (Alt+clic define el origen)" },
    { id: "pattern", label: "Tampón de patrón", status: "soon" },
  ] },
  { id: "history", label: "Pincel de historial", key: "Y", paint: true, variants: [
    { id: "history", label: "Pincel de historial (pinta el revelado base)" },
    { id: "arthistory", label: "Historial de arte", status: "soon" },
  ] },
  { id: "eraser", label: "Borrador", key: "E", paint: true, variants: [
    { id: "eraser", label: "Borrador" },
    { id: "magic", label: "Borrador mágico (clic borra por color)" },
    { id: "bgeraser", label: "Borrador de fondo", status: "soon" },
  ] },
  { id: "gradient", label: "Degradado", key: "G", paint: true, variants: [
    { id: "linear", label: "Degradado lineal (arrastra el vector)" },
    { id: "radial", label: "Degradado radial (arrastra el radio)" },
    { id: "bucket", label: "Bote de pintura" },
  ] },
  { id: "blur", label: "Desenfoque", key: "U", paint: true, variants: [
    { id: "blur", label: "Desenfoque" },
    { id: "sharpen", label: "Enfocar" },
    { id: "smudge", label: "Dedo (smudge)" },
  ] },
  { id: "dodge", label: "Exponer", key: "O", paint: true, variants: [
    { id: "dodge", label: "Exponer (aclarar)" },
    { id: "burn", label: "Quemar (oscurecer)" },
    { id: "sponge", label: "Esponja (Alt = desaturar)" },
  ] },
  { id: "type", label: "Texto", key: "T", paint: true, variants: [
    { id: "type", label: "Texto (clic coloca; rasterizado v1)" },
    { id: "typevert", label: "Texto vertical", status: "soon" },
    { id: "typemask", label: "Máscara de texto", status: "soon" },
  ] },
  { id: "pen", label: "Pluma", key: "P", paint: true, variants: [
    { id: "pen", label: "Pluma (clic: puntos · Enter cierra · Esc cancela)" },
    { id: "freeform", label: "Pluma libre", status: "soon" },
    { id: "curvature", label: "Curvatura", status: "soon" },
  ] },
  { id: "pathsel", label: "Selección de trazado", key: "A", variants: [
    { id: "path", label: "Selección de trazado (v1: sin vectores)", status: "soon" },
  ] },
  // Desviación documentada: la ref usa U para formas, pero U ya lo tiene el
  // grupo Desenfoque (herencia de la 4.2b). Formas toma R (libre).
  { id: "shapes", label: "Rectángulo", key: "R", paint: true, variants: [
    { id: "rect", label: "Rectángulo (arrastra)" },
    { id: "ellipse", label: "Elipse (arrastra)" },
    { id: "line", label: "Línea (arrastra)" },
    { id: "polygon", label: "Polígono", status: "soon" },
    { id: "custom", label: "Forma personalizada", status: "soon" },
  ] },
  { id: "hand", label: "Mano", key: "H", variants: [
    { id: "hand", label: "Mano (pan)" },
    { id: "rotate", label: "Rotar vista (N/A en el visor)", status: "soon" },
  ] },
  { id: "zoom", label: "Zoom (Alt+clic aleja)", key: "Z", variants: [
    { id: "zoom", label: "Zoom" },
  ] },
  // Botón EXTRA fuera del orden de la referencia: en Photoshop las máscaras
  // viven en el panel de capas/menú Selección, no en la caja de herramientas;
  // aquí son feature de revelado del Modo Foto (radial/lineal/pincel).
  { id: "masks", label: "Máscaras de revelado", key: "K", variants: [
    { id: "masks", label: "Máscaras (radial, lineal o pincel)" },
  ] },
];

export const GROUP_BY_ID = new Map(PHOTO_TOOL_GROUPS.map((g): [PhotoGroupId, PhotoToolGroupDef] => [g.id, g]));
export const GROUP_BY_KEY = new Map(PHOTO_TOOL_GROUPS.map((g): [string, PhotoGroupId] => [g.key.toLowerCase(), g.id]));
export const isPaintTool = (g: PhotoGroupId) => !!GROUP_BY_ID.get(g)?.paint;

/** Primera variante funcional del grupo (default si el usuario no eligió). */
export const defaultVariantOf = (g: PhotoGroupId): string => {
  const grp = GROUP_BY_ID.get(g);
  return grp?.variants.find(v => v.status !== "soon")?.id || grp?.variants[0]?.id || g;
};

export const findVariant = (g: PhotoGroupId, v: string): PhotoVariantDef | undefined =>
  GROUP_BY_ID.get(g)?.variants.find(x => x.id === v);

// ── iconos (glifos propios estilo Photopea) ────────────────────────────────

const I = (d: string, extra?: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {extra}
  </svg>
);

/** Barras verticales con opacidad decreciente = degradado (sin <defs>). */
const GRAD_BARS = (
  <>
    <path d="M7 7v10" strokeOpacity="1" />
    <path d="M11 7v10" strokeOpacity="0.66" />
    <path d="M15 7v10" strokeOpacity="0.4" />
    <path d="M19 7v10" strokeOpacity="0.18" />
  </>
);

const TOOL_ICONS: Record<PhotoGroupId, ReactNode> = {
  move: I("M6 3l12 9-7 1.2 3.2 6.3-2.7 1.3-3-6.2L5 17.5z"),
  marquee: I("M4 4h16v16H4z", <path d="M4 8v8M20 8v8M8 4h8M8 20h8" strokeDasharray="3 3" />),
  lasso: I("M12 4c4.4 0 8 2.5 8 5.6 0 3.1-3.6 5.6-8 5.6-1.3 0-2.6-.2-3.7-.6M8.3 14.6C5.6 13.7 4 11.8 4 9.6 4 6.5 7.6 4 12 4M9 15.5c-.5 1.6.2 2.7-1 4M11.5 15.9c-.2 1.5.4 2.5-.4 4.1"),
  quicksel: I("M5 3l7 16 2.2-6.3L20.5 11z", <path d="M16.5 3.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" strokeWidth="1.3" />),
  crop: I("M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"),
  eyedropper: I("M19.3 4.7a2.4 2.4 0 00-3.4 0L13 7.6l-1.4-1.4-1.8 1.8 6.2 6.2 1.8-1.8-1.4-1.4 2.9-2.9a2.4 2.4 0 000-3.4zM11 9.5L4.5 16c-.6.6-.9 1.4-.9 2.2V20h1.8c.8 0 1.6-.3 2.2-.9L14 12.5"),
  heal: I("M7.5 13.5l6-6M4.9 10.9l3.4-3.4a2.4 2.4 0 013.4 0l4.8 4.8a2.4 2.4 0 010 3.4l-3.4 3.4a2.4 2.4 0 01-3.4 0l-4.8-4.8a2.4 2.4 0 010-3.4z", <path d="M10 11l3 3M13 11l-3 3" strokeWidth="1.3" />),
  brush: I("M20 4c-3 1-7.6 4.6-9.8 7.6l2.2 2.2C15.4 11.6 19 7 20 4zM9.3 12.6c-1.8.3-3 1.6-3.1 3.6-.1 1.5-1 2.3-2.2 2.8 1.2 1 2.7 1.3 4.1 1 2-.4 3.3-1.8 3.4-3.7"),
  clone: I("M8 21h8M12 17v4M7 13h10l1.5 4h-13zM9 13V9a3 3 0 016 0v4"),
  history: I("M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z", <path d="M9.5 13.2a2.6 2.6 0 015-.9M14.5 12v1.5h-1.5" strokeWidth="1.3" />),
  eraser: I("M7 21h13M5.5 16.5L14 8a2.4 2.4 0 013.4 0l2.1 2.1a2.4 2.4 0 010 3.4L13 20H8.6l-3.1-3.1a2.4 2.4 0 010-3.4z"),
  gradient: I("M4 5h16v14H4z", GRAD_BARS),
  blur: I("M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z", <path d="M9 14c.8 1 1.6 1.4 3 1.4s2.2-.4 3-1.4" strokeWidth="1.3" />),
  dodge: I("M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"),
  type: I("M5 6V4h14v2M12 4v16M9 20h6"),
  pen: I("M12 3l5.5 5.5-8 8a2 2 0 01-1 .5L4 18.5l1.5-4.5a2 2 0 01.5-1zM13.5 5.5l5 5", <path d="M10.5 13.5h.01" strokeWidth="2.4" />),
  pathsel: I("M6 3l12 8-5.5 1L15 19l-3 1.2-2.2-6L6 17z"),
  shapes: I("M4 6h16v12H4z"),
  hand: I("M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5v-1a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7m0-3.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6.5 7-3 0-4.4-1.2-6-3.6L5 14.6c-.9-1.3.7-3 2-2l1 1.2"),
  zoom: I("M10.5 3a7.5 7.5 0 105.3 12.8L21 21M10.5 3a7.5 7.5 0 015.3 12.8M10.5 7v7M7 10.5h7"),
  masks: I("M12 3a9 9 0 100 18 9 9 0 000-18z", <path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" />),
};

const railBtn = (active: boolean): CSSProperties => ({
  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 5, border: `1px solid ${active ? "rgba(200,184,152,0.55)" : "transparent"}`,
  background: active ? "rgba(200,184,152,0.16)" : "transparent",
  color: active ? "#f0e8d8" : "#9a9384", cursor: "pointer", padding: 0,
  position: "relative",
});

const flyoutCorner: CSSProperties = {
  position: "absolute", right: 1, bottom: 1, width: 7, height: 7,
  borderRight: "1.5px solid currentColor", borderBottom: "1.5px solid currentColor",
  borderBottomRightRadius: 2, opacity: 0.75, pointerEvents: "none",
};

const sep: CSSProperties = { height: 1, width: 22, background: "rgba(255,255,255,0.08)", margin: "3px 0" };

/** Separadores de familia: mismo ritmo visual que la referencia. */
const FAMILY_STARTS = new Set<PhotoGroupId>(["move", "marquee", "crop", "heal", "brush", "history", "type", "hand", "masks"]);

const variantMenu: CSSProperties = {
  position: "absolute", left: 44, zIndex: 30, minWidth: 200,
  background: "rgba(19,19,19,0.98)", border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 6, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

export interface PhotoToolRailProps {
  tool: PhotoGroupId;
  /** groupId → variante activa elegida por el usuario */
  variants: Record<string, string>;
  disabled?: boolean;
  paintColor: string;
  onPick: (group: PhotoGroupId) => void;
  onPickVariant: (group: PhotoGroupId, variant: string) => void;
  onColor: (color: string) => void;
}

/** Rail vertical estilo Photoshop: grupos en orden de la referencia, flyout de
 * variantes por grupo (triangulito o clic derecho) y swatch de color abajo. */
export function PhotoToolRail(props: PhotoToolRailProps) {
  const [menuFor, setMenuFor] = useState<PhotoGroupId | null>(null);
  const activeVariant = (g: PhotoGroupId) => props.variants[g] || defaultVariantOf(g);
  return (
    <div
      data-testid="photo-tool-rail"
      style={{
        flex: "0 0 44px", borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        padding: "8px 0", background: "#0d0d0d", overflowY: "auto", overflowX: "visible",
        opacity: props.disabled ? 0.4 : 1, pointerEvents: props.disabled ? "none" : "auto",
        position: "relative",
      }}
    >
      {PHOTO_TOOL_GROUPS.map((g, i) => {
        const av = activeVariant(g.id);
        const hasMenu = g.variants.length > 1;
        return (
          <span key={g.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, position: "relative" }}>
            {i > 0 && FAMILY_STARTS.has(g.id) && <span style={sep} />}
            <button
              type="button"
              aria-label={`${g.label}: ${findVariant(g.id, av)?.label || av}`}
              title={`${g.label} — ${findVariant(g.id, av)?.label || av} (${g.key})`}
              style={railBtn(props.tool === g.id)}
              onClick={() => { setMenuFor(null); props.onPick(g.id); }}
              onContextMenu={e => { if (hasMenu) { e.preventDefault(); setMenuFor(m => (m === g.id ? null : g.id)); } }}
            >
              {TOOL_ICONS[g.id]}
              {hasMenu && <span style={flyoutCorner} />}
            </button>
            {hasMenu && (
              <span
                role="button" tabIndex={-1} aria-label={`Variantes de ${g.label}`}
                title="Variantes de la herramienta"
                onClick={e => { e.stopPropagation(); setMenuFor(m => (m === g.id ? null : g.id)); }}
                style={{ position: "absolute", right: 0, bottom: 0, width: 12, height: 12, cursor: "pointer" }}
              />
            )}
            {menuFor === g.id && (
              <span style={variantMenu} data-testid={`photo-tool-menu-${g.id}`}>
                {g.variants.map(v => (
                  <button key={v.id} type="button"
                    style={{
                      display: "flex", width: "100%", alignItems: "center", gap: 6, textAlign: "left",
                      fontSize: 10, padding: "5px 7px", borderRadius: 4, cursor: "pointer",
                      border: "1px solid transparent", background: "transparent", color: "#d8d2c4",
                      fontFamily: "inherit",
                      opacity: v.status === "soon" ? 0.55 : 1,
                      ...(av === v.id ? { background: "rgba(200,184,152,0.16)", borderColor: "rgba(200,184,152,0.4)" } : {}),
                    }}
                    onClick={() => { props.onPickVariant(g.id, v.id); if (v.status !== "soon") setMenuFor(null); }}
                  >
                    {v.label}{v.status === "soon" ? " · pronto" : ""}
                  </button>
                ))}
              </span>
            )}
          </span>
        );
      })}
      <span style={sep} />
      <label title="Color de primer plano (pincel/bote/degradado/texto)" style={{ position: "relative", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
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
