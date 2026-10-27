/**
 * MotionSpec font assets are public/signed Storage URLs supplied by the
 * declarative compiler. Load them once into the document before preview or
 * Canvas export so a custom family does not silently fall back to serif.
 */

export interface MotionFontAsset {
  id: string;
  family: string;
  url: string;
}

export interface MotionFontLoadResult extends MotionFontAsset {
  loaded: boolean;
  reason?: string;
}

const FONT_FAMILY = /^[\p{L}\p{N} _.,'"-]{1,160}$/u;
const publicUrl = (value: unknown): value is string => typeof value === "string" && /^(https?:\/\/|\/)/.test(value);
const loaded = new Map<string, Promise<void>>();

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeAsset(value: unknown): MotionFontAsset | null {
  if (!record(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim().slice(0, 128) : "";
  const family = typeof value.family === "string" ? value.family.trim().slice(0, 160) : "";
  const url = value.url;
  if (!id || !family || !FONT_FAMILY.test(family) || !publicUrl(url)) return null;
  return { id, family, url };
}

/** Extracts only the serializable font declarations the compiler stores in a
 * material payload. It intentionally ignores arbitrary objects from saved
 * JSON. */
export function motionFontAssetsFromPayload(payload: unknown): MotionFontAsset[] {
  if (!record(payload) || !Array.isArray(payload.fontAssets)) return [];
  const unique = new Map<string, MotionFontAsset>();
  for (const raw of payload.fontAssets) {
    const asset = safeAsset(raw);
    if (asset) unique.set(`${asset.family}\u0000${asset.url}`, asset);
  }
  return [...unique.values()];
}

export function motionFontAssetsFromPayloads(payloads: Iterable<unknown>): MotionFontAsset[] {
  const unique = new Map<string, MotionFontAsset>();
  for (const payload of payloads) {
    for (const asset of motionFontAssetsFromPayload(payload)) unique.set(`${asset.family}\u0000${asset.url}`, asset);
  }
  return [...unique.values()];
}

function sourceUrl(url: string): string {
  // FontFace only accepts a CSS source string. Escape the two characters that
  // can terminate its quoted URL; publicUrl already rejects javascript/data.
  return `url("${url.replace(/["\\\r\n]/g, "")}")`;
}

async function loadFont(asset: MotionFontAsset): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) {
    throw new Error("FONT_API_UNAVAILABLE");
  }
  const key = `${asset.family}\u0000${asset.url}`;
  const existing = loaded.get(key);
  if (existing) return existing;
  const work = (async () => {
    const face = new FontFace(asset.family, sourceUrl(asset.url), { display: "block" });
    const resolved = await face.load();
    document.fonts.add(resolved);
    await document.fonts.load(`16px "${asset.family.replace(/["\\]/g, "")}"`);
  })();
  loaded.set(key, work);
  try {
    await work;
  } catch (error) {
    loaded.delete(key);
    throw error;
  }
}

/** Resolves every declared face. Callers decide whether a failed custom face
 * is a preview warning or a hard export failure. */
export async function ensureMotionFonts(assets: Iterable<MotionFontAsset>): Promise<MotionFontLoadResult[]> {
  const unique = new Map<string, MotionFontAsset>();
  for (const asset of assets) unique.set(`${asset.family}\u0000${asset.url}`, asset);
  return Promise.all([...unique.values()].map(async (asset) => {
    try {
      await loadFont(asset);
      return { ...asset, loaded: true };
    } catch (error) {
      return { ...asset, loaded: false, reason: error instanceof Error ? error.message : "FONT_LOAD_FAILED" };
    }
  }));
}
