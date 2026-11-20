# REQ-080 — Agente productor F1 (batch diario) + REQ-081 Operación

## Qué se construyó (20-nov-2026)
1. **Tick diario del Musa Batch** (`worker/runtime/functions/agent-batch-tick.mjs`):
   el pipeline Kanban (leader/implementer/reviewer, `musa-batch-background`)
   ya existía pero su tick horario era de Netlify y no migró. Ahora el cron
   */5 del worker lo despierta UNA vez al día (11:00-11:04 UTC = 06:00 Lima)
   con puerta diaria en `platform_config` (`agent_batch_last_day`).
   Opt-in real: solo workspaces con `auto_process_enabled=true` (ya estaba en
   `runDailyBatch`). Kill switch global `AGENT_BATCH_ENABLED=false`.
   Disparo: POST interno a `/api/musa-batch-background` con `x-batch-secret`.
2. **UI de operador (REQ-081)**: tab Configuración → «Operación»
   (`OperationsSection.tsx`) + endpoint `GET /api/operations/overview`
   (`api/src/routes/operations.ts`, gate `requireUserSession` +
   `canAccessWorkspace`). Por marca: piezas 7d, pendientes de aprobación
   (con días de la más vieja), programadas, publicadas/jobs/entregas 30d.
   Totales + alertas ("X lleva 5 días sin aprobar") + agentes conectados con
   su uso del mes (key_usage_monthly). MCP-first: el agente lee lo mismo con
   list_brands + key_usage + client_report_generate.

## Por qué F1 y no el "agente de verdad" aún
F1 = agente batch: produce piezas en BORRADOR diariamente para plan pago
(no-BYOK, créditos de plataforma). El loop continuo (F3) necesita runtime
persistente (Maritime o similar) — Workers free: 10ms CPU/invocación.
F2 (reactivo a eventos) queda para después de F1 validado.

## Costos
Tick: 1 query en 287/288 ticks del día; 1 fetch interno el día que corre.
Pipeline: créditos de plataforma SOLO para workspaces opt-in (se vende).
Operación: 5 queries por consulta, sin cron.
