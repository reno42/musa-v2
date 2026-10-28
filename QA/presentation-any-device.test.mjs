/**
 * Presentación visible desde cualquier dispositivo. Corre:
 * node --experimental-strip-types --test QA/presentation-any-device.test.mjs
 *
 * Cubre: el visor no depende del fullscreen API para existir (iOS no lo
 * permite), navega por gestos táctiles, el editor lo expone en la barra
 * móvil y en el menú hamburguesa, y la vista compartida /c/:id ofrece el
 * mismo botón Presentar en mobile y desktop.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(ROOT + path, "utf8");
const presentation = read("src/components/DesignPresentation.tsx");
const editor = read("src/pages/EditorV2.tsx");
const gate = read("src/components/SharedDesignGate.tsx");

test("el visor funciona sin fullscreen: iOS rechaza el API y el overlay fixed cubre igual", () => {
  assert.match(presentation, /root\.requestFullscreen/);
  assert.match(presentation, /webkitRequestFullscreen/);
  // Solo se cierra al SALIR de fullscreen si se llegó a entrar — el evento
  // suelto de un móvil no debe cerrar el visor.
  assert.match(presentation, /enteredFullscreenRef/);
  assert.match(presentation, /if \(enteredFullscreenRef\.current\) onClose\(\)/);
});

test("navegación táctil: swipe horizontal cambia de frame y un tap corto avanza", () => {
  assert.match(presentation, /onTouchStart=\{onTouchStart\}/);
  assert.match(presentation, /onTouchEnd=\{onTouchEnd\}/);
  assert.match(presentation, /Math\.abs\(dx\) >= 48/);
  assert.match(presentation, /elapsed < 400/);
  // El toque sobre los botones no debe disparar el avance del tap.
  assert.match(presentation, /closest\?\.\("button"\)/);
});

test("chrome compacto y área segura: el visor se adapta bajo 768px", () => {
  assert.match(presentation, /window\.innerWidth < 768/);
  assert.match(presentation, /env\(safe-area-inset-bottom\)/);
});

test("el editor expone Presentar en la barra móvil y en el menú hamburguesa", () => {
  // Barra inferior móvil (la topbar se desborda en un teléfono).
  assert.match(editor, /editor-v2-mobile-bar-btn[\s\S]*?Presentar/);
  // Menú hamburguesa (mobile/tablet).
  assert.match(editor, /setPresentationOpen\(true\); setMobileMenuOpen\(false\)/);
  // El botón del topbar (desktop) sigue existiendo.
  assert.match(editor, /onClick=\{\(\) => setPresentationOpen\(true\)\}/);
});

test("la vista compartida /c/:id ofrece Presentar en mobile y desktop", () => {
  assert.match(gate, /import \{ DesignPresentation \} from "\.\/DesignPresentation";/);
  assert.match(gate, /<DesignPresentation/);
  assert.match(gate, /setPresenting\(true\)/);
  // El visor solo se ofrece tras pasar el gate: nunca filtra frames de un
  // diseño privado al invitado.
  assert.match(gate, /signedIn && presentationFrames\.length > 0/);
});
