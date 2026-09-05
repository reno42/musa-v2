/**
 * Color Extract — deterministic color identification core.
 *
 * The server-side half of match_color. Philosophy mirrors the font matcher:
 * the calling AI proposes WHERE to look (normalized regions), this module
 * answers WHAT the pixels say — exactly, with no AI and no external API.
 *
 * Everything here is pure TypeScript over an RGBA buffer (decoded upstream
 * with sharp). All comparisons happen in CIELAB with CIEDE2000, never in
 * RGB distance — RGB distance lies badly for dark and saturated colors.
 *
 * Classification ladder (honesty gate): solid → gradient → texture → photo.
 * A region that fails the gradient fit is reported as texture/photo instead
 * of emitting a fake gradient. fitScore is the mean ΔE2000 between the
 * model's reconstruction and the actual pixels: ≤3 clean, 3–8 approximate,
 * >8 "not a reproducible gradient".
 */

// ── Types ──

export interface RGB { r: number; g: number; b: number }
export interface Lab { L: number; a: number; b: number }

export interface ColorRegionInput {
  role: string;
  x: number; y: number; w: number; h: number; // normalized 0..1, top-left origin
}

export interface ColorHit {
  hex: string;
  name: string;
  coverage: number; // 0..1 share of region pixels
  brandMatch: { token: string; deltaE: number } | null;
}

export interface GradientStop { hex: string; position: number } // position: 0..100

export interface GradientModel {
  kind: "linear" | "radial";
  angleDeg?: number; // CSS angle for linear (0 = to top, 90 = to right)
  center?: { x: number; y: number }; // normalized, radial only
  stops: GradientStop[];
  fitScore: number; // mean ΔE2000 between model reconstruction and pixels
}

export interface RegionResult {
  role: string;
  box: { x: number; y: number; w: number; h: number };
  type: "solid" | "gradient" | "texture" | "photo";
  colors: ColorHit[];
  gradientCss: string | null;
  gradient: GradientModel | null;
  alpha: { semiTransparent: boolean; alphaEstimate: number | null; compositeOver: string | null } | null;
  fitScore: number | null;
  confidence: "high" | "medium" | "low";
}

export interface BrandColorToken { path: string; hex: string }

export interface RejectedRegion { region: ColorRegionInput; reason: string }

export interface ColorExtraction {
  assumedSrgb: true;
  regions: RegionResult[];
  rejected: RejectedRegion[];
}

// ── sRGB / hex ──

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Accepts "#7C3AED" and legacy "rgb(124,58,237)" / "rgba(...)" forms.
export function parseColorString(s: string): RGB | null {
  const str = String(s || "").trim();
  const hex = hexToRgb(str);
  if (hex) return hex;
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(str);
  if (m) {
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    if (r <= 255 && g <= 255 && b <= 255) return { r, g, b };
  }
  return null;
}

// ── Lab conversions (D65) ──

const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const gam = (c: number) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };

const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const EPS_CIE = 216 / 24389;
const KAPPA = 24389 / 27;
const fLab = (t: number) => (t > EPS_CIE ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

export function rgbToLab({ r, g, b }: RGB): Lab {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / YN;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / ZN;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(lab: Lab): RGB {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const inv = (t: number) => { const t3 = t * t * t; return t3 > EPS_CIE ? t3 : (116 * t - 16) / KAPPA; };
  const yr = lab.L > KAPPA * EPS_CIE ? fy * fy * fy : lab.L / KAPPA;
  const X = inv(fx) * XN, Y = yr * YN, Z = inv(fz) * ZN;
  return {
    r: gam(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    g: gam(-0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z),
    b: gam(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  };
}

export const labToHex = (lab: Lab): string => rgbToHex(labToRgb(lab));

// ── CIEDE2000 (Sharma 2005 formulation) ──

const RAD = Math.PI / 180;

export function deltaE2000(l1: Lab, l2: Lab): number {
  const C1 = Math.hypot(l1.a, l1.b), C2 = Math.hypot(l2.a, l2.b);
  const Cbar = (C1 + C2) / 2;
  const c7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(c7 / (c7 + Math.pow(25, 7))));
  const a1p = (1 + G) * l1.a, a2p = (1 + G) * l2.a;
  const C1p = Math.hypot(a1p, l1.b), C2p = Math.hypot(a2p, l2.b);
  const hueOf = (ap: number, b: number) => (ap === 0 && b === 0 ? 0 : ((Math.atan2(b, ap) / RAD) + 360) % 360);
  const h1p = hueOf(a1p, l1.b), h2p = hueOf(a2p, l2.b);

  const dLp = l2.L - l1.L;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const Lbp = (l1.L + l2.L) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp: number;
  if (C1p * C2p === 0) {
    hbp = h1p + h2p;
  } else {
    const diff = Math.abs(h1p - h2p);
    const sum = h1p + h2p;
    if (diff <= 180) hbp = sum / 2;
    else if (sum < 360) hbp = (sum + 360) / 2;
    else hbp = (sum - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos((hbp - 30) * RAD)
    + 0.24 * Math.cos(2 * hbp * RAD)
    + 0.32 * Math.cos((3 * hbp + 6) * RAD)
    - 0.20 * Math.cos((4 * hbp - 63) * RAD);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const cbp7 = Math.pow(Cbp, 7);
  const RC = 2 * Math.sqrt(cbp7 / (cbp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
    Math.pow(dCp / SC, 2) +
    Math.pow(dHp / SH, 2) +
    RT * (dCp / SC) * (dHp / SH),
  );
}

// ── Deterministic k-means in Lab ──
// No RNG anywhere: seeds are evenly spaced samples, so identical input
// always produces identical clusters (the whole tool must be reproducible).

export function kMeansLab(points: Lab[], k: number, iterations = 64): { centroids: Lab[]; assign: number[] } {
  const kk = Math.max(1, Math.min(k, points.length));
  const centroids: Lab[] = [];
  for (let i = 0; i < kk; i++) {
    const idx = Math.min(Math.floor((i * points.length) / kk), points.length - 1);
    centroids.push({ ...points[idx] });
  }
  const assign = new Array<number>(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = (points[i].L - centroids[c].L) ** 2 + (points[i].a - centroids[c].a) ** 2 + (points[i].b - centroids[c].b) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s.L += points[i].L; s.a += points[i].a; s.b += points[i].b; s.n++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].n > 0) {
        centroids[c] = { L: sums[c].L / sums[c].n, a: sums[c].a / sums[c].n, b: sums[c].b / sums[c].n };
      } else {
        centroids[c] = { ...points[Math.floor((c * points.length) / centroids.length)] };
      }
    }
    if (!moved && it > 0) break;
  }
  return { centroids, assign };
}

const medianOf = (arr: number[]): number => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// ── Region sampling ──

export interface RegionPixel { x: number; y: number; rgb: RGB; lab: Lab } // x,y normalized within the eroded box

export function sampleRegionPixels(
  data: Uint8Array, width: number, height: number, channels: number,
  box: { x: number; y: number; w: number; h: number }, // in PIXELS
  maxSamples = 2500,
): RegionPixel[] {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w)), y1 = Math.min(height, Math.ceil(box.y + box.h));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 1 || bh < 1) return [];
  const step = Math.max(1, Math.ceil(Math.sqrt((bw * bh) / maxSamples)));
  const out: RegionPixel[] = [];
  for (let py = y0; py < y1; py += step) {
    for (let px = x0; px < x1; px += step) {
      const o = (py * width + px) * channels;
      const rgb: RGB = { r: data[o], g: data[o + 1], b: data[o + 2] };
      out.push({ x: (px - x0) / (bw - 1 || 1), y: (py - y0) / (bh - 1 || 1), rgb, lab: rgbToLab(rgb) });
    }
  }
  return out;
}

// ── Region sanitization (the caller's boxes are proposals, not truth) ──

export interface SanitizeContext { width: number; height: number }

export function sanitizeRegions(regions: ColorRegionInput[], ctx: SanitizeContext): { accepted: { input: ColorRegionInput; boxPx: { x: number; y: number; w: number; h: number } }[]; rejected: RejectedRegion[] } {
  const accepted: { input: ColorRegionInput; boxPx: { x: number; y: number; w: number; h: number } }[] = [];
  const rejected: RejectedRegion[] = [];
  const imgArea = ctx.width * ctx.height;
  for (const region of regions) {
    const role = String(region.role || "region").slice(0, 40);
    const nums = [region.x, region.y, region.w, region.h].map(v => Number(v));
    if (nums.some(n => !Number.isFinite(n))) {
      rejected.push({ region, reason: `x/y/w/h must be finite numbers (role "${role}")` });
      continue;
    }
    const [x, y, w, h] = nums;
    if (w <= 0.02 || h <= 0.02) {
      rejected.push({ region, reason: `degenerate box (w/h ≤ 0.02) for role "${role}" — regions need real area, e.g. {x:0.1,y:0.1,w:0.5,h:0.3}` });
      continue;
    }
    if (x < -0.05 || y < -0.05 || x + w > 1.05 || y + h > 1.05) {
      rejected.push({ region, reason: `box out of bounds for role "${role}" — x/y/w/h are normalized 0..1` });
      continue;
    }
    // Clamp to image, then erode ~5% of each dimension: kills antialiasing
    // fringes and JPEG halos at box borders, the #1 source of invented hexes.
    const cx0 = Math.max(0, x * ctx.width), cy0 = Math.max(0, y * ctx.height);
    const cw = Math.min(ctx.width, (x + w) * ctx.width) - cx0;
    const ch = Math.min(ctx.height, (y + h) * ctx.height) - cy0;
    const ex = Math.max(1, cw * 0.05), ey = Math.max(1, ch * 0.05);
    const boxPx = { x: cx0 + ex, y: cy0 + ey, w: Math.max(2, cw - 2 * ex), h: Math.max(2, ch - 2 * ey) };
    if (boxPx.w < 4 || boxPx.h < 4) {
      rejected.push({ region, reason: `box for role "${role}" is smaller than 4px after clamping — image too small or box too tiny` });
      continue;
    }
    if ((boxPx.w * boxPx.h) / imgArea < 0.004) {
      rejected.push({ region, reason: `box for role "${role}" covers under 0.4% of the image — likely a mis-pointed region` });
      continue;
    }
    // Overlap guard: a box that duplicates an earlier one adds nothing.
    const dupe = accepted.some(a => {
      const ox = Math.max(0, Math.min(a.boxPx.x + a.boxPx.w, boxPx.x + boxPx.w) - Math.max(a.boxPx.x, boxPx.x));
      const oy = Math.max(0, Math.min(a.boxPx.y + a.boxPx.h, boxPx.y + boxPx.h) - Math.max(a.boxPx.y, boxPx.y));
      return (ox * oy) / Math.min(a.boxPx.w * a.boxPx.h, boxPx.w * boxPx.h) > 0.8;
    });
    if (dupe) {
      rejected.push({ region, reason: `box for role "${role}" overlaps an earlier region by >80% — drop duplicates` });
      continue;
    }
    accepted.push({ input: { role, x, y, w, h }, boxPx });
  }
  return { accepted, rejected };
}

// ── Gradient fitting ──

interface BinPoint { t: number; lab: Lab }

function binProfile(pix: RegionPixel[], vals: number[]): BinPoint[] {
  const B = 16;
  const bins: Lab[][] = Array.from({ length: B }, () => []);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV;
  for (let i = 0; i < pix.length; i++) {
    const b = Math.min(B - 1, Math.floor(((vals[i] - minV) / (range || 1)) * B));
    bins[b].push(pix[i].lab);
  }
  const out: BinPoint[] = [];
  for (let b = 0; b < B; b++) {
    if (bins[b].length < 2) continue;
    const t = range ? (b + 0.5) / B : 0.5;
    out.push({
      t,
      lab: {
        L: medianOf(bins[b].map(l => l.L)),
        a: medianOf(bins[b].map(l => l.a)),
        b: medianOf(bins[b].map(l => l.b)),
      },
    });
  }
  return out;
}

// Ramer–Douglas–Peucker in Lab space: keeps real stops, drops noise steps.
function rdpStops(pts: BinPoint[], eps: number): BinPoint[] {
  if (pts.length < 3) return pts;
  let maxD = -1, idx = 0;
  const first = pts[0], last = pts[pts.length - 1];
  const span = Math.max(1e-6, last.t - first.t);
  for (let i = 1; i < pts.length - 1; i++) {
    const w = (pts[i].t - first.t) / span;
    const interp: Lab = {
      L: first.lab.L + w * (last.lab.L - first.lab.L),
      a: first.lab.a + w * (last.lab.a - first.lab.a),
      b: first.lab.b + w * (last.lab.b - first.lab.b),
    };
    const d = deltaE2000(pts[i].lab, interp);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdpStops(pts.slice(0, idx + 1), eps);
    const right = rdpStops(pts.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function interpLabAt(stops: BinPoint[], v: number): Lab {
  if (v <= stops[0].t) return stops[0].lab;
  if (v >= stops[stops.length - 1].t) return stops[stops.length - 1].lab;
  for (let i = 0; i < stops.length - 1; i++) {
    const A = stops[i], Bp = stops[i + 1];
    if (v >= A.t && v <= Bp.t) {
      const w = (v - A.t) / Math.max(1e-6, Bp.t - A.t);
      return {
        L: A.lab.L + w * (Bp.lab.L - A.lab.L),
        a: A.lab.a + w * (Bp.lab.a - A.lab.a),
        b: A.lab.b + w * (Bp.lab.b - A.lab.b),
      };
    }
  }
  return stops[stops.length - 1].lab;
}

function meanResidual(pix: RegionPixel[], vals: number[], stops: BinPoint[]): number {
  let sum = 0;
  for (let i = 0; i < pix.length; i++) sum += deltaE2000(pix[i].lab, interpLabAt(stops, vals[i]));
  return sum / Math.max(1, pix.length);
}

function buildModel(pix: RegionPixel[], vals: number[], range: number): { stops: BinPoint[]; fit: number } | null {
  if (range < 0.15) return null; // axis too short → direction ill-defined
  const profile = binProfile(pix, vals);
  if (profile.length < 3) return null;
  let stops: BinPoint[] = [];
  for (const eps of [1.5, 2.5, 4]) {
    stops = rdpStops(profile, eps);
    if (stops.length <= 5) break;
  }
  if (stops.length > 5) stops = [stops[0], stops[Math.floor(stops.length / 2)], stops[stops.length - 1]];
  return { stops, fit: meanResidual(pix, vals, stops) };
}

interface LinearFit { ux: number; uy: number; stops: BinPoint[]; fit: number }

// The gradient axis is the direction along which COLOR changes, which is NOT
// derivable from spatial PCA (a filled square has identical spread on both
// axes). So we search: project on candidate directions, bin → simplify →
// score, keep the best; then refine around the winner.
function fitLinear(pix: RegionPixel[], mx: number, my: number): LinearFit | null {
  const tryAxis = (ux: number, uy: number): LinearFit | null => {
    const raw = pix.map(p => (p.x - mx) * ux + (p.y - my) * uy);
    const min = Math.min(...raw), max = Math.max(...raw);
    const range = max - min;
    if (range < 0.15) return null;
    const norm = raw.map(v => (v - min) / range);
    const model = buildModel(pix, norm, range);
    return model ? { ux, uy, stops: model.stops, fit: model.fit } : null;
  };
  let best: LinearFit | null = null;
  for (let a = 0; a < 180; a += 22.5) {
    const r = a * RAD;
    const candidate = tryAxis(Math.cos(r), Math.sin(r));
    if (candidate && (!best || candidate.fit < best.fit)) best = candidate;
  }
  if (!best) return null;
  // Refine ±11.25° in 3.75° steps around the coarse winner.
  const baseDeg = Math.atan2(best.uy, best.ux) / RAD;
  for (let d = -11.25; d <= 11.25; d += 3.75) {
    if (d === 0) continue;
    const r = (baseDeg + d) * RAD;
    const candidate = tryAxis(Math.cos(r), Math.sin(r));
    if (candidate && candidate.fit < best.fit) best = candidate;
  }
  return best;
}

function fitGradient(pix: RegionPixel[]): GradientModel | null {
  if (pix.length < 24) return null;
  let mx = 0, my = 0;
  for (const p of pix) { mx += p.x; my += p.y; }
  mx /= pix.length; my /= pix.length;

  const linear = fitLinear(pix, mx, my);

  // RADIAL: grid-searched center around the centroid.
  let bestRadial: { stops: BinPoint[]; fit: number } | null = null;
  let bestCenter = { x: mx, y: my };
  for (const dx of [-0.25, 0, 0.25]) {
    for (const dy of [-0.25, 0, 0.25]) {
      const cxr = mx + dx, cyr = my + dy;
      const raw = pix.map(p => Math.hypot(p.x - cxr, p.y - cyr));
      const rMax = Math.max(...raw);
      if (rMax < 0.1) continue;
      const vals = raw.map(r => r / rMax);
      const model = buildModel(pix, vals, 1); // spread already guarded by rMax >= 0.1
      if (model && (!bestRadial || model.fit < bestRadial.fit)) { bestRadial = model; bestCenter = { x: cxr, y: cyr }; }
    }
  }

  if (!linear && !bestRadial) return null;
  if (linear && (!bestRadial || linear.fit <= bestRadial.fit)) {
    // CSS angle: our axis (ux,uy) with y down → 0deg points up, 90 to right.
    let angle = (Math.atan2(linear.ux, -linear.uy) / RAD + 360) % 360;
    const snapped = Math.round(angle / 45) * 45;
    if (Math.abs(angle - snapped) <= 7 || Math.abs(angle - snapped) >= 353) angle = (snapped + 360) % 360;
    else angle = Math.round(angle);
    const stops: GradientStop[] = pinEndStops(linear.stops.map(s => ({ hex: labToHex(s.lab), position: Math.round(s.t * 100) })));
    return { kind: "linear", angleDeg: angle, stops: dedupeStops(stops), fitScore: round2(linear.fit) };
  }
  const stops: GradientStop[] = pinEndStops(bestRadial!.stops.map(s => ({ hex: labToHex(s.lab), position: Math.round(s.t * 100) })));
  return { kind: "radial", center: { x: Math.round(bestCenter.x * 100) / 100, y: Math.round(bestCenter.y * 100) / 100 }, stops: dedupeStops(stops), fitScore: round2(bestRadial!.fit) };
}

// CSS renders a gradient's first/last stop colors all the way to 0%/100%, so
// pinning endpoints there is rendering-identical and reads like a designer
// wrote it. Endpoint COLORS stay the robust bin medians — extrapolating hexes
// beyond the sampled pixels would be inventing color.
function pinEndStops(stops: GradientStop[]): GradientStop[] {
  if (!stops.length) return stops;
  return stops.map((s, i) => ({
    ...s,
    position: i === 0 ? 0 : i === stops.length - 1 ? 100 : Math.max(0, Math.min(100, s.position)),
  }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function dedupeStops(stops: GradientStop[]): GradientStop[] {
  const out: GradientStop[] = [];
  for (const s of stops) {
    const prev = out[out.length - 1];
    if (prev && prev.hex === s.hex && Math.abs(prev.position - s.position) <= 4) continue;
    out.push(s);
  }
  return out.length ? out : stops;
}

export function gradientToCss(g: GradientModel): string {
  const stopStr = g.stops.map(s => `${s.hex} ${Math.round(s.position)}%`).join(", ");
  if (g.kind === "linear") return `linear-gradient(${g.angleDeg ?? 90}deg, ${stopStr})`;
  const c = g.center || { x: 50, y: 50 };
  return `radial-gradient(circle at ${Math.round(c.x * 100)}% ${Math.round(c.y * 100)}%, ${stopStr})`;
}

// ── Cluster hits (median RGB per cluster — never the mean; means invent colors) ──

function clusterHits(pix: RegionPixel[], rgb: RGB[], k: number, minCoverage: number, brandTokens: BrandColorToken[] | undefined, maxColors: number): ColorHit[] {
  const labs = pix.map(p => p.lab);
  const { centroids, assign } = kMeansLab(labs, k);
  const groups: number[][] = centroids.map(() => []);
  for (let i = 0; i < pix.length; i++) groups[assign[i]].push(i);
  const hits: ColorHit[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    const coverage = g.length / pix.length;
    if (coverage < minCoverage) continue;
    const hex = rgbToHex({ r: medianOf(g.map(i => rgb[i].r)), g: medianOf(g.map(i => rgb[i].g)), b: medianOf(g.map(i => rgb[i].b)) });
    hits.push({ hex, name: nameColor(hex), coverage: round2(coverage), brandMatch: brandMatchFor(hex, brandTokens) });
  }
  hits.sort((a, b) => b.coverage - a.coverage);
  return hits.slice(0, maxColors);
}

function brandMatchFor(hex: string, brandTokens: BrandColorToken[] | undefined): { token: string; deltaE: number } | null {
  if (!brandTokens || !brandTokens.length) return null;
  const lab = rgbToLab(hexToRgb(hex)!);
  let best: { token: string; deltaE: number } | null = null;
  for (const t of brandTokens) {
    const rgb = hexToRgb(t.hex);
    if (!rgb) continue;
    const d = deltaE2000(lab, rgbToLab(rgb));
    if (!best || d < best.deltaE) best = { token: t.path, deltaE: round2(d) };
  }
  return best;
}

// ── Color naming (in-house: CSS names + hue-based fallback) ──

const NAMED: [string, string][] = [
  ["black", "#000000"], ["white", "#ffffff"], ["gray", "#808080"], ["silver", "#c0c0c0"],
  ["red", "#ff0000"], ["crimson", "#dc143c"], ["maroon", "#800000"], ["brown", "#a52a2a"],
  ["chocolate", "#d2691e"], ["tan", "#d2b48c"], ["coral", "#ff7f50"], ["salmon", "#fa8072"],
  ["tomato", "#ff6347"], ["orange", "#ffa500"], ["gold", "#ffd700"], ["khaki", "#f0e68c"],
  ["yellow", "#ffff00"], ["olive", "#808000"], ["lime", "#00ff00"], ["green", "#008000"],
  ["emerald", "#50c878"], ["teal", "#008080"], ["turquoise", "#40e0d0"], ["cyan", "#00ffff"],
  ["sky blue", "#87ceeb"], ["azure", "#007fff"], ["blue", "#0000ff"], ["navy", "#000080"],
  ["indigo", "#4b0082"], ["violet", "#ee82ee"], ["purple", "#800080"], ["magenta", "#ff00ff"],
  ["pink", "#ffc0cb"], ["rose", "#ff007f"], ["beige", "#f5f5dc"], ["ivory", "#fffff0"],
  ["lavender", "#e6e6fa"], ["plum", "#dda0dd"], ["orchid", "#da70d6"], ["charcoal", "#36454f"],
];
let namedLabs: { name: string; lab: Lab }[] | null = null;
const getNamedLabs = (): { name: string; lab: Lab }[] => {
  if (!namedLabs) {
    namedLabs = NAMED.map(([name, hex]) => ({ name, lab: rgbToLab(hexToRgb(hex)!) }));
  }
  return namedLabs;
};

export function nameColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "unknown";
  const lab = rgbToLab(rgb);
  let best: { name: string; d: number } | null = null;
  for (const n of getNamedLabs()) {
    const d = deltaE2000(lab, n.lab);
    if (!best || d < best.d) best = { name: n.name, d };
  }
  if (best && best.d <= 4) return best.name;
  const C = Math.hypot(lab.a, lab.b);
  if (C < 6) {
    if (lab.L < 25) return "near-black";
    if (lab.L > 90) return "off-white";
    return lab.L < 55 ? "charcoal gray" : "light gray";
  }
  let hue = (Math.atan2(lab.b, lab.a) / RAD + 360) % 360;
  const hueNames: [number, string][] = [
    [15, "red"], [40, "orange"], [65, "amber"], [90, "lime"], [140, "green"], [175, "teal"],
    [205, "cyan"], [250, "azure"], [285, "blue"], [310, "indigo"], [335, "violet"], [355, "magenta"], [360, "rose"],
  ];
  const base = hueNames.find(([max]) => hue <= max)?.[1] || "red";
  let prefix = "";
  if (lab.L < 30) prefix = "deep ";
  else if (lab.L < 45) prefix = "dark ";
  else if (lab.L > 82) prefix = C > 30 ? "bright " : "pale ";
  else if (C > 45) prefix = "vivid ";
  else if (C < 18) prefix = "muted ";
  return prefix + base;
}

// ── Brand tokens (DTCG-tolerant) ──

export function brandColorTokens(tokensJson: string | null | undefined): BrandColorToken[] {
  let root: unknown = null;
  try { root = JSON.parse(String(tokensJson || "")); } catch { return []; }
  if (!root || typeof root !== "object") return [];
  const out: BrandColorToken[] = [];
  const visit = (node: unknown, path: string, depth: number) => {
    if (depth > 6 || out.length >= 200) return;
    // Flat token maps hold bare strings ("color": { accent: "#ff0000" }).
    if (typeof node === "string") {
      if (!path) return;
      const rgb = parseColorString(node);
      if (rgb) out.push({ path, hex: rgbToHex(rgb) });
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const typed = typeof obj.$type === "string" || typeof obj.type === "string";
    const isColorType = obj.$type === "color" || obj.type === "color";
    const val = obj.$value ?? obj.value;
    if (typeof val === "string" && (!typed || isColorType)) {
      const rgb = parseColorString(val);
      if (rgb) { out.push({ path: path || "color", hex: rgbToHex(rgb) }); return; }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$type" || k === "type" || k === "$description" || k === "$extensions") continue;
      visit(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  const r = root as Record<string, unknown>;
  if (r.color && typeof r.color === "object") visit(r.color, "color", 0);
  if (!out.length) visit(root, "", 0); // lenient: flat token maps without a color group
  return out;
}

// ── Main entry ──

export function extractColors(opts: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  regions: ColorRegionInput[];
  brandTokens?: BrandColorToken[];
  maxColors?: number;
}): ColorExtraction {
  const { data, width, height, channels } = opts;
  const maxColors = Math.max(1, Math.min(6, opts.maxColors || 3));
  const { accepted, rejected } = sanitizeRegions(opts.regions, { width, height });
  const results: RegionResult[] = [];

  for (const { input, boxPx } of accepted) {
    const pix = sampleRegionPixels(data, width, height, channels, boxPx);
    const rgb = pix.map(p => p.rgb);
    const role = input.role;

    if (pix.length < 24) {
      const hex = rgb.length ? rgbToHex(rgb[Math.floor(rgb.length / 2)]) : "#000000";
      results.push({
        role, box: input, type: "solid",
        colors: [{ hex, name: nameColor(hex), coverage: 1, brandMatch: brandMatchFor(hex, opts.brandTokens) }],
        gradientCss: null, gradient: null, alpha: null, fitScore: null, confidence: "low",
      });
      continue;
    }

    // Alpha casuistic: partial coverage means an overlay, not a color.
    let alpha: RegionResult["alpha"] = null;
    if (channels === 4) {
      let partial = 0;
      const partialAlphas: number[] = [];
      const x0 = Math.floor(boxPx.x), y0 = Math.floor(boxPx.y);
      const x1 = Math.min(width, Math.ceil(boxPx.x + boxPx.w)), y1 = Math.min(height, Math.ceil(boxPx.y + boxPx.h));
      for (let py = y0; py < y1; py += 2) {
        for (let px = x0; px < x1; px += 2) {
          const a = data[(py * width + px) * channels + 3];
          if (a >= 40 && a < 220) { partial++; partialAlphas.push(a); }
        }
      }
      const total = Math.max(1, ((x1 - x0) / 2 | 0) * ((y1 - y0) / 2 | 0));
      if (partial / total >= 0.15) {
        // Composite hypothesis: what the color becomes over the surroundings.
        let ring: RGB[] = [];
        const ringX0 = Math.max(0, x0 - 6), ringY0 = Math.max(0, y0 - 6);
        const ringX1 = Math.min(width, x1 + 6), ringY1 = Math.min(height, y1 + 6);
        for (let py = ringY0; py < ringY1; py += 2) {
          for (let px = ringX0; px < ringX1; px += 2) {
            const inside = px >= x0 && px < x1 && py >= y0 && py < y1;
            if (!inside) {
              const o = (py * width + px) * channels;
              ring.push({ r: data[o], g: data[o + 1], b: data[o + 2] });
            }
          }
        }
        const alphaEstimate = round2(medianOf(partialAlphas) / 255);
        let compositeOver: string | null = null;
        if (ring.length >= 10) {
          const bg = { r: medianOf(ring.map(c => c.r)), g: medianOf(ring.map(c => c.g)), b: medianOf(ring.map(c => c.b)) };
          compositeOver = rgbToHex(bg);
        }
        alpha = { semiTransparent: true, alphaEstimate, compositeOver };
      }
    }

    // Ladder: solid → gradient → texture → photo.
    const subset = pix.length > 1600 ? pix.filter((_, i) => i % Math.ceil(pix.length / 1600) === 0) : pix;
    const centroid = kMeansLab(subset.map(p => p.lab), 1).centroids[0];
    const residual1 = subset.reduce((s, p) => s + deltaE2000(p.lab, centroid), 0) / subset.length;

    if (residual1 <= 3) {
      const colors = clusterHits(pix, rgb, 3, 0.1, opts.brandTokens, maxColors);
      const fallback = colors.length ? colors : (() => {
        const hex = labToHex(centroid);
        return [{ hex, name: nameColor(hex), coverage: 1, brandMatch: brandMatchFor(hex, opts.brandTokens) }];
      })();
      results.push({ role, box: input, type: "solid", colors: fallback, gradientCss: null, gradient: null, alpha, fitScore: round2(residual1), confidence: residual1 <= 1.5 ? "high" : "medium" });
      continue;
    }

    const gradient = fitGradient(subset);
    if (gradient && gradient.fitScore! <= 8) {
      const conf = gradient.fitScore! <= 3 ? "high" : gradient.fitScore! <= 5 ? "medium" : "low";
      const colors: ColorHit[] = gradient.stops.map(s => ({
        hex: s.hex, name: nameColor(s.hex), coverage: round2(1 / gradient.stops.length),
        brandMatch: brandMatchFor(s.hex, opts.brandTokens),
      }));
      results.push({ role, box: input, type: "gradient", colors, gradientCss: gradientToCss(gradient), gradient, alpha, fitScore: gradient.fitScore!, confidence: conf });
      continue;
    }

    if (residual1 <= 12) {
      const colors = clusterHits(pix, rgb, 4, 0.06, opts.brandTokens, maxColors);
      results.push({ role, box: input, type: "texture", colors, gradientCss: null, gradient: null, alpha, fitScore: round2(residual1), confidence: "medium" });
      continue;
    }

    const colors = clusterHits(pix, rgb, 4, 0.05, opts.brandTokens, maxColors);
    results.push({ role, box: input, type: "photo", colors, gradientCss: null, gradient: null, alpha, fitScore: round2(residual1), confidence: "medium" });
  }

  return { assumedSrgb: true, regions: results, rejected };
}
