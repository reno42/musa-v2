/**
 * FrameReconciler — incremental DOM patching for frame HTML.
 *
 * Replaces `content.innerHTML = frame.html` (full DOM teardown/rebuild) with
 * layer-level diffing by [data-layer-id]. Only nodes whose content changed are
 * patched; untouched nodes stay in the DOM with their event listeners, scroll
 * positions, and rendered state intact.
 *
 * Performance budgets (Sprint 2 acceptance criteria):
 *   - Single-layer commit: < 30 ms DOM stable
 *   - Nodes re-created per 1-layer commit: exactly 1
 *   - 200-layer frame: ≥ 55 fps during drag (achieved via CSS-only transform)
 */

// ── Types ──

export interface PatchStats {
  /** Layers replaced (content hash mismatch). */
  patched: number;
  /** Layers inserted (not present in current DOM). */
  inserted: number;
  /** Layers removed (not present in target HTML). */
  removed: number;
  /** Layers skipped (content hash match). */
  skipped: number;
  /** Wall-clock duration of the patch pass in milliseconds. */
  durationMs: number;
}

// ── Helpers ──

/** Fast, non-crypto string hash for equality checks (FNV-1a inspired). */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h = h & h; // 32-bit
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

/**
 * Collect all elements with [data-layer-id] from a parent, recursively.
 * Returns a Map<layerId, { element, hash }>.
 */
function collectLayers(root: ParentNode): Map<string, { el: Element; hash: string }> {
  const map = new Map<string, { el: Element; hash: string }>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    const lid = node.getAttribute("data-layer-id");
    if (lid) {
      map.set(lid, { el: node, hash: hashString(node.outerHTML) });
    }
  }
  return map;
}

// ── Core reconciler ──

/**
 * Apply minimal DOM mutations to make `content` match `targetHtml`.
 *
 * Strategy:
 *   1. Parse target HTML into a detached DocumentFragment.
 *   2. Walk BOTH trees collecting layerId → element maps.
 *   3. DELETE: current layers not in target.
 *   4. PATCH: layers whose outerHTML hash differs → replaceWith(clone).
 *   5. INSERT: target layers not in current → appendChild.
 *
 * Preserves untouched elements (no re-parse, no re-attach, no re-paint).
 */
export function reconcileFrameHtml(
  content: HTMLElement,
  targetHtml: string,
): PatchStats {
  const t0 = performance.now();

  // Parse target → detached fragment
  const template = document.createElement("template");
  template.innerHTML = targetHtml;
  const targetLayers = collectLayers(template.content);

  // Current live DOM
  const currentLayers = collectLayers(content);

  let patched = 0;
  let inserted = 0;
  let removed = 0;
  let skipped = 0;

  // DELETE — layers in current DOM but not in target
  for (const [lid, { el }] of currentLayers) {
    if (!targetLayers.has(lid)) {
      el.remove();
      removed++;
    }
  }

  // PATCH / INSERT / SKIP — layers in target
  for (const [lid, { el: targetEl, hash: targetHash }] of targetLayers) {
    const current = currentLayers.get(lid);

    if (!current) {
      // INSERT — clone from template fragment and append
      const clone = targetEl.cloneNode(true) as Element;
      content.appendChild(clone);
      inserted++;
    } else if (current.hash !== targetHash) {
      // PATCH — replace in place
      const clone = targetEl.cloneNode(true) as Element;
      current.el.replaceWith(clone);
      patched++;
    } else {
      // SKIP — no change
      skipped++;
    }
  }

  const durationMs = performance.now() - t0;

  // Expose stats to agent bridge for CI measurement
  if (typeof window !== "undefined" && (window as any).futurariaAgent) {
    (window as any).futurariaAgent.__lastReconcile = {
      patched, inserted, removed, skipped, durationMs,
    };
  }

  return { patched, inserted, removed, skipped, durationMs };
}

/**
 * Lightweight "hash-only" check — returns true if the content matches
 * without touching the DOM at all. Used to skip reconciliation entirely
 * when the HTML hasn't changed (complement to echo-suppression).
 */
export function frameHtmlMatches(
  content: HTMLElement,
  targetHtml: string,
): boolean {
  const template = document.createElement("template");
  template.innerHTML = targetHtml;
  const targetLayers = collectLayers(template.content);
  const currentLayers = collectLayers(content);

  if (targetLayers.size !== currentLayers.size) return false;

  for (const [lid, { hash }] of targetLayers) {
    const cur = currentLayers.get(lid);
    if (!cur || cur.hash !== hash) return false;
  }

  return true;
}
