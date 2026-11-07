---
name: musa-organizacion
description: Organización en Musa (planes corporativos). Áreas internas, la aprobación de piezas por Marketing u otra área validadora, agencias externas con su SLA y las plantillas de marca bloqueadas. Úsala en empresas con varias áreas o agencias que producen para la misma marca.
module: organizacion
---

# Organización · áreas, aprobaciones y agencias

En una empresa, varias áreas (Marketing, RR. HH., Producto…) producen piezas, y una de ellas **valida** antes de publicar. Las agencias externas trabajan para áreas concretas con un SLA.

## Flujos

**Ver la estructura**
- `list_org({ workspaceId })` → áreas, agencias y aprobaciones (filtra con `approvalStatus: "pendiente"`).

**Configurar áreas y agencias** (dueños o admins)
- `org_area_save({ workspaceId, name, description, leadName, validates, brandIds })`. `validates: true` para el área que aprueba (normalmente Marketing).
- `org_agency_save({ workspaceId, name, contactEmail, areaIds, slaHours, accessNote })`.
- Ambas aceptan `id` para editar y `delete: true` para quitar.

**Mandar una pieza a aprobación**
1. Termina y verifica el diseño (skill `musa-diseno`).
2. `approval_request({ workspaceId, templateId, areaId, requestedBy })` → queda pendiente.

**Aprobar o pedir cambios** (dueños o admins, igual que en la web)
1. Revisa la pieza contra la guía: `validate_brand`, `check_accessibility` (skill `musa-marcas`).
2. `approval_decide({ workspaceId, id, status: "aprobado" | "cambios", comment, checks: [["Logo y márgenes", 1], ["Colores de la guía", 1], ["Tipografía", 0], ["Tono de voz", 1], ["Claims legales", null]] })`.
3. Si pides cambios, el comentario debe decir exactamente qué corregir.

**Plantillas de marca bloqueadas**
- Las áreas producen desde plantillas aprobadas: `create_from_plantilla`, y los estilos bloqueados se respetan con `get_active_styles` / `set_style_lock` (skill `musa-marcas`).

## Herramientas

- `list_org`: áreas, agencias y aprobaciones.
- `org_area_save`, `org_agency_save`: crear, editar o borrar áreas y agencias.
- `approval_request`: enviar un diseño a aprobación.
- `approval_decide`: aprobar, pedir cambios o reabrir, con checklist y comentario.

## Reglas

- Una IA no aprueba su propio trabajo: si tú hiciste la pieza, deja la decisión a una persona u otro agente revisor.
- Organización existe en planes corporativos; si las tablas vienen vacías, puede que el espacio no la use.

## Ejemplos

- "Crea las áreas Marketing (valida), RR. HH. y Producto"
- "Manda el afiche de bienvenida a aprobación de Marketing"
- "¿Qué piezas están pendientes de aprobación y cuál lleva más tiempo?"
