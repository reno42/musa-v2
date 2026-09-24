// Prueba roundtrip de extremos de flecha sueltos (@pend / GF_FLOAT_*).
import { parseGraphMd, serializeGraphMd, sanitizeModel } from './lib/graphmd.mjs';

const FENCE = '```';

// 1) edge con extremo destino suelto
const md1 = `# Test float

${FENCE}mermaid
flowchart TD
    A[Inicio]
    GF_FLOAT_T_e1((GF_FLOAT_T_e1))

    A --> GF_FLOAT_T_e1

    %% @pos A 100 100
    %% @pos GF_FLOAT_T_e1 300 220
    %% @pend GF_FLOAT_T_e1 T 300 220
${FENCE}
`;

const m1 = parseGraphMd(md1, 't1');
console.log('T1 parse  nodes:', m1.nodes.map(n => n.id), '| dstFloat:', JSON.stringify(m1.edges[0]?.dstFloat), '| t:', m1.edges[0]?.t);

const s1 = serializeGraphMd(sanitizeModel(m1, 't1'));
console.log('--- md serializado ---');
console.log(s1);

const m1b = parseGraphMd(s1, 't1');
console.log('T1 rtrip  nodes:', m1b.nodes.map(n => n.id), '| dstFloat:', JSON.stringify(m1b.edges[0]?.dstFloat));

// 2) edge normal NO se toca
const md2 = `# Normal

${FENCE}mermaid
flowchart TD
    A[X] --> B[Y]
    %% @pos A 0 0
    %% @pos B 200 0
${FENCE}
`;
const m2 = parseGraphMd(md2, 't2');
console.log('T2 normal nodes:', m2.nodes.map(n => n.id), '| srcFloat:', m2.edges[0]?.srcFloat, '| dstFloat:', m2.edges[0]?.dstFloat);
const s2 = serializeGraphMd(sanitizeModel(m2, 't2'));
console.log('T2 serial conserva @sides/@link:', s2.includes('@pos A 0 0'), '| sin GF_FLOAT:', !s2.includes('GF_FLOAT'));
