import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { mcpCall } from "../lib/mcpClient";
import { useAuth } from "../lib/auth";

/** REQ-047 «Conecta tu IA» — página pública en #connect.
 *
 *  El onboarding del agente externo: emitir un token del workspace con scopes
 *  (paso 1), copiar el snippet de su cliente MCP (paso 2), probar la conexión
 *  con ese token (paso 3) y quedarse con el loop de operación: bandeja de
 *  tareas IA (paso 4), despertar por webhook firmado (paso 5) y los prompts
 *  sistema/cron listos para pegar (paso 6).
 *
 *  Pública como #agents: un dueño de workspace medio dormido y un agente sin
 *  sesión tienen que poder leerla siempre. Emitir/revocar exige sesión de
 *  admin del workspace (la API lo exige igual: requireWorkspaceRole("admin")). */

const SITE = typeof window !== "undefined" ? window.location.origin : "";
const MCP_URL = `${SITE}/mcp`;

// ── Presets de scopes (paso 1). Vacío = sin límites (compat: como hasta hoy). ──
type PresetId = "agente" | "atendedor" | "libre";
const PRESETS: { id: PresetId; name: string; desc: string; scopes: string[] }[] = [
  {
    id: "agente",
    name: "Agente de diseño",
    desc: "Lee, guarda y ejecuta flows; crea y edita piezas. El recomendado para un agente que trabaja solo en Musa.",
    scopes: ["flows:read", "flows:write", "flows:resume", "assets:read", "assets:write"],
  },
  {
    id: "atendedor",
    name: "Atendedor de tareas",
    desc: "Solo ve la bandeja de tareas IA y las resuelve (flow_ai_tasks / flow_ai_complete). No puede tocar flows ni piezas.",
    scopes: ["flows:read", "flows:resume"],
  },
  {
    id: "libre",
    name: "Sin límites",
    desc: "Acceso completo al workspace, como los tokens que ya tenías. Usalo solo con agentes de tu confianza.",
    scopes: [],
  },
];

type ApiKeyRow = { id: string; label: string; key_prefix: string; role: string; kind: string; scopes?: string[] | null; created_at: string };
type AiTask = { runId: string; flowId: string; flowName: string; nodeLabel?: string; title: string; resumeToken: string; expiresAt?: string | null; startedAt: string; staleMinutes: number; message?: string };
type WakeCfg = { enabled: boolean; url: string | null; secretHint: string | null };

const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: "14px 16px", display: "grid", gap: 10 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, color: "#fff", outline: "none" };
const btnBase: React.CSSProperties = { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.85)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };

function CopyBtn({ text, small }: { text: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copiar al portapapeles"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        }).catch(() => {});
      }}
      style={{ ...btnBase, padding: small ? "3px 9px" : "6px 11px", fontSize: small ? 10.5 : 11.5, ...(done ? { borderColor: "rgba(74,222,128,0.6)", color: "#4ade80" } : {}) }}
    >
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <pre style={{ margin: 0, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 13px", fontSize: 11.5, lineHeight: 1.55, color: "rgba(255,255,255,0.82)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{code}</pre>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><CopyBtn text={code} small /></div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...cardStyle, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 999, background: "rgba(129,140,248,0.2)", border: "1px solid rgba(129,140,248,0.5)", color: "#c7d2fe", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function minutesLeft(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000));
}

const SYSTEM_PROMPT = `Sos el agente de diseño de Futuraria, conectado a Musa por MCP (HTTP streamable, JSON-RPC 2.0).

Reglas de operación:
1. Descubrí el workspace con flow_list (tu token ya está atado a un workspace: no podés ver otros).
2. Para ejecutar un flow: flow_run { flowId }. Seguí el progreso con flow_history { flowId, limit }.
3. Cuando un run quede en status "waiting", hay una tarea esperándote: flow_ai_tasks te da title, message (el briefing) y resumeToken. Atendé primero las de staleMinutes más alto.
4. Entregá el trabajo con flow_ai_complete { runId, resumeToken, ok, payload }: payload ES la salida del nodo (lote de textos → payload:{copys:[...]}; el server valida la forma).
5. Cada tarea tiene expiresAt: si pasa, el run expira solo (WAIT_EXPIRED, sin costo) y hay que volver a lanzar el flow. No dejes tareas sin atender.
6. Si una herramienta responde SCOPE_DENIED, tu token no tiene ese alcance: avisale al dueño del workspace en vez de insistir.
7. Nada de inventar datos de marca: pedí el design system con las herramientas de brand antes de diseñar.`;

const CRON_PROMPT = `Cada 15 minutos:
1. Llamá flow_ai_tasks. Si hay tareas: atendé las de staleMinutes más alto primero y completá cada una con flow_ai_complete (payload = salida del nodo).
2. Si flow_ai_tasks trae expired[], avisale al dueño qué flow expiró y re-ejecutalo con flow_run.
3. Si no hay tareas, no hagas nada más (no llames flow_run por tu cuenta salvo que el dueño te pida un flow específico).
Reportá al final: tareas atendidas, expiradas y errores.`;

const WAKE_NOTE = `Cuando un run queda waiting, Musa manda a esta URL un POST firmado (X-Musa-Signature = hex(hmac_sha256(secreto, body))). Tu agente decide y responde con flow_resume + resumeToken.`;

export function ConnectLanding({ onEnter, onOpenHuman }: { onEnter?: () => void; onOpenHuman?: () => void }) {
  const { user, workspaceId } = useAuth();

  // Paso 1 — token
  const [preset, setPreset] = useState<PresetId>("agente");
  const [label, setLabel] = useState("Agente IA");
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintErr, setMintErr] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);

  // Paso 2/3 — snippets y prueba
  const [tab, setTab] = useState<"claude-code" | "claude-desktop" | "cursor" | "http" | "n8n">("claude-code");
  const [testToken, setTestToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<{ ok: boolean; text: string } | null>(null);

  // Paso 4/5 — bandeja y despertar
  const [tray, setTray] = useState<{ tasks: AiTask[]; expired: AiTask[]; note?: string } | null>(null);
  const [trayErr, setTrayErr] = useState<string | null>(null);
  const [wake, setWake] = useState<WakeCfg | null>(null);
  const [wakeUrl, setWakeUrl] = useState("");
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [wakeSecretOnce, setWakeSecretOnce] = useState<string | null>(null);
  const [wakeBusy, setWakeBusy] = useState<"save" | "test" | null>(null);
  const [wakeOut, setWakeOut] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const loadKeys = useCallback(async () => {
    if (!workspaceId) { setKeys(null); return; }
    try {
      const res = await apiFetch<{ success: boolean; data: ApiKeyRow[] }>(`/api/workspaces/${workspaceId}/api-keys`);
      setKeys(Array.isArray(res?.data) ? res.data : []);
    } catch { setKeys(null); }
  }, [workspaceId]);

  const loadTray = useCallback(async () => {
    if (!workspaceId) { setTray(null); return; }
    setTrayErr(null);
    try {
      const res = await mcpCall("flow_ai_tasks", { workspaceId });
      setTray({ tasks: Array.isArray(res?.tasks) ? res.tasks : [], expired: Array.isArray(res?.expired) ? res.expired : [], note: res?._note });
    } catch (e: any) { setTray(null); setTrayErr(String(e?.message ?? e)); }
  }, [workspaceId]);

  const loadWake = useCallback(async () => {
    if (!workspaceId) { setWake(null); return; }
    try {
      const res = await mcpCall("flow_wake_get", { workspaceId });
      setWake({ enabled: !!res?.enabled, url: res?.url ?? null, secretHint: res?.secretHint ?? null });
      setWakeUrl(res?.url ?? "");
      setWakeEnabled(res?.enabled !== false);
    } catch { setWake(null); }
  }, [workspaceId]);

  useEffect(() => { void loadKeys(); void loadTray(); void loadWake(); }, [loadKeys, loadTray, loadWake]);

  const mintToken = async () => {
    if (!workspaceId || minting) return;
    setMinting(true); setMintErr(null);
    try {
      const p = PRESETS.find((x) => x.id === preset)!;
      const res = await apiFetch<{ success: boolean; data: ApiKeyRow & { key: string } }>(`/api/workspaces/${workspaceId}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ label: label.trim() || "Agente IA", role: "editor", kind: "mcp", ...(p.scopes.length ? { scopes: p.scopes } : {}) }),
      });
      if (res?.data?.key) {
        setRawKey(res.data.key);
        setTestToken(res.data.key);
        await loadKeys();
      } else { setMintErr("La API no devolvió el token."); }
    } catch (e: any) { setMintErr(String(e?.message ?? e)); }
    finally { setMinting(false); }
  };

  const revokeKey = async (keyId: string) => {
    if (!workspaceId) return;
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/api-keys/${keyId}`, { method: "DELETE" });
      if (rawKey && keys?.find((k) => k.id === keyId)?.key_prefix === rawKey.slice(0, 12)) setRawKey(null);
      await loadKeys();
    } catch { /* el llavero recarga igual */ }
  };

  const saveWake = async () => {
    if (!workspaceId || wakeBusy) return;
    setWakeBusy("save"); setWakeOut(null);
    try {
      const res = await mcpCall("flow_wake_set", { workspaceId, url: wakeUrl.trim() || null, enabled: wakeEnabled });
      if (res?.secret) setWakeSecretOnce(String(res.secret));
      else setWakeOut(res?.cleared ? "Despertar quitado: los runs waiting seguirán esperando flow_resume, sin aviso." : "Despertar guardado.");
      await loadWake();
    } catch (e: any) { setWakeOut(`Error: ${e?.message ?? e}`); }
    finally { setWakeBusy(null); }
  };

  const testWake = async () => {
    if (!workspaceId || wakeBusy) return;
    setWakeBusy("test"); setWakeOut(null);
    try {
      const res = await mcpCall("flow_wake_test", { workspaceId });
      setWakeOut(res?.ok ? `OK: tu endpoint respondió ${res.status} al POST firmado.` : `Sin 2xx tras los reintentos (status ${res?.status ?? "?"}). Los runs en espera no se ven afectados.`);
    } catch (e: any) { setWakeOut(`Error: ${e?.message ?? e}`); }
    finally { setWakeBusy(null); }
  };

  const testConnection = async () => {
    const tok = (testToken || rawKey || "").trim();
    if (!tok || testing) return;
    setTesting(true); setTestOut(null);
    try {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": tok },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "flow_list", arguments: {} }, id: 1 }),
      });
      if (res.status === 401 || res.status === 403) { setTestOut({ ok: false, text: `Token rechazado (HTTP ${res.status}): inválido o sin acceso a este workspace.` }); return; }
      const json: any = await res.json().catch(() => null);
      if (json?.error) {
        const code = json.error.code;
        const why = code === -32003 ? "SCOPE_DENIED: el token no tiene el scope para flow_list."
          : code === -32008 ? "RATE_LIMITED: superaste 120 llamadas por minuto."
          : String(json.error.message ?? "error desconocido");
        setTestOut({ ok: false, text: `El MCP respondió un error: ${why}` });
        return;
      }
      let data: any = json?.result?.content?.[0]?.type === "text" ? json.result.content[0].text : json?.result;
      let count: number | null = null;
      try { const p = typeof data === "string" ? JSON.parse(data) : data; count = Array.isArray(p?.flows) ? p.flows.length : Array.isArray(p?.data) ? p.data.length : typeof p?.total === "number" ? p.total : null; data = p; } catch { /* texto plano: igual es OK */ }
      setTestOut({ ok: true, text: count != null ? `Conexión OK — el token entró y vio ${count} flow(s) del workspace.` : "Conexión OK — el MCP respondió a tu token." });
    } catch (e: any) {
      setTestOut({ ok: false, text: `No se pudo contactar ${MCP_URL}: ${e?.message ?? e}` });
    } finally { setTesting(false); }
  };

  const tokenForSnippets = rawKey ?? (testToken.trim() || null);
  const snippet = (() => {
    const tok = tokenForSnippets ?? "TU_TOKEN_fdr_ws_...";
    switch (tab) {
      case "claude-code":
        return `claude mcp add --transport http futuraria ${MCP_URL} --header "x-api-key: ${tok}" --scope user`;
      case "claude-desktop":
        return JSON.stringify({ mcpServers: { futuraria: { type: "http", url: MCP_URL, headers: { "x-api-key": tok } } } }, null, 2);
      case "cursor":
        return JSON.stringify({ mcpServers: { futuraria: { url: MCP_URL, headers: { "x-api-key": tok } } } }, null, 2);
      case "http":
        return `URL:     ${MCP_URL}
Header:  x-api-key: ${tok}
Transporte: HTTP streamable (JSON-RPC 2.0, tools/list y tools/call)`;
      case "n8n":
        return `Nodo "MCP Client Tool" (HTTP streamable):
  Endpoint: ${MCP_URL}
  Header:   x-api-key: ${tok}

Para atender tareas IA desde un workflow: HTTP Request POST ${MCP_URL}
  body: { "jsonrpc": "2.0", "method": "tools/call",
          "params": { "name": "flow_ai_tasks", "arguments": {} }, "id": 1 }`;
    }
  })();

  const briefingFor = (t: AiTask) =>
    `[Tarea IA] ${t.title || "(sin título)"}\nFlow: ${t.flowName || t.flowId} (${t.flowId}) · run ${t.runId}\nMensaje:\n${t.message ?? ""}\n\nContrato: flow_ai_complete { runId: "${t.runId}", resumeToken: "${t.resumeToken}", ok: true, payload: <salida del nodo> }\nMCP: ${MCP_URL} (header x-api-key con tu token)`;

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(1200px 600px at 70% -10%, rgba(99,102,241,0.16), transparent 60%), #07070b", color: "rgba(255,255,255,0.88)", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 18px 60px", display: "grid", gap: 16 }}>
        {/* ── Header ── */}
        <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.5, color: "#c7d2fe" }}>FUTURARIA</span>
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>Musa · MCP</span>
          <span style={{ flex: 1 }} />
          {/* App no escucha hashchange: fuera de props, navegación completa. */}
          <button type="button" onClick={() => window.location.assign("/#agents")} style={btnBase}>La Llamada</button>
          <button type="button" onClick={() => (onOpenHuman ? onOpenHuman() : window.location.assign("/"))} style={btnBase}>Soy humano</button>
          {user && onEnter && <button type="button" onClick={onEnter} style={{ ...btnBase, borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe" }}>Ir a mi workspace</button>}
        </header>

        <div style={{ display: "grid", gap: 8, padding: "6px 2px" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: -0.3 }}>Conecta tu IA</h1>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", maxWidth: 640 }}>
            Un token con scopes para tu workspace, un snippet por cliente y el loop completo: tu IA ve tareas, las resuelve y Musa sigue el flow. Sin compartir tu contraseña ni tu cuenta.
          </p>
          {!user && (
            <div style={{ fontSize: 12, color: "rgba(252,211,77,0.85)", border: "1px solid rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.07)", borderRadius: 10, padding: "8px 11px", lineHeight: 1.5 }}>
              Para emitir o revocar tokens iniciá sesión con tu cuenta de admin del workspace: los botones del paso 1 piden sesión. Todo lo demás (snippets, prompts, contrato) se lee igual sin sesión.
            </div>
          )}
        </div>

        {/* ── Paso 1: token con scopes ── */}
        <Step n={1} title="Emití un token con scopes">
          <div style={{ display: "grid", gap: 8 }}>
            {PRESETS.map((p) => {
              const active = preset === p.id;
              return (
                <button key={p.id} type="button" onClick={() => setPreset(p.id)} disabled={!user || !workspaceId}
                  style={{ textAlign: "left", cursor: user && workspaceId ? "pointer" : "not-allowed", background: active ? "rgba(129,140,248,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? "rgba(129,140,248,0.55)" : "rgba(255,255,255,0.1)"}`, borderRadius: 10, padding: "10px 12px", color: "inherit" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: active ? "#c7d2fe" : "rgba(255,255,255,0.85)" }}>{p.name}</span>
                    {p.id === "agente" && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#a5b4fc", border: "1px solid rgba(129,140,248,0.5)", borderRadius: 999, padding: "1px 8px" }}>recomendado</span>}
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{p.scopes.length ? p.scopes.join(" · ") : "sin scopes (todo)"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginTop: 3 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etiqueta (¿para qué agente es?)" disabled={!user || !workspaceId} style={{ ...inputStyle, flex: 1, minWidth: 200, opacity: user && workspaceId ? 1 : 0.5 }} />
            <button type="button" onClick={() => void mintToken()} disabled={!user || !workspaceId || minting}
              style={{ ...btnBase, background: "rgba(129,140,248,0.2)", borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe", opacity: !user || !workspaceId || minting ? 0.5 : 1 }}>
              {minting ? "Generando…" : "Generar token"}
            </button>
          </div>
          {mintErr && <div style={{ fontSize: 11.5, color: "#f87171" }}>{mintErr}</div>}
          {rawKey && (
            <div style={{ border: "1px solid rgba(251,191,36,0.45)", background: "rgba(251,191,36,0.08)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 7 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#fcd34d" }}>Token generado — cópialo AHORA: no vuelve a mostrarse.</div>
              <code style={{ fontSize: 11.5, fontFamily: "monospace", color: "rgba(255,255,255,0.9)", wordBreak: "break-all" }}>{rawKey}</code>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <CopyBtn text={rawKey} small />
                <button type="button" onClick={() => setRawKey(null)} style={{ ...btnBase, padding: "3px 9px", fontSize: 10.5 }}>Ya lo copié</button>
              </div>
            </div>
          )}
          {user && workspaceId && keys && keys.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: 0.4 }}>TOKENS DEL WORKSPACE</div>
              {keys.map((k) => (
                <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "7px 10px" }}>
                  <code style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", fontFamily: "monospace" }}>{k.key_prefix}</code>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{k.label}</span>
                  {Array.isArray(k.scopes) && k.scopes.length > 0 && <span style={{ fontSize: 9.5, color: "rgba(196,181,253,0.85)", border: "1px solid rgba(196,181,253,0.4)", borderRadius: 999, padding: "1px 7px", fontFamily: "monospace" }}>{k.scopes.join(" · ")}</span>}
                  {!Array.isArray(k.scopes) || k.scopes.length === 0 ? <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.35)" }}>sin scopes</span> : null}
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => void revokeKey(k.id)} title="Revoca el token: deja de funcionar de inmediato" style={{ ...btnBase, padding: "3px 9px", fontSize: 10.5, borderColor: "rgba(248,113,113,0.45)", color: "#f87171" }}>Revocar</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.55 }}>
            El token se guarda hasheado (nunca en claro), está atado a ESTE workspace y a sus scopes. Revocar corta el acceso al instante. Límite de uso: 120 llamadas por minuto por token.
          </div>
        </Step>

        {/* ── Paso 2: snippet por cliente ── */}
        <Step n={2} title="Conectá tu cliente MCP">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["claude-code", "Claude Code"], ["claude-desktop", "Claude Desktop"], ["cursor", "Cursor"], ["http", "Otro (streamable HTTP)"], ["n8n", "n8n"]] as const).map(([id, name]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                style={{ ...btnBase, fontSize: 11, padding: "5px 11px", ...(tab === id ? { background: "rgba(255,255,255,0.13)", borderColor: "rgba(255,255,255,0.45)", color: "rgba(255,255,255,0.95)" } : {}) }}>
                {name}
              </button>
            ))}
          </div>
          {!tokenForSnippets && <div style={{ fontSize: 11, color: "rgba(252,211,77,0.8)" }}>Generá (o pegá abajo) un token para verlo en el snippet; por ahora va el placeholder.</div>}
          <CodeBlock code={snippet} />
        </Step>

        {/* ── Paso 3: probar conexión ── */}
        <Step n={3} title="Probá la conexión">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={testToken} onChange={(e) => setTestToken(e.target.value)} placeholder="fdr_ws_… (se autocompleta si acabas de generar uno)" style={{ ...inputStyle, flex: 1, minWidth: 240, fontFamily: "monospace" }} />
            <button type="button" onClick={() => void testConnection()} disabled={testing || !(testToken || rawKey)} style={{ ...btnBase, background: "rgba(74,222,128,0.14)", borderColor: "rgba(74,222,128,0.45)", color: "#86efac", opacity: testing || !(testToken || rawKey) ? 0.5 : 1 }}>
              {testing ? "Probando…" : "Probar conexión"}
            </button>
          </div>
          {testOut && (
            <div style={{ fontSize: 12, lineHeight: 1.5, border: `1px solid ${testOut.ok ? "rgba(74,222,128,0.4)" : "rgba(248,113,113,0.4)"}`, background: testOut.ok ? "rgba(74,222,128,0.07)" : "rgba(248,113,113,0.07)", borderRadius: 8, padding: "8px 11px", color: testOut.ok ? "#86efac" : "#f87171" }}>
              {testOut.text}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.55 }}>
            La prueba llama flow_list con TU token (sin tu sesión): si pasa, tu agente tiene exactamente ese acceso — ni más ni menos.
          </div>
        </Step>

        {/* ── Paso 4: bandeja de tareas IA ── */}
        <Step n={4} title="Bandeja de tu IA (tareas en espera)">
          {workspaceId ? (
            <div style={{ display: "grid", gap: 8 }} data-tick={tick}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: tray && tray.tasks.length > 0 ? "#fbbf24" : "rgba(255,255,255,0.25)" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: tray && tray.tasks.length > 0 ? "#fcd34d" : "rgba(255,255,255,0.5)" }}>
                  {tray ? (tray.tasks.length === 0 ? "Sin tareas pendientes" : `${tray.tasks.length} tarea(s) esperando`) : "Cargando bandeja…"}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => void loadTray()} style={{ ...btnBase, padding: "4px 10px", fontSize: 11 }}>Refrescar</button>
              </div>
              {trayErr && <div style={{ fontSize: 11.5, color: "#f87171" }}>{trayErr}</div>}
              {(tray?.tasks ?? []).map((t) => {
                const left = minutesLeft(t.expiresAt);
                return (
                  <div key={t.runId} style={{ border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.05)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fcd34d" }}>{t.title || "(sin título)"}</span>
                      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>{t.flowName || t.flowId} · sin atención {t.staleMinutes} min</span>
                      {left != null && <span style={{ fontSize: 10.5, color: left <= 5 ? "#f87171" : "rgba(255,255,255,0.45)" }}>expira en {left} min</span>}
                      <span style={{ flex: 1 }} />
                      <CopyBtn text={briefingFor(t)} small />
                    </div>
                    {t.message && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 84, overflow: "hidden" }}>{t.message}</div>}
                    <code style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", wordBreak: "break-all" }}>{t.resumeToken}</code>
                  </div>
                );
              })}
              {(tray?.expired?.length ?? 0) > 0 && (
                <div style={{ border: "1px solid rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.06)", borderRadius: 10, padding: "9px 12px", fontSize: 11.5, color: "rgba(248,113,113,0.85)", lineHeight: 1.5 }}>
                  {tray!.expired.length} tarea(s) EXPIRADAS: nadie las atendió a tiempo. Re-ejecuta el flow; las esperas no consumen CPU ni tokens.
                </div>
              )}
              {tray?.note && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", lineHeight: 1.55 }}>{tray.note}</div>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.55 }}>
              Iniciá sesión para ver la bandeja de este workspace. Tu agente la lee desde fuera con flow_ai_tasks (scope flows:read) y responde con flow_ai_complete (scope flows:resume).
            </div>
          )}
        </Step>

        {/* ── Paso 5: despertar ── */}
        <Step n={5} title="Despertar por agente (webhook firmado)">
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.55 }}>{WAKE_NOTE}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={wakeUrl} onChange={(e) => setWakeUrl(e.target.value)} placeholder="https://tu-agente.ejemplo/musa/wake (HTTPS público)" disabled={!workspaceId} style={{ ...inputStyle, flex: 1, minWidth: 220, opacity: workspaceId ? 1 : 0.5 }} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>
              <input type="checkbox" checked={wakeEnabled} onChange={(e) => setWakeEnabled(e.target.checked)} disabled={!workspaceId} />
              Activo
            </label>
            <button type="button" onClick={() => void saveWake()} disabled={!workspaceId || wakeBusy !== null} style={{ ...btnBase, background: "rgba(96,165,250,0.2)", borderColor: "rgba(96,165,250,0.5)", color: "#93c5fd", opacity: !workspaceId || wakeBusy !== null ? 0.5 : 1 }}>
              {wakeBusy === "save" ? "Guardando…" : wakeUrl.trim() ? "Guardar" : "Quitar"}
            </button>
            <button type="button" onClick={() => void testWake()} disabled={!workspaceId || wakeBusy !== null} title="Envía un POST de prueba a la URL guardada (no toca ningún run)" style={{ ...btnBase, opacity: !workspaceId || wakeBusy !== null ? 0.5 : 1 }}>
              {wakeBusy === "test" ? "Probando…" : "Probar"}
            </button>
          </div>
          {wake?.url && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>configurado: {wake.secretHint ? `secreto ${wake.secretHint}` : "sin secreto"} · {wake.enabled ? "activo" : "pausado"}</div>}
          {wakeSecretOnce && (
            <div style={{ border: "1px solid rgba(251,191,36,0.45)", background: "rgba(251,191,36,0.08)", borderRadius: 8, padding: "9px 11px", display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fcd34d" }}>Secreto generado — cópialo AHORA: no vuelve a mostrarse.</div>
              <code style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.85)", wordBreak: "break-all" }}>{wakeSecretOnce}</code>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setWakeSecretOnce(null)} style={{ ...btnBase, padding: "3px 9px", fontSize: 11 }}>Ya lo copié</button>
              </div>
            </div>
          )}
          {wakeOut && <div style={{ fontSize: 11.5, color: wakeOut.startsWith("Error") ? "#f87171" : "rgba(255,255,255,0.6)" }}>{wakeOut}</div>}
        </Step>

        {/* ── Paso 6: prompts ── */}
        <Step n={6} title="Prompts listos para pegar">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Prompt sistema — cómo opera tu IA en Musa</div>
          <CodeBlock code={SYSTEM_PROMPT} />
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Prompt cron — ronda de atención cada 15 min</div>
          <CodeBlock code={CRON_PROMPT} />
        </Step>

        <footer style={{ fontSize: 10.5, color: "rgba(255,255,255,0.32)", lineHeight: 1.6, padding: "0 2px" }}>
          MCP: {MCP_URL} · tokens hasheados en reposo · scopes por token · auditoría de tareas IA · revocación inmediata. ¿Problemas? Entrá a tu workspace y mirá Configuración → APIs/Webhooks.
        </footer>
      </div>
    </div>
  );
}
