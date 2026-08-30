# Post-mortem — Colapso de fuentes en el editor (saga 2026-08-30)

> **Resultado final:** rollback total por mandato del usuario. Revert `40394b7`
> restaura `main` al estado pre-saga (`a14692f`). Los 4 fixes de la saga
> (`683d208`, `17eb1f1`, `76baa4a`, `3f7e810`) quedan fuera de producción.
> Tests 10/10 y build verdes sobre el estado restaurado antes del push.

---

## 1. Estado de producción tras el rollback (importante leer primero)

**Vuelve a funcionar como antes de la saga** (ni mejor ni peor):

- El editor carga y el proxy same-origin de Google Fonts existe tal como estaba.
- Las fuentes **colapsan al fallback genérico tras un reload duro (Ctrl+F5)**
  — el síntoma ORIGINAL sigue presente y sin fix, porque todos los fixes
  se revirtieron junto con el daño.

**Defectos conocidos que retornan con el rollback** (todos documentados con
evidencia durante la saga, ver §4):

1. El gateway de Netlify corta los query params también en `;` → todo css2
   con tupla de ejes (`:ital@0;1`, `:wght@400;700`) llega desmembrado al
   proxy y muere en 400 **antes** de tocar Google.
2. `font-family` referenciada sin `@import` (estado real del template
   `tpl_11cbed9a`: texto en `"Nunito Sans"` y `"Matcha Mint" !important` con
   4 imports de solo `Nunito`) → fallback silencioso, sin request ni error.
3. Fuentes custom del usuario nunca viajan por Google, pero el estado
   pre-saga tampoco las pedía (el ruido del 400 era parte de la saga).

---

## 2. Timeline de la saga

| Commit | Qué se creyó / qué se cambió | Resultado observado |
|---|---|---|
| `683d208` | Tuplas css2 400ean por re-encoding en runtime → wire-form crudo + retry con familia pelada + multiValue | Usuario: persisten 3/4 curls en 400 |
| `17eb1f1` | El gateway parte params en `;` (confirmado con probes) → rebuild desde `event.rawUrl` + percent-encode cliente | Curls 200, pero usuario reporta "ya ni cargan" y luego "no sale nada en Network" (200s cacheados = invisibles) |
| `76baa4a` | Captura Network+consola demuestra imports≠font-family → `fontLinksForCss` carga la unión | Google fonts deberían cargar; aparece 400+toast de "Matcha Mint" (custom pedida a Google por error) |
| `3f7e810` | Consola muestra 11× OTS decode errors → binarios corruptos en tránsito → `identity` + `private` + re-keyeo `/v1`+`fv=2` + skip de `@font-face` propios | Origen verificado sirviendo `wOF2` válido con headers correctos; **usuario igual ve "ya ni carga la fuente"** → mandato de rollback |

---

## 3. Las dos capas del problema (qué quedó probado y qué no)

### 3.1 Capa hojas de estilo (css2) — RESUELTA en su momento, hoy revertida

- **Gateway split en `;`**: probado con probes (URLs codificadas 200, crudas 400).
- **Fallback silencioso referenced-without-import**: probado con captura de
  consola del propio usuario (4 imports Nunito vs font-family Nunito Sans /
  Matcha Mint) y performance.getEntriesByType (cero request de Nunito+Sans).
- Ambos fixes (`17eb1f1`, `76baa4a`) tenían el mecanismo verificado: tras
  `76baa4a` la consola del usuario mostraba los links inyectados cargando
  (Nunito y Nunito Sans sin error).

### 3.2 Capa binarios (woff2 / OTS) — síntoma confirmado, origen NO cerrado

- **Confirmado con datos del usuario**: exactamente los 2 woff2 descargados
  por red (nunito latin 71.003B, instrumentserif 37.883B) fallaban
  `Failed to decode downloaded font` / `OTS parsing error: Failed to convert
  WOFF 2.0 font to SFNT`, mientras los 5 subsets servidos desde caché del
  navegador decodificaban bien. `transfer > decoded` (ej. 38.183→37.883)
  demuestra que la descompresión del transporte funcionó: **la corrupción
  estaba dentro del payload ya descomprimido**.
- **Confirmado desde fuera**: el mismo URL exacto servido desde el origen
  devolvía `wOF2` válido (~71KB) en fetch directo repetido.
- **Hipótesis fuerte, no probada en browser del usuario**: variante envenenada
  en caché compartida (edge Netlify) congelada por `Cache-Control:
  public, max-age=31536000, immutable` — el fix `3f7e810` sacaba el edge del
  camino (`private`) y re-keyeaba todas las URLs (`/v1/`, `fv=2`), y fue
  verificado sirviendo correcto desde producción (200 + private + nosniff +
  magic bytes wOF2), **pero el usuario reportó fallo total antes de poder
  validar en su navegador** y ordenó el rollback.
- **No descartado**: corruptor local (antivirus/antivirus-HTTPS o extensión
  escaneando respuestas — la consola del usuario muestra "content script
  loaded"). La prueba discriminadora (incógnito sin extensiones) nunca se
  ejecutó.

---

## 4. Evidencia clave (para retomar sin re-derivar nada)

1. **Curl matrix** post-`17eb1f1`: shell-ital/zilla-multi/doble-familia/sin-espacio en 200.
2. **Network del usuario** (18:03): css2 en 200 con `netlify-vary: query`,
   `age` altos (edge hits), cero request de Nunito+Sans → fallback silencioso.
3. **Consola del usuario**: `[fonts] el css pide: Nunito`, imports persistidos
   solo Nunito; luego toast `No se pudo cargar la hoja "Matcha Mint"` (custom
   pedida a Google — bug introducido y luego corregido dentro de la saga).
4. **performance.getEntriesByType**: los únicos 2 woff2 con `transferSize > 0`
   son exactamente los que fallan OTS; los 5 con `0B` (caché) decodifican.
5. **Probes del origen** post-`3f7e810`: css2 `fv=2` entrega URLs `/v1/`;
   woff2 `/v1/` → `200`, `cache-control: private,max-age=31536000,immutable`,
   `content-type: font/woff2`, `x-content-type-options: nosniff`, magic bytes
   `wOF2`.

---

## 5. Recomendaciones para un re-intento

1. **Perfil limpio primero**: reproducir (o no) en incógnito sin extensiones y
   sin antivirus-HTTPS. Si no reproduce allí, el corruptor es local y ningún
   cambio de servidor lo arregla — esa prueba cuesta 30 segundos y ahorra
   toda una saga.
2. **Headers de la respuesta fallida antes que cualquier teoría**: status,
   `content-encoding`, `cache-status`, `age`, `content-length` del woff2 que
   falla OTS. Distingue edge-envenenado de origin-corrupto de MITM local.
3. **Una variable por deploy**, con verificación en el navegador del usuario
   tras cada una. La saga acumuló 3 cambios de comportamiento en un solo
   deploy dos veces, y el ruido de un fix tapó la señal del siguiente.
4. **Considerar evitar el proxy-por-función para binarios**: servir los woff2
   desde Supabase Storage / CDN estático (o self-host de los subsets usados)
   elimina la clase entera de corrupción en tránsito y el cold-start por
   archivo. Las hojas css2 (texto) sí funcionaron bien vía función.
5. El approach verificado de `3f7e810` (`identity` upstream + `private` +
   re-keyeo generacional + skip de `@font-face` propios) quedó probado
   **sirviendo correcto desde el origen**; reaplicarlo es mecánico (git
   revert del revert) pero solo con el punto 1 cerrado primero.

## 6. Apéndice — commits revertidos y su contenido

- `683d208` — wire-form crudo de tuplas css2 + retry bare-family + multiValue.
- `17eb1f1` — rebuild del query desde `event.rawUrl` (split solo en `&`) +
  percent-encode de `; : @ ,` en el cliente + link del shell codificado.
- `76baa4a` — `fontLinksForCss`: unión de imports + familias referenciadas
  (con `PREINSTALLED_FAMILIES`); usado por DesignFrame y HtmlCanvas.
- `3f7e810` — gstatic `identity`/`private`/nosniff/MIME-por-extensión +
  generación `/v1/` en paths de glyphs + `fv=2` en css2 + skip de familias
  con `@font-face` propio en el css.

Rollback: `40394b7` (revert range `683d208^..3f7e810`), 11 archivos,
tests 10/10 y build verdes pre-push.
