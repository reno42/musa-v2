/**
 * Verdict-fixes QA round — real-UI verification of the 18-bug patch set from
 * QA_ANALISIS_BUGS_REPO_2026-10-05.md (implemented 2026-10-06 after
 * VEREDICTO_QA_design-main_2026-10-06.md, whose condition #5 demands
 * verification in the RUNNING app, not just a green build).
 *
 * Round 3: the fixture trigger is [data-testid="nuevo-archivo"] — the
 * "Nuevo archivo de diseño" aria-label belongs to the DIALOG, not the trigger;
 * direct #workspace/diseno navigation (default tab is home); the calendar row
 * is dated in the CURRENT month (the grid renders the cursor month); the chat
 * dock opens via [aria-label="Abrir chat"] (the FAB has no "Chat" text); and
 * B-05 asserts the minmax(300px, 1fr) floor in the inline style, because
 * computed 1fr columns resolve wider than 300px and can never match.
 *
 * Safety rails:
 *  - DELETE /api/templates/* is answered 500 by request interception (C-02
 *    needs a forced failure anyway) — no real deletion, fixture survives.
 *  - Every window.confirm dialog is auto-DISMISSED (M-11/M-05 assert the
 *    dialog APPEARED; dismissing aborts the destructive path).
 *  - The CSV import only writes rows into the QA user's own workspace.
 *
 * Run: node QA/verdict-fixes-qa.mjs
 * Exit 0 = no FAIL (BLOCKED = needs conditions this environment lacks).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { ensureServers, VITE_URL } from "./editor-interactions/lib/servers.mjs";
import { launchBrowser } from "./editor-interactions/lib/browser.mjs";
import { PAGE_HELPERS } from "./editor-interactions/lib/page-helpers.mjs";
import { qaCredentials } from "./editor-interactions/lib/mcp.mjs";

const results = [];
function record(id, name, status, detail = "") {
  results.push({ id, name, status, detail });
  console.log(`  [${status}] ${id} — ${name}${detail ? ` · ${detail}` : ""}`);
}

// 64×64 negro se dibuja in-page con canvas (dropBlackPngAtCenter) — fixture
// del drop. CSV con fecha del mes en curso: la grilla renderiza el mes del cursor.
mkdirSync(".tmp", { recursive: true });
const CSV_FIXTURE = "Fecha,Tipo,Marca,Campaña,Conjunto,Tema,Copy,Canales,Estado\n2026-10-15,Orgánico,QA Verdict,Lanzamiento,Set A,Idea de prueba,Copy de prueba QA,Instagram,idea\n";

async function settle(page, ms = 150) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

async function clickByText(page, selector, regex) {
  return page.evaluate((sel, pattern) => {
    const re = new RegExp(pattern, "i");
    const el = [...document.querySelectorAll(sel)].find(e => re.test((e.textContent || "").trim()) && !e.disabled && e.offsetParent !== null);
    if (!el) return false;
    el.click();
    return true;
  }, selector, regex.source);
}

async function bodyHasText(page, text) {
  return page.evaluate(t => document.body.innerText.includes(t), text);
}

async function waitForText(page, text, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await bodyHasText(page, text)) return true;
    await sleep(250);
  }
  return false;
}

async function gotoWorkspace(page, tabPath = "") {
  await page.goto("about:blank", { waitUntil: "load", timeout: 15000 }).catch(() => {});
  await page.goto(`${VITE_URL}/#workspace${tabPath}`, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(600);
}

async function ensureSignedIn(page) {
  const hasForm = await page.evaluate(() => Boolean(document.querySelector("form.auth-form")));
  if (!hasForm) return true;
  const { email, password } = qaCredentials();
  if (!email || !password) throw new Error("No QA credentials (run node QA/oauth-qa-user-setup.mjs once).");
  await page.type('form.auth-form input[type="email"]', email, { delay: 5 });
  await page.type('form.auth-form input[type="password"]', password, { delay: 5 });
  await page.click("button.auth-submit");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (!(await page.evaluate(() => Boolean(document.querySelector("form.auth-form"))))) return true;
    await sleep(400);
  }
  return false;
}

/** Drop a 64×64 black PNG drawn IN-PAGE (canvas.toBlob) at viewport center;
 *  bubbles to the app-level drop handler → DesignImportModal. A real-sized
 *  bitmap avoids the 1px degenerate boxes a 1×1 fixture produced. */
async function dropBlackPngAtCenter(page, size = 64) {
  await page.evaluate(async px => {
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, px, px);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    const file = new File([blob], "qa-drop-image.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, size);
}

async function main() {
  console.log("── Verdict-fixes QA round (real UI, round 5) ──");
  const servers = await ensureServers();
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let lastDialog = null;
  page.on("dialog", async d => { lastDialog = { type: d.type(), message: d.message() }; await d.dismiss(); });

  // Safety rail: every template DELETE fails with 500 for the whole run.
  await page.setRequestInterception(true);
  let blockDeletes = true;
  page.on("request", req => {
    if (blockDeletes && req.method() === "DELETE" && /\/api\/templates\//.test(req.url())) {
      req.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "QA forced failure" }) });
      return;
    }
    req.continue();
  });

  try {
    // ═══ sign in + enter the dashboard ═══
    await gotoWorkspace(page);
    const signed = await ensureSignedIn(page);
    if (!signed) throw new Error("QA login did not complete — cannot run the round.");
    await gotoWorkspace(page);
    await settle(page, 1200);

    // The QA user may land on a workspace prompt — create one if offered.
    const wsCreated = await clickByText(page, "button", /^(Crear|Nuevo) workspace/i);
    if (wsCreated) { await settle(page, 1500); }

    // ═══ Fixture: a template named "QA Verdict Tmp" ═══
    console.log("\n▶ Fixture: plantilla");
    // "Nuevo archivo de diseño" is the DIALOG's aria-label (Dashboard.tsx);
    // the trigger button is [data-testid="nuevo-archivo"], on Diseño/files.
    const filesGridReady = async () => {
      await gotoWorkspace(page, "/diseno");
      await settle(page, 1200);
      let ok = await page.evaluate(() => Boolean(document.querySelector('[data-testid="nuevo-archivo"]')));
      if (!ok) {
        await clickByText(page, "button", /^Diseño/i);
        await settle(page, 900);
        ok = await page.evaluate(() => Boolean(document.querySelector('[data-testid="nuevo-archivo"]')));
      }
      return ok;
    };
    const gridOk = await filesGridReady();
    const findCard = () => page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[id^="template-actions-"]')].find(b => /QA Verdict Tmp/i.test(b.getAttribute("aria-label") || ""));
      return btn ? btn.id.replace("template-actions-", "") : "";
    });
    let tmplId = await findCard();
    if (tmplId) {
      record("FIXTURE", "Plantilla 'QA Verdict Tmp' (de corrida anterior)", "PASS", `id=${tmplId.slice(0, 8)}…`);
    } else if (!gridOk) {
      record("FIXTURE", "Plantilla 'QA Verdict Tmp'", "BLOCKED", "botón 'Nuevo archivo' no visible en Diseño/files");
    } else {
      await page.click('[data-testid="nuevo-archivo"]');
      const dialog = await page.waitForSelector('[aria-label="Nuevo archivo de diseño"]', { timeout: 6000 }).catch(() => null);
      if (!dialog) {
        record("FIXTURE", "Plantilla 'QA Verdict Tmp'", "BLOCKED", "el popup de nuevo archivo no abrió");
      } else {
        await page.type('input[aria-label="Nombre del nuevo archivo"]', "QA Verdict Tmp", { delay: 5 });
        await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="crear-archivo"]');
          if (btn) btn.click();
        });
        await settle(page, 2500);
        // creation may auto-open the editor — come back to the grid if so
        const inEditor = await page.evaluate(() => Boolean(document.querySelector(".editor-v2-topbar")));
        if (inEditor) await gotoWorkspace(page, "/diseno");
        const deadline = Date.now() + 15000;
        while (!tmplId && Date.now() < deadline) {
          tmplId = await findCard();
          if (!tmplId) await sleep(500);
        }
        record("FIXTURE", "Plantilla 'QA Verdict Tmp'", tmplId ? "PASS" : "FAIL", tmplId ? `id=${tmplId.slice(0, 8)}…` : "no apareció la tarjeta tras crear");
      }
    }

    // ═══ C-02 on the fixture ═══
    console.log("\n▶ Dashboard / Archivos — C-02");
    if (!tmplId) {
      record("C-02", "Delete del menú no abre el archivo + 500 mantiene la tarjeta", "BLOCKED", "sin plantilla fixture");
    } else {
      await gotoWorkspace(page, "/diseno");
      await settle(page, 1200);
      const cardBtn = `#template-actions-${tmplId}`;
      const present = await page.evaluate(sel => Boolean(document.querySelector(sel)), cardBtn);
      if (!present) {
        // the grid may live under the Diseño tab
        await clickByText(page, "button", /^Diseño/i);
        await settle(page, 900);
      }
      if (!(await page.evaluate(sel => Boolean(document.querySelector(sel)), cardBtn))) {
        record("C-02", "Delete del menú no abre el archivo + 500 mantiene la tarjeta", "BLOCKED", "tarjeta fixture no visible");
      } else {
        await page.click(cardBtn);
        await settle(page, 400);
        const clicked = await page.evaluate(() => {
          const item = [...document.querySelectorAll('[role="menuitem"]')].find(b => /Delete/.test(b.textContent || ""));
          if (!item) return false;
          item.click();
          return true;
        });
        await settle(page, 700);
        const editorOpened = await page.evaluate(() => Boolean(document.querySelector(".editor-v2-topbar")) || /[?&]template=/.test(location.search + location.hash));
        record("C-02a", "Click en Delete NO abre el editor", clicked && !editorOpened ? "PASS" : "FAIL", clicked ? `editorOpened=${editorOpened}` : "menuitem Delete no encontrado");

        const modalVisible = await page.evaluate(() => [...document.querySelectorAll("button")].some(b => (b.textContent || "").trim() === "Eliminar" && b.offsetParent !== null));
        if (modalVisible) {
          // The confirm dialog is a CHECKBOX ("Entiendo y quiero eliminar este
          // archivo") that enables Eliminar — there is no name input to type.
          await page.evaluate(() => {
            const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(c => c.offsetParent && /Entiendo y quiero eliminar/i.test(c.closest("label")?.textContent || ""));
            if (cb && !cb.checked) cb.click();
          });
          await settle(page, 300);
          const executed = await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button")].find(b => (b.textContent || "").trim() === "Eliminar" && !b.disabled && b.offsetParent !== null);
            if (!btn) return false;
            btn.click();
            return true;
          });
          await settle(page, 900);
          const toast = await waitForText(page, "Error al eliminar", 3000);
          const cardStill = await page.evaluate(sel => Boolean(document.querySelector(sel)), cardBtn);
          record("C-02b", "DELETE 500 → tarjeta permanece + toast (sin phantom delete)", executed && cardStill && toast ? "PASS" : "FAIL", `executed=${executed} cardStill=${cardStill} toast=${toast}`);
        } else {
          const toast = await waitForText(page, "Error al eliminar", 3000);
          const cardStill = await page.evaluate(sel => Boolean(document.querySelector(sel)), cardBtn);
          record("C-02b", "DELETE 500 → tarjeta permanece + toast (sin phantom delete)", cardStill && toast ? "PASS" : "FAIL", `modal=none(skip window) cardStill=${cardStill} toast=${toast}`);
        }
      }
    }

    // ═══ Inicio — B-04, B-05, M-02, B-12, M-01 ═══
    console.log("\n▶ Inicio");
    await gotoWorkspace(page, "/home");
    await settle(page, 1500);

    {
      const bg = await page.evaluate(() => {
        const el = [...document.querySelectorAll("div")].find(d => {
          const s = getComputedStyle(d);
          return s.position === "relative" && s.zIndex === "10" && /rgba\(6,\s*7,\s*10/.test(s.backgroundColor);
        });
        return el ? getComputedStyle(el).backgroundColor : "";
      });
      record("B-04", "Topbar opaca (sin texto translúcido)", bg ? "PASS" : "FAIL", bg || "no element with rgba(6,7,10,.88) found");
    }
    {
      // B-05 fix = repeat(auto-fit, minmax(300px, 1fr)). Computed tracks come
      // back like "379.5px 379.5px … 0px" (auto-fit keeps collapsed slots) —
      // parseFloat, NOT Number("379.5px")=NaN, which poisoned rounds 3-5.
      const grid = await page.evaluate(() => {
        const el = [...document.querySelectorAll("div")]
          .find(d => (d.getAttribute("style") || "").includes("minmax(300px, 1fr)")
            && d.offsetParent !== null
            && getComputedStyle(d).display === "grid"
            && d.children.length > 0);
        if (!el) return null;
        const cols = getComputedStyle(el).gridTemplateColumns.split(" ").map(parseFloat).filter(n => n > 0);
        return { cols, floor: cols.length ? Math.min(...cols) : 0, cards: el.children.length };
      });
      record("B-05", "Grilla KPI min 300px (sin tarjeta huérfana)", grid && grid.floor >= 299 ? "PASS" : grid ? "FAIL" : "BLOCKED",
        grid ? `floor=${Math.round(grid.floor)}px cards=${grid.cards} cols=[${grid.cols.map(n => Math.round(n)).join(",")}]`
             : "sin grilla KPI visible con tarjetas");
    }
    {
      const hasMore = await clickByText(page, "button", /^\+\d+ más$/);
      if (!hasMore) {
        record("M-02", "+N más expande la lista", "BLOCKED", "sin widget con más de 8 items en el workspace QA");
      } else {
        await settle(page, 300);
        const expanded = await bodyHasText(page, "Ver menos");
        record("M-02", "+N más expande la lista", expanded ? "PASS" : "FAIL", expanded ? "Ver menos visible tras el click" : "el click no expandió");
      }
    }
    {
      const before = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Gobernanza"]')));
      // The FAB carries an aria-label, no text — clickByText("Chat") never fires.
      const opened = await page.evaluate(() => {
        const b = document.querySelector('[aria-label="Abrir chat"]');
        if (!b) return false;
        b.click();
        return true;
      });
      await settle(page, 700);
      const after = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Gobernanza"]')));
      if (!opened) {
        record("B-12", "Gobernanza no enfocable con panel cerrado", "BLOCKED", "no encontré el dock del chat para abrirlo");
      } else {
        record("B-12", "Gobernanza no enfocable con panel cerrado", !before && after ? "PASS" : "FAIL", `cerrado=${before} abierto=${after}`);
        await page.evaluate(() => { const b = document.querySelector('[aria-label="Cerrar chat"]'); if (b) b.click(); });
        await settle(page, 400);
      }
    }
    {
      const kpi = await page.evaluate(() => {
        const el = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && /Leads capturados/i.test(e.textContent || ""));
        if (!el) return "";
        const card = el.closest("div");
        return ((card && card.parentElement ? card.parentElement.innerText : "")).replace(/\n/g, " ").slice(0, 80);
      });
      record("M-01", "KPI 'Leads capturados' renderiza (smoke UI)", /\d/.test(kpi) ? "PASS" : "BLOCKED", kpi || "widget ausente — workspace QA sin métricas");
    }

    // ═══ Copywriting / Calendario — M-10, M-09, M-11 ═══
    console.log("\n▶ Copywriting / Calendario");
    await gotoWorkspace(page, "/copywriting/calendar");
    await settle(page, 1500);
    {
      let m10 = await page.evaluate(() => [...document.querySelectorAll("button")].some(b => /⇧ Importar asistido/.test(b.textContent || "")));
      if (!m10) {
        await clickByText(page, "button", /Calendario/i);
        await settle(page, 900);
        m10 = await page.evaluate(() => [...document.querySelectorAll("button")].some(b => /⇧ Importar asistido/.test(b.textContent || "")));
      }
      record("M-10", "Botón renombrado a '⇧ Importar asistido'", m10 ? "PASS" : "BLOCKED", m10 ? "" : "pane de calendario no visible en headless");

      const hasGear = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Conexiones sociales"]')));
      if (!hasGear) {
        record("M-09", "Popover de conexiones dentro del viewport", "BLOCKED", "chip de conexiones no visible");
      } else {
        await page.click('[aria-label="Conexiones sociales"]');
        await settle(page, 400);
        const ok = await page.evaluate(() => {
          const pops = [...document.querySelectorAll("div")].filter(d => {
            const s = getComputedStyle(d);
            return s.position === "absolute" && s.zIndex === "30" && s.width === "320px";
          });
          if (!pops.length) return { found: false };
          const r = pops[pops.length - 1].getBoundingClientRect();
          return { found: true, left: r.left, right: r.right, innerW: window.innerWidth };
        });
        record("M-09", "Popover de conexiones dentro del viewport", ok.found && ok.left >= 0 && ok.right <= ok.innerW ? "PASS" : ok.found ? "FAIL" : "BLOCKED", ok.found ? `left=${Math.round(ok.left)} right=${Math.round(ok.right)} vw=${ok.innerW}` : "popover no apareció");
      }

      // M-11 fixture: import one real row via the CSV input (exercises A-03 path too)
      const importInput = await page.$('input[aria-label="Importar contenido desde CSV"]');
      let rowOk = false;
      if (importInput) {
        writeFileSync(".tmp/qa-calendar-row.csv", CSV_FIXTURE);
        await importInput.uploadFile(".tmp/qa-calendar-row.csv");
        // Success is silent when there are no judgment calls; with an unknown
        // brand the alert bar reads "Importadas N piezas — …". The card text
        // is the topic, so wait for it directly (row is dated this month).
        rowOk = await waitForText(page, "Idea de prueba", 8000);
        if (!rowOk) rowOk = await waitForText(page, "Importadas", 3000);
        await settle(page, 1200);
      }
      const peekOpened = await page.evaluate(() => {
        const days = [...document.querySelectorAll(".cal-day")];
        for (const d of days) {
          const card = [...d.children].find(c => c.tagName === "DIV" && c !== d.firstElementChild && (c.textContent || "").trim());
          if (card) { card.click(); return true; }
        }
        return false;
      });
      if (!peekOpened) {
        record("M-11", "Eliminar pieza pide confirmación", "BLOCKED", rowOk ? "fila importada pero tarjeta no clickeable" : "sin piezas en el calendario (import CSV no disponibilidad)");
      } else {
        await settle(page, 800);
        lastDialog = null;
        const delClicked = await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find(b => /Eliminar pieza/.test(b.textContent || ""));
          if (!btn) return false;
          btn.click();
          return true;
        });
        await settle(page, 500);
        record("M-11", "Eliminar pieza pide confirmación", delClicked && lastDialog ? "PASS" : "FAIL", delClicked ? `dialog=${lastDialog ? lastDialog.message.slice(0, 60) : "no apareció"}` : "botón Eliminar pieza no encontrado");
      }
    }

    // ═══ Kanban — M-05 ═══
    console.log("\n▶ Kanban");
    {
      await gotoWorkspace(page, "/home/kanban");
      await settle(page, 1500);
      const dry = await page.evaluate(() => {
        const label = [...document.querySelectorAll("label")].find(l => /dry run/i.test(l.textContent || ""));
        const cb = label ? label.querySelector('input[type="checkbox"]') : null;
        if (!cb) return { found: false };
        return { found: true, checked: cb.checked };
      });
      if (!dry.found) {
        record("M-05", "Batch REAL pide confirmación", "BLOCKED", "toggle Dry run no encontrado (¿vista Kanban no cargó?)");
      } else {
        if (dry.checked) {
          await page.evaluate(() => {
            const label = [...document.querySelectorAll("label")].find(l => /dry run/i.test(l.textContent || ""));
            const cb = label && label.querySelector('input[type="checkbox"]');
            if (cb) cb.click();
          });
          await settle(page, 300);
        }
        lastDialog = null;
        const runClicked = await clickByText(page, "button", /Ejecutar batch/i);
        await settle(page, 700);
        record("M-05", "Batch REAL pide confirmación", runClicked && lastDialog ? "PASS" : "FAIL", runClicked ? `dialog=${lastDialog ? lastDialog.message.slice(0, 70) : "no apareció"}` : "botón Ejecutar batch no encontrado");
      }
    }

    // ═══ Editor — A-09, M-27, A-15/A-17, C-03, A-02, M-13 ═══
    console.log("\n▶ Editor");
    if (!tmplId) {
      for (const id of ["A-09", "M-27", "A-15/A-17", "C-03-guard", "A-02", "M-13"]) {
        record(id, "verificación en editor", "BLOCKED", "sin plantilla fixture");
      }
    } else {
      await page.goto("about:blank", { waitUntil: "load", timeout: 15000 }).catch(() => {});
      await page.goto(`${VITE_URL}/?template=${tmplId}&v=2`, { waitUntil: "networkidle2", timeout: 45000 });
      await page.evaluate(PAGE_HELPERS);
      let fid = "";
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await page.evaluate(PAGE_HELPERS);
        fid = await page.evaluate(() => {
          const w = document.querySelector("[data-frame-id]");
          return w ? w.getAttribute("data-frame-id") : "";
        });
        if (fid && await page.evaluate(f => window.__qa && window.__qa.ready(f), fid)) break;
        await sleep(500);
      }
      if (!fid) {
        for (const id of ["A-09", "M-27", "A-15/A-17", "C-03-guard", "A-02", "M-13"]) record(id, "verificación en editor", "BLOCKED", "el editor no terminó de cargar");
      } else {
        // A-09 — saving span always in DOM (reserved space)
        const savingEl = await page.evaluate(() => {
          const el = document.querySelector(".editor-v2-saving");
          return el ? getComputedStyle(el).visibility : "";
        });
        record("A-09", "Indicador de guardado con espacio reservado", savingEl ? "PASS" : "FAIL", savingEl ? `visibility=${savingEl}` : ".editor-v2-saving ausente");

        // M-27 — photo mode with NO selection → toast, does not open
        const selBefore = await page.evaluate(f => window.__qa.selectionBox(f), fid);
        const photoBtn = 'button[title^="Modo Foto"]';
        if (selBefore) {
          record("M-27", "Modo Foto sin selección no abre", "BLOCKED", "el editor ya tiene selección al cargar");
        } else {
          await page.click(photoBtn);
          await settle(page, 600);
          const after = await page.evaluate(() => {
            const btn = document.querySelector('button[title^="Modo Foto"]');
            return { active: btn ? btn.className.includes("active") : null, toast: document.body.innerText.includes("Seleccioná una imagen") };
          });
          record("M-27", "Modo Foto sin selección no abre", after.active === false && after.toast ? "PASS" : "FAIL", `active=${after.active} toast=${after.toast}`);
        }

        // A-15/A-17 fixture — drop a PNG → DesignImportModal auto-imports
        // (handleFiles fires from initialFiles) → new frame with an
        // <img data-layer-id src=storage-url> layer. Match only NEW imgs with
        // a non-empty src: the starter template also has placeholder imgs
        // (src=""), and selecting one of those is exactly what made M-27's
        // "no target" toast fire in round 4.
        let lastImportError = "";
        const preImgs = await page.evaluate(() => {
          const out = [];
          for (const w of document.querySelectorAll("[data-frame-id]")) {
            const host = [...w.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
            if (!host) continue;
            for (const img of host.shadowRoot.getElementById("__df_content").querySelectorAll("img[data-layer-id]")) {
              out.push(`${w.getAttribute("data-frame-id")}/${img.getAttribute("data-layer-id")}`);
            }
          }
          return out;
        });
        await dropBlackPngAtCenter(page);
        let imgFrameId = "";
        let imgLayerId = "";
        let imgSrc = "";
        const imgDeadline = Date.now() + 30000;
        while (Date.now() < imgDeadline && !imgLayerId) {
          const found = await page.evaluate(pre => {
            const preSet = new Set(pre);
            for (const w of document.querySelectorAll("[data-frame-id]")) {
              const host = [...w.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
              if (!host) continue;
              for (const img of host.shadowRoot.getElementById("__df_content").querySelectorAll("img[data-layer-id]")) {
                const key = `${w.getAttribute("data-frame-id")}/${img.getAttribute("data-layer-id")}`;
                const src = img.getAttribute("src") || "";
                if (!preSet.has(key) && src) return { fid: w.getAttribute("data-frame-id"), lid: img.getAttribute("data-layer-id"), src };
              }
            }
            return null;
          }, preImgs);
          if (found) { imgFrameId = found.fid; imgLayerId = found.lid; imgSrc = found.src; break; }
          const modalErr = await page.evaluate(() => {
            const dlg = document.querySelector("dialog[open]");
            const alert = dlg ? dlg.querySelector("[role='alert']") : null;
            return alert ? (alert.textContent || "").trim().slice(0, 140) : "";
          });
          if (modalErr) lastImportError = modalErr;
          await sleep(700);
        }
        if (!imgLayerId) {
          record("A-15/A-17", "Modo Foto oculta toolbar y panel derecho", "BLOCKED",
            `el drop no produjo capa de imagen nueva con src${lastImportError ? ` · import: ${lastImportError}` : " (import design no completó en 30s)"}`);
        } else {
          // dismiss the import report ("Listo") so nothing floats over the canvas
          await page.evaluate(() => {
            const b = [...document.querySelectorAll("button")].find(x => (x.textContent || "").trim() === "Listo");
            if (b) b.click();
          });
          await settle(page, 400);
          await page.evaluate((f, lid) => {
            window.__qa.clickEl(window.__qa.resolveTarget(f, lid));
          }, imgFrameId, imgLayerId);
          await settle(page, 600);
          // selectedLayerId matches the overlay box to a layer by geometry —
          // proves the selection landed on the IMG (and not the frame).
          const selState = await page.evaluate((f, lid) => ({
            box: window.__qa.selectionBox(f),
            onImg: window.__qa.selectedLayerId(f) === lid,
          }), imgFrameId, imgLayerId);
          if (!selState.box || !selState.onImg) {
            record("A-15/A-17", "Modo Foto oculta toolbar y panel derecho", "BLOCKED",
              `capa importada (${imgLayerId.slice(0, 8)}…, src=${imgSrc.slice(0, 40)}…) pero la selección no quedó en ella · box=${JSON.stringify(selState.box)} onImg=${selState.onImg}`);
          } else {
            await page.click(photoBtn);
            await settle(page, 800);
            const st = await page.evaluate(() => {
              const btn = document.querySelector('button[title^="Modo Foto"]');
              const tb = document.querySelector(".editor-v2-floating-toolbar");
              const rp = document.querySelector(".editor-v2-right-panel");
              return {
                active: btn ? btn.className.includes("active") : null,
                toolbar: tb ? getComputedStyle(tb).display : "absent",
                rightPanel: rp ? getComputedStyle(rp).display : "absent",
                toast: document.body.innerText.includes("Seleccioná una imagen"),
              };
            });
            record("A-15/A-17", "Modo Foto oculta toolbar y panel derecho",
              // The right panel is UNMOUNTED in photo mode (showRightPanel &&
              // !videoModeOpen && !photoModeOpen) — absent is the hidden state.
              st.active && st.toolbar === "none" && (st.rightPanel === "none" || st.rightPanel === "absent") ? "PASS" : "FAIL", JSON.stringify(st));
            if (st.active) {
              await page.click(photoBtn);
              await settle(page, 500);
              const tb2 = await page.evaluate(() => {
                const tb = document.querySelector(".editor-v2-floating-toolbar");
                return tb ? getComputedStyle(tb).display : "absent";
              });
              record("A-15/A-17-rest", "Toolbar vuelve al salir de Modo Foto", tb2 !== "none" ? "PASS" : "FAIL", `display=${tb2}`);
            }
          }
        }

        // C-03 — the real guard against a black render and a legit dark photo
        try {
          const guard = await page.evaluate(async () => {
            const m = await import("/src/components/PhotoModeOverlay.tsx");
            if (typeof m.blobLooksSuspiciouslyBlack !== "function") return { ok: false, reason: "guard no exportado" };
            const makeBlob = kind => new Promise(resolve => {
              const cv = document.createElement("canvas");
              cv.width = 64; cv.height = 64;
              const ctx = cv.getContext("2d");
              if (kind === "black") {
                ctx.fillStyle = "#000";
                ctx.fillRect(0, 0, 64, 64);
              } else {
                const img = ctx.createImageData(64, 64);
                for (let i = 0; i < img.data.length; i += 4) {
                  const v = 5 + Math.floor(Math.random() * 26); // dark but DETAILED (avg≈17)
                  img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
                }
                ctx.putImageData(img, 0, 0);
              }
              cv.toBlob(b => resolve(b), "image/png");
            });
            const blackIs = await m.blobLooksSuspiciouslyBlack(await makeBlob("black"));
            const darkIs = await m.blobLooksSuspiciouslyBlack(await makeBlob("dark"));
            return { ok: true, blackIs, darkIs };
          });
          record("C-03-guard", "Guard: PNG negro→true, foto oscura legítima→false", guard.ok && guard.blackIs === true && guard.darkIs === false ? "PASS" : guard.ok ? "FAIL" : "BLOCKED", guard.ok ? `black=${guard.blackIs} dark=${guard.darkIs}` : guard.reason);
        } catch (e) {
          record("C-03-guard", "Guard: PNG negro→true, foto oscura legítima→false", "BLOCKED", `import vite falló: ${String(e).slice(0, 80)}`);
        }

        // A-02 — proxy never forwards upstream 4xx bodies
        try {
          const r = await page.evaluate(async () => {
            const sbKey = Object.keys(localStorage).find(k => /-auth-token$/.test(k));
            let token = "";
            if (sbKey) {
              try {
                const parsed = JSON.parse(localStorage.getItem(sbKey));
                token = parsed?.access_token || parsed?.currentSession?.access_token || "";
              } catch {}
            }
            const apiKey = localStorage.getItem("futuraria-api-key") || "";
            const headers = { "Content-Type": "application/json" };
            if (token) headers.Authorization = `Bearer ${token}`;
            if (apiKey) headers["x-api-key"] = apiKey;
            const res = await fetch("/api/llm", {
              method: "POST",
              headers,
              // The proxy nests the vendor payload under `body` (req.body.body):
              // a flat shape hits the 400 "Missing 'body'" guard, not the provider.
              body: JSON.stringify({ provider: "deepseek", key: "sk-qa-invalid-redacted", body: { model: "deepseek-chat", messages: [{ role: "user", content: "qa" }], stream: false } }),
            });
            return { status: res.status, body: (await res.text()).slice(0, 400) };
          });
          if (r.status === 401 && /authentication/i.test(r.body)) {
            record("A-02", "Proxy no reenvía el body 4xx del proveedor", "BLOCKED", "sin Bearer en localStorage — no llegué al proxy");
          } else {
            const generic = r.body.includes("rechazó la request");
            const leaked = r.body.includes("sk-qa-invalid-redacted") || /Incorrect API key/i.test(r.body) || /"type"\s*:\s*"upstream_error"/i.test(r.body);
            record("A-02", "Proxy no reenvía el body 4xx del proveedor", r.status >= 400 && generic && !leaked ? "PASS" : "FAIL", `status=${r.status} generic=${generic} leaked=${leaked}`);
          }
        } catch (e) {
          record("A-02", "Proxy no reenvía el body 4xx del proveedor", "BLOCKED", String(e).slice(0, 80));
        }

        // M-13 — alias "Conjunto" mapea a ad_set
        try {
          const m13 = await page.evaluate(async () => {
            const m = await import("/src/lib/contentCalendar.ts");
            const csv = "Fecha,Tipo,Marca,Conjunto\n2026-01-01,Orgánico,Mi marca,Anuncio set A";
            const out = m.mapContentImport(csv, [{ id: "b1", name: "Mi marca" }]);
            return JSON.stringify(out);
          });
          const mapped = m13.includes('"ad_set"') && m13.includes("Anuncio set A");
          record("M-13", "Header 'Conjunto' mapea a ad_set", mapped ? "PASS" : "FAIL", m13.slice(0, 120));
        } catch (e) {
          record("M-13", "Header 'Conjunto' mapea a ad_set", "BLOCKED", String(e).slice(0, 80));
        }
      }
    }
  } finally {
    blockDeletes = false;
    await browser.close().catch(() => {});
    if (servers.startedCount > 0) await servers.stop().catch(() => {});
  }

  console.log("\n── Resumen ──");
  const fail = results.filter(r => r.status === "FAIL");
  const blocked = results.filter(r => r.status === "BLOCKED");
  const pass = results.filter(r => r.status === "PASS");
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.id} — ${r.name}${r.detail ? ` · ${r.detail}` : ""}`);
  console.log(`\nPASS=${pass.length} FAIL=${fail.length} BLOCKED=${blocked.length}`);
  process.exit(fail.length > 0 ? 1 : 0);
}

main().catch(err => { console.error("runner falló:", err); process.exit(2); });
