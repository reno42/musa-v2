// GraphForge — markdown <-> graph model bridge.
// Format: standard markdown with one ```mermaid fence; node positions persist
// as `%% @pos <id> <x> <y>` comments and drill-down navigation as
// `%% @link <id> <graph-name>` comments inside the fence (GitHub-compatible).
// The mermaid block is the single source of truth for the graph structure.

const ID_RE = /^[A-Za-z0-9_]{1,40}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SHAPE_LIST = ['rect', 'round', 'diamond', 'circle'];
const SIDE_LIST = ['top', 'bottom', 'left', 'right'];

export function contentHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function escLabel(s) {
  return String(s ?? '').replace(/"/g, "'").replace(/\r?\n/g, '<br/>').trim();
}

function slugId(s) {
  return String(s).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'sg';
}

const NODE_TOKEN = /^([A-Za-z0-9_]+)\s*(?:\(\((.+?)\)\)|\[(.+?)\]|\{(.+?)\}|\((.+?)\))?\s*$/;

function parseNodeToken(tok) {
  const m = NODE_TOKEN.exec(tok.trim());
  if (!m) return null;
  let shape = 'rect';
  let label = '';
  let explicit = false;
  if (m[2] !== undefined) { shape = 'circle'; label = m[2]; explicit = true; }
  else if (m[3] !== undefined) { shape = 'rect'; label = m[3]; explicit = true; }
  else if (m[4] !== undefined) { shape = 'diamond'; label = m[4]; explicit = true; }
  else if (m[5] !== undefined) { shape = 'round'; label = m[5]; explicit = true; }
  return { id: m[1], shape, label: escLabel(label), explicit };
}

export function parseGraphMd(md, name) {
  const model = { name, title: name, direction: 'TD', nodes: [], edges: [], subgraphs: [] };
  const byId = new Map();
  const posOnly = new Set(); // nodes created by @pos before their real definition
  const ensure = (id, shape, label, parent, fromPos = false) => {
    let n = byId.get(id);
    if (!n) {
      n = { id, label: '', shape: 'rect', parent: parent || null, x: null, y: null };
      byId.set(id, n);
      model.nodes.push(n);
      if (fromPos) posOnly.add(id);
    }
    return n;
  };
  const claim = (n, parent) => {
    // first real statement sighting fixes subgraph membership (mermaid semantics)
    if (posOnly.has(n.id)) {
      posOnly.delete(n.id);
      n.parent = parent;
    }
    return n;
  };
  const titleM = md.match(/^\s*#\s+(.+)$/m);
  if (titleM) model.title = titleM[1].trim();
  const fence = md.match(/```mermaid\s*\n([\s\S]*?)```/);
  if (!fence) return model;
  const stack = [];
  let edgeSeq = 0;
  const sidesMap = new Map(); // `%% @sides src tgt s t` — user-chosen anchors
  const pinsMap = new Map(); // `%% @pin src tgt S|T x y` — pinned endpoints
  const lanesMap = new Map(); // `%% @lane src tgt x|y v` — dragged middle lanes
  const pends = new Map();   // `%% @pend phId S|T x y` — disconnected arrow endpoints
  for (const line of fence[1].split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('%%')) {
      const pm = /^%%\s*@pos\s+([A-Za-z0-9_]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(raw);
      if (pm) {
        const n = ensure(pm[1], 'rect', '', stack[stack.length - 1] || null, true);
        n.x = parseFloat(pm[2]);
        n.y = parseFloat(pm[3]);
        continue;
      }
      const lm = /^%%\s*@link\s+([A-Za-z0-9_]+)\s+(\S+)/.exec(raw);
      if (lm) {
        // Same contract as @pos: metadata must never freeze subgraph membership.
        const n = ensure(lm[1], 'rect', '', stack[stack.length - 1] || null, true);
        if (NAME_RE.test(lm[2])) n.link = lm[2];
      }
      const sm = /^%%\s*@sides\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s+(top|bottom|left|right)\s+(top|bottom|left|right)/.exec(raw);
      if (sm) sidesMap.set(`${sm[1]}>${sm[2]}`, { s: sm[3], t: sm[4] });
      // `%% @pin src T|S x y` — pinned endpoint: the edge attaches at the exact
      // saved point instead of the port middle (the line bends, the anchor stays).
      const pm2 = /^%%\s*@pin\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s+([ST])\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(raw);
      if (pm2) pinsMap.set(`${pm2[1]}>${pm2[2]}`, { ...(pinsMap.get(`${pm2[1]}>${pm2[2]}`) || {}), [pm2[3] === 'S' ? 's' : 't']: { x: parseFloat(pm2[4]), y: parseFloat(pm2[5]) } });
      // `%% @lane src tgt x|y <v>` — user-dragged middle lane for edge ordering
      const lm2 = /^%%\s*@lane\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s+([xy])\s+(-?[\d.]+)/.exec(raw);
      if (lm2) lanesMap.set(`${lm2[1]}>${lm2[2]}`, { axis: lm2[3], v: parseFloat(lm2[4]) });
      // `%% @pend <placeholderId> S|T <x> <y>` marks a disconnected arrow end:
      // the placeholder node it names becomes a free-floating point.
      const dm = /^%%\s*@pend\s+([A-Za-z0-9_]+)\s+([ST])\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(raw);
      if (dm) pends.set(dm[1], { side: dm[2], x: parseFloat(dm[3]), y: parseFloat(dm[4]) });
      continue;
    }
    let m;
    if ((m = /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i.exec(raw))) {
      model.direction = /LR/i.test(m[2]) ? 'LR' : 'TD';
      continue;
    }
    if (/^(classDef|class|style|linkStyle|direction|click|href)\b/.test(raw)) continue;
    if ((m = /^subgraph\s+(.+)$/.exec(raw))) {
      const rest = m[1].trim();
      let id, title;
      const named = /^([A-Za-z0-9_]+)\s*(?:\["([^"]*)"\])?$/.exec(rest);
      const quoted = /^"([^"]*)"$/.exec(rest);
      if (named) { id = named[1]; title = named[2] || named[1]; }
      else if (quoted) { id = slugId('sg_' + quoted[1]); title = quoted[1]; }
      else { id = slugId(rest); title = rest; }
      if (!model.subgraphs.some(s => s.id === id)) model.subgraphs.push({ id, title });
      stack.push(id);
      continue;
    }
    if (/^end\b/.test(raw)) { stack.pop(); continue; }
    const parent = stack[stack.length - 1] || null;
    // Normalise labelled arrow forms into `-->|label|` / `-.->|label|`.
    const s = raw.replace(/--\s+(.+?)\s+-->/g, '-->|$1|').replace(/-\.\s+(.+?)\s+\.->/g, '-.->|$1|');
    const parts = s.split(/(-\.->\|[^|]*\||-->\|[^|]*\||-\.->|-->|---|--)/);
    if (parts.length === 1) {
      const nt = parseNodeToken(s);
      if (nt) {
        const n = claim(ensure(nt.id, nt.shape, '', parent), parent);
        if (nt.explicit) {
          n.shape = nt.shape;
          if (nt.label) n.label = nt.label;
        }
      }
      continue;
    }
    const items = [];
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      const op = /^(-\.->)(?:\|([^|]*)\|)?$/.exec(t) || /^(-->)(?:\|([^|]*)\|)?$/.exec(t) || /^(---|--)$/.exec(t);
      if (op) items.push({ op: op[1], label: op[2] || '' });
      else {
        const nt = parseNodeToken(t);
        items.push(nt ? { node: nt } : { bad: true });
      }
    }
    let prev = null; // { nodeId, op, label }
    for (const it of items) {
      if (it.node) {
        const n = claim(ensure(it.node.id, it.node.shape, '', parent), parent);
        // a bare reference must never downgrade an explicitly declared shape
        if (it.node.explicit) {
          n.shape = it.node.shape;
          if (it.node.label) n.label = it.node.label;
        }
        if (prev && prev.op) {
          model.edges.push({
            id: 'e' + (++edgeSeq),
            source: prev.nodeId,
            target: n.id,
            label: prev.label,
            dashed: prev.op === '-.->',
          });
        }
        prev = { nodeId: n.id, op: null, label: '' };
      } else if (it.op && prev) {
        prev.op = it.op;
        prev.label = it.label;
      }
    }
  }
  // Hand-chosen anchor sides attach to the first edge matching the pair;
  // keyed by endpoints (not edge ids) so hand-edits cannot shift them.
  for (const e of model.edges) {
    const key = `${e.source}>${e.target}`;
    const sd = sidesMap.get(key);
    if (sd) {
      e.s = sd.s;
      e.t = sd.t;
      sidesMap.delete(key);
    }
    const pin = pinsMap.get(key);
    if (pin) {
      if (pin.s) e.srcPin = pin.s;
      if (pin.t) e.dstPin = pin.t;
      pinsMap.delete(key);
    }
    const lane = lanesMap.get(key);
    if (lane) {
      e.lane = lane;
      lanesMap.delete(key);
    }
  }
  // Disconnected arrow ends: a placeholder node whose id appears in `@pend`
  // becomes a floating point — the edge keeps its other real endpoint, loses
  // the placeholder from the node list, and remembers where the free end sits.
  const phIds = new Set();
  for (const id of pends.keys()) {
    const ph = byId.get(id);
    if (ph && !model.edges.some(x => x.source === id && x.target === id)) phIds.add(id);
  }
  for (const e of model.edges) {
    if (phIds.has(e.source)) {
      const p = pends.get(e.source);
      e.srcFloat = { x: p.x, y: p.y };
      e.s = e.s || 'right';
    }
    if (phIds.has(e.target)) {
      const p = pends.get(e.target);
      e.dstFloat = { x: p.x, y: p.y };
      e.t = e.t || 'left';
    }
  }
  // Pins (@srcPin/@dstPin from the UI) ride through sanitizeModel; loose
  // placeholders never become real nodes.
  if (phIds.size) model.nodes = model.nodes.filter(n => !phIds.has(n.id));
  return model;
}

function nodeDef(n) {
  const label = escLabel(n.label) || n.id;
  switch (n.shape) {
    case 'round': return `${n.id}(${label})`;
    case 'diamond': return `${n.id}{${label}}`;
    case 'circle': return `${n.id}((${label}))`;
    default: return `${n.id}[${label}]`;
  }
}

export function serializeGraphMd(model) {
  const out = [];
  out.push(`# ${model.title || model.name}`);
  out.push('');
  out.push('<!-- GraphForge live mirror. This mermaid block is the single source of truth.');
  out.push('     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->');
  out.push('');
  out.push('```mermaid');
  out.push(`flowchart ${model.direction === 'LR' ? 'LR' : 'TD'}`);
  const known = new Set(model.nodes.map(n => n.id));
  for (const sg of model.subgraphs || []) {
    const members = model.nodes.filter(n => n.parent === sg.id);
    out.push(`    subgraph ${sg.id}["${escLabel(sg.title)}"]`);
    for (const n of members) out.push('        ' + nodeDef(n));
    out.push('    end');
  }
  for (const n of model.nodes) {
    const inSg = n.parent && (model.subgraphs || []).some(s => s.id === n.parent);
    if (!inSg) out.push('    ' + nodeDef(n));
  }
  for (const e of model.edges || []) {
    if (!known.has(e.source) && !e.srcFloat) { out.push(`    ${e.source}[${e.source}]`); known.add(e.source); }
    if (!known.has(e.target) && !e.dstFloat) { out.push(`    ${e.target}[${e.target}]`); known.add(e.target); }
  }
  // Disconnected arrow ends: each floating endpoint re-materializes as a tiny
  // placeholder node (GF_FLOAT_*), never shown as a real node by the editor.
  const floatMeta = [];
  for (const e of model.edges || []) {
    if (e.srcFloat && Number.isFinite(e.srcFloat.x)) {
      const pid = 'GF_FLOAT_S_' + e.id;
      out.push(`    ${pid}((${pid}))`);
      known.add(pid);
      e.srcFloat.ph = pid;
      if (SIDE_LIST.includes(e.s)) floatMeta.push(`    %% @sides ${e.source} ${e.target} ${e.s} ${SIDE_LIST.includes(e.t) ? e.t : 'left'}`);
    }
    if (e.dstFloat && Number.isFinite(e.dstFloat.x)) {
      const pid = 'GF_FLOAT_T_' + e.id;
      out.push(`    ${pid}((${pid}))`);
      known.add(pid);
      e.dstFloat.ph = pid;
    }
  }
  if ((model.edges || []).length) out.push('');
  for (const e of model.edges || []) {
    // a disconnected end is written as an arrow into/out of its placeholder,
    // exactly the shape the parser expects to find on reload
    const src = e.srcFloat?.ph || e.source;
    const tgt = e.dstFloat?.ph || e.target;
    const lbl = e.label ? `|${escLabel(String(e.label).replace(/\|/g, '/'))}|` : '';
    const op = e.dashed ? `-.->${lbl}` : `-->${lbl}`;
    out.push(`    ${src} ${op} ${tgt}`);
  }
  // Metadata goes last: membership is decided by definition order, so @pos /
  // @link / @sides comments must never introduce or alter real statements.
  const meta = model.nodes
    .filter(n => Number.isFinite(n.x) && Number.isFinite(n.y))
    .map(n => `    %% @pos ${n.id} ${Math.round(n.x)} ${Math.round(n.y)}`);
  for (const n of model.nodes) {
    if (n.link && NAME_RE.test(String(n.link))) meta.push(`    %% @link ${n.id} ${n.link}`);
  }
  for (const e of model.edges || []) {
    if (e.lane && (e.lane.axis === 'x' || e.lane.axis === 'y') && Number.isFinite(+e.lane.v)) meta.push(`    %% @lane ${e.source} ${e.target} ${e.lane.axis} ${Math.round(+e.lane.v)}`);
    if (e.srcPin && Number.isFinite(e.srcPin.x)) meta.push(`    %% @pin ${e.source} ${e.target} S ${Math.round(e.srcPin.x)} ${Math.round(e.srcPin.y)}`);
    if (e.dstPin && Number.isFinite(e.dstPin.x)) meta.push(`    %% @pin ${e.source} ${e.target} T ${Math.round(e.dstPin.x)} ${Math.round(e.dstPin.y)}`);
    if (e.srcFloat && e.srcFloat.ph && Number.isFinite(e.srcFloat.x)) meta.push(`    %% @pos ${e.srcFloat.ph} ${Math.round(e.srcFloat.x)} ${Math.round(e.srcFloat.y)}`, `    %% @pend ${e.srcFloat.ph} S ${Math.round(e.srcFloat.x)} ${Math.round(e.srcFloat.y)}`);
    if (e.dstFloat && e.dstFloat.ph && Number.isFinite(e.dstFloat.x)) meta.push(`    %% @pos ${e.dstFloat.ph} ${Math.round(e.dstFloat.x)} ${Math.round(e.dstFloat.y)}`, `    %% @pend ${e.dstFloat.ph} T ${Math.round(e.dstFloat.x)} ${Math.round(e.dstFloat.y)}`);
    if (SIDE_LIST.includes(e.s) && SIDE_LIST.includes(e.t) && !e.srcFloat && !e.dstFloat) meta.push(`    %% @sides ${e.source} ${e.target} ${e.s} ${e.t}`);
  }
  if (meta.length) {
    out.push('');
    out.push(...meta);
  }
  out.push('```');
  out.push('');
  return out.join('\n');
}

export function sanitizeModel(input, name) {
  const m = {
    name,
    title: String(input?.title || name).slice(0, 120),
    direction: input?.direction === 'LR' ? 'LR' : 'TD',
    nodes: [],
    edges: [],
    subgraphs: [],
  };
  const sgIds = new Set();
  for (const sg of Array.isArray(input?.subgraphs) ? input.subgraphs : []) {
    if (!sg || !ID_RE.test(String(sg.id || '')) || sgIds.has(String(sg.id))) continue;
    sgIds.add(String(sg.id));
    m.subgraphs.push({ id: String(sg.id), title: String(sg.title ?? sg.id).slice(0, 120) });
  }
  const ids = new Set();
  for (const n of Array.isArray(input?.nodes) ? input.nodes : []) {
    if (!n || !ID_RE.test(String(n.id || '')) || ids.has(String(n.id))) continue;
    const id = String(n.id);
    ids.add(id);
    m.nodes.push({
      id,
      label: String(n.label ?? '').slice(0, 300),
      shape: SHAPE_LIST.includes(n.shape) ? n.shape : 'rect',
      parent: n.parent != null && sgIds.has(n.parent) ? n.parent : null,
      x: n.x != null && Number.isFinite(+n.x) ? Math.round(+n.x) : null,
      y: n.y != null && Number.isFinite(+n.y) ? Math.round(+n.y) : null,
      link: n.link != null && NAME_RE.test(String(n.link)) ? String(n.link) : undefined,
    });
  }
  const seen = new Set();
  for (const e of Array.isArray(input?.edges) ? input.edges : []) {
    if (!e) continue;
    const source = String(e.source || '');
    const target = String(e.target || '');
    // A disconnected end keeps the edge alive even though its placeholder id
    // is not (and must never be) a real node in m.nodes — validated below.
    const srcFloat = e.srcFloat && Number.isFinite(+e.srcFloat.x) && Number.isFinite(+e.srcFloat.y)
      ? { x: Math.round(+e.srcFloat.x), y: Math.round(+e.srcFloat.y) } : null;
    const dstFloat = e.dstFloat && Number.isFinite(+e.dstFloat.x) && Number.isFinite(+e.dstFloat.y)
      ? { x: Math.round(+e.dstFloat.x), y: Math.round(+e.dstFloat.y) } : null;
    const srcPin = e.srcPin && Number.isFinite(+e.srcPin.x) && Number.isFinite(+e.srcPin.y)
      ? { x: Math.round(+e.srcPin.x), y: Math.round(+e.srcPin.y) } : null;
    const dstPin = e.dstPin && Number.isFinite(+e.dstPin.x) && Number.isFinite(+e.dstPin.y)
      ? { x: Math.round(+e.dstPin.x), y: Math.round(+e.dstPin.y) } : null;
    const lane = e.lane && (e.lane.axis === 'x' || e.lane.axis === 'y') && Number.isFinite(+e.lane.v)
      ? { axis: e.lane.axis, v: Math.round(+e.lane.v) } : null;
    const srcOk = ids.has(source) || (srcFloat && source.startsWith('GF_FLOAT_S_'));
    const tgtOk = ids.has(target) || (dstFloat && target.startsWith('GF_FLOAT_T_'));
    if (!srcOk || !tgtOk) continue;
    if (source === target) continue;
    const label = String(e.label ?? '').slice(0, 200).replace(/\|/g, '/');
    const dashed = !!e.dashed;
    // float coords go in the dedupe key: two parallel arrows between the same
    // nodes are different edges when one end hangs loose
    const fk = srcFloat ? `~${srcFloat.x},${srcFloat.y}` : '';
    const tk = dstFloat ? `~${dstFloat.x},${dstFloat.y}` : '';
    const key = `${source}\u0000${target}\u0000${label}\u0000${dashed ? 1 : 0}${fk}${tk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const eid = String(e.id || 'e' + m.edges.length).replace(/[^\w]/g, '').slice(0, 40) || 'e' + m.edges.length;
    m.edges.push({
      id: eid,
      source,
      target,
      label,
      dashed,
      s: srcFloat ? 'right' : (SIDE_LIST.includes(e.s) ? e.s : undefined),
      t: dstFloat ? 'left' : (SIDE_LIST.includes(e.t) ? e.t : undefined),
      srcFloat,
      dstFloat,
      srcPin,
      dstPin,
      lane,
    });
  }
  return m;
}
