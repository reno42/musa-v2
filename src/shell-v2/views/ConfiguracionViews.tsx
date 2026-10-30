/**
 * ConfiguracionViews.tsx — vistas de CONFIGURACIÓN con datos reales.
 * configuracion/espacios + configuracion/equipo ← apiV2/organizacion.ts.
 * configuracion/integraciones ← apiV2/conversar.ts fetchSocialIntegrations.
 * configuracion/cuenta ← apiV2/configuracion.ts fetchAccount (/api/account/me).
 * El resto de subs sigue en placeholder (ver shell-v2/NEEDS.md).
 */
import { fetchAccount, fetchSocialIntegrations, loadOrganizacion } from "../../lib/apiV2";
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
