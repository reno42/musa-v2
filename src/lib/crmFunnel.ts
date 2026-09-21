/**
 * Pure funnel math for the CRM «Embudo» view — no React, no fetches, so the
 * QA suite can import it directly. The funnel mirrors the kanban's open
 * stages 1:1 («Perdido» stays outside the funnel as leakage) and counts
 * DEALS per stage with a per-brand breakdown. v52: the unit is always the
 * brand — creative work is B2B (there is no quote without a brand), so the
 * old "personas" mode is gone. The two views keep their lenses: Embudo reads
 * as marketing (how each brand flows through the stages) and Ventas as
 * commercial (deal-by-deal negotiation).
 */

export type DealStage =
  | "discovery"
  | "proposal"
  | "negotiation"
  | "approved"
  | "in_production"
  | "review"
  | "ready"
  | "delivered"
  | "lost";

/** Open pipeline stages, in kanban column order — «lost» is not one of them. */
export const FUNNEL_STAGES: ReadonlyArray<{ value: DealStage; label: string }> = [
  { value: "discovery", label: "Discovery" },
  { value: "proposal", label: "Propuesta" },
  { value: "negotiation", label: "Negociación" },
  { value: "approved", label: "Aprobado" },
  { value: "in_production", label: "En producción" },
  { value: "review", label: "Revisión" },
  { value: "ready", label: "Listo" },
  { value: "delivered", label: "Entregado" },
];

/** Every kanban stage, including the «Perdido» column. */
export const ALL_DEAL_STAGES: ReadonlyArray<{ value: DealStage; label: string }> = [
  ...FUNNEL_STAGES,
  { value: "lost", label: "Perdido" },
];

export type FunnelBrand = { id: string; name: string };
export type FunnelContact = { id: string; first_name: string; last_name?: string | null };

export type FunnelDeal = {
  id: string;
  brand_id: string;
  stage: string;
  title: string;
  value?: number | null;
  currency?: string;
  primary_contact_id?: string | null;
};

export type FunnelRow = {
  stage: DealStage;
  label: string;
  /** Deals sitting in this stage — every deal belongs to a brand (B2B). */
  count: number;
  /** All deals sitting in the stage, for the drill-down panel. */
  deals: FunnelDeal[];
  /** Deal count per brand, highest first — feeds the stacked bar segments. */
  byBrand: Array<{ brandId: string; name: string; count: number }>;
  /** count ÷ previous stage count; null on the first stage or after a zero one. */
  conversionFromPrev: number | null;
};

export type FunnelResult = {
  rows: FunnelRow[];
  /** «Perdido» deals live outside the funnel as leakage. */
  lost: { count: number; value: number };
  /** Bottom-of-funnel ÷ top-of-funnel; null when the funnel starts empty. */
  endToEnd: number | null;
};

export function contactName(contact: FunnelContact): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ");
}

export function buildFunnel(
  deals: FunnelDeal[],
  brands: FunnelBrand[],
): FunnelResult {
  const brandNames = new Map(brands.map((brand): [string, string] => [brand.id, brand.name]));
  const lostDeals = deals.filter((deal) => deal.stage === "lost");

  const rows: FunnelRow[] = FUNNEL_STAGES.map((stage) => {
    const stageDeals = deals.filter((deal) => deal.stage === stage.value);
    const countsByBrand = new Map<string, number>();
    for (const deal of stageDeals) countsByBrand.set(deal.brand_id, (countsByBrand.get(deal.brand_id) || 0) + 1);
    const byBrand = [...countsByBrand.entries()]
      .map(([brandId, count]) => ({ brandId, name: brandNames.get(brandId) || "Marca", count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return {
      stage: stage.value,
      label: stage.label,
      count: stageDeals.length,
      deals: stageDeals,
      byBrand,
      conversionFromPrev: null,
    };
  });

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1].count;
    rows[index].conversionFromPrev = previous > 0 ? rows[index].count / previous : null;
  }

  return {
    rows,
    lost: { count: lostDeals.length, value: lostDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0) },
    endToEnd: rows[0].count > 0 ? rows[rows.length - 1].count / rows[0].count : null,
  };
}

/** Color del puntito por etapa — el desglose de barras y el peek panel del
 *  CRM lo usan, y ahora también el mini-embudo del Inicio. */
export const FUNNEL_STAGE_DOTS: Record<DealStage, string> = {
  discovery: "#60a5fa",
  proposal: "#a78bfa",
  negotiation: "#fbbf24",
  approved: "#34d399",
  in_production: "#fb923c",
  review: "#22d3ee",
  ready: "#4ade80",
  delivered: "#a1a1aa",
  lost: "#ef4444",
};

/** Rampa beige del simulador (marca Futuraria): capa 0 = luz arriba, capa n =
 *  fondo de pirámide. fg legible sobre cada fondo; sin morado (regla dura). */
export const FUNNEL_LAYER_SKINS: Array<{ bg: string; fg: string }> = [
  { bg: "linear-gradient(180deg, #e9ddc1, #dbcba6)", fg: "#1c1810" },
  { bg: "linear-gradient(180deg, #d6c49c, #c3ac7e)", fg: "#1c1810" },
  { bg: "linear-gradient(180deg, #b89f70, #a38a5c)", fg: "#201a0e" },
  { bg: "linear-gradient(180deg, #967f52, #7c6841)", fg: "#fff7e8" },
  { bg: "linear-gradient(180deg, #6d5c39, #554628)", fg: "#fff7e8" },
  { bg: "linear-gradient(180deg, #483c22, #372e19)", fg: "#ecdfc2" },
  { bg: "linear-gradient(180deg, #2e2715, #241e10)", fg: "#d8cba9" },
  { bg: "linear-gradient(180deg, #1f1a0d, #16130a)", fg: "#c0b493" },
];
