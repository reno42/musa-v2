import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../services/supabase.js";

export const customFontRoutes = Router();

/** Private-write bucket; each object is addressed by its unguessable public URL. */
const BUCKET = "custom-fonts";
const MAX_FONT_BYTES = 2 * 1024 * 1024;

const FONT_MIME = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
} as const;
type FontExtension = keyof typeof FONT_MIME;

/**
 * Plan limits — the first real quota read off access_plan (the NDA wall
 * writes it once and locks it, which makes it a stable billing signal).
 */
const PLAN_FONT_LIMITS = {
  corporate: { maxCount: 50, maxBytes: 100 * 1024 * 1024 },
  default: { maxCount: 10, maxBytes: 20 * 1024 * 1024 },
} as const;
const limitsFor = (plan: string | null | undefined) =>
  plan === "corporate" ? PLAN_FONT_LIMITS.corporate : PLAN_FONT_LIMITS.default;

const publicUrl = (path: string) =>
  `${process.env.SUPABASE_URL || ""}/storage/v1/object/public/${BUCKET}/${path}`;

/**
 * Magic bytes beat the extension: a renamed anything must not become a font.
 * TTF starts 00 01 00 00; OTTO / wOFF / wOF2 name themselves. The extension
 * is only the fallback for variable-font containers that carry no signature.
 */
function sniffFormat(buffer: Buffer, fileName: string): FontExtension | null {
  if (buffer.length > 3 && buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) return "ttf";
  const tag = buffer.length > 3 ? buffer.toString("ascii", 0, 4) : "";
  if (tag === "OTTO") return "otf";
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  return ext in FONT_MIME ? (ext as FontExtension) : null;
}

/** "MiFuente-Bold_final.ttf" → "MiFuente Bold final" — what the picker shows. */
function familyNameFrom(fileName: string): string {
  const cleaned = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9À-ÿ ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return cleaned || "Fuente personalizada";
}

interface CustomFontRow {
  id: string;
  family_name: string;
  file_name: string;
  format: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

const toApi = (row: CustomFontRow) => ({
  id: row.id,
  familyName: row.family_name,
  fileName: row.file_name,
  format: row.format,
  sizeBytes: Number(row.size_bytes) || 0,
  publicUrl: publicUrl(row.storage_path),
  createdAt: row.created_at,
});

/**
 * GET /api/fonts/custom — the caller's own fonts, newest first.
 * User-scoped by construction: the filter is the authenticated id, never a
 * client-supplied one, so one account can never list another's faces.
 */
customFontRoutes.get("/", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.json({ success: true, data: { fonts: [] } });
    const { data, error } = await sb.from("custom_fonts")
      .select("id, family_name, file_name, format, size_bytes, storage_path, created_at")
      .eq("user_id", req.auth!.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { fonts: (data || []).map(toApi) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/fonts/custom/upload — JSON body { fileName, dataBase64 }.
 * Base64 over multipart because this runs on serverless functions where a
 * 2MB font is a body, not a stream. Same payload shape works unchanged from
 * the picker and from the MCP tool, which is the point.
 */
customFontRoutes.post("/upload", async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || "");
    const dataBase64 = String(req.body?.dataBase64 || "");
    if (!fileName || !dataBase64) {
      return res.status(400).json({ success: false, error: "fileName y dataBase64 son obligatorios" });
    }
    // Tolerate data: URLs — agents love wrapping bytes in one.
    const b64 = dataBase64.startsWith("data:") ? (dataBase64.split(",")[1] || "") : dataBase64;
    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) return res.status(400).json({ success: false, error: "El archivo está vacío" });
    if (buffer.length > MAX_FONT_BYTES) {
      return res.status(413).json({ success: false, error: `El archivo pesa ${(buffer.length / 1048576).toFixed(1)}MB — el límite es 2MB por fuente` });
    }
    const format = sniffFormat(buffer, fileName);
    if (!format) return res.status(415).json({ success: false, error: "Formato no soportado: sube .ttf, .otf, .woff o .woff2" });

    const sb = getSupabaseAdmin();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });
    const userId = req.auth!.userId;

    const { data: profile } = await sb.from("user_profiles").select("access_plan").eq("id", userId).maybeSingle();
    const limits = limitsFor(profile?.access_plan);
    const [{ count }, { data: sizeRows }] = await Promise.all([
      sb.from("custom_fonts").select("id", { count: "exact", head: true }).eq("user_id", userId),
      sb.from("custom_fonts").select("size_bytes").eq("user_id", userId),
    ]);
    const usedBytes = (sizeRows || []).reduce((sum: number, r: any) => sum + (Number(r.size_bytes) || 0), 0);
    if ((count || 0) >= limits.maxCount) {
      return res.status(403).json({ success: false, error: `Límite del plan: ${limits.maxCount} fuentes. Borra alguna para subir otra.` });
    }
    if (usedBytes + buffer.length > limits.maxBytes) {
      return res.status(403).json({ success: false, error: `Límite del plan: ${Math.round(limits.maxBytes / 1048576)}MB de fuentes.` });
    }

    const familyName = familyNameFrom(fileName);
    // unique (user, family, format): re-uploading the same face REPLACES it —
    // a v2 of the file should not exhaust the quota with a dead row.
    const { data: existing } = await sb.from("custom_fonts")
      .select("id, storage_path")
      .eq("user_id", userId).eq("family_name", familyName).eq("format", format)
      .maybeSingle();

    const storagePath = `${userId}/${randomUUID()}.${format}`;
    const { error: upErr } = await sb.storage.from(BUCKET)
      .upload(storagePath, buffer, { contentType: FONT_MIME[format], upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    let row: CustomFontRow;
    if (existing) {
      await sb.storage.from(BUCKET).remove([existing.storage_path]);
      const { data, error } = await sb.from("custom_fonts")
        .update({ file_name: fileName, storage_path: storagePath, size_bytes: buffer.length })
        .eq("id", existing.id)
        .select("id, family_name, file_name, format, size_bytes, storage_path, created_at")
        .single();
      if (error) throw new Error(error.message);
      row = data;
    } else {
      const { data, error } = await sb.from("custom_fonts")
        .insert({
          user_id: userId, family_name: familyName, file_name: fileName,
          storage_path: storagePath, format, size_bytes: buffer.length,
        })
        .select("id, family_name, file_name, format, size_bytes, storage_path, created_at")
        .single();
      if (error) throw new Error(error.message);
      row = data;
    }
    res.json({ success: true, data: { font: toApi(row) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/fonts/custom/:id — object and row leave together; an orphan of
 * either kind would either eat quota (row) or storage (object) forever.
 */
customFontRoutes.delete("/:id", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });
    const { data: row } = await sb.from("custom_fonts")
      .select("id, storage_path")
      .eq("id", req.params.id).eq("user_id", req.auth!.userId)
      .maybeSingle();
    if (!row) return res.status(404).json({ success: false, error: "Fuente no encontrada" });
    await sb.storage.from(BUCKET).remove([row.storage_path]);
    const { error } = await sb.from("custom_fonts").delete().eq("id", row.id);
    if (error) throw new Error(error.message);
    res.json({ success: true, deleted: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/fonts/custom/usage — what the settings card draws:
 * count and bytes against the plan's two limits.
 */
customFontRoutes.get("/usage", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const userId = req.auth!.userId;
    if (!sb) {
      return res.json({ success: true, data: { count: 0, bytes: 0, limits: limitsFor(null), plan: "unknown" } });
    }
    const [{ count }, { data: sizeRows }, { data: profile }] = await Promise.all([
      sb.from("custom_fonts").select("id", { count: "exact", head: true }).eq("user_id", userId),
      sb.from("custom_fonts").select("size_bytes").eq("user_id", userId),
      sb.from("user_profiles").select("access_plan").eq("id", userId).maybeSingle(),
    ]);
    const bytes = (sizeRows || []).reduce((sum: number, r: any) => sum + (Number(r.size_bytes) || 0), 0);
    const plan = profile?.access_plan || "friends_family";
    res.json({ success: true, data: { count: count || 0, bytes, limits: limitsFor(plan), plan } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
