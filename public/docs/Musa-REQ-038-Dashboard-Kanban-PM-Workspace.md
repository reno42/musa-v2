# REQ-038 — Dashboard + Kanban: espacio completo de PM para Musa

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** Inicio / Project Management / Kanban / Reporting / Analytics  
**Prioridad:** P0 para operación diaria; P1 para portfolio y analítica avanzada; P2 para automatización extensible

## 1. Decisión de producto

Inicio debe ser el espacio operativo del Project Manager: ver qué está pasando, decidir qué sigue, desbloquear trabajo, revisar capacidad y demostrar resultados. Debe unir tres niveles en la misma experiencia:

1. **Operación:** tareas, entregables, calendario, responsables y bloqueos.
2. **Control del proyecto:** alcance, dependencias, hitos, riesgo, capacidad, fechas y progreso.
3. **Dirección:** KPIs, objetivos, tendencia, forecast y reporting por marca, campaña, proyecto y workspace.

Musa no necesita copiar toda la superficie de Trello o Power BI. Necesita cerrar el circuito entre el tablero de trabajo y la evidencia de negocio que ya vive en CRM, contenido, diseño y agentes.

## 2. Estado actual verificado

### 2.1 Dashboard de Inicio

`src/components/home/HomeDashboard.tsx` ya incluye:

- rango de 7, 30 y 90 días;
- KPIs de piezas publicadas, leads, pipeline y deals abiertos;
- calendario mensual de publicaciones;
- campañas y sus métricas agregadas;
- acciones pendientes: aprobaciones, Kanban estancado, deals sin siguiente paso y comentarios sin respuesta;
- mini embudo CRM;
- actividad reciente;
- exportación de reporte semanal a PNG y CSV;
- skeletons, carga independiente y error/reintento por widget.

### 2.2 Kanban de Inicio

`src/components/KanbanTab.tsx` ya incluye:

- columnas Backlog, Research, Draft, Design, Review, Feedback y Done;
- drag and drop entre columnas;
- crear, editar, borrar y avanzar tarea;
- título, tipo, prioridad, brief, deadline, tono, CTA, asignación, origen y modelo de IA;
- etiquetas, marca, template, formato y tipo de contenido;
- criterios de aceptación y checkpoints del harness;
- actividad de sesión, tiempo de agentes, tokens y costo;
- pausar para batch y bloquear para todas las IAs;
- tarjetas de calendario de contenido sobre el tablero;
- vista Tabla, importación y exportación CSV;
- peek/drawer con detalles y enlaces al editor.

## 3. Referencias externas

Trello ofrece un tablero con búsqueda/filtros, calendario, timeline, tabla, dashboard, automatizaciones y Power-Ups. Su Dashboard permite tiles editables para tarjetas por lista, fecha, miembro y etiqueta; Timeline permite fechas de inicio y fin, agrupación y tarjetas sin agenda. [Trello Dashboard](https://support.atlassian.com/trello/docs/dashboard-view), [Trello Timeline](https://support.atlassian.com/trello/docs/timeline-view), [Trello Calendar](https://support.atlassian.com/trello/docs/calendar-view), [Trello automation](https://support.atlassian.com/trello/docs/create-and-manage-automations).

Trello no tiene dependencias nativas completas; documenta resolverlas con checklists, enlaces y automatizaciones. Musa sí necesita modelarlas directamente porque sus tareas representan producción de diseño y trabajo de agentes. [Trello task dependencies](https://support.atlassian.com/trello/docs/creating-and-managing-task-dependencies/).

Power BI aporta el patrón de analítica: dashboards con tiles, filtros, alertas, suscripciones, drillthrough, bookmarks, tooltips, objetivos y visualizaciones configurables. Los reportes permiten navegar de un resumen a detalles filtrados y guardar estados de análisis. [Power BI dashboards](https://learn.microsoft.com/en-us/power-bi/consumer/end-user-dashboard-open), [Power BI reports](https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-reports-overview), [Power BI drillthrough](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-drillthrough), [Power BI goals](https://learn.microsoft.com/en-us/power-bi/create-reports/service-goals-follow).

## 4. Diagnóstico

### P0 — El Kanban es un tablero de tareas, no todavía un sistema de proyectos

- No hay entidad de proyecto/portfolio separada del workspace.
- No hay subtareas, checklist estructurado ni dependencias entre tareas.
- Deadline es una fecha única; faltan start date, duración, milestone y baseline.
- No hay vista Timeline/Gantt para cruzar tareas, fechas y dependencias.
- `assigned_to` existe como campo, pero falta un selector de miembros, capacidad y carga por persona/agente.
- Hay tags, pero no filtros y vistas guardadas por marca, campaña, responsable, prioridad, estado, deadline, agente o costo.
- No hay WIP limits por columna, políticas de entrada/salida ni definición de listo global.
- Feedback vuelve a Design, pero no existe un ciclo de feedback versionado con autor, resolución y SLA.
- No hay tareas recurrentes, plantillas de proyecto ni duplicación de un workflow completo.
- No hay notificaciones, recordatorios, digest ni alertas por vencimiento/bloqueo.
- Actividad y checkpoints son visibles, pero no hay una auditoría unificada de cambios humanos, agentes y automatizaciones.

### P0 — El Dashboard muestra datos, pero no permite dirigir el trabajo

- Los KPIs son una fotografía: no muestran objetivo, variación, tendencia, forecast ni fecha de actualización.
- Los desgloses por marca se muestran como texto compacto; no se puede hacer click para filtrar todo el dashboard.
- Cada widget tiene su propia llamada MCP y no existe un modelo compartido de filtros, periodos o drillthrough.
- No hay capacidad, carga por persona/agente, cycle time, lead time, throughput, WIP, aging ni tasa de bloqueo.
- No hay milestones, salud de proyecto, riesgos, dependencias vencidas ni ruta crítica.
- El funnel CRM y el Kanban están juntos visualmente, pero no existe una relación explícita entre objetivo comercial, deliverables y tareas.
- Exportar PNG/CSV es útil, pero no hay reporte guardado, suscripción, snapshot histórico ni comparación contra periodos previos.

### P1 — Falta la capa analítica de PM

- No hay drilldown Dashboard → marca → campaña → tarea → evidencia.
- No hay filtros persistentes, bookmarks o vistas «Mi día», «Riesgos», «Por marca» y «Para dirección».
- No hay objetivos configurables ni semáforo contra target.
- No hay anomalías: tareas atascadas, costo de agente fuera de rango, campañas atrasadas o caída de throughput.
- No hay análisis de causa: qué marca, tipo, etapa o agente explica un atraso.
- No hay histórico suficiente para velocity, burnup, burndown, forecast de entrega o capacidad futura.

### P1 — Falta portfolio y multi-proyecto

- Inicio opera un workspace, pero no presenta portfolio de proyectos con estado, owner, salud, presupuesto, avance y próximos hitos.
- No hay separación clara entre proyecto, campaña, marca, deliverable y tarea.
- No hay cross-project dependencies ni vista de conflictos de recursos.

### P1 — Falta interacción PM directa

- El dashboard navega a otras pestañas, pero no permite resolver desde el widget: reasignar, posponer, bloquear, aprobar o crear siguiente paso.
- No existe inbox unificado de decisiones con prioridad, contexto, responsable y fecha.
- No hay comando rápido para crear una tarea desde una métrica o anomalía.

### P1 — Falta colaboración y gobernanza

- No hay roles de PM, contributor, reviewer, cliente y agente con permisos de proyecto.
- No hay comentarios por tarea con menciones, adjuntos, decisiones y resolución.
- No hay registro de cambios ni historial de valores anteriores para fechas, estado, owner o presupuesto.
- No hay vistas compartidas con snapshot estable para dirección o cliente.

### P2 — Falta automatización extensible

- El batch existe, pero el usuario no dispone de un constructor visible de reglas tipo trigger → condición → acción.
- No hay log de automatizaciones, simulación, reintento ni rollback por regla.
- No hay webhooks, calendario externo o integraciones configurables desde el espacio PM.

## 5. Requisitos funcionales

### RF-01 — Modelo de trabajo PM (P0)

Agregar entidades explícitas:

- `project` y `portfolio`;
- `task` y `subtask`;
- `milestone`;
- `dependency` (`blocks`, `blocked_by`, `relates_to`);
- `risk` y `decision`;
- `project_member` y capacidad;
- `saved_view` y `dashboard_layout`.

Mantener compatibilidad con `design_kanban_tasks`, pero vincular cada tarjeta a proyecto, campaña, marca y deliverable cuando exista.

### RF-02 — Tareas completas (P0)

Cada tarea debe soportar:

- estado y columna configurable;
- owner humano o agente;
- observadores;
- start date, due date y duración;
- prioridad, effort y costo estimado/real;
- labels y custom fields;
- subtareas/checklists con progreso;
- dependencias y bloqueador;
- comentarios, adjuntos, actividad y auditoría;
- criterios de aceptación y evidencia.

### RF-03 — Vistas del trabajo (P0)

Conservar Board y Tabla. Agregar:

- Timeline/Gantt con start/end, duración, hitos y dependencias;
- Calendario de deadlines y publicaciones;
- Mi trabajo por responsable;
- Workload/capacity;
- vista de riesgos y bloqueos;
- filtros por marca, campaña, proyecto, estado, owner, agente, prioridad, etiqueta y fecha;
- vistas guardadas y compartidas.

### RF-04 — Flujo y calidad (P0)

- WIP limits por columna.
- Reglas de entrada/salida configurables.
- Definición de listo y aceptación por proyecto.
- SLA por estado y alertas de aging.
- Handoff explícito entre IA, diseñador, reviewer y cliente.
- No permitir `done` si faltan criterios obligatorios o evidencia.

### RF-05 — Dashboard PM configurable (P0)

Widgets iniciales:

- salud de proyectos;
- avance contra objetivo y baseline;
- tareas por estado y aging;
- workload/capacidad por persona y agente;
- próximos hitos y vencidos;
- bloqueos y dependencias críticas;
- throughput y cycle time;
- pipeline y deliverables CRM;
- costos, tokens y tiempo de agentes;
- calendario de publicaciones;
- riesgos y decisiones pendientes.

Cada widget debe tener periodo, filtros, timestamp de actualización, fuente y drillthrough.

### RF-06 — Analítica y objetivos (P1)

- Targets configurables por proyecto, campaña, marca y workspace.
- Variación vs periodo anterior y vs baseline.
- Forecast de fecha y capacidad.
- Burndown/burnup, velocity y cumulative flow cuando haya histórico suficiente.
- Detección de anomalías y explicación de contribuyentes.
- Bookmarks: Ejecutivo, PM diario, Operación, Marca y Costos IA.

### RF-07 — Acciones desde el Dashboard (P0)

Desde una alerta o widget se debe poder:

- abrir detalle filtrado;
- asignar/reasignar;
- cambiar estado;
- posponer fecha;
- crear dependencia o tarea;
- aprobar o devolver a feedback;
- crear deal/deliverable cuando corresponda;
- abrir el diseño, render o evidencia.

### RF-08 — Automatización (P1)

Crear reglas versionadas con:

- trigger: estado, fecha, checklist, métrica, comentario o webhook;
- condiciones;
- acciones: mover, asignar, notificar, crear tarea, crear Kanban, ejecutar batch o generar reporte;
- modo simulación;
- log de ejecuciones;
- reintento y desactivación;
- permisos y auditoría.

### RF-09 — Reporting (P1)

- Reportes guardados con filtros y periodo.
- Export CSV/PDF/PNG con fuentes y timestamp.
- Suscripción y notificación al actualizar o fallar.
- Snapshot histórico inmutable para dirección.
- Drillthrough desde KPI a evidencia transaccional.

### RF-10 — Gobernanza y colaboración (P1)

- Roles y permisos por workspace, portfolio, proyecto y tarea.
- Comentarios con menciones, decisiones y resolución.
- Historial de cambios.
- Vistas externas de solo lectura para clientes.
- Privacidad para costos, tokens y notas internas.

## 6. Plan recomendado

### Fase 1 — PM operativo

1. Proyectos, owners, start/end, subtareas y dependencias.
2. Filtros y vistas guardadas.
3. Timeline/Gantt y workload.
4. Alertas de vencidos, bloqueos y aging.
5. Acciones directas desde Dashboard.

### Fase 2 — Control y calidad

1. Milestones, baselines, riesgos y decisiones.
2. WIP/SLA/Definition of Done.
3. Auditoría y comentarios.
4. Integración formal Kanban ↔ CRM ↔ deliverables ↔ contenido.

### Fase 3 — Dirección y analytics

1. Targets, variaciones, forecast y snapshots.
2. Cycle time, throughput, burnup/burndown y cumulative flow.
3. Dashboards configurables, bookmarks y drillthrough.
4. Costos y rendimiento de agentes.

### Fase 4 — Automatización e integraciones

1. Constructor de reglas con log y rollback.
2. Calendarios externos, webhooks y notificaciones.
3. Portal de cliente y vistas de portfolio.

## 7. Criterios de aceptación

- Un PM puede ver en menos de un minuto qué proyectos están atrasados, quién debe actuar y qué bloquea el avance.
- Puede pasar de un KPI a la tarea, deliverable, archivo o actividad que lo explica.
- Puede filtrar por marca, campaña, proyecto y responsable sin perder el contexto.
- Mover una fecha respeta dependencias y muestra el impacto.
- Un proyecto tiene baseline, hitos, riesgos y progreso verificable.
- El dashboard muestra objetivos, tendencia, fecha de actualización y fuente.
- El tablero no marca una tarea como terminada sin sus criterios de aceptación.
- Las acciones automáticas dejan log, responsable y resultado.
- La vista de dirección no expone notas internas ni costos restringidos.


