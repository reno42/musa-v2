/**
 * APIs/Webhooks — sección de Configuración (WorkspaceConsole)
 * ──────────────────────────────────────────────────────────────
 * Una sola superficie para conectar Musa con el mundo exterior:
 *
 *   · API REST   — crea y revoca claves de workspace aquí mismo
 *                  (mismos endpoints que «Invita IAs»), guía de
 *                  autenticación, referencia de endpoints agrupada
 *                  y recetas colapsadas para N8N, Zapier y Make.
 *   · Webhooks   — alta/baja de webhooks salientes, suscripción
 *                  por evento, test en vivo (webhook.ping),
 *                  secreto HMAC y log de entregas con reintentos.
 *
 * Regla de maquetación (feedback v60): la pestaña API se lee en UNA
 * columna, de arriba a abajo, con pasos numerados — nada de adivinar
 * qué mitad es la buena. La pestaña Webhooks es formulario a la
 * izquierda y lista a la derecha, con estado vacío explicado (nunca
 * un hueco en blanco). Íconos SVG, sin emojis.
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
type ApiKey = { id: string; label: string; key_prefix: string; role: string; kind?: string; last_used_at?: string; created_at: string };

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

/** Referencia agrupada por recurso — qué hace exactamente cada endpoint.
 *  El detalle fino (parámetros, esquemas, errores) vive en /api/openapi.json. */
const ENDPOINT_GROUPS: Array<{ group: string; endpoints: Array<{ method: string; path: string; desc: string }> }> = [
  {
    group: "Workspaces",
    endpoints: [
      { method: "GET", path: "/api/workspaces", desc: "Lista los workspaces accesibles con tus credenciales." },
      { method: "POST", path: "/api/workspaces", desc: "Crea un workspace nuevo (una marca o cliente)." },
    ],
  },
  {
    group: "Plantillas — tus diseños",
    endpoints: [
      { method: "GET", path: "/api/templates?limit=50&offset=0", desc: "Lista plantillas, las más recientes primero (paginado)." },
      { method: "POST", path: "/api/templates", desc: "Crea una plantilla: nombre y tamaño (p. ej. 1080×1080 para un post de IG)." },
      { method: "GET", path: "/api/templates/:id", desc: "Lee una plantilla completa: frames, canvas y metadatos." },
      { method: "PUT", path: "/api/templates/:id", desc: "Actualiza nombre, tamaño, canvas, frames, HTML o CSS." },
      { method: "DELETE", path: "/api/templates/:id", desc: "La envía a papelera — recuperable durante 30 días." },
    ],
  },
  {
    group: "Frames — páginas o artboards de una plantilla",
    endpoints: [
      { method: "GET", path: "/api/templates/:id/frames", desc: "Lista los frames de una plantilla." },
      { method: "POST", path: "/api/templates/:id/frames", desc: "Añade un frame nuevo con nombre y tamaño." },
      { method: "GET", path: "/api/templates/:id/render/:frameId?format=png", desc: "Renderiza un frame a PNG, JPG o SVG — la imagen final lista para publicar." },
    ],
  },
  {
    group: "Versiones — historial",
    endpoints: [
      { method: "GET", path: "/api/templates/:id/versions", desc: "Lista las versiones guardadas de una plantilla." },
      { method: "POST", path: "/api/templates/:id/versions", desc: "Guarda un snapshot del estado actual." },
      { method: "POST", path: "/api/templates/:id/versions/:versionId/restore", desc: "Restaura la plantilla a una versión anterior." },
    ],
  },
  {
    group: "Webhooks — eventos salientes",
    endpoints: [
      { method: "GET", path: "/api/webhooks", desc: "Lista tus webhooks registrados." },
      { method: "POST", path: "/api/webhooks", desc: "Registra un webhook: URL de destino + eventos a los que suscribirte." },
      { method: "POST", path: "/api/webhooks/:id/test", desc: "Envía un evento webhook.ping de prueba a tu URL." },
      { method: "GET", path: "/api/webhooks/:id/deliveries", desc: "Log de entregas: intentos, respuesta HTTP y errores." },
      { method: "POST", path: "/api/webhooks/:id/deliveries/:deliveryId/retry", desc: "Reintenta una entrega fallida." },
      { method: "POST", path: "/api/webhooks/:id/regenerate", desc: "Rota el secreto HMAC del webhook (el viejo deja de validar)." },
      { method: "GET", path: "/api/webhooks/events", desc: "Catálogo de eventos disponibles (público, sin clave)." },
    ],
  },
];

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

function CopyButton({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <button type="button" className="workspace-link" onClick={() => { void navigator.clipboard.writeText(text); onCopy(); }}>
      Copiar
    </button>
  );
}

/** Enmascarado de secretos — feedback v60.2: «deberían estar ocultas y si el
 *  usuario presiona un botón de copiar, la copia pero sin verla tampoco».
 *  El valor completo JAMÁS se pinta en pantalla: solo el botón Copiar lo
 *  toca (directo al portapapeles). */
function maskValue(value: string, head = 6) {
  return value.length > head + 4 ? `${value.slice(0, head)}…${value.slice(-4)}` : "••••••";
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

/** Rayito — el ícono de esta sección también en las pestañas internas
 *  (feedback v60: el tacho de basura no decía nada y el enchufe ya
 *  pertenece a «Mis integraciones»). */
function BoltIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function KeyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

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

export function ApiWebhooksSection({ workspaceId }: { workspaceId: string }) {
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
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            onClick={() => { setTab(t); setError(""); }}
          >
            {t === "api" ? <KeyIcon /> : <BoltIcon />}
            <span>{t === "api" ? "API REST" : "Webhooks"}</span>
          </button>
        ))}
      </div>
      {tab === "api"
        ? <ApiTab workspaceId={workspaceId} onFlash={flash} onFail={fail} setConfirmAction={setConfirmAction} />
        : <WebhooksTab workspaceId={workspaceId} onFlash={flash} onFail={fail} setConfirmAction={setConfirmAction} />}
      {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body} confirmLabel={confirmAction.label} onConfirm={confirmAction.run} onClose={() => setConfirmAction(null)} />}
    </>
  );
}

// ═══ Tab 1 · API REST — una columna, pasos numerados ════════════

function ApiTab({ workspaceId, onFlash, onFail, setConfirmAction }: {
  workspaceId: string;
  onFlash: (m: string) => void;
  onFail: (m: string) => void;
  setConfirmAction: (a: { title: string; body: string; label: string; run: () => void } | null) => void;
}) {
  const base = typeof window !== "undefined" ? window.location.origin : "https://tu-dominio.com";
  // Claves del workspace — los mismos endpoints que usa «Invita IAs»,
  // pero gestionadas aquí para no sacarte de la sección a mitad de flujo.
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keyLabel, setKeyLabel] = useState("");
  const [keyRole, setKeyRole] = useState("editor");
  const [rawKey, setRawKey] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(true);

  const curl = `curl -X POST "${base}/api/templates" \\\n  -H "x-api-key: fdr_ws_TU_CLAVE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"workspaceId":"${workspaceId}","name":"Post IG — Lanzamiento","width":1080,"height":1080}'`;
  // v55: llaveros separados — aquí solo se listan las claves de scope REST;
  // las MCP (Invita IAs) viven en su sección. Filas sin kind (pre-v55) son
  // claves de agentes y no se muestran aquí.
  const restKeys = keys.filter(key => key.kind === "rest");

  const loadKeys = useCallback(async () => {
    try {
      const result = await apiFetch<{ data: ApiKey[] }>(`/api/workspaces/${workspaceId}/api-keys`);
      setKeys(result.data || []);
    } catch (cause: any) { onFail(cause?.message || "No se pudieron cargar tus claves."); }
    setLoadingKeys(false);
  }, [workspaceId, onFail]);

  useEffect(() => { void loadKeys(); }, [loadKeys]);

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await apiFetch<{ data: { key: string } }>(`/api/workspaces/${workspaceId}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ label: keyLabel, role: keyRole, kind: "rest" }),
      });
      setRawKey(result.data.key);
      setKeyLabel("");
      onFlash("Clave creada. Cópiala ahora: no volverá a mostrarse.");
      await loadKeys();
    } catch (cause: any) { onFail(cause?.message || "No se pudo crear la clave."); }
  };

  const revoke = (key: ApiKey) => setConfirmAction({
    title: "Revocar clave",
    body: `La clave «${key.label}» (${key.key_prefix}) dejará de funcionar inmediatamente. Los scripts que la usen recibirán 401.`,
    label: "Revocar",
    run: async () => {
      try { await apiFetch(`/api/workspaces/${workspaceId}/api-keys/${key.id}`, { method: "DELETE" }); await loadKeys(); onFlash("Clave revocada."); }
      catch (cause: any) { onFail(cause?.message || "No se pudo revocar la clave."); }
    },
  });

  const downloadOpenApi = async () => {
    try {
      const res = await fetch("/api/openapi.json", { headers: getApiHeaders() });
      downloadBlob(new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" }), "musa-openapi.json");
      onFlash("Spec OpenAPI descargada.");
    } catch (cause: any) { onFail(cause?.message || "No se pudo descargar la spec."); }
  };

  return (
    <div className="workspace-grid">
      {/*
        PASO 1 — la acción principal va primero y sin navegación:
        crear la clave aquí mismo (feedback v60: el botón que saltaba a
        «Invita IAs» cambiaba de página sin razón aparente).
      */}
      <article className="workspace-panel span">
        <h3>1 · Crea tu clave API</h3>
        <p className="workspace-muted">
          Una clave identifica a una integración (N8N, Zapier, Make, tu script) con permiso de
          <strong> editor</strong> —puede diseñar— o <strong>viewer</strong> —solo lectura— sobre este workspace.
        </p>
        <p className="workspace-muted" style={{ marginTop: 6 }}>
          Llaveros separados (v55): estas claves son de scope <strong>REST</strong> — el MCP las rechaza con
          <code> key_wrong_scope</code>. Las claves para tus IAs (Cursor, Claude) se crean en Invita IAs.
        </p>
        <form className="workspace-form" onSubmit={createKey}>
          <div className="workspace-form-row">
            <Field label="Nombre de la integración">
              <input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="N8N de marketing" required />
            </Field>
            <Field label="Permiso">
              <select value={keyRole} onChange={e => setKeyRole(e.target.value)}>
                <option value="editor">Puede diseñar</option>
                <option value="viewer">Solo lectura</option>
              </select>
            </Field>
            <button className="workspace-button">Crear clave</button>
          </div>
        </form>
        {rawKey && (
          <div className="workspace-secret" role="status">
            <strong>Clave creada — cópiala con el botón: no volverá a mostrarse.</strong>
            <code style={{ fontSize: 11 }}>{maskValue(rawKey, 12)}</code>
            <CopyButton text={rawKey} onCopy={() => onFlash("Clave copiada al portapapeles (sin mostrarse).")} />
          </div>
        )}
      </article>

      {/*
        PASO 2 — con clave en mano, la llamada. Autenticación y ejemplo
        juntas: lo que se copia vive cerca de lo que se lee.
      */}
      <article className="workspace-panel span">
        <h3>2 · Haz tu primera llamada</h3>
        <div className="workspace-list">
          <div className="workspace-row">
            <div>
              <strong><code>x-api-key: fdr_ws_…</code></strong>
              <span>La clave que creaste en el paso 1. Así se autentican N8N, Zapier, Make y cualquier script.</span>
            </div>
          </div>
          <div className="workspace-row">
            <div>
              <strong><code>Authorization: Bearer …</code></strong>
              <span>Tu sesión del editor; útil para probar desde la consola del navegador sin crear clave.</span>
            </div>
          </div>
        </div>
        <p className="workspace-muted" style={{ marginTop: 12 }}>Base URL — todos los ejemplos la usan; cambia sola si trabajas en local:</p>
        <div className="workspace-secret" role="status"><code>{base}</code><CopyButton text={base} onCopy={() => onFlash("Base URL copiada.")} /></div>
        <CodeBlock code={curl} onCopy={() => onFlash("cURL copiado.")} />
      </article>

      {/*
        PASO 3 — la referencia que faltaba: qué hace exactamente cada
        endpoint, agrupada por recurso. La spec OpenAPI queda a un clic
        para quien quiera esquemas y errores.
      */}
      <article className="workspace-panel span">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>3 · Referencia de endpoints</h3>
          <button type="button" className="workspace-button secondary" onClick={() => void downloadOpenApi()}>Descargar openapi.json</button>
        </div>
        <p className="workspace-muted">
          Qué hace cada endpoint, agrupado por recurso. Para esquemas de request/response e importar en
          Postman, Insomnia o Make, descarga la spec OpenAPI 3.1.
        </p>
        {ENDPOINT_GROUPS.map(group => (
          <div key={group.group} style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>{group.group}</h3>
            <div className="workspace-list">
              {group.endpoints.map(ep => (
                <div className="workspace-row" key={`${ep.method}${ep.path}`}>
                  <div>
                    <strong>
                      <span style={{ color: methodColor(ep.method), fontFamily: "monospace", fontSize: 10, marginRight: 8 }}>{ep.method}</span>
                      <code style={{ fontSize: 11 }}>{ep.path}</code>
                    </strong>
                    <span>{ep.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </article>

      {/*
        PASO 4 — recetas colapsadas: existen para quien las necesita
        sin convertir la página en un muro de texto (feedback v60:
        la maquetación anterior intimidaba).
      */}
      <article className="workspace-panel span">
        <h3>4 · Recetas: N8N, Zapier y Make</h3>
        <details style={{ borderTop: "1px solid #27272a", padding: "10px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>N8N — crear plantillas y recibir eventos</summary>
          <p className="workspace-muted" style={{ marginTop: 8 }}>Para LLAMAR a Musa: Credentials → <strong>Header Auth</strong> (<code>Name: x-api-key</code>, <code>Value: fdr_ws_…</code>). Nodo HTTP Request → POST → <code>{base}/api/templates</code> con la credencial.</p>
          <p className="workspace-muted">Para RECIBIR eventos: nodo Webhook (POST, producción) → pega su URL en la pestaña Webhooks de arriba. Filtra por <code>body.event</code> con un nodo IF.</p>
        </details>
        <details style={{ borderTop: "1px solid #27272a", padding: "10px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Zapier — catch hook y acciones</summary>
          <p className="workspace-muted" style={{ marginTop: 8 }}>Para RECIBIR eventos: trigger <strong>Webhooks by Zapier → Catch Hook</strong> → copia la custom webhook URL → créala en la pestaña Webhooks → «Enviar test» y Zapier muestra el payload.</p>
          <p className="workspace-muted">Para LLAMAR a Musa: action <strong>Webhooks by Zapier → POST</strong> con header <code>x-api-key</code> y payload JSON.</p>
        </details>
        <details style={{ borderTop: "1px solid #27272a", borderBottom: "1px solid #27272a", padding: "10px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Make — custom webhook y HTTP</summary>
          <p className="workspace-muted" style={{ marginTop: 8 }}>Para RECIBIR eventos: módulo <strong>Webhooks → Custom webhook</strong> → copia la URL → regístrala en la pestaña Webhooks → «Enviar test» y Make detecta la estructura.</p>
          <p className="workspace-muted">Para LLAMAR a Musa: módulo <strong>HTTP → Make a request</strong> hacia <code>{base}/api/…</code> con header <code>x-api-key</code>.</p>
        </details>
      </article>

      {/*
        PASO 5 — el llavero va AL FINAL (feedback v60.2: «deberían estar
        al final y ocultas»). La página se lee de arriba a abajo: crear,
        llamar, referenciar, recetas… y el inventario de claves al cierre.
        Valores siempre enmascarados; la clave completa solo existe en el
        momento de creación y se copia sin mostrarse (nunca se vuelve a
        pintar ni re-copiar después: si se pierde, se revoca y se crea otra).
      */}
      <article className="workspace-panel span">
        <h3>5 · Tus claves REST {restKeys.length > 0 && <span className="workspace-muted">({restKeys.length})</span>}</h3>
        {loadingKeys ? <p className="workspace-muted">Cargando…</p> : restKeys.length === 0
          ? <p className="workspace-muted">Todavía no tienes claves REST — crea la primera con el formulario del paso 1.</p>
          : (
            <div className="workspace-list">
              {restKeys.map(key => (
                <div className="workspace-row" key={key.id}>
                  <div>
                    <strong>{key.label}</strong>
                    <span>
                      <code style={{ fontSize: 10 }}>{key.key_prefix}</code> · {key.role === "viewer" ? "solo lectura" : "puede diseñar"}
                      {key.last_used_at ? ` · último uso ${new Date(key.last_used_at).toLocaleDateString()}` : " · sin uso todavía"}
                    </span>
                  </div>
                  <button type="button" className="workspace-link danger" onClick={() => revoke(key)}>Revocar</button>
                </div>
              ))}
            </div>
          )}
        <p className="workspace-muted" style={{ marginTop: 10 }}>
          Por seguridad el valor completo no se vuelve a mostrar ni re-copiar después de crearlo: si lo perdiste, revoca la clave y crea otra.
        </p>
      </article>
    </div>
  );
}

// ═══ Tab 2 · Webhooks — formulario a la izquierda, lista a la derecha ═══

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
        ? `Test entregado (HTTP ${d.responseStatus})`
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

  const statusColor = (s: Delivery["status"] | "active" | "inactive") =>
    s === "success" || s === "active" ? "#4ade80" : s === "failed" ? "#f87171" : s === "pending" ? "#facc15" : "#a1a1aa";

  const verifySnippet = `// Node — verifica la firma de cada webhook entrante\nconst expected = "sha256=" + crypto.createHmac("sha256", MUSA_SECRET)\n  .update(\`\${timestamp}.\${rawBody}\`).digest("hex");\n// Compara con el header x-musa-signature (timing-safe) y acepta solo\n// si el timestamp tiene menos de 5 minutos.`;

  return (
    <div className="workspace-grid">
      {/* IZQUIERDA — crear. El checkbox de alcance FUERA de .workspace-field:
          esa clase fuerza width:100% a los inputs y partía la fila. */}
      <article className="workspace-panel">
        <h3>Nuevo webhook</h3>
        <p className="workspace-muted">Musa POSTea un JSON firmado (HMAC-SHA256 en <code>x-musa-signature</code>) a tu URL por cada evento suscrito. Reintenta solo: 1m → 5m → 30m → 2h → 6h.</p>
        <form className="workspace-form" onSubmit={create}>
          <Field label="Nombre (opcional)">
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
          <div>
            <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#c6cbd6", marginBottom: 6 }}>Alcance</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#a1a1aa", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={onlyThisWs}
                onChange={e => setOnlyThisWs(e.target.checked)}
                style={{ width: "auto", margin: 0, padding: 0, accentColor: "#f4f4f5" }}
              />
              Solo eventos de este workspace (si lo dejas vacío, todos)
            </label>
          </div>
          <button className="workspace-button" disabled={!url || events.length === 0}>Crear webhook</button>
        </form>
        {newSecret && (
          <div className="workspace-secret" role="status">
            <strong>Secreto nuevo — cópialo con el botón: no volverá a mostrarse.</strong>
            <code style={{ fontSize: 11 }}>{maskValue(newSecret)}</code>
            <CopyButton text={newSecret} onCopy={() => onFlash("Secreto copiado al portapapeles (sin mostrarse).")} />
          </div>
        )}
      </article>

      {/* DERECHA — la lista vive en la misma fila que el formulario: la
          celda nunca queda vacía (estado vacío explicado, feedback v60). */}
      <article className="workspace-panel">
        <h3>Tus webhooks {hooks.length > 0 && <span className="workspace-muted">({hooks.length})</span>}</h3>
        {loading ? <p className="workspace-muted">Cargando…</p> : hooks.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8, padding: "26px 10px", color: "#a1a1aa" }}>
            <span style={{ color: "#52525b" }}><BoltIcon size={28} /></span>
            <strong style={{ color: "#e4e4e7", fontSize: 13 }}>Aquí aparecerán tus webhooks</strong>
            <p className="workspace-muted" style={{ margin: 0 }}>
              Crea el primero con el formulario de la izquierda: pega la URL de un escenario de N8N,
              un Catch Hook de Zapier o un Custom webhook de Make, elige los eventos y listo.
              Musa enviará un JSON firmado por cada evento.
            </p>
          </div>
        ) : (
          <div className="workspace-list">
            {hooks.map(hook => (
              <div className="workspace-row" key={hook.id} style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 200 }}>
                  <strong><span style={{ color: statusColor(hook.active ? "active" : "inactive"), marginRight: 6 }}>●</span>{hook.label}</strong>
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
                    <strong><span style={{ color: statusColor(d.status) }}>●</span> {d.event}</strong>
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

      {/* La verificación de firma pertenece a esta pestaña (antes vivía
          en la de API, donde no se aplicaba). Colapsada: solo la abre
          quien esté implementando su receptor. */}
      <article className="workspace-panel span">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Verificar la firma en tu receptor (HMAC-SHA256)</summary>
          <p className="workspace-muted" style={{ marginTop: 8 }}>Cada entrega trae <code>x-musa-signature</code> y <code>x-musa-timestamp</code>. Verifica así antes de procesar el body:</p>
          <CodeBlock code={verifySnippet} onCopy={() => onFlash("Snippet de verificación copiado.")} />
        </details>
      </article>
    </div>
  );
}
