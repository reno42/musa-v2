/**
 * Cuchillo (Knife) — REQ-043 Fase 3: rebanar formas cerradas con una línea
 * libre. Cada pieza es la intersección de la geometría aplanada de la forma
 * con el semiplano a cada lado de la línea — QUADS enormes, no un
 * "polígono" de cero grosor: un cortador sin área siembra slivers
 * degenerados que tumban al sweep de Martinez (la misma lección del offset
 * en pathOps/offset.ts).
 *
 * TS puro, sin DOM/Node → corre igual en el editor y en Cloudflare Workers.
 */
import polygonClipping from "polygon-clipping";
import { sampleShapeRing, ringsToPathD } from "../pathBoolean.ts";

type Pt = [number, number];
type Ring = Pt[];

/** Una pieza resultante: path `d` cerrado (puede traer varios anillos —
 * outer + agujeros, serializados con ringsToPathD) y el relleno heredado. */
export interface KnifePiece {
  d: string;
  fill?: string;
}

function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * Corta UNA forma con la línea (x1,y1)→(x2,y2) en coordenadas del frame.
 * Devuelve las piezas (cada una cerrada, con el relleno original) o null
 * cuando la línea no cruza COMPLETAMENTE la figura — pasa fuera, la roza
 * sin atravesarla, el drag entra pero no sale, o el path no se pudo
 * aplanar. El rechazo siempre deja la forma intacta.
 */
export function knifeCutShape(
  d: string,
  fill: string | undefined,
  x1: number, y1: number, x2: number, y2: number,
): KnifePiece[] | null {
  const ring = sampleShapeRing(d);
  if (!ring) return null;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = -dy / len; // normal unitaria a la línea
  const ny = dx / len;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  // El quad del semiplano debe envolver con holgura toda la figura desde
  // la línea: big crece con el bbox para que ningún vértice quede fuera.
  const big = 3 * Math.max(maxX - minX, maxY - minY, 1) + 100;

  const shape = [ring.map((pt): Pt => [pt[0], pt[1]])];
  // Devuelve POLÍGONOS (uno por pieza: su outer viaja con sus agujeros), no
  // anillos sueltos — aplanar aquí separaría el agujero de su pieza.
  const cut = (side: 1 | -1): Ring[][] | null => {
    // Quad del semiplano: la línea como arista compartida + los otros dos
    // vértices proyectados lejos hacia ese lado de la normal.
    const s = side * big;
    const cutter: Ring = [
      [x1, y1],
      [x2, y2],
      [x2 + nx * s, y2 + ny * s],
      [x1 + nx * s, y1 + ny * s],
    ];
    try {
      const polys = polygonClipping.intersection(shape as never, [cutter] as never) as Ring[][];
      const clean = polys.filter(poly => poly.some(r => Math.abs(signedArea(r)) > 0.5));
      return clean.length ? clean : null;
    } catch {
      // Contactos tangenciales (la línea roza el borde sin cruzar): sin corte.
      return null;
    }
  };

  const above = cut(1);
  const below = cut(-1);
  // Sin geometría en AMBOS lados no hay cruce real: la línea pasa fuera.
  if (!above || !below) return null;

  // Corte completo garantizado: las piezas deben reconstruir la figura.
  // Una línea que ENTRA pero no SALE (drag a medias) también interseca los
  // dos semiplanos, pero botaría la parte que la línea no alcanzó — eso es
  // pérdida silenciosa de geometría, no un corte.
  const polyArea = (poly: Ring[]) => Math.abs(poly.reduce((n, r) => n + signedArea(r), 0));
  const originalArea = Math.abs(signedArea(ring));
  const piecesArea = [...above, ...below].reduce((n, poly) => n + polyArea(poly), 0);
  if (Math.abs(piecesArea - originalArea) > Math.max(1, originalArea * 0.01)) return null;

  return [
    ...above.map(poly => ({ d: ringsToPathD(poly), fill })),
    ...below.map(poly => ({ d: ringsToPathD(poly), fill })),
  ];
}
