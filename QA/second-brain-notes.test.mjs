/** QA — Second Brain vault live (una nota viva por entidad).
 *
 * 1. Unit: splitNoteZones / humanBlock (shared/brainNoteZones.ts) — las zonas
 *    generated/agent/human se separan bien y el texto suelto cuenta como humano.
 * 2. Content: emitters wired — brainNotes escribe por service client (las RLS
 *    de v47 revocan escrituras `authenticated`), rutas registradas, hooks en
 *    brandContainer / saas / designMeta, sub-nodos de notas en brandGraph.
 * 3. E2E HTTP contra :3001 — workspace QA propio (JWT owner), marca sembrada
 *    por service key: GET entity crea la nota perezosamente, PUT human solo
 *    toca su zona y SOBREVIVE a la regeneración, el bloque human de una nota
 *    legacy `comunicacion-*` migra a `estrategia-*`, y el backfill reporta
 *    conteos. Limpieza completa vía service key.
 *
 * Run: npx tsx QA/second-brain-notes.test.mjs   (necesita API en :3001 + env)
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitNoteZones, humanBlock } from "../shared/brainNoteZones.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.error(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

// ── 1. Unit: zonas de la nota ─────────────────────────────────────
console.log("[1] brainNoteZones");
const fullBody = [
  "suelto antes",
  "<!-- generated -->",
  "HOLA-GENERADA",
  "<!-- /generated -->",
  "<!-- agent -->",
  "NOTA-IA",
  "<!-- /agent -->",
  "<!-- human -->",
  "MIS-NOTAS",
  "<!-- /human -->",
].join("\n");
const zones = splitNoteZones(fullBody);
check("generated zone extraída", zones.generated === "HOLA-GENERADA", JSON.stringify(zones.generated));
check("agent zone extraída", zones.agent === "NOTA-IA", JSON.stringify(zones.agent));
check("human zone incluye bloque + suelto", zones.human.includes("MIS-NOTAS") && zones.human.includes("suelto antes"), JSON.stringify(zones.human));
check("legacy sin fences → legacyFreeForm", splitNoteZones("texto libre viejo").legacyFreeForm === true);
check("legacy sin fences → todo es human", splitNoteZones("texto libre viejo").human === "texto libre viejo");
check("con fences → legacyFreeForm false", zones.legacyFreeForm === false);
check("humanBlock envuelve", humanBlock("hola") === "<!-- human -->\nhola\n<!-- /human -->");
check("humanBlock vacío → vacío", humanBlock("   ") === "");
check("human vacío no rompe el split", splitNoteZones("<!-- generated -->x<!-- /generated -->").human === "");

// ── 2. Content: emitters wired ────────────────────────────────────
console.log("[2] cableado del vault");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const notesSrc = read("api/src/services/brainNotes.ts");
check("brainNotes usa service client (RLS v47 revoca authenticated)", notesSrc.includes("getSupabaseAdmin"));
check("migración legacy comunicacion-*", notesSrc.includes("comunicacion-"));
const indexSrc = read("api/src/index.ts");
check("ruta entity registrada", indexSrc.includes("/api/brain-notes/entity"));
check("ruta human registrada", indexSrc.includes("/api/brain-notes/:slug/human"));
check("ruta backfill registrada", indexSrc.includes("/api/brain-notes/backfill"));
check("designMeta dispara emitArchivoNoteForTemplate", read("api/src/routes/designMeta.ts").includes("emitArchivoNoteForTemplate"));
check("brandContainer siembra el vault", read("api/src/services/brandContainer.ts").includes("emitBrandVault"));
check("save de estrategia siembra el vault", read("api/src/routes/saas.ts").includes("emitBrandVault"));
const graphSrc = read("api/src/services/brandGraph.ts");
check("brandGraph: sub-nodo CRM", graphSrc.includes("note:crm"));
check("brandGraph: sub-nodo Estrategia", graphSrc.includes("note:estrategia"));
check("brandGraph: sub-nodo Copywriting", graphSrc.includes("note:copywriting"));

// ── 3. E2E HTTP :3001 ─────────────────────────────────────────────
console.log("[3] E2E HTTP :3001");
function loadEnv(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !(k in vars)) vars[k] = v;
  }
  return vars;
}
const env = { ...loadEnv(resolve(root, ".env")), ...loadEnv(resolve(root, "api/.env")) };
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEYS;
const publishable = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const sbUrl = env.SUPABASE_URL;
const API = "http://localhost:3001";

const health = await fetch(`${API}/api/health`);
if (!health.ok) {
  console.log(`  SKIP e2e — API no disponible (${health.status}). Sube :3001 para el e2e completo.`);
} else {
  const email = `qa-vault-${Date.now()}@example.com`;
  const password = `Qa!${randomBytes(6).toString("hex")}A1`;
  const svcHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", "User-Agent": "musa-qa/1.0" };
  const authHeaders = { "Content-Type": "application/json; charset=utf-8", Authorization: "", "User-Agent": "musa-qa/1.0" };
  let qaUserId = null;

  // Workspace propio de QA: el vault nunca toca datos de usuarios reales.
  const userRes = await fetch(`${sbUrl}/auth/v1/admin/users`, {
    method: "POST", headers: svcHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await userRes.json();
  qaUserId = user?.id || null;
  check("QA user creado", Boolean(qaUserId));

  const tokenRes = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: publishable, "Content-Type": "application/json", "User-Agent": "musa-qa/1.0" },
    body: JSON.stringify({ email, password }),
  });
  const jwt = (await tokenRes.json())?.access_token;
  check("JWT emitido", Boolean(jwt));

  if (qaUserId && jwt) {
    authHeaders.Authorization = `Bearer ${jwt}`;
    // Workspace propio de QA, sembrado por service key: la RLS viva rechaza
    // INSERT user-scoped en workspaces (se provisionan por trigger de signup),
    // y el vault nunca debe tocar datos de usuarios reales.
    const wsName = `QA Second Brain ${Date.now()}`;
    const wsId = crypto.randomUUID();
    const wsRes = await fetch(`${sbUrl}/rest/v1/workspaces`, {
      method: "POST", headers: svcHeaders,
      body: JSON.stringify({
        id: wsId, name: wsName, slug: `qa-second-brain-${Date.now()}`,
        owner_id: qaUserId, data: {}, updated_at: new Date().toISOString(),
      }),
    });
    check("workspace QA sembrado", wsRes.status === 201, `HTTP ${wsRes.status}`);

    if (wsId) {
      // Marca sembrada directo por service key — id `brand_<hex>` como en el
      // CRM real (regresión: la ruta no debe exigir brandId uuid).
      const brandName = `QA Vault ${Date.now()}`;
      const slugPart = brandName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const brandId = `brand_${randomBytes(10).toString("hex")}`;
      const marcaSlug = `marca-${slugPart}`;
      const crmSlug = `crm-${slugPart}`;
      const estrategiaSlug = `estrategia-${slugPart}`;

      const brandRes = await fetch(`${sbUrl}/rest/v1/brands`, {
        method: "POST", headers: svcHeaders,
        body: JSON.stringify({ id: brandId, workspace_id: wsId, name: brandName, relationship_status: "client" }),
      });
      check("marca QA sembrada", brandRes.status === 201, `HTTP ${brandRes.status}`);

      // Nota legacy comunicacion-* con bloque human — la primera emisión de
      // estrategia-* debe migrarlo.
      const legacyRes = await fetch(`${sbUrl}/rest/v1/brain_notes`, {
        method: "POST", headers: svcHeaders,
        body: JSON.stringify({
          workspace_id: wsId, slug: `comunicacion-${slugPart}`,
          title: `Comunicación: ${brandName}`,
          body_md: "<!-- human -->\nLEGADO-QA-MARKER: tono irónico, sin emojis\n<!-- /human -->",
          links: [], entity_type: "communication", entity_id: brandId, source: "system",
        }),
      });
      check("nota legacy comunicacion-* sembrada", legacyRes.status === 201, `HTTP ${legacyRes.status}`);

      const entityUrl = (kind) => `${API}/api/brain-notes/entity?workspaceId=${wsId}&kind=${kind}&brandId=${brandId}`;

      // Lectura perezosa: el primer GET crea la nota desde las tablas fuente.
      const marcaRes = await fetch(entityUrl("marca"), { headers: authHeaders });
      const marcaBody = await marcaRes.json().catch(() => null);
      check("GET entity marca → 200", marcaRes.status === 200, `HTTP ${marcaRes.status} ${marcaBody?.error || ""}`);
      check("nota marca creada perezosamente", Boolean(marcaBody?.data?.note?.bodyMd));
      check("slug marca correcto", marcaBody?.data?.slug === marcaSlug, `got ${marcaBody?.data?.slug}`);
      check("zona generated presente", String(marcaBody?.data?.note?.bodyMd || "").includes("<!-- generated -->"));

      // CRM: backlinks apuntan a la nota marca (la marca enlaza [[crm-…]]).
      const crmRes = await fetch(entityUrl("crm"), { headers: authHeaders });
      const crmBody = await crmRes.json().catch(() => null);
      check("GET entity crm → 200 con nota", crmRes.status === 200 && Boolean(crmBody?.data?.note?.bodyMd), `HTTP ${crmRes.status}`);
      check("backlinks del crm incluyen la marca", (crmBody?.data?.backlinks || []).some((b) => b.slug === marcaSlug));

      // Copywriting corre sin estrategia guardada (voice vacío, nota igual).
      const copyRes = await fetch(entityUrl("copywriting"), { headers: authHeaders });
      check("GET entity copywriting → 200 con nota", copyRes.status === 200 && Boolean((await copyRes.json().catch(() => null))?.data?.note), `HTTP ${copyRes.status}`);

      // Rama Archivos: índice de fichas con wikilinks a cada archivo-*.
      const archRes = await fetch(entityUrl("archivos"), { headers: authHeaders });
      const archBody = await archRes.json().catch(() => null);
      check("GET entity archivos → 200 con nota", archRes.status === 200 && Boolean(archBody?.data?.note?.bodyMd), `HTTP ${archRes.status} ${archBody?.error || ""}`);

      // PUT human: merge SOLO de la zona humana.
      const putRes = await fetch(`${API}/api/brain-notes/${encodeURIComponent(marcaSlug)}/human`, {
        method: "PUT", headers: authHeaders,
        body: JSON.stringify({ workspaceId: wsId, humanMd: "HUMAN-QA-MARKER\n- idea de campaña: noir" }),
      });
      const putBody = await putRes.json().catch(() => null);
      check("PUT human → 200", putRes.status === 200, `HTTP ${putRes.status} ${putBody?.error || ""}`);

      // Regeneración (otro GET): el human sobrevive junto al generated nuevo.
      const marcaRes2 = await fetch(entityUrl("marca"), { headers: authHeaders });
      const marcaBody2 = await marcaRes2.json().catch(() => null);
      const body2 = String(marcaBody2?.data?.note?.bodyMd || "");
      check("regeneración conserva el human", body2.includes("HUMAN-QA-MARKER"));
      check("regeneración reconstruye el generated", body2.includes("<!-- generated -->"));

      // Migración legacy: estrategia-* lleva el human de comunicacion-*.
      const estRes = await fetch(entityUrl("estrategia"), { headers: authHeaders });
      const estBody = await estRes.json().catch(() => null);
      check("GET entity estrategia → 200", estRes.status === 200, `HTTP ${estRes.status}`);
      check("slug estrategia correcto", estBody?.data?.slug === estrategiaSlug, `got ${estBody?.data?.slug}`);
      check("human legacy migrado a estrategia-*", String(estBody?.data?.note?.bodyMd || "").includes("LEGADO-QA-MARKER"));

      // Backfill: bóveda completa del workspace, con conteos.
      const bfRes = await fetch(`${API}/api/brain-notes/backfill`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ workspaceId: wsId }),
      });
      const bfBody = await bfRes.json().catch(() => null);
      check("backfill → 200", bfRes.status === 200, `HTTP ${bfRes.status} ${bfBody?.error || ""}`);
      check("backfill cubre la marca (≥7 notas)", (bfBody?.data?.brands || 0) >= 1 && (bfBody?.data?.notes || 0) >= 7, JSON.stringify(bfBody?.data));

      // Limpieza (service key): notas → marca → members → workspace → user.
      const nDel = await fetch(`${sbUrl}/rest/v1/brain_notes?workspace_id=eq.${wsId}`, { method: "DELETE", headers: svcHeaders });
      console.log(`  cleanup: brain_notes HTTP ${nDel.status}`);
      const bDel = await fetch(`${sbUrl}/rest/v1/brands?id=eq.${brandId}`, { method: "DELETE", headers: svcHeaders });
      console.log(`  cleanup: brand HTTP ${bDel.status}`);
      const mDel = await fetch(`${sbUrl}/rest/v1/workspace_members?workspace_id=eq.${wsId}`, { method: "DELETE", headers: svcHeaders });
      console.log(`  cleanup: members HTTP ${mDel.status}`);
      const wDel = await fetch(`${sbUrl}/rest/v1/workspaces?id=eq.${wsId}`, { method: "DELETE", headers: svcHeaders });
      console.log(`  cleanup: workspace HTTP ${wDel.status}`);
    }
  }
  if (qaUserId) {
    const userDel = await fetch(`${sbUrl}/auth/v1/admin/users/${qaUserId}`, { method: "DELETE", headers: svcHeaders });
    console.log(`  cleanup: user HTTP ${userDel.status}`);
  }
}

console.log(`\nRESULTADO: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
