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
    return api("/mcp", { method: "POST", timeoutMs: 180000, headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method: "tools/call", params: { name: name, arguments: args || {} } }) })
      .then(function (r) {
        if (r && r.error) throw new Error(r.error.message || "error");
        var c = r && r.result && r.result.content && r.result.content[0], t = c && c.text;
        if (r.result && r.result.isError) throw new Error(t || "error");
        try { return JSON.parse(t); } catch (e) { return t; }
      });
  };
  function friendly(e) {
    var m = String(e && e.message || e || "error");
    /* errores crudos del proveedor (401, «身份验证失败», JSON del LLM): mensaje claro, sin internals */
    if (/401|unauthori|invalid[_ ]?api|authentication|身份验证|api key not valid/i.test(m)) return "Tu llave de IA no es válida o venció · revísala en Configuración › Integraciones";
    if (/429|quota|rate.?limit|insufficient|余额|saldo/i.test(m)) return "Tu proveedor de IA no tiene saldo o llegó a su límite · revísalo en Configuración › Integraciones";
    if (/LLM \w+ error|\{"error"/.test(m)) return "Tu proveedor de IA respondió con un error · inténtalo de nuevo o revisa la llave en Configuración › Integraciones";
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
  /* recorte del sujeto: Nano Banana dibuja la máscara (blanco = sujeto) y se usa como canal alfa de la foto */
  function subjectMask(cv) {
    var data = canvasData(cv, 1600);
    return nanoBanana("Create a precise segmentation mask of this exact photo: paint the main subject (people, product or main object, including hair and fine edges) pure white #FFFFFF and everything else pure black #000000. Same framing and size as the input. No gray, no text, no other content.", data, nearAR(cv.width, cv.height))
      .then(loadCanvas).then(function (m) {
        var W = cv.width, H = cv.height, mc = document.createElement("canvas"); mc.width = W; mc.height = H;
        var g = mc.getContext("2d"); g.drawImage(m, 0, 0, W, H);
        var d = g.getImageData(0, 0, W, H), px = d.data;
        for (var i = 0; i < px.length; i += 4) { var l = (px[i] + px[i + 1] + px[i + 2]) / 3; px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = l > 128 ? Math.min(255, (l - 128) * 2.2) : 0; }
        g.putImageData(d, 0, 0);
        return mc;
      });
  }
  function cutoutCanvas(cv) {
    return subjectMask(cv).then(function (mask) {
      var out = document.createElement("canvas"); out.width = cv.width; out.height = cv.height;
      var g = out.getContext("2d"); g.drawImage(cv, 0, 0); g.globalCompositeOperation = "destination-in"; g.drawImage(mask, 0, 0);
      return { cut: out, mask: mask };
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

  /* ═════ Configuración › Integraciones: BYOK real (cada usuario pone sus llaves) ═════ */
  var BYOK_CATS = { "Chat IA": 1, "Editor": 1, "Contenidos": 1, "Importar": 1 };
  RB.byok = null;
  RB.loadKeys = function () {
    return api("/api/keys").then(function (m) { RB.byok = m || {}; applyKeys(); return RB.byok; }, function () { RB.byok = RB.byok || {}; });
  };
  function applyKeys() {
    if (typeof INTS === "undefined" || !RB.byok) return;
    INTS.forEach(function (i) {
      if (!BYOK_CATS[i.cat] || i.accounts || i.social) return;
      var k = RB.byok[i.id];
      i.st = k && k.configured ? "ok" : "off"; i.key = k && k.last4 ? k.last4 : null; i.account = null;
    });
  }
  if (typeof viewIntegrations === "function") {
    var _vInt = viewIntegrations;
    viewIntegrations = function () {
      if (RB.on && !RB.byok) { RB.loadKeys().then(function () { if (route.sub === "integraciones") _vInt(); }); }
      applyKeys();
      return _vInt.apply(this, arguments);
    };
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('#body [data-ia="link"], #body [data-ia="unlink"]');
      if (!a || !RB.on || typeof INT === "undefined") return;
      var i = INTS.find(function (x) { return x.id === INT.open; });
      if (!i || !BYOK_CATS[i.cat] || i.accounts || i.social) return;
      e.stopPropagation(); e.preventDefault();
      if (a.dataset.ia === "link") {
        var inp = document.getElementById("intKey"), v = inp ? inp.value.trim() : "";
        if (v.length < 8) { if (inp) { inp.placeholder = "Pega la key completa"; inp.focus(); } return; }
        a.disabled = true;
        api("/api/keys/" + encodeURIComponent(i.id), json("PUT", { key: v }))
          .then(function () { uiToast(i.name + " vinculada a tu cuenta · la key queda cifrada en el servidor"); return RB.loadKeys(); })
          .then(function () { viewIntegrations(); }, function (err) { a.disabled = false; uiToast("No se pudo guardar la key: " + (err && err.message)); });
      } else {
        return window.__musaReal.confirmBox("¿Desvincular tu key de " + i.name + "? Las funciones que la usan dejarán de funcionar hasta que pongas otra.", { danger: true, ok: "Desvincular" }).then(function (ok) { if (!ok) return;
        api("/api/keys/" + encodeURIComponent(i.id), { method: "DELETE" })
          .then(function () { uiToast(i.name + " desvinculada"); return RB.loadKeys(); })
          .then(function () { viewIntegrations(); }, function (err) { uiToast("No se pudo desvincular: " + (err && err.message)); });
      });
      }
    }, true);
  }

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
        return window.__musaReal.promptBox(o ? "¿Qué cambio quieres en la imagen seleccionada?" : "Describe la imagen que quieres crear:", "", { title: "Nano Banana", multiline: true, rows: 4, label: o ? "Cambio" : "Descripción", ok: o ? "Editar" : "Generar" }).then(function (p) {
        if (!p || !p.trim()) return;
        toast(o ? "Editando con Nano Banana…" : "Generando con Nano Banana…");
        var src = o && urlOfEl(o) ? loadCanvas(urlOfEl(o)).then(function (c) { return canvasData(c, 2000); }) : Promise.resolve(null);
        src.then(function (data) { return nanoBanana(p.trim(), data, nearAR(o ? o.w : f.w, o ? o.h : f.h)); })
          .then(function (img) { return upload(img, "nano-banana.png"); })
          .then(function (url) { if (o) { snap(); o.fill = "url('" + url + "') center/cover no-repeat"; edRender(); edProps(); } else insertImage(f, url, "Nano Banana"); toast("Imagen lista"); })
          .catch(function (e) { toast("Nano Banana: " + friendly(e)); });
      });
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
        return window.__musaReal.promptBox("Opcional: cámara, qué se mueve, estilo.", "", { title: "Animar el frame", label: "Movimiento", ok: "Animar" }).then(function (p) { if (p === null) return;
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
      });
      },
      "Vectorizar": function () {
        /* motor propio (sin IA ni llave de Quiver): bridge-replica.js */
        if (RB.replicaVectorize) return RB.replicaVectorize();
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
      /* se abre en otra pestaña: antes sacaba del editor sin forma de volver al diseño (QA Instinct 11) */
      "Ajustes de IA": function () {
        var url; try { url = window.parent.location.origin + window.parent.location.pathname + "#configuracion/integraciones"; } catch (e) { url = "/#configuracion/integraciones"; }
        try { window.open(url, "_blank", "noopener"); } catch (e) {}
        toast("Ajustes de IA abiertos en otra pestaña: tu diseño sigue aquí");
      }
    };
    var buildFrameFrom = function (src, x) { return RB._buildFrame(src, x); };
    var _mIa = MENUS.ia;
    MENUS.ia = function () {
      var it = _mIa(); if (!ED.doc || !ED.doc._real) return it;
      return it.map(function (x) { return x && x.l && IA[x.l] ? Object.assign({}, x, { fn: IA[x.l] }) : x; });
    };
  }

  /* al aplicar una foto con transparencia (sin fondo, capas separadas) se guarda como PNG para no perder el recorte */
  var _toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
    try {
      if (typeof PH !== "undefined" && PH.open && type === "image/jpeg" && this.width && this.height) {
        var t = document.createElement("canvas"); t.width = 64; t.height = Math.max(1, Math.round(64 * this.height / this.width));
        var g = t.getContext("2d"); g.drawImage(this, 0, 0, t.width, t.height);
        var px = g.getImageData(0, 0, t.width, t.height).data;
        for (var i = 3; i < px.length; i += 4) if (px[i] < 250) { type = "image/png"; break; }
      }
    } catch (e) {}
    return _toBlob.call(this, cb, type, q);
  };

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
        subjectMask(PH.src).then(function (mask) { brushMask(mask, false, "Sujeto"); })
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
        cutoutCanvas(PH.src).then(function (r) { phAddUp(r.cut, (PH.t && PH.t.name || "Foto") + " · sin fondo"); phToast("Listo: aplícala para usarla en el diseño"); })
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
        return window.__musaReal.promptBox("¿Qué quieres borrar o agregar en la foto?", "", { title: "Relleno generativo", label: "Indicación", ok: "Aplicar" }).then(function (p) { if (!p || !p.trim()) return;
        phToast("Nano Banana está editando la foto…");
        nanoBanana(p.trim(), canvasData(phFlatten(2000), 2000), nearAR(PH.src.width, PH.src.height)).then(loadCanvas).then(function (cv) { phAddUp(cv, "Relleno · " + p.trim().slice(0, 30)); })
          .catch(function (e) { phToast("Relleno generativo: " + friendly(e)); });
      });
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
    var takeAudio = function (c) { var tk = c.take != null ? VTAKES[c.take] : null, src = tk ? tk.blob : c.url; return fetch(src).then(function (r) { if (!r.ok) throw new Error("no se pudo leer el clip"); return r.blob(); }).then(function (b) { if (b.size > 24e6) throw new Error("el clip pesa más de 24 MB"); return blobToData(b).then(function (d) { return { data: d.split(",")[1], mime: b.type || (tk ? "video/mp4" : "audio/mpeg") }; }); }); };
    var scribe = function (c) { return takeAudio(c).then(function (a) { return api("/api/elevenlabs/stt", json("POST", { audioBase64: a.data, mimeType: a.mime, languageCode: "es" })); }); };
    var FILL = /^(eh+|em+|mm+|este|o sea|bueno|ehh|ah+|pues|digamos|tipo|vale)$/i;
    /* SRT o VTT → [{ s, d, text }] (segundos). Tolera números de cue, estilos <i>, ajustes de posición y líneas CRLF */
    var parseSubs = function (txt) {
      var tm = function (v) { var m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(v.trim()); if (!m) return NaN; return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4] + "00").slice(0, 3)) / 1000; };
      var out = [];
      String(txt || "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).forEach(function (blk) {
        var ls = blk.split("\n").filter(function (l) { return l.trim() !== ""; }), k = ls.findIndex(function (l) { return /-->/.test(l); }); if (k < 0) return;
        var pr = ls[k].split("-->"), s0 = tm(pr[0]), s1 = tm((pr[1] || "").trim().split(/\s+/)[0]); if (!isFinite(s0) || !isFinite(s1) || s1 <= s0) return;
        var text = ls.slice(k + 1).join("\n").replace(/<[^>]+>/g, "").trim(); if (!text) return;
        out.push({ s: Math.round(s0 * 100) / 100, d: Math.round((s1 - s0) * 100) / 100, text: text });
      });
      return out;
    };
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
        /* lo que se dice en las tomas de V1 y en los audios de A (voz subida, voz IA, música con letra) */
        var srcs = p.v1.filter(function (c) { return c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob; }).map(function (c) { return { c: c, inT: function (s) { return c.start + (s - (c.in || 0)) / (c.speed || 1); }, end: c.start + c.dur }; })
          .concat((p.a || []).filter(function (c) { return c.url && !c.mute; }).map(function (c) { return { c: c, inT: function (s) { return c.start + s - (c.in || 0); }, end: c.start + c.dur }; }));
        if (!srcs.length) return vtoast("No hay voz para transcribir: suma una toma en V1 o un audio en A");
        vtoast("Transcribiendo " + srcs.length + (srcs.length > 1 ? " clips" : " clip") + " con ElevenLabs Scribe…");
        var n = 0, marks = [], skipped = 0;
        srcs.reduce(function (pr, x) { return pr.then(function () { return scribe(x.c).then(function (r) {
          var words = (r.words || []).filter(function (w) { return w.kind !== "spacing"; });
          if (a === "filler") { words.forEach(function (w) { if (FILL.test(w.text.replace(/[.,!?¿¡]/g, "").trim())) marks.push([x.inT(w.startSec), w.text]); }); return; }
          for (var i = 0; i < words.length;) {
            var grp = words.slice(i, i + 7); i += 7;
            var s = x.inT(grp[0].startSec), d = Math.max(0.6, x.inT(grp[grp.length - 1].endSec) - s);
            if (s < x.c.start - 0.05 || s >= x.end) continue;
            /* no se duplica un subtítulo que ya existe en ese momento (transcribir dos veces) */
            if (p.t.some(function (t) { return t.sub && Math.abs(t.start - s) < 0.3; })) { skipped++; continue; }
            if (!n) vsnap();
            var t = cap(grp.map(function (w) { return w.text; }).join(" "), Math.round(s * 100) / 100, Math.round(d * 100) / 100, { y: 82, size: 54, bg: "#000000aa", anim: "fade", weight: 700 }); t.sub = 1;
            p.t.push(t); n++;
          }
        }); }); }, Promise.resolve()).then(function () {
          if (a === "filler") {
            if (!marks.length) return vtoast("No encontré muletillas");
            VE.t = marks[0][0]; veAll();
            return vtoast(marks.length + " muletillas: " + marks.slice(0, 6).map(function (m) { return "«" + m[1] + "» " + fmtT(m[0]); }).join(" · ") + " · el cursor quedó en la primera");
          }
          veAll(); veBin(); vtoast(n + " subtítulos creados desde la voz" + (skipped ? " · " + skipped + " ya estaban" : ""));
        }).catch(function (err) { vtoast("Transcribir: " + friendly(err) + " · también puedes importar un archivo SRT o VTT"); });
        return;
      }
      /* un subtítulo a mano, en el playhead (se escribe en el inspector o con doble clic en el lienzo) */
      if (a === "subadd") {
        e.stopPropagation(); e.preventDefault();
        vsnap();
        var nt = cap("Escribe el subtítulo", Math.round(VE.t * 100) / 100, 2.5, { y: 82, size: 54, bg: "#000000aa", anim: "fade", weight: 700 }); nt.sub = 1;
        p.t.push(nt); VE.sel = { tr: "t", i: p.t.length - 1 }; veAll(); veInsp(); veBin();
        setTimeout(function () { var f = document.querySelector('#veInsp [data-vk="text"], #veInsp textarea'); if (f) { f.focus(); if (f.select) f.select(); } }, 60);
        return vtoast("Subtítulo agregado a las " + fmtT(VE.t) + ": escríbelo en el inspector");
      }
      /* exportar: solo los subtítulos (si el video los tiene marcados), no los títulos del diseño */
      if (a === "srt" || a === "vtt") {
        var hasSub = p.t.some(function (c) { return c.sub; }); if (!hasSub) return;
        e.stopPropagation(); e.preventDefault();
        var ts = function (s, sep) { var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + x.toFixed(3).padStart(6, "0").replace(".", sep); };
        var list = p.t.filter(function (c) { return c.sub; }).sort(function (x, y) { return x.start - y.start; });
        var txt = a === "srt" ? list.map(function (c, i) { return (i + 1) + "\n" + ts(c.start, ",") + " --> " + ts(c.start + c.dur, ",") + "\n" + c.text + "\n"; }).join("\n")
          : "WEBVTT\n\n" + list.map(function (c) { return ts(c.start, ".") + " --> " + ts(c.start + c.dur, ".") + "\n" + c.text + "\n"; }).join("\n");
        var dl = document.createElement("a"); dl.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" })); dl.download = (p.name || "video") + "." + a; document.body.appendChild(dl); dl.click(); dl.remove();
        return vtoast(list.length + " subtítulos en " + a.toUpperCase());
      }
      /* subtítulos desde un archivo (SRT o VTT): sin IA, para cualquier video o audio */
      if (a === "srtin") {
        e.stopPropagation(); e.preventDefault();
        /* en el documento (Safari no abre el selector de un input suelto) y se quita al elegir */
        var fi = document.createElement("input"); fi.type = "file"; fi.accept = ".srt,.vtt,text/vtt,application/x-subrip,text/plain"; fi.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.appendChild(fi);
        fi.onchange = function () {
          var f = fi.files && fi.files[0]; fi.remove(); if (!f) return;
          f.text().then(function (txt) {
            var cues = parseSubs(txt); if (!cues.length) return vtoast("No encontré subtítulos en «" + f.name + "» (¿es SRT o VTT?)");
            vsnap();
            cues.forEach(function (q) { var t = cap(q.text, q.s, q.d, { y: 82, size: 54, bg: "#000000aa", anim: "fade", weight: 700 }); t.sub = 1; p.t.push(t); });
            VE.t = cues[0].s; veAll(); veBin(); vtoast(cues.length + " subtítulos importados de «" + f.name + "»");
          });
        };
        fi.click();
        return;
      }
    }, true);

    /* Clones IA con HeyGen (BYOK): tus clones, generar video con un clon y entrenar uno desde una toma */
    var musaClones = null, clonEstado = null, clonesCargando = false;
    /* Subtítulos: transcribir también los audios de A e importar un SRT/VTT (sin IA) */
    var _veBinS = veBin;
    veBin = function () {
      _veBinS.apply(this, arguments);
      if (!VE.p || VE.tab !== "subs") return;
      var bt = vq('#veBin [data-bact="transcribe"]'); if (!bt || bt.dataset.subx) return;
      bt.dataset.subx = "1"; bt.textContent = "Transcribir tomas y audios";
      var note = bt.parentNode.querySelector(".ed-note"); if (note) note.textContent = "Crea subtítulos en T con lo que se dice en las tomas de V1 y en los audios de A (ElevenLabs Scribe, con tu llave). Sin llave: importa un archivo de subtítulos.";
      bt.insertAdjacentHTML("afterend", '<button class="ed-btn" data-bact="srtin" style="margin-left:6px">Importar SRT o VTT</button><button class="ed-btn" data-bact="subadd" style="margin-left:6px">Agregar subtítulo</button>');
      /* si el video tiene subtítulos marcados, la lista y la exportación son solo esos (no los títulos del diseño) */
      var subs = VE.p.t.filter(function (c) { return c.sub; });
      if (subs.length) {
        [].forEach.call(document.querySelectorAll("#veBin [data-subi]"), function (b2) { var c = VE.p.t[+b2.dataset.subi]; if (c && !c.sub) b2.remove(); });
        var hd = [].find.call(document.querySelectorAll("#veBin .ed-mh"), function (h) { return /^Subtítulos/.test(h.textContent); }); if (hd) hd.textContent = "Subtítulos · " + subs.length;
      }
    };
    var _veBinC = veBin;
    veBin = function () {
      _veBinC.apply(this, arguments);
      if (!VE.p || !VE.p._real || VE.tab !== "clones") return;
      var box = vq("#veBin"), sec2 = function (t, body) { return '<div class="ve-bsec"><div class="ed-mh">' + t + "</div>" + body + "</div>"; };
      /* Una sola lista: clones propios de Musa (plan Empresa) y los clones privados de HeyGen traídos a Musa */
      var est = clonEstado || {}, hab = !!est.habilitado, cargandoEst = clonEstado == null;
      var etiqueta = function (c) { return c.provider === "heygen" ? "HeyGen" : "Musa"; };
      var opts = (musaClones || []).filter(function (c) { return c.status === "listo" && (c.provider === "heygen" ? est.heygen : hab); })
        .map(function (c) { return '<option value="clon:' + eesc(c.id) + '">' + eesc(c.name) + " · " + etiqueta(c) + "</option>"; }).join("");
      var lista = (musaClones || []).slice(0, 40).map(function (c) { return '<div class="ve-item" style="cursor:default"><span class="ve-bth" style="background:' + (c.portrait_url ? "url('" + eesc(c.portrait_url) + "') center/cover" : "#333") + '"></span><span><b>' + eesc(c.name) + "</b><small>" + etiqueta(c) + " · " + (c.status === "listo" ? "listo" : c.status === "error" ? "error" : (c.provider === "heygen" ? "entrenando" : "preparando")) + "</small></span></div>"; }).join("");
      var nota = (hab || cargandoEst) ? "" : '<div class="ed-note">Los <b>clones propios de Musa</b> están habilitados para el plan Empresa. ' + (est.heygen ? "Tus clones de HeyGen se usan con tu llave: HeyGen genera el video y Musa lo trae aquí." : "Conecta tu API de HeyGen (Configuración › Integraciones) y trae tus clones a Musa.") + "</div>";
      box.innerHTML = sec2("Tus clones", (musaClones == null ? '<div class="ed-note">Cargando tus clones…</div>' : (lista || '<div class="ed-note">Todavía no tienes clones.</div>')) + nota)
        + sec2("Generar video con el clon", '<div class="ed-sb" style="padding:0"><label class="ef full"><span>Clon</span><select id="mbAv">' + (opts || "<option value=''>— sin clones listos —</option>") + '</select></label><label class="ef full ta"><textarea id="mbScript" rows="4" placeholder="Guion del clon…"></textarea></label><label class="ef"><span>Formato</span><select id="mbAr"><option>9:16</option><option>16:9</option><option>1:1</option></select></label><button class="ed-btn pri" data-mbclone="gen">Generar</button></div>')
        + sec2("Entrenar un clon desde una toma", '<label class="ef full"><span>Toma grabada (últimas 24 h)</span><select id="mbTake"><option value="">Cargando tomas…</option></select></label><label class="ef full"><span>Nombre</span><input id="mbCloneName" placeholder="Ej.: Renzo estudio"></label>'
          + (hab ? '<button class="ed-btn pri" data-mbclone="trainmusa" style="margin-top:6px;width:100%">Entrenar con Musa</button>' : "")
          + '<button class="ed-btn' + (hab ? "" : " pri") + '" data-mbclone="train" style="margin-top:6px;width:100%">Entrenar con HeyGen</button><div class="ed-note">Graba 1 a 2 minutos mirando a cámara en Crear › Tomas. ' + (hab ? "Musa crea tu avatar y tu voz con tu plan Empresa; " : "") + "HeyGen usa tu llave (Integraciones).</div>");
      /* mientras llega el estado del plan no se muestra ninguna variante (evita un aviso equivocado por un instante) */
      if (clonEstado == null && window.__musaClonEstado) window.__musaClonEstado(true).then(function (e) { clonEstado = e || {}; if (VE.tab === "clones") veBin(); });
      if (musaClones == null && !clonesCargando) {
        clonesCargando = true; // evita pedidos repetidos mientras carga
        var cargarClones = function () { return api("/api/musa-clon/clones?ws=" + encodeURIComponent(RB.ws)).then(function (x) { clonesCargando = false; musaClones = (x && x.clones) || []; if (VE.tab === "clones") veBin(); }, function () { clonesCargando = false; musaClones = []; }); };
        cargarClones();
        /* trae los clones privados de HeyGen (si la persona conectó su llave) y recarga si hay novedades */
        api("/api/musa-clon/heygen/sync", json("POST", { workspaceId: RB.ws })).then(function (r) { if (r && (r.nuevos || r.actualizados)) cargarClones(); }, function () { /* sin llave de HeyGen */ });
      }
      api("/api/video-takes?workspace_id=" + encodeURIComponent(RB.ws)).then(function (x) {
        var sel = document.getElementById("mbTake"); if (!sel) return;
        var ts = (x && x.takes) || [];
        sel.innerHTML = ts.length ? ts.map(function (t, i) { return '<option value="' + eesc(t.id) + '">Toma ' + (i + 1) + " · " + new Date(t.created_at || t.createdAt || Date.now()).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "</option>"; }).join("") : "<option value=''>No hay tomas vigentes: graba una en Crear › Tomas</option>";
      }, function () {});
    };
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-mbclone]"); if (!b || !VE.open) return;
      e.stopPropagation(); e.preventDefault();
      if (b.dataset.mbclone === "trainmusa") {
        var takeM = (document.getElementById("mbTake") || {}).value, nameM = ((document.getElementById("mbCloneName") || {}).value || "").trim();
        if (!takeM) return vtoast("Elige una toma");
        if (!nameM) return vtoast("Ponle nombre al clon");
        if (!confirm("Confirma que eres la persona de la toma (o que tienes su autorización) para crear este clon con IA.")) return;
        return api("/api/musa-clon/clones", json("POST", { workspaceId: RB.ws, name: nameM, source: "take", takeId: takeM, consent: true })).then(function () {
          musaClones = null; vtoast("Clon creado: Musa lo está preparando y aparece en «Tus clones» cuando esté listo"); veBin();
          if (window.__musaReloadClones) window.__musaReloadClones();
        }, function (err) { vtoast("Clon Musa: " + friendly(err)); });
      }
      if (b.dataset.mbclone === "train") {
        var takeSel = (document.getElementById("mbTake") || {}).value, name = ((document.getElementById("mbCloneName") || {}).value || "").trim();
        if (!takeSel) return vtoast("Elige una toma");
        if (!name) return vtoast("Ponle nombre al clon");
        return api("/api/heygen/avatars/digital-twin", json("POST", { take_id: takeSel, name: name })).then(function () { musaClones = null; vtoast("Entrenamiento enviado a HeyGen: el clon aparece en «Tus clones» cuando termine"); veBin(); }, function (err) { vtoast("Entrenar clon: " + friendly(err)); });
      }
      var av = (document.getElementById("mbAv") || {}).value, sc = ((document.getElementById("mbScript") || {}).value || "").trim(), ar = (document.getElementById("mbAr") || {}).value || "9:16";
      if (!av) return vtoast("Necesitas un clon listo");
      if (!sc) return vtoast("Escribe el guion");
      var cid = av.slice(5), clon = (musaClones || []).find(function (c) { return c.id === cid; }) || {}, cname = clon.name || "Clon", hg = clon.provider === "heygen";
      vtoast(hg ? "HeyGen está generando el video; Musa lo agrega a V1 al terminar" : "Musa está preparando la voz y pone el video en cola…");
      return api("/api/musa-clon/videos", json("POST", { cloneId: cid, script: sc, aspect: ar, title: VE.p.name })).then(function (x) {
        var id = x && x.job && x.job.id; if (!id) throw new Error("no se creó el trabajo");
        return pollUntil(function () { return api("/api/musa-clon/jobs/" + encodeURIComponent(id)); }, function (r) { var j = r && r.job; return j && (j.status === "done" || j.status === "error" || j.status === "cancelled"); }, 10000, 720);
      }).then(function (r) {
        var j = r.job; if (j.status !== "done" || !j.video_url) throw new Error(j.error || (hg ? "HeyGen no pudo generar el video" : "el motor no pudo generar el video"));
        vsnap(); var dur = Number(j.seconds) || 10;
        VE.p.v1.push(take(RB.takeFor(j.video_url, "Clon · " + cname, dur), dur));
        veAll(); vtoast("Video del clon agregado al final de V1");
      }).catch(function (err) { vtoast("Generar con el clon: " + friendly(err)); });
    }, true);
    /* Publicar: graba el reel, lo sube y lo publica en las cuentas que elijas (confirmación previa) */
    var publish = function () {
      var p = VE.p; if (!p || !p._real) return;
      vtoast("Revisando tus cuentas conectadas…");
      RB.mcp("list_social_accounts", { workspaceId: RB.ws }).then(function (r) {
        var acc = [];
        ((r && r.connections) || []).forEach(function (c) { if (c.connected !== false) (c.accounts || []).forEach(function (a) { acc.push(Object.assign({ provider: c.provider }, a)); }); });
        if (!acc.length) { var flat = (r && (r.accounts || r.data)) || []; acc = Array.isArray(flat) ? flat : []; }
        if (!acc.length) throw new Error("no hay cuentas de redes conectadas (Configuración › Integraciones)");
        var list = acc.map(function (x, i) { return (i + 1) + ". " + (x.platform || x.provider || "") + " · " + (x.name || x.username || x.handle || x.id); }).join("\n");
        void list;
        return window.__musaReal.dialog({ title: "¿En qué cuentas publico «" + p.name + "»?", action: "pick-accounts", ok: "Seguir", fields: acc.map(function (x, i) { return { name: "a" + i, type: "checkbox", value: i === 0, label: (x.platform || x.provider || "") + " · " + (x.name || x.username || x.handle || x.id) }; }) })
        .then(function (v) { if (!v) return null; var ids = acc.filter(function (x, i) { return v["a" + i]; }).map(function (x) { return x.id || x.accountId; }).filter(Boolean); if (!ids.length) return null;
        return window.__musaReal.confirmBox("Se va a PUBLICAR de verdad en " + ids.length + " cuenta(s).", { ok: "Publicar ahora" }).then(function (ok) { if (!ok) return null;
        vtoast("Grabando el reel para publicarlo (tiempo real)…");
        return RB.exportReel({ f: "mp4", r: 1080, fps: p.fps }, function () {}).then(function (blob) {
          if (blob.size > 5 * 1024 * 1024) throw new Error("el reel pesa " + (blob.size / 1e6).toFixed(1) + " MB; el límite de subida es 5 MB (baja la resolución en Exportar)");
          return blobToData(blob).then(function (d) { return upload(d, (p.name || "reel") + (/mp4/.test(blob.type) ? ".mp4" : ".webm")); });
        }).then(function (mediaUrl) {
          var id = "cc_" + Math.random().toString(16).slice(2, 18), today = new Date();
          return api("/rest/v1/content_calendar", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ id: id, workspace_id: RB.ws, scheduled_date: today.toISOString().slice(0, 10), scheduled_time: today.toTimeString().slice(0, 8), topic: p.name, kind: "organic", channels: [], status: "aprobación", external_url: mediaUrl }) })
            .then(function () { return RB.mcp("publish_content", { workspaceId: RB.ws, contentId: id, mode: "now", accountIds: ids, contentType: "reel", mediaUrl: mediaUrl }); });
        }).then(function (r) { vtoast("Publicado" + (r && r.status ? " · " + r.status : "")); });
      }); });
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
        .then(function () { RB.vids.unshift({ id: pid, name: name, ratio: fmt, duration_us: 5e6 }); TILES["crear/videos"].unshift([eesc(name), "Sin marca", "0:05"]); Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; }); return RB.openVideo(pid, 0); });
    };
    RB.newVideo = function (fmt) {
      fmt = VFMT[fmt] ? fmt : "9:16";
      return window.__musaReal.promptBox("Nombre del video", "Video nuevo", { title: "Video nuevo", label: "Nombre", ok: "Crear" }).then(function (name) { if (!name) return;
      api("/api/video-projects", json("POST", { workspaceId: RB.ws, name: name, ratio: fmt, canvasW: VFMT[fmt][0], canvasH: VFMT[fmt][1], fps: 30 }))
        .then(function (x) { var pid = x.data.project.id; RB.vids.unshift({ id: pid, name: name, ratio: fmt, duration_us: 0 }); TILES["crear/videos"].unshift([eesc(name), "Sin marca", "0:00"]); Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; }); return RB.openVideo(pid, 0); })
        .catch(function (e) { uiToast("No se pudo crear el video: " + friendly(e)); });
    });
    };
  }

  /* Bandeja: la sugerencia IA se genera solo cuando la persona la pide (antes se disparaba sola al entrar,
     gastando su llave sin preguntar), con su llave (BYOK) */
  var IB_ASK = "Pídele a tu IA una respuesta con la voz de la marca: toca «Sugerir con IA».";
  function ibSuggest(x) {
      if (x && x.db && !x._aiBusy) {
        x._aiBusy = true; x._aiErr = false; x.ai = "Generando sugerencia con tu IA…";
        var last = x.th.filter(function (m) { return !m[2]; }).slice(-3).map(function (m) { return m[0]; }).join(" / ");
        RB.mcp("ai_generate_text", {
          systemPrompt: "Eres el community manager de la marca " + (x.brand || "") + ". Responde en el mismo idioma del mensaje, breve (1-3 frases), cercano y útil, sin hashtags ni comillas. Devuelve SOLO el texto de la respuesta.",
          prompt: "Mensaje de " + x.who + " (" + (IB_TYPE1[x.type] || x.type) + "): " + last,
        }).then(function (r) {
          x.ai = String((r && r.generated) || r || "").trim() || "La IA no devolvió texto.";
          x._aiOk = true;
        }, function (e) { x.ai = "No se pudo generar: " + friendly(e); x._aiBusy = false; x._aiErr = true; })
          .then(function () { x._aiBusy = false; if (/bandeja/.test(location.hash) && IB.sel === x.id && typeof viewInbox === "function") viewInbox(); });
      }
  }
  if (typeof ibDetail === "function") {
    var _ibDetail = ibDetail;
    ibDetail = function () {
      var x = IB_ITEMS.find(function (i) { return i.id === IB.sel; });
      if (x && x.db && !x.ai) x.ai = IB_ASK;
      var r = _ibDetail.apply(this, arguments);
      /* mientras no haya sugerencia lista, el botón la pide (y reintenta si falló) */
      if (x && x.db && !x._aiOk) { var b = document.querySelector('#body [data-iba="useai"]'); if (b) { b.textContent = x._aiBusy ? "Generando…" : x._aiErr ? "Reintentar" : "Sugerir con IA"; b.disabled = !!x._aiBusy; } }
      return r;
    };
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest('[data-iba="useai"]'); if (!b) return;
      var x = IB_ITEMS.find(function (i) { return i.id === IB.sel; });
      if (x && x.db && !x._aiOk) { e.stopPropagation(); e.preventDefault(); ibSuggest(x); if (typeof viewInbox === "function") viewInbox(); }
    }, true);
  }
})();
