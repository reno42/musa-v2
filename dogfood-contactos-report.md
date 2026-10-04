# Dogfood QA — Contactos (CRM) de Musa

Fecha: 2026-09-24  
Cuenta: Renzo Perez Bartra  
URL: `https://design.futuraria.com/#workspace/contacts`  
Método: sólo interfaz visible, clicks/teclado del navegador. Sin MCP, API, curl, backend, deploy ni push.

## Resumen por severidad

- **Alta:** 2
- **Media:** 3
- **Baja:** 0

Datos QA usados: `QA_Contacto Exploracion` (contacto), `QA_Contactos_Deal` (deal), campaña `QA_Contactos_Campaña`. La interacción `QA_Interaccion_Contacto: comentario de prueba para validar timeline.` fue intentada en la UI, quedó procesando y no persistió. No se enviaron mensajes ni se tocaron contactos reales.

## Hallazgos

### CRM-001 — Registrar interacción queda procesando y no crea entrada

- Severidad: **Alta**
- Fase: Personas → ficha de persona
- Categoría: Funcional / Datos
- URL: `https://design.futuraria.com/#workspace/contacts`
- Pasos:
  1. Abrir Personas.
  2. Abrir la ficha existente QA `QA Hermes`.
  3. En “Registrar interacción”, dejar Tipo `Reunión`.
  4. Ingresar exactamente `QA_Interaccion_Contacto: comentario de prueba para validar timeline.`.
  5. Pulsar `Registrar` y esperar 8 s.
- Esperado: feedback de éxito, contador incrementado y entrada visible con fecha, tipo y texto.
- Obtenido: botón pasa a `Registrando…`, luego vuelve a `Registrar`; el timeline sigue en `Timeline comercial 0` y no hay feedback de error.
- Consola: no apareció error nuevo asociado; persistía el error global CRM-005.
- Screenshot: captura inline de la ficha durante la sesión; CUA no expone ruta para exportar PNG.

### CRM-002 — El encabezado de persona contradice el timeline

- Severidad: **Alta**
- Fase: Personas → ficha de persona
- Categoría: Funcional / Contenido
- URL: `https://design.futuraria.com/#workspace/contacts`
- Pasos:
  1. Abrir `QA Hermes`.
  2. Leer el bloque Comercial y el bloque Timeline.
- Esperado: el resumen y el detalle cuentan la misma historia.
- Obtenido: encabezado muestra `Interacciones 3` y `Último contacto: Hace 1 día`, pero `Timeline comercial 0` y “Sin interacciones registradas”. La ficha no es confiable en menos de 10 segundos.
- Consola: sin error nuevo específico.

### CRM-003 — Contactos no ofrece entrada visible a Bandeja/Zernio

- Severidad: **Media**
- Fase: Bandeja social → integración CRM
- Categoría: UX / Integración
- URL: `https://design.futuraria.com/#workspace/contacts`
- Pasos:
  1. Abrir el menú `Secciones de Contactos`.
  2. Revisar las cuatro opciones visibles: `Ventas`, `Personas`, `Marcas`, `Embudo`.
  3. Buscar un enlace/botón de Bandeja, Zernio, comentarios o captura social dentro de Contactos.
- Esperado: acceso claro a la Bandeja social o indicación explícita del flujo de captura.
- Obtenido: no existe ninguna opción de Bandeja/Zernio en el módulo. El ciclo comentario → captura → persona → timeline no puede empezar desde CRM; el usuario debe descubrir otro módulo.
- Consola: sin error nuevo específico.

### CRM-004 — Cambiar etapa de un deal no solicita confirmación

- Severidad: **Media**
- Fase: Ventas → drawer de deal
- Categoría: UX / Datos
- URL: `https://design.futuraria.com/#workspace/contacts`
- Pasos:
  1. Abrir el deal QA `QA_Contactos_Deal`.
  2. En `Etapa`, cambiar `Discovery` a `Propuesta`.
  3. Observar la UI y cerrar/reabrir el drawer.
- Esperado: confirmación o botón explícito de guardar antes de mover la oportunidad.
- Obtenido: el cambio se aplica inmediatamente al seleccionar la opción; no aparece confirmación. Persistió al cerrar y volver a Ventas.
- Consola: sin error nuevo específico.

### CRM-005 — Error global de workspace al cargar Contactos

- Severidad: **Media**
- Fase: transición a Contactos
- Categoría: Consola / Funcional potencial
- URL: `https://design.futuraria.com/#workspace/contacts`
- Pasos:
  1. Entrar a Contactos.
  2. Abrir consola y observar logs.
- Esperado: carga CRM sin errores de inicialización.
- Obtenido, texto completo:

  ```text
  [mcpCall] JSON-RPC error: Object
  [mcpCall] FAILED: get_dashboard_summary workspaceId is required — llama list_workspaces y usa uno de los IDs accesibles
  ```

  El CRM sí termina cargando, pero la inicialización intenta una llamada sin `workspaceId`; es un error silencioso de alto valor para corregir.

## Matriz de cobertura Fase 0

| Vista / control | Estado | Evidencia |
|---|---:|---|
| Ventas: carga pipeline, KPIs, columnas Discovery→Perdido | ✓ | 3 deals después de QA; totales visibles |
| Ventas: `+ Nuevo deal`, formulario, marca, título, campaña, valor, probabilidad, fecha | ✓ | Creado `QA_Contactos_Deal` |
| Ventas: drawer Resumen | ✓ | Etapa, campaña, comercial, entregables |
| Ventas: drawer Timeline | ✓ | 3 entradas de QA Hermes; formulario de interacción |
| Ventas: drawer Persona | ✓ | Mensaje “Sin contacto principal” |
| Ventas: drawer Marca | ✓ | Salud, prioridad, relaciones y deals |
| Personas: búsqueda existente/inexistente/acentos | ✓ | `Ren`, `zzzz-no-existe`, `áéñ` |
| Personas: filtros Estado y Marca | ✓ | Menús visibles; opciones de marca verificadas |
| Personas: CSV / Importar | ⚠ | Visibles, no ejecutados para no mutar/descargar |
| Personas: agregar persona | ✓ | `QA_Contacto Exploracion` creado |
| Personas: paginación y filas por página | ✓ | 3 resultados, 10 por página; siguiente/anterior deshabilitados |
| Personas: drawer header, comercial, datos, guardar | ✓ | Persistencia de Cargo `QA Editado` verificada |
| Personas: Registrar interacción | ✕ | CRM-001 |
| Personas: timeline completo y fuente/origen | ✕ | CRM-001/002; no hay entrada social en ficha |
| Marcas: búsqueda, filtros relación/salud | ✓ | Controles visibles |
| Marcas: filas y conteos | ✓ | 6 marcas; ELSA 2 deals/100 USD, Futuraria 1/1500 USD |
| Marcas: drawer salud/prioridad/último contacto | ✓ | ELSA muestra Activa, Media, 3 interacciones, hace 1 día |
| Marcas: personas vinculadas | ⚠ | No se muestra una lista de personas vinculadas en el drawer inspeccionado |
| Marcas: deals vinculados | ✓ | ELSA lista `QA_Contactos_Deal` y `test` |
| Embudo: marcas, filtros, 8 etapas, conversión | ✓ | 3 deals, USD 1,600, conversión 0% |
| Embudo: detalle por etapa y deal QA | ✓ | Discovery 2 / Propuesta 0 / Negociación 1 |
| Bandeja/Zernio dentro de Contactos | ✕ | CRM-003 |

## Evaluación de la ficha de persona (≤10 segundos)

**No pasa.** Una persona con actividad no cuenta una historia consistente: el encabezado resume 3 interacciones y último contacto hace 1 día, pero el timeline está vacío. En una persona nueva (`QA_Contacto Exploracion`) sí se entiende identidad, cargo y canales, pero faltan origen, fecha de última interacción y un control para registrar interacción. El origen Instagram/Zernio tampoco aparece en la ficha inspeccionada.

## Ciclo Bandeja → captura → timeline

No pudo completarse dentro de la regla “sólo Contactos”: no hay Bandeja social/Zernio en ninguna de las cuatro vistas ni en el menú de secciones de Contactos. Por tanto no se pudo capturar autor, comprobar deduplicación ni verificar el texto real de Instagram en el timeline. El botón de respuesta social tampoco está presente en este módulo; no se envió nada.

## Consistencia Embudo ↔ Ventas

Cuadra durante la prueba: Ventas muestra 2 deals en Discovery (QA_Contactos_Deal y `test`) y 1 en Negociación (`QA-Hermes deal`); Embudo muestra 3 deals, USD 1,600, Discovery 2, Negociación 1 y Entregado 0. La ficha de ELSA lista 2 deals y USD 100 porque sólo esos dos están vinculados a ELSA.

## Cinco arreglos prioritarios

1. Hacer transaccional `Registrar interacción`: respuesta de éxito/error, timeout y refresco atómico de contador/timeline.
2. Unificar la fuente de verdad de resumen y timeline de persona; no mostrar `3 interacciones` si el detalle devuelve 0.
3. Integrar o enlazar Bandeja/Zernio desde Contactos y conservar origen, texto y autor al capturar.
4. Añadir confirmación/undo para cambios de etapa y feedback de guardado.
5. Corregir el `workspaceId` faltante en la inicialización y evitar warnings/error logs en una carga normal.

## No probado y motivo

- Cinco personas distintas: sólo había 2 personas existentes; tras crear la QA hubo 3, no 5.
- Captura Bandeja→CRM y deduplicación: no hay acceso desde Contactos; el prompt prohibía salir a Copywriting.
- Responder mensaje social: no existe control en este módulo y no se deben enviar respuestas reales.
- Importar/CSV: se dejaron sin ejecutar para no descargar ni mutar datos.
- Borrado de QA: no apareció control de eliminación en persona/deal; se dejó evidencia QA y no se tocó ningún dato real.

