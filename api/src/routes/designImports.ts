import crypto from "node:crypto";
import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabase, getSupabaseAdmin } from "../services/supabase.js";
import { uploadAsset } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import { decryptWorkspaceSecret, encryptWorkspaceSecret } from "../services/secrets.js";
import { importFigmaUrl, testFigmaToken } from "../services/designImports.js";
import { convertDesignUpload } from "../services/designUploadConversion.js";
import { getTemplate } from "../services/templates.js";
import { importSvgDocument, renderImportArtboard, type DesignImportDocument } from "../../../shared/designImport.ts";

export const designImportRoutes = Router();
const FIGMA_ENDPOINT = "https://api.figma.com/v1";

async function access(req: any, workspaceId: string, role: "viewer" | "editor" | "admin") {
  return Boolean(workspaceId && req.auth && await canAccessWorkspace(req.auth, workspaceId, role));
}

async function figmaConnection(sb: any, workspaceId: string) {
  const { data, error } = await sb.from("workspace_mcp_connections")
    .select("id, workspace_id, provider, enabled, public_config, credentials_encrypted")
    .eq("workspace_id", workspaceId).eq("provider", "figma").maybeSingle();
  if (error) throw error;
  return data;
}

async function cleanExpiredOriginals(sb: any, workspaceId: string) {
  const expired = await sb.from("design_import_jobs").select("id,source_path").eq("workspace_id", workspaceId)
    .lt("expires_at", new Date().toISOString()).not("source_path", "is", null)
    .in("status", ["uploaded", "ready", "partial", "committed", "error"]).limit(5);
  if (expired.error) throw expired.error;
  for (const job of expired.data || []) {
    if (!job.source_path.startsWith(`${workspaceId}/${job.id}/`)) continue;
    const removed = await sb.storage.from("design-imports").remove([job.source_path]);
    if (removed.error) throw removed.error;
    const updated = await sb.from("design_import_jobs").update({ source_path: null }).eq("id", job.id).eq("workspace_id", workspaceId);
    if (updated.error) throw updated.error;
  }
}

async function figmaToken(sb: any, workspaceId: string) {
  const row = await figmaConnection(sb, workspaceId);
  if (!row?.enabled || !row.credentials_encrypted) throw new Error("Conecta Figma en Configuración antes de importar el enlace.");
  const secret = decryptWorkspaceSecret<{ apiToken: string }>(row.credentials_encrypted);
  if (!secret.apiToken) throw new Error("La conexión de Figma no tiene token.");
  return secret.apiToken;
}

function assertImportDocument(value: unknown): asserts value is DesignImportDocument {
  const document = value as DesignImportDocument;
  if (!document || document.version !== "futuraria-import/v1" || !Array.isArray(document.artboards) || !document.artboards.length) {
    throw new Error("El resultado de importación no es un documento Futuraria válido.");
  }
  if (JSON.stringify(document).length > 8_000_000) throw new Error("El resultado convertido supera el límite de 8 MB.");
  for (const artboard of document.artboards) {
    if (!Number.isFinite(artboard.width) || !Number.isFinite(artboard.height) || artboard.width < 1 || artboard.height < 1 || artboard.width > 16_384 || artboard.height > 16_384) {
      throw new Error("Una mesa de trabajo tiene dimensiones inválidas.");
    }
  }
  if (/data:image\//i.test(JSON.stringify(document))) throw new Error("Guarda las imágenes en Assets antes de confirmar la importación.");
}

async function persistDocumentAssets(sb: any, document: DesignImportDocument, workspaceId: string) {
  const pattern = /data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g;
  for (const artboard of document.artboards) {
    for (const layer of artboard.layers) {
      const visit = async (current: typeof layer): Promise<void> => {
        const matches = [...current.html.matchAll(pattern)];
        for (const [full, mimeType, encoded] of matches) {
          const bytes = Buffer.from(encoded, "base64");
          if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Una capa de Figma supera el límite de 5 MB; expórtala optimizada o como SVG sin bitmap embebido.");
          const assetId = `asset_import_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
          const ext = mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1].replace("jpeg", "jpg");
          const filename = `${assetId}.${ext}`;
          const url = await uploadAsset(filename, bytes, mimeType, workspaceId);
          const saved = await sb.from("assets").upsert({ id: assetId, workspace_id: workspaceId, name: `${document.name} · ${current.name}`, filename, mime_type: mimeType, size_bytes: bytes.length, url, tags: ["design-import", "figma"] });
          if (saved.error) throw saved.error;
          current.html = current.html.split(full).join(url);
        }
        for (const child of current.children || []) await visit(child);
      };
      await visit(layer);
    }
  }
  return document;
}

designImportRoutes.get("/integrations/figma", asyncRoute(async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "");
  if (!await access(req, workspaceId, "viewer")) return res.status(403).json({ success: false, error: "Workspace access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const row = await figmaConnection(sb, workspaceId);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: { connected: Boolean(row?.enabled && row?.credentials_encrypted), account: row?.public_config?.account || null } });
}));

designImportRoutes.put("/integrations/figma", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  if (!await access(req, workspaceId, "admin")) return res.status(403).json({ success: false, error: "Admin access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const existing = await figmaConnection(sb, workspaceId);
  const entered = String(req.body?.apiToken || "").trim();
  const apiToken = entered || (existing?.credentials_encrypted ? decryptWorkspaceSecret<{ apiToken: string }>(existing.credentials_encrypted).apiToken : "");
  if (!apiToken) return res.status(400).json({ success: false, error: "Ingresa un token personal de Figma." });
  let account;
  try { account = await testFigmaToken(apiToken); }
  catch (error) { return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Token inválido" }); }
  const record = { workspace_id: workspaceId, name: "Figma", kind: "model_api", provider: "figma", endpoint_url: FIGMA_ENDPOINT, enabled: true, public_config: { account, scopes: ["current_user:read", "file_content:read"] }, credentials_encrypted: encryptWorkspaceSecret({ apiToken }), updated_at: new Date().toISOString() };
  const result = existing
    ? await sb.from("workspace_mcp_connections").update(record).eq("id", existing.id).eq("workspace_id", workspaceId).select("id").single()
    : await sb.from("workspace_mcp_connections").insert({ ...record, created_by: req.auth!.userId }).select("id").single();
  if (result.error) throw result.error;
  res.json({ success: true, data: { id: result.data.id, connected: true, account } });
}));

designImportRoutes.delete("/integrations/figma", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  if (!await access(req, workspaceId, "admin")) return res.status(403).json({ success: false, error: "Admin access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const { error } = await sb.from("workspace_mcp_connections").update({ enabled: false, credentials_encrypted: null, public_config: {}, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("provider", "figma");
  if (error) throw error;
  res.json({ success: true });
}));

designImportRoutes.post("/figma", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  const url = String(req.body?.url || "").trim();
  if (!await access(req, workspaceId, "editor")) return res.status(403).json({ success: false, error: "Editor access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const token = await figmaToken(sb, workspaceId);
  const idempotencyKey = String(req.body?.idempotencyKey || crypto.randomUUID()).trim().slice(0, 160);
  if (!idempotencyKey) return res.status(400).json({ success: false, error: "idempotencyKey inválido" });
  const previous = await sb.from("design_import_jobs").select("id,status,result,warnings,error").eq("workspace_id", workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (previous.data?.result && ["ready", "partial", "committed"].includes(previous.data.status)) return res.json({ success: true, data: previous.data });
  if (previous.data && ["analyzing", "converting", "committing"].includes(previous.data.status)) return res.status(202).json({ success: true, data: previous.data });

  let job: any = null;
  if (previous.data?.status === "error") {
    const claimed = await sb.from("design_import_jobs").update({ status: "analyzing", progress: 15, error: null })
      .eq("id", previous.data.id).eq("workspace_id", workspaceId).eq("status", "error").select("id").maybeSingle();
    job = claimed.data;
  } else {
    const created = await sb.from("design_import_jobs").insert({ workspace_id: workspaceId, created_by: req.auth!.userId, idempotency_key: idempotencyKey, source_type: "figma", source_name: url, status: "analyzing", progress: 15 }).select("id").maybeSingle();
    if (created.error?.code === "23505") {
      const concurrent = await sb.from("design_import_jobs").select("id,status,progress,result,warnings,error").eq("workspace_id", workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle();
      return res.status(concurrent.data?.result ? 200 : 202).json({ success: true, data: concurrent.data });
    }
    if (created.error) throw created.error;
    job = created.data;
  }
  if (!job?.id) return res.status(409).json({ success: false, error: "La importación ya está siendo procesada." });
  try {
    const document = await persistDocumentAssets(sb, await importFigmaUrl(url, token), workspaceId);
    const status = document.warnings.length ? "partial" : "ready";
    const { error } = await sb.from("design_import_jobs").update({ status, progress: 100, result: document, warnings: document.warnings, error: null }).eq("id", job.id).eq("workspace_id", workspaceId).eq("status", "analyzing");
    if (error) throw error;
    res.json({ success: true, data: { id: job.id, status, progress: 100, result: document, warnings: document.warnings } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo importar Figma.";
    await sb.from("design_import_jobs").update({ status: "error", progress: 100, error: message }).eq("id", job.id).eq("workspace_id", workspaceId);
    res.status(400).json({ success: false, error: message, jobId: job.id });
  }
}));

designImportRoutes.post("/svg", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  if (!await access(req, workspaceId, "editor")) return res.status(403).json({ success: false, error: "Editor access is required" });
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const document = await persistDocumentAssets(sb, importSvgDocument(String(req.body?.content || ""), String(req.body?.name || "SVG")), workspaceId);
  assertImportDocument(document);
  const saved = await sb.from("design_import_jobs").insert({ workspace_id: workspaceId, created_by: req.auth!.userId, idempotency_key: crypto.randomUUID(), source_type: "svg", source_name: document.name, status: "partial", progress: 100, result: document, warnings: document.warnings }).select("id,status,result,warnings").single();
  if (saved.error) throw saved.error;
  res.json({ success: true, data: saved.data });
}));

designImportRoutes.post("/uploads", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  const size = Number(req.body?.size || 0);
  const name = String(req.body?.name || "design.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const sourceType = String(req.body?.sourceType || "");
  if (!await access(req, workspaceId, "editor")) return res.status(403).json({ success: false, error: "Editor access is required" });
  if (!["svg", "psd", "ai", "pdf", "image"].includes(sourceType) || !Number.isInteger(size) || size < 1 || size > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: "Tipo o tamaño de archivo inválido (máximo 50 MB). Para .fig usa el enlace de Figma." });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const idempotencyKey = String(req.body?.idempotencyKey || crypto.randomUUID());
  await cleanExpiredOriginals(sb, workspaceId);
  const id = crypto.randomUUID();
  const path = `${workspaceId}/${id}/${name}`;
  const { error } = await sb.from("design_import_jobs").insert({ id, workspace_id: workspaceId, created_by: req.auth!.userId, idempotency_key: idempotencyKey, source_type: sourceType, source_name: name, source_path: path, status: "uploaded", progress: 0 });
  if (error) throw error;
  const { data: upload, error: uploadError } = await sb.storage.from("design-imports").createSignedUploadUrl(path);
  if (uploadError) throw uploadError;
  res.status(201).json({ success: true, data: { id, path, token: upload.token, signedUrl: upload.signedUrl, expiresIn: 7200 } });
}));

designImportRoutes.post("/jobs/:id/convert", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  if (!await access(req, workspaceId, "editor")) return res.status(403).json({ success: false, error: "Editor access is required" });
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const claimed = await sb.from("design_import_jobs").update({ status: "converting", error: null, progress: 10 }).eq("id", req.params.id).eq("workspace_id", workspaceId).in("status", ["uploaded", "error"]).neq("source_type", "figma").select("id,source_path,source_type,source_name,expires_at").maybeSingle();
  if (claimed.error) throw claimed.error;
  const job = claimed.data;
  if (!job) return res.status(409).json({ success: false, error: "El archivo no está listo para convertir o ya se está procesando." });
  try {
    if (!job.source_path?.startsWith(`${workspaceId}/${job.id}/`) || new Date(job.expires_at).getTime() <= Date.now()) throw new Error("El original expiró. Vuelve a subirlo.");
    const original = await sb.storage.from("design-imports").download(job.source_path);
    if (original.error) throw new Error("No se encontró el archivo subido. Completa la subida antes de convertir.");
    const document = await persistDocumentAssets(sb, await convertDesignUpload(Buffer.from(await original.data.arrayBuffer()), job.source_type, job.source_name), workspaceId);
    assertImportDocument(document);
    const status = document.warnings.length ? "partial" : "ready";
    const saved = await sb.from("design_import_jobs").update({ status, progress: 100, result: document, warnings: document.warnings }).eq("id", job.id).eq("workspace_id", workspaceId).eq("status", "converting");
    if (saved.error) throw saved.error;
    res.json({ success: true, data: { id: job.id, status, result: document, warnings: document.warnings } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo convertir el archivo.";
    await sb.from("design_import_jobs").update({ status: "error", error: message }).eq("id", job.id).eq("workspace_id", workspaceId);
    res.status(400).json({ success: false, error: message, jobId: job.id });
  }
}));

designImportRoutes.get("/jobs/:id", asyncRoute(async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "");
  if (!await access(req, workspaceId, "viewer")) return res.status(403).json({ success: false, error: "Workspace access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const { data, error } = await sb.from("design_import_jobs").select("id,source_type,source_name,status,progress,result,warnings,error,template_id,created_at,expires_at").eq("id", req.params.id).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, error: "Importación no encontrada" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data });
}));

designImportRoutes.post("/jobs/:id/retry", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  if (!await access(req, workspaceId, "editor")) return res.status(403).json({ success: false, error: "Editor access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const claimed = await sb.from("design_import_jobs").update({ status: "analyzing", progress: 15, error: null })
    .eq("id", req.params.id).eq("workspace_id", workspaceId).or(`status.eq.error,and(status.eq.analyzing,updated_at.lt.${new Date(Date.now() - 300_000).toISOString()})`)
    .eq("source_type", "figma").select("id,source_name").maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return res.status(409).json({ success: false, error: "Reintenta un job de Figma fallido o sin actividad durante cinco minutos." });
  try {
    const token = await figmaToken(sb, workspaceId);
    const document = await persistDocumentAssets(sb, await importFigmaUrl(claimed.data.source_name, token), workspaceId);
    const status = document.warnings.length ? "partial" : "ready";
    const saved = await sb.from("design_import_jobs").update({ status, progress: 100, result: document, warnings: document.warnings, error: null })
      .eq("id", claimed.data.id).eq("workspace_id", workspaceId).eq("status", "analyzing");
    if (saved.error) throw saved.error;
    res.json({ success: true, data: { id: claimed.data.id, status, progress: 100, result: document, warnings: document.warnings } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo reintentar la importación.";
    await sb.from("design_import_jobs").update({ status: "error", progress: 100, error: message }).eq("id", claimed.data.id).eq("workspace_id", workspaceId);
    res.status(400).json({ success: false, error: message, jobId: claimed.data.id });
  }
}));

designImportRoutes.post("/jobs/:id/commit", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "");
  const templateId = String(req.body?.templateId || "");
  if (!await access(req, workspaceId, "editor")) return res.status(403).json({ success: false, error: "Editor access is required" });
  if (!templateId) return res.status(400).json({ success: false, error: "templateId is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const { data: job, error: jobError } = await sb.from("design_import_jobs")
    .select("id,workspace_id,status,result,template_id,committed_frame_ids")
    .eq("id", req.params.id).eq("workspace_id", workspaceId).maybeSingle();
  if (jobError) throw jobError;
  if (!job) return res.status(404).json({ success: false, error: "Importación no encontrada" });
  if (job.status === "committed") {
    if (job.template_id !== templateId) return res.status(409).json({ success: false, error: "Esta importación ya fue confirmada en otro diseño." });
    return res.json({ success: true, data: { id: job.id, status: "committed", templateId, frameIds: job.committed_frame_ids || [] } });
  }
  if (!["ready", "partial", "committing"].includes(job.status)) return res.status(409).json({ success: false, error: `La importación no está lista (${job.status}).` });
  if (job.template_id && job.template_id !== templateId) return res.status(409).json({ success: false, error: "Esta importación ya se está confirmando en otro diseño." });
  assertImportDocument(job.result);

  const template = await getTemplate(templateId);
  if (!template || template.workspaceId !== workspaceId) return res.status(404).json({ success: false, error: "Template not found" });
  const existing = template.frames || [];
  const frameIds = job.result.artboards.map((_: unknown, index: number) => `frame_import_${job.id}_${index}`);
  const additions = job.result.artboards.flatMap((artboard, index) => {
    const rendered = renderImportArtboard(artboard);
    return [{ id: frameIds[index], templateId, name: rendered.name, x: 100 + (existing.length + index) * 40, y: 100 + (existing.length + index) * 40, width: rendered.width, height: rendered.height, fill: artboard.background || "#ffffff", order: existing.length + index, objects: [], layoutMode: "NONE" as const, clipsContent: true, constraints: {}, padding: { top: 0, right: 0, bottom: 0, left: 0 }, html: rendered.html, css: rendered.css }];
  });
  const completed = await sb.rpc("commit_design_import", {
    target_job: job.id, target_workspace: workspaceId, target_template: templateId, imported_frames: additions,
  });
  if (completed.error) throw completed.error;
  res.json({ success: true, data: completed.data });
}));
