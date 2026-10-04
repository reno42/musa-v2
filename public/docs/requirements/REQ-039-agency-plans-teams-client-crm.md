# REQ-039 — Planes para agencias: equipos, espacios de cliente y CRM delegado

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** Multi-tenant / Workspaces / Equipos / PM / Notificaciones / CRM  
**Prioridad:** P0 para agencias; P1 para portal y reporting; P2 para enterprise

## 1. Decisión de producto

Musa debe separar cuatro conceptos que hoy están mezclados:

1. **Identidad:** una persona inicia sesión una vez.
2. **Organización:** la agencia que paga y administra el plan.
3. **Workspace de cliente:** espacio donde vive el trabajo y el CRM de una marca concreta.
4. **Espacio personal:** borradores y archivos privados de cada usuario.

La agencia puede cambiar de workspace desde un selector y recibir acceso delegado a los workspaces de sus clientes. Eso permite que una misma cuenta trabaje en varias marcas sin convertir a todos los clientes en miembros del espacio interno de la agencia.

Modelo objetivo:

```text
Cuenta / Usuario
├── Espacio personal (privado)
└── Organización Agencia
    ├── Equipos / pods internos
    ├── Proyectos internos
    ├── CRM comercial de la agencia
    └── Workspaces de clientes
        ├── Equipo cliente + miembros delegados de la agencia
        ├── Proyectos, campañas y Kanban
        ├── Archivos y Design System de la marca
        └── CRM operativo del cliente
```

La fuente de verdad de cada archivo, tarea y registro CRM es su workspace. No se deben duplicar contactos o deals entre la agencia y el cliente; se deben enlazar mediante una relación comercial explícita.

## 2. Estado actual verificado

La base de Musa ya permite:

- una identidad Supabase separada de los workspaces;
- un workspace personal por cuenta y múltiples workspaces compartidos;
- `workspace_members` con roles `owner`, `admin`, `editor` y `viewer`;
- invitaciones, aceptación, revocación y expiración;
- RLS y API keys limitadas a un workspace;
- CRM por workspace con marcas, contactos, campañas, deals, entregables y archivos confirmados;
- Kanban con asignación, tags, deadlines, checkpoints, tiempo, tokens y costo de agentes.

El CRM actual modela una marca como cuenta comercial dentro del workspace. Eso sirve para una agencia que lleva su propio pipeline, pero no alcanza para que la marca cliente administre su CRM con sus propios usuarios y permisos.

También faltan entidades actuales para equipos/grupos, membresía por proyecto, menciones, notificaciones y sprints. El inventario histórico menciona herramientas de equipos y menciones que fueron eliminadas; no se deben reactivar como herramientas superficiales sin autorización y RLS equivalentes.

## 3. Prácticas externas que debemos adoptar

Figma organiza los recursos como organización → equipos → proyectos → archivos, conserva un espacio personal y permite que colaboradores externos sean invitados solo al recurso necesario. Las reglas pueden heredarse desde equipo/proyecto y sobrescribirse a nivel de archivo; también existen grupos para compartir y mencionar. [Figma: organización y recursos compartidos](https://help.figma.com/hc/en-us/articles/360052679454-Access-shared-resources-in-an-organization), [Figma: permisos de archivos y proyectos](https://help.figma.com/hc/en-us/articles/35361119554711-File-and-project-permissions), [Figma: grupos](https://help.figma.com/hc/en-us/articles/38020006913943-Create-and-manage-user-groups).

HubSpot usa un patrón equivalente para agencias: el partner conserva su cuenta, el cliente conserva su cuenta y el partner recibe acceso administrativo delegado a la cuenta del cliente. El cliente aprueba ese acceso y puede quitar empleados o limitar permisos; la cuenta del partner no recibe automáticamente todos los datos del cliente. [HubSpot: acceso de empleados del partner a cuentas cliente](https://knowledge.hubspot.com/partner-tools/manage-partner-employee-access-to-client-accounts), [HubSpot: asignar acceso a registros](https://knowledge.hubspot.com/records/assign-access-to-records), [HubSpot: compartir registros con usuarios y equipos](https://knowledge.hubspot.com/records/share-records).

La conclusión de diseño es una inferencia aplicable a Musa: una agencia necesita una vista multi-workspace y acceso delegado revocable, mientras que cada cliente conserva la propiedad de sus datos y sus usuarios.

## 4. Diagnóstico y brechas

### P0 — Falta una jerarquía de colaboración

- No existe `organization` como contenedor de workspaces y facturación.
- No existen `teams` o grupos reutilizables para Creative, Copy, Motion, PM o una cuenta cliente.
- La membresía es de workspace completo; falta membresía de proyecto, carpeta o archivo.
- `assigned_to` del Kanban no tiene un directorio de usuarios/grupos con selector y permisos verificables.
- No existe un tipo de usuario `guest/client` con acceso limitado y fecha de expiración.
- No existe una relación agencia ↔ cliente con consentimiento, alcance, vigencia y auditoría.

### P0 — Falta colaboración dirigida

- No hay menciones estructuradas, watchers ni grupos mencionables.
- No hay inbox de notificaciones in-app, email o push.
- No hay preferencias por evento, digest ni silencio por proyecto.
- No se guarda quién vio, aceptó o resolvió una mención.

### P0 — Falta control de sprints

- El Kanban tiene tareas, fechas y costos, pero no entidad de sprint.
- No hay story points/effort points, compromiso, carryover, velocity ni burndown.
- No existe separación entre métrica de trabajo humano y costo/calidad del agente.
- Un ranking público por puntos incentivaría inflar tareas; el puntaje debe servir para planificación y calibración, no para castigo.

### P0 — Falta CRM multi-cliente

- Una marca es actualmente un registro dentro del CRM del workspace de la agencia.
- No hay un CRM propiedad del cliente con usuarios y pipelines propios.
- No hay separación entre notas internas de la agencia, datos compartidos y datos confidenciales del cliente.
- No hay offboarding que revoque el acceso de la agencia sin borrar el workspace del cliente.
- Un API key de workspace ya está bien encaminado, pero los agentes necesitan seleccionar explícitamente el workspace cliente antes de leer o mutar datos.

## 5. Modelo de datos objetivo

### RF-01 — Organización y workspaces (P0)

Agregar entidades:

- `organizations`: plan, billing owner, estado y límites.
- `organization_members`: usuario, rol, estado y fecha de alta/baja.
- `workspaces`: agregar `organization_id`, `workspace_type` (`personal`, `agency`, `client`), `owner_org_id` y estado.
- `workspace_relationships`: `agency_workspace_id`, `client_workspace_id`, tipo (`managed_service`, `partner`, `read_only`), alcance, consentimiento, `starts_at`, `ends_at`, `revoked_at`.
- `delegated_access_grants`: usuario o equipo agencia, workspace cliente, rol, scopes, expiración, otorgado por, revocado por y motivo.

Regla: cada request debe incluir un `workspaceId` explícito o derivado de una sesión de workspace; nunca se debe inferir el cliente por el nombre de la marca.

### RF-02 — Equipos, grupos y membresía granular (P0)

Agregar:

- `teams`: nombre, tipo (`internal`, `client`, `pod`) y workspace propietario.
- `team_members`: usuario, rol, fecha de entrada y salida.
- `project_members`: permisos por proyecto.
- `resource_shares`: archivo, carpeta o proyecto compartido con usuario/equipo.
- roles base: `org_owner`, `org_admin`, `workspace_owner`, `workspace_admin`, `pm`, `editor`, `reviewer`, `client_commenter`, `client_viewer`, `agent_service`.

El rol no reemplaza el alcance. Por ejemplo, un `editor` de un proyecto cliente no puede leer el CRM de otro cliente.

### RF-03 — Espacio personal (P0)

- Mantener un workspace personal por usuario.
- Borradores personales son privados por defecto.
- Publicar o mover un archivo a un workspace compartido requiere una acción explícita.
- El archivo conserva `created_in_workspace_id`, `current_workspace_id` y un historial de transferencias.
- Al abandonar la agencia, el usuario conserva sus borradores personales; la agencia conserva los archivos creados en su workspace según la política de propiedad configurada.

### RF-04 — Menciones y notificaciones (P0)

Las referencias no deben ser texto libre solamente. Agregar a tarea, comentario, archivo y actividad:

- `assignee_id`;
- `watcher_ids`;
- `mentioned_user_ids`;
- `mentioned_team_ids`;
- `project_id` y `workspace_id`;
- visibilidad y clasificación (`internal`, `shared_with_client`).

Eventos mínimos:

- mención directa o de grupo;
- asignación o reasignación;
- comentario nuevo o respuesta;
- solicitud de revisión/aprobación;
- tarea bloqueada, vencida o desbloqueada;
- cambio de permisos;
- inicio, cierre o riesgo de sprint;
- invitación y revocación de acceso.

La notificación debe incluir contexto, autor, workspace, recurso, acción, timestamp y enlace profundo. Debe ser idempotente para no enviar duplicados al reintentar un evento.

### RF-05 — Sprints y puntuación (P0)

Agregar:

- `sprints`: objetivo, periodo, owner, estado, workspace/proyecto.
- `sprint_items`: tarea, puntos comprometidos, puntos completados, carryover y motivo de cambio.
- `sprint_events`: cambios de alcance, bloqueo, revisión y cierre.
- `sprint_metrics`: committed, completed, velocity, cycle time, aging, rework y costo.

Reglas:

- story points representan esfuerzo relativo y se calibran por equipo;
- tokens, tiempo de agente y costo se muestran como métricas separadas;
- el score de una persona no se compara sin contexto de rol y tipo de tarea;
- el cierre exige registrar puntos incompletos y motivo de carryover;
- el dashboard puede mostrar tendencia del equipo y capacidad futura, no un leaderboard obligatorio.

### RF-06 — CRM de cliente con acceso delegado (P0)

Un cliente que quiere que Musa le administre su CRM debe recibir un **workspace de cliente propio**. La agencia crea o vincula ese workspace, pero no se apropia de los datos.

El workspace cliente contiene:

- marcas/unidades, contactos, campañas, deals y pipelines del cliente;
- usuarios del cliente y equipos internos del cliente;
- archivos, Design System y proyectos de esa marca;
- integraciones y API keys propias;
- notas y campos clasificados por visibilidad.

La organización agencia conserva:

- su pipeline de prospección y relación comercial;
- contrato, alcance, facturación y salud de la cuenta cliente;
- notas internas, costes, staffing y márgenes, invisibles para el cliente;
- un enlace al workspace cliente, no una copia de todos sus contactos y deals.

La relación debe permitir:

1. Invitar al cliente como `workspace_owner` o `client_admin` de su workspace.
2. Conceder a un equipo agencia acceso `pm`, `editor`, `reviewer` o `viewer` con scopes concretos.
3. Hacer que el cliente apruebe, expire o revoque el acceso delegado.
4. Consultar desde la agencia el estado de todas sus cuentas autorizadas sin mezclar registros.
5. Revocar el acceso sin borrar archivos, CRM ni historial del cliente.
6. Exportar y transferir la propiedad al terminar el contrato.

Casos de uso:

- **Solo colaboración:** portal o proyecto compartido con viewer/commenter; no se crea acceso al CRM completo.
- **Musa opera el CRM:** workspace cliente completo con permisos delegados y auditoría.
- **La marca ya tiene su cuenta:** vincularla como client workspace existente; nunca migrar copiando sin consentimiento.
- **Varios clientes de una agencia:** selector multi-workspace + filtros de portfolio; cada consulta conserva su `workspaceId`.

### RF-07 — API, MCP y agentes (P0)

Agregar herramientas con el mismo control de workspace que usa la UI:

- `list_organizations`, `list_workspaces`, `switch_workspace`;
- `create_team`, `list_teams`, `invite_to_workspace`, `set_project_membership`;
- `mention_user`, `list_notifications`, `mark_notification_read`;
- `create_sprint`, `set_task_points`, `get_sprint_report`;
- `create_client_workspace`, `grant_delegated_access`, `revoke_delegated_access`;
- `get_client_portfolio`, `get_client_crm`, `link_agency_client`.

Cada tool debe:

- exigir sesión o API key limitada a un workspace;
- devolver `workspaceId`, `organizationId`, rol efectivo y alcance aplicado;
- ocultar notas internas, costos y campos sensibles si el scope no los permite;
- rechazar IDs de otro workspace aunque el usuario conozca el UUID;
- registrar actor humano, agente o automatización en auditoría.

No se debe crear un “super key” de agencia para saltarse RLS. Un agente de agencia debe recibir una delegación con scopes, o una key separada del workspace cliente.

## 6. Planes comerciales propuestos

| Plan | Incluye | Límite inicial sugerido |
| --- | --- | --- |
| Solo | espacio personal + un workspace compartido, Kanban y CRM básico | 1 propietario, hasta 3 colaboradores |
| Agency | organización, equipos, workspaces cliente, portal, sprints, menciones y notificaciones | miembros y clientes según asientos/uso |
| Agency Pro | portfolio multi-cliente, acceso delegado avanzado, reporting cross-workspace, auditoría, roles personalizados y automatizaciones | límites altos + retención configurable |
| Enterprise | SSO/SCIM, políticas de datos, logs exportables, residencia/aislamiento dedicado y soporte | contrato |

La facturación debe distinguir:

- asientos internos de agencia;
- usuarios cliente activos;
- workspaces cliente administrados;
- almacenamiento, automatizaciones y uso de IA.

Un cliente invitado a comentar un proyecto no debería consumir el mismo asiento que un operador de CRM, salvo que el plan lo defina explícitamente.

## 7. Seguridad y propiedad de datos

- RLS por `workspace_id` y comprobación de relación delegada.
- No usar `brand.name`, email o slug como frontera de seguridad.
- Separar campos `internal`, `shared` y `client_only`.
- Audit log para grants, revocaciones, exportaciones, cambios de rol y acceso a datos sensibles.
- Expiración automática de accesos temporales y revisión periódica.
- El cliente conserva propiedad de su workspace y puede exportarlo.
- Al terminar la relación, revocar tokens, webhooks y sesiones delegadas; no borrar datos del cliente.
- Agentes no ven costos, márgenes ni notas internas por defecto.

## 8. Fases de implementación

### Fase 0 — Fundaciones de tenancy y permisos

1. Añadir `organization_id`, `workspace_type` y relación agencia-cliente.
2. Normalizar roles y scopes.
3. Implementar selector multi-workspace y contexto visible en cada pantalla.
4. Agregar `project_members`, equipos y grupos.
5. Cubrir RLS, API keys y pruebas de cross-tenant access.

### Fase 1 — Colaboración y sprints

1. Menciones estructuradas, comentarios y watchers.
2. Inbox de notificaciones, email y preferencias.
3. Entidad sprint, puntos, carryover y reportes.
4. Asignación por usuario o equipo en Kanban.
5. Acciones rápidas desde notificaciones.

### Fase 2 — CRM de cliente y portal

1. Crear/vincular workspace cliente.
2. Invitación y aprobación de acceso delegado.
3. CRM aislado por cliente con visibilidad por campo.
4. Portal client viewer/commenter y reportes compartidos.
5. Offboarding, exportación y transferencia.

### Fase 3 — Operación de agencia

1. Portfolio cross-workspace con métricas agregadas y sin datos sensibles.
2. Presupuesto, horas, costos y margen internos.
3. Auditoría exportable, SSO/SCIM y políticas enterprise.
4. Facturación por asientos, clientes y uso.
5. Integraciones externas por workspace y webhooks con scopes.

## 9. Criterios de aceptación

- Una persona puede tener borradores personales y trabajar en varios workspaces sin mezclar archivos.
- Un PM puede mencionar a un usuario o equipo en una tarea y el destinatario recibe una notificación con enlace y contexto.
- Un cliente puede comentar un archivo o revisar una tarea sin leer notas internas, costos ni otros clientes.
- Un sprint muestra comprometido, completado, carryover, velocity y costo de agentes por separado.
- Una agencia puede cambiar entre sus workspaces cliente y confirmar el workspace activo antes de cualquier mutación.
- Un cliente puede aprobar y revocar el acceso de la agencia; la revocación es efectiva para UI, API y MCP.
- El CRM de Cliente A nunca aparece en la búsqueda, listado o sugerencias del Cliente B.
- La agencia puede consultar su pipeline comercial y el estado de cuentas gestionadas sin copiar todos los registros del CRM cliente.
- Al terminar el contrato, el cliente conserva sus datos y la agencia pierde acceso delegado, claves y webhooks.
- Un agente que intenta usar el ID de otro workspace recibe `403` y no filtra existencia del recurso.

## 10. Decisiones que debemos cerrar antes de implementar

1. Si una cuenta cliente puede pertenecer a varias agencias y con qué límites.
2. Si el plan Agency factura al cliente como asiento invitado o como workspace administrado.
3. Qué campos CRM son `internal`, `shared` y `client_only` por defecto.
4. Si el primer release soporta solo una base Supabase multi-tenant o también aislamiento dedicado.
5. Qué canales de notificación se habilitan en MVP: in-app, email o ambos.
6. Si los puntos usan Fibonacci (1, 2, 3, 5, 8) o una escala propia por equipo.

## 11. No objetivos del primer release

- No construir un ERP, contabilidad o facturación completa.
- No mezclar los datos de todos los clientes en un CRM global visible.
- No convertir los puntos de sprint en ranking laboral automático.
- No permitir que un agente de agencia tenga acceso universal por conveniencia.
- No reactivar tools antiguas de equipos sin contratos de autorización, RLS y UI verificable.
