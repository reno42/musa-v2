/**
 * The font list the editor searches.
 *
 *   SYSTEM   — Georgia, Helvetica, Courier. Already on the machine, so they
 *              need no loading at all. They were missing purely because they
 *              are not Google Fonts.
 *   GOOGLE   — the whole live library (~1800 families, every variant) straight
 *              from the Webfonts Developer API. Nothing is bundled: the old
 *              curated JSON was a second copy of the catalog that silently
 *              shrank the picker to ~94 whenever the key was missing, and a
 *              reduced catalog must be SEEN, not disguised as the full one.
 *
 * The live list is fetched once per process and kept for 12h, because it is
 * ~1800 entries that change a few times a year and this runs on a serverless
 * function where a cold start already costs more than the parse. A failed
 * fetch retries at most once a minute — an outage must not turn every
 * keystroke into a request against a failing endpoint.
 */

import { SYSTEM_FONTS, LICENSED_ALTERNATIVES } from "../data/systemFonts.js";

export interface CatalogFont {
  family: string;
  category: string;
  variants: string[];
  /** "system" needs no webfont link; "google" does. */
  source: "system" | "google";
  /** Only for system fonts — what to actually write into CSS. */
  stack?: string;
  availability?: string;
}

const GOOGLE_API = "https://www.googleapis.com/webfonts/v1/webfonts";

let liveCache: { fonts: CatalogFont[]; at: number } | null = null;
let lastFailureAt = 0;
const LIVE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;

const asCatalog = (fonts: SystemFontLike[]): CatalogFont[] =>
  fonts.map(f => ({
    family: f.family,
    category: f.category,
    variants: ["regular", "700"],
    source: "system" as const,
    stack: f.stack,
    availability: f.availability,
  }));
type SystemFontLike = { family: string; category: string; stack: string; availability: string };

/**
 * The whole Google library, if a key is configured.
 *
 * Without one — or while Google is unreachable — this returns null and the
 * caller reports the reduced catalog instead of papering over it.
 */
async function fetchGoogleLibrary(): Promise<CatalogFont[] | null> {
  const key = process.env.GOOGLE_FONTS_API_KEY;
  if (!key) return null;
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.fonts;
  if (Date.now() - lastFailureAt < FAILURE_RETRY_MS) return null;
  try {
    const res = await fetch(`${GOOGLE_API}?key=${encodeURIComponent(key)}&sort=popularity`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google Fonts respondió ${res.status}`);
    const body = await res.json() as { items?: Array<{ family: string; category: string; variants: string[] }> };
    const fonts: CatalogFont[] = (body.items || []).map(item => ({
      family: item.family,
      category: item.category,
      variants: item.variants || ["regular"],
      source: "google" as const,
    }));
    if (fonts.length === 0) {
      lastFailureAt = Date.now();
      return null;
    }
    liveCache = { fonts, at: Date.now() };
    return fonts;
  } catch (err) {
    lastFailureAt = Date.now();
    console.warn("[fonts] no se pudo traer la lista de Google:", (err as Error).message);
    return null;
  }
}

/**
 * System fonts first, then the live Google library.
 *
 * `live: false` means the API answered with nothing usable — the route passes
 * that to the picker, which says "catálogo reducido" out loud with a retry,
 * instead of quietly showing a sliver of the library as if it were all of it.
 */
export async function buildCatalog(): Promise<{ fonts: CatalogFont[]; live: boolean }> {
  const live = await fetchGoogleLibrary();
  if (live && live.length > 0) return { fonts: [...asCatalog(SYSTEM_FONTS), ...live], live: true };
  return { fonts: asCatalog(SYSTEM_FONTS), live: false };
}

/**
 * A note for a search that found nothing because the font is licensed.
 *
 * Answering "Futura" with an empty list teaches the user the editor is broken.
 * Answering it with "Futura is paid; try Jost or Poppins" teaches them what to
 * do next, which is the only useful thing an empty result can carry.
 */
export function licensedNote(search: string): { note: string; instead: string[] } | null {
  const needle = search.trim().toLowerCase();
  if (!needle) return null;
  for (const [name, info] of Object.entries(LICENSED_ALTERNATIVES)) {
    if (needle.includes(name) || name.includes(needle)) return info;
  }
  return null;
}
