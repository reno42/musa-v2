// packages/api/src/routes/branches.ts
// Branch management for templates

import { Router } from "express";
import * as templates from "../services/templates";
import type { Branch, DesignTemplate } from "@futuraria/shared";

export const branchRoutes = Router();

// In-memory branch store (parallel to templates)
const branchStore = new Map<string, Branch[]>();

// ── Helper: get branches for a template ──
function getBranches(templateId: string): Branch[] {
  return branchStore.get(templateId) || [];
}

// ── Helper: save branches for a template ──
function saveBranches(templateId: string, branches: Branch[]) {
  branchStore.set(templateId, branches);
}

// ── List branches for a template ──
branchRoutes.get("/:id/branches", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    // Merge stored branches with template-embedded branches
    const stored = getBranches(req.params.id);
    const embedded = tpl.branches || [];
    const allBranches = [...embedded, ...stored.filter(
      sb => !embedded.find(eb => eb.id === sb.id)
    )];

    // Ensure main branch exists
    if (!allBranches.find(b => b.name === "main")) {
      allBranches.unshift({
        id: `br_${req.params.id}_main`,
        name: "main",
        templateId: req.params.id,
        createdAt: tpl.metadata.createdAt,
        createdBy: "system",
      });
    }

    res.json({ success: true, data: allBranches });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Create a new branch ──
branchRoutes.post("/:id/branches", async (req, res) => {
  try {
    const { name, createdBy } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Branch name is required" });

    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const sourceBranchId = req.body.sourceBranchId || `br_${req.params.id}_main`;

    const branchId = `br_${req.params.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const branch: Branch = {
      id: branchId,
      name,
      templateId: req.params.id,
      parentBranchId: sourceBranchId,
      createdAt: new Date().toISOString(),
      createdBy,
    };

    // Duplicate the template for this branch
    const branchTemplate = await templates.createTemplate(
      `${tpl.name} [${name}]`,
      tpl.canvas.width,
      tpl.canvas.height,
      {
        ...tpl,
        id: undefined,
        name: `${tpl.name} [${name}]`,
        branches: [...(tpl.branches || []), branch],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    // Store branch reference
    const branches = getBranches(req.params.id);
    branches.push(branch);
    saveBranches(req.params.id, branches);

    res.status(201).json({ success: true, data: { branch, template: branchTemplate } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Merge a branch into current ──
branchRoutes.post("/:id/branches/:branchId/merge", async (req, res) => {
  try {
    const { id: templateId, branchId: sourceBranchId } = req.params;
    const { targetBranchId, resolutions } = req.body;

    const tpl = await templates.getTemplate(templateId);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    // Get source branch template
    const branches = getBranches(templateId);
    const allBranches = [...(tpl.branches || []), ...branches.filter(
      sb => !(tpl.branches || []).find(eb => eb.id === sb.id)
    )];

    const sourceBranch = allBranches.find(b => b.id === sourceBranchId);
    if (!sourceBranch) return res.status(404).json({ success: false, error: "Source branch not found" });

    // Find source template by branch name
    const sourceTemplate = (await templates.listTemplates()).find(
      t => t.name === `${tpl.name} [${sourceBranch.name}]`
    );
    if (!sourceTemplate) return res.status(404).json({ success: false, error: "Source branch template not found" });

    // Layer-level merge strategy
    const targetLayers = new Map(tpl.layers.map(l => [l.id, l]));
    const sourceLayers = new Map(sourceTemplate.layers.map(l => [l.id, l]));

    const conflicts: Array<{ layerId: string; layerName: string; source: any; target: any }> = [];
    const mergedLayers = [...tpl.layers];

    for (const [layerId, sourceLayer] of sourceLayers) {
      const targetLayer = targetLayers.get(layerId);

      if (!targetLayer) {
        // New layer from source — add it
        mergedLayers.push(sourceLayer);
      } else {
        // Layer exists in both — check for modifications
        const sourceStr = JSON.stringify(sourceLayer);
        const targetStr = JSON.stringify(targetLayer);

        if (sourceStr !== targetStr) {
          // Modified in both — conflict unless resolution provided
          if (resolutions && resolutions[layerId] !== undefined) {
            const useSource = resolutions[layerId];
            const idx = mergedLayers.findIndex(l => l.id === layerId);
            if (idx >= 0) mergedLayers[idx] = useSource ? sourceLayer : targetLayer;
          } else {
            conflicts.push({
              layerId,
              layerName: sourceLayer.name || layerId,
              source: sourceLayer,
              target: targetLayer,
            });
          }
        }
      }
    }

    if (conflicts.length > 0) {
      return res.json({
        success: false,
        conflicts,
        message: "Merge has conflicts. Resolve them and retry with resolutions.",
      });
    }

    // Apply merge
    await templates.updateTemplate(templateId, {
      layers: mergedLayers,
      metadata: { ...tpl.metadata, updatedAt: new Date().toISOString() },
    });

    res.json({ success: true, data: { merged: true, layerCount: mergedLayers.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Delete a branch ──
branchRoutes.delete("/:id/branches/:branchId", async (req, res) => {
  try {
    const { id: templateId, branchId } = req.params;

    const branches = getBranches(templateId);
    const updated = branches.filter(b => b.id !== branchId);
    saveBranches(templateId, updated);

    // Also update template-embedded branches
    const tpl = await templates.getTemplate(templateId);
    if (tpl) {
      await templates.updateTemplate(templateId, {
        branches: (tpl.branches || []).filter(b => b.id !== branchId),
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
