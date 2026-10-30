// apiV2/anunciar.ts — datos de las vistas ANUNCIAR del shell-v2.
// Fuentes reales: tabla Supabase campaigns (name, status, campaign_type, brief,
// brand_id, workspace_id) + brands para agrupar por marca + crm_deals.final_value
// como resultado asociado por campaign_id. RLS aplica con la sesión del usuario.
import { getData } from "./client";
import { fetchBrands, type CrmBrand } from "./vender";

export interface Campaign {
  id: string;
  workspace_id: string;
  name: string;
  status?: string | null;
  campaign_type?: string | null;
  brief?: string | null;
  brand_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchCampaigns(workspaceId: string, limit = 200): Promise<Campaign[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: "id,workspace_id,name,status,campaign_type,brief,brand_id,created_at,updated_at",
    order: "updated_at.desc",
    limit: String(limit),
  });
  return getData<Campaign[]>(`/rest/v1/campaigns?${qs}`);
}

/** Vista por marca: campaigns agrupadas + nombre de la marca resuelto. */
export interface CampaignsByBrand {
  brandId: string;
  brandName: string;
  campaigns: Campaign[];
}

export function groupCampaignsByBrand(campaigns: Campaign[], brands: CrmBrand[]): CampaignsByBrand[] {
  const nameOf = new Map(brands.map((b) => [b.id, b.name]));
  const out = new Map<string, CampaignsByBrand>();
  for (const c of campaigns) {
    const key = c.brand_id || "(sin marca)";
    if (!out.has(key)) out.set(key, { brandId: key, brandName: nameOf.get(key) || "(sin marca)", campaigns: [] });
    out.get(key)!.campaigns.push(c);
  }
  return [...out.values()].sort((a, b) => a.brandName.localeCompare(b.brandName));
}

// ── Audiencias: deriva de contactos por status/tags (fuente real hoy) ──
export interface AudienceSummary {
  fuente: string;
  cantidad: number;
}

export function buildAudiences(
  contacts: { status?: string | null; tags?: string[] | null }[]
): AudienceSummary[] {
  const out = new Map<string, number>();
  for (const c of contacts) {
    const key = c.status || "sin estado";
    out.set(key, (out.get(key) || 0) + 1);
  }
  return [...out.entries()]
    .map(([fuente, cantidad]) => ({ fuente, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

// ── Presupuesto: asociación campaigns ↔ deals (campaign_id en deals) ──
export interface BudgetRow {
  brandName: string;
  campaignName: string;
  periodo: string | null;
  asignadoUsd: number;
  resultadoUsd: number;
}

export function buildBudget(
  campaigns: Campaign[],
  brands: CrmBrand[],
  deals: { campaign_id?: string | null; final_value?: number | null; value?: number | null; currency?: string | null }[]
): BudgetRow[] {
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const valueByCampaign = new Map<string, number>();
  for (const d of deals) {
    if (!d.campaign_id) continue;
    valueByCampaign.set(d.campaign_id, (valueByCampaign.get(d.campaign_id) || 0) + Number(d.final_value ?? d.value ?? 0));
  }
  return campaigns.map((c) => ({
    brandName: (c.brand_id && brandName.get(c.brand_id)) || "(sin marca)",
    campaignName: c.name,
    periodo: null,
    asignadoUsd: 0, // sin columna de presupuesto asignado aún (NEEDS: presupuesto plan)
    resultadoUsd: Math.round(valueByCampaign.get(c.id) || 0),
  }));
}

/** Paquete de la vista ANUNCIAR. */
export interface AnunciarData {
  campaigns: Campaign[];
  brands: CrmBrand[];
}

export async function loadAnunciar(
  workspaceId: string,
  deps?: { contacts?: { status?: string | null; tags?: string[] | null }[]; deals?: { campaign_id?: string | null; final_value?: number | null; value?: number | null }[] }
): Promise<AnunciarData> {
  const [campaigns, brands] = await Promise.all([
    fetchCampaigns(workspaceId),
    fetchBrands(workspaceId),
  ]);
  void deps; // las derivas (audiencias/presupuesto) se computan en la vista con buildAudiences/buildBudget
  return { campaigns, brands };
}
