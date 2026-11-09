/* bridge-code.js — «Editor de código» para todos los editores de Musa: diseño, fotos, video,
 * automatizaciones, tomas, clones y mailing. Muestra el ítem abierto como código (los mismos datos
 * que guarda Musa), deja editarlo y aplicarlo, y en «Para agentes» da la llamada MCP / REST exacta
 * para que una IA lo cree de forma nativa con una llave del workspace.
 */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path, init); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function J(o) { return JSON.stringify(o, null, 2); }
  function origin() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  function clean(o) { return JSON.parse(JSON.stringify(o, function (k, v) { return k.charAt(0) === "_" || typeof v === "function" ? undefined : v; })); }
  function put(path, body) { return api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function mcpCall(tool, args) {
    var body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } };
    return "# MCP (Claude, Cursor, Codex…): servidor " + origin() + "/mcp\n# Autorización: Bearer <llave del workspace> — créala en Configuración › Conecta tu IA\n\n"
      + "curl -X POST " + origin() + "/mcp \\\n  -H 'Authorization: Bearer fdr_ws_TU_LLAVE' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Accept: application/json, text/event-stream' \\\n  -d '" + JSON.stringify(body).replace(/'/g, "'\\''") + "'\n\n# Como tool call:\n" + J({ tool: tool, arguments: args });
  }
  function rest(method, path, body) { return "# REST (llave del workspace tipo «API / webhooks»)\ncurl -X " + method + " " + origin() + path + " \\\n  -H 'Authorization: Bearer fdr_ws_TU_LLAVE' \\\n  -H 'Content-Type: application/json'" + (body ? " \\\n  -d '" + JSON.stringify(body).replace(/'/g, "'\\''") + "'" : ""); }
  function frameDoc(html, css, w, h, bg) { return "<!doctype html><meta charset='utf-8'><style>html,body{margin:0;background:#1a1a1a}.st{position:relative;width:" + w + "px;height:" + h + "px;overflow:hidden;background:" + (bg || "#fff") + ";transform-origin:0 0}" + (css || "") + "</style><body><div class='st' id='st'>" + (html || "") + "</div><script>var s=document.getElementById('st'),k=Math.min(innerWidth/" + w + ",innerHeight/" + h + ",1);s.style.transform='scale('+k+')';<\/script>"; }

  /* ───────── adaptadores: qué es «el código» de cada editor ───────── */
  var A = {};

  A.design = {
    title: "Diseño",
    ready: function () { return typeof ED !== "undefined" && ED.open && ED.doc && ED.doc._real && RB()._ed && RB()._ed.payload; },
    files: function () {
      var p = RB()._ed.payload(), f = [];
      var meta = { id: ED.doc._id, name: p.name, frames: p.frames.map(function (fr, i) { return { id: fr.id, name: fr.name, x: fr.x, y: fr.y, width: fr.width, height: fr.height, background: fr.background, html: "frame-" + (i + 1) + ".html", css: "frame-" + (i + 1) + ".css" }; }) };
      f.push({ name: "diseño.json", lang: "json", text: J(meta) });
      p.frames.forEach(function (fr, i) { f.push({ name: "frame-" + (i + 1) + ".html", lang: "html", text: fr.html || "" }); f.push({ name: "frame-" + (i + 1) + ".css", lang: "css", text: fr.css || "" }); });
      return f;
    },
    build: function (files) {
      var by = {}; files.forEach(function (x) { by[x.name] = x.text; });
      var meta = JSON.parse(by["diseño.json"]);
      if (!meta.frames || !meta.frames.length) throw new Error("el diseño necesita al menos un frame");
      var base = RB()._ed.payload();
      return { name: meta.name || base.name, frames: meta.frames.map(function (m, i) {
        var src = base.frames.find(function (x) { return x.id === m.id; }) || {};
        var o = Object.assign({}, src, { id: m.id || "frame_" + Date.now().toString(36) + i, name: m.name || "Frame " + (i + 1), x: +m.x || 0, y: +m.y || 0, width: +m.width || 1080, height: +m.height || 1080, background: m.background || "#ffffff", html: by[m.html] != null ? by[m.html] : "", css: by[m.css] != null ? by[m.css] : "" });
        return o;
      }) };
    },
    preview: function (files, cur) {
      var spec = A.design.build(files), n = (cur.match(/frame-(\d+)/) || [0, 1])[1] - 1, fr = spec.frames[Math.max(0, Math.min(n, spec.frames.length - 1))];
      return frameDoc(fr.html, fr.css, fr.width, fr.height, fr.background);
    },
    apply: function (files) {
      var spec = A.design.build(files), id = ED.doc._id;
      if (RB()._ed.save) RB()._ed.save();
      return put("/api/templates/" + encodeURIComponent(id), spec).then(function () { RB().openDesign(id); return "Diseño actualizado"; });
    },
    agent: function (files) {
      var spec = A.design.build(files), f = spec.frames[0];
      return "## Crear un diseño nuevo igual a este\n" + mcpCall("create_html_template", { workspaceId: RB().ws, name: spec.name, width: f.width, height: f.height, initialHtml: f.html, initialCss: f.css })
        + "\n\n## Reemplazar este diseño completo (todos los frames)\n" + rest("PUT", "/api/templates/" + ED.doc._id, spec)
        + "\n\n## Editar solo un frame\n" + mcpCall("update_html_frame", { templateId: ED.doc._id, frameId: f.id, html: f.html, css: f.css });
    },
  };

  A.photo = {
    title: "Fotos",
    ready: function () { return typeof PH !== "undefined" && PH.open && PH.r; },
    files: function () { return [{ name: "revelado.json", lang: "json", text: J(clean(PH.r)) }]; },
    apply: function (files) { var r = JSON.parse(files[0].text); if (!r || typeof r !== "object") throw new Error("JSON inválido"); phSnap(); PH.r = Object.assign({}, PH.r, r); if (PH.r.masks && !PH.r.masks.some(function (m) { return m.id === PH.mask; })) PH.mask = null; phAll(); return Promise.resolve("Revelado aplicado (Ctrl+Z para deshacer). Guarda o aplica al diseño desde el editor."); },
    agent: function (files) {
      var r = JSON.parse(files[0].text), ex = {};
      ["basic", "light", "color", "hsl", "detail", "effects", "bw"].forEach(function (k) { if (r[k]) ex[k] = r[k]; });
      var tid = PH.doc && PH.doc._id, lid = (PH.t && PH.t.lid) || "<data-layer-id de la imagen>";
      return "## Mismo revelado con las tools de fotos (sobre la capa de imagen del diseño)\n" + mcpCall("photo_open_session", { templateId: tid || "<templateId>", layerId: lid })
        + "\n\n" + mcpCall("photo_apply_operation", { templateId: tid || "<templateId>", layerId: lid, type: "basic", params: r.light || r.basic || {} })
        + "\n\n## Receta completa (para guardarla en la capa del diseño: frames[].html → data-photo)\n" + J(ex);
    },
  };

  A.video = {
    title: "Video",
    ready: function () { return typeof VE !== "undefined" && VE.open && VE.p && VE.p._real; },
    files: function () { return [{ name: "video.json", lang: "json", text: J(clean(VE.p)) }]; },
    apply: function (files) {
      var p = JSON.parse(files[0].text); if (!p || !Array.isArray(p.v1)) throw new Error("el video necesita la pista v1 (tomas)");
      var oldName = VE.p.name;
      vsnap(); Object.keys(p).forEach(function (k) { if (k.charAt(0) !== "_") VE.p[k] = p[k]; }); veAll();
      var rn = p.name && p.name !== oldName ? api("/rest/v1/musa_video_projects?id=eq." + encodeURIComponent(VE.p._real.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name }) }).then(function () { var v = (RB().vids || []).find(function (x) { return x.id === VE.p._real.id; }); if (v) v.name = p.name; }) : Promise.resolve();
      return rn.then(function () { return "Video actualizado: se guarda solo en unos segundos"; });
    },
    agent: function (files) {
      var p = JSON.parse(files[0].text), id = VE.p._real.id, c = (p.v1 || [])[0];
      return "## Crear un video nativo (tiempos en MICROsegundos)\n" + mcpCall("video_project_create", { workspaceId: RB().ws, name: p.name || "Video", ratio: p.fmt || p.ratio || "9:16", canvasW: 1080, canvasH: 1920, fps: 30 })
        + "\n\n" + mcpCall("video_track_add", { projectId: "<id>", type: "video" })
        + "\n\n" + mcpCall("video_material_add", { projectId: "<id>", kind: "video", payload: { url: (c && (c.src || c.url)) || "https://…/toma.mp4", durationUs: Math.round(((c && c.dur) || 5) * 1e6) } })
        + "\n\n" + mcpCall("video_segment_add", { projectId: "<id>", trackId: "<track>", materialId: "<material>", targetStartUs: 0, targetDurUs: Math.round(((c && c.dur) || 5) * 1e6) })
        + "\n\n## Este proyecto por REST\n" + rest("GET", "/api/video-projects/" + id + "?workspaceId=" + RB().ws);
    },
  };

  A.flow = {
    title: "Automatización",
    ready: function () { return typeof FL !== "undefined" && FL.open && FL.f && RB().flowSpec; },
    files: function () { return [{ name: "flow.json", lang: "json", text: J(clean(RB().flowSpec())) }]; },
    apply: function (files) {
      var s = JSON.parse(files[0].text); if (!s.name) throw new Error("falta name");
      if (s.trigger && s.trigger.type && s.trigger.type !== "manual") throw new Error("solo se permite disparo manual (sin crons ni webhooks)");
      return RB().flowApply(s).then(function (id) {
        for (var i = FL_FLOWS.length - 1; i >= 0; i--) if (FL_FLOWS[i].id === id) FL_FLOWS.splice(i, 1);
        FL.ref = null; FL.dirty = false; flOpen(id); return "Flow guardado";
      });
    },
    agent: function (files) { var s = JSON.parse(files[0].text); return mcpCall("flow_save", Object.assign({ workspaceId: RB().ws }, s)) + "\n\n## Ejecutarlo\n" + mcpCall("flow_run", { workspaceId: RB().ws, flowId: s.id || "<id>" }); },
  };

  var takeId = null;
  A.takes = {
    title: "Tomas (guion del teleprompter)",
    ready: function () { return typeof TK !== "undefined"; },
    files: function () { return [{ name: "guion.json", lang: "json", text: J({ title: TK.title || "Guion", script: TK.script || "", format: TK.fmt || "9:16", speed: TK.speed, size: TK.size }) }]; },
    apply: function (files) {
      var s = JSON.parse(files[0].text); if (typeof s.script !== "string") throw new Error("falta script");
      TK.script = s.script; TK.title = s.title; if (s.format) TK.fmt = s.format; if (s.speed) TK.speed = +s.speed; if (s.size) TK.size = +s.size;
      var el = document.getElementById("tkScript"); if (el) el.value = TK.script; try { tkPrompt(); } catch (e) {}
      return RB().mcp("take_script_save", Object.assign({ workspaceId: RB().ws, id: takeId || undefined }, s)).then(function (r) { takeId = r && r.id; return "Guion guardado"; });
    },
    agent: function (files) { return mcpCall("take_script_save", Object.assign({ workspaceId: RB().ws }, JSON.parse(files[0].text))) + "\n\n## Las tomas grabadas\n" + mcpCall("video_takes_list", { workspaceId: RB().ws }); },
  };
  /* el último guion guardado se carga al entrar a Tomas */
  var takesWs = null;
  function loadTakeScript() {
    if (!RB() || !RB().on || takesWs === RB().ws) return; takesWs = RB().ws;
    api("/rest/v1/workspace_take_scripts?workspace_id=eq." + encodeURIComponent(RB().ws) + "&select=id,title,script,format,speed,size&order=updated_at.desc&limit=1").then(function (r) {
      var s = r && r[0]; if (!s) return; takeId = s.id; TK.script = s.script; TK.title = s.title; TK.fmt = s.format; TK.speed = s.speed; TK.size = s.size;
      var el = document.getElementById("tkScript"); if (el) { el.value = s.script; try { tkPrompt(); } catch (e) {} }
    }, function () {});
  }

  A.clones = {
    title: "Clones",
    ready: function () { return true; },
    files: function () { return [{ name: "clon.json", lang: "json", text: J({ kind: "voz", name: "Mi voz", audioUrl: "https://… (muestra de 1 a 3 min)", description: "", consent: false, _ayuda: "kind: voz (ElevenLabs, audioUrl) | avatar (HeyGen, takeId de Crear › Tomas). consent debe ser true." }) }]; },
    apply: function (files) {
      var s = JSON.parse(files[0].text); if (s.consent !== true) throw new Error("consent debe ser true: la persona tiene que autorizarlo");
      if (s.kind === "avatar") { if (!s.takeId) throw new Error("falta takeId"); return api("/api/heygen/avatars/digital-twin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ take_id: s.takeId, name: s.name }) }).then(function (x) { var d = (x && (x.data || x)) || {}; return (window.__musaRegisterClone ? window.__musaRegisterClone({ kind: "avatar", provider: "heygen", name: s.name, external_id: d.avatar_id || d.id || null, status: "entrenando" }) : null); }).then(function () { go(); return "Entrenamiento enviado a HeyGen"; }); }
      return RB().mcp("voice_clone_create", { workspaceId: RB().ws, name: s.name, audioUrl: s.audioUrl, description: s.description, consent: true }).then(function () { if (window.__musaReloadClones) window.__musaReloadClones(); return "Voz clonada"; });
    },
    agent: function (files) { var s = JSON.parse(files[0].text); return "## Clon de voz (ElevenLabs, llave BYOK del dueño de la key)\n" + mcpCall("voice_clone_create", { workspaceId: RB().ws, name: s.name, audioUrl: s.audioUrl, description: s.description, consent: true }) + "\n\n## Clones con avatar de HeyGen (listar)\n" + rest("GET", "/api/heygen/avatars"); },
  };

  function curMail() { return typeof ML !== "undefined" && typeof MAILS !== "undefined" ? MAILS.find(function (m) { return m.id === ML.sel; }) : null; }
  A.mailing = {
    title: "Mailing",
    ready: function () { return typeof ML !== "undefined"; },
    files: function () {
      var m = curMail() || { name: "Nueva campaña", subject: "", brand: "", seg: "Todos los contactos", tpl: "news" };
      var html = m.html || (typeof emailHTML === "function" ? '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">' + emailHTML(m) + "</div>" : "");
      return [{ name: "mailing.json", lang: "json", text: J({ id: m.db || undefined, kind: "campana", name: m.name, subject: m.subject || "", brandId: (RB().brandId || {})[m.brand] || null, segment: m.seg, tpl: m.tpl }) }, { name: "correo.html", lang: "html", text: html }];
    },
    preview: function (files) { return files[1].text; },
    apply: function (files) {
      var s = JSON.parse(files[0].text); s.html = files[1].text; s.workspaceId = RB().ws;
      if (!s.name) throw new Error("falta name");
      return RB().mcp("mailing_save", s).then(function (r) { if (RB().reloadData) RB().reloadData(); if (r && r.id && typeof ML !== "undefined") ML.sel = "m_" + r.id; return r && r.created ? "Campaña creada" : "Campaña actualizada"; });
    },
    agent: function (files) { var s = JSON.parse(files[0].text); s.html = files[1].text.length > 400 ? files[1].text.slice(0, 400) + "…" : files[1].text; return mcpCall("mailing_save", Object.assign({ workspaceId: RB().ws }, s)) + "\n\n## Secuencia\n" + mcpCall("mailing_save", { workspaceId: RB().ws, kind: "secuencia", name: "Bienvenida", segment: "Leads nuevos", steps: [{ d: 0, subject: "Bienvenida" }, { d: 3, subject: "Te cuento más" }] }); },
  };

  A.events = {
    title: "Evento",
    ready: function () { return typeof EV !== "undefined"; },
    files: function () {
      var m = location.hash.match(/crear\/eventos\/(e_[0-9a-f-]+)/), e = m && EV.find(function (x) { return x.id === m[1]; });
      return [{ name: "evento.json", lang: "json", text: J(e ? { id: e.db, name: e.name, startsAt: new Date(e.start).toISOString(), durationMin: e.dur, platform: e.plat, link: e.link, capacity: e.cap, brandId: (RB().brandId || {})[e.brand] || null, description: e.desc, coverUrl: e.cover || null, publish: !!e.pub }
        : { name: "Webinar", startsAt: new Date(Date.now() + 14 * 864e5).toISOString(), durationMin: 60, platform: "meet", link: "", capacity: 100, description: "", publish: false }) }];
    },
    apply: function (files) { var s = JSON.parse(files[0].text); s.workspaceId = RB().ws; return RB().mcp("event_save", s).then(function (r) { if (RB().reloadData) RB().reloadData(); setTimeout(function () { location.hash = "crear/eventos/e_" + r.id + (r.published ? "/pagina" : ""); }, 700); return r.url ? "Evento publicado: " + r.url : "Evento guardado"; }); },
    agent: function (files) { return mcpCall("event_save", Object.assign({ workspaceId: RB().ws }, JSON.parse(files[0].text))); },
  };

  /* ───────── la vista de código (mismo chrome que el editor de diseño: .ed) ───────── */
  var ABOUT = {
    design: ["Diseño", "Editor de diseño", "Capas, frames y propiedades sobre el lienzo", "Cada frame es HTML + CSS. diseño.json dice los frames (nombre, tamaño, fondo) y qué archivos usan. Lo que cambies aquí se ve igual en el editor visual."],
    photo: ["Fotos", "Editor de fotos", "Revelado, capas y máscaras de la foto", "La receta del revelado: luz, color, curvas, detalle, geometría y máscaras. Es lo mismo que mueven los controles del editor de fotos."],
    video: ["Video", "Editor de video", "Tomas, textos, audio y transiciones en la línea de tiempo", "El video completo: formato, pistas (v1 tomas, m media, t textos, a audio), tiempos en segundos y efectos."],
    flow: ["Automatizar", "Editor de automatizaciones", "Nodos y conexiones del flow", "El flow tal como lo recibe el motor: disparo (solo manual), nodos, conexiones y entradas. Mismo formato que flow_save."],
    takes: ["Tomas", "Estudio de tomas", "Teleprompter y grabación", "El guion del teleprompter, su formato de video, la velocidad y el tamaño de letra. La grabación la hace una persona con su cámara."],
    clones: ["Clones", "Clones IA", "Voz y avatar de la marca", "Pide un clon de voz (ElevenLabs, muestra de audio por URL) o con avatar (HeyGen, desde una toma). Usa tus llaves y requiere consentimiento."],
    mailing: ["Mailing", "Editor de mailing", "Campaña, audiencia y envío", "mailing.json son los datos de la campaña y correo.html es el cuerpo exacto que recibe la persona (CSS en línea)."],
    events: ["Eventos", "Editor de eventos", "Datos, inscritos y página pública", "El evento con su fecha, plataforma, cupos y si está publicado. Al publicar se crea su página con inscripción y .ics."],
  };
  var CODE_DESC = "El mismo archivo como código: edítalo, míralo en vivo y dáselo a tus agentes por MCP o API";
  var ICON = { json: "{ }", html: "&lt;/&gt;", css: "#" };
  var box = null, st = null;
  function css() {
    if (document.getElementById("mbCodeCss")) return;
    var s = document.createElement("style"); s.id = "mbCodeCss";
    s.textContent = ".ed.mbc{z-index:120;grid-template-columns:240px minmax(0,1fr) 380px}"
      + ".mbc .ed-top .ed-chip.k{color:var(--e-accent);border-color:rgba(255,94,0,.45)}"
      + ".mbc .ed-layers,.mbc .ed-props{grid-row:2}.mbc .ed-ly{padding-left:10px;height:30px;cursor:pointer}.mbc .ed-ly .ti{width:22px;font:600 10px ui-monospace,Menlo,Consolas,monospace;color:var(--e-muted)}.mbc .ed-ly.on .ti{color:var(--e-accent)}.mbc .ed-ly .dot{width:6px;height:6px;border-radius:50%;background:var(--e-accent)}"
      + ".mbc .mbc-sec{padding:12px}.mbc .mbc-sec .ed-mh{padding:0 0 6px}.mbc .mbc-sec p{margin:0;color:var(--e-muted);font-size:11px;line-height:1.5}"
      + ".mbc-main{grid-row:2;grid-column:2;display:grid;grid-template-columns:46px 1fr;min-height:0;background:#0a0a0a}"
      + ".mbc-g{color:#4a4a4a;text-align:right;padding:14px 10px 14px 0;font:12px/1.65 ui-monospace,Menlo,Consolas,monospace;overflow:hidden;white-space:pre;user-select:none;border-right:1px solid var(--e-line)}"
      + ".mbc-ta{width:100%;height:100%;resize:none;border:0;outline:0;background:transparent;color:#e3e3e3;padding:14px 16px;font:12px/1.65 ui-monospace,Menlo,Consolas,monospace;white-space:pre;overflow:auto;tab-size:2;caret-color:var(--e-accent)}.mbc-ta::selection{background:rgba(255,94,0,.3)}"
      + ".mbc-pv{flex:1;min-height:0;display:flex;flex-direction:column}.mbc-pv iframe{flex:1;width:100%;border:0;background:#0a0a0a radial-gradient(#1d1d1d 1px,transparent 1px) 0 0/20px 20px}"
      + ".mbc-ag{flex:1;min-height:0;overflow:auto;margin:0 12px 12px;padding:10px;background:#0b0b0b;border:1px solid var(--e-line);border-radius:6px;font:11px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#c9c9c9;white-space:pre-wrap;word-break:break-word}"
      + ".mbc .ed-btn{background:#1c1c1c;color:#fff;font-weight:500}.mbc .ed-btn:hover{background:#262626}.mbc .ed-status .er{color:#ff6b6b}.mbc .ed-status .ok{color:#6bd38a}.mbc .ed-sb .ed-btn{grid-column:auto}";
    document.head.appendChild(s);
  }
  function itemName() {
    try {
      var k = st.kind;
      if (k === "design") return ED.doc.name; if (k === "video") return VE.p.name; if (k === "flow") return FL.f.name;
      if (k === "photo") return (PH.t && PH.t.name) || "Foto"; if (k === "takes") return TK.title || "Guion";
      if (k === "mailing") { var m = curMail(); return m ? m.name : "Nueva campaña"; }
      if (k === "events") { var mm = location.hash.match(/(e_[0-9a-f-]+)/), e = mm && EV.find(function (x) { return x.id === mm[1]; }); return e ? e.name : "Nuevo evento"; }
    } catch (x) {}
    return ABOUT[st.kind][0];
  }
  function previewFonts() {
    var out = [].map.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) { return /font/i.test(l.href) ? '<link rel="stylesheet" href="' + esc(l.href) + '">' : ""; }).join("");
    [].forEach.call(document.querySelectorAll("style"), function (s) { var m = (s.textContent || "").match(/@font-face\s*{[^}]*}/g); if (m) out += "<style>" + m.join("") + "</style>"; });
    var fam = (getComputedStyle(document.body).getPropertyValue("--sans") || "").trim() || "Inter,-apple-system,'Segoe UI',Roboto,sans-serif";
    return { links: out, fam: fam };
  }
  var PF = null;
  frameDoc = function (html, css2, w, h, bg) {
    PF = PF || previewFonts();
    return "<!doctype html><meta charset='utf-8'>" + PF.links + "<style>html,body{margin:0;height:100%;overflow:hidden}html{background:#0a0a0a radial-gradient(#1d1d1d 1px,transparent 1px) 0 0/20px 20px}body{display:grid;place-items:center}.wr{position:relative}.st{position:absolute;left:0;top:0;width:" + w + "px;height:" + h + "px;overflow:hidden;background:" + (bg || "#fff") + ";transform-origin:0 0;font-family:" + PF.fam + ";color:#111;box-shadow:0 10px 40px rgba(0,0,0,.5)}" + (css2 || "") + "</style><body><div class='wr' id='wr'><div class='st' id='st'>" + (html || "") + "</div></div><script>function f(){var k=Math.min((innerWidth-32)/" + w + ",(innerHeight-32)/" + h + ",1),w=document.getElementById('wr');w.style.width=(" + w + "*k)+'px';w.style.height=(" + h + "*k)+'px';document.getElementById('st').style.transform='scale('+k+')';}f();addEventListener('resize',f);<\/script>";
  };
  function open(kind) {
    var a = A[kind]; if (!a) return;
    if (!RB() || !RB().on) return uiToast("Cargando tus datos…");
    if (!a.ready()) return uiToast("Abre primero un " + a.title.toLowerCase() + " de tu espacio");
    var files; try { files = a.files(); } catch (e) { return uiToast("No se pudo leer el código: " + e.message); }
    css();
    st = { kind: kind, a: a, files: files, cur: 0, side: (a.preview || a.previewEl) ? "preview" : "agent", orig: files.map(function (f) { return f.text; }), msg: "" };
    if (box) box.remove();
    box = document.createElement("div"); box.className = "ed mbc";
    document.body.appendChild(box);
    draw();
  }
  function dirty() { return st.files.some(function (x, i) { return x.text !== st.orig[i]; }); }
  function close(force) { if (!force && dirty()) return window.__musaReal.confirmBox("Tienes cambios sin aplicar. ¿Volver al editor visual igual?", { ok: "Volver sin aplicar" }).then(function (ok) { if (ok) close(true); }); if (box) box.remove(); box = null; var m = document.getElementById("mbcMenu"); if (m) m.remove(); }
  function agentText() { try { return st.a.agent(st.files); } catch (e) { return "// Corrige el código primero: " + e.message; } }
  function draw() {
    var a = st.a, f = st.files[st.cur], ab = ABOUT[st.kind], hasPrev = !!(a.preview || a.previewEl);
    box.innerHTML = '<header class="ed-top"><div class="ed-tl"><button class="ed-ib" data-c="close" title="Volver al editor visual">←</button><b class="ed-logo">Musa<span>#</span></b>'
      + '<span class="ed-name" style="display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(itemName()) + '</span><span class="ed-chip k">Código</span></div>'
      + '<nav class="ed-tc"><button class="ed-tb" data-c="menu">Editor<span class="cv">▾</span></button><span class="ed-sep"></span><button class="ed-tb" data-c="copy">Copiar archivo</button><button class="ed-tb" data-c="dl">Descargar</button><button class="ed-tb" data-c="reset"' + (dirty() ? "" : ' disabled style="opacity:.35"') + '>Descartar cambios</button></nav>'
      + '<div class="ed-tr"><button class="ed-tb" data-c="close">Volver al editor visual</button><span class="ed-sep"></span><button class="ed-tb ed-exp" data-c="apply">Aplicar</button></div></header>'
      + '<aside class="ed-layers"><div class="ed-ptabs"><button class="on">Archivos</button></div><div class="ed-scroll">'
      + st.files.map(function (x, i) { return '<div class="ed-ly fr' + (i === st.cur ? " on" : "") + '" data-f="' + i + '"><span class="ti">' + (ICON[x.lang] || "·") + '</span><span class="nm">' + esc(x.name) + "</span>" + (x.text !== st.orig[i] ? '<i class="dot" title="Sin aplicar"></i>' : "") + "</div>"; }).join("")
      + '<div class="mbc-sec"><div class="ed-mh">Qué es este código</div><p>' + esc(ab[3]) + '</p></div><div class="mbc-sec"><div class="ed-mh">Cómo se usa</div><p>Edita a la izquierda, revisa a la derecha y pulsa <b style="color:#fff">Aplicar</b> (o Ctrl+S): se guarda en tu espacio y el editor visual queda igual. «Para agentes» trae la llamada lista para una IA.</p></div></div></aside>'
      + '<main class="mbc-main"><div class="mbc-g" id="mbcG"></div><textarea class="mbc-ta" id="mbcT" spellcheck="false" aria-label="' + esc(f.name) + '"></textarea></main>'
      + '<aside class="ed-props"><div class="ed-ptabs">' + (hasPrev ? '<button data-s="preview" class="' + (st.side === "preview" ? "on" : "") + '">Vista previa</button>' : "") + '<button data-s="agent" class="' + (st.side === "agent" ? "on" : "") + '">Para agentes</button></div>'
      + (st.side === "preview" && hasPrev ? (a.previewEl ? '<div class="mbc-pv"><div id="mbcPD" style="flex:1;min-height:0;display:grid;place-items:center;overflow:hidden;background:#0a0a0a radial-gradient(#1d1d1d 1px,transparent 1px) 0 0/20px 20px"></div></div>' : '<div class="mbc-pv"><iframe id="mbcP" sandbox="allow-scripts" title="Vista previa"></iframe></div>')
        : '<div class="mbc-sec"><p>Lo mismo que hace el editor visual, en una llamada que cualquier IA conectada (Claude, Cursor, Codex…) ejecuta con una llave del workspace. Créala en Configuración › Conecta tu IA.</p></div><pre class="mbc-ag" id="mbcA">' + esc(agentText()) + '</pre><div class="ed-sb"><button class="ed-btn" data-c="copyag" style="grid-column:1/-1">Copiar llamada</button></div>')
      + '</aside><footer class="ed-status"><span id="mbcS">' + (st.msg || "<b>" + esc(f.name) + "</b> · " + esc(f.lang.toUpperCase()) + " · Ctrl+S aplica · Tab indenta") + "</span><span>" + (dirty() ? "Cambios sin aplicar" : "Todo aplicado") + "</span></footer>";
    var ta = box.querySelector("#mbcT"), g = box.querySelector("#mbcG");
    ta.value = f.text;
    var gut = function () { var n = ta.value.split("\n").length; g.textContent = Array.from({ length: n }, function (_, i) { return i + 1; }).join("\n"); g.scrollTop = ta.scrollTop; };
    gut(); ta.onscroll = function () { g.scrollTop = ta.scrollTop; };
    var pv = null;
    var prev = function () { var pd = box.querySelector("#mbcPD"); if (pd) { clearTimeout(pv); pv = setTimeout(function () { try { a.previewEl(pd, st.files); setMsg(""); } catch (e) { setMsg(e.message, true); } }, 300); return; } var fr = box.querySelector("#mbcP"); if (!fr) return; clearTimeout(pv); pv = setTimeout(function () { try { fr.srcdoc = a.preview(st.files, st.files[st.cur].name); setMsg(""); } catch (e) { setMsg(e.message, true); } }, 250); };
    ta.oninput = function () {
      var was = dirty(); st.files[st.cur].text = ta.value; gut(); prev();
      if (was !== dirty()) { st.msg = ""; var p = ta.selectionStart; draw(); var t2 = box.querySelector("#mbcT"); t2.focus(); t2.setSelectionRange(p, p); return; }
      var ag = box.querySelector("#mbcA"); if (ag) ag.textContent = agentText();
    };
    ta.onkeydown = function (e) {
      if (e.key === "Tab") { e.preventDefault(); var s = ta.selectionStart, en = ta.selectionEnd; ta.setRangeText("  ", s, en, "end"); ta.oninput(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); applyNow(); }
    };
    prev(); ta.focus();
    box.onclick = function (e) {
      var r = e.target.closest("[data-f],[data-s],[data-c]"); if (!r) return;
      if (r.dataset.f) { st.cur = +r.dataset.f; st.msg = ""; return draw(); }
      if (r.dataset.s) { st.side = r.dataset.s; return draw(); }
      var c = r.dataset.c;
      if (c === "close") return close();
      if (c === "menu") return menu(r);
      if (c === "copy") { try { navigator.clipboard.writeText(ta.value); } catch (x) {} return setMsg("Archivo copiado"); }
      if (c === "copyag") { try { navigator.clipboard.writeText(agentText()); } catch (x) {} return setMsg("Llamada para agentes copiada"); }
      if (c === "dl") { var bl = new Blob([ta.value], { type: "text/plain" }), u = URL.createObjectURL(bl), l = document.createElement("a"); l.href = u; l.download = st.files[st.cur].name; l.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); return; }
      if (c === "reset") { st.files.forEach(function (x, i) { x.text = st.orig[i]; }); st.msg = ""; return draw(); }
      if (c === "apply") applyNow();
    };
  }
  function menu(btn) {
    var old = document.getElementById("mbcMenu"); if (old) { old.remove(); return; }
    var ab = ABOUT[st.kind], m = document.createElement("div"); m.className = "ed-menu"; m.id = "mbcMenu";
    m.innerHTML = '<div class="ed-mh">' + esc(ab[0]) + '</div><div class="ed-mi" data-x="visual"><span class="ck"></span><span class="l">' + esc(ab[1]) + "<small>" + esc(ab[2]) + '</small></span></div><div class="ed-ms"></div><div class="ed-mh">Código</div><div class="ed-mi"><span class="ck">✓</span><span class="l">Editor de código<small>' + esc(CODE_DESC) + "</small></span></div>";
    var rc = btn.getBoundingClientRect(); m.style.left = rc.left + "px"; m.style.top = rc.bottom + 6 + "px";
    document.body.appendChild(m);
    m.onclick = function (e) { var it = e.target.closest("[data-x]"); m.remove(); if (it) close(); };
    setTimeout(function () { document.addEventListener("pointerdown", function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", off); } }); }, 0);
  }
  function setMsg(m, err) { st.msg = m ? '<span class="' + (err ? "er" : "ok") + '">' + esc(m) + "</span>" : ""; var s = box && box.querySelector("#mbcS"); if (s) s.innerHTML = st.msg || "<b>" + esc(st.files[st.cur].name) + "</b> · " + esc(st.files[st.cur].lang.toUpperCase()) + " · Ctrl+S aplica · Tab indenta"; }
  function applyNow() {
    setMsg("Aplicando…");
    Promise.resolve().then(function () { return st.a.apply(st.files); }).then(function (msg) {
      st.orig = st.files.map(function (f) { return f.text; }); uiToast(msg || "Aplicado");
      var k = st.kind; if (k === "design" || k === "flow" || k === "events") { setTimeout(function () { close(true); }, 300); return; }
      st.msg = '<span class="ok">' + esc(msg || "Aplicado") + "</span>"; draw();
    }, function (e) { setMsg("No se aplicó: " + (e && e.message || e), true); });
  }
  document.addEventListener("keydown", function (e) { if (box && e.key === "Escape") { e.stopPropagation(); var m = document.getElementById("mbcMenu"); if (m) m.remove(); } }, true);

  /* ───────── entradas: menú «Editor» de diseño, fotos y video ───────── */
  function addMenu(M, kind, d) {
    if (typeof M === "undefined" || !M || typeof M.editor !== "function") return;
    var _e = M.editor, ab = ABOUT[kind];
    M.editor = function () {
      var it = _e.apply(this, arguments).slice();
      var i = it.findIndex(function (x) { return x && x.on; });
      if (i >= 0 && !it[i].d) it[i] = Object.assign({}, it[i], { d: ab[2] });
      var end = i < 0 ? it.length : it.indexOf("-", i); if (end < 0) end = it.length;
      it.splice(end, 0, "-", { h: "Código" }, { l: "Editor de código", d: d || CODE_DESC, fn: function () { open(kind); } });
      return it;
    };
  }

  addMenu(typeof MENUS !== "undefined" ? MENUS : null, "design", "HTML y CSS de cada frame, con vista previa en vivo y la llamada para tus agentes");
  addMenu(typeof PH_MENUS !== "undefined" ? PH_MENUS : null, "photo", "La receta del revelado como código, lista para tus agentes");
  addMenu(typeof VMENUS !== "undefined" ? VMENUS : null, "video", "Pistas, tomas, textos y audio como código, listo para tus agentes");

  /* botones «</> Código» en automatizaciones, tomas, clones, mailing y eventos */
  function btn(attr, extra) { return '<button class="btn btn-g" data-mbcode="' + attr + '"' + (extra || "") + ">&lt;/&gt; Código</button>"; }
  function inject() {
    if (!RB() || !RB().on) return;
    var t = document.getElementById("flTabs"); if (t && !t.querySelector("[data-mbcode]")) t.insertAdjacentHTML("beforeend", '<button data-mbcode="flow">Código</button>');
    var k = document.getElementById("tkScript"); if (k && !document.querySelector('[data-mbcode="takes"]')) { k.closest("label").insertAdjacentHTML("afterend", btn("takes", ' style="margin-top:6px;height:30px;font-size:12px"')); loadTakeScript(); }
    if (route.mod === "crear" && route.sub === "clones") { var fb = document.querySelector("#body .fx-bar"); if (fb && !fb.querySelector("[data-mbcode]")) fb.insertAdjacentHTML("beforeend", btn("clones")); }
    var ma = document.querySelector(".ml-acts"); if (ma && !ma.querySelector("[data-mbcode]")) ma.insertAdjacentHTML("beforeend", btn("mailing"));
    var mt = document.querySelector(".ml-top"); if (mt && !mt.querySelector("[data-mbcode]")) mt.insertAdjacentHTML("beforeend", btn("mailing", ' style="margin-left:6px"'));
    var ef = document.querySelector("#body .ev-head .seg"); if (ef && !document.querySelector('[data-mbcode="events"]')) ef.insertAdjacentHTML("afterend", btn("events", ' style="margin-left:8px"'));
    if (route.mod === "crear" && route.sub === "eventos" && !/eventos\/e/.test(location.hash)) { var eh = document.querySelector("#body .ch"); if (eh && !document.querySelector('[data-mbcode="events"]')) eh.insertAdjacentHTML("beforeend", btn("events", ' style="margin-left:auto"')); }
  }
  var injT = 0;
  new MutationObserver(function () { if (injT) return; injT = requestAnimationFrame(function () { injT = 0; inject(); }); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-mbcode]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); open(b.dataset.mbcode);
  }, true);

  window.__musaCode = { open: open, adapters: A, mcpCall: mcpCall, rest: rest };
})();
/* correos escritos en código: la vista previa del mailing muestra ese HTML (aislado en un iframe) */
(function () {
  if (typeof emailHTML !== "function") return;
  var _em = emailHTML;
  emailHTML = function (m) { if (m && m.html) return '<iframe sandbox="" style="width:100%;height:560px;border:0;background:#fff;display:block" srcdoc="' + String(m.html).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"></iframe>'; return _em.apply(this, arguments); };
})();
