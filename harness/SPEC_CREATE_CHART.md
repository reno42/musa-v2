# SPEC · `create_chart` — tool nativa de charts server-side

> **Estado:** SPEC (pendiente de implementar en design-main / Qoder)
> **Por qué server-side:** las IAs fallamos en 2 cosas consistentes: la matemática de proporciones (a ojo) y acordarnos de las recetas. Si el servidor calcula y expone la primitiva, ninguna IA depende de su memoria. La receta CSS queda como fallback (CHART_RECIPES.md).

## Endpoint MCP

`create_chart(frameId, recipe, data, options) → objects[]` (devuelve objetos individuales listos para el frame — ver contrato objects en DESIGN_HARNESS_RULES)

## Parámetros

```jsonc
{
  "frameId": "frame_xxx",
  "recipe": "donut | vbars | hbars | timeline | line | statgrid",
  "data": {
    // donut/hbars/vbars/line:  [{ "label": "Product", "value": 40, "note": "US$200K" }]
    // timeline:                [{ "label": "MES 0–1", "title": "Marca + SpA", "desc": "…", "status": "done|current|todo" }]
    // statgrid:                [{ "value": "3 min", "label": "brief → carrusel" }]
  },
  "options": {
    "palette": ["#d2ff02", "#854be8", "#4a5058", "#2e2e2e"],  // default Futuraria
    "valueFormat": "currency|percent|raw",
    "placeholder": false,  // true → aplica R-V5 (violet + dasharray + [FILL])
    "contentZone": { "w": 1728, "h": 760 }  // default deck
  }
}
```

## Contratos por receta (el servidor calcula, la IA nunca)

| recipe | El servidor calcula | Output |
|---|---|---|
| donut | stops acumulados del conic-gradient; valida Σ=100% y ≤5 segmentos | shape (donut) + hole text + legend rows |
| vbars | `height% = v ÷ (max×1.15) × 100`; posiciones de ejes | N bar shapes + value texts + axis labels |
| hbars | `width% = v ÷ max × 100`; decide valor dentro/fuera (<30%) | track+fill shapes + labels |
| timeline | `left%` de nodos equiespaciados (8–92%); alternancia arriba/abajo de cards; progreso hasta nodo `current` | line + prog + nodes + cards |
| line | `y = H − (v ÷ max) × (H−2p)`; path C/S entre puntos; área; gridlines 25% | svg path + dots + value labels |
| statgrid | grid-rows 1fr según N stats; escala de numeral | N stat cards |

## Validaciones (rechazar con error claro)

1. Σ donut ≠ 100% ± 0.5 → error
2. > 5 segmentos donut / > 7 barras → error (usar tabla)
3. `data` vacío o valores no numéricos donde se piden → error
4. `placeholder: false` + valores que vienen de ranges ("52–65") → warning + fuerza placeholder

## Lint (reglas nuevas para `lint_design`)

- `COVERAGE`: contenido renderizado < 70% de la zona declarada → error
- `TYPE_FLOOR`: texto < 20px (labels de chart < 16px) en canvas ≥ 1080 → error
- `CHART_MISSING`: título del frame matchea /mercado|funds|proyecci|growth|revenue|arr|pricing/i Y no existe objeto chart → warning
- `PROPORTION`: (futuro) render → medir alturas/anchos reales vs valores declarados → error si delta > 5pp

## Notas de implementación

- Los objetos devueltos respetan el contrato objects[] (nada de HTML monolítico).
- La paleta se sobreescribe si el frame tiene brand tokens (leer CSS vars del frame).
- `create_chart` NO crea frames: patchea un frame existente (componible con create_deck).
