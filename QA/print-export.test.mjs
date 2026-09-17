/**
 * printExport — matemática del export de imprenta (300dpi/CMYK). buildPrintPdf
 * queda fuera (jsPDF/browser); aquí va todo lo que decide DPI real: página =
 * medidas del archivo a 300dpi + margen opcional, fondo de imprenta y
 * filenames. La regresión que motiva el módulo: el PDF viejo usaba unit "px"
 * a escala fija 2x — sin control de DPI y sin unidades físicas, imposible
 * de mandar a imprenta.
 *
 * Run: node --test QA/print-export.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "src", "lib", "printExport.ts");

// node:test no trae assertAlmostEqual — épsilon propio en dpi/mm.
const approx = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `se esperaba ~${expected}, llegó ${actual}`);

const {
  PRINT_DPI,
  MM_PER_INCH,
  pxToMm,
  computePrintGeometry,
  effectiveDpi,
  printBackground,
  printFilename,
  PRINT_PROFILES,
  CMYK_PROFILES,
  DEFAULT_PRINT_OPTIONS,
} = await import(modPath);

describe("pxToMm — px del frame a mm físicos a 300dpi", () => {
  it("1080px = 91.44mm", () => {
    approx(pxToMm(1080), (1080 / PRINT_DPI) * MM_PER_INCH);
  });
});

describe("computePrintGeometry — página = medidas del archivo", () => {
  it("página = frame a 300dpi exactos, escala 1, sin margen", () => {
    const g = computePrintGeometry(1080, 1350);
    approx(g.pageWmm, pxToMm(1080));
    approx(g.pageHmm, pxToMm(1350));
    assert.equal(g.scale, 1);
    assert.equal(g.rasterW, 1080);
    assert.equal(g.rasterH, 1350);
    approx(g.drawnWmm, g.pageWmm);
    approx(g.offXmm, 0);
    approx(g.offYmm, 0);
    approx(g.effDpi, PRINT_DPI);
  });

  it("margen N mm: página crece 2N, dibujo centrado a tamaño físico", () => {
    const g = computePrintGeometry(1080, 1080, 5);
    approx(g.pageWmm, pxToMm(1080) + 10);
    approx(g.drawnWmm, pxToMm(1080));
    approx(g.offXmm, 5);
    approx(g.offYmm, 5);
    assert.equal(g.rasterW, 1080);
    approx(g.effDpi, PRINT_DPI);
  });

  it("margen negativo se clampa a 0 (sin recortes accidentales)", () => {
    const g = computePrintGeometry(1080, 1080, -3);
    approx(g.pageWmm, pxToMm(1080));
    approx(g.offXmm, 0);
  });

  it("raster = px del frame siempre; la proporción la da el frame (sin orientación)", () => {
    const g = computePrintGeometry(1920, 1080);
    assert.equal(g.rasterW, 1920);
    assert.equal(g.rasterH, 1080);
    assert.ok(g.pageWmm > g.pageHmm, "frame apaisado → página apaisada");
  });
});

describe("computePrintGeometry — escala del trabajo (Scale To de Illustrator)", () => {
  it("escala 2: página y raster ×2, dpi del diseño 150", () => {
    const g = computePrintGeometry(1080, 1080, 0, { scale: 2 });
    approx(g.pageWmm, pxToMm(1080) * 2);
    assert.equal(g.rasterW, 2160);
    assert.equal(g.rasterH, 2160);
    approx(g.effDpi, 150);
    approx(g.trimWmm, pxToMm(1080) * 2);
  });

  it("escala fuera de rango se clampa a 0.1–5", () => {
    approx(computePrintGeometry(1080, 1080, 0, { scale: 99 }).scale, 5);
    approx(computePrintGeometry(1080, 1080, 0, { scale: 0.001 }).scale, 0.1);
  });

  it("pedir 100mm sobre 1080px → dpi del diseño ≈ 274 (el warning del dialog)", () => {
    const g = computePrintGeometry(1080, 1080, 0, { scale: 100 / pxToMm(1080) });
    approx(g.trimWmm, 100);
    assert.ok(g.effDpi < 300, `dpi ${g.effDpi} debería estar bajo 300`);
    assert.ok(g.effDpi > 274 && g.effDpi < 275, `dpi ${g.effDpi} debería rondar 274`);
  });
});

describe("computePrintGeometry — sangrado y marcas de corte", () => {
  it("sangrado 3mm sin margen: página = corte + 6, imagen llena la página", () => {
    const g = computePrintGeometry(1080, 1080, 0, { bleedMm: 3 });
    approx(g.trimWmm, pxToMm(1080));
    approx(g.pageWmm, pxToMm(1080) + 6);
    approx(g.drawnWmm, pxToMm(1080) + 6);
    approx(g.offXmm, 0);
    // el estiro del sangrado baja el dpi del diseño sobre el área dibujada
    assert.ok(g.effDpi < PRINT_DPI && g.effDpi > 275, `dpi ${g.effDpi}`);
  });

  it("sangrado necesita papel: la página crece aunque el margen sea 0", () => {
    const g = computePrintGeometry(1080, 1080, 0, { bleedMm: 5 });
    approx(g.ringMm, 5);
    approx(g.pageWmm, pxToMm(1080) + 10);
  });

  it("marcas de corte: anillo mínimo = sangrado + 4 (1mm aire + 3mm trazo)", () => {
    const g = computePrintGeometry(1080, 1080, 0, { bleedMm: 3, cropMarks: true });
    approx(g.ringMm, 7);
    approx(g.pageWmm, pxToMm(1080) + 14);
    approx(g.offXmm, 4); // la imagen queda a 4mm del borde: las marcas viven ahí
    assert.equal(g.cropMarks, true);
  });

  it("marcas sin sangrado: anillo 4 desde el corte (offset 1 + trazo 3)", () => {
    const g = computePrintGeometry(1080, 1080, 0, { cropMarks: true });
    approx(g.ringMm, 4);
    approx(g.bleedMm, 0);
    approx(g.offXmm, 4);
  });

  it("margen grande gana sobre el mínimo de las marcas", () => {
    const g = computePrintGeometry(1080, 1080, 10, { cropMarks: true });
    approx(g.ringMm, 10);
    approx(g.pageWmm, pxToMm(1080) + 20);
  });

  it("sin extras el comportamiento legacy se conserva (dpi exactos)", () => {
    const g = computePrintGeometry(1080, 1350);
    approx(g.effDpi, PRINT_DPI);
    assert.equal(g.cropMarks, false);
    approx(g.bleedMm, 0);
    approx(g.ringMm, 0);
  });
});

describe("effectiveDpi — reporte post-export", () => {
  it("3240px sobre 210mm ≈ 391.8 dpi", () => {
    approx(effectiveDpi(3240, 210), 3240 / (210 / MM_PER_INCH));
  });
});

describe("printBackground — imprenta lleva blanco, no negro de alpha", () => {
  it("frame transparente + default → blanco forzado", () => {
    assert.equal(printBackground("transparent", DEFAULT_PRINT_OPTIONS), "#ffffff");
    assert.equal(printBackground(undefined, DEFAULT_PRINT_OPTIONS), "#ffffff");
  });

  it("color del frame se respeta", () => {
    assert.equal(printBackground("#123456", DEFAULT_PRINT_OPTIONS), "#123456");
  });

  it("transparencia SOLO con sRGB + PNG marcado explícito", () => {
    const on = { ...DEFAULT_PRINT_OPTIONS, transparent: true };
    assert.equal(printBackground("transparent", on), "transparent");
    assert.equal(printBackground("transparent", { ...on, profile: "fogra39" }), "#ffffff");
    assert.equal(printBackground("transparent", { ...on, codec: "jpeg" }), "#ffffff");
  });
});

describe("printFilename", () => {
  it("sRGB: nombre_300dpi.pdf (sanitizado igual que el export actual)", () => {
    // ñ→_ y !→_ dentro del nombre + el separador _ del join con el tail.
    assert.equal(printFilename("Mi Diseño!", "srgb"), "Mi_Dise_o__300dpi.pdf");
  });

  it("CMYK: sufijo del perfil (REQ F2)", () => {
    assert.equal(printFilename("flyer", "fogra39"), "flyer_FOGRA39.pdf");
    assert.equal(printFilename("flyer", "iso_uncoated"), "flyer_ISO_Uncoated.pdf");
  });
});

describe("perfiles", () => {
  it("hay 3 perfiles CMYK + sRGB, todos con sufijo de filename", () => {
    assert.equal(PRINT_PROFILES.length, 4);
    assert.equal(CMYK_PROFILES.length, 3);
    for (const p of CMYK_PROFILES) {
      assert.ok(p.iccFile.endsWith(".icc"));
      assert.ok(p.suffix && p.suffix.length > 0);
      // REQ F2: el OutputIntent necesita el identifier registrado de la
      // condición — Acrobat lo muestra en Salida.
      assert.ok(p.condition && p.condition.length > 0);
    }
    assert.equal(PRINT_PROFILES.find(p => p.id === "srgb").condition, null);
  });
});

// ── pdfOutputIntent — incrustado incremental (REQ F2: Acrobat debe mostrar
// el OutputIntent del perfil elegido; el spike verificó que pdfwrite no lo
// incrusta) ──
const intentPath = "file://" + resolve(__dirname, "..", "src", "lib", "pdfOutputIntent.ts");
const { embedOutputIntent, validateEmbeddedUpdate } = await import(intentPath);

/** PDF mínimo con xref REAL (offsets correctos) y catálogo sin comprimir,
 *  como el que produce pdfwrite — para ejercitar el update sin Ghostscript. */
function buildTinyPdf() {
  const content = "1 0 0 1 0 0 cm 0 1 1 0.7 k 0 0 200 200 re f";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /ProcSet [/PDF] >> >>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((dict, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${dict}\nendobj\n`; });
  const xrefAt = body.length;
  let xref = "xref\n0 5\n0000000000 65535 f \n";
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += xref + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("embedOutputIntent — update incremental (REQ F2)", () => {
  const icc = new TextEncoder().encode("FAKE-ICC-BYTES-12"); // 17 bytes
  const meta = { outputConditionIdentifier: "ISO Coated v2 300% (ECI)" };

  it("original intacto byte a byte + catálogo nuevo con /OutputIntents", () => {
    const orig = buildTinyPdf();
    const out = embedOutputIntent(orig, icc, meta);
    assert.ok(out.length > orig.length);
    for (let i = 0; i < orig.length; i++) assert.equal(out[i], orig[i], `byte ${i} del original cambió`);
    const text = Buffer.from(out).toString("latin1");
    assert.ok(text.includes("/Type /OutputIntent"), "dict del intent");
    assert.ok(text.includes(String.raw`/OutputConditionIdentifier (ISO Coated v2 300% \(ECI\))`), "identifier con delimitadores escapados");
    assert.ok(text.includes("/DestOutputProfile 5 0 R"), "ICC referenciado (maxObj 4 → icc 5)");
    assert.ok(text.includes("5 0 obj\n<</N 4 /Alternate /DeviceCMYK /Length 17>>"), "stream ICC con /N 4");
    assert.ok(text.includes("/OutputIntents [6 0 R]"), "catálogo nuevo apunta al intent");
    assert.ok(text.includes("/Root 7 0 R"), "trailer nuevo apunta al catálogo nuevo");
    assert.ok(text.includes("/Prev"), "cadena hacia el xref original");
  });

  it("xref propia consistente: offsets que apuntan a objetos reales", () => {
    const out = embedOutputIntent(buildTinyPdf(), icc, meta);
    const v = validateEmbeddedUpdate(out);
    assert.equal(v.ok, true, v.reason);
    const text = Buffer.from(out).toString("latin1");
    const sxr = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
    assert.ok(text.slice(sxr).startsWith("xref\n5 3\n"), "subsection 5..7 en el startxref final");
  });

  it("el original sin update no valida (el validador mide SOLO el update)", () => {
    assert.equal(validateEmbeddedUpdate(buildTinyPdf()).ok, false);
  });

  it("PDF sin catálogo/xref legible se devuelve SIN tocar (nunca romper un export)", () => {
    const junk = new TextEncoder().encode("esto no es un pdf");
    const out = embedOutputIntent(junk, icc, meta);
    assert.equal(out, junk, "misma referencia = sin procesar");
    assert.equal(validateEmbeddedUpdate(out).ok, false);
  });

  it("offset roto en la xref propia → el validador detecta la corrupción", () => {
    const out = embedOutputIntent(buildTinyPdf(), icc, meta);
    const text = Buffer.from(out).toString("latin1");
    // OJO: "startxref\n" contiene "xref\n" — un lastIndexOf de la palabra
    // suelta caía en el trailer y el replace ya no tocaba ninguna entry.
    // Anclamos por el offset REAL que publica el startxref final.
    const at = Number(text.slice(text.lastIndexOf("startxref")).match(/\d+/)[0]);
    const badHead = text.slice(at).replace(/^(\d{10}) 00000 n /m, "9999999999 00000 n ");
    const bad = new TextEncoder().encode(text.slice(0, at) + badHead);
    const v = validateEmbeddedUpdate(bad);
    assert.equal(v.ok, false);
  });
});
