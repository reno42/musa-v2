/**
 * Pure funnel math for the CRM «Embudo» view — no React, no fetches, so the
 * QA suite can import it directly. The funnel mirrors the kanban's open
 * stages 1:1 («Perdido» stays outside the funnel as leakage) and the unit it
 * counts switches with the view:
 *   - "brands":   deals per stage — the classic opportunity funnel, stacked
 *                 per brand in the UI.
 *   - "personas": distinct people per stage. A deal carries one
 *                 primary_contact_id, and one brand can orbit several humans
 *                 (the influencer you talk to is not always the decisor), so
 *                 counting people instead of deals shows how many humans are
 *                 actually moving through each stage.
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

export type FunnelMode = "brands" | "personas";

export type FunnelRow = {
  stage: DealStage;
  label: string;
  /** Units in this stage: deals in "brands" mode, distinct people in "personas". */
  count: number;
  /** All deals sitting in the stage, for the drill-down panel. */
  deals: FunnelDeal[];
  /** Deal count per brand, highest first — feeds the stacked bar segments. */
  byBrand: Array<{ brandId: string; name: string; count: number }>;
  /** Distinct people (primary contacts) in the stage, alphabetical. */
  people: Array<{ contactId: string; name: string }>;
  /** Deals in the stage without a primary contact — they don't count as people. */
  unassignedDeals: number;
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
  contacts: FunnelContact[],
  mode: FunnelMode,
): FunnelResult {
  const brandNames = new Map(brands.map((brand): [string, string] => [brand.id, brand.name]));
  const peopleNames = new Map(contacts.map((contact): [string, string] => [contact.id, contactName(contact)]));
  const lostDeals = deals.filter((deal) => deal.stage === "lost");

  const rows: FunnelRow[] = FUNNEL_STAGES.map((stage) => {
    const stageDeals = deals.filter((deal) => deal.stage === stage.value);
    const countsByBrand = new Map<string, number>();
    for (const deal of stageDeals) countsByBrand.set(deal.brand_id, (countsByBrand.get(deal.brand_id) || 0) + 1);
    const byBrand = [...countsByBrand.entries()]
      .map(([brandId, count]) => ({ brandId, name: brandNames.get(brandId) || "Marca", count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const seen = new Set<string>();
    const people: FunnelRow["people"] = [];
    let unassignedDeals = 0;
    for (const deal of stageDeals) {
      if (!deal.primary_contact_id) { unassignedDeals += 1; continue; }
      if (seen.has(deal.primary_contact_id)) continue;
      seen.add(deal.primary_contact_id);
      people.push({ contactId: deal.primary_contact_id, name: peopleNames.get(deal.primary_contact_id) || "Persona" });
    }
    people.sort((a, b) => a.name.localeCompare(b.name));

    return {
      stage: stage.value,
      label: stage.label,
      count: mode === "brands" ? stageDeals.length : people.length,
      deals: stageDeals,
      byBrand,
      people,
      unassignedDeals,
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
