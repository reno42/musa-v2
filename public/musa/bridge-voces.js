/* bridge-voces.js — REQ-071: Módulo de Voces (Crear › Voces).
 * Voces gratis (stock Workers AI de la plataforma, $0 para el usuario),
 * librería «Mis voces» y «Crear voz» (clon por grabación o archivo).
 * La síntesis puede agregarse como audio a un proyecto de video real
 * (track audio + material + segmento server-first).
 * Usa las clases de la maqueta (btn, tiles, tile, card, pill, flt-bar) —
 * nada de UI inventada; el CSS nuevo es mínimo y va con prefijo vz-.
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal;
  if (!RB || typeof viewGrid !== "function" || typeof $ !== "function") { if ((n || 0) < 800) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (window.__musaVozMod) return;
  window.__musaVozMod = true;

  function host() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function bridge() { var h = host(); try { return h && h.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ── alta de la sección en el módulo Crear (después de Video y motion) ── */
  try {
    var crear = (typeof MODULES !== "undefined") && MODULES.find(function (m) { return m.id === "crear"; });
    if (crear && !crear.subs.some(function (s) { return s[0] === "voces"; })) {
      var at = crear.subs.findIndex(function (s) { return s[0] === "videos"; });
      crear.subs.splice(at + 1, 0, ["voces", "Voces", "grid"]);
      if (typeof SUB_DESC !== "undefined") SUB_DESC["crear/voces"] = "Voces gratis para tus videos: elige una voz, escribe el guion y genera la locución. Clona la tuya desde «Crear voz».";
      if (typeof drawNav === "function") drawNav();
    }
  } catch (e) { /* el módulo se registra solo la primera vez */ }

  /* ── estado ── */
  var S = {
    tab: "stock", cat: null, mias: null, miasEstado: "", idioma: "es",
    speaker: "", vozMia: "", guion: "", busy: false, cuota: null,
    lastAudio: null, lastNombre: "", err: "", nota: "",
    clonNombre: "", clonBlob: null, clonUrl: "", grabando: false, rec: null, chunks: [],
    proyectos: null, proyectoSel: ""
  };
  var FRASES = { es: "Hola, así suena mi voz para tus videos.", en: "Hi, this is how my voice sounds in your videos." };

  /* CSS mínimo (el resto son clases de la maqueta) */
  var css = document.createElement("style");
  css.textContent = [
    ".vz-tabs{display:flex;gap:6px;margin-bottom:10px}",
    ".vz-tab{padding:6px 16px;border-radius:50px;border:1px solid rgba(255,255,255,.12);background:transparent;color:rgba(255,255,255,.6);font-size:12.5px;font-weight:650;cursor:pointer}",
    ".vz-tab.on{background:rgba(99,102,241,.22);border-color:rgba(99,102,241,.5);color:#fff}",
    ".vz-chips{display:flex;gap:6px;margin:4px 0 10px}",
    ".vz-chip{padding:5px 14px;border-radius:50px;border:1px solid rgba(255,255,255,.12);background:transparent;color:rgba(255,255,255,.6);font-size:12px;font-weight:650;cursor:pointer}",
    ".vz-chip.on{background:rgba(99,102,241,.22);border-color:rgba(99,102,241,.5);color:#fff}",
    ".vz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:12px}",
    ".vz-voz{padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);cursor:pointer}",
    ".vz-voz.on{border-color:rgba(99,102,241,.55);background:rgba(99,102,241,.12)}",
    ".vz-voz b{display:block;font-size:13px;color:#fff}",
    ".vz-voz small{color:rgba(255,255,255,.5);font-size:11px}",
    ".vz-guion{width:100%;min-height:110px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;padding:10px 12px;font:inherit;font-size:13px;resize:vertical}",
    ".vz-fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}",
    ".vz-cuota{color:rgba(255,255,255,.45);font-size:11.5px}",
    ".vz-nota{color:rgba(255,255,255,.55);font-size:12px;max-width:560px}",
    ".vz-err{color:#fca5a5;font-size:12px}",
    ".vz-audio{width:100%;max-width:420px;height:36px;margin-top:8px}",
    ".vz-rec{display:inline-flex;align-items:center;gap:6px}",
    ".vz-dot{width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block}",
    ".vz-card{max-width:640px}"
  ].join("\n");
  document.head.appendChild(css);

  function grupo() { return S.cat && S.cat.stock && S.cat.stock.find(function (g) { return g.idioma === S.idioma; }); }
  function speakerActual() { var g = grupo(); return g && g.speakers.find(function (s) { return s.id === S.speaker; }); }
  function cuotaTxt() {
    if (S.cuota) return S.cuota.usado.toLocaleString("es-PE") + " / " + S.cuota.limite.toLocaleString("es-PE") + " caracteres hoy";
    var l = S.cat && S.cat.cuota ? S.cat.cuota.charsDia : 10000;
    return "hasta " + l.toLocaleString("es-PE") + " caracteres al día";
  }

  function cargarCat() {
    if (S.cat) return Promise.resolve(S.cat);
    return api("/api/musa-voz/stock").then(function (c) { S.cat = c; if (!S.speaker) { var g = c.stock.find(function (x) { return x.idioma === "es"; }); S.speaker = g && g.speakers[0] ? g.speakers[0].id : ""; } return c; });
  }
  function cargarMias() {
    return api("/api/musa-voz/voces").then(function (d) { S.mias = d.mias || []; S.miasEstado = "ok"; if (!S.vozMia && S.mias[0]) S.vozMia = S.mias[0].id; })
      .catch(function (e) { S.miasEstado = /migraci/i.test(String(e && e.message)) ? "pendiente" : "error"; });
  }

  function b64Blob(b64, mime) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "audio/mpeg" });
  }
  function duracion(blob) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve(0);
    var ctx = new AC();
    return blob.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (d) { var s = d.duration; try { ctx.close(); } catch (e) {} return s; })
      .catch(function () { try { ctx.close(); } catch (e) {} return 0; });
  }
  function blobWavB64(blob) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    return blob.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); }).then(function (d) {
      var nc = Math.min(d.numberOfChannels, 2), len = d.length * nc * 2;
      var out = new ArrayBuffer(44 + len), v = new DataView(out);
      function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
      ws(0, "RIFF"); v.setUint32(4, 36 + len, true); ws(8, "WAVE"); ws(12, "fmt ");
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
      v.setUint32(24, d.sampleRate, true); v.setUint32(28, d.sampleRate * nc * 2, true);
      v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, len, true);
      var off = 44, ch = [];
      for (var c = 0; c < nc; c++) ch.push(d.getChannelData(c));
      for (var i = 0; i < d.length; i++) for (var k = 0; k < nc; k++) { var x = Math.max(-1, Math.min(1, ch[k][i])); v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true); off += 2; }
      try { ctx.close(); } catch (e) {}
      var wav = new Uint8Array(out), bin = "", CH = 0x8000;
      for (var j = 0; j < wav.length; j += CH) bin += String.fromCharCode.apply(null, wav.subarray(j, j + CH));
      return { b64: btoa(bin), mimeType: "audio/wav" };
    });
  }

  /* ── síntesis + agregar a video ── */
  function sintetizar(body) {
    S.busy = true; S.err = ""; S.nota = "Generando audio…"; render();
    return api("/api/musa-voz/sintetizar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        S.cuota = r.quota; S.busy = false; S.nota = "";
        S.lastAudio = URL.createObjectURL(b64Blob(r.audioBase64, r.mimeType));
        S.lastNombre = (r.voz && r.voz.nombre) || "Voz";
        render();
      })
      .catch(function (e) { S.busy = false; S.nota = ""; S.err = String((e && e.message) || e); render(); });
  }

  function cargarProyectos() {
    if (S.proyectos) return Promise.resolve(S.proyectos);
    return api("/api/video-projects?workspaceId=" + encodeURIComponent(RB.ws)).then(function (d) {
      S.proyectos = (d.data && d.data.projects) || [];
      if (!S.proyectoSel && S.proyectos[0]) S.proyectoSel = S.proyectos[0].id;
      return S.proyectos;
    });
  }

  function agregarAlVideo() {
    if (!S.lastAudio || !S.proyectoSel) return;
    S.busy = true; S.nota = "Agregando al video…"; S.err = ""; render();
    var pid = encodeURIComponent(S.proyectoSel);
    var WS = encodeURIComponent(RB.ws);
    fetch(S.lastAudio).then(function (r) { return r.blob(); }).then(function (blob) {
      return duracion(blob).then(function (seg) {
        var durUs = Math.max(1000000, Math.round(seg * 1e6));
        /* blob → base64 → Storage público (el material exige URL http) */
        return new Promise(function (res, rej) {
          var fr = new FileReader();
          fr.onload = function () { res(String(fr.result).split(",")[1] || ""); };
          fr.onerror = function () { rej(new Error("No se pudo leer el audio")); };
          fr.readAsDataURL(blob);
        }).then(function (b64) {
          return api("/api/storage/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: RB.ws, filename: "voz_" + Date.now() + ".mp3", dataBase64: b64, mimeType: "audio/mpeg" }) });
        }).then(function (up) {
          var url = up.data && up.data.url;
          if (!url) throw new Error("La subida del audio no devolvió URL.");
          return api("/api/video-projects/" + pid + "?workspaceId=" + WS).then(function (tree) {
            var tracks = (tree.data && tree.data.tracks) || [];
            var tA = null;
            for (var i = 0; i < tracks.length; i++) if (tracks[i].type === "audio") { tA = tracks[i]; break; }
            var pTrack = tA
              ? Promise.resolve({ data: { track: tA } })
              : api("/api/video-projects/" + pid + "/tracks?workspaceId=" + WS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "audio", zOrder: 90 }) });
            return pTrack.then(function (tr) {
              var trackId = tr.data && tr.data.track && tr.data.track.id;
              return api("/api/video-projects/" + pid + "/materials?workspaceId=" + WS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "audio", payload: { url: url, durationUs: durUs, name: "Voz · " + S.lastNombre } }) })
                .then(function (mt) {
                  var matId = mt.data && mt.data.material && mt.data.material.id;
                  return api("/api/video-projects/" + pid + "/segments?workspaceId=" + WS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId: trackId, materialId: matId, targetStartUs: 0, targetDurUs: durUs }) });
                });
            });
          });
        });
      });
    }).then(function () {
      S.busy = false; S.nota = "Listo: la locución está en el timeline del video (pista de audio, al inicio)."; S.err = "";
      render();
    }).catch(function (e) { S.busy = false; S.err = String((e && e.message) || e); render(); });
  }

  /* ── clonar ── */
  function grabar() {
    if (S.grabando) { try { S.rec.stop(); } catch (e) {} return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var rec = new MediaRecorder(stream); S.chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) S.chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var b = new Blob(S.chunks, { type: rec.mimeType || "audio/webm" });
        S.clonBlob = b; S.clonUrl = URL.createObjectURL(b); S.grabando = false; render();
      };
      rec.start(); S.rec = rec; S.grabando = true; render();
    }).catch(function () { S.err = "No se pudo acceder al micrófono."; render(); });
  }

  function crearVoz() {
    if (!S.clonNombre.trim()) { S.err = "Ponle un nombre a la voz."; return render(); }
    if (!S.clonBlob) { S.err = "Graba o sube un clip de tu voz (10-30 segundos)."; return render(); }
    S.busy = true; S.err = ""; S.nota = "Creando la voz…"; render();
    blobWavB64(S.clonBlob).then(function (w) {
      var payload = { nombre: S.clonNombre.trim(), audioBase64: w.b64, mimeType: w.mimeType, idioma: S.idioma };
      return api("/api/musa-voz/clonar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ proveedor: "elevenlabs" }, payload)) })
        .catch(function (e) {
          // sin key ElevenLabs → clon gratis propio (Chatterbox en backend Musa)
          if (!/ELEVENLABS_KEY_MISSING/i.test(String((e && e.message) || e))) throw e;
          return api("/api/musa-voz/clonar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ proveedor: "workers-ai" }, payload)) });
        });
    }).then(function (r) {
      S.busy = false;
      var esMusa = r.voz && r.voz.proveedor === "workers-ai";
      S.nota = r.nota || (esMusa ? ("Voz \"" + ((r.voz && r.voz.nombre) || S.clonNombre) + "\" creada (clon Musa). Al usarla, la generación corre en CPU y puede tardar ~1 min por minuto de audio.") : ("Voz \"" + ((r.voz && r.voz.nombre) || S.clonNombre) + "\" creada."));
      S.clonBlob = null; S.clonUrl = ""; S.clonNombre = "";
      return cargarMias().then(render);
    }).catch(function (e) {
      S.busy = false; S.nota = "";
      var m = String((e && e.message) || e);
      S.err = m;
      render();
    });
  }

  /* ── render ── */
  function activo() { return !!document.querySelector("#body [data-vz-tab], #body [data-vz-gen], #body [data-vz-rec]"); }
  function tabsHtml() {
    return "<div class='vz-tabs'>" +
      [["stock", "Gratis"], ["mias", "Mis voces"], ["crear", "Crear voz"]].map(function (t) {
        return "<button type='button' class='vz-tab " + (S.tab === t[0] ? "on" : "") + "' data-vz-tab='" + t[0] + "'>" + t[1] + "</button>";
      }).join("") + "</div>";
  }
  function gridSpeakers() {
    var g = grupo(); if (!g) return "";
    return "<div class='vz-chips'>" +
      [["es", "Español"], ["en", "English"]].map(function (x) {
        return "<button type='button' class='vz-chip " + (S.idioma === x[0] ? "on" : "") + "' data-vz-idioma='" + x[0] + "'>" + x[1] + "</button>";
      }).join("") + "</div>" +
      "<div class='vz-grid'>" + g.speakers.slice(0, 12).map(function (s) {
        return "<div class='vz-voz " + (S.speaker === s.id ? "on" : "") + "' data-vz-spk='" + s.id + "'><b>" + esc(s.nombre) + "</b><small>" + esc(s.rasgo) + "</small></div>";
      }).join("") + "</div>";
  }
  function guionHtml(deshabilitado) {
    return "<textarea class='vz-guion' data-vz-guion placeholder='Texto que dirá la voz…'" + (deshabilitado ? " disabled" : "") + ">" + esc(S.guion) + "</textarea>" +
      "<div class='vz-fila'>" +
      "<button type='button' class='btn btn-p' data-vz-gen" + (S.busy || deshabilitado ? " disabled" : "") + ">" + (S.busy ? (S.nota || "Generando…") : "Generar locución") + "</button>" +
      (S.lastAudio ? "<button type='button' class='btn btn-g' data-vz-play>Escuchar el resultado</button>" : "") +
      "<span class='vz-cuota'>" + cuotaTxt() + "</span></div>" +
      (S.lastAudio ? "<audio class='vz-audio' controls src='" + S.lastAudio + "'></audio>" +
        "<div class='vz-fila'><select class='mini-search' data-vz-proyecto style='min-width:220px'>" +
        (S.proyectos || []).map(function (p) { return "<option value='" + esc(p.id) + "'" + (p.id === S.proyectoSel ? " selected" : "") + ">" + esc(p.name || p.id) + "</option>"; }).join("") +
        "</select><button type='button' class='btn btn-p' data-vz-add" + (S.busy || !S.proyectoSel ? " disabled" : "") + ">Agregar a ese video</button>" +
        "<span class='vz-cuota'>queda al inicio de la pista de audio</span></div>" : "");
  }
  function render(forzar) {
    if (!forzar && !activo()) return;
    var h = tabsHtml();
    if (S.tab === "stock") {
      h += gridSpeakers() + guionHtml(false);
    } else if (S.tab === "mias") {
      if (S.miasEstado === "cargando" || !S.mias && S.miasEstado !== "pendiente") { h += "<p class='vz-nota'>Cargando tus voces…</p>"; }
      else if (S.miasEstado === "pendiente") { h += "<p class='vz-nota'>La librería de voces se está activando en este entorno. Mientras tanto usa las voces gratis.</p>"; }
      else if (!S.mias.length) { h += "<p class='vz-nota'>Todavía no tienes voces guardadas. Crea la tuya desde «Crear voz».</p>"; }
      else {
        h += "<div class='vz-grid'>" + S.mias.map(function (v) {
          return "<div class='vz-voz " + (S.vozMia === v.id ? "on" : "") + "' data-vz-mia='" + esc(v.id) + "'><b>" + esc(v.nombre) + "</b><small>" + (v.proveedor === "elevenlabs" ? "ElevenLabs" : "Musa") + "</small></div>";
        }).join("") + "</div>" + guionHtml(!S.vozMia);
      }
    } else {
      h += "<div class='card vz-card'><div class='ch'><h3>Clona tu voz</h3></div>" +
        "<p class='vz-nota'>Graba 10-30 segundos con voz clara (o sube un archivo). Con tu llave de ElevenLabs la voz se crea al instante; sin llave queda en lista de espera para los clones propios de Musa.</p>" +
        "<div class='vz-fila'><input class='mini-search' data-vz-clonnombre placeholder='Nombre de la voz' style='flex:1;min-width:180px' value='" + esc(S.clonNombre) + "'>" +
        "<button type='button' class='btn btn-g vz-rec' data-vz-rec>" + (S.grabando ? "<span class='vz-dot'></span> Grabando… parar" : "Grabar") + "</button>" +
        "<label class='btn btn-g'>Subir archivo<input type='file' accept='audio/*' data-vz-file style='display:none'></label></div>" +
        (S.clonUrl ? "<audio class='vz-audio' controls src='" + S.clonUrl + "'></audio><p class='vz-nota'>Clip listo.</p>" : "") +
        "<div class='vz-fila'><button type='button' class='btn btn-p' data-vz-clonar" + (S.busy ? " disabled" : "") + ">" + (S.busy ? (S.nota || "Creando…") : "Crear voz") + "</button></div></div>";
    }
    if (S.err) h += "<p class='vz-err'>" + esc(S.err) + "</p>";
    if (S.nota && !S.busy) h += "<p class='vz-nota'>" + esc(S.nota) + "</p>";
    $("#body").innerHTML = h;
  }

  /* ── eventos (delegación, sin onclick dinámico) ── */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-vz-tab],[data-vz-idioma],[data-vz-spk],[data-vz-mia],[data-vz-gen],[data-vz-play],[data-vz-add],[data-vz-rec],[data-vz-clonar]");
    if (!t) return;
    if (t.hasAttribute("data-vz-tab")) { S.tab = t.getAttribute("data-vz-tab"); if (S.tab === "mias" && !S.mias) { S.miasEstado = "cargando"; render(); cargarMias().then(render); } else render(); return; }
    if (t.hasAttribute("data-vz-idioma")) { S.idioma = t.getAttribute("data-vz-idioma"); var g = grupo(); S.speaker = g && g.speakers[0] ? g.speakers[0].id : ""; render(); return; }
    if (t.hasAttribute("data-vz-spk")) { S.speaker = t.getAttribute("data-vz-spk"); render(); return; }
    if (t.hasAttribute("data-vz-mia")) { S.vozMia = t.getAttribute("data-vz-mia"); render(); return; }
    if (t.hasAttribute("data-vz-gen")) {
      var taEl = document.querySelector("[data-vz-guion]");
      var texto = taEl ? taEl.value : S.guion;
      S.guion = texto;
      if (!texto.trim()) { S.err = "Escribe el guion que dirá la voz."; return render(); }
      var body = S.tab === "mias" ? { vozId: S.vozMia, texto: texto } : { speaker: S.speaker, idioma: S.idioma, texto: texto };
      sintetizar(body).then(function () { cargarProyectos().then(render); });
      return;
    }
    if (t.hasAttribute("data-vz-play")) { try { new Audio(S.lastAudio).play(); } catch (er) {} return; }
    if (t.hasAttribute("data-vz-add")) { agregarAlVideo(); return; }
    if (t.hasAttribute("data-vz-rec")) { grabar(); return; }
    if (t.hasAttribute("data-vz-clonar")) { crearVoz(); return; }
  });
  document.addEventListener("input", function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute("data-vz-guion")) S.guion = e.target.value;
    if (e.target.hasAttribute && e.target.hasAttribute("data-vz-clonnombre")) S.clonNombre = e.target.value;
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches && e.target.matches("[data-vz-file]")) {
      var f = e.target.files && e.target.files[0];
      if (f) { S.clonBlob = f; S.clonUrl = URL.createObjectURL(f); render(); }
    }
    if (e.target.matches && e.target.matches("[data-vz-proyecto]")) S.proyectoSel = e.target.value;
  });

  /* ── override de la vista grid para crear/voces ── */
  var _vg = viewGrid;
  viewGrid = function (key) {
    if (key === "crear/voces") {
      render(true);
      cargarCat().then(function () { render(true); });
      return;
    }
    return _vg(key);
  };

  render();
})(0);
