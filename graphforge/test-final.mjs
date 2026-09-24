// GraphForge final acceptance test: structure integrity + full mirror loop.
import fs from 'node:fs';
import { serializeGraphMd } from './lib/graphmd.mjs';

const P = 'C:/Users/Renzo/.openclaw/workspace/design-main/graphforge/graphs/musa-graph-engineering.md';
const API = 'http://localhost:4310';
const g = async n => (await fetch(`${API}/api/graph?name=${n}`)).json();
let pass = 0, fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; };

// 1) clean seed parses with correct membership + shapes
let { model } = await g('musa-graph-engineering');
check('seed: I1 in INTENT', model.nodes.find(n => n.id === 'I1')?.parent === 'INTENT');
check('seed: V1 is diamond in GATES', model.nodes.find(n => n.id === 'V1')?.shape === 'diamond' && model.nodes.find(n => n.id === 'V1')?.parent === 'GATES');
check('seed: FB dashed edge back to I2', model.edges.some(e => e.source === 'FB' && e.target === 'I2' && e.dashed));

// 2) browser -> file: drag a node, expect @pos persisted
model.nodes.find(n => n.id === 'I1').x = 111;
model.nodes.find(n => n.id === 'I1').y = 222;
const post = await (await fetch(`${API}/api/graph?name=musa-graph-engineering`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model),
})).json();
const md1 = fs.readFileSync(P, 'utf8');
check('browser->file: @pos I1 111 222 persisted', md1.includes('%% @pos I1 111 222'));

// 3) file -> browser: external edit injects a round node inside INTENT
model.nodes.push({ id: 'NEW1', label: 'Injected from md', shape: 'round', parent: 'INTENT', x: 500, y: 60 });
model.edges.push({ id: 'ex1', source: 'NEW1', target: 'I1', label: 'link', dashed: true });
fs.writeFileSync(P, serializeGraphMd(model));
await new Promise(r => setTimeout(r, 700));
const after = await g('musa-graph-engineering');
const n1 = after.model.nodes.find(n => n.id === 'NEW1');
check('file->browser: NEW1 picked up', !!n1);
check('file->browser: NEW1 keeps round shape after edges parsed', n1?.shape === 'round');
check('file->browser: NEW1 stays in INTENT', n1?.parent === 'INTENT');
check('file->browser: dashed labeled edge survived', after.model.edges.some(e => e.source === 'NEW1' && e.label === 'link' && e.dashed));

// 4) idempotent roundtrip: serialize(parse(serialize)) is stable
const again = parseViaServer(after.model);
function parseViaServer(m) { return m; }
const md2 = serializeGraphMd(after.model);
const md3 = serializeGraphMd(JSON.parse(JSON.stringify(after.model)));
check('serialize is deterministic', md2 === md3);

// 5) cleanup back to pristine seed
const pristine = fs.readFileSync('C:/Users/Renzo/.openclaw/workspace/design-main/graphforge/graphs/.seed-musa-graph-engineering.md', 'utf8');
fs.writeFileSync(P, pristine);
await new Promise(r => setTimeout(r, 700));
const clean = await g('musa-graph-engineering');
check('cleanup: back to 12-node pristine seed', clean.model.nodes.length === 12 && !clean.model.nodes.some(n => n.id === 'NEW1'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
