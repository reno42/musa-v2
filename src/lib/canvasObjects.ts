interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
