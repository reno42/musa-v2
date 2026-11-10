/* bridge-pulido.js — detalles del retest 2 de Instinct (2026-11-10, M1-M9 y menores). Solo presentación: no cambia datos.
 *  M1  un modal oculto (.mx) nunca intercepta clics.
 *  M4  la portada de cada marca usa SU color principal (antes una paleta fija naranja/azul/gris) y «1 pieza» en singular.
 *  M6  en el calendario, «+N más» del día de hoy ya no se pinta como el círculo naranja del número del día.
 *  M7  selectores sin marcas repetidas por mayúsculas (Futuraria / futuraria): se deja una por nombre.
 *  M8  en el celular no se muestra la ruta cortada («Ven», «Plar»): el título grande ya dice dónde estás.
 *  N3  la tarjeta de una oportunidad muestra el chip «COT-xxxx · estado» de la cotización unida a ella (por la oportunidad,
 *      no solo por el nombre de la marca); tocarla abre esa cotización.
 *  B43 CSV de Medir › Loops: la marca dice «Todas (simulación general)» en vez de «Ejemplo» y la semilla lleva valor y unidad.
 */
(function () {
  "use strict";
  var css = document.createElement("style");
  css.id = "musa-pulido";
  css.textContent = [
    ".mx[hidden]{display:none!important;pointer-events:none!important}",
    ".mx:empty{display:none!important}",
    ".mc-grid .d.today>span.mc-more{background:none!important;color:var(--muted)!important;width:auto!important;height:auto!important;border-radius:0!important;display:block!important;place-items:initial!important}",
    "@media (max-width:600px){#crumb,.crumb{display:none!important}}",
  ].join("\n");
  document.head.appendChild(css);

  function R() { return window.__musaReal || {}; }
  var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase(); };
  function hexOk(h) { return /^#[0-9a-f]{6}$/i.test(h); }
  function textoSobre(hex) {   // blanco o casi negro según el brillo del fondo
    var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#111" : "#fff";
  }
  var SING = { piezas: "pieza", proyectos: "proyecto", "campañas": "campaña", eventos: "evento" };

  /* ── M4: portadas de las marcas con su color ── */
  function pintarMarcas() {
    if (!/^#crear\/marcas\/?$/.test(location.hash) || typeof TILES === "undefined") return;
    var lista = TILES["crear/marcas"] || [];
    document.querySelectorAll("#body .tiles a.tile").forEach(function (a) {
      var nombre = ((a.querySelector(".tile-b b") || {}).textContent || "").trim(), th = a.querySelector(".thumb");
      if (!th || !nombre) return;
      var t = lista.find(function (x) { return x[0] === nombre; }), hex = t && (String(t[1] || "").match(/#[0-9a-f]{6}\b/i) || [])[0];
      if (hex && hexOk(hex)) { th.style.background = hex; th.style.color = textoSobre(hex); }
      else { th.style.background = "#2a2a2a"; th.style.color = "#fff"; }   // sin sistema de diseño: neutro, no un color inventado
      a.querySelectorAll(".tile-b small span").forEach(function (s) {
        var nuevo = s.textContent.replace(/(^|\D)1 (piezas|proyectos|campañas|eventos)\b/g, function (m, p, w) { return p + "1 " + SING[w]; });
        if (nuevo !== s.textContent) s.textContent = nuevo;
      });
    });
  }

  /* ── M7: una opción por marca en los selectores ── */
  function marcasConocidas() {
    var set = {}, bn = R().brandName || {};
    Object.keys(bn).forEach(function (k) { if (bn[k]) set[norm(bn[k])] = 1; });
    return set;
  }
  function sinRepetidas(root) {
    var conocidas = marcasConocidas();
    if (!Object.keys(conocidas).length) return;
    (root || document).querySelectorAll("select").forEach(function (s) {
      if (s.options.length < 2) return;
      var vistos = {}, quitar = [];
      [].forEach.call(s.options, function (o) {
        var k = norm(o.text);
        if (!k || !conocidas[k]) return;
        if (!vistos[k]) { vistos[k] = o; return; }
        if (o.selected && !vistos[k].selected) { quitar.push(vistos[k]); vistos[k] = o; } else quitar.push(o);
      });
      quitar.forEach(function (o) { o.remove(); });
    });
  }
  /* Vender/Medir › Loops: los botones de marca salen de crmBrands (constante de la maqueta): se quitan los repetidos en pantalla */
  function loopsSinRepetidas() {
    var vistos = {};
    document.querySelectorAll("#body .seg [data-lpb]").forEach(function (b) {
      var k = norm(b.dataset.lpb);
      if (!vistos[k]) { vistos[k] = b; return; }
      if (b.classList.contains("on")) { vistos[k].remove(); vistos[k] = b; } else b.remove();
    });
  }

  /* ── N3: chip de la cotización unida a la oportunidad ── */
  var ST_PILL = { Firmada: "ok", Enviada: "warn", Borrador: "mute", Vencida: "mute" };
  function chipsOportunidades() {
    if (!/^#vender\/oportunidades/.test(location.hash) || typeof QUOTES === "undefined") return;
    document.querySelectorAll("#body .kc[data-db]").forEach(function (c) {
      if (c.querySelector(".pill")) return;
      var qs = QUOTES.filter(function (q) { return q.deal && q.deal === c.dataset.db && q.st !== "Rechazada"; });
      if (!qs.length) return;
      var q = qs[0];
      [].forEach.call(c.querySelectorAll("small"), function (s) { if (/Crear cotizaci/.test(s.textContent)) s.remove(); });
      c.insertAdjacentHTML("beforeend", '<small style="margin-top:6px"><span class="pill ' + (ST_PILL[q.st] || "mute") + '">' + q.n + " · " + q.st + "</span></small>");
      c.dataset.qdeal = q.id;
      c.title = "Abrir su cotización";
    });
  }
  /* antes que los demás manejadores: la tarjeta con cotización unida abre esa cotización */
  window.addEventListener("click", function (e) {
    if (!/^#vender\/oportunidades/.test(location.hash)) return;
    var c = e.target.closest && e.target.closest(".kc[data-qdeal]");
    if (!c || e.target.closest(".mv-tools, .wtag, button, a")) return;
    e.stopPropagation(); e.preventDefault();
    if (typeof CL !== "undefined") CL.quote = c.dataset.qdeal;
    location.hash = "vender/cotizaciones";
  }, true);

  /* ── B43: CSV de Loops ── */
  function envolverLpCsv() {
    if (typeof lpCsv !== "function" || lpCsv.__pulido) return typeof lpCsv === "function";
    var _lp = lpCsv;
    lpCsv = function () {
      try { if (typeof LP !== "undefined" && LP.seed == null && typeof lpSeedDefault === "function") LP.seed = lpSeedDefault(); } catch (e) {}
      var q = function (x) { return '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"'; };
      var L = (typeof LOOPS !== "undefined" && typeof LP !== "undefined" && LOOPS[LP.macro]) || {};
      return String(_lp.apply(this, arguments)).split(String.fromCharCode(10)).map(function (l) {
        if (l.indexOf('"Loop","Marca","Ejemplo"') === 0) return ["Loop", "Marca", "Todas (simulación general)", "", "elige una marca en la vista para usar sus datos"].map(q).join(",");
        if (/^"Parámetro","(Semilla por ciclo|Nuevos inactivos por ciclo)"/.test(l)) {
          var res = LP.macro === "res";
          return ["Parámetro", res ? "Nuevos inactivos por ciclo" : "Semilla por ciclo", LP.seed == null ? 0 : LP.seed, L.unit || "",
            res ? "usuarios que se vuelven inactivos en cada ciclo" : "lo que entra sin el loop (ads, orgánico, ventas)"].map(q).join(",");
        }
        return l;
      }).join(String.fromCharCode(10));
    };
    lpCsv.__pulido = true;
    return true;
  }

  /* ── aplicar en cada cambio de la vista ── */
  var pend = 0;
  function pasada() {
    pend = 0;
    try { pintarMarcas(); } catch (e) {}
    try { chipsOportunidades(); } catch (e) {}
    try { sinRepetidas(document); } catch (e) {}
    try { loopsSinRepetidas(); } catch (e) {}
    try { if (typeof mxEl !== "undefined" && mxEl && !mxEl.hidden && !mxEl.querySelector(".mx-box") && !mxEl.textContent.trim()) mxEl.hidden = true; } catch (e) {}
  }
  function luego() { if (!pend) pend = setTimeout(pasada, 60); }
  function instalar() {
    if (!envolverLpCsv()) return setTimeout(instalar, 200);
    new MutationObserver(luego).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", luego);
    luego();
  }
  instalar();
})();
