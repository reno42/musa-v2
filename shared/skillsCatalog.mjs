/**
 * Catálogo de habilidades (Skills) — parser compartido de los SKILL.md que
 * viven en .agents/skills/<skill>/SKILL.md.
 *
 * FUENTE ÚNICA DE VERDAD: los SKILL.md. Tanto el endpoint /api/skills-catalog
 * (lectura en caliente con cache en Node) como el JSON estático que genera el
 * prebuild (scripts/generate-skills-catalog.mjs → public/skills-catalog.json,
 * para CF Workers donde no hay fs) pasan por este parser — cero drift.
 *
 * Regla de presentación (vitrina, no documentación): del body SOLO suben
 * frases de método en lenguaje natural (sin backticks ni nombres de tool);
 * si no alcanzan 3, el skill no lleva sección "Cómo funciona" — mejor vacío
 * que markdown crudo.
 */

/** Orden fijo pensado para el usuario (no alfabético): la vitrina abre con
 *  lo que más vende el "oh, mi IA hace TODO esto". */
export const SKILL_ORDER = [
  "musa",
  "musa-inicio",
  "musa-organizacion",
  "musa-planear",
  "musa-copy",
  "musa-marcas",
  "musa-diseno",
  "musa-diseno-biblioteca",
  "musa-vectores",
  "musa-fotos",
  "musa-video",
  "musa-mailing-eventos",
  "musa-automatizaciones",
  "musa-redes",
  "musa-anunciar",
  "musa-vender",
  "musa-medir",
  "musa-agentes",
  "musa-configuracion",
];

/** Título legible + clave de icono (el icono real vive en la UI). Las skills
 *  son FIJAS: iguales para todas las personas y en todos los planes. */
export const SKILL_META = {
  "musa": { title: "Empieza aquí", icon: "config" },
  "musa-inicio": { title: "Inicio y segundo cerebro", icon: "brands" },
  "musa-organizacion": { title: "Organización", icon: "contacts" },
  "musa-planear": { title: "Planear y calendario", icon: "copy" },
  "musa-copy": { title: "Copywriting", icon: "copy" },
  "musa-marcas": { title: "Marcas", icon: "brands" },
  "musa-diseno": { title: "Diseño", icon: "design" },
  "musa-diseno-biblioteca": { title: "Biblioteca de diseños", icon: "design" },
  "musa-vectores": { title: "Vectores", icon: "design" },
  "musa-fotos": { title: "Fotos", icon: "photo" },
  "musa-video": { title: "Video y motion", icon: "motion" },
  "musa-mailing-eventos": { title: "Mailing y eventos", icon: "social" },
  "musa-automatizaciones": { title: "Automatizaciones", icon: "flows" },
  "musa-redes": { title: "Redes y bandeja", icon: "social" },
  "musa-anunciar": { title: "Anunciar", icon: "social" },
  "musa-vender": { title: "Vender (CRM)", icon: "contacts" },
  "musa-medir": { title: "Medir", icon: "contacts" },
  "musa-agentes": { title: "Agentes", icon: "flows" },
  "musa-configuracion": { title: "Configuración", icon: "config" },
};

/** Frontmatter `key: value` (solo las 2 claves que usamos; sin YAML completo). */
function parseFrontmatter(raw) {
  const out = {};
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { meta: out, body: raw };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (kv) out[kv[1].trim()] = kv[2].trim();
  }
  return { meta: out, body: raw.slice(m[0].length) };
}

/** Items "- ..." de ## Ejemplos (hasta el próximo encabezado o EOF). */
export function parseExamples(body) {
  const section = body.match(/^##\s+Ejemplos\s*$/m);
  if (!section) return [];
  const rest = body.slice(section.index + section[0].length);
  const end = rest.search(/^##\s+/m);
  const scope = end === -1 ? rest : rest.slice(0, end);
  const items = [];
  for (const line of scope.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) items.push(item[1].replace(/^["“](.*)["”]$/, "$1").trim());
  }
  return items;
}

/** Frases de método aptas para usuario — filtro ESTRICTO porque los bodies
 *  de los SKILL.md están escritos para la IA, no para la persona. Solo suben
 *  oraciones narrativas (arranque en artículo/determinador — cómo habla la
 *  prosa para usuarios), jamás imperativos dirigidos a la agente ni vocabulario
 *  interno (tools, IDs, MCP, extensiones). Si sobreviven menos de 3, la ficha
 *  OMITE "Cómo funciona" — mejor vacío que crudo. Máximo 4 bullets. */
const METHOD_BANNED = [
  /[A-Za-z]+_[A-Za-z]+/,             // snake_case = nombre de tool
  /\.(js|mjs|ts|json|html|css)\b/i, // extensiones de archivo
  /tools?\/list/i, /\bMCP\b/i,      // internals MCP
  /\bIDs?\b/i, /requestId/i,        // identificadores técnicos
  /\bcron\b/i, /flow (save|run|history)/i, // vocabulario interno de flows
  /\bel usuario\b/i, /\bt[uú]\b/i,   // instrucciones dirigidas a la agente
  /\bnunca\b/i, /\bplaybook/i,
];
const METHOD_NARRATIVE =
  /^(El |La |Los |Las |Un |Una |Unos |Unas |Se |Este |Esta |Estos |Estas |Su |Sus |Cada |En |Hay |Puedes |Pueden |Tu |Tus )/;

export function extractMethod(body) {
  const withoutExamples = body.replace(/^##\s+Ejemplos[\s\S]*$/m, "");
  // Sin encabezados ni ruido de markdown: solo prosa corrida.
  const prose = withoutExamples
    .split(/\r?\n/)
    .filter(line => !/^\s*#/.test(line))
    .join(" ");
  const sentences = prose
    .replace(/[*_>#`]/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.length >= 30 && s.length <= 220)
    .filter(s => !METHOD_BANNED.some(re => re.test(s)))
    .filter(s => METHOD_NARRATIVE.test(s));
  if (sentences.length < 3) return null;
  return sentences.slice(0, 4);
}

/** Nombres de herramientas MCP citados en una skill (`nombre_tool`), filtrados
 *  contra el catálogo real para no colar tipos de nodo ni valores. */
export function extractToolNames(body, knownTools) {
  const out = [];
  for (const m of String(body).matchAll(/`([a-z][a-z0-9_]*)/g)) {
    const n = m[1];
    if (knownTools && !knownTools.has(n)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Entra { skillId: contenidoMarkdown }, sale el catálogo ordenado. Con
 *  knownTools (Set de nombres MCP) cada skill trae también su lista de tools
 *  y el markdown completo — lo que leen las IAs vía get_skill. */
export function buildSkillsCatalog(filesById, knownTools = null) {
  const ids = Object.keys(filesById);
  const known = SKILL_ORDER.filter(id => ids.includes(id));
  const extra = ids.filter(id => !SKILL_ORDER.includes(id)).sort();
  const entries = [...known, ...extra].map(id => {
    const { meta, body } = parseFrontmatter(String(filesById[id] ?? ""));
    const desc = String(meta.description || "").trim();
    return {
      id,
      title: SKILL_META[id]?.title || id.replace(/^musa-/, "").replace(/^\w/, c => c.toUpperCase()),
      icon: SKILL_META[id]?.icon || "design",
      description: desc,
      module: String(meta.module || "").trim(),
      examples: parseExamples(body),
      method: extractMethod(body),
      ...(knownTools ? { tools: extractToolNames(body, knownTools), content: String(filesById[id]) } : {}),
    };
  });
  return { total: entries.length, skills: entries };
}
