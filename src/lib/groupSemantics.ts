/**
 * Group semantics — the two Figma container models, switchable at will.
 *
 *   GRUPO (kind="group")       — Figma Group: wrapper is display:contents (no
 *   box, imposes nothing). INVARIANT: every child owns its position (absolute,
 *   in the parent coordinate space) and its text styles (baked inline). Moving
 *   one child can never move a sibling; ungrouping is visually a no-op.
 *
 *   CONTENEDOR (kind="container") — Figma Frame/Auto-Layout: a real box that
 *   may have padding/background/flex and whose children flow and inherit.
 *
 * Conversions BAKE reality: positions and inherited text styles are measured
 * from the rendered DOM (client side) and written onto the children, so legacy
 * / replicated designs normalize losslessly with one click.
 */

/** Inheritable text properties that must survive losing a styled ancestor. */
export const BAKED_TEXT_PROPS = [
  "font-family", "font-size", "font-weight", "font-style",
  "line-height", "letter-spacing", "text-align", "text-transform", "color",
] as const;

export interface ChildBakeEntry {
  layerId: string;
  /** Rect relative to the containing block the child will have AFTER conversion. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Computed inheritable text styles at measure time. */
  inherited: Record<string, string>;
}

export interface ContainerBake {
  containerId: string;
  /** Wrapper's own rect in the same coordinate space (for the backdrop layer). */
  rect: { left: number; top: number; width: number; height: number };
  /** Wrapper visual box worth preserving as a backdrop (null if invisible). */
  backdrop: { background: string; borderRadius: string; border: string; boxShadow: string } | null;
  children: ChildBakeEntry[];
}

/**
 * Measure a container's children from the live editor DOM (shadow roots are
 * open). Coordinates are relative to the child's FUTURE containing block: the
 * nearest positioned ancestor above the wrapper (the wrapper itself stops
 * being a box once it turns into a display:contents group).
 */
export function measureContainerForBake(frameId: string, containerId: string): ContainerBake | null {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  const host = wrapper && [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
  const content = host?.shadowRoot?.getElementById("__df_content") as HTMLElement | null;
  if (!host || !content) return null;
  const container = content.querySelector(`[data-layer-id="${containerId}"]`) as HTMLElement | null;
  if (!container) return null;

  const zoom = (host as HTMLElement).getBoundingClientRect().width / ((host as HTMLElement).offsetWidth || 1);

  // Containing block after conversion: nearest positioned ancestor above the wrapper.
  let anchor: HTMLElement = content;
  let walk = container.parentElement;
  while (walk && walk !== content) {
    if (getComputedStyle(walk).position !== "static") { anchor = walk; break; }
    walk = walk.parentElement;
  }
  const anchorRect = anchor.getBoundingClientRect();
  const originX = anchorRect.left + anchor.clientLeft * zoom;
  const originY = anchorRect.top + anchor.clientTop * zoom;

  const measure = (el: HTMLElement): ChildBakeEntry => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inherited: Record<string, string> = {};
    for (const prop of BAKED_TEXT_PROPS) inherited[prop] = cs.getPropertyValue(prop);
    return {
      layerId: el.getAttribute("data-layer-id") || "",
      left: Math.round((rect.left - originX) / zoom),
      top: Math.round((rect.top - originY) / zoom),
      width: Math.round(rect.width / zoom),
      height: Math.round(rect.height / zoom),
      inherited,
    };
  };

  const children = [...container.children]
    .filter((el): el is HTMLElement => el instanceof HTMLElement || el instanceof SVGElement as any)
    .map(el => measure(el as HTMLElement));

  const ccs = getComputedStyle(container);
  const cRect = container.getBoundingClientRect();
  const hasBg = ccs.backgroundColor !== "rgba(0, 0, 0, 0)" || ccs.backgroundImage !== "none";
  const hasBorder = parseFloat(ccs.borderTopWidth) > 0 || ccs.boxShadow !== "none";
  return {
    containerId,
    rect: {
      left: Math.round((cRect.left - originX) / zoom),
      top: Math.round((cRect.top - originY) / zoom),
      width: Math.round(cRect.width / zoom),
      height: Math.round(cRect.height / zoom),
    },
    backdrop: (hasBg || hasBorder) ? {
      background: ccs.background,
      borderRadius: ccs.borderRadius,
      border: ccs.border,
      boxShadow: ccs.boxShadow,
    } : null,
    children,
  };
}

function parseDoc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function findLayer(doc: Document, layerId: string): HTMLElement | null {
  return doc.querySelector(`[data-layer-id="${layerId}"]`);
}

/** Pin one child at its measured rect and bake inherited text styles it lacks. */
function bakeChild(el: HTMLElement, entry: ChildBakeEntry, pinSize: boolean): void {
  el.style.position = "absolute";
  el.style.left = `${entry.left}px`;
  el.style.top = `${entry.top}px`;
  el.style.margin = "0";
  if (pinSize) {
    el.style.width = `${entry.width}px`;
    el.style.height = `${entry.height}px`;
  }
  for (const prop of BAKED_TEXT_PROPS) {
    if (!el.style.getPropertyValue(prop) && entry.inherited[prop]) {
      el.style.setProperty(prop, entry.inherited[prop]);
    }
  }
}

/**
 * CONTENEDOR → GRUPO. The wrapper becomes a boxless display:contents group;
 * children get pinned/baked so nothing moves and nothing changes typography.
 * If the wrapper painted a visible box, it survives as a backdrop layer.
 */
export function convertContainerToGroup(html: string, bake: ContainerBake): string | null {
  const doc = parseDoc(html);
  const wrapper = findLayer(doc, bake.containerId);
  if (!wrapper) return null;

  for (const entry of bake.children) {
    if (!entry.layerId) continue;
    const child = findLayer(doc, entry.layerId);
    if (!child) continue;
    const isText = /^(h[1-6]|p|span|a|li|label|button|em|strong|small|b|i)$/i.test(child.tagName)
      || (child.children.length === 0 && (child.textContent || "").trim().length > 0);
    bakeChild(child, entry, !isText);
  }

  if (bake.backdrop) {
    const bg = doc.createElement("div");
    bg.setAttribute("data-layer-id", `${bake.containerId}_bg`);
    bg.setAttribute("data-layer-name", "Fondo");
    bg.setAttribute(
      "style",
      `position:absolute;left:${bake.rect.left}px;top:${bake.rect.top}px;width:${bake.rect.width}px;height:${bake.rect.height}px;` +
      `background:${bake.backdrop.background};border-radius:${bake.backdrop.borderRadius};border:${bake.backdrop.border};box-shadow:${bake.backdrop.boxShadow};`,
    );
    wrapper.insertBefore(bg, wrapper.firstChild);
  }

  // The wrapper stops being a box: strip its visual/layout styling entirely.
  wrapper.setAttribute("data-layer-kind", "group");
  wrapper.setAttribute("style", "display:contents;");
  return doc.body.innerHTML;
}

/**
 * GRUPO → CONTENEDOR (best effort, documented): the wrapper becomes a real
 * absolute box at its measured bounds with a vertical auto-layout; children
 * enter the flow ordered by their visual position.
 */
export function convertGroupToContainer(html: string, bake: ContainerBake): string | null {
  const doc = parseDoc(html);
  const wrapper = findLayer(doc, bake.containerId);
  if (!wrapper) return null;

  const minLeft = Math.min(...bake.children.map(c => c.left), bake.rect.left);
  const minTop = Math.min(...bake.children.map(c => c.top), bake.rect.top);
  const gaps: number[] = [];
  const sorted = [...bake.children].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.max(0, sorted[i].top - (sorted[i - 1].top + sorted[i - 1].height)));
  }
  const gap = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 12;

  // Re-order DOM children by visual top so the flow matches what was seen.
  for (const entry of sorted) {
    const child = entry.layerId ? findLayer(doc, entry.layerId) : null;
    if (!child) continue;
    child.style.position = "";
    child.style.left = "";
    child.style.top = "";
    wrapper.appendChild(child);
  }

  wrapper.setAttribute("data-layer-kind", "container");
  wrapper.setAttribute(
    "style",
    `position:absolute;left:${minLeft}px;top:${minTop}px;width:${bake.rect.width}px;` +
    `display:flex;flex-direction:column;gap:${gap}px;`,
  );
  return doc.body.innerHTML;
}

/**
 * Safe ungroup for ANY wrapper kind: children are baked (position in the
 * parent coordinate space + text styles) BEFORE the wrapper dissolves, so
 * nothing jumps, nothing re-styles, nothing is ever lost.
 */
export function ungroupPreservingLayout(html: string, bake: ContainerBake): string | null {
  const doc = parseDoc(html);
  const wrapper = findLayer(doc, bake.containerId);
  if (!wrapper || !wrapper.parentElement) return null;

  for (const entry of bake.children) {
    if (!entry.layerId) continue;
    const child = findLayer(doc, entry.layerId);
    if (!child) continue;
    const isText = /^(h[1-6]|p|span|a|li|label|button|em|strong|small|b|i)$/i.test(child.tagName)
      || (child.children.length === 0 && (child.textContent || "").trim().length > 0);
    bakeChild(child, entry, !isText);
  }

  // Only element children survive (bare text nodes have no layer identity).
  const survivors = [...wrapper.children];
  wrapper.replaceWith(...survivors);
  return doc.body.innerHTML;
}
