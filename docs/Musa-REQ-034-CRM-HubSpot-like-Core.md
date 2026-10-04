# REQ-034 — CRM HubSpot-like para Musa: núcleo comercial, actividades y automatización

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** CRM / Ventas / Producción / Automatización / Reporting  
**Prioridad:** P0 para el núcleo comercial; P1 para automatización e integraciones; P2 para marketing y servicio

## 1. Decisión de producto

Musa no debe convertirse en un clon de HubSpot. Debe alcanzar una experiencia comparable en el núcleo CRM que necesitan estudios, agencias y equipos que venden y producen diseño, contenido, motion y campañas.

El CRM actual ya resuelve una parte importante del flujo:

```text
Marca → Persona → Deal → Entregables → Archivos de diseño → Entrega
```

El siguiente paso es convertir ese flujo en una plataforma comercial confiable, con actividades, tareas, automatizaciones, vistas, reportes y asociaciones consistentes.

La paridad se medirá en tres niveles:

1. **CRM operativo:** contactos, cuentas, deals, actividades y seguimiento.
2. **CRM de crecimiento:** automatizaciones, scoring, integraciones y reporting.
3. **Customer platform:** marketing, soporte, tickets, knowledge base, pagos y objetos personalizados.

La primera entrega debe completar el nivel 1 y preparar la arquitectura para los niveles 2 y 3.

## 2. Estado actual verificado

### Funcionalidades existentes que se preservan

- Personas/contactos.
- Marcas/cuentas.
- Campañas.
- Deals con etapas fijas.
- Valor, moneda, probabilidad y fechas.
- Contacto principal del deal.
- Entregables cuantificables.
- Vinculación de entregables con archivos de diseño.
- Reconciliación de producción contra alcance vendido.
- Timeline de interacciones.
- Salud de cuenta `active / at_risk / churned`.
- Captura de autores desde la Bandeja social.
- Importación/exportación CSV.
- Vistas Ventas, Personas, Marcas, Embudo y Captura.
- MCP para consultar y modificar entidades CRM.

Fuentes principales actuales:

- `src/components/CrmWorkspace.tsx`.
- `api/src/routes/saas.ts`.
- `api/src/services/crmInsights.ts`.
- `api/src/services/crmInboxCapture.ts`.
- `supabase_migrations_v9.sql`, `v14.sql`, `v45.sql`, `v48.sql`, `v51.sql` y `v58.sql`.

### Limitaciones actuales

- No existe un objeto general de tareas.
- El timeline mezcla interacciones manuales y señales, pero no es una bandeja universal de actividades.
- Los pipelines y etapas están codificados.
- Las asociaciones son limitadas, especialmente un único `primary_contact_id` por deal.
- No hay propiedades personalizadas configurables por workspace.
- No hay vistas guardadas ni edición masiva.
- No hay constructor de workflows CRM.
- No hay reporting configurable de ventas.
- No hay email/calendario sincronizados.
- No hay tickets ni service desk.
- No hay deduplicación/merge ni auditoría detallada de cambios.

## 3. Referencia funcional

HubSpot describe su CRM alrededor de objetos, registros, propiedades, asociaciones, actividades, vistas, segmentos y reportes:

- https://knowledge.hubspot.com/get-started/manage-your-crm-database
- https://www.hubspot.com/products/crm
- https://knowledge.hubspot.com/records/manage-index-page-types-and-tabs
- https://knowledge.hubspot.com/workflows/create-records-with-workflows

Estas referencias sirven para comparar capacidades, no para copiar la arquitectura ni la navegación de HubSpot.

## 4. Modelo de datos objetivo

### 4.1 Objetos principales

Mantener:

- `workspace`.
- `brand` como cuenta/empresa comercial.
- `crm_contact` como persona.
- `crm_deal` como oportunidad o venta.
- `campaign` como contexto de trabajo.
- `crm_deliverable` como alcance vendido.
- `design_file_meta` como producción relacionada.

Agregar progresivamente:

- `crm_task`.
- `crm_activity` como normalización de llamadas, emails, reuniones, notas, mensajes y cambios.
- `crm_pipeline`.
- `crm_pipeline_stage`.
- `crm_property_definition`.
- `crm_record_property_value` o equivalente JSONB validado.
- `crm_association` para relaciones many-to-many.
- `crm_saved_view`.
- `crm_workflow` y `crm_workflow_run`.
- `crm_audit_event`.

### 4.2 Identidad y asociaciones

- Todo registro conserva `workspace_id`.
- Cada entidad tiene origen, creador, updated_by y timestamps.
- Un deal puede tener varios contactos asociados con una etiqueta: decisor, influencer, comprador, aprobador, etc.
- Una persona puede pertenecer a una marca y participar en varios deals.
- Una actividad puede asociarse a una persona, marca, deal, campaña y tarea.
- Las asociaciones deben tener reglas de integridad y permisos por workspace.
- Importaciones y capturas deben ser idempotentes.

## 5. Requisitos funcionales

### RF-01 — Actividades unificadas (P0)

Crear un timeline común para:

- Nota.
- Email.
- Llamada.
- WhatsApp.
- Reunión.
- Comentario social.
- Cambio de etapa.
- Tarea creada/completada.
- Entregable creado/completado.
- Cambio de propiedad.
- Publicación o respuesta.

Cada actividad debe conservar:

- Tipo.
- Fecha de ocurrencia.
- Fecha de registro.
- Autor.
- Origen.
- Registro asociado.
- Notas.
- Permalink cuando exista.
- Metadata sin datos sensibles innecesarios.

**Aceptación:** al abrir una persona, marca o deal se puede ver la historia completa en una sola línea temporal filtrable.

### RF-02 — Tareas y seguimiento (P0)

Agregar `crm_task` con:

- Título.
- Descripción.
- Responsable.
- Estado: pendiente, en progreso, completada, cancelada.
- Prioridad.
- Fecha de vencimiento.
- Fecha de finalización.
- Contacto, marca, deal y campaña asociados.
- Origen: manual, workflow, importación o IA.
- Recordatorio.

La UI debe incluir:

- Mi cola de tareas.
- Vencidas.
- Hoy.
- Próximas.
- Sin responsable.
- Crear tarea desde cualquier ficha.
- Completar, posponer y reasignar.

**Aceptación:** un deal sin próximo paso produce una tarea visible, pero nunca se crea automáticamente sin una regla explícita.

### RF-03 — Pipeline configurable (P0)

- Crear varios pipelines por workspace.
- Definir etapas, orden, color y probabilidad base.
- Marcar etapas de ganado/perdido.
- Definir campos obligatorios por etapa.
- Registrar tiempo de entrada y salida por etapa.
- Permitir vistas Kanban, tabla, calendario y forecast.
- Mantener compatibilidad con el pipeline actual durante la migración.

**Aceptación:** un workspace puede tener un pipeline de nuevos clientes y otro de renovaciones sin cambiar código.

### RF-04 — Productos, líneas comerciales y cotización mínima (P1)

- Catálogo de servicios o productos.
- Line items dentro del deal.
- Cantidad, precio unitario, descuento, impuesto y total.
- Moneda y conversión explícita.
- Relación con entregables de producción.
- Generación de propuesta o cotización exportable.
- Registro de valor estimado, valor aprobado y valor final.

No incluye facturación completa en esta fase.

### RF-05 — Propiedades configurables (P1)

Permitir que el usuario cree campos para contactos, marcas, deals y tareas:

- Texto.
- Número.
- Moneda.
- Fecha.
- Boolean.
- Selección simple.
- Selección múltiple.
- URL.
- Email.
- Usuario.

Cada propiedad debe tener:

- Nombre interno estable.
- Etiqueta visible.
- Tipo.
- Valores permitidos.
- Requerido/opcional.
- Visibilidad.
- Historial de cambios.
- Uso en filtros, workflows y reportes.

### RF-06 — Deduplicación y calidad de datos (P1)

- Detectar contactos por email.
- Detectar posibles duplicados por teléfono, handle y nombre.
- Mostrar comparación antes de fusionar.
- Fusionar conservando actividades, deals y asociaciones.
- Nunca borrar silenciosamente el registro fuente.
- Registrar quién fusionó y cuándo.
- Validar importaciones antes de escribir.
- Reportar filas rechazadas y duplicadas.

### RF-07 — Importación y exportación (P0)

- Importar contactos, marcas, deals, tareas y actividades.
- Importar asociaciones en el mismo lote.
- Previsualizar mapeo de columnas.
- Validar tipos y valores antes de insertar.
- Modo crear, actualizar o upsert.
- Idempotency key por lote.
- Rollback o reporte parcial claro.
- Exportar vista filtrada y dataset completo según permisos.

### RF-08 — Vistas guardadas y edición masiva (P0)

- Guardar filtros, columnas, orden y agrupación.
- Vistas privadas, compartidas y por equipo.
- URL reproducible para una vista.
- Selección múltiple.
- Editar estado, responsable, prioridad, marca o etapa en lote.
- Exportar exactamente lo que muestra la vista.
- Mostrar cuántos registros cambiarán antes de confirmar.

### RF-09 — Automatizaciones CRM (P1)

Crear un motor mínimo:

```text
trigger → conditions → actions → delay → audit
```

Triggers iniciales:

- Registro creado.
- Propiedad cambiada.
- Deal entra en etapa.
- Deal lleva N días sin actividad.
- Tarea vence.
- Interacción recibida.
- Cuenta cambia de salud.
- Entregable completado.

Acciones iniciales:

- Crear tarea.
- Cambiar propiedad.
- Cambiar etapa.
- Asignar responsable.
- Crear actividad.
- Notificar dentro de Musa.
- Crear tarjeta Kanban.
- Ejecutar receta determinista.

Requisitos de seguridad:

- Preview/dry-run.
- Idempotencia.
- Límite de ejecuciones.
- Logs por ejecución.
- Reintentos controlados.
- Pausa global por workflow.
- Nada de enviar mensajes externos sin autorización explícita.

### RF-10 — Reporting y forecast (P0/P1)

Reportes iniciales:

- Pipeline por etapa.
- Conversión entre etapas.
- Win rate.
- Tiempo promedio por etapa.
- Deals sin actividad.
- Deals sin próximo paso.
- Forecast ponderado.
- Revenue ganado por mes.
- Motivos de pérdida.
- Valor por marca, campaña y responsable.
- Entregables vendidos vs completados.
- Tiempo de venta vs tiempo de producción.

Los reportes deben tener:

- Filtros por fecha, marca, pipeline, etapa y responsable.
- Export CSV.
- Guardado como dashboard.
- Definición de métrica visible.
- Fuente de datos auditable.

### RF-11 — Integraciones de comunicación (P1)

Preparar conectores para:

- Email.
- Calendario.
- WhatsApp o proveedor autorizado.
- Bandeja social.
- Webhooks.
- Importaciones externas.

La integración debe registrar actividades y respetar preferencias de comunicación, permisos y origen del dato.

### RF-12 — Lead scoring y salud (P1)

Separar tres conceptos:

- Lifecycle: lead, qualified, opportunity, customer, inactive.
- Health: active, at risk, churned.
- Score: número calculado por reglas transparentes.

El score debe poder explicar:

- Qué señales lo aumentaron.
- Qué señales lo redujeron.
- Cuándo se calculó.
- Si fue automático o editado por una persona.

### RF-13 — Permisos y auditoría (P0)

- Mantener permisos por workspace.
- Agregar permisos por módulo y acción.
- Separar lectura, creación, edición, borrado, exportación y administración.
- Registrar cambios sensibles.
- Ocultar campos restringidos.
- Mostrar fuente del cambio: humano, MCP, workflow, importación o integración.
- No exponer claves ni datos sensibles en timelines o logs.

### RF-14 — UI CRM (P0)

La UI debe incluir:

- Navegación por objetos.
- Búsqueda global.
- Vistas guardadas.
- Tablas con columnas configurables.
- Acciones masivas.
- Kanban con alternativa tabla.
- Ficha con layout configurable.
- Timeline filtrable.
- Tareas siempre visibles.
- Estado de sincronización.
- Indicadores claros de error, conflicto y datos incompletos.
- Responsive usable en tablet y móvil.

## 6. Plan de entrega

### Fase 0 — CRM operativo sólido

1. Crear `crm_task`.
2. Unificar actividades y timeline.
3. Añadir cola de tareas y recordatorios.
4. Añadir vistas guardadas.
5. Añadir selección y edición masiva.
6. Corregir asociaciones y preservar compatibilidad con datos existentes.
7. Añadir auditoría básica.

### Fase 1 — CRM configurable

1. Pipelines configurables.
2. Propiedades personalizadas.
3. Deduplicación y merge.
4. Importación/upsert robusto.
5. Reportes y forecast.
6. Line items y cotización mínima.

### Fase 2 — Automatización e integraciones

1. Workflows trigger/action.
2. Email y calendario.
3. Lead scoring.
4. Secuencias.
5. Webhooks de CRM.
6. Sincronización externa.

### Fase 3 — Customer platform opcional

1. Tickets.
2. Shared inbox.
3. SLA.
4. Knowledge base.
5. Encuestas.
6. Formularios y landing pages.
7. Payments y billing.
8. Objetos personalizados.

## 7. Pruebas obligatorias

- Crear, editar, completar, posponer y reasignar tarea.
- Timeline con actividades de múltiples fuentes.
- Asociar varios contactos a un deal.
- Cambiar etapa con campos obligatorios.
- Crear pipeline adicional sin deploy.
- Crear propiedad personalizada y filtrarla.
- Importar CSV con filas válidas, duplicadas e inválidas.
- Fusionar contactos conservando timeline y deals.
- Guardar vista y abrirla desde otra sesión.
- Editar 20 registros en lote y verificar auditoría.
- Ejecutar workflow en dry-run y modo real.
- Pausar y reanudar workflow.
- Generar forecast reproducible.
- Verificar permisos de lector, editor y administrador.
- Flujo responsive de persona, deal y tarea.
- Verificar que MCP y UI produzcan el mismo estado final.

## 8. Definición de terminado

- El CRM actual sigue cargando marcas, personas, deals, campañas y entregables.
- Los datos existentes migran sin pérdida.
- Una actividad registrada desde UI o MCP aparece en el mismo timeline.
- Las tareas tienen responsable, vencimiento y estado.
- Las vistas guardadas sobreviven a una recarga.
- Los reportes muestran la fuente y el periodo usados.
- Los workflows tienen preview, logs, límites y pausa.
- Las acciones masivas tienen confirmación, progreso y resultado por fila.
- Las modificaciones sensibles quedan auditadas.
- `tsc`, pruebas API, E2E y pruebas de regresión del CRM pasan.
- La documentación del CRM coincide con las rutas, tablas y tools reales.

## 9. Fuera de alcance inicial

- Replicar toda la navegación de HubSpot.
- Construir Marketing Hub completo.
- Construir Service Hub completo.
- Cobros y facturación multi-país.
- Sincronización bidireccional con todos los proveedores.
- IA que cambie etapas o envíe mensajes sin autorización.
- Sustituir el vínculo diferencial entre CRM y producción de diseño.

## 10. Criterio de éxito

Musa será un CRM fuerte cuando una persona pueda responder en menos de 30 segundos:

1. ¿Quién es este contacto?
2. ¿Con qué marca y deals está relacionado?
3. ¿Qué ocurrió recientemente?
4. ¿Qué debo hacer ahora?
5. ¿Qué valor está en juego?
6. ¿Qué trabajo de diseño se vendió y qué falta entregar?
7. ¿Qué fuente y regla produjo cada dato?

El producto debe conservar su ventaja: conectar la relación comercial directamente con la producción creativa y las herramientas de IA.
