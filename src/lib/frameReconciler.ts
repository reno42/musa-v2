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
 * Returns a Map<layerId, { element, hash }> plus how many layer elements were
 * seen in total — when total > map.size, the tree carries DUPLICATE ids.
 */
function collectLayers(root: ParentNode): Map<string, { el: Element; hash: string }> & { totalSeen?: number } {
  const map: Map<string, { el: Element; hash: string }> & { totalSeen?: number } = new Map();
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    const lid = node.getAttribute("data-layer-id");
    if (lid) {
      total++;
      map.set(lid, { el: node, hash: hashString(node.outerHTML) });
    }
  }
  map.totalSeen = total;
  return map;
}

/** Place/move `node` under `parent` right after the previously placed child. */
function ensurePlacement(parent: Node, node: Element, lastPlaced: Map<Node, Element | null>): void {
  const prev = lastPlaced.get(parent) ?? null;
  const ref: Node | null = prev ? prev.nextSibling : (parent as Element).firstChild;
  if (node === ref) return;
  if (node.parentNode === parent && node.previousSibling === prev) return;
  (parent as Element).insertBefore(node, ref === node ? node.nextSibling : ref);
}

/** Copy attributes of `from` onto `to` (add/update + remove extras). */
function syncAttributes(to: Element, from: Element): void {
  for (const attr of [...from.attributes]) {
    if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value);
  }
  for (const attr of [...to.attributes]) {
    if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
  }
}

// ── Core reconciler ──

/**
 * Apply minimal DOM mutations to make `content` match `targetHtml`.
 *
 * Strategy (hierarchy-aware — handles re-parenting like group/ungroup):
 *   1. Parse target HTML into a detached fragment; map layers of both trees.
 *   2. DELETE: current layers absent from target — but first RESCUE any
 *      descendant that still exists in target (an ungrouped wrapper must not
 *      drag its surviving children out of the DOM with it).
 *   3. SYNC: walk the target tree in document order; for every layer ensure
 *      the live node (a) has matching content — patch via clone otherwise —
 *      and (b) sits under the right live parent at the right position. This
 *      makes moves INTO/OUT OF containers first-class instead of data loss.
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

  // DUPLICATE data-layer-id bailout (legacy batch-generated designs): the
  // id-keyed diff below assumes ids are unique — with duplicates the map
  // drops siblings and the sync pass fights over shared nodes, DUPLICATING
  // or DELETING elements (worst on ungroup). A full rebuild renders the
  // target verbatim: slower, but never corrupts.
  const hasDuplicates =
    (targetLayers.totalSeen || 0) > targetLayers.size ||
    (currentLayers.totalSeen || 0) > currentLayers.size;
  if (hasDuplicates) {
    content.innerHTML = targetHtml;
    return {
      patched: 0,
      inserted: targetLayers.size,
      removed: currentLayers.size,
      skipped: 0,
      durationMs: performance.now() - t0,
    };
  }

  let patched = 0;
  let inserted = 0;
  let removed = 0;
  let skipped = 0;

  // DELETE with RESCUE — a removed wrapper must not take surviving layers down.
  for (const [lid, { el }] of currentLayers) {
    if (targetLayers.has(lid)) continue;
    if (!el.isConnected) { removed++; currentLayers.delete(lid); continue; }
    for (const desc of [...el.querySelectorAll("[data-layer-id]")]) {
      const did = desc.getAttribute("data-layer-id");
      if (did && targetLayers.has(did)) content.appendChild(desc); // detached-but-alive; SYNC re-places it
    }
    el.remove();
    removed++;
    currentLayers.delete(lid);
  }

  /** Live element registry, updated as clones replace or arrive. */
  const liveById = new Map<string, Element>();
  for (const [lid, { el }] of currentLayers) liveById.set(lid, el);

  /** Per live-parent pointer to the last placed child (ordered insertion). */
  const lastPlaced = new Map<Node, Element | null>();

  const registerSubtree = (root: Element) => {
    for (const [nlid, entry] of collectLayers(root)) liveById.set(nlid, entry.el);
    const rid = root.getAttribute("data-layer-id");
    if (rid) liveById.set(rid, root);
  };
  const unregisterDescendants = (root: Element) => {
    for (const desc of [...root.querySelectorAll("[data-layer-id]")]) {
      const did = desc.getAttribute("data-layer-id");
      if (did) liveById.delete(did);
    }
  };

  // SYNC — explicit DFS over the target tree. Layer parents are visited before
  // their layer children, so the live parent always exists when needed.
  type StackItem = { node: Element; liveParent: () => Node };
  const rootParent = () => content as Node;
  const stack: StackItem[] = [...template.content.children]
    .filter((c): c is Element => c.nodeType === 1)
    .reverse()
    .map(node => ({ node, liveParent: rootParent }));

  while (stack.length) {
    const { node: tNode, liveParent } = stack.pop()!;
    const lid = tNode.getAttribute("data-layer-id");

    if (!lid) {
      // Non-layer wrapper in target: descend with the same live parent.
      stack.push(...[...tNode.children].filter((c): c is Element => c.nodeType === 1).reverse()
        .map(node => ({ node, liveParent })));
      continue;
    }

    const parent = liveParent();
    const live = liveById.get(lid);
    const targetHash = hashString(tNode.outerHTML);

    if (!live) {
      // INSERT — whole subtree arrives as a clone.
      const clone = tNode.cloneNode(true) as Element;
      ensurePlacement(parent, clone, lastPlaced);
      lastPlaced.set(parent, clone);
      registerSubtree(clone);
      inserted++;
      continue;
    }

    if (hashString(live.outerHTML) === targetHash) {
      // MATCH — identical subtree; still enforce parent + order (re-parenting).
      ensurePlacement(parent, live, lastPlaced);
      lastPlaced.set(parent, live);
      skipped++;
      continue;
    }

    const hasLayerChildren = !!tNode.querySelector("[data-layer-id]");
    if (!hasLayerChildren) {
      // LEAF PATCH — replace just this subtree.
      const clone = tNode.cloneNode(true) as Element;
      if (live.isConnected) live.replaceWith(clone); 
      ensurePlacement(parent, clone, lastPlaced);
      lastPlaced.set(parent, clone);
      unregisterDescendants(live);
      liveById.set(lid, clone);
      patched++;
      continue;
    }

    // CONTAINER PATCH — sync own attributes, keep the node, recurse into
    // children so unchanged grandchildren keep their live DOM nodes.
    syncAttributes(live, tNode);
    ensurePlacement(parent, live, lastPlaced);
    lastPlaced.set(parent, live);
    if (!lastPlaced.has(live)) lastPlaced.set(live, null);
    patched++;
    const liveRef = live;
    stack.push(...[...tNode.children].filter((c): c is Element => c.nodeType === 1).reverse()
      .map(node => ({ node, liveParent: () => liveRef as Node })));
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
