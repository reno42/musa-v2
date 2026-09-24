// GraphForge acceptance test — canonical Musa graphs + @link drill-downs.
// Run: node test-nav.mjs   (from graphforge/)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseGraphMd, serializeGraphMd, sanitizeModel } from './lib/graphmd.mjs';

const dir = join(import.meta.dirname, 'graphs') + '\\';
// compare modulo line endings: the Write tool emits CRLF, the serializer LF;
// the first browser save re-normalizes the file to LF either way.
const trim = s => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

const EXPECT = {
  'musa-entry': { nodes: 13, edges: 7, links: 6 },
  'musa-pb-replicate-html': { nodes: 26, edges: 33 },
  'musa-pb-create-from-scratch': { nodes: 28, edges: 38 },
  'musa-pb-csv-batch': { nodes: 23, edges: 26 },
  'musa-pb-design-system': { nodes: 28, edges: 34 },
  'musa-pb-multi-agent': { nodes: 29, edges: 32 },
  'musa-pb-content-calendar': { nodes: 12, edges: 13 },
  // user-restored synthesis graph (kept by user request, positions from their manual layout)
  'musa-graph-engineering': { nodes: 12, edges: 16 },
};

let pass = 0, fail = 0;
const chk = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };

for (const [name, exp] of Object.entries(EXPECT)) {
  let file;
  try { file = readFileSync(dir + name + '.md', 'utf8'); }
  catch { chk(false, `${name}.md missing`); continue; }
  const m1 = parseGraphMd(file, name);
  chk(m1.nodes.length === exp.nodes, `${name} nodes ${m1.nodes.length} != ${exp.nodes}`);
  chk(m1.edges.length === exp.edges, `${name} edges ${m1.edges.length} != ${exp.edges}`);
  // sanitize -> serialize -> parse -> serialize must be stable AND byte-faithful
  const s1 = serializeGraphMd(sanitizeModel(m1, name));
  const m2 = parseGraphMd(s1, name);
  const s2 = serializeGraphMd(m2);
  chk(s1 === s2, `${name} roundtrip unstable`);
  chk(trim(s1) === trim(file), `${name} serialize(parse(file)) != file layout`);
  // membership integrity: every node claimed by its intended subgraph stays there
  for (const sg of m2.subgraphs) {
    const members = m2.nodes.filter(n => n.parent === sg.id);
    chk(members.length > 0, `${name} empty subgraph ${sg.id}`);
  }
  if (exp.links) {
    const linked = m1.nodes.filter(n => n.link);
    chk(linked.length === exp.links, `${name} links ${linked.length} != ${exp.links}`);
    for (const n of linked) chk(/^musa-pb-[a-z-]+$/.test(n.link), `${name} bad link ${n.id}->${n.link}`);
  }
}

// cross-file: every @link target must exist as a graph file
const files = new Set(readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)));
const entry = parseGraphMd(readFileSync(dir + 'musa-entry.md', 'utf8'), 'musa-entry');
for (const n of entry.nodes.filter(n => n.link)) {
  chk(files.has(n.link), `entry link target missing: ${n.link}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
