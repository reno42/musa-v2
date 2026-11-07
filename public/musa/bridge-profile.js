/* ═══════════════════════════════════════════════════════════════════════════
   bridge-profile.js — El perfil de trabajo se elige en Configuración, no en el
   menú. Dos cosas:
   1. Oculta el <select id="role"> invisible que vive sobre el avatar (era lo
      que abría el dropdown nativo que mareaba). El mecanismo sigue igual:
      asClient() y el botón «volver» del portal lo cambian por código.
   2. Inyecta la tarjeta «Tu perfil de trabajo» en Configuración › Cuenta con
      el mismo selector, descripciones claras y la nota de que no cambia datos.
   Nota del dueño (2026-11-05): el onboarding para elegir perfil se decide
   después; hoy el lugar del control es Configuración › Cuenta.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  function RB() { return window.__musaReal || null; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* Texto claro por rol: para qué sirve, sin jerga. */
  var PROFILE_INFO = {
    global: ["Global · uso todo", "Ves todo el menú y aterrizas en Inicio › Resumen. Es el perfil por defecto y el que usan dueño y admins."],
    disenador: ["Diseñador", "Aterrizas en Crear › Diseños, con Crear y Planear fijados arriba."],
    motion: ["Motion designer", "Aterrizas en Crear › Videos, con Crear y Planear fijados arriba."],
    video: ["Editor de video", "Aterrizas en Crear › Videos, con Crear y Planear fijados arriba."],
    copy: ["Copywriter", "Aterrizas en Planear › Calendario, con Planear y Crear fijados arriba."],
    community: ["Community manager", "Aterrizas en Conversar › Bandeja, con Conversar, Planear y Crear fijados arriba."],
    automatizador: ["Automatizador", "Aterrizas en Crear › Automatizaciones, con Crear, Configuración y Medir fijados arriba."],
    cuentas: ["Ejecutivo de cuentas", "Aterrizas en Planear › Briefs, con Clientes, Vender y Planear fijados arriba."],
    cliente: ["Cliente · portal", "Ves la app como un cliente invitado: solo el portal de su marca para aprobar piezas, ver calendario y descargar entregables."]
  };

  function injectCss() {
    if (document.getElementById("mbProfileCss")) return;
    var st = document.createElement("style");
    st.id = "mbProfileCss";
    st.textContent = ".side-foot.me select#role,.side-foot.me .caret{display:none!important}.side-foot.me{cursor:default}";
    document.head.appendChild(st);
  }

  /* Tarjeta en Configuración › Cuenta (mismo patrón que las tarjetas de growth). */
  function profileCard() {
    var body = document.getElementById("body");
    if (!body || document.getElementById("mbProfile")) return;
    var sel = document.getElementById("role");
    if (!sel) return;
    var cur = sel.value || "global";
    var box = document.createElement("div");
    box.id = "mbProfile";
    box.className = "grid";
    box.style.marginTop = "14px";
    var opts = Object.keys(PROFILE_INFO).map(function (id) {
      return '<option value="' + id + '"' + (id === cur ? " selected" : "") + ">" + esc(PROFILE_INFO[id][0]) + "</option>";
    }).join("");
    box.innerHTML =
      '<article class="card c12"><div class="ch"><h3>Tu perfil de trabajo</h3>' +
      '<small>Define dónde aterrizas al abrir Musa y qué módulos quedan fijados. No cambia tus datos ni tu espacio.</small></div>' +
      '<div class="fx-row" style="grid-template-columns:280px auto;align-items:end;margin-top:12px">' +
      '<div><label class="fx-lbl">Perfil</label><select class="fx-in" id="mbRoleSel">' + opts + "</select></div>" +
      '<div class="ag-ctl"><button class="pri" data-mbrole id="mbRoleGo">Aplicar perfil</button></div></div>' +
      '<p class="lp-obj" style="margin-top:10px" id="mbRoleDesc">' + esc(PROFILE_INFO[cur] ? PROFILE_INFO[cur][1] : "") + "</p>" +
      '<small style="display:block;color:var(--muted);margin-top:8px">«Cliente · portal» es solo una vista de prueba: los clientes reales entran con su propia cuenta y ven únicamente su portal.</small>' +
      "</article>";
    body.appendChild(box);
    var s = box.querySelector("#mbRoleSel");
    s.onchange = function () { box.querySelector("#mbRoleDesc").textContent = PROFILE_INFO[s.value] ? PROFILE_INFO[s.value][1] : ""; };
    box.querySelector("[data-mbrole]").onclick = function () {
      if (s.value === cur) return;
      sel.value = s.value;
      sel.onchange();               // el mecanismo original: guarda, re-fija el menú y navega al home del perfil
    };
  }

  function whenReady(fn, tries) {
    if (typeof drawView === "function" && document.getElementById("role")) return fn();
    if ((tries || 0) > 60) return;
    setTimeout(function () { whenReady(fn, (tries || 0) + 1); }, 100);
  }

  whenReady(function () {
    injectCss();

    /* Selector de espacios: el desplegable de la cuenta (bridge-account) lista
       TODOS tus espacios — el personal y los de agencia — con sus grupos
       (PERSONAL/AGENCIA/…), así que el podado se limita a quitar «Ver como»
       (el cambio de persona es cosa de la maqueta demo) y «+ Crear espacio».
       «Espacios y planes» queda (entrada al plan/billing), «Invitar personas»
       y «Cerrar sesión» las agrega bridge-account/bridge-fit. */
    function pruneWsPop() {
      try {
        if (!(RB() && RB().on)) return;
        var who = wsPop.querySelector(".who"); if (who) who.remove();
        wsPop.querySelectorAll(".foot a").forEach(function (a) {
          if ((a.textContent || "").indexOf("Crear espacio") >= 0) a.remove();
        });
      } catch (e) {}
    }
    if (typeof wsPopDraw === "function") {
      var _wpd = wsPopDraw;
      wsPopDraw = function () { var r = _wpd.apply(this, arguments); pruneWsPop(); return r; };
    }

    var _dv = drawView;
    drawView = function () {
      var r = _dv.apply(this, arguments);
      try {
        var onConfig = typeof route !== "undefined" && route && route.mod === "configuracion" && route.sub === "cuenta";
        if (onConfig) profileCard(); else { var old = document.getElementById("mbProfile"); if (old) old.remove(); }
      } catch (e) {}
      return r;
    };
  });
})();
