/* bridge-fit.js — Musa en celular y tablet.
 * 1) Menús, desplegables y popups: nunca se salen de la pantalla; si no caben, se deslizan por dentro.
 * 2) Modales: la caja interior se limita al alto visible y scrollea.
 * 3) «Cerrar sesión» en la tarjeta de usuario del menú lateral y en el selector de espacios.
 * No cambia el diseño de la maqueta: solo agrega límites de alto/ancho y scroll cuando hace falta. */
(function () {
  var M = 8; // margen con el borde de la pantalla

  var css = document.createElement("style");
  /* Popups y menús: se sigue pudiendo deslizar, solo desaparece la barra dibujada.
     Es el mismo criterio que la maqueta usa en el menú lateral (.side) y en los rieles
     del editor (.ed-rail, .ve-strip, .fl-bar): scrollbar-width:none + ::-webkit-scrollbar. */
  var BARS = ".mx-box,.ve-modal>*,.fl-modal>*,.ws-pop,.fx-menu,.ed-fly,.ed-mi .sub,.fdd-p,.ev-room,.mbc-flist,[role=menu],[role=listbox]";
  css.textContent = [
    /* popups conocidos: scroll táctil y sin arrastrar el fondo */
    ".ws-pop,.fx-menu,.ed-fly,.ed-mi .sub,.fdd-p{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;max-width:calc(100vw - 16px)}",
    /* modales a pantalla completa: la caja interior scrollea */
    ".ve-modal>*,.fl-modal>*{max-height:calc(100dvh - 24px);max-width:calc(100vw - 24px);overflow:auto;overscroll-behavior:contain}",
    ".mx-box{max-height:calc(100dvh - 32px)}",
    /* El overlay NO se pone scrolleable: si `.mx` y `.mx-box` scrollean a la vez, la caja
       centrada (place-items:center) se desplaza 4px ida y vuelta y el popup tiembla. */
    ".ve-modal,.fl-modal{overflow:auto}",
    BARS + "{scrollbar-width:none;-ms-overflow-style:none}",
    BARS.split(",").map(function (s) { return s.trim() + "::-webkit-scrollbar"; }).join(",") + "{display:none;width:0;height:0}",
    /* ícono de idioma en la barra superior: mismo molde que tema y notificaciones */
    ".mb-lang-code{position:absolute;right:1px;bottom:0;font:700 8px/1 var(--sans);letter-spacing:.02em;color:var(--accent)}",
    ".ev-room{overflow-y:auto;justify-content:safe center}",
    /* encabezados de tarjeta (título + filtro + botón) bajan de línea en pantallas chicas */
    "@media (max-width:860px){.ch{flex-wrap:wrap}.ch input{min-width:0;flex:1 1 140px}}",
    /* cerrar sesión */
    ".mb-out{display:flex;align-items:center;gap:8px;width:100%;margin-top:6px;padding:9px 12px;border-radius:10px;background:transparent;border:1px solid #2a2a2a;color:#bbb;font:600 12px var(--sans);cursor:pointer}",
    ".mb-out:hover{border-color:var(--accent);color:var(--accent)}",
    ".ws-pop .foot a.mb-out-ws{background:transparent;border:1px solid #2a2a2a}",
  ].join("\n");
  document.head.appendChild(css);

  /* ── 1 y 2: ajustar lo flotante ── */
  var MODALES = ".mx,.ve-modal,.fl-modal"; // overlays de la maqueta: solo CSS estático, nunca estilo en línea
  function visible(el) { if (el.hidden) return false; var cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && el.offsetWidth > 0; }
  /* Tolerancia amplia: un overlay sigue siendo overlay aunque NOSOTROS le hayamos movido 8px.
     Si se decidiera por el rect mutabile, nuestro propio write lo degradaría a "flotante".
     Y ahí nace el bucle: top:8px -> max-height:884px -> (se acota) -> sin max-height -> 884px -> ... */
  function coversViewport(r) { return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9; }

  /* Fase de LECTURA: devuelve qué escribir; no toca el DOM (evita intercalar reads/writes,
     que es lo que fuerza layout sincrónico cuadro tras cuadro). */
  function planFloating(el, mayUnclamp) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height || coversViewport(r)) return null;
    var cs = getComputedStyle(el), fixed = cs.position === "fixed", w = [];
    // Alto natural (sin nuestro límite) = tope + todo su contenido.
    var top = Math.max(r.top, M), want = el.scrollHeight + (r.height - el.clientHeight);
    if (r.top < M && fixed) w.push([el, "top", M + "px"]);
    if (top + want > innerHeight - M) {
      w.push([el, "maxHeight", Math.max(140, Math.floor(innerHeight - top - M)) + "px"]);
      w.push([el, "overflowY", "auto"]);
      w.push([el, "overscrollBehavior", "contain"]);
    } else if (mayUnclamp && el.style.maxHeight && el.dataset.mbFit) {
      /* Solo se destraba en resize: por mutación, el alto ya limitado haría que `want` entre
         y salga de la condición en pasadas alternadas (temblor a ~58Hz medido). */
      w.push([el, "maxHeight", ""]);
    }
    if (r.right > innerWidth - M && fixed) {
      w.push([el, "left", Math.max(M, Math.floor(innerWidth - M - r.width)) + "px"]);
      w.push([el, "right", "auto"]);
    }
    return w.length ? w : null;
  }

  // Modal = capa fija que llena la pantalla con UNA caja centrada: se limita la caja, nunca el overlay.
  function planOverlay(el) {
    if (el.children.length !== 1) return null;
    var box = el.firstElementChild, b = box.getBoundingClientRect();
    if (box.scrollHeight <= innerHeight - 24 && b.top >= 0) return null;
    return [[box, "maxHeight", "calc(100dvh - 24px)"], [box, "overflowY", "auto"], [box, "overscrollBehavior", "contain"]];
  }

  var SEL = ".ws-pop,.fx-menu,.ed-fly,.ed-mi .sub,.fdd-p,.fdd.open .fdd-p,[role=menu],[role=listbox],[role=dialog]";
  function scan(reason) {
    var plans = [], seen = new Set();
    document.querySelectorAll(SEL).forEach(function (el) {
      seen.add(el);
      if (visible(el) && !el.closest(MODALES)) { var p = planFloating(el, reason === "resize"); if (p) plans.push(p); }
    });
    // Flotantes creados por los bridges con estilo en línea (menús contextuales, popups).
    var all = document.body.querySelectorAll("body > *, [style*='position: fixed'], [style*='position:fixed'], [style*='position: absolute']");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (seen.has(el) || el.id === "mb-load" || el.tagName === "SCRIPT" || el.tagName === "STYLE" || !visible(el)) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      var z = parseInt(cs.zIndex, 10) || 0;
      if (z < 50 || el.classList.contains("side") || el.classList.contains("scrim") || el.classList.contains("tip")) continue;
      var p = coversViewport(el.getBoundingClientRect()) ? planOverlay(el) : planFloating(el, reason === "resize");
      if (p) plans.push(p);
    }
    /* Fase de ESCRITURA: todas las lecturas ya pasaron; ahora se aplica y se marca lo tocado. */
    for (var k = 0; k < plans.length; k++) for (var j = 0; j < plans[k].length; j++) { var w = plans[k][j]; set(w[0], w[1], w[2]); }
    sweepSoon();
  }

  /* Nuestras propias mutaciones de estilo no deben re-disparar el observer. Se conserva "style"
     en el filtro (los cambios de estilo de terceros sí se siguen viendo) y se ignora por marca. */
  var writes = new Set(), sweeping = false;
  function set(el, k, v) {
    if (el.style[k] === v) return;
    el.dataset.mbFitWriting = "1"; writes.add(el);
    el.style[k] = v; el.dataset.mbFit = "1";
  }
  function sweepSoon() {
    if (sweeping || !writes.size) return; sweeping = true;
    // Macrotarea: corre DESPUÉS de que el MutationObserver entregue los registros de esta pasada.
    setTimeout(function () { sweeping = false; writes.forEach(function (el) { delete el.dataset.mbFitWriting; }); writes.clear(); }, 0);
  }
  function isOurs(r) { return r.type === "attributes" && r.attributeName === "style" && (writes.has(r.target) || (r.target.dataset && r.target.dataset.mbFitWriting === "1")); }

  /* Debounce SOLO por mutación; un resize necesita respuesta inmediata (si no, el menú queda
     fuera de pantalla mientras se arrastra la ventana).
     Es throttle con pasada final, NO debounce puro: el fondo re-renderiza el dashboard a
     135-235 mutaciones/s medidos y reiniciar el timer cada vez nunca dejaría ajustar un menú. */
  var DEBOUNCE_MS = 120, timer = null, frame = null;
  function drop() { if (timer !== null) { clearTimeout(timer); timer = null; } if (frame !== null) { cancelAnimationFrame(frame); frame = null; } }
  function soon(delay) {
    if (delay) { if (timer === null && frame === null) timer = setTimeout(flush, DEBOUNCE_MS); return; }
    if (frame !== null) return;
    if (timer !== null) { clearTimeout(timer); timer = null; } // clic: se adelanta lo pendiente
    frame = requestAnimationFrame(flush);
  }
  function flush() { drop(); try { scan(); } catch (e) { /* nunca romper la app */ } }
  function now() { drop(); try { scan("resize"); } catch (e) { /* nunca romper la app */ } }
  new MutationObserver(function (rs) {
    for (var i = 0; i < rs.length; i++) if (!isOurs(rs[i])) return soon(DEBOUNCE_MS);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style", "open"] });
  addEventListener("resize", now);
  if (window.visualViewport) visualViewport.addEventListener("resize", now);
  document.addEventListener("click", function () { soon(0); }, true);

  /* ── Menú lateral en celular/tablet: tocar un módulo lo despliega (no cierra el menú ni salta a su
   * primera sección), así se ven y se eligen todas sus secciones. En escritorio no cambia nada. */
  document.addEventListener("click", function (e) {
    if (!matchMedia("(max-width:860px)").matches) return;
    var mh = e.target.closest && e.target.closest("#nav .mod:not(.nav-ed) > .mod-h");
    if (!mh || e.target.closest(".caret")) return;
    var caret = mh.querySelector(".caret");
    if (!caret) return;
    e.preventDefault(); e.stopPropagation();
    caret.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, true);

  /* ── 3: cerrar sesión ── */
  function signOut() {
    if (!confirm("¿Cerrar sesión en Musa?")) return;
    var b = parent && parent.__musaBridge;
    if (b && typeof b.signOut === "function") b.signOut();
    else { try { parent.localStorage.clear(); } catch (e) { /* sin acceso */ } parent.location.href = "/"; }
  }
  /* Idioma: un ícono en la barra superior, junto a tema y notificaciones. Antes era la fila
   * «IDIOMA EN|ES» del menú lateral; habiendo dos idiomas el botón ya decide por sí solo el
   * siguiente, así que alcanza con el globo que muestra el activo. */
  function addLangIcon() {
    if (!window.musaI18n || document.querySelector(".top .mb-lang")) return;
    var top = document.querySelector(".top"), theme = document.getElementById("themeBtn");
    if (!top || !theme) return;
    var L = musaI18n.langs || ["en", "es"], cur = musaI18n.lang;
    var next = L[(L.indexOf(cur) + 1) % L.length], names = { en: "English", es: "Español" };
    var b = document.createElement("button");
    b.type = "button"; b.className = "icon-btn mb-lang"; b.setAttribute("data-no-i18n", "");
    b.title = (cur === "es" ? "Idioma: " : "Language: ") + names[cur] + " · " + (cur === "es" ? "cambiar a " : "switch to ") + names[next];
    b.setAttribute("aria-label", b.title);
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg><span class="mb-lang-code">' + cur.toUpperCase() + "</span>";
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); musaI18n.set(next); });
    theme.insertAdjacentElement("beforebegin", b);
  }
  function addButtons() {
    addLangIcon();
    var foot = document.querySelector(".side-foot.me");
    if (foot && !document.querySelector(".side .mb-out")) {
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "mb-out";
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>Cerrar sesión';
      btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); signOut(); });
      foot.insertAdjacentElement("afterend", btn);
    }
    var wsf = document.querySelector(".ws-pop .foot");
    if (wsf && !wsf.querySelector(".mb-out-ws")) {
      var a = document.createElement("a");
      a.href = "#"; a.className = "mb-out-ws"; a.textContent = "Cerrar sesión";
      a.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); signOut(); });
      wsf.appendChild(a);
    }
  }
  addButtons();
  var abFrame = null;
  new MutationObserver(function () {
    if (abFrame !== null) return;
    abFrame = requestAnimationFrame(function () { abFrame = null; try { addButtons(); } catch (e) { /* sin botones */ } });
  }).observe(document.body, { childList: true, subtree: true });
})();
