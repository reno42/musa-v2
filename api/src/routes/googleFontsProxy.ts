import { Router } from "express";
import type { Request, Response } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";

/**
 * Same-origin proxy for Google Fonts css2 stylesheets and gstatic font files.
 *
 * WHY: the editor's shadow-DOM <link> tags and the raster inliner load Google
 * Fonts from the BROWSER, and some environments never let that request
 * complete — corporate filters, HTTPS-scanning antivirus, aggressive privacy
 * extensions and flaky network paths all close the connection before Google
 * answers (observed in the wild as net::ERR_CONNECTION_CLOSED and CORS
 * errors, with Chrome's slow-network intervention on top). Netlify's servers
 * reach Google reliably — the deck generator and the thumbnail pipeline
 * already depend on that — so rendering routes the request through our own
 * origin while the PERSISTED css keeps the canonical URLs.
 *
 * Not an open proxy: css2 accepts a strict parameter allowlist, gstatic only
 * serves versioned font files matching the known /s/<family>/v<n>/<file>
 * shape, and both answers carry long-lived cache headers so each stylesheet
 * and glyph file crosses the network at most once per browser.
 *
 * GET /api/fonts/css2?family=Nunito+Sans&display=swap
 * GET /api/fonts/gstatic/s/nunitosans/v18/XRXI3….woff2
 */

const UPSTREAM_CSS2 = "https://fonts.googleapis.com/css2";
const UPSTREAM_GSTATIC = "https://fonts.gstatic.com/";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Only the parameters css2 documents. `family` may repeat (multi-family
// stylesheets); its value carries the axis tuple (e.g. ":wght@400;700").
const ALLOWED_CSS2_PARAMS = new Set(["family", "display", "text", "subset"]);
// Decoded css2 values: family names, axis tuples and `text=` samples. Letters
// from any script (the picker serves the whole Google catalog) plus the
// punctuation css2's own syntax uses — nothing else passes.
const SAFE_CSS2_VALUE = /^[\p{L}\p{N} '+.,;:@%()\-~]*$/u;
// gstatic serves immutable, versioned glyph files under /s/<family>/v<n>/.
const GSTATIC_FILE = /^s\/[a-z0-9-]+\/v\d+\/[A-Za-z0-9_-]+\.(?:woff2|woff|ttf|otf)$/;
const CSS2_TTL_MS = 6 * 60 * 60 * 1000;
const CSS2_CACHE_MAX = 300;

/** Small in-process cache: css2 stylesheets are tiny and repeat constantly —
 *  every editor load re-requests the same families across sessions. */
const css2Cache = new Map<string, { body: string; at: number }>();

/** Re-emit a VALIDATED css2 value in css2's own wire form: spaces as `+`,
 * axis punctuation (:@;,) left raw. URLSearchParams percent-encodes :@; and
 * the serverless runtime re-encodes the outgoing %3B once more, so Google
 * reads a literal "%3B" inside the family name and answers 400 — that is
 * how every multi-value axis tuple (…@0;1, …@400;700) died in production
 * while single-value tuples (…@0, …@400) passed. Raw specials are legal in
 * a query and are exactly what css2 expects. */
function encodeCss2Value(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%3A/g, ":")
    .replace(/%40/g, "@")
    .replace(/%3B/g, ";")
    .replace(/%2C/g, ",");
}

function buildCss2Query(entries: [string, string][]): string {
  return entries.map(([key, value]) => `${key}=${encodeCss2Value(value)}`).join("&");
}

/** css2 answers are User-Agent-sniffed: the modern UA buys woff2 @font-face
 *  rules (with unicode-range splits) instead of legacy TTF. Null means the
 *  upstream never answered (network), not that it answered badly. */
async function fetchCss2(query: string): Promise<Awaited<ReturnType<typeof fetch>> | null> {
  try {
    return await fetch(`${UPSTREAM_CSS2}?${query}`, { headers: { "user-agent": BROWSER_UA } });
  } catch {
    return null;
  }
}

export const googleFontProxyRoutes = Router();

/** The public origin of THIS deployment, so the css body can hand back
 *  same-origin font-file URLs (Netlify sits behind a proxy: trust the
 *  forwarded headers first). */
function requestOrigin(req: Request): string {
  const proto = ((req.headers["x-forwarded-proto"] as string) || req.protocol || "https").split(",")[0].trim();
  const host = ((req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

googleFontProxyRoutes.get("/css2", asyncRoute(async (req: Request, res: Response) => {
  const entries: [string, string][] = [];
  for (const [key, raw] of Object.entries(req.query)) {
    if (!ALLOWED_CSS2_PARAMS.has(key)) {
      res.status(400).set("Cache-Control", "no-store").json({ success: false, error: `Unsupported css2 parameter: ${key}` });
      return;
    }
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value !== "string" || value.length > 500 || !SAFE_CSS2_VALUE.test(value)) {
        res.status(400).set("Cache-Control", "no-store").json({ success: false, error: "Malformed css2 parameter value" });
        return;
      }
      entries.push([key, value]);
    }
  }
  const query = buildCss2Query(entries);
  if (!query) {
    res.status(400).set("Cache-Control", "no-store").json({ success: false, error: "Missing css2 query (family=...)" });
    return;
  }

  const cached = css2Cache.get(query);
  if (cached && Date.now() - cached.at < CSS2_TTL_MS) {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.send(cached.body);
    return;
  }

  let upstream = await fetchCss2(query);

  // A 400 names a css2-syntax problem with THIS url — a runtime re-encoding
  // the axis tuple, or a family without the requested axis. `family=Name`
  // with the axes stripped is the one form css2 always serves, so one retry
  // heals the stylesheet (at the cost of the default weight set) instead of
  // collapsing the whole design to its fallback font.
  if (upstream !== null && upstream.status === 400) {
    const bare = buildCss2Query(entries.map(([key, value]) =>
      [key, key === "family" ? value.split(":")[0] : value] as [string, string]));
    if (bare !== query) {
      const retry = await fetchCss2(bare);
      if (retry !== null && retry.ok) upstream = retry;
    }
  }

  if (upstream === null) {
    res.status(502).set("Cache-Control", "no-store").json({ success: false, error: "Google Fonts css2 unreachable" });
    return;
  }
  if (!upstream.ok) {
    // Surface Google's own status — a 400 means a genuinely invalid request
    // (the URL sanitizer upstream should have prevented that). Never cache
    // a failure: the next editor load must retry, not read the error back.
    res.status(upstream.status >= 500 ? 502 : upstream.status).set("Cache-Control", "no-store")
      .json({ success: false, error: `Google Fonts css2 answered ${upstream.status}` });
    return;
  }

  // Rewrite the font-file host into our own origin so the browser never
  // needs a second, direct connection to Google either.
  const body = (await upstream.text()).replaceAll(
    "https://fonts.gstatic.com",
    `${requestOrigin(req)}/api/fonts/gstatic`,
  );

  if (css2Cache.size >= CSS2_CACHE_MAX) {
    const oldest = css2Cache.keys().next().value;
    if (oldest !== undefined) css2Cache.delete(oldest);
  }
  css2Cache.set(query, { body, at: Date.now() });

  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
  res.send(body);
}));

googleFontProxyRoutes.get("/gstatic/*", asyncRoute(async (req: Request, res: Response) => {
  const path = (req.params as Record<string, string>)["0"];
  if (!path || !GSTATIC_FILE.test(path)) {
    res.status(400).set("Cache-Control", "no-store").json({ success: false, error: "Not a Google Fonts static file path" });
    return;
  }

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetch(UPSTREAM_GSTATIC + path, { headers: { "user-agent": BROWSER_UA } });
  } catch {
    res.status(502).set("Cache-Control", "no-store").json({ success: false, error: "Google Fonts static host unreachable" });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status >= 500 ? 502 : upstream.status).set("Cache-Control", "no-store")
      .json({ success: false, error: `Google Fonts static host answered ${upstream.status}` });
    return;
  }

  // Versioned glyph files never change — the browser caches them forever.
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(Buffer.from(await upstream.arrayBuffer()));
}));
