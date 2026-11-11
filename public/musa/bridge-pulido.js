/* bridge-pulido.js — detalles del retest 2 de Instinct (2026-11-10, M1-M9 y menores). Solo presentación: no cambia datos.
 *  M1  un modal oculto (.mx) nunca intercepta clics.
 *  M4  la portada de cada marca usa SU color principal (antes una paleta fija naranja/azul/gris) y «1 pieza» en singular.
 *  M6  en el calendario, «+N más» del día de hoy ya no se pinta como el círculo naranja del número del día.
 *  M7  selectores sin marcas repetidas por mayúsculas (Futuraria / futuraria): se deja una por nombre.
 *  M8  en el celular no se muestra la ruta cortada («Ven», «Plar»): el título grande ya dice dónde estás.
 *  N3  la tarjeta de una oportunidad muestra el chip «COT-xxxx · estado» de la cotización unida a ella (por la oportunidad,
 *      no solo por el nombre de la marca); tocarla abre esa cotización.
 *  N2  (retest 3) detalle de cotización sin barra horizontal · N3 campos de fecha con el idioma de la app.
 *  B43 CSV de Medir › Loops: la marca dice «Todas (simulación general)» en vez de «Ejemplo» y la semilla lleva valor y unidad.
 *  R4-8  (ronda 4) fecha y hora en el idioma de la app en todos los navegadores: calendario propio en vez del nativo.
 *  R4-10 el calendario no abre con un filtro que no se ve en ningún control.
 *  R4-13 «Segundo cerebro» con su propia descripción (repetía la de Mi trabajo).
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
    /* N2 (retest 3): el detalle de una cotización no necesita el ancho mínimo de 720 px de las tablas grandes (salía barra horizontal y tapaba el subtotal) */
    "@media (min-width:861px){.card.c8:has(.cl-sum) .tbl-wrap>table{min-width:0}.card.c8:has(.cl-sum) .tbl-wrap{margin-bottom:0}}",
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

  /* ── N3 (retest 3): los campos de fecha con el idioma de la app (Firefox lo usa para el formato; Chrome y Safari usan el del navegador) ── */
  function fechasEnIdioma() {
    var lang = (document.documentElement.getAttribute("lang") || "").slice(0, 2) || "es";
    try { var g = localStorage.getItem("musa_lang"); if (g) lang = g.slice(0, 2); } catch (e) {}
    document.querySelectorAll('input[type="date"]:not([lang]),input[type="datetime-local"]:not([lang])').forEach(function (i) { i.setAttribute("lang", lang === "en" ? "en" : "es-PE"); });
  }

  /* ── R4-13: cada sección de Inicio dice lo suyo ── */
  if (typeof SUB_DESC !== "undefined" && !SUB_DESC["inicio/cerebro"]) SUB_DESC["inicio/cerebro"] = "Lo que sabes de cada marca y cómo trabajas, ordenado para ti y para tus IAs.";

  /* ── R4-10: el calendario no abre con un filtro escondido ──
   * Se vio «Limpiar filtros · 1» con «Mostrar: Todo» y «Marca: Todas», y el mes vacío. Pasa cuando las capas quedan
   * vacías o con tipos que ya no existen, o cuando el filtro de marca cubre todas las marcas (el control dice «Todas»
   * pero deja fuera lo que no tiene marca). Antes de dibujar se deja el filtro en algo que los controles muestren. */
  function calSano() {
    if (typeof CAL === "undefined" || typeof CAL_T === "undefined") return;
    var keys = Object.keys(CAL_T), cur = CAL.layers instanceof Set ? [].slice.call(CAL.layers) : [];
    var ok = cur.filter(function (k) { return keys.indexOf(k) >= 0; });
    if (!ok.length || ok.length !== cur.length) CAL.layers = new Set(ok.length ? ok : keys);
    if (CAL.brand != null) {
      var all = typeof allBrands === "function" ? allBrands() : [], sel = [].concat(CAL.brand).filter(function (b) { return all.indexOf(b) >= 0; });
      CAL.brand = !sel.length || (all.length && sel.length >= all.length) ? null : sel;
    }
  }
  function envolverCalendario() {
    if (typeof viewCalendar !== "function" || viewCalendar.__pulido) return typeof viewCalendar === "function";
    var _vc = viewCalendar;
    viewCalendar = function () { try { calSano(); } catch (e) {} return _vc.apply(this, arguments); };
    viewCalendar.__pulido = true;
    return true;
  }

  /* ── R4-8: fecha y hora en el idioma de la app ──
   * El calendario nativo de Chrome y Safari usa el idioma del navegador, no el de la app (mm/dd/yyyy, AM/PM). El campo
   * real se queda con su id y su valor de siempre (aaaa-mm-dd, HH:MM o aaaa-mm-ddTHH:MM), así todo el código que lo lee
   * sigue igual; solo se oculta, y en su lugar se ve un botón con la fecha escrita en el idioma de la app que abre un
   * calendario propio. Cambiar el valor por código también actualiza lo que se ve. */
  var DPL = {
    es: { m: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], d: ["L", "M", "X", "J", "V", "S", "D"], hoy: "Hoy", borrar: "Borrar", listo: "Listo", elegir: "Elegir fecha", hora: "Elegir hora", h: "Hora", min: "Min", prev: "Mes anterior", next: "Mes siguiente" },
    en: { m: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], d: ["M", "T", "W", "T", "F", "S", "S"], hoy: "Today", borrar: "Clear", listo: "Done", elegir: "Pick a date", hora: "Pick a time", h: "Hour", min: "Min", prev: "Previous month", next: "Next month" },
  };
  function dpLang() { var l = (document.documentElement.getAttribute("lang") || "es").slice(0, 2); try { var g = localStorage.getItem("musa_lang"); if (g) l = g.slice(0, 2); } catch (e) {} return l === "en" ? "en" : "es"; }
  var VAL = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  function nv(i) { return VAL.get.call(i); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function parseD(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; }
  function parseT(s) { var m = /(?:^|T)(\d{2}):(\d{2})/.exec(s || ""); return m ? { h: +m[1], mi: +m[2] } : null; }
  function isoD(o) { return o.y + "-" + p2(o.m + 1) + "-" + p2(o.d); }
  function txtD(o, L) { var t = DPL[L]; return L === "en" ? t.m[o.m].slice(0, 3) + " " + o.d + ", " + o.y : o.d + " " + t.m[o.m].slice(0, 3) + " " + o.y; }
  function txtV(i) {
    var L = dpLang(), t = DPL[L], v = nv(i), d = parseD(v), h = parseT(v), k = i.dataset.dpKind;
    if (k === "time") return h ? p2(h.h) + ":" + p2(h.mi) : "--:--";
    if (k === "datetime") return d ? txtD(d, L) + (h ? " · " + p2(h.h) + ":" + p2(h.mi) : "") : t.elegir;
    return d ? txtD(d, L) : t.elegir;
  }
  function pintar(i) {
    var b = i.__dpBtn; if (!b) return;
    var v = nv(i);
    b.firstChild.textContent = txtV(i);
    b.classList.toggle("dp-vacio", !v);
    b.disabled = i.disabled;
  }
  var DP = { pop: null, inp: null, y: 0, m: 0, sel: null, h: null };
  function dpCerrar() { if (DP.pop) { DP.pop.remove(); DP.pop = null; } if (DP.inp && DP.inp.__dpBtn) DP.inp.__dpBtn.setAttribute("aria-expanded", "false"); DP.inp = null; }
  function dpPoner(i, v) {
    VAL.set.call(i, v); pintar(i);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function dpDibujar() {
    var i = DP.inp, k = i.dataset.dpKind, L = dpLang(), t = DPL[L], html = "";
    if (k !== "time") {
      var first = new Date(DP.y, DP.m, 1), off = (first.getDay() + 6) % 7, days = new Date(DP.y, DP.m + 1, 0).getDate(), hoy = new Date();
      var mn = parseD(i.min), mx2 = parseD(i.max), lim = function (d) { var s = isoD({ y: DP.y, m: DP.m, d: d }); return (mn && s < isoD(mn)) || (mx2 && s > isoD(mx2)); };
      html += '<div class="dp-h"><button type="button" data-dp="-1" aria-label="' + t.prev + '">‹</button><b>' + t.m[DP.m] + " " + DP.y + '</b><button type="button" data-dp="1" aria-label="' + t.next + '">›</button></div><div class="dp-g">'
        + t.d.map(function (x) { return "<i>" + x + "</i>"; }).join("");
      for (var c = 0; c < off; c++) html += "<span></span>";
      for (var d = 1; d <= days; d++) {
        var on = DP.sel && DP.sel.y === DP.y && DP.sel.m === DP.m && DP.sel.d === d, es = hoy.getFullYear() === DP.y && hoy.getMonth() === DP.m && hoy.getDate() === d;
        html += '<button type="button" data-dd="' + d + '" class="' + (on ? "on " : "") + (es ? "hoy" : "") + '"' + (lim(d) ? " disabled" : "") + ">" + d + "</button>";
      }
      html += "</div>";
    }
    if (k !== "date") {
      var hh = DP.h || { h: 9, mi: 0 }, mins = [];
      for (var mm = 0; mm < 60; mm += 5) mins.push(mm);
      if (mins.indexOf(hh.mi) < 0) { mins.push(hh.mi); mins.sort(function (a, b) { return a - b; }); }
      html += '<div class="dp-t"><label>' + t.h + ' <select data-dph="h">' + Array.apply(null, Array(24)).map(function (_, n) { return '<option value="' + n + '"' + (n === hh.h ? " selected" : "") + ">" + p2(n) + "</option>"; }).join("") + "</select></label>"
        + "<b>:</b><label>" + t.min + ' <select data-dph="m">' + mins.map(function (n) { return '<option value="' + n + '"' + (n === hh.mi ? " selected" : "") + ">" + p2(n) + "</option>"; }).join("") + "</select></label></div>";
    }
    html += '<div class="dp-f">' + (k !== "time" ? '<button type="button" data-dpa="hoy">' + t.hoy + "</button>" : "") + (i.required ? "" : '<button type="button" data-dpa="borrar">' + t.borrar + "</button>")
      + (k !== "date" ? '<button type="button" class="pri" data-dpa="listo">' + t.listo + "</button>" : "") + "</div>";
    DP.pop.innerHTML = html;
  }
  function dpUbicar() {
    if (!DP.pop || !DP.inp || !DP.inp.__dpBtn) return;
    var r = DP.inp.__dpBtn.getBoundingClientRect(), w = DP.pop.offsetWidth, h = DP.pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var top = r.bottom + 6; if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    DP.pop.style.top = Math.max(8, Math.min(top, vh - h - 8)) + "px";
    DP.pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
  }
  function dpValor() {
    var i = DP.inp, k = i.dataset.dpKind, d = DP.sel, h = DP.h || { h: 9, mi: 0 };
    if (k === "time") return p2(h.h) + ":" + p2(h.mi);
    if (!d) return "";
    return k === "datetime" ? isoD(d) + "T" + p2(h.h) + ":" + p2(h.mi) : isoD(d);
  }
  function dpAbrir(i) {
    if (DP.inp === i) return dpCerrar();
    dpCerrar();
    var v = nv(i), d = parseD(v), h = parseT(v), base = d || parseD(i.min) || (function () { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; })();
    DP.inp = i; DP.sel = d; DP.h = h; DP.y = base.y; DP.m = base.m;
    DP.pop = document.createElement("div");
    DP.pop.className = "dp-pop"; DP.pop.setAttribute("data-no-i18n", ""); DP.pop.setAttribute("role", "dialog");
    DP.pop.setAttribute("aria-label", i.dataset.dpKind === "time" ? DPL[dpLang()].hora : DPL[dpLang()].elegir);
    document.body.appendChild(DP.pop);
    dpDibujar(); dpUbicar();
    i.__dpBtn.setAttribute("aria-expanded", "true");
    DP.pop.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    DP.pop.addEventListener("click", function (e) {
      e.stopPropagation();
      var b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.dp) { DP.m += +b.dataset.dp; if (DP.m < 0) { DP.m = 11; DP.y--; } if (DP.m > 11) { DP.m = 0; DP.y++; } dpDibujar(); dpUbicar(); return; }
      if (b.dataset.dd) {
        DP.sel = { y: DP.y, m: DP.m, d: +b.dataset.dd };
        if (DP.inp.dataset.dpKind === "date") { var x = DP.inp; dpPoner(x, dpValor()); dpCerrar(); x.__dpBtn.focus(); return; }
        dpDibujar(); return;
      }
      var a = b.dataset.dpa;
      if (a === "hoy") { var n = new Date(); DP.sel = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; DP.y = DP.sel.y; DP.m = DP.sel.m; if (DP.inp.dataset.dpKind === "date") { var x2 = DP.inp; dpPoner(x2, dpValor()); dpCerrar(); x2.__dpBtn.focus(); return; } dpDibujar(); return; }
      if (a === "borrar") { var x3 = DP.inp; dpPoner(x3, ""); dpCerrar(); x3.__dpBtn.focus(); return; }
      if (a === "listo") { var x4 = DP.inp; if (!DP.h) DP.h = { h: 9, mi: 0 }; var val = dpValor(); if (val) dpPoner(x4, val); dpCerrar(); x4.__dpBtn.focus(); }
    });
    DP.pop.addEventListener("change", function (e) {
      var s = e.target.closest("select[data-dph]"); if (!s) return;
      DP.h = DP.h || { h: 9, mi: 0 };
      if (s.dataset.dph === "h") DP.h.h = +s.value; else DP.h.mi = +s.value;
      /* solo hora: cambia al momento */
      if (DP.inp.dataset.dpKind === "time") dpPoner(DP.inp, dpValor());
    });
  }
  function mejorarFecha(i) {
    if (i.__dpBtn || i.closest("[data-no-dp]")) return;
    var ty = (i.getAttribute("type") || "").toLowerCase(), k = ty === "time" ? "time" : ty === "datetime-local" ? "datetime" : "date";   /* el atributo: hay navegadores que informan «text» si no tienen ese control */
    i.dataset.dpKind = k;
    var b = document.createElement("button");
    b.type = "button"; b.className = (i.className || "fx-in") + " dp-btn"; b.setAttribute("data-no-i18n", ""); b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-expanded", "false");
    if (i.getAttribute("style")) b.setAttribute("style", i.getAttribute("style"));
    var lbl = i.id && document.querySelector('label[for="' + i.id + '"]');
    b.setAttribute("aria-label", (lbl ? lbl.textContent.replace(/\s*\*$/, "").trim() + ": " : "") + (k === "time" ? DPL[dpLang()].hora : DPL[dpLang()].elegir));
    b.innerHTML = '<span></span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' + (k === "time" ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' : '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>') + "</svg>";
    i.__dpBtn = b;
    i.classList.add("dp-nativo"); i.setAttribute("tabindex", "-1"); i.setAttribute("aria-hidden", "true");
    i.parentNode.insertBefore(b, i.nextSibling);
    try { Object.defineProperty(i, "value", { configurable: true, get: function () { return VAL.get.call(this); }, set: function (v) { VAL.set.call(this, v); pintar(this); } }); } catch (e) {}
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (!i.disabled) dpAbrir(i); });
    b.addEventListener("keydown", function (e) { if (e.key === "Escape" && DP.inp === i) { e.stopPropagation(); dpCerrar(); } });
    pintar(i);
  }
  function fechasPropias(root) { (root || document).querySelectorAll('input[type="date"],input[type="time"],input[type="datetime-local"]').forEach(function (i) { try { mejorarFecha(i); } catch (e) {} }); }
  document.addEventListener("mousedown", function (e) { if (DP.pop && !DP.pop.contains(e.target) && !(DP.inp && DP.inp.__dpBtn && DP.inp.__dpBtn.contains(e.target))) dpCerrar(); }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && DP.pop) { e.stopImmediatePropagation(); e.stopPropagation(); var x = DP.inp; dpCerrar(); if (x && x.__dpBtn) x.__dpBtn.focus(); } }, true);
  window.addEventListener("resize", dpUbicar);
  document.addEventListener("scroll", function () { if (DP.pop && DP.inp && DP.inp.__dpBtn && !document.body.contains(DP.inp.__dpBtn)) dpCerrar(); else dpUbicar(); }, true);
  (function () {
    var st = document.createElement("style");
    st.textContent = [
      ".dp-nativo{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;margin:0!important;padding:0!important;border:0!important}",
      ".dp-btn{display:flex!important;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;font:inherit;color:inherit}",
      ".dp-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dp-btn svg{flex:0 0 auto;opacity:.55}.dp-btn.dp-vacio span{color:var(--muted,#888)}.dp-btn:disabled{opacity:.55;cursor:default}",
      ".dp-pop{position:fixed;z-index:2147483600;width:272px;max-width:calc(100vw - 16px);background:#fff;color:#111;border:1.5px solid #c9c7b8;border-radius:14px;box-shadow:0 14px 34px rgba(0,0,0,.22);padding:10px;font:13px/1.3 var(--sans,Inter,system-ui,sans-serif)}",
      ".dp-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.dp-h b{font-weight:800;text-transform:capitalize}",
      ".dp-h button{width:30px;height:30px;border:0;border-radius:8px;background:#f2efe4;font-size:16px;cursor:pointer;color:#111}",
      ".dp-g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}.dp-g i{font-style:normal;font-size:10.5px;font-weight:700;color:#8a8878;padding:4px 0}",
      ".dp-g button{height:32px;border:0;border-radius:8px;background:none;cursor:pointer;color:#111;font:inherit;font-variant-numeric:tabular-nums}",
      ".dp-g button:hover{background:#f2efe4}.dp-g button.hoy{box-shadow:inset 0 0 0 1.5px var(--accent,#ff5e00)}.dp-g button.on{background:var(--accent,#ff5e00);color:#fff;font-weight:800}.dp-g button:disabled{opacity:.3;cursor:default}",
      ".dp-t{display:flex;align-items:center;gap:6px;justify-content:center;margin-top:8px;padding-top:8px;border-top:1px solid #eee}.dp-t label{display:flex;align-items:center;gap:6px;font-size:11px;color:#8a8878;font-weight:700}",
      ".dp-t select{height:32px;border:1.5px solid #d6d4c6;border-radius:8px;padding:0 6px;font:inherit;font-size:14px;color:#111;background:#fff;font-variant-numeric:tabular-nums}",
      ".dp-f{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}.dp-f button{height:30px;padding:0 12px;border:0;border-radius:50px;background:#e9e7da;color:#111;font-weight:700;font-size:11.5px;cursor:pointer}.dp-f button.pri{background:var(--accent,#ff5e00);color:#fff}",
      "@media (max-width:600px){.dp-g button{height:38px}.dp-pop{width:300px}}",
    ].join("\n");
    document.head.appendChild(st);
  })();

  /* ── aplicar en cada cambio de la vista ── */
  var pend = 0;
  function pasada() {
    pend = 0;
    try { pintarMarcas(); } catch (e) {}
    try { chipsOportunidades(); } catch (e) {}
    try { sinRepetidas(document); } catch (e) {}
    try { loopsSinRepetidas(); } catch (e) {}
    try { fechasEnIdioma(); } catch (e) {}
    try { fechasPropias(document); } catch (e) {}
    try { if (typeof mxEl !== "undefined" && mxEl && !mxEl.hidden && !mxEl.querySelector(".mx-box") && !mxEl.textContent.trim()) mxEl.hidden = true; } catch (e) {}
  }
  function luego() { if (!pend) pend = setTimeout(pasada, 60); }
  function instalar() {
    if (!envolverLpCsv()) return setTimeout(instalar, 200);
    envolverCalendario();
    new MutationObserver(luego).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", luego);
    luego();
  }
  instalar();
})();
