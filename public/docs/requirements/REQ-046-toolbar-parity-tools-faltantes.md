# REQ-046 — Paridad de barra de herramientas con Illustrator: herramientas faltantes

**Fecha:** 2026-10-10
**Estado:** Propuesto. El layout de dos columnas y el orden de lectura de Illustrator ya están implementados en `src/components/FloatingToolbar.tsx` (rail de dos columnas con pares tipo IA). Este documento registra las ranuras de la barra de Illustrator que Musa aún no cubre y que quedan como requerimiento de desarrollo.

## Contexto

El usuario pidió que la barra del editor replique la barra de dos columnas de Illustrator (captura del 2026-10-10): mismo orden de lectura (izquierda→derecha, arriba→abajo), iconos fieles y, si falta una herramienta, se registra aquí como nuevo req; si un icono no coincide, se corrige.

## Estado actual (implementado)

Rail de dos columnas (grid `46px 46px`), pares por fila igual que IA:

| Fila | Izquierda | Derecha |
|------|-----------|---------|
| 1 | Select | Wand |
| 2 | Lasso | Pen ▾ (+/−/convertir en flyout) |
| 3 | Curvature | Text |
| 4 | Text on Path | Line |
| 5 | Rect ▾ (círculo/triángulo/estrella/polígono + biblioteca) | Pencil |
| 6 | Width | Shape Builder |
| 7 | Paint Bucket | Live Paint |
| 8 | Gradient | Eyedropper |
| 9 | Eraser (panel de tamaño) | Scissors |
| 10 | Knife | Frame (artboard) |
| 11 | Hand | Zoom |

Capas y swatches frontal/fondo cierran la rail a lo ancho. Los iconos existentes ya replican sus glifos de IA (flecha sólida, varita con destellos, lazo de cuerda, pluma con ojal, curvatura con anclas cuadradas, T con serifas, T en trazado, línea, rectángulo, lápiz, perfil de ancho, shape builder con flecha, bote con gota, cuadrado de degradado, borrador biselado, tijeras, artboard con esquinas, cuentagotas, mano, lupa).

## Herramientas faltantes (nuevo req)

En el orden en que aparecen en la barra de IA; prioridad = valor para un editor HTML/canvas:

| # | Herramienta IA | Atajo | Prioridad | Nota de implementación |
|---|----------------|-------|-----------|------------------------|
| 1 | Selección directa | A | Alta | Editar anclas/segmentos de un path ya insertado sin la pluma; reusa el editor de anclas de `pen-edit`/curvatura |
| 2 | Fusión (Blend) | W | Alta | El motor ya existe como tool MCP `blend` (REQ-045); falta botón de rail que lo dispare sobre la selección |
| 3 | Rotar | R | Alta | Transformación de selección con manija; el motor de transform ya soporta rotate |
| 4 | Escalar | S | Alta | Igual: motor existente, falta tool dedicada |
| 5 | Reflejar | O | Media | Mismo motor de transform |
| 6 | Transformación libre | E | Media | Agrupa mover/rotar/escalar en una manija |
| 7 | Pincel (Paintbrush) | B | Media | Trazos con pincelada (perfiles/estilos) diferenciado del lápiz plano |
| 8 | Gráfico (Chart) | J | Media | Conecta con el goal de creación de charts (GOAL_IDE_AGENT_CREATE_CHART) |
| 9 | Sin relleno (swatch none) | / | Media | Tercer swatch mini bajo frontal/fondo; pone fill en none |
| 10 | Inclinar (Shear) | — | Baja | Mismo motor de transform |
| 11 | Malla (Mesh) | U | Baja | Degradado en malla sobre HTML canvas es complejo; evaluar |
| 12 | Touch Type | ⇧T | Baja | Texto HTML no se edita glifo a glifo; probablemente omitir |
| 13 | Perspectiva (grid + selección) | ⇧P | Omitir | No aplica a canvas HTML plano |
| 14 | Rociador de símbolos / Rebanadas (Slice) | — | Omitir | Sin equivalente en el modelo de documento |

## Criterio de implementación (olas)

1. **Ola 1:** Selección directa, Blend (botón → motor MCP), Rotar, Escalar.
2. **Ola 2:** Reflejar, Transformación libre, Pincel, Gráfico, swatch "Sin relleno".
3. **Ola 3:** Shear/Mesh según pedido; Touch Type/Perspectiva/Símbolos/Slice solo si el usuario los confirma.

## Convenciones respetadas

- Iconos: SVG trazo 1.7, lienzo 24×24, sin emojis.
- Atajos: no reasignar letras ya tomadas; los nuevos entran por `EditorV2` keyboard map.
- Rail: los paneles del wand (CLIPSeg) y del borrador (tamaño) se mantienen intactos al reordenar.
