/* bridge-photo-code.js — la foto ES código y el código ES la foto.
 *  · Panel «</> Código» en el editor de fotos: el código Musa Photo de la foto, en vivo en los dos sentidos
 *    (mueves un control → cambia el código; escribes → cambia la foto). Pestañas: foto.js · fuente (si la foto
 *    nace de código, con sus números como controles y el instante elegido) · JSON.
 *  · Pegar cualquier código (CSS filter, canvas, Three.js, p5, shader, SVG, HTML, Python, sharp, Jimp, ImageMagick):
 *    lo que son ajustes queda como controles; lo que es un programa queda como fuente de código.
 *  · Crear › Fotos › «Desde código», y pasos con un clic a Diseño y a Video (la foto sigue editable allá).
 *  · Las fotos «por pintar» (las cambió una IA por MCP) se dibujan solas al verlas.
 */
(function boot(n) {
  "use strict";
  var X = window.__phx, RB = window.__musaReal, PC = window.MusaPhotoCode, ML = window.MusaVideoLive;
  if (!X || !X.ready || !RB || !window.__musaFotos) { if ((n || 0) < 900) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (X.code) return;
  var esc = X.esc, say = X.say, errOf = X.errOf, api = X.api, jreq = X.jreq, FO = window.__musaFotos;
  var LANGS = { js: "JavaScript", html: "HTML", svg: "SVG", py: "Python", glsl: "GLSL" };

  /* ═════════════ panel ═════════════ */
  var CP = { el: null, ta: null, st: null, tab: "js", dirty: false, t: null, busy: false, vt: null };
  var css = document.createElement("style");
  css.textContent = "#phCode{position:absolute;left:8px;top:8px;bottom:8px;width:min(540px,52%);z-index:41;display:flex;flex-direction:column;background:#141414;border:1px solid #333;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);color:#ddd;font:12px/1.5 'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace}"
    + "#phCode[hidden]{display:none}#phCode header{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a2a;font:600 12px/1.2 Inter,system-ui,sans-serif;flex-wrap:wrap}#phCode header .tabs{display:flex;gap:2px;flex:1;min-width:150px}"
    + "#phCode button{background:#262626;border:1px solid #3a3a3a;color:#eee;border-radius:6px;height:26px;padding:0 8px;cursor:pointer;font:600 12px Inter,system-ui,sans-serif}#phCode button.on{background:#ff5e00;border-color:#ff5e00}#phCode button:focus-visible{outline:2px solid #ff5e00;outline-offset:1px}"
    + "#phCode textarea{flex:1;min-height:80px;resize:none;background:#0d0d0d;color:#e6e6e6;border:0;padding:10px;font:inherit;outline:none;white-space:pre;tab-size:2}"
    + "#phCode footer{padding:6px 10px;border-top:1px solid #2a2a2a;font:11px/1.35 Inter,system-ui,sans-serif;color:#aaa;max-height:84px;overflow:auto}#phCode footer.er{color:#ff8a70}"
    + "#phCodeSrc{border-bottom:1px solid #2a2a2a;padding:8px 10px;display:grid;gap:6px;font:11px/1.3 Inter,system-ui,sans-serif;max-height:38%;overflow:auto}#phCodeSrc[hidden]{display:none}"
    + "#phCodeSrc .r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#phCodeSrc input[type=number]{width:70px;height:24px;background:#0d0d0d;border:1px solid #3a3a3a;border-radius:5px;color:#fff;padding:0 6px;font:inherit}#phCodeSrc input[type=range]{flex:1;min-width:90px;accent-color:#ff5e00}#phCodeSrc select{height:24px;background:#0d0d0d;border:1px solid #3a3a3a;border-radius:5px;color:#fff;font:inherit}"
    + "#phCodeSrc .v{display:grid;grid-template-columns:minmax(70px,120px) 1fr 58px;gap:6px;align-items:center}#phCodeSrc .v span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bbb}#phCodeSrc .v output{text-align:right;color:#fff;font-variant-numeric:tabular-nums}"
    + "#phCodeBtn{margin-left:4px}"
    + "@media (max-width:760px){#phCode{left:0;right:0;top:auto;bottom:0;width:auto;height:58%;border-radius:12px 12px 0 0}}";
  document.head.appendChild(css);

  function build() {
    if (CP.el) return;
    var host = phStage.parentNode; if (getComputedStyle(host).position === "static") host.style.position = "relative";
    CP.el = document.createElement("section"); CP.el.id = "phCode"; CP.el.hidden = true; CP.el.setAttribute("aria-label", "Código de la foto");
    CP.el.innerHTML = '<header><div class="tabs" role="tablist"><button type="button" role="tab" data-pc-tab="js">foto.js</button><button type="button" role="tab" data-pc-tab="src" hidden>fuente</button><button type="button" role="tab" data-pc-tab="json">JSON</button></div>'
      + '<button type="button" data-pc="apply" title="Ctrl+Enter">Aplicar</button><button type="button" data-pc="paste" title="Pegar código de otro lugar (CSS, canvas, Python, SVG…)">Pegar código…</button><button type="button" data-pc="copy">Copiar</button><button type="button" data-pc="close" aria-label="Cerrar">×</button></header>'
      + '<div id="phCodeSrc" hidden></div><textarea spellcheck="false" aria-label="Código de la foto"></textarea><footer aria-live="polite"></footer>';
    host.appendChild(CP.el);
    CP.ta = CP.el.querySelector("textarea"); CP.st = CP.el.querySelector("footer"); CP.src = CP.el.querySelector("#phCodeSrc");
    ["pointerdown", "wheel", "dblclick"].forEach(function (ev) { CP.el.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    CP.el.addEventListener("keydown", function (e) { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); apply(true); } if (e.key === "Tab" && e.target === CP.ta) { e.preventDefault(); CP.ta.setRangeText("  ", CP.ta.selectionStart, CP.ta.selectionEnd, "end"); CP.ta.dispatchEvent(new Event("input")); } if (e.key === "Escape") { e.preventDefault(); close(); } });
    CP.el.addEventListener("keyup", function (e) { e.stopPropagation(); });
    CP.ta.addEventListener("input", function () { CP.dirty = true; clearTimeout(CP.t); status("Escribiendo…"); CP.t = setTimeout(function () { apply(false); }, 900); });
    CP.ta.addEventListener("paste", function (e) {
      /* pegar código de otro dialecto sobre todo el texto: se convierte en vez de romper el código de la foto */
      var txt = (e.clipboardData && e.clipboardData.getData("text")) || ""; if (!txt || CP.tab === "src") return;
      var all = CP.ta.selectionStart === 0 && CP.ta.selectionEnd === CP.ta.value.length, k = PC.detect(txt).kind;
      if (k !== "musa" && k !== "json" && k !== "unknown" && k !== "empty" && (all || !CP.ta.value.trim())) { e.preventDefault(); importText(txt); }
    });
    CP.el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-pc],[data-pc-tab]"); if (!b) return;
      if (b.dataset.pcTab) { if (CP.dirty) apply(true); CP.tab = b.dataset.pcTab; CP.dirty = false; return refresh(true); }
      var k = b.dataset.pc;
      if (k === "close") return close();
      if (k === "apply") return apply(true);
      if (k === "paste") return codeDialog();
      if (k === "copy") { var t = CP.ta.value; try { navigator.clipboard.writeText(t).then(function () { say("Código copiado"); }, function () { CP.ta.select(); document.execCommand("copy"); say("Código copiado"); }); } catch (er) { CP.ta.select(); document.execCommand("copy"); } }
    });
    CP.src.addEventListener("input", onSrcInput);
    CP.src.addEventListener("change", onSrcInput);
  }
  function status(m, er) { if (!CP.st) return; CP.st.textContent = m; CP.st.classList.toggle("er", !!er); }
  function srcNow() { var s = X.st(); return s.source && s.source.kind === "code" ? s.source : null; }
  function textFor(tab) { var d = X.docNow(); if (tab === "json") return PC.toJSON(d); if (tab === "src") { var s = srcNow(); return s ? s.code : ""; } return PC.toCode(d); }
  function open(tab) {
    build(); if (!PH.open || !PH.r) return;
    if (tab) CP.tab = tab;
    CP.el.hidden = false; CP.dirty = false; refresh(true);
    var b = document.getElementById("phCodeBtn"); if (b) b.classList.add("on");
  }
  function close() { if (!CP.el || CP.el.hidden) return; if (CP.dirty) apply(true); CP.el.hidden = true; var b = document.getElementById("phCodeBtn"); if (b) b.classList.remove("on"); }
  function isOpen() { return !!(CP.el && !CP.el.hidden); }
  function refresh(force) {
    if (!isOpen() || !PH.open || !PH.r || !PH.src) return;
    var s = srcNow(), tb = CP.el.querySelector('[data-pc-tab="src"]');
    tb.hidden = !s; if (s) tb.textContent = "fuente · " + LANGS[s.lang];
    if (!s && CP.tab === "src") CP.tab = "js";
    [].forEach.call(CP.el.querySelectorAll("[data-pc-tab]"), function (x) { x.classList.toggle("on", x.dataset.pcTab === CP.tab); x.setAttribute("aria-selected", x.dataset.pcTab === CP.tab ? "true" : "false"); });
    drawSrc(force);
    if (CP.dirty || CP.busy) return;
    var code = textFor(CP.tab);
    if (code !== CP.ta.value) {
      var top = CP.ta.scrollTop, pos = CP.ta.selectionStart, foc = document.activeElement === CP.ta;
      CP.ta.value = code; CP.ta.scrollTop = top;
      if (foc) try { CP.ta.selectionStart = CP.ta.selectionEnd = Math.min(pos, code.length); } catch (e) { /* sin cursor */ }
    }
    if (force || !CP.st.textContent || /^(Escribiendo|Aplicado)/.test(CP.st.textContent)) {
      var er = X.st().codeErr;
      status(er ? "El código de la fuente falló: " + er : CP.tab === "src" ? "El código que dibuja la foto. Cambia sus números con los controles de arriba o escribe aquí: se vuelve a dibujar solo." : CP.tab === "json" ? "El mismo documento en JSON (lo que guarda Musa y lo que lee una IA por MCP)." : "En vivo: lo que mueves en el editor aparece aquí y lo que escribes aquí cambia la foto (Ctrl+Enter aplica ya).", !!er);
    }
  }
  /* controles de la fuente de código: lienzo, instante y cada número del código */
  function valuesOf(s) {
    try {
      if ((s.lang === "js" || s.lang === "html") && ML.codeValues) {
        var out = ML.codeValues(s.code).filter(function (v) { return v.type === "num" || v.type === "color"; }).slice(0, 60).map(function (v) {
          if (v.type === "color") return { i: v.i, color: true, value: PC.toHex(PC.hex(v.v)), label: v.label || "color", ml: true };
          var val = +v.v; return { i: v.i, value: val, label: v.label || "valor", min: val < 0 ? Math.min(val * 3, -1) : 0, max: Math.max(Math.abs(val) * 3, Math.abs(val) <= 1 ? 1 : 10), step: v.int ? 1 : Math.abs(val) <= 1 ? 0.01 : 0.1, ml: true };
        }).filter(function (v) { return v.color || isFinite(v.value); });
        if (out.length) return out;
      }
    } catch (e) { /* lector del código vivo no pudo: se usa el genérico */ }
    return PC.values(s.code, s.lang).slice(0, 60);
  }
  function drawSrc(force) {
    var s = srcNow();
    CP.src.hidden = !s || CP.tab !== "src";
    if (CP.src.hidden) return;
    var sig = s.lang + "|" + s.w + "|" + s.h + "|" + (s.t || 0) + "|" + (s.capture || "") + "|" + s.code.length + "|" + ML.hash(s.code);
    if (!force && CP.srcSig === sig) return;
    if (CP.src.contains(document.activeElement) && !force) return;
    CP.srcSig = sig;
    var timed = s.lang === "js" || s.lang === "html" || s.lang === "glsl", vs = valuesOf(s);
    CP.vals = vs;
    CP.src.innerHTML = '<div class="r"><label>Lienzo <input type="number" min="16" max="4096" data-ps="w" value="' + s.w + '" aria-label="Ancho"> × <input type="number" min="16" max="4096" data-ps="h" value="' + s.h + '" aria-label="Alto"> px</label>'
      + (s.lang === "js" || s.lang === "html" ? '<label>Captura <select data-ps="capture"><option value="">Automática</option><option value="canvas"' + (s.capture === "canvas" ? " selected" : "") + '>El lienzo (canvas)</option><option value="page"' + (s.capture === "page" ? " selected" : "") + ">La página completa</option></select></label>" : "") + "</div>"
      + (timed ? '<div class="r"><label for="phCodeT">Instante</label><input id="phCodeT" type="range" min="0" max="' + Math.max(10, Math.ceil((s.t || 0) * 1.5)) + '" step="0.05" data-ps="t" value="' + (s.t || 0) + '"><output>' + (s.t || 0).toFixed(2) + " s</output></div>" : "")
      + (vs.length ? '<div style="color:#888;padding-top:2px">Valores del código (' + vs.length + ")</div>" + vs.map(function (v, k) { return '<label class="v"><span title="' + esc(v.snippet || v.label) + '">' + esc(v.label) + "</span>" + (v.color ? '<input type="color" data-pv="' + k + '" value="' + v.value + '">' : '<input type="range" data-pv="' + k + '" min="' + v.min + '" max="' + v.max + '" step="' + v.step + '" value="' + v.value + '">') + "<output>" + v.value + "</output></label>"; }).join("") : "");
  }
  function setSource(patch, soon) {
    var s = srcNow(); if (!s) return;
    var S = X.st(); S.source = PC.normSource(Object.assign({}, s, patch));
    clearTimeout(CP.vt);
    CP.vt = setTimeout(function () { X.reloadSource(); }, soon ? 60 : 350);
  }
  function onSrcInput(e) {
    var t = e.target, s = srcNow(); if (!s) return;
    if (t.dataset.pv != null) {
      var v = CP.vals[+t.dataset.pv]; if (!v) return;
      var code = v.ml ? ML.setCodeValue(s.code, v.i, v.color ? t.value : +t.value) : PC.setValue(s.code, s.lang, v.i, +t.value);
      t.nextElementSibling.textContent = t.value;
      if (e.type === "input" && !t._snapped) { t._snapped = true; phSnap(); }
      if (e.type === "change") t._snapped = false;
      CP.srcSig = null; setSource({ code: code });
      if (!CP.dirty) { CP.ta.value = code; }
      return;
    }
    var k = t.dataset.ps; if (!k) return;
    if (k === "t") { t.nextElementSibling.textContent = (+t.value).toFixed(2) + " s"; if (e.type === "input" && !t._snapped) { t._snapped = true; phSnap(); } if (e.type === "change") t._snapped = false; return setSource({ t: +t.value }); }
    if (e.type !== "change") return;
    phSnap();
    if (k === "w" || k === "h") { var o = {}; o[k] = +t.value; return setSource(o, true); }
    if (k === "capture") return setSource({ capture: t.value || undefined }, true);
  }
  function apply(now) {
    clearTimeout(CP.t);
    if (!isOpen() || !CP.dirty || CP.busy) return;
    var txt = CP.ta.value;
    try {
      if (CP.tab === "src") {
        var s = srcNow(); if (!s) return;
        if (txt === s.code) { CP.dirty = false; return; }
        phSnap(); CP.dirty = false; CP.srcSig = null; setSource({ code: txt }, true); status("Aplicado · dibujando…");
        return;
      }
      var k = PC.detect(txt).kind;
      if (k !== "musa" && k !== "json") {
        if (k === "empty") return status("El código está vacío: empieza con photo(\"https://…\")", true);
        if (!now) return status("Esto no es código de Musa Photo. Pulsa Aplicar para convertirlo (" + (PC.KIND_LABEL[k] || "código") + ").", true);
        CP.dirty = false; return importText(txt);
      }
      var doc = PC.parse(txt, X.docNow());
      CP.dirty = false; CP.busy = true;
      Promise.resolve(X.setDoc(doc)).then(function () { CP.busy = false; status("Aplicado"); refresh(false); }, function (e) { CP.busy = false; status(errOf(e), true); });
    } catch (e) { status(errOf(e), true); }
  }
  /* cada vez que el editor se redibuja, el panel se pone al día */
  var _render = phRender, rT = null;
  phRender = function () { var r = _render.apply(this, arguments); if (isOpen()) { clearTimeout(rT); rT = setTimeout(function () { refresh(false); }, 120); } return r; };
  X.onClose = function () { if (CP.el) { CP.el.hidden = true; CP.dirty = false; } };
  var _onLoad = X.onLoad; X.onLoad = function () { if (_onLoad) _onLoad(); if (isOpen()) { CP.dirty = false; refresh(true); } };
  X.code = { open: open, close: close, isOpen: isOpen, refresh: refresh, apply: apply };

  /* ═════════════ pegar / importar código ═════════════ */
  function summary(r) {
    var parts = [];
    if (r.mode === "adjust") parts.push(r.count + " ajuste" + (r.count === 1 ? "" : "s") + " de " + r.label + " quedaron editables" + (r.result && r.result.filters.length ? " (pestaña Filtros)" : ""));
    if (r.mode === "source") parts.push("Código " + r.label + ": es la fuente de la foto y sigue editable");
    if (r.mode === "doc") parts.push("Código de Musa Photo aplicado");
    if (r.notes && r.notes.length) parts.push(r.notes.join(". "));
    if (r.missed && r.missed.length) parts.push("Sin equivalente (no se aplicó): " + r.missed.slice(0, 5).join(", "));
    return parts.join(" · ");
  }
  /* con una foto abierta: el código se aplica a ESA foto */
  function importText(text) {
    var cur = X.docNow(), r;
    try { r = PC.importAny(text, cur); } catch (e) { say(errOf(e)); if (isOpen()) status(errOf(e), true); return Promise.resolve(null); }
    var doc;
    if (r.mode === "source") {
      doc = PC.normalize(Object.assign({}, cur, { source: r.source }));
      /* un programa que procesa una imagen recibe la foto abierta; si la foto abierta todavía no tiene dirección, no hay entrada */
      if (PC.usesInput(r.source.code, r.source.lang) && !r.source.input && r.source.lang === "py") { say("El script abre una imagen, pero esta foto todavía no está guardada: guárdala primero y vuelve a pegarlo"); return Promise.resolve(null); }
    } else doc = r.doc;
    var msg = summary(r);
    return Promise.resolve(X.setDoc(doc)).then(function () {
      if (r.mode === "adjust" && r.result && r.result.filters.length) { PH.tab = "filtros"; if (PH.mode !== "edit") phMode("edit"); phAll(); }
      say(msg.length > 150 ? msg.slice(0, 147) + "…" : msg);
      if (r.mode === "source") open("src"); else if (isOpen()) { CP.dirty = false; refresh(true); }
      if (isOpen()) status(msg, !!(r.missed && r.missed.length));
      return r;
    });
  }
  X.importText = importText;
  /* sin foto abierta (Crear › Fotos › Desde código): nace una foto nueva */
  function createFromCode(text, name) {
    var r = PC.importAny(text, null), doc = r.mode === "source" ? PC.normalize({ source: r.source }) : r.doc;
    if (!doc || !doc.source) return Promise.reject(new Error("Este código ajusta una foto pero no dice cuál. Abre una foto y pégalo ahí con «</> Código», o incluye la dirección de la imagen."));
    var code = doc.source.kind === "code", nm = String(name || doc.name || (code ? "Foto con código" : "Foto desde código")).slice(0, 120);
    var pg = RB.progress ? RB.progress("Creando la foto", code && doc.source.lang === "py" ? "Preparando Python (la primera vez tarda)…" : "Dibujando el código…") : null;
    return X.renderDoc(doc, 2400).then(function (cv) {
      if (pg) pg.set(70, "Guardando…");
      return X.outBlob(cv, X.hasAlpha(cv) ? "png" : "jpg", 0.9).then(function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ data: fr.result, w: cv.width, h: cv.height }); }; fr.onerror = rej; fr.readAsDataURL(b); }); });
    }).then(function (o) {
      return api("/api/photo-sources/code", jreq("POST", { workspaceId: RB.ws, name: nm, doc: doc, data: o.data, width: o.w, height: o.h }, 120000));
    }).then(function (x) {
      if (pg) pg.close();
      FO.F.rows = null;
      if (typeof toast === "function") toast(summary(r) || "Foto creada");
      location.hash = "crear/fotos/" + encodeURIComponent(x.photo.id) + "/editar";
      return x.photo;
    }, function (e) { if (pg) pg.close(); throw e; });
  }
  X.createFromCode = createFromCode;
  var EXAMPLE = "// Ejemplo: un degradado con círculos (canvas). Pega aquí tu código.\nconst c = document.createElement('canvas');\nc.width = 1080; c.height = 1350;\ndocument.body.appendChild(c);\nconst x = c.getContext('2d');\nconst g = x.createLinearGradient(0, 0, 1080, 1350);\ng.addColorStop(0, '#ff5e00'); g.addColorStop(1, '#1b1464');\nx.fillStyle = g; x.fillRect(0, 0, 1080, 1350);\nfor (let i = 0; i < 40; i++) {\n  x.fillStyle = `rgba(255,255,255,${0.04 + i * 0.004})`;\n  x.beginPath(); x.arc(540, 675, 620 - i * 15, 0, 7); x.fill();\n}\n";
  function codeDialog() {
    var inEd = PH.open && PH.src;
    var dlg = document.createElement("div"); dlg.className = "mdlg phx-dlg"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-label", "Foto desde código"); dlg.dataset.musaDialog = "photo-code";
    dlg.innerHTML = '<form class="phx-card wide"><h3>' + (inEd ? "Pegar código en esta foto" : "Foto desde código") + "</h3>"
      + "<p>" + (inEd ? "Si el código son ajustes (CSS filter, sharp, Pillow, ImageMagick, filtro SVG…) se suman a esta foto como controles editables. Si es un programa que dibuja o procesa píxeles, pasa a ser la fuente de la foto y corre aislado."
        : "Pega código que dibuja una imagen: canvas, Three.js, p5, WebGL o shader, SVG, HTML/CSS o Python (Pillow, matplotlib, numpy). Corre aislado, queda como foto y la editas con todas las herramientas; su código sigue editable.") + "</p>"
      + (inEd ? "" : '<label>Nombre<input type="text" name="nm" maxlength="120" placeholder="Foto con código"></label>')
      + '<label>Código<textarea name="code" spellcheck="false" placeholder="Pega aquí el código…"></textarea></label>'
      + '<p class="phx-info" aria-live="polite"></p>'
      + '<div class="phx-row">' + (inEd ? "" : '<button type="button" data-x="ex">Ver un ejemplo</button>') + '<button type="button" data-x="cancel">Cancelar</button><button type="submit" class="pri">' + (inEd ? "Aplicar a la foto" : "Crear la foto") + "</button></div></form>";
    document.body.appendChild(dlg);
    var f = dlg.querySelector("form"), info = dlg.querySelector(".phx-info"), ta = f.code;
    var det = function () {
      var k = PC.detect(ta.value); info.classList.remove("er");
      info.textContent = k.kind === "empty" ? "" : k.kind === "unknown" ? "No reconozco este código todavía." : "Detectado: " + (k.kind === "gen" ? PC.LANG_LABEL[k.lang] + " — será la fuente de la foto" : PC.KIND_LABEL[k.kind] + (k.kind === "musa" || k.kind === "json" ? "" : " — quedará como ajustes editables"));
    };
    ta.addEventListener("input", det);
    ["keydown", "keyup"].forEach(function (ev) { dlg.addEventListener(ev, function (e) { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") close2(); if (ev === "keydown" && e.key === "Tab" && e.target === ta) { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); } }); });
    var close2 = function () { dlg.remove(); };
    dlg.addEventListener("pointerdown", function (e) { e.stopPropagation(); if (e.target === dlg) close2(); });
    f.querySelector("[data-x=cancel]").onclick = close2;
    var ex = f.querySelector("[data-x=ex]"); if (ex) ex.onclick = function () { ta.value = EXAMPLE; det(); ta.focus(); };
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var txt = ta.value, btn = f.querySelector("button[type=submit]");
      if (!txt.trim()) { info.textContent = "Pega un código primero"; info.classList.add("er"); return; }
      if (inEd) { close2(); return importText(txt); }
      btn.disabled = true; btn.textContent = "Creando…";
      var p; try { p = createFromCode(txt, f.nm.value.trim()); } catch (er) { p = Promise.reject(er); }
      p.then(close2, function (er) { btn.disabled = false; btn.textContent = "Crear la foto"; info.textContent = errOf(er); info.classList.add("er"); });
    });
    setTimeout(function () { ta.focus(); }, 30);
  }
  X.codeDialog = codeDialog;
  /* Ctrl+V de código con el editor de fotos abierto (fuera de un campo de texto) */
  document.addEventListener("paste", function (e) {
    if (!PH.open || !PH.src || (e.target.closest && e.target.closest("input,textarea,select,[contenteditable=true]"))) return;
    var txt = (e.clipboardData && e.clipboardData.getData("text")) || ""; if (txt.length < 12) return;
    var k = PC.detect(txt).kind; if (k === "unknown" || k === "empty") return;
    e.preventDefault(); importText(txt);
  });

  /* ═════════════ botón y menús ═════════════ */
  (function topBtn() {
    var nav = phRoot.querySelector(".ed-top .ed-tc"); if (!nav || document.getElementById("phCodeBtn")) return;
    var b = document.createElement("button"); b.className = "ed-tb"; b.id = "phCodeBtn"; b.type = "button"; b.textContent = "</> Código"; b.title = "La foto como código, editable en vivo en los dos sentidos";
    b.addEventListener("click", function (e) { e.stopPropagation(); if (isOpen()) close(); else open(); });
    nav.appendChild(b);
  })();

  /* ═════════════ pasos con un clic ═════════════ */
  function attr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function sizeOfUrl(url) { return X.loadImg(url).then(function (im) { return [im.naturalWidth, im.naturalHeight]; }, function () { return [1080, 1080]; }); }
  /* una foto de Crear › Fotos → diseño nuevo con la foto como capa que se sigue editando («Editar foto») */
  function photoToDesign(a) {
    var pg = RB.progress ? RB.progress("Llevando la foto a un diseño", "Creando el diseño…") : null;
    return api("/api/photo-sources/asset/" + encodeURIComponent(a.id) + "/doc").then(function (x) {
      var doc = x.doc, p = x.photo, code = doc.source && doc.source.kind === "code";
      var ready = p.stale ? X.renderDoc(doc, 2400).then(function (cv) { return X.uploadCv(cv, p.name + ".jpg", { type: X.hasAlpha(cv) ? "image/png" : "image/jpeg", tags: ["foto-revelada"] }).then(function (u) { return { url: u.url, wh: [cv.width, cv.height] }; }); })
        : (p.width && p.height ? Promise.resolve([p.width, p.height]) : sizeOfUrl(p.url)).then(function (wh) { return { url: p.url, wh: wh }; });
      return ready.then(function (o) {
        var k = Math.min(1, 2400 / Math.max(o.wh[0], o.wh[1])), W = Math.max(16, Math.round(o.wh[0] * k)), H = Math.max(16, Math.round(o.wh[1] * k));
        var orig = code ? (doc.source.poster || o.url) : doc.source ? doc.source.url : o.url, meta = X.metaOf(doc, orig, null);
        if (!(p.edited || p.code)) meta = { orig: o.url, recipe: PC.recipe0(), rev: PC.uid("r") };
        var lid = "foto_" + Date.now().toString(36);
        var html = '<img data-layer-id="' + lid + '" data-layer-name="' + attr(p.name || "Foto") + '" data-layer-kind="image" src="' + attr(o.url) + '" alt="" data-photo="' + attr(JSON.stringify(meta)) + '" style="position:absolute;left:0;top:0;width:' + W + "px;height:" + H + 'px;object-fit:cover">';
        return RB.mcp("create_html_template", { workspaceId: RB.ws, name: (p.name || "Foto") + " · diseño", width: W, height: H, initialHtml: html, initialCss: "" });
      });
    }).then(function (r) {
      var id = r && (r.id || r.templateId || (r.template && r.template.id) || (r.data && r.data.id));
      if (!id) throw new Error("no se pudo crear el diseño");
      if (pg) pg.close();
      if (typeof toast === "function") toast("Diseño creado con la foto: doble clic en ella para seguir editándola en el editor de fotos");
      if (RB.reloadData) try { RB.reloadData(); } catch (e) { /* lista */ }
      RB.openDesign(id);
      return id;
    }, function (e) { if (pg) pg.close(); if (typeof toast === "function") toast("No se pudo llevar al diseño: " + errOf(e)); throw e; });
  }
  function animated(src) { return src && src.kind === "code" && (src.lang === "js" || src.lang === "html") && /requestAnimationFrame|setAnimationLoop|function\s+draw\s*\(|gsap\.|@keyframes|animate\(|setInterval|performance\.now|clock\./i.test(src.code); }
  function plainDoc(d) { return !PC.recipeEdited(d.recipe) && !d.filters.length && !d.layers.length; }
  /* a video: una foto fija entra como imagen; un código animado puede entrar como clip de código (sigue vivo y editable) */
  function toVideo(doc, name, getCanvas) {
    var live = animated(doc.source) && RB.videoFromCode;
    var ask = live ? RB.choose("«" + name + "» nace de un código animado. ¿Cómo lo llevo al video?", [{ value: "live", label: "Como animación" + (plainDoc(doc) ? "" : " (sin el revelado ni las capas de la foto)") + " · clip de código editable" }, { value: "still", label: "Como imagen fija · el instante elegido, con todos tus ajustes" }], { title: "Llevar al editor de video" }) : Promise.resolve("still");
    return ask.then(function (pick) {
      if (!pick) return;
      if (pick === "live") return RB.videoFromCode(doc.source.code, name + " · video");
      return getCanvas().then(function (cv) { return RB.photoToVideo({ canvas: cv, name: name, alpha: X.hasAlpha(cv) }); });
    });
  }
  function assetToVideo(a) {
    return api("/api/photo-sources/asset/" + encodeURIComponent(a.id) + "/doc").then(function (x) {
      return toVideo(x.doc, x.photo.name || "Foto", function () { return x.photo.stale || !(x.photo.edited || x.photo.code) ? X.renderDoc(x.doc, 2048) : X.loadImg(x.photo.url).then(function (im) { return X.toCanvas(im, 2048); }, function () { return X.renderDoc(x.doc, 2048); }); });
    }).catch(function (e) { if (typeof toast === "function") toast("No se pudo llevar al video: " + errOf(e)); });
  }
  X.photoToDesign = photoToDesign; X.assetToVideo = assetToVideo; X.toVideo = toVideo;
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-fox]"); if (!b || !FO.onLib()) return;
    e.preventDefault(); e.stopPropagation();
    var p = b.dataset.fox.split(":"), r = FO.rowOf(p.slice(1).join(":")); if (!r || b.disabled) return;
    b.disabled = true; var done = function () { b.disabled = false; };
    (p[0] === "design" ? photoToDesign(r) : assetToVideo(r)).then(done, done);
  }, true);
  /* desde el editor: guarda primero lo pendiente (para llevar exactamente lo que se ve) */
  function editorToDesign() {
    var lp = PH.doc && PH.doc._photo; if (!lp) return;
    var a = lp.asset, go = function (as) { return photoToDesign(as); };
    if (!X.dirty() && (a.edited || a.code)) return go(a);
    if (!X.dirty()) return go(a);
    X.keepOpen = true; X.afterSave = function (x) { X.afterSave = null; if (x && x.asset) go(x.asset); };
    return X.saveLoose("save");
  }
  var _edMenu = PH_MENUS.editor;
  PH_MENUS.editor = function () {
    var it = _edMenu().slice(), loose = PH.doc && PH.doc._photo, out = [];
    it.forEach(function (x) {
      if (x && x.l === "Llevar esta foto a un video") { out.push({ l: x.l, d: x.d, fn: function () { toVideo(X.docNow(), (PH.t && PH.t.name) || "Foto", function () { return X.flattenAsync(2048); }); } }); return; }
      if (x && x.l === "Editor de diseño" && loose) { out.push({ l: "Llevar esta foto a un diseño", d: "Diseño nuevo con la foto como capa; sigue editable en el editor de fotos", fn: editorToDesign }); return; }
      if (x && x.l === "Editor de video" && loose) return;
      out.push(x);
    });
    return out;
  };
  /* las acciones de IA aplanan la foto: antes se resuelven los filtros de código a ese tamaño */
  var _ia = PH_MENUS.ia;
  PH_MENUS.ia = function () { return _ia().map(function (x) { if (!x || !x.fn || !X.st().filters.some(function (f) { return f.kind === "code" && f.on; })) return x; var fn = x.fn; return Object.assign({}, x, { fn: function () { X.flattenAsync(2000).then(fn, fn); } }); }); };
  var _exp = PH_MENUS.exportar;
  PH_MENUS.exportar = function () {
    return [{ h: "Exportar" }, { l: "Exportar la foto…", d: "Formato, tamaño real y calidad", fn: function () { phDownload(""); } }, "-", { h: "Código" },
      { l: "Copiar el código de la foto", d: "Musa Photo (se puede pegar en otra foto o dárselo a una IA)", fn: function () { var t = PC.toCode(X.docNow()); try { navigator.clipboard.writeText(t).then(function () { say("Código copiado"); }); } catch (e) { open(); } } },
      { l: "Pegar código…", d: "CSS, canvas, Python, SVG, sharp, ImageMagick…", fn: codeDialog }, "-",
      { l: "Guardar receta", d: "Versión sin tocar el diseño", fn: function () { phAct("saveRecipe"); } }];
  };

  /* ═════════════ «Editor de código» (pantalla completa): el mismo código Musa Photo ═════════════ */
  var A = window.__musaCode && window.__musaCode.adapters;
  if (A) {
    A.photo = {
      title: "Fotos",
      ready: function () { return PH.open && PH.r && PH.src; },
      files: function () { var d = X.docNow(), f = [{ name: "foto.js", lang: "js", text: PC.toCode(d) }, { name: "foto.json", lang: "json", text: PC.toJSON(d) }]; return f; },
      previewEl: function (box, files) {
        /* el archivo que se está editando: el que ya no coincide con la foto abierta */
        var i = files[1] && files[1].text !== PC.toJSON(X.docNow()) && files[0].text === PC.toCode(X.docNow()) ? 1 : 0, tok = (box._tok = (box._tok || 0) + 1);
        var doc = PC.parse(files[i].text, X.docNow());
        if (!doc.source) throw new Error("falta la fuente: photo(\"https://…\")");
        box.innerHTML = '<span style="color:#888;font:12px Inter,sans-serif">Dibujando…</span>';
        X.renderDoc(doc, 900).then(function (cv) { if (box._tok !== tok) return; box.innerHTML = ""; cv.style.cssText = "max-width:calc(100% - 32px);max-height:calc(100% - 32px);box-shadow:0 10px 40px rgba(0,0,0,.5)"; box.appendChild(cv); }, function (e) { box.innerHTML = '<span style="color:#ff8a70;font:12px Inter,sans-serif;padding:16px">' + esc(errOf(e)) + "</span>"; });
      },
      apply: function (files) {
        var i = files[1].text !== PC.toJSON(X.docNow()) && files[0].text === PC.toCode(X.docNow()) ? 1 : 0;
        return Promise.resolve(X.setDoc(PC.parse(files[i].text, X.docNow()))).then(function () { return "Foto actualizada (Ctrl+Z deshace)"; });
      },
      agent: function (files) {
        var C = window.__musaCode, d = PC.parse(files[0].text, X.docNow()), lp = PH.doc && PH.doc._photo, e = phEl();
        var ref = lp ? { assetId: lp.asset.id } : { templateId: (PH.doc && PH.doc._id) || "<templateId>", layerId: (e && e._n && e._n.getAttribute("data-layer-id")) || "<data-layer-id de la imagen>" };
        return "## Leer esta foto como código\n" + C.mcpCall("photo_code_get", ref)
          + "\n\n## Escribirla completa (el mismo código de foto.js)\n" + C.mcpCall("photo_code_apply", Object.assign({}, ref, { code: PC.toCode(d, { bare: true }) }))
          + "\n\n## Cambiar solo una parte\n" + C.mcpCall("photo_edit", Object.assign({}, ref, { set: { "basic.exposure": 12 }, addFilters: [{ kind: "blur", radius: 3 }] }))
          + "\n\n## Crear una foto nueva desde código\n" + C.mcpCall("photo_create_from_code", { workspaceId: RB.ws, name: "Foto con código", code: "<canvas / Three.js / SVG / HTML / Python / CSS…>" });
      },
    };
  }

  /* ═════════════ video → editor de fotos: el cuadro del cabezal o una imagen del video ═════════════ */
  function saveAsPhoto(cv, name, from) {
    var pg = RB.progress ? RB.progress("Llevando al editor de fotos", "Guardando la imagen en Fotos…") : null;
    return X.outBlob(cv, X.hasAlpha(cv) ? "png" : "jpg", 0.92).then(function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); }); }).then(function (data) {
      return api("/api/assets/upload", jreq("POST", { name: String(name).slice(0, 120) + (X.hasAlpha(cv) ? ".png" : ".jpg"), data: data, workspaceId: RB.ws, tags: from ? [from] : [] }, 120000));
    }).then(function (x) {
      var a = x.data || x, id = a.assetId || a.id; if (!id) throw new Error("no se pudo guardar la imagen");
      if (pg) pg.close();
      FO.F.rows = null;
      if (typeof toast === "function") toast("«" + name + "» quedó en Crear › Fotos: edítala y vuelve a llevarla al video con «Llevar esta foto a un video»");
      location.hash = "crear/fotos/" + encodeURIComponent(id) + "/editar";
      return id;
    }, function (e) { if (pg) pg.close(); if (typeof toast === "function") toast("No se pudo llevar al editor de fotos: " + errOf(e)); });
  }
  function fmtT(t) { var m = Math.floor(t / 60), s = (t % 60).toFixed(1).replace(".", ","); return m + ":" + (s.length < 4 ? "0" : "") + s; }
  X.videoFrameToPhoto = function () {
    if (typeof VE === "undefined" || !VE.open || !VE.p || !RB.videoStill) return;
    var t = VE.t || 0, nm = (VE.p.name || "Video") + " · cuadro " + fmtT(t);
    return RB.videoStill(t, 2160).then(function (cv) { return saveAsPhoto(cv, nm, "cuadro de video"); }, function (e) { if (typeof toast === "function") toast("No se pudo dibujar el cuadro: " + errOf(e)); });
  };
  X.videoImageToPhoto = function () {
    if (typeof VE === "undefined" || !VE.open || !VE.p) return;
    var s = VE.sel, c = s && s.tr === "m" && VE.p.m[s.i], u = c && RB.videoImgOf ? RB.videoImgOf(c) : null;
    if (!u) { if (typeof toast === "function") toast("Elige primero una imagen de la pista Media (M)"); return; }
    return X.loadImg(u).then(function (im) { return saveAsPhoto(X.toCanvas(im, 4096), c.name || "Imagen del video", "imagen de video"); }, function () { if (typeof toast === "function") toast("No se pudo leer esa imagen (permiso de su web de origen)"); });
  };
  if (typeof VMENUS !== "undefined" && VMENUS.editor) {
    var _vEd = VMENUS.editor;
    VMENUS.editor = function () {
      var it = _vEd().slice(), i = it.findIndex(function (x) { return x && x.l === "Editor de fotos"; });
      var s = VE.sel, img = s && s.tr === "m" && VE.p && VE.p.m[s.i] && RB.videoImgOf && RB.videoImgOf(VE.p.m[s.i]);
      var add = [{ l: "Este cuadro al editor de fotos", d: "El cuadro del cabezal (" + fmtT(VE.t || 0) + ") como foto editable", fn: X.videoFrameToPhoto }];
      if (img) add.push({ l: "Esta imagen al editor de fotos", d: "La imagen elegida en Media, como foto editable", fn: X.videoImageToPhoto });
      if (i >= 0) { if (VE.from == null) it.splice(i, 1, add[0]); else it.splice(i + 1, 0, add[0]); if (add[1]) it.splice(i + (VE.from == null ? 1 : 2), 0, add[1]); }
      else it = it.concat(["-", { h: "Foto" }], add);
      return it;
    };
  }

  /* ═════════════ diseño abierto: las fotos que cambió una IA se vuelven a pintar y se guardan ═════════════ */
  var dpaint = {};
  setInterval(function () {
    if (typeof ED === "undefined" || !ED.open || !ED.doc || !ED.doc._real || PH.open || document.hidden) return;
    var d = ED.doc;
    d.frames.forEach(function (f) { (f.els || []).forEach(function (e) {
      if (e.type !== "image") return; var ph; try { ph = e.photo; } catch (x) { ph = null; }
      if (!ph || !ph.stale) return;
      var key = d._id + "|" + ph.rev; if (dpaint[key]) return; dpaint[key] = 1;
      X.renderDoc(X.docOfMeta(ph, phUrlOf(e.fill)), 2400).then(function (cv) { return X.uploadCv(cv, (e.name || "foto") + ".jpg", { type: X.hasAlpha(cv) ? "image/png" : "image/jpeg", tags: ["foto-revelada"] }); }).then(function (u) {
        if (ED.doc !== d) return; var cur = e.photo; if (!cur || cur.rev !== ph.rev) return;
        var m = Object.assign({}, cur); delete m.stale; e.photo = m; e.fill = "url('" + u.url + "') center/cover no-repeat";
        if (typeof edRender === "function") edRender(); if (RB._ed && RB._ed.save) RB._ed.save();
      }, function (er) { console.warn("[fotos] no se pudo pintar la foto del diseño", er); });
    }); });
  }, 2500);

  /* ═════════════ biblioteca: fotos «por pintar» ═════════════ */
  var painting = {}, paintQ = Promise.resolve();
  X.onLibDraw = function (list) {
    (list || []).filter(function (r) { return r.stale && r.doc && !painting[r.id + "|" + r.rev]; }).slice(0, 4).forEach(function (r) {
      painting[r.id + "|" + r.rev] = 1;
      paintQ = paintQ.then(function () {
        return X.renderDoc(r.doc, 2400).then(function (cv) {
          return X.outBlob(cv, X.hasAlpha(cv) ? "png" : "jpg", 0.9).then(function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); }); })
            .then(function (data) { return api("/api/photo-sources/asset/" + encodeURIComponent(r.id) + "/render", jreq("POST", { data: data, width: cv.width, height: cv.height, rev: r.rev }, 120000)); });
        }).then(function (x) { if (x && x.photo) { Object.assign(r, x.photo); if (FO.onLib()) FO.drawLib(); } }, function (e) { console.warn("[fotos] no se pudo pintar " + r.id, e); });
      });
    });
  };
})();
