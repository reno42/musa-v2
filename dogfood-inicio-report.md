# Dogfood QA — Inicio de Musa

Fecha: 2026-09-24  
Cuenta: Renzo Perez Bartra  
URL: `https://design.futuraria.com/#workspace`  
Método: sólo interfaz visible con clicks/teclado. No se usaron MCP, APIs, curl, backend, deploy ni push.

## Resumen por severidad

- **Alta:** 1
- **Media:** 2
- **Baja:** 0

Datos QA: tarea `QA_Inicio_Kanban_Editado`, ID exacto `card_muga4cvc_8agsr5`, originalmente creada como `QA_Inicio_Kanban`. Se dejó una sola tarea QA como evidencia. Se movió de Backlog a Research y persistió tras Refresh.

## Hallazgos

### INI-001 — Inicio sigue cargando el resumen con `workspaceId` faltante

- Severidad: **Alta**
- Fase: Dashboard / transición a Inicio
- Categoría: Consola / Funcional potencial
- URL: `https://design.futuraria.com/#workspace`
- Pasos:
  1. Abrir Inicio desde la interfaz.
  2. Abrir consola en la transición.
  3. Esperar la carga completa del Dashboard.
- Esperado: transición sin errores y resumen cargado con el workspace correcto.
- Obtenido: el Dashboard termina cargando, pero la consola registra:

  ```text
  [mcpCall] JSON-RPC error: Object
  [mcpCall] FAILED: get_dashboard_summary workspaceId is required — llama list_workspaces y usa uno de los IDs accesibles
  ```

  El bug pendiente de deploy sigue presente aunque hay fallback suficiente para mostrar datos.

### INI-002 — Validación de título permite 500+ caracteres sin advertencia

- Severidad: **Media**
- Fase: Kanban → Nueva
- Categoría: UX / Validación
- URL: `https://design.futuraria.com/#workspace`
- Pasos:
  1. Abrir Kanban y pulsar `+ Nueva`.
  2. Introducir `QA_` seguido de 500 caracteres `x` en `Título de la tarea`.
  3. Observar el botón `Crear`.
- Esperado: límite explícito, contador o validación que impida un título excesivo.
- Obtenido: `Crear` queda habilitado con 503 caracteres; no aparece advertencia ni límite visible. No se envió esa versión para no crear basura QA.
- Consola: sin error JS nuevo.

### INI-003 — El botón Dry run no comunica claramente un estado seguro de ejecución

- Severidad: **Media**
- Fase: Kanban → controles batch
- Categoría: UX / Seguridad operativa
- Pasos:
  1. Activar checkbox `Dry run`.
  2. Observar `▶ Ejecutar batch`.
- Esperado: el botón debe mostrar explícitamente `Ejecutar dry run` o una confirmación del modo no mutante.
- Obtenido: el checkbox queda marcado, pero el botón conserva exactamente `▶ Ejecutar batch`; no hay cambio visual en el CTA. No se pulsó para evitar ejecutar batch real.
- Consola: sin error JS nuevo.

## Matriz de cobertura Fase 0

| Área / control | Estado | Resultado |
|---|---:|---|
| Dashboard / Kanban / Tabla tabs | ✓ | Dashboard y Kanban recorridos; Tabla no abierta por quedar fuera del alcance explícito |
| Rangos 7d, 30d, 90d | ✓ | 7d/30d: 0 piezas, 1 lead, 3 deals; 90d: 0 piezas, 2 leads, 3 deals |
| Tarjetas Piezas publicadas, Leads, Pipeline, Deals abiertos | ✓ | Datos cargados; Pipeline USD 1,6 K y Deals 3 coherentes con CRM anterior |
| Mini-calendario, mes anterior/siguiente, días | ✓ | Septiembre↔octubre; click día 24 muestra “0 piezas / Sin contenido” |
| Reportes de campañas | ✓ | Tarjetas visibles con Neti 38, QA_Campaña 1, Semana Design Tool 7 |
| Actividad reciente | ✓ | Eventos CRM, lead y kanban visibles |
| Kanban contador total | ✓ | 54 iniciales; 55 después de crear QA |
| Columnas Idea/Diseño/Aprobación/Programado/Publicado | ✓ | Visibles y vacías en la carga de contenido |
| Columnas Backlog/Research/Draft/Design/Review/Feedback/Done | ✓ | Contadores y tarjetas visibles |
| Tarjetas existentes clickeables | ✓ | Se abrió Layers-first con 6 acceptance criteria |
| Drawer de tarea: título/ID/estado/prioridad/brief | ✓ | Datos visibles y correctos |
| Drawer: acceptance criteria | ✓ | 6 criterios en tarjeta real; 3 en QA |
| Drawer: link de diseño | ⚠ | Href observado (`/?template=tpl_8eb66fc6-690&v=2`), no abierto por restricción de no probar Diseño |
| Drawer: Editar | ✓ | QA editada y persistida |
| Drawer: Borrar | ⚠ | No usado; ninguna tarea real era elegible y se conserva sólo 1 QA |
| Flecha de tarjeta / cambio de columna | ✓ | QA Backlog→Research |
| Refresh | ✓ | QA y contador 55 persisten |
| Nueva: formulario y campos | ✓ | Título, tipo, prioridad, deadline, brief, acceptance, origen, contenido, modelo |
| Nueva: vacío | ✓ | Crear deshabilitado sin título |
| Nueva: 500+ chars | ✕ | INI-002 |
| Nueva: acentos/emoji | ✓ | Brief QA con `áéñ🙂` persistió |
| Dry run | ⚠ | Checkbox probado; batch no ejecutado |
| Ejecutar batch | ⚠ | No pulsado: mutaría tareas/consumiría LLM |
| CSV | ⚠ | Visible, no descargado |
| Importar | ⚠ | Visible, no ejecutado |
| Filtros | — | No existen controles de filtro visibles en Kanban |

## Flujo tarjeta → detalle → edición → persistencia

1. Kanban cargó `54 tareas · vía MCP (studio_list_cards)`.
2. `+ Nueva` abrió formulario.
3. Se creó `QA_Inicio_Kanban` con brief `Prueba QA de Inicio con áéñ🙂 y persistencia.` y criterios:
   - `Se abre el detalle`
   - `El título persiste`
   - `El estado se puede refrescar`
4. El total pasó a 55.
5. Click en la tarjeta abrió drawer con ID `card_muga4cvc_8agsr5`, estado BACKLOG, prioridad Normal, brief y 3 criterios.
6. `✏️ Editar` cambió el título a `QA_Inicio_Kanban_Editado`.
7. Se guardó, se cerró/reabrió y el título editado persistió.
8. La flecha de la tarjeta la movió a Research; el contador de Research pasó a 1.
9. `↻ Refresh` mantuvo la tarjeta en Research y el total en 55.

## Evaluación del Dashboard

El Dashboard refleja datos reales razonablemente: `Pipeline abierto USD 1,6 K` y `3 deals abiertos` coinciden con Ventas/Embudo previamente observado; la distribución muestra Futuraria USD 1,5 K y ELSA USD 100. `Piezas publicadas 0` es coherente con que las piezas inspeccionadas no estaban publicadas. Los rangos 7d y 30d comparten 0 piezas/1 lead, mientras 90d sube a 2 leads; no se detectó una tarjeta vacía inexplicable. El error de consola INI-001 sí indica que la obtención del resumen no está correctamente inicializada.

## Cinco arreglos prioritarios

1. Pasar explícitamente `workspaceId` al resumen de Inicio y eliminar el error `get_dashboard_summary workspaceId is required`.
2. Validar longitud máxima de título con mensaje/contador y límite de servidor/UI.
3. Hacer que Dry run cambie el CTA a un texto inequívoco y muestre qué se simulará antes de ejecutar.
4. Añadir confirmación/undo y feedback de éxito/error al mover tarjetas y actualizar contadores.
5. Mantener el drawer como fuente de verdad única: estado, actividad, aceptación y persistencia deben refrescarse atómicamente.

## No probado y motivo

- Tabla de Inicio: fuera del alcance explícito (sólo Dashboard y Kanban).
- Ejecutar batch: bloqueado intencionalmente porque mutaría las 55 tareas y consumiría LLM.
- CSV/Importar: sólo lectura solicitada; no se descargó ni importó archivo.
- Links a Diseño y módulos cruzados: sólo se inspeccionó el href; no se abrió Diseño.
- Borrado: no se tocó ninguna tarea real; se dejó exactamente una tarea QA como evidencia.
- Filtros: no hay filtros visibles en Kanban.

