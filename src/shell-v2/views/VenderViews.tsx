/**
 * VenderViews.tsx — vistas VENDER del shell-v2 con datos reales.
 * Fuente: apiV2/vender.ts (tablas Supabase crm_deals / crm_contacts / brands
 * vía PostgREST con la sesión del usuario — RLS aplica).
 */
import { DEAL_STAGES, fetchBrands, fetchContacts, fetchDeals, groupDealsByStage } from "../../lib/apiV2";
import type { CrmBrand, CrmContact, CrmDeal } from "../../lib/apiV2/vender";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, fmtMoney, str } from "./helpers";
import type { V2ViewProps } from "../router";

/** Etiquetas ES de los stages reales de crm_deals. */
const STAGE_LABEL: Record<string, string> = {
  discovery: "Descubrimiento",
  proposal: "Propuesta",
  negotiation: "Negociación",
  closed_won: "Ganado",
  closed_lost: "Perdido",
};

/** Color de etapa (solo tokens). */
const STAGE_COLOR: Record<string, string> = {
  discovery: "var(--ds-azul)",
  proposal: "var(--ds-accent)",
  negotiation: "var(--ds-warn)",
  closed_won: "var(--ds-verde)",
  closed_lost: "var(--ds-rojo)",
};

/** vender/oportunidades — kanban de oportunidades (tabla crm_deals). */
export function OportunidadesKanban({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchDeals), [workspaceId]);
  const deals: CrmDeal[] = data ?? [];
  const byStage = groupDealsByStage(deals);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <DsCard span={12}>
          <DsCardTitle hint={`${deals.length} oportunidades`}>Pipeline</DsCardTitle>
          {deals.length === 0 ? (
            <DataState state="empty" message="Sin oportunidades en este espacio todavía. Las que se registren en el CRM aparecen aquí por etapa." />
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", paddingBottom: 4 }}>
              {DEAL_STAGES.map((stage) => {
                const col = byStage[stage] ?? [];
                // La suma de columna solo mezcla montos USD (o sin moneda):
                // sumar monedas distintas engañaría.
                const usdSum = col
                  .filter(d => !d.currency || d.currency.toUpperCase() === "USD")
                  .reduce((acc, d) => acc + Number(d.final_value ?? d.value ?? 0), 0);
                return (
                  <div
                    key={stage}
                    style={{
                      flex: "1 1 0", minWidth: 205,
                      background: "var(--ds-panel-2)",
                      borderRadius: "var(--ds-radius-md)",
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: `400 11px/1 var(--ds-font-display)`, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--ds-bright)" }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: STAGE_COLOR[stage] ?? "var(--ds-muted)" }} />
                        {STAGE_LABEL[stage] ?? stage}
                      </span>
                      <b style={{ color: "var(--ds-muted)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{col.length}</b>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ds-muted)", fontVariantNumeric: "tabular-nums", marginBottom: 10, fontFamily: "var(--ds-font-sans)" }}>
                      {fmtMoney(usdSum, "USD")} <span style={{ opacity: 0.7 }}>solo USD</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {col.map((d) => {
                        const prob = d.probability == null ? null : Math.round(Number(d.probability) * 100);
                        return (
                          <div key={d.id} style={{ background: "var(--ds-card-bg)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-sm)", padding: "10px 12px" }}>
                            <div title={d.title} style={{ color: "var(--ds-bright)", fontSize: 12.5, fontFamily: "var(--ds-font-sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 5 }}>
                              {d.title}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: "var(--ds-text)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--ds-font-sans)" }}>
                              <span>{fmtMoney(d.final_value ?? d.value, d.currency ?? "USD")}</span>
                              {prob != null ? <span title="Probabilidad">{prob}%</span> : null}
                            </div>
                            {d.expected_close_date ? (
                              <div style={{ marginTop: 5, fontSize: 11, color: "var(--ds-muted)", fontFamily: "var(--ds-font-sans)" }}>
                                Cierre {fmtDate(d.expected_close_date)}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {col.length === 0 ? (
                        <div style={{ padding: "16px 0", textAlign: "center", color: "var(--ds-muted)", fontSize: 11.5, fontFamily: "var(--ds-font-sans)" }}>
                          —
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DsCard>
      )}
    </div>
  );
}

/** vender/personas — tabla de contactos CRM (tabla crm_contacts). */
export function PersonasTabla({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchContacts), [workspaceId]);
  const contacts: CrmContact[] = data ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <DsCard span={12}>
          <DsCardTitle hint={`${contacts.length} contactos`}>Personas</DsCardTitle>
          {contacts.length === 0 ? (
            <DataState state="empty" message="Sin contactos en este espacio todavía." />
          ) : (
            <DsTable
              rows={contacts}
              rowKey={r => r.id}
              cols={[
                {
                  label: "Nombre",
                  cell: r => {
                    const nombre = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
                    return str(nombre || r.email || r.id);
                  },
                },
                { label: "Email", cell: r => str(r.email) },
                { label: "Empresa", cell: r => str(r.company ?? r.brand_name) },
                { label: "Cargo", cell: r => str(r.job_title) },
                { label: "Estado", cell: r => str(r.status) },
                { label: "Etiquetas", cell: r => (r.tags && r.tags.length > 0 ? r.tags.join(", ") : "—") },
              ]}
            />
          )}
        </DsCard>
      )}
    </div>
  );
}

/** vender/empresas — cuentas/marcas del CRM (tabla brands). */
export function EmpresasTabla({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchBrands), [workspaceId]);
  const brands: CrmBrand[] = data ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <DsCard span={12}>
          <DsCardTitle hint={`${brands.length} cuentas`}>Empresas</DsCardTitle>
          {brands.length === 0 ? (
            <DataState state="empty" message="Sin marcas registradas en este espacio todavía." />
          ) : (
            <DsTable
              rows={brands}
              rowKey={r => r.id}
              cols={[
                { label: "Marca", cell: r => str(r.name) },
                { label: "Relación", cell: r => str(r.relationship_status) },
                { label: "Prioridad", cell: r => str(r.crm_priority) },
                { label: "Salud", cell: r => str(r.account_health) },
                { label: "Último contacto", cell: r => fmtDate(r.last_contacted_at ?? undefined) },
                { label: "Próximo follow-up", cell: r => fmtDate(r.next_follow_up_at ?? undefined) },
              ]}
            />
          )}
        </DsCard>
      )}
    </div>
  );
}
