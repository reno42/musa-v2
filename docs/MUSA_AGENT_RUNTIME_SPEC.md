# MUSA — Agent Runtime Architecture Spec

> **Target:** `design-main/src/components/ChatFAB.tsx`
> **Goal:** Elevate Musa from "sometimes works" to Hermes-level agent quality
> **Status:** Specification for IDE agent implementation
> **Date:** August 2026

---

## 1. CURRENT STATE (what exists)

### What works ✅
- Leader → Implementer → Reviewer delegation pattern
- Tool filtering by role (LEADER_TOOLS / IMPLEMENTER_TOOLS / REVIEWER_TOOLS)
- Harness session management in Supabase (harness_start_session, harness_submit_for_review)
- C1-C5 checkpoint evaluation
- Anti-telephone effect (write to DB, not pass in chat)
- `noToolCallsMade` detection in subagents (line 942)

### What's broken 🔴
- **Bug 1:** No `tool_choice: "auto"` → model responds with text instead of using tools (lines 1142, 904)
- **Bug 2:** No fake tool call detection in Leader → model writes tool names as text, nothing executes (after line 1167)
- **Bug 3:** No conversation trimming → context grows until model hallucinates (line 1108)
- **Bug 4:** Memory exists in Supabase but Leader never loads it → every session starts from zero (AGENTS.md line 16 says "OPCIONAL")
- **Bug 5:** Tool results are passed RAW to the model → MCP JSON wrapper becomes noise in context (line 976)

### What's missing 🟡
- **Bootstrap layer:** Skills/styles/playbooks loaded before chat starts
- **Verification pipeline:** Reviewer checks structure (C1-C5), but no render check (PNG), no content audit (text extraction)
- **Skills system:** Agent learns procedures and recalls them next session
- **Tool result parser:** Normalize MCP JSON → clean string before returning to model
- **Proactive memory flush:** Leader dumps context at 40% automatically, not manually

---

## 2. TARGET ARCHITECTURE (4 layers)

```
┌──────────────────────────────────────────────────────────────┐
│                    LAYER 1: BOOTSTRAP                         │
│  Runs ONCE when chat opens. Silent. No UI visible.           │
│                                                              │
│  harness_healthcheck()            → verify Supabase is up    │
│  harness_get_context({            → load session history     │
│    agentType: "leader",                                      │
│    loadPreviousSessions: true                                │
│  })                                                          │
│  get_active_styles({workspaceId}) → load saved styles        │
│  list_templates({workspaceId,     → load recent templates    │
│    limit: 5, sort: "recent"})                                │
│  get_agent_guide({agentType:      → load playbook if exists  │
│    "leader"})                                                │
│                                                              │
│  All of the above is injected into HARNESS_SYSTEM_PROMPT     │
│  via buildSystemPrompt() BEFORE any message is sent.         │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│               LAYER 2: EXECUTION LOOP                         │
│  The chat. Leader talks to human, delegates to subagents.    │
│                                                              │
│  FIX 1: tool_choice: "auto" on EVERY API call (line 1142,   │
│         904, 1134 for Anthropic)                             │
│  FIX 2: After line 1167: detect fake tool calls in text     │
│         → retry with stronger instruction                    │
│  FIX 3: Before line 1142: trim conversation to last ~15      │
│         messages to stay under model context limit            │
│  FIX 5: Normalize ALL tool results through a parser          │
│         before feeding back to conversation                   │
│                                                              │
│  Subagent tool loop (spawnSubagent):                         │
│  - Same FIX 1 and FIX 5 apply                               │
│  - Already has noToolCallsMade detection (keep it)           │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│            LAYER 3: VERIFICATION PIPELINE                     │
│                                                              │
│  CAPA 1 — STRUCTURAL (Reviewer, already exists)              │
│    C1: Dimensions match request                              │
│    C2: HTML not empty/placeholder                             │
│    C3: Palette/style matches specified brand                  │
│    C4: HTML well-formed                                       │
│    C5: CSS functional, no broken properties                   │
│                                                              │
│  CAPA 2 — VISUAL (NEW)                                       │
│    Reviewer calls render_html_template({templateId})         │
│    → Gets a PNG URL of the rendered design                   │
│    → Leader receives PNG URL in reviewer result              │
│    → Leader presents PNG to human: "Así se ve. ¿OK?"         │
│                                                              │
│  CAPA 3 — CONTENT AUDIT (NEW)                                │
│    Reviewer calls harvest_text({templateId})                 │
│    → Gets all text content extracted from the design         │
│    → Compares against original instruction:                  │
│      - Are all requested words present?                      │
│      - Is there placeholder text (lorem ipsum)?              │
│      - Are dimensions/content boundaries respected?          │
│                                                              │
│  CAPA 4 — HUMAN (always exists)                              │
│    Leader shares editor link + render PNG                    │
│    Human approves or requests changes                        │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│            LAYER 4: MEMORY & LEARNING                         │
│                                                              │
│  AUTO-SAVE (during session):                                 │
│    - harness_log_entry() after every significant action       │
│    - register_brand() when a new style is created             │
│    - harness_dump_context() when conversation > 40% capacity  │
│                                                              │
│  AUTO-LOAD (next session, via Layer 1 Bootstrap):            │
│    - Recent sessions from harness_get_context()              │
│    - Active styles from get_active_styles()                  │
│    - Recent templates from list_templates()                   │
│    - Playbooks from get_agent_guide()                        │
│                                                              │
│  SKILLS (NEW):                                               │
│    When the agent discovers a successful workflow:            │
│    1. Leader calls harness_log_entry({entryType: "skill",    │
│       content: JSON.stringify({name, trigger, steps})})      │
│    2. Next session Bootstrap loads skills from entries        │
│    3. Skills are injected into system prompt as:             │
│       "SKILLS DISPONIBLES: [name]: [steps]"                   │
│    4. Agent references skills instead of re-discovering      │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. IMPLEMENTATION SPECS (exact changes)

### SPEC 1: Add `tool_choice: "auto"` to all API calls

**File:** `src/components/ChatFAB.tsx`

**Leader chat loop (line ~1142):**
```typescript
// BEFORE:
body: JSON.stringify({ model: ..., messages: [...], max_tokens: 4096, tools: LEADER_TOOLS })

// AFTER:
body: JSON.stringify({ model: ..., messages: [...], max_tokens: 4096, tools: LEADER_TOOLS, tool_choice: "auto" })
```

**Same for Anthropic path (line ~1134):**
```typescript
// BEFORE:
body: JSON.stringify({ model: ..., max_tokens: 4096, system: systemPrompt, messages: conversation, tools: toolsForAnthropic(LEADER_TOOLS) })

// AFTER:
body: JSON.stringify({ model: ..., max_tokens: 4096, system: systemPrompt, messages: conversation, tools: toolsForAnthropic(LEADER_TOOLS), tool_choice: { type: "auto" } })
```

**Subagent OpenAI path (line ~904):**
```typescript
// BEFORE:
body: JSON.stringify({ model: ..., messages: [...], max_tokens: 4096, tools })

// AFTER:
body: JSON.stringify({ model: ..., messages: [...], max_tokens: 4096, tools, tool_choice: "auto" })
```

**Subagent Anthropic path (line ~896):**
```typescript
// BEFORE:
body: JSON.stringify({ model: ..., max_tokens: 4096, system: systemPrompt, messages: subConv, tools: toolsForAnthropic(tools) })

// AFTER:
body: JSON.stringify({ model: ..., max_tokens: 4096, system: systemPrompt, messages: subConv, tools: toolsForAnthropic(tools), tool_choice: { type: "auto" } })
```

---

### SPEC 2: Fake tool call detection for Leader

**File:** `src/components/ChatFAB.tsx`
**Location:** After line 1167 (after `if (toolCalls.length === 0)`)

```typescript
if (toolCalls.length === 0) {
  // ── NEW: Detect fake tool calls in text ──
  const TOOL_NAME_PATTERNS = /\b(create_template|create_html_template|set_html|set_css|harness_delegate|studio_create|studio_move|harness_complete|create_frame|delete_frame|render_html)\b/;
  const jsonBlockPattern = /\{\s*"tool"\s*:/i;
  const looksLikeToolCall = TOOL_NAME_PATTERNS.test(textContent) || jsonBlockPattern.test(textContent);
  
  if (looksLikeToolCall && round < 3) {
    // The model wrote tool names as text instead of using function calling.
    // Push a correction and continue the loop.
    conversation.push({ 
      role: "user", 
      content: "⚠️ Escribiste nombres de herramientas como texto en lugar de ejecutarlas. NO escribas 'create_template(...)' ni JSON con tools. Usa function calling real (tool_calls). Si necesitas crear un diseño, llama la herramienta create_html_template con tus tool_calls. Si no puedes usar herramientas en este momento, responde: 'Error: No puedo ejecutar herramientas. Verifica tu API key.'" 
    });
    continue;
  }
  
  if (textContent.trim()) setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
  break;
}
```

---

### SPEC 3: Conversation trimming

**File:** `src/components/ChatFAB.tsx`
**Location:** Inside the `send` function, before the API call loop (before line 1123)

```typescript
// ── NEW: Trim conversation to prevent context overflow ──
// Keep system message + last ~6K tokens worth of conversation
const MAX_CONVERSATION_MESSAGES = 20;
if (conversation.length > MAX_CONVERSATION_MESSAGES) {
  // Keep first 2 messages (greeting + first user input) + last 15
  conversation = [
    ...conversation.slice(0, 2),
    ...conversation.slice(-Math.min(15, MAX_CONVERSATION_MESSAGES - 2))
  ];
  // Insert context reminder so model doesn't lose track
  conversation.splice(2, 0, {
    role: "user",
    content: "[Conversación recortada para mantener contexto. Continúa donde estabas.]"
  });
}
```

**Same for subagent loop** (`spawnSubagent`, around line 888):
```typescript
// ── NEW: Trim subagent conversation ──
if (subConv.length > 15 && round > 3) {
  subConv = [
    subConv[0],  // First message (task instruction)
    { role: "user", content: "[Conversación recortada. Continúa tu tarea.]" },
    ...subConv.slice(-10)
  ];
}
```

---

### SPEC 4: Tool result parser (normalize MCP JSON)

**File:** `src/components/ChatFAB.tsx`
**Location:** New helper function, before `spawnSubagent`

```typescript
/**
 * Normalize MCP tool results before feeding back to the LLM.
 * 
 * MCP returns: { result: { content: [{ type: "text", text: "..." }] } }
 * We need: just the text, truncated if too long.
 * 
 * Without this, the model sees raw JSON wrappers as noise and
 * tool calling degrades after 2-3 rounds.
 */
function normalizeToolResult(raw: string, toolName: string): string {
  try {
    const parsed = JSON.parse(raw);
    
    // MCP format: { jsonrpc: "2.0", result: { content: [{ text: "..." }] } }
    const mcpText = parsed?.result?.content?.[0]?.text;
    if (mcpText) {
      // Try to parse the inner text as JSON too (nested MCP)
      try {
        const inner = JSON.parse(mcpText);
        // If it has id/templateId/etc, it's a meaningful object
        const summary = JSON.stringify(inner, null, 0);
        return summary.length > 2000 ? summary.slice(0, 1997) + "..." : summary;
      } catch {
        return mcpText.length > 2000 ? mcpText.slice(0, 1997) + "..." : mcpText;
      }
    }
    
    // Direct object (non-MCP wrapper)
    const direct = JSON.stringify(parsed);
    return direct.length > 2000 ? direct.slice(0, 1997) + "..." : direct;
  } catch {
    // Not JSON, return as-is truncated
    const str = String(raw);
    return str.length > 2000 ? str.slice(0, 1997) + "..." : str;
  }
}
```

**Usage in subagent loop** (replace line 955):
```typescript
// BEFORE:
const resultStr = await executeToolCall(tc.name, tc.args, signal);

// AFTER:
const rawResult = await executeToolCall(tc.name, tc.args, signal);
const resultStr = normalizeToolResult(rawResult, tc.name);
```

**Usage in Leader loop** (find the equivalent `executeToolCall` call):
```typescript
// Same pattern: normalize before pushing to conversation
const rawResult = await executeToolCall(tc.name, tc.args, signal);
const resultStr = normalizeToolResult(rawResult, tc.name);
```

---

### SPEC 5: Bootstrap layer (load memory before chat)

**File:** `src/components/ChatFAB.tsx`
**Location:** `buildSystemPrompt()` function (line 194) and `send()` function

**Step 1: Create async bootstrap function:**
```typescript
interface BootstrapContext {
  styles: Array<{ name: string; description?: string }>;
  recentTemplates: Array<{ id: string; name: string }>;
  previousSessions: Array<{ id: string; summary: string }>;
  skills: Array<{ name: string; trigger: string; steps: string }>;
  healthOk: boolean;
}

async function bootstrapSession(): Promise<BootstrapContext> {
  const ctx: BootstrapContext = {
    styles: [],
    recentTemplates: [],
    previousSessions: [],
    skills: [],
    healthOk: false,
  };
  
  try {
    // 1. Health check
    const health = await mcpCall("harness_healthcheck", {});
    ctx.healthOk = health?.ok === true;
    
    // 2. Load previous context
    if (currentContext.workspaceId) {
      const context = await mcpCall("harness_get_context", {
        agentType: "leader",
        workspaceId: currentContext.workspaceId,
      });
      if (context?.sessions) {
        ctx.previousSessions = context.sessions.slice(0, 3).map((s: any) => ({
          id: s.id,
          summary: s.summary || s.task_title || "Sin resumen",
        }));
      }
      
      // 3. Load active styles
      const styles = await mcpCall("get_active_styles", {
        workspaceId: currentContext.workspaceId,
      });
      if (Array.isArray(styles)) {
        ctx.styles = styles.slice(0, 20).map((s: any) => ({
          name: s.name || s.id,
          description: s.description || "",
        }));
      }
      
      // 4. Load recent templates
      const templates = await mcpCall("list_templates", {
        workspaceId: currentContext.workspaceId,
        limit: 5,
      });
      if (Array.isArray(templates)) {
        ctx.recentTemplates = templates.map((t: any) => ({
          id: t.id,
          name: t.name || "Sin nombre",
        }));
      }
      
      // 5. Load playbook if exists
      try {
        const playbook = await mcpCall("get_playbook", { name: "multi-agent" });
        if (playbook?.content) {
          ctx.skills.push({
            name: "multi-agent-playbook",
            trigger: "design tasks",
            steps: typeof playbook.content === "string" ? playbook.content.slice(0, 500) : JSON.stringify(playbook.content).slice(0, 500),
          });
        }
      } catch { /* playbook may not exist yet */ }
    }
  } catch (e) {
    console.warn("Bootstrap partial failure:", e);
  }
  
  return ctx;
}
```

**Step 2: Inject bootstrap into system prompt:**
```typescript
function buildSystemPrompt(bootstrap?: BootstrapContext): string {
  const ctxLines: string[] = [];
  
  if (currentContext.workspaceId) ctxLines.push(`- workspaceId actual: ${currentContext.workspaceId}`);
  if (currentContext.templateId) ctxLines.push(`- templateId abierto en editor: ${currentContext.templateId}`);
  
  // ── NEW: Inject bootstrap context ──
  if (bootstrap) {
    if (!bootstrap.healthOk) {
      ctxLines.push("⚠️ HEALTH CHECK FALLÓ. Verifica conexión con Supabase antes de continuar.");
    }
    if (bootstrap.styles.length > 0) {
      ctxLines.push(`ESTILOS GUARDADOS (${bootstrap.styles.length}):`);
      bootstrap.styles.forEach(s => ctxLines.push(`  - ${s.name}${s.description ? ": " + s.description : ""}`));
    }
    if (bootstrap.recentTemplates.length > 0) {
      ctxLines.push(`TEMPLATES RECIENTES:`);
      bootstrap.recentTemplates.forEach(t => ctxLines.push(`  - ${t.id}: ${t.name}`));
    }
    if (bootstrap.previousSessions.length > 0) {
      ctxLines.push("SESIONES PREVIAS (resumen):");
      bootstrap.previousSessions.forEach(s => ctxLines.push(`  - ${s.id}: ${s.summary}`));
    }
    if (bootstrap.skills.length > 0) {
      ctxLines.push("SKILLS CARGADOS:");
      bootstrap.skills.forEach(s => ctxLines.push(`  - ${s.name}: ${s.trigger} → ${s.steps}`));
    }
  }
  
  const block = ctxLines.length > 0 ? `## CONTEXTO ACTUAL\n${ctxLines.join('\n')}` : '';
  return HARNESS_SYSTEM_PROMPT.replace("{CURRENT_CONTEXT}", block);
}
```

**Step 3: Call bootstrap before first message:**
```typescript
// In the ChatFAB component, add state:
const [bootstrapCtx, setBootstrapCtx] = useState<BootstrapContext | null>(null);
const [bootstrapping, setBootstrapping] = useState(true);

// On mount or when workspaceId changes:
useEffect(() => {
  if (currentContext.workspaceId) {
    setBootstrapping(true);
    bootstrapSession().then(ctx => {
      setBootstrapCtx(ctx);
      setBootstrapping(false);
    });
  }
}, [currentContext.workspaceId]);

// Use in send():
const systemPrompt = buildSystemPrompt(bootstrapCtx ?? undefined);
```

---

### SPEC 6: Proactive context dump at 40%

**File:** `src/components/ChatFAB.tsx`
**Location:** Inside the Leader chat loop (`send()` function), before each API call

```typescript
// ── NEW: Proactive context dump when conversation grows ──
const estimatedTokens = JSON.stringify(conversation).length / 4; // rough estimate
const CONTEXT_DUMP_THRESHOLD = 4000; // ~40% of 10K practical limit

if (estimatedTokens > CONTEXT_DUMP_THRESHOLD && !contextDumped) {
  try {
    await mcpCall("harness_dump_context", {
      agentType: "leader",
      conversation: JSON.stringify(conversation.slice(-10)), // last 10 messages
      workspaceId: currentContext.workspaceId,
    });
    contextDumped = true;
  } catch { /* non-fatal */ }
}
```

---

### SPEC 7: Review step includes render + content audit

**File:** `src/components/ChatFAB.tsx`
**Location:** HARNESS_SYSTEM_PROMPT (line 141-143) and REVIEWER_PROMPT (line 560-602)

**Update HARNESS_SYSTEM_PROMPT step 5 (line 141):**
```
5. harness_delegate_task({ role: "reviewer", taskId: "<cardId>", instruction: 
   "Verifica C1-C5 con harness_evaluate_checkpoint. 
    ADEMÁS: llama render_html_template para obtener PNG de cómo se ve.
    ADEMÁS: llama harvest_text para extraer todo el texto del diseño.
    Compara el texto extraído contra la instrucción original: 
    ¿están todas las palabras? ¿hay placeholder o lorem ipsum?
    Reporta el renderUrl Y el texto extraído en tu resultado." })
```

**Update REVIEWER_PROMPT (add after line 581, before PASO 3):**
```
PASO 2.5 — Render visual y auditoría de contenido:
  - Llama render_html_template({ templateId }) → obtén renderUrl (PNG del diseño)
  - Llama harvest_text({ templateId }) → obtén todo el texto del diseño
  - Compara el texto extraído contra la instrucción original en {TASK_CONTEXT}:
    ¿Aparecen todas las palabras/frases solicitadas?
    ¿Hay texto placeholder ("lorem ipsum", "sample text", "contenido aquí")?
    ¿El texto está truncado o incompleto?
  - Si el diseño se ve bien en el render Y el texto coincide → C3 y C5 ganan más peso
  - Si el render muestra desbordamiento o texto cortado → C1 falla aunque las dimensiones sean correctas
```

---

## 4. EXPECTED BEHAVIOR AFTER ALL FIXES

### Happy path (user says "crea un post 1080x1080 que diga Hola")

```
1. BOOTSTRAP (silent, <2 seconds)
   ✓ Health check pasa
   ✓ Estilos cargados: Futuraria_SocialMedia, Polimi_Blue
   ✓ Templates recientes: tpl_xxx, tpl_yyy
   ✓ Skills cargados: multi-agent-playbook

2. LEADER (visible in chat)
   "Creando tarjeta Kanban..."
   ✓ studio_create_card → card_ms7a68sl
   ✓ studio_move_card → design
   ✓ harness_delegate_task → implementer

3. IMPLEMENTER (silent, 5-15 rounds)
   ✓ Detecta MODO A (nuevo diseño)
   ✓ create_html_template con HTML/CSS COMPLETO
   ✓ harness_submit_for_review
   → "done -> implementado"

4. REVIEWER (silent, 3-5 rounds)
   ✓ get_template → verifica estructura
   ✓ get_frame → verifica contenido
   ✓ render_html_template → PNG generado
   ✓ harvest_text → "Hola" encontrado, sin placeholder
   ✓ harness_evaluate_checkpoint C1-C5 → todos pass
   → "APPROVED"

5. LEADER (visible in chat)
   "¡Listo! El diseño pasó todos los checks."
   ✓ studio_move_card → done
   ✓ Comparte link editor + link render PNG
```

### Sad path (fake tool call detected)

```
1. LEADER calls API
2. Model responds with text: "Voy a crear el template con create_template..."
3. Fake tool call detection triggers (SPEC 2)
4. Conversation gets correction message
5. Model retries with actual tool_calls
6. Success OR second detection → reports error to human
```

### Context overflow path

```
1. Conversation reaches 20+ messages
2. Trimming kicks in (SPEC 3)
3. Old messages removed, context reminder inserted
4. Context dump to Supabase (SPEC 6)
5. Conversation continues with fresh context
```

---

## 5. FILES TO MODIFY (in order)

| # | File | Change | Lines |
|---|------|--------|:-----:|
| 1 | `src/components/ChatFAB.tsx` | SPEC 4: Add `normalizeToolResult()` | NEW |
| 2 | `src/components/ChatFAB.tsx` | SPEC 1: Add `tool_choice: "auto"` | 1142, 904, 1134, 896 |
| 3 | `src/components/ChatFAB.tsx` | SPEC 2: Add fake tool call detection | after 1167 |
| 4 | `src/components/ChatFAB.tsx` | SPEC 3: Add conversation trimming | before 1123, in spawnSubagent |
| 5 | `src/components/ChatFAB.tsx` | SPEC 5: Add bootstrap layer | buildSystemPrompt + new function |
| 6 | `src/components/ChatFAB.tsx` | SPEC 6: Add proactive context dump | inside send() loop |
| 7 | `src/components/ChatFAB.tsx` | SPEC 7: Update reviewer instructions | 141-143, 581+ |
| 8 | `src/components/ChatFAB.tsx` | SPEC 4: Wire normalizeToolResult | 955 + Leader equivalent |
| 9 | `AGENTS.md` | Update: step 0 from "OPCIONAL" to "OBLIGATORIO" | line 16 |

---

## 6. VERIFICATION CHECKLIST

After implementation, verify:

- [ ] Leader uses tools immediately, never writes tool names as text
- [ ] Subagents use tools immediately, never write tool names as text
- [ ] Bootstrap runs on chat open, shows styles/templates in context
- [ ] Conversations longer than 20 messages don't degrade
- [ ] Tool results are clean, not raw JSON
- [ ] Reviewer generates PNG render and checks content text
- [ ] Context dumps to Supabase when conversation grows
- [ ] Memory persists across sessions (styles remembered, templates recognized)
- [ ] Fake tool calls are detected and retried
