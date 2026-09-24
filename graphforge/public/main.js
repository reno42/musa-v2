// GraphForge app wiring: state, API, SSE live mirror, inspector, toolbar, history.

import { GraphEditor } from './editor.js';

const $ = s => document.querySelector(s);
const svg = $('#canvas');

const state = {
  name: null,
  model: null,
  hash: '',
  suppress: '',
  history: [],
  saveTimer: null,
  dirty: false,
};

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}

function toast(msg, type = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (type === 'err' ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 2600);
}

function setStatus(txt) { $('#saveState').textContent = txt; }

function updateStatusBar() {
  if (!state.model) return;
  $('#statusbar').textContent =
    `graphs/${state.name}.md  ·  ${state.model.nodes.length} nodes · ${state.model.edges.length} edges · hash ${state.hash || '—'}  ·  this .md file is the live mirror`;
}

// ---------- history ----------

function pushHistory() {
  if (!state.model) return;
  state.history.push(JSON.stringify(state.model));
  if (state.history.length > 60) state.history.shift();
  $('#btnUndo').disabled = false;
}

function undo() {
  if (!state.history.length) return;
  flushSave();
  state.model = JSON.parse(state.history.pop());
  editor.setModel(state.model);
  editor.render();
  renderInspector();
  scheduleSave();
  $('#btnUndo').disabled = !state.history.length;
}

// ---------- save / load ----------

function scheduleSave() {
  if (!state.model) return;
  setStatus('saving…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => flushSave().catch(console.error), 350);
}

async function flushSave() {
  if (!state.model) return;
  clearTimeout(state.saveTimer);
  const model = state.model;
  try {
    const r = await api(`/api/graph?name=${encodeURIComponent(state.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model),
    });
    if (state.model === model) {
      state.suppress = r.hash;
      state.hash = r.hash;
      state.dirty = false;
      setStatus('synced ' + new Date().toLocaleTimeString());
      updateStatusBar();
    }
  } catch (e) {
    setStatus('SAVE FAILED');
    toast('Save failed: ' + e.message, 'err');
  }
}

async function loadList() {
  const { graphs } = await api('/api/graphs');
  const list = $('#graphList');
  list.innerHTML = '';
  for (const g of graphs) {
    const row = document.createElement('div');
    row.className = 'gitemrow';
    const b = document.createElement('button');
    b.className = 'gitem' + (g.name === state.name ? ' active' : '');
    b.textContent = g.name;
    b.dataset.name = g.name;
    b.title = g.name + '.md';
    b.onclick = () => openGraph(g.name);
    const del = document.createElement('button');
    del.className = 'gdel';
    del.textContent = '\u00d7';
    del.title = 'Delete ' + g.name + '.md (moves to graphs/.trash)';
    del.onclick = ev => { ev.stopPropagation(); deleteGraph(g.name); };
    row.append(b, del);
    list.appendChild(row);
  }
  return graphs;
}

async function openGraph(name) {
  await flushSave();
  const { model, hash } = await api(`/api/graph?name=${encodeURIComponent(name)}`);
  state.name = name;
  state.model = model;
  state.hash = hash;
  state.suppress = hash;
  state.history = [];
  $('#btnUndo').disabled = true;
  editor.setModel(model);
  if (model.nodes.some(n => !Number.isFinite(n.x))) {
    editor.autoLayout();
    scheduleSave();
  }
  editor.render();
  editor.fitView();
  renderInspector();
  updateStatusBar();
  localStorage.setItem('gf.last', name);
  document.querySelectorAll('.gitem').forEach(x => x.classList.toggle('active', x.dataset.name === name));
}

async function deleteGraph(name) {
  if (!confirm(`Delete graph "${name}.md"?\nIt moves to graphs/.trash/ so you can recover it.`)) return;
  try {
    const wasOpen = state.name === name;
    if (wasOpen) resetEditorState(); // clear before any flushSave could recreate it
    await api(`/api/graph?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadList();
    if (!state.name) await openFirstOrEmpty();
    toast(`Deleted ${name}.md (recoverable in graphs/.trash)`);
  } catch (e) {
    toast('Delete failed: ' + e.message, 'err');
  }
}

function resetEditorState() {
  clearTimeout(state.saveTimer);
  state.name = null;
  state.model = null;
  state.hash = '';
  state.suppress = '';
  state.history = [];
  state.saveTimer = null;
  editor.setModel(null);
  editor.render();
  $('#inspector').classList.remove('has');
  $('#statusbar').textContent = '';
  setStatus('');
}

async function openFirstOrEmpty() {
  const { graphs } = await api('/api/graphs');
  if (graphs.length) await openGraph(graphs[0].name);
  else showEmptyInspector();
}

function showEmptyInspector() {
  const box = $('#inspector');
  box.innerHTML = '';
  box.classList.add('has');
  head(box, 'GraphForge');
  const tips = document.createElement('div');
  tips.className = 'itips';
  tips.textContent = 'Create your first graph with the form in the sidebar.';
  box.appendChild(tips);
}

function applyRemote(model, hash) {
  // Never yank the caret: skip when content is identical (self-echo) or
  // while the user is typing in the inspector. Hashes still advance so the
  // next real change applies once the edit session ends.
  const typing = document.activeElement && $('#inspector').contains(document.activeElement);
  const unchanged = state.model && JSON.stringify(model) === JSON.stringify(state.model);
  state.hash = hash;
  state.suppress = hash;
  if (unchanged || typing) return false;
  state.model = model;
  editor.setModel(model);
  editor.render();
  renderInspector();
  updateStatusBar();
  return true;
}

// ---------- editor ----------

function addNodeAt(pt) {
  if (!state.model) return;
  pushHistory();
  let i = 1;
  while (state.model.nodes.some(n => n.id === 'n' + i)) i++;
  const id = 'n' + i;
  state.model.nodes.push({
    id, label: 'New step', shape: $('#newShape')?.value || 'rect', parent: null,
    x: Math.round(pt.x - 60), y: Math.round(pt.y - 18),
  });
  editor.render();
  editor.select({ type: 'node', id });
  scheduleSave();
  focusLabelInput();
}

function addEdge(from, to, fromSide, toSide) {
  if (!state.model) return;
  if (state.model.edges.some(e => e.source === from && e.target === to && !e.label)) {
    toast('Edge already exists');
    return;
  }
  pushHistory();
  const SIDES = ['top', 'bottom', 'left', 'right'];
  state.model.edges.push({
    id: 'e' + Date.now().toString(36), source: from, target: to, label: '', dashed: false,
    s: SIDES.includes(fromSide) ? fromSide : undefined, // the vertex you pulled from
    t: SIDES.includes(toSide) ? toSide : undefined,     // the vertex you dropped near
  });
  editor.render();
  scheduleSave();
}

function focusLabelInput() {
  const ta = $('#inspector textarea');
  if (ta) { ta.focus(); ta.select(); }
}

// nearest real node to a loose endpoint (for the one-click reconnect button)
function closestNode(pt, excludeId) {
  let best = null, bd = Infinity;
  for (const n of state.model.nodes) {
    if (n.id === excludeId) continue;
    const d = Math.hypot(n.x - pt.x, n.y - pt.y);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

const editor = new GraphEditor(svg, {
  history: pushHistory,
  changed: scheduleSave,
  select: sel => renderInspector(sel),
  addNode: pt => addNodeAt(pt),
  link: (from, to, fromSide, toSide) => addEdge(from, to, fromSide, toSide),
  labelLive: (id, labelHtml) => {
    state.dirty = true;
    const ta = $('#inspector textarea');
    // keep the inspector in sync while typing on the canvas (never while it owns the caret)
    if (ta && document.activeElement !== ta) ta.value = (labelHtml || '').replace(/<br\/>/g, '\n');
  },
  labelDone: () => renderInspector(),
  activate: () => focusLabelInput(),
  openLink: name => {
    if (!state.model) return;
    toast('Opening drill-down → ' + name);
    openGraph(name).catch(e => toast('Graph not found: ' + name, 'err'));
  },
  edgeChanged: () => scheduleSave(),
  edgeDetached: (ed, end) => {
    toast(end === 'src' ? 'Flecha desconectada del origen — arrástrala o suéltala' : 'Flecha desconectada del destino — arrástrala o suéltala');
    scheduleSave();
  },
  viewChange: k => { $('#zoomLabel').textContent = Math.round(k * 100) + '%'; },
});

// ---------- inspector ----------

function head(box, text) {
  const h = document.createElement('div');
  h.className = 'ihead';
  h.textContent = text;
  box.appendChild(h);
}

function field(box, label, inputEl) {
  const w = document.createElement('label');
  w.className = 'ifield';
  const s = document.createElement('span');
  s.textContent = label;
  w.append(s, inputEl);
  box.appendChild(w);
  return inputEl;
}

function btn(box, text, onclick) {
  const b = document.createElement('button');
  b.className = 'ibtn';
  b.textContent = text;
  b.onclick = onclick;
  box.appendChild(b);
  return b;
}

function beginEdit(input) {
  if (!input._d) { pushHistory(); input._d = true; }
}

function renderInspector(sel) {
  sel = sel || editor.getSelection();
  const box = $('#inspector');
  box.innerHTML = '';
  if (!state.model) return;
  box.classList.add('has');

  if (sel && sel.type === 'node') {
    const n = state.model.nodes.find(x => x.id === sel.id);
    if (!n) return renderInspector(null);
    head(box, 'Node — ' + n.id);
    const label = document.createElement('textarea');
    label.rows = 3;
    label.value = (n.label || '').replace(/<br\/>/g, '\n');
    const commitLabel = () => { editor.render(); flushSave(); };
    label.addEventListener('input', () => {
      beginEdit(label);
      n.label = label.value.replace(/\n/g, '<br/>').slice(0, 300);
      state.dirty = true;
      editor.render();
    });
    label.addEventListener('keydown', ev => {
      // Enter commits and syncs; Shift+Enter inserts a newline in-node.
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitLabel(); }
    });
    field(box, 'Label (Shift+Enter = new line, Enter = sync)', label);
    btn(box, 'Sync label (Enter)', commitLabel);
    const shape = document.createElement('select');
    const SHAPES = { rect: 'Process  [rect]', round: 'Terminal  (round)', diamond: 'Decision  {diamond}', circle: 'Connector  ((circle))' };
    for (const [v, t] of Object.entries(SHAPES)) {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if (n.shape === v) o.selected = true;
      shape.appendChild(o);
    }
    shape.addEventListener('change', () => { pushHistory(); n.shape = shape.value; editor.render(); scheduleSave(); });
    field(box, 'Shape', shape);
    const parent = document.createElement('select');
    [['', '— none —'], ...state.model.subgraphs.map(s => [s.id, s.title])].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if ((n.parent || '') === v) o.selected = true;
      parent.appendChild(o);
    });
    parent.addEventListener('change', () => { pushHistory(); n.parent = parent.value || null; editor.render(); scheduleSave(); });
    field(box, 'Subgraph', parent);
    const link = document.createElement('input');
    link.value = n.link || '';
    link.placeholder = 'graph-name (drill-down)';
    link.addEventListener('change', () => {
      pushHistory();
      const v = link.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      link.value = v;
      if (v) n.link = v; else delete n.link;
      editor.render();
      scheduleSave();
    });
    field(box, 'Drill-down → graph (@link)', link);
    if (n.link) btn(box, 'Open ' + n.link + ' →', () => editor.cb.openLink(n.link));
    btn(box, 'Delete node', () => { editor.deleteSelection(); focusCanvas(); });
  } else if (sel && sel.type === 'edge') {
    const e = state.model.edges.find(x => x.id === sel.id);
    if (!e) return renderInspector(null);
    head(box, 'Edge — ' + e.source + ' → ' + e.target);
    const label = document.createElement('input');
    label.value = e.label || '';
    label.addEventListener('input', () => {
      beginEdit(label);
      e.label = label.value;
      state.dirty = true;
      editor.render();
    });
    label.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); flushSave(); }
    });
    field(box, 'Label (Enter = sync)', label);
    const wrap = document.createElement('label');
    wrap.className = 'icheck';
    const dash = document.createElement('input');
    dash.type = 'checkbox';
    dash.checked = !!e.dashed;
    dash.addEventListener('change', () => { pushHistory(); e.dashed = dash.checked; editor.render(); scheduleSave(); });
    wrap.append(dash, document.createTextNode('Dashed line'));
    box.appendChild(wrap);
    if (e.srcFloat || e.dstFloat) {
      const tips = document.createElement('div');
      tips.className = 'itips';
      tips.textContent = (e.srcFloat ? 'Origen suelto ' : '') + (e.dstFloat ? 'Destino suelto ' : '') + '— arrastra el punto ○ para reconectar.';
      box.appendChild(tips);
      const re = document.createElement('button');
      re.className = 'ibtn';
      re.textContent = 'Reconectar extremo suelto al nodo más cercano';
      re.onclick = () => {
        pushHistory();
        if (e.srcFloat) { e.source = closestNode(e.srcFloat, e.target); e.s = undefined; delete e.srcFloat; }
        if (e.dstFloat) { e.target = closestNode(e.dstFloat, e.source); e.t = undefined; delete e.dstFloat; }
        editor.render();
        scheduleSave();
        renderInspector();
      };
      box.appendChild(re);
    } else {
      btn(box, '⇅ Cambiar orientación (R)', () => {
        pushHistory();
        editor.cycleEdgeSide();
        scheduleSave();
        renderInspector();
      });
    }
    btn(box, 'Delete edge', () => { editor.deleteSelection(); focusCanvas(); });
  } else if (sel && sel.type === 'sub') {
    const sg = state.model.subgraphs.find(x => x.id === sel.id);
    if (!sg) return renderInspector(null);
    head(box, 'Subgraph — ' + sg.id);
    const title = document.createElement('input');
    title.value = sg.title;
    title.addEventListener('input', () => {
      beginEdit(title);
      sg.title = title.value;
      editor.render();
      scheduleSave();
    });
    field(box, 'Title', title);
    btn(box, 'Ungroup (keep nodes)', () => { editor.deleteSelection(); focusCanvas(); });
  } else {
    head(box, 'Graph');
    const title = document.createElement('input');
    title.value = state.model.title;
    title.addEventListener('input', () => {
      beginEdit(title);
      state.model.title = title.value;
      scheduleSave();
    });
    field(box, 'Title', title);
    const dir = document.createElement('select');
    [['TD', 'Top down'], ['LR', 'Left to right']].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if (state.model.direction === v) o.selected = true;
      dir.appendChild(o);
    });
    dir.addEventListener('change', () => { pushHistory(); state.model.direction = dir.value; scheduleSave(); });
    field(box, 'Auto-layout direction', dir);
    const tips = document.createElement('div');
    tips.className = 'itips';
    tips.textContent = 'Double-click canvas: add node · Double-click a node: edit text · Drag a port dot: connect · Click an edge then R (or the button): rotate orientation · Press an edge and drag: pull its nearest end loose · Drop on a node: reconnects exactly where you drop (the line bends, the anchor stays) · Del: delete · Ctrl+Z: undo · Edit graphs/' + state.name + '.md — it syncs live.';
    box.appendChild(tips);
  }
}

function focusCanvas() { svg.focus?.(); }

// ---------- sidebar accordion ----------

const sbSidebar = document.getElementById('sidebar');
const sbContent = document.getElementById('sbContent');
$('#sbToggle').onclick = () => {
  sbSidebar.classList.toggle('collapsed');
  localStorage.setItem('gf.sb', sbSidebar.classList.contains('collapsed') ? '0' : '1');
};
if (localStorage.getItem('gf.sb') === '0') sbSidebar.classList.add('collapsed');

// ---------- toolbar ----------

$('#btnAddNode').onclick = () => addNodeAt(editor.centerWorld());
$('#btnAuto').onclick = () => {
  pushHistory();
  editor.autoLayout();
  editor.render();
  scheduleSave();
  toast('Auto-layout applied');
};
$('#btnFit').onclick = () => editor.fitView();
$('#btnZoomIn').onclick = () => editor.zoomBy(1.25);
$('#btnZoomOut').onclick = () => editor.zoomBy(0.8);
$('#btnUndo').onclick = undo;
$('#btnSvg').onclick = () => {
  const blob = new Blob([editor.exportSvgString()], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.name || 'graph') + '.svg';
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- markdown view / download ----------

async function openMarkdown() {
  if (!state.name) return;
  try {
    await flushSave(); // make sure the file on disk matches the canvas
    const r = await fetch(`/api/graph.md?name=${encodeURIComponent(state.name)}`);
    if (!r.ok) throw new Error(r.statusText);
    $('#mdTitle').textContent = state.name + '.md';
    $('#mdText').textContent = await r.text();
    $('#mdModal').hidden = false;
  } catch (e) {
    toast('Could not load markdown: ' + e.message, 'err');
  }
}

function closeMarkdown() { $('#mdModal').hidden = true; }

$('#btnMd').onclick = openMarkdown;
$('#mdClose').onclick = closeMarkdown;
$('#mdModal').addEventListener('click', e => { if (e.target === $('#mdModal')) closeMarkdown(); });
$('#mdCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#mdText').textContent);
    toast('Markdown copied to clipboard');
  } catch {
    toast('Clipboard blocked — select and copy manually', 'err');
  }
};
$('#mdDownload').onclick = () => {
  const blob = new Blob([$('#mdText').textContent], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = $('#mdTitle').textContent;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#newGraphForm').onsubmit = async ev => {
  ev.preventDefault();
  const raw = $('#newGraphName').value;
  const name = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!name) { toast('Invalid graph name', 'err'); return; }
  try {
    await api(`/api/graph?name=${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: raw.trim() || name, direction: 'TD', nodes: [], edges: [], subgraphs: [] }),
    });
    $('#newGraphName').value = '';
    await loadList();
    await openGraph(name);
  } catch (e) {
    toast(e.message, 'err');
  }
};

// ---------- keyboard ----------

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#mdModal').hidden) {
    closeMarkdown();
    return;
  }
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    flushSave();
    return;
  }
  if (typing) return;
  if (e.key.toLowerCase() === 'r' && editor.getSelection()?.type === 'edge') {
    e.preventDefault();
    pushHistory();
    editor.cycleEdgeSide();
    scheduleSave();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editor.getSelection()) {
      e.preventDefault();
      editor.deleteSelection();
    }
  }
});

window.addEventListener('beforeunload', () => {
  if (state.model && (state.dirty || state.saveTimer)) {
    const blob = new Blob([JSON.stringify(state.model)], { type: 'application/json' });
    navigator.sendBeacon(`/api/graph?name=${encodeURIComponent(state.name)}`, blob);
  }
});

// ---------- SSE live mirror ----------

function wireSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = async ev => {
    if (!ev.data || !ev.data.startsWith('{')) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.deleted) {
      const wasOpen = msg.deleted === state.name;
      if (wasOpen) resetEditorState();
      await loadList();
      if (!state.name) await openFirstOrEmpty();
      if (!wasOpen) toast('Graph deleted elsewhere: ' + msg.deleted);
      return;
    }
    if (msg.name === state.name) {
      if (msg.hash === state.suppress || msg.hash === state.hash) return;
      try {
        const { model, hash } = await api(`/api/graph?name=${encodeURIComponent(state.name)}`);
        // Guard against reading a file mid-write (partial fence => empty graph).
        if (model.nodes.length === 0 && state.model && state.model.nodes.length > 0) return;
        if (applyRemote(model, hash)) toast('Synced from graphs/' + state.name + '.md');
      } catch { /* transient read error; next event resyncs */ }
    } else {
      document.querySelectorAll('.gitem').forEach(b => {
        if (b.dataset.name === msg.name) b.classList.add('changed');
      });
    }
  };
}

// ---------- boot ----------

async function init() {
  wireSSE();
  const graphs = await loadList();
  const last = localStorage.getItem('gf.last');
  const first = graphs.find(g => g.name === last)?.name || graphs[0]?.name;
  if (first) {
    await openGraph(first);
  } else {
    showEmptyInspector();
  }
}

init().catch(e => {
  toast('Init failed: ' + e.message, 'err');
  console.error(e);
});
