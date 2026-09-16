# SPEC · `create_chart` — tool nativa de charts server-side

> **Estado:** IMPLEMENTADO (15-sep-2026). Módulo puro `netlify/functions/chart-builder.mjs` + case handler en `netlify/functions/mcp.mjs`. Sin imports de plataforma — Workers-compatible (deploy CF design-futuraria).
> **Por qué server-side:** las IAs fallamos en 2 cosas consistentes: la matemática de proporciones (a ojo) y acordarnos de las recetas. Si el servidor calcula y expone la primitiva, ninguna IA depende de su memoria. La receta CSS queda como fallback (CHART_RECIPES.md).

## Endpoint MCP

`create_chart(templateId, recipe, data, options) → { success, templateId, frameId, recipe, objects, warnings }`

Patchea UN frame existente del template (NO crea frames — componible con create_deck). Target: `frameId` explícito, o el primer frame si se omite. Si el template aún no tiene frames (p.ej. recién creado por create_html_template), escribe a nivel template — misma convención backward-compat de set_html/set_css. Modo `replace` (default) sobrescribe el html/css del target; modo `append` inyecta el chart antes del último `</div>` del html existente y concatena el CSS.

## Parámetros

```jsonc
{
  "templateId": "tpl_xxx",       // required
  "frameId": "fr_xxx",           // opcional — default: primer frame del template
  "recipe": "donut | vbars | hbars | timeline | line | statgrid | mindmap | journey | versus | matrix2x2 | storyarc",  // required
  "data": [ ... ],               // required — shape por receta (ver tabla)
  "palette": ["#d2ff02", "#854be8", "#4a5058", "#2e2e2e"],  // default Futuraria
  "valueFormat": "currency|percent|raw",
  "placeholder": false,          // true → aplica R-V5 (violet #854be8 + dashed + [FILL])
  "mode": "replace|append",
  "highlightIndex": 2,           // resalta el ítem i (vbars/hbars/line/versus)
  "headA": "Antes", "headB": "Después",        // versus
  "quadrantTitles": ["...", "...", "...", "..."],  // matrix2x2
  "axisX": "Precio", "axisY": "Valor"          // matrix2x2
}
```

## Contratos por receta (el servidor calcula, la IA nunca)

| recipe | data shape | El servidor calcula | Output |
|---|---|---|---|
| donut | `[{label, value}]` Σ=100 | stops acumulados del conic-gradient; valida Σ=100±0.5 y ≤5 segmentos | donut + hole text + legend |
| vbars | `[{label, value}]` ≤7 | `height% = v ÷ (max×1.15) × 100`; ejes y labels de valor | N bars + axis labels |
| hbars | `[{label, value}]` | `width% = v ÷ max × 100`; valor dentro/fuera (<30%) | track+fill + labels |
| timeline | `[{label, title, desc, status: done\|current\|todo}]` | `left%` de nodos (8–92%); cards alternadas; progreso hasta `current` | line + prog + nodes + cards |
| line | `[{label, value}]` | `y = H − (v ÷ max) × (H−2p)`; path C/S; área; gridlines | svg path + dots + value labels |
| statgrid | `[{value, label}]` 2–4 | grid-rows 1fr; escala de numeral | N stat cards |
| mindmap | `[0]` = concepto central `{label, desc}`; `[1..6]` = ramas `{label, desc}` | espina horizontal + tarjetas colgando; root destacado | root + spine + branch cards |
| journey | `[{label, desc}]` 2–6 pasos | nodos equiespaciados `left% = 8 + i·84/(N−1)`; numeración 01..06 | línea + nodos numerados + cards |
| versus | `[{label, a, b}]` ≤6 filas | header chips headA/headB + filas A\|attr\|B; highlight por índice | head + N paired rows |
| matrix2x2 | `[{label, x: low\|high, y: low\|high}]` | grilla 2×2 (celda ≤44% alto); chips posicionados por cuadrante `x-y`; ejes con títulos | 4 quadrants + chips + ejes |
| storyarc | `[{kicker, title, desc}]` — EXACTAMENTE 3 (historia → técnico → empresa) | 3 columnas 1fr + flechas SVG entre tandas | 3 cols + 2 arrows |

Escala: `s = clamp(min(zone.w/1728, zone.h/760), 0.55, 2)` — todos los tamaños (tipos, gaps, radios) se multiplican por `s` para respetar R-V1/R-V2 en cualquier frame, no solo decks 1920×1080.

## Validaciones (rechazar con error claro → MCP -32602)

1. `recipe` fuera del enum → error con lista válida
2. `data` vacío o no-array → error
3. Σ donut ≠ 100% ± 0.5 → error
4. > 5 segmentos donut / > 7 barras / > 6 ramas mindmap / > 6 pasos journey / > 6 filas versus / storyarc ≠ 3 → error
5. mindmap sin rama (data[1..] vacío) → error
6. `placeholder: false` + valores que vienen de ranges ("52–65") → warning + fuerza placeholder

## Lint (reglas para `lint_design`)

- `COVERAGE`: contenido renderizado < 70% de la zona declarada → error (R-V1)
- `TYPE_FLOOR`: texto < 20px (labels de chart < 16px) en canvas ≥ 1080 → error (R-V2)
- `CHART_MISSING`: título del frame matchea /mercado|funds|proyecci|growth|revenue|arr|pricing/i Y no existe objeto chart → warning
- `PROPORTION`: (futuro) render → medir alturas/anchos reales vs valores declarados → error si delta > 5pp

## Notas de implementación

- Módulo puro sin imports de plataforma: `buildChart({recipe, data, palette, zone, ...})` → `{html, css, objects, warnings}`. Testeable sin runtime del server.
- El handler MCP sanitiza con DOMPurify (misma config que set_html) y pasa por `normalizeLayersFirstWrite` antes de escribir el frame — el chart entra al sistema de layers como un objeto más.
- Clases CSS prefijadas `cc-` para que el modo append nunca colisione con el CSS existente del frame.
- La paleta se sobreescribe con `options.palette`; placeholder fuerza violeta #854be8 + dasharray + tag [FILL] (R-V5).
- Catálogo cliente: `src/components/chartCatalog.tsx` (CHART_TYPES + ChartTypePreview con SVGs esquemáticos para la UI de Planilla).
