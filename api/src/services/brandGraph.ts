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
 * Categories with nothing in them are omitted rather than shown as
 * placeholders: at four per brand they drowned out the real nodes.
 */

import { getSupabase } from "./supabase.js";
import { listBrandsByWorkspace } from "./brands.js";
import { getTemplate } from "./templates.js";
import {
  ARCHIVOS, ASSETS, DESIGN_SYSTEM, PLANTILLAS,
  bucketByCategory, normalizeName, resolveTemplateOwners,
} from "./brandFiling.js";

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

/** Monochrome graph: orphans are told apart by orbit and dashed ring, not hue. */
const ORPHAN_COLOR = "#ffffff";

const BRAND_PALETTE = ["#ffffff"];

function brandColor(_index: number, _tokensJson?: string | null): string {
  // Deliberately ignores the style's token colours: the graph is monochrome.
  return BRAND_PALETTE[0];
}

/**
 * Reads design_file_meta, degrading to the pre-v21 column set when `category`
 * is not in the database yet. Letting the query fail instead would empty
 * metaRows and turn every file in the workspace into an orphan.
 */
async function selectFileMeta(sb: any, workspaceId: string) {
  const legacy = "template_id, brand, campaign, obsidian_link, brand_id";
  const result = await sb.from("design_file_meta")
    .select(`${legacy}, category`).eq("workspace_id", workspaceId);
  if (!result.error) return result;
  if (!String(result.error.message || "").includes("category")) return result;
  return sb.from("design_file_meta").select(legacy).eq("workspace_id", workspaceId);
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
    sb ? selectFileMeta(sb, workspaceId) : Promise.resolve({ data: [], error: null }),
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

  // Resolve ownership once, before the per-brand loop below.
  const ownerByTemplate = resolveTemplateOwners(
    templates.map(t => t.id), brands as Array<{ id: string; name: string }>, metaByTemplate,
  );

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
      if (ownerByTemplate.get(tpl.id) === brand.id) {
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
    const pushCat = (c: BrandGraphNode | null) => { if (c) children.push(c); };

    const nonDsTemplates = brandTemplates.filter(t => !t._isDs);

    const filed = bucketByCategory(nonDsTemplates, metaByTemplate);
    /** A filed template rendered as a leaf of its category. */
    const fileNode = (tpl: any, level: number): BrandGraphNode => ({
      id: `tpl:${tpl.id}`,
      name: tpl.name || tpl.id,
      level,
      kind: "template",
      color,
      templateId: tpl.id,
      obsidianLink: metaByTemplate.get(tpl.id)?.obsidian_link || undefined,
      campaign: metaByTemplate.get(tpl.id)?.campaign || undefined,
      children: [],
    });

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
    for (const tpl of filed.get(DESIGN_SYSTEM)!) dsChildren.push(fileNode(tpl, 3));
    pushCat(category(brand.id, color, "ds", DESIGN_SYSTEM, dsChildren));

    // ── Plantillas: files filed here by hand ──
    // The frames-of-plantillas_<brand> container doesn't exist yet — it needs
    // brand_guidelines.template_library_template_id, mirroring what v20 did
    // for the Design System. Until then the branch holds only what the table
    // filed into it.
    //
    // It must NOT fall back to listing nonDsTemplates: that is what the old
    // code did, and since Archivos lists the same array, every file was
    // emitted twice under the same `tpl:<id>` node id, collapsing the
    // canvas's byId map and mis-wiring the edges.
    pushCat(category(brand.id, color, "templates", PLANTILLAS,
      filed.get(PLANTILLAS)!.map(tpl => fileNode(tpl, 3))));

    // ── Assets ──
    const assetChildren: BrandGraphNode[] = brandAssets.map(a => ({
      id: `asset:${a.id}`,
      name: a.name || a.file_path || a.id,
      level: 3,
      kind: "asset",
      color,
      children: [],
    }));
    for (const tpl of filed.get(ASSETS)!) assetChildren.push(fileNode(tpl, 3));
    pushCat(category(brand.id, color, "assets", ASSETS, assetChildren));

    // Archivos category — templates grouped by campaign
    const campaignGroups = new Map<string, any[]>();
    for (const tpl of filed.get(ARCHIVOS)!) {
      const meta = metaByTemplate.get(tpl.id);
      const campaign = meta?.campaign || "Sin campaña";
      if (!campaignGroups.has(campaign)) campaignGroups.set(campaign, []);
      campaignGroups.get(campaign)!.push(tpl);
    }
    const archivoChildren: BrandGraphNode[] = [];
    for (const [campaign, groupTpls] of campaignGroups) {
      if (groupTpls.length === 1) {
        // Single template in campaign — render directly
        archivoChildren.push(fileNode(groupTpls[0], 3));
      } else {
        // Multiple templates — group under campaign node
        const campaignChildren = groupTpls.map(tpl => fileNode(tpl, 4));
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
    pushCat(category(brand.id, color, "archivos", ARCHIVOS, archivoChildren));

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

/**
 * Builds one of a brand's category nodes, or null when the brand has nothing
 * in it. Empty categories used to emit a ghost placeholder child so the branch
 * stayed visible as a suggestion, but with four per brand across 29 brands the
 * graph was mostly placeholders, so they are simply omitted now.
 */
function category(
  brandId: string,
  color: string,
  slug: string,
  label: string,
  children: BrandGraphNode[],
): BrandGraphNode | null {
  if (children.length === 0) return null;
  return {
    id: `cat:${slug}:${brandId}`,
    name: label,
    level: 2,
    kind: "category",
    color,
    category: label,
    children,
  };
}
