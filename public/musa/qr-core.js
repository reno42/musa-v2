/* qr-core.js — motor único de códigos QR de Musa (la pantalla y el MCP usan el MISMO archivo, como siterender.js).
 *
 * Codifica con node-qrcode (el codificador de QeepeR, de Douglas Lovera; MIT), empaquetado en vendor/qrcode.min.js
 * para el navegador (globalThis.QRCodeLib) e importado desde npm en el worker. Aquí se arma:
 *   · el contenido de cada tipo (enlace, WhatsApp, Wi‑Fi, correo, llamada, SMS, texto, contacto vCard), con el
 *     escapado que piden los lectores (Wi‑Fi y vCard rompían con «;», «,» o «:» en el nombre o la clave);
 *   · el dibujo en SVG: colores de la marca, módulos cuadrados o redondeados, ojos cuadrados o redondeados,
 *     logo al centro (sube la corrección a H y limpia los módulos de debajo para que siga leyéndose);
 *   · los avisos de lectura: poco contraste, colores invertidos, contenido que no cabe.
 * Registro: globalThis.MusaQR.
 */
(function (G) {
  "use strict";
  function lib() {
    var L = G.QRCodeLib;
    if (!L || typeof L.create !== "function") throw new Error("El codificador de QR no cargó");
    return L;
  }

  /* ── tipos ── */
  var TYPES = {
    url: { label: "Enlace", dynamic: true },
    whatsapp: { label: "WhatsApp", dynamic: true },
    wifi: { label: "Wi‑Fi", dynamic: false },
    email: { label: "Correo", dynamic: false },
    phone: { label: "Llamada", dynamic: false },
    sms: { label: "SMS", dynamic: false },
    text: { label: "Texto", dynamic: false },
    vcard: { label: "Contacto", dynamic: false },
  };
  var MAX_URL = 2048, MAX_CONTENT = 1800;

  /** Un enlace http(s) válido o null. Sin esquema se asume https:// (como escribe la gente: «miweb.com»). */
  function normalizeUrl(u) {
    var s = String(u == null ? "" : u).trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (!/^[^\s/]+\.[^\s/]{2,}/.test(s)) return null;
      s = "https://" + s.replace(/^\/+/, "");
    }
    var p;
    try { p = new URL(s); } catch (e) { return null; }
    if (p.protocol !== "http:" && p.protocol !== "https:") return null;
    if (!p.hostname || /\s/.test(s) || s.length > MAX_URL) return null;
    return p.href;
  }
  /** Un QR que apunta a otro QR de Musa (/r/código) solo agrega un salto y puede hacer un bucle. */
  function isShortLink(u) { try { return /^\/r\/[A-Za-z0-9]{6,16}\/?$/.test(new URL(u).pathname); } catch (e) { return false; } }

  function digits(s) { return String(s == null ? "" : s).replace(/[^\d+]/g, "").replace(/(?!^)\+/g, ""); }
  function wifiEsc(s) { return String(s == null ? "" : s).replace(/([\\;,:"])/g, "\\$1"); }
  function vEsc(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1"); }

  /**
   * Contenido del QR según el tipo. Devuelve { ok, content, url?, error? }.
   * url = destino (solo enlaces y WhatsApp, que pueden ser dinámicos: el QR lleva /r/código y el destino se cambia luego).
   */
  function payload(type, f) {
    f = f || {};
    var bad = function (m) { return { ok: false, error: m }; };
    switch (type) {
      case "url": {
        var u = normalizeUrl(f.url);
        if (!u) return bad("Escribe un enlace válido (https://…)");
        if (isShortLink(u)) return bad("Ese enlace ya es de un código QR de Musa: apunta a su destino real");
        return { ok: true, content: u, url: u };
      }
      case "whatsapp": {
        var n = digits(f.phone).replace(/^\+/, "");
        if (n.length < 8 || n.length > 15) return bad("Escribe el número con código de país (ej.: 51987654321)");
        var w = "https://wa.me/" + n + (f.message ? "?text=" + encodeURIComponent(f.message) : "");
        return { ok: true, content: w, url: w };
      }
      case "wifi": {
        var ssid = String(f.ssid || "").trim();
        if (!ssid) return bad("Falta el nombre de la red (SSID)");
        var enc = f.encryption === "WEP" ? "WEP" : f.encryption === "none" ? "nopass" : "WPA";
        if (enc !== "nopass" && !f.password) return bad("Falta la clave de la red (o elige «Sin clave»)");
        return { ok: true, content: "WIFI:T:" + enc + ";S:" + wifiEsc(ssid) + ";" + (enc !== "nopass" ? "P:" + wifiEsc(f.password) + ";" : "") + (f.hidden ? "H:true;" : "") + ";" };
      }
      case "email": {
        var to = String(f.to || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return bad("Escribe un correo válido");
        var q = [];
        if (f.subject) q.push("subject=" + encodeURIComponent(f.subject));
        if (f.body) q.push("body=" + encodeURIComponent(f.body));
        return { ok: true, content: "mailto:" + to + (q.length ? "?" + q.join("&") : "") };
      }
      case "phone": {
        var t = digits(f.phone);
        if (t.replace(/\D/g, "").length < 6) return bad("Escribe un número de teléfono");
        return { ok: true, content: "tel:" + t };
      }
      case "sms": {
        var s = digits(f.phone);
        if (s.replace(/\D/g, "").length < 6) return bad("Escribe un número de teléfono");
        return { ok: true, content: "SMSTO:" + s + ":" + String(f.message || "") };
      }
      case "text": {
        var x = String(f.text || "");
        if (!x.trim()) return bad("Escribe el texto");
        return { ok: true, content: x };
      }
      case "vcard": {
        var first = String(f.firstName || "").trim(), last = String(f.lastName || "").trim();
        if (!first && !last && !f.org) return bad("Escribe al menos un nombre o la empresa");
        var L = ["BEGIN:VCARD", "VERSION:3.0", "N:" + vEsc(last) + ";" + vEsc(first) + ";;;", "FN:" + vEsc((first + " " + last).trim() || f.org)];
        if (f.org) L.push("ORG:" + vEsc(f.org));
        if (f.title) L.push("TITLE:" + vEsc(f.title));
        if (f.phone) L.push("TEL;TYPE=CELL:" + digits(f.phone));
        if (f.email) L.push("EMAIL:" + vEsc(String(f.email).trim()));
        if (f.web) { var wu = normalizeUrl(f.web); if (wu) L.push("URL:" + wu); }
        if (f.address) L.push("ADR;TYPE=WORK:;;" + vEsc(f.address) + ";;;;");
        L.push("END:VCARD");
        return { ok: true, content: L.join("\r\n") };
      }
    }
    return bad("Tipo de QR desconocido");
  }

  /* ── colores ── */
  function hex6(h) {
    h = String(h || "").trim();
    if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h.slice(1).split("").map(function (c) { return c + c; }).join("");
    return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null;
  }
  function lum(h) {
    var c = [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16) / 255; })
      .map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  /* ── opciones ── */
  function opts(o) {
    o = o || {};
    var fg = hex6(o.fg) || "#111111", bg = hex6(o.bg) || "#ffffff";
    return {
      fg: fg, bg: bg, eye: hex6(o.eye) || fg,
      transparent: !!o.transparent,
      margin: Math.max(0, Math.min(8, o.margin == null ? 3 : +o.margin || 0)),
      /* sin estilo «puntos»: probado con un lector (jsQR), no se leía en casi ningún tamaño */
      dots: o.dots === "rounded" ? "rounded" : "square",
      eyes: o.eyes === "rounded" ? "rounded" : "square",
      logo: typeof o.logo === "string" && o.logo ? o.logo : null,
      ecc: o.logo ? "H" : (/^[LMQH]$/.test(o.ecc || "") ? o.ecc : "M"),
      size: Math.max(64, Math.min(4096, +o.size || 512)),
    };
  }

  /** Avisos para que el QR se lea bien (texto para la persona). */
  function warnings(o) {
    var p = opts(o), w = [];
    var c = contrast(p.fg, p.bg);
    /* 4:1 y no 3:1: con 3:1 (p. ej. naranja sobre blanco) un lector estricto ya fallaba en la prueba */
    if (!p.transparent && c < 4) w.push("Poco contraste entre el código y el fondo: algunos celulares no lo van a leer.");
    else if (!p.transparent && lum(p.fg) > lum(p.bg)) w.push("Código claro sobre fondo oscuro: varios lectores no lo leen. Mejor oscuro sobre claro.");
    if (p.eye !== p.fg && contrast(p.eye, p.bg) < 4.5) w.push("El color de las esquinas casi no se distingue del fondo.");
    if (p.margin < 2) w.push("Con un margen tan chico, ponlo sobre un fondo liso y claro para que se lea.");
    return w;
  }

  /** Matriz de módulos. Lanza «no cabe» si el contenido supera la capacidad del QR. */
  function matrix(text, ecc) {
    var s = String(text == null ? "" : text);
    if (!s) throw new Error("El QR está vacío");
    if (s.length > MAX_CONTENT + 2048) throw new Error("Es demasiado contenido para un código QR");
    var q;
    try { q = lib().create(s, { errorCorrectionLevel: ecc || "M" }); }
    catch (e) { throw new Error(/too big|amount of data|capacity/i.test(String(e && e.message)) ? "Es demasiado contenido para un código QR: acórtalo" : (e && e.message) || "No se pudo armar el QR"); }
    var m = q.modules, n = m.size;
    return { n: n, version: q.version, get: function (r, c) { return !!m.get(r, c); } };
  }

  /* ── dibujo ── */
  function rr(x, y, w, h, r) {
    if (!r) return "M" + x + " " + y + "h" + w + "v" + h + "h" + (-w) + "z";
    r = Math.min(r, w / 2, h / 2);
    return "M" + (x + r) + " " + y + "h" + (w - 2 * r) + "a" + r + " " + r + " 0 0 1 " + r + " " + r + "v" + (h - 2 * r)
      + "a" + r + " " + r + " 0 0 1 " + (-r) + " " + r + "h" + (-(w - 2 * r)) + "a" + r + " " + r + " 0 0 1 " + (-r) + " " + (-r)
      + "v" + (-(h - 2 * r)) + "a" + r + " " + r + " 0 0 1 " + r + " " + (-r) + "z";
  }
  /* sentido contrario: el hueco del ojo con fill-rule evenodd */
  function rrHole(x, y, w, h, r) {
    if (!r) return "M" + x + " " + y + "v" + h + "h" + w + "v" + (-h) + "z";
    r = Math.min(r, w / 2, h / 2);
    return "M" + (x + r) + " " + y + "a" + r + " " + r + " 0 0 0 " + (-r) + " " + r + "v" + (h - 2 * r)
      + "a" + r + " " + r + " 0 0 0 " + r + " " + r + "h" + (w - 2 * r) + "a" + r + " " + r + " 0 0 0 " + r + " " + (-r)
      + "v" + (-(h - 2 * r)) + "a" + r + " " + r + " 0 0 0 " + (-r) + " " + (-r) + "z";
  }
  function attr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function num(v) { return Math.round(v * 1000) / 1000; }

  /**
   * SVG del QR. text = lo que lleva el código (para un dinámico, su enlace corto /r/código).
   * o: { fg, bg, eye, transparent, margin, dots, eyes, logo, ecc, size, title }
   */
  function svg(text, o) {
    var p = opts(o), M = matrix(text, p.ecc), n = M.n, m = p.margin, T = n + 2 * m;
    var finder = function (r, c) { return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7); };
    /* logo: un cuadrado al centro de ~22 % del lado (con corrección H se recupera hasta ~30 % de daño) */
    var Lz = 0, L0 = 0;
    if (p.logo) { Lz = Math.floor(n * 0.22); if (Lz % 2 === 0) Lz++; L0 = Math.floor((n - Lz) / 2); }
    var underLogo = function (r, c) { return Lz && r >= L0 - 1 && r <= L0 + Lz && c >= L0 - 1 && c <= L0 + Lz; };
    var on = function (r, c) { return r >= 0 && c >= 0 && r < n && c < n && M.get(r, c) && !finder(r, c) && !underLogo(r, c); };
    /* un módulo de 1×1 con radio 0,5 solo en las esquinas pedidas (tl, tr, br, bl) */
    var rc = function (x, y, tl, tr, br, bl) {
      var R = 0.5;
      return "M" + (x + (tl ? R : 0)) + " " + y
        + "h" + (1 - (tl ? R : 0) - (tr ? R : 0)) + (tr ? "a.5 .5 0 0 1 .5 .5" : "")
        + "v" + (1 - (tr ? R : 0) - (br ? R : 0)) + (br ? "a.5 .5 0 0 1 -.5 .5" : "")
        + "h" + (-(1 - (br ? R : 0) - (bl ? R : 0))) + (bl ? "a.5 .5 0 0 1 -.5 -.5" : "")
        + "v" + (-(1 - (bl ? R : 0) - (tl ? R : 0))) + (tl ? "a.5 .5 0 0 1 .5 -.5" : "") + "z";
    };
    var d = [], r, c;
    for (r = 0; r < n; r++) {
      if (p.dots === "square") {
        /* tramos horizontales seguidos en un solo rectángulo: el SVG pesa mucho menos */
        c = 0;
        while (c < n) {
          if (M.get(r, c) && !finder(r, c) && !underLogo(r, c)) {
            var s = c; while (c < n && M.get(r, c) && !finder(r, c) && !underLogo(r, c)) c++;
            d.push("M" + (s + m) + " " + (r + m) + "h" + (c - s) + "v1h" + (s - c) + "z");
          } else c++;
        }
      } else {
        /* redondeado «líquido»: cada módulo ocupa su cuadro completo (sin rendijas, que confundían al lector) y
           solo redondea la esquina que no tiene vecinos a los dos lados */
        for (c = 0; c < n; c++) {
          if (!on(r, c)) continue;
          var up = on(r - 1, c), dn = on(r + 1, c), lf = on(r, c - 1), rt = on(r, c + 1);
          d.push(rc(c + m, r + m, !up && !lf, !up && !rt, !dn && !rt, !dn && !lf));
        }
      }
    }
    var eyes = [[0, 0], [0, n - 7], [n - 7, 0]].map(function (e) {
      var ey = e[0] + m, ex = e[1] + m, round = p.eyes === "rounded";
      return '<path fill="' + p.eye + '" fill-rule="evenodd" d="' + rr(ex, ey, 7, 7, round ? 2 : 0) + rrHole(ex + 1, ey + 1, 5, 5, round ? 1.4 : 0) + '"/>'
        + '<path fill="' + p.eye + '" d="' + rr(ex + 2, ey + 2, 3, 3, round ? 0.9 : 0) + '"/>';
    }).join("");
    var logo = "";
    if (Lz) {
      var lx = L0 + m - 0.5, ly = L0 + m - 0.5, lw = Lz + 1;
      logo = (p.transparent ? "" : '<path fill="' + p.bg + '" d="' + rr(lx, ly, lw, lw, lw * 0.18) + '"/>')
        + '<image x="' + num(lx + lw * 0.08) + '" y="' + num(ly + lw * 0.08) + '" width="' + num(lw * 0.84) + '" height="' + num(lw * 0.84)
        + '" preserveAspectRatio="xMidYMid meet" href="' + attr(p.logo) + '" xlink:href="' + attr(p.logo) + '"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + T + " " + T + '" width="' + p.size + '" height="' + p.size + '"'
      + (p.dots === "square" ? ' shape-rendering="crispEdges"' : "") + ">"
      + (o && o.title ? "<title>" + attr(o.title) + "</title>" : "")
      + (p.transparent ? "" : '<rect width="' + T + '" height="' + T + '" fill="' + p.bg + '"/>')
      + '<path fill="' + p.fg + '" d="' + d.join("") + '"/>' + eyes + logo + "</svg>";
  }

  /** SVG → data URL (para pegarlo como imagen en un diseño o en un <img>). */
  function dataUrl(svgText) {
    var b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(svgText))) : Buffer.from(svgText, "utf8").toString("base64");
    return "data:image/svg+xml;base64," + b64;
  }

  /** PNG (solo navegador): dibuja el SVG en un canvas. El logo tiene que venir como data URL o el canvas queda bloqueado. */
  function png(text, o, px) {
    return new Promise(function (ok, ko) {
      var size = Math.max(256, Math.min(4096, +px || 1024));
      var s = svg(text, Object.assign({}, o, { size: size }));
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement("canvas"); cv.width = size; cv.height = size;
          var cx = cv.getContext("2d");
          cx.imageSmoothingEnabled = false;
          cx.drawImage(img, 0, 0, size, size);
          cv.toBlob(function (b) { b ? ok(b) : ko(new Error("No se pudo armar el PNG")); }, "image/png");
        } catch (e) { ko(e); }
      };
      img.onerror = function () { ko(new Error("No se pudo dibujar el QR")); };
      img.src = dataUrl(s);
    });
  }

  /** Colores de una marca que se leen: el más oscuro de la paleta para el código y su acento en las esquinas solo si contrasta. */
  function brandColors(cols, bg) {
    bg = hex6(bg) || "#ffffff";
    var hs = (cols || []).map(hex6).filter(Boolean);
    var ok = hs.filter(function (h) { return contrast(h, bg) >= 4.5 && lum(h) < lum(bg); }).sort(function (a, b) { return lum(a) - lum(b); });
    var fg = ok[0] || "#111111";
    var eye = hs.filter(function (h) { return h !== fg && contrast(h, bg) >= 4.5 && lum(h) < lum(bg); })[0] || fg;
    return { fg: fg, eye: eye, bg: bg };
  }

  G.MusaQR = { brandColors: brandColors, TYPES: TYPES, payload: payload, normalizeUrl: normalizeUrl, isShortLink: isShortLink, matrix: matrix, svg: svg, png: png, dataUrl: dataUrl, warnings: warnings, contrast: contrast, hex6: hex6, MAX_URL: MAX_URL, MAX_CONTENT: MAX_CONTENT };
})(typeof globalThis !== "undefined" ? globalThis : this);
