/* bridge-ai.js — las funciones de IA y publicación de los editores, conectadas a los servicios reales de Musa
 * (servidor MCP con tu sesión, ElevenLabs, Runway, WaveSpeed, Nano Banana, u2net). Usan las claves de IA de tu
 * espacio (Configuración › Integraciones); si falta una, el mensaje lo dice.
 */
(function () {
  var RB = window.__musaReal;
  if (!RB) return;
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin puente")); }
  function json(method, body) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }; }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* herramientas MCP de Musa con la sesión del navegador */
  var rid = 0;
  RB.mcp = function (name, args) {
    return api("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method: "tools/call", params: { name: name, arguments: args || {} } }) })
      .then(function (r) {
        if (r && r.error) throw new Error(r.error.message || "error");
        var c = r && r.result && r.result.content && r.result.content[0], t = c && c.text;
        if (r.result && r.result.isError) throw new Error(t || "error");
        try { return JSON.parse(t); } catch (e) { return t; }
      });
  };
  function friendly(e) {
    var m = String(e && e.message || e || "error");
    if (/api key|apikey|GEMINI|RUNWAY|WAVESPEED|QUIVER|ELEVENLABS|BYOK|key/i.test(m)) return m + " · configura la clave en Configuración › Integraciones";
    return m;
  }
  function upload(dataUrl, name) {
    var image = /^data:image\//.test(dataUrl);
    var body = image ? { name: name, data: dataUrl, workspaceId: RB.ws } : { name: name, data: dataUrl, mimeType: (dataUrl.match(/^data:([^;]+);/) || [])[1], filename: name, workspaceId: RB.ws };
    return api(image ? "/api/assets/upload" : "/api/assets/upload-file", json("POST", body)).then(function (x) { var u = x.url || (x.data && x.data.url); if (!u) throw new Error("subida sin URL"); return u; });
  }
  RB.uploadData = upload;
  function canvasData(cv, max) {
    var s = Math.min(1, (max || 2400) / Math.max(cv.width, cv.height));
    if (s < 1) { var c2 = document.createElement("canvas"); c2.width = Math.round(cv.width * s); c2.height = Math.round(cv.height * s); c2.getContext("2d").drawImage(cv, 0, 0, c2.width, c2.height); cv = c2; }
    return cv.toDataURL("image/jpeg", 0.9);
  }
  function loadCanvas(url) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () { var c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); res(c); };
      im.onerror = function () { rej(new Error("no se pudo leer la imagen")); }; im.src = url;
    });
  }
  function blobToData(b) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); }); }
  function pollUntil(fn, ok, every, max) {
    var n = 0;
    var loop = function () { return fn().then(function (r) { if (ok(r)) return r; if (++n > max) throw new Error("tardó demasiado; reintenta"); return wait(every).then(loop); }); };
    return loop();
  }
  function cutout(url) {
    return RB.mcp("remove_background", { url: url, workspaceId: RB.ws }).then(function (r) {
      var get = function (x) { x = x || {}; var j = x.result_json || x.result || x; return j && (j.cutoutUrl || j.cutout_url) ? j : null; };
      if (get(r)) return get(r);
      var id = r && (r.jobId || r.job_id || r.id);
      if (!id) throw new Error("quitar fondo no devolvió resultado");
      return pollUntil(function () { return RB.mcp("segment_status", { jobId: id }); }, function (x) { return get(x) || (x && /error|failed/.test(x.status || "")); }, 2000, 40)
        .then(function (x) { if (!get(x)) throw new Error((x && (x.error || x.status)) || "falló"); return get(x); });
    });
  }
  function separate(url) {
    return RB.mcp("separate_image_layers", { imageUrl: url }).then(function (r) {
      var id = r && (r.predictionId || r.id);
      if (!id) throw new Error("no se pudo iniciar la separación");
      return pollUntil(function () { return RB.mcp("separate_image_layers_check", { predictionId: id }); }, function (x) { return x && (x.status === "completed" || /fail|error/.test(x.status || "")); }, 5000, 60);
    }).then(function (x) { if (x.status !== "completed") throw new Error("la separación falló"); return x; });
  }
  function nanoBanana(prompt, imageData, aspect) {
    var a = { prompt: prompt }; if (imageData) a.imageBase64 = imageData; if (aspect) a.aspectRatio = aspect;
    return RB.mcp("ai_generate_image", a).then(function (r) { if (!r || !r.imageBase64) throw new Error("Nano Banana no devolvió imagen"); return r.imageBase64; });
  }
  var ARS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
  function nearAR(w, h) { var r = w / h; return ARS.slice().sort(function (a, b) { var p = a.split(":"), q = b.split(":"); return Math.abs(p[0] / p[1] - r) - Math.abs(q[0] / q[1] - r); })[0]; }

  /* ═════ Editor de diseño › IA ═════ */
  if (typeof MENUS !== "undefined") {
    var selImg = function () { var o = ED.sel && ED.sel.e != null ? ED.doc.frames[ED.sel.f].els[ED.sel.e] : null; return o && o.type === "image" ? o : null; };
    var urlOfEl = function (o) { var m = String(o.fill || "").match(/url\(["']?([^"')]+)["']?\)/); return m ? m[1] : null; };
    var frameOf = function () { return ED.doc.frames[ED.sel ? ED.sel.f : 0]; };
    var reopen = function () { var id = ED.doc._id; setTimeout(function () { RB.openDesign(id); }, 300); };
    var saveNow = function () { return new Promise(function (r) { if (RB._ed) RB._ed.save(); setTimeout(r, 2500); }); };
    var insertImage = function (f, url, name, box) {
      snap();
      var w = box ? box.w : Math.round(f.w * 0.6), h = box ? box.h : Math.round(f.w * 0.6), o = { type: "image", name: name || "Imagen IA", x: box ? box.x : Math.round((f.w - w) / 2), y: box ? box.y : Math.round((f.h - h) / 2), w: w, h: h, fill: "url('" + url + "') center/cover no-repeat" };
      f.els.push(Object.assign({}, DEF, o));
      edRender(); edLayers();
    };
    var IA = {
      "Nano Banana": function () {
        var o = selImg(), f = frameOf();
        var p = prompt(o ? "¿Qué cambio quieres en la imagen seleccionada?" : "Describe la imagen que quieres crear:");
        if (!p || !p.trim()) return;
        toast(o ? "Editando con Nano Banana…" : "Generando con Nano Banana…");
        var src = o && urlOfEl(o) ? loadCanvas(urlOfEl(o)).then(function (c) { return canvasData(c, 2000); }) : Promise.resolve(null);
        src.then(function (data) { return nanoBanana(p.trim(), data, nearAR(o ? o.w : f.w, o ? o.h : f.h)); })
          .then(function (img) { return upload(img, "nano-banana.png"); })
          .then(function (url) { if (o) { snap(); o.fill = "url('" + url + "') center/cover no-repeat"; edRender(); edProps(); } else insertImage(f, url, "Nano Banana"); toast("Imagen lista"); })
          .catch(function (e) { toast("Nano Banana: " + friendly(e)); });
      },
      "Imagen → Diseño": function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
        inp.onchange = function () {
          var file = inp.files && inp.files[0]; if (!file) return;
          toast("Convirtiendo la imagen en un frame editable…");
          var doc = ED.doc, data;
          blobToData(file).then(function (d) { data = d; return new Promise(function (r) { var im = new Image(); im.onload = function () { r([im.naturalWidth, im.naturalHeight]); }; im.src = d; }); })
            .then(function (wh) {
              var s = 1080 / Math.max(wh[0], wh[1]), w = Math.round(wh[0] * s), h = Math.round(wh[1] * s), fid = "frame_" + Date.now().toString(36);
              /* frame nuevo vacío donde la IA escribe el HTML */
              var x = doc.frames.reduce(function (m, f) { return Math.max(m, f.x + f.w); }, 0) + 120;
              snap();
              doc.frames.push(Object.assign(buildFrameFrom({ id: fid, name: file.name.replace(/\.\w+$/, ""), html: "", css: "", width: w, height: h, background: "#ffffff" }, x)));
              edRender();
              return saveNow().then(function () { return RB.mcp("image_to_design", { templateId: doc._id, imageBase64: data, frameId: fid, width: w, height: h }); });
            })
            .then(function () { toast("Listo: la imagen ahora es un frame con capas"); reopen(); })
            .catch(function (e) { toast("Imagen → Diseño: " + friendly(e)); });
        };
        inp.click();
      },
      "Generar video": function () {
        var f = frameOf(); if (!f) return;
        var p = prompt("¿Qué movimiento quieres? (opcional: cámara, qué se mueve, estilo)", "") ; if (p === null) return;
        var ratio = f.w > f.h ? "1280:720" : f.w < f.h ? "720:1280" : "960:960";
        toast("Preparando el frame…");
        RB.shotFrame(f).then(function (d) { return upload(d, f.name + ".jpg"); })
          .then(function (url) { toast("Runway está animando el frame (1-3 min)…"); return RB.mcp("generate_image_video", { imageUrl: url, prompt: p || undefined, ratio: ratio, duration: 5 }); })
          .then(function (r) {
            var id = r && (r.taskId || r.id); if (!id) throw new Error("Runway no devolvió tarea");
            return pollUntil(function () { return RB.mcp("generate_image_video_check", { taskId: id }); }, function (x) { return x && (x.status === "SUCCEEDED" || /FAILED|CANCEL/.test(x.status || "")); }, 6000, 60)
              .then(function (x) { if (x.status !== "SUCCEEDED") throw new Error("Runway: " + x.status); return RB.mcp("generate_image_video_check", { taskId: id, persist: true, workspaceId: RB.ws }); });
          })
          .then(function (x) {
            var url = x.videoUrl || x.tempUrl; if (!url) throw new Error("sin video");
            toast("Video listo: creando el proyecto…");
            return RB.videoFromUrl ? RB.videoFromUrl(url, f.name + " · animado", f.w, f.h) : window.open(url);
          })
          .catch(function (e) { toast("Generar video: " + friendly(e)); });
      },
      "Vectorizar": function () {
        var o = selImg(), f = frameOf();
        if (!o || !urlOfEl(o)) return toast("Selecciona una capa de imagen para vectorizar");
        toast("Vectorizando con Quiver…");
        saveNow().then(function () { return RB.mcp("vectorize_image", { templateId: ED.doc._id, frameId: f._src && f._src.id, imageUrl: urlOfEl(o), x: o.x, y: o.y }); })
          .then(function () { toast("Vector agregado como capa nueva"); reopen(); })
          .catch(function (e) { toast("Vectorizar: " + friendly(e)); });
      },
      "Separar en capas": function () {
        var o = selImg(), f = frameOf();
        if (!o || !urlOfEl(o)) return toast("Selecciona una capa de imagen para separarla en capas");
        toast("Separando en capas (≈1 min)…");
        var bx = { x: o.x, y: o.y, w: o.w, h: o.h };
        separate(urlOfEl(o)).then(function (x) {
          var layers = (x.layers && x.layers.length ? x.layers : (x.outputs || []).map(function (u, i) { return { url: u, name: "Capa " + (i + 1) }; }));
          var W = (x.width || (layers[0] && layers[0].size && layers[0].size.width)) || null;
          snap();
          layers.forEach(function (L, i) {
            var bb = L.boundingBox, s = W ? bx.w / W : 1;
            var box = bb && W ? { x: Math.round(bx.x + bb.x * s), y: Math.round(bx.y + bb.y * s), w: Math.max(4, Math.round(bb.width * s)), h: Math.max(4, Math.round(bb.height * s)) } : bx;
            f.els.push(Object.assign({}, DEF, { type: "image", name: L.name || "Capa " + (i + 1), x: box.x, y: box.y, w: box.w, h: box.h, fill: "url('" + L.url + "') center/contain no-repeat" }));
          });
          o.hidden = true;
          edRender(); edLayers();
          toast(layers.length + " capas creadas · la original quedó oculta");
        }).catch(function (e) { toast("Separar en capas: " + friendly(e)); });
      },
      "Ajustes de IA": function () { if (ED.open) location.hash = "configuracion/integraciones"; }
    };
    var buildFrameFrom = function (src, x) { return RB._buildFrame(src, x); };
    var _mIa = MENUS.ia;
    MENUS.ia = function () {
      var it = _mIa(); if (!ED.doc || !ED.doc._real) return it;
      return it.map(function (x) { return x && x.l && IA[x.l] ? Object.assign({}, x, { fn: IA[x.l] }) : x; });
    };
  }

  /* ═════ Editor de fotos › IA ═════ */
  if (typeof PH_MENUS !== "undefined") {
    var phData = function (max) { return canvasData(PH.src, max || 2400); };
    var phAddUp = function (cv, name) {
      var t2 = phCanvas(120, 120 * cv.height / cv.width); t2.getContext("2d").drawImage(cv, 0, 0, t2.width, t2.height);
      PH.ups.push({ name: name, from: "IA", cv: cv, thumb: t2.toDataURL("image/jpeg", .8) });
      phGo("u" + (PH.ups.length - 1));
    };
    var srcUrl = function () { return upload(phData(2400), (PH.t && PH.t.name || "foto") + ".jpg"); };
    var brushMask = function (alphaCv, invert, label) {
      phSnap();
      var id = "m" + Date.now().toString(36), c = phCanvas(PH.base.w, PH.base.h), g = c.getContext("2d");
      g.drawImage(alphaCv, 0, 0, c.width, c.height);
      if (invert) { g.globalCompositeOperation = "xor"; g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); }
      PH.brushCv[id] = c;
      PH.r.masks.push({ id: id, kind: "brush", on: true, invert: false, feather: .2, name: label, adj: { exposure: 0, contrast: 0, saturation: 0, temp: 0, tint: 0 } });
      PH.mask = id; phAll();
      phToast(label + " seleccionado: ajusta sus valores a la derecha");
    };
    var PIA = {
      "Seleccionar sujeto": function () {
        if (PH.r.masks.length >= 6) return phToast("Máximo 6 máscaras");
        phToast("Detectando el sujeto…");
        srcUrl().then(cutout).then(function (j) { return loadCanvas(j.cutoutUrl || j.cutout_url); }).then(function (cv) { brushMask(cv, false, "Sujeto"); })
          .catch(function (e) { phToast("Seleccionar sujeto: " + friendly(e)); });
      },
      "Seleccionar cielo": function () {
        if (PH.r.masks.length >= 6) return phToast("Máximo 6 máscaras");
        /* local: píxeles claros y azulados conectados al borde superior */
        var s = PH.src, w = Math.min(800, s.width), h = Math.round(s.height * w / s.width), c = phCanvas(w, h), g = c.getContext("2d");
        g.drawImage(s, 0, 0, w, h);
        var d = g.getImageData(0, 0, w, h), px = d.data, out = g.createImageData(w, h), seen = new Uint8Array(w * h), q = [];
        var sky = function (i) { var r = px[i], gg = px[i + 1], b = px[i + 2], l = (r + gg + b) / 3; return (b >= r - 8 && b >= gg - 20 && l > 110) || l > 215; };
        for (var x = 0; x < w; x++) if (sky(x * 4)) { seen[x] = 1; q.push(x); }
        while (q.length) {
          var k = q.pop(), X = k % w, Y = (k - X) / w; out.data[k * 4 + 3] = 255;
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) { var nx = X + dd[0], ny = Y + dd[1]; if (nx < 0 || ny < 0 || nx >= w || ny >= h) return; var j = ny * w + nx; if (!seen[j] && sky(j * 4)) { seen[j] = 1; q.push(j); } });
        }
        var n = 0; for (var i = 3; i < out.data.length; i += 4) if (out.data[i]) n++;
        if (n < w * h * 0.02) return phToast("No encontré cielo en esta foto");
        g.putImageData(out, 0, 0);
        brushMask(c, false, "Cielo");
      },
      "Quitar fondo": function () {
        phToast("Quitando el fondo…");
        srcUrl().then(cutout).then(function (j) { return loadCanvas(j.cutoutUrl || j.cutout_url); }).then(function (cv) { phAddUp(cv, (PH.t && PH.t.name || "Foto") + " · sin fondo"); phToast("Listo: aplícala para usarla en el diseño"); })
          .catch(function (e) { phToast("Quitar fondo: " + friendly(e)); });
      },
      "Separar en capas": function () {
        phToast("Separando en capas (≈1 min)…");
        srcUrl().then(separate).then(function (x) {
          var L = x.layers && x.layers.length ? x.layers : (x.outputs || []).map(function (u, i) { return { url: u, name: "Capa " + (i + 1) }; });
          return L.reduce(function (p, l, i) { return p.then(function () { return loadCanvas(l.url).then(function (cv) { var t2 = phCanvas(120, 120 * cv.height / cv.width); t2.getContext("2d").drawImage(cv, 0, 0, t2.width, t2.height); PH.ups.push({ name: l.name || "Capa " + (i + 1), from: "Separar en capas", cv: cv, thumb: t2.toDataURL("image/png") }); }); }); }, Promise.resolve())
            .then(function () { PH.lt = "fotos"; phAll(); phToast(L.length + " capas listas en «Subidas»"); });
        }).catch(function (e) { phToast("Separar en capas: " + friendly(e)); });
      },
      "Relleno generativo": function () {
        var p = prompt("¿Qué quieres borrar o agregar en la foto?"); if (!p || !p.trim()) return;
        phToast("Nano Banana está editando la foto…");
        nanoBanana(p.trim(), canvasData(phFlatten(2000), 2000), nearAR(PH.src.width, PH.src.height)).then(loadCanvas).then(function (cv) { phAddUp(cv, "Relleno · " + p.trim().slice(0, 30)); })
          .catch(function (e) { phToast("Relleno generativo: " + friendly(e)); });
      },
      "Ampliar ×2": function () {
        phToast("Ampliando con IA…");
        nanoBanana("Upscale this exact image to higher resolution. Reproduce it faithfully, sharpen fine detail, do not change composition, colors or content.", canvasData(PH.src, 1600), nearAR(PH.src.width, PH.src.height))
          .then(loadCanvas).then(function (cv) {
            var W = PH.src.width * 2, H = PH.src.height * 2, out = phCanvas(W, H), g = out.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(cv, 0, 0, W, H);
            phAddUp(out, (PH.t && PH.t.name || "Foto") + " · ×2");
          }).catch(function (e) { phToast("Ampliar ×2: " + friendly(e)); });
      },
      "Igualar color con la marca": function () {
        var b = WSS[RB.ws] && (WSS[RB.ws].brands || []).map(function (r) { return r[0]; })[0], skin = b && BRAND_SKIN[b];
        var cols = skin ? skin.slice(0, 2).join(", ") : null;
        phToast("Llevando la foto hacia la paleta de la marca…");
        nanoBanana("Color-grade this exact photo toward the brand palette" + (cols ? " (" + cols + ")" : "") + ". Keep every element, composition and detail identical; only adjust color grading, white balance and tones.", canvasData(phFlatten(2000), 2000), nearAR(PH.src.width, PH.src.height))
          .then(loadCanvas).then(function (cv) { phAddUp(cv, "Color de marca"); }).catch(function (e) { phToast("Igualar color: " + friendly(e)); });
      }
    };
    var _pIa = PH_MENUS.ia;
    PH_MENUS.ia = function () { var it = _pIa(); return it.map(function (x) { return x && x.l && PIA[x.l] ? Object.assign({}, x, { fn: PIA[x.l] }) : x; }); };
  }

  /* ═════ Editor de video: voz IA real, subtítulos y muletillas con Scribe, Publicar, video nuevo ═════ */
  if (typeof VE !== "undefined") {
    var raw = function (url, body) { var b = bridge(); if (!b || !b.fetchRaw) return Promise.reject(new Error("recarga la página para usar audio")); return b.fetchRaw(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); };
    var voices = null;
    var loadVoices = function () { if (voices) return Promise.resolve(voices); return api("/api/elevenlabs/voices").then(function (x) { voices = (x.voices || x.data || x || []).map(function (v) { return { id: v.id || v.voiceId || v.voice_id, name: v.name }; }).filter(function (v) { return v.id; }); return voices; }); };
    var takeAudio = function (c) { var tk = VTAKES[c.take]; return fetch(tk.blob).then(function (r) { if (!r.ok) throw new Error("no se pudo leer el clip"); return r.blob(); }).then(function (b) { if (b.size > 24e6) throw new Error("el clip pesa más de 24 MB"); return blobToData(b).then(function (d) { return { data: d.split(",")[1], mime: b.type || "video/mp4" }; }); }); };
    var scribe = function (c) { return takeAudio(c).then(function (a) { return api("/api/elevenlabs/stt", json("POST", { audioBase64: a.data, mimeType: a.mime, languageCode: "es" })); }); };
    var FILL = /^(eh+|em+|mm+|este|o sea|bueno|ehh|ah+|pues|digamos|tipo|vale)$/i;
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-bact]");
      if (!b || !VE.open || !VE.p || !VE.p._real) return;
      var a = b.dataset.bact, p = VE.p;
      if (a === "tts" || a === "ttsadd") {
        e.stopPropagation(); e.preventDefault();
        var txt = (vq("#veTts").value || "").trim(); if (!txt) return;
        vtoast(a === "tts" ? "Generando la voz…" : "Generando la voz y agregándola en A…");
        loadVoices().then(function (vs) {
          if (!vs.length) throw new Error("ElevenLabs no devolvió voces");
          var sel = vq("#veVoice"); if (sel && !sel.dataset.real) { sel.innerHTML = vs.map(function (v) { return '<option value="' + eesc(v.id) + '">' + eesc(v.name) + "</option>"; }).join(""); sel.dataset.real = 1; }
          return raw("/api/elevenlabs/tts", { voiceId: sel ? sel.value : vs[0].id, text: txt });
        }).then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || j.error || ("TTS " + r.status)); }); return r.blob(); })
          .then(function (blob) {
            var url = URL.createObjectURL(blob);
            if (a === "tts") { new Audio(url).play(); return vtoast("Reproduciendo la voz de ElevenLabs"); }
            var au = new Audio(url);
            return new Promise(function (res) { au.onloadedmetadata = function () { res(au.duration || 3); }; au.onerror = function () { res(3); }; })
              .then(function (dur) { return blobToData(blob).then(function (d) { return upload(d, "voz-ia.mp3"); }).then(function (u) {
                vsnap(); p.a.push({ id: nid(), name: "Voz IA · " + (vq("#veVoice").selectedOptions[0] || {}).textContent, start: Math.round(VE.t * 10) / 10, dur: Math.round(dur * 10) / 10, vol: 1, fin: 0, fout: 0.3, url: u });
                VE.sel = { tr: "a", i: p.a.length - 1 }; veAll(); veInsp(); vtoast("Voz IA agregada en A");
              }); });
          }).catch(function (err) { vtoast("Voz IA: " + friendly(err)); });
        return;
      }
      if (a === "transcribe" || a === "filler") {
        e.stopPropagation(); e.preventDefault();
        var clips = p.v1.filter(function (c) { return c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob; });
        if (!clips.length) return vtoast("No hay clips de video con voz en V1");
        vtoast("Transcribiendo con ElevenLabs Scribe…");
        var n = 0, marks = [];
        clips.reduce(function (pr, c) { return pr.then(function () { return scribe(c).then(function (r) {
          var words = (r.words || []).filter(function (w) { return w.kind !== "spacing"; }), inT = function (s) { return c.start + (s - (c.in || 0)) / (c.speed || 1); };
          if (a === "filler") { words.forEach(function (w) { if (FILL.test(w.text.replace(/[.,!?¿¡]/g, "").trim())) marks.push([inT(w.startSec), w.text]); }); return; }
          for (var i = 0; i < words.length;) {
            var grp = words.slice(i, i + 7); i += 7;
            var s = inT(grp[0].startSec), d = Math.max(0.6, inT(grp[grp.length - 1].endSec) - s);
            if (s >= c.start + c.dur) break;
            if (!n) vsnap();
            p.t.push(cap(grp.map(function (w) { return w.text; }).join(" "), Math.round(s * 100) / 100, Math.round(d * 100) / 100, { y: 78, size: 54, bg: "#000000aa", anim: "fade", weight: 700 })); n++;
          }
        }); }); }, Promise.resolve()).then(function () {
          if (a === "filler") {
            if (!marks.length) return vtoast("No encontré muletillas");
            VE.t = marks[0][0]; veAll();
            return vtoast(marks.length + " muletillas: " + marks.slice(0, 6).map(function (m) { return "«" + m[1] + "» " + fmtT(m[0]); }).join(" · ") + " · el cursor quedó en la primera");
          }
          veAll(); veBin(); vtoast(n + " subtítulos creados desde la voz real");
        }).catch(function (err) { vtoast("Transcribir: " + friendly(err)); });
      }
    }, true);

    /* Publicar: graba el reel, lo sube y lo publica en las cuentas que elijas (confirmación previa) */
    var publish = function () {
      var p = VE.p; if (!p || !p._real) return;
      vtoast("Revisando tus cuentas conectadas…");
      RB.mcp("list_social_accounts", { workspaceId: RB.ws }).then(function (r) {
        var acc = (r && (r.accounts || r.data || r)) || []; acc = Array.isArray(acc) ? acc : [];
        if (!acc.length) throw new Error("no hay cuentas de redes conectadas (Configuración › Integraciones)");
        var list = acc.map(function (x, i) { return (i + 1) + ". " + (x.platform || x.provider || "") + " · " + (x.name || x.username || x.handle || x.id); }).join("\n");
        var pick = prompt("¿En qué cuentas publico «" + p.name + "» ahora? Escribe los números separados por coma:\n" + list, "1");
        if (!pick) return null;
        var ids = pick.split(/[,\s]+/).map(function (s) { return acc[+s - 1]; }).filter(Boolean).map(function (x) { return x.id || x.accountId; });
        if (!ids.length) return null;
        if (!confirm("Se va a PUBLICAR de verdad en " + ids.length + " cuenta(s). ¿Continuar?")) return null;
        vtoast("Grabando el reel para publicarlo (tiempo real)…");
        return RB.exportReel({ f: "mp4", r: 1080, fps: p.fps }, function () {}).then(function (blob) {
          if (blob.size > 5 * 1024 * 1024) throw new Error("el reel pesa " + (blob.size / 1e6).toFixed(1) + " MB; el límite de subida es 5 MB (baja la resolución en Exportar)");
          return blobToData(blob).then(function (d) { return upload(d, (p.name || "reel") + (/mp4/.test(blob.type) ? ".mp4" : ".webm")); });
        }).then(function (mediaUrl) {
          var id = "cc_" + Math.random().toString(16).slice(2, 18), today = new Date();
          return api("/rest/v1/content_calendar", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ id: id, workspace_id: RB.ws, scheduled_date: today.toISOString().slice(0, 10), scheduled_time: today.toTimeString().slice(0, 8), topic: p.name, kind: "organic", channels: [], status: "aprobación", external_url: mediaUrl }) })
            .then(function () { return RB.mcp("publish_content", { workspaceId: RB.ws, contentId: id, mode: "now", accountIds: ids, contentType: "reel", mediaUrl: mediaUrl }); });
        }).then(function (r) { vtoast("Publicado" + (r && r.status ? " · " + r.status : "")); });
      }).catch(function (e) { vtoast("Publicar: " + friendly(e)); });
    };
    try { vq("#vePublish").onclick = function () { if (VE.p && VE.p._real) publish(); else vtoast("Publicar · en esta maqueta es simulado"); }; } catch (e) {}
    document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest('[data-vact="publish"]'); if (b && VE.p && VE.p._real) { e.stopPropagation(); e.preventDefault(); publish(); } }, true);

    /* video desde una URL (Runway) y video en blanco */
    RB.videoFromUrl = function (url, name, w, h) {
      var fmt = Object.keys(VFMT).sort(function (a, b) { return Math.abs(VFMT[a][0] / VFMT[a][1] - w / h) - Math.abs(VFMT[b][0] / VFMT[b][1] - w / h); })[0], pid, q = "?workspaceId=" + encodeURIComponent(RB.ws);
      return api("/api/video-projects", json("POST", { workspaceId: RB.ws, name: name, ratio: fmt, canvasW: VFMT[fmt][0], canvasH: VFMT[fmt][1], fps: 30 }))
        .then(function (x) { pid = x.data.project.id; return api("/api/video-projects/" + pid + q); })
        .then(function (x) {
          var vt = ((x.data.tracks || []).find(function (t) { return t.type === "video"; }) || {}).id;
          return (vt ? Promise.resolve(vt) : api("/api/video-projects/" + pid + "/tracks" + q, json("POST", { type: "video" })).then(function (y) { return y.data.track.id; }));
        })
        .then(function (track) { return api("/api/video-projects/" + pid + "/materials" + q, json("POST", { kind: "video", payload: { url: url, name: name, durationUs: 5e6 } })).then(function (m) { return api("/api/video-projects/" + pid + "/segments" + q, json("POST", { trackId: track, materialId: m.data.material.id, targetStartUs: 0, targetDurUs: 5e6, sourceStartUs: 0, sourceDurUs: 5e6, speed: 1 })); }); })
        .then(function () { RB.vids.unshift({ id: pid, name: name, ratio: fmt, duration_us: 5e6 }); TILES["crear/videos"].unshift([eesc(name), eesc(WSS[RB.ws] ? WSS[RB.ws].own : ""), "0:05"]); Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; }); return RB.openVideo(pid, 0); });
    };
    RB.newVideo = function (fmt) {
      fmt = VFMT[fmt] ? fmt : "9:16";
      var name = prompt("Nombre del video:", "Video nuevo"); if (!name) return;
      api("/api/video-projects", json("POST", { workspaceId: RB.ws, name: name, ratio: fmt, canvasW: VFMT[fmt][0], canvasH: VFMT[fmt][1], fps: 30 }))
        .then(function (x) { var pid = x.data.project.id; RB.vids.unshift({ id: pid, name: name, ratio: fmt, duration_us: 0 }); TILES["crear/videos"].unshift([eesc(name), eesc(WSS[RB.ws] ? WSS[RB.ws].own : ""), "0:00"]); Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; }); return RB.openVideo(pid, 0); })
        .catch(function (e) { uiToast("No se pudo crear el video: " + friendly(e)); });
    };
  }
})();
