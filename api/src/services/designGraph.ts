export interface DesignGraphNode {
  id: string;
  brand: string | null;
  campaign: string | null;
  tags: string[];
}

export interface DesignGraphEdge {
  source: string;
  target: string;
  kind: "brand" | "campaign" | "tag";
}

export function buildDesignGraphEdges(nodes: DesignGraphNode[]): DesignGraphEdge[] {
  const brandGroups = new Map<string, Set<string>>();
  const campaignGroups = new Map<string, Set<string>>();
  const tagGroups = new Map<string, Set<string>>();

  for (const node of nodes) {
    const brand = normalizeGroupValue(node.brand);
    const campaign = normalizeGroupValue(node.campaign);
    if (brand) addToGroup(brandGroups, brand, node.id);
    if (campaign) addToGroup(campaignGroups, `${brand || "_"}\u0000${campaign}`, node.id);
    for (const tag of node.tags) {
      const normalizedTag = normalizeGroupValue(tag);
      if (normalizedTag) addToGroup(tagGroups, normalizedTag, node.id);
    }
  }

  return [
    ...connectGroups(brandGroups, "brand"),
    ...connectGroups(campaignGroups, "campaign"),
    ...connectGroups(tagGroups, "tag"),
  ];
}

function addToGroup(groups: Map<string, Set<string>>, key: string, id: string): void {
  const ids = groups.get(key) || new Set<string>();
  ids.add(id);
  groups.set(key, ids);
}

function connectGroups(
  groups: Map<string, Set<string>>,
  kind: DesignGraphEdge["kind"],
): DesignGraphEdge[] {
  const edges: DesignGraphEdge[] = [];
  for (const idSet of groups.values()) {
    const ids = [...idSet];
    for (let first = 0; first < ids.length; first++) {
      for (let second = first + 1; second < ids.length; second++) {
        edges.push({ source: ids[first], target: ids[second], kind });
      }
    }
  }
  return edges;
}

function normalizeGroupValue(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() || "";
}
