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
