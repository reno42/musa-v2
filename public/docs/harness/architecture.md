# Arquitectura — Qué significa "hacer un buen trabajo" en Futuraria Design

> Este documento define el estándar de calidad. Los agentes revisores
> evalúan trabajo contra este archivo. Si no está aquí, no es un requisito.

## Principios

1. **MCP-first.** Toda mutación al editor pasa por tools del MCP
   (`update_template`, `set_html`, `set_css`, `create_frame`, …). No hay
   una segunda API paralela. Un agente externo con su `fdr_ws_...` key puede
   hacer todo lo que un humano hace via UI.

2. **Cloud-only.** Cero archivos locales de estado. Todo vive en Supabase:
   templates, frames, kanban, harness, brands, style library. El repo de git
   contiene código y docs, no datos de usuario.

3. **Multi-tenant.** Toda tabla del harness tiene `account_id` (FK a
   `auth.users(id)`) y RLS policy `account_id = auth.uid()`. Un agente nunca
   puede leer ni escribir datos de otra cuenta. Google login bienvenido.

4. **Anti-context-degradation.** La memoria se extrae constantemente a
   `harness_entries` con `harness_dump_context`. Los subagentes arrancan con un
   `context_summary` mínimo (rol + acceptance + plan + últimas 3 entries). A
   partir del 40% de uso del contexto, se debe flushear.

5. **Una feature a la vez.** `harness_claim_feature` falla si la cuenta ya tiene
   una task en `draft` o `design`. Es la traducción cloud de la regla de
   `init.sh` que rechaza >1 `in_progress`.

6. **Verificación ejecutable.** `harness_healthcheck` reemplaza a `init.sh`.
   Valida MCP, Supabase, tablas del harness y opcionalmente `lint_design` sobre
   un template. El reviewer debe correrlo antes de aprobar.

7. **Determinismo sobre creatividad.** Cuando un prompt puede producir
   resultados distintos, se usa el `styleFingerprint` o el `tokensJson` de la
   brand para acotar. Una brand = un sistema de diseño estable.

## Flujo de datos

```
humano ──habla──▶ Leader (cualquier IA)
                     │
                     ├── harness_claim_feature(taskId)
                     ├── harness_start_session(role:"implementer")
                     │      ↓ context_summary mínimo
                     │   Subagente (Implementer)
                     │      ├── MCP: set_html / set_css / create_frame
                     │      ├── harness_log_entry(progress) por paso
                     │      └── harness_submit_for_review
                     │
                     ├── harness_start_session(role:"reviewer")
                     │      ↓
                     │   Subagente (Reviewer)
                     │      ├── harness_get_entries
                     │      ├── harness_healthcheck({ templateId })
                     │      ├── harness_evaluate_checkpoint por C1-C5
                     │      └── verdict: APPROVED | CHANGES_REQUESTED
                     │
                     └── si APPROVED → harness_complete_feature
                                         ↓
                                     Kanban UI: columna Done (Realtime)
```

## Qué NO hacer

- **No** escribir a Supabase directamente desde el frontend. Siempre via MCP.
- **No** dejar tasks en `draft` si la sesión se cancela. Llama
  `harness_release_feature`.
- **No** aprobar sin correr `harness_healthcheck` con `ok: true`.
- **No** circular contenido de subagentes por chat. Referencias solamente.
- **No** inventar tools. Si una capability no está en `SKILL.md`, no existe.
- **No** dejar un agente trabajando en segundo plano sin loguear. Si pasó algo,
  debe estar en `harness_entries`.
