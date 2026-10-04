# Musa — cierre de QA por UI

Fecha: 2026-09-24  
Alcance: Diseño, Copywriting, Contactos e Inicio. Landing y acceso quedaron fuera por indicación del usuario. Todas las acciones de producto se hicieron a través de la interfaz visible de Musa; no se usaron APIs, curl, backend ni MCP para operar datos.

## Resumen ejecutivo

Se completaron las pruebas que podían cerrarse de forma segura con artefactos `QA_` ya presentes. Se confirmó persistencia mediante navegación/recarga para Kanban y CRM, movimiento de una pieza de Copywriting y guardado/undo/redo en el editor.

Hallazgos nuevos reproducidos en esta ronda: **0 críticos, 0 altos, 0 medios, 0 bajos**. El dashboard de 7 días mostró ceros, pero al cambiar a 30/90 días expuso datos coherentes; no se registra como bug porque la ventana de siete días no contiene publicaciones/deals del período visible.

## Artefactos QA usados

| Módulo | Artefacto | Identificador / estado final |
|---|---|---|
| Inicio | `QA_Inicio_Kanban_Final` | `card_muga4cvc_8agsr5`, estado `DRAFT` |
| Copywriting | `QA_Copywriting_Pieza` | Estado final `aprobación`; campaña `QA_Campaña` |
| Contactos | `QA_Contacto Exploracion` | Cargo final `QA_Final áéñ🙂`; notas `QA_ nota de persistencia 2026-09-24` |
| Diseño | `QA_Explorador_Total` | `tpl_34450318-e8b`; fondo final `#f5f5f5`, versión guardada |

No se eliminaron estos artefactos: borrarlos sería una acción destructiva en la cuenta y no se solicitó confirmación puntual de borrado.

## Cobertura y resultado

### Inicio

- Kanban: carga, contador (55), columnas, tarjeta clickeable y drawer: **✓**.
- Tarea QA: edición de título, cambio a `Draft`, `Refresh` y reapertura: **✓**. El drawer confirmó título, descripción, 3 acceptance criteria, estado e ID tras recargar.
- Dashboard: tabs 7d/30d/90d: **✓**. En 30d mostró 0 piezas publicadas, 1 lead, 3 deals y USD 1.6K; en 90d el total de leads subió a 2. Las tarjetas y links de acción cargaron.
- Dry run, batch, Importar y borrado: **⚠ no ejecutados**; pueden procesar/importar masivamente o borrar datos.
- Reporte semanal: **—**; estaba deshabilitado en UI.

### Copywriting

- Calendario, filtros, selector de estado, detalle y vínculo de archivo: **✓**.
- Pieza `QA_Copywriting_Pieza`: `programado` → `aprobación` mediante el selector de UI, verificado luego en Kanban de contenido: **✓**.
- Publicar, responder en Bandeja y capturar autores reales de Zernio: **⚠ no ejecutados**; implican comunicación o captación sobre datos reales.
- Importar CSV: **⚠ no ejecutado**; requiere un archivo concreto y podría crear múltiples piezas.

### Contactos

- Lista, carga de filas, búsqueda/filtros/paginación visibles y apertura de ficha: **✓**.
- Ficha de `QA_Contacto Exploracion`: edición de Cargo y Notas, Guardar, cierre, recarga y verificación del valor persistido: **✓**.
- Timeline/registrar interacción: **—**; la ficha QA no presentó un control de registro de interacción en la UI expuesta.
- Creación/borrado de personas, importación y operaciones sobre contactos reales: **⚠ no ejecutadas**. Ya había un contacto QA apto; borrar o importar requiere una autorización puntual/archivo de prueba.

### Diseño

- Apertura del archivo QA, zoom +/−, paneles, Props y propiedades del frame: **✓**.
- Cambio de fondo `#ffffff` → `#f5f5f5`, Guardar versión, `Ctrl+Z`, `Ctrl+Shift+Z` y guardado final: **✓**.
- Herramientas que precisan un asset (máscara, varita, borrador sobre imagen, quitar fondo) e Import: **—**; requieren subir/usar una imagen de prueba específica.
- Compartir, comentarios, exportación, animación y eliminación: **⚠ no ejecutados**. Compartir cambia visibilidad, export genera descargas, el preset de animación es issue conocido y eliminar es destructivo.

## Evidencia de persistencia

1. Se abrió `QA_Inicio_Kanban_Final`, se cambió a `Draft`, se refrescó el tablero y se volvió a abrir. El detalle mostró `card_muga4cvc_8agsr5`, `DRAFT`, título y criterios esperados.
2. Se abrió `QA_Copywriting_Pieza`, se cambió Estado a `aprobación`; el tablero de contenido luego la mostró bajo **APROBACIÓN 1**.
3. Se guardó `QA_Final áéñ🙂` en el contacto QA; al volver a Personas, la fila mostró exactamente ese cargo.
4. En `QA_Explorador_Total`, el fondo volvió a blanco con Undo, a `#f5f5f5` con Redo y quedó guardado como versión.

## Exportaciones — segunda ronda

Se descargaron todos los formatos que la interfaz mostró en los módulos cubiertos. La automatización del navegador confirma la activación de cada descarga; el panel de imprenta además confirmó en pantalla el archivo generado.

| Módulo | Formatos descargados por UI | Resultado |
|---|---|---|
| Diseño | PNG, JPG, SVG, PDF, PDF imprenta, JSON template, Design Tokens (DTCG), Design.md y CSS | **✓**. El PDF de imprenta confirmó `QA_Explorador_Total_300dpi.pdf`, 1080×1080 px, 300 dpi efectivos. |
| Copywriting — Calendario | PPT, CSV, Excel, plantilla CSV | **✓**. El PPT se generó para 8 piezas/9 slides. |
| Copywriting — Reportes | CSV y Excel | **✓**. |
| Contactos — Personas | CSV | **✓**. Ventas, Marcas y Embudo no mostraron controles de exportación propios. |
| Inicio — Kanban y Tabla | CSV de Kanban y CSV de Tabla | **✓**. |
| Inicio — Dashboard | Reporte semanal (PNG + CSV) | **—**: el botón está deshabilitado en la UI. |

El contenido descargado no se analizó con API ni backend. La siguiente verificación posible es abrir localmente cada archivo desde el gestor de descargas y comprobar tamaño/estructura visual; eso requiere que la UI exponga el panel de descargas o que el usuario indique dónde quiere que se abran los archivos.

## Pendiente para cobertura completa

| Acción pendiente | Qué hace falta |
|---|---|
| Publicar/responder/capturar desde Zernio | Autorización puntual para una acción que representa a la cuenta, y un ítem sintético o explícitamente autorizado. |
| Batch/Dry run/Import masivo | Autorización puntual; puede afectar el tablero completo o crear muchos datos. |
| Borrar QA | Confirmación explícita de los artefactos exactos a borrar. |
| Importar piezas/contactos o probar herramientas de imagen | Un CSV/imagen de prueba concreto y autorización para subirlo. |
| Reporte semanal | Que la función esté habilitada en la UI. |
| Consola y resize | Acceso visible a DevTools/controles de viewport; no se usaron interfaces de backend para suplirlo. |

## Observación no clasificada como hallazgo

El historial persistente del panel Chat mostraba errores anteriores de Ghost/LLM (401 y 500). No se invocó Ghost en esta ronda, por lo que no se registra como una reproducción nueva ni se atribuye a las pruebas de UI actuales.
