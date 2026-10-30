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

/** Color de estado de aprobación (solo tokens). */
function approvalTone(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s.startsWith("aprob")) return "var(--ds-verde)";
  if (s.startsWith("rechaz")) return "var(--ds-rojo)";
  if (s.includes("pend")) return "var(--ds-warn)";
  return "var(--ds-muted)";
}

/** organizacion/agencias — agencias externas y sus accesos (workspace_agencies). */
export function AgenciasView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchAgencies), [workspaceId]);
  const rows: WorkspaceAgency[] = data ?? [];

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
          <DsCardTitle hint={`${rows.length} agencias`}>Agencias externas</DsCardTitle>
          {rows.length === 0 ? (
            <DataState state="empty" message="Sin agencias registradas: las agencias con acceso al workspace aparecen aquí." />
          ) : (
            <DsTable
              rows={rows}
              rowKey={(r) => r.id}
              cols={[
                { label: "Agencia", cell: r => str(r.name) },
                { label: "Plan", cell: r => str(r.plan) },
                { label: "Marcas", cell: r => (Array.isArray(r.brands) && r.brands.length ? r.brands.join(", ") : "—") },
                { label: "Miembros", cell: r => String(r.member_count ?? 0) },
                { label: "Desde", cell: r => fmtDate(r.created_at) },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

/** organizacion/aprobaciones — cola de aprobación (workspace_approvals). */
export function AprobacionesView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchApprovals), [workspaceId]);
  const rows: WorkspaceApproval[] = data ?? [];
  const pendientes = rows.filter(r => (r.status || "").toLowerCase().includes("pend")).length;

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
          <DsCardTitle hint={`${rows.length} piezas · ${pendientes} pendientes`}>Aprobaciones</DsCardTitle>
          {rows.length === 0 ? (
            <DataState state="empty" message="Sin aprobaciones: las piezas enviadas a revisión de Marketing aparecen aquí." />
          ) : (
            <DsTable
              rows={rows}
              rowKey={(r) => r.id}
              cols={[
                { label: "Pieza", cell: r => str(r.piece_name ?? r.piece_id) },
                { label: "Marca", cell: r => str(r.brand_name) },
                { label: "Solicitó", cell: r => str(r.requested_by) },
                {
                  label: "Estado",
                  cell: r => <span style={{ color: approvalTone(r.status) }}>{str(r.status, "sin estado")}</span>,
                },
                { label: "Solicitada", cell: r => fmtDate(r.requested_at) },
                { label: "Decidida", cell: r => fmtDate(r.decided_at ?? undefined) },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

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
