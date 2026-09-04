# CRM, deals y cumplimiento de diseños

## Objetivo

El CRM convierte una oportunidad comercial en trabajo de diseño verificable sin duplicar las entidades que ya existen en Futuraria Design.

La relación es:

```text
Workspace
└── Marca
    ├── Stakeholders
    ├── Campañas
    ├── Deals
    │   └── Entregables (tipo de asset + cantidad)
    │       └── Archivos confirmados
    └── Diseños existentes
```

- **Marca:** cuenta comercial. Puede ser lead o cliente.
- **Stakeholder:** persona que trabaja dentro o alrededor de una marca.
- **Campaña:** contexto que separa iniciativas distintas de la misma marca.
- **Deal:** oportunidad o trabajo vendido. Recorre ventas, producción, revisión y entrega.
- **Entregable:** línea cuantificable del alcance, por ejemplo `8 × Social media`.
- **Archivo confirmado:** diseño que satisface un entregable concreto.

## Pipeline

| Etapa | Uso |
| --- | --- |
| `discovery` | Se está entendiendo la necesidad. |
| `proposal` | Se está preparando o enviando la propuesta. |
| `negotiation` | Alcance, precio o fechas en negociación. |
| `approved` | Trabajo aprobado y listo para producción. |
| `in_production` | Diseños en ejecución. |
| `review` | Diseños esperando revisión. |
| `ready` | Todo el alcance está listo. |
| `delivered` | Trabajo entregado. |
| `lost` | Oportunidad perdida. |

Cuando un deal pasa a `approved` o una etapa posterior, la marca se reconoce como cliente activa. La salud de una cuenta se maneja aparte como `active`, `at_risk` o `churned`; así el grafo puede conservar la división estable entre leads y clientes.

## Cruce entre entregables y archivos

`crm_deliverable_files` es la fuente de verdad. Un archivo solo puede confirmar un entregable dentro de un workspace, lo que evita contarlo dos veces.

El cruce automático exige estas cuatro coincidencias:

1. Mismo workspace.
2. Misma marca.
3. Misma campaña.
4. Mismo `asset_type`.

Si el deal no tiene campaña, el CRM muestra posibles coincidencias, pero no las confirma automáticamente. Un humano puede revisar y vincular un archivo manualmente. Esta regla evita mezclar campañas simultáneas de una misma marca.

El progreso se calcula como:

```text
archivos confirmados / cantidad solicitada
```

Los archivos sobrantes no elevan el progreso por encima de 100%.

## Sugerencias comerciales

Las sugerencias actuales son determinísticas; no llaman a una IA ni crean automatizaciones.

- Lead sin diseños: propone un paquete visual de entrada.
- Cliente activo: detecta huecos en la cobertura base de assets sin volver a sugerir lo que ya existe o ya está incluido en un deal abierto.
- Cliente en fuga: propone una campaña acotada de reactivación.
- Cliente perdido: propone auditoría y relanzamiento.

Estas sugerencias son evidencia para una decisión humana, no acciones automáticas.

## Interacciones comerciales y salud de cuenta (v45)

La migración `supabase_migrations_v45.sql` (idempotente, segura de re-ejecutar) añade tres piezas sin tocar las entidades existentes:

- **`crm_interactions`:** timeline comercial tipado por marca y persona. Tipos válidos: `primer_contacto`, `reunion`, `llamada`, `email`, `whatsapp`, `propuesta_enviada`, `revision`, `aprobacion`, `publicacion`, `pago`, `follow_up`, `objecion`, `otro`. Registrar una interacción actualiza `last_contacted_at` de la marca.
- **Outcome del deal:** `crm_deals.final_value` (valor finalmente facturado en deals `delivered`) y `crm_deals.lost_reason` (motivo en deals `lost`).
- **Salud con override:** `brands.account_health_override` fija manualmente `active`, `at_risk` o `churned`; mientras exista, gana sobre cualquier cálculo, con auditoría en `health_changed_at` / `health_changed_by`. En `null` la salud es automática: un cliente sin deals abiertos y con 30+ días sin contacto pasa a `at_risk`; `churned` persiste; un deal en `approved` o posterior mantiene la cuenta activa.

El servidor expone la salud resultante en `computed_health` dentro del agregado `/crm`. La UI (layout DIATTA con tipografía y fondos Musa) muestra esa salud computada, la ficha 360 por persona con su timeline y mini-embudo, y el embudo filtrable por persona.

### MCP (paridad completa)

Nada del CRM es UI-only: cada operación tiene su tool MCP y todas montan el mismo API del workspace que usa la UI.

| Tool | Función |
| --- | --- |
| `get_crm_overview` | El agregado completo: marcas con `computed_health`, personas con `dealStats`, deals y resumen. |
| `log_interaction` / `list_interactions` | Escribe y lee el timeline comercial. |
| `create_crm_deal` / `update_crm_deal` | Crea deals; mueve el embudo y registra `finalValue` / `lostReason`. |
| `update_crm_deliverable` | Edita líneas de alcance (el material de conciliación). |
| `create_crm_contact` / `update_crm_contact` | Personas; con `brandName` crea la marca y su Design System si no existen. |
| `update_crm_brand` | Relación, prioridad, notas, follow-up y el pin manual de salud (`accountHealthOverride`, `null` vuelve a automático). |

## API

Todas las rutas exigen una sesión válida y el rol correspondiente en el workspace.

| Método | Ruta | Función |
| --- | --- | --- |
| `GET` | `/api/workspaces/:id/crm` | Devuelve marcas, stakeholders, campañas, deals, diseños, progreso y sugerencias. |
| `POST` | `/api/workspaces/:id/deals` | Crea un deal con uno o más entregables. |
| `PATCH` | `/api/workspaces/:id/deals/:dealId` | Actualiza etapa, valor, fechas, contacto o campaña. |
| `DELETE` | `/api/workspaces/:id/deals/:dealId` | Elimina el deal y sus entregables. |
| `POST` | `/api/workspaces/:id/deals/:dealId/deliverables` | Añade una línea de alcance. |
| `PATCH` | `/api/workspaces/:id/deals/:dealId/deliverables/:deliverableId` | Edita una línea de alcance. |
| `DELETE` | `/api/workspaces/:id/deals/:dealId/deliverables/:deliverableId` | Elimina una línea de alcance. |
| `POST` | `/api/workspaces/:id/deals/:dealId/reconcile` | Confirma automáticamente archivos exactos y todavía no usados. |
| `POST` | `/api/workspaces/:id/deals/:dealId/deliverables/:deliverableId/files` | Vincula manualmente un archivo compatible. |
| `DELETE` | `/api/workspaces/:id/deals/:dealId/deliverables/:deliverableId/files/:templateId` | Retira una confirmación. |
| `GET` | `/api/workspaces/:id/interactions` | Lee el timeline comercial (filtro por marca o persona, más reciente primero). |
| `POST` | `/api/workspaces/:id/interactions` | Registra una interacción y actualiza `last_contacted_at` de la marca. |

## Contrato para un futuro agente de producción

El agente no necesita inventar otro sistema de tareas. Puede usar este flujo:

1. Leer `GET /api/workspaces/:id/crm`.
2. Elegir deals en `approved` o `in_production`.
3. Leer los entregables pendientes y los assets de marca existentes.
4. Crear cada diseño con las herramientas actuales del harness.
5. Guardar en `design_file_meta` el `brand_id`, `campaign_id` y `asset_type` del entregable.
6. Ejecutar `POST .../reconcile`.
7. Volver a leer el CRM y comprobar que `progress.complete` sea `true`.
8. Mover el deal a `ready`.

El agente solo debe marcar `ready` después de comprobar el progreso calculado por el servidor. Esto mantiene el kanban auditable y permite que un humano abra cada archivo confirmado.

## Base de datos y despliegue

La migración base está en `supabase_migrations_v14.sql` (después de v13). La capa de interacciones, outcome y salud está en `supabase_migrations_v45.sql` (después de v44). Ambas son idempotentes — `IF NOT EXISTS` en tablas, columnas e índices, y guardas `DO $$ ... $$` en constraints y políticas — así que re-ejecutarlas sobre una base ya migrada no genera conflictos.

Orden seguro:

1. Ejecutar las migraciones pendientes en Supabase (v42, v43, v44 y v45 si no se han aplicado; cada una detecta por sí misma lo que ya existe).
2. Verificar que cada migración termine con `Success`.
3. Actualizar `.migration-version` al mayor número aplicado.
4. Desplegar el código.

La migración habilita RLS para deals, entregables y vínculos. Las políticas verifican el rol del workspace y la coherencia entre deal, marca, campaña, stakeholder, entregable y archivo.
