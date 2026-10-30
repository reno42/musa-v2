import { Router } from "express";
import { store } from "../services/store.js";
import { getSupabase } from "../services/supabase.js";
import { requireWorkspaceRole } from "../services/tenancy.js";

export const metricsRoutes = Router();

/** Day-level metrics aggregated from snapshots and template creation dates. */
interface DayMetrics {
  date: string;
  designOps: number;
  framesCreated: number;
  templatesCreated: number;
  byActor: { ia: number; human: number; system: number };
}

/**
 * GET /api/metrics/activity?from=2026-01-01&to=2026-12-31
 *
 * Returns day-level activity aggregated from snapshots (design operations),
 * template frame counts, and template creation dates.
 *
 * Source data:
 *   - In-memory store (`store.listAllSnapshots()`) for current session snapshots
 *   - Supabase `templates` table for template creation dates and frame counts
 *   - Supabase `snapshots` table if available (planned for persistent snapshots)
 *
 * Falls back gracefully when Supabase is not configured.
 */
metricsRoutes.get("/activity", requireWorkspaceRole("viewer", "query"), async (_req, res) => {
  try {
    const workspaceId = String(_req.query.workspaceId);
    const fromDate = _req.query.from ? new Date(_req.query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = _req.query.to ? new Date(_req.query.to as string) : new Date();

    // Aggregate snapshots from in-memory store by day
    const dayMap = new Map<string, DayMetrics>();
    const ensureDay = (date: string) => {
      if (!dayMap.has(date)) {
        dayMap.set(date, { date, designOps: 0, framesCreated: 0, templatesCreated: 0, byActor: { ia: 0, human: 0, system: 0 } });
      }
      return dayMap.get(date)!;
    };

    // ── 1. In-memory snapshots ──
    const snaps = store.listAllSnapshots().filter(snapshot => snapshot.data?.workspaceId === workspaceId);
    for (const s of snaps) {
      const ts = new Date(s.timestamp);
      if (ts < fromDate || ts > toDate) continue;
      const date = ts.toISOString().slice(0, 10);
      const day = ensureDay(date);
      day.designOps++;
      if (s.type === "ia") day.byActor.ia++;
      else if (s.type === "human") day.byActor.human++;
      else day.byActor.system++;
      // Each snapshot records frame count at the time
      day.framesCreated += s.frameCount || s.objectCount || 0;
    }

    // ── 2. Supabase template creation dates ──
    const sb = getSupabase();
    if (sb) {
      try {
        const { data: tpls, error } = await sb
          .from("templates")
          .select("created_at, data")
          .eq("workspace_id", workspaceId)
          .gte("created_at", fromDate.toISOString())
          .lte("created_at", toDate.toISOString())
          .is("deleted_at", null);

        if (!error && tpls) {
          for (const row of tpls) {
            const date = new Date(row.created_at).toISOString().slice(0, 10);
            const day = ensureDay(date);
            day.templatesCreated++;
            // Count frames from template data
            const tplData = row.data || {};
            const frames = tplData.frames || [];
            day.framesCreated += frames.length;
          }
        }
      } catch {
        // Non-blocking: Supabase may be unreachable
      }
    }

    // ── 3. Templates created in in-memory store ──
    const allTpls = store.listTemplates(workspaceId, 1000, 0);
    for (const tpl of allTpls.data) {
      const created = tpl.metadata?.createdAt;
      if (!created) continue;
      const ts = new Date(created);
      if (ts < fromDate || ts > toDate) continue;
      const date = ts.toISOString().slice(0, 10);
      const day = ensureDay(date);
      day.templatesCreated++;
      day.framesCreated += tpl.frames?.length || 0;
    }

    const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const totals = days.reduce(
      (acc, d) => ({
        designOps: acc.designOps + d.designOps,
        framesCreated: acc.framesCreated + d.framesCreated,
        templatesCreated: acc.templatesCreated + d.templatesCreated,
      }),
      { designOps: 0, framesCreated: 0, templatesCreated: 0 },
    );

    res.json({
      success: true,
      data: {
        days,
        totals,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/metrics/ads?workspaceId= (REQ-070 F5, aditivo)
 * Join campaigns x crm_deals SERVIDO (antes se cruzaba en el cliente).
 * Devuelve por campaña: presupuesto planificado (budget_plan_usd) y resultado
 * (suma de final_value/value de deals con esa campaign_id). RLS aplica vía
 * requireWorkspaceRole; solo campañas y deals del workspace.
 */
metricsRoutes.get("/ads", requireWorkspaceRole("viewer", "query"), async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return void res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId) return void res.status(400).json({ success: false, error: "workspaceId is required" });

    const [campRes, dealRes] = await Promise.all([
      sb.from("campaigns")
        .select("id,name,status,brand_id,budget_plan_usd,updated_at")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(500),
      sb.from("crm_deals")
        .select("campaign_id,final_value,value")
        .eq("workspace_id", workspaceId)
        .limit(2000),
    ]);
    if (campRes.error) return void res.status(500).json({ success: false, error: campRes.error.message });
    if (dealRes.error) return void res.status(500).json({ success: false, error: dealRes.error.message });

    const valueByCampaign = new Map<string, number>();
    for (const d of dealRes.data || []) {
      const cid = (d as { campaign_id?: string | null }).campaign_id;
      if (!cid) continue;
      const v = Number((d as { final_value?: number | null }).final_value
        ?? (d as { value?: number | null }).value ?? 0);
      valueByCampaign.set(cid, (valueByCampaign.get(cid) || 0) + v);
    }
    const rows = (campRes.data || []).map((c: any) => ({
      campaignName: c.name,
      status: c.status ?? null,
      brandId: c.brand_id ?? null,
      budgetPlanUsd: Number(c.budget_plan_usd ?? 0),
      resultadoUsd: Math.round(valueByCampaign.get(c.id) || 0),
    }));
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
