// REQ-059 (bloque A) — Importador de guiones (.txt / .md / .docx) sin dependencias.
// Run with: node --experimental-strip-types --test QA/docx-text.test.mjs
//
// Los .docx de fixture se arman a mano (ZIP real, central directory incluido)
// porque el repo no tiene jszip ni mammoth: si el extractor no lee un ZIP
// genuino, el test lo nota.
import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  DOCX_DOCUMENT_PART,
  ScriptImportError,
  decodeXmlEntities,
  documentXmlToText,
  findZipEntry,
  scriptFileToText,
  stripMarkdown,
} from "../src/lib/docxText.ts";

// ── ZIP mínimo ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data, method }] → ArrayBuffer de un ZIP válido. */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data, "utf8");
    const data = entry.method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const body = Buffer.concat([...locals, ...centrals]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(body.length - offset, 12);
  eocd.writeUInt32LE(offset, 16);
  const merged = Buffer.concat([body, eocd]);
  return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.length);
}

function docxBuffer(paragraphXmlParts, method = 8) {
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphXmlParts.map(t => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("") +
    "</w:body></w:document>";
  return buildZip([
    { name: "[Content_Types].xml", data: "<Types/>", method },
    { name: "_rels/.rels", data: "<Relationships/>", method },
    { name: DOCX_DOCUMENT_PART, data: xml, method },
  ]);
}

function fileLike(name, buffer, text = "") {
  return {
    name,
    arrayBuffer: async () => buffer,
    text: async () => text,
  };
}

// ── ZIP / .docx ──────────────────────────────────────────────────────────────

test("findZipEntry lee el central directory de un ZIP real (deflate y stored)", () => {
  for (const method of [8, 0]) {
    const buf = docxBuffer(["Un párrafo."], method);
    const entry = findZipEntry(buf, DOCX_DOCUMENT_PART);
    assert.ok(entry, `method ${method}: no encontró la parte`);
    assert.equal(entry.method, method);
    assert.ok(entry.compSize > 0);
    assert.equal(findZipEntry(buf, "word/noexiste.xml"), null);
  }
});

test("scriptFileToText: .docx comprimido → texto del teleprompter", async () => {
  const buf = docxBuffer(
    ["Buenos días a todos.", "Hoy hablamos de crecimiento."],
    8,
  );
  const text = await scriptFileToText(fileLike("guion.docx", buf));
  assert.equal(text, "Buenos días a todos.\nHoy hablamos de crecimiento.");
});

test("scriptFileToText: .docx sin comprimir (method 0) da el mismo texto", async () => {
  const buf = docxBuffer(["Toma stored."], 0);
  const text = await scriptFileToText(fileLike("guion-stored.docx", buf));
  assert.equal(text, "Toma stored.");
});

test("scriptFileToText: no es un .docx → error explícito, nunca texto vacío disfrazado", async () => {
  const noDocx = buildZip([{ name: "readme.txt", data: "hola", method: 0 }]);
  await assert.rejects(
    () => scriptFileToText(fileLike("falso.docx", noDocx)),
    err => err instanceof ScriptImportError && err.code === "DOCX_NO_DOCUMENT",
  );

  await assert.rejects(
    () => scriptFileToText(fileLike("basura.docx", new Uint8Array([1, 2, 3]).buffer)),
    err => err.code === "DOCX_NO_DOCUMENT",
  );
});

test("scriptFileToText: .docx con método raro o sin texto avisa en vez de romper", async () => {
  const bzip = buildZip([{ name: DOCX_DOCUMENT_PART, data: "<w:document/>", method: 12 }]);
  await assert.rejects(
    () => scriptFileToText(fileLike("raro.docx", bzip)),
    err => err.code === "DOCX_METHOD_UNSUPPORTED",
  );

  const vacio = docxBuffer([""], 0);
  await assert.rejects(
    () => scriptFileToText(fileLike("vacio.docx", vacio)),
    err => err.code === "DOCX_EMPTY",
  );
});

// ── XML → texto ──────────────────────────────────────────────────────────────

test("documentXmlToText: párrafos, saltos, tabs y entidades", () => {
  const xml =
    "<w:p><w:r><w:t>Línea uno</w:t></w:r></w:p>" +
    '<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:tab/><w:t>C</w:t></w:r></w:p>' +
    "<w:p><w:r><w:t>D&amp;E &#8212; fr&#237;a &lt;x&gt;</w:t></w:r></w:p>";
  const text = documentXmlToText(xml);
  assert.equal(text, "Línea uno\nA\nB\tC\nD&E — fría <x>");
});

test("documentXmlToText ignora códigos de campo y attrs, y colapsa saltos", () => {
  const xml =
    '<w:p><w:r><w:instrText xml:space="preserve"> HYPERLINK "http://x" </w:instrText></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Texto real</w:t></w:r></w:p>' +
    "<w:p></w:p><w:p></w:p>" +
    '<w:p><w:r><w:t>Fin</w:t></w:r></w:p>';
  assert.equal(documentXmlToText(xml), "Texto real\nFin");
});

test("decodeXmlEntities: numéricas, nombradas y punto unicode raro", () => {
  assert.equal(decodeXmlEntities("&#x263a; &amp; &quot; &apos; &#10;"), "☺ & \" ' \n");
  // Un code point inválido se descarta en vez de tirar RangeError.
  assert.equal(decodeXmlEntities("a&#x110000;b"), "ab");
});

// ── Markdown y texto plano ───────────────────────────────────────────────────

test("stripMarkdown: deja solo lo que se dice en voz alta", () => {
  const md = [
    "# Título del guion",
    "",
    "- primer bullet",
    "* segundo bullet",
    "1. paso uno",
    "> cita bloque",
    "",
    "**Fuerte** y *itálica* y `code` y ~~tachado~~.",
    "",
    "[link](https://x.com) y ![img](https://y/z.png)",
    "",
    "```",
    "codigo que no va",
    "```",
  ].join("\n");
  const text = stripMarkdown(md);
  assert.ok(text.includes("Título del guion"));
  assert.ok(!text.includes("#"), "quedan headings");
  assert.ok(text.includes("primer bullet") && !text.includes("- primer"), "quedan bullets");
  assert.ok(text.includes("paso uno") && !text.includes("1."), "quedan listas numeradas");
  assert.ok(text.includes("cita bloque") && !text.includes(">"), "queda blockquote");
  assert.ok(text.includes("Fuerte") && text.includes("itálica") && !text.includes("**"), "queda bold/italic");
  assert.ok(text.includes("code") && !text.includes("`"), "queda inline code");
  assert.ok(text.includes("link") && text.includes("img") && !text.includes("https://"), "queda la URL");
  assert.ok(!text.includes("```"), "queda la cerca de código");
  assert.ok(!text.includes("codigo que no va"), "entra el bloque de código");
});

test("scriptFileToText: .md quita marcadores y pasa todo a LF", async () => {
  const md = await scriptFileToText(fileLike("guion.md", null, "## Encabezado\ntexto\r\nsegunda linea"));
  assert.equal(md, "Encabezado\ntexto\nsegunda linea");

  const txt = await scriptFileToText(fileLike("guion.txt", null, "una\r\ndos\r\n"));
  assert.equal(txt, "una\ndos");
});

test("scriptFileToText: .markdown es igual a .md", async () => {
  const text = await scriptFileToText(fileLike("guion.markdown", null, "**Listo**"));
  assert.equal(text, "Listo");
});
