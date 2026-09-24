// GraphForge SVG flowchart editor.
// Renders a graph model, handles pan/zoom, node dragging, port-to-port linking,
// selection, Sugiyama-lite auto layout and SVG export.
// Model mutations raise cb.history() before and cb.changed() after the change.

const NS = 'http://www.w3.org/2000/svg';
const FONT_LABEL = '13px -apple-system, "Segoe UI", system-ui, sans-serif';
const FONT_ELABEL = '11.5px -apple-system, "Segoe UI", system-ui, sans-serif';

const SIDE_VEC = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

const EXPORT_CSS = `
  .nshape { fill: #ffffff; stroke: #9aa0a6; stroke-width: 1.4; }
  .node.sel .nshape, .nshape.sel { stroke: #2f6fed; stroke-width: 2.4; }
  .nlabel { font: 13px -apple-system, "Segoe UI", system-ui, sans-serif; fill: #202124; text-align: center; display: flex; align-items: center; justify-content: center; height: 100%; padding: 2px 8px; box-sizing: border-box; }
  .epath { fill: none; stroke: #d93025; stroke-width: 1.8; }
  .epath.dash { stroke-dasharray: 6 5; }
  .elabel-bg { fill: #ffffff; stroke: #e4e6ea; }
  .elabel-text { font: 11.5px -apple-system, "Segoe UI", system-ui, sans-serif; fill: #5f6368; }
  .subbox { fill: rgba(32,33,36,0.04); stroke: #bdc1c6; stroke-width: 1.3; stroke-dasharray: 7 5; }
  .subtitle { font: 11px -apple-system, "Segoe UI", system-ui, sans-serif; fill: #3c4043; font-weight: 600; letter-spacing: .05em; }
`;

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;br\/?&gt;/gi, '<br>');
}

const measureCtx = document.createElement('canvas').getContext('2d');
function measureLabel(label, font) {
  measureCtx.font = font;
  const lines = String(label || '').split('<br/>');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l || ' ').width);
  return { w, lines: lines.length, lh: 17 };
}

function nodeSize(n) {
  const t = measureLabel(n.label, FONT_LABEL);
  if (n.shape === 'diamond') return { w: Math.max(110, Math.ceil(t.w) + 76), h: Math.max(66, t.lines * 17 + 46) };
  if (n.shape === 'circle') {
    const r = Math.max(28, Math.ceil(t.w) / 2 + 20, (t.lines * 17) / 2 + 22);
    return { w: Math.round(r * 2), h: Math.round(r * 2) };
  }
  return { w: Math.max(76, Math.ceil(t.w) + 26), h: Math.max(36, t.lines * 17 + 16) };
}

const SIDE_LIST = ['top', 'bottom', 'left', 'right'];

function autoSides(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) * 1.15 > Math.abs(dy)) {
    return { sSide: dx >= 0 ? 'right' : 'left', tSide: dx >= 0 ? 'left' : 'right' };
  }
  return { sSide: dy >= 0 ? 'bottom' : 'top', tSide: dy >= 0 ? 'top' : 'bottom' };
}

const r2 = v => Math.round(v * 100) / 100;

// clamp a pin point to a node's border box (with a small margin) so a pinned
// endpoint always lands on the visible edge of the card
function clampToBox(pt, n) {
  const m = 6;
  const x = Math.min(Math.max(pt.x, n.x + m), n.x + n.w - m);
  const y = Math.min(Math.max(pt.y, n.y + m), n.y + n.h - m);
  const onBorderX = pt.x < n.x + m || pt.x > n.x + n.w - m;
  const onBorderY = pt.y < n.y + m || pt.y > n.y + n.h - m;
  if (onBorderX && !onBorderY) return { x, y: Math.min(Math.max(pt.y, n.y), n.y + n.h) };
  if (onBorderY && !onBorderX) return { x: Math.min(Math.max(pt.x, n.x), n.x + n.w), y };
  return { x, y };
}

// Orthogonal ("combed") routing: leave p1 along its side, elbow, enter p2
// along its side. Corners get a small rounding for the polished look.
function routeBetween(p1, sSide, p2, tSide, preA, preB, segShift) {
  const G = 16;
  const v1 = SIDE_VEC[sSide], v2 = SIDE_VEC[tSide];
  const A = preA || { x: p1.x + v1.x * G, y: p1.y + v1.y * G };
  const B = preB || { x: p2.x + v2.x * G, y: p2.y + v2.y * G };
  const pts = [p1, A];
  if (v1.x !== 0 && v2.x !== 0) {
    const midX = (A.x + B.x) / 2;
    pts.push({ x: midX, y: A.y }, { x: midX, y: B.y });
  } else if (v1.y !== 0 && v2.y !== 0) {
    let midY;
    if (v1.y === v2.y) midY = v1.y > 0 ? Math.max(A.y, B.y) + 14 : Math.min(A.y, B.y) - 14;
    else midY = (A.y + B.y) / 2;
    pts.push({ x: A.x, y: midY }, { x: B.x, y: midY });
  } else if (v1.x !== 0) {
    pts.push({ x: B.x, y: A.y }); // out horizontal, in vertical
  } else {
    pts.push({ x: A.x, y: B.y }); // out vertical, in horizontal
  }
  pts.push(B, p2);
  // user-dragged middle lane: shift the long middle segment to the saved lane
  if (segShift && segShift.v != null && pts.length >= 5) {
    if (pts.length === 6) {
      // both exits on the same axis: pts[2..3] is the movable middle segment
      const axis = v1.x !== 0 ? 'x' : 'y';
      if (segShift.axis === axis) { pts[2][axis] = segShift.v; pts[3][axis] = segShift.v; }
    } else {
      // mixed exits: pts[1..2] is the middle run; move it along its normal
      const axis = pts[1].x === pts[2].x ? 'x' : 'y';
      if (segShift.axis === axis) { pts[1][axis] = segShift.v; pts[2][axis] = segShift.v; }
    }
  }
  const clean = [];
  for (const p of pts) {
    const q = clean[clean.length - 1];
    if (!q || Math.abs(q.x - p.x) > 0.01 || Math.abs(q.y - p.y) > 0.01) clean.push(p);
  }
  let d = `M ${r2(clean[0].x)},${r2(clean[0].y)}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const p = clean[i], prev = clean[i - 1], next = clean[i + 1];
    const d1 = Math.hypot(p.x - prev.x, p.y - prev.y);
    const d2 = Math.hypot(next.x - p.x, next.y - p.y);
    const rr = Math.min(9, d1 / 2, d2 / 2);
    const ax = p.x + ((prev.x - p.x) / d1) * rr, ay = p.y + ((prev.y - p.y) / d1) * rr;
    const bx = p.x + ((next.x - p.x) / d2) * rr, by = p.y + ((next.y - p.y) / d2) * rr;
    d += ` L ${r2(ax)},${r2(ay)} Q ${r2(p.x)},${r2(p.y)} ${r2(bx)},${r2(by)}`;
  }
  const last = clean[clean.length - 1];
  d += ` L ${r2(last.x)},${r2(last.y)}`;
  // edge label sits on the longest segment
  let best = -1, mid = { x: p1.x, y: p1.y };
  for (let i = 1; i < clean.length; i++) {
    const L = Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y);
    if (L > best) {
      best = L;
      mid = { x: (clean[i - 1].x + clean[i].x) / 2, y: (clean[i - 1].y + clean[i].y) / 2 };
    }
  }
  return { d, mid };
}

function edgeGeometry(a, b, sSide, tSide, segShift) {
  const auto = autoSides(a, b);
  if (!SIDE_LIST.includes(sSide)) sSide = auto.sSide;
  if (!SIDE_LIST.includes(tSide)) tSide = auto.tSide;
  const sShape = a.shape === 'diamond' ? 'diamond' : 'rect';
  const tShape = b.shape === 'diamond' ? 'diamond' : 'rect';
  // endpoint ON the diamond vertex / rect border, then route outward
  const p1 = portWorldAbs({ ...a, _size: { w: a.w, h: a.h }, shape: sShape }, sSide);
  const p2 = portWorldAbs({ ...b, _size: { w: b.w, h: b.h }, shape: tShape }, tSide);
  const g = 16;
  const v1 = SIDE_VEC[sSide], v2 = SIDE_VEC[tSide];
  const A = { x: p1.x + v1.x * g, y: p1.y + v1.y * g };
  const B = { x: p2.x + v2.x * g, y: p2.y + v2.y * g };
  return routeBetween(p1, sSide, p2, tSide, A, B, segShift);
}

function portLocal(s, side) {
  switch (side) {
    case 'top': return { x: s.w / 2, y: 0 };
    case 'bottom': return { x: s.w / 2, y: s.h };
    case 'left': return { x: 0, y: s.h / 2 };
    default: return { x: s.w, y: s.h / 2 };
  }
}
function portAbs(n, side) {
  const s = n._size || { w: 80, h: 40 };
  const p = portLocal(s, side);
  return { x: n.x + p.x, y: n.y + p.y };
}
// diamond ports: at the vertices of the rotated square (N/E/S/W points)
function diamondPort(s, side) {
  switch (side) {
    case 'top': return { x: s.w / 2, y: 0 };
    case 'right': return { x: s.w, y: s.h / 2 };
    case 'bottom': return { x: s.w / 2, y: s.h };
    default: return { x: 0, y: s.h / 2 };
  }
}
// port position in world coords honoring diamond geometry
function portWorldAbs(n, side) {
  const s = n._size || { w: 80, h: 40 };
  const p = n.shape === 'diamond' ? diamondPort(s, side) : portLocal(s, side);
  return { x: n.x + p.x, y: n.y + p.y };
}

export class GraphEditor {
  constructor(svg, cb) {
    this.svg = svg;
    this.cb = cb || {};
    this.model = null;
    this.sizes = new Map();
    this.nodeEls = new Map();
    this.edgeEls = new Map();
    this.subEls = new Map();
    this.sel = null;
    this.view = { x: 40, y: 40, k: 1 };
    this.drag = null;
    this.link = null;
    this.edgeEnd = null;
    this.lane = null;
    this.pan = null;

    this.root = el('g', { id: 'viewport' });
    this.layers = { sub: el('g'), edges: el('g'), nodes: el('g'), temp: el('g') };
    this.layers.temp.setAttribute('pointer-events', 'none');
    const defs = el('defs');
    defs.innerHTML = `
      <marker id="gf-arr" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d93025"/></marker>
      <marker id="gf-arr-sel" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2f6fed"/></marker>`;
    svg.appendChild(defs);
    for (const l of Object.values(this.layers)) this.root.appendChild(l);
    svg.appendChild(this.root);
    this.bindEvents();
  }

  setModel(m) { this.model = m; this.sel = null; }
  getSelection() { return this.sel; }

  select(t) {
    this.sel = t;
    for (const [id, { g }] of this.nodeEls) g.classList.toggle('sel', t?.type === 'node' && t.id === id);
    for (const [id, e] of this.edgeEls) {
      const on = t?.type === 'edge' && t.id === id;
      e.g.classList.toggle('sel', on);
      e.path.setAttribute('marker-end', on ? 'url(#gf-arr-sel)' : 'url(#gf-arr)');
    }
    for (const [id, { g }] of this.subEls) g.classList.toggle('sel', t?.type === 'sub' && t.id === id);
    this.cb.select?.(t);
  }

  // ---------- rendering ----------

  render() {
    this.sizes.clear();
    this.layers.sub.innerHTML = '';
    this.layers.edges.innerHTML = '';
    this.layers.nodes.innerHTML = '';
    this.layers.temp.innerHTML = '';
    this.nodeEls.clear(); this.edgeEls.clear(); this.subEls.clear();
    const m = this.model;
    if (!m) { this.applyTransform(); return; }

    for (const n of m.nodes) {
      n._size = nodeSize(n);
      this.sizes.set(n.id, n._size);
    }

    for (const sg of m.subgraphs || []) {
      const members = m.nodes.filter(n => n.parent === sg.id);
      if (!members.length) continue;
      const box = this.membersBBox(members);
      const g = el('g', { class: 'sub', 'data-id': sg.id }, this.layers.sub);
      el('rect', { class: 'subbox', x: box.x, y: box.y, width: box.w, height: box.h, rx: 12 }, g);
      const t = el('text', { class: 'subtitle', x: box.x + 14, y: box.y + 20 }, g);
      t.textContent = sg.title;
      const hit = el('rect', { class: 'subhit', x: box.x, y: box.y, width: box.w, height: 30, fill: 'transparent' }, g);
      hit.setAttribute('pointer-events', 'all');
      this.subEls.set(sg.id, { g, box });
    }

    for (const e of m.edges) {
      const a = this.nodePos(e.source), b = this.nodePos(e.target);
      const noSrc = !a, noDst = !b;
      if (noSrc && !e.srcFloat) continue;
      if (noDst && !e.dstFloat) continue;
      if (!noSrc && !noDst) {
        this.renderEdge(e, a, b);
        continue;
      }
      // Disconnected end(s): draw toward the floating point(s).
      const fa = noSrc
        ? { id: null, x: e.srcFloat.x, y: e.srcFloat.y, w: 2, h: 2 }
        : a;
      const fb = noDst
        ? { id: null, x: e.dstFloat.x, y: e.dstFloat.y, w: 2, h: 2 }
        : b;
      this.renderEdge(e, fa, fb, noSrc ? null : (e.s || 'right'), noDst ? null : (e.t || 'left'), noSrc, noDst);
    }

    for (const n of m.nodes) {
      const s = this.sizes.get(n.id);
      const selected = this.sel?.type === 'node' && this.sel.id === n.id;
      const g = el('g', {
        class: 'node' + (selected ? ' sel' : ''),
        'data-id': n.id,
        transform: `translate(${n.x ?? 0},${n.y ?? 0})`,
      }, this.layers.nodes);
      if (n.shape === 'diamond') {
        el('polygon', { class: 'nshape', points: `${s.w / 2},0 ${s.w},${s.h / 2} ${s.w / 2},${s.h} 0,${s.h / 2}` }, g);
      } else if (n.shape === 'circle') {
        el('ellipse', { class: 'nshape', cx: s.w / 2, cy: s.h / 2, rx: s.w / 2, ry: s.h / 2 }, g);
      } else if (n.shape === 'round') {
        el('rect', { class: 'nshape', width: s.w, height: s.h, rx: s.h / 2 }, g);
      } else {
        el('rect', { class: 'nshape', width: s.w, height: s.h, rx: 9 }, g);
      }
      const fo = el('foreignObject', { width: s.w, height: s.h }, g);
      const div = document.createElement('div');
      div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      div.className = 'nlabel';
      div.innerHTML = escHtml(n.label);
      div.title = 'Double-click to edit text in place';
      div.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        this.startInlineEdit(n.id, div);
      });
      fo.appendChild(div);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        // diamonds: ports sit at the 4 VERTICES (the sharp points), where
        // lines naturally touch; other shapes: side midpoints
        const p = n.shape === 'diamond' ? diamondPort(s, side) : portLocal(s, side);
        el('circle', { class: 'port', 'data-side': side, cx: p.x, cy: p.y, r: 5.5 }, g);
      }
      if (n.link) {
        // drill-down badge: click opens the linked graph (cb.openLink)
        const bg = el('g', { class: 'linkbadge' }, g);
        el('circle', { cx: s.w - 1, cy: -1, r: 9 }, bg);
        const bt = el('text', { x: s.w - 1, y: 3, 'text-anchor': 'middle' }, bg);
        bt.textContent = '↗';
      }
      this.nodeEls.set(n.id, { g });
    }

    this.applyTransform();
  }

  nodePos(id) {
    const n = this.model?.nodes.find(x => x.id === id);
    if (!n) return null;
    const s = this.sizes.get(id) || { w: 80, h: 40 };
    return { id, x: n.x ?? 0, y: n.y ?? 0, w: s.w, h: s.h };
  }

  renderEdge(e, a, b, sSide, tSide, noSrc = false, noDst = false) {
    // A pinned end keeps the user's exact drop point: the endpoint port moves
    // to the pin (clamped inside the node box) and the line bends there.
    if (e.srcPin && a) {
      const c = clampToBox(e.srcPin, a);
      e.srcPin = c;
    }
    if (e.dstPin && b) {
      const c = clampToBox(e.dstPin, b);
      e.dstPin = c;
    }
    const aEff = (e.srcPin && a) ? { ...a, x: e.srcPin.x - a.w / 2, y: e.srcPin.y - a.h / 2 } : a;
    const bEff = (e.dstPin && b) ? { ...b, x: e.dstPin.x - b.w / 2, y: e.dstPin.y - b.h / 2 } : b;
    const geo = edgeGeometry(aEff ?? a, bEff ?? b, sSide ?? e.s, tSide ?? e.t, e.lane);
    const selected = this.sel?.type === 'edge' && this.sel.id === e.id;
    const g = el('g', { class: 'edge' + (noSrc || noDst ? ' loose' : ''), 'data-id': e.id }, this.layers.edges);
    const hit = el('path', { class: 'ehit', d: geo.d }, g);
    const path = el('path', {
      class: 'epath' + (e.dashed ? ' dash' : ''),
      d: geo.d,
      'marker-end': selected ? 'url(#gf-arr-sel)' : 'url(#gf-arr)',
    }, g);
    // grab handle on a disconnected end: drag it to reposition or reconnect
    if (noSrc) {
      const m0 = geo.d.match(/^M ([\d.-]+),([\d.-]+)/);
      const h = el('circle', { class: 'floathandle', 'data-id': e.id, 'data-end': 'src', cx: Number(m0?.[1] ?? a.x), cy: Number(m0?.[2] ?? a.y), r: 7 }, g);
      h.setAttribute('pointer-events', 'all');
    }
    if (noDst) {
      const h = el('circle', { class: 'floathandle', 'data-id': e.id, 'data-end': 'dst', cx: b.x, cy: b.y, r: 7 }, g);
      h.setAttribute('pointer-events', 'all');
    }
    let label = null;
    if (e.label) {
      const lg = el('g', { class: 'elabel' }, g);
      const mt = measureLabel(e.label, FONT_ELABEL);
      const w = mt.w + 10, h = 17;
      const rect = el('rect', { class: 'elabel-bg', x: geo.mid.x - w / 2, y: geo.mid.y - h / 2, width: w, height: h, rx: 4 }, lg);
      const tx = el('text', { class: 'elabel-text', x: geo.mid.x, y: geo.mid.y + 4, 'text-anchor': 'middle' }, lg);
      tx.textContent = e.label.replace(/<br\/>/g, ' ');
      label = { rect, text: tx };
    }
    this.edgeEls.set(e.id, { g, path, hit, label });
  }

  nearestSide(p, wpt) {
    // shape-aware: diamonds anchor at their 4 VERTICES, rects/rounds at the
    // midpoints of their sides — pick whichever port is physically closest
    // to where the user dropped.
    const n = this.model?.nodes.find(x => x.id === p.id);
    const ports = [
      { side: 'top', x: p.x + p.w / 2, y: p.y },
      { side: 'right', x: p.x + p.w, y: p.y + p.h / 2 },
      { side: 'bottom', x: p.x + p.w / 2, y: p.y + p.h },
      { side: 'left', x: p.x, y: p.y + p.h / 2 },
    ];
    let best = ports[0], bd = Infinity;
    for (const pt of ports) {
      const d = Math.hypot(wpt.x - pt.x, wpt.y - pt.y);
      if (d < bd) { bd = d; best = pt; }
    }
    return best.side;
  }

  // ---------- inline label editing (double-click the node text) ----------

  startInlineEdit(id, div) {
    if (this.inline) this.finishInlineEdit(true);
    const n = this.model?.nodes.find(x => x.id === id);
    if (!n) return;
    this.select({ type: 'node', id });
    this.cb.history?.();
    div.contentEditable = 'true';
    div.classList.add('editing');
    div.innerText = (n.label || '').replace(/<br\/>/g, '\n');
    this.inline = { id, div, orig: n.label };
    div.focus();
    const range = document.createRange();
    range.selectNodeContents(div);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    div.oninput = () => {
      if (!this.inline) return;
      n.label = div.innerText.replace(/\n/g, '<br/>').slice(0, 300);
      this.cb.labelLive?.(id, n.label);
    };
    div.onkeydown = ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.finishInlineEdit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.finishInlineEdit(false); }
    };
    div.onblur = () => this.finishInlineEdit(true);
  }

  finishInlineEdit(commit) {
    const ie = this.inline;
    if (!ie) return;
    this.inline = null;
    const n = this.model?.nodes.find(x => x.id === ie.id);
    if (n) n.label = commit
      ? ie.div.innerText.replace(/\n/g, '<br/>').slice(0, 300)
      : ie.orig;
    ie.div.oninput = ie.div.onkeydown = ie.div.onblur = null;
    ie.div.contentEditable = 'false';
    ie.div.classList.remove('editing');
    this.render();
    if (commit) {
      this.cb.labelDone?.();
      this.cb.changed?.();
    } else {
      this.cb.labelLive?.(ie.id, n ? n.label : '');
    }
  }

  membersBBox(members, pad = 22, titleH = 30) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const s = this.sizes.get(n.id) || { w: 80, h: 40 };
      const x = n.x ?? 0, y = n.y ?? 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + s.w); maxY = Math.max(maxY, y + s.h);
    }
    return {
      x: minX - pad, y: minY - pad - titleH,
      w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + titleH,
    };
  }

  refreshEdgesFor(ids) {
    const set = new Set(ids);
    for (const e of this.model.edges) {
      if (!set.has(e.source) && !set.has(e.target)) continue;
      const ee = this.edgeEls.get(e.id);
      if (!ee) continue;
      const a = this.nodePos(e.source) || (e.srcFloat ? { id: null, x: e.srcFloat.x, y: e.srcFloat.y, w: 2, h: 2 } : null);
      const b = this.nodePos(e.target) || (e.dstFloat ? { id: null, x: e.dstFloat.x, y: e.dstFloat.y, w: 2, h: 2 } : null);
      if (!a || !b) continue;
      const geo = edgeGeometry(
        (e.srcPin && a) ? { ...a, x: e.srcPin.x - a.w / 2, y: e.srcPin.y - a.h / 2 } : a,
        (e.dstPin && b) ? { ...b, x: e.dstPin.x - b.w / 2, y: e.dstPin.y - b.h / 2 } : b,
        e.srcFloat ? null : e.s,
        e.dstFloat ? null : e.t,
        e.lane,
      );
      ee.path.setAttribute('d', geo.d);
      ee.hit.setAttribute('d', geo.d);
      if (ee.label) {
        const mt = measureLabel(e.label, FONT_ELABEL);
        const w = mt.w + 10, h = 17;
        ee.label.rect.setAttribute('x', geo.mid.x - w / 2);
        ee.label.rect.setAttribute('y', geo.mid.y - h / 2);
        ee.label.text.setAttribute('x', geo.mid.x);
        ee.label.text.setAttribute('y', geo.mid.y + 4);
      }
    }
  }

  refreshSubBoxes() {
    const m = this.model;
    for (const sg of m.subgraphs || []) {
      const se = this.subEls.get(sg.id);
      if (!se) continue;
      const members = m.nodes.filter(n => n.parent === sg.id);
      if (!members.length) continue;
      const box = this.membersBBox(members);
      se.box = box;
      const rect = se.g.querySelector('.subbox');
      rect.setAttribute('x', box.x); rect.setAttribute('y', box.y);
      rect.setAttribute('width', box.w); rect.setAttribute('height', box.h);
      const title = se.g.querySelector('.subtitle');
      title.setAttribute('x', box.x + 14); title.setAttribute('y', box.y + 20);
      const hit = se.g.querySelector('.subhit');
      hit.setAttribute('x', box.x); hit.setAttribute('y', box.y);
      hit.setAttribute('width', box.w); hit.setAttribute('height', 30);
    }
  }

  // ---------- viewport ----------

  applyTransform() {
    this.root.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
  }

  worldFromEvent(e) {
    const rect = this.svg.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }

  zoomAt(sx, sy, factor) {
    const k2 = Math.min(3.5, Math.max(0.12, this.view.k * factor));
    const wx = (sx - this.view.x) / this.view.k;
    const wy = (sy - this.view.y) / this.view.k;
    this.view.x = sx - wx * k2;
    this.view.y = sy - wy * k2;
    this.view.k = k2;
    this.applyTransform();
    this.cb.viewChange?.(k2);
  }

  zoomBy(factor) {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  fitView() {
    if (!this.model || !this.model.nodes.length) return;
    const bb = this.contentBBox(60);
    const rect = this.svg.getBoundingClientRect();
    if (!bb.w || !bb.h) return;
    const k = Math.min(rect.width / bb.w, rect.height / bb.h, 1.4);
    this.view.k = Math.max(0.12, k);
    this.view.x = (rect.width - bb.w * this.view.k) / 2 - bb.x * this.view.k;
    this.view.y = (rect.height - bb.h * this.view.k) / 2 - bb.y * this.view.k;
    this.applyTransform();
    this.cb.viewChange?.(this.view.k);
  }

  contentBBox(pad = 0) {
    const m = this.model;
    if (!m || !m.nodes.length) return { x: 0, y: 0, w: 100, h: 100 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of m.nodes) {
      const s = this.sizes.get(n.id) || { w: 80, h: 40 };
      const x = n.x ?? 0, y = n.y ?? 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + s.w); maxY = Math.max(maxY, y + s.h);
    }
    for (const sb of this.subEls.values()) {
      minX = Math.min(minX, sb.box.x); minY = Math.min(minY, sb.box.y);
      maxX = Math.max(maxX, sb.box.x + sb.box.w); maxY = Math.max(maxY, sb.box.y + sb.box.h);
    }
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  centerWorld() {
    const rect = this.svg.getBoundingClientRect();
    return this.worldFromEvent({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  }

  // ---------- interactions ----------

  bindEvents() {
    this.svg.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.svg.addEventListener('pointermove', e => this.onPointerMove(e));
    this.svg.addEventListener('pointerup', e => this.onPointerUp(e));
    this.svg.addEventListener('dblclick', e => this.onDblClick(e));
    this.svg.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (this.inline) { this.finishInlineEdit(false); return; }
        this.cancelTransient();
        this.select(null);
      }
    });
  }

  cancelTransient() {
    if (this.lane) {
      this.svg.classList.remove('lane-drag');
      this.lane = null;
    }
    if (this.edgeEnd) {
      this.tempPath?.remove();
      this.tempPath = null;
      this.svg.classList.remove('linking');
      this.svg.querySelectorAll('.linkTarget').forEach(x => x.classList.remove('linkTarget'));
      this.edgeEnd = null;
    }
    if (this.link) {
      this.tempPath?.remove();
      this.tempPath = null;
      this.svg.classList.remove('linking');
      this.svg.querySelectorAll('.linkTarget').forEach(x => x.classList.remove('linkTarget'));
      this.link = null;
    }
    this.drag = null;
    this.pan = null;
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  onDblClick(e) {
    const gNode = e.target.closest?.('g.node');
    if (gNode) {
      const id = gNode.dataset.id;
      this.select({ type: 'node', id });
      this.cb.activate?.(id);
      return;
    }
    if (e.target.closest?.('.port')) return;
    this.cb.addNode?.(this.worldFromEvent(e));
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const badge = e.target.closest?.('.linkbadge');
    const gNode = e.target.closest?.('g.node');
    const portEl = e.target.closest?.('.port');
    const subHit = e.target.closest?.('.subhit');
    const gEdge = e.target.closest?.('g.edge');
    const floatHandle = e.target.closest?.('.floathandle');

    if (floatHandle) {
      const id = floatHandle.dataset.id;
      const end = floatHandle.dataset.end; // 'src' | 'dst'
      const ed = this.model.edges.find(x => x.id === id);
      if (!ed) return;
      this.select({ type: 'edge', id });
      this.cb.history?.();
      this.edgeEnd = {
        id, end,
        // where the edge should re-attach if dropped on empty canvas: nowhere — it stays loose
      };
      this.tempPath = el('path', { class: 'epath temp' }, this.layers.temp);
      this.svg.classList.add('linking');
      try { this.svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
      return;
    }

    if (badge && gNode) {
      const n = this.model.nodes.find(x => x.id === gNode.dataset.id);
      if (n?.link) {
        this.cb.openLink?.(n.link);
        e.preventDefault();
        return;
      }
    }

    if (portEl && gNode) {
      const id = gNode.dataset.id;
      const side = portEl.dataset.side;
      const start = portAbs({ ...this.model.nodes.find(n => n.id === id), _size: this.sizes.get(id) }, side);
      this.link = { from: id, side, start };
      this.tempPath = el('path', { class: 'epath temp' }, this.layers.temp);
      this.svg.classList.add('linking');
      try { this.svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
      return;
    }

    if (gNode) {
      // while inline-editing, clicks inside the label place the caret instead of dragging
      if (this.inline && this.inline.div.contains(e.target)) { e.preventDefault(); return; }
      const id = gNode.dataset.id;
      this.select({ type: 'node', id });
      this.drag = {
        ids: [id],
        orig: this.snapshotPositions([id]),
        sx: e.clientX, sy: e.clientY, moved: false,
      };
      try { this.svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
      return;
    }

    if (subHit) {
      const sgId = subHit.closest('g.sub').dataset.id;
      const ids = this.model.nodes.filter(n => n.parent === sgId).map(n => n.id);
      this.select({ type: 'sub', id: sgId });
      this.drag = { ids, orig: this.snapshotPositions(ids), sx: e.clientX, sy: e.clientY, moved: false };
      try { this.svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
      return;
    }

    if (gEdge) {
      const id = gEdge.dataset.id;
      const ed = this.model.edges.find(x => x.id === id);
      this.select({ type: 'edge', id });
      if (ed) {
        const wpt = this.worldFromEvent(e);
        const a = this.nodePos(ed.source), b = this.nodePos(ed.target);
        // Ports of each end (diamond-aware) to find the nearest end…
        const portOf = (n, side) => {
          if (!n) return ed.srcFloat ? { x: ed.srcFloat.x, y: ed.srcFloat.y } : null;
          return portWorldAbs({ ...n, _size: { w: n.w, h: n.h }, shape: n.shape === 'diamond' ? 'diamond' : 'rect' }, side);
        };
        const auto = a && b ? autoSides(a, b) : null;
        const pS = a ? portOf(a, ed.s || auto?.sSide) : (ed.srcFloat ? { x: ed.srcFloat.x, y: ed.srcFloat.y } : null);
        const pT = b ? portOf(b, ed.t || auto?.tSide) : (ed.dstFloat ? { x: ed.dstFloat.x, y: ed.dstFloat.y } : null);
        const dS = pS ? Math.hypot(wpt.x - pS.x, wpt.y - pS.y) : Infinity;
        const dT = pT ? Math.hypot(wpt.x - pT.x, wpt.y - pT.y) : Infinity;
        const nearEnd = dS < 60 || dT < 60;
        if (nearEnd && !e.altKey) {
          // grab near an end: pull THAT end loose (Mural-style)
          this.edgeEnd = {
            id,
            end: dS <= dT ? 'src' : 'dst',
            sx: e.clientX, sy: e.clientY,
            moved: false,
          };
        } else {
          // grab the middle: drag the whole lane to reorder crossings
          const midAxis = this.laneAxisOf(ed, a, b, auto);
          this.lane = {
            id,
            axis: midAxis.axis,
            orig: ed.lane?.axis === midAxis.axis ? ed.lane.v : midAxis.def,
            sx: e.clientX, sy: e.clientY,
            moved: false,
          };
        }
        try { this.svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
        e.preventDefault();
      }
      return;
    }

    // background: pan
    this.pan = { sx: e.clientX, sy: e.clientY, ox: this.view.x, oy: this.view.y, moved: false };
    try { this.svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }

  snapshotPositions(ids) {
    return ids.map(id => {
      const n = this.model.nodes.find(x => x.id === id);
      return { id, x: n?.x ?? 0, y: n?.y ?? 0 };
    });
  }

  // world coords of the current anchor port of an edge end (for seeding floats)
  portWorld(ed, which) {
    const n = this.nodePos(which === 'src' ? ed.source : ed.target);
    if (!n) return { x: 0, y: 0 };
    const auto = autoSides(n, this.nodePos(which === 'src' ? ed.target : ed.source) || n);
    const side = (which === 'src' ? (ed.s || auto.sSide) : (ed.t || auto.tSide));
    const p = portWorldAbs({ ...n, _size: { w: n.w, h: n.h }, shape: n.shape === 'diamond' ? 'diamond' : 'rect' }, side);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  // axis + default position of the movable middle segment of an edge
  laneAxisOf(ed, a, b, auto) {
    const s = (ed.s || auto?.sSide || 'right');
    const t = (ed.t || auto?.tSide || 'left');
    const sH = s === 'left' || s === 'right'; // source exits horizontally
    const tH = t === 'left' || t === 'right';
    if (sH === tH) {
      // both exits same axis: the middle run runs along that axis
      return { axis: sH ? 'x' : 'y', def: sH ? ((a.x + a.w / 2 + b.x + b.w / 2) / 2) : ((a.y + a.h / 2 + b.y + b.h / 2) / 2) };
    }
    // mixed: middle run is perpendicular to the source exit
    return sH ? { axis: 'y', def: (a.y + a.h / 2 + b.y + b.h / 2) / 2 } : { axis: 'x', def: (a.x + a.w / 2 + b.x + b.w / 2) / 2 };
  }

  onPointerMove(e) {
    if (this.lane) {
      const ed = this.model.edges.find(x => x.id === this.lane.id);
      if (!ed) { this.lane = null; return; }
      if (!this.lane.moved) {
        if (Math.abs(e.clientX - this.lane.sx) + Math.abs(e.clientY - this.lane.sy) < 4) return;
        this.lane.moved = true;
        this.cb.history?.();
        this.svg.classList.add('lane-drag');
      }
      const wpt = this.worldFromEvent(e);
      const v = Math.round(this.lane.axis === 'x' ? wpt.x : wpt.y);
      ed.lane = { axis: this.lane.axis, v };
      const ee = this.edgeEls.get(ed.id);
      if (ee) {
        const a = this.nodePos(ed.source) || (ed.srcFloat ? { id: null, x: ed.srcFloat.x, y: ed.srcFloat.y, w: 2, h: 2 } : null);
        const b = this.nodePos(ed.target) || (ed.dstFloat ? { id: null, x: ed.dstFloat.x, y: ed.dstFloat.y, w: 2, h: 2 } : null);
        if (a && b) {
          const geo = edgeGeometry(a, b, ed.srcFloat ? null : ed.s, ed.dstFloat ? null : ed.t, ed.lane);
          ee.path.setAttribute('d', geo.d);
          ee.hit.setAttribute('d', geo.d);
          if (ee.label) {
            const mt = measureLabel(ee && ed.label || ee.label.text.textContent, FONT_ELABEL);
            ee.label.rect.setAttribute('x', geo.mid.x - (mt.w + 10) / 2);
            ee.label.rect.setAttribute('y', geo.mid.y - 8.5);
            ee.label.text.setAttribute('x', geo.mid.x);
            ee.label.text.setAttribute('y', geo.mid.y + 4);
          }
        }
      }
      return;
    }
    if (this.edgeEnd) {
      const ed = this.model.edges.find(x => x.id === this.edgeEnd.id);
      if (!ed) { this.cancelTransient(); return; }
      // arm on first real movement: a plain click never detaches anything
      if (!this.edgeEnd.moved) {
        if (Math.abs(e.clientX - this.edgeEnd.sx) + Math.abs(e.clientY - this.edgeEnd.sy) < 4) return;
        this.edgeEnd.moved = true;
        this.cb.history?.();
        // seed the float at the CURRENT anchor position so a failed reconnect
        // never parks the end at {0,0}; it gets overwritten at pointerup anyway
        const seed = this.edgeEnd.end === 'src'
          ? this.portWorld(ed, 'src')
          : this.portWorld(ed, 'dst');
        if (this.edgeEnd.end === 'src') ed.srcFloat = seed;
        else ed.dstFloat = seed;
        this.tempPath = el('path', { class: 'epath temp' }, this.layers.temp);
        this.svg.classList.add('linking');
      }
      const wpt = this.worldFromEvent(e);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('g.node');
      this.svg.querySelectorAll('.linkTarget').forEach(x => { if (x !== hit) x.classList.remove('linkTarget'); });
      const other = this.edgeEnd.end === 'src' ? ed.target : ed.source;
      if (hit && hit.dataset.id !== other) hit.classList.add('linkTarget');
      const attachId = hit && hit.dataset.id !== other ? hit.dataset.id : null;
      // live preview: from the fixed endpoint to the cursor (or the node under it)
      const fixed = this.edgeEnd.end === 'src' ? this.nodePos(ed.target) : this.nodePos(ed.source);
      const mov = attachId
        ? this.nodePos(attachId)
        : { id: null, x: wpt.x - 1, y: wpt.y - 1, w: 2, h: 2 };
      const tSide = attachId ? this.nearestSide(mov, wpt) : undefined;
      const sSide = this.edgeEnd.end === 'src' ? undefined : (ed.s || 'right');
      const tSideFixed = this.edgeEnd.end === 'src' ? (ed.t || 'left') : tSide;
      const s2 = this.edgeEnd.end === 'src' ? (attachId ? this.nearestSide(mov, wpt) : undefined) : sSide;
      const geo = edgeGeometry(
        this.edgeEnd.end === 'src' ? mov : fixed,
        this.edgeEnd.end === 'src' ? s2 : sSide,
        this.edgeEnd.end === 'src' ? tSideFixed : mov,
        this.edgeEnd.end === 'src' ? undefined : tSide,
      );
      this.tempPath.setAttribute('d', geo.d);
      return;
    }
    if (this.link) {
      const wpt = this.worldFromEvent(e);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('g.node');
      this.svg.querySelectorAll('.linkTarget').forEach(x => { if (x !== hit) x.classList.remove('linkTarget'); });
      if (hit && hit.dataset.id !== this.link.from) hit.classList.add('linkTarget');
      let target = hit && hit.dataset.id !== this.link.from ? this.nodePos(hit.dataset.id) : null;
      let tSide;
      if (target) tSide = this.nearestSide(target, wpt);
      else target = { id: null, x: wpt.x - 40, y: wpt.y - 40, w: 80, h: 80 }; // pseudo-node: auto-side toward cursor
      const geo = edgeGeometry(this.nodePos(this.link.from), target, this.link.side, tSide);
      this.tempPath.setAttribute('d', geo.d);
      return;
    }
    if (this.drag) {
      const dx = (e.clientX - this.drag.sx) / this.view.k;
      const dy = (e.clientY - this.drag.sy) / this.view.k;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
      for (const o of this.drag.orig) {
        const n = this.model.nodes.find(x => x.id === o.id);
        if (!n) continue;
        n.x = Math.round(o.x + dx);
        n.y = Math.round(o.y + dy);
        this.nodeEls.get(o.id)?.g.setAttribute('transform', `translate(${n.x},${n.y})`);
      }
      this.refreshEdgesFor(this.drag.orig.map(o => o.id));
      this.refreshSubBoxes();
      return;
    }
    if (this.pan) {
      const dx = e.clientX - this.pan.sx, dy = e.clientY - this.pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.pan.moved = true;
      this.view.x = this.pan.ox + dx;
      this.view.y = this.pan.oy + dy;
      this.applyTransform();
    }
  }

  onPointerUp(e) {
    if (this.lane) {
      if (this.lane.moved) {
        this.cb.edgeChanged?.(this.model.edges.find(x => x.id === this.lane.id));
      }
      this.svg.classList.remove('lane-drag');
      this.lane = null;
      return;
    }
    if (this.edgeEnd) {
      const ed = this.model.edges.find(x => x.id === this.edgeEnd.id);
      if (!this.edgeEnd.moved || !ed) { this.edgeEnd = null; return; } // plain click: nothing armed
      const wpt = this.worldFromEvent(e);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('g.node');
      const other = this.edgeEnd.end === 'src' ? ed.target : ed.source;
      const attachId = hit?.dataset.id && hit.dataset.id !== other ? hit.dataset.id : null;
      if (attachId) {
        // Snap to the nearest PORT of the node (side midpoints for rect/round,
        // vertices for a diamond) — connections always land on visible dots.
        const side = this.nearestSide(this.nodePos(attachId), wpt);
        if (this.edgeEnd.end === 'src') {
          ed.source = attachId;
          ed.s = side;
          delete ed.srcFloat;
          delete ed.srcPin;
        } else {
          ed.target = attachId;
          ed.t = side;
          delete ed.dstFloat;
          delete ed.dstPin;
        }
        this.cb.edgeChanged?.(ed);
      } else {
        // stays loose at the cursor
        if (this.edgeEnd.end === 'src') ed.srcFloat = { x: Math.round(wpt.x), y: Math.round(wpt.y) };
        else ed.dstFloat = { x: Math.round(wpt.x), y: Math.round(wpt.y) };
        this.cb.edgeChanged?.(ed);
      }
      this.cancelTransient();
      this.render();
      return;
    }
    if (this.link) {
      const wpt = this.worldFromEvent(e);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('g.node');
      const target = hit?.dataset.id;
      if (target && target !== this.link.from) {
        // the vertex you drop near becomes the target anchor
        this.cb.link?.(this.link.from, target, this.link.side, this.nearestSide(this.nodePos(target), wpt));
      }
      this.cancelTransient();
      return;
    }
    if (this.drag) {
      if (this.drag.moved) this.cb.changed?.();
      this.drag = null;
      return;
    }
    if (this.pan) {
      if (!this.pan.moved) this.select(null);
      this.pan = null;
    }
  }

  // ---------- deletion ----------

  deleteSelection() {
    const m = this.model;
    if (!m || !this.sel) return false;
    this.cb.history?.();
    if (this.sel.type === 'node') {
      const id = this.sel.id;
      m.nodes = m.nodes.filter(n => n.id !== id);
      m.edges = m.edges.filter(x => x.source !== id && x.target !== id);
    } else if (this.sel.type === 'edge') {
      m.edges = m.edges.filter(x => x.id !== this.sel.id);
    } else if (this.sel.type === 'sub') {
      const sid = this.sel.id;
      m.subgraphs = m.subgraphs.filter(s => s.id !== sid);
      for (const n of m.nodes) if (n.parent === sid) n.parent = null;
    } else {
      return false;
    }
    this.sel = null;
    this.render();
    this.cb.changed?.();
    this.cb.select?.(null);
    return true;
  }

  // Cycle the anchor side of the selected edge: bottom→top / left↔right etc.
  // Rotates through the 16 (s,t) combinations so any orientation is reachable.
  cycleEdgeSide() {
    const m = this.model;
    if (!m || this.sel?.type !== 'edge') return false;
    const e = m.edges.find(x => x.id === this.sel.id);
    if (!e) return false;
    if (e.srcFloat || e.dstFloat) return false; // loose ends have no fixed anchor
    const SIDES = SIDE_LIST;
    const s = SIDES.includes(e.s) ? SIDES.indexOf(e.s) : 1; // default bottom
    const t = SIDES.includes(e.t) ? SIDES.indexOf(e.t) : 3; // default top
    if (t < 3) e.t = SIDES[t + 1];
    else { e.t = SIDES[0]; e.s = SIDES[(s + 1) % 4]; }
    this.render();
    return true;
  }

  // ---------- auto layout (Sugiyama-lite) ----------

  autoLayout() {
    const m = this.model;
    const N = m.nodes.length;
    if (!N) return;
    if (this.sizes.size !== N) for (const n of m.nodes) this.sizes.set(n.id, nodeSize(n));
    const idx = new Map(m.nodes.map((n, i) => [n.id, i]));
    // a fresh layout re-combes the routes: drop hand-picked anchor sides
    for (const e of m.edges) { delete e.s; delete e.t; }
    const out = Array.from({ length: N }, () => []);
    const inn = Array.from({ length: N }, () => []);
    for (const e of m.edges) {
      const s = idx.get(e.source), t = idx.get(e.target);
      if (s == null || t == null || s === t) continue;
      out[s].push(t);
      inn[t].push(s);
    }
    // strip back edges via DFS so layering terminates
    const state = new Array(N).fill(0);
    const dag = Array.from({ length: N }, () => []);
    const dagIn = Array.from({ length: N }, () => []);
    const dfs = u => {
      state[u] = 1;
      for (const v of out[u]) {
        if (state[v] === 1) continue; // back edge
        dag[u].push(v);
        dagIn[v].push(u);
        if (state[v] === 0) dfs(v);
      }
      state[u] = 2;
    };
    for (let i = 0; i < N; i++) if (!state[i]) dfs(i);
    // longest-path layering in topological order
    const indeg = dagIn.map(l => l.length);
    const q = [];
    for (let i = 0; i < N; i++) if (!indeg[i]) q.push(i);
    const topo = [];
    while (q.length) {
      const u = q.shift();
      topo.push(u);
      for (const v of dag[u]) if (--indeg[v] === 0) q.push(v);
    }
    const done = new Set(topo);
    for (let i = 0; i < N; i++) if (!done.has(i)) topo.push(i);
    const layer = new Array(N).fill(0);
    for (const u of topo) for (const v of dag[u]) layer[v] = Math.max(layer[v], layer[u] + 1);
    const L = Math.max(...layer) + 1;
    const rows = Array.from({ length: L }, () => []);
    topo.forEach(u => rows[layer[u]].push(u));
    // barycenter ordering sweeps
    const posOf = new Map();
    rows.forEach((r, li) => r.forEach((u, i) => posOf.set(u, i)));
    const bary = (u, useSucc) => {
      const ns = useSucc ? dag[u] : dagIn[u];
      if (!ns.length) return posOf.get(u) ?? 0;
      return ns.reduce((s, v) => s + (posOf.get(v) ?? 0), 0) / ns.length;
    };
    for (let it = 0; it < 6; it++) {
      const useSucc = it % 2 === 0; // alternate pred/succ barycenters
      for (let li = 0; li < L; li++) {
        rows[li].sort((a, b) => bary(a, useSucc) - bary(b, useSucc) || a - b);
        rows[li].forEach((u, i) => posOf.set(u, i));
      }
    }
    // coordinates
    const TD = m.direction !== 'LR';
    const pitch = TD ? 170 : 230;
    const withinGap = TD ? 60 : 70;
    rows.forEach((r, li) => {
      let cursor = 40;
      const alongStart = 40 + li * pitch;
      for (const u of r) {
        const n = m.nodes[u];
        const s = this.sizes.get(n.id);
        const c = cursor;
        cursor += (TD ? s.w : s.h) + withinGap;
        const cx = TD ? c + s.w / 2 : alongStart + s.w / 2;
        const cy = TD ? alongStart + s.h / 2 : c + s.h / 2;
        n.x = Math.round(cx - s.w / 2);
        n.y = Math.round(cy - s.h / 2);
      }
    });
  }

  // ---------- export ----------

  exportSvgString() {
    const clone = this.svg.cloneNode(true);
    clone.removeAttribute('id');
    const root = clone.querySelector('#viewport');
    root?.removeAttribute('transform');
    clone.querySelectorAll('.port, .ehit, .epath.temp, .linkbadge').forEach(x => x.remove());
    clone.setAttribute('xmlns', NS);
    const bb = this.contentBBox(50);
    clone.setAttribute('viewBox', `${bb.x} ${bb.y} ${Math.max(bb.w, 10)} ${Math.max(bb.h, 10)}`);
    clone.setAttribute('width', Math.round(Math.max(bb.w, 10)));
    clone.setAttribute('height', Math.round(Math.max(bb.h, 10)));
    const style = document.createElementNS(NS, 'style');
    style.textContent = EXPORT_CSS;
    clone.insertBefore(style, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }
}
