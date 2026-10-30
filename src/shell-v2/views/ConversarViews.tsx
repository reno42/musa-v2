/**
 * ConversarViews.tsx — vistas de CONVERSAR con datos reales.
 * conversar/bandeja ← apiV2/conversar.ts (integraciones sociales + inbox).
 * conversar/comentarios ← apiV2/vender.ts fetchShares (GET /api/comments-share).
 */
import { fetchSocialIntegrations, loadConversar } from "../../lib/apiV2";
import { fetchShares, type ShareStat } from "../../lib/apiV2/vender";
import type { InboxItem, SocialConnection } from "../../lib/apiV2/conversar";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, pick, str } from "./helpers";
import type { V2ViewProps } from "../router";

/** Tabla compartida de conexiones sociales (bandeja + configuracion/integraciones). */
export function ConnectionsTable({ rows }: { rows: SocialConnection[] }) {
  return (
    <DsTable
      rows={rows}
      rowKey={(r, i) => `${r.provider}-${i}`}
      cols={[
        { label: "Proveedor", cell: r => str(r.provider) },
        {
          label: "Estado",
          cell: r => (
            <span style={{ color: r.connected ? "var(--ds-verde)" : "var(--ds-muted)" }}>
              {r.connected ? "conectada" : "desconectada"}
            </span>
          ),
        },
        { label: "Cuentas", cell: r => String(Array.isArray(r.accounts) ? r.accounts.length : 0) },
      ]}
    />
  );
}

/** conversar/bandeja — canales conectados + inbox unificado (lo que existe hoy). */
export function ConversarBandeja({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadConversar), [workspaceId]);
  const connections: SocialConnection[] = data ? data.connections : [];
  const inbox: InboxItem[] = data ? data.inbox : [];
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
            <DsCardTitle hint={`${connections.length}`}>Canales</DsCardTitle>
            {connections.length === 0 ? (
              <DataState state="empty" message="Conecta una red social desde configuracion/integraciones." />
            ) : (
              <ConnectionsTable rows={connections} />
            )}
          </DsCard>
          <DsCard span={7}>
            <DsCardTitle hint={`${inbox.length} mensajes`}>Bandeja</DsCardTitle>
            {inbox.length === 0 ? (
              <DataState state="empty" message="Sin mensajes: la bandeja unifica DMs y comentarios de tus redes conectadas." />
            ) : (
              <DsTable
                rows={inbox}
                rowKey={(r, i) => `${r.id}-${i}`}
                cols={[
                  { label: "Autor", cell: r => str(r.author) },
                  { label: "Mensaje", cell: r => str(r.text) },
                  { label: "Canal", cell: r => str(r.provider) },
                  { label: "Fecha", cell: r => fmtDate(pick(r, ["createdAt", "created_at"])) },
                ]}
              />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

/** conversar/comentarios — comentarios de diseño compartidos (commentShare). */
export function ConversarComentarios({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => fetchShares(workspaceId ?? undefined), [workspaceId]);
  const shares: ShareStat[] = data ?? [];
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
          <DsCardTitle hint={`${shares.length}`}>Comentarios compartidos</DsCardTitle>
          {shares.length === 0 ? (
            <DataState state="empty" message="Sin comentarios compartidos todavía." />
          ) : (
            <DsTable
              rows={shares}
              rowKey={(r, i) => `${str(pick(r, ["id"]), String(i))}-${i}`}
              cols={[
                { label: "Comentario", cell: r => str(pick(r, ["id"])) },
                { label: "Autor", cell: r => str(pick(r, ["author", "user", "createdBy", "created_by"])) },
                { label: "Fecha", cell: r => fmtDate(pick(r, ["createdAt", "created_at"])) },
                {
                  label: "",
                  cell: r => {
                    const url = pick(r, ["url", "shareUrl", "share_url"]);
                    return typeof url === "string" ? (
                      <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--ds-accent)", fontSize: 12 }}>
                        Ver
                      </a>
                    ) : (
                      "—"
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
