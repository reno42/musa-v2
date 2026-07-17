import assert from "node:assert/strict";
import test from "node:test";
import { store } from "../api/src/services/store.ts";

// ── Trash / Soft-delete: Papelera con deleted_at ──

// Setup: create templates to work with
const tpl = store.createTemplate({
  workspaceId: "test_ws",
  name: "Trash Test Template",
  userId: "user_1",
});
const tpl2 = store.createTemplate({
  workspaceId: "test_ws",
  name: "Trash Test Template 2",
  userId: "user_1",
});

test("soft-delete sets deletedAt and template disappears from listings", () => {
  const ok = store.deleteTemplate(tpl.id);
  assert.equal(ok, true);
  const deleted = store.getTemplate(tpl.id);
  assert.ok(deleted);
  assert.ok(deleted.metadata.deletedAt, "deletedAt should be set");

  // Should NOT appear in normal listing
  const { data } = store.listTemplates("test_ws");
  const found = data.find(t => t.id === tpl.id);
  assert.equal(found, undefined, "soft-deleted template should not appear in listTemplates");
});

test("trash listing shows soft-deleted templates", () => {
  const trash = store.listTrash();
  const found = trash.find(t => t.id === tpl.id);
  assert.ok(found, "soft-deleted template should appear in trash");
  assert.ok(found.metadata.deletedAt);
});

test("restore clears deletedAt and template reappears in listings", () => {
  const ok = store.restoreTemplate(tpl.id);
  assert.equal(ok, true);

  const restored = store.getTemplate(tpl.id);
  assert.ok(restored);
  assert.equal(restored.metadata.deletedAt, undefined, "deletedAt should be cleared");

  // Should appear in normal listing again
  const { data } = store.listTemplates("test_ws");
  const found = data.find(t => t.id === tpl.id);
  assert.ok(found, "restored template should appear in listTemplates");

  // Should NOT appear in trash
  const trash = store.listTrash();
  const inTrash = trash.find(t => t.id === tpl.id);
  assert.equal(inTrash, undefined, "restored template should not appear in trash");
});

test("restore non-deleted template returns false", () => {
  // tpl is already restored from previous test
  const ok = store.restoreTemplate(tpl.id);
  assert.equal(ok, false, "restoring a non-deleted template should return false");
});

test("permanent purge removes template completely", () => {
  // Soft-delete tpl2 first
  store.deleteTemplate(tpl2.id);
  assert.ok(store.listTrash().find(t => t.id === tpl2.id));

  // Purge it
  const ok = store.purgeTemplate(tpl2.id);
  assert.equal(ok, true);

  // Should be gone from everywhere
  assert.equal(store.getTemplate(tpl2.id), undefined);
  assert.equal(store.listTrash().find(t => t.id === tpl2.id), undefined);
});

test("purge non-existent template returns false", () => {
  const ok = store.purgeTemplate("nonexistent_id");
  assert.equal(ok, false);
});

test("purgeExpiredTemplates only removes templates older than threshold", () => {
  // Create a fresh template and soft-delete it (deletedAt = now)
  const fresh = store.createTemplate({
    workspaceId: "test_ws",
    name: "Fresh Trash",
    userId: "user_1",
  });
  store.deleteTemplate(fresh.id);

  // Manually backdate deletedAt to 31 days ago
  const t = store.getTemplate(fresh.id);
  t.metadata.deletedAt = new Date(Date.now() - 31 * 86400000).toISOString();

  // Create another freshly deleted (deletedAt = now)
  const recent = store.createTemplate({
    workspaceId: "test_ws",
    name: "Recent Trash",
    userId: "user_1",
  });
  store.deleteTemplate(recent.id);

  // Purge with 30-day threshold
  const count = store.purgeExpiredTemplates(30);
  assert.ok(count >= 1, "should purge at least the expired one");

  // Expired one should be gone
  assert.equal(store.getTemplate(fresh.id), undefined);

  // Recent one should still be in trash
  const recentInTrash = store.listTrash().find(t => t.id === recent.id);
  assert.ok(recentInTrash, "recently deleted should still be in trash");

  // Clean up recent
  store.purgeTemplate(recent.id);
});

test("delete returns false for non-existent template", () => {
  const ok = store.deleteTemplate("nonexistent_id");
  assert.equal(ok, false);
});
