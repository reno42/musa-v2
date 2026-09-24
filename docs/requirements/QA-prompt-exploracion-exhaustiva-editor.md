# QA-exploración-exhaustiva del editor Musa (solo UI, sin MCP)

Estás probando Musa (https://design.futuraria.com) como usuario real: todo por la interfaz, con clicks y teclado en el navegador. PROHIBIDO usar tools MCP, APIs directas, curl ni creación de datos por backend — el objetivo es ejercitar la UI completa. Excepción: si el editor no abre o algo crashea, repórtalo y usa la ruta alternativa solo para continuar la sesión, anotándolo.

## Fase 1 — Crear un diseño desde cero POR LA UI que use TODAS las herramientas

Crea un archivo nuevo 1080×1080 desde el dashboard (Diseño → nuevo archivo). Dóminalo **"QA_Explorador_Total"**. Sobre ese lienzo, ejercita CADA herramienta del editor. El diseño final debe contener, como mínimo, un elemento creado con cada una de estas herramientas/funciones — y cada una genera su hallazgo (pass/fail + consola):

**Herramientas de dibujo (barra izquierda):**
1. **Select/Hand** (Hand solo abrir/cambiar, sin profundizar)
2. **Frame** — crea un frame dentro del canvas
3. **Texto (T)** — 2 textos: título "Hola Mira, me encanta Hermes" y subtítulo "y con ChatGPT son lo máximo"
4. **Rectángulo** — con esquinas redondeadas (ajusta radius desde Properties)
5. **Elipse/Círculo**
6. **Polígono/Estrella** (si existe)
7. **Línea/Líneas**
8. **Pluma (Pen)** — dibuja un path de 4+ puntos con anclas y cierra el path
9. **Bezier** — curva con al menos 2 puntos de control (arrastra las manijas de las anclas)
10. **Lápiz/Dibujo a mano alzada (Freehand/Pencil)** — traza libre con el mouse; prueba también su variante con suavizado si el panel la ofrece
11. **Comentarios** — deja un comentario en el canvas y resuélvelo

**Color y pintura (panel Properties/Contextual):**
12. **Color sólido RGB** — color picker completo: hex (#7B2FF7), RGB numérico, y seleccionador visual del espectro
13. **Color CMYK** — si el picker tiene pestaña/entrada CMYK, introduce valores numéricos CMYK y aplica; si NO existe entrada CMYK en la UI, documéntalo como hallazgo (esperado: Musa soporta export CMYK 300dpi — ¿dónde se controla el color CMYK?)
14. **Degradado (gradient)** — linear con 2+ stops; edita el color de cada stop, el ángulo y arrastra el controlador en canvas; prueba también radial si existe
15. **Opacidad/transparencia** — slider y valor numérico en un elemento
16. **Sombras (drop shadow)** — aplica sombra a un elemento: edita offset X/Y, blur, color y spread desde Properties
17. **Sombra interior (inner shadow)** si existe
18. **Blur** (layer blur o background blur) si existe
19. **Stroke/borde** — aplica stroke a un elemento: grosor, color, y alineación (inside/center/outside) si está
20. **Dashed/dotted stroke** si existe el control
21. **Blend modes** (multiply, screen, overlay…) en el panel de capas o propiedades
22. **Máscara** — enmascara una imagen o forma con otra (si existe la función mask)

**Manipulación y transformación:**
23. Arrastrar/mover elementos, redimensionar por manijas, rotar por manija de rotación
24. Rotación y escala numérica exacta desde Properties (ej: rotar 15°, escalar 137%)
25. Duplicar (Ctrl+D y alt+drag si aplica)
26. Copiar/pegar (Ctrl+C/V) entre frames
27. Agrupar (Ctrl+G) y desagrupar
28. Orden Z: subir/bajar capas, llevar al frente/al fondo (botones o atajos)
29. Alinear y distribuir (panel de alineación): 3 funciones distintas
30. Bloquear elemento y desbloquear
31. Flip horizontal/vertical si existe
32. Boolean ops (union/subtract/intersect) si existen

**Capas:**
33. Renombrar capa, reordenar arrastrando, ocultar (ojo) y mostrar, anidar en grupo
34. Buscador/filtro de capas si existe

**Vista y documento:**
35. Zoom: botones +/-, input numérico (prueba 5 y 5000), zoom to fit, Ctrl+scroll
36. Undo/redo (Ctrl+Z / Ctrl+Shift+Z) tras cada cambio importante; valida que el historial (panel History si existe) lo registre
37. Reglas/guías/grid si existen (activarlas y mover una guía)
38. Guardar versión (Ctrl+S o botón): confirmación visible; abre el panel History/Versiones y verifica que la versión quedó registrada
39. Renombrar el archivo desde la topbar

**Export:**
40. Menú Exportar completo: exporta UN PNG y UN PDF; verifica descarga y tamaño >0 bytes. Si hay opción CMYK/300dpi en el export, actívala y exporta también — es la prueba clave del punto 13
41. Copy as / share link si existen (sin publicar en redes)

## FUERA DE ALCANCE (no tocar)
Menús **Manos/Hands** (gestos, cámara) y **Video** (export video, animación de video). Tampoco el preset de animación del panel Animation (known freeze).

## Fase 2 — Menús y paneles restantes
- Click derecho sobre: canvas vacío, un elemento, una capa en Layers, un texto en edición — documenta cada menú contextual y prueba 1 acción de cada uno
- Panel Information/Meta, History, Biblioteca de estilos, Batchamator (ejecuta UNA acción de batch con 2 elementos y reviértela), AI Settings (abre cada sub-pestaña, no conectes nada sin registrar qué pide)
- Con el diseño terminado, vuelve al dashboard: verifica que el archivo aparece con thumbnail actualizado; ábrelo y ciérralo

## Cierre
Deja el archivo llamado "QA_Explorador_Total" (no lo borres — sirve de evidencia). Si creaste archivos extra, bórralos.

## Formato de cada hallazgo
ID, severidad (Crítico/Alto/Medio/Bajo), número de ítem de esta lista, URL, pasos numerados con valores exactos, esperado vs obtenido, error de consola completo, screenshot.

## Entregable final
Reporte único con:
1. Resumen por severidad (total de bugs)
2. **Matriz de cobertura de los 41 ítems**: ✓ probado OK / ✕ falló (link al bug) / ⚠ bloqueado (por qué) / — no existe en la UI (esto también es hallazgo: promete la herramienta y falta)
3. Los 5 arreglos prioritarios y por qué
4. Qué NO se pudo probar y por qué

Deduplica bugs que se manifiestan en varias herramientas. Máximo 90 minutos. Si una herramienta no responde en 3 intentos, documéntala y sigue — cobertura primero.
