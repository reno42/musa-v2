/**
 * Importar HTML a Musa — un solo motor para el editor, el MCP y la API.
 *
 * Entra: HTML pegado, un archivo .html, una URL o un .zip (HTML + CSS + imágenes + fuentes).
 * Sale: un job de design_import_jobs con uno o varios frames listos para confirmar.
 *
 * Qué hace, en orden:
 *  1. Lee la fuente (y el ZIP o la URL de base para resolver rutas relativas).
 *  2. Trae las hojas de estilo externas y los @import, y deja todo el CSS dentro del diseño.
 *     Las fuentes de Google quedan como @import (su CDN), el resto se copia a Musa.
 *  3. Limpia el HTML y el CSS (htmlSanitize.ts): nada ejecutable llega a guardarse.
 *  4. Cada imagen y fuente (data:, del ZIP o de internet) se marca para copiarse a Musa.
 *  5. Separa frames: elementos con data-musa-frame, o varias secciones de tamaño fijo
 *     (un pack de portadas), o un solo frame con el tamaño del CSS / meta / formato.
 *  6. Adapta lo que en un frame no funciona igual que en una página: media queries
 *     (se evalúan con el ancho del frame), unidades vw/vh (a px) y position:fixed.
 *  7. Detecta las fuentes: Google (se agrega su @import), alojadas en el diseño,
 *     del sistema, o faltantes (se avisa).
 *  8. Copia los archivos en tandas (runHtmlAssetBatch) para no pasar el tope de
 *     llamadas por pedido del plan gratis de Workers; el estado queda en el job.
 */
import * as cheerio from "cheerio";
import { cleanTree, emptyReport, sanitizeDesignCss, type SanitizeReport } from "./htmlSanitize.ts";
import { normalizeZipPath, type ZipIndex } from "./zipReader.ts";
import type { DesignImportDocument, DesignImportWarning } from "../../../shared/designImport.ts";

export const HTML_IMPORT_LIMITS = {
  htmlBytes: 8 * 1024 * 1024,
  sheets: 16,
  sheetBytes: 1024 * 1024,
  assets: 150,
  assetBytes: 5 * 1024 * 1024,
  frames: 40,
  fontChecks: 8,
};

export const FORMAT_PRESETS: Record<string, [number, number]> = {
  post: [1080, 1080], cuadrado: [1080, 1080], square: [1080, 1080],
  portrait: [1080, 1350], vertical: [1080, 1350], "4:5": [1080, 1350],
  story: [1080, 1920], historia: [1080, 1920], reel: [1080, 1920], "9:16": [1080, 1920],
  landscape: [1200, 628], horizontal: [1200, 628], link: [1200, 628],
  youtube: [1280, 720], "16:9": [1920, 1080], slide: [1920, 1080], presentacion: [1920, 1080],
  a4: [794, 1123], carta: [816, 1056],
};

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset", "revert", "revert-layer", "-apple-system", "blinkmacsystemfont", "var"]);
const SYSTEM_EXTRA = ["Segoe UI", "SF Pro", "SF Pro Display", "SF Pro Text", "San Francisco", "Helvetica Neue", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Times", "Courier", "Menlo", "Monaco", "Consolas", "Tahoma", "Verdana", "Georgia", "Trebuchet MS", "Impact", "Arial Black", "Comic Sans MS", "Courier New", "Times New Roman", "Lucida Grande", "Palatino", "Garamond", "Calibri", "Cambria", "Candara", "Optima", "Futura", "Gill Sans", "Avenir", "Avenir Next", "Didot", "Baskerville", "Hoefler Text"];

export type HtmlImportSource = "html" | "url" | "zip";

export interface HtmlImportOptions {
  name?: string;
  width?: number;
  height?: number;
  format?: string;
  /** auto: separa frames si los encuentra; single: siempre uno. */
  split?: "auto" | "single";
  background?: string;
  /** Familias que el espacio ya tiene (fuentes subidas): no se cuentan como faltantes. */
  knownFonts?: string[];
  systemFonts?: string[];
}

export interface PendingAsset {
  id: number;
  kind: "data" | "zip" | "remote";
  font: boolean;
  /** data: base64 · zip: ruta · remote: URL absoluta */
  ref: string;
  mime?: string;
  status: "pending" | "done" | "failed";
  url?: string;
  error?: string;
  label: string;
  tries?: number;
}

export interface HtmlImportFrame { name: string; width: number; height: number; background: string; html: string; css: string }

export interface HtmlImportState {
  version: "futuraria-html-batch/v1";
  name: string;
  source: HtmlImportSource;
  frames: HtmlImportFrame[];
  assets: PendingAsset[];
  warnings: DesignImportWarning[];
  fonts: { used: string[]; google: string[]; hosted: string[]; system: string[]; missing: string[] };
  stats: Record<string, number>;
  /** Para seguir la tanda: dónde está el ZIP original y qué hacer al terminar. */
  zipPath?: string;
  templateId?: string;
  brandId?: string;
  startedAt: string;
}

export interface HtmlImportIO {
  /** Trae texto (HTML o CSS) de internet, validando cada salto. */
  fetchText(url: string, kind: "css" | "html"): Promise<{ text: string; url: string }>;
  /** Devuelve el href de css2 de Google Fonts si la familia existe (con esos pesos si se puede). */
  googleFont(family: string, weights: number[], italic: boolean): Promise<string | null>;
}

export const TOKEN = "musa-asset://";

/* ───────────────────────── utilidades de CSS ───────────────────────── */

function stripComments(css: string) {
  let out = "", i = 0, quote = "";
  while (i < css.length) {
    const c = css[i];
    if (quote) { out += c; if (c === "\\") { out += css[i + 1] || ""; i += 2; continue; } if (c === quote) quote = ""; i++; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && css[i + 1] === "*") { const end = css.indexOf("*/", i + 2); i = end < 0 ? css.length : end + 2; continue; }
    out += c; i++;
  }
  return out;
}

interface CssBlock { prelude: string; body: string | null }
/** Bloques de primer nivel: { prelude, body } (body null para sentencias como @import x;). */
export function cssBlocks(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  let i = 0, start = 0, quote = "", depth = 0, preludeEnd = -1;
  while (i < css.length) {
    const c = css[i];
    if (quote) { if (c === "\\") { i += 2; continue; } if (c === quote) quote = ""; i++; continue; }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === "{") { if (depth === 0) preludeEnd = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0) { out.push({ prelude: css.slice(start, preludeEnd).trim(), body: css.slice(preludeEnd + 1, i) }); start = i + 1; }
      if (depth < 0) depth = 0;
    } else if (c === ";" && depth === 0) {
      const stmt = css.slice(start, i).trim();
      if (stmt) out.push({ prelude: stmt, body: null });
      start = i + 1;
    }
    i++;
  }
  const rest = css.slice(start).trim();
  if (rest && depth === 0) out.push({ prelude: rest, body: null });
  return out;
}
function joinBlocks(blocks: CssBlock[]) {
  return blocks.map((b) => (b.body == null ? `${b.prelude};` : `${b.prelude}{${b.body}}`)).join("\n");
}

/** Evalúa una media query contra el frame: true, false o null (no se sabe: se deja). */
export function evalMedia(query: string, w: number, h: number): boolean | null {
  const parts = query.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return true;
  let unknown = false;
  for (const part of parts) {
    let neg = false, q = part;
    if (q.startsWith("not ")) { neg = true; q = q.slice(4); }
    q = q.replace(/^only\s+/, "");
    let ok: boolean | null = true;
    for (const tok of q.split(/\s+and\s+/)) {
      const t = tok.trim();
      if (!t) continue;
      if (t === "screen" || t === "all") continue;
      if (t === "print" || t === "speech" || t === "tv") { ok = false; break; }
      const f = t.match(/^\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)$/);
      const range = t.match(/^\(\s*(width|height)\s*(<=|>=|<|>|=)\s*([\d.]+)px\s*\)$/);
      if (range) {
        const v = range[1] === "width" ? w : h, n = +range[3];
        const r = range[2] === "<=" ? v <= n : range[2] === ">=" ? v >= n : range[2] === "<" ? v < n : range[2] === ">" ? v > n : v === n;
        if (!r) { ok = false; break; }
        continue;
      }
      if (!f) { ok = null; continue; }
      const [, feat, rawVal = ""] = f;
      const val = rawVal.trim();
      const px = /^([\d.]+)px$/.exec(val)?.[1];
      const n = px ? +px : NaN;
      let r: boolean | null = null;
      if (feat === "min-width" && px) r = w >= n;
      else if (feat === "max-width" && px) r = w <= n;
      else if (feat === "min-height" && px) r = h >= n;
      else if (feat === "max-height" && px) r = h <= n;
      else if (feat === "orientation") r = val === (h >= w ? "portrait" : "landscape");
      else if (feat === "prefers-color-scheme") r = val === "light";
      else if (feat === "prefers-reduced-motion") r = val === "no-preference";
      else if (feat === "hover" || feat === "any-hover") r = val === "hover";
      else if (feat === "pointer" || feat === "any-pointer") r = val === "fine";
      else if (feat === "color") r = true;
      if (r === null) { ok = null; continue; }
      if (!r) { ok = false; break; }
    }
    if (ok === null) { unknown = true; continue; }
    if (neg ? !ok : ok) return true;
  }
  return unknown ? null : false;
}

/** Lo que en una página depende de la ventana, fijado al tamaño del frame. */
export function adaptCssToFrame(css: string, w: number, h: number, stats: Record<string, number>): string {
  const walk = (text: string): string => joinBlocks(cssBlocks(text).flatMap((b) => {
    if (b.body != null && /^@media\b/i.test(b.prelude)) {
      const verdict = evalMedia(b.prelude.replace(/^@media\s*/i, ""), w, h);
      stats.mediaQueries = (stats.mediaQueries || 0) + 1;
      if (verdict === true) return cssBlocks(walk(b.body));
      if (verdict === false) return [];
      return [{ prelude: b.prelude, body: walk(b.body) }];
    }
    if (b.body != null && /^@(supports|layer|container)\b/i.test(b.prelude)) return [{ prelude: b.prelude, body: walk(b.body) }];
    return [b];
  }));
  return viewportToPx(walk(css), w, h, stats);
}

export function viewportToPx(text: string, w: number, h: number, stats: Record<string, number>) {
  return text
    .replace(/(-?\d*\.?\d+)(s|l|d)?(vw|vh|vmin|vmax|vi|vb)\b/g, (_m, num, _p, unit) => {
      stats.viewportUnits = (stats.viewportUnits || 0) + 1;
      const base = unit === "vw" || unit === "vi" ? w : unit === "vh" || unit === "vb" ? h : unit === "vmin" ? Math.min(w, h) : Math.max(w, h);
      return `${+(parseFloat(num) * base / 100).toFixed(2)}px`;
    })
    .replace(/position\s*:\s*fixed/gi, () => { stats.fixedPositions = (stats.fixedPositions || 0) + 1; return "position:absolute"; });
}

/* ───────────────────────── tamaños ───────────────────────── */

function declSize(decls: string): { w?: number; h?: number; ar?: number } {
  const get = (prop: string) => {
    const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([\\d.]+)px`, "gi");
    let m: RegExpExecArray | null, last: number | undefined;
    while ((m = re.exec(decls))) last = +m[1];
    return last;
  };
  const ar = /(?:^|[;{\s])aspect-ratio\s*:\s*([\d.]+)\s*(?:\/\s*([\d.]+))?/i.exec(decls);
  return { w: get("width"), h: get("height") ?? get("min-height"), ar: ar ? +ar[1] / (ar[2] ? +ar[2] : 1) : undefined };
}

type RuleMap = Map<string, string>;
function simpleRules(css: string): RuleMap {
  const map: RuleMap = new Map();
  for (const b of cssBlocks(css)) {
    if (b.body == null || b.prelude.startsWith("@")) continue;
    for (const sel of b.prelude.split(",")) {
      const s = sel.trim();
      if (/^(?:[a-z][\w-]*|\*)?(?:[.#][\w-]+)*$/i.test(s) && s) map.set(s, (map.get(s) || "") + ";" + b.body);
    }
  }
  return map;
}
function elementDecls(el: any, rules: RuleMap) {
  const tag = String(el.tagName || "").toLowerCase();
  const id = el.attribs?.id;
  const classes = String(el.attribs?.class || "").split(/\s+/).filter(Boolean);
  let decls = rules.get(tag) || "";
  for (const c of classes) decls += ";" + (rules.get("." + c) || "") + ";" + (rules.get(tag + "." + c) || "");
  if (classes.length > 1) decls += ";" + (rules.get("." + classes.join(".")) || "");
  if (id) decls += ";" + (rules.get("#" + id) || "") + ";" + (rules.get(tag + "#" + id) || "");
  return decls + ";" + (el.attribs?.style || "");
}
function sizeOf(el: any, rules: RuleMap) {
  const s = declSize(elementDecls(el, rules));
  let { w, h } = s;
  if (w && !h && s.ar) h = Math.round(w / s.ar);
  if (h && !w && s.ar) w = Math.round(h * s.ar);
  return w && h && w >= 50 && h >= 50 && w <= 16384 && h <= 16384 ? { w: Math.round(w), h: Math.round(h) } : null;
}
function bgOf(decls: string) {
  const m = /(?:^|[;{\s])background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)\s*(?:;|$|!)/gi;
  let last: string | undefined, x: RegExpExecArray | null;
  while ((x = m.exec(decls))) last = x[1];
  return last && !/^(none|transparent|inherit|initial|unset|var)$/i.test(last) ? last : undefined;
}

/* ───────────────────────── fuentes ───────────────────────── */

function firstFamily(stack: string) {
  const f = stack.split(",")[0].trim().replace(/^["']|["']$/g, "").trim();
  return f && !GENERIC_FAMILIES.has(f.toLowerCase()) && !/^var\(/i.test(f) && f.length <= 60 ? f : "";
}
export function fontFamiliesIn(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/(?:^|[;{\s"])font-family\s*:\s*([^;}{]+)/gi)) { const f = firstFamily(m[1]); if (f) out.add(f); }
  for (const m of css.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}{]+)/gi)) {
    const fam = /[\d.]+(?:px|pt|em|rem|%|vw|vh|ex|ch|pc|cm|mm|in)(?:\s*\/\s*[\w.%-]+)?\s+(.+)$/.exec(m[1].trim());
    if (fam) { const f = firstFamily(fam[1]); if (f) out.add(f); }
  }
  return [...out];
}
function weightsIn(css: string) {
  const w = new Set<number>([400]);
  for (const m of css.matchAll(/font-weight\s*:\s*(\d{3}|bold|bolder|normal|lighter)/gi)) {
    const v = m[1].toLowerCase(); w.add(v === "bold" || v === "bolder" ? 700 : v === "normal" ? 400 : v === "lighter" ? 300 : +v);
  }
  for (const m of css.matchAll(/(?:^|[;{\s])font\s*:\s*(?:italic\s+)?(\d{3}|bold)\s/gi)) w.add(m[1] === "bold" ? 700 : +m[1]);
  return [...w].filter((x) => x >= 100 && x <= 900).sort((a, b) => a - b);
}
function googleFamiliesOf(href: string) {
  const out: string[] = [];
  for (const m of href.matchAll(/[?&]family=([^&:]+)/g)) out.push(decodeURIComponent(m[1].replace(/\+/g, " ")).trim());
  for (const m of href.matchAll(/[?&]family=([^&]+)/g)) if (m[1].includes("|")) out.push(...m[1].split("|").map((x) => decodeURIComponent(x.split(":")[0].replace(/\+/g, " ")).trim()));
  return out;
}

/* ───────────────────────── preparar ───────────────────────── */

interface Ctx { zip?: ZipIndex; dir: string; base?: string }

function dataUriParts(uri: string) {
  const m = /^data:([\w/+.-]*)((?:;[\w-]+=[\w.-]+)*)(;base64)?,([\s\S]*)$/i.exec(uri.trim());
  if (!m) return null;
  const mime = (m[1] || "text/plain").toLowerCase();
  let b64: string;
  try { b64 = m[3] ? m[4].replace(/\s+/g, "") : Buffer.from(decodeURIComponent(m[4]), "utf8").toString("base64"); } catch { return null; }
  return { mime, b64 };
}
const isFontPath = (p: string) => /\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(p);

export async function prepareHtmlImport(
  input: { html: string; source: HtmlImportSource; baseUrl?: string; zip?: ZipIndex; htmlPath?: string },
  opts: HtmlImportOptions,
  io: HtmlImportIO,
): Promise<HtmlImportState> {
  if (!input.html || !input.html.trim()) throw new Error("No hay HTML para importar");
  if (Buffer.byteLength(input.html, "utf8") > HTML_IMPORT_LIMITS.htmlBytes) throw new Error("El HTML supera el límite de 8 MB. Si trae imágenes pegadas adentro (data:), mándalo como ZIP con las imágenes aparte.");
  const warnings: DesignImportWarning[] = [];
  const stats: Record<string, number> = {};
  const warn = (code: string, message: string) => { if (!warnings.some((w) => w.code === code && w.message === message)) warnings.push({ code, message }); };
  const assets: PendingAsset[] = [];
  const assetKeys = new Map<string, number>();
  let unresolved = 0, overAssets = 0;
  const unresolvedSamples: string[] = [];
  const docCtx: Ctx = { zip: input.zip, dir: input.htmlPath ? input.htmlPath.split("/").slice(0, -1).join("/") : "", base: input.baseUrl };

  /** Devuelve el token que reemplaza a la URL, la URL tal cual (#, Google) o null (se quita). */
  const assetFor = (raw: string, ctx: Ctx, font: boolean): string | null => {
    const v = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
    if (!v) return null;
    if (v.startsWith("#")) return v;
    if (v.startsWith(TOKEN)) return v;
    let kind: PendingAsset["kind"], ref: string, mime: string | undefined, label: string;
    if (/^data:/i.test(v)) {
      const d = dataUriParts(v);
      if (!d || !(/^image\//.test(d.mime) || /font|woff|ttf|otf|octet-stream/.test(d.mime))) return null;
      kind = "data"; ref = d.b64; mime = d.mime; label = `imagen pegada (${d.mime})`;
      font = font || /font|woff|ttf|otf/.test(d.mime);
    } else if (/^(?:blob|about|javascript|vbscript|file|chrome|filesystem):/i.test(v)) {
      return null;
    } else {
      const abs = v.startsWith("//") ? "https:" + v : v;
      if (/^https?:\/\//i.test(abs)) {
        if (/^https:\/\/fonts\.(?:gstatic|googleapis)\.com\//i.test(abs)) return abs;
        kind = "remote"; ref = abs.replace(/^http:/i, "https:"); label = abs.slice(0, 120);
      } else if (ctx.zip) {
        let clean = abs.split(/[?#]/)[0];
        try { clean = decodeURIComponent(clean); } catch { /* ruta con % suelto */ }
        const path = normalizeZipPath(clean.startsWith("/") ? clean : (ctx.dir ? ctx.dir + "/" : "") + clean);
        if (!path || !ctx.zip.has(path)) { unresolved++; if (unresolvedSamples.length < 3) unresolvedSamples.push(v.slice(0, 60)); return null; }
        kind = "zip"; ref = path; label = path;
      } else if (ctx.base) {
        try { kind = "remote"; ref = new URL(abs, ctx.base).toString(); label = ref.slice(0, 120); } catch { return null; }
        if (!/^https?:/i.test(ref)) return null;
        ref = ref.replace(/^http:/i, "https:");
      } else {
        unresolved++; if (unresolvedSamples.length < 3) unresolvedSamples.push(v.slice(0, 60));
        return null;
      }
    }
    const key = kind + ":" + (kind === "data" ? `${ref.length}:${ref.slice(0, 48)}:${ref.slice(-48)}` : ref);
    if (assetKeys.has(key)) return TOKEN + assetKeys.get(key);
    if (assets.length >= HTML_IMPORT_LIMITS.assets) { overAssets++; return kind === "remote" ? ref : null; }
    if (kind === "data" && ref.length * 0.75 > HTML_IMPORT_LIMITS.assetBytes) { warn("asset_too_big", "Una imagen pegada adentro del HTML pesa más de 5 MB y no se importó."); return null; }
    const id = assets.length;
    assets.push({ id, kind, font: font || isFontPath(ref), ref, mime, status: "pending", label });
    assetKeys.set(key, id);
    return TOKEN + id;
  };

  /** url(...) del CSS → tokens. Las de @font-face cuentan como fuentes. */
  const rewriteCssUrls = (css: string, ctx: Ctx) => {
    const fix = (text: string, font: boolean) => text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi, (_m, a, b, c) => {
      const raw = (a ?? b ?? c ?? "").trim();
      const out = assetFor(raw, ctx, font || isFontPath(raw));
      return out == null ? "none" : `url("${out.replace(/"/g, "%22")}")`;
    });
    // Primero las de @font-face (fuentes); luego el resto. Un token ya puesto no se toca.
    return fix(css.replace(/@font-face\s*\{[^}]*\}/gi, (block) => fix(block, true)), false);
  };

  const googleImports: string[] = [];
  let sheetsLoaded = 0;
  /** Una hoja: sus @import se traen y se meten adentro (las de Google quedan como @import). */
  const loadSheet = async (css: string, ctx: Ctx, depth: number): Promise<string> => {
    css = stripComments(css);
    const parts: string[] = [];
    let rest = css;
    // la URL puede traer «;» adentro (Google Fonts: wght@400;700)
    const importRe = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;?/gi;
    const imports = [...css.matchAll(importRe)];
    for (const m of imports) {
      rest = rest.replace(m[0], "");
      const href = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").trim();
      const abs = href.startsWith("//") ? "https:" + href : href;
      if (/^https?:\/\/fonts\.googleapis\.com\//i.test(abs)) { googleImports.push(abs.replace(/^http:/i, "https:")); continue; }
      if (depth >= 2 || sheetsLoaded >= HTML_IMPORT_LIMITS.sheets) { warn("css_import_skipped", `No se trajo la hoja importada ${href.slice(0, 80)} (demasiadas hojas encadenadas).`); continue; }
      const loaded = await readSheet(abs, ctx);
      if (loaded) parts.push(await loadSheet(loaded.text, loaded.ctx, depth + 1));
    }
    parts.push(rewriteCssUrls(rest, ctx));
    return parts.join("\n");
  };
  /** Lee una hoja externa (del ZIP o de internet) y devuelve su contexto para sus rutas relativas. */
  const readSheet = async (href: string, ctx: Ctx): Promise<{ text: string; ctx: Ctx } | null> => {
    sheetsLoaded++;
    try {
      if (/^https?:\/\//i.test(href) || (!ctx.zip && ctx.base)) {
        const url = /^https?:\/\//i.test(href) ? href : new URL(href, ctx.base).toString();
        const r = await io.fetchText(url.replace(/^http:/i, "https:"), "css");
        return { text: r.text.slice(0, HTML_IMPORT_LIMITS.sheetBytes), ctx: { base: r.url, dir: "" } };
      }
      if (ctx.zip) {
        const path = normalizeZipPath(href.startsWith("/") ? href : (ctx.dir ? ctx.dir + "/" : "") + href.split(/[?#]/)[0]);
        if (!path || !ctx.zip.has(path)) throw new Error("no viene en el ZIP");
        return { text: (await ctx.zip.text(path)).slice(0, HTML_IMPORT_LIMITS.sheetBytes), ctx: { zip: ctx.zip, dir: path.split("/").slice(0, -1).join("/") } };
      }
      throw new Error("ruta relativa sin la carpeta del diseño");
    } catch (e: any) {
      warn("css_missing", `No se pudo traer la hoja de estilos ${href.slice(0, 80)}: ${e?.message || e}. El diseño puede verse distinto.`);
      return null;
    }
  };

  /* 1-2. parsear y juntar todo el CSS, en el orden del documento */
  const $ = cheerio.load(input.html);
  const htmlEl = $("html").get(0) as any;
  const bodyEl = $("body").get(0) as any;
  const cssParts: string[] = [];
  // Lo que nunca se dibuja se quita antes de leer estilos: un <style> dentro de MathML o de un
  // <noscript>/<template> no es CSS del diseño (y es la vía de los ataques mXSS).
  const hadScripts = $("script").length;
  $("math, template, noscript, script").remove();
  const sheetNodes = $("style, link").toArray() as any[];
  for (const node of sheetNodes) {
    const tag = String(node.tagName).toLowerCase();
    if (tag === "style") {
      cssParts.push(await loadSheet($(node).text() || "", docCtx, 0));
    } else {
      const rel = String(node.attribs?.rel || "").toLowerCase();
      const href = String(node.attribs?.href || "").trim();
      if (!/\bstylesheet\b/.test(rel) || !href) continue;
      const abs = href.startsWith("//") ? "https:" + href : href;
      if (/^https?:\/\/fonts\.googleapis\.com\//i.test(abs)) { googleImports.push(abs.replace(/^http:/i, "https:")); continue; }
      if (sheetsLoaded >= HTML_IMPORT_LIMITS.sheets) { warn("css_too_many", "El diseño enlaza demasiadas hojas de estilo; se trajeron las primeras 16."); continue; }
      const loaded = await readSheet(abs, docCtx);
      if (loaded) cssParts.push(await loadSheet(loaded.text, loaded.ctx, 1));
    }
  }
  $("style").remove();
  const hadVideo = $("video, audio").length;
  const hadCanvas = $("canvas").length;
  const metaSize = $('meta[name="musa:size"], meta[name="musa-size"]').attr("content") || "";
  const metaFormat = $('meta[name="musa:format"], meta[name="musa-format"]').attr("content") || "";
  const docTitle = ($("title").first().text() || "").trim();

  /* 3-4. limpiar el cuerpo y marcar cada recurso para copiarlo a Musa */
  const report: SanitizeReport = emptyReport();
  $("video[poster]").each((_, v: any) => {
    const img = $("<img>").attr("src", v.attribs.poster).attr("alt", "");
    for (const k of ["class", "style", "id"]) if (v.attribs[k]) img.attr(k, v.attribs[k]);
    $(v).replaceWith(img);
  });
  $("video, audio, canvas, picture > source").remove();
  $("img").each((_, img: any) => {
    if (!img.attribs.src && img.attribs.srcset) {
      const cands = String(img.attribs.srcset).split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (cands.length) img.attribs.src = cands[cands.length - 1];
    }
    if (!img.attribs.src && img.attribs["data-src"]) img.attribs.src = img.attribs["data-src"];
  });
  cleanTree($, bodyEl || $.root().get(0), report, {
    resource: (value, el, attr) => {
      const tag = String(el.tagName || "").toLowerCase();
      if (attr === "src" || attr === "poster" || ((tag === "image" || tag === "feimage") && (attr === "href" || attr === "xlink:href"))) return assetFor(value, docCtx, false);
      if (attr === "data") return null;
      return value;
    },
    style: (css) => rewriteCssUrls(css, docCtx),
  });

  /* CSS final, limpio y con las fuentes de Google al principio */
  let css = sanitizeDesignCss(cssParts.join("\n"));
  const bodyStyle = bodyEl?.attribs?.style ? rewriteCssUrls(sanitizeDesignCss(bodyEl.attribs.style), docCtx) : "";
  const htmlStyle = htmlEl?.attribs?.style ? rewriteCssUrls(sanitizeDesignCss(htmlEl.attribs.style), docCtx) : "";
  if (htmlStyle) css += `\nhtml{${htmlStyle}}`;
  if (bodyStyle) css += `\nbody{${bodyStyle}}`;
  // body.oscuro / html.dark: el documento es el documento; si no coincide, la regla no aplica.
  const qualifierOk = (el: any, q: string) => q.split(/(?=[.#])/).every((p) => (p[0] === "." ? String(el?.attribs?.class || "").split(/\s+/).includes(p.slice(1)) : String(el?.attribs?.id || "") === p.slice(1)));
  css = css.replace(/(^|[\s,{}>+~(])(html|body)((?:[.#][\w-]+)+)(?=[\s,{:>+~[)]|$)/g, (_m, pre, tag, q) => (qualifierOk(tag === "html" ? htmlEl : bodyEl, q) ? pre + tag : pre + tag + ":not(*)"));

  /* 5. frames */
  const rules = simpleRules(css);
  const preset = FORMAT_PRESETS[String(opts.format || metaFormat || "").toLowerCase()];
  const metaWH = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(metaSize.trim());
  const bodyDecls = (rules.get("html") || "") + ";" + (rules.get("body") || "") + ";" + (rules.get(":root") || "") + ";" + bodyStyle;
  const bodySize = declSize(bodyDecls);
  const pageBg = opts.background || bgOf(bodyDecls) || "#ffffff";

  const elementChildren = (el: any) => (el?.children || []).filter((c: any) => c.type === "tag");
  const markedNodes = $("[data-musa-frame], [data-frame]").toArray().filter((el: any) => !$(el).parents("[data-musa-frame], [data-frame]").length);
  let frameEls: any[] = [];
  if (opts.split !== "single") {
    if (markedNodes.length) frameEls = markedNodes;
    else {
      let box = bodyEl;
      for (let depth = 0; depth < 4 && box; depth++) {
        const kids = elementChildren(box);
        const sized = kids.filter((k: any) => sizeOf(k, rules));
        if (sized.length >= 2 && sized.length >= kids.length - 1) { frameEls = sized; break; }
        if (kids.length === 1 && !sizeOf(kids[0], rules)) { box = kids[0]; continue; }
        break;
      }
    }
  }
  if (frameEls.length > HTML_IMPORT_LIMITS.frames) {
    warn("frames_limit", `El diseño trae ${frameEls.length} frames; se importaron los primeros ${HTML_IMPORT_LIMITS.frames}.`);
    frameEls = frameEls.slice(0, HTML_IMPORT_LIMITS.frames);
  }

  const name = (opts.name || docTitle || "Diseño importado").slice(0, 120);
  const frames: HtmlImportFrame[] = [];
  const baseCss = css;
  if (frameEls.length) {
    const reset = "\nhtml,body{margin:0!important;padding:0!important;display:block!important;gap:0!important;transform:none!important;overflow:hidden!important}";
    frameEls.forEach((el: any, i: number) => {
      const size = sizeOf(el, rules) || (opts.width && opts.height ? { w: opts.width, h: opts.height } : preset ? { w: preset[0], h: preset[1] } : { w: 1080, h: 1080 });
      const w = opts.width || size.w, h = opts.height || size.h;
      const label = String(el.attribs?.["data-musa-frame"] || el.attribs?.["data-frame"] || "").trim();
      const heading = $(el).find("h1,h2,h3").first().text().trim().slice(0, 40);
      const fname = (label && label !== "true" ? label : el.attribs?.["data-name"] || el.attribs?.["aria-label"] || heading || `${name} ${i + 1}`).slice(0, 80);
      for (const k of ["data-musa-frame", "data-frame"]) delete el.attribs?.[k];
      el.attribs.style = `${el.attribs.style ? el.attribs.style.replace(/;?\s*$/, ";") : ""}position:relative;margin:0;box-sizing:border-box;width:${w}px;height:${h}px;overflow:hidden;flex:none`;
      const own = bgOf(elementDecls(el, rules));
      frames.push({ name: fname, width: w, height: h, background: own || pageBg, html: viewportToPx($.html(el), w, h, stats), css: adaptCssToFrame(baseCss + reset, w, h, stats) });
    });
  } else {
    const kids = elementChildren(bodyEl);
    const only = kids.length === 1 ? sizeOf(kids[0], rules) : null;
    const w = Math.round(opts.width || (metaWH ? +metaWH[1] : 0) || preset?.[0] || bodySize.w || only?.w || 1080);
    const h = Math.round(opts.height || (metaWH ? +metaWH[2] : 0) || preset?.[1] || bodySize.h || only?.h || (bodySize.w && bodySize.ar ? bodySize.w / bodySize.ar : 0) || 1080);
    if (!opts.width && !metaWH && !preset && !bodySize.w && !only) warn("size_default", "El HTML no dice su tamaño; quedó de 1080 × 1080. Puedes indicar el formato (post, historia, portada…) o poner width y height en el body.");
    frames.push({ name, width: Math.min(16384, w), height: Math.min(16384, h), background: pageBg, html: viewportToPx((bodyEl ? $(bodyEl).html() : $.root().html()) || "", w, h, stats).trim(), css: adaptCssToFrame(baseCss, w, h, stats) });
  }

  /* 7. fuentes */
  const allCss = frames.map((f) => f.css).join("\n") + "\n" + frames.map((f) => (f.html.match(/style="[^"]*"/g) || []).join(";")).join("\n");
  const used = fontFamiliesIn(allCss.replace(/&quot;/g, '"'));
  const hosted = new Set<string>();
  for (const m of allCss.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*([^;}]+)/gi)) hosted.add(m[1].trim().replace(/^["']|["']$/g, ""));
  const google = new Set<string>(googleImports.flatMap(googleFamiliesOf));
  const systemSet = new Set([...(opts.systemFonts || []), ...SYSTEM_EXTRA].map((f) => f.toLowerCase()));
  const knownSet = new Set((opts.knownFonts || []).map((f) => f.toLowerCase()));
  const lower = (s: Set<string>) => new Set([...s].map((x) => x.toLowerCase()));
  const system: string[] = [], missing: string[] = [], addedGoogle: string[] = [];
  const weights = weightsIn(allCss), italic = /font-style\s*:\s*italic|font\s*:\s*italic/i.test(allCss);
  let checks = 0;
  for (const fam of used) {
    const f = fam.toLowerCase();
    if (lower(hosted).has(f) || lower(google).has(f) || knownSet.has(f)) continue;
    if (systemSet.has(f)) { system.push(fam); continue; }
    if (checks >= HTML_IMPORT_LIMITS.fontChecks) { missing.push(fam); continue; }
    checks++;
    const href = await io.googleFont(fam, weights, italic).catch(() => null);
    if (href) { googleImports.push(href); google.add(fam); addedGoogle.push(fam); } else missing.push(fam);
  }
  const importLines = [...new Set(googleImports)].map((h) => `@import url('${h.replace(/'/g, "%27")}');`).join("\n");
  if (importLines) for (const f of frames) f.css = importLines + "\n" + f.css;
  if (addedGoogle.length) warn("fonts_google", `Se agregaron de Google Fonts: ${addedGoogle.join(", ")}.`);
  if (missing.length) warn("fonts_missing", `No se encontraron estas fuentes: ${missing.join(", ")}. Súbelas en Configuración › Fuentes o inclúyelas en el ZIP; mientras tanto se ve con una fuente parecida.`);

  /* avisos de lo que se perdió o cambió */
  if (hadScripts) warn("scripts_removed", `Se quitaron ${hadScripts} script(s): Musa no guarda JavaScript. Si algo del diseño se armaba con JavaScript (gráficos, textos que se cargan, animaciones), puede verse distinto.`);
  if (report.handlers || report.badUrls) warn("unsafe_removed", `Se quitaron ${report.handlers + report.badUrls} atributo(s) que ejecutaban código (on…, javascript:).`);
  if (report.embeds) warn("embeds_removed", `Se quitaron ${report.embeds} contenido(s) incrustado(s) (iframe, object o embed).`);
  if (hadVideo) warn("video_removed", "Se quitaron videos o audios: Musa importa diseños estáticos (si el video tenía portada, quedó como imagen).");
  if (hadCanvas) warn("canvas_removed", "Se quitaron dibujos hechos con <canvas> (necesitan JavaScript).");
  if (unresolved) warn("assets_unresolved", `${unresolved} archivo(s) con ruta relativa no vinieron con el HTML (p. ej. ${unresolvedSamples.join(", ")}). Importa un ZIP con la carpeta completa o usa enlaces https.`);
  if (overAssets) warn("assets_limit", `El diseño trae más de ${HTML_IMPORT_LIMITS.assets} imágenes y fuentes; las demás quedaron enlazadas a su sitio original.`);
  if (stats.fixedPositions) warn("fixed_position", "Los elementos con position:fixed quedaron fijos dentro del frame.");
  if (stats.viewportUnits) warn("viewport_units", "Las medidas en vw/vh se pasaron a píxeles del frame.");

  const elements = frames.reduce((n, f) => n + (f.html.match(/<[a-z][\w-]*/gi) || []).length, 0);
  Object.assign(stats, { frames: frames.length, elements, assets: assets.length, images: assets.filter((a) => !a.font).length, fontFiles: assets.filter((a) => a.font).length, scriptsRemoved: hadScripts, unsafeRemoved: report.handlers + report.badUrls, embedsRemoved: report.embeds, unresolved });
  return {
    version: "futuraria-html-batch/v1", name, source: input.source, frames, assets, warnings,
    fonts: { used, google: [...google], hosted: [...hosted], system, missing },
    stats, startedAt: new Date().toISOString(),
  };
}

/* ───────────────────────── copiar recursos en tandas ───────────────────────── */

export function sniffMime(bytes: Uint8Array, declared = ""): { mime: string; ext: string; font: boolean } | null {
  const b = bytes, s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0x89 && s(1, 3) === "PNG") return { mime: "image/png", ext: "png", font: false };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", font: false };
  if (s(0, 4) === "GIF8") return { mime: "image/gif", ext: "gif", font: false };
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return { mime: "image/webp", ext: "webp", font: false };
  if (s(4, 4) === "ftyp" && /avif|avis/.test(s(8, 4))) return { mime: "image/avif", ext: "avif", font: false };
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { mime: "image/x-icon", ext: "ico", font: false };
  if (s(0, 4) === "wOF2") return { mime: "font/woff2", ext: "woff2", font: true };
  if (s(0, 4) === "wOFF") return { mime: "font/woff", ext: "woff", font: true };
  if (s(0, 4) === "OTTO") return { mime: "font/otf", ext: "otf", font: true };
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || s(0, 4) === "true") return { mime: "font/ttf", ext: "ttf", font: true };
  const head = new TextDecoder().decode(b.subarray(0, 1024)).trimStart().toLowerCase();
  if ((head.startsWith("<svg") || head.startsWith("<?xml") || declared.includes("svg")) && head.includes("<svg")) return { mime: "image/svg+xml", ext: "svg", font: false };
  return null;
}

export interface AssetBatchDeps {
  /** Descarga de internet (imagen o fuente), con validación SSRF. */
  fetchRemote(url: string, font: boolean): Promise<Uint8Array>;
  /** Lee un archivo del ZIP. */
  readZip(path: string): Promise<Uint8Array>;
  /** Sube los archivos de esta tanda y devuelve la URL de cada uno (por id). */
  persist(items: Array<{ asset: PendingAsset; bytes: Uint8Array; mime: string; ext: string }>): Promise<Record<number, string>>;
}

/** Copia hasta `budget` llamadas externas de recursos. Devuelve cuántos quedan pendientes. */
export async function runHtmlAssetBatch(state: HtmlImportState, deps: AssetBatchDeps, budget: number) {
  const ready: Array<{ asset: PendingAsset; bytes: Uint8Array; mime: string; ext: string }> = [];
  let spent = 0;
  for (const asset of state.assets) {
    if (asset.status !== "pending") continue;
    const cost = asset.kind === "remote" ? 4 : 1;
    if (ready.length && spent + cost > budget) break;
    spent += cost;
    try {
      const bytes = asset.kind === "data" ? new Uint8Array(Buffer.from(asset.ref, "base64"))
        : asset.kind === "zip" ? await deps.readZip(asset.ref)
        : await deps.fetchRemote(asset.ref, asset.font);
      if (!bytes.length) throw new Error("archivo vacío");
      if (bytes.length > HTML_IMPORT_LIMITS.assetBytes) throw new Error("pesa más de 5 MB");
      const kind = sniffMime(bytes, asset.mime || "");
      if (!kind) throw new Error("no es una imagen ni una fuente reconocible");
      ready.push({ asset, bytes, mime: kind.mime, ext: kind.ext });
    } catch (e: any) {
      const msg = String(e?.message || e);
      // Se acabó el cupo de llamadas de este pedido: el archivo sigue pendiente para la próxima tanda.
      if (/too many subrequests/i.test(msg)) { spent = budget; break; }
      asset.status = "failed"; asset.error = msg.slice(0, 200);
    }
  }
  if (ready.length) {
    try {
      const urls = await deps.persist(ready);
      for (const r of ready) {
        if (urls[r.asset.id]) { r.asset.status = "done"; r.asset.url = urls[r.asset.id]; r.asset.mime = r.mime; if (r.asset.kind === "data") r.asset.ref = ""; }
        else if (r.asset.status !== "failed") {
          // no alcanzó a subirse en esta tanda: se reintenta en la siguiente, hasta 3 veces
          r.asset.tries = (r.asset.tries || 0) + 1;
          if (r.asset.tries >= 3) { r.asset.status = "failed"; r.asset.error = r.asset.error || "no se pudo guardar"; }
        }
      }
    } catch (e: any) {
      // La subida falló entera: se reintenta en la siguiente tanda (hasta que el job se dé por terminado).
      for (const r of ready) { r.asset.error = String(e?.message || e).slice(0, 200); }
      throw e;
    }
  }
  return state.assets.filter((a) => a.status === "pending").length;
}

/** Reemplaza los tokens por las URLs de Musa (o la original si no se pudo copiar) y arma el documento. */
export function finalizeHtmlImport(state: HtmlImportState): DesignImportDocument {
  const byId = new Map(state.assets.map((a) => [a.id, a]));
  const failed = state.assets.filter((a) => a.status === "failed");
  const swap = (text: string) => text.replace(/musa-asset:\/\/(\d+)/g, (_m, id) => {
    const a = byId.get(+id);
    if (a?.status === "done" && a.url) return a.url;
    if (a?.kind === "remote") return a.ref;
    return "";
  });
  const warnings = [...state.warnings];
  if (failed.length) {
    const remote = failed.filter((a) => a.kind === "remote").length;
    warnings.push({ code: "assets_failed", message: `${failed.length} imagen(es) o fuente(s) no se pudieron copiar a Musa${remote ? ` (${remote} quedaron enlazadas a su sitio original)` : ""}: ${failed.slice(0, 3).map((a) => `${a.label} — ${a.error}`).join("; ")}.` });
  }
  const artboards = state.frames.map((f, i) => {
    const html = swap(f.html).replace(/\s(?:src|href|xlink:href|poster)=""/g, "");
    const css = swap(f.css).replace(/url\(""\)/g, "none");
    return { id: `html-${i}`, name: f.name, width: f.width, height: f.height, background: f.background, layers: [], raw: { html, css } };
  });
  const elements = state.frames.reduce((n, f) => n + (f.html.match(/<[a-z][\w-]*/gi) || []).length, 0);
  return {
    version: "futuraria-import/v1", name: state.name, source: "html", artboards, warnings,
    report: { editable: elements, approximate: 0, raster: 0 },
    fonts: { used: state.fonts.used, missing: state.fonts.missing },
  } as DesignImportDocument;
}

/** Resumen sin datos pesados (para mostrar el avance). */
export function htmlImportSummary(state: HtmlImportState) {
  const done = state.assets.filter((a) => a.status === "done").length;
  const failed = state.assets.filter((a) => a.status === "failed").length;
  return {
    version: state.version, name: state.name, source: state.source, frames: state.frames.map((f) => ({ name: f.name, width: f.width, height: f.height })),
    assets: { total: state.assets.length, done, failed, pending: state.assets.length - done - failed },
    fonts: state.fonts, warnings: state.warnings, stats: state.stats,
  };
}
