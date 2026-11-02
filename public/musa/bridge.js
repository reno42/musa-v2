/* bridge.js — conecta la maqueta (index.html, intacta) con la app Musa v2.
 * - Refleja la ruta de la maqueta en la barra de direcciones (linkable, sobrevive refresh).
 * - Reemplaza los datos de ejemplo por datos reales donde ya hay backend, sin tocar el diseño.
 */
(function () {
  var host = null;
  try { host = window.parent !== window ? window.parent : null; } catch (e) { host = null; }

  function syncHash() {
    if (!host) return;
    try { host.history.replaceState(null, "", "/" + location.hash); } catch (e) {}
  }
  window.addEventListener("hashchange", syncHash);
  syncHash();

  function bridge() { try { return host && host.__musaBridge; } catch (e) { return null; } }

  var STAGES = [["discovery", "Prospecto"], ["proposal", "Propuesta"], ["negotiation", "Negociación"], ["closed_won", "Ganado"]];
  var STAGE_LBL = { discovery: "Prospecto", proposal: "Propuesta", negotiation: "Negociación", closed_won: "Cliente", closed_lost: "Perdido" };

  function money(v, cur) {
    if (v == null || !isFinite(v)) return "—";
    var sym = cur === "PEN" || !cur ? "S/" : cur === "USD" ? "US$" : cur;
    return sym + " " + Math.round(v).toLocaleString("es-PE").replace(/,/g, " ");
  }
  function ago(iso) {
    if (!iso) return "—";
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function load(b) {
    var ws = b.workspaceId;
    if (!ws) return;
    var q = function (t, sel) { return "/rest/v1/" + t + "?workspace_id=eq." + ws + "&select=" + sel + "&order=updated_at.desc&limit=200"; };
    var deals = b.api(q("crm_deals", "id,title,stage,value,final_value,currency,primary_contact_id,updated_at")).catch(function () { return null; });
    var contacts = b.api(q("crm_contacts", "id,first_name,last_name,email,company,brand_name,status,updated_at")).catch(function () { return null; });

    Promise.all([deals, contacts]).then(function (r) {
      var D = r[0], C = r[1], changed = false;
      var byId = {};
      (C || []).forEach(function (c) { byId[c.id] = c; });
      var who = function (c) { return c ? ((c.first_name || "") + " " + (c.last_name || "")).trim() || c.email || "—" : "—"; };
      var shortWho = function (c) { var n = who(c).split(/\s+/); return n.length > 1 ? n[0] + " " + n[1][0] + "." : n[0]; };

      if (Array.isArray(D)) {
        KANBANS["vender/oportunidades"] = STAGES.map(function (s) {
          return [s[1], D.filter(function (d) { return (d.stage || "discovery") === s[0]; }).map(function (d) {
            return [esc(d.title || "Sin título"), money(d.final_value != null ? d.final_value : d.value, d.currency), esc(shortWho(byId[d.primary_contact_id]))];
          })];
        });
        changed = true;
      }
      if (Array.isArray(C)) {
        var dealOf = {};
        (D || []).forEach(function (d) { if (d.primary_contact_id && !dealOf[d.primary_contact_id]) dealOf[d.primary_contact_id] = d; });
        TABLES["vender/personas"].rows = C.map(function (c) {
          var d = dealOf[c.id];
          var stage = d ? STAGE_LBL[d.stage] || "Prospecto" : "Prospecto";
          var days = c.updated_at ? (Date.now() - new Date(c.updated_at).getTime()) / 86400000 : 99;
          return [esc(who(c)), esc(c.company || c.brand_name || "—"), stage, d ? money(d.value, d.currency) : "—", ago(c.updated_at), days > 10 ? "En fuga" : days > 4 ? "En riesgo" : "Sana"];
        });
        changed = true;
      }
      var h = location.hash.slice(1);
      if (changed && (h === "vender/oportunidades" || h === "vender/personas") && typeof go === "function") go();
    });
  }

  var tries = 0;
  (function wait() {
    var b = bridge();
    if (b && b.workspaceId) return load(b);
    if (++tries < 120) setTimeout(wait, 250);
  })();
})();
