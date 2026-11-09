// QA: importador de HTML (api/src/services/htmlImport.ts) — un solo motor para editor, MCP y API.
// Run: node --experimental-strip-types --test QA/html-import.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { prepareHtmlImport, runHtmlAssetBatch, finalizeHtmlImport, evalMedia, adaptCssToFrame, fontFamiliesIn, sniffMime } from "../api/src/services/htmlImport.ts";
import { sanitizeDesignHtml, sanitizeDesignCss } from "../api/src/services/htmlSanitize.ts";
import { openZip, mainHtmlPath } from "../api/src/services/zipReader.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const WOFF2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(40)]);

function io(over = {}) {
  const calls = { css: [], fonts: [] };
  return {
    calls,
    fetchText: async (url, kind) => { calls.css.push(url); if (over.css && over.css[url]) return { text: over.css[url], url }; throw new Error("404"); },
    googleFont: async (family) => { calls.fonts.push(family); return (over.google || ["Inter", "Playfair Display", "Montserrat", "Bebas Neue"]).includes(family) ? `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}&display=swap` : null; },
  };
}
const deps = (files = {}) => ({
  readZip: async (p) => files[p],
  fetchRemote: async () => PNG,
  persist: async (items) => Object.fromEntries(items.map((it) => [it.asset.id, `https://lnbsmnbvclxrwwcuuvud.supabase.co/storage/v1/object/sign/design-assets/ws/import_${it.asset.id}.${it.ext}?token=t`])),
});
async function full(input, opts = {}, ioOver = {}, files = {}) {
  const state = await prepareHtmlImport({ source: "html", ...input }, opts, io(ioOver));
  let guard = 0;
  while (await runHtmlAssetBatch(state, deps(files), 10)) if (++guard > 50) throw new Error("no termina");
  return { state, doc: finalizeHtmlImport(state) };
}
const EXEC = /<script|\son\w+\s*=|javascript:|<iframe|<object|<embed/i;

test("HTML generado por IA: tamaño, Google Fonts, vw→px, sin JS ni handlers", async () => {
  const html = `<!doctype html><html><head><title>Portada Lanzamiento</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap">
<style>body{margin:0;width:1080px;height:1350px;background:#0b0b0b;font-family:'Inter',sans-serif}
.hero{position:fixed;inset:0;padding:5vw}.t{font:700 64px/1.1 "Playfair Display",serif;width:50vw}</style>
<script>document.body.innerHTML='x'</script></head>
<body><div class="hero"><h1 class="t" onclick="alert(1)">Lanzamiento</h1><img src="data:image/png;base64,${PNG.toString("base64")}" onerror="alert(2)"><a href="javascript:alert(3)">x</a></div></body></html>`;
  const { state, doc } = await full({ html });
  assert.equal(doc.artboards.length, 1);
  const ab = doc.artboards[0];
  assert.equal(ab.width, 1080); assert.equal(ab.height, 1350);
  assert.equal(ab.name, "Portada Lanzamiento");
  assert.equal(ab.background, "#0b0b0b");
  assert.doesNotMatch(ab.raw.html + ab.raw.css, EXEC);
  assert.match(ab.raw.css, /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display/);
  assert.match(ab.raw.css, /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Inter/, "Inter se agrega de Google");
  assert.match(ab.raw.css, /padding:54px/); assert.match(ab.raw.css, /width:540px/);
  assert.match(ab.raw.css, /position:absolute/);
  assert.match(ab.raw.html, /src="https:\/\/lnbsmnbvclxrwwcuuvud\.supabase\.co\/storage\/v1\/object\/sign\/design-assets\//);
  assert.doesNotMatch(JSON.stringify(doc), /data:image\//);
  assert.ok(doc.warnings.some((w) => w.code === "scripts_removed"));
  assert.ok(doc.warnings.some((w) => w.code === "unsafe_removed"));
  assert.deepEqual(state.fonts.missing, []);
});

test("pack de portadas: varias secciones de tamaño fijo → un frame cada una", async () => {
  const html = `<html><head><style>body{display:flex;gap:40px;padding:40px;background:#eee}
.cover{width:1080px;height:1350px;background:#ff5e00;color:#fff} .cover h2{font-size:80px}
@media (max-width:600px){.cover h2{font-size:20px}} @media print{.cover{display:none}}</style></head>
<body><h1>Mi pack</h1><section class="cover"><h2>Uno</h2></section><section class="cover"><h2>Dos</h2></section><section class="cover" data-name="Tres final"><h2>Tres</h2></section></body></html>`;
  const { doc } = await full({ html });
  assert.equal(doc.artboards.length, 3);
  assert.deepEqual(doc.artboards.map((a) => a.name), ["Uno", "Dos", "Tres final"]);
  for (const a of doc.artboards) {
    assert.equal(a.width, 1080); assert.equal(a.height, 1350); assert.equal(a.background, "#ff5e00");
    assert.match(a.raw.html, /^<section class="cover" [^>]*style="[^"]*width:1080px;height:1350px/);
    assert.doesNotMatch(a.raw.css, /font-size:20px/, "media query que no aplica a 1080 se quita");
    assert.doesNotMatch(a.raw.css, /display:none/, "print se quita");
    assert.match(a.raw.css, /padding:0!important/, "el padding de la página no corre la portada");
  }
});

test("frames marcados con data-musa-frame y tamaño por formato", async () => {
  const html = `<body><div data-musa-frame="Historia A" style="width:1080px;height:1920px">A</div><div data-musa-frame>B</div></body>`;
  const { doc } = await full({ html }, { format: "story" });
  assert.equal(doc.artboards.length, 2);
  assert.equal(doc.artboards[0].name, "Historia A");
  assert.equal(doc.artboards[1].height, 1920);
  assert.doesNotMatch(doc.artboards[0].raw.html, /data-musa-frame/);
});

test("split single y meta musa:size", async () => {
  const html = `<head><meta name="musa:size" content="1200x628"></head><body><div style="width:300px;height:300px"></div><div style="width:300px;height:300px"></div></body>`;
  const { doc } = await full({ html }, { split: "single" });
  assert.equal(doc.artboards.length, 1);
  assert.equal(doc.artboards[0].width, 1200); assert.equal(doc.artboards[0].height, 628);
});

test("export tipo Figma (posiciones absolutas) se conserva tal cual", async () => {
  const html = `<div style="position:relative;width:1440px;height:1024px;background:#fff"><div style="position:absolute;left:120px;top:80px;width:400px;height:60px;font-family:Montserrat;font-weight:800">Título</div><div style="position:absolute;left:120px;top:200px;width:600px;height:400px;background:url('data:image/png;base64,${PNG.toString("base64")}') center/cover"></div></div>`;
  const { doc, state } = await full({ html });
  const ab = doc.artboards[0];
  assert.equal(ab.width, 1440); assert.equal(ab.height, 1024);
  assert.match(ab.raw.html, /left:120px;top:80px/);
  assert.match(ab.raw.html, /background:url\(&quot;https:\/\/lnbsmnbvclxrwwcuuvud/);
  assert.ok(state.fonts.google.includes("Montserrat"));
});

test("fuentes: alojadas, del sistema, faltantes", async () => {
  const html = `<style>@font-face{font-family:"Marca Sans";src:url("data:font/woff2;base64,${WOFF2.toString("base64")}") format("woff2")}
h1{font-family:"Marca Sans"} p{font-family:Georgia,serif} span{font-family:'Fuente Rara 2000'}</style><h1>a</h1><p>b</p><span>c</span>`;
  const { state, doc } = await full({ html });
  assert.deepEqual(state.fonts.hosted, ["Marca Sans"]);
  assert.ok(state.fonts.system.includes("Georgia"));
  assert.deepEqual(state.fonts.missing, ["Fuente Rara 2000"]);
  assert.ok(doc.warnings.some((w) => w.code === "fonts_missing"));
  assert.match(doc.artboards[0].raw.css, /@font-face\{font-family:"Marca Sans";src:url\("https:/);
  assert.equal(state.assets.find((a) => a.font)?.mime, "font/woff2");
});

test("rutas relativas sin carpeta: aviso claro, sin romper", async () => {
  const { doc } = await full({ html: `<img src="img/logo.png"><div style="background:url(fondo.jpg)"></div>` });
  const w = doc.warnings.find((x) => x.code === "assets_unresolved");
  assert.ok(w && /img\/logo\.png/.test(w.message) && /ZIP/.test(w.message));
  assert.doesNotMatch(doc.artboards[0].raw.html, /logo\.png/);
});

test("@import de Google con varios pesos no se rompe y no se trae como hoja", async () => {
  const html = `<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;800&display=swap');.cover{width:1080px;height:1350px;font-family:Montserrat}</style><div class="cover">x</div>`;
  const { doc, state } = await full({ html });
  const css = doc.artboards[0].raw.css;
  assert.match(css, /^@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat:wght@400;800&display=swap'\);/);
  assert.match(css, /\.cover\{width:1080px;height:1350px;font-family:Montserrat\}/);
  assert.deepEqual(state.fonts.missing, []);
  assert.equal(doc.artboards[0].height, 1350);
});

test("hojas externas y @import se traen y quedan dentro (con sus rutas)", async () => {
  const base = "https://ejemplo.com/landing/";
  const css = { "https://ejemplo.com/landing/css/main.css": "@import 'base.css'; .x{background:url(../img/a.png)}", "https://ejemplo.com/landing/css/base.css": "body{width:800px;height:600px;color:#123}" };
  const { doc, state } = await full({ html: `<link rel="stylesheet" href="css/main.css"><div class="x">hola</div>`, baseUrl: base, source: "url" }, {}, { css });
  assert.match(doc.artboards[0].raw.css, /color:#123/);
  assert.equal(doc.artboards[0].width, 800);
  assert.equal(state.assets[0].ref, "https://ejemplo.com/landing/img/a.png");
});

function makeZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const raw = Buffer.from(data), comp = deflateRawSync(raw), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, comp); centrals.push(ch, n); offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test("ZIP: index.html + css + imágenes + fuente, con rutas relativas", async () => {
  const zipBytes = makeZip({
    "pack/index.html": `<link rel="stylesheet" href="css/s.css"><div class="c"><img src="img/logo.png"></div><div class="c"><img src="./img/logo.png"></div>`,
    "pack/css/s.css": `@font-face{font-family:Propia;src:url(../fonts/p.woff2)} .c{width:1080px;height:1080px;font-family:Propia;background:url("../img/bg.png")}`,
    "pack/img/logo.png": PNG, "pack/img/bg.png": PNG, "pack/fonts/p.woff2": WOFF2,
    "__MACOSX/pack/._index.html": "basura",
  });
  const zip = openZip(zipBytes);
  const htmlPath = mainHtmlPath(zip);
  assert.equal(htmlPath, "pack/index.html");
  const files = {}; for (const p of zip.list()) files[p] = await zip.read(p);
  const { doc, state } = await full({ html: await zip.text(htmlPath), zip, htmlPath, source: "zip" }, {}, {}, files);
  assert.equal(doc.artboards.length, 2);
  assert.equal(state.assets.length, 3, "logo una sola vez, fondo y fuente");
  assert.ok(state.assets.every((a) => a.status === "done"));
  assert.deepEqual(state.fonts.hosted, ["Propia"]);
  assert.deepEqual(state.fonts.missing, []);
});

test("ZIP: rechaza rutas que salen de la carpeta y archivos que no son ZIP", () => {
  assert.throws(() => openZip(makeZip({ "../../etc/x.html": "x" })), /salen de su carpeta/);
  assert.throws(() => openZip(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])), /no es un ZIP/);
});

test("seguridad: vectores conocidos no sobreviven", () => {
  const vectors = [
    `<img src=x onerror=alert(1)>`,
    `<svg><style><img src=x onerror=alert(1)></style></svg>`,
    `<a href=" jAvA&#x09;script:alert(1)">x</a>`,
    `<iframe srcdoc="<script>alert(1)</script>"></iframe>`,
    `<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>`,
    `<svg><set attributeName="onmouseover" to="alert(1)"/></svg>`,
    `<object data="javascript:alert(1)"></object><embed src="x.swf">`,
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
    `<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>`,
    `<div style="background:url(javascript:alert(1));behavior:url(x.htc)">x</div>`,
    `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
    `<base href="https://malo.example/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)">`,
  ];
  for (const v of vectors) {
    const out = sanitizeDesignHtml(v);
    assert.doesNotMatch(out, /\son\w+\s*=|javascript:|<iframe|<object|<embed|<base|<meta|behavior:/i, `${v} → ${out}`);
  }
  assert.doesNotMatch(sanitizeDesignCss(`.a{color:red}</style><script>alert(1)</script>`), /</);
  assert.equal(sanitizeDesignCss(`.q::before{content:"<b>"}`), `.q::before{content:"\\3c b>"}`);
  assert.match(sanitizeDesignCss(`@import url('https://fonts.googleapis.com/css2?family=Inter');@import url(https://malo.example/x.css);`), /^@import url\('https:\/\/fonts\.googleapis\.com/);
  assert.doesNotMatch(sanitizeDesignCss(`@import url(https://malo.example/x.css);`), /malo/);
  // URLs con «;» adentro (Google Fonts con varios pesos) se reconocen enteras
  const multi = `@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;800&display=swap');\n.c{color:red}`;
  assert.equal(sanitizeDesignCss(multi), multi);
  assert.doesNotMatch(sanitizeDesignCss(`@import url('https://malo.example/a;b.css');.c{color:red}`), /malo/);
});

test("media queries y unidades de ventana", () => {
  assert.equal(evalMedia("(min-width: 768px)", 1080, 1080), true);
  assert.equal(evalMedia("(max-width: 600px)", 1080, 1080), false);
  assert.equal(evalMedia("screen and (orientation: portrait)", 1080, 1350), true);
  assert.equal(evalMedia("print", 1080, 1080), false);
  assert.equal(evalMedia("(width >= 1000px)", 1080, 1080), true);
  assert.equal(evalMedia("(prefers-color-scheme: dark)", 1080, 1080), false);
  assert.equal(evalMedia("(min-resolution: 2dppx)", 1080, 1080), null);
  const stats = {};
  const out = adaptCssToFrame(`.a{width:100vw;height:50vh}@media (min-width:500px){.b{color:red}}@media (min-resolution:2dppx){.c{color:blue}}`, 1080, 1920, stats);
  assert.match(out, /width:1080px;height:960px/); assert.match(out, /\.b\{color:red\}/); assert.match(out, /@media \(min-resolution:2dppx\)\{\.c\{color:blue\}\}/);
});

test("detección de familias y tipos de archivo", () => {
  assert.deepEqual(fontFamiliesIn(`a{font-family:"Inter",sans-serif} b{font:italic 700 20px/1.2 'DM Sans', serif} c{font-family:var(--f)}`), ["Inter", "DM Sans"]);
  assert.equal(sniffMime(PNG).mime, "image/png");
  assert.equal(sniffMime(WOFF2).mime, "font/woff2");
  assert.equal(sniffMime(Buffer.from("<html>no")), null);
});

test("ida y vuelta: exportar un frame de Musa e importarlo da lo mismo", async () => {
  const frame = { name: "Post", width: 1080, height: 1080, background: "#101010", css: `.c{position:absolute;left:80px;top:90px;color:#fff;font-family:Montserrat;font-size:72px}`, html: `<div data-layer-id="musa_1" data-layer-name="Título" data-layer-kind="text" class="c">Hola</div>` };
  const exported = `<!doctype html><html><head><meta charset="utf-8"><meta name="musa:size" content="${frame.width}x${frame.height}"><title>${frame.name}</title><style>body{margin:0;background:${frame.background}}\n${frame.css}</style></head><body>${frame.html}</body></html>`;
  const { doc } = await full({ html: exported }, {}, { google: [] });
  const ab = doc.artboards[0];
  assert.equal(ab.name, frame.name); assert.equal(ab.width, frame.width); assert.equal(ab.height, frame.height); assert.equal(ab.background, frame.background);
  assert.equal(ab.raw.html, frame.html);
  assert.ok(ab.raw.css.includes(frame.css));
});

test("tandas: muchos recursos remotos se copian en varias vueltas sin perder ninguno", async () => {
  const imgs = Array.from({ length: 23 }, (_, i) => `<img src="https://cdn.ejemplo.com/${i}.png">`).join("");
  const state = await prepareHtmlImport({ source: "html", html: imgs }, {}, io());
  let rounds = 0;
  while (await runHtmlAssetBatch(state, deps(), 10)) rounds++;
  assert.ok(rounds >= 4);
  assert.equal(state.assets.filter((a) => a.status === "done").length, 23);
  const doc = finalizeHtmlImport(state);
  assert.doesNotMatch(doc.artboards[0].raw.html, /cdn\.ejemplo\.com/);
});
