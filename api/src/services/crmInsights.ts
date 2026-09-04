export type CrmAccountHealth = "active" | "at_risk" | "churned";

export interface CrmBrandRow {
  id: string;
  name: string;
  relationship_status?: "lead" | "client" | null;
  account_health?: CrmAccountHealth | null;
  account_health_override?: CrmAccountHealth | null;
  last_contacted_at?: string | null;
}

export interface CrmDealRow {
  id: string;
  brand_id: string;
  campaign_id?: string | null;
  primary_contact_id?: string | null;
  stage: string;
  value?: number | null;
  final_value?: number | null;
  currency?: string | null;
}

export interface CrmDeliverableRow {
  id: string;
  deal_id: string;
  asset_type: string;
  label: string;
  quantity: number;
  sort_order?: number | null;
}

export interface CrmDeliverableLinkRow {
  deliverable_id: string;
  template_id: string;
}

export interface CrmDesignRow {
  template_id: string;
  brand_id?: string | null;
  campaign_id?: string | null;
  asset_type?: string | null;
  updated_at?: string | null;
  name?: string | null;
  thumbnail?: string | null;
}

export interface CrmOfferSuggestion {
  assetType: string;
  title: string;
  reason: string;
}

const ASSET_LABELS: Record<string, string> = {
  key_visual: "Key visual",
  social_media: "Social media",
  web: "Web",
  mailing: "Mailing",
  landing: "Landing page",
  ecommerce: "E-commerce",
  display_ads: "Display ads",
  motion: "Motion / video",
  whatsapp_template: "Plantilla de WhatsApp",
  deck: "Presentación",
  packaging: "Empaque",
  brand_identity: "Identidad de marca",
  brand_book: "Manual de marca",
  permanent_asset: "Activo permanente",
};

const CLIENT_GAPS = ["key_visual", "social_media", "landing", "mailing", "deck"] as const;

export function crmAssetLabel(assetType: string) {
  return ASSET_LABELS[assetType] || assetType.replaceAll("_", " ");
}

export function buildOfferSuggestions(
  brand: CrmBrandRow,
  designs: CrmDesignRow[],
  requestedAssetTypes: string[] = [],
  limit = 3,
): CrmOfferSuggestion[] {
  const brandDesigns = designs.filter((design) => design.brand_id === brand.id);
  const existingTypes = new Set([
    ...brandDesigns.map((design) => design.asset_type).filter(Boolean),
    ...requestedAssetTypes,
  ]);
  const health = brand.account_health || "active";

  if (health === "churned") {
    return [{
      assetType: "brand_identity",
      title: "Auditoría y relanzamiento",
      reason: "La cuenta está en fuga; una revisión concreta abre una conversación de reactivación.",
    }];
  }

  if (health === "at_risk") {
    return [{
      assetType: "social_media",
      title: "Campaña de reactivación",
      reason: "La cuenta está en riesgo; conviene proponer una entrega acotada y fácil de aprobar.",
    }];
  }

  if (brand.relationship_status === "lead") {
    const firstGap = CLIENT_GAPS.find((assetType) => !existingTypes.has(assetType)) || "key_visual";
    return [{
      assetType: firstGap,
      title: brandDesigns.length === 0 ? "Paquete visual de entrada" : crmAssetLabel(firstGap),
      reason: brandDesigns.length === 0
        ? "Todavía no hay diseños vinculados; una primera pieza permite demostrar el estilo con poco riesgo."
        : `Ya existe contexto de marca, pero falta ${crmAssetLabel(firstGap).toLocaleLowerCase()}.`,
    }];
  }

  return CLIENT_GAPS
    .filter((assetType) => !existingTypes.has(assetType))
    .slice(0, limit)
    .map((assetType) => ({
      assetType,
      title: crmAssetLabel(assetType),
      reason: `La marca ya tiene producción, pero no registra ${crmAssetLabel(assetType).toLocaleLowerCase()}.`,
    }));
}

export function buildDealProgress(
  deal: CrmDealRow,
  deliverables: CrmDeliverableRow[],
  links: CrmDeliverableLinkRow[],
  designs: CrmDesignRow[],
) {
  const dealDeliverables = deliverables
    .filter((deliverable) => deliverable.deal_id === deal.id)
    .sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0));
  const designById = new Map(designs.map((design) => [design.template_id, design]));
  const linkedTemplateIds = new Set(links.map((link) => link.template_id));
  let requested = 0;
  let completed = 0;

  const items = dealDeliverables.map((deliverable) => {
    const matchedFiles = links
      .filter((link) => link.deliverable_id === deliverable.id)
      .map((link) => designById.get(link.template_id))
      .filter((design): design is CrmDesignRow => Boolean(design));
    const remaining = Math.max(0, deliverable.quantity - matchedFiles.length);
    const candidateFiles = designs
      .filter((design) =>
        design.brand_id === deal.brand_id
        && design.asset_type === deliverable.asset_type
        && (!deal.campaign_id || design.campaign_id === deal.campaign_id)
        && !linkedTemplateIds.has(design.template_id))
      .slice(0, remaining);
    const completedQuantity = Math.min(deliverable.quantity, matchedFiles.length);
    requested += deliverable.quantity;
    completed += completedQuantity;

    return {
      ...deliverable,
      matchedFiles,
      candidateFiles,
      completedQuantity,
      remainingQuantity: deliverable.quantity - completedQuantity,
      status: completedQuantity >= deliverable.quantity
        ? "complete"
        : completedQuantity > 0
          ? "partial"
          : "pending",
    };
  });

  return {
    requested,
    completed,
    percentage: requested === 0 ? 0 : Math.round((completed / requested) * 100),
    complete: requested > 0 && completed >= requested,
    canReconcile: Boolean(deal.campaign_id),
    warning: deal.campaign_id
      ? null
      : "Asigna una campaña para confirmar archivos sin mezclar trabajos de la misma marca.",
    deliverables: items,
  };
}

/** Días sin contacto antes de marcar una cuenta cliente como at_risk. */
export const BRAND_HEALTH_STALE_DAYS = 30;

function isOpenDealStage(stage: string) {
  return stage !== "delivered" && stage !== "lost";
}

/** Salud computada estilo DIATTA, sin reemplazar la lógica existente:
 *  1. `account_health_override` (v45) siempre gana — corrección humana.
 *  2. `churned` es pegajoso: una cuenta dada de baja no revive sola.
 *  3. Cliente sin deal abierto y sin contacto en BRAND_HEALTH_STALE_DAYS → at_risk.
 *  4. En cualquier otro caso manda el `account_health` persistido. */
export function computeBrandHealth(
  brand: Pick<CrmBrandRow, "id" | "relationship_status" | "account_health" | "account_health_override" | "last_contacted_at">,
  deals: CrmDealRow[],
  now: Date = new Date(),
): CrmAccountHealth {
  if (brand.account_health_override) return brand.account_health_override;
  if (brand.account_health === "churned") return "churned";
  const hasOpenDeal = deals.some(
    (deal) => deal.brand_id === brand.id && isOpenDealStage(deal.stage),
  );
  if (!hasOpenDeal && brand.relationship_status === "client") {
    const lastContact = brand.last_contacted_at ? new Date(brand.last_contacted_at).getTime() : null;
    const stale = !lastContact || now.getTime() - lastContact > BRAND_HEALTH_STALE_DAYS * 24 * 60 * 60 * 1000;
    if (stale) return "at_risk";
  }
  return brand.account_health || "active";
}

export interface CrmContactDealStats {
  dealCount: number;
  openDeals: number;
  openValue: number;
  wonValue: number;
  currency: string | null;
}

const EMPTY_CONTACT_STATS: CrmContactDealStats = {
  dealCount: 0,
  openDeals: 0,
  openValue: 0,
  wonValue: 0,
  currency: null,
};

/** Números comerciales por persona (tabla Personas estilo DIATTA): cuántos
 *  deals toca esta persona, cuánto está abierto y cuánto cerró ganado. */
export function buildContactDealStats(contactId: string, deals: CrmDealRow[]): CrmContactDealStats {
  const mine = deals.filter((deal) => deal.primary_contact_id === contactId);
  if (mine.length === 0) return { ...EMPTY_CONTACT_STATS };
  let openValue = 0;
  let wonValue = 0;
  let currency: string | null = null;
  for (const deal of mine) {
    if (!currency && deal.currency) currency = deal.currency;
    if (deal.stage === "delivered") {
      wonValue += Number(deal.final_value ?? deal.value ?? 0);
    } else if (isOpenDealStage(deal.stage)) {
      openValue += Number(deal.value ?? 0);
    }
  }
  return {
    dealCount: mine.length,
    openDeals: mine.filter((deal) => isOpenDealStage(deal.stage)).length,
    openValue,
    wonValue,
    currency,
  };
}
