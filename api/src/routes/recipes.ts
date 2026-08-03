import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase.js";
import * as templates from "../services/templates.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../services/tenancy.js";

export const recipeRoutes = Router();

/** POST /api/recipes — create recipe */
recipeRoutes.post("/", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase not configured");
    const id = `rec_${uuid().slice(0, 12)}`;
    const now = new Date().toISOString();
    const { name, description, workspaceId, structure, templateHtml, templateCss } = req.body;
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to a workspace is required" });
    }
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
    const accessibleIds = await listAccessibleWorkspaceIds(req.auth!);
    if (workspaceId && !accessibleIds.includes(workspaceId)) return res.status(403).json({ success: false, error: "Workspace access is required" });
    let query = supabase.from("recipes").select("*").order("created_at", { ascending: false });
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    else if (accessibleIds.length) query = query.in("workspace_id", accessibleIds);
    else return res.json({ success: true, data: [], total: 0 });
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

/** Apply {texts, images, colors} variable substitution to one frame's html/css. */
function applyVariables(html: string, css: string, variables: any) {
  if (variables?.texts) for (const [k, v] of Object.entries(variables.texts)) { html = html.replace(new RegExp(k, "g"), String(v)); }
  if (variables?.images) for (const [k, v] of Object.entries(variables.images)) { html = html.replace(new RegExp(k, "g"), String(v)); }
  if (variables?.colors) for (const [k, v] of Object.entries(variables.colors)) { css = css.replace(new RegExp(k, "g"), String(v)); }
  return { html, css };
}

/** POST /api/recipes/:id/execute — create template from recipe with variables */
recipeRoutes.post("/:id/execute", async (req, res) => {
  try {
    const supabase = getSupabase()!;
    if (!supabase) throw new Error("Supabase not configured");
    const { data: recipe, error: sbError } = await supabase.from("recipes").select("*").eq("id", req.params.id).single();
    if (sbError || !recipe) return res.status(404).json({ success: false, error: "Recipe not found" });
    const { variables } = req.body;
    const workspaceId = recipe.workspace_id;
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the recipe workspace is required" });
    }

    // Multi-frame Key Visuals store their frames in structure.frames; older
    // single-frame recipes only ever populated the legacy top-level
    // template_html/template_css columns — support both.
    const FRAME_GAP = 100;
    const savedFrames: Array<{ name?: string; html?: string; css?: string; width?: number; height?: number }> =
      recipe.structure?.frames?.length ? recipe.structure.frames
      : [{ name: recipe.name, html: recipe.template_html || "", css: recipe.template_css || "", width: recipe.structure?.layout?.width || 1080, height: recipe.structure?.layout?.height || 1080 }];

    const firstWidth = savedFrames[0]?.width || 1080;
    const firstHeight = savedFrames[0]?.height || 1080;
    const tpl = await templates.createTemplate(`${recipe.name}_${Date.now() % 10000}`, firstWidth, firstHeight, undefined, "", workspaceId || "default");

    let x = 100;
    const frames = savedFrames.map((f, i) => {
      const { html, css } = applyVariables(f.html || "", f.css || "", variables);
      const width = f.width || 1080;
      const height = f.height || 1080;
      const frame = {
        id: `frame_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        templateId: tpl.id,
        name: f.name || `Frame ${i + 1}`,
        x, y: 100, width, height,
        order: i,
        objects: [],
        layoutMode: "NONE" as const,
        clipsContent: true,
        constraints: {},
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        html, css,
      };
      x += width + FRAME_GAP;
      return frame;
    });

    await templates.updateTemplate(tpl.id, {
      engine: "html",
      html: frames[0].html, css: frames[0].css, // legacy fields, kept for back-compat readers
      frames,
    });
    res.status(201).json({ success: true, data: { templateId: tpl.id, name: tpl.name } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
