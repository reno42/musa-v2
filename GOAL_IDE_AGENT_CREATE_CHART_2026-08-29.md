# 🎯 /goal — Tool nativa `create_chart` + lint de composición (Reglas #8/#9)

> 📅 2026-08-29 | 👤 Preparado por: Hermes (para Ren → Qoder)
> 🎯 Objetivo: implementar `create_chart` como tool MCP server-side que calcula TODA la matemática de charts y devuelve `objects[]`, + reglas de lint COVERAGE/TYPE_FLOOR/CHART_MISSING.
> 📦 Repo: `C:\Users\Renzo\.openclaw\workspace\design-main` → https://github.com/reno42/design
> 🚀 Deploy: design.futuraria.com (Netlify)

## 🔍 CONTEXTO

Post-mortem del deck seed 2026-08-29: las IAs generaban slides con 45–55% de cobertura vertical y cero gráficos reales en slides numéricos. La corrección documentada (canon CSS) sigue dependiendo de que cada IA "se acuerde". Esta feature vuelve la math determinística del lado servidor.

**Ya está en main (commit 3f02dd7):**
- `harness/CHART_RECIPES.md` — canon (R-V1..R-V5 + recetas R1–R6)
- `harness/SPEC_CREATE_CHART.md` — **ESTA ES LA SPEC A IMPLEMENTAR (leer primero)**
- Kanban: card `card_mtewcpgf_doib6k` con acceptance criteria

## ✅ LO QUE YA FUNCIONA BIEN (no tocar)

| Funcionalidad | Estado |
|---|---|
| create_deck / create_html_carousel / create_frame | ✅ producción |
| lint_design (heurísticas actuales) | ✅ producción — SOLO agregar reglas |
| MCP tool registry (255 tools) | ✅ producción — registrar create_chart ahí |
| Contrato objects[] (DESIGN_HARNESS_RULES #0) | ✅ vigente |

## 🔴 GAPS (priorizados)

| Gap | Descripción | Prioridad |
|---|---|---|
| G1 | Tool MCP `create_chart(frameId, recipe, data, options)` → objects[] | P0 |
| G2 | Math server-side por receta (donut stops, vbars headroom 1.15×, hbars in/out, timeline equiespaciado, line y=H−(v÷max)(H−2p)) | P0 |
| G3 | Validaciones (Σ=100%±0.5, ≤5 segmentos donut, ≤7 barras, placeholder forzado en ranges) | P0 |
| G4 | lint_design: COVERAGE (<70% zona) · TYPE_FLOOR (<20px en canvas ≥1080) · CHART_MISSING (regex título numérico sin chart) | P1 |
| G5 | Paleta: leer brand tokens del frame si existen, si no default Futuraria | P2 |

## 🗺️ RUTAS

### MODIFICAR:
- `api/src/` — endpoint/registro MCP de la tool (localizar registry existente de las 255 tools; anti-patrón #1: verificar qué corre realmente en Netlify Edge vs Express)
- lint_design actual — agregar las 3 reglas

### REFERENCIA (NO modificar):
- `harness/SPEC_CREATE_CHART.md` — spec completa (contratos por receta, validaciones)
- `harness/CHART_RECIPES.md` — valores/patrones CSS exactos que el output debe producir
- `DESIGN_HARNESS_RULES.md` (repo) — contrato objects[]

## ⚠️ REGLAS PARA EL AGENTE IDE

1. `create_chart` NO crea frames — patchea frame existente (componible con create_deck).
2. Output SIEMPRE objects[] individuales — HTML monolítico = rechazado (Regla #0).
3. La math vive en el servidor — la IA llamante solo pasa data.
4. Commits atómicos con firma `[IDE Act]`.
5. Anti-patrón #1 del repo: confirmar qué backend corre en prod antes de tocar middleware.

## 📊 VERIFICACIÓN POST-IMPLEMENTACIÓN (Lara/Hermes)

- [ ] create_chart(donut, [40,30,20,10]) → conic stops exactos 0/40/70/90/100
- [ ] create_chart(donut, [40,30,15]) → error Σ≠100%
- [ ] create_chart(vbars, [120,420,900]) → heights ≈ 15.5%/54.3%/100% (headroom 1.15)
- [ ] create_chart(timeline, 4 nodos) → left% equiespaciados 8–92%, cards alternadas sin overlap
- [ ] lint_design sobre deck v1 (tpl_419198f1) → COVERAGE falla; sobre v2 (tpl_8e2c338b) → pasa
- [ ] Kanban card_mtewcpgf_doib6k → done tras review
