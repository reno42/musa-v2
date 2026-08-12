export interface SelectionPoint {
  x: number;
  y: number;
}

export interface SelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function updateSelection(current: readonly string[], layerId: string, additive: boolean): string[] {
  if (!additive) return [layerId];
  const next = new Set(current);
  if (next.has(layerId)) next.delete(layerId);
  else next.add(layerId);
  return [...next];
}

/**
 * Every selector a style change should be written to.
 *
 * The contextual panel only ever knew about the one element it was handed, so
 * setting a fill on a multi-selection painted a single object and left the
 * rest untouched. Selecting several things and applying a tool means applying
 * it to all of them.
 */
export function styleTargets(
  primarySelector: string,
  primaryLayerId: string,
  selectedLayerIds: readonly string[],
): string[] {
  if (!primarySelector) return [];
  if (selectedLayerIds.length < 2) return [primarySelector];

  const targets = selectedLayerIds.map(id =>
    // The primary selector can be compound — an SVG child, say, where the
    // selector reaches past the layer wrapper. Rebuilding it from the layer id
    // alone would style the wrapper instead of the node that was clicked.
    id === primaryLayerId ? primarySelector : `[data-layer-id="${id}"]`,
  );
  if (!targets.includes(primarySelector)) targets.unshift(primarySelector);
  return [...new Set(targets)];
}

export function pickTopmostByBounds<T>(
  itemsInStackOrder: readonly T[],
  point: SelectionPoint,
  getBounds: (item: T) => SelectionBounds,
): T | null {
  for (let index = itemsInStackOrder.length - 1; index >= 0; index--) {
    const item = itemsInStackOrder[index];
    const bounds = getBounds(item);
    if ((bounds.width > 0 || bounds.height > 0)
      && point.x >= bounds.left && point.x <= bounds.right
      && point.y >= bounds.top && point.y <= bounds.bottom) {
      return item;
    }
  }
  return null;
}
