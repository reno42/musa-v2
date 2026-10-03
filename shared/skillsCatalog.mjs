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
  "musa-design",
  "musa-flows",
  "musa-copywriting",
  "musa-motion",
  "musa-photo",
  "musa-brands",
  "musa-social",
  "musa-contacts",
  "musa-config",
];

/** Título legible en español + clave de icono (el icono real vive en la UI,
 *  con el mismo vocabulario visual de la nav: design/copy/contacts/config/
 *  flows + motion/photo/brands/social en el mismo estilo de trazo). */
export const SKILL_META = {
  "musa-design": { title: "Diseño", icon: "design" },
  "musa-flows": { title: "Automatizaciones", icon: "flows" },
  "musa-copywriting": { title: "Copywriting", icon: "copy" },
  "musa-motion": { title: "Animación y video", icon: "motion" },
  "musa-photo": { title: "Fotos", icon: "photo" },
  "musa-brands": { title: "Tu marca", icon: "brands" },
  "musa-social": { title: "Redes sociales", icon: "social" },
  "musa-contacts": { title: "CRM", icon: "contacts" },
  "musa-config": { title: "Ajustes", icon: "config" },
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

/** Entra { skillId: contenidoMarkdown }, sale el catálogo ordenado. */
export function buildSkillsCatalog(filesById) {
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
      examples: parseExamples(body),
      method: extractMethod(body),
    };
  });
  return { total: entries.length, skills: entries };
}
