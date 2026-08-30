# 🎯 /goal — Calidad de decks como infraestructura: `create_chart` + guards de geometría

> 📅 2026-08-29 (v2, consolidado) | 👤 Preparado por: Hermes (para Ren → Qoder)
> 🎯 Objetivo: que la calidad de un deck generado NO dependa de que la IA "se acuerde". Math de charts server-side + contrato de geometría en `create_deck` + lint que detecta overflow antes de que llegue al usuario.
> 📦 Repo: `C:\Users\Renzo\.openclaw\workspace\design-main` → https://github.com/reno42/design
> 🚀 Deploy: design.futuraria.com (Netlify)

## 🔍 CONTEXTO — 3 post-mortems, 1 raíz

| # | Post-mortem | Síntoma | Causa raíz |
|---|---|---|---|
| 1 | Deck seed v1 (2026-08-29) | Cobertura 45–55%, cero charts reales | La math vivía en cada IA |
| 2 | Deck v3→v4 | "Maquetación dura", muletillas IA | Reglas leídas como prohibición de personalidad |
| 3 | Deck v5 poster (hoy) | "Se sale todo de la hoja" | `create_deck` mete cada slide en un chrome de contenido **1728×760 en (96,200)**; los slides poster eran **1920×1080** → 192px de fuga derecha, 320px abajo. Overflow silencioso: nada lo valida |

**Raíz común:** el servidor confía ciegamente en lo que la IA envía. Ninguna capa verifica geometría.

**Exonerado:** el módulo de copywriting (`copy_recipes`, REQ-016) es una biblioteca CRUD de hooks/tonos/frameworks — no genera ni inyecta HTML en frames. La correlación temporal con v5 fue coincidencia. PERO el riesgo "copy largo desborda contenedor" es real y lo cierra G9 (genérico, sin tocar el módulo).

**Evidencia previa:** `PRUEBAS_MCP_28JUL.md` Prueba 1 pasó medidas personalizadas y ya flaggeaba: *"Agregar validación de overflow. Si el CSS del body no coincide con el frame, debería advertir"*. G8/G9 implementan exactamente eso.

## 🏗️ ARQUITECTURA — defensa en 4 capas

```
Capa 1  CONTRATO EN GENERACIÓN   create_deck acepta layout {mode:"chrome"|"poster"}
                                 → el servidor aplica el chrome correcto ÉL MISMO.
                                 La IA declara intención; el servidor posee la geometría.
Capa 2  GUARD DINÁMICO           check overflow con motor real (headless) via el
                                 renderer que ya existe (render_html_template):
                                 scrollWidth/scrollHeight vs caja del frame, por elemento.
                                 Cubre TODO contenido: HTML, copy largo, charts, CSV.
Capa 3  LINT                     reglas baratas/static en lint_design:
                                 CHROME_OVERFLOW (la clase exacta del bug v5)
                                 + COVERAGE/TYPE_FLOOR/CHART_MISSING/AI-TELLS/MONOTONY
Capa 4  CONOCIMIENTO             ya vive: Reglas #0–#13 (vault+skill),
                                 harness/CHART_RECIPES.md, harness/AI_TELLS.md
```

Principio: **cada capa es independiente** — si la IA olvida la regla (Capa 4), el lint lo pilla (Capa 3); si el lint no ve el caso, el guard dinámico sí (Capa 2); y con Capa 1 el caso ni se produce.

## ✅ LO QUE YA FUNCIONA BIEN (no tocar)

| Funcionalidad | Estado |
|---|---|
| create_deck / create_html_carousel / create_frame | ✅ producción — SOLO agregar param `layout` |
| lint_design (heurísticas actuales) | ✅ producción — SOLO agregar reglas |
| render_html_template (renderer headless) | ✅ producción — reusar su infra para Capa 2 |
| MCP tool registry (255 tools) | ✅ producción — registrar create_chart ahí |
| detect_structure (boundingBox correcto, Prueba 1) | ✅ producción |
| profile_template_pool (maxChars por slot) | ✅ producción — presupuesto de texto ya existe para path CSV |
| Contrato objects[] (DESIGN_HARNESS_RULES #0) | ✅ vigente |

## 🔴 GAPS (priorizados)

| Gap | Descripción | Prioridad |
|---|---|---|
| G1 | Tool MCP `create_chart(frameId, recipe, data, options)` → objects[] | P0 |
| G2 | Math server-side por receta (donut stops, vbars headroom 1.15×, hbars in/out, timeline equiespaciado, line y=H−(v÷max)(H−2p)) | P0 |
| G3 | Validaciones (Σ=100%±0.5, ≤5 segmentos donut, ≤7 barras, placeholder forzado en ranges) | P0 |
| G4 | lint_design: COVERAGE (<70% zona) · TYPE_FLOOR (<20px en canvas ≥1080) · CHART_MISSING (regex título numérico sin chart) | P1 |
| G6 | lint_design AI-TELLS (basado en `harness/AI_TELLS.md`): BORDER_LEFT_ACCENT (`border-left` con color de acento ≥3px en cards/quotes) · EMOJI_ICON (🚀💡✨ en labels) · PILL_RADIUS abusivo (>5 elementos `border-radius:999px`) · BUZZWORDS (regex "seamless\|delve\|leverage\|unlock\|empower\|cutting-edge") · GRADIENT_CTA (linear-gradient en botones) | P1 |
| **G8a** | **`create_deck` param `layout: {mode:"chrome"\|"poster"}`** (default "chrome"). En "poster": el servidor emite el chrome neutralizado (content a 0,0,W×H, sin reglas de título/folio) en vez del de 1728×760. La geometría se deriva del width/height REAL del template (nada hardcodeado). Retrocompatible: sin param = comportamiento actual | **P0** |
| **G8b** | lint_design **CHROME_OVERFLOW** (static): si el root element del HTML del slide tiene dims ≥ frame completo y existe `[data-deck-chrome="content"]` de menor tamaño sin neutralizar → FAIL con px de fuga | P1 |
| **G9** | **Guard dinámico OVERFLOW** (Capa 2): reusar el renderer headless de `render_html_template` → medir scrollWidth/scrollHeight del content zone vs frame box, reportar overshoot en px por elemento. Exponer como `lint_design` regla OVERFLOW (severity error si fuga >4px) y como check interno post-`set_html`/`update_html_frame` (warn en la respuesta, no bloqueo) | **P1** |
| G5 | Paleta: leer brand tokens del frame si existen, si no default Futuraria | P2 |
| G7 | lint_design LAYOUT_MONOTONY (Regla #12): ≥3 frames consecutivos con mismo esqueleto en deck ≥8 slides → WARN "monotonía defensiva" (chrome compartido NO cuenta) | P2 |

## 🗺️ RUTAS

### MODIFICAR:
- `api/src/` — tool registry MCP (localizar el de las 255 tools; anti-patrón #1: verificar qué corre realmente en Netlify Edge vs Express)
- `create_deck` handler — param `layout` (G8a)
- `lint_design` — reglas nuevas (G4/G6/G7/G8b/G9)
- renderer (`render_html_template`) — extraer función de medición reutilizable para G9

### REFERENCIA (NO modificar):
- `harness/SPEC_CREATE_CHART.md` — spec completa de create_chart (leer primero)
- `harness/CHART_RECIPES.md` — valores/patrones CSS exactos que el output debe producir
- `harness/AI_TELLS.md` — canon de 55 muletillas (fuente de G6)
- `DESIGN_HARNESS_RULES.md` (vault) — contrato Reglas #0–#13

## ⚠️ REGLAS PARA EL AGENTE IDE

1. `create_chart` NO crea frames — patchea frame existente (componible con create_deck).
2. Output SIEMPRE objects[] individuales — HTML monolítico = rechazado (Regla #0).
3. La math vive en el servidor — la IA llamante solo pasa data.
4. G8a default "chrome" — NO cambiar comportamiento existente sin el param.
5. G9 no bloquea writes — solo reporta (warn en respuesta + regla error en lint).
6. Commits atómicos con firma `[IDE Act]`.
7. Anti-patrón #1 del repo: confirmar qué backend corre en prod antes de tocar middleware.
8. NO tocar `api/src/routes/copyRecipes.ts` — exonerado, no parte de este scope.

## 📊 VERIFICACIÓN POST-IMPLEMENTACIÓN (Lara/Hermes)

**create_chart:**
- [ ] create_chart(donut, [40,30,20,10]) → conic stops exactos 0/40/70/90/100
- [ ] create_chart(donut, [40,30,15]) → error Σ≠100%
- [ ] create_chart(vbars, [120,420,900]) → heights ≈ 15.5%/54.3%/100% (headroom 1.15)
- [ ] create_chart(timeline, 4 nodos) → left% equiespaciados 8–92%, cards alternadas sin overlap

**lint:**
- [ ] lint COVERAGE: deck v1 (tpl_419198f1) → falla; v2 (tpl_8e2c338b) → pasa
- [ ] lint AI-TELLS: CSS con `border-left:4px solid #d2ff02` → FAIL; sin él → PASS
- [ ] lint BUZZWORDS: HTML con "Seamless experience" → FAIL con match señalado
- [ ] lint LAYOUT_MONOTONY: v4 (tpl_dc2d5681) → WARN; v3 (tpl_5a5de21b) → PASS
- [ ] lint CHROME_OVERFLOW: recrear slide 1920×1080 con content 1728×760 sin neutralizar → FAIL con "192px/320px de fuga"; v5 (tpl_a8265257) neutralizado → PASS

**geometría (G8a):**
- [ ] create_deck(layout:"poster") → frames con content a 0,0,W×H y sin título/folio visibles
- [ ] create_deck() sin param → idéntico a comportamiento actual (regresión cero)
- [ ] create_deck en template custom (e.g. 1200×628) → geometría derivada, no 1728×760 hardcodeado

**guard dinámico (G9):**
- [ ] set_html con div 2200px de ancho en frame 1920 → respuesta incluye warn con px de overshoot
- [ ] lint OVERFLOW sobre el caso anterior → error con px; sobre v5 neutralizado → PASS
- [ ] copy largo en slot chico (simulado con data-slot) → OVERFLOW lo detecta por scrollHeight

**cierre:**
- [ ] Kanban card_mtewcpgf_doib6k → done tras review MANUAL (el auto-reviewer del batch ya marcó done falso una vez evaluando un slide que describía la spec; no repetir)
- [ ] README de harness/ actualizado con estado
