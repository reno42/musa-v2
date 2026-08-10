/**
 * The Content Machine round trip: sheet → CSV → someone else's spreadsheet →
 * back. The id column is what makes the return leg recognisable, so most of
 * this is about ids surviving software that does not know it should keep them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ID_COLUMN, parseCSV, toCSV, rowsFromCsv, allColumns, newRowId, emptyRow, looksLikeUrl,
} from "../src/lib/contentSheet.ts";

const sheet = (rows) => rows.map(([id, values]) => ({ id, values }));

test("a downloaded sheet leads with the id column", () => {
  const csv = toCSV(["Headline", "Subtitle"], sheet([
    ["r-abc", { Headline: "Hola", Subtitle: "Mundo" }],
  ]));
  const [header, first] = csv.trim().split("\n");
  assert.equal(header, '"id","Headline","Subtitle"');
  assert.equal(first, '"r-abc","Hola","Mundo"');
});

test("a sheet that comes back keeps the ids it left with", () => {
  const original = sheet([
    ["r-uno", { Headline: "A" }],
    ["r-dos", { Headline: "B" }],
  ]);
  const returned = rowsFromCsv(parseCSV(toCSV(["Headline"], original)), ["Headline"]);
  assert.deepEqual(returned.map(r => r.id), ["r-uno", "r-dos"]);
  assert.deepEqual(returned.map(r => r.values.Headline), ["A", "B"]);
});

test("a file with no id column still loads, with fresh ids", () => {
  const rows = rowsFromCsv(parseCSV('"Headline"\n"Escrito a mano"\n'), ["Headline"]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^r-/);
  assert.equal(rows[0].values.Headline, "Escrito a mano");
});

test("duplicated ids are re-issued rather than colliding", () => {
  const rows = rowsFromCsv(parseCSV('"id","Headline"\n"r-x","A"\n"r-x","B"\n'), ["Headline"]);
  assert.equal(rows[0].id, "r-x");
  assert.notEqual(rows[1].id, "r-x", "the second row cannot answer to the same id");
});

test("a column the writer added survives the trip back", () => {
  const rows = rowsFromCsv(
    parseCSV('"id","Headline","Nota del redactor"\n"r-1","A","revisar tono"\n'),
    ["Headline"],
  );
  assert.equal(rows[0].values["Nota del redactor"], "revisar tono");
  assert.deepEqual(allColumns(["Headline"], rows), ["Headline", "Nota del redactor"]);
});

test("commas, quotes and newlines survive a round trip", () => {
  const messy = { Headline: 'Dijo "hola", y se fue', Body: "linea uno\nlinea dos" };
  const csv = toCSV(["Headline", "Body"], sheet([["r-1", messy]]));
  const back = rowsFromCsv(parseCSV(csv), ["Headline", "Body"]);
  assert.equal(back[0].values.Headline, messy.Headline);
  assert.equal(back[0].values.Body, messy.Body);
});

test("ids are unique across rapid creation", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRowId()));
  assert.equal(ids.size, 200);
});

test("a new row starts with every column present and empty", () => {
  const row = emptyRow(["A", "B"]);
  assert.deepEqual(row.values, { A: "", B: "" });
  assert.match(row.id, /^r-/);
});

test("an empty sheet is not mistaken for data", () => {
  assert.deepEqual(parseCSV(""), { headers: [], rows: [] });
  assert.deepEqual(parseCSV('"id","Headline"\n'), { headers: [], rows: [] });
});

test("only http(s) values are treated as a link to fetch", () => {
  assert.equal(looksLikeUrl("https://images.unsplash.com/photo-1.jpg"), true);
  assert.equal(looksLikeUrl("  http://example.com/a.png  "), true);
  assert.equal(looksLikeUrl("Un titular cualquiera"), false);
  assert.equal(looksLikeUrl("data:image/png;base64,AAA"), false);
  assert.equal(looksLikeUrl("file:///etc/passwd"), false);
  assert.equal(looksLikeUrl(""), false);
});

test("the id column name is the one the CSV writes", () => {
  assert.equal(ID_COLUMN, "id");
});
