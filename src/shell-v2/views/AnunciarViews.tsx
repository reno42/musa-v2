/**
 * AnunciarViews.tsx — vistas ANUNCIAR del shell-v2 con datos reales.
 * Fuente: apiV2/anunciar.ts (tabla campaigns + brands) y apiV2/vender.ts
 * (crm_contacts / crm_deals para las derivas de audiencias y presupuesto).
 */
import { buildAudiences, fetchBrands, fetchCampaigns, fetchContacts, fetchDeals } from "../../lib/apiV2";
import type { Campaign } from "../../lib/apiV2/anunciar";
import type { CrmBrand } from "../../lib/apiV2/vender";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, fmtMoney, str } from "./helpers";
import type { V2ViewProps } from "../router";

const nf = new Intl.NumberFormat("es-PE");

/** Etiquetas ES de estados de contacto (fuente de las audiencias hoy). */
const STATUS_LABEL: Record<string, string> = {
  lead: "Leads",
  active: "Activos",
  inactive: "Inactivos",
  "sin estado": "Sin estado",
};

/** anunciar/campanas — campañas de pauta del workspace (tabla campaigns). */
export function CampanasView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(
    () =>
      requireWs(workspaceId, async (id) => {
        const [campaigns, brands] = await Promise.all([fetchCampaigns(id), fetchBrands(id)]);
        return { campaigns, brands };
      }),
    [workspaceId]
  );
  const campaigns: Campaign[] = data?.campaigns ?? [];
  const brandName = new Map<string, string>((data?.brands ?? []).map(b => [b.id, b.name]));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <DsCard span={12}>
          <DsCardTitle hint={`${campaigns.length} campañas`}>Campañas</DsCardTitle>
          {campaigns.length === 0 ? (
            <DataState state="empty" message="Sin campañas de pauta en este espacio todavía." />
          ) : (
            <DsTable
              rows={campaigns}
              rowKey={r => r.id}
              cols={[
                { label: "Campaña", cell: r => str(r.name) },
                { label: "Marca", cell: r => (r.brand_id ? str(brandName.get(r.brand_id) ?? "(sin nombre)") : "Sin marca") },
                { label: "Tipo", cell: r => str(r.campaign_type) },
                { label: "Estado", cell: r => str(r.status) },
                { label: "Brief", cell: r => str(r.brief) },
                { label: "Creada", cell: r => fmtDate(r.created_at) },
              ]}
            />
          )}
        </DsCard>
      )}
    </div>
  );
}

/** anunciar/audiencias — audiencias derivadas del estado de crm_contacts. */
export function AudienciasView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchContacts), [workspaceId]);
  const contacts = data ?? [];
  const audiences = buildAudiences(contacts);
  const max = Math.max(...audiences.map(a => a.cantidad), 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <>
          <DsCard span={4}>
            <DsCardTitle>Contactos</DsCardTitle>
            <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
              {nf.format(contacts.length)}
            </b>
            <p style={{ color: "var(--ds-muted)", fontSize: 12, fontFamily: "var(--ds-font-sans)", lineHeight: 1.5, margin: "10px 0 0" }}>
              Base actual del CRM de este espacio. Las audiencias de pauta se
              derivan del estado de cada contacto — cuando exista una tabla de
              segmentos (NEEDS) se conecta aquí.
            </p>
          </DsCard>
          <DsCard span={8}>
            <DsCardTitle hint="derivada de crm_contacts.status">Audiencias por estado</DsCardTitle>
            {audiences.length === 0 ? (
              <DataState state="empty" message="Sin contactos todavía: la audiencia se construye con tu CRM." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                {audiences.map(a => {
                  const pct = max > 0 ? Math.max((a.cantidad / max) * 100, 4) : 0;
                  return (
                    <div key={a.fuente}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontFamily: "var(--ds-font-sans)", fontSize: 12 }}>
                        <span style={{ color: "var(--ds-bright)" }}>{STATUS_LABEL[a.fuente] ?? a.fuente}</span>
                        <b style={{ color: "var(--ds-muted)", fontVariantNumeric: "tabular-nums" }}>{nf.format(a.cantidad)}</b>
                      </div>
                      <div style={{ height: 22, background: "var(--ds-panel-2)", borderRadius: "var(--ds-radius-pill)", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--ds-accent)", borderRadius: "var(--ds-radius-pill)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DsCard>
        </>
      )}
    </div>
  );
}
