/**
 * Invita IAs — catálogo de harnesses con tarjetas + detalle lateral.
 * ────────────────────────────────────────────────────────────────
 * Misma gramática visual que «Mis integraciones» (intg-*), pero el
 * contenido de cada tarjeta es un HARNESS de IA (Claude Code, ChatGPT
 * Desktop + Codex…) y la acción es copiar el PROMPT completo, no la
 * llave. El feedback v61 fue explícito: la gente veía la llave recién
 * creada, la copiaba suelta y se quedaba a mitad de camino — el valor
 * está en pegarle a la IA el prompt entero, que ya trae la llave dentro.
 *
 * Flujo en pantalla (CTA explícito, en orden):
 *   1. Barra HORIZONTAL «Genera la llave MCP» — un único botón; la
 *      llave nunca muestra un botón «Copiar», solo un aviso de que ya
 *      viaja dentro de los prompts.
 *   2. Tarjetas por harness: logo + nombre + oneliner + dos botones
 *      («Copiar» copia el prompt completo; «Ver detalle» abre el
 *      drawer lateral con el prompt entero).
 *   3. Abajo, fuera del camino principal: Accesos de agentes (revocar),
 *      SKILL.md y los MCPs BYOK del equipo (v61: se movieron aquí desde
 *      «Mis integraciones» — este es el hogar de todo lo MCP).
 *
 * Los prompts viven en AiConnectPrompts.tsx (AI_PROMPTS) — única fuente;
 * aquí solo se les añade la capa visual y la llave recién creada.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getApiHeaders } from "../lib/apiKey";
import { downloadBlob } from "../lib/download";
import { AI_PROMPTS, renderPrompt, type AiPrompt } from "./AiConnectPrompts";

type ApiKey = { id: string; label: string; key_prefix: string; role: string; kind?: string; last_used_at?: string; created_at: string };
type Connection = { id: string; name: string; kind: string; provider: string; endpointUrl: string; enabled: boolean; hasCredentials: boolean };

type HarnessDef = AiPrompt & {
  logo?: string;
  fallback: { letter: string; from: string; to: string };
};

/** Capa visual por harness — el texto (prompt/how/badge) vive en AI_PROMPTS. */
const HARNESS_VISUALS: Record<string, { logo?: string; fallback: { letter: string; from: string; to: string } }> = {
  hermes: { fallback: { letter: "H", from: "#34d399", to: "#0b7a55" } },
  // Claude Code es CLI: un ❯ de terminal lo distingue de las tarjetas Desktop/Cowork.
  "claude-code": { fallback: { letter: "❯", from: "#e8825d", to: "#b45309" } },
  "claude-desktop": { logo: "/logos/claude.png", fallback: { letter: "C", from: "#d97757", to: "#9a4a2e" } },
  "claude-cowork": { logo: "/logos/claude.png", fallback: { letter: "C", from: "#d97757", to: "#9a4a2e" } },
  "chatgpt-desktop-codex": { logo: "/logos/chatgpt.png", fallback: { letter: "G", from: "#10a37f", to: "#0b7a5f" } },
  otra: { fallback: { letter: "✦", from: "#8b5cf6", to: "#5b21b6" } },
};

const HARNESS: HarnessDef[] = AI_PROMPTS.map(def => ({
  ...def,
  ...(HARNESS_VISUALS[def.id] ?? { fallback: { letter: def.name.charAt(0), from: "#8b5cf6", to: "#5b21b6" } }),
}));

const maskKey = (key: string) => (key.length > 18 ? `${key.slice(0, 12)}…${key.slice(-4)}` : key);

const shortDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" }); } catch { return ""; }
};

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(getApiHeaders());
  new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
  const res = await fetch(url, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="workspace-field"><span>{label}</span>{children}</label>;
}

export type InviteAisCatalogProps = {
  workspaceId: string;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

export function InviteAisCatalog({ workspaceId, setError, setNotice }: InviteAisCatalogProps): JSX.Element {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keyLabel, setKeyLabel] = useState("");
  const [keyRole, setKeyRole] = useState("editor");
  const [creating, setCreating] = useState(false);
  // La llave recién creada solo existe aquí (el servidor no la vuelve a
  // enviar): viaja directa a los prompts; la UI nunca ofrece copiarla suelta.
  const [rawKey, setRawKey] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // MCPs BYOK del equipo (v61: movidos desde «Mis integraciones»).
  const [connections, setConnections] = useState<Connection[]>([]);
  const [mcpName, setMcpName] = useState(""); const [mcpProvider, setMcpProvider] = useState(""); const [mcpEndpoint, setMcpEndpoint] = useState(""); const [mcpCredentials, setMcpCredentials] = useState('{"headers":{"Authorization":"Bearer …"}}');

  const loadKeys = useCallback(async () => {
    try {
      const result = await apiFetch<{ data: ApiKey[] }>(`/api/workspaces/${workspaceId}/api-keys`);
      setKeys((result.data || []).filter(key => (key.kind ?? "mcp") === "mcp"));
    } catch (cause: any) { setError(cause.message); }
  }, [workspaceId, setError]);

  const loadConnections = useCallback(async () => {
    try {
      const result = await apiFetch<{ data: Connection[] }>(`/api/workspaces/${workspaceId}/connections`);
      setConnections(result.data || []);
    } catch (cause: any) { setError(cause.message); }
  }, [workspaceId, setError]);

  useEffect(() => { void loadKeys(); void loadConnections(); }, [loadKeys, loadConnections]);

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const result = await apiFetch<{ data: { key: string } }>(`/api/workspaces/${workspaceId}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ label: keyLabel, role: keyRole, kind: "mcp" }),
      });
      setRawKey(result.data.key);
      setKeyLabel("");
      await loadKeys();
      // CTA explícito: tras crear, la vista baja sola a las tarjetas —
      // el siguiente paso es copiar el prompt, no mirar la llave.
      setTimeout(() => gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (cause: any) { setError(cause.message); }
    setCreating(false);
  };

  // Copia el prompt completo (llave incluida) — clipboard + fallback execCommand.
  const copyPrompt = useCallback((id: string) => {
    const def = HARNESS.find(item => item.id === id);
    const text = renderPrompt(def?.prompt ?? "", rawKey);
    const done = () => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch { /* clipboard no disponible */ }
    document.body.removeChild(ta);
  }, [rawKey]);

  // Revocación en dos pasos — confirmación inline, sin diálogo.
  const revoke = async (key: ApiKey) => {
    if (confirmId !== key.id) { setConfirmId(key.id); return; }
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/api-keys/${key.id}`, { method: "DELETE" });
      await loadKeys();
      setNotice("Llave revocada.");
    } catch (cause: any) { setError(cause.message); }
    setConfirmId(null);
  };

  // MCPs BYOK del equipo (v61: se movieron desde «Mis integraciones»).
  const addConnection = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const credentials = mcpCredentials.trim() ? JSON.parse(mcpCredentials) : undefined;
      await apiFetch(`/api/workspaces/${workspaceId}/connections`, {
        method: "POST",
        body: JSON.stringify({ name: mcpName, provider: mcpProvider, endpointUrl: mcpEndpoint, kind: "mcp", enabled: true, credentials }),
      });
      setMcpName(""); setMcpProvider(""); setMcpEndpoint("");
      setNotice("MCP conectado al workspace.");
      await loadConnections();
    } catch (cause: any) { setError(cause.message); }
  };

  const toggleConnection = async (connection: Connection) => {
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !connection.enabled }) });
      await loadConnections();
    } catch (cause: any) { setError(cause.message); }
  };

  const downloadSkill = async () => {
    try {
      const res = await fetch("/SKILL.md");
      downloadBlob(new Blob([await res.text()], { type: "text/markdown" }), "SKILL.md");
    } catch (cause: any) { setError(cause?.message || "No se pudo descargar SKILL.md"); }
  };

  const selected = HARNESS.find(item => item.id === selectedId) ?? null;
  const hasKey = Boolean(rawKey.trim());

  return (
    <div className="intg-ais">
      {/* Los 3 pasos, explícitos: el error a matar es «copio la llave y ya». */}
      <ol className="intg-steps" aria-label="Cómo invitar a tu IA en tres pasos">
        <li><span className="intg-steps-num">1</span> Genera la llave MCP</li>
        <li><span className="intg-steps-num">2</span> Copia el prompt de tu IA — la llave viaja dentro</li>
        <li><span className="intg-steps-num">3</span> Pégalo en tu IA; listo cuando su healthcheck dé ok</li>
      </ol>

      {/* Paso 1 — la creación de llave, horizontal a lo ancho y con UN solo botón. */}
      <section className="intg-create-bar" aria-labelledby="intg-create-title">
        <div className="intg-create-head">
          <h3 id="intg-create-title">Genera la llave MCP</h3>
          <p>Un botón, una llave: se inserta sola en los prompts de abajo. No necesitas copiarla — el prompt completo la lleva por ti.</p>
        </div>
        <form className="intg-create-row" onSubmit={createKey}>
          <input
            value={keyLabel}
            onChange={e => setKeyLabel(e.target.value)}
            placeholder="Claude del equipo"
            aria-label="Nombre de la llave"
            required
          />
          <select value={keyRole} onChange={e => setKeyRole(e.target.value)} aria-label="Permiso de la llave">
            <option value="editor">Puede diseñar</option>
            <option value="viewer">Solo lectura</option>
          </select>
          <button type="submit" className="intg-btn-generate" disabled={creating}>
            {creating ? "Generando…" : "Generar llave MCP"}
          </button>
        </form>
        {rawKey ? (
          <div className="intg-cta" role="status">
            <CheckIcon />
            <div>
              <strong>Llave creada ({maskKey(rawKey)}) — ya está dentro de los prompts.</strong>
              <span>Paso 2: busca tu IA abajo y pulsa <strong>Copiar</strong>. No copies la llave suelta; el prompt completo la incluye por ti.</span>
            </div>
          </div>
        ) : (
          <p className="intg-create-note">¿Ya tenías una llave y no la encuentras? Genera otra: la anterior sigue activa hasta que la revoques en «Accesos de agentes».</p>
        )}
        {/* REQ-047: el onboarding con scopes por agente vive en su página pública. */}
        <p className="intg-create-note">
          ¿Tu agente vive fuera de tu equipo (n8n, cliente MCP propio) y querés limitar qué puede tocar? En <a href="/#connect" style={{ color: "#a5b4fc", fontWeight: 600 }}>Conecta tu IA</a> emitís un token con scopes, copiás el snippet de tu cliente y probás la conexión.
        </p>
      </section>

      {/* Paso 2 — tarjetas por harness, misma gramática que Mis integraciones. */}
      <section aria-labelledby="intg-harness-title">
        <div className="intg-harness-head">
          <h3 id="intg-harness-title">Elige tu IA — un clic copia el prompt completo</h3>
          <p>El prompt trae tu llave y las instrucciones exactas: tu IA se configura sola y confirma con su healthcheck.</p>
        </div>
        <div className="intg-grid" ref={gridRef}>
          {HARNESS.map(def => (
            <HarnessCard
              key={def.id}
              def={def}
              copied={copiedId === def.id}
              hasKey={hasKey}
              onCopy={() => copyPrompt(def.id)}
              onDetails={() => setSelectedId(def.id)}
            />
          ))}
        </div>
      </section>

      {/* Utilidades de siempre, fuera del camino principal. */}
      <div className="workspace-grid intg-ais-footer">
        <article className="workspace-panel span">
          <h3>Accesos de agentes</h3>
          <div className="workspace-list">
            {keys.length === 0 && <p className="workspace-muted">Todavía no hay llaves MCP en este workspace.</p>}
            {keys.map(key => (
              <div className="workspace-row" key={key.id}>
                <div>
                  <strong>{key.label}</strong>
                  <span>{key.key_prefix} · {key.role === "viewer" ? "Solo lectura" : "Puede diseñar"} · {shortDate(key.created_at)}</span>
                </div>
                {confirmId === key.id ? (
                  <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <button type="button" className="workspace-link danger" onClick={() => void revoke(key)}>Confirmar revocación</button>
                    <button type="button" className="workspace-link" onClick={() => setConfirmId(null)}>Cancelar</button>
                  </span>
                ) : (
                  <button type="button" className="workspace-link danger" onClick={() => setConfirmId(key.id)}>Revocar</button>
                )}
              </div>
            ))}
          </div>
        </article>
        <article className="workspace-panel span">
          <h3>SKILL.md — onboarding para agentes</h3>
          <p className="workspace-muted">Dáselo a cualquier agente de IA: le enseña las herramientas de Futuraria, la estructura del proyecto y las convenciones de diseño, para que diseñe junto a ti.</p>
          <button type="button" className="workspace-button" onClick={() => void downloadSkill()}>Descargar SKILL.md</button>
        </article>
        <article className="workspace-panel">
          <h3>Conectar MCP BYOK</h3>
          <form className="workspace-form" onSubmit={addConnection}>
            <Field label="Nombre"><input value={mcpName} onChange={e => setMcpName(e.target.value)} required /></Field>
            <Field label="Proveedor"><input value={mcpProvider} onChange={e => setMcpProvider(e.target.value)} placeholder="Notion, Slack, MCP propio…" required /></Field>
            <Field label="Endpoint HTTPS"><input type="url" value={mcpEndpoint} onChange={e => setMcpEndpoint(e.target.value)} required /></Field>
            <Field label="Credenciales JSON"><textarea value={mcpCredentials} onChange={e => setMcpCredentials(e.target.value)} rows={3} spellCheck={false} /></Field>
            <button className="workspace-button">Conectar y cifrar</button>
          </form>
        </article>
        <article className="workspace-panel span">
          <h3>MCPs disponibles para el equipo</h3>
          <div className="workspace-list">
            {connections.map(connection => (
              <div className="workspace-row" key={connection.id}>
                <div><strong>{connection.name}</strong><span>{connection.provider} · {connection.endpointUrl} · secretos {connection.hasCredentials ? "cifrados" : "no configurados"}</span></div>
                <button type="button" className="workspace-link" aria-pressed={connection.enabled} onClick={() => void toggleConnection(connection)}>{connection.enabled ? "Desactivar" : "Activar"}</button>
              </div>
            ))}
          </div>
        </article>
      </div>

      {selected && (
        <HarnessDrawer
          key={selected.id}
          def={selected}
          hasKey={hasKey}
          rawKey={rawKey}
          copied={copiedId === selected.id}
          onClose={() => setSelectedId(null)}
          onCopy={() => copyPrompt(selected.id)}
        />
      )}
    </div>
  );
}

/* ── Piezas visuales ── */

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#6ee7b7" strokeWidth="1.6" opacity="0.5" />
      <path d="m8 12.5 2.6 2.6L16 9.5" stroke="#6ee7b7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function LogoTile({ def, size }: { def: HarnessDef; size: number }) {
  const tile: CSSProperties = {
    width: size, height: size, borderRadius: Math.round(size * 0.26), flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
  };
  if (def.logo) {
    return (
      <span style={{ ...tile, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <img src={def.logo} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} style={{ objectFit: "contain" }} draggable={false} />
      </span>
    );
  }
  return (
    <span style={{
      ...tile,
      background: `linear-gradient(135deg, ${def.fallback.from}, ${def.fallback.to})`,
      border: "1px solid rgba(255,255,255,0.14)",
      color: "#fff", fontSize: Math.round(size * 0.4), fontWeight: 700,
    }}>{def.fallback.letter}</span>
  );
}

function KeyPill({ ok }: { ok: boolean }) {
  const style: CSSProperties = {
    fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2, padding: "3px 9px",
    borderRadius: 999, whiteSpace: "nowrap", color: ok ? "#6ee7b7" : "#fcd34d",
    background: ok ? "rgba(110,231,183,0.1)" : "rgba(252,211,77,0.1)",
    border: `1px solid ${ok ? "rgba(110,231,183,0.3)" : "rgba(252,211,77,0.3)"}`,
  };
  return <span style={style}>{ok ? "Prompt listo" : "Falta llave"}</span>;
}

function HarnessCard({ def, copied, hasKey, onCopy, onDetails }: {
  def: HarnessDef;
  copied: boolean;
  hasKey: boolean;
  onCopy: () => void;
  onDetails: () => void;
}) {
  return (
    <article className="intg-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <LogoTile def={def} size={46} />
        <KeyPill ok={hasKey} />
      </div>
      <div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#fff" }}>{def.name}</h3>
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2, color: "rgba(255,255,255,0.45)" }}>{def.badge}</span>
        <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.6)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{def.how}</p>
      </div>
      <div className="intg-card-actions">
        <button type="button" className="intg-copy-btn" onClick={onCopy}>
          {copied ? <><CheckIcon /> Copiado</> : "Copiar"}
        </button>
        <button type="button" className="intg-details-btn" onClick={onDetails} aria-haspopup="dialog">
          Ver detalle <ChevronRight />
        </button>
      </div>
    </article>
  );
}

function HarnessDrawer({ def, hasKey, rawKey, copied, onClose, onCopy }: {
  def: HarnessDef;
  hasKey: boolean;
  rawKey: string;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
}) {
  // Esc cierra y el scroll del body se bloquea mientras el drawer está abierto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="intg-drawer-backdrop" onClick={onClose} />
      <aside className="intg-drawer" role="dialog" aria-modal="true" aria-label={`Prompt de ${def.name}`}>
        <button type="button" className="intg-drawer-close" onClick={onClose} aria-label="Cerrar"><CloseIcon /></button>
        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingRight: 36 }}>
          <LogoTile def={def} size={58} />
          <div>
            <h2 style={{ fontFamily: '"Instrument Serif", serif', fontSize: 27, fontWeight: 400, margin: 0, color: "#fff" }}>{def.name}</h2>
            <span className="intg-badge">{def.badge}</span>
          </div>
        </div>
        <p style={{ margin: "16px 0 0", fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.65)" }}>{def.how}</p>
        {hasKey ? (
          <p className="intg-drawer-ok"><CheckIcon /> El prompt de abajo ya incluye tu llave recién creada.</p>
        ) : (
          <p className="intg-drawer-warn">Aún no generas la llave: el prompt usa el marcador TU_CLAVE_AQUI. Genera la llave arriba y este prompt se rellena solo.</p>
        )}
        <h4 style={{ margin: "18px 0 8px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "rgba(255,255,255,0.45)" }}>Prompt completo</h4>
        <pre className="intg-prompt">{renderPrompt(def.prompt, rawKey)}</pre>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" className="intg-copy-btn" onClick={onCopy}>
            {copied ? <><CheckIcon /> Copiado</> : "Copiar prompt completo"}
          </button>
        </div>
        <p className="intg-drawer-foot">
          Pégalo completo en {def.name}: la conexión queda confirmada cuando su healthcheck responda ok:true después de reiniciar la app. La llave es de este workspace — revócala cuando quieras en «Accesos de agentes».
        </p>
      </aside>
    </>,
    document.body
  );
}
