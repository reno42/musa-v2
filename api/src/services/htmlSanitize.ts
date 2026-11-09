/**
 * Limpieza de HTML y CSS de diseños antes de guardarlos.
 *
 * Un diseño es HTML que Musa dibuja dentro de su propia página, con la sesión de
 * quien lo abre. Por eso nada ejecutable llega a guardarse: ni <script>, ni
 * atributos on*, ni enlaces javascript:, ni iframes/objetos, ni CSS que ejecute.
 * El editor vuelve a limpiar al dibujar (DOMPurify), así los diseños viejos
 * también quedan cubiertos; esto es la primera capa.
 *
 * El árbol se arma con parse5 (vía cheerio), el mismo algoritmo que usan los
 * navegadores, y se limpia sobre el árbol, no con reemplazos de texto.
 */
import * as cheerio from "cheerio";

/** Elementos que se quitan con todo su contenido. */
export const DROP_TAGS = new Set([
  "script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "link",
  "title", "template", "portal", "param", "fencedframe",
  // MathML: ningún diseño lo usa y es la vía clásica de mXSS (<math><mglyph><style>…).
  "math",
]);
/** Atributos que nunca se guardan (además de on*). */
const DROP_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "nonce", "integrity", "http-equiv", "autofocus"]);
/** Atributos que llevan una URL. */
export const URL_ATTRS = new Set(["href", "xlink:href", "src", "poster", "background", "cite", "longdesc", "data", "lowsrc", "dynsrc", "codebase", "archive", "usemap", "manifest"]);
const SVG_ANIM = new Set(["set", "animate", "animatetransform", "animatemotion", "animateTransform", "animateMotion"]);

export interface SanitizeReport { scripts: number; handlers: number; badUrls: number; embeds: number; removedTags: Record<string, number> }
export function emptyReport(): SanitizeReport { return { scripts: 0, handlers: 0, badUrls: 0, embeds: 0, removedTags: {} }; }

function scheme(value: string) {
  return String(value || "").replace(/[\u0000- \u007f-\u009f]+/g, "").toLowerCase();
}
/** URL que ejecuta código o navega a algo activo. */
export function isActiveUrl(value: string) {
  const v = scheme(value);
  return /^(?:javascript|vbscript|livescript|mocha|jscript):/.test(v) || /^data:(?:text\/html|application\/(?:x?html|xml|javascript|ecmascript)|text\/(?:javascript|xml))/.test(v);
}
/** Enlace permitido en <a href>. */
export function isSafeLink(value: string) {
  const v = scheme(value);
  if (!v) return false;
  if (isActiveUrl(v)) return false;
  return /^(?:https?:|mailto:|tel:|#|\/|\.{0,2}\/|[^:]*$)/.test(v);
}

/** CSS sin nada que ejecute ni que rompa el <style> donde se dibuja. */
export function sanitizeDesignCss(css: string, opts: { allowImports?: boolean } = {}): string {
  let out = String(css || "")
    // «<» no hace falta en CSS fuera de textos, y escrito como \3c sigue valiendo dentro de ellos:
    // así ningún CSS puede cerrar su <style> ni colar etiquetas al volver a leerse.
    .replace(/</g, "\\3c ")
    .replace(/-->/g, "")
    .replace(/expression\s*\(/gi, "x-expression(")
    .replace(/(^|[;{\s])(-moz-binding|behavior)\s*:/gi, "$1x-blocked:")
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript|data:text\/html)[^)]*\)/gi, "none");
  if (!opts.allowImports) {
    // Solo fuentes de Google por @import; el resto se trae y se copia al importar.
    out = out.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;?/gi, (m, a, b, c, d, e) => { const href = a ?? b ?? c ?? d ?? e ?? ""; return /^https:\/\/fonts\.googleapis\.com\//i.test(href) ? m : ""; });
  } else {
    out = out.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;?/gi, (m, a, b, c, d, e) => { const href = a ?? b ?? c ?? d ?? e ?? ""; return /^https:\/\//i.test(href) ? m : ""; });
  }
  return out;
}

export interface CleanHooks {
  /** Reescribe (o quita, devolviendo null) una URL de imagen/recurso: src, poster, href de <image>/<use>. */
  resource?: (value: string, el: any, attr: string) => string | null;
  /** Reescribe el CSS de un atributo style. */
  style?: (css: string, el: any) => string;
}

/** Limpia un subárbol de cheerio en el lugar. */
export function cleanTree($: cheerio.CheerioAPI, root: any, report: SanitizeReport = emptyReport(), hooks: CleanHooks = {}) {
  const all = $(root).find("*").toArray();
  for (const el of all) {
    if (!el.parent) continue;
    const tag = String(el.tagName || el.name || "").toLowerCase();
    if (DROP_TAGS.has(tag)) {
      if (tag === "script") report.scripts++;
      if (["iframe", "frame", "object", "embed", "applet", "portal", "fencedframe"].includes(tag)) report.embeds++;
      report.removedTags[tag] = (report.removedTags[tag] || 0) + 1;
      $(el).remove();
      continue;
    }
    if (SVG_ANIM.has(tag) || SVG_ANIM.has(el.tagName)) {
      const target = String(el.attribs?.attributeName || el.attribs?.attributename || "").toLowerCase();
      if (tag === "set" || /href|^on/.test(target)) { report.removedTags[tag] = (report.removedTags[tag] || 0) + 1; $(el).remove(); continue; }
    }
    const attribs = el.attribs || {};
    for (const name of Object.keys(attribs)) {
      const key = name.toLowerCase();
      const value = attribs[name];
      if (key.startsWith("on")) { report.handlers++; delete attribs[name]; continue; }
      if (DROP_ATTRS.has(key)) { delete attribs[name]; continue; }
      if (key === "srcset" || key === "imagesrcset") { delete attribs[name]; continue; }
      if (key === "style") {
        const css = sanitizeDesignCss(value);
        attribs[name] = hooks.style ? hooks.style(css, el) : css;
        continue;
      }
      if (!URL_ATTRS.has(key)) {
        if (isActiveUrl(value) && /^(?:formaction|xlink:href|to|from|values|by)$/.test(key)) { report.badUrls++; delete attribs[name]; }
        continue;
      }
      if (isActiveUrl(value)) { report.badUrls++; delete attribs[name]; continue; }
      if (tag === "a" && (key === "href" || key === "xlink:href")) {
        if (!isSafeLink(value)) { report.badUrls++; delete attribs[name]; }
        continue;
      }
      if (["cite", "longdesc", "codebase", "archive", "manifest", "usemap", "lowsrc", "dynsrc", "background"].includes(key)) { delete attribs[name]; continue; }
      if ((tag === "use" || tag === "textpath" || tag === "mpath" || tag === "feimage" || tag === "pattern" || tag === "lineargradient" || tag === "radialgradient" || tag === "filter") && (key === "href" || key === "xlink:href")) {
        if (!String(value).trim().startsWith("#")) delete attribs[name];
        continue;
      }
      if (hooks.resource) {
        const next = hooks.resource(value, el, key);
        if (next == null) delete attribs[name]; else attribs[name] = next;
      } else if (!/^(?:https?:|data:image\/|#|blob:)/i.test(String(value).trim()) && /^[a-z][\w+.-]*:/i.test(String(value).trim())) {
        report.badUrls++; delete attribs[name];
      }
    }
  }
  return report;
}

/** Para escrituras de HTML suelto (MCP, API): mismo criterio que la importación. */
export function sanitizeDesignHtml(html: string, report: SanitizeReport = emptyReport()) {
  const $ = cheerio.load(String(html || ""), null, false);
  const root = $.root();
  // Los <style> sueltos se limpian y se quedan donde estaban.
  cleanTree($, root.get(0), report);
  root.find("style").each((_, s) => { $(s).text(sanitizeDesignCss($(s).text() || "")); });
  return $.html();
}
