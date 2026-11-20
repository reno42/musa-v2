/**
 * REQ-082 — InboxSection: inbox unificado en Configuración.
 * Lista de conversaciones por marca + detalle + responder. Los agentes
 * contestan con las tools MCP; esta vista es para el humano del operador.
 * Tenancy dura: workspaceId del console; brandId como filtro (no como choice).
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

type Conv = {
  conversationId: string; brandId: string | null; provider: string; kind: string;
  participant: string | null; status: string; unread: number; preview: string | null; lastMessageAt: string | null;
};
type Msg = { direction: string; from: string; author: string | null; body: string; at: string };

export function InboxSection({ workspaceId }: { workspaceId: string }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ conversations: Conv[] }>(`/api/inbox/conversations?workspaceId=${encodeURIComponent(workspaceId)}`);
      setConvs(res.conversations || []);
    } catch (e: any) { setError(e?.message || "error"); }
    finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (c: Conv) => {
    setSel(c);
    try {
      const res = await apiFetch<{ messages: Msg[] }>(`/api/inbox/conversations/${encodeURIComponent(c.conversationId)}/messages?workspaceId=${encodeURIComponent(workspaceId)}`);
      setMsgs(res.messages || []);
    } catch { setMsgs([]); }
  }, [workspaceId]);

  const send = async () => {
    if (!sel || !draft.trim()) return;
    setSending(true);
    try {
      await apiFetch("/api/inbox/reply", { method: "POST", body: JSON.stringify({ workspaceId, conversationId: sel.conversationId, body: draft.trim() }) });
      setDraft("");
      open(sel);
    } catch (e: any) { setError(e?.message || "fallo envío"); }
    finally { setSending(false); }
  };

  const sweep = async () => {
    setLoading(true);
    try { await apiFetch("/api/inbox/sweep", { method: "POST", body: JSON.stringify({ workspaceId }) }); } catch { /* noop */ }
    load();
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <p style={{ margin: 0, opacity: 0.72, fontSize: 14 }}>
          DMs y comentarios de todas tus cuentas conectadas, separados por marca. Tus IAs contestan por MCP con la personalidad de cada cliente.
        </p>
        <button onClick={sweep} style={{ border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "inherit", borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
          Traer mensajes
        </button>
      </div>
      {error && <div style={{ border: "1px solid rgba(255,90,0,.4)", borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>{error}</div>}
      {loading && !convs.length && <p style={{ margin: 0, opacity: 0.6, fontSize: 14 }}>Cargando inbox…</p>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 1.4fr", gap: 12, alignItems: "start" }}>
        {/* Lista */}
        <div style={{ display: "grid", gap: 6, maxHeight: 420, overflowY: "auto" }}>
          {convs.map((c) => (
            <button key={c.conversationId} onClick={() => open(c)}
              style={{ textAlign: "left", border: sel?.conversationId === c.conversationId ? "1px solid rgba(255,255,255,.4)" : "1px solid rgba(255,255,255,.12)", background: "transparent", color: "inherit", borderRadius: 10, padding: "9px 11px", cursor: "pointer", display: "grid", gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.participant || "(sin nombre)"}</span>
                {c.unread > 0 && <span style={{ background: "#ff3b00", color: "#fff", borderRadius: 999, fontSize: 10.5, padding: "1px 7px", fontWeight: 700 }}>{c.unread}</span>}
              </span>
              <span style={{ fontSize: 12, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.provider} · {c.kind} · {c.brandId ? `marca ${c.brandId.slice(0, 8)}…` : "marca propia"}{c.preview ? ` — ${c.preview}` : ""}
              </span>
            </button>
          ))}
          {!loading && convs.length === 0 && (
            <p style={{ margin: 0, opacity: 0.6, fontSize: 13.5 }}>Sin conversaciones aún. Conecta cuentas (Configuración → Publicar) y pulsa «Traer mensajes».</p>
          )}
        </div>

        {/* Detalle */}
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 10, minHeight: 300 }}>
          {!sel && <p style={{ margin: "auto", opacity: 0.5, fontSize: 13.5 }}>Elige una conversación.</p>}
          {sel && (
            <>
              <div style={{ fontSize: 12.5, opacity: 0.65 }}>
                {sel.participant} · {sel.provider} ({sel.kind}) · {sel.status}
              </div>
              <div style={{ display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                {msgs.map((m, i) => (
                  <div key={i} style={{ justifySelf: m.direction === "out" ? "end" : "start", maxWidth: "80%", border: "1px solid rgba(255,255,255,.14)", borderRadius: 10, padding: "6px 10px", fontSize: 13.5, background: m.direction === "out" ? "rgba(255,255,255,.05)" : "transparent" }}>
                    <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 2 }}>{m.direction === "out" ? (m.author || "nosotros") : (m.author || "cliente")} · {String(m.at || "").slice(0, 16).replace("T", " ")}</div>
                    {m.body}
                  </div>
                ))}
                {msgs.length === 0 && <p style={{ margin: 0, opacity: 0.5, fontSize: 13 }}>Sin mensajes cargados.</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(); }}
                  placeholder="Responder como esta marca…"
                  style={{ flex: 1, border: "1px solid rgba(255,255,255,.2)", background: "transparent", borderRadius: 10, padding: "9px 12px", color: "inherit", fontSize: 13.5 }} />
                <button onClick={send} disabled={sending || !draft.trim()}
                  style={{ border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.06)", color: "inherit", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontSize: 13.5 }}>
                  {sending ? "…" : "Enviar"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
