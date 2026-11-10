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
  /* fecha LOCAL (Lima): toISOString daba la de UTC y desde las 7 p. m. el reporte decía «mañana» */
  function iso(d) { var x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
  function dayOf(ts) { return ts ? iso(new Date(ts)) : ""; }
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
      return get(t + "?workspace_id=eq." + W + "&select=" + sel + (dateCol ? (dateCol.indexOf("_at") > 0
        /* columnas con hora: los bordes del día en hora local, no en UTC */
        ? "&" + dateCol + "=gte." + encodeURIComponent(new Date(P.from + "T00:00:00").toISOString()) + "&" + dateCol + "=lte." + encodeURIComponent(new Date(P.to + "T23:59:59").toISOString())
        : "&" + dateCol + "=gte." + P.from + "&" + dateCol + "=lte." + P.to) : "") + (B && !noBrand ? "&brand_id=eq." + encodeURIComponent(B) : "") + (extra || "") + "&limit=5000");
    };
    var S = o.sec, job = {};
    if (S.contenido) job.cal = w("content_calendar", "id,topic,status,channels,visual_type,scheduled_date,published_at,brand_id", "scheduled_date", "&order=scheduled_date.asc");
    if (S.crm) { job.deals = w("crm_deals", "id,title,stage,value,final_value,currency,brand_id,created_at", "created_at"); job.allDeals = w("crm_deals", "id,stage,value,final_value,currency,updated_at", "updated_at"); job.contacts = w("crm_contacts", "id,status,created_at,origin_source", "created_at"); }
    if (S.cotiz) job.quotes = w("crm_quotes", "id,number,title,status,total,currency,created_at,brand_id", "created_at", "&order=created_at.asc");
    if (S.ads) job.ads = w("campaigns", "id,name,status,campaign_type,budget_plan_usd,brief,created_at,brand_id", null);
    if (S.eventos) { job.events = w("workspace_events", "id,name,date,capacity,attendees,brand_id", "date", "&order=date.asc"); job.regs = w("workspace_event_regs", "id,event_id,status,created_at", null, "", true); }
    /* con marca elegida, todo se limita a esa marca (antes mailing, bandeja y producción traían las de todas) */
    var eqB = B ? encodeURIComponent(B) : "";
    if (S.mailing) job.mails = w("workspace_mailings", "id,subject,status,kind,send_at,created_at", "created_at", B ? "&content->>brand_id=eq." + eqB : "", true);
    /* la bandeja no guarda la marca de cada mensaje: con una marca elegida no se mezclan los de todas */
    if (S.bandeja && !B) job.inbox = w("social_inbox", "id,kind,platform,status,occurred_at,replied_at", "occurred_at", "", true);
    if (S.prod) { job.tpl = w("templates", "id,name,updated_at,brandId:data->>brandId,meta:design_file_meta(brand_id)", "updated_at", "&deleted_at=is.null&is_brand_manual=is.false", true); job.vids = w("musa_video_projects", "id,name,updated_at,brand_id", "updated_at", "&is_template=is.false"); job.tasks = w("design_kanban_tasks", "id,title,status,updated_at,brand_id", "updated_at"); }
    var keys = Object.keys(job);
    return Promise.all(keys.map(function (k) { return job[k]; })).then(function (r) {
      var d = {}; keys.forEach(function (k, i) { d[k] = r[i]; });
      if (B) {
        if (d.tpl) d.tpl = d.tpl.filter(function (t) { var m = Array.isArray(t.meta) ? t.meta[0] : t.meta; return ((m && m.brand_id) || t.brandId) === B; });
        if (d.regs && d.events) { var ev = {}; d.events.forEach(function (e) { ev[e.id] = 1; }); d.regs = d.regs.filter(function (x) { return ev[x.event_id]; }); }
        if (S.bandeja) d.inboxSkipped = true;
      }
      return d;
    });
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
        + "<h3>Oportunidades nuevas</h3>" + table("Oportunidades", ["Creada", "Título", "Marca", "Etapa", "Valor"], d.deals.map(function (x) { return [dayOf(x.created_at), x.title, bn(x.brand_id), STG[x.stage] || x.stage, money(val(x), x.currency)]; })));
    }
    if (d.quotes) {
      /* crm_quotes.total es el subtotal: el total que ve el cliente lleva IGV 18 % (igual que el editor y la página pública) */
      var conIgv = function (q) { return Math.round(Number(q.total || 0) * 118) / 100; };
      var tot = function (st) { return d.quotes.filter(function (q) { return !st || q.status === st; }).reduce(function (s, q) { return s + conIgv(q); }, 0); };
      var signed = d.quotes.filter(function (q) { return q.status === "Firmada"; }).length;
      sec("Cotizaciones", tiles([["Emitidas", num(d.quotes.length)], ["Firmadas", num(signed)], ["Tasa de cierre", pct(signed, d.quotes.length)], ["Monto firmado", money(tot("Firmada"))]])
        + table("Cotizaciones", ["N.°", "Título", "Marca", "Estado", "Subtotal", "Total con IGV"], d.quotes.map(function (q) { return [q.number, q.title, bn(q.brand_id), q.status, money(q.total, q.currency), money(conIgv(q), q.currency)]; })));
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
      + table("Mailing", ["Creado", "Asunto", "Tipo", "Estado"], d.mails.map(function (m) { return [dayOf(m.created_at), m.subject, m.kind === "secuencia" ? "Secuencia" : "Campaña", m.status]; })));
    if (d.inboxSkipped) sec("Bandeja y comentarios", '<p class="note">La bandeja no separa los mensajes por marca todavía, así que no se incluye en un reporte de una sola marca. Para verla completa, genera el reporte con «Todas mis marcas».</p>');
    if (d.inbox) {
      var rep = d.inbox.filter(function (m) { return m.replied_at || m.status === "replied" || m.status === "done"; }).length;
      sec("Bandeja y comentarios", tiles([["Mensajes recibidos", num(d.inbox.length)], ["Respondidos", num(rep)], ["Tasa de respuesta", pct(rep, d.inbox.length)]])
        + table("Bandeja por red", ["Red", "Mensajes"], count(d.inbox, function (m) { return m.platform || "—"; })));
    }
    if (d.tpl) {
      var done = d.tasks.filter(function (t) { return t.status === "done"; }).length;
      sec("Producción", tiles([["Diseños trabajados", num(d.tpl.length)], ["Videos trabajados", num(d.vids.length)], ["Tareas movidas", num(d.tasks.length)], ["Tareas terminadas", num(done)]])
        + table("Tareas", ["Actualizada", "Tarea", "Marca", "Estado"], d.tasks.map(function (t) { return [dayOf(t.updated_at), t.title, bn(t.brand_id), t.status]; })));
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
  function pdf(rep, o) { return htmlPdf(rep.html, rep.css, fileBase(rep, o) + ".pdf"); }
  /* HTML (un .rp de 794 px) → PDF A4 en páginas. Lo usan Reportes y el PDF de cotizaciones (RR().htmlPdf). */
  function htmlPdf(html, css, filename) {
    uiToast("Armando el PDF…");
    return Promise.all([loadLib("vendor/html2canvas.min.js", "html2canvas"), loadLib("vendor/jspdf.umd.min.js", "jspdf")]).then(function () {
      var host = document.createElement("div"); host.style.cssText = "position:fixed;left:-10000px;top:0";
      host.innerHTML = "<style>" + css.replace(/body\{/, ".rphost{") + "</style><div class=\"rphost\">" + html + "</div>"; document.body.appendChild(host);
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
        J.save(filename);
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
    var seenB = {}, bs = Object.keys(R.brandName || {}).sort().filter(function (id) { var k = ((R.wsOf && R.wsOf["brand:" + id]) || "") + "|" + String(R.brandName[id]).toLowerCase(); if (seenB[k]) return false; seenB[k] = 1; return true; })
      .map(function (id) { return [id, R.brandName[id]]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); });
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
      /* tarda unos segundos (lee cada módulo): que se note que está trabajando (QA B5) */
      err.style.color = "var(--muted)"; err.textContent = "Leyendo tus datos de " + Object.keys(s).length + " secciones… unos segundos.";
      uiToast("Armando tu reporte…");
      collect(o).then(function (d) { preview(build(o, d), o); }, function (x) { btn.disabled = false; btn.textContent = "Generar reporte"; err.style.color = "#d33"; err.textContent = "No se pudo generar: " + (x && x.message); });
    });
    document.getElementById("rpP").onchange = function (e) { document.getElementById("rpC").style.display = e.target.value === "custom" ? "grid" : "none"; };
  }

  document.addEventListener("click", function (e) {
    var R = RR(); if (!R || !R.on || route.mod !== "medir" || !e.target.closest || !e.target.closest(".head .actions .btn-p")) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); form();
  }, true);
  var _dv = drawView;
  drawView = function () { var r = _dv.apply(this, arguments); try { if (route.mod === "medir" && RR() && RR().on) { var a = document.querySelector(".head .actions .btn-p"); if (a) a.textContent = "Generar reporte"; } } catch (x) {} return r; };

  /* ───────── Manual de marca en PDF (Marcas › Sistemas y guías) ─────────
   * Antes era de ejemplo: mostraba siempre las páginas de «Futuraria» y el PDF solo decía «descargado».
   * Ahora se arma con la marca que estás viendo: logo, paleta, tipografías, reglas y estrategia. */
  /* en la vista «Todo» la marca puede estar en cualquiera de tus espacios */
  function wsFilter() {
    var R = RR(), ids = (R.realWs || []).filter(function (id) { return id && id !== "__todo"; });
    return R.all && ids.length ? "in.(" + ids.map(encodeURIComponent).join(",") + ")" : "eq." + encodeURIComponent(R.ws);
  }
  function brandRow(name) {
    return get("brands?workspace_id=" + wsFilter() + "&name=eq." + encodeURIComponent(name) + "&select=id,name,colors,fonts,rules,logo,strategy_json&limit=1").then(function (r) { return r[0] || null; });
  }
  /* la pregunta dice para qué es (antes siempre «¿De qué marca armo el manual?», QA N1) y sin marcas repetidas */
  function pickBrandName(ask) {
    var R = RR(), hr = typeof hubRoute === "function" ? hubRoute() : null;
    if (hr) return Promise.resolve(hr[0]);
    var seen = {}, names = Object.keys(R.brandName || {}).map(function (id) { return R.brandName[id]; })
      .filter(function (n) { var k = String(n || "").trim().toLowerCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; }).sort(function (a, b) { return a.localeCompare(b); });
    if (names.length === 1) return Promise.resolve(names[0]);
    if (!names.length) return Promise.resolve(null);
    return R.choose ? R.choose(ask || "¿De qué marca armo el manual?", names.map(function (n) { return { value: n, label: n }; })) : Promise.resolve(names[0]);
  }
  function manualPages(b) {
    var cols = (b.colors || []).map(function (c) { return typeof c === "string" ? { hex: c } : c || {}; }).filter(function (c) { return /^#[0-9a-f]{3,8}$/i.test(c.hex || ""); });
    var fonts = (b.fonts || []).map(function (f) { return typeof f === "string" ? f : f && (f.family || f.name); }).filter(Boolean);
    var rules = (b.rules || []).map(function (r) { return typeof r === "string" ? r : r && (r.text || r.rule || r.description); }).filter(Boolean);
    var st = b.strategy_json && typeof b.strategy_json === "object" ? b.strategy_json : {};
    var pick = function (k) { var v = st[k]; return typeof v === "string" ? v : v && (v.text || v.summary || v.value) || ""; };
    var acc = (cols[0] || {}).hex || "#ff5e00", ink = "#111", logo = typeof b.logo === "string" ? b.logo : (b.logo && (b.logo.url || b.logo.src)) || "";
    if (!/^https?:\/\//.test(logo)) logo = "";
    var fTitle = fonts[0] || "Inter", fBody = fonts[1] || fonts[0] || "Inter";
    var pg = function (title, n, body, bg, fg) { return '<section class="pg" style="background:' + (bg || "#fff") + ";color:" + (fg || ink) + '"><div class="hd"><span>' + esc(b.name) + " · Manual de marca</span><span>" + n + "</span></div>" + (title ? "<h2>" + esc(title) + "</h2>" : "") + body + "</section>"; };
    var pages = [];
    pages.push('<section class="pg cover" style="background:' + acc + '"><small>Manual de marca</small><h1 style="font-family:\'' + esc(fTitle) + '\',Inter,sans-serif">' + esc(b.name) + "</h1><p>" + new Date().toLocaleDateString("es-PE", { month: "long", year: "numeric" }) + "</p></section>");
    pages.push(pg("Logo", "02", logo ? '<div class="logo"><img src="' + esc(logo) + '" crossorigin="anonymous" alt=""></div><p class="cap">Respeta su área de seguridad: deja libre alrededor al menos la altura de la letra más alta. No lo deformes, no cambies sus colores ni le agregues efectos.</p>'
      : '<div class="logo"><b style="font-family:\'' + esc(fTitle) + '\',Inter,sans-serif">' + esc(b.name) + '</b></div><p class="cap">Esta marca todavía no tiene logo cargado en Musa. Súbelo en Crear › Marcas y el manual lo incluye solo.</p>'));
    pages.push(pg("Paleta", "03", cols.length ? '<div class="sw">' + cols.slice(0, 8).map(function (c) { return '<div><i style="background:' + esc(c.hex) + '"></i><b>' + esc(c.name || c.hex) + "</b><span>" + esc(c.hex.toUpperCase()) + (c.role ? " · " + esc(c.role) : "") + "</span></div>"; }).join("") + "</div>"
      : '<p class="cap">Sin colores todavía: agrégalos en el sistema de diseño de la marca.</p>'));
    pages.push(pg("Tipografía", "04", fonts.length ? fonts.slice(0, 3).map(function (f, i) { return '<div class="ty"><span>' + (i === 0 ? "Titulares" : i === 1 ? "Texto" : "Apoyo") + "</span><b style=\"font-family:'" + esc(f) + "',Inter,sans-serif\">" + esc(f) + "</b><p style=\"font-family:'" + esc(f) + "',Inter,sans-serif\">ABCDEFGHIJKLMNÑOPQRSTUVWXYZ<br>abcdefghijklmnñopqrstuvwxyz 0123456789</p></div>"; }).join("")
      : '<p class="cap">Sin tipografías todavía: agrégalas en el sistema de diseño de la marca.</p>'));
    var voice = ["proposito", "purpose", "propuesta_valor", "value_proposition", "voz", "voice", "tono", "tone", "publico", "audience"].map(function (k) { return [k, pick(k)]; }).filter(function (x) { return x[1]; });
    var LBL = { proposito: "Propósito", purpose: "Propósito", propuesta_valor: "Propuesta de valor", value_proposition: "Propuesta de valor", voz: "Voz", voice: "Voz", tono: "Tono", tone: "Tono", publico: "Público", audience: "Público" };
    pages.push(pg("Voz y reglas", "05", (voice.length ? voice.slice(0, 4).map(function (v) { return '<div class="vo"><span>' + LBL[v[0]] + "</span><p>" + esc(v[1]).slice(0, 600) + "</p></div>"; }).join("") : "")
      + (rules.length ? '<h3>Reglas</h3><ol class="rl">' + rules.slice(0, 14).map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ol>" : (voice.length ? "" : '<p class="cap">Sin reglas ni estrategia todavía: complétalas en la marca y vuelve a generar el manual.</p>'))));
    pages.push('<section class="pg cover" style="background:' + ink + ';color:#fff"><small style="color:' + acc + '">' + esc(b.name) + '</small><h1 style="font-family:\'' + esc(fTitle) + '\',Inter,sans-serif;font-size:64px">Gracias</h1><p>Manual generado con Musa desde el sistema de diseño vigente de la marca.</p></section>');
    var css = "*{box-sizing:border-box}body{margin:0;font:14px/1.55 '" + fBody + "',Inter,system-ui,sans-serif}.rp{width:794px;margin:0 auto}"
      + ".pg{height:1123px;padding:64px 64px;position:relative;overflow:hidden}.hd{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.55;margin-bottom:48px}"
      + "h2{font:800 46px/1.05 '" + fTitle + "',Inter,sans-serif;margin:0 0 34px}h3{font:800 18px/1.2 Inter,sans-serif;margin:30px 0 10px}.cap{color:#666;max-width:560px}"
      + ".cover{display:flex;flex-direction:column;justify-content:flex-end;color:#fff}.cover small{font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:12px}.cover h1{font-size:92px;line-height:.95;margin:14px 0 18px;word-break:break-word}.cover p{opacity:.8;margin:0}"
      + ".logo{height:520px;display:grid;place-items:center;background:#f3f1e7;border-radius:18px;margin-bottom:24px}.logo img{max-width:70%;max-height:60%}.logo b{font-size:84px}"
      + ".sw{display:grid;grid-template-columns:1fr 1fr;gap:18px}.sw div{border:1px solid #e6e3d6;border-radius:14px;overflow:hidden}.sw i{display:block;height:150px}.sw b{display:block;padding:12px 14px 0}.sw span{display:block;padding:0 14px 12px;color:#666;font-size:12px}"
      + ".ty{border-top:1px solid #e6e3d6;padding:18px 0 22px}.ty span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888}.ty b{display:block;font-size:44px;line-height:1.1;margin:6px 0}.ty p{margin:0;font-size:16px;color:#333}"
      + ".vo{margin-bottom:18px}.vo span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888}.vo p{margin:4px 0 0;font-size:16px}.rl{padding-left:20px}.rl li{margin:6px 0}";
    return { html: '<div class="rp">' + pages.join("") + "</div>", css: css, fonts: fonts, n: pages.length, acc: acc };
  }
  function loadFonts(fonts) {
    var fams = fonts.filter(function (f) { return /^[\w \-]+$/.test(f); });
    if (!fams.length) return Promise.resolve();
    var href = "https://fonts.googleapis.com/css2?" + fams.slice(0, 3).map(function (f) { return "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;700;800"; }).join("&") + "&display=swap";
    if (!document.querySelector('link[href="' + href + '"]')) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }
    return Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(function (r) { setTimeout(r, 2500); })]);
  }
  function realManual() {
    var R = RR(); if (!R || !R.on) return uiToast("Cargando tus datos…");
    pickBrandName().then(function (name) {
      if (!name) return uiToast("Crea una marca primero en Crear › Marcas");
      return brandRow(name).then(function (b) {
        if (!b) return uiToast("No encontré la marca «" + name + "» en este espacio");
        var m = manualPages(b);
        var body = '<div style="border:1.5px solid #d6d4c6;border-radius:12px;overflow:hidden;background:#f3f1e7"><iframe id="mmFrame" style="width:100%;height:56vh;border:0;display:block"></iframe></div>'
          + '<div class="ag-ctl" style="margin-top:14px"><button class="pri" data-a="pdf">Descargar PDF (' + m.n + ' páginas)</button><button data-a="html">Descargar HTML</button></div>';
        mx("Manual de marca · " + b.name, "Se arma con el sistema de diseño vigente de la marca: logo, paleta, tipografías, voz y reglas. Si cambias la marca, vuelve a generarlo.", body, function (e) {
          var a = e.target.closest("[data-a]"); if (!a) return;
          var file = "manual-" + b.name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, "-");
          if (a.dataset.a === "pdf") { a.disabled = true; loadFonts(m.fonts).then(function () { return htmlPdf(m.html, m.css, file + ".pdf"); }).then(function () { a.disabled = false; uiToast("Manual de " + b.name + " descargado"); }, function (x) { a.disabled = false; uiToast("No se pudo armar el PDF: " + (x && x.message)); }); }
          if (a.dataset.a === "html") { download(file + ".html", new Blob(["<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Manual de marca · " + esc(b.name) + "</title><style>" + m.css + "</style><body>" + m.html + "</body></html>"], { type: "text/html" })); uiToast("HTML descargado"); }
        });
        var f = document.getElementById("mmFrame");
        if (f) f.srcdoc = "<!doctype html><meta charset='utf-8'><style>" + m.css + "body{background:#e9e6da}.pg{margin:16px auto;width:794px;box-shadow:0 2px 20px rgba(0,0,0,.1);transform-origin:top center}</style><body>" + m.html;
      });
    });
  }
  if (typeof fxManual === "function") { var _fxm = fxManual; fxManual = function () { if (RR() && RR().on) return realManual(); return _fxm.apply(this, arguments); }; }

  /* ───────── Sistema de diseño real (Marcas › Sistema de diseño) ─────────
   * Antes toda la pestaña era de ejemplo: paleta lima/Syne de Futuraria, «103 % de cumplimiento», versiones v3/v4,
   * tokens #d2ff02/Anton y comparar/fusionar/extraer con piezas fijas, para cualquier marca. Ahora todo sale de la
   * marca real (brands.colors / fonts / rules / logo) y lo que se edita se guarda en ella. */
  function patchBrand(id, body) {
    var b = bridge(); if (!b) return Promise.reject(new Error("sin puente"));
    return b.api("/rest/v1/brands?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) });
  }
  function hexes(b) { return (b.colors || []).map(function (c) { return typeof c === "string" ? c : c && (c.hex || c.value); }).filter(function (c) { return /^#[0-9a-f]{3,8}$/i.test(c || ""); }); }
  function famsOf(b) { return (b.fonts || []).map(function (f) { return typeof f === "string" ? f : f && (f.family || f.name); }).filter(Boolean); }
  function brandFull(name) {
    return get("brands?workspace_id=" + wsFilter() + "&name=eq." + encodeURIComponent(name) + "&select=id,name,colors,fonts,rules,logo,strategy_json,updated_at&limit=1").then(function (r) { return r[0] || null; });
  }
  function brandDesigns(bid) {
    return get("templates?workspace_id=" + wsFilter() + "&deleted_at=is.null&is_brand_manual=is.false&select=id,name,updated_at,brandId:data->>brandId,meta:design_file_meta(brand_id)&order=updated_at.desc&limit=400").then(function (r) {
      return r.filter(function (t) { var m = Array.isArray(t.meta) ? t.meta[0] : t.meta; return ((m && m.brand_id) || t.brandId) === bid; });
    });
  }
  function afterSave(name, msg) { uiToast(msg); var R = RR(); var p = R.reload ? R.reload() : null; return Promise.resolve(p).then(function () { if (location.hash.indexOf("crear/marcas/") === 1) { try { drawView(); } catch (e) {} } }); }
  function currentBrandName() { var hr = typeof hubRoute === "function" ? hubRoute() : null; return hr ? hr[0] : null; }
  function withBrand(fn, ask) {
    var n = currentBrandName();
    (n ? Promise.resolve(n) : pickBrandName(ask)).then(function (name) {
      if (!name) return uiToast("Crea una marca primero en Crear › Marcas");
      return brandFull(name).then(function (b) { if (!b) return uiToast("No encontré la marca «" + name + "» en este espacio"); return fn(b); });
    });
  }
  function ago2(iso) { if (!iso) return "—"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }

  function realDsDetail(name) {
    var body = document.getElementById("body"); if (body) body.innerHTML = '<p class="empty-note">Cargando el sistema de ' + esc(name) + "…</p>";
    brandFull(name).then(function (b) {
      if (!b) { if (body) body.innerHTML = '<p class="empty-note">No encontré la marca «' + esc(name) + '» en este espacio.</p>'; return; }
      return brandDesigns(b.id).then(function (ds) {
        var cols = hexes(b), fonts = famsOf(b), rules = (b.rules || []).map(function (r) { return typeof r === "string" ? r : r && (r.text || r.rule); }).filter(Boolean);
        var c0 = cols[0] || "#111111", c1 = cols[1] || "#ffffff", fH = fonts[0] || "Inter", fB = fonts[1] || fonts[0] || "Inter";
        var logo = typeof b.logo === "string" ? b.logo : (b.logo && (b.logo.url || b.logo.src)) || "";
        var st = b.strategy_json && typeof b.strategy_json === "object" ? b.strategy_json : {};
        var voice = ["voz", "voice", "tono", "tone"].map(function (k) { var v = st[k]; return typeof v === "string" ? v : v && (v.text || v.summary) || ""; }).filter(Boolean)[0] || "";
        var html = '<div class="fx-row"><div><label class="fx-lbl">Logo</label><div style="display:flex;gap:10px">'
          + (/^https?:\/\//.test(logo) ? '<div style="width:96px;height:96px;border-radius:12px;background:#f3f1e7;display:grid;place-items:center"><img src="' + esc(logo) + '" alt="" style="max-width:80%;max-height:80%"></div>'
            : [[c0, c1], [c1, c0]].map(function (p) { return '<div style="width:96px;height:96px;border-radius:12px;background:' + esc(p[0]) + ";color:" + esc(p[1]) + ";display:grid;place-items:center;font:700 22px '" + esc(fH) + "',Inter,sans-serif;border:1px solid #0001\">" + esc(b.name.slice(0, 2).toUpperCase()) + "</div>"; }).join(""))
          + "</div>"
          + '<label class="fx-lbl">Paleta</label>' + (cols.length ? '<div class="fx-sw">' + cols.map(function (c) { return '<span><i style="background:' + esc(c) + '"></i>' + esc(c.toUpperCase()) + "</span>"; }).join("") + "</div>" : '<p class="empty-note" style="margin:4px 0">Sin colores todavía: usa «Editar tokens» o «Extraer de una pieza».</p>')
          + '<label class="fx-lbl">Tipografía</label>' + (fonts.length ? "<div style=\"font-family:'" + esc(fH) + "',var(--serif);font-size:40px;line-height:1;color:#111\">Aa " + esc(fH) + "</div><div style=\"font-family:'" + esc(fB) + "';font-size:14px;color:#333;margin-top:6px\">Cuerpo en " + esc(fB) + "</div>" : '<p class="empty-note" style="margin:4px 0">Sin tipografías todavía.</p>')
          + '<label class="fx-lbl">Componentes</label><div style="display:flex;gap:8px;flex-wrap:wrap"><span style="background:' + esc(c0) + ";color:" + esc(c1) + ';padding:8px 16px;border-radius:50px;font-weight:700">Botón primario</span><span style="border:2px solid ' + esc(c0) + ";color:" + esc(c0) + ';padding:6px 16px;border-radius:50px;font-weight:700">Secundario</span></div></div>'
          + "<div>" + (voice ? '<label class="fx-lbl">Voz</label><p style="margin:4px 0;font-size:13px">' + esc(voice).slice(0, 400) + "</p>" : "")
          + (rules.length ? '<label class="fx-lbl">Reglas</label><ul style="margin:4px 0;padding-left:18px;font-size:13px">' + rules.slice(0, 8).map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" : "")
          + '<label class="fx-lbl">Piezas de la marca · ' + ds.length + "</label>" + (ds.length ? '<ul style="margin:4px 0;padding-left:18px;font-size:13px">' + ds.slice(0, 8).map(function (t) { return '<li><a href="#crear/disenos/tpl:' + esc(t.id) + '">' + esc(t.name) + "</a> <small style=\"color:#888\">" + ago2(t.updated_at) + "</small></li>"; }).join("") + "</ul>" : '<p class="empty-note" style="margin:4px 0">Todavía no hay diseños de esta marca.</p>')
          + '<small style="color:#888">Para revisar si una pieza respeta el sistema, ábrela y usa «Verificar sistema» en el editor.</small>'
          + '<label class="fx-lbl">Última actualización</label><small>' + ago2(b.updated_at) + "</small></div></div>"
          + '<div class="ag-ctl" style="margin-top:12px"><button class="pri" data-dsa="man">Manual de marca PDF</button><button data-dsa="tok">Exportar tokens</button><button data-dsa="ed">Editar tokens</button><button data-dsa="ext">Extraer de una pieza</button><button data-dsa="merge">Fusionar con otra marca</button></div>';
        detail("Marcas", esc(b.name), (cols.length + fonts.length) + " tokens · " + esc([cols[0], fonts[0]].filter(Boolean).join(" · ")), html, function (e) {
          var a = e.target.closest("[data-dsa]"); if (!a) return;
          ({ man: function () { fxManual(); }, tok: function () { fxTokens(); }, ed: function () { editTokens(b); }, ext: function () { fxExtract(); }, merge: function () { fxGuideMerge(); } })[a.dataset.dsa]();
        });
      });
    });
  }
  function editTokens(b) {
    var R = RR();
    R.dialog({ title: "Editar tokens · " + b.name, message: "Un color por línea (hex, por ejemplo #FF5E00) y una tipografía por línea; la primera es la principal. Se guarda en la marca y lo usan sus diseños, el manual y tus IAs.", ok: "Guardar", wide: true,
      fields: [{ name: "colors", label: "Colores", type: "textarea", rows: 6, value: hexes(b).join("\n") }, { name: "fonts", label: "Tipografías", type: "textarea", rows: 3, value: famsOf(b).join("\n") }] }).then(function (v) {
      if (!v) return;
      var cols = String(v.colors || "").split(/[\s,;]+/).map(function (x) { x = x.trim(); return x && x[0] !== "#" ? "#" + x : x; }).filter(function (x) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(x); });
      var fonts = String(v.fonts || "").split(/\n+/).map(function (x) { return x.replace(/["']/g, "").trim(); }).filter(Boolean).slice(0, 6);
      return patchBrand(b.id, { colors: cols, fonts: fonts }).then(function () { return afterSave(b.name, "Tokens de " + b.name + " guardados"); }, function (x) { uiToast("No se pudo guardar: " + (x && x.message)); });
    });
  }
  function realTokens(fmtK) {
    withBrand(function (b) {
      var cols = hexes(b), fonts = famsOf(b), tk = {};
      cols.forEach(function (c, i) { tk["color-" + (i === 0 ? "primario" : i === 1 ? "secundario" : "acento-" + (i - 1))] = c; });
      if (fonts[0]) tk["font-titulo"] = fonts[0]; if (fonts[1] || fonts[0]) tk["font-cuerpo"] = fonts[1] || fonts[0];
      var show = function (k) {
        var code = k === "json" ? JSON.stringify(tk, null, 2)
          : k === "tailwind" ? "module.exports = { theme: { extend: {\n  colors: {\n" + Object.keys(tk).filter(function (x) { return /^color/.test(x); }).map(function (x) { return '    "' + x.replace(/^color-/, "") + '": "' + tk[x] + '"'; }).join(",\n") + "\n  },\n  fontFamily: {\n" + Object.keys(tk).filter(function (x) { return /^font/.test(x); }).map(function (x) { return '    "' + x.replace(/^font-/, "") + '": ["' + tk[x] + '", "sans-serif"]'; }).join(",\n") + "\n  }\n} } };"
          : ":root {\n" + Object.keys(tk).map(function (x) { return "  --" + x + ": " + (/^font/.test(x) ? '"' + tk[x] + '"' : tk[x]) + ";"; }).join("\n") + "\n}";
        mx("Tokens · " + b.name, "Para la web del cliente o su equipo de desarrollo. Salen de la marca guardada en Musa.",
          '<div class="seg" style="display:inline-flex;margin-bottom:8px">' + ["css", "json", "tailwind"].map(function (x) { return '<button data-f="' + x + '" class="' + (x === k ? "on" : "") + '">' + x.toUpperCase() + "</button>"; }).join("") + '</div><textarea class="fx-in" id="tkOut" style="min-height:240px;font-family:monospace" readonly>' + esc(Object.keys(tk).length ? code : "/* Esta marca todavía no tiene colores ni tipografías */") + '</textarea><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="copy">Copiar</button><button data-a="dl">Descargar</button></div>',
          function (e) {
            var f = e.target.closest("[data-f]"), a = e.target.closest("[data-a]");
            if (f) return show(f.dataset.f);
            if (a && a.dataset.a === "copy") { try { navigator.clipboard.writeText(document.getElementById("tkOut").value); } catch (x) {} uiToast("Tokens copiados"); }
            if (a && a.dataset.a === "dl") { download("tokens-" + b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + (k === "json" ? ".json" : k === "tailwind" ? ".tailwind.js" : ".css"), new Blob([document.getElementById("tkOut").value], { type: "text/plain" })); uiToast("Tokens descargados"); }
          });
      };
      show(fmtK || "css");
    }, "¿De qué marca exporto los tokens?");
  }
  /* colores y tipografías de un diseño real, leídos de su HTML/CSS (sin crear nada en el servidor) */
  function readDesign(id) {
    return bridge().api("/api/templates/" + encodeURIComponent(id)).then(function (r) {
      var t = (r && r.data) || r || {}, txt = "";
      (t.frames || []).forEach(function (f) { txt += " " + (f.css || "") + " " + (f.html || ""); });
      txt += " " + (t.css || "") + " " + (t.html || "");
      var cnt = {}, fc = {};
      (txt.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).forEach(function (h) { h = h.toUpperCase(); if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; cnt[h] = (cnt[h] || 0) + 1; });
      (txt.match(/font-family\s*:\s*[^;}"<]+/gi) || []).forEach(function (d) { var f = d.split(":")[1].split(",")[0].replace(/['"&;]|quot/g, "").trim(); if (f && !/^(inherit|initial|serif|sans-serif|monospace|system-ui|var\()/i.test(f)) fc[f] = (fc[f] || 0) + 1; });
      var top = function (o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, n); };
      return { colors: top(cnt, 8), fonts: top(fc, 3) };
    });
  }
  function realExtract() {
    withBrand(function (b) {
      brandDesigns(b.id).then(function (ds) {
        if (!ds.length) return uiToast("Esta marca todavía no tiene diseños: crea o importa uno en Diseños");
        return RR().choose("¿De qué pieza extraigo el sistema de " + b.name + "?", ds.slice(0, 40).map(function (t) { return { value: t.id, label: t.name }; })).then(function (id) {
          if (!id) return;
          uiToast("Leyendo la pieza…");
          return readDesign(id).then(function (x) {
            if (!x.colors.length && !x.fonts.length) return uiToast("No encontré colores ni tipografías en esa pieza");
            mx("Sistema extraído · " + b.name, "Esto encontré en la pieza. Si lo guardas, reemplaza la paleta y las tipografías de la marca.",
              '<label class="fx-lbl">Colores</label><div class="fx-sw">' + x.colors.map(function (c) { return '<span><i style="background:' + c + '"></i>' + c + "</span>"; }).join("") + '</div><label class="fx-lbl">Tipografías</label><p>' + (x.fonts.map(esc).join(", ") || "—") + '</p><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="save">Guardar en ' + esc(b.name) + "</button></div>",
              function (e) { if (!e.target.closest('[data-a="save"]')) return; mxEl.hidden = true; patchBrand(b.id, { colors: x.colors, fonts: x.fonts.length ? x.fonts : famsOf(b) }).then(function () { afterSave(b.name, "Sistema de " + b.name + " actualizado desde la pieza"); }, function (er) { uiToast("No se pudo guardar: " + (er && er.message)); }); });
          });
        });
      }).catch(function (x) { uiToast("No se pudo leer la pieza: " + (x && x.message)); });
    }, "¿A qué marca le extraigo el sistema de una pieza?");
  }
  function realMerge() {
    withBrand(function (a) {
      var R = RR(), others = Object.keys(R.brandName || {}).map(function (id) { return R.brandName[id]; }).filter(function (n) { return n !== a.name; });
      if (!others.length) return uiToast("Necesitas otra marca en este espacio para fusionar");
      R.choose("¿Con qué marca fusiono el sistema de " + a.name + "?", others.map(function (n) { return { value: n, label: n }; })).then(function (n) {
        if (!n) return;
        return brandFull(n).then(function (b2) {
          if (!b2) return;
          var ca = hexes(a), cb = hexes(b2), cols = ca.concat(cb.filter(function (c) { return ca.map(function (x) { return x.toUpperCase(); }).indexOf(c.toUpperCase()) < 0; })).slice(0, 12);
          var fa = famsOf(a), fb = famsOf(b2), fonts = fa.concat(fb.filter(function (f) { return fa.indexOf(f) < 0; })).slice(0, 4);
          var conf = (fa[0] && fb[0] && fa[0] !== fb[0]) ? '<p class="int-note">Tipografía principal distinta: queda <b>' + esc(fa[0]) + "</b> (de " + esc(a.name) + ") y " + esc(fb[0]) + " pasa a secundaria. Puedes cambiarlo luego en «Editar tokens».</p>" : "";
          mx("Fusionar sistemas", "Lo que coincide se une; lo que falta en " + a.name + " se agrega desde " + b2.name + ". Se guarda en " + a.name + "; " + b2.name + " no cambia.",
            '<label class="fx-lbl">Paleta resultante</label><div class="fx-sw">' + cols.map(function (c) { return '<span><i style="background:' + c + '"></i>' + c + "</span>"; }).join("") + '</div><label class="fx-lbl">Tipografías</label><p>' + (fonts.map(esc).join(", ") || "—") + "</p>" + conf + '<div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="save">Guardar en ' + esc(a.name) + "</button></div>",
            function (e) { if (!e.target.closest('[data-a="save"]')) return; mxEl.hidden = true; patchBrand(a.id, { colors: cols, fonts: fonts }).then(function () { afterSave(a.name, "Sistemas fusionados en " + a.name); }, function (er) { uiToast("No se pudo guardar: " + (er && er.message)); }); });
        });
      });
    }, "¿Qué marca quieres fusionar?");
  }
  function realDiff() {
    withBrand(function (b) {
      mx("Versiones del sistema · " + b.name, "Musa guarda el sistema vigente de la marca. Para comparar contra otra guía, fusiónala con «Fusionar con otra marca» o extrae una pieza y revisa antes de guardar.",
        '<label class="fx-lbl">Vigente · actualizado ' + ago2(b.updated_at) + '</label><div class="fx-sw">' + (hexes(b).map(function (c) { return '<span><i style="background:' + c + '"></i>' + c + "</span>"; }).join("") || "<span>Sin colores</span>") + "</div><p>" + (famsOf(b).map(esc).join(", ") || "Sin tipografías") + "</p>", function () {});
    }, "¿De qué marca comparo las versiones?");
  }
  RR() && (RR().applyDsTemplate = function (name, cols, fonts, tname) {
    return brandFull(name).then(function (b) {
      if (!b) { uiToast("No encontré la marca «" + name + "»"); return; }
      return patchBrand(b.id, { colors: cols, fonts: fonts }).then(function () { return afterSave(name, "Sistema de " + name + " creado desde «" + tname + "»"); }, function (x) { uiToast("No se pudo guardar: " + (x && x.message)); });
    });
  });
  var realOn = function () { return RR() && RR().on; };
  if (typeof dsDetail === "function") { var _dsd = dsDetail; dsDetail = function (i) { if (realOn()) { var t = TILES["crear/marcas"][i]; return realDsDetail(t ? t[0] : currentBrandName()); } return _dsd.apply(this, arguments); }; }
  if (typeof fxTokens === "function") { var _fxt = fxTokens; fxTokens = function (k) { if (realOn()) return realTokens(k); return _fxt.apply(this, arguments); }; }
  if (typeof fxExtract === "function") { var _fxe = fxExtract; fxExtract = function () { if (realOn()) return realExtract(); return _fxe.apply(this, arguments); }; }
  if (typeof fxGuideMerge === "function") { var _fxg = fxGuideMerge; fxGuideMerge = function () { if (realOn()) return realMerge(); return _fxg.apply(this, arguments); }; }
  if (typeof fxGuideDiff === "function") { var _fxd = fxGuideDiff; fxGuideDiff = function () { if (realOn()) return realDiff(); return _fxd.apply(this, arguments); }; }
  if (RR()) { RR().openReport = form; RR().htmlPdf = htmlPdf; }
})();
