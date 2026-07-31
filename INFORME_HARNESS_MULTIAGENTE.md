# INFORME: Orquestación Multi-Agente — Contrastes con Sistemas Profesionales

> **Autor:** Subagente de investigación — Hermes Agent  
> **Fecha:** 30 de julio de 2026  
> **Repositorio analizado:** `design-main` (Futuraria Design)  
> **Alcance:** Comparación de `spawnSubagent()` del ChatFAB.tsx contra patrones profesionales de orquestación multi-agente

---

## 0. RESUMEN EJECUTIVO

El repo `design-main` tiene una **arquitectura multi-agente conceptualmente correcta** — roles separados, tools filtradas, contexto aislado, checkpoints y persistencia en Supabase — pero la implementación de `spawnSubagent()` es **síncrona, secuencial, bloqueante y carece de 9 capacidades críticas** que los sistemas profesionales (Claude Code Agent Tool, CrewAI, AutoGen, LangGraph) sí tienen. El backend (MCP + Supabase + SQL) está **más avanzado que el frontend**: la infraestructura cloud soporta multi-tenancy, RLS, y agent definitions dinámicas, pero el frontend `spawnSubagent()` no puede consumir agentes personalizados ni orquestar en paralelo.

---

## 1. CÓMO IMPLEMENTAN SUBAGENTES LOS SISTEMAS PROFESIONALES

### 1.1 Claude Code — Agent Tool (nativa)

**Mecanismo:** Claude Code tiene una herramienta nativa `Agent` que **invoca un proceso Claude Code separado** con su propio system prompt, tools y contexto aislado.

```yaml
# .claude/agents/leader.md
tools: Read, Glob, Grep, Bash, Agent
```

- **Spawning real:** El Agent tool lanza un subproceso Claude real con `subagent_type` que apunta a otro archivo `.claude/agents/<name>.md`
- **Context isolation:** El subagente recibe SOLO la instrucción del leader + su propio `CLAUDE.md` + los docs de referencia. No hereda el historial de la conversación del leader
- **Tool filtering:** Cada `.md` declara `tools:` explícitamente (ej: implementer tiene `Read, Write, Edit, Glob, Grep, Bash`; reviewer solo `Read, Glob, Grep, Bash`)
- **Result collection:** Anti-teléfono-descompuesto — los subagentes escriben a ARCHIVOS (`progress/*.md`) y responden UNA línea: `done -> progress/impl_feature.md`
- **Hooks automáticos:** `.claude/settings.json` con `PostToolUse` (corre tests automáticamente tras cada edit) y `Stop` (fuerza init.sh antes de cerrar)
- **Paralelismo:** El leader lanza 2-3 explorers en paralelo, y el Agent tool los maneja concurrentemente

### 1.2 CrewAI — Crews + AgentTool

**Mecanismo:** Cada agente es una instancia Python con `role`, `goal`, `backstory`, `tools`, y `llm` propios. Los crews orquestan agentes con procesos secuenciales o jerárquicos.

- **Spawning:** `Crew(agents=[...], tasks=[...], process=Process.sequential)` — cada task se ejecuta en el contexto del agente asignado
- **Context isolation:** Cada agente tiene su propio `llm` (puede ser diferente modelo/proveedor), su propio `system_message` derivado de role+goal+backstory, y su propia lista de tools
- **Tool filtering:** `@tool` decorators + `tools=[...]` explícito por agente. El orchestrator no ve las tools del implementer
- **Result collection:** `Task.output` con `output_pydantic` / `output_json` para structured output; `context` compartido entre tasks vía `TaskContext`
- **Memoria:** `memory=True` habilita short-term, long-term, entity, y user memory vectors compartidos entre agentes

### 1.3 AutoGen (Microsoft Agent Framework) — AgentTool

**Mecanismo:** `AgentTool` envuelve un agente como una tool invocable por otro agente. El agente orquestador ve agentes especializados como tools en su toolbox.

```python
math_agent = AssistantAgent("math_expert", system_message="You are a math expert.")
math_agent_tool = AgentTool(math_agent, return_value_as_last_message=True)
orchestrator = AssistantAgent("assistant", tools=[math_agent_tool, chem_agent_tool])
```

- **Spawning:** El orchestrator invoca `AgentTool` → AutoGen ejecuta una conversación completa dentro del agente especializado → retorna el último mensaje
- **Context isolation:** Cada agente tiene su propio `system_message`, `model_client`, y `workbench` (MCP servers). Máximo `max_tool_iterations` por subagente
- **Tool filtering:** Cada agente define sus propias tools vía `workbench` (MCP servers) o `handoffs`; no hay acceso cruzado
- **Result collection:** `return_value_as_last_message=True` — solo retorna el mensaje final, no el historial completo
- **Handoff pattern:** `handoffs=[other_agent]` permite transferencia directa de conversación entre agentes (más avanzado que simple spawn)

### 1.4 LangGraph — Subgraphs

**Mecanismo:** LangGraph usa `StateGraph` con nodos que pueden ser otros grafos completos (subgraphs). Cada subgraph es un agente autónomo con su propio estado, tools, y ciclo de ejecución.

- **Spawning:** `builder.add_node("implementer", implementer_subgraph)` — el subgraph se compila como un grafo independiente
- **Context isolation:** Cada subgraph define su propio `State` (TypedDict) con campos específicos. El estado del padre y del hijo son independientes; se comunican vía `Command` o `interrupt`
- **Tool filtering:** Cada nodo/subgraph tiene acceso solo a las tools declaradas en su scope
- **Durable execution:** LangGraph persiste el estado de cada subgraph automáticamente vía checkpointing. Si un subagente falla, se reanuda desde el último checkpoint
- **Human-in-the-loop:** `interrupt()` en cualquier nodo pausa la ejecución y permite intervención humana antes de continuar

### 1.5 MetaGPT — Roles + SOPs

**Mecanismo:** MetaGPT modela una empresa de software completa con roles (ProductManager, Architect, Engineer, etc.) que se comunican vía mensajes estructurados y un `Environment` compartido.

- **Spawning:** `Role.run()` → el rol observa mensajes en el environment, razona con su LLM, y publica acciones
- **Context isolation:** Cada rol tiene su propio system prompt derivado de su perfil (nombre, goal, constraints) y solo ve los mensajes dirigidos a él en el `Environment`
- **Tool filtering:** Actions específicas por rol (`WriteDesign`, `WriteCode`, `WriteTest`). Un Engineer no puede ejecutar `WritePRD`
- **Result collection:** Los resultados se publican como mensajes en el Environment compartido. El `Memory` del environment almacena todo el historial estructurado

---

## 2. ANÁLISIS DE `spawnSubagent()` (ChatFAB.tsx, líneas 480-626)

### 2.1 Cómo funciona actualmente

```typescript
async function spawnSubagent(params: {
  role: "implementer" | "reviewer";
  taskId?: string;
  instruction: string;
  templateId?: string;
}): Promise<string>
```

**Flujo:**
1. Toma la API key del `localStorage` del navegador (mismo proveedor/modelo que el Leader)
2. Llama `harness_start_session` via MCP → crea registro en Supabase con `context_summary`
3. Selecciona system prompt y tools según rol (IMPLEMENTER_PROMPT/REVIEWER_PROMPT + IMPLEMENTER_TOOLS/REVIEWER_TOOLS)
4. Inicia un **loop síncrono** de hasta 15 rondas (`for` loop bloqueante)
5. Cada ronda: `fetch()` al LLM → parsea tool calls → ejecuta `executeToolCall()` → inyecta resultado en `subConv[]`
6. Cuando el LLM deja de emitir tool calls o se alcanzan 15 rondas: retorna resultado

### 2.2 Lo que hace BIEN

| Aspecto | Evaluación |
|---|---|
| **Separación de roles** | ✅ System prompts distintos para implementer y reviewer |
| **Tool filtering estructural** | ✅ `IMPLEMENTER_TOOL_NAMES` (9 tools) vs `REVIEWER_TOOL_NAMES` (11 tools) vs `LEADER_TOOL_NAMES` (14 tools) — filtrado con `Set` + `filter()` |
| **Context isolation** | ✅ `subConv[]` arranca fresco, sin historial del Leader |
| **Session ID** | ✅ Inyectado en el primer mensaje para que el subagente lo use |
| **TemplateId capture** | ✅ Captura el ID de templates creados desde resultados de tools |
| **Anti-teléfono-descompuesto conceptual** | ✅ El prompt del system dice "responde UNA línea" |

### 2.3 LO QUE FALTA — 9 brechas críticas

#### BRECHA 1: **Ejecución síncrona y bloqueante (CRÍTICA)**
- **Actual:** `spawnSubagent()` usa `for` loop + `await fetch()` **secuencial**. El Leader se congela esperando que termine el subagente. No puede lanzar 2 subagentes en paralelo.
- **Profesional:** Claude Code lanza explorers en paralelo; CrewAI ejecuta tasks en `Process.hierarchical` concurrente; AutoGen permite múltiples `AgentTool` calls asíncronas.
- **Impacto:** Un implementer que tarda 30s bloquea toda la UI. No se puede hacer implementer + explorer simultáneos.

#### BRECHA 2: **Sin timeout ni circuit breaker**
- **Actual:** 15 rondas máximo, pero sin timeout global. Si el LLM se cuelga en una ronda, `fetch()` espera indefinidamente (no hay `AbortController`).
- **Profesional:** AutoGen tiene `max_tool_iterations` + timeout; LangGraph tiene `interrupt` y `Command` para timeouts.
- **Impacto:** Una API lenta = UI congelada sin recover.

#### BRECHA 3: **Sin streaming ni feedback en tiempo real**
- **Actual:** El Leader no ve NADA de lo que hace el subagente hasta que termina. Las tool calls del subagente no se emiten como eventos al UI.
- **Profesional:** Claude Code muestra streaming del subagente; CrewAI tiene `verbose=True` y callback `step_callback`.
- **Impacto:** Experiencia de "caja negra" — el usuario ve un spinner 30 segundos sin saber qué pasa.

#### BRECHA 4: **Sin manejo de errores granular**
- **Actual:** `catch { /* non-fatal */ }` en `harness_start_session` y `catch` genérico en tool calls. Si el LLM devuelve un error de API, el subagente simplemente termina sin recovery.
- **Profesional:** LangGraph tiene `Command(goto=...)` para reintentos; CrewAI tiene `max_retries` y `retry_limit` por task.
- **Impacto:** Un error transitorio de API mata toda la sesión del subagente sin reintento.

#### BRECHA 5: **Sin paralelismo real (CRÍTICA)**
- **Actual:** `spawnSubagent()` se invoca desde `executeToolCall()` que es `await`-secuencial. El Leader no puede hacer `Promise.all([spawnSubagent(...), spawnSubagent(...)])`.
- **Profesional:** Claude Code `Agent` tool permite múltiples invocaciones concurrentes; CrewAI `Process.hierarchical` ejecuta tasks en paralelo dentro de un manager.
- **Impacto:** Sin explorers paralelos. Sin implementer+reviewer pipeline asíncrono.

#### BRECHA 6: **Sin inyección de contexto desde DB al subagente**
- **Actual:** `harness_start_session` genera un `context_summary` JSON con agent def + task + plan, pero `spawnSubagent()` solo lo usa si `sessResult?.session?.context_summary` existe. Si la llamada falla (catch no-fatal), usa `params.instruction` crudo.
- **Profesional:** Claude Code Agent tool inyecta archivos de referencia; CrewAI `Task.context` inyecta outputs de tasks anteriores.
- **Impacto:** Si Supabase está caído, el subagente arranca sin el acceptance criteria ni las reglas del proyecto — solo con la instrucción del usuario.

#### BRECHA 7: **Agentes hardcodeados — sin definiciones dinámicas (CRÍTICA)**
- **Actual:** `IMPLEMENTER_PROMPT`, `REVIEWER_PROMPT`, `IMPLEMENTER_TOOLS`, `REVIEWER_TOOLS` están **hardcodeados en el frontend**. El backend tiene `harness_agent_definitions` con agentes dinámicos (explorer, custom roles), pero `spawnSubagent()` solo acepta `"implementer" | "reviewer"`.
- **Profesional:** Claude Code lee `.claude/agents/*.md` dinámicamente; CrewAI construye agentes desde config; MetaGPT define roles como clases Python.
- **Impacto:** Impossible crear un agente "explorer", "debugger", "optimizer" sin modificar ChatFAB.tsx.

#### BRECHA 8: **Mismo proveedor/modelo para todos los agentes**
- **Actual:** El subagente usa `localStorage.getItem(LS_LLM_KEY_KEY)` y `localStorage.getItem(LS_PROVIDER_KEY)` — la MISMA API key y proveedor que el Leader.
- **Profesional:** CrewAI permite `Agent(llm=llm)` diferente por agente; AutoGen `AssistantAgent("name", model_client=OpenAIChatCompletionClient(model="gpt-4.1"))` diferente por agente.
- **Impacto:** No se puede usar GPT-4o para el implementer (diseño) y Claude para el reviewer (verificación) con diferentes claves.

#### BRECHA 9: **Sin persistencia de conversación del subagente**
- **Actual:** `subConv[]` es un array en memoria. Si la pestaña se cierra o el componente se desmonta, la conversación del subagente se pierde. Solo sobrevive lo que el subagente escribió explícitamente a `harness_entries`.
- **Profesional:** LangGraph persiste estado automáticamente vía checkpointing; CrewAI tiene `memory=True` con vectores persistentes.
- **Impacto:** Un subagente interrumpido no puede reanudarse. Hay que empezar de cero.

---

## 3. AISLAMIENTO DE CONTEXTO: ANÁLISIS DETALLADO

### 3.1 Lo que existe

- **Leader:** `HARNESS_SYSTEM_PROMPT` (73 líneas hardcodeadas) + `LEADER_TOOLS` (14 tools filtradas de 193)
- **Implementer:** `IMPLEMENTER_PROMPT` (28 líneas) + `IMPLEMENTER_TOOLS` (9 tools)
- **Reviewer:** `REVIEWER_PROMPT` (33 líneas) + `REVIEWER_TOOLS` (11 tools)

Cada subagente arranca con `subConv = [{ role: "user", content: "<instrucción + sessionId>" }]` — SIN historial del Leader.

### 3.2 Lo que falta

| Aspecto | Estado actual | Sistemas profesionales |
|---|---|---|
| **Contexto comprimido** | `context_summary` JSON crudo (agente + task + plan) | CrewAI: `TaskContext` con resúmenes estructurados; Claude Code: solo referencias a archivos |
| **Límite de contexto** | No se monitorea. El subagente puede llenar `subConv[]` con 15 rondas × tool results grandes | LangGraph: `messages` con truncado automático; AutoGen: `max_tool_iterations` + `model_client_stream` |
| **Context dump** | El AGENTS.md menciona `harness_dump_context` al 40% de uso, pero el `spawnSubagent()` no lo implementa — el subagente no tiene acceso a la herramienta `harness_dump_context` | Claude Code: prompt caching automático; LangGraph: checkpointing incremental |
| **Referencias a archivos vs contenido** | El subagente recibe TODO el contenido inline en el prompt. Si la instrucción es larga (HTML de un template, acceptance criteria de 10 items), se come el contexto | El ejemplo-harness-subagentes usa `done -> progress/file.md` (solo referencias). El contento NUNCA circula por chat |

---

## 4. FILTRADO DE TOOLS POR ROL: ANÁLISIS DETALLADO

### 4.1 Lo que existe

```typescript
const LEADER_TOOL_NAMES = new Set([
  "studio_create_card", "studio_list_cards", "studio_move_card", "studio_get_card",
  "harness_delegate_task", "harness_healthcheck", "harness_get_context",
  "harness_list_features", "harness_claim_feature", "harness_release_feature",
  "harness_get_entries", "harness_complete_feature", "harness_report_error",
  "harness_submit_for_review", "list_workspaces", "list_templates",
]);

const IMPLEMENTER_TOOL_NAMES = new Set([
  "create_html_template", "create_frame", "create_html_frame",
  "set_html", "set_css", "get_template", "list_frames",
  "harness_submit_for_review", "harness_log_entry",
  "list_workspaces",
]);

const REVIEWER_TOOL_NAMES = new Set([
  "get_template", "get_template_structure", "get_html_frames", "get_frame",
  "lint_design", "export_frame", "harness_get_entries", "harness_evaluate_checkpoint",
  "harness_healthcheck", "list_templates", "list_frames",
]);
```

El filtrado es **estructural**: `HARNESS_TOOLS.filter(t => ROLE_TOOL_NAMES.has(t.function.name))`. El LLM literalmente no ve tools que no están en su definición de funciones.

### 4.2 Lo que falta

| Aspecto | Estado actual | Profesional |
|---|---|---|
| **Tools dinámicas por agente** | Hardcodeadas en el frontend. No se cargan desde `harness_agent_definitions.tools[]` | Claude Code lee `tools:` del YAML del agente; CrewAI construye lista de tools programáticamente |
| **Explorer tools ausentes** | No existe `EXPLORER_TOOL_NAMES`. El rol "explorer" mencionado en docs no tiene implementación en ChatFAB | MetaGPT tiene `Role._observe()` + `Role._think()` + acciones específicas del rol |
| **MCP tools vs Browser tools** | `LEADER_TOOLS` incluye `mcp:*` conceptualmente pero `spawnSubagent` no distingue entre tools MCP y tools locales | AutoGen: `workbench` (MCP servers) + `tools` (funciones Python) — separación explícita |
| **Sin validación de seguridad** | Si un agente malicioso intenta llamar una tool que no está en su set, `executeToolCall` la ejecuta igual (no valida contra el rol) | AutoGen: `AgentTool` solo expone las tools del agente envuelto, imposible llamar tools fuera de su scope |

---

## 5. SISTEMA DE CHECKPOINTS Y VERIFICACIÓN

### 5.1 Lo que existe (BIEN)

- **5 checkpoints C1-C5** definidos en `docs/harness/checkpoints.md`:
  - C1: Entorno listo (`harness_healthcheck → ok: true`)
  - C2: Acceptance criteria cumplidos (uno por uno)
  - C3: Calidad geométrica (`lint_design_template: passed`)
  - C4: Persistencia (reload no pierde datos)
  - C5: Sesión cerrada correctamente

- **Backend:** `harness_evaluate_checkpoint` inserta/actualiza en `harness_checkpoints` con `passed` booleano + `notes` + `reviewer_agent`
- **Realtime:** `harness_checkpoints` publicado en `supabase_realtime` → UI se actualiza en vivo
- **Cierre condicional:** `harness_complete_feature` verifica que todos los checkpoints estén en `passed: true` antes de mover la task a `done`

### 5.2 Lo que falta

| Aspecto | Estado actual | Profesional |
|---|---|---|
| **Verificación automática pre-commit** | El reviewer tiene que llamar `harness_evaluate_checkpoint` manualmente. Nada fuerza la verificación | `.claude/settings.json` tiene `PostToolUse` hooks que corren tests automáticamente; LangGraph tiene `interrupt_before` para validación pre-nodo |
| **Checkpoints específicos por tipo de feature** | C1-C5 son genéricos. Un feature de "export PDF" necesita checkpoints distintos a "crear landing page" | MetaGPT tiene `ActionNode` con validación tipada por tipo de acción; CrewAI `Task.expected_output` con `output_pydantic` |
| **Sin evidencia automática** | El reviewer "confía" en que el implementer hizo lo que dijo. `docs/harness/verification.md` pide screenshots y logs pero no se automatiza | Claude Code hooks: `PostToolUse` corre `init.sh` tras cada escritura — la evidencia es ejecutable, no declarativa |
| **Sin lint pre-review obligatorio** | `harness_healthcheck({ templateId })` corre `lint_design` pero es opcional (si `params.templateId` existe). Si el reviewer no lo llama, no se ejecuta | LangGraph: `add_conditional_edges` con función de ruteo que fuerza pasar por nodo de validación |

---

## 6. PERSISTENCIA DE SESIONES

### 6.1 Lo que existe (BIEN)

**Schema (Supabase):** 4 tablas con RLS multi-tenant:
- `harness_sessions`: sesiones activas/pausadas/completadas con `context_summary`
- `harness_entries`: bitácora append-only (plan, progress, blocker, review, verdict, summary, exploration, context_dump)
- `harness_checkpoints`: evaluaciones objetivas por task
- `harness_agent_definitions`: definiciones de agentes (globales con `account_id IS NULL` + overrides por cuenta)

**Realtime:** 3 tablas publicadas en `supabase_realtime` → Kanban UI recibe updates en vivo
**Cronjobs:** `harness_cronjobs` con schedule + `encrypted_api_key` para ejecución automática vía Edge Functions

### 6.2 Lo que falta

| Aspecto | Estado actual | Profesional |
|---|---|---|
| **Persistencia de conversación del subagente** | `subConv[]` es volátil (memoria del navegador). Si la pestaña se cierra, se pierde la conversación completa | LangGraph: checkpointing automático de estado del grafo; CrewAI: memory vectors persistentes |
| **Reanudación de sesiones** | `harness_sessions` tiene `status IN ('active','paused')` pero no hay código en ChatFAB para cargar una sesión pausada y reanudar `subConv[]` | LangGraph: `graph.astream(config={"configurable": {"thread_id": "1"}})` reanuda desde último checkpoint |
| **Sin compresión de contexto al 40%** | `AGENTS.md` menciona `harness_dump_context` pero ni el Leader ni el subagente lo implementan | Claude Code: prompt caching automático; LangGraph: `messages` truncado automático con `max_messages` |
| **Sin migración de sesiones entre dispositivos** | Todo vive en `localStorage` + `subConv[]` en memoria. Si el usuario cambia de pestaña/navegador, pierde la sesión | CrewAI AMP Suite: control plane centralizado; LangSmith: deployment persistente |

---

## 7. TABLA COMPARATIVA COMPLETA

| Capacidad | design-main (ChatFAB) | Claude Code Agent | CrewAI | AutoGen/MAF | LangGraph |
|---|---|---|---|---|---|
| **Spawning real** | ✅ `fetch()` con prompt distinto | ✅ Proceso Claude separado | ✅ Crew.execute() | ✅ AgentTool.run() | ✅ Subgraph.compile() |
| **Paralelismo** | ❌ Síncrono secuencial | ✅ Explorers paralelos | ✅ Process.hierarchical | ✅ Async AgentTools | ✅ Subgraphs paralelos |
| **Context isolation** | ✅ subConv[] fresco | ✅ Archivos + prompt mínimo | ✅ System message por agente | ✅ System message + workbench | ✅ State independiente |
| **Tool filtering** | ✅ Set + filter estructural | ✅ tools: en YAML | ✅ tools=[] por agente | ✅ tools=[], workbench | ✅ Tools por nodo |
| **Agentes dinámicos** | ❌ Hardcodeados | ✅ .claude/agents/*.md | ✅ Python dinámico | ✅ Python dinámico | ✅ Grafos programáticos |
| **Múltiples modelos** | ❌ Mismo provider/key | ✅ Por configuración | ✅ llm= por agente | ✅ model_client= por agente | ✅ model= por nodo |
| **Streaming subagente** | ❌ Sin feedback | ✅ Streaming al leader | ✅ step_callback | ✅ model_client_stream | ✅ astream_events |
| **Timeout/Circuit breaker** | ❌ Sin timeout | ✅ Session timeout | ✅ max_retries | ✅ max_tool_iterations | ✅ interrupt + Command |
| **Checkpointing** | ✅ BD checkpoints (manual) | ✅ init.sh hooks | ✅ Task expected_output | ✅ Agent state serializable | ✅ Durable execution |
| **Reanudación** | ❌ No implementado | ✅ Session resume | ✅ Memory persistente | ✅ Checkpoint load | ✅ thread_id resume |
| **Hooks automáticos** | ❌ No implementado | ✅ PostToolUse/Stop | ✅ before/after callbacks | ✅ middleware | ✅ interrupt_before/after |
| **Human-in-the-loop** | ❌ No implementado | ✅ Approval mode | ✅ human_input=True | ✅ UserProxyAgent | ✅ interrupt() |
| **Persistencia conversación** | ❌ Memoria volátil | ✅ Archivos progress/ | ✅ Memory vectors | ✅ Checkpoint serializable | ✅ Checkpoint state |
| **Multi-tenant** | ✅ RLS + account_id | ❌ Local filesystem | ✅ AMP Suite (cloud) | ✅ A2A protocol | ✅ LangSmith deploy |

---

## 8. PLAN DE ACCIÓN: LO QUE HAY QUE CONSTRUIR

### Fase 1: Desbloquear el paralelismo — SEMANA 1-2

1. **Refactor `spawnSubagent()` a async no bloqueante**
   - Cambiar `for` loop síncrono por `Promise.race([subagentLoop(), timeoutPromise])`
   - Añadir `AbortController` con timeout configurable (ej: 120s)
   - Emitir eventos de progreso (`subagent:tool_start`, `subagent:tool_end`, `subagent:done`)

2. **Habilitar múltiples subagentes simultáneos**
   - Cambiar `executeToolCall("harness_delegate_task")` para que soporte `Promise.all([...])`
   - Añadir UI de "subagentes activos" con indicadores de progreso por subagente

### Fase 2: Agentes dinámicos — SEMANA 3-4

3. **Cargar definiciones de agente desde `harness_agent_definitions`**
   - Añadir `harness_get_agent_definitions` al leader tools
   - Modificar `spawnSubagent()` para aceptar `agentDefinitionId` + cargar prompt/tools desde BD
   - Soportar rol `explorer` y `custom`

4. **Soportar múltiples proveedores/modelos por agente**
   - Añadir campo `provider` y `model` a `harness_agent_definitions`
   - Permitir API key por agente o key global con override

### Fase 3: Persistencia y reanudación — SEMANA 5-6

5. **Persistir `subConv[]` en `harness_entries`**
   - Guardar cada tool call + resultado como `entry_type: "agent_turn"`
   - Al reanudar, reconstruir `subConv[]` desde entries

6. **Implementar `harness_resume_session`**
   - Backend: endpoint que carga session + entries y devuelve `subConv[]` reconstruido
   - Frontend: UI para ver sesiones activas/pausadas y reanudar

### Fase 4: Verificación automática — SEMANA 7-8

7. **Implementar hooks pre/post tool call**
   - Pre-hook: validar que la tool está en el set del rol (seguridad)
   - Post-hook: si el implementer escribe HTML/CSS → auto-trigger `lint_design`
   - Post-subagent: si el implementer terminó → auto-trigger reviewer con checkpoints

8. **Checkpoints automáticos**
   - El backend ejecuta `harness_evaluate_checkpoint` automáticamente al detectar `harness_submit_for_review`
   - C1 (entorno), C3 (lint), C4 (persistencia) se evalúan sin intervención del reviewer

### Fase 5: Observabilidad — SEMANA 9+

9. **Dashboard de subagentes**
   - Panel que muestra: agentes activos, sesiones recientes, checkpoints, errores
   - Streaming de tool calls en tiempo real vía Supabase Realtime

10. **Tracing distribuido**
    - Cada tool call del subagente → entry en `harness_entries` con `tool_name`, `duration_ms`, `success`
    - Dashboard de rendimiento: qué tools tardan más, qué agentes fallan más

---

## 9. CONCLUSIÓN

El repo `design-main` tiene una **visión arquitectónica sólida** que anticipa correctamente los patrones de orquestación multi-agente que los sistemas profesionales han validado:

- ✅ Separación Leader/Implementer/Reviewer (mismo patrón que Claude Code + CrewAI + MetaGPT)
- ✅ Tool filtering estructural por rol (más estricto que CrewAI)
- ✅ Contexto aislado con sesiones independientes
- ✅ Checkpoints + verificación con persistencia cloud
- ✅ Multi-tenancy con RLS en Supabase

Sin embargo, la **implementación actual es un prototipo funcional, no un sistema de orquestación robusto**. Las 9 brechas identificadas — especialmente el spawning síncrono, agentes hardcodeados, falta de paralelismo, y ausencia de persistencia de conversación — impiden que el sistema escale más allá de un solo agente secuencial por tarea.

**La buena noticia:** el backend (MCP + Supabase + SQL) ya tiene la infraestructura para soportar agentes dinámicos, reanudación, y checkpoints automáticos. El 80% del trabajo restante está en el frontend (`ChatFAB.tsx`), no en la arquitectura.

**Prioridad crítica:** Refactorizar `spawnSubagent()` para que sea asíncrono, paralelizable, y cargue agentes desde BD. Sin esto, el sistema seguirá siendo un "single-agent con disfraz multi-agente".

---

## REFERENCIAS

- **Repo analizado:** `C:/Users/Renzo/.openclaw/workspace/design-main/`
- **Archivos clave:** `src/components/ChatFAB.tsx:480-626`, `netlify/functions/mcp.mjs:11048-11290`, `supabase_migrations/harness.sql`, `docs/harness/*.md`
- **Ejemplo de referencia:** `ejemplo-harness-subagentes-main/.claude/agents/*.md`, `CLAUDE.md`, `.claude/settings.json`
- **Sistemas profesionales:** Claude Code Agent Tool, CrewAI (GitHub), AutoGen/Microsoft Agent Framework, LangGraph (LangChain), MetaGPT
