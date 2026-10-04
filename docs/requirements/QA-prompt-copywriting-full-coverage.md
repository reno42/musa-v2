# QA-exploración-exhaustiva Copywriting al 100% (solo UI, sin MCP)

Estás probando el módulo **Copywriting** de Musa (https://design.futuraria.com) como usuario real: todo por la interfaz, con clicks y teclado en el navegador. PROHIBIDO usar tools MCP, APIs directas, curl ni creación de datos por backend. Estás autenticado con la cuenta de Renzo — el módulo Copywriting es el único módulo en alcance (NO pruebes Diseño, CRM, Inicio, Agentes ni Configuración; ya están cubiertos por otras pasadas).

Estructura que vas a recorrer (así organizas tu reporte): Copywriting tiene 7 sub-pestañas — **Calendario, Contenidos (hoja/sheet), Reportes, Atribución, Copies, Recetas, Bandeja (inbox)** — y las filas de Contenidos/Calendario abren un panel de detalle (peek panel, cajón lateral). Todo lo que sigue se prueba en cada sub-pestaña que aplique.

## Fase 0 — Inventario (10 min, antes de tocar nada)

Recorre las 7 sub-pestañas y lista TODO elemento interactivo visible: botones, tabs, filtros, búsquedas, selects, iconos con tooltip, headers clickeables (orden de columnas), links. Esta lista es tu matriz de cobertura — cada elemento se marca ✓/✕/⚠/— al final. Si un control no hace nada visible al click, es hallazgo.

## Fase 1 — Calendario (vista mensual)

1. Navegación de meses: anterior, siguiente, hoy (si existe). Verifica que las piezas de cada mes cargan y que el conteo coincide con lo que muestra Contenidos.
2. Cada pieza del calendario: hover, click — debe abrir su detalle (peek). Dentro del detalle: copy visible, canal, marca, fecha, estado, y TODO botón/acción del panel (editar, cambiar estado, duplicar, borrar, abrir template si existe).
3. Crear pieza nueva desde el calendario (botón "+"): formulario completo — valida campos vacíos, fecha inválida (ej: 2026-02-30), y una pieza válida con prefijo `QA_`. 
4. Drag & drop de una pieza `QA_` a otro día: ¿se mueve? ¿actualiza la fecha en el detalle? ¿revierte con Ctrl+Z?
5. Filtros del calendario (marca/canal/campaña/estado si existen): cada filtro solo, combinados, y limpiar filtros.
6. Cambiar el ESTADO de una pieza desde el calendario (si hay drag o dropdown directo) y desde el detalle.

## Fase 2 — Contenidos (hoja tipo spreadsheet)

1. Carga: ¿cuántas filas trae? ¿hay paginación, scroll infinito o botón "cargar más"? ¿el total mostrado coincide con las filas reales?
2. **Vista tabla**: ordena por cada columna clickeable (fecha, marca, estado…), busca en el buscador (término existente, inexistente, con acentos, mayúsculas vs minúsculas), aplica cada filtro.
3. **Vista detalle (peek panel) — EXHAUSTIVA, es el corazón de esta QA:**
   - Abre 5 piezas distintas (mezcla de estados: idea, borrador, programada, publicada si existen).
   - Cada campo visible del peek: ¿muestra el dato real de la fila?
   - **El copy completo**: ¿se ve entero? ¿los saltos de línea, emojis y acentos se renderizan bien? ¿hay botón copiar-al-portapapeles y copia exacto?
   - Cada botón del peek: editar (guarda de verdad el cambio en una pieza `QA_`), cambiar estado, eliminar (solo `QA_`), abrir template vinculado (abre el editor con el template correcto).
   - Edita el copy de una pieza `QA_` desde el peek: guarda, cierra, reabre — ¿persistió?
4. Edición inline en la tabla (si las celdas son editables): cambia canal y fecha de una `QA_` — verifica persistencia reordenando/filtrando.
5. Crear contenido desde Contenidos: formulario completo, con validaciones.
6. Duplicar y borrar la pieza `QA_` (al final deja el dataset como estaba, menos 1 pieza `QA_` que sirve de evidencia).

## Fase 3 — Copies

1. ¿Qué lista esta pestaña exactamente? Genera o crea si hay botón para ello: crea un copy `QA_` completo (con acentos, emojis, 3 párrafos).
2. Cada acción sobre un copy: ver detalle, editar, duplicar, borrar, copiar al portapapeles, mover a una pieza del calendario si existe esa acción.
3. ¿Hay conexión visible Copies ↔ Contenidos/Calendario? (ej: "usar este copy en una pieza"). Pruébala con tu `QA_`.
4. Estado vacío: filtra algo que no tenga resultados — ¿el mensaje de vacío es útil o feo/silencioso?

## Fase 4 — Recetas (aquí va la creación de contenido nuevo — la parte más importante)

La pestaña Recetas gestiona **hooks, tonos y frameworks** de escritura (hay 10 factory-default de solo lectura — AIDA, PAS, StoryBrand, etc. — más las personales del usuario).

1. Lista las 10 recetas factory: abre cada una, verifica que se ven completas y que las marcadas read-only NO dejan editarse.
2. **Crea UNA receta de cada tipo:**
   - **Un framework nuevo** `QA_` (ej: "HOOK-DATO-CTA": estructura de 3 bloques para posts técnicos — hook con dato duro ≤15 palabras, desarrollo con 1 ejemplo concreto peruano, CTA de comentario). Nómbralo con prefijo `QA_`.
   - **Un tono nuevo** `QA_` (define: trato en "tú", oraciones cortas, cero jerga corporativa, 1 emoji máximo por párrafo, contraste dato-emoción).
   - **Un hook nuevo** `QA_` (patrón de primera línea que detenga el scroll).
3. Edita tu receta `QA_`: ¿guarda? ¿duplica? ¿borra? ¿se pueden marcar con marca (brand scope) y etiqueta?
4. **Prueba el ciclo completo receta → copy:** usa el asistente/generador de copy si existe (o el flujo que la UI ofrezca) pidiendo un copy para una pieza `QA_` del calendario y citando tu framework `QA_` — ¿el copy generado respeta tu framework? ¿menciona qué recetas aplicó? Este es el test integrador: receta nueva → copy que la obedece → copy en la pieza → visible en tabla Y en detalle.
5. Si hay flujo de "investigar frameworks online y guardarlos": ábrelo, no lo ejecutes completo si consume créditos externos — documenta qué pide.

## Fase 5 — Bandeja (inbox), Reportes y Atribución

1. **Bandeja:** carga, contador, abrir ítems, acciones por ítem (responder/archivar/etiquetar si existen), filtros, estado vacío.
2. **Reportes:** cada rango de fechas (7d/30d/90d si existen), cada gráfico (hover muestra tooltip?), exportar si existe botón — verifica que los números NO estén en cero/vacíos cuando sí hay piezas (compara contra lo que ves en Contenidos: si hay 38 piezas y reportes dice 0, es bug).
3. **Atribución:** cada vista/filtro, que cargue datos coherentes, export si existe.

## Fase 6 — Integración copy ↔ diseño (cruce con el editor, SOLO lectura)

1. Desde el detalle de una pieza con template vinculado: "abrir template" → abre el editor. Verifica que el template corresponde a la pieza (nombre/formato). NO edites el diseño — solo confirma que la relación pieza↔template existe y es la correcta en ambos sentidos.
2. Verifica si el copy de la pieza aparece en algún lugar del editor (panel de capas/comentarios) o si la relación es solo el link. Documenta qué existe.

## Reglas de la sesión

- Todo dato de prueba lleva prefijo `QA_`. Al final: borra lo que puedas borrar, deja SOLO una pieza y una receta `QA_` como evidencia (anótalas en el reporte con sus IDs/nombres exactos).
- Fuera de alcance: otros módulos, preset de animación (known freeze), configuración de llaves, cualquier acción irreversible sobre datos existentes de Renzo (las 38 piezas del calendario 90d son sagradas — NUNCA las edites ni borres; pruébalas solo lectura).
- Si algo pide confirmación destructiva sobre datos reales: cancela y documéntalo como ⚠.
- Consola del navegador abierta en cada transición: cualquier error JS/MCP es hallazgo aunque la UI lo disimule.

## Formato de cada hallazgo

ID, severidad (Crítico/Alto/Medio/Bajo), sub-pestaña y fase, URL, pasos numerados con valores exactos, esperado vs obtenido, error de consola completo, screenshot.

## Entregable final

Reporte único con:
1. Resumen por severidad.
2. **Matriz de cobertura del inventario de la Fase 0**: cada control de las 7 sub-pestañas + el peek panel → ✓ OK / ✕ falló (link al bug) / ⚠ bloqueado / — no existe.
3. **Resultados del ciclo integrador** (Fase 4 punto 4): framework QA_ → copy generado → pieza → tabla → detalle, con screenshots y el texto real del copy generado citado completo.
4. Los 5 arreglos prioritarios y por qué.
5. Qué NO se pudo probar y por qué.

Deduplica. Máximo 90 minutos. Cobertura primero: si algo no responde en 3 intentos, documéntalo y sigue. Usa razonamiento mínimo, acciones directas y reporte conciso — cada verbo extra son tokens.
