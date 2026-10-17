// QA/gap-g9-write-chain.test.mjs — G9* (gap-analysis 2026-10-16, W0.1):
// fill/posición se revertían al guardar. Raíz: los mutadores de frames
// (handleHtmlChange, handleFrameCssChange, handleFrameHtmlChange) mapeaban
// sobre el closure `frames` del render ignorando la cadena de escrituras —
// la última escritura de una ráfaga (html del rich-text + css del panel
// contextual, o css de un drag) borraba a su hermana y el estado persistido
// quedaba pre-ráfaga mientras el Shadow DOM mostraba el cambio. EditorV2.tsx
// es un componente de 11k líneas que no corre bajo node:test, así que el
// contrato se afirma sobre el source (convención del repo: req032-visual-tools).
// Corre con:
//   node --test QA/gap-g9-write-chain.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(ROOT + "src/pages/EditorV2.tsx", "utf8");

function useCallbackBody(source, name) {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start !== -1, `no se encontró ${name}`);
  const end = source.indexOf("\n  }, [", start);
  assert.ok(end !== -1, `no se encontró el cierre de ${name}`);
  return source.slice(start, end);
}

// ── La cadena ──────────────────────────────────────────────────────────────

test("framesChainRef se declara ANTES de los mutadores (deps sin TDZ)", () => {
  const chain = src.indexOf("const framesChainRef = useRef");
  assert.ok(chain !== -1, "no existe framesChainRef");
  for (const name of [
    "handleHtmlChange", "handleCssChange", "handleFrameCssChange",
    "handleFrameHtmlChange", "handleSvgFillMedia",
  ]) {
    const handler = src.indexOf(`const ${name} = useCallback(`);
    assert.ok(handler !== -1, `no existe ${name}`);
    assert.ok(chain < handler, `${name} depende de commitFrames: debe declararse después de la cadena`);
  }
});

test("la cadena se resetea cuando React entrega los frames nuevos", () => {
  assert.match(src, /useEffect\(\(\) => \{ framesChainRef\.current = null; \}, \[frames\]\);/);
});

test("commitFrames: fija la cadena + undo + autoSave, la cadena primero", () => {
  const body = useCallbackBody(src, "commitFrames");
  assert.match(body, /framesChainRef\.current = next;/);
  assert.ok(
    body.indexOf("framesChainRef.current = next;") < body.indexOf("store.replaceAllWithUndo"),
    "la cadena se fija antes del undo",
  );
  assert.match(body, /autoSave\(next\)/);
});

// ── Los mutadores componen en vez de pisarse ───────────────────────────────

const MUTATORS = [
  "handleHtmlChange", "handleCssChange", "handleFrameCssChange",
  "handleFrameHtmlChange", "handleSvgFillMedia",
];

for (const name of MUTATORS) {
  test(`${name}: lee la cadena (framesChainRef.current ?? frames), no el closure crudo`, () => {
    const body = useCallbackBody(src, name);
    assert.match(body, /framesChainRef\.current \?\? frames/);
    assert.doesNotMatch(body, /= frames\.map\(/);
  });
  test(`${name}: commitea por commitFrames (sin replaceAllWithUndo/autoSave sueltos)`, () => {
    const body = useCallbackBody(src, name);
    assert.match(body, /commitFrames\(/);
    assert.doesNotMatch(body, /store\.replaceAllWithUndo/);
    assert.doesNotMatch(body, /autoSave\(/);
  });
}

test("handleContextualCssChange (entrada del panel) delega en handleCssChange chain-aware", () => {
  const body = useCallbackBody(src, "handleContextualCssChange");
  assert.match(body, /handleCssChange\(newCss\)/);
});

// ── El guardado manual (Ctrl+S) ────────────────────────────────────────────

test("handleSaveVersion: saveLocal ANTES del PUT y con el MISMO payload", () => {
  const body = useCallbackBody(src, "handleSaveVersion");
  const local = body.indexOf("saveLocal(templateId, payload)");
  const put = body.indexOf("await apiFetch(`/api/templates/${templateId}`");
  assert.ok(local !== -1, "handleSaveVersion no llama saveLocal (bug: localStorage quedaba viejo tras Ctrl+S)");
  assert.ok(put !== -1, "handleSaveVersion no hace PUT");
  assert.ok(local < put, "saveLocal debe escribirse antes del PUT");
  assert.match(body, /body: JSON\.stringify\(payload\)/);
});

test("handleSaveVersion: lee la cadena si una ráfaga está en vuelo (freshest frames)", () => {
  const body = useCallbackBody(src, "handleSaveVersion");
  assert.match(body, /framesChainRef\.current \?\? framesRef\.current/);
});

// ── Regresión: el patrón clobber no vuelve a entrar ────────────────────────

test("regresión: ningún mutador de la región mapea sobre `frames` sin la cadena", () => {
  const region = src.slice(
    src.indexOf("// ── Sequential-write chain (G9*)"),
    src.indexOf("// ── Figma-style frame selection handlers"),
  );
  assert.ok(region.length > 200, "región de mutadores no encontrada");
  assert.doesNotMatch(region, /= frames\.map\(/);
});
