import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase.js";
import * as templates from "../services/templates.js";

export const recipeRoutes = Router();

/** POST /api/recipes — create recipe */
recipeRoutes.post("/", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase not configured");
    const id = `rec_${uuid().slice(0, 12)}`;
    const now = new Date().toISOString();
    const { name, description, workspaceId, structure, templateHtml, templateCss } = req.body;
    const { error } = await supabase.from("recipes").insert({
      id, name, description,
      workspace_id: workspaceId,
      structure: structure || {},
      template_html: templateHtml || "",
      template_css: templateCss || "",
      created_at: now, updated_at: now,
    });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { id, name, createdAt: now } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/recipes — list recipes */
recipeRoutes.get("/", async (req, res) => {
  try {
    const supabase = getSupabase()!;
    if (!supabase) throw new Error("Supabase not configured");
    const workspaceId = req.query.workspaceId as string;
    let query = supabase.from("recipes").select("*").order("created_at", { ascending: false });
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data || [], total: data?.length || 0 });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/recipes/:id — get single recipe */
recipeRoutes.get("/:id", async (req, res) => {
  try {
    const supabase = getSupabase()!;
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.from("recipes").select("*").eq("id", req.params.id).single();
    if (error || !data) return res.status(404).json({ success: false, error: "Recipe not found" });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /api/recipes/:id — update recipe */
recipeRoutes.put("/:id", async (req, res) => {
  try {
    const supabase = getSupabase()!;
    if (!supabase) throw new Error("Supabase not configured");
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.structure !== undefined) updates.structure = req.body.structure;
    if (req.body.templateHtml !== undefined) updates.template_html = req.body.templateHtml;
    if (req.body.templateCss !== undefined) updates.template_css = req.body.templateCss;
    const { error } = await supabase.from("recipes").update(updates).eq("id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** DELETE /api/recipes/:id — delete recipe */
recipeRoutes.delete("/:id", async (req, res) => {
  try {
    const supabase = getSupabase()!;
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.from("recipes").delete().eq("id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/recipes/:id/execute — create template from recipe with variables */
recipeRoutes.post("/:id/execute", async (req, res) => {
  try {
    const supabase = getSupabase()!;
    if (!supabase) throw new Error("Supabase not configured");
    const { data: recipe, error: sbError } = await supabase.from("recipes").select("*").eq("id", req.params.id).single();
    if (sbError || !recipe) return res.status(404).json({ success: false, error: "Recipe not found" });
    const { variables, workspaceId } = req.body;
    let html = recipe.template_html || "";
    let css = recipe.template_css || "";
    if (variables?.texts) for (const [k, v] of Object.entries(variables.texts)) { html = html.replace(new RegExp(k, "g"), String(v)); }
    if (variables?.images) for (const [k, v] of Object.entries(variables.images)) { html = html.replace(new RegExp(k, "g"), String(v)); }
    if (variables?.colors) for (const [k, v] of Object.entries(variables.colors)) { css = css.replace(new RegExp(k, "g"), String(v)); }
    const tpl = await templates.createTemplate(`${recipe.name}_${Date.now() % 10000}`, 1080, 1080, undefined, "", workspaceId || "default");
    tpl.engine = "html"; tpl.html = html; tpl.css = css;
    await templates.updateTemplate(tpl.id, { engine: "html", html, css, frames: [] });
    res.status(201).json({ success: true, data: { templateId: tpl.id, name: tpl.name } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
