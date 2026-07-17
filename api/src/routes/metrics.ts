import { Router } from "express";
import { store } from "../services/store.js";
import { getSupabase } from "../services/supabase.js";

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
metricsRoutes.get("/activity", async (_req, res) => {
  try {
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
    const snaps = store.listAllSnapshots();
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
    const allTpls = store.listTemplates(undefined, 1000, 0);
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
