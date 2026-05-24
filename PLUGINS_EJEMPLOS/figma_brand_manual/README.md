# Brand Manual Generator — Figma Plugin v2

## Plugin
- **Name:** Brand Manual Generator
- **ID:** brand-manual-generator
- **Version:** 2.0 (rewritten)

## Pages Generated (7)
| # | Página | Contenido |
|---|--------|-----------|
| 1 | Portada | Logo clonado + título "MANUAL DE MARCA" + nombre del frame + año |
| 2 | Índice | Lista numerada de secciones con descripción |
| 3 | Logotipo | Frame original clonado centrado + propiedades (ancho, alto, ratio) |
| 4 | Variantes | 4 versiones del logo: Original, Invertido, Escala de grises, Sobre color |
| 5 | Tipografía | Fuentes detectadas como specimens reales + escala tipográfica |
| 6 | Paleta de colores | Colores agrupados (primarios/secundarios) con swatch + HEX + RGB + CMYK |
| 7 | Grilla de construcción | Clearspace (40px) + área de respeto con borde punteado + co-branding demo |

## Key Changes from v1
- Pages stacked VERTICALLY (not horizontally side by side)
- Removed AI toggle (cosmetic only, not functional)
- Removed 9 generic pages → 7 specific pages
- Added Índice, Variantes, Grilla de construcción
- Added CMYK conversion
- Typography shows real font specimens (not just metadata)
- Colors show HEX + RGB + CMYK with visual swatches
- Construction grid shows clearspace with dashed border
- Co-branding section with partner placeholder

## Files
- `manifest.json` — plugin metadata
- `ui.html` — dark theme UI (380×360px)
- `code.js` — main logic (~600 lines)
- `reference-manual.pdf` — Bolt brand manual (reference)
- `REFERENCE-ANALYSIS.md` — gap analysis & future improvements
