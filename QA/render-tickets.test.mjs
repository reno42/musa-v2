// REQ-055 F2 — FSM de tickets de render (pura). Run with:
// node --experimental-strip-types --test QA/render-tickets.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_TIMEOUT_MS,
  claimExpired,
  claimable,
  claimTicket,
  completeTicket,
  failTicket,
  newRenderTicket,
  requeueTicket,
  RENDER_TICKET_STATES,
} from "../shared/renderTickets.ts";

const NOW = 1_700_000_000_000;

function queued(overrides = {}) {
  return {
    ...newRenderTicket({ id: "vrt_test1", projectId: "vidproj_x", workspaceId: "ws_1", nowMs: NOW }),
    ...overrides,
  };
}

test("estados espejo del CHECK de v83", () => {
  assert.deepEqual([...RENDER_TICKET_STATES], ["queued", "running", "completed", "failed"]);
  const t = queued();
  assert.equal(t.state, "queued");
  assert.equal(t.format, "mp4");
  assert.equal(t.attempts, 0);
});

test("ciclo feliz: queued → claim → complete (solo el dueño cierra)", () => {
  const claimed = claimTicket(queued(), "sess-a", NOW + 1);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.ticket.state, "running");
  assert.equal(claimed.ticket.attempts, 1);

  const closed = completeTicket(claimed.ticket, "sess-a", "renders/vrt_test1.mp4", NOW + 2);
  assert.equal(closed.ok, true);
  assert.equal(closed.ticket.state, "completed");
  assert.equal(closed.ticket.resultPath, "renders/vrt_test1.mp4");
  assert.equal(closed.ticket.error, undefined);
});

test("claim doble NO duplica: la segunda sesión pierde", () => {
  const first = claimTicket(queued(), "sess-a", NOW).ticket;
  const second = claimTicket(first, "sess-b", NOW + 1);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "NOT_CLAIMABLE");
});

test("solo el dueño del claim puede completar o fallar", () => {
  const claimed = claimTicket(queued(), "sess-a", NOW).ticket;
  const foreign = completeTicket(claimed, "sess-b", "renders/x.mp4", NOW + 1);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, "NOT_CLAIM_OWNER");

  const foreignFail = failTicket(claimed, "sess-b", "codec", NOW + 1);
  assert.equal(foreignFail.ok, false);
});

test("completed/failed ya no se reclaman; complete sin result se rechaza", () => {
  const done = completeTicket(claimTicket(queued(), "a", NOW).ticket, "a", "p.mp4", NOW + 1).ticket;
  assert.equal(claimTicket(done, "b", NOW + 2).reason, "ALREADY_COMPLETED");
  assert.equal(claimable(done, NOW + 3), false);

  const failed = failTicket(claimTicket(queued(), "a", NOW).ticket, "a", "CODEC_UNSUPPORTED", NOW + 1).ticket;
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "CODEC_UNSUPPORTED");
  assert.equal(claimTicket(failed, "b", NOW + 2).reason, "ALREADY_FAILED");

  const noResult = completeTicket(claimTicket(queued(), "a", NOW).ticket, "a", "  ", NOW + 1);
  assert.equal(noResult.ok, false);
  assert.equal(noResult.reason, "RESULT_REQUIRED");
});

test("claim expirado: re-claim por otra sesión y requeue explícito", () => {
  const stale = claimTicket(queued(), "sess-muerta", NOW).ticket;
  assert.equal(claimExpired(stale, NOW + CLAIM_TIMEOUT_MS), false, "dentro de la ventana sigue vivo");
  assert.equal(claimExpired(stale, NOW + CLAIM_TIMEOUT_MS + 1), true);

  const stolen = claimTicket(stale, "sess-b", NOW + CLAIM_TIMEOUT_MS + 1);
  assert.equal(stolen.ok, true, "un claim expirado es reclamable");
  assert.equal(stolen.ticket.claimedBy, "sess-b");
  assert.equal(stolen.ticket.attempts, 2, "el intento muerto cuenta");

  const requeued = requeueTicket(stale, NOW + CLAIM_TIMEOUT_MS + 1);
  assert.equal(requeued.ok, true);
  assert.equal(requeued.ticket.state, "queued");
  assert.equal(requeued.ticket.claimedBy, undefined);

  const fresh = claimTicket(queued(), "a", NOW).ticket;
  assert.equal(requeueTicket(fresh, NOW + 1).reason, "NOT_EXPIRED", "un claim vivo no se re-encola");
});

test("sin sesión o sin id no se reclama; mismo criterio que el RPC v83", () => {
  assert.equal(claimTicket(queued(), "  ", NOW).reason, "SESSION_REQUIRED");
  const t = queued();
  assert.equal(claimable(t, NOW), true, "queued es reclamable");
  assert.equal(claimable({ ...t, state: "running", claimedAtMs: NOW }, NOW + CLAIM_TIMEOUT_MS), false);
  assert.equal(claimable({ ...t, state: "running", claimedAtMs: NOW }, NOW + CLAIM_TIMEOUT_MS + 1), true);
});
