// Ítem 3 — RATE-LIMIT: burst de 250 requests contra :3002
// IP dedicada 10.66.1.3 (vía X-Forwarded-For) para no interferir con otros ítems.
const BASE = "http://localhost:3002";
const H = { "x-forwarded-for": "10.66.1.3" };

const counts = {};
let first429 = null;
let first = null;
let lastOk = null;
const t0 = Date.now();

for (let i = 1; i <= 250; i++) {
  const res = await fetch(BASE + "/api/health", { headers: H });
  const body = await res.text();
  counts[res.status] = (counts[res.status] || 0) + 1;
  const rl = {
    limit: res.headers.get("x-ratelimit-limit"),
    remaining: res.headers.get("x-ratelimit-remaining"),
    reset: res.headers.get("x-ratelimit-reset"),
    retryAfter: res.headers.get("retry-after"),
  };
  if (i === 1) first = { i, status: res.status, rl, body };
  if (res.status !== 429) lastOk = { i, status: res.status, rl };
  if (res.status === 429 && !first429) first429 = { i, status: res.status, rl, body };
}
const elapsed = Date.now() - t0;

console.log(`burst de 250 GET /api/health en ${elapsed} ms`);
console.log(`conteo por status: ${JSON.stringify(counts)}`);
console.log(`\nrequest #1: status=${first.status} headers=${JSON.stringify(first.rl)}`);
console.log(`último request con éxito: #${lastOk?.i} status=${lastOk?.status} remaining=${lastOk?.rl.remaining}`);
if (first429) {
  console.log(`\nprimer 429 en request #${first429.i}`);
  console.log(`headers: ${JSON.stringify(first429.rl, null, 2)}`);
  console.log(`body: ${first429.body}`);
} else {
  console.log("\nno hubo 429 en 250 requests");
}
