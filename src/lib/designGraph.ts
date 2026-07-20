export interface DesignGraphNode {
  id: string;
  name: string;
  brand: string;
  campaign: string | null;
  tags: string[];
  theme: string;
  format: string;
  file_type: string;
  cover: string | null;
  obsidian_link: string;
}

export interface DesignCampaignGroup {
  name: string;
  designs: DesignGraphNode[];
}

export interface DesignBrandGroup {
  name: string;
  directDesigns: DesignGraphNode[];
  campaigns: DesignCampaignGroup[];
  totalDesigns: number;
}

export function buildDesignHierarchy(nodes: DesignGraphNode[]): DesignBrandGroup[] {
  const brands = new Map<string, {
    name: string;
    directDesigns: DesignGraphNode[];
    campaigns: Map<string, DesignCampaignGroup>;
  }>();

  for (const node of nodes) {
    const brandName = normalizeDisplayName(node.brand) || "Sin marca";
    const brandKey = normalizeKey(brandName);
    const brand = brands.get(brandKey) || {
      name: brandName,
      directDesigns: [],
      campaigns: new Map<string, DesignCampaignGroup>(),
    };
    brands.set(brandKey, brand);

    const campaignName = normalizeDisplayName(node.campaign);
    if (!campaignName) {
      brand.directDesigns.push(node);
      continue;
    }

    const campaignKey = normalizeKey(campaignName);
    const campaign = brand.campaigns.get(campaignKey) || { name: campaignName, designs: [] };
    campaign.designs.push(node);
    brand.campaigns.set(campaignKey, campaign);
  }

  return [...brands.values()]
    .map((brand) => {
      const directDesigns = sortDesigns(brand.directDesigns);
      const campaigns = [...brand.campaigns.values()]
        .map((campaign) => ({ ...campaign, designs: sortDesigns(campaign.designs) }))
        .sort((first, second) => compareNames(first.name, second.name));
      return {
        name: brand.name,
        directDesigns,
        campaigns,
        totalDesigns: directDesigns.length + campaigns.reduce((sum, campaign) => sum + campaign.designs.length, 0),
      };
    })
    .sort((first, second) => compareNames(first.name, second.name));
}

function sortDesigns(nodes: DesignGraphNode[]): DesignGraphNode[] {
  return [...nodes].sort((first, second) => compareNames(first.name, second.name));
}

function normalizeDisplayName(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") || "";
}

function normalizeKey(value: string): string {
  return value.toLocaleLowerCase();
}

function compareNames(first: string, second: string): number {
  return first.localeCompare(second, "es", { sensitivity: "base", numeric: true });
}
