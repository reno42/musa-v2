/**
 * Buscatrazos local — the 13 built-in presets, in panel order.
 *
 * Presets are named parameter sets over `TraceParams`; only the fields that
 * differ from the default are spelled out per preset. Every Black-and-White
 * preset keeps `ignoreWhite` on (they trace logos/sketches, not white cards);
 * the plain Default preset does not.
 */
import { defaultTraceParams, type TraceMethod, type TraceParams } from "./params.ts";

export interface TracePreset {
  name: string;
  params: TraceParams;
}

function preset(
  name: string,
  overrides: Partial<TraceParams>,
): TracePreset {
  return { name, params: { ...defaultTraceParams(), ...overrides } };
}

/** Color-mode helper: palette size, fidelity, corners, noise, layer method. */
function color(
  name: string,
  colors: number,
  paths: number,
  corners: number,
  noise: number,
  method: TraceMethod,
): TracePreset {
  return preset(name, { mode: "color", colors, paths, corners, noise, method });
}

/** Black-and-white helper: always ignores white; optionally snaps curves to lines. */
function bw(
  name: string,
  threshold: number,
  paths: number,
  corners: number,
  noise: number,
  snapCurvesToLines: boolean,
): TracePreset {
  return preset(name, { mode: "blackAndWhite", threshold, paths, corners, noise, ignoreWhite: true, snapCurvesToLines });
}

export const TRACE_PRESETS: TracePreset[] = [
  preset("Default", {}),
  color("High Fidelity Photo", 64, 90, 25, 4, "overlapping"),
  color("Low Fidelity Photo", 20, 60, 50, 12, "overlapping"),
  color("3 Colors", 3, 60, 60, 20, "abutting"),
  color("6 Colors", 6, 65, 60, 16, "abutting"),
  color("16 Colors", 16, 70, 55, 10, "abutting"),
  preset("Shades of Gray", { mode: "grayscale", colors: 8, paths: 60, corners: 50, noise: 10, method: "overlapping" }),
  bw("Black and White Logo", 128, 95, 80, 8, true),
  bw("Sketched Art", 150, 50, 50, 100, false),
  bw("Silhouettes", 200, 40, 60, 30, false),
  bw("Line Art", 128, 80, 70, 10, false),
  bw("Technical Drawing", 128, 95, 90, 4, true),
  preset("Flat Logo", { mode: "logo", colors: 8, paths: 60, corners: 50, noise: 6, snapCurvesToLines: true }),
];

/** Preset by name (case-insensitive). "default" is the plain default params. */
export function tracePresetByName(name: string): TraceParams | null {
  const key = name.trim().toLowerCase();
  const hit = TRACE_PRESETS.find(p => p.name.toLowerCase() === key);
  return hit ? hit.params : null;
}
