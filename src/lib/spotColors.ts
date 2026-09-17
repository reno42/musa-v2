/**
 * spotColors — tintas planas (spot) estilo Illustrator, versión honesta para
 * un pipeline raster RGB→CMYK: la tinta se guarda como NOMBRE en una
 * propiedad CSS del frame (`--spot-ink: PANTONE 185 C`) y el elemento se
 * pinta con la aproximación RGB publicada. El PDF de imprenta lleva la
 * aproximación convertida por ICC; el nombre viaja en el diseño y en el
 * dialog de export (paridad parcial con Spot Colors: identificación y
 * listado, no placa separada — una placa real exige separación con
 * colorantes nombrados, imposible desde un raster RGB).
 *
 * Valores: aproximaciones RGB publicadas de la biblioteca Pantone (los
 * valores exactos son propiedad de Pantone LLC; los nombres se usan solo
 * para identificación). El build CMYK es el de imprenta usual de cada
 * tinta, informativo para el dialog.
 */
export interface SpotInk {
  /** Identificador estable (sin espacios). */
  id: string;
  /** Nombre de tinta tal como viaja en el diseño y al dialog. */
  name: string;
  /** Aproximación RGB que pinta el lienzo y el export. */
  hex: string;
  /** Build CMYK de imprenta usual (0–100 por tinta), informativo. */
  cmyk: [number, number, number, number];
}

export const SPOT_INKS: SpotInk[] = [
  { id: "pantone-black-c", name: "PANTONE Black C", hex: "#2D2926", cmyk: [0, 0, 0, 100] },
  { id: "pantone-reflex-blue-c", name: "PANTONE Reflex Blue C", hex: "#001489", cmyk: [100, 80, 0, 20] },
  { id: "pantone-185-c", name: "PANTONE 185 C", hex: "#E10600", cmyk: [0, 100, 85, 0] },
  { id: "pantone-186-c", name: "PANTONE 186 C", hex: "#C8102E", cmyk: [0, 100, 80, 5] },
  { id: "pantone-warm-red-c", name: "PANTONE Warm Red C", hex: "#F9423A", cmyk: [0, 85, 80, 0] },
  { id: "pantone-rubine-red-c", name: "PANTONE Rubine Red C", hex: "#CE0058", cmyk: [0, 100, 10, 5] },
  { id: "pantone-orange-021-c", name: "PANTONE Orange 021 C", hex: "#FE5000", cmyk: [0, 80, 100, 0] },
  { id: "pantone-process-yellow-c", name: "PANTONE Process Yellow C", hex: "#FEDD00", cmyk: [0, 0, 100, 0] },
  { id: "pantone-348-c", name: "PANTONE 348 C", hex: "#00843D", cmyk: [95, 0, 90, 5] },
  { id: "pantone-355-c", name: "PANTONE 355 C", hex: "#009639", cmyk: [90, 0, 100, 5] },
  { id: "pantone-356-c", name: "PANTONE 356 C", hex: "#00693C", cmyk: [100, 0, 85, 40] },
  { id: "pantone-286-c", name: "PANTONE 286 C", hex: "#0032A0", cmyk: [100, 70, 0, 10] },
  { id: "pantone-288-c", name: "PANTONE 288 C", hex: "#002D72", cmyk: [100, 68, 0, 30] },
  { id: "pantone-293-c", name: "PANTONE 293 C", hex: "#003DA5", cmyk: [100, 68, 0, 5] },
  { id: "pantone-purple-c", name: "PANTONE Purple C", hex: "#593380", cmyk: [65, 90, 0, 0] },
  { id: "pantone-violet-c", name: "PANTONE Violet C", hex: "#440099", cmyk: [85, 100, 0, 0] },
  { id: "pantone-cool-gray-10-c", name: "PANTONE Cool Gray 10 C", hex: "#63666A", cmyk: [40, 26, 22, 60] },
  { id: "pantone-871-c", name: "PANTONE 871 C (oro)", hex: "#8C7354", cmyk: [40, 45, 65, 50] },
  { id: "pantone-877-c", name: "PANTONE 877 C (plata)", hex: "#8A8D8F", cmyk: [35, 22, 25, 55] },
];

/** Valor centinela de `--spot-ink` cuando no hay tinta (convención del
 *  panel: las props de memoria se limpian con "0"). */
export const SPOT_NONE = "0";

/** Busca una tinta por id o por nombre exacto. */
export function findSpotInk(idOrName: string): SpotInk | null {
  const key = String(idOrName || "").trim();
  if (!key || key === SPOT_NONE) return null;
  return SPOT_INKS.find(ink => ink.id === key || ink.name === key) || null;
}

export interface ScannedSpotInk {
  name: string;
  hex: string;
  cmyk: [number, number, number, number];
}

/**
 * Escanea un frame (css + html inline styles) en busca de `--spot-ink:`
 * y devuelve las tintas usadas, sin duplicados, en orden de aparición.
 * Ignora el centinela "0" y valores desconocidos quedan con build CMYK
 * nulo (la imprenta los resuelve como tintas custom).
 */
export function scanSpotInks(css: string, html: string): ScannedSpotInk[] {
  const RE = /--spot-ink:\s*(?:"([^"]{1,60})"|'([^']{1,60})'|([^;"'}]{1,60}?))\s*[;"'}]/g;
  const out: ScannedSpotInk[] = [];
  const seen = new Set<string>();
  const sources = [css, html];
  for (const source of sources) {
    if (!source) continue;
    for (const m of source.matchAll(RE)) {
      const raw = (m[1] || m[2] || m[3] || "").trim();
      if (!raw || raw === SPOT_NONE || seen.has(raw)) continue;
      seen.add(raw);
      const ink = findSpotInk(raw);
      out.push(ink
        ? { name: ink.name, hex: ink.hex, cmyk: ink.cmyk }
        : { name: raw, hex: "", cmyk: [0, 0, 0, 0] });
    }
  }
  return out;
}
