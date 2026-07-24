/**
 * Version comparison — pure logic, zero IO.
 *
 * Kept apart from versionHistory.ts (which talks to Supabase and Storage) so
 * the rule that decides what counts as a change can be unit-tested directly,
 * and so the MCP layer can reason about frames without loading a payload.
 */

/** One frame as stored in a version: loose on purpose, so a payload written by
 *  an older build still compares and restores. */
export interface VersionFrame {
  id: string;
  name?: string;
  html?: string;
  css?: string;
  [key: string]: unknown;
}

export type FrameDiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface FrameDiff {
  frameId: string;
  frameName?: string;
  status: FrameDiffStatus;
  before: { html: string; css: string } | null;
  after: { html: string; css: string } | null;
}

/**
 * Stable content hash for one frame — the same algorithm the MCP change tools
 * use, so hashes recorded in a version are comparable with get_frame_changes.
 * The "||" separator keeps html and css from blurring into each other.
 */
export function hashFrameContent(html: string, css: string): string {
  const source = `${html}||${css}`;
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** Compare two sets of frames, optionally narrowed to a single frame id. */
export function compareFrameSets(
  before: VersionFrame[],
  after: VersionFrame[],
  frameId?: string,
): FrameDiff[] {
  const beforeById = new Map(before.map(f => [f.id, f]));
  const afterById = new Map(after.map(f => [f.id, f]));
  const ids = frameId ? [frameId] : [...new Set([...beforeById.keys(), ...afterById.keys()])];

  return ids.map(id => {
    const b = beforeById.get(id);
    const a = afterById.get(id);
    const beforeContent = b ? { html: String(b.html || ""), css: String(b.css || "") } : null;
    const afterContent = a ? { html: String(a.html || ""), css: String(a.css || "") } : null;
    let status: FrameDiffStatus;
    if (!b) status = a ? "added" : "removed";
    else if (!a) status = "removed";
    else {
      status = hashFrameContent(beforeContent!.html, beforeContent!.css)
        === hashFrameContent(afterContent!.html, afterContent!.css) ? "unchanged" : "modified";
    }
    return {
      frameId: id,
      frameName: (a?.name || b?.name) as string | undefined,
      status,
      before: beforeContent,
      after: afterContent,
    };
  });
}
