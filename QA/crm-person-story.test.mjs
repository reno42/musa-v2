import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPersonStory, daysSincePerson, personLastContact, personOriginLabel } from "../src/lib/crmPerson.ts";

// REQ-030 Item 1 (CRM-002): header y timeline de la ficha comparten UNA fuente
// (la lista de interacciones de la persona). La regresión clave: aunque la
// marca tenga 4 interacciones y la persona 1, los helpers solo ven la lista
// de la persona — es imposible que el header pinte el número de la marca.
const herTimeline = [
  { id: "i1", interaction_type: "reunion", interaction_date: "2026-09-24T10:00:00Z" },
  { id: "i2", interaction_type: "comentario", interaction_date: "2026-09-12T09:00:00Z", notes: "me encanta" },
  { id: "i3", interaction_type: "comentario", interaction_date: "2026-09-20T11:30:00Z", notes: "precio?" },
];

test("personLastContact reads the person's newest touchpoint, never the brand's", () => {
  assert.equal(personLastContact(herTimeline), "2026-09-24T10:00:00Z");
  // Unordered input still yields the max (server order must not be trusted).
  assert.equal(personLastContact([...herTimeline].reverse()), "2026-09-24T10:00:00Z");
  assert.equal(personLastContact([]), null);
});

test("daysSincePerson counts whole days and tolerates garbage", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  assert.equal(daysSincePerson("2026-09-24T10:00:00Z", now), 2);
  assert.equal(daysSincePerson("2026-09-26T08:00:00Z", now), 0);
  assert.equal(daysSincePerson(null, now), null);
  assert.equal(daysSincePerson("not-a-date", now), null);
});

test("personOriginLabel only reads capture tags — manual contacts stay manual", () => {
  assert.equal(personOriginLabel(["zernio", "instagram"]), "Bandeja Zernio");
  assert.equal(personOriginLabel(["instagram"]), "Social · instagram");
  assert.equal(personOriginLabel(["lead"]), "Manual");
  assert.equal(personOriginLabel(null), "Manual");
});

test("the story counts the person's comments with first—last range", () => {
  const story = buildPersonStory({
    interactions: herTimeline,
    dealsCount: 0,
    brandName: "Zernio",
    capturedFromInbox: true,
  });
  assert.match(story, /Comentó 2 veces en contenido de Zernio/);
  // es-PE abbreviates septiembre as "set." in this ICU — match the day numbers
  // and the em-dash range instead of the month spelling.
  assert.match(story, /\(12 se\S* — 20 se\S*\)/);
  assert.match(story, /Capturado desde la Bandeja/);
  assert.match(story, /Sin deals/);
});

test("no comments falls back to total interactions; empty timeline still reads", () => {
  const noComments = buildPersonStory({
    interactions: [herTimeline[0]],
    dealsCount: 2,
    brandName: null,
  });
  assert.match(noComments, /1 interacción registrada desde 24 se\S*/);
  assert.match(noComments, /2 deals en el pipeline/);
  const empty = buildPersonStory({ interactions: [], dealsCount: 0, brandName: "Nova" });
  assert.equal(empty, "Sin deals");
});

test("CRM-002 contract: the ficha no longer mixes brand counters into the person", () => {
  const crmWorkspace = readFileSync(new URL("../src/components/CrmWorkspace.tsx", import.meta.url), "utf8");
  // The fallback that allowed the lie is gone.
  assert.doesNotMatch(crmWorkspace, /brand\.interaction_count \|\| interactions\.length/);
  // Person counters are computed from the person's own timeline...
  assert.match(crmWorkspace, /daysSincePerson\(personLastContact\(interactions\)\)/);
  // ...labeled as the person's, and the brand ficha labels its own numbers.
  assert.match(crmWorkspace, /Interacciones \(de \{fullName\}\)/);
  assert.match(crmWorkspace, /Interacciones de la marca: \$\{brand\.interaction_count\}/);
  assert.match(crmWorkspace, /Último contacto de la marca hace/);
  // The header story is built from the same interactions list (one fetch, one truth).
  assert.match(crmWorkspace, /buildPersonStory\(\{\s*\n\s*interactions,/);
});
