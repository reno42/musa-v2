/**
 * Tag hierarchy — REQ-061 Fase 2.
 * ──────────────────────────────────────────────────────────────
 * Los tags viven como paths punteados ("redes", "redes.instagram") en
 * design_file_meta.tags y design_tags.name. Este módulo PURA deriva el
 * árbol de esa sola convención — sin leer la registry — para que el grafo
 * del second brain (KnowledgeGraph y BrandGraphCanvas) anide hijos bajo
 * su padre en vez de dibujar una órbita plana.
 *
 * Consumidores: src/lib/designGraph.ts, src/components/BrandGraphCanvas.tsx.
 * Cero I/O, cero React — testeable en QA con node:test.
 */

export interface TagHierarchyNode {
  /** Full dotted path, e.g. "redes.instagram". Normalized lowercase. */
  path: string;
  /** Last segment, e.g. "instagram" — the label a node renders. */
  leaf: string;
  /** Members attached to THIS exact path (0 for implied ancestors). */
  degree: number;
  /** degree of the node plus every descendant — the ranking signal. */
  totalDegree: number;
  parent: string | null;
  children: TagHierarchyNode[];
}

/** Implied ancestor nodes exist so "redes.instagram.stories" hangs off a
 *  visible "redes.instagram" even when nobody tagged that exact path. */
export function buildTagTree(degrees: Map<string, number>): {
  roots: TagHierarchyNode[];
  byPath: Map<string, TagHierarchyNode>;
} {
  const byPath = new Map<string, TagHierarchyNode>();
  const ensure = (rawPath: string): TagHierarchyNode => {
    const path = String(rawPath || "").trim().toLowerCase();
    let node = byPath.get(path);
    if (node) return node;
    node = {
      path,
      leaf: path.split(".").pop() || path,
      degree: degrees.get(path) || 0,
      totalDegree: 0,
      parent: null,
      children: [],
    };
    byPath.set(path, node);
    const dot = path.lastIndexOf(".");
    if (dot > 0) {
      const parent = ensure(path.slice(0, dot));
      node.parent = parent.path;
      parent.children.push(node);
    }
    return node;
  };
  for (const [path, degree] of degrees) {
    if (!(degree > 0)) continue; // callers may pre-seed junk; only real tags branch
    const clean = String(path || "").trim().toLowerCase();
    if (!clean) continue; // an empty tag is never a branch
    ensure(clean);
  }
  const roots = [...byPath.values()].filter(n => n.parent === null);
  const computeTotal = (node: TagHierarchyNode): number => {
    node.totalDegree = node.degree + node.children.reduce((sum, child) => sum + computeTotal(child), 0);
    return node.totalDegree;
  };
  for (const root of roots) computeTotal(root);
  const byTotal = (a: TagHierarchyNode, b: TagHierarchyNode) =>
    b.totalDegree - a.totalDegree || a.path.localeCompare(b.path);
  roots.sort(byTotal);
  for (const node of byPath.values()) node.children.sort(byTotal);
  return { roots, byPath };
}

/**
 * Top-N selection with ancestor closure: rank REAL tags (degree > 0) by
 * totalDegree, keep the best `limit`, and add every ancestor so no child
 * ever renders without its parent. Returns full paths.
 */
export function selectVisibleTags(
  byPath: Map<string, TagHierarchyNode>,
  limit: number,
): Set<string> {
  const visible = new Set<string>();
  if (limit <= 0) return visible;
  const ranked = [...byPath.values()]
    .filter(n => n.degree > 0)
    .sort((a, b) => b.totalDegree - a.totalDegree || a.path.localeCompare(b.path))
    .slice(0, limit);
  for (const node of ranked) {
    visible.add(node.path);
    for (let p = node.parent; p; p = byPath.get(p)?.parent ?? null) visible.add(p);
  }
  return visible;
}

/** Aggregate member lists a parent inherits from its subtree (canvas radius).
 *  Generic: members may be design ids (graph) or sim nodes (canvas). */
export function subtreeMembers<T>(node: TagHierarchyNode, membersByPath: Map<string, T[]>): T[] {
  const own = membersByPath.get(node.path) || [];
  return node.children.reduce((all, child) => all.concat(subtreeMembers(child, membersByPath)), own);
}
