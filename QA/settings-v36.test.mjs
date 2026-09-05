// v36 — settings consolidation regression invariants.
//
// What this guards:
//   • user_profiles.prefs (JSONB) exists and /account/me merges it shallowly
//   • Dashboard settings = ONE General flow with titled bento sections; the
//     browser-local fdr_ key surface is gone (server vault only)
//   • WorkspaceConsole = four icon-only tabs (Mi cuenta, Mis integraciones,
//     Invita colegas, Invita IAs — hover shows the label)
//   • EditorV2 tool panels show key status and delegate editing to Ajustes
//     de IA (single surface), which hosts all four provider editors
//   • non-secret prefs (chatRoles, nanoBananaModel) follow the account via
//     userPrefs with localStorage as the fast path
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("v36 migration adds the non-secret prefs JSONB column", () => {
  const sql = read("supabase_migrations_v36.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
  // Secrets deliberately stay out of prefs — they live in user_api_keys.
  assert.match(sql, /user_api_keys/i);
});

test("/account/me persists prefs with a shallow merge and a 16KB cap", () => {
  const saas = read("api/src/routes/saas.ts");
  assert.match(saas, /PROFILE_EXTRA_COLUMNS = "[^"]*\bprefs/);
  assert.match(saas, /prefs must be a plain object/);
  assert.match(saas, /\{\s*\.\.\.base, \.\.\.\(incoming/);
  assert.match(saas, /prefs too large \(16KB limit\)/);
  assert.match(saas, /supabase_migrations_v36\.sql/);
});

test("Dashboard settings: one General flow of titled bento sections", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  for (const title of ["👤 Tu cuenta", "🏢 Workspace", "🔑 Claves de IA y conexiones", "⚙️ Preferencias", "📊 Uso y estado"]) {
    assert.match(dashboard, new RegExp(`bento-section-title">${title}`));
  }
  // Every provider key goes through the generic row — the browser never
  // sees a key value, only statuses.
  assert.match(dashboard, /function ProviderKeyRow/);
  assert.match(dashboard, /fetchKeyStatuses/);
  // Non-secret prefs are saved to the account, not just localStorage.
  assert.match(dashboard, /saveUserPrefs\(\{ chatRoles \}\)/);
  assert.match(dashboard, /saveUserPrefs\(\{ nanoBananaModel: model \}\)/);
});

test("WorkspaceConsole keeps exactly four icon tabs: Mi cuenta, Mis integraciones, Invita colegas, Invita IAs", () => {
  const ws = read("src/components/WorkspaceConsole.tsx");
  const dashboard = read("src/components/Dashboard.tsx");
  // v53: four sections, icon-only buttons whose label shows on hover (title),
  // the same pattern as the CRM nav.
  assert.match(ws, /id: "account",\s*label: "Mi cuenta"/);
  assert.match(ws, /id: "integrations",\s*label: "Mis integraciones"/);
  assert.match(ws, /id: "humans",\s*label: "Invita colegas"/);
  assert.match(ws, /id: "ais",\s*label: "Invita IAs"/);
  assert.doesNotMatch(ws, /label: "General"|label: "Agentes & MCP"|label: "Tu cuenta"|label: "Integraciones & MCPs"/);
  assert.doesNotMatch(ws, /TeamSection|AccountSection/);
  // Icon tabs reveal their label on hover.
  assert.match(ws, /title=\{tab\.label\}/);
  assert.match(ws, /"crm-nav-tab active" : "crm-nav-tab"/);
  // Mi cuenta mounts its slot; agent tooling (incl. the SKILL.md download)
  // lives in Invita IAs and MCP BYOK in Mis integraciones.
  assert.match(ws, /section === "account" && account/);
  assert.match(ws, /section === "integrations" && \(/);
  assert.match(ws, /section === "humans" && inviteHumans/);
  assert.match(ws, /section === "ais" && <AgentsSection/);
  assert.match(ws, /Descargar SKILL\.md/);
  // Dashboard feeds the heavy bento content through named slots.
  assert.match(dashboard, /account=\{\(/);
  assert.match(dashboard, /inviteHumans=\{\(/);
  assert.match(dashboard, /integrations=\{\(/);
  // v53: the shared CRM hierarchy — glass top card, serif h1, tabs in the head.
    // v54: each section presents itself — own title and descriptor; the
  // top card no longer always says «Configuración».
  assert.match(ws, /<h1 id="workspace-console-title">\{current\.title\}<\/h1>/);
    assert.match(ws, /<p>\{current\.description\}<\/p>/);
  // v55: the top card only presents — the per-section CTA and the account
  // row (email + Cerrar sesión) left the card. SKILL.md download survives
  // inside the Invita IAs panel, where the action belongs.
  assert.doesNotMatch(ws, /ctaLabel|ctaTo/);
  assert.doesNotMatch(ws, /workspace-account|crm-toolbar-push/);
  assert.match(ws, /onClick=\{\(\) => void downloadSkillMd\(setError\)\}/);
  assert.match(ws, /<div className="crm-table-card crm-contacts-top">/);
  assert.match(ws, /role="tablist" aria-label="Secciones de configuración"/);
});

test("EditorV2: tool panels show key status only — editing lives in Ajustes de IA", () => {
  const editor = read("src/pages/EditorV2.tsx");
  // The three duplicated key inputs are gone.
  assert.doesNotMatch(editor, /API Key \(Google Gemini\)|API Key \(WaveSpeedAI\)|API Key \(RunwayML\)/);
  // …replaced by a status row with a shortcut to the single surface.
  assert.ok((editor.match(/Abrir Ajustes de IA/g) || []).length >= 3, "expected the status rows in genImage, layerSplit and videoGen");
  // The AI Settings panel hosts an editor for every provider, Runway included.
  assert.match(editor, /Image → Design \(Google Gemini\)/);
  assert.match(editor, /Vectorize Image → SVG \(Quiver AI\)/);
  assert.match(editor, /Separar en Capas \(WaveSpeedAI · Seedream\)/);
  assert.match(editor, /Generar Video \(RunwayML\)/);
  // The 🍌 model choice mirrors to account prefs so settings and editor agree.
  assert.match(editor, /saveUserPrefs\(\{ nanoBananaModel: e\.target\.value \}\)/);
});

test("ChatFAB roles follow the account: prefs hydration with LS fast-path", () => {
  const chatfab = read("src/components/ChatFAB.tsx");
  assert.match(chatfab, /import \{ fetchUserPrefs, saveUserPrefs \} from "\.\.\/lib\/userPrefs";/);
  assert.match(chatfab, /roleConfigHydratedRef/);
  assert.match(chatfab, /saveUserPrefs\(\{ chatRoles: roleConfig \}\)/);
  assert.match(chatfab, /prefs\.chatRoles/);
});

test("IconPicker pulls the Unsplash key from the account store with a one-time LS migration", () => {
  const picker = read("src/components/IconPicker.tsx");
  assert.match(picker, /fetchDecryptedKey\("unsplash"\)/);
  assert.match(picker, /saveProviderKeyRemote\("unsplash", legacy\)/);
  assert.match(picker, /localStorage\.removeItem\(LS_UNSPLASH_KEY\)/);
  assert.match(picker, /deleteProviderKeyRemote\("unsplash"\)/);
});

test("NANO_BANANA_MODELS is shared from aiProviders as the single source", () => {
  const providers = read("src/lib/aiProviders.ts");
  assert.match(providers, /export const NANO_BANANA_MODELS/);
});
