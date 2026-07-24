export type CrmAccountHealth = "active" | "at_risk" | "churned";

export interface CrmBrandRow {
  id: string;
  name: string;
  relationship_status?: "lead" | "client" | null;
  account_health?: CrmAccountHealth | null;
}

export interface CrmDealRow {
  id: string;
  brand_id: string;
  campaign_id?: string | null;
  stage: string;
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
