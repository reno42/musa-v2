// GraphForge acceptance test: raw markdown endpoint + soft-delete to .trash.
// Requires a running server: node server.mjs   (from graphforge/)
import { readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:4310';
const here = dirname(fileURLToPath(import.meta.url));
const trashDir = join(here, 'graphs', '.trash');
let pass = 0, fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; };

const j = async (n, opts) => {
  const r = await fetch(`${API}/api/graph?name=${n}`, opts);
  return { code: r.status, body: await r.json().catch(() => null) };
};

// 1) raw markdown endpoint serves the file as-is
const r1 = await fetch(`${API}/api/graph.md?name=musa-entry`);
const md1 = await r1.text();
check('raw md: 200 + text/markdown', r1.status === 200 && (r1.headers.get('content-type') || '').includes('text/markdown'));
check('raw md: starts with title heading', md1.startsWith('# '));
check('raw md: contains mermaid fence', md1.includes('```mermaid'));
check('raw md: matches file on disk', md1 === (await import('node:fs')).readFileSync(join(here, 'graphs', 'musa-entry.md'), 'utf8'));

// 2) invalid + missing names rejected
const r2 = await fetch(`${API}/api/graph.md?name=../etc`);
check('raw md: invalid name -> 400', r2.status === 400);
const r3 = await fetch(`${API}/api/graph.md?name=does-not-exist`);
check('raw md: missing graph -> 404', r3.status === 404);

// 3) create a scratch graph, raw-fetch it, then soft-delete it
const create = await j('zz-delete-me', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'delete me', direction: 'TD',
    nodes: [{ id: 'a', label: 'A', shape: 'rect', parent: null, x: 0, y: 0 }],
    edges: [], subgraphs: [],
  }),
});
check('create scratch graph ok', create.code === 200 && create.body.ok);
const r4 = await fetch(`${API}/api/graph.md?name=zz-delete-me`);
check('raw md: scratch graph readable', r4.status === 200 && (await r4.text()).includes('# delete me'));

const del = await j('zz-delete-me', { method: 'DELETE' });
check('delete: 200 ok', del.code === 200 && del.body.ok);
const after = await j('zz-delete-me');
check('delete: graph api now 404', after.code === 404);
const r5 = await fetch(`${API}/api/graph.md?name=zz-delete-me`);
check('delete: raw md now 404', r5.status === 404);

// 4) second delete -> 404, and the file landed in graphs/.trash
const del2 = await j('zz-delete-me', { method: 'DELETE' });
check('delete: second delete -> 404', del2.code === 404);
let trashed = [];
try { trashed = readdirSync(trashDir).filter(f => f.startsWith('zz-delete-me-')); } catch { /* no trash yet */ }
check('delete: file moved to graphs/.trash', trashed.length >= 1);

// 5) cleanup: remove this test's trash artifacts
for (const f of trashed) { try { unlinkSync(join(trashDir, f)); } catch { /* already gone */ } }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
