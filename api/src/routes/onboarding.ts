import { Router } from "express";
import { z } from "zod";
import { getSupabaseAdmin } from "../services/supabase.js";
import { isOnboardingGoalId, type OnboardingGoalId } from "../../../shared/personalizedOnboarding.js";

export const personalizedOnboardingRoutes = Router();
const id = z.string().refine(isOnboardingGoalId, "Unknown onboarding goal");
const goalsPayload = z.object({ goalIds: z.array(id).max(25) });
function db() { const sb = getSupabaseAdmin(); if (!sb) throw new Error("Supabase is required for onboarding progress"); return sb; }

personalizedOnboardingRoutes.get("/progress", async (req, res) => {
  try {
    const { data, error } = await db().from("onboarding_progress").select("goal_id, selected_at, completed_at, completion_source, dismissed_at")
      .eq("user_id", req.auth!.userId).is("dismissed_at", null).order("selected_at");
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

personalizedOnboardingRoutes.put("/goals", async (req, res) => {
  const parsed = goalsPayload.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: "Los objetivos recibidos no son válidos. Recarga la página e inténtalo otra vez.",
    });
  }
  try {
    const goalIds = [...new Set(parsed.data.goalIds)]; const sb = db(); const userId = req.auth!.userId;
    const { data: existing, error: readError } = await sb.from("onboarding_progress").select("goal_id, dismissed_at").eq("user_id", userId);
    if (readError) throw readError;
    const existingIds = new Set((existing || []).map((row: any) => row.goal_id));
    const removed = (existing || []).filter((row: any) => !row.dismissed_at && !goalIds.includes(row.goal_id)).map((row: any) => row.goal_id);
    if (removed.length) {
      const { error } = await sb.from("onboarding_progress").update({ dismissed_at: new Date().toISOString() }).eq("user_id", userId).in("goal_id", removed);
      if (error) throw error;
    }
    const restored = goalIds.filter(goalId => existingIds.has(goalId));
    if (restored.length) {
      const { error } = await sb.from("onboarding_progress").update({ dismissed_at: null }).eq("user_id", userId).in("goal_id", restored);
      if (error) throw error;
    }
    const inserted = goalIds.filter(goalId => !existingIds.has(goalId));
    if (inserted.length) {
      const { error } = await sb.from("onboarding_progress").insert(inserted.map(goal_id => ({ user_id: userId, goal_id })));
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "No se pudo guardar tus objetivos." });
  }
});

personalizedOnboardingRoutes.patch("/progress/:goalId", async (req, res) => {
  try {
    const goalId = id.parse(req.params.goalId); const parsed = z.object({ completed: z.boolean() }).parse(req.body);
    const values = { completed_at: parsed.completed ? new Date().toISOString() : null, completion_source: parsed.completed ? "self" : null };
    const { error } = await db().from("onboarding_progress").update(values).eq("user_id", req.auth!.userId).eq("goal_id", goalId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

/** Server-only hook for real product events. Browser requests can never set system. */
export async function recordObservedOnboardingCompletion(userId: string, goalId: OnboardingGoalId) {
  const { error } = await db().from("onboarding_progress").update({
    completed_at: new Date().toISOString(), completion_source: "system", dismissed_at: null,
  }).eq("user_id", userId).eq("goal_id", goalId);
  if (error) throw error;
}
