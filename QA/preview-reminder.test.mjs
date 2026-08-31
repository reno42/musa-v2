import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isPreviewSnoozeDays,
  isPreviewStale,
  shouldShowPreviewReminder,
} from "../shared/previewReminder.ts";

const today = new Date(2026, 7, 31, 12, 0, 0);
const editorSource = readFileSync(new URL("../src/pages/EditorV2.tsx", import.meta.url), "utf8");

test("only supported snooze durations are accepted", () => {
  assert.equal(isPreviewSnoozeDays(1), true);
  assert.equal(isPreviewSnoozeDays(30), true);
  assert.equal(isPreviewSnoozeDays(4), false);
  assert.equal(isPreviewSnoozeDays(Number.NaN), false);
});

test("the snooze duration stays interactive before the opt-in checkbox is checked", () => {
  const selectorStart = editorSource.indexOf('id="preview-snooze-days"');
  const selectorEnd = editorSource.indexOf("</select>", selectorStart);
  const selector = editorSource.slice(selectorStart, selectorEnd);

  assert.ok(selectorStart >= 0, "the preview snooze selector must exist");
  assert.doesNotMatch(selector, /disabled=\{!snoozeEnabled/);
  assert.match(selector, /disabled=\{savingSnooze\}/);
  assert.match(selector, /setSnoozeEnabled\(true\)/);
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
