/* bridge-demo.js — ejemplos de la maqueta para los pocos módulos que no tienen datos sembrados.
 * Desde 2026-11-09 (pedido del usuario) ya NO hay botón «Datos de ejemplo»: cada espacio nace con ejemplos REALES
 * en la base (migración 36, seedDemo en bridge.js) que se editan, se guardan y se borran como cualquier dato.
 * Aquí solo quedan, siempre encendidos, los ejemplos visuales de lo que no se puede sembrar como fila (videos,
 * tomas, clones y motion necesitan archivos; investigación, tareas de agentes, audiencias y presupuestos de ads
 * vienen de servicios externos). Se ven solo mientras ese módulo está vacío y no escriben nada en la base.
 * Tiene que cargar antes de que bridge.js vacíe los arreglos (bridge.js los vacía después de pedir datos a la red). */
(function () {
  try { localStorage.removeItem("musa-demo"); } catch (e) {}

  // Nombres globales de la maqueta que siguen mostrando su ejemplo cuando están vacíos.
  var ARRAYS = ["TQ", "AD_AUDS", "SKILLS"];
  var OBJECTS = ["AD_BUD", "CH_SEED", "ROLE_WORK"];
  var MAP_KEYS = { TILES: ["crear/videos", "crear/motion", "crear/tomas", "crear/clones"], LISTS: ["planear/investigacion"], TABLES: ["automatizar/historial"] };

  function get(n) { try { return (0, eval)("typeof " + n + " !== 'undefined' ? " + n + " : undefined"); } catch (e) { return undefined; } }
  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }

  var snap = {};
  ARRAYS.concat(OBJECTS, Object.keys(MAP_KEYS)).forEach(function (n) { var v = get(n); if (v !== undefined) snap[n] = clone(v); });

  function fill() {
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
    Object.keys(MAP_KEYS).forEach(function (n) {
      var cur = get(n), src = snap[n];
      if (!cur || !src) return;
      MAP_KEYS[n].forEach(function (k) {
        var v = cur[k];
        if (n === "TABLES") { if (v && Array.isArray(v.rows) && !v.rows.length && src[k] && src[k].rows) v.rows = clone(src[k].rows); }
        else if (Array.isArray(src[k]) && (v === undefined || (Array.isArray(v) && !v.length))) cur[k] = clone(src[k]);
      });
    });
  }

  // Antes de cada pintado: si uno de esos módulos quedó vacío con los datos reales, se rellena con el ejemplo.
  var wrapped = false;
  function wrap() {
    if (wrapped || typeof drawView !== "function") return;
    var R = window.__musaReal; if (!R || !R.on) return;
    var d = drawView;
    drawView = function () { try { fill(); } catch (e) {} return d.apply(this, arguments); };
    wrapped = true;
    try { fill(); if (typeof go === "function") go(); } catch (e) {}
  }
  var t = setInterval(function () { wrap(); if (wrapped) clearInterval(t); }, 300);
  setTimeout(function () { clearInterval(t); }, 30000);
})();
