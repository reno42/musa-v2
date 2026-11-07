/* bridge-demo.js — «Datos de ejemplo» (ENCENDIDO por defecto desde 2026-11-07, pedido del usuario:
 * quien todavía no creó nada ve cómo se verá cada módulo con datos; apagarlo queda guardado en el navegador).
 * bridge.js vacía los datos de ejemplo de la maqueta y pone los reales. Con este modo encendido, los módulos
 * que quedan VACÍOS se llenan con los ejemplos de la maqueta para ver cómo se ve Musa con uso real.
 * No escribe nada en la base: es solo visual, se guarda en este navegador y se apaga con el mismo botón.
 * Tiene que cargar antes de que bridge.js vacíe los arreglos (bridge.js los vacía después de pedir datos a la red). */
(function () {
  var KEY = "musa-demo";
  var on = false;
  try { on = localStorage.getItem(KEY) !== "0"; } catch (e) { on = true; }

  // Nombres globales de la maqueta con datos de ejemplo (los mismos que vacía bridge.js).
  var ARRAYS = ["EV", "MAILS", "ADS", "AD_AUDS", "FORMS", "BRIEFS", "QUOTES", "FEES", "PROJ", "TQ", "SQS", "IB_ITEMS", "NOTES", "PZ", "EV_REGS", "AREAS", "APV", "PB", "SKILLS", "GOV"];
  var OBJECTS = ["AD_BUD", "BRAND_SKIN", "CH_SEED", "ROLE_WORK"];
  var MAPS = ["TILES", "TABLES", "LISTS", "KANBANS"];
  // Nunca se rellenan: acciones sobre ellos tocarían datos reales (papelera, claves, cuentas).
  var SKIP = /^configuracion\/|papelera|apis/;

  function get(n) { try { return (0, eval)("typeof " + n + " !== 'undefined' ? " + n + " : undefined"); } catch (e) { return undefined; } }
  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }

  var snap = {};
  ARRAYS.concat(OBJECTS, MAPS).forEach(function (n) { var v = get(n); if (v !== undefined) snap[n] = clone(v); });

  function emptyVal(v) {
    if (Array.isArray(v)) return v.length === 0 || (v.length && v.every(function (c) { return Array.isArray(c) && c.length === 2 && Array.isArray(c[1]) && c[1].length === 0; }));
    if (v && typeof v === "object" && Array.isArray(v.rows)) return v.rows.length === 0;
    return !v;
  }

  function fill() {
    if (!on) return;
    ARRAYS.forEach(function (n) {
      var cur = get(n), src = snap[n];
      if (Array.isArray(cur) && !cur.length && Array.isArray(src) && src.length) clone(src).forEach(function (x) { cur.push(x); });
    });
    OBJECTS.forEach(function (n) {
      var cur = get(n), src = snap[n];
      if (!cur || !src || typeof cur !== "object") return;
      Object.keys(src).forEach(function (k) {
        if (n === "ROLE_WORK") { if (!cur[k] || !cur[k].length) cur[k] = clone(src[k]); }
        else if (!(k in cur)) cur[k] = clone(src[k]);
      });
    });
    MAPS.forEach(function (n) {
      var cur = get(n), src = snap[n];
      if (!cur || !src) return;
      Object.keys(src).forEach(function (k) {
        if (SKIP.test(k)) return;
        var v = cur[k];
        if (n === "TABLES") { if (v && Array.isArray(v.rows) && !v.rows.length && src[k] && src[k].rows) v.rows = clone(src[k].rows); }
        else if (v === undefined || emptyVal(v)) cur[k] = clone(src[k]);
      });
    });
    var R = window.__musaReal; if (R) R.demoOn = true;
  }

  // Antes de cada pintado: si un módulo quedó vacío con los datos reales, se rellena con el ejemplo.
  var wrapped = false;
  function wrap() {
    if (wrapped || typeof drawView !== "function") return;
    var R = window.__musaReal; if (!R || !R.on) return;
    var d = drawView;
    drawView = function () { try { fill(); } catch (e) {} return d.apply(this, arguments); };
    wrapped = true;
    try { fill(); if (typeof go === "function") go(); } catch (e) {}
  }
  if (on) { var t = setInterval(function () { wrap(); if (wrapped) clearInterval(t); }, 300); setTimeout(function () { clearInterval(t); }, 30000); }

  /* interruptor + aviso */
  var css = document.createElement("style");
  css.textContent = ".mb-demo{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:6px;padding:9px 12px;border-radius:10px;background:transparent;border:1px solid #2a2a2a;color:#bbb;font:600 12px var(--sans);cursor:pointer}"
    + ".mb-demo i{font-style:normal;font-size:10px;padding:2px 8px;border-radius:99px;background:#2a2a2a;color:#999}.mb-demo.on i{background:var(--accent);color:#111}"
    + ".mb-demo-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 -28px 12px;padding:8px 28px;background:var(--accent);color:#111;font:600 12px var(--sans)}"
    + ".mb-demo-bar button{background:#111;color:#fff;border-radius:99px;padding:5px 12px;font:600 11px var(--sans)}"
    + "@media (max-width:860px){.mb-demo-bar{margin:0 -16px 12px;padding:8px 16px}}";
  document.head.appendChild(css);

  function toggle() { try { localStorage.setItem(KEY, on ? "0" : "1"); } catch (e) {} location.reload(); }
  function ui() {
    var out = document.querySelector(".side .mb-out");
    if (out && !document.querySelector(".mb-demo")) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "mb-demo" + (on ? " on" : "");
      b.innerHTML = "<span>Datos de ejemplo</span><i>" + (on ? "Sí" : "No") + "</i>";
      b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(); });
      out.insertAdjacentElement("beforebegin", b);
    }
    var main = document.querySelector(".main"), top = document.querySelector(".main > .top");
    if (on && main && top && !document.querySelector(".mb-demo-bar")) {
      var bar = document.createElement("div");
      bar.className = "mb-demo-bar";
      bar.innerHTML = "<span>Los módulos que aún están vacíos muestran un ejemplo de cómo se verán con tus datos. Desaparece en cuanto creas lo tuyo.</span><button type=\"button\">Ocultar ejemplos</button>";
      bar.querySelector("button").addEventListener("click", toggle);
      top.insertAdjacentElement("afterend", bar);
    }
  }
  new MutationObserver(ui).observe(document.documentElement, { childList: true, subtree: true });
  ui();
})();
