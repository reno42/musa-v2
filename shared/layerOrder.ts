/**
 * layerOrder — P1.6 (motion proposal oct-7): explicit z-order overrides for
 * video mode. "Poner un objeto debajo de otro" without mutating the design:
 * a per-frame `layerZ` map (layerId → stack index) is applied in the overlay
 * as a scoped CSS rule; the design editor ignores it (video-only framing,
 * same spirit as reelLayout/reelFx).
 *
 * DOM document order is the base stacking; an explicit map assigns
 * z-index = index to EVERY layer of the frame, so the order is total and
 * predictable. A11y note: the state is never encoded by color alone — the
 * timeline row and the inspector Capas list both show the z value.
 */

/** Swap `layerId` with its neighbor in `order` (document order, last =
 *  topmost). dir +1 = traer hacia el frente, -1 = enviar hacia el fondo.
 *  Returns the FULL explicit map (id → index) or null when the move is
 *  impossible (unknown id, already at the edge). */
export function reorderedLayerZ(
  order: string[],
  layerId: string,
  dir: -1 | 1,
): Record<string, number> | null {
  const i = order.indexOf(layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return null;
  const next = order.slice();
  next[i] = order[j];
  next[j] = order[i];
  const z: Record<string, number> = {};
  next.forEach((id, idx) => { z[id] = idx; });
  return z;
}

/** Render the override map as CSS scoped to one wrapper's scope class
 *  (`.vm-scope-N`), so duplicated frames never leak z rules to each other.
 *  Empty/absent map → "" (the effect removes the style tag). */
export function layerZStyleText(
  scopeCls: string,
  layerZ: Record<string, number> | null | undefined,
): string {
  if (!layerZ) return "";
  const entries = Object.entries(layerZ);
  if (entries.length === 0) return "";
  return entries.map(([id, z]) => `.${scopeCls} [data-layer-id="${id}"]{z-index:${z} !important;}`).join("");
}
