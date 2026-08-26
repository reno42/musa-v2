# REQ-013 — Extractor de design system no resuelve CSS custom properties (`var()`)

Status: Backlog
Priority: Alta (producto vendido a usuarios externos; la extracción devuelve tokens erróneos para diseños que usan `var()`)
Files:
- netlify/functions/design-extractor.mjs (fix principal — `extractDesignSystem()` + `parseCss()`)
- netlify/functions/mcp.mjs (handler `tools/call` de `extract_design_system` — solo invoca, no cambia)
- api/src/routes/designSystem.ts (verificar si reimplementa la extracción o importa design-extractor.mjs)

## Problema

`extractDesignSystem()` (design-extractor.mjs) parsea el CSS con regex y lee los
valores de las declaraciones como strings literales. **No resuelve `var(--x)`**,
así que cualquier diseño que defina colores/fuentes como CSS custom properties
pierde su identidad visual en la extracción.

El flujo actual:
1. `parseCss()` (líneas 336-388) parte cada regla en `{ selector, property, value }` y
   guarda el `value` crudo.
2. Extracción de color (líneas 455-483): `extractColorsFromValue(rule.value)` hace
   match de `#hex`/`rgb()` con regex. Con `background-color: var(--ds-color-bg)`
   no matchea nada → el color se PIERDE por completo.
3. Tipografía (líneas 492-505): `font-family: var(--ds-font-family)` → guarda
   literalmente `"var(--ds-font-family)"` como familia; `font-size: var(--x)` →
   `parseInt()` devuelve `NaN` → se descarta.

Evidencia (reproducible, 26 ago 2026):
- Template `tpl_7bc52f38-e77` ("Sweet Bread Card"). CSS real:
  `.bread-card { --ds-color-bg:#FAF7EF; --ds-color-primary:#3252CB; ... }` con
  `background-color: var(--ds-color-bg)`, `color: var(--ds-color-primary)`,
  `font-family: var(--ds-font-family)`.
- `extract_design_system({ templateIds:["tpl_7bc52f38-e77"] })` devolvió:
  - colors: `canvas=#ffffff`, `ink=#000000` (el azul #3252CB y el crema #FAF7EF NO aparecen).
  - constraint: `"No saturated accent color detected. Palette is monochrome."`
  - typography.families: `[{ name: "var(--ds-font-family)" }]` (sin resolver).

Resultado: un diseño azul-sobre-crema se lee como blanco/negro/monocromo. Rompe
el caso de uso "extraer estilo → crear nueva pieza siguiendo los tokens" para
cualquier usuario cuyo diseño fuente use custom properties.

## Solución

Agregar una pasada de resolución de custom properties **antes** de la extracción,
manteniendo el determinismo (mismo input → mismo output; la resolución es
puramente funcional).

### 1. Recolectar las custom properties

Cualquier declaración cuyo `property` empieza con `--` es una definición de
custom property (`--ds-color-bg: #FAF7EF`). Construir un map `--nombre → valor`
con todos los rules de todos los frames.

```js
function buildCustomProps(rules) {
  var map = {};
  rules.forEach(function (r) {
    if (r.property && r.property.indexOf("--") === 0) {
      map[r.property] = r.value;
    }
  });
  return map;
}
```

### 2. Resolver `var()` (recursivo, con guarda de ciclos)

Soportar `var(--x)` y `var(--x, fallback)`:

```js
function resolveVarValue(value, map, depth) {
  depth = depth || 0;
  if (depth > 8) return value;            // ciclo / demasiado anidado
  var re = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*?))?\s*\)/g;
  var out = value;
  var changed = true, guard = 0;
  while (changed && guard < 10) {
    changed = false;
    guard++;
    out = out.replace(re, function (match, name, fallback) {
      var resolved = map[name];
      if (resolved === undefined) resolved = (fallback !== undefined ? fallback : match);
      if (resolved !== match) changed = true;
      return resolved;
    });
  }
  return out;
}
```

### 3. Aplicar la resolución a todos los rules antes de extraer

En `extractDesignSystem()`, justo después de juntar `allRules` de todos los frames
(tras el bucle de la línea ~446-453) y **antes** de la extracción de color (~455):

```js
var customProps = buildCustomProps(allRules);
allRules = allRules.map(function (r) {
  return { selector: r.selector, property: r.property, value: resolveVarValue(r.value, customProps) };
});
```

Con esto, `extractColorsFromValue` recibe `#FAF7EF`/`#3252CB` ya resueltos, y la
tipografía recibe `"Helvetica Neue", Helvetica, Arial, ...` en vez de
`var(--ds-font-family)`. No hace falta tocar `parseCss` ni las funciones de
extracción individuales.

## Notas

- Mantener el determinismo: `buildCustomProps` y `resolveVarValue` son puros
  (sin aleatoriedad, sin `Date`, sin orden dependiente de inserción de objetos
  externos). El hash de salida (`sourceHash`/`styleFingerprint`) sigue siendo
  estable para el mismo input.
- NO tocar el `:root` GENERADO por el extractor (los artifacts `sharedCss`/`tokensJson`
  que emite al final). Este fix resuelve las custom properties de ENTRADA, no cambia
  el formato de salida.
- `var()` con fallback anidado o con más de un `var()` en el mismo valor: la regex
  + el loop con guarda cubren el caso común; documentar como límite conocido si
  aparece un caso raro.

## Verificación

1. Deploy del cambio.
2. `extract_design_system({ templateIds:["tpl_7bc52f38-e77"] })` → debe devolver:
   - un color `#3252cb` (role primario/ink) y `#faf7ef` (canvas/background).
   - typography.families con `"Helvetica Neue"` (o el primer nombre real), NO `"var(--ds-font-family)"`.
   - desaparecer la constraint `"Palette is monochrome"`.
3. Regresión — diseño con hex literales (sin `var()`): extracción idéntica a la
   actual (byte-for-byte en `sourceHash` para el mismo frame).
4. Regresión — diseño con `var(--x, fallback)`: resuelve el valor de `--x` si
   existe, o el fallback si no.
5. `api/src/routes/designSystem.ts`: confirmar si usa `design-extractor.mjs` o
   reimplementa; si reimplementa, aplicar el mismo patrón ahí.

## Resultado esperado

La extracción de estilo devuelve la paleta/tipografía REAL de diseños que usan
custom properties, lo que habilita correctamente el flujo "extraer estilo →
crear nueva pieza siguiendo los tokens" para los usuarios del producto.
