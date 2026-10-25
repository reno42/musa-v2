// REQ-053 F2 — saneamiento SVG allowlist (fail-closed). Run with:
// node --experimental-strip-types --test QA/motion-svg-sanitize.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAiSvg, svgDataUrl } from "../shared/motionSvgSanitize.ts";

const ROOT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">';
const GOOD = `${ROOT}<path d="M0 0L10 10" fill="#ff0000"/></svg>`;
const GRADIENT = `${ROOT}<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/></svg>`;

test("SVG válido pasa byte-idéntico y cuenta elementos", () => {
  const res = sanitizeAiSvg(GOOD);
  assert.equal(res.ok, true, JSON.stringify(res.rejected));
  assert.equal(res.svg, GOOD, "sin reescritura: orden y valores originales");
  assert.equal(res.elements, 2);
  assert.deepEqual(res.rejected, []);
});

test("gradientes y refs internas (#id) pasan — incluida url(#id) en fill", () => {
  const res = sanitizeAiSvg(GRADIENT);
  assert.equal(res.ok, true, JSON.stringify(res.rejected));
  assert.equal(res.svg, GRADIENT);
});

test("script/foreignObject/image/style y handlers on* se RECHAZAN (fail-closed, sin strip)", () => {
  for (const evil of [
    `${ROOT}<script>alert(1)</script></svg>`,
    `${ROOT}<foreignObject><p>x</p></foreignObject></svg>`,
    `${ROOT}<image href="https://evil.example/x.png"/></svg>`,
    `${ROOT}<style>path{}</style></svg>`,
    `${ROOT}<path d="M0 0" onclick="alert(1)"/></svg>`,
    `${ROOT}<path d="M0 0" style="fill:red"/></svg>`,
  ]) {
    const res = sanitizeAiSvg(evil);
    assert.equal(res.ok, false, evil);
    assert.equal(res.svg, null, "no se persiste una versión recortada");
    assert.ok(res.rejected[0].match(/FORBIDDEN|UNSAFE/), res.rejected[0]);
  }
});

test("href externo y valores con javascript: se rechazan; el fragmento #id pasa", () => {
  const ext = sanitizeAiSvg(`${ROOT}<use href="https://evil.example/x"/></svg>`);
  assert.equal(ext.ok, false);
  assert.match(ext.rejected[0], /SVG_REF_UNSAFE/);

  const js = sanitizeAiSvg(`${ROOT}<path d="M0 0" fill="javascript:alert(1)"/></svg>`);
  assert.equal(js.ok, false);
  assert.match(js.rejected[0], /VALUE_UNSAFE/);
});

test("comentarios, doctype y CDATA se rechazan", () => {
  const comment = sanitizeAiSvg(`<!-- hola -->${GOOD}`);
  assert.equal(comment.ok, false);
  assert.match(comment.rejected[0], /MARKUP_FORBIDDEN/);

  const doctype = sanitizeAiSvg(`<!DOCTYPE svg>${GOOD}`);
  assert.equal(doctype.ok, false);
});

test("raíz: debe ser <svg> con xmlns del namespace SVG", () => {
  const noRoot = sanitizeAiSvg('<path d="M0 0" xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(noRoot.ok, false);
  assert.match(noRoot.rejected[0], /ROOT_REQUIRED/);

  const noXmlns = sanitizeAiSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>');
  assert.equal(noXmlns.ok, false);
  assert.match(noXmlns.rejected[0], /XMLNS_REQUIRED/);
});

test("árbol desbalanceado o sin cerrar se rechaza", () => {
  const swapped = sanitizeAiSvg(`${ROOT}<g><path d="M0 0"/></g></svg>`.replace("</g>", "</path>"));
  assert.equal(swapped.ok, false);
  assert.match(swapped.rejected[0], /UNBALANCED/);

  const unclosed = sanitizeAiSvg(`${ROOT}<g><path d="M0 0"/></svg>`);
  assert.equal(unclosed.ok, false);
  assert.match(unclosed.rejected[0], /UNCLOSED/);
});

test("texto suelto fuera de title/desc se rechaza; dentro pasa", () => {
  const loose = sanitizeAiSvg(`${ROOT}hola<path d="M0 0"/></svg>`);
  assert.equal(loose.ok, false);
  assert.match(loose.rejected[0], /TEXT_OUTSIDE/);

  const titled = sanitizeAiSvg(`${ROOT}<title>Logo</title><path d="M0 0"/></svg>`);
  assert.equal(titled.ok, true, JSON.stringify(titled.rejected));
});

test("límites: tamaño y cantidad de elementos", () => {
  const big = sanitizeAiSvg(`${ROOT}${'<circle r="1"/>'.repeat(50)}</svg>`, { maxElements: 10 });
  assert.equal(big.ok, false);
  assert.match(big.rejected[0], /TOO_MANY_ELEMENTS/);

  const large = sanitizeAiSvg(`${ROOT}<path d="${"L10 10".repeat(20_000)}"/></svg>`, { maxBytes: 1000 });
  assert.equal(large.ok, false);
  assert.match(large.rejected[0], /TOO_LARGE/);
});

test("entrada no-string o vacía nunca lanza", () => {
  for (const bad of [null, undefined, 42, "", "   "]) {
    const res = sanitizeAiSvg(bad);
    assert.equal(res.ok, false);
    assert.equal(res.svg, null);
  }
});

test("svgDataUrl usa el patrón del catálogo y decodifica al original", () => {
  const url = svgDataUrl(GOOD);
  assert.ok(url.startsWith("data:image/svg+xml;utf8,"));
  assert.equal(decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length)), GOOD);
});
