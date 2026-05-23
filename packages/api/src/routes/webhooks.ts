import { Router } from "express";
import { registerWebhook, listWebhooks, deleteWebhook } from "../services/webhooks";

export const webhookRoutes = Router();

// Register webhook
webhookRoutes.post("/", async (req, res) => {
  try {
    const { url, events, secret } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "url is required" });
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ success: false, error: "events array is required" });
    }
    const entry = await registerWebhook(url, events, secret, req.auth?.userId);
    res.status(201).json({ success: true, data: entry });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List webhooks
webhookRoutes.get("/", async (req, res) => {
  try {
    const data = await listWebhooks(req.auth?.userId);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete webhook
webhookRoutes.delete("/:id", async (req, res) => {
  try {
    const ok = await deleteWebhook(req.params.id, req.auth?.userId);
    if (!ok) return res.status(404).json({ success: false, error: "Webhook not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
