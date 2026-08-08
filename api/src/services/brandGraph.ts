/**
 * Brand Graph Service — builds a hierarchical tree of brands → categories → items
 * for the "Red de Marcas" force-directed graph visualization.
 *
 * Tree structure:
 *   workspace (level 0)
 *     └─ brand (level 1, from brand_guidelines)
 *          ├─ 🎨 Design System    (level 2) → frames inside DS template (level 3)
 *          ├─ 📄 Plantillas       (level 2) → templates tagged with this brand (level 3)
 *          ├─ 🖼 Assets            (level 2) → assets linked to this brand (level 3)
 *          └─ 📁 Archivos         (level 2) → campaigns → templates (level 3)
 */

import { getSupabase } from "./supabase.js";
import { listBrandsByWorkspace } from "./brands.js";
import { getTemplate } from "./templates.js";

// ── Public types ──

export type BrandGraphNodeKind =
  | "workspace"
  | "brand"
  | "category"
  | "template"
  | "asset"
  | "frame";

export interface BrandGraphNode {
  id: string;
  name: string;
  level: number;
  kind: BrandGraphNodeKind;
  color: string;
  /** Only set for template/frame/asset nodes — opens the editor. */
  templateId?: string;
  /** Obsidian vault deep-link from design_file_meta. */
  obsidianLink?: string;
  /** Category label shown in the graph (e.g. "Design System", "Plantillas"). */
  category?: string;
  children: BrandGraphNode[];
}

export interface BrandGraphRoot {
  workspaceId: string;
  workspaceName: string;
  brands: BrandGraphNode[];
}

// ── Color palette (matches the prototype + brand tokens fallback) ──

const BRAND_PALETTE = [
  "#ff4b72", // Rosa neón (Futuraria default)
  "#00e5ff", // Cyan
  "#b5179e", // Púrpura
  "#ffb703", // Amarillo
  "#06d6a0", // Verde menta
  "#ef476f", // Rojo coral
  "#118ab2", // Azul profundo
  "#f78c6b", // Naranja suave
];

function brandColor(index: number, tokensJson?: string | null): string {
  // Try to extract a primary color from tokensJson first
  if (tokensJson) {
    try {
      const tokens = typeof tokensJson === "string" ? JSON.parse(tokensJson) : tokensJson;
      // Look for brand.primary.color or palette[0]
      const primary =
        tokens?.brand?.primary?.color ||
        tokens?.colors?.primary ||
        tokens?.palette?.[0];
      if (typeof primary === "string" && /^#[0-9a-fA-F]{6}$/.test(primary)) {
        return primary;
      }
    } catch { /* fall through */ }
  }
  return BRAND_PALETTE[index % BRAND_PALETTE.length];
}

// ── Builder ──

export async function buildBrandGraph(
  workspaceId: string,
  workspaceName?: string,
): Promise<BrandGraphRoot> {
  const sb = getSupabase();

  // 1. Fetch brands from brand_guidelines (active only)
  const brands = await listBrandsByWorkspace(workspaceId);

  // 2. Fetch all templates + assets + design_file_meta for this workspace
  const [tplResult, assetResult, metaResult] = await Promise.all([
    sb
      ? sb.from("templates")
          .select("id, name, thumbnail, is_brand_manual")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    sb
      ? sb.from("assets")
          .select("id, name, file_path, tags")
          .eq("workspace_id", workspaceId)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    sb
      ? sb.from("design_file_meta")
          .select("template_id, brand, campaign, obsidian_link, brand_id")
          .eq("workspace_id", workspaceId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tplResult.error) console.warn("[brandGraph] templates query error:", tplResult.error.message);
  if (assetResult.error) console.warn("[brandGraph] assets query error:", assetResult.error.message);
  if (metaResult.error) console.warn("[brandGraph] meta query error:", metaResult.error.message);

  const templates = (tplResult.data || []) as any[];
  const assets = (assetResult.data || []) as any[];
  const metaRows = (metaResult.data || []) as any[];

  // Build lookup maps
  const metaByTemplate = new Map<string, any>();
  for (const row of metaRows) {
    if (row.template_id) metaByTemplate.set(row.template_id, row);
  }

  // 3. Build the tree
  const brandNodes: BrandGraphNode[] = [];

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const color = brandColor(i, brand.tokensJson);

    // Determine which templates belong to this brand (by brand_id or meta brand name)
    const brandTemplates: any[] = [];
    const brandAssets: any[] = [];
    const brandMeta: any[] = [];

    for (const tpl of templates) {
      if (tpl.is_brand_manual && brand.designSystemTemplateId === tpl.id) {
        // This is the Design System template — handled separately
        brandTemplates.push({ ...tpl, _isDs: true });
        continue;
      }
      const meta = metaByTemplate.get(tpl.id);
      if (
        meta &&
        (meta.brand_id === brand.id ||
         normalizeName(meta.brand) === normalizeName(brand.name))
      ) {
        brandTemplates.push(tpl);
        if (meta) brandMeta.push(meta);
      }
    }

    for (const asset of assets) {
      const tags: string[] = typeof asset.tags === "string"
        ? JSON.parse(asset.tags || "[]")
        : (Array.isArray(asset.tags) ? asset.tags : []);
      if (tags.some(t => normalizeName(t) === normalizeName(brand.name))) {
        brandAssets.push(asset);
      }
    }

    // ── Build children ──
    const children: BrandGraphNode[] = [];

    // Design System category
    const dsChildren: BrandGraphNode[] = [];
    if (brand.designSystemTemplateId) {
      const dsTpl = brandTemplates.find(t => t._isDs);
      if (dsTpl) {
        // Fetch DS template to get its frames
        try {
          const fullDs = await getTemplate(brand.designSystemTemplateId);
          if (fullDs?.frames && fullDs.frames.length > 0) {
            for (const frame of fullDs.frames) {
              dsChildren.push({
                id: `frame:${frame.id}`,
                name: frame.name || frame.id,
                level: 3,
                kind: "frame",
                color,
                children: [],
              });
            }
          }
        } catch { /* DS template might not exist yet */ }
      }
      // Even if empty, show the DS category
      children.push({
        id: `cat:ds:${brand.id}`,
        name: "Design System",
        level: 2,
        kind: "category",
        color,
        category: "Design System",
        children: dsChildren.length > 0 ? dsChildren : [
          {
            id: `empty:ds:${brand.id}`,
            name: "Agrega frames al DS",
            level: 3,
            kind: "template",
            color,
            templateId: brand.designSystemTemplateId,
            children: [],
          },
        ],
      });
    }

    // Plantillas category (non-DS templates)
    const nonDsTemplates = brandTemplates.filter(t => !t._isDs);
    const plantillaChildren: BrandGraphNode[] = [];
    for (const tpl of nonDsTemplates) {
      const meta = metaByTemplate.get(tpl.id);
      plantillaChildren.push({
        id: `tpl:${tpl.id}`,
        name: tpl.name || tpl.id,
        level: 3,
        kind: "template",
        color,
        templateId: tpl.id,
        obsidianLink: meta?.obsidian_link || undefined,
        children: [],
      });
    }
    if (plantillaChildren.length > 0) {
      children.push({
        id: `cat:templates:${brand.id}`,
        name: "Plantillas",
        level: 2,
        kind: "category",
        color,
        category: "Plantillas",
        children: plantillaChildren,
      });
    }

    // Assets category
    const assetChildren: BrandGraphNode[] = brandAssets.map(a => ({
      id: `asset:${a.id}`,
      name: a.name || a.file_path || a.id,
      level: 3,
      kind: "asset",
      color,
      children: [],
    }));
    if (assetChildren.length > 0) {
      children.push({
        id: `cat:assets:${brand.id}`,
        name: "Assets",
        level: 2,
        kind: "category",
        color,
        category: "Assets",
        children: assetChildren,
      });
    }

    // Archivos category — templates grouped by campaign
    const campaignGroups = new Map<string, any[]>();
    for (const tpl of nonDsTemplates) {
      const meta = metaByTemplate.get(tpl.id);
      const campaign = meta?.campaign || "Sin campaña";
      if (!campaignGroups.has(campaign)) campaignGroups.set(campaign, []);
      campaignGroups.get(campaign)!.push(tpl);
    }
    const archivoChildren: BrandGraphNode[] = [];
    for (const [campaign, groupTpls] of campaignGroups) {
      if (groupTpls.length === 1) {
        // Single template in campaign — render directly
        const tpl = groupTpls[0];
        const meta = metaByTemplate.get(tpl.id);
        archivoChildren.push({
          id: `tpl:${tpl.id}`,
          name: tpl.name || tpl.id,
          level: 3,
          kind: "template",
          color,
          templateId: tpl.id,
          obsidianLink: meta?.obsidian_link || undefined,
          children: [],
        });
      } else {
        // Multiple templates — group under campaign node
        const campaignChildren: BrandGraphNode[] = groupTpls.map(tpl => {
          const meta = metaByTemplate.get(tpl.id);
          return {
            id: `tpl:${tpl.id}`,
            name: tpl.name || tpl.id,
            level: 4,
            kind: "template",
            color,
            templateId: tpl.id,
            obsidianLink: meta?.obsidian_link || undefined,
            children: [],
          };
        });
        archivoChildren.push({
          id: `campaign:${brand.id}:${campaign}`,
          name: campaign,
          level: 3,
          kind: "category",
          color,
          category: "Campaña",
          children: campaignChildren,
        });
      }
    }
    if (archivoChildren.length > 0) {
      children.push({
        id: `cat:archivos:${brand.id}`,
        name: "Archivos",
        level: 2,
        kind: "category",
        color,
        category: "Archivos",
        children: archivoChildren,
      });
    }

    brandNodes.push({
      id: brand.id,
      name: brand.name,
      level: 1,
      kind: "brand",
      color,
      children,
    });
  }

  return {
    workspaceId,
    workspaceName: workspaceName || "Mi cuenta",
    brands: brandNodes,
  };
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}
