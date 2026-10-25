/**
 * REQ-053 F2 — saneamiento SVG allowlist para `shape` declarativo de IA.
 *
 * Regla del REQ: NUNCA se ejecuta ni reescribe el SVG de la IA — se SANEÁ
 * con allowlist cerrada antes de persistir como media `svg` atomic. Aquí la
 * política es FAIL-CLOSED: cualquier tag, atributo o valor fuera de la
 * allowlist RECHAZA el SVG completo con razón accionable (un SVG recortado
 * podría renderizar distinto a lo que la IA intentó — peor que ningún shape).
 *
 * Honesty rules (mismo contrato que el resto del arnés):
 *  - Función pura, sin DOM ni I/O — corre en Worker, editor y node QA.
 *  - Nunca lanza: entrada malformada → ok:false + `rejected` con causas.
 *  - Determinista: mismo input → misma salida (y mismos rechazos).
 *  - Límites de tamaño y de elementos para el presupuesto de CPU del Worker.
 */

export interface SvgSanitizeResult {
  ok: boolean;
  /** SVG saneado (solo cuando ok) — listo para `svgDataUrl()` o Storage. */
  svg: string | null;
  /** Razones de rechazo (códigos accionables), vacío cuando ok. */
  rejected: string[];
  /** Cantidad de elementos aceptados (presupuesto). */
  elements: number;
}

/** Elementos permitidos — shapes declarativos + gradientes + metadatos. */
const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "linearGradient", "radialGradient", "stop", "use", "title", "desc",
]);

const GLOBAL_ATTRS = new Set([
  "id", "transform", "opacity", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "vector-effect", "clip-rule", "display",
]);

const TAG_ATTRS: Record<string, Set<string>> = {
  svg: new Set(["xmlns", "viewBox", "width", "height", "preserveAspectRatio"]),
  path: new Set(["d", "pathLength"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", "pathLength"]),
  circle: new Set(["cx", "cy", "r", "pathLength"]),
  ellipse: new Set(["cx", "cy", "rx", "ry", "pathLength"]),
  line: new Set(["x1", "y1", "x2", "y2", "pathLength"]),
  polyline: new Set(["points", "pathLength"]),
  polygon: new Set(["points", "pathLength"]),
  linearGradient: new Set(["x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"]),
  radialGradient: new Set(["cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod"]),
  stop: new Set(["offset", "stop-color", "stop-opacity"]),
  use: new Set(["href", "xlink:href", "x", "y"]),
};

/** Texto seguro: sin entidades raras ni tags disimulados. El contenido libre
 *  solo tiene sentido dentro de <title>/<desc>; en otros elementos se
 *  rechaza (los shapes de IA no llevan texto suelto). */
const SAFE_TEXT = /^[^<>{}&]*$/;
const SAFE_TEXT_TAGS = new Set(["title", "desc"]);
const URI_SAFE = /^#[\w-]+$/; // refs internas a ids del propio SVG
const VALUE_FORBIDDEN = /(?:java|vb|live)script:|data:text\/html|<|>/i;

const MAX_BYTES_DEFAULT = 65_536;
const MAX_ELEMENTS_DEFAULT = 300;

interface ParsedTag {
  closing: boolean;
  selfClosing: boolean;
  name: string;
  attrs: Array<{ name: string; value: string }>;
  raw: string;
}

function parseTag(raw: string): ParsedTag | null {
  const m = raw.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>$/);
  if (!m) return null;
  const attrs: Array<{ name: string; value: string }> = [];
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(m[3])) !== null) {
    attrs.push({ name: a[1], value: a[2] !== undefined ? a[2] : a[3] ?? "" });
  }
  return { closing: m[1] === "/", selfClosing: m[4] === "/", name: m[2], attrs, raw };
}

/**
 * Sanea un SVG de IA bajo allowlist cerrada. Rechaza (y lista por qué):
 * tamaño/nodos excedidos, tags o atributos fuera de allowlist, `on*` y
 * `style` (implícitos: no están en la allowlist), URIs no-fragmento, doctype/
 * comentarios/CDATA/PI, texto suelto fuera de title/desc, y árboles mal
 * balanceados. El resultado sano conserva orden y valores originales.
 */
export function sanitizeAiSvg(raw: unknown, opts: { maxBytes?: number; maxElements?: number } = {}): SvgSanitizeResult {
  const rejected: string[] = [];
  const maxBytes = opts.maxBytes ?? MAX_BYTES_DEFAULT;
  const maxElements = opts.maxElements ?? MAX_ELEMENTS_DEFAULT;

  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, svg: null, rejected: ["SVG_EMPTY: la entrada debe ser un string SVG no vacío."], elements: 0 };
  }
  const source = raw.trim();
  if (source.length > maxBytes) {
    return { ok: false, svg: null, rejected: [`SVG_TOO_LARGE: ${source.length} bytes superan el límite de ${maxBytes}.`], elements: 0 };
  }

  const tokenRe = /<[^>]*>|[^<]+/g;
  const out: string[] = [];
  const stack: string[] = [];
  let elements = 0;
  let rootChecked = false;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(source)) !== null) {
    const token = match[0];
    if (!token.startsWith("<")) {
      const context = stack[stack.length - 1];
      if (token.trim()) {
        if (!context || !SAFE_TEXT_TAGS.has(context)) {
          rejected.push(`SVG_TEXT_OUTSIDE_TITLE: texto suelto fuera de <title>/<desc> (contexto: <${context ?? "raíz"}>).`);
          return { ok: false, svg: null, rejected, elements };
        }
        if (!SAFE_TEXT.test(token)) {
          rejected.push("SVG_TEXT_UNSAFE: el texto contiene caracteres no permitidos (<, >, {, }, &).");
          return { ok: false, svg: null, rejected, elements };
        }
        out.push(token);
      }
      continue;
    }
    if (/^<!--/.test(token) || /^<\s*!/.test(token) || /^<\s*\?/.test(token)) {
      rejected.push(`SVG_MARKUP_FORBIDDEN: comentarios/doctype/CDATA/PI no se aceptan (${token.slice(0, 24)}…).`);
      return { ok: false, svg: null, rejected, elements };
    }
    const tag = parseTag(token);
    if (!tag) {
      rejected.push(`SVG_TAG_MALFORMED: etiqueta no parseable (${token.slice(0, 40)}).`);
      return { ok: false, svg: null, rejected, elements };
    }
    if (tag.closing) {
      const open = stack.pop();
      if (open !== tag.name) {
        if (stack.includes(tag.name)) {
          // El cierre es de un ancestro: los intermedios quedaron sin cerrar.
          rejected.push(`SVG_TREE_UNCLOSED: <${open ?? "nada"}> sin cerrar antes de </${tag.name}>.`);
        } else {
          rejected.push(`SVG_TREE_UNBALANCED: se esperaba </${open ?? "nada"}> y llegó </${tag.name}>.`);
        }
        return { ok: false, svg: null, rejected, elements };
      }
      out.push(`</${tag.name}>`);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag.name)) {
      rejected.push(`SVG_TAG_FORBIDDEN: <${tag.name}> no está en la allowlist.`);
      return { ok: false, svg: null, rejected, elements };
    }
    if (!rootChecked) {
      if (tag.name !== "svg") {
        rejected.push(`SVG_ROOT_REQUIRED: la raíz debe ser <svg> (llegó <${tag.name}>).`);
        return { ok: false, svg: null, rejected, elements };
      }
      const xmlns = tag.attrs.find(a => a.name === "xmlns");
      if (!xmlns || xmlns.value !== "http://www.w3.org/2000/svg") {
        rejected.push('SVG_XMLNS_REQUIRED: la raíz <svg> debe declarar xmlns="http://www.w3.org/2000/svg".');
        return { ok: false, svg: null, rejected, elements };
      }
      rootChecked = true;
    }
    if (++elements > maxElements) {
      rejected.push(`SVG_TOO_MANY_ELEMENTS: más de ${maxElements} elementos.`);
      return { ok: false, svg: null, rejected, elements };
    }

    const allowed = new Set([...GLOBAL_ATTRS, ...(TAG_ATTRS[tag.name] ?? [])]);
    const renderedAttrs: string[] = [];
    for (const { name, value } of tag.attrs) {
      if (!allowed.has(name)) {
        rejected.push(`SVG_ATTR_FORBIDDEN: ${name} no está permitido en <${tag.name}>.`);
        return { ok: false, svg: null, rejected, elements };
      }
      if (VALUE_FORBIDDEN.test(value)) {
        rejected.push(`SVG_ATTR_VALUE_UNSAFE: el valor de ${name} contiene contenido prohibido.`);
        return { ok: false, svg: null, rejected, elements };
      }
      if ((name === "href" || name === "xlink:href") && !URI_SAFE.test(value.trim())) {
        rejected.push(`SVG_REF_UNSAFE: ${name} solo acepta referencias internas "#id" (llegó "${value.slice(0, 40)}").`);
        return { ok: false, svg: null, rejected, elements };
      }
      renderedAttrs.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
    }
    out.push(`<${tag.name}${renderedAttrs.length ? " " + renderedAttrs.join(" ") : ""}${tag.selfClosing ? "/" : ""}>`);
    if (!tag.selfClosing && !SAFE_TEXT_TAGS.has(tag.name) && tag.name !== "svg") {
      // title/desc llevan texto; el resto no debe quedar vacío-colgando sin
      // cierre — el stack lo verifica al llegar el cierre correspondiente.
    }
    if (!tag.selfClosing) stack.push(tag.name);
  }

  if (stack.length > 0) {
    rejected.push(`SVG_TREE_UNCLOSED: quedaron ${stack.length} elementos sin cerrar (${stack.join(", ")}).`);
    return { ok: false, svg: null, rejected, elements };
  }
  if (!rootChecked) {
    rejected.push("SVG_ROOT_REQUIRED: no se encontró ningún elemento <svg>.");
    return { ok: false, svg: null, rejected, elements };
  }

  return { ok: true, svg: out.join(""), rejected: [], elements };
}

/** Data-URL del SVG saneado — el mismo patrón de GRAIN_URI del catálogo. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
