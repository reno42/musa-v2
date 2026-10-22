import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static contract tests for the referral feature (v76). They pin the wiring
// that keeps the feature honest: the DB minting trigger, the API guards and
// reward math, the capture/redeem loop, the signup field rules, and the
// onboarding share step. Runtime behavior belongs to QA harness sessions.

const migration = fs.readFileSync("supabase_migrations_v76.sql", "utf8");
const api = fs.readFileSync("api/src/routes/saas.ts", "utf8");
const lib = fs.readFileSync("src/lib/referral.ts", "utf8");
const authScreen = fs.readFileSync("src/components/AuthScreen.tsx", "utf8");
const auth = fs.readFileSync("src/lib/auth.tsx", "utf8");
const tour = fs.readFileSync("src/components/OnboardingTour.tsx", "utf8");
const dashboard = fs.readFileSync("src/components/Dashboard.tsx", "utf8");
const editor = fs.readFileSync("src/pages/EditorV2.tsx", "utf8");

test("migration v76 adds referral columns, unique code index and the minting trigger", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS referral_code TEXT/);
  assert.match(migration, /referred_by UUID/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_referral_code/);
  assert.match(migration, /CREATE TRIGGER trg_assign_referral_code/);
  assert.match(migration, /BEFORE INSERT ON user_profiles/);
  assert.match(migration, /generate_referral_code/);
  // Backfill for pre-v76 profiles.
  assert.match(migration, /WHERE referral_code IS NULL/);
  // Collision ladder terminates: 3 digits, then 4, then hex escape hatch.
  assert.match(migration, /tries > 10/);
  assert.match(migration, /tries > 20/);
});

test("API exposes redeem + summary with guards and the reward math", () => {
  assert.match(api, /referral_code, referred_by, referred_at/);
  assert.match(api, /accountRoutes\.post\("\/referral\/redeem"/);
  assert.match(api, /accountRoutes\.get\("\/referral\/summary"/);
  assert.match(api, /CODE_NOT_FOUND/);
  assert.match(api, /SELF_REFERRAL/);
  assert.match(api, /ALREADY_REFERRED/);
  // Atomic claim — concurrent double redemption is impossible.
  assert.match(api, /\.is\("referred_by", null\)/);
  // Reward: 30 days per credited referral, capped at 365.
  assert.equal(api.match(/REFERRAL_REWARD_DAYS = (\d+)/)?.[1], "30");
  assert.equal(api.match(/REFERRAL_REWARD_CAP_DAYS = (\d+)/)?.[1], "365");
  assert.match(api, /Math\.min\(creditedCount \* REFERRAL_REWARD_DAYS, REFERRAL_REWARD_CAP_DAYS\)/);
  // Brute-force guard on guesses (name + 3 digits is guessable-ish).
  assert.match(api, /REFERRAL_ATTEMPTS_LIMIT/);
  // PATCH /me allowlist must never accept referral fields (immutable, like NDA).
  const allowed = api.match(/const allowed = \[([^\]]*)\] as const;/)?.[1] ?? "";
  assert.doesNotMatch(allowed, /referral/i);
  // Migration degrade path, same convention as v16/v36.
  assert.match(api, /PROFILE_MIGRATION_REQUIRED/);
});

test("pending referral lib captures ?ref= with a TTL and redeems post-bootstrap", () => {
  assert.match(lib, /futuraria:referral-pending/);
  assert.match(lib, /REFERRAL_CODE_RE = \/\^\[A-Z0-9\]\{2,14\}\[0-9\]\{2,\}\$\//);
  assert.match(lib, /export function capturePendingReferral/);
  assert.match(lib, /export function peekPendingReferral/);
  assert.match(lib, /export function consumePendingReferral/);
  assert.match(lib, /TTL_MS/);
  assert.match(lib, /\/account\/referral\/redeem/);
  // 429 keeps the pending code for the next login; 404/409 consume it.
  assert.match(lib, /TOO_MANY_ATTEMPTS/);
});

test("App captures the ?ref= link at boot, before SPA routing rewrites the URL", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /capturePendingReferral\(\)/);
});

test("signup shows the optional code field and hides it on workspace invitations", () => {
  assert.match(authScreen, /Código de referido \(opcional\)/);
  assert.match(authScreen, /mode === "signup" && !invitation/);
  assert.match(authScreen, /isValidReferralCode\(referral\)/);
  assert.match(authScreen, /savePendingReferral\(referral\)/);
});

test("auth provider redeems the pending code right after the account bootstrap", () => {
  assert.match(auth, /void redeemPendingReferral\(\)/);
});

test("settings card renders code, counter, milestone meter and manual redeem", () => {
  assert.match(dashboard, /function ReferralCard/);
  assert.match(dashboard, /\/account\/referral\/summary/);
  assert.match(dashboard, /Has traído/);
  assert.match(dashboard, /de Musa ganados/);
  assert.match(dashboard, /REFERRAL_MILESTONES/);
  assert.match(dashboard, /profileFieldsAvailable/);
  // Un-referred users get the manual redemption form (cross-device case).
  assert.match(dashboard, /!summary\?\.referred_by/);
});

test("the guided tour is mounted on both pages and the share step sits right after the AI step", () => {
  assert.match(dashboard, /<OnboardingTour page="dashboard" referralCode=\{referralCode\}/);
  assert.match(editor, /<OnboardingTour\s*\n\s*page="editor"/);
  const ids = [...tour.matchAll(/id: "([a-z]+)", page:/g)].map(m => m[1]);
  const ai = ids.indexOf("ai");
  assert.ok(ai >= 0, "AI step must exist");
  assert.equal(ids[ai + 1], "share");
  assert.match(tour, /referralShare: true/);
  // No code → silent skip; the tour never blocks on a referral nicety.
  assert.match(tour, /current\.referralShare && !referralCode/);
  assert.match(tour, /Copiar enlace de invitación/);
});

test("editor tour actions open the panels the steps spotlight", () => {
  assert.match(editor, /"show-layers"\) setShowLayersPanel\(true\)/);
  assert.match(editor, /"show-props"\) setShowRightPanel\(true\)/);
  assert.match(editor, /"back-to-dashboard"\) onBack\(\)/);
});
