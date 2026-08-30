# 🎯 /goal — Calidad de decks como infraestructura: `create_chart` + guards de geometría y escritura

> 📅 2026-08-30 (v3, consolidado — TODO en este único doc) | 👤 Preparado por: Hermes (para Ren → Qoder)
> 🎯 Objetivo: que la calidad de un deck NO dependa de que la IA "se acuerde" ni de que su output llegue íntegro. Math de charts server-side + contrato de geometría + guard de overflow + validación de escritura.
> 📦 Repo: `C:\Users\Renzo\.openclaw\workspace\design-main` → https://github.com/reno42/design
> 🚀 Deploy: design.futuraria.com (Netlify)

## 🔍 CONTEXTO — 5 post-mortems, 1 raíz

| # | Post-mortem | Síntoma | Causa raíz (MEDIDA) |
|---|---|---|---|
| 1 | Deck seed v1 (29-ago) | Cobertura 45–55%, cero charts reales | La math vivía en cada IA |
| 2 | Deck v3→v4 | "Maquetación dura", muletillas IA | Reglas leídas como prohibición de personalidad |
| 3 | Deck v5 (29-ago) | "Se sale por abajo y derecha" | Chrome de `create_deck` = content **1728×760@(96,200)** vs slides 1920×1080 → fuga **192px X / 320px Y** |
| 4 | Deck v5 (30-ago, 2ª causa) | Seguía desbordando tras neutralizar chrome | Slides 01–11 sin `*{box-sizing:border-box}` (la portada SÍ lo tenía): `.wr` = 1920 + border 12 + padding 56 = **1988×1148** → fuga **+68px X / +68px Y**. El editor recorta con `overflow:hidden` → marco sin borde derecho/inferior |
| 5 | Escritura v5 (30-ago) | Slides corruptos en producción | `set_css` devolvió `success:true` a CSS truncado (553 chars, layout perdido), basura (2922 chars con runs de dígitos y `cssLength:553` incrustado) y tokens corruptos (`#00b84squirrel`, `--deck-tool-font`). Solo rechazó un templateId mal escrito |

**Raíz común:** el servidor confía ciegamente en lo que la IA envía — ni la geometría ni la integridad del payload se verifican. Un agente degradado (sesión larga, payloads repetidos) corrompe producción **en silencio** y el usuario lo descubre al abrir el editor.

**Hallazgo tipografía (post-mortem 4b):** cuerpos de 20–22px en canvas 1920×1080 (los posters de referencia usan ≥40px) → "cuadrados ocupando todo pero vacíos por dentro". Y al subir tipografía sin medir, el slide 02 desbordó **+119px** por dentro (scrollHeight 1187 vs 1068) → tipografía y overflow están acoplados; el guard debe medir, no estimar.

**Exonerado:** módulo copywriting (`api/src/routes/copyRecipes.ts`, REQ-016) — biblioteca CRUD de hooks/tonos, no genera ni inyecta HTML. Correlación temporal con v5 = coincidencia. El riesgo real ("copy largo desborda") lo cierra G9.

**Evidencia previa:** `PRUEBAS_MCP_28JUL.md` Prueba 1 ya flaggeaba: *"Agregar validación de overflow"*. El hueco estaba documentado desde el 28-jul.

## 🏗️ ARQUITECTURA — defensa en 4 capas

```
Capa 1  CONTRATO EN GENERACIÓN   create_deck acepta layout {mode:"chrome"|"poster"}
                                 → el servidor aplica el chrome correcto ÉL MISMO y
                                 EMITE *{box-sizing:border-box} en el CSS base de todo slide.
                                 La IA declara intención; el servidor posee la geometría.
Capa 2  GUARD DINÁMICO           overflow con motor real (headless) via renderer existente
                                 (render_html_template): scrollWidth/scrollHeight vs caja del
                                 frame. Cubre TODO: HTML, copy, charts, CSV, tipografía alta.
Capa 3  LINT                     reglas static en lint_design: CHROME_OVERFLOW,
                                 BORDERBOX_MISSING, TYPE_FLOOR_REL, COVERAGE, AI-TELLS,
                                 MONOTONY. (HOY lint da 86/100 a un deck desbordado = ciego)
Capa 4  ESCRITURA SEGURA         set_css/set_html VALIDAN antes de persistir: llaves
                                 balanceadas + parse CSS + anti-garbage. Batch atómico.
```

Principio: **cada capa es independiente** — si la IA olvida la regla, el lint lo pilla; si el lint no ve el caso, el guard dinámico sí; y con Capa 1+4 el caso ni se produce.

## ✅ LO QUE YA FUNCIONA BIEN (no tocar)

| Funcionalidad | Estado |
|---|---|
| create_deck / create_html_carousel / create_frame | ✅ producción — SOLO agregar param `layout` + box-sizing base |
| lint_design (heurísticas actuales) | ✅ producción — SOLO agregar reglas |
| render_html_template (renderer headless) | ✅ producción — reusar su infra para Capa 2 |
| MCP tool registry (255 tools) | ✅ producción — registrar create_chart ahí |
| detect_structure (boundingBox correcto, Prueba 1) | ✅ producción |
| profile_template_pool (maxChars por slot) | ✅ producción — presupuesto de texto ya existe para path CSV |
| Contrato objects[] (DESIGN_HARNESS_RULES #0) | ✅ vigente |
| Transporte MCP `/mcp` JSON-RPC (get_frame/set_css) | ✅ verificado 30-ago — la vía confiable de escritura |

## 🔴 GAPS (priorizados)

| Gap | Descripción | Prioridad |
|---|---|---|
| G1 | Tool MCP `create_chart(frameId, recipe, data, options)` → objects[] | P0 |
| G2 | Math server-side por receta (donut stops, vbars headroom 1.15×, hbars in/out, timeline equiespaciado, line y=H−(v÷max)(H−2p)) | P0 |
| G3 | Validaciones (Σ=100%±0.5, ≤5 segmentos donut, ≤7 barras, placeholder forzado en ranges) | P0 |
| **G8a** | **`create_deck` param `layout:{mode:"chrome"|"poster"}`** (default "chrome"). En "poster": content a 0,0,W×H real del template (nada hardcodeado), sin título/folio. Retrocompatible: sin param = comportamiento actual | **P0** |
| **G8c** | **CSS base obligatorio en todo slide generado**: `*{margin:0;padding:0;box-sizing:border-box}` — lo emite el servidor (Capa 1), no depende de la IA | **P0** |
| **G10a** | **Validación de escritura** en set_css/set_html/update_html_frame/update_frame: (a) llaves `{}` balanceadas, (b) parse CSS real (postcss/lightningcss) — rechazar si no parsea, (c) anti-garbage: runs de dígitos >25, tokens no declarados. Responder con error + diff mínimo, NO persistir | **P0** |
| G4 | lint COVERAGE (<70% zona) · TYPE_FLOOR_REL (**piso relativo al canvas: cuerpo ≥2% del ancho** → ~38px en 1920, ~21px en 1080) · CHART_MISSING | P1 |
| G6 | lint AI-TELLS: BORDER_LEFT_ACCENT · EMOJI_ICON · PILL_RADIUS abusivo · BUZZWORDS ("seamless\|delve\|leverage…") · GRADIENT_CTA | P1 |
| **G8b** | lint **CHROME_OVERFLOW** static: root con dims ≥ frame completo + `[data-deck-chrome="content"]` menor sin neutralizar → FAIL con px de fuga | P1 |
| **G8d** | lint **BORDERBOX_MISSING**: si el CSS del frame no contiene `box-sizing:border-box` y el HTML tiene wrappers con border/padding → WARN con fuga calculada (border+padding del wrapper) | P1 |
| **G9** | **Guard dinámico OVERFLOW** (Capa 2): renderer headless mide scrollWidth/scrollHeight vs caja del frame, overshoot en px por elemento. Como regla OVERFLOW en lint (error si fuga >4px) y check post-`set_html`/`set_css` (warn en respuesta, no bloqueo) | P1 |
| **G10b** | **Escritura batch**: `set_css(templateId, frameIds[], css)` atómico — un cambio de chrome a 11 frames = 1 llamada (hoy son 11 y cada una es chance de corrupción) | P1 |
| **G10c** | **Sincronizar API REST con repo o documentar el backend real de prod**: `PUT /api/templates/:id/frames/:frameId` existe en `api/src/routes/frames.ts:43` pero en prod devuelve 404; PATCH devuelve no-JSON. Hoy la única vía confiable es `/mcp` | P1 |
| G5 | Paleta: leer brand tokens del frame si existen, si no default Futuraria | P2 |
| G7 | lint LAYOUT_MONOTONY (Regla #12): ≥3 frames consecutivos mismo esqueleto en deck ≥8 → WARN (chrome compartido NO cuenta) | P2 |
| **G10d** | **Auditar `src/components/HtmlCanvas.tsx`**: setea `transformOrigin:"top left"` y dimensiona iframe `width*scale` pero NUNCA aplica `transform:scale()` — si algo lo usa, renderiza mal; si es dead code, borrar (el editor real usa DesignFrame/Shadow DOM) | P2 |

## 🗺️ RUTAS

### MODIFICAR:
- `api/src/` — tool registry MCP (localizar el de las 255 tools; anti-patrón #1: verificar qué corre realmente en prod)
- `create_deck` handler — param `layout` (G8a) + CSS base box-sizing (G8c)
- `set_css`/`set_html`/`update_html_frame` handlers — validación G10a + batch G10b
- `lint_design` — reglas nuevas (G4/G6/G7/G8b/G8d/G9)
- renderer (`render_html_template`) — extraer función de medición reutilizable para G9

### REFERENCIA (NO modificar):
- `harness/SPEC_CREATE_CHART.md` — spec completa de create_chart (leer primero)
- `harness/CHART_RECIPES.md` — valores/patrones CSS exactos que el output debe producir
- `harness/AI_TELLS.md` — canon de 55 muletillas (fuente de G6)
- `harness/QA_OVERFLOW_2026-08-30.md` — evidencia cruda de post-mortems 4/5 (este doc la resume; el QA queda como anexo)
- `DESIGN_HARNESS_RULES.md` (vault) — contrato Reglas #0–#13

### FIXTURES (estado verificado 30-ago):
- `tpl_a8265257-8a5` (v5): 12 frames, overflow **0px medido** (scrollHeight 1068/1068, scrollWidth 1908/1908) — PASA los guards post-fix
- Slides 01–11 de v5 ANTES del fix = caso de prueba BORDERBOX_MISSING/CHROME_OVERFLOW (git history / QA doc)

## ⚠️ REGLAS PARA EL AGENTE IDE

1. `create_chart` NO crea frames — patchea frame existente (componible con create_deck).
2. Output SIEMPRE objects[] individuales — HTML monolítico = rechazado (Regla #0).
3. La math vive en el servidor — la IA llamante solo pasa data.
4. G8a default "chrome" — NO cambiar comportamiento existente sin el param.
5. G9/G10a: G9 no bloquea writes (warn); G10a SÍ rechaza writes inválidos (parse). Balance deliberado.
6. Commits atómicos con firma `[IDE Act]`.
7. Anti-patrón #1: confirmar qué backend corre en prod antes de tocar middleware (ver G10c).
8. NO tocar `api/src/routes/copyRecipes.ts` — exonerado, fuera de scope.
9. **Railway de agente (lección del 30-ago):** el agente que escribe CSS largo a mano en sesión larga SE DEGRADA. El path confiable verificado: leer via `get_frame` → cirugía con regex determinista (script, no generación) → `set_css` con el payload exacto → re-leer y verificar `cssLength`. G10b (batch) + CSS a nivel template hacen este railway innecesario — esa es la meta.

## 📊 VERIFICACIÓN POST-IMPLEMENTACIÓN (Lara/Hermes)

**create_chart:**
- [ ] create_chart(donut, [40,30,20,10]) → conic stops exactos 0/40/70/90/100
- [ ] create_chart(donut, [40,30,15]) → error Σ≠100%
- [ ] create_chart(vbars, [120,420,900]) → heights ≈ 15.5%/54.3%/100% (headroom 1.15)
- [ ] create_chart(timeline, 4 nodos) → left% equiespaciados 8–92%, sin overlap

**lint:**
- [ ] COVERAGE: v1 (tpl_419198f1) → falla; v2 (tpl_8e2c338b) → pasa
- [ ] AI-TELLS: CSS con `border-left:4px solid #d2ff02` → FAIL; sin él → PASS
- [ ] BUZZWORDS: "Seamless experience" → FAIL con match señalado
- [ ] LAYOUT_MONOTONY: v4 (tpl_dc2d5681) → WARN; v3 (tpl_5a5de21b) → PASS
- [ ] CHROME_OVERFLOW: slide 1920×1080 con content 1728×760 sin neutralizar → FAIL "192px/320px"
- [ ] BORDERBOX_MISSING: CSS de v5 pre-fix (sin box-sizing, wrapper con border 6+padding 28) → WARN "+68px/+68px"
- [ ] TYPE_FLOOR_REL: cuerpo 22px en canvas 1920 → FAIL (piso 38px); 22px en canvas 1080 → PASS

**geometría (G8a/G8c):**
- [ ] create_deck(layout:"poster") → content a 0,0,W×H real, sin título/folio
- [ ] create_deck() sin param → idéntico a hoy (regresión cero)
- [ ] create_deck en template custom (1200×628) → geometría derivada, no hardcodeada
- [ ] todo slide generado contiene `box-sizing:border-box` en su CSS base (verificable por grep)

**guard dinámico (G9):**
- [ ] set_html con div 2200px en frame 1920 → respuesta incluye warn con px de overshoot
- [ ] lint OVERFLOW sobre caso anterior → error con px; sobre v5 → PASS
- [ ] tipografía alta (slide 02 pre-fix, scrollHeight 1187 vs 1068) → detecta +119px

**escritura segura (G10a/b/c):**
- [ ] set_css con CSS truncado (llaves desbalanceadas, 553 chars) → RECHAZADO con error de parse, frame intacto
- [ ] set_css con basura (runs de dígitos >25) → RECHAZADO
- [ ] set_css con token no declarado (`--deck-tool-font`) → RECHAZADO o WARN
- [ ] set_css batch: 11 frames mismo chrome → 1 llamada atómica (todo o nada)
- [ ] PUT /api/templates/:id/frames/:frameId → responde en prod o backend real documentado

**cierre:**
- [ ] Kanban card_mtewcpgf_doib6k → done tras review MANUAL (auto-reviewer ya marcó done falso una vez)
- [ ] README de harness/ actualizado con estado

## 🧰 SCRIPT DE VERIFICACIÓN DE OVERFLOW (embrión de G9, probado 30-ago)

```js
// medir en DOM real (headless o consola), para cada slide:
const W = frameWidth, H = frameHeight, border = 6;
const maxW = W - 2*border, maxH = H - 2*border; // border-box
const wr = document.querySelector('.wr');
const oX = wr.scrollWidth - maxW, oY = wr.scrollHeight - maxH;
if (oX > 4 || oY > 4) fail(`overflow ${oX}x${oY}px`);
```

Resultado esperado tras fixes: v5 → `oX=0, oY=0` en 12/12 frames (verificado).
