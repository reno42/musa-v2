/**
 * Brain note zones (harness/BRAIN_NOTES_SPEC.md §3).
 *
 * A brain note body is Markdown with up to three fenced zones:
 *
 *   <!-- generated -->  …  <!-- /generated -->   system, rebuilt on every emit
 *   <!-- agent -->      …  <!-- /agent -->       IA output, cached between runs
 *   <!-- human -->      …  <!-- /human -->      human markdown, never touched
 *
 * The generated zone is rebuilt from source tables; human/agent blocks survive
 * regeneration verbatim (protectHumanBlocks in api/src/services/brainNotes.ts).
 * This module is the shared, dependency-free parser so the API and the browser
 * agree on where one zone ends and the next begins. Text outside any fence is
 * treated as human (legacy free-form notes predate the fences).
 */

export type BrainNoteZones = {
  generated: string;
  agent: string;
  /** Human markdown: fenced human blocks in order plus any unfenced text. */
  human: string;
  /** True when the body contained no fences at all (legacy free-form note). */
  legacyFreeForm: boolean;
};

const GENERATED_RE = /<!--\s*generated\s*-->([\s\S]*?)<!--\s*\/generated\s*-->/gi;
const AGENT_RE = /<!--\s*agent\s*-->([\s\S]*?)<!--\s*\/agent\s*-->/gi;
const HUMAN_RE = /<!--\s*human\s*-->[\s\S]*?<!--\s*\/human\s*-->/gi;
const FENCE_RE = /<!--\s*(\/?)(generated|agent|human)\s*-->/i;

/** Pull the inner text of every fenced zone of one kind, in order. */
function zoneText(body: string, re: RegExp): string {
  const parts: string[] = [];
  for (const match of body.matchAll(re)) parts.push(match[1] ?? "");
  return parts.map(p => p.trim()).filter(Boolean).join("\n\n");
}

/** Split a note body into its rendered zones. */
export function splitNoteZones(body: string | null | undefined): BrainNoteZones {
  const source = String(body || "");
  const hasFence = FENCE_RE.test(source);
  const generated = zoneText(source, GENERATED_RE);
  const agent = zoneText(source, AGENT_RE);

  // Human = fenced human blocks (inner text, in order) + any text that lives
  // outside every fence. Fence lines themselves never leak into the zones.
  const humanChunks: string[] = [];
  for (const match of source.matchAll(/<!--\s*human\s*-->([\s\S]*?)<!--\s*\/human\s*-->/gi)) {
    const inner = match[1]?.trim();
    if (inner) humanChunks.push(inner);
  }
  let outside = "";
  if (hasFence) {
    let cursor = 0;
    for (const match of source.matchAll(/<!--\s*\/?(?:generated|agent|human)\s*-->[\s\S]*?<!--\s*\/(?:generated|agent|human)\s*-->|<!--\s*\/?(?:generated|agent|human)\s*-->/gi)) {
      outside += source.slice(cursor, match.index ?? cursor);
      cursor = (match.index ?? cursor) + match[0].length;
    }
    outside += source.slice(cursor);
  } else {
    outside = source;
  }
  const stray = outside.replace(HUMAN_RE, "").trim();
  if (stray) humanChunks.unshift(stray);

  return {
    generated,
    agent,
    human: humanChunks.join("\n\n"),
    legacyFreeForm: !hasFence,
  };
}

/** Wrap human markdown in its fence. Empty input → empty string. */
export function humanBlock(humanMd: string): string {
  const trimmed = String(humanMd || "").trim();
  if (!trimmed) return "";
  return `<!-- human -->\n${trimmed}\n<!-- /human -->`;
}
