/* bridge-report.js — Medir › «Generar reporte»: arma el reporte con los datos reales del workspace
 * (contenido, CRM, cotizaciones, ads, eventos, mailing, bandeja, producción) para el periodo y la marca
 * elegidos, lo muestra y lo deja descargar en PDF, Excel (CSV) o HTML. Nada programado: se genera al pedirlo.
 */
(function () {
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api("/rest/v1/" + path); }
  function get(path) { return api(path).catch(function () { return []; }).then(function (r) { return r || []; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 }).replace(/,/g, " "); }
  function money(n, c) { return (c === "USD" ? "US$ " : "S/ ") + num(n); }
  function pct(a, b) { return b ? Math.round(a * 100 / b) + " %" : "—"; }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function loadLib(src, glob) { if (window[glob]) return Promise.resolve(window[glob]); return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = function () { res(window[glob]); }; s.onerror = function () { rej(new Error("no cargó " + src)); }; document.head.appendChild(s); }); }
  function download(name, blob) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }

  var SECTIONS = [["contenido", "Contenido y calendario"], ["crm", "CRM: oportunidades y personas"], ["cotiz", "Cotizaciones"], ["ads", "Ads · pauta planificada"], ["eventos", "Eventos e inscritos"], ["mailing", "Mailing"], ["bandeja", "Bandeja y comentarios"], ["prod", "Producción (diseños, videos, tareas)"]];
  var WON = { approved: 1, in_production: 1, review: 1, ready: 1, delivered: 1 };
  var STG = { discovery: "Prospecto", proposal: "Propuesta", negotiation: "Negociación", approved: "Ganado", in_production: "Ganado", review: "Ganado", ready: "Ganado", delivered: "Ganado", lost: "Perdido" };

  function period(k, from, to) {
    var now = new Date(), a, b = new Date(now);
    if (k === "mes") a = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (k === "mespasado") { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    else if (k === "30") { a = new Date(now); a.setDate(a.getDate() - 30); }
    else if (k === "90") { a = new Date(now); a.setDate(a.getDate() - 90); }
    else if (k === "anio") a = new Date(now.getFullYear(), 0, 1);
    else { a = new Date(from + "T00:00:00"); b = new Date(to + "T00:00:00"); }
    return { from: iso(a), to: iso(b), label: a.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }) + " – " + b.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }) };
  }

  function collect(o) {
    var R = RR(), W = encodeURIComponent(R.ws), P = o.p, B = o.brand;
    var w = function (t, sel, dateCol, extra, noBrand) {
      return get(t + "?workspace_id=eq." + W + "&select=" + sel + (dateCol ? "&" + dateCol + "=gte." + P.from + "&" + dateCol + "=lte." + P.to + (dateCol.indexOf("_at") > 0 ? "T23:59:59" : "") : "") + (B && !noBrand ? "&brand_id=eq." + encodeURIComponent(B) : "") + (extra || "") + "&limit=5000");
    };
    var S = o.sec, job = {};
    if (S.contenido) job.cal = w("content_calendar", "id,topic,status,channels,visual_type,scheduled_date,published_at,brand_id", "scheduled_date", "&order=scheduled_date.asc");
    if (S.crm) { job.deals = w("crm_deals", "id,title,stage,value,final_value,currency,brand_id,created_at", "created_at"); job.allDeals = w("crm_deals", "id,stage,value,final_value,currency,updated_at", "updated_at"); job.contacts = w("crm_contacts", "id,status,created_at,origin_source", "created_at"); }
    if (S.cotiz) job.quotes = w("crm_quotes", "id,number,title,status,total,currency,created_at,brand_id", "created_at", "&order=created_at.asc");
    if (S.ads) job.ads = w("campaigns", "id,name,status,campaign_type,budget_plan_usd,brief,created_at,brand_id", null);
    if (S.eventos) { job.events = w("workspace_events", "id,name,date,capacity,attendees,brand_id", "date", "&order=date.asc"); job.regs = w("workspace_event_regs", "id,event_id,status,created_at", null, "", true); }
    if (S.mailing) job.mails = w("workspace_mailings", "id,subject,status,kind,send_at,created_at", "created_at", "", true);
    if (S.bandeja) job.inbox = w("social_inbox", "id,kind,platform,status,occurred_at,replied_at", "occurred_at", "", true);
    if (S.prod) { job.tpl = w("templates", "id,name,updated_at", "updated_at", "&deleted_at=is.null", true); job.vids = w("musa_video_projects", "id,name,updated_at", "updated_at", "&is_template=is.false", true); job.tasks = w("design_kanban_tasks", "id,title,status,updated_at,brand_id", "updated_at"); }
    var keys = Object.keys(job);
    return Promise.all(keys.map(function (k) { return job[k]; })).then(function (r) { var d = {}; keys.forEach(function (k, i) { d[k] = r[i]; }); return d; });
  }

  function build(o, d) {
    var R = RR(), bn = function (id) { return (id && R.brandName[id]) || "—"; }, parts = [], csv = [], kpis = [];
    var sec = function (title, body) { parts.push('<section><h2>' + esc(title) + "</h2>" + body + "</section>"); };
    var table = function (name, head, rows) {
      csv.push([name], head, rows.length ? rows : [["(sin datos)"]], []);
      return '<table><thead><tr>' + head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" + (rows.length ? rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") : '<tr><td colspan="' + head.length + '" class="empty">Sin datos en este periodo</td></tr>') + "</tbody></table>";
    };
    var tiles = function (arr) { arr.forEach(function (k) { kpis.push(k); }); return '<div class="tiles">' + arr.map(function (k) { return "<div><b>" + esc(k[1]) + "</b><span>" + esc(k[0]) + "</span></div>"; }).join("") + "</div>"; };
    var count = function (arr, f) { var m = {}; arr.forEach(function (x) { var k = f(x); m[k] = (m[k] || 0) + 1; }); return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).map(function (k) { return [k, m[k]]; }); };

    if (d.cal) {
      var pub = d.cal.filter(function (c) { return c.published_at || /publica/.test(c.status || ""); }), apr = d.cal.filter(function (c) { return /aprob|program/.test(c.status || ""); });
      var ch = {}; d.cal.forEach(function (c) { (c.channels || []).forEach(function (x) { ch[x] = (ch[x] || 0) + 1; }); });
      sec("Contenido y calendario", tiles([["Piezas planificadas", num(d.cal.length)], ["Publicadas", num(pub.length)], ["Aprobadas / programadas", num(apr.length)], ["Cumplimiento", pct(pub.length, d.cal.length)]])
        + "<h3>Por canal</h3>" + table("Contenido por canal", ["Canal", "Piezas"], Object.keys(ch).map(function (k) { return [k, ch[k]]; }))
        + "<h3>Detalle</h3>" + table("Piezas", ["Fecha", "Tema", "Formato", "Marca", "Estado"], d.cal.map(function (c) { return [c.scheduled_date, c.topic || "—", c.visual_type || "post", bn(c.brand_id), c.published_at ? "Publicada" : c.status || "—"]; })));
    }
    if (d.deals) {
      var won = d.allDeals.filter(function (x) { return WON[x.stage]; }), val = function (x) { return Number(x.final_value != null ? x.final_value : x.value) || 0; };
      var pipe = d.allDeals.filter(function (x) { return !WON[x.stage] && x.stage !== "lost"; });
      sec("CRM", tiles([["Oportunidades nuevas", num(d.deals.length)], ["Personas nuevas", num(d.contacts.length)], ["Ganadas (periodo)", num(won.length)], ["Valor ganado", money(won.reduce(function (s, x) { return s + val(x); }, 0))], ["En embudo", money(pipe.reduce(function (s, x) { return s + val(x); }, 0))]])
        + "<h3>Embudo por etapa</h3>" + table("Oportunidades por etapa", ["Etapa", "Cantidad"], count(d.deals, function (x) { return STG[x.stage] || x.stage; }))
        + "<h3>Oportunidades nuevas</h3>" + table("Oportunidades", ["Creada", "Título", "Marca", "Etapa", "Valor"], d.deals.map(function (x) { return [String(x.created_at).slice(0, 10), x.title, bn(x.brand_id), STG[x.stage] || x.stage, money(val(x), x.currency)]; })));
    }
    if (d.quotes) {
      var tot = function (st) { return d.quotes.filter(function (q) { return !st || q.status === st; }).reduce(function (s, q) { return s + Number(q.total || 0); }, 0); };
      var signed = d.quotes.filter(function (q) { return q.status === "Firmada"; }).length;
      sec("Cotizaciones", tiles([["Emitidas", num(d.quotes.length)], ["Firmadas", num(signed)], ["Tasa de cierre", pct(signed, d.quotes.length)], ["Monto firmado", money(tot("Firmada"))]])
        + table("Cotizaciones", ["N.°", "Título", "Marca", "Estado", "Total"], d.quotes.map(function (q) { return [q.number, q.title, bn(q.brand_id), q.status, money(q.total, q.currency)]; })));
    }
    if (d.ads) {
      var b = d.ads.reduce(function (s, a) { return s + Number(a.budget_plan_usd || 0); }, 0);
      sec("Ads · pauta planificada", tiles([["Campañas", num(d.ads.length)], ["Presupuesto planificado", "US$ " + num(b)]]) + '<p class="note">Gasto, impresiones y resultados aparecen cuando conectes tus cuentas de ads en Integraciones.</p>'
        + table("Campañas de ads", ["Campaña", "Marca", "Objetivo", "Presupuesto US$", "Estado"], d.ads.map(function (a) { var j = {}; try { j = JSON.parse(a.brief); } catch (e) { j = { obj: a.brief }; } return [a.name, bn(a.brand_id), j.obj || "—", num(a.budget_plan_usd), a.status]; })));
    }
    if (d.events) {
      var ids = {}; d.events.forEach(function (e) { ids[e.id] = 1; });
      var regs = d.regs.filter(function (r) { return ids[r.event_id]; }), att = regs.filter(function (r) { return r.status === "asistio"; }).length;
      sec("Eventos", tiles([["Eventos", num(d.events.length)], ["Inscritos", num(regs.length)], ["Asistieron", num(att)], ["Asistencia", pct(att, regs.length)]])
        + table("Eventos", ["Fecha", "Evento", "Marca", "Inscritos", "Cupos"], d.events.map(function (e) { return [e.date, e.name, bn(e.brand_id), regs.filter(function (r) { return r.event_id === e.id; }).length, e.capacity || "—"]; })));
    }
    if (d.mails) sec("Mailing", tiles([["Campañas", num(d.mails.filter(function (m) { return m.kind !== "secuencia"; }).length)], ["Secuencias", num(d.mails.filter(function (m) { return m.kind === "secuencia"; }).length)], ["Enviadas", num(d.mails.filter(function (m) { return /envi/.test(m.status || ""); }).length)]])
      + table("Mailing", ["Creado", "Asunto", "Tipo", "Estado"], d.mails.map(function (m) { return [String(m.created_at).slice(0, 10), m.subject, m.kind === "secuencia" ? "Secuencia" : "Campaña", m.status]; })));
    if (d.inbox) {
      var rep = d.inbox.filter(function (m) { return m.replied_at || m.status === "replied" || m.status === "done"; }).length;
      sec("Bandeja y comentarios", tiles([["Mensajes recibidos", num(d.inbox.length)], ["Respondidos", num(rep)], ["Tasa de respuesta", pct(rep, d.inbox.length)]])
        + table("Bandeja por red", ["Red", "Mensajes"], count(d.inbox, function (m) { return m.platform || "—"; })));
    }
    if (d.tpl) {
      var done = d.tasks.filter(function (t) { return t.status === "done"; }).length;
      sec("Producción", tiles([["Diseños trabajados", num(d.tpl.length)], ["Videos trabajados", num(d.vids.length)], ["Tareas movidas", num(d.tasks.length)], ["Tareas terminadas", num(done)]])
        + table("Tareas", ["Actualizada", "Tarea", "Marca", "Estado"], d.tasks.map(function (t) { return [String(t.updated_at).slice(0, 10), t.title, bn(t.brand_id), t.status]; })));
    }

    var title = o.title || "Reporte de resultados", who = o.brand ? bn(o.brand) : (WSS[R.ws] ? WSS[R.ws].name : "Mi espacio");
    var css = "*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:13px/1.5 Inter,system-ui,sans-serif}.rp{width:794px;padding:44px 48px;margin:0 auto;background:#fff}"
      + "header{border-bottom:3px solid #ff5e00;padding-bottom:14px;margin-bottom:22px}header small{color:#ff5e00;font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:10px}h1{font:800 30px/1.1 Inter,sans-serif;margin:6px 0 4px}header p{margin:0;color:#666}"
      + "h2{font:800 18px/1.2 Inter,sans-serif;margin:26px 0 10px}h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#777;margin:16px 0 6px}"
      + ".tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.tiles div{background:#f3f1e7;border-radius:10px;padding:10px 12px}.tiles b{display:block;font:800 20px/1.1 Inter,sans-serif}.tiles span{font-size:11px;color:#666}"
      + "table{width:100%;border-collapse:collapse;margin-top:4px;font-size:11.5px}th{text-align:left;background:#111;color:#fff;padding:6px 8px;font-weight:700}td{padding:5px 8px;border-bottom:1px solid #e6e3d6}td.empty{color:#999;text-align:center}.note{color:#777;font-size:11.5px}footer{margin-top:30px;color:#999;font-size:10.5px;border-top:1px solid #eee;padding-top:8px}";
    var html = '<div class="rp"><header><small>Musa · ' + esc(who) + "</small><h1>" + esc(title) + "</h1><p>" + esc(o.p.label) + "</p></header>" + (parts.join("") || '<p class="note">No elegiste secciones.</p>') + "<footer>Generado el " + new Date().toLocaleString("es-PE") + " con los datos de tu espacio en Musa.</footer></div>";
    return { html: html, css: css, csv: csv, title: title, who: who };
  }

  function toCSV(rows) { return "﻿" + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n"); }
  function fileBase(rep, o) { return ("reporte-" + rep.who + "-" + o.p.from + "-a-" + o.p.to).toLowerCase().replace(/[^a-z0-9áéíóúñ-]+/g, "-"); }
  function pdf(rep, o) {
    uiToast("Armando el PDF…");
    return Promise.all([loadLib("vendor/html2canvas.min.js", "html2canvas"), loadLib("vendor/jspdf.umd.min.js", "jspdf")]).then(function () {
      var host = document.createElement("div"); host.style.cssText = "position:fixed;left:-10000px;top:0";
      host.innerHTML = "<style>" + rep.css.replace(/body\{/, ".rphost{") + "</style><div class=\"rphost\">" + rep.html + "</div>"; document.body.appendChild(host);
      var el = host.querySelector(".rp");
      return html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false }).then(function (c) {
        host.remove();
        var J = new window.jspdf.jsPDF({ unit: "pt", format: "a4" }), pw = J.internal.pageSize.getWidth(), ph = J.internal.pageSize.getHeight(), k = pw / c.width, sliceH = Math.floor(ph / k), y = 0, first = true;
        while (y < c.height) {
          var part = document.createElement("canvas"); part.width = c.width; part.height = Math.min(sliceH, c.height - y);
          part.getContext("2d").drawImage(c, 0, y, c.width, part.height, 0, 0, c.width, part.height);
          if (!first) J.addPage(); first = false;
          J.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, part.height * k);
          y += sliceH;
        }
        J.save(fileBase(rep, o) + ".pdf");
      }, function (e) { host.remove(); throw e; });
    });
  }

  function preview(rep, o) {
    var body = '<div style="border:1.5px solid #d6d4c6;border-radius:12px;overflow:hidden;background:#fff"><iframe id="rpFrame" style="width:100%;height:60vh;border:0;display:block"></iframe></div>'
      + '<div class="ag-ctl" style="margin-top:12px"><button class="pri" data-a="pdf">Descargar PDF</button><button data-a="csv">Descargar Excel (CSV)</button><button data-a="html">Descargar HTML</button><button data-a="back">Cambiar filtros</button></div>';
    mx(rep.title, rep.who + " · " + o.p.label, body, function (e) {
      var a = e.target.closest("[data-a]"); if (!a) return;
      var k = a.dataset.a;
      if (k === "pdf") pdf(rep, o).then(function () { uiToast("PDF descargado"); }, function (x) { uiToast("No se pudo armar el PDF: " + (x && x.message)); });
      if (k === "csv") { download(fileBase(rep, o) + ".csv", new Blob([toCSV(rep.csv)], { type: "text/csv;charset=utf-8" })); uiToast("Excel (CSV) descargado"); }
      if (k === "html") { download(fileBase(rep, o) + ".html", new Blob(["<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>" + esc(rep.title) + "</title><style>" + rep.css + "</style><body>" + rep.html + "</body></html>"], { type: "text/html" })); uiToast("HTML descargado"); }
      if (k === "back") form(o);
    });
    var f = document.getElementById("rpFrame"); f.srcdoc = "<!doctype html><meta charset='utf-8'><style>" + rep.css + "body{background:#f3f1e7}.rp{margin:16px auto;box-shadow:0 2px 20px rgba(0,0,0,.08)}</style><body>" + rep.html;
  }

  function form(prev) {
    var R = RR(); if (!R || !R.on) return uiToast("Cargando tus datos…");
    prev = prev || {};
    var bs = Object.keys(R.brandName || {}).map(function (id) { return [id, R.brandName[id]]; });
    var sel = prev.sec || { contenido: 1, crm: 1, cotiz: 1, ads: 1, eventos: 1, mailing: 1, bandeja: 1, prod: 1 };
    var opt = function (arr, v) { return arr.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); };
    var body = '<div class="fx-row"><div><label class="fx-lbl">Título</label><input class="fx-in" id="rpT" value="' + esc(prev.title || "Reporte de resultados") + '"></div><div><label class="fx-lbl">Marca</label><select class="fx-in" id="rpB">' + opt([["", "Todas mis marcas"]].concat(bs), prev.brand || "") + "</select></div></div>"
      + '<div class="fx-row"><div><label class="fx-lbl">Periodo</label><select class="fx-in" id="rpP">' + opt([["mes", "Este mes"], ["mespasado", "Mes pasado"], ["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["anio", "Este año"], ["custom", "Elegir fechas…"]], prev.pk || "mes") + '</select></div><div id="rpC" style="display:' + (prev.pk === "custom" ? "grid" : "none") + ';grid-template-columns:1fr 1fr;gap:8px"><div><label class="fx-lbl">Desde</label><input class="fx-in" type="date" id="rpF" value="' + (prev.from || iso(new Date(Date.now() - 30 * 864e5))) + '"></div><div><label class="fx-lbl">Hasta</label><input class="fx-in" type="date" id="rpTo" value="' + (prev.to || iso(new Date())) + '"></div></div></div>'
      + '<label class="fx-lbl">Qué incluye</label><div class="ag-tags" id="rpS">' + SECTIONS.map(function (s) { return '<button type="button" class="ag-tag' + (sel[s[0]] ? " k" : "") + '" data-v="' + s[0] + '">' + s[1] + "</button>"; }).join("") + "</div>"
      + '<p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:10px 0 0;min-height:1em"></p><div class="ag-ctl" style="margin-top:6px"><button class="pri" data-a="go">Generar reporte</button><button data-mx="close">Cancelar</button></div>';
    mx("Generar reporte", "Se arma ahora con los datos de tu espacio. Lo ves aquí y lo descargas en PDF, Excel o HTML.", body, function (e) {
      var t = e.target.closest(".ag-tag"); if (t) { t.classList.toggle("k"); return; }
      if (!e.target.closest('[data-a="go"]')) return;
      var s = {}; [].forEach.call(document.querySelectorAll("#rpS .ag-tag.k"), function (b) { s[b.dataset.v] = 1; });
      var err = mxEl.querySelector(".mbc-err");
      if (!Object.keys(s).length) { err.textContent = "Elige al menos una sección"; return; }
      var pk = document.getElementById("rpP").value, from = document.getElementById("rpF").value, to = document.getElementById("rpTo").value;
      if (pk === "custom" && (!from || !to || from > to)) { err.textContent = "Revisa las fechas"; return; }
      var o = { title: document.getElementById("rpT").value.trim() || "Reporte de resultados", brand: document.getElementById("rpB").value, pk: pk, from: from, to: to, sec: s, p: period(pk, from, to) };
      var btn = e.target.closest("button"); btn.disabled = true; btn.textContent = "Generando…";
      collect(o).then(function (d) { preview(build(o, d), o); }, function (x) { btn.disabled = false; btn.textContent = "Generar reporte"; err.textContent = "No se pudo generar: " + (x && x.message); });
    });
    document.getElementById("rpP").onchange = function (e) { document.getElementById("rpC").style.display = e.target.value === "custom" ? "grid" : "none"; };
  }

  document.addEventListener("click", function (e) {
    var R = RR(); if (!R || !R.on || route.mod !== "medir" || !e.target.closest || !e.target.closest(".head .actions .btn-p")) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); form();
  }, true);
  var _dv = drawView;
  drawView = function () { var r = _dv.apply(this, arguments); try { if (route.mod === "medir" && RR() && RR().on) { var a = document.querySelector(".head .actions .btn-p"); if (a) a.textContent = "Generar reporte"; } } catch (x) {} return r; };
  if (RR()) RR().openReport = form;
})();
