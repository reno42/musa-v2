/**
 * ConfiguracionViews.tsx — vistas de CONFIGURACIÓN con datos reales.
 * configuracion/espacios + configuracion/equipo ← apiV2/organizacion.ts.
 * configuracion/integraciones ← apiV2/conversar.ts fetchSocialIntegrations.
 * configuracion/cuenta ← apiV2/configuracion.ts fetchAccount (/api/account/me).
 * configuracion/conecta ← fetchLlmKeys (/api/keys) + fetchSocialIntegrations.
 * configuracion/apis ← fetchWebhooks (/api/webhooks) + estado de conexiones.
 * El resto de subs sigue en placeholder (ver shell-v2/NEEDS.md).
 */
import { useState } from "react";
import { fetchAccount, fetchLlmKeys, fetchPapelera, fetchSocialIntegrations, fetchWebhooks, loadOrganizacion, restoreFromTrash } from "../../lib/apiV2";
import type { LlmKeyStatus, TrashTemplate } from "../../lib/apiV2";
import type { WorkspaceMember, WorkspaceSummary } from "../../lib/apiV2";
import type { SocialConnection } from "../../lib/apiV2/conversar";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, pick, str } from "./helpers";
import { ConnectionsTable } from "./ConversarViews";
import type { V2ViewProps } from "../router";

/** configuracion/espacios — workspaces del usuario con su rol. */
export function ConfiguracionEspacios({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadOrganizacion), [workspaceId]);
  const workspaces: WorkspaceSummary[] = data ? data.workspaces : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <DsCard span={12}>
          <DsCardTitle hint={`${workspaces.length} espacios`}>Tus espacios</DsCardTitle>
          {workspaces.length === 0 ? (
            <DataState state="empty" message="Aún no perteneces a ningún espacio." />
          ) : (
            <DsTable
              rows={workspaces}
              rowKey={(r, i) => `${r.id}-${i}`}
              cols={[
                { label: "Espacio", cell: r => str(pick(r, ["name", "slug", "id"])) },
                { label: "Tu rol", cell: r => str(pick(r, ["role"])) },
                { label: "Creado", cell: r => fmtDate(pick(r, ["createdAt", "created_at"])) },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

/** configuracion/equipo — miembros del workspace actual. */
export function ConfiguracionEquipo({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadOrganizacion), [workspaceId]);
  const members: WorkspaceMember[] = data ? data.members : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <DsCard span={12}>
          <DsCardTitle hint={`${members.length} miembros`}>Equipo</DsCardTitle>
          {members.length === 0 ? (
            <DataState state="empty" message="Sin miembros listados para este espacio." />
          ) : (
            <DsTable
              rows={members}
              rowKey={(r, i) => `${str(pick(r, ["id", "userId"]), String(i))}-${i}`}
              cols={[
                { label: "Email", cell: r => str(pick(r, ["email", "userId"])) },
                { label: "Rol", cell: r => str(pick(r, ["role"])) },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

/** Fila clave/valor reutilizable (patrón del resumen de inicio). */
function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: "1px solid var(--ds-border)", fontSize: 12 }}>
      <span style={{ color: "var(--ds-muted)" }}>{label}</span>
      <b style={{ color: "var(--ds-bright)", fontWeight: 500, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</b>
    </div>
  );
}

/** configuracion/cuenta — perfil de la sesión (GET /api/account/me → user_profiles). */
export function ConfiguracionCuenta({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => fetchAccount(), []);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <>
          <DsCard span={5}>
            <DsCardTitle hint="sesión actual">Perfil</DsCardTitle>
            <KvRow label="Nombre" value={str(pick(data, ["display_name", "first_name", "last_name"]), "Sin nombre")} />
            <KvRow label="Email" value={str(data.email)} />
            <KvRow label="Marca propia" value={str(data.brand_name)} />
            <KvRow label="Teléfono" value={str(data.phone)} />
            <KvRow label="Sitio web" value={str(data.website)} />
          </DsCard>
          <DsCard span={7}>
            <DsCardTitle hint="user_profiles">Estado de la cuenta</DsCardTitle>
            <KvRow label="Plan de acceso" value={str(data.access_plan)} />
            <KvRow label="NDA" value={data.nda_accepted_at ? `aceptado ${fmtDate(data.nda_accepted_at)}` : "pendiente"} />
            <KvRow label="Onboarding" value={data.onboarding_completed ? "completado" : "pendiente"} />
            <KvRow label="Código de referido" value={str(data.referral_code)} />
            <KvRow label="Espacio activo" value={workspaceId ?? "—"} />
            <KvRow label="Cuenta creada" value={fmtDate(data.created_at)} />
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

/** Proveedores IA que el chat soporta (id → etiqueta; misma familia que aiProviders). */
const LLM_LABELS: Record<string, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  moonshot: "Moonshot",
  qwen: "Qwen",
  zhipu: "Zhipu (Z.ai)",
  openrouter: "OpenRouter",
};

/** configuracion/conecta — proveedores IA (BYOK) + redes sociales conectadas. */
export function ConfiguracionConecta({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(
    () =>
      requireWs(workspaceId, async (ws) => {
        const [keys, social] = await Promise.all([fetchLlmKeys(), fetchSocialIntegrations(ws)]);
        return { keys, social };
      }),
    [workspaceId]
  );

  const keyRows = data
    ? Array.from(new Set([...Object.keys(LLM_LABELS), ...Object.keys(data.keys)])).map((p) => ({
        provider: p,
        label: LLM_LABELS[p] ?? p,
        ...(data.keys[p] ?? {} as LlmKeyStatus),
      }))
    : [];
  const configured = keyRows.filter(r => r.configured).length;
  const social = data ? data.social : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <>
          <DsCard span={7}>
            <DsCardTitle hint={`${configured}/${keyRows.length} configuradas`}>Proveedores de IA (BYOK)</DsCardTitle>
            {keyRows.length === 0 ? (
              <DataState state="empty" message="Sin proveedores registrados." />
            ) : (
              <DsTable
                rows={keyRows}
                rowKey={(r) => r.provider}
                cols={[
                  { label: "Proveedor", cell: r => str(r.label) },
                  {
                    label: "Estado",
                    cell: r => (
                      <span style={{ color: r.configured ? "var(--ds-verde)" : "var(--ds-muted)" }}>
                        {r.configured ? "configurada" : "sin key"}
                      </span>
                    ),
                  },
                  { label: "Modelo", cell: r => str(r.model) },
                  { label: "Key", cell: r => (r.last4 ? `•••• ${r.last4}` : "—") },
                ]}
              />
            )}
          </DsCard>
          <DsCard span={5}>
            <DsCardTitle hint={`${social.length}`}>Redes sociales</DsCardTitle>
            {social.length === 0 ? (
              <DataState state="empty" message="Ninguna red conectada todavía." />
            ) : (
              <ConnectionsTable rows={social} />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

/** configuracion/apis — superficie de integración: webhooks salientes + conexiones activas. */
export function ConfiguracionApis({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(
    () =>
      requireWs(workspaceId, async (ws) => {
        const [hooks, keys, social] = await Promise.all([
          fetchWebhooks(),
          fetchLlmKeys(),
          fetchSocialIntegrations(ws),
        ]);
        return { hooks, keys, social };
      }),
    [workspaceId]
  );

  const hooks = data ? data.hooks : [];
  const iaOk = data ? Object.values(data.keys).filter(k => k.configured).length : 0;
  const socialOk = data ? data.social.filter(c => c.connected).length : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <>
          <DsCard span={4}>
            <DsCardTitle hint="conexiones activas">Resumen</DsCardTitle>
            <KvRow label="Proveedores IA" value={`${iaOk} con key configurada`} />
            <KvRow label="Redes sociales" value={`${socialOk} conectadas`} />
            <KvRow label="Webhooks salientes" value={String(hooks.length)} />
          </DsCard>
          <DsCard span={8}>
            <DsCardTitle hint={`${hooks.length} hooks · de la cuenta`}>Webhooks salientes</DsCardTitle>
            {hooks.length === 0 ? (
              <DataState state="empty" message="Sin webhooks: registra uno para recibir eventos (version.created, etc.)." />
            ) : (
              <DsTable
                rows={hooks}
                rowKey={(r, i) => `${str(r.id, String(i))}-${i}`}
                cols={[
                  { label: "Etiqueta", cell: r => str(pick(r, ["label", "id"])) },
                  { label: "URL", cell: r => str(r.url) },
                  { label: "Eventos", cell: r => (Array.isArray(r.events) ? r.events.join(", ") : "—") },
                  {
                    label: "Activo",
                    cell: r => (
                      <span style={{ color: r.active ? "var(--ds-verde)" : "var(--ds-muted)" }}>
                        {r.active ? "sí" : "no"}
                      </span>
                    ),
                  },
                  { label: "Creado", cell: r => fmtDate(pick(r, ["createdAt", "created_at"])) },
                ]}
              />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

/** configuracion/integraciones — integraciones sociales conectadas. */
export function ConfiguracionIntegraciones({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchSocialIntegrations), [workspaceId]);
  const connections: SocialConnection[] = data ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <DsCard span={12}>
          <DsCardTitle hint={`${connections.length}`}>Integraciones</DsCardTitle>
          {connections.length === 0 ? (
            <DataState state="empty" message="Ninguna integración social conectada todavía." />
          ) : (
            <ConnectionsTable rows={connections} />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

/** configuracion/papelera — diseños borrados (soft-delete, GET /api/templates/trash). */
export function ConfiguracionPapelera({ meta }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => fetchPapelera(100, 0), []);
  const borrados: TrashTemplate[] = data ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restaurar = async (id: string) => {
    setBusyId(id);
    setRestoreError(null);
    try {
      await restoreFromTrash(id);
      reload();
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : "No se pudo restaurar el diseño");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <DsCard span={12}>
          <DsCardTitle hint={`${borrados.length} borrados · purga automática a los 30 días`}>Papelera</DsCardTitle>
          {restoreError ? (
            <div
              role="alert"
              style={{
                padding: "9px 12px",
                borderRadius: "var(--ds-radius-sm)",
                background: "var(--ds-accent-dim)",
                color: "var(--ds-text)",
                fontSize: 12,
                fontFamily: "var(--ds-font-sans)",
                marginBottom: 12,
              }}
            >
              {restoreError}
            </div>
          ) : null}
          {borrados.length === 0 ? (
            <DataState state="empty" message="Papelera vacía: los diseños que borres aparecen aquí y se purgan solos a los 30 días." />
          ) : (
            <DsTable
              rows={borrados}
              rowKey={(r, i) => `${r.id}-${i}`}
              cols={[
                { label: "Diseño", cell: r => str(pick(r, ["name", "title", "id"])) },
                { label: "Borrado", cell: r => fmtDate(pick(r, ["deleted_at"])) },
                {
                  label: "",
                  cell: r => {
                    const busy = busyId === r.id;
                    return (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => restaurar(r.id)}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--ds-border-2)",
                          color: busy ? "var(--ds-muted)" : "var(--ds-bright)",
                          borderRadius: "var(--ds-radius-pill)",
                          padding: "4px 12px",
                          cursor: busyId !== null ? "default" : "pointer",
                          font: `400 11px/1 var(--ds-font-sans)`,
                        }}
                      >
                        {busy ? "Restaurando…" : "Restaurar"}
                      </button>
                    );
                  },
                },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}
