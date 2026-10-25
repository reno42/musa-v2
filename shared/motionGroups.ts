/**
 * REQ-053 F3 — Transformaciones de grupo, aplanado determinista.
 *
 * El spec permite `parentId` en cualquier nodo (kind "group" como contenedor
 * lógico). Hoy `motionSpecToAnimationSchema` descarta los groups — el
 * transform del padre se pierde. Este módulo es el núcleo puro que resuelve
 * la brecha SIN tocar renderers:
 *
 *  - Misma matemática para preview y export: componer la cadena
 *    root → ... → hijo como transformadas restringidas T(x,y)·S(s)·R(θ)
 *    (el formato exacto que `transformAt` de motionSpec ya emite).
 *    La composición de formas restringidas CIERRA en la misma forma:
 *      Θ = θp + θc · S = ps·sc · (X,Y) = (px,py) + ps·R(θp)·(cx,cy)
 *  - La opacidad se multiplica por la cadena (semántica CSS de opacity en
 *    contenedores).
 *  - Cada hijo conserva su clip propio (el resultado es por-nodo); el padre
 *    queda como agrupación lógica, no como clip.
 *
 * Honesty rules: función pura, sin DOM ni I/O — corre en editor, compiler y
 * node QA. El wiring del compilador/MCP queda como shim documentado en
 * REQ-053 §4 mientras sus archivos están en sesión concurrente.
 */
import type { SubsetIssue } from "./motionSubset.ts";

/** Estado de transformación de un nodo — misma convención que `transformAt`
 *  de motionSpec: x/y px, scale multiplicador (1 = 100%), rotation grados. */
export interface NodeTransformState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export const IDENTITY_TRANSFORM: NodeTransformState = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

/** Shape mínima que este módulo necesita — compatible con MotionSpec
 *  normalizado y con specs crudos (para QA sin pasar por normalize). */
export interface GroupNodeLike {
  id: string;
  parentId?: string;
  props?: Record<string, unknown>;
}

export interface GroupKeyframeLike {
  nodeId: string;
  property: string;
  timeMs: number;
  value: unknown;
}

export interface GroupFlattenOptions {
  /** Instante de muestreo para keyframes (default 0). */
  atMs?: number;
  /** Profundidad máxima de cadena — corta ciclos patológicos además del
   *  guard explícito de ciclos. Default 16 (spec real no pasa de 3-4). */
  maxDepth?: number;
}

export interface GroupFlattenResult {
  /** Transform combinado por nodo (incluye los groups mismos). Nodos con
   *  problema (ciclo/d-padre/profundidad) quedan FUERA del mapa. */
  combinedByNodeId: Map<string, NodeTransformState>;
  /** Nodos cuyo resultado viene de una cadena de ≥1 ancestro — el consumer
   *  (shim del compilador) usa esto para saber a quién aplicar el flatten. */
  chainedNodeIds: Set<string>;
  issues: SubsetIssue[];
}

/** Igual que `numericAt` de motionSpec: el último keyframe numérico con
 *  timeMs <= atMs (en orden de array), si no el prop numérico, si no el
 *  default. */
function sampleNumber(
  keyframes: GroupKeyframeLike[] | undefined,
  nodeId: string,
  property: string,
  atMs: number,
  props: Record<string, unknown> | undefined,
  prop: string,
  fallback: number,
): number {
  if (keyframes) {
    const candidates = keyframes.filter(
      (frame) => frame.nodeId === nodeId && frame.property === property && typeof frame.value === "number" && frame.timeMs <= atMs,
    );
    const latest = candidates[candidates.length - 1];
    if (latest && typeof latest.value === "number") return latest.value;
  }
  const raw = props?.[prop];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** Muestrea el transform declarativo del nodo en `atMs` — espejo de
 *  `transformAt` de motionSpec (defaults 0,0,1,0) + opacity (default 1). */
export function sampleNodeTransform(
  node: GroupNodeLike,
  keyframes: GroupKeyframeLike[] | undefined,
  atMs: number,
): NodeTransformState {
  const props = node.props;
  return {
    x: sampleNumber(keyframes, node.id, "x", atMs, props, "x", 0),
    y: sampleNumber(keyframes, node.id, "y", atMs, props, "y", 0),
    scale: sampleNumber(keyframes, node.id, "scale", atMs, props, "scale", 1),
    rotation: sampleNumber(keyframes, node.id, "rotation", atMs, props, "rotation", 0),
    opacity: sampleNumber(keyframes, node.id, "opacity", atMs, props, "opacity", 1),
  };
}

/** Compone `outer ∘ inner` (outer aplica DESPUÉS, como CSS anidado:
 *  screen = P·C·punto). Ambas en forma restringida; el resultado también. */
export function composeInto(outer: NodeTransformState, inner: NodeTransformState): NodeTransformState {
  const cos = Math.cos((outer.rotation * Math.PI) / 180);
  const sin = Math.sin((outer.rotation * Math.PI) / 180);
  return {
    x: outer.x + outer.scale * (inner.x * cos - inner.y * sin),
    y: outer.y + outer.scale * (inner.x * sin + inner.y * cos),
    scale: outer.scale * inner.scale,
    rotation: outer.rotation + inner.rotation,
    opacity: outer.opacity * inner.opacity,
  };
}

/** Cadena root → ... → hoja: fold de composeInto. Asociativa por
 *  construcción (producto de matrices 3×3 en forma restringida). */
export function composeChain(states: NodeTransformState[]): NodeTransformState {
  return states.reduce((acc, next) => composeInto(acc, next));
}

/** Aplana las cadenas de grupos de un spec completo. Determinista: el orden
 *  de recorrido es el del array y los errores de estructura (ciclo,
 *  profundidad) excluyen al nodo pero no abortan el resto. */
export function flattenGroupTransforms(
  nodes: GroupNodeLike[],
  keyframes: GroupKeyframeLike[] | undefined,
  opts: GroupFlattenOptions = {},
): GroupFlattenResult {
  const atMs = typeof opts.atMs === "number" && Number.isFinite(opts.atMs) ? opts.atMs : 0;
  const maxDepth = typeof opts.maxDepth === "number" && opts.maxDepth >= 1 ? Math.floor(opts.maxDepth) : 16;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const combinedByNodeId = new Map<string, NodeTransformState>();
  const depthByNodeId = new Map<string, number>(); // profundidad REAL de la cadena (root=1)
  const chainedNodeIds = new Set<string>();
  const issues: SubsetIssue[] = [];

  for (const node of nodes) {
    // Ascender root → nodo. Si un ancestro ya está resuelto, reutilizar:
    // la profundidad se hereda del caché (el guard vale igual aunque el
    // walk se corte temprano).
    const chain: GroupNodeLike[] = [];
    const seen = new Set<string>([node.id]);
    let cursor: GroupNodeLike | undefined = node;
    let broken: { code: string; nodeId: string; missingId?: string } | null = null;
    while (cursor) {
      chain.unshift(cursor);
      if (chain.length > maxDepth) {
        broken = { code: "GROUP_DEPTH_EXCEEDED", nodeId: node.id };
        break;
      }
      const parentId = typeof cursor.parentId === "string" ? cursor.parentId : "";
      if (!parentId) break;
      if (seen.has(parentId) || parentId === cursor.id) {
        broken = { code: "GROUP_CYCLE", nodeId: node.id };
        break;
      }
      const resolved = combinedByNodeId.get(parentId);
      if (resolved) {
        const parentDepth = depthByNodeId.get(parentId) ?? 1;
        if (parentDepth + 1 > maxDepth) {
          broken = { code: "GROUP_DEPTH_EXCEEDED", nodeId: node.id };
          break;
        }
        // Ancestro ya computado: la cadena efectiva es su resultado + este nodo.
        combinedByNodeId.set(node.id, composeInto(resolved, sampleNodeTransform(node, keyframes, atMs)));
        depthByNodeId.set(node.id, parentDepth + 1);
        chainedNodeIds.add(node.id); // tiene ≥1 ancestro por definición
        cursor = undefined;
        break;
      }
      const parent = byId.get(parentId);
      if (!parent) {
        broken = { code: "GROUP_PARENT_MISSING", nodeId: node.id, missingId: parentId };
        break;
      }
      seen.add(parentId);
      cursor = parent;
    }
    if (broken) {
      const code = broken.code;
      const message =
        code === "GROUP_CYCLE"
          ? `Ciclo en parentId desde ${node.id}.`
          : code === "GROUP_PARENT_MISSING"
            ? `El nodo ${node.id} referencia un parentId inexistente: ${broken.missingId}.`
            : `Cadena de grupos más profunda que maxDepth=${maxDepth} desde ${node.id}.`;
      issues.push({ severity: "error", code, path: `$.nodes.${broken.nodeId}.parentId`, message });
      continue;
    }
    if (!cursor) continue; // resuelto vía caché de ancestro
    // Cadena completa root → nodo: componer progresivamente y cachear CADA
    // eslabón — los descendientes futuros quedan en O(1) y la profundidad
    // registrada es la real.
    let acc: NodeTransformState | undefined;
    for (let index = 0; index < chain.length; index++) {
      const own = sampleNodeTransform(chain[index], keyframes, atMs);
      acc = acc ? composeInto(acc, own) : { ...own };
      const link = chain[index];
      if (!combinedByNodeId.has(link.id)) {
        combinedByNodeId.set(link.id, acc);
        depthByNodeId.set(link.id, index + 1);
        if (index > 0) chainedNodeIds.add(link.id);
      }
    }
  }

  return { combinedByNodeId, chainedNodeIds, issues };
}
