// csv-proxy.ts — Proxies Google Sheets "Publish to Web" CSV URLs
// Bypasses CORS restrictions when fetching from the browser.
import { Router } from "express";

const router = Router();

router.get("/csv-proxy", async (req, res) => {
  const url = req.query.url as string;
  if (!url) {
    return res.status(400).json({ error: "Missing ?url param" });
  }

  // Basic security: only allow fetching from Google Sheets domains
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const allowedHosts = process.env.CSV_PROXY_DOMAINS
    ? process.env.CSV_PROXY_DOMAINS.split(",").map((d) => d.trim())
    : [
        "docs.google.com",
        "sheets.googleapis.com",
        "spreadsheets.google.com",
      ];
  if (!allowedHosts.some((h) => parsed.hostname.endsWith(h))) {
    return res.status(403).json({
      error: "Only Google Sheets URLs are allowed via this proxy",
    });
  }

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Futuraria-CSV-Proxy/1.0" },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Upstream returned ${upstream.status}`,
      });
    }
    const text = await upstream.text();
    return res.json({ text, url });
  } catch (e: any) {
    return res.status(502).json({ error: e.message || "Proxy fetch failed" });
  }
});

export default router;
