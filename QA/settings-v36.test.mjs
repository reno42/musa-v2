// v36 — settings consolidation regression invariants.
//
// What this guards:
//   • user_profiles.prefs (JSONB) exists and /account/me merges it shallowly
//   • Dashboard settings = ONE General flow with titled bento sections; the
//     browser-local fdr_ key surface is gone (server vault only)
//   • WorkspaceConsole = exactly two tabs (General + Agentes & MCP)
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

test("WorkspaceConsole collapses to exactly two tabs: General + Agentes & MCP", () => {
  const ws = read("src/components/WorkspaceConsole.tsx");
  assert.match(ws, /\["general", "General"\]/);
  assert.match(ws, /\["agents", "Agentes & MCP"\]/);
  assert.doesNotMatch(ws, /\["team", "Equipo"\]|\["account", "Cuenta"\]/);
  assert.doesNotMatch(ws, /TeamSection|AccountSection/);
  // General only mounts the page's own content; agent tooling (incl. the
  // SKILL.md download) lives in the agents tab.
  assert.match(ws, /section === "general" && <>\{children\}<\/>/);
  assert.match(ws, /Descargar SKILL\.md/);
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
