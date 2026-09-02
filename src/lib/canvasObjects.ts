interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function toFrameLocalBounds(
  visual: { left: number; top: number; width: number; height: number },
  frame: { left: number; top: number },
  zoom: number,
): CanvasBounds {
  const scale = zoom > 0 ? zoom : 1;
  return {
    x: (visual.left - frame.left) / scale,
    y: (visual.top - frame.top) / scale,
    width: visual.width / scale,
    height: visual.height / scale,
  };
}

export type CanvasResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export function rotationDegreesFromTransform(transform: string): number {
  const match = /rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/i.exec(transform);
  return match ? Number(match[1]) : 0;
}

export function rotationFromPointer(
  center: { x: number; y: number },
  startPointer: { x: number; y: number },
  currentPointer: { x: number; y: number },
  initialDegrees: number,
): number {
  const start = Math.atan2(startPointer.y - center.y, startPointer.x - center.x);
  const current = Math.atan2(currentPointer.y - center.y, currentPointer.x - center.x);
  return initialDegrees + ((current - start) * 180) / Math.PI;
}

export function isRoundableCanvasShape(kind: string, html: string, borderRadius: string): boolean {
  return kind === "shape" && /^\s*<div\b/i.test(html) && !/%/.test(borderRadius);
}

export function resizeCanvasObjectBounds(
  bounds: CanvasBounds,
  direction: CanvasResizeDirection,
  deltaX: number,
  deltaY: number,
  minSize = 8,
): CanvasBounds {
  const fromWest = direction.includes("w");
  const fromEast = direction.includes("e");
  const fromNorth = direction.includes("n");
  const fromSouth = direction.includes("s");
  const width = fromWest
    ? Math.max(minSize, bounds.width - deltaX)
    : fromEast ? Math.max(minSize, bounds.width + deltaX) : bounds.width;
  const height = fromNorth
    ? Math.max(minSize, bounds.height - deltaY)
    : fromSouth ? Math.max(minSize, bounds.height + deltaY) : bounds.height;
  return {
    x: fromWest ? bounds.x + bounds.width - width : bounds.x,
    y: fromNorth ? bounds.y + bounds.height - height : bounds.y,
    width,
    height,
  };
}

interface CanvasObjectInput extends CanvasBounds {
  id: string;
  name?: string;
  kind?: string;
  frameId?: string | null;
  html: string;
  css: string;
  zIndex?: number;
}

export function inferCanvasObjectKind(html: string): string {
  return /data-layer-kind=["']([^"']+)["']/i.exec(html)?.[1]?.toLowerCase() || "shape";
}

export function normalizeCanvasObject(object: CanvasObjectInput, index: number) {
  return {
    ...object,
    name: object.name?.trim() || `Object ${index + 1}`,
    kind: object.kind || inferCanvasObjectKind(object.html),
    frameId: null,
    x: Number(object.x) || 0,
    y: Number(object.y) || 0,
    width: Math.max(1, Number(object.width) || 1),
    height: Math.max(1, Number(object.height) || 1),
    zIndex: Number.isFinite(Number(object.zIndex)) ? Number(object.zIndex) : index,
  };
}

export function findCanvasObjectPosition(
  frames: CanvasBounds[],
  objects: CanvasBounds[],
  gap = 100,
): { x: number; y: number } {
  const all = [...frames, ...objects];
  if (all.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(...all.map(item => item.x + item.width)) + gap,
    y: Math.min(...all.map(item => item.y)),
  };
}
