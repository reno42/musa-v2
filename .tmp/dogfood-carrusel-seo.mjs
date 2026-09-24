// DOGFOOD 10 min — demo para lead: el ghost REAL (sin arnés de tests) armando
// un carrusel del taller SEO en modo teacher. Flujo de usuario puro: abrir la
// app, pedirle a Musa, elegir "Aquí, viendo a Musa", ver el teatro, recibir el
// carrusel. Solo graba video + shots y reporta lo que pasó (sin asserts duros).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, ".tmp", "fase2-tests");
const VID = path.join(OUT, "videos");
fs.mkdirSync(VID, { recursive: true });

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5173";
const TPL = "tpl_bbac3d34-cd6";
const EDITOR_URL = `${BASE}/?template=${TPL}&v=2`;
const EMAIL = "qa.oauth.test@design.futuraria.com";
const PASS = "fdr_qa_0c02282e5a97f124ecd99abe";
const MSG = "arma un carrusel del taller SEO";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: VID, size: { width: 1280, height: 720 } },
});
// Modo teacher ANTES de que la app arranque (preferencia real del usuario,
// no un toggle de test). El default ya es teacher; esto lo hace explícito.
await context.addInitScript(() => { try { localStorage.setItem("futuraria-ghost-mode", "teacher"); } catch {} });

const res = { id: "dogfood-carrusel-seo", msg: MSG };
try {
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("Entrar al workspace").first().click();
  await page.waitForSelector(".auth-form input[type=email]", { timeout: 20000 });
  await page.fill(".auth-form input[type=email]", EMAIL);
  await page.fill(".auth-form input[type=password]", PASS);
  await page.click("button.auth-submit");
  await page.waitForSelector('button[title="Chat (Musa)"]', { timeout: 30000 });
  console.log("login OK — usuario en su workspace");

  // El diseñador abre su diseño y le habla a Musa desde ahí.
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  const openBtn = page.locator('button[title="Abrir chat"]').first();
  if (await openBtn.count()) await openBtn.click({ force: true }).catch(() => {});
  await page.waitForSelector('input[aria-label="Mensaje para el Leader"]', { timeout: 20000 });
  await page.waitForFunction(
    () => performance.getEntriesByType("resource").some(e => e.name.includes("model_int8.onnx")),
    { timeout: 90000 },
  ).catch(() => {});
  await page.waitForTimeout(1500);

  // Armar espera de chips ANTES de enviar (lección A1/A2).
  const chipsP = page.waitForSelector('button[data-testid="ghost-chip-here"]', { timeout: 45000 }).then(() => true).catch(() => false);
  await page.locator('input[aria-label="Mensaje para el Leader"]').fill(MSG);
  await page.locator('input[aria-label="Mensaje para el Leader"]').press("Enter");
  console.log(`pedido enviado: "${MSG}"`);
  const t0 = Date.now();

  res.chips = await chipsP;
  if (res.chips) {
    await page.screenshot({ path: path.join(OUT, "dogfood-1-chips.png") }).catch(() => {});
    // El usuario elige ver a Musa: el teatro arranca acá.
    await page.locator('button[data-testid="ghost-chip-here"]').first().click({ force: true });
    console.log(`chips OK (${Date.now() - t0}ms) → clic en "Aquí, viendo a Musa"`);
    await sleep(9000); // dejar que el teatro se pose
    await page.screenshot({ path: path.join(OUT, "dogfood-2-teatro.png") }).catch(() => {});
  } else {
    console.log("sin chips — puede haber ido por otra ruta; se graba igual");
  }

  // Espera del desenlace (receta ✓/✕ o cierre honesto). 300s. Node-side con
  // try/catch: el editor puede RECARGAR por sync de mutaciones remotas (T3) y
  // un waiter in-page muere con el contexto — lección de take 2.
  const list = ["✓ Receta", "✕ La receta", "Listo:", "✕ Abortado"];
  const t1 = Date.now();
  let bubble = null;
  while (Date.now() - t1 < 300000) {
    try {
      const found = await page.evaluate(list => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t; (t = w.nextNode());) {
          const d = (t.data || "").trim();
          if (list.some(s => d.includes(s))) return d;
        }
        return null;
      }, list);
      if (found && found !== bubble) { bubble = found; if (bubble.length > 0 && (bubble.includes("✓ Receta") || bubble.includes("✕"))) break; }
    } catch { /* navegación en curso — el poll sigue */ }
    await sleep(1500);
  }
  res.bubble = bubble ? bubble.slice(0, 220) : null;
  console.log(`desenlace (${Date.now() - t0}ms): ${res.bubble || "(sin burbuja en 300s)"}`);

  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, "dogfood-3-final.png") }).catch(() => {});
  res.bubbleOk = Boolean(res.bubble && (res.bubble.includes("✓ Receta") || res.bubble.includes("Listo:")));
  res.ok = res.chips === true && res.bubbleOk;
} catch (e) {
  res.error = String(e).slice(0, 400);
}

const pages = context.pages();
const video = pages[0]?.video();
await context.close();
if (video) { try { fs.renameSync(await video.path(), path.join(VID, "demo-ghost-carrusel-seo.webm")); } catch {} }
await browser.close();
console.log(`\n${res.ok ? "✓" : "✗"} dogfood ${JSON.stringify(res).slice(0, 400)}`);
console.log(`video → ${path.join(VID, "demo-ghost-carrusel-seo.webm")}`);
