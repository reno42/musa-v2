import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import Parser from "rss-parser";
import { getNewsroomFlows } from "./newsroom-flows.mjs";
import { fetchNitterSource } from "./newsroom-nitter-source.mjs";
import { getNewsroomRuns, runtimePaths, writeJson } from "./runtime-store.mjs";

const parser = new Parser({ timeout: 15_000 });
const TIMEZONE = "America/Lima";
const MUSA_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 5_000, 5_000];

function isMusaConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:服务\s+\S+\s+未连接|not connected|connection (?:is )?(?:closed|lost)|transport.*closed)/i.test(message);
}

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function unwrap(result) {
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { text }; }
}

function findValue(value, predicate) {
  if (predicate(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const child of Object.values(value)) {
    const found = findValue(child, predicate);
    if (found != null) return found;
  }
  return null;
}

function html(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function plain(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  if (typeof value !== "string") return null;
  const decoded = value
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&")
    .trim();
  return /^https?:\/\//i.test(decoded) ? decoded : null;
}

function trimText(value, length) {
  const text = plain(value);
  return text.length <= length ? text : `${text.slice(0, length - 1).trim()}…`;
}

function currentDay() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function imageFromItem(item) {
  const enclosureIsVideo = /^video\//i.test(item.enclosure?.type ?? "") || /\.(?:mp4|webm)(?:[?#]|$)/i.test(item.enclosure?.url ?? "");
  const mediaContentIsVideo = /^video\//i.test(item["media:content"]?.type ?? "") || /\.(?:mp4|webm)(?:[?#]|$)/i.test(item["media:content"]?.url ?? "");
  const candidates = [
    enclosureIsVideo ? null : item.enclosure?.url,
    item.image?.url,
    item.image,
    item.thumbnail,
    mediaContentIsVideo ? null : item["media:content"]?.url,
    item["media:thumbnail"]?.url,
  ];
  const markup = `${item.content ?? ""} ${item["content:encoded"] ?? ""} ${item.description ?? ""}`;
  candidates.push(markup.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]);
  return normalizeUrl(candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value)));
}

async function imageFromArticle(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const response = await fetch(parsed, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MiaNewsroom/1.0)", "accept-language": "es-PE,es;q=0.9" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.text()).slice(0, 600_000);
    return normalizeUrl(body.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i)?.[1]
      ?? null);
  } catch { return null; }
}

function articleMarkup(article, index, imageUrl) {
  const title = trimText(article.title, 120);
  const summary = trimText(article.summary, 280) || "Revisa la fuente para conocer todos los detalles de esta noticia.";
  const photo = imageUrl
    ? `<img class="hero" src="${html(imageUrl)}" alt="${html(title)}">`
    : `<div class="hero fallback"><span>${String(index + 1).padStart(2, "0")}</span></div>`;
  return {
    html: `<main>${photo}<section class="content"><div class="meta"><span>${html(article.source)}</span><time>${html(article.dateLabel)}</time></div><h1>${html(title)}</h1><p>${html(summary)}</p><footer><span>MIA NEWS · EDICIÓN DIARIA</span><span>Fuente: ${html(article.source)}</span></footer></section></main>`,
    css: `*{box-sizing:border-box}body{margin:0;color:#17191c;font-family:Arial,sans-serif;width:1080px;height:1350px}main{position:relative;width:1080px;height:1350px;overflow:hidden;background:#f4f0e8}.hero{display:block;width:1080px;height:700px;object-fit:cover;filter:saturate(.82) contrast(1.05)}.hero.fallback{display:grid;place-items:center;background:#20252d;color:#e6b44a;font-size:180px;font-weight:900}.content{position:absolute;left:0;right:0;bottom:0;min-height:700px;padding:68px 72px 48px;background:#f4f0e8;border-top:14px solid #e6b44a}.meta{display:flex;justify-content:space-between;gap:24px;color:#665d50;font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:2px}.meta span{max-width:620px}h1{max-width:930px;margin:35px 0 28px;font-size:66px;line-height:1.02;letter-spacing:-2.6px}p{max-width:890px;margin:0;color:#4c4c4b;font-size:30px;line-height:1.42}footer{position:absolute;left:72px;right:72px;bottom:42px;display:flex;justify-content:space-between;gap:24px;border-top:2px solid #c8c0b3;padding-top:20px;color:#686158;font-size:17px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px}`,
  };
}

function replaceSlots(markup, values) {
  const aliases = { titular: "title", resumen: "summary", fuente: "source", fecha: "date", imagen: "imageUrl", enlace: "sourceUrl", imageurl: "imageUrl", sourceurl: "sourceUrl" };
  return markup.replace(/\{\{\s*(title|summary|source|date|imageUrl|sourceUrl|titular|resumen|fuente|fecha|imagen|enlace)\s*\}\}/gi, (_, key) => html(values[aliases[key.toLowerCase()] ?? key] ?? ""));
}

function headlineParts(title, maxLength) {
  const words = trimText(title, maxLength).split(" ");
  const middle = Math.max(1, Math.ceil(words.length / 2));
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

export function renderNewsroomSourceFrame(frame, article, imageUrl) {
  if (!frame || typeof frame.html !== "string" || typeof frame.css !== "string") throw new Error("El frame de Musa no contiene HTML y CSS utilizables.");
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width < 320 || frame.height < 320) throw new Error("El frame de Musa tiene dimensiones inválidas.");
  const values = {
    title: trimText(article.title, 105), summary: trimText(article.summary, 280),
    source: article.source, date: article.dateLabel, imageUrl: imageUrl ?? "", sourceUrl: article.link,
  };
  let frameHtml = replaceSlots(frame.html, values);
  let frameCss = frame.css;
  const seiko = /class=["'](?:post|story)-headline["']/i.test(frameHtml);
  if (seiko) {
    const prefix = /class=["']story-headline["']/i.test(frameHtml) ? "story" : "post";
    const [first, second] = headlineParts(article.title, prefix === "story" ? 90 : 76);
    frameHtml = frameHtml.replace(new RegExp(`(<h1\\b[^>]*class=["'][^"']*${prefix}-headline[^"']*["'][^>]*>)[\\s\\S]*?(<\\/h1>)`, "i"), (_, open, close) => `${open}<span>${html(first)}</span><br><span class="${prefix}-lime">${html(second)}</span>${close}`);
    frameHtml = frameHtml.replace(new RegExp(`(<button\\b[^>]*class=["'][^"']*${prefix}-cta-btn[^"']*["'][^>]*>)[\\s\\S]*?(<\\/button>)`, "i"), (_, open, close) => `${open}Fuente: ${html(article.source)}${close}`);
    const background = imageUrl && /^https?:\/\//i.test(imageUrl) ? `url(${JSON.stringify(imageUrl)})` : "none";
    frameCss += `\n.${prefix}-bg{background-image:${background}}`;
  } else {
    if (!/\{\{\s*(?:title|titular)\s*\}\}/i.test(frame.html)) {
      if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(frameHtml)) throw new Error("La plantilla no tiene un campo para el titular. Usa un frame con h1 o {{title}}.");
      frameHtml = frameHtml.replace(/(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/i, (_, open, close) => `${open}${html(values.title)}${close}`);
    }
    if (imageUrl && !/\{\{\s*(?:imageUrl|imagen)\s*\}\}/i.test(frame.html)) {
      const images = [...frameHtml.matchAll(/<img\b[^>]*>/gi)];
      const mainImage = images.find(([tag]) => /hero|cover|photo|main|image|foto/i.test(tag) && !/logo|icon|avatar/i.test(tag)) ?? (images.length === 1 ? images[0] : null);
      if (mainImage) {
        const replacement = /\bsrc=(['"])[\s\S]*?\1/i.test(mainImage[0])
          ? mainImage[0].replace(/\bsrc=(['"])[\s\S]*?\1/i, () => `src="${html(imageUrl)}"`)
          : mainImage[0].replace(/>$/, ` src="${html(imageUrl)}">`);
        frameHtml = frameHtml.replace(mainImage[0], replacement);
      } else {
        const classNames = [...frameHtml.matchAll(/\bclass=['"]([^'"]+)['"]/gi)].flatMap((match) => match[1].split(/\s+/));
        const backgroundClass = classNames.find((name) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(name) && /(?:^|[-_])(bg|hero|cover|photo|image|foto)(?:$|[-_])/i.test(name) && !/logo|icon|avatar/i.test(name));
        if (backgroundClass) frameCss += `\n.${backgroundClass}{background-image:url(${JSON.stringify(imageUrl)})}`;
      }
    }
  }
  return { html: frameHtml, css: frameCss, width: frame.width, height: frame.height, background: frame.background ?? null };
}

function configSignature(flow) {
  const nodes = flow.nodes
    .filter((node) => !["schedule", "report"].includes(node.type))
    .map(({ id, type, label, enabled, config }) => ({
      id, type, label, enabled,
      config: type === "design" && (config.storyTemplateId === config.postTemplateId || (!config.storyTemplateId && !config.storyFrameId))
        ? { mode: config.mode, templateId: config.postTemplateId ?? config.templateId ?? "", postFrameId: config.postFrameId ?? "", storyFrameId: config.storyFrameId ?? "" }
        : config,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = flow.edges
    .filter(({ from, to }) => nodes.some((node) => node.id === from) && nodes.some((node) => node.id === to))
    .map(({ from, to }) => ({ from, to }))
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));
  return createHash("sha256").update(JSON.stringify({ flowId: flow.id, workspaceId: flow.workspaceId, maxItems: flow.maxItems, nodes, edges })).digest("hex");
}

function legacyConfigFromFlow(flow) {
  if (!flow) return null;
  return {
    enabled: flow.enabled,
    workspaceId: flow.workspaceId,
    maxItems: flow.maxItems,
    feeds: flow.nodes.filter((node) => node.type === "rss").map((node) => ({ name: node.label, url: node.config.url, enabled: node.enabled })),
    design: flow.nodes.find((node) => node.type === "design")?.config ?? { mode: "builtin" },
  };
}

export async function fetchRssSource(node) {
  const feed = await parser.parseURL(node.config.url);
  return (feed.items ?? []).flatMap((item) => {
    const link = item.link || item.guid;
    if (!link || !item.title) return [];
    const enclosure = item.enclosure;
    const videoUrl = /^video\//i.test(enclosure?.type ?? "") || /\.(?:mp4|webm)(?:[?#]|$)/i.test(enclosure?.url ?? "")
      ? normalizeUrl(enclosure?.url) : null;
    const imageUrl = imageFromItem(item);
    return [{
      title: item.title,
      summary: item.contentSnippet || item.summary || item.content || item.description || "",
      link,
      source: node.label || feed.title || "RSS",
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      imageUrl,
      videoUrl,
      media: [...(imageUrl ? [{ type: "photo", url: imageUrl, previewImageUrl: imageUrl }] : []), ...(videoUrl ? [{ type: "video", url: videoUrl, previewImageUrl: imageUrl }] : [])],
    }];
  }).sort((left, right) => (Date.parse(right.publishedAt) || 0) - (Date.parse(left.publishedAt) || 0));
}

function passesFilter(article, config) {
  if (config.kind === "repost" && article.kind !== "repost") return false;
  if (config.kind === "original" && article.kind === "repost") return false;
  const text = plain(`${article.title ?? ""} ${article.summary ?? ""} ${article.author ?? ""} ${article.sharedBy ?? ""}`).toLocaleLowerCase("es");
  const includes = config.includeKeywords ?? [];
  const excludes = config.excludeKeywords ?? [];
  if (includes.length && !includes.some((keyword) => text.includes(keyword.toLocaleLowerCase("es")))) return false;
  if (excludes.some((keyword) => text.includes(keyword.toLocaleLowerCase("es")))) return false;
  if (config.media === "image" && !article.imageUrl && !article.media?.some((item) => item.type === "photo")) return false;
  if (config.media === "video" && !article.videoUrl && !article.media?.some((item) => item.type === "video")) return false;
  return true;
}

function reachesDesign(sourceId, article, nodes, next, designId, applyFilters) {
  const pending = [sourceId];
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const targetId of next.get(id) ?? []) {
      const target = nodes.get(targetId);
      if (!target?.enabled) continue;
      if (targetId === designId) return true;
      if (target.type === "filter" && (!applyFilters || passesFilter(article, target.config))) pending.push(targetId);
    }
  }
  return false;
}

export async function collectNewsroomArticles(flow, { fetchRss = fetchRssSource, fetchNitter = fetchNitterSource } = {}) {
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  const next = new Map(flow.nodes.map((node) => [node.id, []]));
  for (const edge of flow.edges) next.get(edge.from)?.push(edge.to);
  const designId = flow.nodes.find((node) => node.type === "design")?.id;
  const sources = flow.nodes.filter((node) => ["rss", "nitter"].includes(node.type) && node.enabled && reachesDesign(node.id, null, nodes, next, designId, false));
  const outcomes = new Array(sources.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < sources.length) {
      const index = nextIndex++;
      const node = sources[index];
      try {
        const fetched = node.type === "rss"
          ? await fetchRss(node)
          : await fetchNitter({ ...node, config: { ...node.config, name: node.label } });
        outcomes[index] = {
          articles: fetched
            .filter((article) => article?.link && article?.title && reachesDesign(node.id, article, nodes, next, designId, true))
            .map((article) => ({ ...article, sourceNodeId: node.id, sourceType: node.type })),
        };
      } catch (error) {
        outcomes[index] = { error: { stage: node.type, source: node.label, sourceNodeId: node.id, code: error?.code ?? null, message: error instanceof Error ? error.message : String(error) } };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, () => worker()));
  const buckets = outcomes.flatMap((outcome) => outcome?.articles ? [outcome.articles] : []);
  const errors = outcomes.flatMap((outcome) => outcome?.error ? [outcome.error] : []);
  const selected = [];
  const seen = new Set();
  const limit = Math.max(1, Math.min(Number(flow.maxItems) || 5, 10));
  // Each feed keeps its own timeline order, including reposts whose pubDate is the original post date.
  for (let index = 0; selected.length < limit && buckets.some((bucket) => index < bucket.length); index += 1) {
    for (const bucket of buckets) {
      const article = bucket[index];
      if (!article) continue;
      const key = article.link.trim().replace(/#.*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(article);
      if (selected.length === limit) break;
    }
  }
  return { articles: selected, errors };
}

function notifyWindows(title, message) {
  if (process.platform !== "win32") return;
  const ps = (value) => String(value).replace(/'/g, "''");
  const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);$nodes=$xml.GetElementsByTagName('text');$nodes.Item(0).AppendChild($xml.CreateTextNode('${ps(title)}')) > $null;$nodes.Item(1).AppendChild($xml.CreateTextNode('${ps(message)}')) > $null;$toast=[Windows.UI.Notifications.ToastNotification]::new($xml);[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mia Control Room').Show($toast)`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

export function createNewsroomPipeline(callTool, {
  loadFlows = getNewsroomFlows,
  loadRuns = getNewsroomRuns,
  writeRuns = (store) => writeJson(runtimePaths.newsroomRuns, store),
  fetchRss = fetchRssSource,
  fetchNitter = fetchNitterSource,
  notify = notifyWindows,
} = {}) {
  let saveQueue = Promise.resolve();
  const inFlight = new Map();

  async function callMusa(toolName, args) {
    let lastError;
    for (let attempt = 0; attempt <= MUSA_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const result = await callTool(toolName, args);
        if (result?.isError) throw new Error(result.content?.find((item) => item?.type === "text")?.text ?? `${toolName} failed`);
        return result;
      } catch (error) {
        lastError = error;
        if (!isMusaConnectionError(error) || attempt === MUSA_RETRY_DELAYS_MS.length) throw error;
        const delayMs = MUSA_RETRY_DELAYS_MS[attempt];
        console.warn(`[newsroom] ${toolName} waiting for Musa (${attempt + 1}/${MUSA_RETRY_DELAYS_MS.length}, ${delayMs}ms)`);
        await wait(delayMs);
      }
    }
    throw lastError;
  }

  async function saveRun(run) {
    const saved = structuredClone(run);
    const task = saveQueue.catch(() => {}).then(async () => {
      const store = await loadRuns();
      store.runs = [saved, ...(store.runs ?? []).filter((item) => item.id !== saved.id)].slice(0, 100);
      await writeRuns(store);
    });
    saveQueue = task;
    await task;
  }

  async function snapshot() {
    const [flows, store] = await Promise.all([loadFlows(), loadRuns()]);
    const selectedFlowId = flows.selectedFlowId ?? flows.flows[0]?.id ?? null;
    const selectedFlow = flows.flows.find((flow) => flow.id === selectedFlowId);
    const latestByFlow = Object.create(null);
    for (const run of store.runs ?? []) {
      const id = run.flowId ?? "daily-news";
      latestByFlow[id] ??= run;
    }
    return { config: legacyConfigFromFlow(selectedFlow), flows, latestRun: latestByFlow[selectedFlowId] ?? null, latestByFlow };
  }

  async function resolveFlow(flowId) {
    const store = await loadFlows();
    const id = flowId ?? store.selectedFlowId ?? store.flows[0]?.id;
    const flow = store.flows.find((item) => item.id === id);
    if (!flow) throw Object.assign(new Error(`No existe el flujo de noticias ${id ?? "solicitado"}.`), { statusCode: 404 });
    return flow;
  }

  async function buildFlow(flow) {
    if (flow.enabled === false) return { flowId: flow.id, status: "disabled", message: `El flujo «${flow.name}» está pausado.` };
    const day = currentDay();
    const store = await loadRuns();
    const signature = configSignature(flow);
    const existing = store.runs?.find((item) => (item.flowId ?? "daily-news") === flow.id && item.day === day && item.configSignature === signature);
    if (existing?.status === "complete") return existing;
    const revision = (store.runs ?? []).filter((item) => (item.flowId ?? "daily-news") === flow.id && item.day === day).length + 1;
    const run = existing ?? { id: randomUUID(), flowId: flow.id, flowName: flow.name, day, revision, configSignature: signature, startedAt: new Date().toISOString(), status: "running", articles: [], errors: [], questions: [] };
    if (existing) {
      run.errors = (run.errors ?? []).filter((error) => ["rss", "nitter", "image"].includes(error.stage));
      delete run.finishedAt;
    }
    run.flowId = flow.id;
    run.flowName = flow.name;
    run.status = "running";
    await saveRun(run);

    try {
      let selected = run.selectedArticles;
      if (!Array.isArray(selected) || !selected.length) {
        const collection = await collectNewsroomArticles(flow, { fetchRss, fetchNitter });
        selected = collection.articles;
        run.errors.push(...collection.errors);
        if (!selected.length) throw new Error("No se encontraron noticias en las fuentes activas del flujo.");
        for (const article of selected) {
          if (!article.imageUrl && article.sourceType === "rss") article.imageUrl = await imageFromArticle(article.link);
          const published = new Date(article.publishedAt);
          article.dateLabel = new Intl.DateTimeFormat("es-PE", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric" }).format(Number.isNaN(published.getTime()) ? new Date() : published);
        }
        run.selectedArticles = selected;
        await saveRun(run);
      }

      let workspaceId = flow.workspaceId;
      if (!workspaceId) {
        const workspaces = unwrap(await callMusa("musa__list_workspaces", {}));
        workspaceId = workspaces?.data?.[0]?.id;
      }
      if (!workspaceId) throw new Error("No hay un workspace de Musa configurado");

      const designConfig = flow.nodes.find((node) => node.type === "design")?.config ?? { mode: "builtin" };
      let sourceFrames = [];
      if (designConfig.mode === "musa") {
        const postTemplateId = designConfig.postTemplateId ?? designConfig.templateId;
        const storyTemplateId = designConfig.storyTemplateId ?? (designConfig.storyFrameId ? designConfig.templateId : "");
        if (!postTemplateId || !designConfig.postFrameId) throw new Error("Selecciona una plantilla y un frame de post en Flujo noticias.");
        if (Boolean(storyTemplateId) !== Boolean(designConfig.storyFrameId)) throw new Error("Selecciona la plantilla y el frame de story, o deja ambos vacíos.");
        const templateFrames = new Map();
        for (const [format, templateId, frameId] of [["post", postTemplateId, designConfig.postFrameId], ["story", storyTemplateId, designConfig.storyFrameId]]) {
          if (!frameId) continue;
          if (!templateFrames.has(templateId)) {
            const source = unwrap(await callMusa("musa__get_html_frames", { templateId }));
            templateFrames.set(templateId, source?.frames ?? source?.data?.frames ?? []);
          }
          const frame = templateFrames.get(templateId).find((item) => item.id === frameId);
          if (!frame) throw new Error(`No se encontró el frame ${format} en la plantilla ${templateId}.`);
          sourceFrames.push({ format, templateId, frame });
        }
        run.designSource = { templateId: postTemplateId, formats: sourceFrames.map(({ format, templateId, frame }) => ({ format, templateId, sourceFrameId: frame.id })) };
      }

      if (!run.templateId) {
        const name = `Noticias ${flow.id === "daily-news" ? "" : `${trimText(flow.name, 36)} · `}${day}${run.revision > 1 ? ` · edición ${run.revision}` : ""}`;
        const created = unwrap(await callMusa("musa__create_template", { name, workspaceId, width: sourceFrames[0]?.frame.width ?? 1080, height: sourceFrames[0]?.frame.height ?? 1350, engine: "html", initialFrame: false }));
        run.templateId = created?.templateId
          ?? findValue(created, (value) => value && typeof value === "object" && typeof value.templateId === "string")?.templateId
          ?? findValue(created, (value) => value && typeof value === "object" && typeof value.id === "string")?.id;
        if (!run.templateId) throw new Error("Musa no devolvió el ID del archivo diario");
        await saveRun(run);
      }

      for (let index = run.articles.length; index < selected.length; index += 1) {
        const article = selected[index];
        let pending = run.pendingArticle;
        const resuming = Boolean(pending);
        if (pending && (pending.index !== index || pending.sourceUrl !== article.link)) throw new Error("La edición pendiente no coincide con las noticias guardadas.");
        if (!pending) {
          let assetUrl = article.imageUrl;
          if (assetUrl) {
            try {
              const uploaded = unwrap(await callMusa("musa__upload_image", { name: `${day}-${index + 1}-${trimText(article.title, 40)}`, url: assetUrl, workspaceId, tags: [article.sourceType ?? "rss", "newsroom", flow.id, day] }));
              assetUrl = findValue(uploaded, (value) => typeof value === "string" && /^https:\/\//.test(value)) || assetUrl;
            } catch (error) {
              run.errors.push({ stage: "image", source: article.source, message: error instanceof Error ? error.message : String(error) });
            }
          }
          pending = { index, sourceUrl: article.link, imageUrl: assetUrl, formats: [] };
          run.pendingArticle = pending;
          await saveRun(run);
        }
        try {
          const variants = sourceFrames.length ? sourceFrames : [{ format: "post", frame: null }];
          if (resuming) {
            const output = unwrap(await callMusa("musa__get_html_frames", { templateId: run.templateId }));
            const remoteFrames = output?.frames ?? output?.data?.frames ?? [];
            for (const variant of variants) {
              if (pending.formats.some((item) => item.format === variant.format)) continue;
              const name = `${String(index + 1).padStart(2, "0")} · ${variant.format} · ${trimText(article.title, 48)}`;
              const found = remoteFrames.find((frame) => frame.name === name);
              if (found) pending.formats.push({ format: variant.format, frameId: found.id });
            }
            await saveRun(run);
          }
          for (const variant of variants) {
            if (pending.formats.some((item) => item.format === variant.format)) continue;
            const design = variant.frame ? renderNewsroomSourceFrame(variant.frame, article, pending.imageUrl) : { ...articleMarkup(article, index, pending.imageUrl), width: 1080, height: 1350, background: "#f4f0e8" };
            const frame = unwrap(await callMusa("musa__create_html_frame", { templateId: run.templateId, name: `${String(index + 1).padStart(2, "0")} · ${variant.format} · ${trimText(article.title, 48)}`, width: design.width, height: design.height, html: design.html, css: design.css, background: design.background || "#0c0c0e", frameStrategy: "multi" }));
            const frameId = frame?.frameId
              ?? findValue(frame, (value) => value && typeof value === "object" && typeof value.frameId === "string")?.frameId
              ?? findValue(frame, (value) => value && typeof value === "object" && typeof value.id === "string")?.id
              ?? null;
            if (!frameId) throw new Error(`Musa no devolvió el ID del frame ${variant.format}`);
            pending.formats.push({ format: variant.format, frameId });
            await saveRun(run);
          }
          const formats = variants.map(({ format }) => pending.formats.find((item) => item.format === format));
          run.articles.push({
            title: trimText(article.title, 140), summary: trimText(article.summary, 500), source: article.source, sourceUrl: article.link,
            sourceType: article.sourceType, sourceNodeId: article.sourceNodeId,
            imageUrl: pending.imageUrl, videoUrl: article.videoUrl ?? null,
            media: article.media ?? [], kind: article.kind ?? "article", author: article.author ?? null, sharedBy: article.sharedBy ?? null,
            frameId: formats[0]?.frameId ?? null, formats, status: "created",
          });
          delete run.pendingArticle;
        } catch (error) {
          run.errors.push({ stage: "design", source: article.source, title: article.title, message: error instanceof Error ? error.message : String(error) });
          await saveRun(run);
          break;
        }
        await saveRun(run);
      }

      try {
        const rendered = unwrap(await callMusa("musa__render_html_template", { templateId: run.templateId, format: "png", scale: 1 }));
        run.render = rendered ? {
          url: rendered.url ?? null,
          width: rendered.width ?? null,
          height: rendered.height ?? null,
          format: rendered.format ?? "png",
          totalFrames: rendered.totalFrames ?? run.articles.length,
        } : null;
      } catch (error) {
        run.errors.push({ stage: "render", message: error instanceof Error ? error.message : String(error) });
      }
      run.status = run.articles.length === selected.length ? "complete" : run.articles.length ? "partial" : "failed";
      run.finishedAt = new Date().toISOString();
      await saveRun(run);
      console.log(`[newsroom] ${flow.id}: ${run.status}: ${run.articles.length} posts in ${run.templateId}`);
      return run;
    } catch (error) {
      run.status = run.articles.length ? "partial" : "failed";
      run.finishedAt = new Date().toISOString();
      run.errors.push({ stage: "pipeline", message: error instanceof Error ? error.message : String(error) });
      await saveRun(run);
      console.error(`[newsroom] ${flow.id} failed: ${run.errors.at(-1).message}`);
      return run;
    }
  }

  async function build(flowId) {
    const flow = await resolveFlow(flowId);
    if (inFlight.has(flow.id)) return inFlight.get(flow.id);
    const task = buildFlow(flow);
    inFlight.set(flow.id, task);
    try { return await task; }
    finally { if (inFlight.get(flow.id) === task) inFlight.delete(flow.id); }
  }

  async function report(flowId) {
    const flow = await resolveFlow(flowId);
    const { latestByFlow } = await snapshot();
    const latestRun = latestByFlow[flow.id] ?? null;
    if (!latestRun) {
      const result = { flowId: flow.id, status: "missing", message: `No hay una ejecución de «${flow.name}» para reportar.` };
      notify("Mia · Noticias", result.message);
      console.error(`[newsroom-report] ${result.message}`);
      return result;
    }
    const result = {
      flowId: flow.id,
      flowName: flow.name,
      day: latestRun.day,
      status: latestRun.status,
      templateId: latestRun.templateId ?? null,
      created: latestRun.articles?.map(({ title, summary, source, sourceUrl, frameId, formats, videoUrl, media, kind, author, sharedBy }) => ({ title, summary: summary ?? "", source, sourceUrl, frameId, formats: formats ?? [{ format: "post", frameId }], videoUrl: videoUrl ?? null, media: media ?? [], kind: kind ?? "article", author: author ?? null, sharedBy: sharedBy ?? null })) ?? [],
      errors: latestRun.errors ?? [],
      questions: latestRun.questions ?? [],
    };
    const issueSummary = [
      result.errors.length ? `${result.errors.length} errores` : "sin errores",
      result.questions.length ? `${result.questions.length} dudas` : "sin dudas",
    ].join(" · ");
    const designCount = result.created.reduce((total, article) => total + article.formats.length, 0);
    const message = `${result.created.length} noticias · ${designCount} diseños creados · ${issueSummary}`;
    const titleList = result.created
      .map((item, index) => `${index + 1}. ${trimText(item.title, 54)}`)
      .join(" · ");
    notify(`Mia · ${flow.name}`, titleList ? `${message}\n${titleList}` : message);
    console.log(`[newsroom-report] ${flow.id}: ${message}; template=${result.templateId ?? "none"}`);
    return result;
  }

  return { build, report, snapshot };
}
