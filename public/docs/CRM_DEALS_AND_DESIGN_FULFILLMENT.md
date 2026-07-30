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

La migración está en `supabase_migrations_v14.sql` y debe aplicarse después de v13.

Orden seguro:

1. Ejecutar las migraciones pendientes en Supabase.
2. Verificar que `supabase_migrations_v14.sql` termine con `Success`.
3. Actualizar `.migration-version` al mayor número aplicado.
4. Desplegar el código.

La migración habilita RLS para deals, entregables y vínculos. Las políticas verifican el rol del workspace y la coherencia entre deal, marca, campaña, stakeholder, entregable y archivo.
