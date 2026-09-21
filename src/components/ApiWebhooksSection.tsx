/**
 * APIs/Webhooks — sección de Configuración (WorkspaceConsole)
 * ──────────────────────────────────────────────────────────────
 * Una sola superficie para conectar Musa con el mundo exterior:
 *
 *   · API       — credenciales (claves de workspace), guía de
 *                 autenticación, catálogo de endpoints, spec
 *                 OpenAPI descargable y recetas listas para
 *                 N8N, Zapier y Make.
 *   · Webhooks  — alta/baja de webhooks salientes, suscripción
 *                 por evento, test en vivo (webhook.ping),
 *                 secreto HMAC, y el log de entregas con
 *                 reintentos manuales.
 *
 * Todo habla con /api/webhooks (routes/webhooks.ts) con las mismas
 * credenciales que el resto del panel: Bearer de sesión y/o la
 * x-api-key del workspace.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { downloadBlob } from "../lib/download";

type Hook = {
  id: string; label: string; url: string; events: string[]; active: boolean;
  workspaceId: string | null; secretPreview: string; secret?: string; createdAt: string;
};
type Delivery = {
  id: string; webhookId: string; event: string; status: "pending" | "success" | "failed";
  attempts: number; responseStatus: number | null; responseSnippet: string | null;
  error: string | null; createdAt: string; deliveredAt: string | null;
};

/** Espejo del catálogo backend (services/webhookEvents.ts) — el test QA
 *  QA/api-webhooks.test.mjs compara ambos y rompe si se descarrilan. */
const WEBHOOK_EVENTS: Array<{ name: string; label: string }> = [
  { name: "template.created", label: "Plantilla creada" },
  { name: "template.updated", label: "Plantilla actualizada" },
  { name: "template.deleted", label: "Plantilla eliminada" },
  { name: "version.created", label: "Versión creada" },
  { name: "comment.created", label: "Comentario creado" },
  { name: "webhook.ping", label: "Ping de prueba" },
];

const API_ENDPOINTS: Array<{ method: string; path: string; desc: string }> = [
  { method: "GET", path: "/api/health", desc: "Healthcheck público" },
  { method: "GET", path: "/api/openapi.json", desc: "Spec OpenAPI 3.1 (importa en Postman/Make)" },
  { method: "GET", path: "/api/workspaces", desc: "Lista tus workspaces" },
  { method: "POST", path: "/api/workspaces", desc: "Crea un workspace" },
  { method: "GET", path: "/api/templates?limit=50", desc: "Lista plantillas (paginado)" },
  { method: "POST", path: "/api/templates", desc: "Crea una plantilla" },
  { method: "GET", path: "/api/templates/:id", desc: "Lee una plantilla completa" },
  { method: "PUT", path: "/api/templates/:id", desc: "Actualiza canvas/frames/html/css" },
  { method: "DELETE", path: "/api/templates/:id", desc: "Papelera (recuperable 30 días)" },
  { method: "GET", path: "/api/templates/:id/frames", desc: "Lista frames" },
  { method: "POST", path: "/api/templates/:id/frames", desc: "Crea un frame" },
  { method: "GET", path: "/api/templates/:id/render/:frameId", desc: "Render HTML → PNG/JPG/SVG" },
  { method: "POST", path: "/api/templates/:id/versions", desc: "Crea una versión (snapshot)" },
  { method: "GET", path: "/api/webhooks", desc: "Tus webhooks registrados" },
  { method: "POST", path: "/api/webhooks", desc: "Registra un webhook" },
  { method: "POST", path: "/api/webhooks/:id/test", desc: "Envía webhook.ping de prueba" },
  { method: "GET", path: "/api/webhooks/:id/deliveries", desc: "Log de entregas" },
  { method: "GET", path: "/api/webhooks/events", desc: "Catálogo de eventos" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="workspace-field"><span>{label}</span>{children}</label>;
}

function CopyButton({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <button type="button" className="workspace-link" onClick={() => { void navigator.clipboard.writeText(text); onCopy(); }}>
      Copiar
    </button>
  );
}

function CodeBlock({ code, onCopy }: { code: string; onCopy: () => void }) {
  return (
    <div style={{ position: "relative", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ position: "absolute", top: 6, right: 8 }}><CopyButton text={code} onCopy={onCopy} /></div>
      <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "rgba(255,255,255,0.75)" }}>{code}</pre>
    </div>
  );
}

const methodColor = (m: string) =>
  m === "GET" ? "#4ade80" : m === "POST" ? "#818cf8" : m === "PUT" || m === "PATCH" ? "#facc15" : "#f87171";

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="workspace-dialog" onClose={onClose}>
      <h3>{title}</h3><p>{body}</p>
      <div className="workspace-dialog-actions">
        <button type="button" className="workspace-button secondary" onClick={() => ref.current?.close()}>Cancelar</button>
        <button type="button" className="workspace-button danger" onClick={() => { onConfirm(); ref.current?.close(); }}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

export function ApiWebhooksSection({ workspaceId, onOpenAiKeys }: { workspaceId: string; onOpenAiKeys?: () => void }) {
  const [tab, setTab] = useState<"api" | "webhooks">("api");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  // Estables: los hijos los usan en deps de useCallback/useEffect.
  const flash = useCallback((msg: string) => { setNotice(msg); setError(""); }, []);
  const fail = useCallback((msg: string) => { setError(msg); setNotice(""); }, []);

  return (
    <>
      {(error || notice) && <p className={error ? "workspace-status error" : "workspace-status success"} role={error ? "alert" : "status"}>{error || notice}</p>}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["api", "webhooks"] as const).map(t => (
          <button
            key={t} type="button"
            className={tab === t ? "workspace-button" : "workspace-button secondary"}
            onClick={() => { setTab(t); setError(""); }}
          >
            {t === "api" ? "🔌 API REST" : "📡 Webhooks"}
          </button>
        ))}
      </div>
      {tab === "api"
        ? <ApiTab workspaceId={workspaceId} onOpenAiKeys={onOpenAiKeys} onFlash={flash} onFail={fail} />
        : <WebhooksTab workspaceId={workspaceId} onFlash={flash} onFail={fail} setConfirmAction={setConfirmAction} />}
      {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body} confirmLabel={confirmAction.label} onConfirm={confirmAction.run} onClose={() => setConfirmAction(null)} />}
    </>
  );
}

// ═══ Tab 1 · API ════════════════════════════════════════════════

function ApiTab({ workspaceId, onOpenAiKeys, onFlash, onFail }: { workspaceId: string; onOpenAiKeys?: () => void; onFlash: (m: string) => void; onFail: (m: string) => void }) {
  const base = typeof window !== "undefined" ? window.location.origin : "https://tu-dominio.com";
  const curl = `curl -X POST "${base}/api/templates" \\\n  -H "x-api-key: fdr_ws_TU_CLAVE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"workspaceId":"${workspaceId}","name":"Post IG — Lanzamiento","width":1080,"height":1080}'`;
  const verifySnippet = `// Node — verifica la firma de cada webhook entrante\nconst expected = "sha256=" + crypto.createHmac("sha256", MUSA_SECRET)\n  .update(\`\${timestamp}.\${rawBody}\`).digest("hex");\n// Compara con el header x-musa-signature (timing-safe) y acepta solo\n// si el timestamp tiene menos de 5 minutos.`;

  const downloadOpenApi = async () => {
    try {
      const res = await fetch("/api/openapi.json", { headers: getApiHeaders() });
      downloadBlob(new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" }), "musa-openapi.json");
      onFlash("Spec OpenAPI descargada.");
    } catch (cause: any) { onFail(cause?.message || "No se pudo descargar la spec."); }
  };

  return (
    <div className="workspace-grid">
      <article className="workspace-panel">
        <h3>Credenciales</h3>
        <p className="workspace-muted">Musa acepta dos formas de autenticación en todos los endpoints <code>/api/*</code>:</p>
        <div className="workspace-list">
          <div className="workspace-row">
            <div>
              <strong>x-api-key — clave de workspace</strong>
              <span>Claves <code>fdr_ws_…</code> con rol editor o viewer. Se crean en Invita IAs o aquí mismo.</span>
            </div>
            {onOpenAiKeys && <button type="button" className="workspace-button" onClick={onOpenAiKeys}>Crear clave</button>}
          </div>
          <div className="workspace-row">
            <div>
              <strong>Authorization: Bearer — tu sesión</strong>
              <span>El mismo access token de Supabase que usa el editor. Ideal para scripts con tu cuenta.</span>
            </div>
          </div>
        </div>
        <CodeBlock code={curl} onCopy={() => onFlash("cURL copiado.")} />
      </article>

      <article className="workspace-panel">
        <h3>Base URL y spec OpenAPI</h3>
        <p className="workspace-muted">Todos los ejemplos de esta página usan esta base. Cambia sola si trabajas en local.</p>
        <div className="workspace-secret" role="status"><code>{base}</code><CopyButton text={base} onCopy={() => onFlash("Base URL copiada.")} /></div>
        <p className="workspace-muted" style={{ marginTop: 12 }}>
          La spec OpenAPI 3.1 describe los endpoints principales con sus esquemas: impórtala en Postman,
          Insomnia o Make y tendrás la API navegando sin escribir nada.
        </p>
        <button type="button" className="workspace-button" onClick={() => void downloadOpenApi()}>Descargar openapi.json</button>
        <CodeBlock code={verifySnippet} onCopy={() => onFlash("Snippet de verificación copiado.")} />
      </article>

      <article className="workspace-panel span">
        <h3>Endpoints principales</h3>
        <div className="workspace-list">
          {API_ENDPOINTS.map(ep => (
            <div className="workspace-row" key={`${ep.method}${ep.path}`}>
              <div>
                <strong><span style={{ color: methodColor(ep.method), fontFamily: "monospace", marginRight: 8 }}>{ep.method}</span><code style={{ fontSize: 11 }}>{ep.path}</code></strong>
                <span>{ep.desc}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="workspace-muted">La referencia completa (con esquemas y errores) vive en <code>/api/openapi.json</code> y en <code>docs/API_WEBHOOKS.md</code>.</p>
      </article>

      <article className="workspace-panel">
        <h3>N8N</h3>
        <p className="workspace-muted">1) Credentials → <strong>Header Auth</strong>: <code>Name: x-api-key</code>, <code>Value: fdr_ws_…</code></p>
        <p className="workspace-muted">2) Nodo <strong>HTTP Request</strong> → método POST → URL <code>{base}/api/templates</code> → usa la credencial.</p>
        <p className="workspace-muted">3) Para RECIBIR eventos: nodo <strong>Webhook</strong> (método POST, producción) → pega su URL al crear un webhook en la pestaña de arriba. Filtra por <code>body.event</code> con un nodo IF.</p>
      </article>

      <article className="workspace-panel">
        <h3>Zapier</h3>
        <p className="workspace-muted">1) Zap → trigger <strong>Webhooks by Zapier → Catch Hook</strong> → copia la <em>custom webhook URL</em>.</p>
        <p className="workspace-muted">2) Pestaña Webhooks → crea el webhook con esa URL y tus eventos → pulsa «Enviar test» y Zapier mostrará el payload.</p>
        <p className="workspace-muted">3) Para ACCIONAR Musa: action <strong>Webhooks by Zapier → POST</strong> con header <code>x-api-key</code> y payload JSON.</p>
      </article>

      <article className="workspace-panel">
        <h3>Make</h3>
        <p className="workspace-muted">1) Scenario → módulo <strong>Webhooks → Custom webhook</strong> → copia la URL del hook.</p>
        <p className="workspace-muted">2) Regístrala en la pestaña Webhooks con tus eventos → «Enviar test» y Make detecta la estructura.</p>
        <p className="workspace-muted">3) Módulo <strong>HTTP → Make a request</strong> hacia <code>{base}/api/…</code> con header <code>x-api-key</code> para operar Musa desde tus escenarios.</p>
      </article>
    </div>
  );
}

// ═══ Tab 2 · Webhooks ═══════════════════════════════════════════

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(getApiHeaders());
  new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
  const res = await fetch(url, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload;
}

function WebhooksTab({ workspaceId, onFlash, onFail, setConfirmAction }: {
  workspaceId: string;
  onFlash: (m: string) => void;
  onFail: (m: string) => void;
  setConfirmAction: (a: { title: string; body: string; label: string; run: () => void } | null) => void;
}) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["template.created"]);
  const [onlyThisWs, setOnlyThisWs] = useState(false);
  const [newSecret, setNewSecret] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // includeSecret=1: el dueño necesita el secreto completo para
      // verificar firmas en su receptor — se muestra bajo demanda.
      const result = await apiFetch<{ data: Hook[] }>("/api/webhooks?includeSecret=1");
      setHooks(result.data || []);
    } catch (cause: any) { onFail(cause?.message || "No se pudo cargar tus webhooks."); }
    setLoading(false);
  }, [onFail]);

  useEffect(() => { void load(); }, [load]);

  const loadDeliveries = useCallback(async (hookId: string) => {
    try {
      const result = await apiFetch<{ data: Delivery[] }>(`/api/webhooks/${hookId}/deliveries?limit=15`);
      setDeliveries(result.data || []);
    } catch { setDeliveries([]); }
  }, []);

  useEffect(() => { if (selected) void loadDeliveries(selected); }, [selected, loadDeliveries]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const result = await apiFetch<{ data: Hook }>("/api/webhooks", {
        method: "POST",
        body: JSON.stringify({ label: label || undefined, url, events, workspaceId: onlyThisWs ? workspaceId : null }),
      });
      setNewSecret(result.data.secret || "");
      setLabel(""); setUrl(""); setEvents(["template.created"]); setOnlyThisWs(false);
      onFlash("Webhook creado. Guarda el secreto: lo necesitas para verificar la firma.");
      await load();
    } catch (cause: any) { onFail(cause?.message || "No se pudo crear el webhook."); }
  };

  const toggle = (hook: Hook) => setConfirmAction({
    title: hook.active ? "Desactivar webhook" : "Activar webhook",
    body: hook.active
      ? `«${hook.label}» dejará de recibir eventos hasta que lo reactives. El historial se conserva.`
      : `«${hook.label}» volverá a recibir los eventos suscritos.`,
    label: hook.active ? "Desactivar" : "Activar",
    run: async () => {
      try { await apiFetch(`/api/webhooks/${hook.id}`, { method: "PATCH", body: JSON.stringify({ active: !hook.active }) }); await load(); if (selected === hook.id) void loadDeliveries(hook.id); } catch { /* noop */ }
    },
  });

  const remove = (hook: Hook) => setConfirmAction({
    title: "Eliminar webhook",
    body: `«${hook.label}» y todo su historial de entregas se borran definitivamente.`,
    label: "Eliminar",
    run: async () => {
      try { await apiFetch(`/api/webhooks/${hook.id}`, { method: "DELETE" }); if (selected === hook.id) { setSelected(null); setDeliveries([]); } await load(); onFlash("Webhook eliminado."); } catch { /* noop */ }
    },
  });

  const test = async (hook: Hook) => {
    setBusyId(hook.id);
    try {
      const result = await apiFetch<{ data: Delivery }>(`/api/webhooks/${hook.id}/test`, { method: "POST" });
      const d = result.data;
      onFlash(d.status === "success"
        ? `Test entregado ✓ (HTTP ${d.responseStatus})`
        : `Test falló: ${d.error || `HTTP ${d.responseStatus ?? "?"}`} — revisa la URL y que el receptor responda 2xx`);
      if (selected === hook.id) void loadDeliveries(hook.id);
    } catch (cause: any) { onFlash(cause.message); }
    setBusyId(null);
  };

  const retry = async (hookId: string, deliveryId: string) => {
    setBusyId(deliveryId);
    try {
      await apiFetch(`/api/webhooks/${hookId}/deliveries/${deliveryId}/retry`, { method: "POST" });
      await loadDeliveries(hookId);
    } catch { /* noop */ }
    setBusyId(null);
  };

  const regenerate = (hook: Hook) => setConfirmAction({
    title: "Regenerar secreto",
    body: `El secreto de «${hook.label}» cambia ahora: tu receptor debe usar el nuevo o las firmas no validarán.`,
    label: "Regenerar",
    run: async () => {
      try {
        const result = await apiFetch<{ data: { secret: string } }>(`/api/webhooks/${hook.id}/regenerate`, { method: "POST" });
        setNewSecret(result.data.secret);
        await load();
        onFlash("Secreto regenerado.");
      } catch { /* noop */ }
    },
  });

  const statusDot = (s: Delivery["status"]) =>
    s === "success" ? "#4ade80" : s === "failed" ? "#f87171" : "#facc15";

  return (
    <div className="workspace-grid">
      <article className="workspace-panel">
        <h3>Nuevo webhook</h3>
        <p className="workspace-muted">Musa POSTea un JSON firmado (HMAC-SHA256 en <code>x-musa-signature</code>) a tu URL por cada evento suscrito. Reintenta solo: 1m → 5m → 30m → 2h → 6h.</p>
        <form className="workspace-form" onSubmit={create}>
          <Field label="Nombre">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="N8N de marketing" maxLength={80} />
          </Field>
          <Field label="URL de destino (https)">
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://n8n.tu-dominio.com/webhook/musa" required />
          </Field>
          <Field label="Eventos">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {WEBHOOK_EVENTS.map(ev => {
                const on = events.includes(ev.name);
                return (
                  <button
                    key={ev.name} type="button"
                    className={on ? "workspace-button" : "workspace-button secondary"}
                    style={{ fontSize: 11, padding: "4px 10px" }}
                    aria-pressed={on}
                    title={ev.name}
                    onClick={() => setEvents(prev => on ? prev.filter(x => x !== ev.name) : [...prev, ev.name])}
                  >
                    {ev.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Alcance">
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <input type="checkbox" checked={onlyThisWs} onChange={e => setOnlyThisWs(e.target.checked)} id="wh-ws-scope" />
              <label htmlFor="wh-ws-scope">Solo eventos de este workspace</label>
            </div>
          </Field>
          <button className="workspace-button" disabled={!url || events.length === 0}>Crear webhook</button>
        </form>
        {newSecret && (
          <div className="workspace-secret" role="status">
            <strong>Secreto nuevo — cópialo ahora.</strong>
            <code>{newSecret}</code>
            <CopyButton text={newSecret} onCopy={() => onFlash("Secreto copiado.")} />
          </div>
        )}
      </article>

      <article className="workspace-panel span">
        <h3>Tus webhooks {hooks.length > 0 && <span className="workspace-muted">({hooks.length})</span>}</h3>
        {loading ? <p className="workspace-muted">Cargando…</p> : hooks.length === 0
          ? <p className="workspace-muted">Todavía no registras webhooks. Crea el primero: pega la URL de un escenario N8N, un Catch Hook de Zapier o un Custom webhook de Make.</p>
          : (
            <div className="workspace-list">
              {hooks.map(hook => (
                <div className="workspace-row" key={hook.id} style={{ flexWrap: "wrap" }}>
                  <div style={{ minWidth: 220 }}>
                    <strong>{hook.active ? "🟢" : "⚪"} {hook.label}</strong>
                    <span><code style={{ fontSize: 10 }}>{hook.url}</code></span>
                    <span>{hook.events.length} evento(s) · secreto <code style={{ fontSize: 10 }}>{hook.secretPreview}</code>{hook.workspaceId ? " · 1 workspace" : " · todos los workspaces"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="workspace-button" disabled={busyId === hook.id} onClick={() => void test(hook)}>Enviar test</button>
                    <button type="button" className="workspace-link" onClick={() => setSelected(selected === hook.id ? null : hook.id)} aria-expanded={selected === hook.id}>
                      {selected === hook.id ? "Ocultar entregas" : "Ver entregas"}
                    </button>
                    <button type="button" className="workspace-link" onClick={() => toggle(hook)}>{hook.active ? "Desactivar" : "Activar"}</button>
                    <button type="button" className="workspace-link" onClick={() => regenerate(hook)}>Regenerar secreto</button>
                    {hook.secret && <CopyButton text={hook.secret} onCopy={() => onFlash("Secreto copiado.")} />}
                    <button type="button" className="workspace-link danger" onClick={() => remove(hook)}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </article>

      {selected && (
        <article className="workspace-panel span">
          <h3>Entregas recientes <span className="workspace-muted">— últimos 15 intentos</span></h3>
          {deliveries.length === 0 ? <p className="workspace-muted">Sin entregas todavía: dispara un evento o pulsa «Enviar test».</p> : (
            <div className="workspace-list">
              {deliveries.map(d => (
                <div className="workspace-row" key={d.id} style={{ flexWrap: "wrap" }}>
                  <div style={{ minWidth: 200 }}>
                    <strong><span style={{ color: statusDot(d.status) }}>●</span> {d.event}</strong>
                    <span>
                      {new Date(d.createdAt).toLocaleString()} · intento {d.attempts}/5
                      {d.responseStatus != null && ` · HTTP ${d.responseStatus}`}
                      {d.deliveredAt ? " · entregado" : d.status === "pending" ? " · pendiente (el cron de Cloudflare lo procesa)" : " · fallido"}
                    </span>
                    {(d.error || d.responseSnippet) && (
                      <span style={{ maxWidth: 480, overflowWrap: "anywhere" }}>{d.error || `Respuesta: ${d.responseSnippet}`}</span>
                    )}
                  </div>
                  {d.status !== "success" && (
                    <button type="button" className="workspace-link" disabled={busyId === d.id} onClick={() => void retry(d.webhookId, d.id)}>Reintentar</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
      )}
    </div>
  );
}
