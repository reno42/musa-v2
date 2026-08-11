/**
 * The font list the editor searches.
 *
 * Three sources, in one shape:
 *
 *   SYSTEM   — Georgia, Helvetica, Courier. Already on the machine, so they
 *              need no loading at all. They were missing purely because they
 *              are not Google Fonts.
 *   GOOGLE   — the bundled JSON (~90 families), or the full library (~1800)
 *              when GOOGLE_FONTS_API_KEY is set. The bundled list is the
 *              floor, not the ceiling: a curated ninety is a reasonable
 *              default and a terrible limit.
 *   ALIASES  — names people search for that cannot be shipped, answered with
 *              the closest free faces instead of nothing.
 *
 * The live list is fetched once per process and kept, because it is ~1800
 * entries that change a few times a year and this runs on a serverless
 * function where a cold start already costs more than the parse.
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
const LIVE_TTL_MS = 12 * 60 * 60 * 1000;

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
 * Without one this returns null and the caller falls back to the bundled list
 * — deliberately silent, because a missing optional key is a smaller library,
 * not an error the user should see.
 */
async function fetchGoogleLibrary(): Promise<CatalogFont[] | null> {
  const key = process.env.GOOGLE_FONTS_API_KEY;
  if (!key) return null;
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.fonts;
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
    if (fonts.length === 0) return null;
    liveCache = { fonts, at: Date.now() };
    return fonts;
  } catch (err) {
    console.warn("[fonts] no se pudo traer la lista de Google:", (err as Error).message);
    return null;
  }
}

/** System fonts first: they always render, wherever the design is opened. */
export async function buildCatalog(bundled: Array<{ family: string; category: string; variants: string[] }>): Promise<CatalogFont[]> {
  const live = await fetchGoogleLibrary();
  const google: CatalogFont[] = (live || bundled.map(f => ({
    family: f.family,
    category: f.category,
    variants: f.variants,
    source: "google" as const,
  })));
  return [...asCatalog(SYSTEM_FONTS), ...google];
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
