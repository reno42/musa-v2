/* bridge-mail.js — Correo real y enlaces públicos.
 * · Integraciones: Resend y Postmark (BYOK) + remitente del espacio (quién envía, desde qué correo).
 * · Mailing: Enviar / Programar / Enviarme prueba / Guardar sobre la base; Secuencias: Activar.
 * · Formularios (/f), Briefs para el cliente (/b) y Cotizaciones para aprobar (/q): enlace público real,
 *   copiable y que se puede mandar por correo con el proveedor elegido.
 */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path, init); }
  function J(method, body) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function origin() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  function real() { return RB() && RB().on; }
  function ws() { return RB().ws; }
  function copy(t) { try { navigator.clipboard.writeText(t); } catch (e) {} uiToast("Enlace copiado"); }
  function errText(e) { return String(e && (e.message || e.error) || e || "error"); }

  /* ───────── 1. Integraciones: Resend y Postmark ───────── */
  var MAIL = { st: null, mine: {}, loaded: null };
  function loadMail(force) {
    if (!force && MAIL.loaded === ws()) return Promise.resolve(MAIL);
    return api("/api/email/settings?workspaceId=" + encodeURIComponent(ws())).then(function (r) { MAIL.st = r.settings; MAIL.mine = r.myKeys || {}; MAIL.loaded = ws(); return MAIL; }, function () { MAIL.st = null; MAIL.loaded = ws(); return MAIL; });
  }
  function addInts() {
    if (typeof INTS === "undefined" || INTS.some(function (i) { return i.id === "resend"; })) return;
    var at = INTS.findIndex(function (i) { return i.id === "mail-domain"; }); if (at < 0) at = INTS.length;
    INTS.splice(at, 0,
      { id: "resend", name: "Resend", cat: "Mailing", color: "#111", letter: "R", tagline: "Envía tus campañas, secuencias y correos de eventos desde tu dominio, con tu propia cuenta de Resend.", bullets: ["Campañas a tus contactos con enlace de baja.", "Programa recordatorios de eventos y secuencias (1 día y 1 hora antes).", "Pon tu API key y verifica tu dominio en Resend."], st: "off" },
      { id: "postmark", name: "Postmark", cat: "Mailing", color: "#ffde00", letter: "P", tagline: "Entrega rápida y confiable con tu propia cuenta de Postmark.", bullets: ["Campañas por el stream «broadcast» y correos de eventos por «outbound».", "Ideal si ya usas Postmark para tus correos transaccionales.", "No programa envíos: para recordatorios y secuencias usa Resend."], st: "off" });
  }
  function mailBox(i) {
    var st = MAIL.st, active = st && st.provider === i.id, has = MAIL.mine[i.id];
    var d = st && st.provider === i.id ? st : {};
    return '<div class="mb-mail" style="margin-top:14px"><h5>Remitente de este espacio</h5>'
      + (active ? '<div class="int-acc"><span><b>' + esc((d.from_name ? d.from_name + " · " : "") + d.from_email) + "</b><small>Este espacio envía con " + i.name + (d.isOwner ? " (tu llave)" : " (llave de quien lo configuró)") + '</small></span><span class="pill ok">En uso</span></div>' : st ? '<p class="int-note">Ahora el espacio envía con ' + (st.provider === "resend" ? "Resend" : "Postmark") + ". Puedes cambiarlo aquí.</p>" : "")
      + (has ? '<div class="pz-grid" style="margin-top:8px"><label>Correo remitente<input id="mbFrom" placeholder="hola@tudominio.com" value="' + esc(d.from_email || "") + '"></label><label>Nombre<input id="mbName" placeholder="Tu marca" value="' + esc(d.from_name || "") + '"></label><label>Responder a (opcional)<input id="mbReply" value="' + esc(d.reply_to || "") + '"></label>'
        + (i.id === "postmark" ? '<label>Stream para campañas<input id="mbStream" value="' + esc(d.postmark_stream || "broadcast") + '"></label>' : "")
        + '</div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-p" data-mbm="use">' + (active ? "Guardar remitente" : "Usar " + i.name + " en este espacio") + "</button>" + (active ? '<button class="btn btn-g" data-mbm="test">Enviarme una prueba</button>' : "") + "</div>"
        + '<p class="int-note">El remitente tiene que ser de un dominio verificado en ' + i.name + '. Solo Dueño o Admin cambia el remitente.</p>'
        : '<p class="int-note">Primero vincula tu API key arriba; después eliges el remitente.</p>') + "</div>";
  }
  if (typeof intDetail === "function") {
    var _id = intDetail;
    intDetail = function (i) {
      var h = _id.apply(this, arguments);
      if (!real() || !i || (i.id !== "resend" && i.id !== "postmark")) return h;
      if (MAIL.loaded !== ws()) loadMail().then(function () { if (INT.open === i.id) viewIntegrations(); });
      return h.replace(/<\/aside>\s*$/, mailBox(i) + "</aside>");
    };
  }
  if (typeof viewIntegrations === "function") {
    var _vi = viewIntegrations;
    viewIntegrations = function () {
      if (real()) {
        addInts();
        var dom = INTS.find(function (i) { return i.id === "mail-domain"; });
        if (dom && MAIL.loaded === ws()) { dom.st = MAIL.st ? "ok" : "off"; dom.account = MAIL.st ? MAIL.st.from_email.split("@")[1] : null; dom.tagline = MAIL.st ? "Envías desde " + MAIL.st.from_email + " con " + (MAIL.st.provider === "resend" ? "Resend" : "Postmark") + "." : "Conecta Resend o Postmark y elige tu remitente para enviar desde tu dominio."; }
        if (MAIL.loaded !== ws()) loadMail().then(function () { if (route.sub === "integraciones") _vi(); });
      }
      return _vi.apply(this, arguments);
    };
  }
  /* las llaves de correo usan el mismo guardado cifrado BYOK que las de IA */
  document.addEventListener("click", function (e) {
    if (!real() || typeof INT === "undefined" || !e.target.closest) return;
    var a = e.target.closest('#body [data-ia="link"], #body [data-ia="unlink"]'); var i = a && INTS.find(function (x) { return x.id === INT.open; });
    if (a && i && (i.id === "resend" || i.id === "postmark")) {
      e.stopPropagation(); e.preventDefault();
      if (a.dataset.ia === "link") {
        var inp = document.getElementById("intKey"), v = inp ? inp.value.trim() : "";
        if (v.length < 8) { if (inp) inp.focus(); return; }
        a.disabled = true;
        api("/api/keys/" + i.id, J("PUT", { key: v })).then(function () { uiToast(i.name + " vinculada · la key queda cifrada"); return Promise.all([RB().loadKeys ? RB().loadKeys() : null, loadMail(true)]); }).then(function () { viewIntegrations(); }, function (x) { a.disabled = false; uiToast("No se pudo guardar: " + errText(x)); });
      } else {
        if (!confirm("¿Desvincular tu key de " + i.name + "?" + (MAIL.st && MAIL.st.provider === i.id && MAIL.st.isOwner ? " Este espacio dejará de poder enviar correos." : ""))) return;
        api("/api/keys/" + i.id, { method: "DELETE" }).then(function () { return Promise.all([RB().loadKeys ? RB().loadKeys() : null, loadMail(true)]); }).then(function () { viewIntegrations(); });
      }
      return;
    }
    var m = e.target.closest("[data-mbm]"); if (!m) return;
    var cur = INTS.find(function (x) { return x.id === INT.open; }); if (!cur) return;
    e.stopPropagation(); e.preventDefault();
    if (m.dataset.mbm === "use") {
      var body = { workspaceId: ws(), provider: cur.id, fromEmail: (document.getElementById("mbFrom") || {}).value, fromName: (document.getElementById("mbName") || {}).value, replyTo: (document.getElementById("mbReply") || {}).value, postmarkStream: (document.getElementById("mbStream") || {}).value };
      m.disabled = true; m.textContent = "Verificando…";
      api("/api/email/settings", J("PUT", body)).then(function () { uiToast("Listo: este espacio envía con " + cur.name); return loadMail(true); }).then(function () { viewIntegrations(); }, function (x) { m.disabled = false; m.textContent = "Usar " + cur.name + " en este espacio"; uiToast(errText(x)); });
    }
    if (m.dataset.mbm === "test") { m.disabled = true; api("/api/email/test", J("POST", { workspaceId: ws() })).then(function (r) { m.disabled = false; uiToast("Prueba enviada a " + r.to); }, function (x) { m.disabled = false; uiToast("No se pudo enviar: " + errText(x)); }); }
  }, true);

  /* ───────── 2. Mailing real ───────── */
  var PROPS = ["color", "background-color", "background-image", "background-size", "background-position", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration", "padding", "margin", "border", "border-radius", "display", "width", "max-width", "height", "vertical-align"];
  /* el correo lleva los estilos en línea: Gmail y Outlook ignoran las hojas de estilo */
  function mailHTML(m) {
    if (m.html) return m.html;
    var host = document.createElement("div"); host.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;background:#fff";
    host.className = "ml-prev"; host.innerHTML = typeof emailHTML === "function" ? emailHTML(m) : ""; document.body.appendChild(host);
    host.querySelectorAll("*").forEach(function (n) { var cs = getComputedStyle(n), st = PROPS.map(function (p) { var v = cs.getPropertyValue(p); return v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" && v !== "rgba(0, 0, 0, 0)" ? p + ":" + v : ""; }).filter(Boolean).join(";"); n.setAttribute("style", st); n.removeAttribute("class"); });
    var inner = host.innerHTML; host.remove();
    return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'></head><body style='margin:0;background:#f3f1e7'><div style='max-width:600px;margin:0 auto;background:#fff;font-family:Arial,sans-serif'>" + inner + "</div></body></html>";
  }
  function curMail() { return typeof MAILS !== "undefined" ? MAILS.find(function (m) { return m.id === ML.sel; }) : null; }
  function needMail() { return loadMail().then(function () { if (!MAIL.st) throw new Error("Primero conecta Resend o Postmark en Configuración › Integraciones y elige tu remitente"); }); }
  function saveMail(m) {
    return RB().mcp("mailing_save", { workspaceId: ws(), id: m.db, kind: "campana", name: m.name, subject: m.subject || m.name, brandId: (RB().brandId || {})[m.brand] || null, segment: m.seg, tpl: m.tpl, html: m.html || undefined, sendAt: m.when === "date" && m.at ? new Date(m.at).toISOString() : undefined });
  }
  function sendAll(m, html, offset, acc) {
    return api("/api/email/mailings/" + m.db + "/send", J("POST", { workspaceId: ws(), html: html, offset: offset })).then(function (r) {
      acc.sent += r.sent || 0; acc.failed += r.failed || 0; (r.errors || []).forEach(function (x) { acc.errors.push(x); });
      if (r.nextOffset != null) { uiToast("Enviando… " + acc.sent + " de " + r.total); return sendAll(m, html, r.nextOffset, acc); }
      return acc;
    });
  }
  document.addEventListener("click", function (e) {
    if (!real() || !e.target.closest || route.mod !== "crear" || route.sub !== "mailing") return;
    var b = e.target.closest("[data-mla]"), m = curMail();
    if (b && m && m.db && /^(go|test|save)$/.test(b.dataset.mla)) {
      e.stopPropagation(); e.preventDefault();
      var k = b.dataset.mla, html = mailHTML(m);
      if (k === "save") return saveMail(m).then(function () { m.status = "Borrador"; uiToast("Guardado"); if (RB().reloadData) RB().reloadData(); }, function (x) { uiToast("No se pudo guardar: " + errText(x)); });
      if (k === "test") return needMail().then(function () { return api("/api/email/test", J("POST", { workspaceId: ws(), subject: m.subject || m.name, html: html })); }).then(function (r) { uiToast("Prueba enviada a " + r.to); }, function (x) { uiToast(errText(x)); });
      b.disabled = true;
      return needMail().then(function () { return saveMail(m); }).then(function () {
        if (m.when === "trigger") return api("/rest/v1/workspace_mailings?id=eq." + m.db, J("PATCH", { status: "activa" })).then(function () { uiToast("Activada: los contactos nuevos del segmento la reciben cuando la envíes de nuevo (sin envíos automáticos)"); });
        return api("/api/email/mailings/" + m.db + "/send", J("POST", { workspaceId: ws(), html: html, dryRun: true })).then(function (c) {
          if (!c.recipients) throw new Error("La audiencia «" + m.seg + "» no tiene contactos con correo");
          if (m.when === "date") {
            if (!confirm("¿Programar el envío para " + new Date(m.at).toLocaleString("es-PE") + " a " + c.recipients + " personas?")) return;
            return api("/api/email/mailings/" + m.db + "/schedule", J("POST", { workspaceId: ws(), html: html, at: new Date(m.at).toISOString() })).then(function (r) { uiToast("Programado: " + r.scheduled + " correos"); });
          }
          if (!confirm("¿Enviar «" + (m.subject || m.name) + "» a " + c.recipients + " personas ahora?")) return;
          return sendAll(m, html, 0, { sent: 0, failed: 0, errors: [] }).then(function (a) { uiToast("Enviado a " + a.sent + " personas" + (a.failed ? " · " + a.failed + " fallaron: " + (a.errors[0] || "") : "")); });
        });
      }).then(function () { b.disabled = false; if (RB().reloadData) RB().reloadData(); }, function (x) { b.disabled = false; uiToast(errText(x)); });
    }
    var s = e.target.closest('[data-sqa="toggle"]');
    if (s && typeof SQ !== "undefined") {
      var q = (typeof SQS !== "undefined" ? SQS : []).find(function (x) { return x.id === SQ.sel; });
      if (!q || !q.db) return;
      e.stopPropagation(); e.preventDefault();
      if (q.status === "Activa") return api("/rest/v1/workspace_mailings?id=eq." + q.db, J("PATCH", { status: "pausada" })).then(function () { q.status = "Pausada"; uiToast("Pausada: lo ya programado en Resend se cancela desde Resend"); viewMailing(); });
      needMail().then(function () { return RB().mcp("mailing_save", { workspaceId: ws(), id: q.db, kind: "secuencia", name: q.name, brandId: (RB().brandId || {})[q.brand] || null, segment: q.groups[0] || "Todos", steps: q.steps.map(function (x) { return { d: x.d, subject: x.subject, tpl: x.tpl }; }) }); })
        .then(function () { if (!confirm("¿Activar la secuencia? El primer correo sale ahora y los siguientes quedan programados en tu proveedor.")) throw null; return api("/api/email/sequences/" + q.db + "/activate", J("POST", { workspaceId: ws() })); })
        .then(function (r) { q.status = "Activa"; uiToast("Activa: " + r.sent + " enviados ahora y " + r.scheduled + " programados para " + r.people + " personas"); if (RB().reloadData) RB().reloadData(); }, function (x) { if (x) uiToast(errText(x)); });
    }
  }, true);

  /* ───────── 3. Enlaces públicos ───────── */
  function linkPopup(title, sub, url, mailSubject, mailBody, after) {
    mx(title, sub, '<div class="fx-row" style="grid-template-columns:1fr auto;align-items:end"><div><label class="fx-lbl">Enlace público</label><input class="fx-in" readonly value="' + esc(url) + '" id="mbLk"></div><div class="ag-ctl"><button data-a="copy">Copiar</button><button data-a="open">Abrir</button></div></div>'
      + '<label class="fx-lbl">Mandarlo por correo (opcional)</label><div class="fx-row" style="grid-template-columns:1fr auto;align-items:center"><input class="fx-in" id="mbTo" type="email" placeholder="correo@cliente.com"><div class="ag-ctl"><button class="pri" data-a="mail">Enviar</button></div></div><p class="int-note" id="mbN" style="margin-top:6px">Se envía con el correo de tu espacio (Resend o Postmark).</p>',
      function (e) {
        var a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "copy") { copy(url); if (after) after("copy"); }
        if (a.dataset.a === "open") window.open(url, "_blank", "noopener");
        if (a.dataset.a === "mail") {
          var to = document.getElementById("mbTo").value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return document.getElementById("mbTo").focus();
          a.disabled = true;
          needMail().then(function () { return api("/api/email/send", J("POST", { workspaceId: ws(), to: to, subject: mailSubject, html: mailBody(url) })); })
            .then(function () { mxEl.hidden = true; uiToast("Enviado a " + to); if (after) after("mail"); }, function (x) { a.disabled = false; document.getElementById("mbN").textContent = errText(x); });
        }
      });
  }
  var btnHTML = function (t, url) { return '<div style="font:16px/1.55 Arial,sans-serif;max-width:560px;margin:auto;color:#111"><p>Hola,</p><p>' + t + '</p><p><a href="' + url + '" style="display:inline-block;background:#ff5e00;color:#fff;padding:11px 20px;border-radius:50px;text-decoration:none;font-weight:700">Abrir</a></p><p style="font-size:12px;color:#888">No necesitas crear una cuenta.</p></div>'; };

  /* formularios: URL real, copiar, insertar, pausar/activar y vista previa de la página real */
  var _fd = typeof formDetail === "function" ? formDetail : null, curForm = null;
  if (_fd) formDetail = function (i) {
    curForm = i;
    var r = _fd.apply(this, arguments), f = FORMS[i];
    if (!real() || !f || !f.db || !f.token) return r;
    var url = origin() + "/f/" + f.token;
    document.querySelectorAll("#body *").forEach(function (n) { if (n.children.length === 0 && /forms\.musa\.app\//.test(n.textContent)) n.textContent = n.textContent.replace(/(https:\/\/)?forms\.musa\.app\/\S+/, url); });
    if (FMX.prev) { var pv = document.querySelector("#body .fm-page, #body .lu-page, #body .fm-prev"); if (pv) pv.outerHTML = '<iframe src="' + esc(url) + '" style="width:100%;height:620px;border:0;border-radius:14px;background:#f3f1e7"></iframe>'; }
    return r;
  };
  document.addEventListener("click", function (e) {
    if (!real() || !e.target.closest) return;
    var a = e.target.closest("[data-fa2]");
    if (a && typeof FORMS !== "undefined") {
      var f = curForm != null ? FORMS[curForm] : null, i = curForm;
      if (!f || !f.db || !f.token) return;
      var url = origin() + "/f/" + f.token, k = a.dataset.fa2;
      if (k === "link") { e.stopPropagation(); e.preventDefault(); if (f.st !== "Activo") uiToast("Ojo: el formulario está pausado; actívalo para recibir respuestas"); return copy(url); }
      if (k === "embed") { e.stopPropagation(); e.preventDefault(); var code = '<iframe src="' + url + '" style="width:100%;min-height:640px;border:0"></iframe>'; mx("Código para insertar", "Pégalo en tu web: las respuestas entran igual al CRM.", '<textarea class="fx-in" rows="4" readonly>' + esc(code) + '</textarea><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="c">Copiar código</button></div>', function (ev) { if (ev.target.closest('[data-a="c"]')) { try { navigator.clipboard.writeText(code); } catch (x) {} uiToast("Código copiado"); } }); return; }
      if (k === "pause") { e.stopPropagation(); e.preventDefault(); var on = f.st !== "Activo"; api("/rest/v1/workspace_forms?id=eq." + f.db, J("PATCH", { published: on })).then(function () { f.st = on ? "Activo" : "Pausado"; uiToast(on ? "Activo: ya recibe respuestas en " + url : "Pausado: el enlace deja de recibir respuestas"); formDetail(i); }); return; }
    }
    /* brief: «Enviar enlace al cliente» */
    var bl = e.target.closest('[data-ba="link"]');
    if (bl && typeof BRIEFS !== "undefined" && typeof CL !== "undefined") {
      var br = BRIEFS.find(function (x) { return x.id === CL.brief; }); if (!br || !br.db || !br.token) return;
      e.stopPropagation(); e.preventDefault();
      var bu = origin() + "/b/" + br.token;
      return linkPopup("Brief para el cliente", "El cliente lo completa sin crear cuenta y te llega aquí, marcado como «llenado por el cliente».", bu, "Completa el brief: " + br.name, function (u) { return btnHTML("Para arrancar <b>" + esc(br.name) + "</b> necesitamos que completes este brief. Toma 5 minutos.", u); });
    }
    /* cotización: «Enviar para firma» → enlace del portal; la marca como Enviada */
    var qs = e.target.closest('[data-qa="send"]');
    if (qs && typeof QUOTES !== "undefined" && typeof CL !== "undefined") {
      var q = QUOTES.find(function (x) { return x.id === CL.quote; }); if (!q || !q.db || !q.token) return;
      e.stopPropagation(); e.preventDefault();
      var qu = origin() + "/q/" + q.token;
      var mark = function () { if (q.st !== "Borrador") return Promise.resolve(); return api("/rest/v1/crm_quotes?id=eq." + q.db, J("PATCH", { status: "Enviada", sent_at: new Date().toISOString() })).then(function () { q.st = "Enviada"; if (RB().reloadData) RB().reloadData(); }); };
      mark().then(function () {
        linkPopup("Cotización para aprobar", "El cliente la revisa, la aprueba firmando con su nombre o pide cambios. Ves la respuesta aquí.", qu, "Cotización " + q.n + ": " + q.t, function (u) { return btnHTML("Te compartimos la cotización <b>" + esc(q.n) + " · " + esc(q.t) + "</b>. Puedes aprobarla o pedir cambios desde el enlace.", u); });
      }, function (x) { uiToast("No se pudo marcar como enviada: " + errText(x)); });
    }
  }, true);
})();
/* en modo real no se «simula» la firma: el botón da el enlace para el cliente */
(function () {
  if (typeof VIEWS2 === "undefined" || !VIEWS2.clQuotes) return;
  var _q = VIEWS2.clQuotes;
  VIEWS2.clQuotes = function () {
    var r = _q.apply(this, arguments);
    try { var R = window.__musaReal, q = R && R.on && QUOTES.find(function (x) { return x.id === CL.quote; }); var b = document.querySelector('#body [data-qa="send"]');
      if (q && q.db && b) b.textContent = q.st === "Borrador" ? "Enviar al cliente para aprobar" : "Ver enlace para el cliente";
      if (q && q.db && q.st === "Firmada" && q.signedBy) { var h = document.querySelector("#body .ag-box h3, #body article h3"); if (h && !document.getElementById("mbSig")) h.insertAdjacentHTML("afterend", '<p id="mbSig" style="font-size:12px;color:#22a35a;font-weight:700;margin:4px 0">Aprobada por ' + String(q.signedBy).replace(/[<>&]/g, "") + "</p>"); }
      if (q && q.db && q.st === "Rechazada" && q.clientComment) { var h2 = document.querySelector("#body .ag-box h3, #body article h3"); if (h2 && !document.getElementById("mbSig")) h2.insertAdjacentHTML("afterend", '<p id="mbSig" style="font-size:12px;color:#d7261e;font-weight:700;margin:4px 0">El cliente pidió cambios: ' + String(q.clientComment).replace(/[<>&]/g, "") + "</p>"); }
    } catch (e) {}
    return r;
  };
})();
