/* ═══════════════════════════════════════════════════════════════════════════
   bridge-account.js — La cuenta vive en UN solo lugar del lateral, estilo
   Notion: el chip superior muestra tu nombre y tu espacio, y al abrirlo el
   desplegable reúne todo —
     · tu identidad (avatar, nombre, correo, rol · perfil),
     · TODOS tus espacios: el personal (privado, solo tú) y los de agencia
       (bridge-profile deja de podar la lista; al cambiar de espacio la
       plataforma entera carga los archivos de ese workspace — wsSwitch),
     · «Invitar personas»: con plan Agencia/Empresa/Ilimitado lleva a
       Configuración › Equipo; con plan base (Freelance) muestra el upsell,
     · «Crear espacio»: mismo gate, salta a Espacios y planes donde se crean
       espacios de agencia nuevos (bridge-team hace el POST),
     · «Espacios y planes» (bridge-billing) y «Cerrar sesión» (bridge-fit).
   La tarjeta de abajo y el botón suelto se ocultan SOLO en modo real: la
   maqueta de ejemplo no se toca (sin puente todo sigue igual).
   El encabezado y la fila de invitación se agregan observando wsPop en vez de
   envolver wsPopDraw, así no depende del orden en que cargan los puentes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  function RB() { return window.__musaReal || null; }
  function bridgeObj() { try { return (window.parent !== window && window.parent.__musaBridge) || null; } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function injectCss() {
    if (document.getElementById("mbAcctCss")) return;
    var st = document.createElement("style");
    st.id = "mbAcctCss";
    st.textContent = [
      /* el chip superior es la cuenta; la tarjeta y el botón suelto salen del lateral */
      ".side .side-foot.me,.side .mb-out{display:none!important}",
      /* nombre y espacio no desbordan el chip */
      ".side .ws>div{min-width:0;flex:1}",
      ".side .ws b,.side .ws small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      /* encabezado de identidad dentro del desplegable */
      ".ws-pop .who.mb-acct{display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px}",
      ".mb-acct-av{width:34px;height:34px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:600;font-size:13px;flex:none}",
      ".mb-acct-tx{min-width:0;display:flex;flex-direction:column;gap:2px}",
      ".mb-acct-tx b{color:#e8e8e8;font-weight:600;font-size:13px}",
      ".mb-acct-tx small{color:#7d7d7d;font-size:11px}",
      ".mb-acct-tx small.mb-acct-meta{color:#999}",
      ".mb-acct-tx b,.mb-acct-tx small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      /* acciones del desplegable en columna: Invitar / Espacios y planes / Cerrar sesión */
      ".ws-pop .foot.mb-foot-col{display:flex;flex-direction:column;gap:4px}",
      ".ws-pop .foot.mb-foot-col a{flex:none;display:flex;align-items:center;gap:8px;padding:9px 10px;border:0;border-radius:9px;background:transparent;color:#ccc;font-weight:600;font-size:12px;text-align:left}",
      ".ws-pop .foot.mb-foot-col a:hover{background:#1f1f1f;color:#fff}",
      ".ws-pop .foot.mb-foot-col a svg{flex:none;color:#8a8a8a}",
      /* upsell de invitación para cuentas en el plan base (Freelance) */
      ".mb-upsell{display:flex;align-items:center;gap:10px;margin-top:8px;padding:10px;border:1px solid rgba(255,94,0,.45);background:rgba(255,94,0,.08);border-radius:10px}",
      ".mb-upsell div{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}",
      ".mb-upsell b{color:#ffb08a;font:700 12px var(--sans)}",
      ".mb-upsell small{color:#999;font:500 11px var(--sans)}",
      ".mb-upsell button{flex:none;background:var(--accent);color:#111;border:0;border-radius:8px;padding:8px 12px;font:700 12px var(--sans);cursor:pointer}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function persona() { try { return PERSONAS[WSX.persona] || null; } catch (e) { return null; } }
  function curWs() { try { return WSS[WSX.cur] || null; } catch (e) { return null; } }
  function planColor(w) { try { return (PLAN[w && w.plan] && PLAN[w.plan][1]) || "#333"; } catch (e) { return "#333"; } }
  function rolTxt() { try { return myRole() || ""; } catch (e) { return ""; } }

  /* plan de la cuenta — mismo criterio que bridge-billing: Agencia, Empresa e
     Ilimitado pueden invitar personas y crear espacios; el plan base
     (Freelance) ve el upsell */
  var planTier = null;
  function loadPlan() {
    if (planTier) return;
    var b = bridgeObj();
    if (!b || !b.api) { planTier = "gratis"; return; }
    planTier = "gratis"; /* respaldo mientras llega la respuesta real */
    try {
      b.api("/rest/v1/rpc/v2_my_plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { planTier = (r && r.tier) || "gratis"; }, function () { /* sin billing: queda base */ });
    } catch (e) { planTier = "gratis"; }
  }
  function canInvite() { return planTier === "agencia" || planTier === "empresa" || planTier === "ilimitado"; }

  /* el chip superior: tu cuenta + tu espacio en una sola pieza. En tu espacio
     personal el nombre ya está en la línea de arriba, así que abajo va el plan */
  function acctChip() {
    if (!(RB() && RB().on)) return;
    var pe = persona(), w = curWs();
    if (!pe || !w) return;
    var pill = document.querySelector(".side .ws");
    if (!pill) return;
    injectCss();
    var rol = rolTxt();
    var parts = w.plan === "personal" ? [w.tier, rol] : [w.name, w.tier, rol];
    pill.innerHTML =
      '<i style="background:' + planColor(w) + '">' + esc(pe.ini) + "</i>" +
      "<div><b>" + esc(pe.name) + "</b><small>" + parts.filter(Boolean).map(esc).join(" · ") + "</small></div>" +
      '<svg class="ws-car" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 10 5 5 5-5"/></svg>';
  }

  /* el desplegable abre con tu identidad arriba y la fila de invitación */
  function acctWho() {
    if (!(RB() && RB().on)) return;
    var pe = persona(), w = curWs();
    if (!pe) return;
    injectCss();
    var rol = rolTxt();
    var perfil = (document.getElementById("roleLbl") || {}).textContent || "";
    var meta = [rol, perfil].filter(Boolean).join(" · ");
    var html =
      '<i class="mb-acct-av" style="background:' + planColor(w) + '">' + esc(pe.ini) + "</i>" +
      '<div class="mb-acct-tx"><b>' + esc(pe.name) + "</b>" +
      (pe.sub ? "<small>" + esc(pe.sub) + "</small>" : "") +
      (meta ? '<small class="mb-acct-meta">' + esc(meta) + "</small>" : "") +
      "</div>";
    /* idempotente: si ya está, solo refresca (sin reinsertar no hay bucle de observer) */
    var d = wsPop.querySelector(".who.mb-acct");
    if (d) { if (d.innerHTML !== html) d.innerHTML = html; }
    else {
      var viejo = wsPop.querySelector(".who");
      if (viejo) viejo.remove();
      d = document.createElement("div");
      d.className = "who mb-acct";
      d.innerHTML = html;
      wsPop.insertBefore(d, wsPop.firstChild);
    }
    /* «Invitar personas» arriba de las acciones (Espacios y planes / Cerrar sesión) */
    var foot = wsPop.querySelector(".foot");
    if (foot && !foot.querySelector("[data-mbinvite]")) {
      foot.classList.add("mb-foot-col");
      var inv = document.createElement("a");
      inv.href = "#";
      inv.setAttribute("data-mbinvite", "");
      inv.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>Invitar personas';
      foot.insertBefore(inv, foot.firstChild);
    }
    /* «Crear espacio» junto a Invitar: mismo gate, lleva a Espacios y planes
       donde bridge-team pinta el alta de espacios de agencia */
    if (foot && canInvite() && !foot.querySelector("[data-mbwsnew]")) {
      var nw = document.createElement("a");
      nw.href = "#";
      nw.setAttribute("data-mbwsnew", "");
      nw.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>Crear espacio';
      var invRow = foot.querySelector("[data-mbinvite]");
      if (invRow) invRow.insertAdjacentElement("afterend", nw); else foot.appendChild(nw);
    }
  }

  function whenReady(fn, tries) {
    if (typeof wsCard === "function" && typeof wsPopDraw === "function" && typeof wsPop !== "undefined" && wsPop && document.querySelector(".ws")) return fn();
    if ((tries || 0) > 60) return;
    setTimeout(function () { whenReady(fn, (tries || 0) + 1); }, 100);
  }

  whenReady(function () {
    /* cada repintado del chip (arranque, cambio de espacio, sync de plan en billing) pasa por acá */
    var _wsCard = wsCard;
    wsCard = function () { var r = _wsCard.apply(this, arguments); try { acctChip(); } catch (e) { /* el chip no frena la app */ } return r; };

    loadPlan();

    /* el popup se dibuja al abrirse: cuando ya es visible y quedó podado por
       bridge-profile, se agrega la identidad y la fila de invitación. */
    new MutationObserver(function () {
      if (wsPop.hidden) return;
      try { acctWho(); } catch (e) { /* sin encabezado, el popup sigue igual */ }
    }).observe(wsPop, { attributes: true, attributeFilter: ["hidden"], childList: true });

    /* Invitar personas: con Agencia/Empresa lleva a Configuración › Equipo;
       con plan base (Freelance) muestra el upsell con salto a Espacios y planes. */
    wsPop.addEventListener("click", function (e) {
      var t = e.target;
      var inv = t.closest ? t.closest("[data-mbinvite]") : null;
      var up = t.closest ? t.closest("[data-mbupsell]") : null;
      var wn = t.closest ? t.closest("[data-mbwsnew]") : null;
      if (wn) {
        e.preventDefault(); e.stopPropagation();
        wsPop.hidden = true;
        location.hash = "configuracion/espacios";
        return;
      }
      if (inv) {
        e.preventDefault(); e.stopPropagation();
        if (canInvite()) { wsPop.hidden = true; location.hash = "configuracion/equipo"; return; }
        var box = wsPop.querySelector(".mb-upsell");
        if (box) { box.remove(); return; }
        box = document.createElement("div");
        box.className = "mb-upsell";
        box.innerHTML = '<div><b>Invitar a tu equipo es del plan Agencia</b><small>5 personas, roles de equipo y portal de clientes. Tu espacio personal queda privado, solo tuyo.</small></div><button type="button" data-mbupsell>Ver planes</button>';
        var foot = wsPop.querySelector(".foot");
        if (foot) foot.insertAdjacentElement("afterend", box); else wsPop.appendChild(box);
        return;
      }
      if (up) {
        e.preventDefault(); e.stopPropagation();
        wsPop.hidden = true;
        location.hash = "configuracion/espacios";
      }
    });
  });
})();
