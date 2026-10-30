/**
 * PlanearViews.tsx — vistas de PLANEAR con datos reales (apiV2/planear.ts).
 * planear/calendario ← GET /api/content · planear/investigacion ←
 * GET /api/research/sources + /api/research/items.
 */
import { loadPlanear } from "../../lib/apiV2";
import type { CalendarEntry, ResearchItem, ResearchSource } from "../../lib/apiV2/planear";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, pick, str } from "./helpers";
import type { V2ViewProps } from "../router";

/** planear/calendario — piezas del content calendar con fecha/canal/estado. */
export function PlanearCalendario({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadPlanear), [workspaceId]);
  const calendar: CalendarEntry[] = data ? data.calendar : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        calendar.length === 0 ? (
          <DsCard span={12}>
            <DataState state="empty" message="Calendario vacío: programa o publica piezas para llenarlo." />
          </DsCard>
        ) : (
          <DsCard span={12}>
            <DsCardTitle hint={`${calendar.length} piezas`}>Calendario de contenidos</DsCardTitle>
            <DsTable
              rows={calendar}
              rowKey={(r, i) => str(pick(r, ["id"]), `fila-${i}`)}
              cols={[
                { label: "Pieza", cell: r => str(pick(r, ["title", "name", "id"])) },
                { label: "Canal", cell: r => str(pick(r, ["channel", "provider", "network"])) },
                { label: "Estado", cell: r => str(pick(r, ["status", "state"])) },
                { label: "Fecha", cell: r => fmtDate(pick(r, ["scheduledAt", "publishAt", "date", "scheduled_at", "createdAt"])) },
              ]}
            />
          </DsCard>
        )
      ) : null}
    </div>
  );
}

/** planear/investigacion — fuentes de research y hallazgos (REQ-051). */
export function PlanearInvestigacion({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadPlanear), [workspaceId]);
  const sources: ResearchSource[] = data ? data.researchSources : [];
  const items: ResearchItem[] = data ? data.researchItems : [];
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
            <DsCardTitle hint={`${sources.length}`}>Fuentes</DsCardTitle>
            {sources.length === 0 ? (
              <DataState state="empty" message="Aún no hay fuentes de research registradas." />
            ) : (
              <DsTable
                rows={sources}
                rowKey={(r, i) => str(pick(r, ["id"]), `f-${i}`)}
                cols={[
                  { label: "Fuente", cell: r => str(pick(r, ["name", "title", "url", "id"])) },
                  { label: "Tipo", cell: r => str(pick(r, ["type", "kind"])) },
                ]}
              />
            )}
          </DsCard>
          <DsCard span={7}>
            <DsCardTitle hint={`${items.length} ítems`}>Hallazgos</DsCardTitle>
            {items.length === 0 ? (
              <DataState state="empty" message="Sin hallazgos todavía." />
            ) : (
              <DsTable
                rows={items}
                rowKey={(r, i) => str(pick(r, ["id"]), `i-${i}`)}
                cols={[
                  { label: "Título", cell: r => str(pick(r, ["title", "name", "summary", "id"])) },
                  { label: "Estado", cell: r => str(pick(r, ["status", "state"])) },
                  { label: "Fecha", cell: r => fmtDate(pick(r, ["createdAt", "created_at", "date"])) },
                ]}
              />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}
