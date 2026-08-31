import assert from "node:assert/strict";
import test from "node:test";
import {
  isPreviewSnoozeDays,
  isPreviewStale,
  shouldShowPreviewReminder,
} from "../shared/previewReminder.ts";

const today = new Date(2026, 7, 31, 12, 0, 0);

test("only supported snooze durations are accepted", () => {
  assert.equal(isPreviewSnoozeDays(1), true);
  assert.equal(isPreviewSnoozeDays(30), true);
  assert.equal(isPreviewSnoozeDays(4), false);
  assert.equal(isPreviewSnoozeDays(Number.NaN), false);
});

test("a design changed after its cover was captured is stale", () => {
  assert.equal(isPreviewStale("2026-08-31T12:00:00Z", "2026-08-30T12:00:00Z"), true);
});

test("a current cover is not stale", () => {
  assert.equal(isPreviewStale("2026-08-30T12:00:00Z", "2026-08-31T12:00:00Z"), false);
});

test("a design with no capture asks for its first preview", () => {
  assert.equal(isPreviewStale("2026-08-31T12:00:00Z", null), true);
});

test("an active snooze suppresses the reminder", () => {
  const params = {
    designUpdatedAt: "2026-08-31T12:00:00Z",
    coverCapturedAt: "2026-08-30T12:00:00Z",
    now: today,
  };
  assert.equal(shouldShowPreviewReminder({ ...params, snoozedUntil: null }), true);
  assert.equal(shouldShowPreviewReminder({ ...params, snoozedUntil: "2026-09-01T12:00:00Z" }), false);
});

test("the reminder returns after the snooze expires", () => {
  assert.equal(shouldShowPreviewReminder({
    designUpdatedAt: "2026-08-31T12:00:00Z",
    coverCapturedAt: "2026-08-30T12:00:00Z",
    snoozedUntil: "2026-08-31T11:59:59Z",
    now: today,
  }), true);
});
