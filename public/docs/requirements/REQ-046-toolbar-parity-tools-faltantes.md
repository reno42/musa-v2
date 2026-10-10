# REQ-046 — Paridad de barra de herramientas con Illustrator: herramientas faltantes

**Fecha:** 2026-10-10
**Estado:** Ola 1 implementada (2026-10-10): Selección directa, Fusión, Rotar y Escalar ya viven en la rail (ver "Estado actual"). Este documento registra las ranuras de la barra de Illustrator que Musa aún no cubre y que quedan como requerimiento de desarrollo.

## Contexto

El usuario pidió que la barra del editor replique la barra de dos columnas de Illustrator (captura del 2026-10-10): mismo orden de lectura (izquierda→derecha, arriba→abajo), iconos fieles y, si falta una herramienta, se registra aquí como nuevo req; si un icono no coincide, se corrige.

## Estado actual (implementado)

Rail de dos columnas (grid `46px 46px`), pares por fila igual que IA (tras la Ola 1):

| Fila | Izquierda | Derecha |
|------|-----------|---------|
| 1 | Select | Selección directa |
| 2 | Wand (panel SAM) | Lasso |
| 3 | Pen ▾ (+/−/convertir en flyout) | Curvature |
| 4 | Text | Text on Path |
| 5 | Line | Rect ▾ (círculo/triángulo/estrella/polígono + biblioteca) |
| 6 | Pencil | Rotar |
| 7 | Escalar | Width |
| 8 | Shape Builder | Paint Bucket |
| 9 | Live Paint | Gradient |
| 10 | Eyedropper | Fusión (Blend) |
| 11 | Eraser (panel de tamaño) | Scissors |
| 12 | Knife | Frame (artboard) |
| 13 | Hand | Zoom |

Capas y swatches frontal/fondo cierran la rail a lo ancho. Comportamiento de la Ola 1: la selección directa comparte los gestos del editor de anclas (`pen-edit`); Fusión hace clic en un trazado y luego en otro para insertar 5 pasos intermedios con `blendD` de `pathOps` (mismo motor del tool MCP); Rotar/Escalar arrastran la capa bajo el cursor componiendo sobre su transform previo (base congelada en `data-ai-rotate-base` / `data-ai-scale-base`), con commit atómico de frame. Sin atajos de teclado: A/R/S ya están tomados (frame/rect/star). Los iconos existentes ya replican sus glifos de IA (flecha sólida, varita con destellos, lazo de cuerda, pluma con ojal, curvatura con anclas cuadradas, T con serifas, T en trazado, línea, rectángulo, lápiz, perfil de ancho, shape builder con flecha, bote con gota, cuadrado de degradado, borrador biselado, tijeras, artboard con esquinas, cuentagotas, mano, lupa).

## Herramientas faltantes (nuevo req)

En el orden en que aparecen en la barra de IA; prioridad = valor para un editor HTML/canvas:

| # | Herramienta IA | Atajo | Prioridad | Nota de implementación |
|---|----------------|-------|-----------|------------------------|
| 1 | ~~Selección directa~~ | A | ✅ Ola 1 | Comparte los gestos del editor de anclas de `pen-edit`/curvatura |
| 2 | ~~Fusión (Blend)~~ | W | ✅ Ola 1 | Botón de rail sobre el motor `blendD` de `pathOps` (el mismo del tool MCP `blend` de REQ-045) |
| 3 | ~~Rotar~~ | R | ✅ Ola 1 | Arrastre rota la capa bajo el cursor sobre su centro (transform CSS) |
| 4 | ~~Escalar~~ | S | ✅ Ola 1 | Arrastre escala la capa bajo el cursor desde su centro (transform CSS) |
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

1. ~~**Ola 1:** Selección directa, Blend (botón → motor MCP), Rotar, Escalar.~~ → implementada 2026-10-10.
2. **Ola 2:** Reflejar, Transformación libre, Pincel, Gráfico, swatch "Sin relleno".
3. **Ola 3:** Shear/Mesh según pedido; Touch Type/Perspectiva/Símbolos/Slice solo si el usuario los confirma.

## Convenciones respetadas

- Iconos: SVG trazo 1.7, lienzo 24×24, sin emojis.
- Atajos: no reasignar letras ya tomadas; los nuevos entran por `EditorV2` keyboard map.
- Rail: los paneles del wand (CLIPSeg) y del borrador (tamaño) se mantienen intactos al reordenar.
