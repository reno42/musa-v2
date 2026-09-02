import type { FrameData, HtmlCanvasObject } from "../components/DesignFrame";

export interface CanvasObjectClipboardItem {
  layerId: string;
  object: HtmlCanvasObject;
}

export type DesignClipboard =
  | {
    kind: "element";
    frameId: string;
    layerId: string;
    html: string;
    css: string;
    layout: { left: string; top: string; translate: string };
    /** Canvas geometry used when an in-frame element is pasted as a root object. */
    canvasGeometry?: {
      x: number;
      y: number;
      width: number;
      height: number;
      frameLocalX?: number;
      frameLocalY?: number;
      contentWidth?: number;
      contentHeight?: number;
      contentOffsetX?: number;
      contentOffsetY?: number;
      name: string;
      kind: string;
    };
    pasteCount: number;
  }
  | { kind: "canvas-object"; objects: CanvasObjectClipboardItem[]; pasteCount: number }
  | { kind: "frames"; frames: FrameData[]; pasteCount: number };

interface StoredDesignClipboard {
  version: 1;
  updatedAt: number;
  clipboard: DesignClipboard;
}

export const DESIGN_CLIPBOARD_KEY = "futuraria_design_clipboard_v1";

let inMemoryClipboard: StoredDesignClipboard | null = null;

function isDesignClipboard(value: unknown): value is DesignClipboard {
  if (!value || typeof value !== "object") return false;
  const clipboard = value as {
    kind?: unknown;
    frames?: unknown;
    frameId?: unknown;
    layerId?: unknown;
    html?: unknown;
    css?: unknown;
    objects?: unknown;
  };
  if (clipboard.kind === "frames") return Array.isArray(clipboard.frames);
  if (clipboard.kind === "canvas-object") {
    return Array.isArray(clipboard.objects) && clipboard.objects.length > 0
      && clipboard.objects.every(value => {
        if (!value || typeof value !== "object") return false;
        const item = value as { layerId?: unknown; object?: Partial<HtmlCanvasObject> };
        const object = item.object;
        return typeof item.layerId === "string"
          && Boolean(object)
          && typeof object?.id === "string"
          && object.frameId === null
          && typeof object.html === "string"
          && typeof object.css === "string"
          && typeof object.x === "number"
          && typeof object.y === "number"
          && typeof object.width === "number"
          && typeof object.height === "number";
      });
  }
  return clipboard.kind === "element"
    && typeof clipboard.frameId === "string"
    && typeof clipboard.layerId === "string"
    && typeof clipboard.html === "string"
    && typeof clipboard.css === "string";
}

function getBrowserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDesignClipboard(): DesignClipboard | null {
  let latest = inMemoryClipboard;
  try {
    const raw = getBrowserStorage()?.getItem(DESIGN_CLIPBOARD_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<StoredDesignClipboard>;
      if (stored.version === 1 && typeof stored.updatedAt === "number" && isDesignClipboard(stored.clipboard)) {
        // localStorage is shared by every editor tab on this origin, so its
        // valid value is canonical. Comparing timestamps left a race when two
        // tabs copied different selections inside the same millisecond.
        latest = stored as StoredDesignClipboard;
      }
    }
  } catch {
    // The in-memory clipboard remains available when persistence is unavailable.
  }
  inMemoryClipboard = latest;
  return latest?.clipboard ?? null;
}

export function persistDesignClipboard(clipboard: DesignClipboard): boolean {
  const stored: StoredDesignClipboard = {
    version: 1,
    updatedAt: Date.now(),
    clipboard,
  };
  inMemoryClipboard = stored;
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(DESIGN_CLIPBOARD_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}
