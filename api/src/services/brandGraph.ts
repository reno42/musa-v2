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
  assetOrigin, bucketByCategory, groupByCampaign, normalizeName, resolveTemplateOwners,
} from "./brandFiling.js";
import {
  computeDsCompleteness, computePlantillasCompleteness, computeStrategyCompleteness,
  strategyDigest, type Completeness,
} from "./brandContainer.js";
import {
  archivoNoteSlug, archivosNoteSlug, brandNoteSlug, copywritingNoteSlug, crmNoteSlug,
  dsNoteSlug, estrategiaNoteSlug, personaNoteSlug, plantillasNoteSlug,
} from "./brainNotes.js";

// ── Public types ──

export type BrandGraphNodeKind =
  | "workspace"
  | "brand"
  | "category"
  | "template"
  | "asset"
  | "frame"
  /** Second Brain branch: no file of its own — the note IS the content. */
  | "note";

/** Which living note this node opens (harness/BRAIN_NOTES_SPEC.md). */
export type BrandNoteKind =
  | "marca" | "ds" | "plantillas" | "archivos" | "crm"
  | "estrategia" | "copywriting" | "persona" | "archivo";

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
  /** organic | ad — what this design was first used for (v22). */
  contentKind?: string;
  /** File no brand claimed — orbits the workspace centre on its own. */
  orphan?: boolean;
  /** Brand nodes only: whether the brand has its Design System file. False
   *  means the UI shows the "sin Design System" badge + one-click create. */
  hasDesignSystem?: boolean;
  /** Asset only: where the bytes are, and whose server they sit on. */
  assetUrl?: string;
  assetOrigin?: "bucket" | "external" | "unknown";
  /** Set on the single node standing in for assets the graph did not draw. */
  rollup?: number;
  /** Second Brain: which note this node opens, and under which slug. */
  noteKind?: BrandNoteKind;
  noteSlug?: string;
  /** persona nodes only: index inside brands.strategy_json.audience.personas. */
  personaIndex?: number;
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
 * Reads the workspace's assets.
 *
 * This asked for `file_path`, which the assets table does not have — the real
 * column is `url`. PostgREST failed the whole query, the error was warned and
 * swallowed, and the Assets branch of every brand has therefore been empty
 * since it was written. Production logs said so on every graph load.
 */
async function selectAssets(sb: any, workspaceId: string) {
  const full = "id, name, url, filename, size_bytes, tags";
  const result = await sb.from("assets").select(full).eq("workspace_id", workspaceId).order("name");
  if (!result.error) return result;
  // A schema that predates size_bytes should still draw its assets.
  return sb.from("assets").select("id, name, url, tags").eq("workspace_id", workspaceId).order("name");
}

/** How many asset nodes one brand may draw before the rest become a count. */
const ASSET_NODE_LIMIT = 8;

/**
 * Reads design_file_meta, degrading to the pre-v21 column set when `category`
 * is not in the database yet. Letting the query fail instead would empty
 * metaRows and turn every file in the workspace into an orphan.
 */
async function selectFileMeta(sb: any, workspaceId: string) {
  const legacy = "template_id, brand, campaign, obsidian_link, brand_id";
  // content_kind arrives with v22; the fallback below covers a database without it.
  const result = await sb.from("design_file_meta")
    .select(`${legacy}, category, content_kind`).eq("workspace_id", workspaceId);
  if (!result.error) return result;
  const msg = String(result.error.message || "");
  if (!msg.includes("category") && !msg.includes("content_kind")) return result;
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
  const styleByCrm = new Map<string, any>();
  for (const s of styles) {
    styleByName.set(normalizeName(s.name), s);
    if (s.crmBrandId) styleByCrm.set(s.crmBrandId, s);
  }

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
      ? selectAssets(sb, workspaceId)
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
    // v35: the CRM link is authoritative; the name match only covers rows
    // the backfill hasn't linked yet.
    const style = styleByCrm.get(brand.id) || styleByName.get(normalizeName(brand.name));
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
      contentKind: metaByTemplate.get(tpl.id)?.content_kind || undefined,
      noteKind: "archivo",
      noteSlug: archivoNoteSlug(tpl.id),
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
    pushCat(category(brand.id, color, "ds", DESIGN_SYSTEM, dsChildren,
      { noteKind: "ds", noteSlug: dsNoteSlug(brand.name) }));

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
      filed.get(PLANTILLAS)!.map(tpl => fileNode(tpl, 3)),
      { noteKind: "plantillas", noteSlug: plantillasNoteSlug(brand.name) }));

    // ── Assets ──
    // Capped on purpose. A Content Machine run can add dozens of photos in an
    // afternoon, and drawing every one of them turns a brand into a hairball
    // that says nothing. The graph answers "this brand has assets, roughly
    // this many"; the data table is where the full list belongs, and it reads
    // /api/assets rather than this payload precisely so this one stays small.
    const assetChildren: BrandGraphNode[] = brandAssets.slice(0, ASSET_NODE_LIMIT).map(a => ({
      id: `asset:${a.id}`,
      name: a.name || a.filename || a.id,
      level: 3,
      kind: "asset",
      color,
      assetUrl: a.url || undefined,
      assetOrigin: assetOrigin(a.url),
      children: [],
    }));
    const hiddenAssets = Math.max(0, brandAssets.length - ASSET_NODE_LIMIT);
    if (hiddenAssets > 0) {
      assetChildren.push({
        id: `asset-rollup:${brand.id}`,
        name: `+${hiddenAssets} assets más`,
        level: 3,
        kind: "asset",
        color,
        rollup: hiddenAssets,
        children: [],
      });
    }
    for (const tpl of filed.get(ASSETS)!) assetChildren.push(fileNode(tpl, 3));
    pushCat(category(brand.id, color, "assets", ASSETS, assetChildren));

    // ── Archivos ──
    // A campaign is optional, and the shape of the branch says so out loud.
    // A file that has one hangs under a node named after it; a file that does
    // not hangs straight off Archivos. Nothing invents a "Sin campaña" bucket
    // — that grouped the unfiled files into something that looked like a
    // campaign, hiding the very difference worth seeing. Now the graph shows
    // at a glance which work is organised and which is not, which is what
    // makes it worth organising.
    const { campaigns, loose } = groupByCampaign(
      filed.get(ARCHIVOS)!, tpl => metaByTemplate.get(tpl.id)?.campaign,
    );
    const archivoChildren: BrandGraphNode[] = loose.map(tpl => fileNode(tpl, 3));
    for (const [campaign, groupTpls] of campaigns) {
      archivoChildren.push({
        id: `campaign:${brand.id}:${campaign}`,
        name: campaign,
        level: 3,
        kind: "category",
        color,
        category: "Campaña",
        // Kept even for a single file: the point is that the campaign is
        // visible, not that it is crowded.
        children: groupTpls.map(tpl => fileNode(tpl, 4)),
      });
    }
    pushCat(category(brand.id, color, "archivos", ARCHIVOS, archivoChildren,
      { noteKind: "archivos", noteSlug: archivosNoteSlug(brand.name) }));

    // ── Ramas vivas del Second Brain: siempre presentes, su nota se genera
    //    al primer click (lazy vault) y se re-regenera leyendo las tablas.
    //    Estrategia cuelga las personas sintéticas como hojas propias. ──
    const personas = parseStrategyPersonas(style?.strategyJson);
    children.push({
      id: `note:crm:${brand.id}`,
      name: "CRM", level: 2, kind: "note", color,
      noteKind: "crm", noteSlug: crmNoteSlug(brand.name),
      children: [],
    });
    children.push({
      id: `note:estrategia:${brand.id}`,
      name: "Estrategia de Marca", level: 2, kind: "note", color,
      noteKind: "estrategia", noteSlug: estrategiaNoteSlug(brand.name),
      children: personas.map((persona, index) => ({
        id: `note:persona:${brand.id}:${index}`,
        name: persona.name,
        level: 3, kind: "note" as const, color,
        noteKind: "persona" as const,
        noteSlug: personaNoteSlug(brand.name, index),
        personaIndex: index,
        children: [],
      })),
    });
    children.push({
      id: `note:copywriting:${brand.id}`,
      name: "Copywriting", level: 2, kind: "note", color,
      noteKind: "copywriting", noteSlug: copywritingNoteSlug(brand.name),
      children: [],
    });

    brandNodes.push({
      id: brand.id,
      name: brand.name,
      level: 1,
      kind: "brand",
      color,
      hasDesignSystem: Boolean(designSystemTemplateId),
      noteKind: "marca",
      noteSlug: brandNoteSlug(brand.name),
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
        noteKind: "archivo" as const,
        noteSlug: archivoNoteSlug(tpl.id),
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
  notes?: { noteKind: BrandNoteKind; noteSlug?: string },
): BrandGraphNode | null {
  if (children.length === 0) return null;
  return {
    id: `cat:${slug}:${brandId}`,
    name: label,
    level: 2,
    kind: "category",
    color,
    category: label,
    ...(notes ? { noteKind: notes.noteKind, ...(notes.noteSlug ? { noteSlug: notes.noteSlug } : {}) } : {}),
    children,
  };
}

/** Synthetic personas of a brand (brands.strategy_json.audience.personas). */
function parseStrategyPersonas(strategyJson?: string | null): Array<{ name: string }> {
  try {
    const list = JSON.parse(strategyJson || "null")?.audience?.personas;
    return Array.isArray(list)
      ? list.filter((p: any) => String(p?.name || "").trim()).slice(0, 12)
        .map((p: any) => ({ name: String(p.name) }))
      : [];
  } catch { return []; }
}

// ── Brand Playbook — the queryable digest of ONE brand ────────────────────

export interface BrandPlaybookItem {
  templateId: string;
  name: string;
  category: string;
  campaign?: string;
  contentKind?: string;
  isBrandManual?: boolean;
}

export interface BrandPlaybook {
  brand: { id: string; name: string };
  /** Whether the brand has its Design System file. When false the AI must
   *  tell the user and offer to create/extract it before designing — never
   *  invent a style from a handful of files (that is how bad designs happen
   *  when there is nothing to pull resources from). */
  hasDesignSystem: boolean;
  /** The brand's Design System, from the style that shares its name. */
  designSystem: {
    templateId: string | null;
    colors: string[];
    fonts: string[];
    styleFingerprint: string | null;
  } | null;
  /** Only when hasDesignSystem is false: the exact action that fixes it. */
  nextAction?: {
    tool: "create_brand_guideline";
    hint: string;
  };
  /** Every file filed under this brand, Design System container included. */
  inventory: BrandPlaybookItem[];
  /** The subset an AI may replicate for another brand: Plantillas + Archivos. */
  replicable: BrandPlaybookItem[];
  counts: { templates: number; plantillas: number; archivos: number; campaigns: number; assets: number };
  /** Container files (v47): one brand = three files. */
  containers: {
    ds: string | null;
    plantillas: string | null;
    communication: string | null;
    plantillasFrameCount: number;
  };
  /** Compact IA-readable digest of the Brand Strategy Canvas when one exists. */
  brandVoice?: string;
  /** Deterministic completeness of the three containers. */
  completeness: {
    ds: Completeness;
    strategy: Completeness;
    plantillas: Completeness;
  } | null;
}

/**
 * Tolerant DTCG walk: pulls a few colors and font families out of any
 * tokens.json shape without requiring a particular token tree. Malformed
 * tokens degrade to empty lists — the playbook still builds.
 */
function extractTokenDigest(tokensJson?: string | null): { colors: string[]; fonts: string[] } {
  const colors: string[] = [];
  const fonts: string[] = [];
  if (!tokensJson) return { colors, fonts };
  try {
    const visit = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const value = record.$value;
      if (typeof value === "string" && value) {
        if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value) && /colou?r|palette|accent|primary|secondary|brand|background|surface/i.test(path)) {
          if (colors.length < 12) colors.push(value);
        } else if (/font|typograph|family|typeface/i.test(path)) {
          if (fonts.length < 8) fonts.push(value.replace(/^["']|["']$/g, ""));
        }
      }
      for (const [key, child] of Object.entries(record)) visit(child, `${path}.${key}`);
    };
    visit(JSON.parse(tokensJson), "");
  } catch { /* malformed tokens — the playbook still builds without them */ }
  return { colors: [...new Set(colors)], fonts: [...new Set(fonts)] };
}

/**
 * Builds the AI-facing answer to "revisá toda la lógica que hicimos para la
 * marca X": what exists (inventory), how it is organized (campaigns and
 * categories), what its design system says (tokens + fingerprint), and which
 * files are replicable for another brand. The visual graph (buildBrandGraph)
 * stays optimized for drawing; this digest is optimized for being read by a
 * model that then has to act on it.
 */
export async function buildBrandPlaybook(
  workspaceId: string,
  brandIdOrName: string,
): Promise<BrandPlaybook> {
  const sb = getSupabase();
  if (!sb) throw new Error("Brand playbook requires Supabase.");
  const needle = normalizeName(brandIdOrName);

  const brandRows = await sb.from("brands").select("id, name").eq("workspace_id", workspaceId).order("name");
  if (brandRows.error) throw new Error("Brands query failed: " + brandRows.error.message);
  const brandList = (brandRows.data || []) as Array<{ id: string; name: string }>;
  const brand = brandList.find(b => b.id === brandIdOrName || normalizeName(b.name) === needle);
  if (!brand) throw new Error(`Brand not found: ${brandIdOrName}`);

  const [styles, tplResult, metaResult, assetResult] = await Promise.all([
    listBrandsByWorkspace(workspaceId).catch(() => [] as any[]),
    sb.from("templates").select("id, name, is_brand_manual, brand_container_kind, brandId:data->>brandId").eq("workspace_id", workspaceId).is("deleted_at", null).order("name"),
    selectFileMeta(sb, workspaceId),
    selectAssets(sb, workspaceId),
  ]);

  const templates = (tplResult.data || []) as any[];
  const metaRows = (metaResult.data || []) as any[];
  const assets = (assetResult.data || []) as any[];
  const metaByTemplate = new Map<string, any>();
  for (const row of metaRows) if (row.template_id) metaByTemplate.set(row.template_id, row);
  const ownerByTemplate = resolveTemplateOwners(
    templates.map(t => t.id), brandList, metaByTemplate,
  );

  // v35: the CRM link is authoritative; the name match only covers rows the
  // backfill hasn't linked yet.
  const style = styles.find(s => (s.crmBrandId && s.crmBrandId === brand.id)
    || normalizeName(s.name) === normalizeName(brand.name)) || null;
  const designSystem = style ? {
    templateId: style.designSystemTemplateId || null,
    ...extractTokenDigest(style.tokensJson),
    styleFingerprint: style.styleFingerprint || null,
  } : null;
  const hasDesignSystem = Boolean(style?.designSystemTemplateId);

  const isDsContainer = (tpl: any) => !!(style?.designSystemTemplateId && tpl.is_brand_manual && tpl.id === style.designSystemTemplateId);
  const brandTemplates = templates.filter(t => isDsContainer(t) || ownerByTemplate.get(t.id) === brand.id);
  const filed = bucketByCategory(brandTemplates.filter(t => !isDsContainer(t)), metaByTemplate);

  const item = (tpl: any, category: string): BrandPlaybookItem => ({
    templateId: tpl.id,
    name: tpl.name || tpl.id,
    category,
    campaign: metaByTemplate.get(tpl.id)?.campaign || undefined,
    contentKind: metaByTemplate.get(tpl.id)?.content_kind || undefined,
    isBrandManual: !!tpl.is_brand_manual,
  });

  const inventory: BrandPlaybookItem[] = [];
  const dsTpl = brandTemplates.find(isDsContainer);
  if (dsTpl) inventory.push(item(dsTpl, DESIGN_SYSTEM));
  for (const tpl of filed.get(DESIGN_SYSTEM)!) inventory.push(item(tpl, DESIGN_SYSTEM));
  for (const tpl of filed.get(PLANTILLAS)!) inventory.push(item(tpl, PLANTILLAS));
  for (const tpl of filed.get(ASSETS)!) inventory.push(item(tpl, ASSETS));
  for (const tpl of filed.get(ARCHIVOS)!) inventory.push(item(tpl, ARCHIVOS));

  // Replicable = finished design files (Plantillas + Archivos). Never the
  // Design System container (that is identity, not a design to copy) nor
  // anything filed under Assets.
  const replicable = inventory.filter(i => i.category === PLANTILLAS || i.category === ARCHIVOS);

  // Containers (v47): the kind column is the source of truth; the DS id
  // falls back to the style link for rows the container service hasn't
  // normalized yet. Plantillas frame count feeds the completeness badge.
  const containerByKind = new Map<string, any>();
  for (const tpl of templates) {
    if (tpl.brandId !== brand.id || !tpl.brand_container_kind) continue;
    if (!containerByKind.has(tpl.brand_container_kind)) containerByKind.set(tpl.brand_container_kind, tpl);
  }
  const plantillasTplId = containerByKind.get("plantillas")?.id || null;
  let plantillasFrameCount = 0;
  if (plantillasTplId) {
    const { data: plantillasRow } = await sb.from("templates")
      .select("frames:data->frames")
      .eq("id", plantillasTplId)
      .is("deleted_at", null)
      .maybeSingle();
    plantillasFrameCount = Array.isArray(plantillasRow?.frames) ? plantillasRow.frames.length : 0;
  }

  const campaigns = new Set<string>();
  for (const i of inventory) if (i.category === ARCHIVOS && i.campaign) campaigns.add(i.campaign);

  const targetName = normalizeName(brand.name);
  const brandAssets = assets.filter(a => {
    let tags: unknown[] = [];
    try {
      tags = typeof a.tags === "string" ? JSON.parse(a.tags || "[]") : Array.isArray(a.tags) ? a.tags : [];
    } catch { /* unparseable tags — the asset simply doesn't match */ }
    return tags.some(t => normalizeName(String(t)) === targetName);
  });

  return {
    brand,
    hasDesignSystem,
    designSystem,
    ...(hasDesignSystem ? {} : {
      nextAction: {
        tool: "create_brand_guideline" as const,
        hint: `La marca "${brand.name}" no tiene Design System todavía. Avísale al usuario y ofrécele crearlo (create_brand_guideline, o POST /api/workspaces/:id/brands/${brand.id}/design-system) o extraerlo de sus archivos con generate_design_artifacts(action="publish", brandName="${brand.name}") antes de diseñar para esta marca.`,
      },
    }),
    inventory,
    replicable,
    counts: {
      templates: brandTemplates.length,
      plantillas: filed.get(PLANTILLAS)!.length,
      archivos: filed.get(ARCHIVOS)!.length,
      campaigns: campaigns.size,
      assets: brandAssets.length,
    },
    containers: {
      ds: containerByKind.get("ds")?.id || style?.designSystemTemplateId || null,
      plantillas: plantillasTplId,
      communication: containerByKind.get("communication")?.id || null,
      plantillasFrameCount,
    },
    ...(style?.strategyJson ? { brandVoice: strategyDigest(style.strategyJson) } : {}),
    completeness: style ? {
      ds: computeDsCompleteness(style),
      strategy: computeStrategyCompleteness(style.strategyJson),
      plantillas: computePlantillasCompleteness(plantillasFrameCount),
    } : null,
  };
}
