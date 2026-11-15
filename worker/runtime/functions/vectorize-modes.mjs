// «Vectorizar» unificado (anexo del spec de réplicas, QA Instinct 2026-11-11): una herramienta, tres modos.
//   trace         motor de trazado propio de Musa (gratis, a color, curvas): parámetros al estilo VTracer.
//   color_layers  una capa con nombre por región de color, y las letras como huecos del manchón (una capa por letra).
//   ai            Quiver (llave del usuario), con costo estimado y confirmación explícita.
// Todos devuelven capas SVG nativas agrupadas bajo «Vector · <capa origen>», recoloreables por separado.

const HUES = [[0, "rojo"], [15, "naranja"], [45, "amarillo"], [70, "lima"], [150, "verde"], [190, "celeste"], [240, "azul"], [280, "morado"], [320, "rosa"], [345, "rojo"]];
export function colorName(hex) {
  const n = parseInt(String(hex).slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
  if (l < 0.16) return "negro"; if (l > 0.9 && s < 0.25) return "blanco"; if (s < 0.15) return l < 0.5 ? "gris oscuro" : "gris";
  let hdeg = 0; const d = mx - mn;
  if (mx === r) hdeg = ((g - b) / d) % 6; else if (mx === g) hdeg = (b - r) / d + 2; else hdeg = (r - g) / d + 4;
  hdeg = (hdeg * 60 + 360) % 360;
  if (hdeg >= 300 && l > 0.6) return "rosa";
  let name = "rojo"; for (const [deg, nm] of HUES) if (hdeg >= deg) name = nm;
  if (name === "rojo" && l > 0.65) name = "rosa";
  if (name === "naranja" && l < 0.35) name = "marrón";
  return name;
}
const hex2 = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const parseHex = (h) => { const n = parseInt(String(h).replace("#", "").padEnd(6, "0").slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/* paleta automática: k-means sobre una muestra */
export function kmeans(r, k) {
  const px = r.rgba, n = r.width * r.height, step = Math.max(1, Math.floor(n / 6000)), pts = [];
  for (let i = 0; i < n; i += step) if (px[i * 4 + 3] > 128) pts.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  if (!pts.length) return [];
  let c = []; for (let i = 0; i < k; i++) c.push(pts[Math.floor((i + 0.5) * pts.length / k)].slice());
  for (let it = 0; it < 12; it++) {
    const sum = c.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let bi = 0, bd = 1e9; c.forEach((q, i) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    c = c.map((q, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : q);
  }
  const uniq = []; c.forEach((q) => { if (!uniq.some((u) => (u[0] - q[0]) ** 2 + (u[1] - q[1]) ** 2 + (u[2] - q[2]) ** 2 < 300)) uniq.push(q); });
  return uniq.map((q) => hex2(q[0], q[1], q[2]));
}

/* contornos de una máscara binaria: aristas de píxel enlazadas en lazos, suavizado de Chaikin y RDP */
function loopsOf(mask, w, h) {
  const key = (x, y) => y * (w + 1) + x, out = new Map(), set = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  const add = (a, b) => { const k = key(a[0], a[1]); (out.get(k) || out.set(k, []).get(k)).push(b); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!set(x, y - 1)) add([x, y], [x + 1, y]);
    if (!set(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!set(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!set(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const loops = [];
  for (const [k0, list] of out) {
    while (list.length) {
      const start = [k0 % (w + 1), Math.floor(k0 / (w + 1))], loop = [start];
      let cur = list.pop(), guard = 0;
      while (guard++ < 400000) {
        if (cur[0] === start[0] && cur[1] === start[1]) break;
        loop.push(cur);
        const nx = out.get(key(cur[0], cur[1])); if (!nx || !nx.length) break;
        cur = nx.pop();
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}
function chaikin(p, it) { for (let k = 0; k < it; k++) { const q = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } p = q; } return p; }
function rdp(p, eps) {
  if (p.length < 4) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1; const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = p[a], [bx, by] = p[b], L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((by - ay) * p[i][0] - (bx - ax) * p[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
const pathD = (loops, sx, sy) => loops.map((l) => "M" + l.map((q) => (Math.round(q[0] * sx * 10) / 10) + " " + (Math.round(q[1] * sy * 10) / 10)).join("L") + "Z").join("");

/* componentes conexos (4-vecinos) de una máscara */
function components(mask, w, h, minArea) {
  const lab = new Int32Array(w * h).fill(-1), comps = []; const q = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    let qh = 0, qt = 0; q[qt++] = i; lab[i] = comps.length; const pix = [];
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (qh < qt) {
      const j = q[qh++], x = j % w, y = (j / w) | 0; pix.push(j);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (n >= 0 && mask[n] && lab[n] < 0) { lab[n] = comps.length; q[qt++] = n; }
    }
    if (pix.length >= minArea) comps.push({ pix, box: [x0, y0, x1, y1] }); else for (const j of pix) lab[j] = -2;
  }
  return comps;
}
function morph(mask, w, h, grow) { const out = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = grow ? 0 : 1; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; const m = X >= 0 && Y >= 0 && X < w && Y < h ? mask[Y * w + X] : 0; if (grow ? m : !m) { v = grow ? 1 : 0; break; } } out[y * w + x] = v; } return out; }

/* modo B: una capa por región de color; las letras = huecos claros dentro de un manchón */
export function colorLayers(r, o) {
  const w = r.width, h = r.height, px = r.rgba, n = w * h;
  let pal = (o.colors && o.colors.length ? o.colors : kmeans(r, Math.max(2, Math.min(12, Math.round(o.maxColors || 6))))).map(parseHex);
  const tol = (o.tolerance != null ? +o.tolerance : 60) ** 2;
  /* el fondo (el color que más toca el borde) no se dibuja, salvo que lo pidas */
  const assign = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (px[i * 4 + 3] < 100) continue;
    let bi = -1, bd = 1e12; for (let c = 0; c < pal.length; c++) { const p = pal[c], d = (px[i * 4] - p[0]) ** 2 + (px[i * 4 + 1] - p[1]) ** 2 + (px[i * 4 + 2] - p[2]) ** 2; if (d < bd) { bd = d; bi = c; } }
    if (bd <= tol || !o.colors) assign[i] = bi;
  }
  const border = new Array(pal.length).fill(0); for (let x = 0; x < w; x++) { if (assign[x] >= 0) border[assign[x]]++; if (assign[(h - 1) * w + x] >= 0) border[assign[(h - 1) * w + x]]++; } for (let y = 0; y < h; y++) { if (assign[y * w] >= 0) border[assign[y * w]]++; if (assign[y * w + w - 1] >= 0) border[assign[y * w + w - 1]]++; }
  /* fondo: solo si un color ocupa al menos un 30 % del borde (con colores picados que no tocan el borde, ninguno lo es) */
  const perim = 2 * (w + h), bmax = Math.max(...border), bg = o.keepBackground || bmax < perim * 0.3 ? -1 : border.indexOf(bmax);
  const minArea = Math.max(4, Math.round((o.minArea != null ? +o.minArea : 0.0004) * n)), eps = o.simplify != null ? +o.simplify : 0.8, smooth = o.smooth === false ? 0 : 2;
  const sx = (o.outW || w) / w, sy = (o.outH || h) / h, layers = [];
  const counter = {};
  for (let c = 0; c < pal.length; c++) {
    if (c === bg) continue;
    let mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = assign[i] === c ? 1 : 0;
    mask = morph(morph(mask, w, h, true), w, h, false); /* cerrar huecos de 1 px */
    for (const comp of components(mask, w, h, minArea)) {
      const m = new Uint8Array(n); for (const j of comp.pix) m[j] = 1;
      /* huecos: lo que no es la forma dentro de su caja y no toca el exterior */
      const [x0, y0, x1, y1] = comp.box, bw = x1 - x0 + 3, bh = y1 - y0 + 3, out = new Uint8Array(bw * bh), st = [0];
      out[0] = 1; while (st.length) { const j = st.pop(), x = j % bw, y = (j / bw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= bw || Y >= bh) continue; const k = Y * bw + X, gx = X + x0 - 1, gy = Y + y0 - 1; const inside = gx >= 0 && gy >= 0 && gx < w && gy < h && m[gy * w + gx]; if (!out[k] && !inside) { out[k] = 1; st.push(k); } } }
      const holeMask = new Uint8Array(n); let holePx = 0;
      for (let Y = 1; Y < bh - 1; Y++) for (let X = 1; X < bw - 1; X++) { const gx = X + x0 - 1, gy = Y + y0 - 1; if (!m[gy * w + gx] && !out[Y * bw + X] && assign[gy * w + gx] !== c) { holeMask[gy * w + gx] = 1; holePx++; } }
      const loopsOuter = loopsOf(m, w, h).map((l) => rdp(chaikin(l, smooth), eps));
      let sr = 0, sg = 0, sb = 0; for (const j of comp.pix) { sr += px[j * 4]; sg += px[j * 4 + 1]; sb += px[j * 4 + 2]; }
      const fill = hex2(sr / comp.pix.length, sg / comp.pix.length, sb / comp.pix.length), cname = colorName(fill);
      counter[cname] = (counter[cname] || 0) + 1;
      layers.push({ name: `forma ${cname} ${counter[cname]}`, fill, d: pathD(loopsOuter, sx, sy), area: comp.pix.length, box: comp.box, kind: "forma" });
      if (o.lettersAsLayers !== false && holePx >= minArea) {
        for (const hc of components(holeMask, w, h, Math.max(4, Math.round(minArea / 3)))) {
          const hm = new Uint8Array(n); for (const j of hc.pix) hm[j] = 1;
          let r2 = 0, g2 = 0, b2 = 0; for (const j of hc.pix) { r2 += px[j * 4]; g2 += px[j * 4 + 1]; b2 += px[j * 4 + 2]; }
          layers.push({ name: "letra", fill: hex2(r2 / hc.pix.length, g2 / hc.pix.length, b2 / hc.pix.length), d: pathD(loopsOf(hm, w, h).map((l) => rdp(chaikin(l, smooth), eps)), sx, sy), area: hc.pix.length, box: hc.box, kind: "letra", parent: layers.length - 1 });
        }
      }
      if (layers.length > 160) break;
    }
  }
  /* letras en orden de lectura: por renglón y de izquierda a derecha */
  const letters = layers.filter((l) => l.kind === "letra");
  const lh = letters.length ? letters.reduce((s, l) => s + (l.box[3] - l.box[1]), 0) / letters.length : 1;
  letters.sort((a, b) => Math.round(a.box[1] / lh) - Math.round(b.box[1] / lh) || a.box[0] - b.box[0]).forEach((l, i) => { l.name = `letra ${i + 1}`; });
  return { layers, palette: pal.map((p) => hex2(p[0], p[1], p[2])), background: bg >= 0 ? hex2(...pal[bg]) : null };
}

/* modo A: el motor propio, parámetros al estilo VTracer → paths agrupados por color */
export function traceParams(o) {
  const bw = o.colormode === "bw" || o.mode === "mono";
  return {
    mode: bw ? "blackAndWhite" : o.mode === "logo" ? "logo" : "color",
    colors: Math.max(2, Math.min(32, Math.round(o.colorPrecision ?? o.colors ?? 8))),
    palette: "limited",
    paths: Math.max(0, Math.min(100, o.pathPrecision != null ? +o.pathPrecision * 10 : (o.detail ?? 60))),
    corners: Math.max(0, Math.min(100, o.cornerThreshold != null ? 100 - (+o.cornerThreshold / 180) * 100 : (o.smooth === false ? 85 : 35))),
    noise: Math.max(0, Math.min(100, o.filterSpeckle != null ? +o.filterSpeckle * 6 : (o.smooth === false ? 12 : 30))),
    method: o.hierarchical === "cutout" ? "abutting" : "overlapping",
    ignoreWhite: !!o.removeBackground,
  };
}

/* Quiver: costo estimado (verificar precios vigentes en docs.quiver.ai) */
export const QUIVER_MODELS = {
  "arrow-1.1": { label: "arrow-1.1 (1 crédito fijo)", estimate: () => "1 crédito de Quiver" },
  "arrow-2": { label: "arrow-2 (por tokens)", estimate: (px) => `≈ US$ ${(0.004 + px / 1e6 * 0.02).toFixed(3)} (tokens: US$4 / US$20 por 1M entrada/salida)` },
  "arrow-2-telos": { label: "arrow-2-telos (mayor fidelidad)", estimate: (px) => `≈ US$ ${(0.006 + px / 1e6 * 0.03).toFixed(3)} (tokens: US$6 / US$30 por 1M entrada/salida)` },
};
