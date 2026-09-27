/**
 * QA — REQ-029 Item 3: la cadena captura → timeline.
 *
 * matchCapturedContact + buildCaptureInteraction (api/src/services/crmInboxCapture.ts)
 * son puros: se prueban sin DB. El test de contrato pinta la ruta para que la
 * cadena no se pueda desmontar en silencio (match + touchpoint best-effort +
 * `matched` en la respuesta).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCaptureInteraction, isCapturedFromInbox, matchCapturedContact } from "../api/src/services/crmInboxCapture.ts";

const ROUTE_FILE = new URL("../api/src/routes/contentCalendar.ts", import.meta.url);

test("matchCapturedContact: email exacto gana y es case-insensitive", () => {
  const item = { author_email: "  Ana@Example.COM ", author_handle: "ana", author_name: "Ana Pérez" };
  const contacts = [
    { id: "by-name", tags: ["zernio"], first_name: "Ana", last_name: "Pérez" },
    { id: "by-email", tags: ["zernio"], email: "ana@example.com", first_name: "Otra", last_name: "Persona" },
  ];
  const match = matchCapturedContact(item, contacts);
  assert.equal(match.contact?.id, "by-email");
  assert.equal(match.matchedBy, "email");
});

test("matchCapturedContact: handle exacto contra las notas de captures previos", () => {
  const item = { author_handle: "@lu_insta", author_name: "Luis Ore" };
  const contacts = [
    { id: "manual", tags: [], first_name: "Luis", last_name: "Ore" }, // manual: NUNCA se pisa
    { id: "by-handle", tags: ["zernio"], notes: "Capturado desde Zernio — comentario en Instagram (@lu_insta): hola", first_name: "Luis", last_name: "Otro" },
  ];
  const match = matchCapturedContact(item, contacts);
  assert.equal(match.contact?.id, "by-handle");
  assert.equal(match.matchedBy, "handle");
});

test("matchCapturedContact: nombre completo normalizado (espacios y casing)", () => {
  const item = { author_name: "  maria   quinones " };
  const contacts = [{ id: "by-name", tags: ["zernio"], first_name: "Maria", last_name: "Quinones" }];
  const match = matchCapturedContact(item, contacts);
  assert.equal(match.contact?.id, "by-name");
  assert.equal(match.matchedBy, "name");
});

test("matchCapturedContact: ignora contactos manuales y devuelve null sin match", () => {
  const item = { author_name: "Desconocido" };
  const contacts = [
    { id: "manual", tags: [], first_name: "Desconocido" },
    { id: "otro", tags: ["zernio"], first_name: "Alguien", last_name: "Más" },
  ];
  const match = matchCapturedContact(item, contacts);
  assert.equal(match.contact, null);
  assert.equal(match.matchedBy, null);
});

test("isCapturedFromInbox: solo el tag zernio marca contacto de Bandeja", () => {
  assert.equal(isCapturedFromInbox({ tags: ["Zernio", "instagram"] }), true);
  assert.equal(isCapturedFromInbox({ tags: ["instagram"] }), false);
  assert.equal(isCapturedFromInbox({ tags: null }), false);
});

test("buildCaptureInteraction: touchpoint comentario con origen completo y fecha del item", () => {
  const item = {
    id: "inbox-1",
    kind: "comment",
    platform: "instagram",
    content: "Me interesa el servicio",
    occurred_at: "2025-09-20T15:04:05.000Z",
    raw: { permalink: "https://instagram.com/p/abc" },
  };
  const row = buildCaptureInteraction(item, { id: "contact-1", brand_id: null }, "ws-1");
  assert.equal(row.workspace_id, "ws-1");
  assert.equal(row.brand_id, null); // v58: null válido — timeline sin marca
  assert.equal(row.contact_id, "contact-1");
  assert.equal(row.interaction_type, "comentario");
  assert.equal(row.notes, "Me interesa el servicio");
  assert.equal(row.interaction_date, "2025-09-20T15:04:05.000Z"); // ocurrió cuando ocurrió
  assert.deepEqual(row.data, {
    origin: "zernio_inbox",
    platform: "instagram",
    itemId: "inbox-1",
    permalink: "https://instagram.com/p/abc",
    occurredAt: "2025-09-20T15:04:05.000Z",
  });
});

test("buildCaptureInteraction: sin permalink ni contenido no inventa nada", () => {
  const item = { id: "inbox-2", occurred_at: "2025-09-12T10:00:00.000Z", raw: { postUrl: "https://x.com/p/1" } };
  const row = buildCaptureInteraction(item, { id: "c2", brand_id: "b2" }, "ws-1");
  assert.equal(row.notes, null);
  assert.equal(row.brand_id, "b2");
  assert.equal(row.data.permalink, "https://x.com/p/1"); // postUrl como fallback
});

test("contrato de ruta: la captura matchea, deja touchpoint best-effort y responde matched", () => {
  const source = readFileSync(ROUTE_FILE, "utf8");
  const captureBlock = source.slice(source.indexOf("inbox/:itemId/capture"), source.indexOf("webhooks/zernio/:connectionId"));
  assert.match(captureBlock, /matchCapturedContact\(item, capturedContacts/);
  assert.match(captureBlock, /\.contains\("tags", \["zernio"\]\)/, "el match solo corre contra contactos capturados de la Bandeja");
  assert.match(captureBlock, /buildCaptureInteraction\(item, contact, workspaceId\)/);
  assert.match(captureBlock, /crm_interactions/);
  assert.match(captureBlock, /matched, matchedBy/, "la respuesta lleva matched para el aviso del UI");
  assert.match(captureBlock, /warning = "Contacto capturado, pero la interacción/, "pre-v58 degrada con aviso, nunca rompe la captura");
});
