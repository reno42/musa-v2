/**
 * Trazados compuestos (compound paths) — REQ-045.
 *
 * Un compound path de Illustrator es UNA capa cuyo `d` contiene varios
 * subtrazados (varios M...Z). Musa trata el compound a nivel de string `d`:
 * parsePathData modela UN subtrazado por path (los handles son del segmento),
 * así que partir/juntar por límites de M es la operación exacta y sin
 * pérdida — el navegador rellena los anillos con fill-rule evenodd.
 *
 * Sin DOM/Node: compatible con el bundle del worker (mismo motor en UI y MCP).
 */

/** Divide un `d` en sus subtrazados (uno por M/m). El Z de cierre viaja con
 * su subtrazado; un `m` relativo a inicio de subtrazado es absoluto por spec
 * SVG, así que cada trozo ya es un `d` válido por sí solo. */
export function splitSubpaths(d: string): string[] {
  const trimmed = d.trim();
  if (!trimmed) return [];
  // 'M'/'m' solo aparecen como comando (arcos usan flags numéricas, y la
  // notación exponencial no lleva letras), así que el lookahead es exacto.
  return trimmed
    .split(/(?=[Mm])/)
    .map(part => part.trim())
    .filter(Boolean);
}

/** Número de subtrazados de un `d`. */
export function countSubpaths(d: string): number {
  return splitSubpaths(d).length;
}

/** Concatena los subtrazados de varios `d` en un solo compound.
 * Devuelve null si el resultado tendría menos de 2 subtrazados
 * (no sería un compound) o si no llega ninguno. */
export function makeCompoundD(ds: string[]): string | null {
  const parts: string[] = [];
  for (const d of ds) parts.push(...splitSubpaths(d));
  if (parts.length < 2) return null;
  return parts.join(" ");
}

/** Parte un compound en sus subtrazados individuales.
 * Devuelve null con menos de 2 (no hay nada que liberar). */
export function releaseCompoundD(d: string): string[] | null {
  const parts = splitSubpaths(d);
  if (parts.length < 2) return null;
  return parts;
}
