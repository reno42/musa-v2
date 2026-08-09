# REQ-008: Limpieza de tablas legacy (CRM + huérfanas)

**Status:** `review` → IDE agent debe confirmar antes de ejecutar
**Priority:** `P1`

## Resumen

La auditoría de Supabase encontró 16 tablas con 0 filas. De esas, 11 son **legacy** (sin código que las use). Este REQ propone eliminarlas.

## Tablas a eliminar

### Bloque 1: CRM (6 tablas)
| Tabla | Creada en | Referencias en código |
|---|---|---|
| `crm_deals` | v14 | Solo en migraciones y docs |
| `crm_deal_deliverables` | v14 | Solo en migraciones |
| `crm_deliverable_files` | v14 | Solo en migraciones |
| `crm_contacts` | v9 | 1 ref en `designMeta.ts` (upsert desde metadata) |
| `crm_activities` | v9 | Solo en migraciones |

### Bloque 2: Features nunca implementadas (5 tablas)
| Tabla | Creada en | Referencias en código |
|---|---|---|
| `bug_reports` | v6 | 0 referencias |
| `suppliers` | v12 | 0 referencias |
| `playbooks` | v12 | Solo en AGENTS.md (el playbook real se lee de archivos) |
| `workspace_invitations` | v9 | `saas.ts` tiene lógica de invitación pero la tabla nunca se pobló |
| `workspace_mcp_connections` | v9 | 0 referencias |

### Bloque 3: Cronjobs huérfanos (2 tablas)
| Tabla | Creada en | Conflicto |
|---|---|---|
| `design_kanban_cronjobs` | design_kanban.sql | Musa batch usa `task_queue` + GitHub Actions, no esta tabla |
| `harness_cronjobs` | harness.sql | Ídem. El handler MCP existe pero nunca se usó. |

## Tablas que NO se eliminan (verificadas activas)

| Tabla | ¿Por qué no? |
|---|---|
| `design_comments` (0 filas) | **VIVA.** Tiene handlers MCP activos. REQ-007 la activa con UI de comentarios. |
| `task_queue` (0 filas) | **VIVA.** Musa Daily Batch. Handlers MCP implementados, solo falta activar el cron. |
| `workspace_config` (0 filas) | **VIVA.** Configuración de Musa batch. |
| `campaigns` (0 filas) | **HUÉRFANA PARCIAL.** Se usa como tag en `design_file_meta.campaign`, pero la tabla separada no se toca. No se elimina aún — evaluar en REQ-009. |
| `design_file_meta` (117 filas) | **ACTIVA.** Contiene `obsidian_link` y metadata de templates. NO TOCAR. |

## Verificación de Obsidian

El campo `obsidian_link` existe en la tabla `design_file_meta` (117 filas activas).  
NO está relacionado con ninguna tabla CRM.  
Eliminar CRM no afecta la integración con Obsidian.

```sql
-- Confirmar que obsidian_link está en design_file_meta, no en CRM
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'design_file_meta' AND column_name = 'obsidian_link';
-- Debe devolver 1 fila.

SELECT column_name FROM information_schema.columns 
WHERE table_name IN ('crm_deals','crm_contacts','crm_activities','crm_deal_deliverables','crm_deliverable_files') 
  AND column_name = 'obsidian_link';
-- Debe devolver 0 filas.
```

## SQL de eliminación

```sql
-- ⚠️ REVISAR ANTES DE EJECUTAR
-- Backup de seguridad: esto solo droppea tablas con 0 filas confirmadas.

DROP TABLE IF EXISTS crm_deal_deliverables CASCADE;
DROP TABLE IF EXISTS crm_deliverable_files CASCADE;
DROP TABLE IF EXISTS crm_deals CASCADE;
DROP TABLE IF EXISTS crm_activities CASCADE;
DROP TABLE IF EXISTS crm_contacts CASCADE;
DROP TABLE IF EXISTS bug_reports CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS playbooks CASCADE;
DROP TABLE IF EXISTS workspace_invitations CASCADE;
DROP TABLE IF EXISTS workspace_mcp_connections CASCADE;
DROP TABLE IF EXISTS design_kanban_cronjobs CASCADE;
DROP TABLE IF EXISTS harness_cronjobs CASCADE;
```

## Instrucciones para el agente con IDE

1. **Revisar** cada tabla en la lista de eliminación:
   - `rg "crm_deals\|crm_contacts\|crm_activities\|crm_deliverable" --iglob '!node_modules' --iglob '!.git' .`
   - Confirmar que no hay referencias en handlers activos (solo en migraciones/docs)
   
2. **Verificar** que `obsidian_link` está en `design_file_meta`, no en CRM:
   - Ejecutar los SQL de verificación arriba

3. **Verificar** que las 11 tablas tienen 0 filas:
   ```sql
   SELECT tablename, n_live_tup FROM pg_stat_user_tables 
   WHERE tablename IN ('crm_deals','crm_contacts','crm_activities','crm_deal_deliverables','crm_deliverable_files','bug_reports','suppliers','playbooks','workspace_invitations','workspace_mcp_connections','design_kanban_cronjobs','harness_cronjobs');
   ```

4. Si todo OK → ejecutar el SQL de eliminación en Supabase SQL Editor

5. Si encuentra algo → reportar, no droppear

## Resultado esperado

- **Antes:** 35 tablas en Supabase
- **Después:** 24 tablas (11 eliminadas)
- Sin pérdida de funcionalidad
- Sin afectar Obsidian
- Sin afectar `design_comments`, `task_queue`, ni `workspace_config`
