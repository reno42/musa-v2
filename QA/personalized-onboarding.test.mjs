import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = fs.readFileSync("shared/personalizedOnboarding.ts", "utf8");
const route = fs.readFileSync("api/src/routes/onboarding.ts", "utf8");
const widget = fs.readFileSync("src/components/PersonalizedOnboardingPlan.tsx", "utf8");
const migration = fs.readFileSync("supabase_migrations/supabase_migrations_v38_personalized_onboarding.sql", "utf8");

test("personalized catalog keeps all 25 promised goals", () => {
  assert.match(catalog, /"batch-designs"/);
  assert.match(catalog, /"sales-funnel"/);
  assert.match(catalog, /"churn-risk"/);
  assert.equal((catalog.match(/^  \["/gm) || []).length, 25);
});

test("progress API preserves dismissed history and reserves observed completion for the server", () => {
  assert.match(route, /dismissed_at/);
  assert.match(route, /\.is\("dismissed_at", null\)/);
  assert.doesNotMatch(route, /z\.enum\(\["self", "system"\]\)/);
  assert.match(route, /recordObservedOnboardingCompletion/);
  assert.match(route, /completion_source: "system"/);
  assert.match(route, /completion_source/);
  assert.match(route, /\.insert\(inserted\.map/);
  assert.match(route, /goalsPayload\.safeParse\(req\.body\)/);
  assert.match(route, /status\(422\)/);
  assert.match(route, /status\(500\)/);
});

test("plan uses the application panel tokens instead of a purple glass widget", () => {
  const css = fs.readFileSync("src/index.css", "utf8");
  const plan = widget.slice(widget.indexOf("export function PersonalizedOnboardingPlan"));
  assert.match(plan, /className=\{`onboarding-plan/);
  assert.match(css, /\.onboarding-plan \{[\s\S]*var\(--bg-panel/);
  assert.match(css, /\.onboarding-plan-trigger small \{[\s\S]*#c8b898/);
  assert.doesNotMatch(plan, /#c4b5fd/);
  assert.doesNotMatch(plan, /background: "#7c3aed"/);
});

test("widget persists edits and uses guided routes without retry spam", () => {
  assert.match(widget, /\/api\/onboarding\/goals/);
  assert.match(widget, /\/api\/onboarding\/progress/);
  assert.match(widget, /GUÍA PERSONALIZADA/);
  assert.match(widget, /aria-expanded/);
  assert.match(widget, /closeRef\.current\?\.focus/);
  assert.doesNotMatch(widget, /aria-modal="true"/);
});

test("migration is private, normalized, idempotent and indexed", () => {
  assert.match(migration, /create table if not exists onboarding_progress/i);
  assert.match(migration, /primary key \(user_id, goal_id\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\) = user_id/i);
  assert.match(migration, /to authenticated/i);
  assert.match(migration, /create index if not exists/i);
  assert.match(migration, /do \$\$[\s\S]*pg_constraint[\s\S]*onboarding_progress_completion_source_check/i);
  assert.doesNotMatch(migration, /drop constraint/i);
});

test("the personalized onboarding completion is separate from the legacy welcome", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const account = fs.readFileSync("api/src/routes/saas.ts", "utf8");
  assert.match(app, /personalized_onboarding_completed !== true/);
  assert.match(account, /personalized_onboarding_completed/);
  assert.match(migration, /add column if not exists personalized_onboarding_completed/i);
});
