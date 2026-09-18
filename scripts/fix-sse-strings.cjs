// Fix one-shot: repara los strings SSE con saltos literales en worker/index.js
const fs = require('fs');
let s = fs.readFileSync('worker/index.js', 'utf8');
const before = s.length;

// Bloque 1: el encode del evento endpoint roto (saltos literales dentro del string)
const reEndpoint = /controller\.enqueue\(encoder\.encode\("event: endpoint[\s\S]*?\)\);\r?\n/;
if (!reEndpoint.test(s)) { console.error('endpoint no encontrado'); process.exit(1); }
s = s.replace(reEndpoint, 'controller.enqueue(encoder.encode("event: endpoint\\r\\ndata: /mcp\\r\\n\\r\\n"));\n');

// Bloque 2: el encode del ping roto
const rePing = /controller\.enqueue\(encoder\.encode\(": ping[\s\S]*?\)\);/;
if (!rePing.test(s)) { console.error('ping no encontrado'); process.exit(1); }
s = s.replace(rePing, 'controller.enqueue(encoder.encode(": ping\\r\\n\\r\\n"));');

fs.writeFileSync('worker/index.js', s);
console.log('fixed. bytes:', before, '->', s.length);
