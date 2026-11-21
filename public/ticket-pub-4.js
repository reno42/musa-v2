// ticket-pub.js — Motor del ticket animado para la página pública /e/<slug>.
// Versión COMPACTA del "Assembled Pass" adaptada: se monta en un contenedor,
// dibuja la ENTRADA de una persona inscrita (nombre, evento, fecha, sala,
// código QR único real) y corre el loop 9.2s (o still con reduced motion).
// Dibuja con Canvas 2D (nada de DOM tiles) para ser liviano y sin deps.
// API: window.musaTicketPub.mount(el, data) -> { dispose() }
//   data = { event, host, date, place, holder, seat, code, accent }
(function () {
  "use strict";
  var LOOP = 9.2, T0 = 2.2, T_OUT = 7.2;
  var W = 420, H = 588, COLS = 5, ROWS = 7, TS = 84, NOTCH_Y = 420;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function eo(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 3); }
  function eo5(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 5); }
  function ei(x) { return Math.pow(clamp(x, 0, 1), 3); }
  function eio(x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function bump(x, w) { return Math.exp(-Math.pow(x / w, 2)); }
  function rng(seed) { var s = seed; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // tiles con salida seeded (seed 7), igual que el spec
  var R = rng(7), TILES = [];
  for (var r = 0; r < ROWS; r++)
    for (var c = 0; c < COLS; c++) {
      var tcx = c * TS + TS / 2 - W / 2, tcy = r * TS + TS / 2 - H / 2, dist = Math.hypot(tcx, tcy);
      var ang = Math.atan2(tcy, tcx) + (R() - 0.5) * 1.2, far = 420 + R() * 360;
      TILES.push({ x: c * TS, y: r * TS,
        sx: Math.cos(ang) * far, sy: Math.sin(ang) * far, sz: -500 + R() * 900,
        rot: (R() - 0.5) * 60, din: 0.1 + (dist / 360) * 0.9 + R() * 0.18,
        dout: (1 - dist / 360) * 0.35 + R() * 0.16,
        wave: (c * TS + r * TS) / (W + H) });
    }

  // barcode REAL Code 39 (cada char = 9 barras: 5 barras + 4 espacios, 3 anchas)
  var C39 = {
    "0":"nnnwwnwnn","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw",
    "5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn",
    "A":"wnnnnwnnw","B":"nnwnnwnnw","C":"wnwnnwnnn","D":"nnnnwwnnw","E":"wnnnwwnnn",
    "F":"nnwnwwnnn","G":"nnnnnwwnw","H":"wnnnnwwnn","I":"nnwnnwwnn","J":"nnnnwwwnn",
    "K":"wnnnnnnww","L":"nnwnnnnww","M":"wnwnnnnwn","N":"nnnnwnnww","O":"wnnnwnnwn",
    "P":"nnwnwnnwn","Q":"nnnnnnwww","R":"wnnnnnwwn","S":"nnwnnnwwn","T":"nnnnwwnwn",
    "U":"wwnnnnnnw","V":"nwwnnnnnw","W":"wwwnnnnnn","X":"nwnnwnnnw","Y":"wwnnwnnnn",
    "Z":"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn","*":"nwnnwnwnn"
  };
  function code39Bars(text) {
    var t = ("*" + String(text).toUpperCase().replace(/[^0-9A-Z\-\. ]/g, "") + "*"), bars = [], x = 0;
    for (var i = 0; i < t.length; i++) {
      var pat = C39[t[i]];
      if (!pat) continue;
      for (var j = 0; j < 9; j++) {
        var w = pat[j] === "w" ? 3 : 1;
        if (j % 2 === 0) bars.push({ x: x, w: w }); // barras en posiciones pares
        x += w;
      }
      x += 1; // gap entre caracteres
    }
    return { bars: bars, width: x };
  }

  // glifo 5x7 (0-9 A B C y caracteres extra mínimos para nombres)
  var FONT = {
    "0": ["01110","10001","10011","10101","11001","10001","01110"],
    "1": ["00100","01100","00100","00100","00100","00100","01110"],
    "2": ["01110","10001","00001","00010","00100","01000","11111"],
    "3": ["11110","00001","00001","01110","00001","00001","11110"],
    "4": ["00010","00110","01010","10010","11111","00010","00010"],
    "5": ["11111","10000","11110","00001","00001","10001","01110"],
    "6": ["01110","10000","11110","10001","10001","10001","01110"],
    "7": ["11111","00001","00010","00100","01000","01000","01000"],
    "8": ["01110","10001","10001","01110","10001","10001","01110"],
    "9": ["01110","10001","10001","01111","00001","00010","01100"],
    A: ["01110","10001","10001","11111","10001","10001","10001"],
    B: ["11110","10001","10001","11110","10001","10001","11110"],
    C: ["01110","10001","10000","10000","10000","10001","01110"],
    D: ["11110","10001","10001","10001","10001","10001","11110"],
    E: ["11111","10000","10000","11110","10000","10000","11111"],
    F: ["11111","10000","10000","11110","10000","10000","10000"],
    G: ["01110","10000","10000","10111","10001","10001","01110"],
    H: ["10001","10001","10001","11111","10001","10001","10001"],
    I: ["01110","00100","00100","00100","00100","00100","01110"],
    J: ["00111","00010","00010","00010","00010","10010","01100"],
    K: ["10001","10010","10100","11000","10100","10010","10001"],
    L: ["10000","10000","10000","10000","10000","10000","11111"],
    M: ["10001","11011","10101","10101","10001","10001","10001"],
    N: ["10001","11001","10101","10011","10001","10001","10001"],
    O: ["01110","10001","10001","10001","10001","10001","01110"],
    P: ["11110","10001","10001","11110","10000","10000","10000"],
    Q: ["01110","10001","10001","10001","10101","10011","01111"],
    R: ["11110","10001","10001","11110","10100","10010","10001"],
    S: ["01111","10000","10000","01110","00001","00001","11110"],
    T: ["11111","00100","00100","00100","00100","00100","00100"],
    U: ["10001","10001","10001","10001","10001","10001","01110"],
    V: ["10001","10001","10001","10001","10001","01010","00100"],
    W: ["10001","10001","10001","10101","10101","11011","10001"],
    X: ["10001","10001","01010","00100","01010","10001","10001"],
    Y: ["10001","10001","01010","00100","00100","00100","00100"],
    Z: ["11111","00001","00010","00100","01000","10000","11111"],
    " ": ["00000","00000","00000","00000","00000","00000","00000"],
    "·": ["00000","00000","00000","01110","01110","00000","00000"]
  };

  function drawGlyph(ctx, ch, x, y, pitch, dotR, scaleK) {
    var rows = FONT[ch] || FONT[ch.toUpperCase()] || FONT[" "];
    ctx.fillStyle = ctx.__ink;
    for (var rr = 0; rr < 7; rr++)
      for (var cc = 0; cc < 5; cc++)
        if (rows[rr][cc] === "1") {
          ctx.beginPath();
          ctx.arc(x + PITCH_HALF(cc, pitch), y + pitch / 2 + rr * pitch, dotR, 0, 6.2832);
          ctx.fill();
        }
    function PITCH_HALF() { return pitch / 2; }
  }

  // matríz QR REAL con la lib de Musa (QRCodeLib = node-qrcode): escaneable
  function realQr(text) {
    try {
      var L = window.QRCodeLib;
      if (!L || !L.create) return null;
      var r = L.create(text, { errorCorrectionLevel: "M" });
      var n = r.modules.size, out = [];
      for (var y = 0; y < n; y++) { out[y] = []; for (var x = 0; x < n; x++) out[y][x] = r.modules.data[y * n + x] ? 1 : 0; }
      // sin finders "null": la matriz real ya trae sus finders integrados
      return out;
    } catch (e) { return null; }
  }
  // matríz decorativa (solo si la lib no cargó)
  function qrMatrix(code) {
    var h = 0, i;
    for (i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    var R4 = rng(h || 1), m = [];
    for (var y = 0; y < 21; y++) { m[y] = []; for (var x = 0; x < 21; x++) {
      var inF = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      m[y][x] = inF ? null : (R4() < 0.48 ? 1 : 0);
    } }
    // finders: ring 7x7 + dot interior
    [[0, 0], [14, 0], [0, 14]].forEach(function (f) {
      for (var yy = 0; yy < 7; yy++) for (var xx = 0; xx < 7; xx++) {
        var edge = yy === 0 || yy === 6 || xx === 0 || xx === 6;
        m[f[1] + yy][f[0] + xx] = edge ? 1 : (yy >= 2 && yy <= 4 && xx >= 2 && xx <= 4 ? 1 : 0);
      }
    });
    return m;
  }

  function mount(el, data) {
    var cv = document.createElement("canvas");
    cv.width = 420; cv.height = 588;
    cv.style.cssText = "width:100%;height:auto;display:block;transform:rotate(-1.2deg)";
    el.appendChild(cv);
    var ctx = cv.getContext("2d");
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 420 * dpr; cv.height = 588 * dpr; ctx.scale(dpr, dpr);

    var accent = data.accent || "#ff5e00";
    var qr = (data.qrText && realQr(data.qrText)) || qrMatrix(data.code || data.holder || "MUSA");
    var qrReal = !!(data.qrText && window.QRCodeLib && window.QRCodeLib.create);

    function colors() {
      var dark = (document.body.getAttribute("data-tk") || document.documentElement.getAttribute("data-tk")) === "dark";
      return dark
        ? { ground: "#070707", card: "#111111", ink: "#ffffff", faint: "#7d7d7d", grid: "#2e2e2e", shadow: "rgba(0,0,0,.5)", ghost: "#1f1f1f" }
        : { ground: "#f4f3ea", card: "#ffffff", ink: "#111111", faint: "#6b6b6b", grid: "#d6d4c6", shadow: "rgba(20,20,30,.16)", ghost: "#e9e8dd" };
    }

    var disposed = false, raf = 0, t0 = 0;

    function drawCard(t) {
      var C = colors();
      ctx.__ink = C.ink;
      ctx.clearRect(0, 0, W, H);
      ctx.save();

      // tiles que vuelan (fase 1) o card sólida (fase 2) o tiles que salen (fase 3)
      var solid = t >= T0 && t < T_OUT;
      var tilt = Math.sin((t - 1.2) * 0.9) * 4 * clamp((t - 1.2) / 1.2, 0, 1);
      ctx.translate(W / 2, H / 2);
      ctx.rotate(tilt * Math.PI / 180);
      ctx.translate(-W / 2, -H / 2);

      // floor shadow
      ctx.save();
      ctx.globalAlpha = clamp(t < T_OUT ? eo((t - 0.6) / 1.4) : 1 - eo((t - T_OUT) / 0.8), 0, 1);
      ctx.filter = "blur(10px)";
      ctx.fillStyle = C.shadow;
      ctx.beginPath(); ctx.ellipse(W / 2 + 10, H + 36, 150, 16, 0, 0, 6.2832); ctx.fill();
      ctx.filter = "none";
      ctx.restore();

      // helper: dibujar el CONTENIDO del ticket en un rect (para tiles y card)
      function drawContent(clipX, clipY, clipW, clipH, offX, offY) {
        ctx.save();
        ctx.beginPath(); ctx.rect(clipX, clipY, clipW, clipH); ctx.clip();
        ctx.translate(-offX, -offY);
        ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, H);
        var c = t - T0;
        var co = clamp((t - T_OUT + 0.4) / 0.35, 0, 1); co = 1 - co;
        // header: marca + evento | ADMIT ONE
        var hk = eo(c / 0.5);
        ctx.save();
        ctx.globalAlpha = clamp(hk * 3, 0, 1) * co;
        ctx.translate(0, (1 - hk) * 26);
        ctx.fillStyle = accent; roundRect(ctx, 32, 33, 22, 22, 7); ctx.fill();
        ctx.fillStyle = C.card; ctx.beginPath(); ctx.arc(43, 44, 5, 0, 6.2832); ctx.fill();
        ctx.fillStyle = C.ink; ctx.font = "500 16px Inter, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(trunc(ctx, data.event, 220), 62, 44);
        // badge admit
        ctx.fillStyle = ""; var badge = "Admit one";
        var bw = ctx.measureText(badge).width + 30;
        ctx.fillStyle = hexA(accent, 0.14); roundRect(ctx, W - 32 - bw, 32, bw, 24, 12); ctx.fill();
        ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(W - 32 - bw + 13, 44, 3, 0, 6.2832); ctx.fill();
        ctx.fillStyle = ""; ctx.fillStyle = "";
        ctx.fillStyle = "#c23e1c";
        ctx.fillText(badge, W - 32 - bw + 24, 44);
        ctx.restore();

        // label ENTRADA
        var sk = eo((c - 0.25) / 0.4);
        ctx.save(); ctx.globalAlpha = clamp(sk * 3, 0, 1) * co;
        ctx.translate(0, (1 - sk) * 16);
        ctx.fillStyle = C.faint; ctx.font = "400 12px Inter, sans-serif";
        ctx.fillText(data.seatLabel || "Entrada", 32, 122);
        ctx.restore();

        // nombre del holder en dots (rodillo: 2 lecturas, sube)
        var S = { at: 0.3, stagger: 0.09, time: 1.1, roll: 150 };
        var holder = String(data.holder || "").toUpperCase().slice(0, 12);
        var chars = holder.split("");
        var pitch = Math.min(18, 340 / Math.max(chars.length, 6));
        var dotR = pitch * 0.36;
        var totalW = chars.length * pitch;
        var startX = (W - totalW) / 2;
        // grid de puntos fantasma detrás del asiento
        ctx.fillStyle = C.grid;
        for (var gy = 0; gy < 7; gy++) for (var gx = 0; gx < 20; gx++) {
          ctx.beginPath(); ctx.arc(32 + 9 + gx * 18, 156 + 9 + gy * 18, 2.2, 0, 6.2832); ctx.fill();
        }

        ctx.save();
        ctx.beginPath(); ctx.rect(24, 132, W - 48, 148); ctx.clip();
        chars.forEach(function (ch, i) {
          var k = eio((c - S.at - i * S.stagger) / S.time);
          if (k <= 0) return;
          ctx.save();
          ctx.globalAlpha = clamp((c - S.at) * 4, 0, 1) * co;
          var blur = Math.sin(k * Math.PI) * 1.5;
          ctx.filter = blur > 0.2 ? "blur(" + blur.toFixed(1) + "px)" : "none";
          drawGlyphAt(ctx, ch, startX + i * pitch, 152 + 8 - k * 24, pitch, dotR);
          ctx.filter = "none";
          ctx.restore();
        });
        ctx.restore();

        // datos (3 columnas)
        var D = { at: 0.9, stagger: 0.08, time: 0.5 };
        (data.details || []).forEach(function (d, i) {
          var k = eo((c - D.at - i * D.stagger) / D.time);
          ctx.save();
          ctx.globalAlpha = k * co;
          ctx.translate(0, (1 - k) * 12);
          ctx.fillStyle = C.faint; ctx.font = "400 12px Inter, sans-serif";
          ctx.fillText(d.label, 32 + i * 132, 330);
          ctx.fillStyle = C.ink; ctx.font = "500 14px Inter, sans-serif";
          ctx.fillText(trunc(ctx, d.value, 120), 32 + i * 132, 348);
          ctx.restore();
        });

        // perforación
        var pk = eo((c - 1.1) / 0.7);
        ctx.save(); ctx.globalAlpha = co;
        ctx.strokeStyle = C.faint; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]);
        ctx.beginPath();
        var perfW = 372 * pk;
        ctx.moveTo(24, 419); ctx.lineTo(24 + perfW, 419);
        ctx.stroke(); ctx.setLineDash([]); ctx.restore();

        // stub: doors + código
        var dk = eo((c - 1.25) / 0.4);
        ctx.save(); ctx.globalAlpha = clamp(dk * 3, 0, 1) * co;
        ctx.translate(0, (1 - dk) * 16);
        ctx.fillStyle = C.faint; ctx.font = "400 12px Inter, sans-serif";
        ctx.fillText(data.doorsLabel || "Empieza", 32, 458);
        ctx.fillStyle = C.ink; ctx.font = "500 17px Inter, sans-serif";
        ctx.fillText(trunc(ctx, data.doorsValue || "", 230), 32, 482);
        ctx.restore();

        // barcode REAL Code 39 del código de entrada — crece barra por barra
        if (!drawContent.__c39 || drawContent.__c39src !== (data.code || "")) {
          drawContent.__c39 = code39Bars(data.code || "MUSA");
          drawContent.__c39src = data.code || "";
        }
        var c39 = drawContent.__c39, sc39 = 200 / c39.width;
        c39.bars.forEach(function (b, i) {
          var k = eo((c - 1.45 - i * 0.006) / 0.25);
          ctx.save(); ctx.globalAlpha = k * co;
          ctx.fillStyle = C.ink;
          var hh = 32 * k;
          ctx.fillRect(32 + b.x * sc39, 520 + (32 - hh), Math.max(1, b.w * sc39), hh);
          ctx.restore();
        });

        // QR real (matríz del código del inscrito) — módulos pop desde el centro
        var qn = qr.length, cell = Math.min(6, Math.floor(126 / qn)) || 4, qx0 = 388 - qn * cell, qy0 = 441;
        for (var yy2 = 0; yy2 < qn; yy2++) for (var xx2 = 0; xx2 < qn; xx2++) {
          var v = qr[yy2][xx2];
          if (v === null) continue;
          var dist2 = Math.hypot(xx2 - 10, yy2 - 10);
          var kk = eo((c - 1.6 - dist2 * 0.05) / 0.3);
          if (kk <= 0) continue;
          ctx.save(); ctx.globalAlpha = kk * co;
          var cx2 = qx0 + xx2 * cell + cell / 2, cy2 = qy0 + yy2 * cell + cell / 2;
          if (v) {
            // módulo oscuro: radio final 0.42*cell (escaneable), crece con el pop
            ctx.fillStyle = C.ink;
            ctx.beginPath(); ctx.arc(cx2, cy2, cell * 0.42 * kk, 0, 6.2832); ctx.fill();
          } else if (qrReal) {
            // módulo claro del QR REAL: punto fantasma sutil (NO interfiere: queda bajo el umbral del lector)
            ctx.fillStyle = hexA(C.ink, 0.10);
            ctx.beginPath(); ctx.arc(cx2, cy2, cell * 0.10 * kk, 0, 6.2832); ctx.fill();
          } else {
            ctx.fillStyle = hexA(C.ink, 0.13);
            ctx.beginPath(); ctx.arc(cx2, cy2, 1.1 * kk, 0, 6.2832); ctx.fill();
          }
          ctx.restore();
        }
        ctx.restore(); // clip
      }

      // FASES
      if (solid) {
        // card entera con notches
        drawCardShape(ctx, C, W, H);
        drawContent(0, 0, W, H, 0, 0);
        // sheen
        var H2 = { first: 2.5, second: 4.6, time: 1.1, end: 1.2, from: -0.6 };
        var sw = (t - T0 - H2.first) / H2.time, sw2 = (t - T0 - H2.second) / H2.time;
        var sv = sw < H2.end ? sw : sw2;
        if (sv > 0 && sv < H2.end) {
          ctx.save();
          roundCardPath(ctx, W, H); ctx.clip();
          var sx = (H2.from + clamp(sv, 0, H2.end)) * W;
          var g = ctx.createLinearGradient(sx - 120, 0, sx + 120, H);
          g.addColorStop(0, "rgba(255,94,0,0)"); g.addColorStop(0.5, "rgba(255,94,0,.14)"); g.addColorStop(1, "rgba(255,94,0,0)");
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      } else {
        // tiles
        TILES.forEach(function (o) {
          var k;
          if (t < T_OUT) k = eo5((t - o.din) / 1.0);
          else k = 1 - ei((t - T_OUT - o.dout) / 0.9);
          if (k <= 0.01) return;
          var q = 1 - k;
          var fl = bump(t - (o.din + 0.62), 0.09) * 0.55;
          var wv = bump(t - (1.62 + o.wave * 0.5), 0.07) * 0.35;
          var lit = clamp(fl + wv, 0, 1);
          ctx.save();
          ctx.globalAlpha = clamp(k * 2.2, 0, 1);
          ctx.translate(o.x + TS / 2 + o.sx * q, o.y + TS / 2 + o.sy * q - o.sz * q * 0.2);
          ctx.rotate(o.rot * q * Math.PI / 180);
          var sc = 0.96 + 0.04 * k;
          ctx.scale(sc, sc);
          ctx.translate(-TS / 2, -TS / 2);
          // tile = slice del contenido (dibuja el ticket desplazado y recorta el tile)
          drawContent(o.x, o.y, TS, TS, o.x, o.y);
          if (lit > 0.01) { ctx.fillStyle = hexA(accent, lit * 0.45); ctx.fillRect(0, 0, TS, TS); }
          ctx.restore();
        });
      }

      ctx.restore();
    }

    function drawGlyphAt(ctx2, ch, x, y, pitch, dotR) {
      var rows = FONT[ch] || FONT[ch.toUpperCase()] || FONT[" "];
      ctx2.fillStyle = ctx2.__ink || "#111";
      for (var rr = 0; rr < 7; rr++) for (var cc = 0; cc < 5; cc++)
        if (rows[rr][cc] === "1") {
          ctx2.beginPath();
          ctx2.arc(x + pitch / 2 + cc * pitch, y + pitch / 2 + rr * pitch, dotR, 0, 6.2832);
          ctx2.fill();
        }
    }
    function randGhost(code, i) {
      var pool = "0123456789ABCDEF";
      var h = 0; var s2 = String(code || "") + i;
      for (var j = 0; j < s2.length; j++) h = (h * 33 + s2.charCodeAt(j)) >>> 0;
      return pool[h % pool.length];
    }
    function trunc(ctx2, s, w) {
      // SIN puntos suspensivos: reduce el tamaño hasta que quepa el texto completo
      s = String(s || "");
      if (ctx2.measureText(s).width <= w) return s;
      var size = parseInt(ctx2.font, 10) || 14;
      while (size > 8 && ctx2.measureText(s).width > w) {
        size--;
        ctx2.font = ctx2.font.replace(/\d+px/, size + "px");
      }
      return s;
    }
    function hexA(hex, a) {
      var m = hex.replace("#", "");
      if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
      var n = parseInt(m, 16);
      return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
    }
    function roundRect(ctx2, x, y, w, h, r) {
      ctx2.beginPath();
      ctx2.moveTo(x + r, y);
      ctx2.arcTo(x + w, y, x + w, y + h, r);
      ctx2.arcTo(x + w, y + h, x, y + h, r);
      ctx2.arcTo(x, y + h, x, y, r);
      ctx2.arcTo(x, y, x + w, y, r);
      ctx2.closePath();
    }
    function drawCardShape(ctx2, C, w, h) {
      // sombra por fuera + card con notches
      ctx2.save();
      roundCardPath(ctx2, w, h);
      ctx2.fillStyle = C.card; ctx2.fill();
      ctx2.restore();
    }
    function roundCardPath(ctx2, w, h) {
      var r = 20, ny = NOTCH_Y, nr = 15;
      ctx2.beginPath();
      ctx2.moveTo(r, 0);
      ctx2.lineTo(w - r, 0); ctx2.arcTo(w, 0, w, r, r);
      ctx2.lineTo(w, ny - nr);
      ctx2.arc(w, ny, nr, -Math.PI / 2, Math.PI / 2, true);
      ctx2.lineTo(w - r, h); ctx2.arcTo(w, h, w - r, h - 0, r);
      ctx2.lineTo(r, h); ctx2.arcTo(0, h, 0, h - r, r);
      ctx2.lineTo(0, ny + nr);
      ctx2.arc(0, ny, nr, Math.PI / 2, -Math.PI / 2, true);
      ctx2.lineTo(r, 0);
      ctx2.closePath();
    }

    function tick() {
      if (disposed) return;
      var t = (performance.now() - t0) / 1000;
      // se arma una sola vez y queda: clamp en la fase sólida completa (sin rotura)
      drawCard(Math.min(t, T0 + 3.2));
      raf = requestAnimationFrame(tick);
    }
    return {
      dispose: function () { disposed = true; cancelAnimationFrame(raf); if (cv.parentNode) cv.parentNode.removeChild(cv); },
      start: function () {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { drawCard(6.4); return; }
        t0 = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
  }

  window.musaTicketPub = { mount: mount };
})();
