/**
 * A group cannot paint.
 *
 * The editor's panel no longer offers a group a fill of its own — its fill
 * fans out to its members. But the panel is one writer among many: an agent
 * driving the MCP tools writes HTML and CSS directly, and nothing stopped it
 * marking a wrapper as a group and painting a box on it. The result is the bug
 * Renzo reported: ungrouping throws the backdrop away, because the paint lived
 * on scaffolding that ungrouping is entitled to dissolve.
 *
 * Forbidding `background-color` outright is not the answer — for a rectangle
 * that property IS its fill, and a div has no other way to colour its inside.
 * What must be impossible is the COMBINATION: a layer that is marked a group
 * and also paints.
 *
 * So when both are true, the mark is what gives. Painting a box is a design
 * decision someone made on purpose; calling that box scaffolding is the
 * mistake. The layer becomes a container, which is what it always was, and
 * ungrouping leaves it alone. Nothing painted is ever discarded.
 *
 * This runs at the persistence boundary, so it holds for every writer —
 * today's tools, tomorrow's, the UI, and any agent — rather than at each of
 * the eighty-odd places that save a template.
 *
 * The paint rules mirror `src/lib/layerKind.ts`, which classifies layers on
 * the frontend. The two packages are sealed to their own `src`, so the list
 * lives in both; keep them in step.
 */

/** CSS that means "somebody drew this box". */
const PAINT_PROPS = [
  "background", "background-color", "background-image",
  "border", "border-width", "border-top", "border-right", "border-bottom", "border-left",
  "box-shadow", "backdrop-filter",
];

/** Values that look like paint but are not. */
const BLANK_PAINT = new Set([
  "none", "transparent", "0", "0px", "initial", "unset", "inherit", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)",
]);

/** True when this block of declarations paints a visible box. */
export function paintsABox(declarations: string | null | undefined): boolean {
  const style = (declarations || "").toLowerCase();
  if (!style) return false;

  for (const prop of PAINT_PROPS) {
    // The boundary stops `background-color:` matching inside `background-clip:`
    // and `border-width` inside `-webkit-border-width`.
    const hit = style.match(new RegExp(`(^|[;{])\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
    if (!hit) continue;
    const value = hit[2].trim().replace(/!important$/, "").trim();
    if (!value || BLANK_PAINT.has(value)) continue;
    // A zero-width BORDER draws nothing. Scoped to borders on purpose: a
    // shadow legitimately starts at a zero offset.
    if (prop.startsWith("border") && /^0(px)?(\s|$)/.test(value)) continue;
    return true;
  }
  return false;
}

/** The declaration block of the rule addressing one layer, across the stylesheet. */
function declarationsForLayer(css: string, layerId: string): string {
  const escaped = layerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleRe = new RegExp(`\\[data-layer-id="${escaped}"\\]\\s*\\{([^}]*)\\}`, "g");
  let blocks = "";
  let match: RegExpExecArray | null;
  // A layer can be addressed by more than one rule; any of them may paint.
  while ((match = ruleRe.exec(css)) !== null) blocks += `;${match[1]}`;
  return blocks;
}

export interface GroupPaintResult {
  html: string;
  /** Layers that were marked groups while painting, and are now containers. */
  retagged: string[];
}

/**
 * Re-tags every painting group as a container.
 *
 * Reads both the inline style and the stylesheet: an agent may write the paint
 * either way, and a rule in `css` is the more common of the two.
 */
export function enforceGroupsDoNotPaint(html: string, css: string): GroupPaintResult {
  if (!html || !html.includes('data-layer-kind="group"')) return { html: html || "", retagged: [] };

  const retagged: string[] = [];
  // Matches one opening tag carrying the group mark, so its own attributes can
  // be read without parsing the whole document.
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)>/g;

  const out = html.replace(tagRe, (whole, tag: string, attrs: string) => {
    if (!/data-layer-kind\s*=\s*"group"/.test(attrs)) return whole;

    const layerId = /data-layer-id\s*=\s*"([^"]*)"/.exec(attrs)?.[1] || "";
    const inline = /style\s*=\s*"([^"]*)"/.exec(attrs)?.[1] || "";
    const fromSheet = layerId ? declarationsForLayer(css || "", layerId) : "";
    if (!paintsABox(inline) && !paintsABox(fromSheet)) return whole;

    if (layerId) retagged.push(layerId);
    return `<${tag}${attrs.replace(/data-layer-kind\s*=\s*"group"/, 'data-layer-kind="container"')}>`;
  });

  return { html: out, retagged };
}
