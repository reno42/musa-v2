/**
 * 05-first-remote-msg.mjs — ÍTEM 5: FIRST-REMOTE-MSG-LOST en PRODUCCIÓN (best effort)
 *
 * Afirmación estática: el efecto realtime se re-suscribe al cambiar selectedFrameId y
 * descarta el primer mensaje tras cada re-suscripción (EditorV2.tsx:492-499, deps
 * [templateId, selectedFrameId] en :562).
 *
 * Hallazgo previo (logs/05-bundle-check.log): el build de prod NO incluye
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY → getClient() devuelve null →
 * subscribeTemplate() devuelve null → el editor usa el FALLBACK DE POLLING (5s).
 * La vía realtime (y por tanto el bug del primer mensaje) NO es alcanzable en prod hoy.
 *
 * Este script documenta eso en vivo y verifica el comportamiento real de sincronización:
 * dos contextos (perfiles separados → localStorage aislado) abren el mismo template;
 * ctx2 edita; se mide si/cuándo ctx1 recibe el cambio vía polling.
 */
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import {
  log, ts, createTemplate, purgeTemplate,
  launchProfile, attachNetLog, openEditor, shot, layerRect,
  PROFILES,
} from "./lib.mjs";

const FRAME = "frame_a2_sync";
const LAYER = "boxS";
const NAME = "verify-a2-sync";
const frames = [{ id: FRAME, name: "Sync", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B",
  html: `<div data-layer-id="${LAYER}" data-layer-name="BoxS" style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#5EEAD4;border-radius:12px;"></div>`, css: "" }];

const results = { item: "5-FIRST-REMOTE-MSG-LOST", realtimeActiveInProd: false, syncSamples: [] };
let tplId = null;

try {
  tplId = await createTemplate(NAME, frames);

  // ctx1 y ctx2 con perfiles SEPARADOS (localStorage aislado → sync solo vía servidor)
  const b1 = await launchProfile(path.join(PROFILES, "f-sync1"));
  const b2 = await launchProfile(path.join(PROFILES, "f-sync2"));
  const p1 = await b1.newPage();
  const p2 = await b2.newPage();
  const net1 = attachNetLog(p1, "CTX1");
  const net2 = attachNetLog(p2, "CTX2");
  // ¿algún websocket a supabase en cualquiera de los dos contextos?
  const wsSeen = [];
  for (const [tag, p] of [["CTX1", p1], ["CTX2", p2]]) {
    p.on("websocket", ws => wsSeen.push({ tag, url: ws.url().replace(/apikey=[^&]+/, "apikey=REDACTED") }));
  }

  await openEditor(p1, tplId, FRAME);
  await openEditor(p2, tplId, FRAME);
  await shot(p1, "05-01-ctx1-antes");
  const r1Before = await layerRect(p1, FRAME, LAYER);
  log("ctx1 rect antes:", r1Before?.x);

  // ctx2 edita (drag +180) — el PUT de ctx2 sale a los ~2s
  const t0 = Date.now();
  await p2.evaluate((f, l) => window.__qa.dragLayer(f, l, 180, 0), FRAME, LAYER);
  const r2 = await layerRect(p2, FRAME, LAYER);
  log("ctx2 editó, rect:", r2?.x, "en", Date.now() - t0, "ms");
  await shot(p2, "05-02-ctx2-despues-de-editar");

  // Observar ctx1 cada 500ms durante 16s (polling de 5s + PUT 2s → debe llegar ≤ ~8s)
  let syncedAtMs = null;
  const deadline = Date.now() + 16000;
  while (Date.now() < deadline) {
    const r = await layerRect(p1, FRAME, LAYER);
    results.syncSamples.push({ ms: Date.now() - t0, x: r?.x });
    if (typeof r?.x === "number" && Math.abs(r.x - 280) <= 3) { syncedAtMs = Date.now() - t0; break; }
    await sleep(500);
  }
  log("ctx1 sincronizó en:", syncedAtMs, "ms (null = no llegó en 16s)");
  await shot(p1, "05-03-ctx1-despues-sync");

  // GET requests de ctx1 (polling = GET /api/templates/:id cada 5s)
  const gets1 = net1.filter(e => e.phase === "req" && e.method === "GET" && e.url.includes(`/api/templates/${tplId}`));
  const puts2 = net2.filter(e => e.phase === "req" && e.method === "PUT");
  results.evidence = {
    websocketsSupabase: wsSeen,
    ctx1PollingGets: gets1.map(e => ({ t: e.t, msTrasEdicion: e.ms - t0 })),
    ctx2Puts: puts2.map(e => ({ t: e.t, msTrasEdicion: e.ms - t0, bytes: e.bytes })),
    syncedAtMs,
  };
  log("websockets vistos:", wsSeen.length, "| polling GETs de ctx1:", gets1.length, "| PUTs de ctx2:", puts2.length);

  await b1.close();
  await b2.close();

  results.verdict = {
    realtimeConfiguredInProd: wsSeen.length > 0,
    claimReachableInProd: false, // sin cliente supabase en el build, la re-suscripción no existe en runtime
    pollingFallbackWorks: syncedAtMs !== null,
    syncLatencyMs: syncedAtMs,
  };
} catch (err) {
  results.fatal = err.message;
  log("FATAL", err.message);
} finally {
  if (tplId) log("cleanup", JSON.stringify(await purgeTemplate(tplId)));
}

console.log("\n===== RESULT ITEM-5 =====");
console.log(JSON.stringify(results, null, 2));
