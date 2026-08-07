import { useState, useRef, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";
import { LLM_MAX_TOKENS } from "../lib/agentRuntime";

/**
 * ChatTab — accordion-style chat that talks to the user's LLM (OpenAI/Anthropic/OpenRouter).
 *
 * The user pastes their LLM API key in Settings (stored locally, never sent
 * anywhere except directly to the provider). The chat sends a system prompt
 * that bootstraps the model as the "leader" of the Futuraria harness, giving
 * it the AGENTS.md context and the list of harness_* MCP tools.
 *
 * The leader then decides: claim a task, run subagents (itself switching
 * context), submit for review, complete.
 *
 * The accordion lets the user collapse the chat when not needed.
 */

type Role = "user" | "assistant" | "system";
interface Message { role: Role; content: string; ts?: number }

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", endpoint: "https://api.openai.com/v1/chat/completions", keyPrefix: "sk-", keyEnv: "VITE_OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-sonnet-20241022", endpoint: "https://api.anthropic.com/v1/messages", keyPrefix: "sk-ant-", keyEnv: "VITE_ANTHROPIC_API_KEY" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "anthropic/claude-3.5-sonnet", endpoint: "https://openrouter.ai/api/v1/chat/completions", keyPrefix: "sk-or-", keyEnv: "VITE_OPENROUTER_API_KEY" },
] as const;

const LS_PROVIDER_KEY = "futuraria-chat-provider";
const LS_LLM_KEY_KEY = "futuraria-chat-llm-key";
const LS_MODEL_KEY = "futuraria-chat-model";
const LS_COLLAPSED_KEY = "futuraria-chat-collapsed";

const HARNESS_SYSTEM_PROMPT = `Eres el leader del harness de Futuraria Design.

Tu trabajo: recibir pedidos del humano, descomponerlos en tareas del Kanban, y orquestar implementers y reviewers via MCP.

PRINCIPIO CRÍTICO: Cuando tu contexto se llene (>40%), llama a harness_dump_context para vaciarlo a la base de datos. El siguiente turno lo recuperas via harness_get_context.

Herramientas MCP disponibles (POST https://design.futuraria.com/mcp con header x-api-key):
- harness_healthcheck() — verifica entorno
- harness_get_context({ agentType }) — bootstrap tu rol
- harness_list_features({ status: "backlog" }) — ver tareas pendientes
- harness_claim_feature({ taskId }) — tomar una tarea
- harness_start_session({ taskId, role, plan }) — iniciar sesión de subagente
- harness_log_entry({ sessionId, entryType, content }) — bitácora
- harness_dump_context({ sessionId, content }) — extraer memoria
- harness_get_entries({ sessionId }) — leer bitácora
- harness_submit_for_review({ sessionId, summary }) — pedir review
- harness_evaluate_checkpoint({ taskId, checkpointId, description, passed }) — evaluar
- harness_complete_feature({ taskId }) — marcar done
- studio_create_card, studio_list_cards, studio_move_card, studio_get_card — manejo Kanban
- Y todas las tools de diseño (set_html, set_css, create_frame, lint_design, etc.) listadas en SKILL.md

PROTOCOLO:
1. Saluda brevemente y pregunta qué necesita el humano.
2. Si el humano describe una tarea, créala con studio_create_card (con acceptance criteria).
3. Luego reclámala con harness_claim_feature.
4. Trabájala usando las tools de diseño del MCP.
5. Pide review con harness_submit_for_review.
6. Auto-revisa con harness_evaluate_checkpoint.
7. Marca done con harness_complete_feature.

No hagas TODO en una respuesta. Divide en pasos. Si el humano pide algo complejo, propón un plan primero.

Las respuestas al humano deben ser concisas. El detalle va a harness_entries, no al chat.`;

/** Tool definitions so the model can invoke MCP tools directly from chat.
 *  OpenAI-style schema; converted for Anthropic at call time. */
const HARNESS_TOOLS = [
  { type: "function", function: {
    name: "harness_healthcheck", description: "Verifica que el entorno del harness está listo (MCP, Supabase, tablas, lint).",
    parameters: { type: "object", properties: { templateId: { type: "string", description: "Opcional: ID del template para verificar diseño" } } } } },
  { type: "function", function: {
    name: "harness_list_features", description: "Lista las tareas del Kanban filtradas por estado. Cada una trae acceptance criteria.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["backlog", "draft", "design", "review", "done", "feedback"] } } } } },
  { type: "function", function: {
    name: "harness_claim_feature", description: "Toma una tarea (pasa a draft/in_progress). Falla si ya hay otra activa.",
    parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, assignedTo: { type: "string" } } } } },
  { type: "function", function: {
    name: "harness_start_session", description: "Inicia una sesión de subagente con rol y plan. Devuelve context_summary pre-armado.",
    parameters: { type: "object", required: ["taskId", "role"], properties: { taskId: { type: "string" }, role: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] }, plan: { type: "string" } } } } },
  { type: "function", function: {
    name: "harness_log_entry", description: "Anota un evento en la bitácora de la sesión (plan, progress, blocker, decision, etc).",
    parameters: { type: "object", required: ["sessionId", "content"], properties: { sessionId: { type: "string" }, entryType: { type: "string", enum: ["plan", "progress", "blocker", "decision", "note", "dump"] }, content: { type: "string" } } } } },
  { type: "function", function: {
    name: "harness_submit_for_review", description: "Implementer pide review. Status pasa a review.",
    parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" }, summary: { type: "string" } } } } },
  { type: "function", function: {
    name: "harness_evaluate_checkpoint", description: "Reviewer evalúa un checkpoint C1-C5 con passed true/false y notas.",
    parameters: { type: "object", required: ["taskId", "checkpointId", "passed"], properties: { taskId: { type: "string" }, checkpointId: { type: "string", description: "ej: C1, C2, C2_item_1" }, description: { type: "string" }, passed: { type: "boolean" }, notes: { type: "string" } } } } },
  { type: "function", function: {
    name: "harness_complete_feature", description: "Marca una tarea como done. Falla si algún checkpoint está en false o no se evaluó.",
    parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } } },
];

/** Convert OpenAI tool schema → Anthropic format at call time */
const toolsForAnthropic = () => HARNESS_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

/** Execute an MCP tool call from the browser and return the result string */
async function executeToolCall(name: string, args: Record<string, any>): Promise<string> {
  try {
    const result = await mcpCall(name, args);
    return JSON.stringify(result, null, 2).slice(0, 4000);
  } catch (e: any) {
    return JSON.stringify({ error: e?.message || "tool call failed" });
  }
}

interface ToolEvent { tool: string; status: "running" | "done" | "error"; result?: string }

interface Props {
  workspaceId: string;
  /** Account's fdr_ws_ key used for MCP auth */
  mcpApiKey?: string;
}

export function ChatTab({ workspaceId, mcpApiKey }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hola. Soy el leader del harness. ¿Qué necesitas que haga hoy?", ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const [provider, setProvider] = useState<string>(() => {
    try { return localStorage.getItem(LS_PROVIDER_KEY) || "openai"; } catch { return "openai"; }
  });
  const [llmKey, setLlmKey] = useState<string>(() => {
    try { return localStorage.getItem(LS_LLM_KEY_KEY) || ""; } catch { return ""; }
  });
  const [model, setModel] = useState<string>(() => {
    try { return localStorage.getItem(LS_MODEL_KEY) || PROVIDERS[0].defaultModel; } catch { return PROVIDERS[0].defaultModel; }
  });
  const [showSettings, setShowSettings] = useState(!llmKey);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist
  useEffect(() => { try { localStorage.setItem(LS_PROVIDER_KEY, provider); } catch {} }, [provider]);
  useEffect(() => { try { localStorage.setItem(LS_LLM_KEY_KEY, llmKey); } catch {} }, [llmKey]);
  useEffect(() => { try { localStorage.setItem(LS_MODEL_KEY, model); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem(LS_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {} }, [collapsed]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, collapsed, toolEvents]);

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    if (!llmKey) { setShowSettings(true); return; }

    const userMsg: Message = { role: "user", content: input.trim(), ts: Date.now() };
    // conversation holds ALL messages for the API (including tool results)
    let conversation: any[] = [...messages.filter(m => m.role !== "system"), userMsg].map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setToolEvents([]);

    const prov = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0];
    const isAnthropic = provider === "anthropic";
    const MAX_TOOL_ROUNDS = 6;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let data: any;

        if (isAnthropic) {
          const resp = await fetch(prov.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": llmKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
              model: model || prov.defaultModel,
              max_tokens: LLM_MAX_TOKENS,
              system: HARNESS_SYSTEM_PROMPT,
              messages: conversation,
              tools: toolsForAnthropic(),
            }),
          });
          if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
          data = await resp.json();
        } else {
          const resp = await fetch(prov.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${llmKey}`,
            },
            body: JSON.stringify({
              model: model || prov.defaultModel,
              messages: [{ role: "system", content: HARNESS_SYSTEM_PROMPT }, ...conversation],
              max_tokens: LLM_MAX_TOKENS,
              tools: HARNESS_TOOLS,
            }),
          });
          if (!resp.ok) throw new Error(`${prov.label} ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
          data = await resp.json();
        }

        // ── Extract text content + tool calls ──
        let textContent = "";
        let toolCalls: { id: string; name: string; args: any }[] = [];

        if (isAnthropic) {
          for (const block of data?.content || []) {
            if (block.type === "text") textContent += block.text;
            else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
          }
        } else {
          const msg = data?.choices?.[0]?.message;
          if (msg) {
            textContent = msg.content || "";
            for (const tc of msg.tool_calls || []) {
              try { toolCalls.push({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") }); }
              catch { toolCalls.push({ id: tc.id, name: tc.function.name, args: {} }); }
            }
          }
        }

        // If no tool calls, we're done — emit the text response
        if (toolCalls.length === 0) {
          if (textContent.trim()) {
            setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
          }
          break;
        }

        // ── Execute tool calls ──
        // Add the assistant message (with tool calls) to conversation
        if (isAnthropic) {
          conversation.push(data.content); // raw Anthropic content blocks
        } else {
          conversation.push(data.choices[0].message);
        }

        for (const tc of toolCalls) {
          setToolEvents(prev => [...prev, { tool: tc.name, status: "running" }]);
          const resultStr = await executeToolCall(tc.name, tc.args);
          setToolEvents(prev => prev.map((e, i) =>
            i === prev.length - 1 ? { ...e, status: "done", result: resultStr.slice(0, 200) } : e
          ));

          if (isAnthropic) {
            conversation.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tc.id, content: resultStr }] });
          } else {
            conversation.push({ role: "tool", tool_call_id: tc.id, content: resultStr });
          }
        }

        // On the last allowed round, force a text summary
        if (round === MAX_TOOL_ROUNDS) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: textContent.trim() || "(límite de iteraciones alcanzado — revisa el Kanban para ver el estado actual)",
            ts: Date.now(),
          }]);
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `⚠️ Error: ${e?.message || "no se pudo contactar al proveedor"}. Verifica tu API key en el botón ⚙ de arriba.`,
        ts: Date.now(),
      }]);
    } finally {
      setSending(false);
      setToolEvents([]);
    }
  }, [input, sending, llmKey, messages, model, provider]);

  const inputBase: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e0e0e0",
    outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header with accordion toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "12px 20px",
        borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.05)",
      }}>
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          style={{
            background: "transparent", border: "none", color: "rgba(255,255,255,0.5)",
            cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6,
            fontFamily: "inherit", padding: 0,
          }}>
          <span style={{ fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Chat
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {!collapsed && (
            <>
              <select
                value={provider}
                onChange={e => {
                  const newProv = e.target.value;
                  setProvider(newProv);
                  const p = PROVIDERS.find(x => x.id === newProv);
                  if (p) setModel(p.defaultModel);
                }}
                style={{ ...inputBase, width: "auto", padding: "4px 10px", fontSize: 11 }}
                title="Proveedor de LLM"
              >
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="modelo"
                style={{ ...inputBase, width: 160, padding: "4px 10px", fontSize: 11 }}
                title="Modelo (ej: gpt-4o-mini)"
              />
              <button
                type="button"
                onClick={() => setShowSettings(s => !s)}
                title="Configurar API key"
                style={{
                  background: llmKey ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
                  border: `1px solid ${llmKey ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                  borderRadius: 8, padding: "5px 10px", color: llmKey ? "#6ee7b7" : "#fca5a5",
                  cursor: "pointer", fontFamily: "inherit", fontSize: 11,
                }}>
                {llmKey ? "✓ Key" : "⚠ Key"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Settings panel (when shown and not collapsed) */}
      {!collapsed && showSettings && (
        <div style={{
          padding: "12px 20px", background: "rgba(255,255,255,0.02)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        }}>
          <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>LLM API key ({provider}):</label>
          <input
            type="password"
            value={llmKey}
            onChange={e => setLlmKey(e.target.value)}
            placeholder={(() => { const p = PROVIDERS.find(x => x.id === provider); return p ? `${p.keyPrefix}...` : "API key"; })()}
            style={{ ...inputBase, flex: 1, minWidth: 200, fontFamily: "monospace", fontSize: 11 }}
          />
          <button
            type="button"
            onClick={() => setShowSettings(false)}
            disabled={!llmKey}
            style={{
              background: "rgba(108,92,231,0.18)", border: "1px solid rgba(108,92,231,0.3)",
              borderRadius: 8, padding: "6px 14px", color: "rgba(255,255,255,0.8)",
              cursor: llmKey ? "pointer" : "not-allowed", fontFamily: "inherit", fontSize: 11,
            }}>
            Guardar
          </button>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", width: "100%" }}>
            Se guarda solo en tu navegador (localStorage). Se envía directamente al proveedor del LLM.
          </span>
        </div>
      )}

      {/* Collapsed banner */}
      {collapsed && (
        <div style={{ padding: "16px 20px", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
          Chat colapsado.{" "}
          <button type="button" onClick={() => setCollapsed(false)} style={{
            background: "none", border: "none", color: "#a78bfa", cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, padding: 0, textDecoration: "underline",
          }}>Mostrar</button>
        </div>
      )}

      {/* Messages + Input */}
      {!collapsed && (
        <>
          <div ref={scrollRef} style={{
            flex: 1, overflowY: "auto", padding: "16px 20px",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background: m.role === "user" ? "rgba(108,92,231,0.18)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${m.role === "user" ? "rgba(108,92,231,0.3)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 12, padding: "10px 14px",
                fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.85)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.content}
              </div>
            ))}
            {toolEvents.length > 0 && toolEvents.map((ev, i) => (
              <div key={`tool-${i}`} style={{
                alignSelf: "flex-start", fontSize: 11, fontFamily: "monospace",
                color: ev.status === "done" ? "#6ee7b7" : "rgba(255,255,255,0.4)",
                background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "4px 10px",
                display: "flex", alignItems: "center", gap: 6, maxWidth: "80%",
              }}>
                <span>{ev.status === "done" ? "✓" : "⏳"}</span>
                <span style={{ fontWeight: 600 }}>{ev.tool}</span>
                {ev.result && <span style={{ color: "rgba(255,255,255,0.25)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.result.slice(0, 80)}</span>}
              </div>
            ))}
            {sending && (
              <div style={{ alignSelf: "flex-start", fontSize: 12, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
                {toolEvents.length > 0 ? "ejecutando herramientas…" : "…pensando"}
              </div>
            )}
          </div>

          <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={llmKey ? "Escribe tu pedido al leader…" : "Configura tu API key arriba primero"}
                disabled={sending}
                style={{ ...inputBase, flex: 1 }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || sending || !llmKey}
                style={{
                  background: input.trim() && !sending && llmKey ? "rgba(108,92,231,0.25)" : "rgba(255,255,255,0.04)",
                  color: input.trim() && !sending && llmKey ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
                  border: `1px solid ${input.trim() && !sending && llmKey ? "rgba(108,92,231,0.4)" : "rgba(255,255,255,0.05)"}`,
                  borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600,
                  cursor: input.trim() && !sending && llmKey ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                }}>
                Enviar
              </button>
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>
              El leader tiene acceso a MCP ({workspaceId}). Verifica que tu cuenta tenga una API key en Configuración.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
