/* bridge-borrar.js — eliminar una marca o un evento desde la web (antes solo se podía «Mover a otro espacio»).
 * Evento: se borra con sus inscritos (los correos ya enviados quedan en el historial).
 * Marca: en la base, borrar una marca borra en cascada sus oportunidades, campañas e interacciones; por eso solo se
 * permite si no tiene oportunidades ni campañas, y antes se muestra todo lo que tiene (lo demás queda «sin marca»). */
(function () {
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function count(path) { return api(path + "&select=id&limit=1000").then(function (r) { return (r || []).length; }, function () { return 0; }); }
  function real() { return RR() && RR().on; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function brandId(name) { var m = RR().brandName || {}; return Object.keys(m).find(function (id) { return m[id] === name; }) || null; }

  function delBrand(name) {
    var id = brandId(name), R = RR(); if (!id) return uiToast("No encontré la marca «" + name + "»");
    var e = encodeURIComponent(id), w = function (t, col) { return count(t + "?" + (col || "brand_id") + "=eq." + e); };
    uiToast("Revisando lo que tiene " + name + "…");
    Promise.all([w("crm_deals"), w("campaigns"), w("crm_interactions"), w("content_calendar"), w("briefs"), w("crm_quotes"), w("workspace_projects"), w("workspace_events"), w("crm_contacts"), w("design_file_meta")]).then(function (n) {
      var L = [["oportunidades", n[0]], ["campañas", n[1]], ["interacciones", n[2]], ["piezas del calendario", n[3]], ["briefs", n[4]], ["cotizaciones", n[5]], ["proyectos", n[6]], ["eventos", n[7]], ["personas", n[8]], ["diseños", n[9]]].filter(function (x) { return x[1]; });
      if (n[0] || n[1]) return R.dialog({ title: "No se puede eliminar " + name, message: "Tiene " + (n[0] ? n[0] + " oportunidades" : "") + (n[0] && n[1] ? " y " : "") + (n[1] ? n[1] + " campañas" : "") + ", que se borrarían con la marca. Muévelas a otra marca o elimínalas primero; o mueve la marca a otro espacio.", ok: "Entendido", cancel: "" });
      var msg = L.length ? "Lo que tiene (" + L.map(function (x) { return x[1] + " " + x[0]; }).join(", ") + ") queda sin marca, no se borra." : "No tiene contenido asociado.";
      return R.confirmBox("¿Eliminar la marca «" + name + "»? " + msg + " Esto no se puede deshacer.", { danger: true, ok: "Eliminar marca", title: "Eliminar marca" }).then(function (ok) {
        if (!ok) return;
        return api("brands?id=eq." + e, { method: "DELETE" }).then(function () { uiToast("Marca «" + name + "» eliminada"); return R.reload ? R.reload() : null; }).then(function () { location.hash = "crear/marcas"; }, function (x) { uiToast("No se pudo eliminar: " + (x && x.message)); });
      });
    });
  }
  function delEvent(ev) {
    var R = RR();
    count("workspace_event_regs?event_id=eq." + encodeURIComponent(ev.db)).then(function (n) {
      return R.confirmBox("¿Eliminar el evento «" + ev.name + "»?" + (n ? " Se borran también sus " + n + " inscritos." : "") + (ev.pub ? " Su página pública deja de responder." : "") + " Esto no se puede deshacer.", { danger: true, ok: "Eliminar evento", title: "Eliminar evento" });
    }).then(function (ok) {
      if (!ok) return;
      return api("workspace_events?id=eq." + encodeURIComponent(ev.db), { method: "DELETE" }).then(function () {
        if (typeof EV !== "undefined") { var i = EV.indexOf(ev); if (i >= 0) EV.splice(i, 1); }
        uiToast("Evento eliminado"); location.hash = "crear/eventos"; if (R.reload) R.reload();
      }, function (x) { uiToast("No se pudo eliminar: " + (x && x.message)); });
    });
  }
  function decorate() {
    if (!real()) return;
    /* ficha de la marca (resumen): junto a «Ver como cliente» */
    var cli = document.querySelector("#body [data-hcli]");
    if (cli && !document.querySelector("#body [data-mbdel]") && typeof hubRoute === "function" && hubRoute() && brandId(hubRoute()[0])) {
      cli.insertAdjacentHTML("afterend", '<button data-mbdel="brand" style="color:#d7261e">Eliminar marca</button>');
    }
    /* detalle del evento: con sus acciones */
    var acts = document.querySelector("#body .ev-acts"), m = location.hash.match(/crear\/eventos\/(e_[0-9a-f-]+)/);
    if (acts && m && !acts.querySelector("[data-mbdel]") && typeof EV !== "undefined") {
      var ev = EV.find(function (x) { return x.id === m[1]; });
      if (ev && ev.db) acts.insertAdjacentHTML("beforeend", '<button data-mbdel="event" style="color:#d7261e">Eliminar evento</button>');
    }
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("#body [data-mbdel]"); if (!b || !real()) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (b.dataset.mbdel === "brand") return delBrand(hubRoute()[0]);
    var m = location.hash.match(/crear\/eventos\/(e_[0-9a-f-]+)/), ev = m && EV.find(function (x) { return x.id === m[1]; });
    if (ev) delEvent(ev);
  }, true);
  var pend = false;
  new MutationObserver(function () { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; decorate(); }); }).observe(document.getElementById("view") || document.body, { childList: true, subtree: true });
})();
