import { Router } from "express";
import { store } from "../services/store.js";
import { canAccessWorkspace } from "../services/tenancy.js";

/**
 * POST /api/design-system/extract
 * Multi-template design system extraction.
 * Wraps the same deterministic engine used by MCP tools.
 */
export const designSystemRoutes = Router();

designSystemRoutes.post("/extract", async (req, res) => {
  try {
    var templateIds = req.body.templateIds || [];
    if (!templateIds.length) {
      return res.status(400).json({ success: false, error: "At least one templateId required" });
    }

    // Dynamically import design-extractor (ESM)
    var designExtractor: any;
    try {
      designExtractor = await import("../../../worker/runtime/functions/design-extractor.mjs");
    } catch {
      return res.status(500).json({ success: false, error: "Design extractor module unavailable" });
    }

    var allExtractions: any[] = [];
    var allFrames: any[] = [];

    for (var t = 0; t < templateIds.length; t++) {
      var tpl = store.getTemplate(templateIds[t]);
      if (!tpl) {
        return res.status(404).json({ success: false, error: "Template not found: " + templateIds[t] });
      }
      if (!req.auth || !(await canAccessWorkspace(req.auth, tpl.workspaceId, "viewer"))) {
        return res.status(404).json({ success: false, error: "Template not found: " + templateIds[t] });
      }

      var extFrames = (tpl.frames || []).map(function (f: any) {
        return {
          id: f.id,
          name: f.name,
          html: f.html || "",
          css: f.css || "",
          width: f.width,
          height: f.height,
          layoutMode: f.layoutMode,
        };
      }).filter(function (f: any) { return f.html || f.css; });

      if (extFrames.length > 0) {
        var extraction = designExtractor.extractDesignSystem(extFrames);
        allExtractions.push(extraction);
        allFrames.push.apply(allFrames, extFrames);
      }
    }

    if (allExtractions.length === 0) {
      return res.status(400).json({ success: false, error: "No frames with HTML/CSS found in any template" });
    }

    // Merge if multiple templates
    var merged = allExtractions.length > 1
      ? designExtractor.mergeExtractions(allExtractions)
      : designExtractor.fillSemanticGaps(allExtractions[0]);

    // Structural component discovery
    merged.components = designExtractor.discoverStructuralComponents(allFrames, merged.colors);

    // Generate artifacts
    var designName = req.body.name || (templateIds.length === 1 ? "Extracted Design System" : "Merged Design System");
    var artifacts = {
      tokensJson: designExtractor.generateTokensJson(merged, { name: designName }),
      designMd: designExtractor.generateDesignMd(merged, { name: designName }),
      sharedCss: designExtractor.generateSharedCss(merged),
      sourceHash: merged.sourceHash,
      styleFingerprint: designExtractor.computeStyleFingerprint(merged),
      generatedAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: {
        templateIds: templateIds,
        templatesAnalyzed: allExtractions.length,
        totalFrames: allFrames.length,
        extraction: merged,
        artifacts: artifacts,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
