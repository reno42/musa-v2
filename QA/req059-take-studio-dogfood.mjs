/**
 * Dogfood REQ-059 — Take Studio (A/B/C) + AI Clones (D) contra el dev local.
 *
 *   node QA/req059-take-studio-dogfood.mjs
 *
 * Requiere vite (:5173) + api (:3001) corriendo (npm run dev:all). Usa Chrome
 * del sistema vía puppeteer-core con cámara fake (--use-fake-device-for-
 * media-stream), así el flujo completo grabar → revisar → biblioteca corre
 * headless de verdad. En dev /api/video-takes y /api/heygen dan 404 (rutas del
 * worker desplegado): el perro también verifica que la UI degrade honesta.
 * No sube nada al server: usa "Guardar en esta pestaña" (modo local) y una key
 * dummy hg-dogfood… para la pestaña Clones.
 */
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { resolveBrowserPath } from "./editor-interactions/lib/browser.mjs";
import { qaCredentials } from "./editor-interactions/lib/mcp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "req059-dogfood");
const VITE_URL = process.env.VITE_URL || "http://localhost:5173";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function settle(page, ms = 250) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

/** Poll hasta que fn(page) sea truthy (o timeout). fn corre EN LA PÁGINA:
 *  tiene que ser autocontenida, sin cierres sobre helpers de Node. */
async function waitFor(page, fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn).catch(() => undefined);
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`timeout esperando ${label} (último: ${JSON.stringify(last)})`);
}

const bodyHas = (page, text, ms = 8000) =>
  waitFor(
    page,
    // new Function: el texto viaja DENTRO del fuente — page.evaluate no serializa cierres.
    new Function(`return (document.body.textContent || "").includes(${JSON.stringify(text)});`),
    ms,
    `texto "${text}"`,
  );
const buttonThere = (page, text, ms = 8000) =>
  waitFor(
    page,
    new Function(`return [...document.querySelectorAll("button")].some(b => (b.textContent || "").trim() === ${JSON.stringify(text)});`),
    ms,
    `botón "${text}"`,
  );

const inPage = {
  bodyText: () => document.body.textContent || "",
  buttonByExactText: (text) => {
    const btn = [...document.querySelectorAll("button")]
      .find(b => (b.textContent || "").trim() === text && b.offsetParent !== null);
    if (!btn) return false;
    btn.click();
    return true;
  },
  hasButton: (text) => [...document.querySelectorAll("button")]
    .some(b => (b.textContent || "").trim() === text && b.offsetParent !== null),
  selectByOptionText: (labelText, textPart) => {
    const label = [...document.querySelectorAll("label")]
      .find(l => [...l.querySelectorAll(":scope > span")].some(s => s.textContent.trim() === labelText));
    const sel = label && label.querySelector("select");
    if (!sel) return false;
    const opt = [...sel.options].find(o => o.textContent.includes(textPart));
    if (!opt) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  },
  selectInfo: (labelText) => {
    const label = [...document.querySelectorAll("label")]
      .find(l => [...l.querySelectorAll(":scope > span")].some(s => s.textContent.trim() === labelText));
    const sel = label && label.querySelector("select");
    if (!sel) return null;
    return {
      value: sel.value,
      disabled: sel.disabled,
      options: [...sel.options].map(o => o.textContent.trim()),
    };
  },
  prompterProbe: () => {
    const viewport = [...document.querySelectorAll("div")]
      .find(d => (d.style.background || "").includes("rgba(0, 0, 0, 0.62)") || (d.style.background || "").includes("rgba(0,0,0,0.62)"));
    if (!viewport) return null;
    const inner = viewport.firstElementChild;
    const lead = inner && inner.firstElementChild;
    return {
      leadPx: lead ? lead.getBoundingClientRect().height : -1,
      text: (inner && inner.textContent || "").slice(0, 200),
      aspect: (() => {
        const frame = viewport.parentElement;
        return frame && frame.style.aspectRatio;
      })(),
    };
  },
  roleAlerts: () => [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent.trim()),
};

/** Tab del sidebar + sub del menú caret (NavSplitTab), con reintentos: tras un
 *  reload el sidebar puede tardar y el menú a veces necesita más de un intento. */
async function openSubPane(page, tabLabel, itemLabel) {
  await page.evaluate(inPage.buttonByExactText, tabLabel);
  await waitFor(
    page,
    new Function(`return Boolean(document.querySelector('button[aria-label="Secciones de ${tabLabel}"]'));`),
    10000,
    `caret de ${tabLabel}`,
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(lbl => {
      const caret = document.querySelector('button[aria-label="Secciones de ' + lbl + '"]');
      if (caret) caret.click();
    }, tabLabel);
    await sleep(400);
    if (await page.evaluate(inPage.buttonByExactText, itemLabel)) return true;
  }
  return false;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: resolveBrowserPath(),
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--force-device-scale-factor=1",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.on("pageerror", err => errors.push(`pageerror: ${err.message}`));
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("dialog", d => d.accept().catch(() => {}));

  try {
    // ── 1. Login del QA user por la UI real ──
    console.log("── 1. Login ──");
    await page.goto(VITE_URL, { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(1500);
    // La landing pública (waitlist) está delante del app: "Entrar al workspace" abre el login.
    const onLanding = await page.evaluate(() => Boolean(document.querySelector("form.landing-waitlist-form")));
    if (onLanding) {
      await page.evaluate(inPage.buttonByExactText, "Entrar al workspace");
      await waitFor(page, () =>
        Boolean(document.querySelector("form.auth-form")) || !document.querySelector("form.landing-waitlist-form"),
        20000, "salida de la landing hacia el login");
      await settle(page, 800);
    }
    const { email, password } = qaCredentials();
    if (!email || !password) throw new Error("Sin credenciales QA (QA/.env.qa-oauth).");
    const hasForm = await page.evaluate(() => Boolean(document.querySelector("form.auth-form")));
    if (hasForm) {
      await page.type('form.auth-form input[type="email"]', email, { delay: 5 });
      await page.type('form.auth-form input[type="password"]', password, { delay: 5 });
      await page.click("button.auth-submit");
      await waitFor(page, () => !document.querySelector("form.auth-form"), 25000, "login");
      await settle(page, 1200);
      record("login QA por la UI", true);
    } else {
      record("login QA por la UI", false, "no apareció form.auth-form (¿sesión activa o pantalla inesperada?)");
    }
    // El QA user ve el tour de onboarding en el primer login: saltarlo si está.
    await page.evaluate(() => {
      const skip = [...document.querySelectorAll("button")].find(b => (b.textContent || "").includes("Saltar tour"));
      if (skip) skip.click();
    });
    await settle(page, 600);

    // ── 2. Navegar a Video → Tomas ──
    console.log("── 2. Navegación a Tomas ──");
    const openedTomas = await openSubPane(page, "Video", "Tomas");
    await settle(page, 600);
    await bodyHas(page, "Grabar toma", 20000);
    await bodyHas(page, "Biblioteca de tomas", 10000);
    record("tab Video + sub Tomas abren el estudio", openedTomas);
    await page.screenshot({ path: join(SHOTS, "01-studio-vertical.png") });

    // ── 3. Layout: sin scroll de página ──
    const scroll = await page.evaluate(() => ({
      page: document.documentElement.scrollHeight - window.innerHeight,
    }));
    record("studio 100vh sin scroll de página", scroll.page <= 2, `overflow de ${scroll.page}px`);
    // El 404 de /api/video-takes llega async: esperar el aviso en vez de leerlo una vez.
    let localNotice = "";
    try {
      await waitFor(page, () => [...document.querySelectorAll('[role="alert"]')].some(e => e.textContent.includes("Modo local")), 10000, "aviso modo local");
      localNotice = (await page.evaluate(inPage.roleAlerts)).find(t => t.includes("Modo local")) || "";
    } catch { /* el fallback local se vuelve a demostrar al guardar la toma */ }
    record("aviso de modo local honesto (404 de /api/video-takes)", Boolean(localNotice), localNotice.slice(0, 140));

    // ── 4. Formatos: dropdown exacto + WYSIWYG + lead del prompter ──
    console.log("── 4. Formatos ──");
    const fmt = await page.evaluate(inPage.selectInfo, "Formato");
    record("dropdown con los 4 formatos exactos", fmt && fmt.options.length === 4,
      fmt ? fmt.options.join(" ¶ ").slice(0, 220) : "sin select");
    await page.evaluate(inPage.selectByOptionText, "Formato", "1920×1080");
    await settle(page, 500);
    const horiz = await page.evaluate(inPage.prompterProbe);
    const hintH = (await page.evaluate(inPage.bodyText)).includes("Salida 1920×1080");
    record("horizontal: preview pasa a 16:9 (WYSIWYG)", horiz && horiz.aspect === "1920 / 1080", `aspect="${horiz && horiz.aspect}"`);
    record("horizontal: lead del prompter remedido (ResizeObserver)", Boolean(horiz && horiz.leadPx > 0), `lead=${horiz && Math.round(horiz.leadPx)}px`);
    record("horizontal: hint de salida visible", hintH);
    await page.screenshot({ path: join(SHOTS, "02-formato-horizontal.png") });
    await page.evaluate(inPage.selectByOptionText, "Formato", "1080×1920");
    await settle(page, 400);

    // ── 5. Prompter: editable, foco, prueba ──
    console.log("── 5. Prompter ──");
    const box = await page.$('textarea[placeholder*="Escribí acá"]');
    await box.click();
    await box.type("Esto es una prueba del teleprompter del estudio. La segunda línea mide el ancho.", { delay: 4 });
    await settle(page, 300);
    const probe = await page.evaluate(inPage.prompterProbe);
    record("guion del panel aparece en el overlay", Boolean(probe && probe.text.includes("segunda línea mide el ancho")));
    // Click sobre el overlay (JS bubbling: mismo camino que el click real).
    await page.evaluate(() => {
      const viewport = [...document.querySelectorAll("div")]
        .find(d => (d.style.background || "").includes("rgba(0, 0, 0, 0.62)"));
      if (viewport) viewport.click();
    });
    await settle(page, 200);
    const focused = await page.evaluate(() => {
      const ta = document.querySelector('textarea[placeholder*="Escribí acá"]');
      return document.activeElement === ta;
    });
    record("click en el overlay enfoca el editor de guion", focused);
    await page.evaluate(inPage.buttonByExactText, "Probar guion");
    await settle(page, 700);
    const scrolling = await page.evaluate(inPage.hasButton, "Pausar guion");
    record("Probar guion arranca el desplazamiento", scrolling);
    await page.screenshot({ path: join(SHOTS, "03-prompter.png") });
    await page.evaluate(inPage.buttonByExactText, "Pausar guion");
    await settle(page, 200);
    record("Pausar guion detiene el desplazamiento", await page.evaluate(inPage.hasButton, "Probar guion"));

    // ── 6. Grabación completa con cámara fake ──
    console.log("── 6. Grabación ──");
    await page.evaluate(inPage.buttonByExactText, "Activar cámara");
    await buttonThere(page, "Apagar cámara", 12000);
    record("cámara fake activada", true);
    await page.evaluate(inPage.selectByOptionText, "Cuenta regresiva", "Sin countdown");
    await settle(page, 200);
    await page.evaluate(inPage.buttonByExactText, "Grabar toma");
    await bodyHas(page, "REC");
    record("grabación arranca con HUD", true);
    const fmtWhileRec = await page.evaluate(inPage.selectInfo, "Formato");
    record("formato bloqueado mientras graba", Boolean(fmtWhileRec && fmtWhileRec.disabled));
    await page.screenshot({ path: join(SHOTS, "04-grabando.png") });
    await page.evaluate(inPage.buttonByExactText, "Pausar");
    await bodyHas(page, "EN PAUSA");
    await page.evaluate(inPage.buttonByExactText, "Seguir");
    await waitFor(page, () => {
      const t = document.body.textContent || "";
      return t.includes("REC") && !t.includes("EN PAUSA");
    }, 5000, "reanudación");
    record("pausa y reanudación", true);
    await sleep(2500);
    await page.evaluate(inPage.buttonByExactText, "Detener y revisar");
    await bodyHas(page, "Toma recién grabada", 20000);
    const reviewBox = await page.evaluate(() => {
      const strong = [...document.querySelectorAll("strong")].find(s => s.textContent.includes("Toma recién grabada"));
      const box = strong && strong.closest("div[style*='border']");
      return box ? box.textContent : "";
    });
    record("revisión antes de subir (nada se sube solo)", reviewBox.includes("revisala antes de subir"));
    record("la toma sale al tamaño exacto del formato (1080×1920)",
      reviewBox.includes("1080×1920") && reviewBox.includes("WEBM"), reviewBox.slice(0, 140));
    await page.screenshot({ path: join(SHOTS, "05-revision.png") });

    // ── 7. Modo local: guardar en la pestaña (no sube nada) ──
    console.log("── 7. Biblioteca local ──");
    await page.evaluate(inPage.buttonByExactText, "Guardar en esta pestaña");
    await waitFor(page, () => (document.body.textContent || "").includes("no está en el server"), 10000, "fila local");
    record("fallback local: la toma queda en la pestaña",
      (await page.evaluate(inPage.bodyText)).includes("Modo local: la toma quedó en esta pestaña"));
    const libScroll = await page.evaluate(() => {
      const secs = [...document.querySelectorAll("section")];
      const lib = secs.find(s => (s.textContent || "").includes("Biblioteca de tomas"));
      const scrollBox = lib && lib.querySelector('div[style*="overflow"]');
      return scrollBox ? { oy: getComputedStyle(scrollBox).overflowY } : null;
    });
    record("biblioteca con scroll interno", Boolean(libScroll && libScroll.oy === "auto"), JSON.stringify(libScroll));
    await page.screenshot({ path: join(SHOTS, "06-biblioteca-local.png") });

    // ── 8. Persistencia del guion tras recargar ──
    console.log("── 8. Persistencia ──");
    await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
    await settle(page, 1500);
    await openSubPane(page, "Video", "Tomas");
    await settle(page, 800);
    const persisted = await page.evaluate(() => {
      const ta = document.querySelector('textarea[placeholder*="Escribí acá"]');
      return ta ? ta.value : "";
    });
    record("guion persiste tras recargar (localStorage)", persisted.includes("segunda línea mide el ancho"));

    // ── 9. Clones: BYOK + mensaje honesto del proxy en dev ──
    console.log("── 9. AI Clones ──");
    const openedClones = await openSubPane(page, "Video", "AI Clones");
    // La clave dummy de una corrida anterior puede seguir en el stub local de
    // /api/keys: entonces el formulario se reemplaza por Reemplazar/Quitar.
    await waitFor(page, () => {
      const form = Boolean(document.querySelector('input[type="password"][placeholder*="hg_"]'));
      const configured = [...document.querySelectorAll("button")].some(b => (b.textContent || "").trim() === "Reemplazar clave");
      return form || configured;
    }, 15000, "card BYOK (form o clave ya guardada)");
    await sleep(3500); // deja terminar el fetch de status (404 en dev)
    const keyConfigured = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some(b => (b.textContent || "").trim() === "Reemplazar clave"));
    if (!keyConfigured) {
      record("Validar clave bloqueada sin key configurada", (() => {
        const b = [...document.querySelectorAll("button")].find(x => (x.textContent || "").trim() === "Validar clave");
        return b ? b.disabled : null;
      })() === true);
      await page.type('input[type="password"][placeholder*="hg_"]', "hg-dogfood-dummy-key", { delay: 3 });
      await page.evaluate(inPage.buttonByExactText, "Guardar y validar");
    } else {
      record("Validar clave bloqueada sin key configurada", true, "clave dummy ya configurada en el stub local (corrida anterior)");
      await page.evaluate(inPage.buttonByExactText, "Validar clave");
    }
    try {
      await waitFor(page, () => [...document.querySelectorAll('[role="alert"]')].length > 0, 15000, "alerta de validación");
    } catch { /* seguimos igual: leemos lo que haya en pantalla */ }
    const clonesAlerts = await page.evaluate(inPage.roleAlerts);
    const honest = clonesAlerts.some(t => t.includes("worker desplegado"));
    record("mensaje honesto: el proxy vive en el worker desplegado", honest, clonesAlerts.join(" | ").slice(0, 180));
    record("pestaña Clones renderiza sin crash", (await page.evaluate(inPage.bodyText)).includes("HeyGen") && openedClones,
      `menú AI Clones click OK: ${openedClones}`);
    // Dejar el stub local como estaba: quitar la clave dummy (stub SOLO local).
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => (x.textContent || "").trim() === "Quitar clave");
      if (b) b.click();
    });
    await page.screenshot({ path: join(SHOTS, "07-clones-dev.png") });

    // ── 10. Consola: solo ruido esperado ──
    console.log("── 10. Consola ──");
    const whitelist = ["/api/", "favicon", "React DevTools", "net::ERR_ABORTED", "Failed to load resource"];
    const real = errors.filter(e => !whitelist.some(w => e.includes(w)));
    record("sin errores de consola fuera del ruido esperado", real.length === 0,
      real.length ? real.slice(0, 5).join(" ¶ ").slice(0, 300) : `(${errors.length} mensajes esperados filtrados)`);
  } catch (cause) {
    const dump = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll("button")].map(b => (b.textContent || "").trim()).filter(Boolean).slice(0, 50),
      alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent.trim()),
      text: (document.body.textContent || "").replace(/\s+/g, " ").slice(0, 300),
    })).catch(() => null);
    console.error("ESTADO AL FALLAR:", JSON.stringify(dump, null, 1));
    throw cause;
  } finally {
    await browser.close().catch(() => {});
  }

  const fails = results.filter(r => !r.pass);
  console.log(`\n══ Dogfood REQ-059: ${results.length - fails.length}/${results.length} checks OK ══`);
  if (fails.length) {
    console.log("Fallones:");
    for (const f of fails) console.log(`  ✗ ${f.name} — ${f.detail}`);
  }
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(async err => {
  console.error("DOGFOOD CRASH:", err.message);
  process.exitCode = 2;
});
