/**
 * Job de importación de HTML: lo que une htmlImport.ts con Supabase y la red.
 *
 * El estado vive en design_import_jobs.result mientras se copian los archivos
 * ("analyzing" = esperando la siguiente tanda, "converting" = una tanda en curso).
 * Al terminar, result pasa a ser el documento canónico (futuraria-import/v1) y,
 * si se pidió un diseño destino, se confirma solo.
 */
import crypto from "node:crypto";
import { assertSafeIntegrationEndpoint } from "./workspaceIntegrations.js";
import { fetchRemoteImage } from "./remoteImage.js";
import { getTemplate } from "./templates.js";
import { SYSTEM_FONTS } from "../data/systemFonts.js";
import { finalizeHtmlImport, htmlImportSummary, prepareHtmlImport, runHtmlAssetBatch, type HtmlImportIO, type HtmlImportOptions, type HtmlImportSource, type HtmlImportState } from "./htmlImport.ts";
import { mainHtmlPath, openZip, type ZipIndex } from "./zipReader.ts";
import { renderImportArtboard, type DesignImportDocument } from "../../../shared/designImport.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dbUserId = (u: string) => (UUID_RE.test(u) ? u : null);
/** Llamadas externas por pedido, con margen bajo el tope de 50 del plan gratis. */
const BUDGET = 40;
const STALE_MS = 2 * 60 * 1000;

export const isHtmlBatchState = (v: any): v is HtmlImportState => Boolean(v && v.version === "futuraria-html-batch/v1" && Array.isArray(v.frames) && Array.isArray(v.assets));

/** fetch que valida cada salto (nada de IPs privadas) y corta por tamaño. */
async function safeFetch(rawUrl: string, opts: { accept: string; maxBytes: number; types: RegExp; counter: { n: number } }) {
  let target = rawUrl;
  for (let hop = 0; hop <= 4; hop++) {
    await assertSafeIntegrationEndpoint(target); opts.counter.n++;
    const res = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: opts.accept, "user-agent": "Mozilla/5.0 (compatible; MusaImport/1.0; +https://musa.futuraria.com)" } });
    opts.counter.n++;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location"); if (!loc) throw new Error(`redirección sin destino (${res.status})`);
      target = new URL(loc, target).toString(); continue;
    }
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type && !opts.types.test(type)) throw new Error(`devolvió ${type}, no lo esperado`);
    if (Number(res.headers.get("content-length") || 0) > opts.maxBytes) throw new Error(`pesa más de ${Math.round(opts.maxBytes / 1048576)} MB`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > opts.maxBytes) throw new Error(`pesa más de ${Math.round(opts.maxBytes / 1048576)} MB`);
    return { bytes: buf, url: target, type };
  }
  throw new Error("demasiadas redirecciones");
}

export function makeIO(counter: { n: number }): HtmlImportIO {
  return {
    async fetchText(url, kind) {
      const r = await safeFetch(url, kind === "css"
        ? { accept: "text/css,*/*;q=0.1", maxBytes: 1024 * 1024, types: /^(text\/css|text\/plain|application\/octet-stream)$/, counter }
        : { accept: "text/html,application/xhtml+xml", maxBytes: 3 * 1024 * 1024, types: /^(text\/html|application\/xhtml\+xml|text\/plain)$/, counter });
      return { text: new TextDecoder("utf-8").decode(r.bytes), url: r.url };
    },
    async googleFont(family, weights, italic) {
      const fam = encodeURIComponent(family.trim()).replace(/%20/g, "+");
      const tries: string[] = [];
      const ws = weights.length ? weights : [400];
      if (ws.length > 1 || ws[0] !== 400 || italic) {
        tries.push(italic ? `:ital,wght@${[...ws.map((w) => `0,${w}`), ...ws.map((w) => `1,${w}`)].join(";")}` : `:wght@${ws.join(";")}`);
      }
      tries.push("");
      for (const axis of tries.slice(0, 2)) {
        const href = `https://fonts.googleapis.com/css2?family=${fam}${axis}&display=swap`;
        counter.n++;
        const r = await fetch(href, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (r?.ok) return href;
        if (r && r.status !== 400) return null;
      }
      return null;
    },
  };
}

export interface StartHtmlImport {
  workspaceId: string;
  userId: string;
  source: HtmlImportSource;
  html?: string;
  url?: string;
  zip?: Uint8Array;
  /** Ruta del ZIP ya guardado en design-imports (subida firmada). */
  zipPath?: string;
  name?: string;
  options: HtmlImportOptions;
  templateId?: string;
  brandId?: string;
  idempotencyKey?: string;
  /** Job ya creado por /uploads (ZIP subido). */
  jobId?: string;
}

async function knownFonts(sb: any, userId: string) {
  const uid = dbUserId(userId);
  if (!uid) return [];
  const { data } = await sb.from("custom_fonts").select("family_name").eq("user_id", uid).limit(500);
  return (data || []).map((r: any) => String(r.family_name));
}

async function loadZip(sb: any, path: string): Promise<ZipIndex> {
  const dl = await sb.storage.from("design-imports").download(path);
  if (dl.error || !dl.data) throw new Error("No se encontró el ZIP subido. Vuelve a subirlo.");
  return openZip(new Uint8Array(await dl.data.arrayBuffer()));
}

/** Crea (o retoma) el job, prepara el diseño y copia la primera tanda de archivos. */
export async function startHtmlImport(sb: any, req: StartHtmlImport) {
  const counter = { n: 3 };
  const io = makeIO(counter);
  const key = (req.idempotencyKey || crypto.randomUUID()).slice(0, 160);
  let jobId = req.jobId;
  if (!jobId) {
    const prev = await sb.from("design_import_jobs").select("id,status,progress,result,warnings,error,template_id,committed_frame_ids").eq("workspace_id", req.workspaceId).eq("idempotency_key", key).maybeSingle();
    if (prev.data && prev.data.status !== "error") return publicJob(prev.data);
    if (prev.data) jobId = prev.data.id;
  }
  const sourceName = (req.name || (req.source === "url" ? req.url : req.source === "zip" ? "diseño.zip" : "HTML pegado") || "HTML").slice(0, 200);
  if (!jobId) {
    jobId = crypto.randomUUID();
    const created = await sb.from("design_import_jobs").insert({ id: jobId, workspace_id: req.workspaceId, created_by: dbUserId(req.userId), idempotency_key: key, source_type: req.source, source_name: sourceName, status: "converting", progress: 5 });
    if (created.error?.code === "23505") {
      const again = await sb.from("design_import_jobs").select("id,status,progress,result,warnings,error,template_id,committed_frame_ids").eq("workspace_id", req.workspaceId).eq("idempotency_key", key).maybeSingle();
      return publicJob(again.data);
    }
    if (created.error) throw created.error;
  } else {
    await sb.from("design_import_jobs").update({ status: "converting", progress: 5, error: null }).eq("id", jobId).eq("workspace_id", req.workspaceId);
  }
  try {
    let html = req.html || "", baseUrl: string | undefined, zip: ZipIndex | undefined, htmlPath: string | undefined, zipPath = req.zipPath;
    if (req.source === "url") {
      if (!req.url || !/^https?:\/\//i.test(req.url)) throw new Error("La URL debe empezar con https://");
      const page = await io.fetchText(req.url.replace(/^http:/i, "https:"), "html");
      html = page.text; baseUrl = page.url;
    } else if (req.source === "zip") {
      if (req.zip) {
        zip = openZip(req.zip);
        zipPath = `${req.workspaceId}/${jobId}/${(req.name || "diseno.zip").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
        const up = await sb.storage.from("design-imports").upload(zipPath, req.zip, { contentType: "application/zip", upsert: true });
        if (up.error) throw new Error("No se pudo guardar el ZIP: " + up.error.message);
        counter.n++;
      } else if (zipPath) { zip = await loadZip(sb, zipPath); counter.n++; }
      else throw new Error("Falta el ZIP");
      htmlPath = mainHtmlPath(zip);
      if (!htmlPath) throw new Error("El ZIP no trae ningún archivo .html (pon un index.html en la raíz).");
      html = await zip.text(htmlPath);
    }
    const fonts = await knownFonts(sb, req.userId); counter.n++;
    const state = await prepareHtmlImport({ html, source: req.source, baseUrl, zip, htmlPath }, { ...req.options, name: req.name || req.options.name, knownFonts: fonts, systemFonts: SYSTEM_FONTS.map((f) => f.family) }, io);
    state.zipPath = zipPath; state.templateId = req.templateId; state.brandId = req.brandId;
    // Lo que ya se gastó (sesión, permisos, job, hojas, fuentes) + lo que falta (guardar, confirmar el diseño).
    return await advance(sb, jobId, req.workspaceId, req.userId, state, zip, Math.max(4, BUDGET - counter.n - 12));
  } catch (e: any) {
    const message = String(e?.message || e || "No se pudo importar el HTML").slice(0, 500);
    await sb.from("design_import_jobs").update({ status: "error", progress: 100, error: message }).eq("id", jobId).eq("workspace_id", req.workspaceId);
    const err: any = new Error(message); err.jobId = jobId; throw err;
  }
}

/** Siguiente tanda de un job que quedó a medias (la llama el navegador o el MCP). */
export async function continueHtmlImport(sb: any, jobId: string, workspaceId: string, userId: string) {
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const claimed = await sb.from("design_import_jobs").update({ status: "converting" }).eq("id", jobId).eq("workspace_id", workspaceId)
    .or(`status.eq.analyzing,and(status.eq.converting,updated_at.lt.${stale})`).select("id,result").maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) {
    const cur = await sb.from("design_import_jobs").select("id,status,progress,result,warnings,error,template_id,committed_frame_ids").eq("id", jobId).eq("workspace_id", workspaceId).maybeSingle();
    if (!cur.data) { const e: any = new Error("Importación no encontrada"); e.status = 404; throw e; }
    return publicJob(cur.data);
  }
  const state = claimed.data.result;
  if (!isHtmlBatchState(state)) {
    await sb.from("design_import_jobs").update({ status: "error", error: "Estado de importación inválido" }).eq("id", jobId);
    throw new Error("Estado de importación inválido");
  }
  try {
    const needsZip = state.zipPath && state.assets.some((a) => a.status === "pending" && a.kind === "zip");
    const zip = needsZip ? await loadZip(sb, state.zipPath!) : undefined;
    return await advance(sb, jobId, workspaceId, userId, state, zip, BUDGET - 12);
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 500);
    await sb.from("design_import_jobs").update({ status: "analyzing", error: message }).eq("id", jobId).eq("workspace_id", workspaceId);
    throw e;
  }
}

async function advance(sb: any, jobId: string, workspaceId: string, userId: string, state: HtmlImportState, zip: ZipIndex | undefined, budget: number) {
  const counter = { n: 0 };
  const short = jobId.replace(/-/g, "").slice(0, 10);
  const pending = await runHtmlAssetBatch(state, {
    readZip: async (path) => { if (!zip) throw new Error("el ZIP ya no está disponible"); return zip.read(path); },
    fetchRemote: async (url, font) => {
      if (!font) { const img = await fetchRemoteImage(url); return new Uint8Array(img.buffer); }
      const r = await safeFetch(url, { accept: "font/*,application/octet-stream,*/*;q=0.5", maxBytes: 5 * 1024 * 1024, types: /^(font\/|application\/(font|x-font|octet-stream|vnd\.ms-fontobject)|binary\/octet-stream)/, counter });
      return r.bytes;
    },
    persist: async (items) => {
      const paths: string[] = [];
      const ok: typeof items = [];
      for (const it of items) {
        const filename = `import_${short}_${it.asset.id}.${it.ext}`;
        const path = `${workspaceId}/${filename}`;
        const up = await sb.storage.from("design-assets").upload(path, it.bytes, { contentType: it.mime, upsert: true });
        if (up.error) {
          if (/too many subrequests/i.test(up.error.message)) break; // sigue pendiente para la próxima tanda
          it.asset.status = "failed"; it.asset.error = up.error.message.slice(0, 200); continue;
        }
        paths.push(path); ok.push(it);
      }
      if (!paths.length) return {};
      const signed = await sb.storage.from("design-assets").createSignedUrls(paths, 31_536_000);
      if (signed.error) throw signed.error;
      const urls: Record<number, string> = {};
      (signed.data || []).forEach((s: any, i: number) => { if (s?.signedUrl) urls[ok[i].asset.id] = s.signedUrl; });
      const rows = ok.filter((it) => !it.mime.startsWith("font/") && urls[it.asset.id]).map((it) => ({
        id: `asset_html_${short}_${it.asset.id}`, workspace_id: workspaceId, name: `${state.name} · ${it.asset.label.split("/").pop()?.slice(0, 60) || "imagen"}`,
        filename: `import_${short}_${it.asset.id}.${it.ext}`, mime_type: it.mime, size_bytes: it.bytes.length, url: urls[it.asset.id], tags: ["design-import", "html"],
      }));
      if (rows.length) { const ins = await sb.from("assets").upsert(rows); if (ins.error) console.warn("[html-import] assets", ins.error.message); }
      return urls;
    },
  }, budget);

  const total = state.assets.length || 1;
  if (pending) {
    const progress = Math.min(95, Math.round(10 + (1 - pending / total) * 85));
    const saved = await sb.from("design_import_jobs").update({ status: "analyzing", progress, result: state, warnings: state.warnings, error: null }).eq("id", jobId).eq("workspace_id", workspaceId);
    if (saved.error) throw saved.error;
    return { id: jobId, status: "analyzing", progress, pending, done: false, result: htmlImportSummary(state) };
  }

  const document = finalizeHtmlImport(state);
  if (JSON.stringify(document).length > 8_000_000) throw new Error("El diseño importado supera 8 MB. Sepáralo en menos frames o usa imágenes más livianas.");
  if (/data:image\//i.test(JSON.stringify(document))) throw new Error("Quedaron imágenes sin copiar a Musa.");
  const status = document.warnings.length ? "partial" : "ready";
  const saved = await sb.from("design_import_jobs").update({ status, progress: 100, result: document, warnings: document.warnings, error: null }).eq("id", jobId).eq("workspace_id", workspaceId);
  if (saved.error) throw saved.error;
  if (state.brandId) await registerBrandFonts(sb, workspaceId, state.brandId, state).catch((e) => console.warn("[html-import] fuentes de marca", e?.message));
  const out: any = { id: jobId, status, progress: 100, done: true, result: document, warnings: document.warnings, summary: htmlImportSummary(state) };
  if (state.templateId) out.commit = await commitImportJob(sb, jobId, workspaceId, state.templateId);
  return out;
}

/** Suma a la marca las fuentes que el diseño usa (Google o alojadas), sin repetir. */
async function registerBrandFonts(sb: any, workspaceId: string, brandId: string, state: HtmlImportState) {
  const wanted = [...state.fonts.google.map((f) => ({ family: f, source: "google" })), ...state.fonts.hosted.map((f) => ({ family: f, source: "import" }))];
  if (!wanted.length) return;
  const { data: brand } = await sb.from("brands").select("id,fonts").eq("id", brandId).eq("workspace_id", workspaceId).maybeSingle();
  if (!brand) return;
  const cur = Array.isArray(brand.fonts) ? brand.fonts : [];
  const have = new Set(cur.map((x: any) => String(typeof x === "string" ? x : x?.family || x?.name || "").toLowerCase()));
  const add = wanted.filter((w) => !have.has(w.family.toLowerCase()));
  if (add.length) await sb.from("brands").update({ fonts: [...cur, ...add], updated_at: new Date().toISOString() }).eq("id", brandId).eq("workspace_id", workspaceId);
}

/** Lo que se devuelve de un job (sin los datos pesados del estado intermedio). */
export function publicJob(row: any) {
  if (!row) return row;
  const r = { ...row };
  if (isHtmlBatchState(r.result)) r.result = htmlImportSummary(r.result);
  r.done = ["ready", "partial", "committed"].includes(r.status);
  return r;
}

/** Agrega los frames de un job listo a un diseño. Idempotente. */
export async function commitImportJob(sb: any, jobId: string, workspaceId: string, templateId: string) {
  const { data: job, error } = await sb.from("design_import_jobs").select("id,workspace_id,status,result,template_id,committed_frame_ids,source_type").eq("id", jobId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw error;
  if (!job) { const e: any = new Error("Importación no encontrada"); e.status = 404; throw e; }
  if (job.status === "committed") {
    if (job.template_id !== templateId) { const e: any = new Error("Esta importación ya fue confirmada en otro diseño."); e.status = 409; throw e; }
    return { id: job.id, status: "committed", templateId, frameIds: job.committed_frame_ids || [] };
  }
  if (!["ready", "partial", "committing"].includes(job.status)) { const e: any = new Error(`La importación no está lista (${job.status}).`); e.status = 409; throw e; }
  const doc = job.result as DesignImportDocument;
  if (!doc || doc.version !== "futuraria-import/v1" || !doc.artboards?.length) throw new Error("El resultado de importación no es válido.");
  const template = await getTemplate(templateId);
  if (!template || template.workspaceId !== workspaceId) { const e: any = new Error("Template not found"); e.status = 404; throw e; }
  const existing = template.frames || [];
  const frameIds = doc.artboards.map((_: unknown, i: number) => `frame_import_${job.id}_${i}`);
  // Los frames nuevos van a la derecha de los que ya hay, uno al lado del otro.
  let x = existing.reduce((m: number, f: any) => Math.max(m, (+f.x || 0) + (+f.width || 0)), 0) + (existing.length ? 160 : 100);
  const additions = doc.artboards.map((ab, i) => {
    const r = renderImportArtboard(ab);
    const side = Boolean(ab.raw);
    const frame = { id: frameIds[i], templateId, name: r.name, x: side ? x : 100 + (existing.length + i) * 40, y: side ? 100 : 100 + (existing.length + i) * 40, width: r.width, height: r.height, fill: ab.background || "#ffffff", background: ab.background || "#ffffff", order: existing.length + i, objects: [], layoutMode: "NONE" as const, clipsContent: true, constraints: {}, padding: { top: 0, right: 0, bottom: 0, left: 0 }, html: r.html, css: r.css };
    x += r.width + 120;
    return frame;
  });
  const done = await sb.rpc("commit_design_import", { target_job: job.id, target_workspace: workspaceId, target_template: templateId, imported_frames: additions });
  if (done.error) throw done.error;
  return done.data;
}
