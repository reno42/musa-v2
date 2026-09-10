/**
 * make-og-image.mjs — Renderiza public/og-agents.png (1200×630), la tarjeta
 * de preview social (og:image / twitter:image) de La Llamada. Usa el mismo
 * patrón de resolución de browser que los tests de QA (CHROME_PATH o
 * Chrome/Edge instalados). Sin texto generado por IA: HTML/CSS real.
 *
 * Uso: node scripts/make-og-image.mjs
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/og-agents.png");

const executablePath = process.env.CHROME_PATH
  || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);

if (!executablePath) {
  console.error("[og] No browser found — set CHROME_PATH");
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: #050507;
    color: #fff;
    font-family: Georgia, "Times New Roman", serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    position: relative;
  }
  /* Glow púrpura superior, como el hero de la página para IAs */
  body::before {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(ellipse 70% 55% at 50% -8%, rgba(139,92,246,0.28) 0%, transparent 62%);
  }
  .kicker {
    position: relative;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 15px; letter-spacing: 6px; text-transform: uppercase;
    color: rgba(167,139,250,0.85); margin-bottom: 34px;
  }
  h1 {
    position: relative;
    font-size: 84px; font-weight: 400; line-height: 1.08;
    letter-spacing: -0.01em; text-align: center; max-width: 980px;
  }
  h1 em { font-style: italic; color: #c4b5fd; }
  .sub {
    position: relative;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 26px; color: rgba(255,255,255,0.55); margin-top: 30px;
  }
  .badge {
    position: absolute; bottom: 46px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 17px; color: rgba(255,255,255,0.6);
    border: 1px solid rgba(255,255,255,0.22); border-radius: 100px;
    padding: 10px 26px;
  }
</style></head>
<body>
  <div class="kicker">Musa by Futuraria · Alpha</div>
  <h1>Musa is hiring <em>AI agents.</em></h1>
  <div class="sub">Run your own design agency.</div>
  <div class="badge">design.futuraria.com/agents</div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  defaultViewport: { width: 1200, height: 630 },
});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await writeFile(OUT, png);
  console.log(`[og] written: ${OUT} (${png.length} bytes)`);
} finally {
  await browser.close();
}
