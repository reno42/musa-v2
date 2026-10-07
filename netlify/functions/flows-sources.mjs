// REQ-027 — flows-sources: executores de red/formato del flow builder.
// Port de flows-engine/src (automation-ai.mjs, newsroom-rss/nitter,
// renderNewsroomSourceFrame) a código Workers-safe: SIN node:dns ni
// rss-parser (no corren en CF Workers). La resolución DNS del SSRF-guard se
// inyecta (en Node dev/test usa dns.lookup; en Workers no hay resolver —
// quedan protocol/credenciales/localhost/IP-literal, que es la superficie
// alcanzable desde el edge).
//
// Todo lo que aqui vive es puro o red-puro: sin Supabase, sin estado de módulo.

const RESPONSE_LIMIT = 256_000;
const AI_RESPONSE_LIMIT = 512_000;
const MODEL_ID = /^[A-Za-z0-9._/@-]{1,120}$/;

export const AI_PROVIDERS = ["gemini", "openai", "anthropic", "deepseek", "glm", "kimi", "qwen", "openrouter"];

const AI_BASES = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  glm: "https://api.z.ai/api/paas/v4",
  kimi: "https://api.moonshot.ai/v1",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export function flowSourceError(code, message) {
  return Object.assign(new Error(message), { flowCode: code });
}

// ── SSRF guard (port de assertPublicHttps/blockedIp) ───────────────────────

export function blockedIp(address) {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("::ffff:127.");
  }
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 2 && parts[2] === 0))) || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && parts[2] === 100))) || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224;
}

/** HTTPS público, sin credenciales en URL, sin localhost/IP-literal, sin
 *  dominios que resuelvan a redes privadas (cuando hay resolver). */
export async function assertPublicHttps(value, { resolveDns } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw flowSourceError("SOURCE_BAD_URL", "La URL no es válida."); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw flowSourceError("SOURCE_BAD_URL", "Las llamadas deben usar HTTPS y no incluir credenciales en la URL.");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw flowSourceError("SOURCE_SSRF_BLOCKED", "No se puede llamar a hosts locales.");
  }
  if (/^[0-9.]+$/.test(url.hostname) || url.hostname.includes(":")) {
    throw flowSourceError("SOURCE_SSRF_BLOCKED", "No se puede llamar a literales IP; usa un dominio.");
  }
  if (resolveDns) {
    let addresses = [];
    try { addresses = await resolveDns(url.hostname); } catch { addresses = []; }
    if (!addresses.length || addresses.some((address) => blockedIp(address))) {
      throw flowSourceError("SOURCE_SSRF_BLOCKED", "El dominio resuelve a una red privada o reservada.");
    }
  }
  return url;
}

/** Lee el body con tope duro de bytes (Workers-safe: sin content-length
 *  confiable, se corta en streaming). La usa flows-core (executeHttp). */
export async function readLimited(response, maxBytes = RESPONSE_LIMIT) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw flowSourceError("SOURCE_TOO_LARGE", `La respuesta supera el límite de ${maxBytes} bytes.`);
  const reader = response.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch {} throw flowSourceError("SOURCE_TOO_LARGE", `La respuesta supera el límite de ${maxBytes} bytes.`); }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join("") + decoder.decode();
}

/** fetch con SSRF-guard y redirecciones manuales same-origin (las credenciales
 *  no pueden fugarse a otro dominio vía 30x). */
export async function guardedFetch(url, init = {}, { resolveDns, timeoutMs = 15_000, maxRedirects = 3 } = {}) {
  let target = await assertPublicHttps(String(url), { resolveDns });
  let response;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    await assertPublicHttps(target.href, { resolveDns });
    response = await fetch(target, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirects === maxRedirects) throw flowSourceError("SOURCE_REDIRECT_LOOP", "Se excedió el límite de redirecciones.");
    const next = new URL(location, target);
    if (next.origin !== target.origin) throw flowSourceError("SOURCE_CROSS_ORIGIN_REDIRECT", "La redirección cambió de dominio; bloqueada para proteger credenciales.");
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && (init.method ?? "GET") !== "GET")) {
      throw flowSourceError("SOURCE_REDIRECT_METHOD", "Redirección que cambia el método HTTP no admitida.");
    }
    target = next;
  }
  return response;
}

// ── rssLite: parser RSS/Atom mínimo (regex + entity decode) ────────────────

function decodeEntities(value) {
  return String(value ?? "").replace(/&#x0*([0-9a-f]+);/gi, (_m, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#0*(\d+);/g, (_m, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_m, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[String(name).toLowerCase()] ?? _m);
}
function safeCodePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}
export function stripTags(markup) {
  return decodeEntities(String(markup ?? "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function tagInner(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  const inner = match[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : inner;
}
function tagAttr(block, tag, attr) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']*)["'][^>]*>`, "i"));
  return match ? match[1] : "";
}
function normalizeUrl(value, base) {
  const raw = decodeEntities(String(value ?? "").trim());
  if (!raw) return null;
  try {
    const url = new URL(raw, base || undefined);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}
function firstImageIn(markup) {
  return normalizeUrl(String(markup ?? "").match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]);
}
function parseDate(value) {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

/** Parsea un XML RSS 2.0 / Atom a items normalizados. Suficiente para feeds
 *  de noticias y Nitter; los bordes raros fallan con error de fuente claro. */
export function parseRssItems(xml, { baseUrl = "" } = {}) {
  const text = String(xml ?? "");
  if (text.length > 2_000_000) throw flowSourceError("SOURCE_TOO_LARGE", "El feed supera el tamaño máximo.");
  if (!/<rss\b|<feed\b/i.test(text)) throw flowSourceError("SOURCE_INVALID_FEED", "La fuente no devolvió un RSS/Atom válido.");
  const blocks = text.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return blocks.map((block) => {
    const linkRaw = tagInner(block, "link") || tagAttr(block, "link", "href") || tagInner(block, "guid");
    const markup = tagInner(block, "content:encoded") || tagInner(block, "content") || tagInner(block, "description") || tagInner(block, "summary");
    const enclosureUrl = tagAttr(block, "enclosure", "url");
    const enclosureType = tagAttr(block, "enclosure", "type");
    const mediaUrl = tagAttr(block, "media:content", "url") || tagAttr(block, "media:thumbnail", "url");
    const candidates = [
      /^video\//i.test(enclosureType) ? null : normalizeUrl(enclosureUrl, baseUrl),
      normalizeUrl(mediaUrl, baseUrl),
      firstImageIn(markup),
    ];
    const imageUrl = candidates.find((value) => typeof value === "string" && value);
    return {
      title: stripTags(tagInner(block, "title")).slice(0, 300),
      summary: stripTags(tagInner(block, "description") || tagInner(block, "summary")).slice(0, 2_000),
      content: markup,
      link: normalizeUrl(linkRaw, baseUrl),
      creator: stripTags(tagInner(block, "dc:creator") || tagInner(block, "author")).slice(0, 120),
      publishedAt: parseDate(tagInner(block, "pubDate") || tagInner(block, "published") || tagInner(block, "updated")),
      enclosureUrl: normalizeUrl(enclosureUrl, baseUrl),
      enclosureType,
      mediaUrl: normalizeUrl(mediaUrl, baseUrl),
      imageUrl,
      videoUrl: /^video\//i.test(enclosureType) ? normalizeUrl(enclosureUrl, baseUrl)
        : /\.(?:mp4|webm)(?:[?#]|$)/i.test(enclosureUrl ?? "") ? normalizeUrl(enclosureUrl, baseUrl) : null,
    };
  }).filter((item) => item.title || item.summary);
}

// ── source_rss ──────────────────────────────────────────────────────────────

export async function fetchRssArticles(config, { resolveDns } = {}) {
  const url = String(config.url ?? "").trim();
  if (!url) throw flowSourceError("SOURCE_CONFIG", "El nodo RSS necesita una URL de feed.");
  const response = await guardedFetch(url, { headers: { accept: "application/rss+xml, application/xml;q=0.9, */*" } }, { resolveDns });
  if (!response.ok) throw flowSourceError("SOURCE_FETCH_FAILED", `El feed respondió HTTP ${response.status}.`);
  const xml = await readLimited(response);
  const feedTitle = stripTags(tagInner(xml, "title")).slice(0, 120);
  const items = parseRssItems(xml, { baseUrl: url }).map((item) => ({ ...item, source: config.label || feedTitle || "RSS" }));
  const limit = Math.max(1, Math.min(50, Number(config.limit) || 25));
  return items
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, limit);
}

// ── source_nitter (port de newsroom-nitter-source.mjs) ─────────────────────

function nitterFeedUrl(config) {
  const direct = String(config.url ?? config.rssUrl ?? "").trim();
  if (direct) {
    const parsed = normalizeUrl(direct);
    if (!parsed) throw flowSourceError("NITTER_CONFIG", "La URL RSS directa de Nitter no es válida.");
    return parsed;
  }
  const username = String(config.username ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw flowSourceError("NITTER_CONFIG", "Indica un usuario válido de X (o una URL RSS directa).");
  const instance = normalizeUrl(String(config.instanceUrl ?? "").trim());
  if (!instance) throw flowSourceError("NITTER_CONFIG", "Indica la instancia de Nitter (URL) o una URL RSS directa.");
  return new URL(`${encodeURIComponent(username)}/rss`, instance.replace(/\/?$/, "/")).toString();
}

function nitterArticleFromItem(item, config) {
  const title = item.title || "";
  const repost = title.match(/^RT(?: by)? @([A-Za-z0-9_]{1,15}):\s*/i);
  if (repost && config.includeReposts === false) return null;
  const reply = !repost && /^R to @[A-Za-z0-9_]+:\s*/i.test(title);
  const cleanTitle = title.replace(/^RT(?: by)? @[A-Za-z0-9_]{1,15}:\s*/i, "").replace(/^R to @[A-Za-z0-9_]+:\s*/i, "");
  const link = item.link && item.link.match(/^https:\/\/x\.com\//i) ? item.link
    : item.link?.match(/^(https?:\/\/[^/]+)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i)
      ? `https://x.com/${item.link.match(/^(?:https?:\/\/[^/]+)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i)[1]}/status/${item.link.match(/^(?:https?:\/\/[^/]+)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i)[2]}`
      : item.link;
  if (!link || (!cleanTitle && !item.summary)) return null;
  const media = [];
  for (const img of String(item.content ?? "").match(/<img\b[^>]*>/gi) ?? []) {
    const url = normalizeUrl(img.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (url) media.push({ type: "photo", url });
  }
  const author = item.creator || link.match(/^https:\/\/x\.com\/([^/]+)\/status\//i)?.[1] || null;
  return {
    ...item,
    title: (cleanTitle || item.summary).slice(0, 300),
    link,
    imageUrl: item.imageUrl || media.find((m) => m.type === "photo")?.url || null,
    source: config.label || (author ? `X · @${String(author).replace(/^@/, "")}` : "X vía Nitter"),
    author: author ? `@${String(author).replace(/^@/, "")}` : null,
    kind: repost ? "repost" : reply ? "reply" : "post",
  };
}

export async function fetchNitterArticles(config, { resolveDns } = {}) {
  const feedUrl = nitterFeedUrl(config);
  let response;
  try {
    response = await guardedFetch(feedUrl, { headers: { accept: "application/rss+xml, application/xml;q=0.9" } }, { resolveDns, timeoutMs: 15_000 });
  } catch (error) {
    if (error.flowCode) throw error;
    throw flowSourceError("NITTER_UNAVAILABLE", "No se pudo conectar con la instancia de Nitter. Prueba otra instancia o una URL RSS directa.");
  }
  if (response.status === 403) throw flowSourceError("NITTER_RSS_DISABLED", "Esta instancia de Nitter tiene el RSS desactivado (HTTP 403). Prueba otra instancia.");
  if (response.status === 429) throw flowSourceError("NITTER_RATE_LIMITED", "La instancia de Nitter limitó las consultas (HTTP 429). Reintenta más tarde o cambia de instancia.");
  if (!response.ok) throw flowSourceError("NITTER_UNAVAILABLE", `La instancia de Nitter respondió HTTP ${response.status}.`);
  const xml = await readLimited(response);
  const limit = Math.max(1, Math.min(100, Number(config.limit) || 25));
  return parseRssItems(xml, { baseUrl: feedUrl })
    .map((item) => nitterArticleFromItem(item, config))
    .filter(Boolean)
    .slice(0, limit);
}

// ── nodo ai: 8 proveedores BYOK — nativos (Gemini, Anthropic) + OpenAI-compatible ──

export function validateAiConfig(config, nodeId = "IA") {
  if (!AI_PROVIDERS.includes(config.provider)) throw flowSourceError("AI_CONFIG", `Proveedor IA inválido en ${nodeId} (usa: ${AI_PROVIDERS.join(", ")}).`);
  const model = String(config.model ?? "").trim();
  if (model && (!MODEL_ID.test(model) || model.includes(".."))) throw flowSourceError("AI_CONFIG", `Modelo IA inválido en ${nodeId}.`);
  if (typeof config.prompt !== "string" || !config.prompt.trim() || config.prompt.length > 20_000) {
    throw flowSourceError("AI_CONFIG", `El prompt IA de ${nodeId} está vacío o es demasiado largo.`);
  }
  const maxOutputTokens = Number(config.maxOutputTokens ?? 1024);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192) {
    throw flowSourceError("AI_CONFIG", `Límite de tokens inválido en ${nodeId} (1-8192).`);
  }
}

function aiAuthHeaders(provider, credential) {
  if (!credential?.secret) throw flowSourceError("AI_NO_CREDENTIAL", "Este nodo IA no tiene credencial: crea una con flow_credentials_set (type ai_provider) y asígnala con credentialId.");
  if (provider === "gemini") return { "x-goog-api-key": credential.secret };
  if (provider === "anthropic") return { "x-api-key": credential.secret, "anthropic-version": "2023-06-01" };
  return { authorization: `Bearer ${credential.secret}` };
}

async function aiRequestJson(url, { headers, body, provider, timeoutMs }) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw flowSourceError("AI_TIMEOUT", `${provider}: la API tardó más de ${Math.round(timeoutMs / 1000)}s.`);
    throw flowSourceError("AI_UNREACHABLE", `${provider}: no se pudo conectar con la API.`);
  }
  if (!response.ok) throw flowSourceError("AI_PROVIDER_ERROR", `${provider}: la API respondió HTTP ${response.status}. Revisa key, modelo y cuota.`);
  const text = await response.text();
  if (text.length > AI_RESPONSE_LIMIT) throw flowSourceError("AI_PROVIDER_ERROR", `${provider}: respuesta demasiado grande.`);
  try { return JSON.parse(text); } catch { throw flowSourceError("AI_PROVIDER_ERROR", `${provider}: la API no devolvió JSON válido.`); }
}

/** Ejecuta un prompt contra el proveedor del nodo. `credential` ya viene
 *  resuelto y descifrado por el llamador (store.getCredential). */
export async function runAiText(config, credential, { timeoutMs = 40_000 } = {}) {
  validateAiConfig(config);
  const provider = config.provider;
  const model = String(config.model || credential?.model || "").trim();
  if (!model) throw flowSourceError("AI_CONFIG", "Selecciona un modelo IA (nodo o credencial) antes de ejecutar.");
  if (credential && credential.type !== "ai_provider") throw flowSourceError("AI_CREDENTIAL_TYPE", `La credencial seleccionada no es de IA (es ${credential.type}).`);
  if (credential?.provider && credential.provider !== provider) {
    throw flowSourceError("AI_CREDENTIAL_TYPE", `La credencial es de ${credential.provider}, no de ${provider}.`);
  }
  const headers = aiAuthHeaders(provider, credential);
  const prompt = config.prompt.trim();
  const systemPrompt = String(config.systemPrompt ?? "").trim();
  const maxOutputTokens = Number(config.maxOutputTokens ?? 1024);
  let url; let body;
  if (provider === "gemini") {
    url = `${AI_BASES.gemini}/${encodeURIComponent(model)}:generateContent`;
    body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      generationConfig: { maxOutputTokens },
    };
  } else if (provider === "anthropic") {
    // API nativa de Anthropic (/v1/messages): system va top-level y max_tokens es obligatorio.
    url = `${AI_BASES.anthropic}/messages`;
    body = {
      model,
      max_tokens: maxOutputTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    // OpenAI-compatible: openai, deepseek, glm (Zhipu), kimi (Moonshot), qwen (DashScope), openrouter.
    url = `${AI_BASES[provider]}/chat/completions`;
    body = {
      model,
      messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: prompt }],
      max_tokens: maxOutputTokens,
      stream: false,
    };
  }
  const data = await aiRequestJson(url, { headers, body, provider, timeoutMs });
  const text = provider === "gemini"
    ? data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("")
    : provider === "anthropic"
      ? data.content?.map((block) => block.text ?? "").join("")
      : data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw flowSourceError("AI_EMPTY_OUTPUT", `${provider}: el modelo no devolvió texto. Revisa filtros de seguridad, modelo y límite de tokens.`);
  }
  return {
    text: text.slice(0, 100_000),
    model: String(data.modelVersion || data.model || model).slice(0, 120),
    provider,
    usage: provider === "gemini"
      ? { inputTokens: data.usageMetadata?.promptTokenCount ?? null, outputTokens: data.usageMetadata?.candidatesTokenCount ?? null }
      : provider === "anthropic"
        ? { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null }
        : { inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null },
  };
}

// ── nodo template: clonar frame exacto + llenar slots (port del newsroom) ──

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

export function trimText(value, length) {
  const text = stripTags(value);
  return text.length <= length ? text : `${text.slice(0, length - 1).trim()}…`;
}

function headlineParts(title, maxLength) {
  const words = trimText(title, maxLength).split(" ");
  const middle = Math.max(1, Math.ceil(words.length / 2));
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

/** Sustituye {{title}}/{{summary}}/… en el HTML del frame; si el frame no usa
 *  slots, rellena h1 y la imagen principal como el newsroom (comportamiento
 *  probado — no reinventar). */
export function renderTemplateFrame(frame, values) {
  if (!frame || typeof frame.html !== "string" || typeof frame.css !== "string") {
    throw flowSourceError("TEMPLATE_INVALID", "El frame de Musa no contiene HTML y CSS utilizables.");
  }
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width < 320 || frame.height < 320) {
    throw flowSourceError("TEMPLATE_INVALID", "El frame de Musa tiene dimensiones inválidas.");
  }
  const clean = {
    title: trimText(values.title ?? "", 120),
    summary: trimText(values.summary ?? "", 400),
    source: String(values.source ?? ""),
    date: String(values.date ?? ""),
    imageUrl: String(values.imageUrl ?? ""),
    sourceUrl: String(values.sourceUrl ?? ""),
    text: trimText(values.text ?? "", 2_000),
  };
  const aliases = { titular: "title", resumen: "summary", fuente: "source", fecha: "date", imagen: "imageUrl", enlace: "sourceUrl", texto: "text" };
  let frameHtml = String(frame.html).replace(
    /\{\{\s*(title|summary|source|date|imageUrl|sourceUrl|text|titular|resumen|fuente|fecha|imagen|enlace|texto)\s*\}\}/gi,
    (_match, key) => escapeHtml(clean[aliases[String(key).toLowerCase()] ?? String(key).toLowerCase()] ?? ""),
  );
  let frameCss = String(frame.css);
  const seiko = /class=["'](?:post|story)-headline["']/i.test(frameHtml);
  if (seiko) {
    const prefix = /class=["']story-headline["']/i.test(frameHtml) ? "story" : "post";
    const [first, second] = headlineParts(clean.title || clean.text, prefix === "story" ? 90 : 76);
    frameHtml = frameHtml.replace(
      new RegExp(`(<h1\\b[^>]*class=["'][^"']*${prefix}-headline[^"']*["'][^>]*>)[\\s\\S]*?(<\\/h1>)`, "i"),
      (_match, open, close) => `${open}<span>${escapeHtml(first)}</span><br><span class="${prefix}-lime">${escapeHtml(second)}</span>${close}`,
    );
    const background = /^https:\/\//i.test(clean.imageUrl) ? `url(${JSON.stringify(clean.imageUrl)})` : "none";
    frameCss += `\n.${prefix}-bg{background-image:${background}}`;
  } else {
    if (!/\{\{\s*(?:title|titular)\s*\}\}/i.test(frame.html) && (clean.title || clean.text)) {
      if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(frameHtml)) {
        throw flowSourceError("TEMPLATE_NO_TITLE_SLOT", "La plantilla no tiene campo para el titular. Usa un frame con <h1> o {{title}}.");
      }
      frameHtml = frameHtml.replace(/(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/i, (_match, open, close) => `${open}${escapeHtml(clean.title || clean.text)}${close}`);
    }
    if (/^https:\/\//i.test(clean.imageUrl) && !/\{\{\s*(?:imageUrl|imagen)\s*\}\}/i.test(frame.html)) {
      const images = [...frameHtml.matchAll(/<img\b[^>]*>/gi)];
      const mainImage = images.find(([tag]) => /hero|cover|photo|main|image|foto/i.test(tag) && !/logo|icon|avatar/i.test(tag)) ?? (images.length === 1 ? images[0] : null);
      if (mainImage) {
        const replacement = /\bsrc=(['"])[\s\S]*?\1/i.test(mainImage[0])
          ? mainImage[0].replace(/\bsrc=(['"])[\s\S]*?\1/i, () => `src="${escapeHtml(clean.imageUrl)}"`)
          : mainImage[0].replace(/>$/, ` src="${escapeHtml(clean.imageUrl)}">`);
        frameHtml = frameHtml.replace(mainImage[0], replacement);
      } else {
        const classNames = [...frameHtml.matchAll(/\bclass=['"]([^'"]+)['"]/gi)].flatMap((match) => match[1].split(/\s+/));
        const backgroundClass = classNames.find((name) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(name) && /(?:^|[-_])(bg|hero|cover|photo|image|foto)(?:$|[-_])/i.test(name) && !/logo|icon|avatar/i.test(name));
        if (backgroundClass) frameCss += `\n.${backgroundClass}{background-image:url(${JSON.stringify(clean.imageUrl)})}`;
      }
    }
  }
  return { html: frameHtml, css: frameCss, width: frame.width, height: frame.height, background: frame.background ?? null };
}

/** Valores que un item aporta al frame del nodo template. */
export function templateValuesFromItem(item = {}) {
  return {
    title: item.title ?? item.summary ?? "",
    summary: item.summary ?? item.ai ?? item.text ?? "",
    source: item.source ?? "",
    date: item.dateLabel ?? item.date ?? "",
    imageUrl: item.imageUrl ?? "",
    sourceUrl: item.link ?? item.sourceUrl ?? "",
    text: item.ai ?? item.text ?? "",
  };
}
