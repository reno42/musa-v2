// uiObserver — FASE 2 del ghost: extrae la UI como TEXTO estructurado para que
// el decisor (ghostBrain hoy, router v3 mañana) lea la pantalla sin screenshots.
//
// Reglas del spec (REPORTE_MIRA_fase2_ghost.md Parte 1):
//   - Selectores estables: [data-testid] > aria-label > title (+ placeholder en
//     inputs). Si un componente no tiene ninguno, se le AGREGA al React — pero
//     aquí abajo el fallback posicional siempre responde, así que el observer
//     nunca se queda mudo mientras esos data-testid van cayendo.
//   - Cap ~60 elementos, priorizando visibles en viewport + dock.
//   - Una corrida < 20ms: es solo querySelectorAll + un getBoundingClientRect
//     por candidato. Cero getComputedStyle, cero reflows encadenados.

export type UIElementRole =
  | "button"
  | "input"
  | "tab"
  | "link"
  | "canvas"
  | "frame"
  | "menu"
  | "other";

export interface UIElement {
  role: UIElementRole;
  /** Texto visible / aria-label / title / placeholder — lo que el modelo lee. */
  label: string;
  /** Selector CSS estable para ejecutar la acción (querySelector directo). */
  selector: string;
  /** Viewport coords — para mover el cursor fantasma al elemento. */
  bbox: { x: number; y: number; w: number; h: number };
}

const CANDIDATE_SELECTOR = [
  "button",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='switch']",
  "[role='checkbox']",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "a[href]",
  "canvas",
  "[data-frame-id]",
].join(",");

const MAX_ELEMENTS = 60;
const LABEL_MAX = 70;

/** Escape de comillas para selectores de atributo ([aria-label="..."]). */
const attrEscape = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** id con pinta de auto-generado (css-abc123, :r3:, radix-…) NO es estable. */
const looksGenerated = (id: string) =>
  !id || /^(:r|:|radix|css-|__|el_)/.test(id) || /\d{4,}/.test(id);

/**
 * Selector estable del elemento, por prioridad del spec. El fallback
 * posicional (último recurso) construye un path corto y único al momento.
 */
function stableSelector(el: HTMLElement): string {
  const ts = el.getAttribute("data-testid");
  if (ts) return `[data-testid="${attrEscape(ts)}"]`;
  const al = el.getAttribute("aria-label");
  if (al) return `[aria-label="${attrEscape(al)}"]`;
  const title = el.getAttribute("title");
  if (title) return `[title="${attrEscape(title)}"]`;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    const ph = el.getAttribute("placeholder");
    if (ph) return `${tag}[placeholder="${attrEscape(ph)}"]`;
    const nm = el.getAttribute("name");
    if (nm) return `${tag}[name="${attrEscape(nm)}"]`;
    const type = el.getAttribute("type");
    if (type === "email" || type === "password") return `${tag}[type="${type}"]`;
  }
  const id = el.id;
  if (!looksGenerated(id)) return `#${CSS.escape(id)}`;
  // Fallback posicional: sube hasta un ancla con id/testido estable y arma
  // el path con nth-of-type (máx 4 tramos — barato de generar y de resolver).
  const segs: string[] = [];
  let cur: HTMLElement | null = el;
  for (let depth = 0; cur && depth < 4; depth++) {
    // Local antes de cualquier closure: evita la inferencia circular
    // parent→cur→parent del narrowing del for.
    const node: HTMLElement = cur;
    const tag = node.tagName;
    const parent = node.parentElement;
    if (!parent) break;
    const sibs = Array.from(parent.children).filter(c => (c as HTMLElement).tagName === tag);
    const idx = sibs.indexOf(node) + 1;
    const self = node.getAttribute("data-testid");
    if (self && depth > 0) {
      segs.unshift(`[data-testid="${attrEscape(self)}"] > ${tag.toLowerCase()}`);
      break;
    }
    segs.unshift(`${tag.toLowerCase()}:nth-of-type(${idx})`);
    if (parent.id && !looksGenerated(parent.id)) {
      segs.unshift(`#${CSS.escape(parent.id)}`);
      break;
    }
    cur = parent;
  }
  return segs.join(" > ");
}

function roleOf(el: HTMLElement): UIElementRole {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  if (role === "tab") return "tab";
  if (role === "menuitem" || role === "menu") return "menu";
  if (tag === "canvas") return "canvas";
  if (el.hasAttribute("data-frame-id")) return "frame";
  if (tag === "button" || role === "button" || role === "switch" || role === "checkbox") return "button";
  if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return "input";
  if (tag === "a") return "link";
  return "other";
}

function labelOf(el: HTMLElement): string {
  const al = el.getAttribute("aria-label");
  if (al) return al.slice(0, LABEL_MAX);
  const title = el.getAttribute("title");
  if (title) return title.slice(0, LABEL_MAX);
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    const input = el as HTMLInputElement;
    return (input.placeholder || input.value || input.type || "").slice(0, LABEL_MAX);
  }
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, LABEL_MAX);
  return tag;
}

/**
 * Observa la UI actual. Solo elementos visibles (área > 0, presentes en
 * layout, intersectando el viewport — el dock del chat vive en el viewport).
 * Prioriza visibles; recorta a MAX_ELEMENTS sin re-ordenar el flujo del DOM
 * dentro de cada grupo para que el texto sea estable entre pasos.
 */
export function observeUI(): UIElement[] {
  if (typeof document === "undefined") return [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const inViewport: UIElement[] = [];
  const offscreen: UIElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const raw of document.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    // Visibilidad barata: sin layout, offsetParent===null ⇒ display:none en
    // un ancestro. Los fixed (dock, badge) sí tienen rect aunque offsetParent
    // sea null, así que se aceptan por rect.
    const r = raw.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (raw.offsetParent === null && (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw)) continue;
    const el: UIElement = {
      role: roleOf(raw),
      label: labelOf(raw),
      selector: stableSelector(raw),
      bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
    const visible = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    (visible ? inViewport : offscreen).push(el);
    if (inViewport.length >= MAX_ELEMENTS) break;
  }
  return inViewport.length >= MAX_ELEMENTS ? inViewport.slice(0, MAX_ELEMENTS) : [...inViewport, ...offscreen].slice(0, MAX_ELEMENTS);
}

const ROLE_ES: Record<UIElementRole, string> = {
  button: "botón",
  input: "input",
  tab: "tab",
  link: "link",
  canvas: "canvas",
  frame: "frame",
  menu: "menú",
  other: "otro",
};

/** Serialización para el prompt: una línea por elemento, role + label + selector. */
export function uiToText(els: UIElement[]): string {
  return els
    .map(e => `[${ROLE_ES[e.role]}] ${e.label} — sel: ${e.selector}`)
    .join("\n");
}
