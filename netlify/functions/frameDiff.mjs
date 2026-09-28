// frameDiff — REQ-032 Tool 3: diff por bloques entre el render de un frame
// y una imagen de referencia. PURO (sin canvas/DOM): opera sobre buffers
// RGBA { data, width, height }. La página de captura (render.mjs) lleva una
// copia EXACTA del bloque DIFF-ALGO — la paridad se afirma en
// QA/req032-visual-tools.test.mjs. Ayuda de localización, no oráculo: kind
// señala DÓNDE y qué CLASE de cambio, el agente decide con su propia visión.
export const DIFF_BLOCK = 32;
export const DIFF_THRESHOLD = 0.12;

// ── DIFF-ALGO-BEGIN — copia exacta en render.mjs (paridad en QA) ──
export function resampleNearest(data, w, h, nw, nh) {
  var out = new Uint8ClampedArray(nw * nh * 4);
  for (var y = 0; y < nh; y++) {
    var sy = Math.min(h - 1, Math.floor((y * h) / nh));
    for (var x = 0; x < nw; x++) {
      var sx = Math.min(w - 1, Math.floor((x * w) / nw));
      var si = (sy * w + sx) * 4, di = (y * nw + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return out;
}

export function diffFrames(a, b, opts) {
  var block = (opts && opts.block) || 32;
  var threshold = (opts && opts.threshold != null) ? opts.threshold : 0.12;
  var topN = (opts && opts.topN) || 8;
  var width = Math.min(a.width, b.width), height = Math.min(a.height, b.height);
  var ad = (a.width === width && a.height === height) ? a.data : resampleNearest(a.data, a.width, a.height, width, height);
  var bd = (b.width === width && b.height === height) ? b.data : resampleNearest(b.data, b.width, b.height, width, height);
  var cols = Math.ceil(width / block), rows = Math.ceil(height / block);
  var scores = new Float64Array(cols * rows);
  var kinds = new Array(cols * rows);
  for (var z = 0; z < kinds.length; z++) kinds[z] = "";
  for (var by = 0; by < rows; by++) {
    for (var bx = 0; bx < cols; bx++) {
      var x0 = bx * block, y0 = by * block;
      var x1 = Math.min(x0 + block, width), y1 = Math.min(y0 + block, height);
      var sumR = 0, sumG = 0, sumB = 0, sumLA = 0, sumLB = 0, sumLA2 = 0, sumLB2 = 0, sumD = 0, sumD2 = 0, n = 0;
      for (var y = y0; y < y1; y++) {
        for (var x = x0; x < x1; x++) {
          var i = (y * width + x) * 4;
          var dr = Math.abs(ad[i] - bd[i]), dg = Math.abs(ad[i + 1] - bd[i + 1]), db = Math.abs(ad[i + 2] - bd[i + 2]);
          sumR += dr; sumG += dg; sumB += db;
          var la = 0.2126 * ad[i] + 0.7152 * ad[i + 1] + 0.0722 * ad[i + 2];
          var lb = 0.2126 * bd[i] + 0.7152 * bd[i + 1] + 0.0722 * bd[i + 2];
          sumLA += la; sumLB += lb; sumLA2 += la * la; sumLB2 += lb * lb;
          var d = (dr + dg + db) / 3;
          sumD += d; sumD2 += d * d;
          n++;
        }
      }
      var score = Math.max(sumR, sumG, sumB) / n / 255;
      var idx = by * cols + bx;
      scores[idx] = score;
      if (score <= threshold) continue;
      // Heurística de kind: señala DÓNDE y qué CLASE de cambio — no qué es.
      var meanLA = sumLA / n, meanLB = sumLB / n;
      var stdLA = Math.sqrt(Math.max(0, sumLA2 / n - meanLA * meanLA));
      var stdLB = Math.sqrt(Math.max(0, sumLB2 / n - meanLB * meanLB));
      var meanD = sumD / n;
      var stdD = Math.sqrt(Math.max(0, sumD2 / n - meanD * meanD));
      var FLAT = 6; // bloque con luminancia ~uniforme
      if (stdLA < FLAT && stdLB < FLAT) kinds[idx] = "color-shift";
      else if (stdLA < FLAT) kinds[idx] = "missing-element"; // plano en render, estructura en referencia
      else if (stdLB < FLAT) kinds[idx] = "extra-element"; // estructura en render, plano en referencia
      else kinds[idx] = stdD > 12 ? "text-shape-shift" : "color-shift";
    }
  }
  // Fusiona bloques divergentes adyacentes en bounding boxes (conexas 4-vecinas)
  var seen = new Uint8Array(cols * rows);
  var comps = [];
  for (var s = 0; s < cols * rows; s++) {
    if (!kinds[s] || seen[s]) continue;
    var queue = [s];
    seen[s] = 1;
    var minX = cols, minY = rows, maxX = -1, maxY = -1, sumScore = 0, count = 0;
    var kindCount = {};
    while (queue.length) {
      var cur = queue.pop();
      var cx = cur % cols, cy = Math.floor(cur / cols);
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      sumScore += scores[cur];
      count++;
      kindCount[kinds[cur]] = (kindCount[kinds[cur]] || 0) + 1;
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var q = 0; q < 4; q++) {
        var nx = cx + nb[q][0], ny = cy + nb[q][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var nIdx = ny * cols + nx;
        if (kinds[nIdx] && !seen[nIdx]) { seen[nIdx] = 1; queue.push(nIdx); }
      }
    }
    var bestKind = "", bestCount = 0;
    for (var kind in kindCount) if (kindCount[kind] > bestCount) { bestKind = kind; bestCount = kindCount[kind]; }
    comps.push({ x: minX * block, y: minY * block, w: Math.min((maxX + 1) * block, width) - minX * block, h: Math.min((maxY + 1) * block, height) - minY * block, kind: bestKind, score: Math.round((sumScore / count) * 10000) / 10000, _sum: sumScore });
  }
  comps.sort(function (p, q2) { return q2._sum - p._sum; });
  var top = [];
  for (var t = 0; t < comps.length && t < topN; t++) {
    top.push({ x: comps[t].x, y: comps[t].y, w: comps[t].w, h: comps[t].h, kind: comps[t].kind, score: comps[t].score });
  }
  var divergent = 0;
  for (var dv = 0; dv < kinds.length; dv++) if (kinds[dv]) divergent++;
  return {
    width: width, height: height, block: block, threshold: threshold,
    divergentAreaPct: Math.round((divergent / (cols * rows)) * 10000) / 100,
    topDivergences: top,
  };
}
// ── DIFF-ALGO-END ──
