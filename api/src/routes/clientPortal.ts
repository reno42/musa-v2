/**
 * REQ-082 — Endpoints de la intranet de clientes (x-client-token).
 * El token (10 min por login, canje continuo mientras navega) Scopea TODO:
 * el cliente solo ve piezas/aprobaciones de SU brand_id. Sin esto, 403.
 */
import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";

export const clientPortalRoutes = Router();

async function clientFromToken(req: any): Promise<{ clientId: string; workspaceId: string; brandId: string } | null> {
  const token = String(req.headers["x-client-token"] || req.query.clientToken || "");
  if (!token) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data: row } = await sb.from("platform_config").select("value").eq("key", `client_token:${token}`).maybeSingle();
  const v = row?.value;
  if (!v || !v.client_id || Number(v.exp) < Date.now()) return null;
  return { clientId: v.client_id, workspaceId: v.workspace_id, brandId: v.brand_id };
}

// piezas de la semana de SU marca
clientPortalRoutes.get("/client-pieces", async (req: any, res: any) => {
  const cl = await clientFromToken(req);
  if (!cl || cl.workspaceId !== String(req.query.workspaceId || "") || cl.brandId !== String(req.query.brandId || "")) {
    return res.status(403).json({ error: "Token inválido o marca ajena" });
  }
  const sb = getSupabaseAdmin();
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await sb.from("content_calendar")
    .select("id, title, status, scheduled_date")
    .eq("workspace_id", cl.workspaceId)
    .eq("brand_id", cl.brandId)
    .gte("scheduled_date", d30)
    .order("scheduled_date")
    .limit(60);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: (data || []).map((r: any) => ({ id: r.id, name: r.title, status: r.status, scheduledDate: r.scheduled_date })) });
});

// aprobar / pedir cambios (solo piezas en estado aprobación de SU marca)
clientPortalRoutes.post("/client-approve", async (req: any, res: any) => {
  const cl = await clientFromToken(req);
  const b = req.body || {};
  if (!cl || cl.workspaceId !== String(b.workspaceId || "") || cl.brandId !== String(b.brandId || "")) {
    return res.status(403).json({ error: "Token inválido o marca ajena" });
  }
  const sb = getSupabaseAdmin();
  const decision = b.decision === "aprobar" ? "programado" : "idea";
  const { data: piece } = await sb.from("content_calendar")
    .select("id, status").eq("id", String(b.pieceId || "")).eq("workspace_id", cl.workspaceId).eq("brand_id", cl.brandId).maybeSingle();
  if (!piece) return res.status(404).json({ error: "Pieza no encontrada en tu marca" });
  if (piece.status !== "aprobación") return res.status(400).json({ error: `La pieza no está esperando aprobación (estado: ${piece.status})` });
  const { error } = await sb.from("content_calendar").update({ status: decision, updated_at: new Date().toISOString() }).eq("id", piece.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, status: decision });
});
