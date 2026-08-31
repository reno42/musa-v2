import assert from "node:assert/strict";
import test from "node:test";
import {
  isPreviewStale,
  localDayKey,
  previewReminderStorageKey,
  shouldShowPreviewReminder,
} from "../src/lib/previewReminder.ts";

const today = new Date(2026, 7, 31, 12, 0, 0);

test("a design changed after its cover was captured is stale", () => {
  assert.equal(isPreviewStale("2026-08-31T12:00:00Z", "2026-08-30T12:00:00Z"), true);
});

test("a current cover is not stale", () => {
  assert.equal(isPreviewStale("2026-08-30T12:00:00Z", "2026-08-31T12:00:00Z"), false);
});

test("a design with no capture asks for its first preview", () => {
  assert.equal(isPreviewStale("2026-08-31T12:00:00Z", null), true);
});

test("the reminder is shown at most once per local day", () => {
  const params = {
    designUpdatedAt: "2026-08-31T12:00:00Z",
    coverCapturedAt: "2026-08-30T12:00:00Z",
    now: today,
  };
  assert.equal(shouldShowPreviewReminder({ ...params, lastShownDay: null }), true);
  assert.equal(shouldShowPreviewReminder({ ...params, lastShownDay: localDayKey(today) }), false);
});

test("reminder keys are isolated by user and template", () => {
  assert.notEqual(previewReminderStorageKey("tpl_a", "user_a"), previewReminderStorageKey("tpl_a", "user_b"));
  assert.notEqual(previewReminderStorageKey("tpl_a", "user_a"), previewReminderStorageKey("tpl_b", "user_a"));
});
