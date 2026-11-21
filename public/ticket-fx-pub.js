/* ticket-fx.js — El ticket de evento que se ARMA en tiles y se ROMPE (adaptado del
 * "Assembled Pass" al módulo de eventos de Musa, vanilla JS sin React).
 *
 * Loop de 9.2 s: 35 tiles (5 × 7) vuelan hacia su lugar, se bloquean, el contenido
 * sube línea por línea (header, asiento en rodillos de puntos, datos, perforación,
 * stub con código de barras y QR de puntos), un destello de luz cruza el ticket y
 * a los 7.2 s se rompe en tiles que vuelan away. El plazo se repite en loop.
 *
 * Musa-ismo: colores del tema (root[data-theme="light"|"dark"]), acento
 * --accent (#ff5e00), tipografía Inter/Anton ya cargadas, borde chueco punk
 * (rotación leve + sombra dura) y notches de ticket en los lados.
 * Reduced motion: dibuja un still armado, sin loop.
 *
 * API: window.musaTicketFX.mount(container, data) → { dispose() }
 *   data = { event, admit, seat, details:[{label,value}×3], doorsLabel, doorsValue }
 */
(function () {
  "use strict";

  /* ── constantes del spec ── */
  var LOOP = 9.2, T0 = 2.2, T_OUT = 7.2, STILL_AT = 6.4;
  var PW = 420, PH = 588, COLS = 5, ROWS = 7, TS = 84, RADIUS = 20, NOTCH_Y = 420;

  /* easing */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function eo(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 3); }
  function eo5(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 5); }
  function ei(x) { return Math.pow(clamp(x, 0, 1), 3); }
  function eio(x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function bump(x, w) { return Math.exp(-Math.pow(x / w, 2)); }
  function rng(seed) { var s = seed; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* ── motion numbers (del spec) ── */
  var TILE = { seed: 7, angleJitter: 1.2, distance: 420, distanceJitter: 360, depth: -500, depthJitter: 900,
    turnX: 200, turnY: 240, turnZ: 120, inStart: 0.1, inSpread: 0.9, inJitter: 0.18, spreadRadius: 360,
    inTime: 1.0, outSpread: 0.35, outJitter: 0.16, outTime: 0.9, fadeGain: 2.2, flashAt: 0.62,
    flashWidth: 0.09, flashGain: 0.55, waveAt: 1.62, waveSpan: 0.5, waveWidth: 0.07, waveGain: 0.35,
    blur: 6, scaleFrom: 0.96, scaleGain: 0.04 };
  var FLOOR = { fadeAt: 0.6, fadeIn: 1.4, fadeOut: 0.8, shift: 3, squash: 60 };
  var TILT = { at: 1.2, rampIn: 1.2, outDelay: 0.6, rampOut: 0.8, yawRate: 0.9, yaw: 7, pitchRate: 0.7, pitch: 4, pitchBias: 2 };
  var CONTENT_OUT = { lead: 0.4, time: 0.35 };
  var REVEAL = { rise: 110, fadeGain: 3 };
  var M = { HEADER: { time: 0.5 }, SEAT_LABEL: { at: 0.25, time: 0.4 },
    REELS: { at: 0.25, stagger: 0.07, time: 0.8, roll: 300, fadeGain: 4, blur: 2.4 },
    DETAILS: { at: 0.7, stagger: 0.06, time: 0.4, rise: 12 }, PERF: { at: 0.85, time: 0.5 },
    DOORS_LABEL: { at: 0.95, time: 0.3 }, DOORS_VALUE: { at: 1.05, time: 0.35 },
    BARS: { at: 1.15, stagger: 0.01, time: 0.25, rise: 32 },
    FINDERS: { at: 1.1, stagger: 0.06, time: 0.35, scaleFrom: 0.4, scaleGain: 0.6, turn: -90 },
    MODULES: { at: 1.3, perCell: 0.04, time: 0.25 },
    SHEEN: { first: 2.5, second: 4.6, time: 1.1, end: 1.2, from: -0.6 } };

  /* ── tiles (seed fija, orden fijo) ── */
  var R = rng(TILE.seed), radius = RADIUS + "px",
    notchRows = [Math.floor(NOTCH_Y / TS) - 1, Math.floor(NOTCH_Y / TS)];
  var TILES = [];
  for (var r = 0; r < ROWS; r++)
    for (var c = 0; c < COLS; c++) {
      var st = { left: c * TS + "px", top: r * TS + "px", backgroundPosition: (-c * TS) + "px " + (-r * TS) + "px" };
      if (r === 0 && c === 0) st.borderTopLeftRadius = radius;
      if (r === 0 && c === COLS - 1) st.borderTopRightRadius = radius;
      if (r === ROWS - 1 && c === 0) st.borderBottomLeftRadius = radius;
      if (r === ROWS - 1 && c === COLS - 1) st.borderBottomRightRadius = radius;
      if (notchRows.indexOf(r) >= 0 && (c === 0 || c === COLS - 1)) {
        var cx = c === 0 ? 0 : TS, cy = NOTCH_Y - r * TS;
        var m = "radial-gradient(circle at " + cx + "px " + cy + "px,transparent 14px,#000 15px)";
        st.WebkitMask = m; st.mask = m;
      }
      var tcx = c * TS + TS / 2 - PW / 2, tcy = r * TS + TS / 2 - PH / 2, dist = Math.hypot(tcx, tcy);
      var ang = Math.atan2(tcy, tcx) + (R() - 0.5) * TILE.angleJitter, far = TILE.distance + R() * TILE.distanceJitter;
      TILES.push({ style: st, sx: Math.cos(ang) * far, sy: Math.sin(ang) * far, sz: TILE.depth + R() * TILE.depthJitter,
        rx: (R() - 0.5) * TILE.turnX, ry: (R() - 0.5) * TILE.turnY, rz: (R() - 0.5) * TILE.turnZ,
        din: TILE.inStart + (dist / TILE.spreadRadius) * TILE.inSpread + R() * TILE.inJitter,
        dout: (1 - dist / TILE.spreadRadius) * TILE.outSpread + R() * TILE.outJitter,
        wave: (c * TS + r * TS) / (PW + PH) });
    }

  /* ── barcode + QR decorativos (seeds 21 / 99) ── */
  var BARS = [];
  { var R2 = rng(21), x = 0, BW = [2, 2, 4, 2, 6], BG = [2, 4, 2, 6];
    while (x < 200) { var w = BW[Math.floor(R2() * BW.length)]; BARS.push({ x: x, w: w }); x += w + BG[Math.floor(R2() * BG.length)]; } }
  var MODULES = [];
  { var R3 = rng(99), MID = 10;
    for (var qy = 0; qy < 21; qy++) for (var qx = 0; qx < 21; qx++) {
      if ((qx < 8 && qy < 8) || (qx > 12 && qy < 8) || (qx < 8 && qy > 12)) continue;
      if (R3() < 0.5) MODULES.push({ x: qx * 6, y: qy * 6, d: Math.hypot(qx - MID, qy - MID) });
    } }
  var FINDERS = [[0, 0], [90, 0], [0, 90]];

  /* ── glifo 5×7 en puntos (0 1 2 4 9 A B C) ── */
  var FONT = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"]
  };
  function glyphSVG(ch) {
    var rows = FONT[ch] || [], PITCH = 18, DOT = 6.6, out = "";
    rows.forEach(function (row, rr) {
      for (var cc = 0; cc < 5; cc++)
        if (row[cc] === "1") out += '<circle cx="' + (PITCH / 2 + cc * PITCH) + '" cy="' + (PITCH / 2 + rr * PITCH) + '" r="' + DOT + '"/>';
    });
    return '<svg viewBox="0 0 90 126" style="display:block;margin-left:6px;padding-top:12px;width:90px;height:138px;fill:currentColor;overflow:visible;box-sizing:border-box">' + out + "</svg>";
  }

  /* ── CSS del componente (inyectado una vez) ── */
  var CSS = [
    ".tkfx{position:fixed;inset:0;overflow:hidden;z-index:1;font-family:Inter,sans-serif}",
    ".tkfx-ground{position:absolute;inset:0;background:radial-gradient(46% 40% at 73% 60%,var(--tk-hot-glow,rgba(255,94,0,.22)),transparent 70%),radial-gradient(60% 50% at 20% 8%,var(--tk-light,rgba(255,255,255,.85)),transparent 70%),var(--tk-ground,#e9e9eb)}",
    ".tkfx-grain{position:absolute;inset:0;pointer-events:none;opacity:.06;mix-blend-mode:overlay;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.7 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")}",
    ".tkfx-stage{position:absolute;left:50%;top:50%;width:1080px;height:1080px;transform:translate(-50%,-50%) scale(var(--tkscale,1))}",
    ".tkfx-camera{position:absolute;inset:0;perspective:1800px;perspective-origin:50% 46%}",
    ".tkfx-rig{position:absolute;left:330px;top:246px;width:420px;height:588px;transform-style:preserve-3d}",
    ".tkfx-floor{position:absolute;left:340px;top:860px;width:400px;height:60px;border-radius:50%;background:var(--tk-shadow,rgba(20,20,30,.2));filter:blur(28px)}",
    ".tkfx-tile{position:absolute;width:84px;height:84px;background:var(--tk-pass-fill) var(--tk-pass-ground);background-size:420px 588px;will-change:transform,opacity,filter;backface-visibility:hidden}",
    ".tkfx-card{position:absolute;inset:0;filter:var(--tk-pass-shadow)}",
    ".tkfx-face{position:absolute;inset:0;border-radius:20px;overflow:hidden;background:var(--tk-pass-fill) var(--tk-pass-ground);-webkit-mask:var(--tk-pass-mask);mask:var(--tk-pass-mask);color:var(--tk-text);transform:rotate(-1.2deg)}",
    ".tkfx-mono{font-family:Inter,sans-serif;font-size:12px;line-height:14px;font-weight:400;letter-spacing:0;color:var(--tk-faint)}",
    ".tkfx-clip{position:absolute;overflow:hidden}",
    /* header */
    ".tkfx-header{left:32px;top:32px;right:32px;height:28px}.tkfx-hrow{position:absolute;left:0;top:0;right:0;display:flex;align-items:center;justify-content:space-between}",
    ".tkfx-mark{display:flex;align-items:center;gap:10px;color:var(--tk-text);font-size:16px;font-weight:500;letter-spacing:-0.2px;max-width:250px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}",
    ".tkfx-micon{width:22px;height:22px;border-radius:7px;background:var(--tk-accent,#ff5e00);position:relative;flex:none}",
    ".tkfx-micon::after{content:\"\";position:absolute;left:6px;top:6px;width:10px;height:10px;border-radius:5px;background:var(--tk-pass-ground)}",
    ".tkfx-admit{height:24px;border-radius:12px;padding:0 10px;display:flex;align-items:center;gap:7px;background:var(--tk-hot-tint);color:var(--tk-hot-ink);font-weight:500}",
    ".tkfx-admit::before{content:\"\";box-sizing:border-box;width:6px;height:6px;border-radius:50%;background:var(--tk-accent,#ff5e00)}",
    /* seat */
    ".tkfx-seatlabel{left:32px;top:116px}",
    ".tkfx-seat{left:26px;top:132px;height:150px;width:380px}",
    ".tkfx-reel{position:absolute;top:0;width:112px;white-space:nowrap;font-size:0;line-height:0;color:var(--tk-text)}",
    ".tkfx-gline{height:150px}",
    /* facts */
    ".tkfx-detail{position:absolute;top:322px;width:120px}",
    ".tkfx-dvalue{font-size:14px;font-weight:500;color:var(--tk-text);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    /* perforation + stub */
    ".tkfx-perf{position:absolute;left:24px;top:419px;width:372px;height:2px}",
    ".tkfx-doorslabel{left:32px;top:452px}",
    ".tkfx-doorsvalue{left:32px;top:476px;font-size:18px;font-weight:500;color:var(--tk-text);letter-spacing:-0.2px;white-space:nowrap;max-width:210px;overflow:hidden;text-overflow:ellipsis}",
    ".tkfx-bars{position:absolute;left:32px;top:520px;width:200px;height:32px}.tkfx-bar{fill:var(--tk-text)}",
    ".tkfx-qr{position:absolute;left:262px;top:441px;width:126px;height:126px}",
    ".tkfx-mod{position:absolute;width:6px;height:6px;border-radius:50%;background:var(--tk-text);box-shadow:0 0 0 0.4px var(--tk-pass-ground) inset}",
    ".tkfx-finder{position:absolute;width:42px;height:42px;border-radius:12px;border:6px solid var(--tk-text)}",
    ".tkfx-finder::after{content:\"\";position:absolute;left:6px;top:6px;width:18px;height:18px;border-radius:50%;background:var(--tk-accent,#ff5e00)}",
    ".tkfx-sheen{position:absolute;mix-blend-mode:screen;inset:-40%;background:linear-gradient(105deg,transparent 40%,rgba(255,94,0,.16) 47%,rgba(255,94,0,.06) 53%,transparent 60%);pointer-events:none}",
    /* dark / light: los tokens del tema de Musa */
    ":root{--tk-ground:#e9e9eb;--tk-light:rgba(255,255,255,.85);--tk-hot-glow:rgba(255,94,0,.22);--tk-shadow:rgba(20,20,30,.2);--tk-pass-ground:#ffffff;--tk-text:#111111;--tk-faint:#8e8e93;--tk-hot-tint:#fff0eb;--tk-hot-ink:#c23e1c;--tk-pass-shadow:drop-shadow(0 1px 1px rgba(20,20,30,.05)) drop-shadow(0 10px 14px rgba(20,20,30,.08));",
    "--tk-pass-fill:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='588'%3E%3Cdefs%3E%3Cpattern id='s' x='32' y='144' width='18' height='18' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='9' cy='9' r='2.2' fill='%23e4e4e8'/%3E%3C/pattern%3E%3Cpattern id='q' x='262' y='441' width='6' height='6' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='3' cy='3' r='.9' fill='%23dcdce0'/%3E%3C/pattern%3E%3C/defs%3E%3Crect x='32' y='144' width='360' height='126' fill='url(%23s)'/%3E%3Cpath d='M310 441h30v48h48v30h-78zM262 489h48v30h-48zM310 519h78v48h-78z' fill='url(%23q)'/%3E%3Cg fill='none' stroke='%23111' stroke-opacity='.26' stroke-width='1.3' stroke-dasharray='2.4 2.8'%3E%3Ccircle cx='0' cy='420' r='22'/%3E%3Ccircle cx='420' cy='420' r='22'/%3E%3C/g%3E%3C/svg%3E\");",
    "--tk-pass-mask:radial-gradient(circle at 0 420px,transparent 14px,#000 15px) left/50% 100% no-repeat,radial-gradient(circle at 100% 420px,transparent 14px,#000 15px) right/50% 100% no-repeat}",
    ":root[data-theme=\"light\"]{--tk-ground:#e9e9eb;--tk-light:rgba(255,255,255,.9);--tk-pass-ground:#ffffff;--tk-text:#111111;--tk-faint:#8e8e93;--tk-hot-tint:#fff0eb;--tk-hot-ink:#c23e1c;--tk-shadow:rgba(20,20,30,.2);--tk-pass-shadow:drop-shadow(0 1px 1px rgba(20,20,30,.05)) drop-shadow(0 10px 14px rgba(20,20,30,.08))}",
    ":root:not([data-theme=\"light\"]){--tk-ground:#131313;--tk-light:rgba(255,255,255,.06);--tk-hot-glow:rgba(255,94,0,.3);--tk-shadow:rgba(0,0,0,.55);--tk-pass-ground:#1d1d1f;--tk-text:#f2f2f0;--tk-faint:#9a9a96;--tk-hot-tint:rgba(255,94,0,.16);--tk-hot-ink:#ffb38a;--tk-pass-shadow:drop-shadow(0 1px 1px rgba(0,0,0,.4)) drop-shadow(0 12px 18px rgba(0,0,0,.5))"
  ].join("\n");

  var cssEl = null;
  function injectCSS() {
    if (cssEl) return;
    cssEl = document.createElement("style");
    cssEl.textContent = CSS;
    document.head.appendChild(cssEl);
  }

  /* ── render del DOM (una vez) ── */
  function build(data) {
    var host = document.createElement("div");
    host.className = "tkfx";
    var h = "";
    h += '<div class="tkfx-ground"></div><div class="tkfx-grain"></div>';
    h += '<div class="tkfx-stage" data-part="stage" style="visibility:hidden"><div class="tkfx-floor" data-part="floor"></div><div class="tkfx-camera"><div class="tkfx-rig" data-part="rig">';
    TILES.forEach(function (t, i) {
      var st = "", k;
      for (k in t.style) st += k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }) + ":" + t.style[k] + ";";
      h += '<div class="tkfx-tile" data-part="tile" style="' + st + '"></div>';
    });
    h += '<div class="tkfx-card" data-part="card"><div class="tkfx-face">';
    h += '<div class="tkfx-clip tkfx-header"><div class="tkfx-hrow" data-part="header"><div class="tkfx-mark"><span class="tkfx-micon"></span>' + esc(data.event) + '</div><div class="tkfx-mono tkfx-admit">' + esc(data.admit) + "</div></div></div>";
    h += '<div class="tkfx-clip tkfx-mono tkfx-seatlabel"><div data-part="seat-label">' + esc(data.seatLabel) + "</div></div>";
    h += '<div class="tkfx-clip tkfx-seat" data-part="seat">';
    var reels = data.seatRoll[0].map(function (_, i) { return data.seatRoll.map(function (rd) { return rd[i]; }); });
    reels.forEach(function (reel) {
      h += '<div class="tkfx-reel" data-part="reel">';
      reel.forEach(function (ch) { h += '<div class="tkfx-gline">' + glyphSVG(ch) + "</div>"; });
      h += "</div>";
    });
    h += "</div>";
    data.details.forEach(function (d, i) {
      h += '<div class="tkfx-detail" style="left:' + [32, 164, 296][i] + 'px" data-part="detail"><div class="tkfx-mono">' + esc(d.label) + '</div><div class="tkfx-dvalue">' + esc(d.value) + "</div></div>";
    });
    h += '<svg class="tkfx-perf" data-part="perf" viewBox="0 0 372 2"><line x1="0" y1="1" x2="372" y2="1" stroke="var(--tk-faint)" stroke-width="1.2" stroke-dasharray="3 4"/></svg>';
    h += '<div class="tkfx-clip tkfx-mono tkfx-doorslabel"><div data-part="doors-label">' + esc(data.doorsLabel) + "</div></div>";
    h += '<div class="tkfx-clip tkfx-doorsvalue"><div data-part="doors-value">' + esc(data.doorsValue) + "</div></div>";
    h += '<svg class="tkfx-bars" viewBox="0 0 200 32">';
    BARS.forEach(function (b) { h += '<rect class="tkfx-bar" data-part="bar" x="' + b.x + '" y="0" width="' + b.w + '" height="32" rx="1"/>'; });
    h += "</svg>";
    h += '<div class="tkfx-qr">';
    MODULES.forEach(function (m) { h += '<span class="tkfx-mod" data-part="module" style="left:' + m.x + "px;top:" + m.y + 'px"></span>'; });
    FINDERS.forEach(function (f) { h += '<span class="tkfx-finder" data-part="finder" style="left:' + f[0] + "px;top:" + f[1] + 'px"></span>'; });
    h += "</div>";
    h += '<div class="tkfx-sheen" data-part="sheen"></div>';
    h += "</div></div></div></div></div>";
    host.innerHTML = h;
    return host;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ── motor ── */
  function mount(container, data) {
    injectCSS();
    var host = build(data);
    container.appendChild(host);
    var q = function (n) { return host.querySelector('[data-part="' + n + '"]'); };
    var qa = function (n) { return host.querySelectorAll('[data-part="' + n + '"]'); };
    var stage = q("stage"), floor = q("floor"), rig = q("rig"), card = q("card"),
      tiles = qa("tile"), header = q("header"), seatLabel = q("seat-label"),
      reels = qa("reel"), details = qa("detail"), perf = q("perf"),
      doorsLabel = q("doors-label"), doorsValue = q("doors-value"),
      bars = qa("bar"), finders = qa("finder"), modules = qa("module"), sheen = q("sheen");

    function fit() {
      var s = Math.min(host.clientWidth, host.clientHeight) / 1080;
      stage.style.setProperty("--tkscale", String(s));
    }
    fit();
    window.addEventListener("resize", fit, { passive: true });

    /* x de los reels: 0, 108, 216 (112 menos 4) */
    var reelX = [0, 108, 216];
    reels.forEach(function (reel, i) { reel.style.left = reelX[i] + "px"; });

    function reveal(el, k) {
      el.style.transform = "translateY(" + (1 - eo(k)) * REVEAL.rise + "%)";
      el.style.opacity = String(clamp(k * REVEAL.fadeGain, 0, 1));
    }
    function fade(el, f) { el.style.opacity = String(Number(el.style.opacity) * f); }

    function render(time) {
      var t = ((time % LOOP) + LOOP) % LOOP;
      var solid = t >= T0 && t < T_OUT, F = TILE;
      TILES.forEach(function (o, i) {
        var el = tiles[i], k;
        if (t < T_OUT) k = eo5((t - o.din) / F.inTime);
        else k = 1 - ei((t - T_OUT - o.dout) / F.outTime);
        var qq = 1 - k;
        var fl = t < T_OUT ? bump(t - (o.din + F.flashAt), F.flashWidth) * F.flashGain : 0;
        var wv = bump(t - (F.waveAt + o.wave * F.waveSpan), F.waveWidth) * F.waveGain;
        el.style.transform = "translate3d(" + o.sx * qq + "px," + o.sy * qq + "px," + o.sz * qq + "px) rotateX(" + o.rx * qq + "deg) rotateY(" + o.ry * qq + "deg) rotateZ(" + o.rz * qq + "deg) scale(" + (F.scaleFrom + F.scaleGain * k) + ")";
        el.style.opacity = String(solid ? 0 : clamp(k * F.fadeGain, 0, 1));
        el.style.setProperty("--lit", (fl + wv).toFixed(3));
        el.style.filter = "blur(" + (qq * qq * F.blur).toFixed(2) + "px)";
        el.style.backgroundColor = "color-mix(in srgb, var(--tk-accent,#ff5e00) calc(var(--lit,0) * 45%), var(--tk-pass-ground))";
      });
      card.style.opacity = String(solid ? 1 : 0);
      floor.style.opacity = String(clamp(t < T_OUT ? eo((t - FLOOR.fadeAt) / FLOOR.fadeIn) : 1 - eo((t - T_OUT) / FLOOR.fadeOut), 0, 1));
      var W = TILT;
      var tw = clamp((t - W.at) / W.rampIn, 0, 1) * (1 - clamp((t - T_OUT - W.outDelay) / W.rampOut, 0, 1));
      var ry = Math.sin((t - W.at) * W.yawRate) * W.yaw * tw,
        rx = (Math.cos((t - W.at) * W.pitchRate) * W.pitch + W.pitchBias) * tw;
      rig.style.transform = "rotateX(" + rx + "deg) rotateY(" + ry + "deg)";
      floor.style.transform = "translateX(" + (-ry * FLOOR.shift) + "px) scaleX(" + (1 - Math.abs(ry) / FLOOR.squash) + ")";
      var out = clamp((t - T_OUT + CONTENT_OUT.lead) / CONTENT_OUT.time, 0, 1), co = 1 - out, c = t - T0;
      reveal(header, c / M.HEADER.time); fade(header, co);
      reveal(seatLabel, (c - M.SEAT_LABEL.at) / M.SEAT_LABEL.time); fade(seatLabel, co);
      var S = M.REELS;
      reels.forEach(function (reel, i) {
        var k = eio((c - S.at - i * S.stagger) / S.time);
        reel.style.transform = "translateY(" + (-k * S.roll) + "px)";
        reel.style.opacity = String(clamp((c - S.at) * S.fadeGain, 0, 1) * co);
        reel.style.filter = "blur(" + (Math.sin(k * Math.PI) * S.blur).toFixed(2) + "px)";
      });
      var D = M.DETAILS;
      details.forEach(function (d, i) {
        var k = eo((c - D.at - i * D.stagger) / D.time);
        d.style.opacity = String(k * co);
        d.style.transform = "translateY(" + (1 - k) * D.rise + "px)";
      });
      perf.style.clipPath = "inset(0 " + (1 - eo((c - M.PERF.at) / M.PERF.time)) * 100 + "% 0 0)";
      perf.style.opacity = String(co);
      reveal(doorsLabel, (c - M.DOORS_LABEL.at) / M.DOORS_LABEL.time); fade(doorsLabel, co);
      reveal(doorsValue, (c - M.DOORS_VALUE.at) / M.DOORS_VALUE.time); fade(doorsValue, co);
      var B = M.BARS;
      bars.forEach(function (b, i) {
        var k = eo((c - B.at - i * B.stagger) / B.time);
        b.setAttribute("transform", "translate(0 " + (1 - k) * B.rise + ") scale(1 " + k + ")");
        b.style.opacity = String(k * co);
      });
      var Q = M.FINDERS;
      finders.forEach(function (f, i) {
        var k = eo((c - Q.at - i * Q.stagger) / Q.time);
        f.style.transform = "scale(" + (Q.scaleFrom + Q.scaleGain * k) + ") rotate(" + (1 - k) * Q.turn + "deg)";
        f.style.opacity = String(k * co);
      });
      var N = M.MODULES;
      modules.forEach(function (m, i) {
        var k = eo((c - N.at - MODULES[i].d * N.perCell) / N.time);
        m.style.transform = "scale(" + k + ")";
        m.style.opacity = String(k * co);
      });
      var H2 = M.SHEEN;
      var sw = (c - H2.first) / H2.time, sw2 = (c - H2.second) / H2.time;
      var sv = sw < H2.end ? sw : sw2;
      sheen.style.transform = "translateX(" + (H2.from + clamp(sv, 0, H2.end)) * 100 + "%)";
      sheen.style.opacity = String(sv > 0 && sv < H2.end ? co : 0);
    }

    var disposed = false, live = false, raf = 0, t0 = 0;
    function draw(t) {
      render(t);
      if (!live) { live = true; stage.style.visibility = "visible"; }
    }
    function tick() {
      draw((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(tick);
    }
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    return {
      dispose: function () {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", fit);
        if (host.parentNode) host.parentNode.removeChild(host);
      },
      start: function () {
        if (disposed) return;
        t0 = performance.now();
        if (reduced) draw(STILL_AT);
        else raf = requestAnimationFrame(tick);
      }
    };
  }

  window.musaTicketFX = { mount: mount };
})();
