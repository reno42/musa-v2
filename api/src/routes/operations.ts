/**
 * REQ-081 — GET /api/operations/overview?workspaceId=
 * Panel del operador zero-person: por cada marca del workspace agrega
 * piezas 7d / pendientes de aprobación / programadas / publicadas 30d /
 * jobs y entregas 30d + key_usage del mes + alertas. Todo con datos que
 * ya viven en la BD (templates, content_calendar, publish_*, key_usage_monthly).
 */
import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

export const operationsRoutes = Router();

operationsRoutes.get("/overview", async (req: any, res: any) => {
  try {
    const auth = req.auth;
    if (!auth?.valid) return res.status(401).json({ error: "No autenticado" });
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId) return res.status(400).json({ error: "workspaceId requerido" });
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(500).json({ error: "Supabase no configurado" });

    const ok = await canAccessWorkspace(auth, workspaceId);
    if (!ok) return res.status(403).json({ error: "Sin acceso a este espacio" });

    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const d7 = new Date(now.getTime() - 7 * 86400000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
    const day30 = d30.slice(0, 10);

    // Marcas del espacio
    const { data: brands } = await sb.from("brands").select("id, name").eq("workspace_id", workspaceId).order("name");
    const brandList = brands || [];
    const brandIds = brandList.map((b: any) => b.id);

    // Piezas creadas 7d por marca (templates con brand_id)
    const { data: pieces } = await sb
      .from("templates")
      .select("brand_id, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", d7)
      .limit(1000);

    // Calendario por marca (estado + fecha)
    const { data: cal } = await sb
      .from("content_calendar")
      .select("brand_id, status, scheduled_date")
      .eq("workspace_id", workspaceId)
      .gte("scheduled_date", day30)
      .limit(2000);

    // Publicaciones 30d por marca (jobs) y entregas (targets)
    const { data: jobs } = await sb
      .from("publish_jobs")
      .select("id, brand_id, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", d30)
      .limit(500);
    const jobIds = (jobs || []).map((j: any) => j.id);
    let targets: Array<any> = [];
    if (jobIds.length) {
      const { data: tg } = await sb.from("publish_targets").select("job_id, status").in("job_id", jobIds);
      targets = tg || [];
    }
    const jobById = new Map((jobs || []).map((j: any) => [j.id, j]));

    // Uso de agentes este mes (por key)
    const { data: usage } = await sb
      .from("key_usage_monthly")
      .select("key_id, mcp_calls")
      .eq("workspace_id", workspaceId)
      .eq("month", month)
      .order("mcp_calls", { ascending: false })
      .limit(10);
    let agents: Array<{ label: string; calls: number }> = [];
    if (usage && usage.length) {
      const { data: keys } = await sb.from("workspace_api_keys").select("id, label").in("id", usage.map((u: any) => u.key_id));
      const labelOf = new Map((keys || []).map((k: any) => [k.id, k.label]));
      agents = usage.map((u: any) => ({ label: labelOf.get(u.key_id) || "(key eliminada)", calls: Number(u.mcp_calls) || 0 }));
    }

    // ── Agregado por marca ──
    const rows: Array<any> = brandList.map((b: any) => {
      const pieces7d = (pieces || []).filter((p: any) => p.brand_id === b.id).length;
      const calB = (cal || []).filter((c: any) => c.brand_id === b.id);
      const pend = calB.filter((c: any) => c.status === "aprobación");
      const oldest = pend.reduce((acc: number | null, c: any) => {
        const days = Math.floor((now.getTime() - Date.parse(`${c.scheduled_date}T00:00:00Z`)) / 86400000);
        return acc == null || days > acc ? days : acc;
      }, null);
      const jobsB = (jobs || []).filter((j: any) => j.brand_id === b.id);
      const delivered = targets.filter((t: any) => t.status === "delivered" && jobById.get(t.job_id)?.brand_id === b.id).length;
      return {
        brandId: b.id,
        name: b.name,
        pieces7d,
        pendingApproval: pend.length,
        scheduledPending: calB.filter((c: any) => c.status === "programado").length,
        oldestPendingDays: oldest,
        published30d: calB.filter((c: any) => c.status === "publicado").length,
        jobs30d: jobsB.length,
        delivered30d: delivered,
      };
    });

    const totals = {
      brands: rows.length,
      pieces7d: rows.reduce((a, r) => a + r.pieces7d, 0),
      pendingApproval: rows.reduce((a, r) => a + r.pendingApproval, 0),
      published30d: rows.reduce((a, r) => a + r.published30d, 0),
      delivered30d: rows.reduce((a, r) => a + r.delivered30d, 0),
    };

    const alerts: string[] = [];
    for (const r of rows) {
      if (r.pendingApproval > 0 && (r.oldestPendingDays ?? 0) >= 5) alerts.push(`${r.name}: ${r.pendingApproval} piezas esperando aprobación (la más vieja ${r.oldestPendingDays} días).`);
      if (r.jobs30d > 0 && r.delivered30d === 0) alerts.push(`${r.name}: ${r.jobs30d} publicaciones sin ninguna entrega — revisa las cuentas conectadas.`);
    }

    res.json({ workspaceId, generatedAt: now.toISOString(), brands: rows, totals, agents, alerts });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Error interno" });
  }
});
