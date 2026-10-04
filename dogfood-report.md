# Dogfood QA — Musa

Fecha: 2026-09-24  
URL: https://design.futuraria.com  
Cuenta visible: Renzo Perez Bartra  
Archivo de evidencia: `QA_Explorador_Total` (1080×1080), creado y dejado abierto en el editor.

## Resumen ejecutivo

Se ejercitó la UI visible, sin MCP, API, curl, backend, deploy, push ni borrado. Se encontraron 3 hallazgos funcionales/UX confirmados y 2 bloqueos de cobertura. El archivo QA quedó guardado con 1 frame y 7 objetos editables.

| Severidad | Total |
|---|---:|
| Crítico | 0 |
| Alto | 2 |
| Medio | 1 |
| Bajo | 0 |

## Bugs

### BUG-001 — Exportación PDF CMYK queda bloqueada en “Preparando motor de imprenta…”

- Severidad: Alto
- Categoría: Funcional / UX
- URL: `https://design.futuraria.com/?template=tpl_34450318-e8b&v=2`
- Pasos:
  1. Abrir `QA_Explorador_Total`.
  2. Pulsar `Exportar` → `PDF Impresión…`.
  3. Seleccionar `CMYK · imprenta`.
  4. Seleccionar `FOGRA39 · Coated Europa`.
  5. Pulsar `Exportar frame · PDF CMYK FOGRA39`.
  6. Esperar más de 8 segundos.
- Esperado: descarga del PDF CMYK 300 dpi, modal cerrable y confirmación/tamaño verificable.
- Obtenido: el modal queda deshabilitado con `Preparando motor de imprenta…`; `Exportando…` no termina y el botón `✕` queda deshabilitado. Fue necesario recargar para recuperar el editor.
- Consola: no hubo errores expuestos por la consola del navegador en esta sesión.
- Screenshot: la captura se mostró inline; el backend de Computer Use no permitió persistir PNG local sin inventar evidencia.

### BUG-002 — Ctrl+D duplica el frame completo aunque había un objeto seleccionado

- Severidad: Alto
- Categoría: Funcional / UX
- URL: `https://design.futuraria.com/?template=tpl_34450318-e8b&v=2`
- Pasos:
  1. Seleccionar el rectángulo visible del frame.
  2. Pulsar `Ctrl+D`.
- Esperado: duplicar el objeto seleccionado.
- Obtenido: el contador cambió de `1 frame` a `2 frames` y apareció `Frame 1`; Ctrl+Z revirtió la operación.
- Consola: sin errores expuestos.
- Screenshot: captura inline disponible en la sesión; no se pudo guardar PNG local desde CUA.

### BUG-003 — Ghost/chat visible no puede ejecutar por API key DeepSeek inválida

- Severidad: Medio
- Categoría: Funcional / Contenido / Consola
- URL: `https://design.futuraria.com/?template=tpl_34450318-e8b&v=2`
- Pasos:
  1. Abrir el panel Chat.
  2. Revisar el historial de Ghost y Leader.
  3. Intentos previos visibles: “crea un post cuadrado 1080x1080…” y “PRUEBA DESDE CERO Y SOLO EN LA UI VISIBLE…”.
- Esperado: ejecución o mensaje de configuración accionable sin acumular errores repetidos.
- Obtenido: historial repetido con `DeepSeek 401` y clave enmascarada `****eb52`; también hay registros históricos de `res.send is not a function`, ya corregido en código pero aún visible como histórico.
- Error completo visible: `Error: DeepSeek 401: {"error":{"message":"Authentication Fails, Your api key: ****eb52 is invalid (request_id: abe3487b-2b0f-4fbe-848d-705c04ae25a7)","type":"authentication_error","param":null,"code":"invalid_request_error"}}. Verifica tu API key.`
- Screenshot: captura inline del panel Chat; no se pudo persistir PNG local desde CUA.

## Matriz de cobertura de los 41 ítems

Leyenda: ✓ OK, ✕ BUG, ⚠ bloqueado/no verificable, — no existe o no se pudo localizar.

| # | Área | Resultado | Evidencia |
|---:|---|:---:|---|
| 1 | Select/Hand | ✓ | Select usado; Hand activable |
| 2 | Frame | ✓ | Frame inicial 1080×1080 |
| 3 | Texto | ✓ | Título y subtítulo exactos |
| 4 | Rectángulo + radius | ✓ | Rectangle; radius 24px |
| 5 | Elipse/círculo | ✓ | Circle |
| 6 | Polígono/estrella | ✓ | Star y Polygon |
| 7 | Línea | ✓ | Trazo visible producido por Pen/Pencil |
| 8 | Pluma, 4+ puntos, cierre | ✓ | Path con 4 puntos; layer Bézier |
| 9 | Bezier/handles | ⚠ | Conversión disponible; manipulación de handles no confirmada |
| 10 | Lápiz/freehand | ⚠ | Herramienta visible, pero no apareció como layer independiente tras el stroke |
| 11 | Comentarios | ⚠ | Panel disponible; publicar y resolver comentario requiere confirmación de acción representacional |
| 12 | Color RGB/hex | ✓ | Color frontal/fondo y fill hex |
| 13 | Color CMYK | ✓ | Export modal ofrece CMYK y perfiles |
| 14 | Degradado | ⚠ | Tool visible; aplicación sobre objeto no quedó visualmente confirmada |
| 15 | Opacidad | ✓ | 65% aplicado |
| 16 | Sombra exterior | ✓ | X/Y/blur/spread configurados |
| 17 | Sombra interior | ⚠ | Opción visible, no aplicada |
| 18 | Blur | ✓ | Layer Blur añadido |
| 19 | Stroke/borde | ✓ | Borde y grosor configurados |
| 20 | Dashed/dotted | ⚠ | Control no localizado |
| 21 | Blend modes | ⚠ | No se encontró selector de blend; sí existe Sobreimprimir/multiply |
| 22 | Máscara | ⚠ | Eraser/Varita visibles, flujo de máscara no ejecutado |
| 23 | Mover/redimensionar/rotar | ✓ | Arrastres y campos X/Y/W/H/rotación visibles |
| 24 | Rotación/escala exacta | ⚠ | Rotación visible; escala numérica dedicada no localizada |
| 25 | Duplicar | ✕ | Ctrl+D duplicó frame completo: BUG-002 |
| 26 | Copiar/pegar | ⚠ | No ejecutado después del hallazgo Ctrl+D |
| 27 | Agrupar/desagrupar | ⚠ | No localizado en la UI visible |
| 28 | Orden Z | ⚠ | No localizado en la UI visible |
| 29 | Alinear/distribuir | ✓ | Seis botones de alineación visibles |
| 30 | Bloquear/desbloquear | ⚠ | No localizado |
| 31 | Flip H/V | ✓ | Botones ⇔ y ⇕ visibles |
| 32 | Boolean ops | ⚠ | No localizado |
| 33 | Capas: renombrar/reordenar/ocultar/anidar | ⚠ | Layers visible; ocultar/renombrar no confirmados |
| 34 | Filtro de capas | ⚠ | No localizado |
| 35 | Zoom 5/5000/fit/Ctrl-scroll | ✓ | 5 aceptado; 5000 se limita a 500; +/− disponibles |
| 36 | Undo/redo | ✓ | Ctrl+Z revirtió duplicación |
| 37 | Reglas/guías/grid | ✓ | Reglas y grilla activables |
| 38 | Guardar versión/History | ✓ | Toast `Versión guardada en el historial`; entrada manual visible |
| 39 | Renombrar archivo | ✓ | Nombre `QA_Explorador_Total` creado desde el diálogo |
| 40 | PNG + PDF + impresión | ✕ | PNG/PDF iniciaron; CMYK se bloqueó: BUG-001 |
| 41 | Copy as/share | ⚠ | Compartir visible; no se publicó ni cambió visibilidad |

## Qué se probó y qué no

Probado por UI: creación de archivo, formato y nombre, herramientas de dibujo principales, capas, propiedades, radius, opacidad, borde, sombra, blur, zoom extremo, reglas/grilla, guardado manual, historial, PNG/PDF y flujo CMYK.

No probado o bloqueado: comentario publicado/resuelto (requiere confirmación de comunicación representacional), algunas variantes avanzadas que no estaban expuestas (blend, dashed, boolean, group, lock, máscara completa), verificación de bytes descargados (el navegador CUA no expuso evento/archivo descargado), resize de ventana (capacidad no disponible), y preset Animation (conocido; no se insistió).

La consola de esta sesión no devolvió entradas mediante la captura del navegador; el error de DeepSeek se verificó en el historial visible del panel Chat.

## Cinco arreglos prioritarios

1. Desbloquear y hacer cancelable el motor de PDF CMYK; reportar progreso, timeout y error recuperable.
2. Corregir el scope de `Ctrl+D` para duplicar el objeto seleccionado, dejando duplicación de frame solo cuando el frame está seleccionado.
3. Reparar la configuración/preflight de DeepSeek y evitar repetir 401 históricos como si fueran ejecuciones nuevas.
4. Añadir verificación de descarga (nombre, MIME y tamaño >0) para PNG/PDF y una confirmación visible de éxito.
5. Hacer explícitos en la UI los controles prometidos pero ausentes (blend modes, dashed stroke, boolean, lock, group, máscara y filtro de capas), o retirar la promesa de la cobertura.

