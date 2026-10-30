/**
 * AgentesViews.tsx — vista agentes/computadoras con datos reales
 * (apiV2/agentes.ts → GET /api/ghost/jobs + /api/ghost/summary, router
 * aditivo de solo lectura). agentes/chats sigue en placeholder (NEEDS.md).
 */
import { loadAgentes } from "../../lib/apiV2";
import type { GhostJob } from "../../lib/apiV2/agentes";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, str } from "./helpers";
import { RowAction } from "./CrearViews";
import type { V2ViewProps } from "../router";

const nf = new Intl.NumberFormat("es-PE");

/** agentes/computadoras — sesiones de agentes IA (ghost jobs) y su resumen. */
export function AgentesComputadoras({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadAgentes), [workspaceId]);
  const jobs: GhostJob[] = data ? data.jobs : [];
  const summary = data?.summary;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data && summary ? (
        <>
          <DsCard span={4}>
            <DsCardTitle>Sesiones</DsCardTitle>
            <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
              {nf.format(summary.total)}
            </b>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
              {Object.entries(summary.byStatus).map(([status, n]) => (
                <div key={status} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--ds-border)", padding: "7px 0", fontSize: 12 }}>
                  <span style={{ color: "var(--ds-muted)" }}>{status}</span>
                  <b style={{ color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>{nf.format(n)}</b>
                </div>
              ))}
            </div>
          </DsCard>
          <DsCard span={8}>
            <DsCardTitle hint={`${jobs.length} registros`}>Jobs de agentes</DsCardTitle>
            {jobs.length === 0 ? (
              <DataState state="empty" message="Ningún agente ha trabajado en este espacio todavía." />
            ) : (
              <DsTable
                rows={jobs}
                rowKey={r => r.id}
                cols={[
                  { label: "Tarea", cell: r => str(r.task ?? r.id) },
                  { label: "Modo", cell: r => str(r.mode) },
                  { label: "Estado", cell: r => str(r.status) },
                  { label: "Creado", cell: r => fmtDate(r.created_at) },
                  {
                    label: "",
                    cell: r => {
                      const url = typeof r.link === "string" && r.link !== "" ? r.link : null;
                      return url ? <RowAction label="Ver" onClick={() => window.open(url, "_blank", "noopener")} /> : "—";
                    },
                  },
                ]}
              />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}
