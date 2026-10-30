/**
 * OrganizacionF3Views.tsx — vistas de ORGANIZACIÓN sumadas en F3 con datos reales.
 * Fuente: apiV2/organizacion.ts (tablas workspace_* de Hermes:
 * F3-hermes-aditivas.sql, RLS por workspace — patrón crm_deals).
 * organizacion/plantillas sigue en placeholder (ver shell-v2/NEEDS.md).
 */
import { fetchAgencies, fetchAreas, fetchApprovals } from "../../lib/apiV2";
import type { WorkspaceAgency, WorkspaceArea, WorkspaceApproval } from "../../lib/apiV2";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, str } from "./helpers";
import type { V2ViewProps } from "../router";

/** organizacion/areas — áreas internas del workspace (workspace_areas). */
export function AreasView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchAreas), [workspaceId]);
  const areas: WorkspaceArea[] = data ?? [];
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
          <DsCardTitle hint={`${areas.length} áreas`}>Áreas internas</DsCardTitle>
          {areas.length === 0 ? (
            <DataState state="empty" message="Sin áreas registradas: crea las áreas del workspace para organizar al equipo." />
          ) : (
            <DsTable
              rows={areas}
              rowKey={(r) => r.id}
              cols={[
                { label: "Área", cell: r => str(r.name) },
                { label: "Líder", cell: r => str(r.lead_name) },
                { label: "Integrantes", cell: r => String(r.member_count ?? 0) },
                { label: "Creada", cell: r => fmtDate(r.created_at) },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}
