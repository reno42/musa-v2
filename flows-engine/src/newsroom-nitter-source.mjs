import Parser from "rss-parser";

const parser = new Parser({
  customFields: { item: [["dc:creator", "creator"]] },
});

const MAX_VIDEO_PAGE_BYTES = 256_000;
const MAX_VIDEO_LOOKUPS = 10;
const VIDEO_LOOKUP_CONCURRENCY = 3;

function sourceError(code, message) {
  return Object.assign(new Error(message), { code });
}

function feedUrl(config) {
  const direct = String(config.rssUrl ?? config.url ?? "").trim();
  if (direct) return validUrl(direct);
  const username = String(config.username ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw sourceError("NITTER_CONFIG", "Indica un usuario válido de X para esta fuente.");
  const instance = validUrl(String(config.instanceUrl ?? "").trim());
  if (instance.username || instance.password || instance.search || instance.hash) throw sourceError("NITTER_CONFIG", "La URL de la instancia de Nitter no debe incluir credenciales ni parámetros.");
  return new URL(`${encodeURIComponent(username)}/rss`, `${instance.toString().replace(/\/?$/, "/")}`);
}

function validUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw sourceError("NITTER_CONFIG", "Indica una URL RSS o una instancia de Nitter válida."); }
  if (!["http:", "https:"].includes(url.protocol)) throw sourceError("NITTER_CONFIG", "La fuente Nitter debe usar HTTP o HTTPS.");
  if (url.username || url.password) throw sourceError("NITTER_CONFIG", "La URL de Nitter no debe incluir credenciales.");
  return url;
}

function absoluteUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.replace(/&amp;/gi, "&"), base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

function decodeEntities(value) {
  return String(value).replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const number = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
}

function plainText(markup) {
  return decodeEntities(String(markup ?? "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;
}

function mediaFromItem(item, base) {
  const markup = String(item["content:encoded"] ?? item.content ?? item.description ?? "");
  const media = [];
  for (const tag of markup.match(/<img\b[^>]*>/gi) ?? []) {
    const url = absoluteUrl(attribute(tag, "src"), base);
    if (!url) continue;
    const before = markup.slice(0, markup.indexOf(tag));
    const isVideoPreview = /<a\b[^>]*>\s*(?:<br\s*\/?>\s*)?Video(?:<br\s*\/?>)?\s*$/i.test(before);
    media.push({ type: isVideoPreview ? "video" : "photo", url: isVideoPreview ? null : url, previewImageUrl: url });
  }
  for (const tag of markup.match(/<source\b[^>]*>/gi) ?? []) {
    const url = absoluteUrl(attribute(tag, "src"), base);
    if (url && /video\/mp4/i.test(attribute(tag, "type") ?? "")) media.push({ type: "video", url, previewImageUrl: null });
  }
  const enclosure = item.enclosure;
  if (enclosure?.url) {
    const url = absoluteUrl(enclosure.url, base);
    if (url) media.push({ type: /video/i.test(enclosure.type ?? "") ? "video" : "photo", url, previewImageUrl: /video/i.test(enclosure.type ?? "") ? null : url });
  }
  return media;
}

function originalLink(value, base) {
  const url = absoluteUrl(value, base);
  if (!url) return null;
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  return match ? `https://x.com/${match[1]}/status/${match[2]}` : url;
}

function articleFromItem(item, config, base) {
  const title = plainText(item.title);
  const repost = title.match(/^RT(?: by)? @([A-Za-z0-9_]{1,15}):\s*/i);
  if (repost && config.includeReposts === false) return null;
  const reply = !repost && /^R to @[A-Za-z0-9_]+:\s*/i.test(title);
  const cleanTitle = title.replace(/^RT(?: by)? @[A-Za-z0-9_]{1,15}:\s*/i, "").replace(/^R to @[A-Za-z0-9_]+:\s*/i, "");
  const markup = String(item["content:encoded"] ?? item.content ?? item.description ?? "");
  const firstParagraph = markup.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const summary = plainText(firstParagraph ?? item.contentSnippet ?? item.description ?? cleanTitle);
  const link = originalLink(item.link || item.guid, base);
  if (!link || !cleanTitle && !summary) return null;
  const media = mediaFromItem(item, base);
  const author = String(item.creator ?? "").trim() || link.match(/^https:\/\/x\.com\/([^/]+)\/status\//i)?.[1] || null;
  const image = media.find((entry) => entry.type === "photo")?.url ?? media.find((entry) => entry.previewImageUrl)?.previewImageUrl ?? null;
  return {
    title: (cleanTitle || summary).slice(0, 180),
    summary,
    link,
    source: config.name || (author ? `X · ${author.startsWith("@") ? author : `@${author}`}` : "X vía Nitter"),
    publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
    imageUrl: image,
    videoUrl: media.find((entry) => entry.type === "video" && entry.url)?.url ?? null,
    media,
    author: author ? (author.startsWith("@") ? author : `@${author}`) : null,
    kind: repost ? "repost" : reply ? "reply" : "post",
    ...(repost ? { sharedBy: `@${repost[1]}` } : {}),
  };
}

function statusPageUrl(item, feed) {
  const link = absoluteUrl(item.link, feed);
  if (!link) return null;
  const page = new URL(link);
  if (page.origin !== feed.origin || !/^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(page.pathname)) return null;
  page.search = "";
  page.hash = "";
  return page;
}

function videoUrlFromPage(html, page) {
  const main = /<(?:div|article)\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bmain-tweet\b)[^>]*>/i.exec(html);
  if (!main) return null;
  const start = main.index + main[0].length;
  const published = /\bclass\s*=\s*["'][^"']*\btweet-published\b/i.exec(html.slice(start));
  if (!published) return null;
  const tweet = html.slice(start, start + published.index);
  for (const video of tweet.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)) {
    for (const source of video[1].match(/<source\b[^>]*>/gi) ?? []) {
      const src = absoluteUrl(attribute(source, "src"), page);
      if (!src) continue;
      const url = new URL(src);
      const type = attribute(source, "type") ?? "";
      if (url.origin === page.origin && url.pathname.startsWith("/video/") && (/video\/mp4/i.test(type) || /\.mp4$/i.test(url.pathname))) return src;
    }
  }
  return null;
}

async function limitedHtml(response) {
  const length = Number(response.headers?.get("content-length"));
  if (length > MAX_VIDEO_PAGE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return html + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_VIDEO_PAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function videoUrlFromStatus(item, feed, fetchImpl) {
  const page = statusPageUrl(item, feed);
  if (!page) return null;
  try {
    const response = await fetchImpl(page, {
      headers: { accept: "text/html" },
      redirect: "error",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const html = await limitedHtml(response);
    return html ? videoUrlFromPage(html, page) : null;
  } catch {
    return null;
  }
}

async function resolveVideoPreviews(records, feed, fetchImpl) {
  const candidates = records.filter(({ article }) => !article.videoUrl && article.media.some((entry) => entry.type === "video" && !entry.url)).slice(0, MAX_VIDEO_LOOKUPS);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(VIDEO_LOOKUP_CONCURRENCY, candidates.length) }, async () => {
    while (next < candidates.length) {
      const { item, article } = candidates[next++];
      const url = await videoUrlFromStatus(item, feed, fetchImpl);
      if (!url) continue;
      article.videoUrl = url;
      const preview = article.media.find((entry) => entry.type === "video" && !entry.url);
      preview.url = url;
    }
  }));
}

export async function fetchNitterSource(node, { fetchImpl = fetch } = {}) {
  const config = node?.config ?? node ?? {};
  const url = feedUrl(config);
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/rss+xml, application/xml;q=0.9" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw sourceError("NITTER_UNAVAILABLE", "No se pudo conectar con la instancia de Nitter. Prueba otra instancia o una URL RSS directa.");
  }
  if (response.status === 403) throw sourceError("NITTER_RSS_DISABLED", "Esta instancia de Nitter tiene el RSS desactivado (HTTP 403). Prueba otra instancia.");
  if (response.status === 429) throw sourceError("NITTER_RATE_LIMITED", "La instancia de Nitter limitó las consultas (HTTP 429). Inténtalo más tarde.");
  if (!response.ok) throw sourceError("NITTER_UNAVAILABLE", `La instancia de Nitter respondió con HTTP ${response.status}.`);
  const xml = await response.text();
  if (xml.length > 2_000_000 || !/<rss\b|<feed\b/i.test(xml)) throw sourceError("NITTER_INVALID_FEED", "La instancia de Nitter no devolvió un RSS válido.");
  let feed;
  try { feed = await parser.parseString(xml); } catch { throw sourceError("NITTER_INVALID_FEED", "No se pudo leer el RSS de Nitter."); }
  const limit = Math.max(1, Math.min(100, Number(config.limit) || 25));
  const records = (feed.items ?? []).map((item) => ({ item, article: articleFromItem(item, config, url) })).filter(({ article }) => article).slice(0, limit);
  if (config.resolveVideoUrls !== false) await resolveVideoPreviews(records, url, fetchImpl);
  return records.map(({ article }) => article);
}
