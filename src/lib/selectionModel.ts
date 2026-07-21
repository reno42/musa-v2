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
