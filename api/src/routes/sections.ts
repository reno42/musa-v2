import { Router } from "express";
import { store } from "../services/store.js";

export const sectionRoutes = Router();

/**
 * POST /api/templates/:id/sections/:frameId/claim
 * Claim a section/frame for an agent. TTL = 60s (renewable).
 * Returns 409 if already claimed by another agent.
 */
sectionRoutes.post("/:id/sections/:frameId/claim", async (req, res) => {
  try {
    const { agentId, agentName } = req.body;
    if (!agentId) return res.status(400).json({ success: false, error: "agentId is required" });

    const claim = store.claimSection(
      req.params.id,
      req.params.frameId,
      agentId,
      agentName || agentId,
    );

    if (!claim) {
      // Check who currently holds the claim
      const existing = store.getClaims(req.params.id)
        .find(c => c.frameId === req.params.frameId);
      return res.status(409).json({
        success: false,
        error: "already_claimed",
        claimedBy: existing ? { agentId: existing.agentId, agentName: existing.agentName } : null,
      });
    }

    res.status(201).json({ success: true, claim });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/templates/:id/sections/:frameId/claim
 * Release a section claim.
 */
sectionRoutes.delete("/:id/sections/:frameId/claim", async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ success: false, error: "agentId is required" });

    const released = store.releaseSection(req.params.id, req.params.frameId, agentId);
    if (!released) return res.status(404).json({ success: false, error: "Claim not found" });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/templates/:id/sections/:frameId/claim/renew
 * Renew a claim's TTL.
 */
sectionRoutes.post("/:id/sections/:frameId/claim/renew", async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ success: false, error: "agentId is required" });

    const claim = store.renewClaim(req.params.id, req.params.frameId, agentId);
    if (!claim) return res.status(404).json({ success: false, error: "Claim not found or expired" });

    res.json({ success: true, claim });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/claims
 * List all active claims for a template.
 */
sectionRoutes.get("/:id/claims", async (req, res) => {
  try {
    const claims = store.getClaims(req.params.id);
    res.json({ success: true, claims });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
