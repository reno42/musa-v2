import type { FrameData } from "../components/DesignFrame";

export type DesignClipboard =
  | {
    kind: "element";
    frameId: string;
    layerId: string;
    html: string;
    css: string;
    layout: { left: string; top: string; translate: string };
    pasteCount: number;
  }
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
  };
  if (clipboard.kind === "frames") return Array.isArray(clipboard.frames);
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
        if (!latest || stored.updatedAt > latest.updatedAt) latest = stored as StoredDesignClipboard;
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
