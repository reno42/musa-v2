# harness/ — Chart Recipes + Spec (2026-08-29)

Carpeta nueva, no toca archivos existentes del repo. Sin commit (regla Qoder).

## Qué contiene

- **CHART_RECIPES.md** — canon v1: reglas de composición (R-V1 presupuesto vertical ≥70%, R-V2 piso tipográfico, R-V3 chart obligatorio, R-V4 math determinística, R-V5 placeholders) + 6 recetas CSS (donut, vbars, hbars, timeline, line SVG, stat grid) + anti-patrones.
- **SPEC_CREATE_CHART.md** — spec de la tool nativa `create_chart` (server calcula proporciones, devuelve objects[]) + 4 reglas de lint nuevas (COVERAGE, TYPE_FLOOR, CHART_MISSING, PROPORTION).

## Dónde vive cada cosa (arquitectura de la mejora)

| Capa | Dónde | Estado |
|---|---|---|
| Kit vivo | Recipe `Harness Chart Kit v1` en Supabase (template tpl_c233aa49-d74) | ✅ hecho |
| Contrato IA | DESIGN_HARNESS_RULES.md (vault) Reglas #8 y #9 + skill design-harness-rules | ✅ hecho |
| Canon | este folder | ✅ hecho |
| Tool nativa | SPEC_CREATE_CHART.md → implementar en api/ | ⏳ pendiente (Qoder) |

## Por qué

Diagnóstico post-mortem del deck seed: las IAs generábamos composiciones que ocupaban 45–55% de la altura (document-flow, sin presupuesto vertical) y cero gráficos reales en slides numéricos. La corrección no puede depender de la memoria de una IA: tiene que ser infraestructura (recetas instanciables + reglas de contrato + eventualmente tool server-side que haga la math).
