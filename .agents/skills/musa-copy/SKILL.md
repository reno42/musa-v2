---
name: musa-copy
description: Copywriting en Musa. Redactar, reescribir y traducir textos de publicaciones, piezas y correos con la voz de cada marca y las recetas de escritura (AIDA, PAS, hooks). Úsala siempre que el entregable principal sea texto.
module: transversal
---

# Copy · textos con la voz de la marca

El copy en Musa vive en tres lugares: el campo `copy` de cada pieza del calendario, los textos dentro de los diseños y el cuerpo de los correos. Las **recetas de escritura** (frameworks, hooks, tonos) son la biblioteca de la cuenta: 10 de fábrica (AIDA, PAS, StoryBrand…) más las propias.

## Flujos

**Escribir el copy de una pieza**
1. `get_brand_strategy({ workspaceId, brandId })` → esencia, ejes de tono (0-100), personas, voz. Es la fuente de la voz.
2. `list_copy_recipes()` y elige la receta adecuada (o la que la marca suele usar).
3. Redacta tú misma. Usa `ai_generate_text` solo si la persona quiere que lo haga el modelo del espacio.
4. Guarda: en una pieza del calendario con `update_content({ id, copy })`; dentro de un diseño con `edit_text_content({ templateId, frameId, layerId, text })`.

**Revisar o reescribir todos los textos de un diseño o espacio**
1. `list_all_texts({ templateId })` para un diseño, o `list_workspace_texts({ workspaceId })` para todo el espacio (rápido, solo lectura).
2. Propón los cambios; aplícalos con `edit_text_content` capa por capa.
3. Si el texto nuevo es más largo, mide antes con `text_metrics` (skill `musa-diseno`) para que no se desborde.

**Traducir**
- `ai_translate({ templateId?, text?, targetLanguage })`. Para un diseño, revisa después que nada se desborde.

**Guardar una receta nueva**
- `create_copy_recipe({ name, type: "hook" | "tono" | "framework" | "otro", content })`. El contenido debe ser autosuficiente: instrucciones + un ejemplo, para que cualquier IA lo aplique después. Las de fábrica no se editan.

## Herramientas

- `get_brand_strategy`: voz, tono, público y personas de la marca.
- `update_brand_strategy`: ajusta secciones de la estrategia (voz, tono, audiencia) cuando la persona lo pide.
- `list_copy_recipes`: recetas de escritura de la cuenta.
- `create_copy_recipe`: guarda una receta propia.
- `update_copy_recipe`: edita una receta propia.
- `delete_copy_recipe`: borra una receta propia.
- `ai_generate_text`: genera texto con el modelo del espacio (BYOK).
- `ai_translate`: traduce texto suelto o los textos de un diseño.
- `list_workspace_texts`: todos los textos del espacio, rápido.
- `list_all_texts`: todos los textos de un diseño (frames y objetos sueltos).
- `edit_text_content`: cambia el texto de una capa.
- `update_content`: guarda el copy en una pieza del calendario.

## Reglas

- La voz sale de la estrategia de la marca, no de tu estilo.
- Si la persona te da un texto exacto, se respeta palabra por palabra.
- Un post de Instagram, uno de LinkedIn y un asunto de correo tienen largos distintos: adapta, no copies.

## Ejemplos

- "Escribe los copys de las 12 piezas de noviembre de Kuna con la receta PAS"
- "Revisa todos los textos del carrusel y déjalos en el tono de la marca"
- "Traduce el deck de lanzamiento al inglés"
