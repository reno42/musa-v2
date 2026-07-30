import { useState, useRef, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";

/**
 * ChatFAB — global floating chat button + right-side panel.
 * Available everywhere: Dashboard, EditorV2, Kanban, Graph, Settings, Workspace.
 *
 * Click the 💬 FAB → right panel slides in with accordion sections.
 * Close it → content goes full-width. Responsive.
 *
 * Two modes (Qoder-style):
 *   agent — the AI acts as the Harness leader, orchestrating via MCP tools
 *   act   — the AI directly executes MCP tools (no orchestration, fire-and-apply)
 */

type Role = "user" | "assistant" | "system";
type ChatMode = "agent" | "act";
interface Message { role: Role; content: string; ts?: number }

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", endpoint: "https://api.openai.com/v1/chat/completions", keyPrefix: "sk-", keyEnv: "VITE_OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-sonnet-20241022", endpoint: "https://api.anthropic.com/v1/messages", keyPrefix: "sk-ant-", keyEnv: "VITE_ANTHROPIC_API_KEY" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "anthropic/claude-3.5-sonnet", endpoint: "https://openrouter.ai/api/v1/chat/completions", keyPrefix: "sk-or-", keyEnv: "VITE_OPENROUTER_API_KEY" },
] as const;

const LS_PROVIDER_KEY = "futuraria-chat-provider";
const LS_LLM_KEY_KEY = "futuraria-chat-llm-key";
const LS_MODEL_KEY = "futuraria-chat-model";
const LS_MODE_KEY = "futuraria-chat-mode";

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

const ACT_SYSTEM_PROMPT = `Eres un agente de acción directa de Futuraria Design. Modo ACT: ejecutas herramientas MCP directamente sin orquestación.

Herramientas MCP disponibles (POST https://design.futuraria.com/mcp con header x-api-key):
- Todas las tools de diseño: set_html, set_css, create_frame, update_frame, delete_frame, lint_design, render_frame, export_design, etc.
- studio_create_card, studio_list_cards, studio_move_card, studio_get_card — Kanban
- comment_add, comment_list, comment_resolve — comentarios en el diseño

Responde siempre ejecutando las herramientas necesarias. Sé conciso. Si no sabes algo, dilo.`;

const HARNESS_TOOLS = [
  { type: "function", function: { name: "harness_healthcheck", description: "Verifica que el entorno del harness está listo (MCP, Supabase, tablas, lint).", parameters: { type: "object", properties: { templateId: { type: "string", description: "Opcional: ID del template para verificar diseño" } } } } },
  { type: "function", function: { name: "harness_list_features", description: "Lista las tareas del Kanban filtradas por estado.", parameters: { type: "object", properties: { status: { type: "string", enum: ["backlog", "draft", "design", "review", "done", "feedback"] } } } } },
  { type: "function", function: { name: "harness_claim_feature", description: "Toma una tarea (pasa a draft/in_progress). Falla si ya hay otra activa.", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, assignedTo: { type: "string" } } } } },
  { type: "function", function: { name: "harness_start_session", description: "Inicia una sesión de subagente con rol y plan.", parameters: { type: "object", required: ["taskId", "role"], properties: { taskId: { type: "string" }, role: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] }, plan: { type: "string" } } } } },
  { type: "function", function: { name: "harness_log_entry", description: "Anota un evento en la bitácora de la sesión.", parameters: { type: "object", required: ["sessionId", "content"], properties: { sessionId: { type: "string" }, entryType: { type: "string", enum: ["plan", "progress", "blocker", "decision", "note", "dump"] }, content: { type: "string" } } } } },
  { type: "function", function: { name: "harness_submit_for_review", description: "Implementer pide review. Status pasa a review.", parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" }, summary: { type: "string" } } } } },
  { type: "function", function: { name: "harness_evaluate_checkpoint", description: "Reviewer evalúa un checkpoint C1-C5 con passed true/false.", parameters: { type: "object", required: ["taskId", "checkpointId", "passed"], properties: { taskId: { type: "string" }, checkpointId: { type: "string", description: "ej: C1, C2" }, description: { type: "string" }, passed: { type: "boolean" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "harness_complete_feature", description: "Marca una tarea como done.", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } } },
];

/** Convert OpenAI tool schema to Anthropic format */
const toolsForAnthropic = () => HARNESS_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

async function executeToolCall(name: string, args: Record<string, any>): Promise<string> {
  try {
    const result = await mcpCall(name, args);
    return JSON.stringify(result, null, 2).slice(0, 4000);
  } catch (e: any) {
    return JSON.stringify({ error: e?.message || "tool call failed" });
  }
}

interface ToolEvent { tool: string; status: "running" | "done" | "error"; result?: string }

const inputBase: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e0e0e0",
  outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

export function ChatFAB() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>(() => {
    try { return (localStorage.getItem(LS_MODE_KEY) || "agent") as ChatMode; } catch { return "agent"; }
  });
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hola. Soy el leader del harness. ¿Qué necesitas que haga hoy?", ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
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
  const [accordion, setAccordion] = useState<"config" | "chat" | "tools" | null>("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist
  useEffect(() => { try { localStorage.setItem(LS_PROVIDER_KEY, provider); } catch {} }, [provider]);
  useEffect(() => { try { localStorage.setItem(LS_LLM_KEY_KEY, llmKey); } catch {} }, [llmKey]);
  useEffect(() => { try { localStorage.setItem(LS_MODEL_KEY, model); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem(LS_MODE_KEY, mode); } catch {} }, [mode]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, toolEvents]);

  // Reset messages when switching mode
  useEffect(() => {
    setMessages([{ role: "assistant", content: mode === "agent" ? "Hola. Soy el leader del harness. ¿Qué necesitas que haga hoy?" : "Modo ACT activado. Dime qué acción ejecutar.", ts: Date.now() }]);
  }, [mode]);

  const systemPrompt = mode === "agent" ? HARNESS_SYSTEM_PROMPT : ACT_SYSTEM_PROMPT;

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    if (!llmKey) { setShowSettings(true); setAccordion("config"); return; }

    const userMsg: Message = { role: "user", content: input.trim(), ts: Date.now() };
    let conversation: any[] = [...messages.filter(m => m.role !== "system"), userMsg].map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setToolEvents([]);

    const prov = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0];
    const isAnthropic = provider === "anthropic";
    const MAX_TOOL_ROUNDS = mode === "agent" ? 6 : 3;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let data: any;

        if (isAnthropic) {
          const resp = await fetch(prov.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": llmKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
            body: JSON.stringify({ model: model || prov.defaultModel, max_tokens: 4096, system: systemPrompt, messages: conversation, tools: toolsForAnthropic() }),
          });
          if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
          data = await resp.json();
        } else {
          const resp = await fetch(prov.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmKey}` },
            body: JSON.stringify({ model: model || prov.defaultModel, messages: [{ role: "system", content: systemPrompt }, ...conversation], max_tokens: 4096, tools: mode === "agent" ? HARNESS_TOOLS : undefined }),
          });
          if (!resp.ok) throw new Error(`${prov.label} ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
          data = await resp.json();
        }

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

        if (toolCalls.length === 0) {
          if (textContent.trim()) setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
          break;
        }

        if (isAnthropic) { conversation.push(data.content); }
        else { conversation.push(data.choices[0].message); }

        for (const tc of toolCalls) {
          setToolEvents(prev => [...prev, { tool: tc.name, status: "running" }]);
          setAccordion("tools");
          const resultStr = await executeToolCall(tc.name, tc.args);
          setToolEvents(prev => prev.map((e, i) => i === prev.length - 1 ? { ...e, status: resultStr.includes('"error"') ? "error" as const : "done", result: resultStr.slice(0, 200) } : e));

          if (isAnthropic) { conversation.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tc.id, content: resultStr }] }); }
          else { conversation.push({ role: "tool", tool_call_id: tc.id, content: resultStr }); }
        }

        if (round === MAX_TOOL_ROUNDS) {
          setMessages(prev => [...prev, { role: "assistant", content: textContent.trim() || "(límite de iteraciones alcanzado — revisa el Kanban)", ts: Date.now() }]);
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e?.message || "no se pudo contactar al proveedor"}. Verifica tu API key.`, ts: Date.now() }]);
    } finally {
      setSending(false);
      setToolEvents([]);
    }
  }, [input, sending, llmKey, messages, model, provider, mode, systemPrompt]);

  const panelWidth = 420;

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Abrir chat (leader / ACT)"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9100,
            width: 52, height: 52, borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(108,92,231,0.85), rgba(167,139,250,0.85))",
            border: "1px solid rgba(167,139,250,0.4)",
            boxShadow: "0 4px 24px rgba(108,92,231,0.35)",
            color: "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, transition: "all 0.2s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 6px 32px rgba(108,92,231,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(108,92,231,0.35)"; }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Slide-in panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9050,
        width: open ? panelWidth : 0,
        background: "rgba(10,10,15,0.97)",
        borderLeft: open ? "1px solid rgba(255,255,255,0.08)" : "none",
        backdropFilter: "blur(16px)",
        display: "flex", flexDirection: "column",
        transition: "width 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#a78bfa" }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)", flex: 1 }}>Chat</span>

          {/* Mode toggle */}
          <div style={{
            display: "flex", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 2, gap: 2,
          }}>
            {(["agent", "act"] as ChatMode[]).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)} style={{
                padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                background: mode === m ? "rgba(108,92,231,0.35)" : "transparent",
                color: mode === m ? "#c4b5fd" : "rgba(255,255,255,0.3)",
                transition: "all 0.15s",
              }}>{m === "agent" ? "Agent" : "Act"}</button>
            ))}
          </div>

          <button type="button" onClick={() => setOpen(false)} style={{
            background: "rgba(255,255,255,0.05)", border: "none", color: "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 16, borderRadius: 8, padding: "4px 10px", fontFamily: "inherit",
          }}>✕</button>
        </div>

        {/* Accordion: Config */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
          <button type="button" onClick={() => setAccordion(a => a === "config" ? null : "config")} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 18px",
            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
            color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600,
          }}>
            <span style={{ fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: accordion === "config" ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</span>
            Configuración
            <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: llmKey ? "#34d399" : "#f87171" }} />
          </button>
          {accordion === "config" && (
            <div style={{ padding: "0 18px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <select value={provider} onChange={e => { setProvider(e.target.value); const p = PROVIDERS.find(x => x.id === e.target.value); if (p) setModel(p.defaultModel); }} style={{ ...inputBase, width: "100%", padding: "6px 12px", fontSize: 11 }}>
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={model} onChange={e => setModel(e.target.value)} placeholder="modelo" style={{ ...inputBase, padding: "6px 12px", fontSize: 11 }} />
              <input type="password" value={llmKey} onChange={e => setLlmKey(e.target.value)} placeholder={`${PROVIDERS.find(p => p.id === provider)?.keyPrefix || "sk-"}... API key`} style={{ ...inputBase, padding: "6px 12px", fontSize: 11, fontFamily: "monospace" }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Guardado en tu navegador. Se envía directo al proveedor LLM.</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: "auto", padding: "14px 18px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "rgba(108,92,231,0.18)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${m.role === "user" ? "rgba(108,92,231,0.3)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 12, padding: "10px 14px",
              fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.85)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{m.content}</div>
          ))}
          {sending && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
              {toolEvents.length > 0 ? "ejecutando…" : "pensando…"}
            </div>
          )}
        </div>

        {/* Tool events (inline) */}
        {toolEvents.length > 0 && (
          <div style={{ padding: "8px 18px", borderTop: "1px solid rgba(255,255,255,0.04)", maxHeight: 120, overflowY: "auto", flexShrink: 0 }}>
            {toolEvents.map((ev, i) => (
              <div key={i} style={{ fontSize: 10, fontFamily: "monospace", color: ev.status === "done" ? "#6ee7b7" : ev.status === "error" ? "#fca5a5" : "rgba(255,255,255,0.4)", display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}>
                <span>{ev.status === "done" ? "✓" : ev.status === "error" ? "✕" : "⏳"}</span>
                <span style={{ fontWeight: 600 }}>{ev.tool}</span>
                {ev.result && <span style={{ color: "rgba(255,255,255,0.2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{ev.result}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={llmKey ? (mode === "agent" ? "Pídele algo al leader…" : "Describe la acción…") : "Configura tu API key ↑"}
              disabled={sending}
              style={{ ...inputBase, flex: 1, padding: "8px 12px", fontSize: 12.5 }}
            />
            <button type="button" onClick={send} disabled={!input.trim() || sending || !llmKey} style={{
              background: input.trim() && !sending && llmKey ? "rgba(108,92,231,0.25)" : "rgba(255,255,255,0.04)",
              color: input.trim() && !sending && llmKey ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
              border: `1px solid ${input.trim() && !sending && llmKey ? "rgba(108,92,231,0.4)" : "rgba(255,255,255,0.05)"}`,
              borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: input.trim() && !sending && llmKey ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}>Enviar</button>
          </div>
        </div>
      </div>
    </>
  );
}
