/**
 * Brand Graph Service — builds a hierarchical tree of brands → categories → items
 * for the "Red de Marcas" force-directed graph visualization.
 *
 * Tree structure:
 *   workspace (level 0)
 *     └─ brand (level 1, from brand_guidelines)
 *          ├─ 🎨 Design System    (level 2) → frames inside design_system_<brand> (level 3)
 *          ├─ 📄 Plantillas       (level 2) → frames inside plantillas_<brand>    (level 3)
 *          ├─ 🖼 Assets            (level 2) → assets linked to this brand         (level 3)
 *          └─ 📁 Archivos         (level 2) → campaigns → design files            (level 3)
 *
 * A file is never a template. You save a *frame* as a template, so Plantillas
 * hangs frames, not files, and needs a container file of its own — the exact
 * mirror of the Design System. See docs/requirements/REQ-010-graph-template-model.md.
 *
 * All four categories are always emitted; an empty one becomes a ghost node so
 * it reads as a suggestion instead of vanishing.
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
  /** Campaign from design_file_meta — shown in the data table. */
  campaign?: string;
  /**
   * Placeholder standing in for a category the brand hasn't filled yet. The
   * graph always shows all four categories so the empty ones read as a
   * suggestion of what's missing, rather than silently disappearing.
   */
  ghost?: boolean;
  /** File no brand claimed — orbits the workspace centre on its own. */
  orphan?: boolean;
  children: BrandGraphNode[];
}

export interface BrandGraphRoot {
  workspaceId: string;
  workspaceName: string;
  brands: BrandGraphNode[];
  /** Files not filed under any brand. Rendered as free-floating planets. */
  orphans: BrandGraphNode[];
}

// ── Color palette (matches the prototype + brand tokens fallback) ──

/** Neutral grey — orphans read as unfiled, never as a brand colour. */
const ORPHAN_COLOR = "#8a93a6";

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

  // 1. Real brands live in `brands` — the table design_file_meta.brand_id
  //    points at, and the one File Info writes. `brand_guidelines` is the
  //    STYLES table (see StyleInvariantError/cleanStyleName in brands.ts);
  //    reading it here made every captured style show up as a brand, and made
  //    the brand_id comparison below compare ids from two different tables, so
  //    no file could ever attach. Styles now hang under their brand instead.
  const brandRowsResult = sb
    ? await sb.from("brands").select("id, name").eq("workspace_id", workspaceId).order("name")
    : { data: [], error: null };
  if (brandRowsResult.error) console.warn("[brandGraph] brands query error:", brandRowsResult.error.message);
  const brands = (brandRowsResult.data || []) as any[];

  // Styles, keyed by name so a brand can find its Design System.
  let styles: any[] = [];
  try { styles = await listBrandsByWorkspace(workspaceId); }
  catch (e: any) { console.warn("[brandGraph] styles query error:", e?.message); }
  const styleByName = new Map<string, any>();
  for (const s of styles) styleByName.set(normalizeName(s.name), s);

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
  /** Templates claimed by some brand. Whatever is left over is an orphan. */
  const claimed = new Set<string>();

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const style = styleByName.get(normalizeName(brand.name));
    const color = brandColor(i, style?.tokensJson);
    // The brand's Design System comes from the style that shares its name.
    const designSystemTemplateId: string | null = style?.designSystemTemplateId || null;

    const brandTemplates: any[] = [];
    const brandAssets: any[] = [];

    for (const tpl of templates) {
      if (tpl.is_brand_manual && designSystemTemplateId === tpl.id) {
        brandTemplates.push({ ...tpl, _isDs: true });
        claimed.add(tpl.id);
        continue;
      }
      const meta = metaByTemplate.get(tpl.id);
      if (
        meta &&
        (meta.brand_id === brand.id ||
         normalizeName(meta.brand) === normalizeName(brand.name))
      ) {
        brandTemplates.push(tpl);
        claimed.add(tpl.id);
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

    const nonDsTemplates = brandTemplates.filter(t => !t._isDs);

    // ── Design System: frames of design_system_<brand> ──
    const dsChildren: BrandGraphNode[] = [];
    if (designSystemTemplateId && brandTemplates.some(t => t._isDs)) {
      try {
        const fullDs = await getTemplate(designSystemTemplateId);
        for (const frame of fullDs?.frames || []) {
          dsChildren.push({
            id: `frame:${frame.id}`,
            name: frame.name || frame.id,
            level: 3,
            kind: "frame",
            color,
            children: [],
          });
        }
      } catch { /* DS template might not exist yet */ }
    }
    children.push(category(brand.id, color, "ds", "Design System", dsChildren, {
      emptyLabel: designSystemTemplateId ? "Agrega frames al DS" : "Crea tu Design System",
      emptyTemplateId: designSystemTemplateId || undefined,
    }));

    // ── Plantillas: frames of plantillas_<brand> ──
    // The container file doesn't exist yet — it needs
    // brand_guidelines.template_library_template_id from v21, mirroring what
    // v20 did for the Design System. Until then this branch is always a ghost.
    //
    // It must NOT fall back to listing nonDsTemplates: that is what the old
    // code did, and since Archivos lists the same array, every file was
    // emitted twice under the same `tpl:<id>` node id, collapsing the
    // canvas's byId map and mis-wiring the edges.
    children.push(category(brand.id, color, "templates", "Plantillas", [], {
      emptyLabel: "Guarda un frame con Batchamator",
    }));

    // ── Assets ──
    const assetChildren: BrandGraphNode[] = brandAssets.map(a => ({
      id: `asset:${a.id}`,
      name: a.name || a.file_path || a.id,
      level: 3,
      kind: "asset",
      color,
      children: [],
    }));
    children.push(category(brand.id, color, "assets", "Assets", assetChildren, {
      emptyLabel: "Sube fotos o archivos",
    }));

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
          campaign: campaign,
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
            campaign: campaign,
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
    children.push(category(brand.id, color, "archivos", "Archivos", archivoChildren, {
      emptyLabel: "Crea tu primer archivo",
    }));

    brandNodes.push({
      id: brand.id,
      name: brand.name,
      level: 1,
      kind: "brand",
      color,
      children,
    });
  }

  // 4. Anything no brand claimed is an orphan. These orbit the workspace centre
  //    directly instead of hanging off a brand, so they read as "not filed yet"
  //    at a glance and can be assigned from the side card.
  const orphans: BrandGraphNode[] = templates
    .filter(tpl => !claimed.has(tpl.id))
    .map(tpl => {
      const meta = metaByTemplate.get(tpl.id);
      return {
        id: `tpl:${tpl.id}`,
        name: tpl.name || tpl.id,
        level: 1,
        kind: "template" as const,
        color: ORPHAN_COLOR,
        templateId: tpl.id,
        obsidianLink: meta?.obsidian_link || undefined,
        campaign: meta?.campaign || undefined,
        orphan: true,
        children: [],
      };
    });

  return {
    workspaceId,
    workspaceName: workspaceName || "Mi cuenta",
    brands: brandNodes,
    orphans,
  };
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

/**
 * Builds one of a brand's four category nodes. Always returns a node: when the
 * category has no real children it gets a single ghost child carrying a hint
 * about what to do next, so the branch stays visible as a suggestion.
 */
function category(
  brandId: string,
  color: string,
  slug: string,
  label: string,
  children: BrandGraphNode[],
  empty: { emptyLabel: string; emptyTemplateId?: string },
): BrandGraphNode {
  return {
    id: `cat:${slug}:${brandId}`,
    name: label,
    level: 2,
    kind: "category",
    color,
    category: label,
    ghost: children.length === 0,
    children: children.length > 0 ? children : [{
      id: `ghost:${slug}:${brandId}`,
      name: empty.emptyLabel,
      level: 3,
      kind: "template",
      color,
      templateId: empty.emptyTemplateId,
      ghost: true,
      children: [],
    }],
  };
}
