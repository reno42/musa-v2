// s99_cleanup.mjs - ITEM 10 (COLD-DELETE) + limpieza total de verify-b-*.
// verify-b-cold se creo en s00 (inicio de la corrida). Se borra AHORA, al final:
// cuanto mas tiempo paso, mas chance de instancia fria (store en memoria sin el objeto).
import { tool, saveEvidence, summarizeToolResp, truncate, verdict, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s99 CLEANUP + COLD-DELETE ==");
const st = loadState();
const ev = { startedAt: st.startedAt, now: new Date().toISOString() };

// ITEM 10: delete del template frio
if (st.coldId) {
  const d = await tool("delete_template", { id: st.coldId }, { apiKey: EFFECTIVE_KEY || undefined });
  ev.cold_delete = summarizeToolResp(d, 800);
  const notFound = d.error && /not found/i.test(d.error.message || "");
  console.log("  delete verify-b-cold (" + st.coldId + ") -> HTTP " + d.httpStatus + (d.error ? (" RPC-" + d.error.code + ": " + truncate(d.error.message, 150)) : " OK (deleted:true)"));
  ev.cold_delete_conclusion = notFound
    ? "VERIFICADO: 404/-32000 Template not found en delete diferido (instancia fria)"
    : d.error
      ? "INCONCLUSO: otro error: " + truncate(d.error.message, 150)
      : "REFUTADO-en-esta-corrida: delete devolvio 200 (no prueba que nunca pase)";
  verdict("cold delete 404 not-found?", Boolean(notFound), ev.cold_delete_conclusion);
} else {
  ev.cold_delete_conclusion = "NO VERIFICADO: no hubo coldId (setup fallo?)";
}

// Borrar el resto de verify-b-* conocidos del state
for (const key of ["noopId", "verId"]) {
  if (st[key]) {
    const d = await tool("delete_template", { id: st[key] }, { apiKey: EFFECTIVE_KEY || undefined });
    ev["delete_" + key] = summarizeToolResp(d, 500);
    console.log("  delete " + key + " (" + st[key] + ") -> " + (d.error ? ("RPC-" + d.error.code + ": " + truncate(d.error.message, 120)) : "OK"));
  }
}

// Red de seguridad: list_templates con search=verify-b y borrar lo que aparezca
const lt = await tool("list_templates", { search: "verify-b", limit: 100 }, { apiKey: EFFECTIVE_KEY || undefined });
const found = (lt.parsed?.data || []).filter(t => (t.name || "").startsWith("verify-b"));
ev.list_verify_b_after_deletes = found.map(t => ({ id: t.id, name: t.name }));
console.log("  list_templates(search=verify-b) encontro:", found.length);
for (const t of found) {
  const d = await tool("delete_template", { id: t.id }, { apiKey: EFFECTIVE_KEY || undefined });
  ev["sweep_delete_" + t.id] = summarizeToolResp(d, 400);
  console.log("    sweep delete " + t.id + " (" + t.name + ") -> " + (d.error ? ("RPC-" + d.error.code + " " + truncate(d.error.message, 100)) : "OK"));
}

// Verificacion final: no debe quedar ninguno
const lt2 = await tool("list_templates", { search: "verify-b", limit: 100 }, { apiKey: EFFECTIVE_KEY || undefined });
const remaining = (lt2.parsed?.data || []).filter(t => (t.name || "").startsWith("verify-b"));
ev.final_remaining = remaining.map(t => ({ id: t.id, name: t.name }));
verdict("cero verify-b-* en el servidor?", remaining.length === 0, remaining.length + " restantes");
ev.final_conclusion = remaining.length === 0 ? "LIMPIEZA COMPLETA" : "QUEDAN " + remaining.length + " OBJETOS verify-b-*";

saveEvidence("99-cleanup.json", ev);
console.log("  RESULTADO:", ev.final_conclusion);
