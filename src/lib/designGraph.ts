export type AccountStatus = "lead" | "client";

export type DesignAssetType =
  | "key_visual"
  | "social_media"
  | "web"
  | "mailing"
  | "other";

export interface DesignGraphNode {
  id: string;
  name: string;
  brand_id?: string | null;
  brand: string;
  campaign_id?: string | null;
  campaign: string | null;
  asset_type?: DesignAssetType | string | null;
  tags: string[];
  theme: string;
  format: string;
  file_type: string;
  cover: string | null;
  obsidian_link: string;
}

export interface DesignGraphBrand {
  id: string;
  name: string;
  relationship_status?: AccountStatus | string | null;
}

export interface DesignGraphContact {
  id: string;
  brand_id?: string | null;
  brand_name?: string | null;
  first_name: string;
  last_name?: string | null;
  job_title?: string | null;
  email?: string | null;
  status?: string | null;
}

export interface DesignGraphWorkspace {
  id: string;
  name: string;
}

export interface DesignAssetGroup {
  type: DesignAssetType;
  label: string;
  designs: DesignGraphNode[];
}

export interface DesignCampaignGroup {
  id: string;
  name: string;
  assetGroups: DesignAssetGroup[];
  designs: DesignGraphNode[];
}

export interface DesignBrandGroup {
  id: string;
  name: string;
  relationshipStatus: AccountStatus;
  people: DesignGraphContact[];
  directAssetGroups: DesignAssetGroup[];
  directDesigns: DesignGraphNode[];
  campaigns: DesignCampaignGroup[];
  totalDesigns: number;
}

export type KnowledgeNodeKind = "workspace" | "status" | "brand" | "person" | "campaign" | "asset_type" | "design";

export interface KnowledgeGraphNode {
  id: string;
  name: string;
  kind: KnowledgeNodeKind;
  colorKey: string;
  templateId?: string;
  externalLink?: string;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  kind: "contains" | "person";
}

export const ASSET_TYPE_OPTIONS: Array<{ value: DesignAssetType; label: string }> = [
  { value: "key_visual", label: "Key visuals" },
  { value: "social_media", label: "Social media" },
  { value: "web", label: "Web" },
  { value: "mailing", label: "Mailing" },
  { value: "other", label: "Otros" },
];

const ASSET_TYPE_LABELS = new Map(ASSET_TYPE_OPTIONS.map((option) => [option.value, option.label]));

export function buildDesignHierarchy(
  nodes: DesignGraphNode[],
  brandAccounts: DesignGraphBrand[] = [],
  contacts: DesignGraphContact[] = [],
): DesignBrandGroup[] {
  const brands = new Map<string, MutableBrandGroup>();
  const brandIdsByName = new Map<string, string>();

  for (const account of brandAccounts) {
    const name = normalizeDisplayName(account.name) || "Sin marca";
    const nameKey = normalizeKey(name);
    if (brandIdsByName.has(nameKey)) continue;
    const id = account.id || syntheticId("brand", name);
    brands.set(id, createMutableBrand(id, name, normalizeAccountStatus(account.relationship_status)));
    brandIdsByName.set(nameKey, id);
  }

  for (const contact of contacts) {
    const brand = resolveBrand(brands, brandIdsByName, contact.brand_id, contact.brand_name, "lead");
    brand.people.push(contact);
    if (!brand.explicitStatus && contact.status === "active") brand.relationshipStatus = "client";
  }

  for (const node of nodes) {
    const brand = resolveBrand(brands, brandIdsByName, node.brand_id, node.brand, "client");
    const campaignName = normalizeDisplayName(node.campaign);
    if (!campaignName) {
      brand.directDesigns.push(node);
      continue;
    }

    const campaignId = node.campaign_id || syntheticId(`${brand.id}:campaign`, campaignName);
    const campaign = brand.campaigns.get(campaignId) || { id: campaignId, name: campaignName, designs: [] };
    campaign.designs.push(node);
    brand.campaigns.set(campaignId, campaign);
  }

  return [...brands.values()]
    .map((brand): DesignBrandGroup => {
      const directDesigns = sortDesigns(brand.directDesigns);
      const campaigns = [...brand.campaigns.values()]
        .map((campaign) => {
          const designs = sortDesigns(campaign.designs);
          return { ...campaign, designs, assetGroups: groupDesignsByAssetType(designs) };
        })
        .sort((first, second) => compareNames(first.name, second.name));
      return {
        id: brand.id,
        name: brand.name,
        relationshipStatus: brand.relationshipStatus,
        people: [...brand.people].sort(compareContacts),
        directAssetGroups: groupDesignsByAssetType(directDesigns),
        directDesigns,
        campaigns,
        totalDesigns: directDesigns.length + campaigns.reduce((sum, campaign) => sum + campaign.designs.length, 0),
      };
    })
    .sort((first, second) => compareNames(first.name, second.name));
}

export function buildKnowledgeGraph(
  workspace: DesignGraphWorkspace | null,
  hierarchy: DesignBrandGroup[],
  showPeople: boolean,
): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
  const graphNodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];
  const rootId = `workspace:${workspace?.id || "current"}`;
  graphNodes.push({ id: rootId, name: workspace?.name || "Tu marca", kind: "workspace", colorKey: "workspace" });

  for (const status of ["lead", "client"] as const) {
    const statusBrands = hierarchy.filter((brand) => brand.relationshipStatus === status);
    if (statusBrands.length === 0) continue;
    const statusId = `status:${status}`;
    graphNodes.push({ id: statusId, name: status === "lead" ? "Leads" : "Clientes", kind: "status", colorKey: status });
    edges.push({ source: rootId, target: statusId, kind: "contains" });

    for (const brand of statusBrands) {
      const brandId = `brand:${brand.id}`;
      graphNodes.push({ id: brandId, name: brand.name, kind: "brand", colorKey: brand.id });
      edges.push({ source: statusId, target: brandId, kind: "contains" });

      if (showPeople) {
        for (const person of brand.people) {
          const personName = [person.first_name, person.last_name].filter(Boolean).join(" ");
          const personId = `person:${person.id}`;
          graphNodes.push({ id: personId, name: personName, kind: "person", colorKey: brand.id });
          edges.push({ source: brandId, target: personId, kind: "person" });
        }
      }

      addAssetBranches(graphNodes, edges, brandId, brand.id, "direct", brand.directAssetGroups);
      for (const campaign of brand.campaigns) {
        const campaignId = `campaign:${campaign.id}`;
        graphNodes.push({ id: campaignId, name: campaign.name, kind: "campaign", colorKey: brand.id });
        edges.push({ source: brandId, target: campaignId, kind: "contains" });
        addAssetBranches(graphNodes, edges, campaignId, brand.id, campaign.id, campaign.assetGroups);
      }
    }
  }

  return { nodes: graphNodes, edges };
}

export function normalizeAssetType(value: string | null | undefined, format = ""): DesignAssetType {
  const normalized = normalizeKey(value || "").replace(/[\s-]+/g, "_");
  if (normalized === "key_visual" || normalized === "key_visuals" || normalized === "kv") return "key_visual";
  if (normalized === "social" || normalized === "social_media") return "social_media";
  if (normalized === "web" || normalized === "website") return "web";
  if (normalized === "mail" || normalized === "email" || normalized === "mailing") return "mailing";

  const normalizedFormat = normalizeKey(format);
  if (normalizedFormat === "social") return "social_media";
  if (["web", "mobile"].includes(normalizedFormat)) return "web";
  if (normalizedFormat === "email") return "mailing";
  return "other";
}

function groupDesignsByAssetType(designs: DesignGraphNode[]): DesignAssetGroup[] {
  const groups = new Map<DesignAssetType, DesignGraphNode[]>();
  for (const design of designs) {
    const type = normalizeAssetType(design.asset_type, design.format);
    const group = groups.get(type) || [];
    group.push(design);
    groups.set(type, group);
  }
  return ASSET_TYPE_OPTIONS
    .filter((option) => groups.has(option.value))
    .map((option) => ({ type: option.value, label: option.label, designs: groups.get(option.value)! }));
}

function addAssetBranches(
  graphNodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  parentId: string,
  colorKey: string,
  scopeId: string,
  assetGroups: DesignAssetGroup[],
) {
  for (const assetGroup of assetGroups) {
    const assetId = `asset-type:${scopeId}:${assetGroup.type}`;
    graphNodes.push({ id: assetId, name: ASSET_TYPE_LABELS.get(assetGroup.type) || "Otros", kind: "asset_type", colorKey });
    edges.push({ source: parentId, target: assetId, kind: "contains" });
    for (const design of assetGroup.designs) {
      const designId = `design:${design.id}`;
      graphNodes.push({
        id: designId,
        name: design.name,
        kind: "design",
        colorKey,
        templateId: design.id,
        externalLink: design.obsidian_link || undefined,
      });
      edges.push({ source: assetId, target: designId, kind: "contains" });
    }
  }
}

interface MutableBrandGroup {
  id: string;
  name: string;
  relationshipStatus: AccountStatus;
  explicitStatus: boolean;
  people: DesignGraphContact[];
  directDesigns: DesignGraphNode[];
  campaigns: Map<string, { id: string; name: string; designs: DesignGraphNode[] }>;
}

function createMutableBrand(id: string, name: string, status: AccountStatus | null): MutableBrandGroup {
  return {
    id,
    name,
    relationshipStatus: status || "lead",
    explicitStatus: status !== null,
    people: [],
    directDesigns: [],
    campaigns: new Map(),
  };
}

function resolveBrand(
  brands: Map<string, MutableBrandGroup>,
  brandIdsByName: Map<string, string>,
  requestedId: string | null | undefined,
  requestedName: string | null | undefined,
  inferredStatus: AccountStatus,
): MutableBrandGroup {
  const displayName = normalizeDisplayName(requestedName) || "Sin marca";
  const matchingId = requestedId && brands.has(requestedId)
    ? requestedId
    : brandIdsByName.get(normalizeKey(displayName));
  const id = matchingId || requestedId || syntheticId("brand", displayName);
  let brand = brands.get(id);
  if (!brand) {
    brand = createMutableBrand(id, displayName, null);
    brand.relationshipStatus = inferredStatus;
    brands.set(id, brand);
    brandIdsByName.set(normalizeKey(displayName), id);
  } else if (!brand.explicitStatus && inferredStatus === "client") {
    brand.relationshipStatus = "client";
  }
  return brand;
}

function normalizeAccountStatus(value: string | null | undefined): AccountStatus | null {
  if (value === "client" || value === "lead") return value;
  return null;
}

function syntheticId(prefix: string, value: string): string {
  const key = normalizeKey(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}:${key || "unassigned"}`;
}

function compareContacts(first: DesignGraphContact, second: DesignGraphContact): number {
  return compareNames(
    `${first.first_name} ${first.last_name || ""}`,
    `${second.first_name} ${second.last_name || ""}`,
  );
}

function sortDesigns(nodes: DesignGraphNode[]): DesignGraphNode[] {
  return [...nodes].sort((first, second) => compareNames(first.name, second.name));
}

function normalizeDisplayName(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") || "";
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function compareNames(first: string, second: string): number {
  return first.localeCompare(second, "es", { sensitivity: "base", numeric: true });
}
