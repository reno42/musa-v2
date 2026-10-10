/**
 * Tijeras (Scissors) — REQ-043 Fase 3: cortar un path por un punto exacto
 * de un segmento. Un path CERRADO queda ABIERTO (una sola pieza: el ancla
 * del corte se duplica en ambos extremos, sin Z); un path ABIERTO se parte
 * en DOS subpaths que comparten el ancla del corte.
 *
 * Reusa splitPathSegment, así que el ancla insertada hereda los sub-curvas
 * correctos del Bézier partido (los handles vecinos se re-acortan a la
 * mitad que les toca). TS puro, sin DOM/Node → corre igual en el editor y
 * en Cloudflare Workers.
 */
import { splitPathSegment, type PathPoint } from "../pathData.ts";

/** Pieza de un corte: siempre un subpath ABIERTO — un relleno lo
 * re-cerraría con la línea de cierre implícita, así que el caller debe
 * pintarlas con fill="none". */
export interface CutPathPiece {
  paths: PathPoint[];
  closed: false;
}

/**
 * Corta el path en (endIndex, t) del segmento — exactamente la salida de
 * findClosestPathSegment. Devuelve null cuando el corte es degenerado:
 * path de menos de 2 anclas, índice fuera de rango, o el extremo suelto
 * de un path ya abierto (cortar donde no hay path no hace nada).
 */
export function cutPathAtPoint(
  points: PathPoint[],
  endIndex: number,
  t: number,
  closed: boolean,
): CutPathPiece[] | null {
  if (points.length < 2 || endIndex < 1 || endIndex > points.length) return null;
  if (!closed && endIndex >= points.length) return null;

  const split = splitPathSegment(points, endIndex, t, closed);
  // El splitter devuelve el array original cuando no partió nada.
  if (split.length === points.length) return null;

  // El ancla recién insertada: en endIndex, o la última si el corte cayó
  // en el segmento de cierre (endIndex === points.length).
  const cutIdx = Math.min(endIndex, split.length - 1);
  const cut = split[cutIdx];
  if (!cut) return null;

  if (closed) {
    // Rotar para que el ancla del corte abra y cierre la secuencia: la
    // copia inicial conserva su handle saliente, la final el entrante.
    const rest = [...split.slice(cutIdx + 1), ...split.slice(0, cutIdx)];
    const start = { ...cut, type: "anchor" as const, cpIn: undefined };
    const end = { ...cut, type: "anchor" as const, cpOut: undefined };
    return [{ paths: [start, ...rest, end], closed: false }];
  }

  // Path abierto: dos subpaths con copias INDEPENDIENTES del ancla del
  // corte (una solo con el handle entrante, otra con el saliente) —
  // compartir el objeto corrompería los handles al limpiarlos.
  const head = [...split.slice(0, endIndex), { ...cut, type: "anchor" as const, cpOut: undefined }];
  const tail = [{ ...cut, type: "anchor" as const, cpIn: undefined }, ...split.slice(endIndex + 1)];
  if (head.length < 2 || tail.length < 2) return null;
  return [{ paths: head, closed: false }, { paths: tail, closed: false }];
}
