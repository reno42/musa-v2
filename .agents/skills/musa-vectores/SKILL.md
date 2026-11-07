---
name: musa-vectores
description: Herramientas vectoriales de Musa (como Illustrator). Pluma y curvas bezier, formas, buscatrazos, trazados compuestos, distorsión, contornos, máscaras sobre imágenes y vectorizar imágenes o generar SVG con IA. Úsala para logos, íconos, ilustraciones y recortes precisos.
module: crear/disenos
---

# Vectores · pluma, trazados, buscatrazos y máscaras

Todo vector en Musa es una capa SVG editable dentro de un frame. Se crea o se convierte a trazado, y luego se opera sobre sus puntos. Necesitas `templateId`, `frameId` y el id de la capa (`get_template_structure`, skill `musa-diseno`).

## Flujos

**Dibujar**
- Formas exactas: `draw_shape` (rectángulo, círculo, triángulo, estrella, polígono).
- Líneas y pluma: `draw_path` (datos de trazado SVG) o `draw_bezier` (curvas cúbicas y cuadráticas).
- Para operar una forma CSS como vector: `shape_to_path` primero.

**Editar puntos**
- `edit_path_point`: un punto (mover, suave/esquina, borrar, insertar).
- `edit_path_points`: reescribe el trazado completo.
- `edit_path`: simplificar, suavizar, cerrar o invertir el trazado.
- `set_corner_radius`: redondea esquinas sin perder el trazado.
- `transform`: mover, rotar, escalar o reflejar con valores numéricos.

**Combinar y cortar**
- `pathfinder`: unir, restar, intersectar, excluir entre 2+ formas.
- `compound_path`: une varios trazados en uno con huecos (o los separa).
- `scissors`: corta un trazado en un punto. `knife`: rebana formas con una línea.

**Contornos y efectos**
- `set_stroke_style`: color, grosor, terminaciones, guiones.
- `outline_stroke`: convierte el borde en forma rellena.
- `offset_path`: expande o contrae una forma a distancia real.
- `width_path`: trazo de ancho variable.
- `distort_path`: remolino, fruncir, inflar, zigzag.
- `blend_path`: pasos intermedios entre dos formas.

**Máscaras sobre fotos**
1. Dibuja un trazado cerrado sobre la imagen.
2. `create_mask_from_path` lo vuelve máscara no destructiva de la capa de imagen.
3. `invert_mask` para invertir; `mask_brush` para pintar a mano; `fill_mask` para rellenar el sujeto con un color.

**De imagen a vector, o vector con IA**
- `trace_image`: calco local de una imagen a formas editables (sin costo de IA).
- `vectorize_image`: vectorización con IA (Quiver, llave del espacio).
- `generate_svg`: genera arte vectorial desde texto (Quiver, llave del espacio).

## Herramientas

- `draw_shape`, `draw_path`, `draw_bezier`, `shape_to_path`.
- `edit_path_point`, `edit_path_points`, `edit_path`, `set_corner_radius`, `transform`.
- `pathfinder`, `compound_path`, `scissors`, `knife`.
- `set_stroke_style`, `outline_stroke`, `offset_path`, `width_path`, `distort_path`, `blend_path`.
- `create_mask_from_path`, `invert_mask`, `mask_brush`, `fill_mask`.
- `trace_image`, `vectorize_image`, `generate_svg`.

## Reglas

- Antes de una operación destructiva sobre varias formas (buscatrazos, cuchillo), `save_version`.
- Verifica el resultado con `render_frame_png` (skill `musa-diseno`).
- Si Quiver responde sin llave, ofrece `trace_image` como alternativa gratuita.

## Ejemplos

- "Dibuja un ícono de hoja con curvas y únelo con el círculo del logo"
- "Vectoriza este logo en PNG para que quede editable"
- "Recorta la foto del producto con una máscara siguiendo su silueta"
