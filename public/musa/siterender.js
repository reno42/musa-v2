/* siterender.js — motor de Websites de Musa (el MISMO en el navegador y en el servidor).
 * Convierte un website (tema + ajustes), sus páginas (secciones) y su CMS (colecciones + entradas) en HTML
 * estático, rápido y con SEO/GEO/AEO: metadatos, Open Graph, JSON-LD (WebSite, Organization, WebPage,
 * BreadcrumbList, FAQPage, BlogPosting/Product), sitemap.xml, robots.txt, llms.txt, llms-full.txt y RSS.
 * La vista previa del editor y la web publicada salen de aquí: lo que ves es lo que se publica.
 * Sin dependencias. Se registra en globalThis.SiteRender (el repo es ESM: no usar solo module.exports).
 */
(function (root) {
  "use strict";
  var SR = {};

  /* ───────────────────────── utilidades ───────────────────────── */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function str(v) { return v == null ? "" : String(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function slugify(s) {
    return str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "pagina";
  }
  function newId(p) { return (p || "s") + "_" + Math.random().toString(36).slice(2, 10); }
  function words(s) { return str(s).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length; }
  function clip(s, n) { s = str(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }
  function plain(md) { return str(md).replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`~-]+/g, " ").replace(/\s+/g, " ").trim(); }
  SR.esc = esc; SR.slugify = slugify; SR.newId = newId; SR.plain = plain; SR.clip = clip;

  var RESERVED = ["api", "admin", "app", "www", "mail", "musa", "futuraria", "login", "w", "static", "assets", "cdn", "docs", "help", "soporte", "status", "blog-musa"];
  SR.RESERVED = RESERVED;
  SR.validSlug = function (s) { return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(str(s)) && RESERVED.indexOf(s) < 0; };
  SR.normPath = function (p) {
    p = "/" + str(p).trim().replace(/^\/+|\/+$/g, "").toLowerCase().replace(/[^a-z0-9/._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/\/{2,}/g, "/");
    return p === "/" ? "/" : p.replace(/\/$/, "");
  };

  /* URLs seguras: http(s), mailto, tel, anclas e internas (que llevan la base del sitio) */
  function safeHref(h, ctx) {
    h = str(h).trim();
    if (!h) return "#";
    if (/^#/.test(h)) return h;
    if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
    if (/^\//.test(h)) return (ctx && ctx.preview) ? "#" + h : ((ctx && ctx.base) || "") + (h === "/" && ctx && ctx.base ? "/" : h);
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(h)) return "https://" + h;
    return "#";
  }
  function safeSrc(u) {
    u = str(u).trim();
    if (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u;
    return "";
  }
  SR.safeHref = safeHref; SR.safeSrc = safeSrc;

  /* HTML personalizado: sin scripts, sin eventos, sin iframes fuera de los permitidos, sin meta/base/form ajenos */
  SR.sanitize = function (html) {
    var s = str(html);
    s = s.replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/<(script|style|noscript|object|embed|applet|base|meta|link|frameset|frame|template)\b[\s\S]*?(<\/\1\s*>|$)/gi, "");
    s = s.replace(/<(script|object|embed|applet|base|meta|link|frame)\b[^>]*>/gi, "");
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    s = s.replace(/\s(href|src|action|formaction|xlink:href|srcdoc)\s*=\s*("|')\s*(javascript|vbscript|data:text)[^"']*\2/gi, "");
    s = s.replace(/<iframe\b([^>]*)>/gi, function (m, a) {
      var src = (a.match(/\ssrc\s*=\s*("|')([^"']+)\1/i) || [])[2] || "";
      return /^https:\/\/(www\.youtube(-nocookie)?\.com|player\.vimeo\.com|www\.google\.com\/maps|open\.spotify\.com|calendly\.com)\//i.test(src)
        ? '<iframe src="' + esc(src) + '" loading="lazy" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0">' : "";
    });
    s = s.replace(/<form\b[^>]*>/gi, "<div>").replace(/<\/form>/gi, "</div>");
    return s;
  };

  /* Markdown seguro (subconjunto): títulos, negrita, cursiva, enlaces, imágenes, listas, citas, código, separador */
  function inline(t, ctx) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, u) { var s = safeSrc(u.replace(/&amp;/g, "&")); return s ? '<img src="' + esc(s) + '" alt="' + alt + '" loading="lazy">' : ""; });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, u) { var h = safeHref(u.replace(/&amp;/g, "&"), ctx); var ext = /^https?:/i.test(h); return '<a href="' + esc(h) + '"' + (ext ? ' rel="noopener" target="_blank"' : "") + ">" + label + "</a>"; });
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
    return t;
  }
  SR.md = function (src, ctx, hShift) {
    var lines = str(src).replace(/\r/g, "").split("\n"), out = [], i = 0, para = [];
    hShift = hShift || 0;
    function flush() { if (para.length) { out.push("<p>" + inline(para.join(" "), ctx) + "</p>"); para = []; } }
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) { flush(); var code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); continue; }
      var h = l.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flush(); var lv = Math.min(6, h[1].length + hShift); out.push("<h" + lv + ">" + inline(h[2], ctx) + "</h" + lv + ">"); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push("<hr>"); i++; continue; }
      if (/^>\s?/.test(l)) { flush(); var q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, "")); out.push("<blockquote>" + inline(q.join(" "), ctx) + "</blockquote>"); continue; }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        flush(); var ol = /^\s*\d/.test(l), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        out.push((ol ? "<ol>" : "<ul>") + items.map(function (x) { return "<li>" + inline(x, ctx) + "</li>"; }).join("") + (ol ? "</ol>" : "</ul>")); continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l.trim()); i++;
    }
    flush();
    return out.join("\n");
  };

  /* ───────────────────────── tema ───────────────────────── */
  var FONTS = ["Inter", "DM Sans", "Manrope", "Plus Jakarta Sans", "Poppins", "Montserrat", "Space Grotesk", "Sora", "Outfit", "Work Sans", "Lato", "Roboto", "Open Sans", "Nunito", "Raleway", "Playfair Display", "Fraunces", "DM Serif Display", "Lora", "Merriweather", "Cormorant Garamond", "Libre Baskerville", "Bricolage Grotesque", "Archivo", "JetBrains Mono"];
  SR.FONTS = FONTS;
  SR.PRESETS = {
    claro: { mode: "light", bg: "#ffffff", fg: "#111111", muted: "#5b5b5b", surface: "#f5f4ef", line: "#e6e4dc", accent: "#ff5e00", headingFont: "Inter", bodyFont: "Inter", radius: 14 },
    oscuro: { mode: "dark", bg: "#0b0b0c", fg: "#f4f3ee", muted: "#a3a3a3", surface: "#151517", line: "#26262a", accent: "#ff5e00", headingFont: "Space Grotesk", bodyFont: "Inter", radius: 14 },
    editorial: { mode: "light", bg: "#f6f1e8", fg: "#1d1a16", muted: "#6b6358", surface: "#ece5d8", line: "#ddd3c2", accent: "#9c3d20", headingFont: "Fraunces", bodyFont: "Work Sans", radius: 6 },
    suave: { mode: "light", bg: "#fbfbfe", fg: "#1a1b2e", muted: "#5d6080", surface: "#eff0fa", line: "#e1e3f2", accent: "#5b5bd6", headingFont: "Plus Jakarta Sans", bodyFont: "Plus Jakarta Sans", radius: 20 },
  };
  function hex(c) { c = str(c).trim(); if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]; return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : ""; }
  function lum(c) { c = hex(c) || "#000000"; var n = [1, 3, 5].map(function (i) { var v = parseInt(c.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  SR.contrast = contrast;
  /** Tema efectivo: preset → marca (colores y tipografías) → lo que la persona ajustó. */
  SR.theme = function (site, brand) {
    var t = obj(site && site.theme), base = SR.PRESETS[t.preset] || SR.PRESETS.claro, out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    if (brand) {
      var cols = arr(brand.colors).map(function (c) { return hex(typeof c === "string" ? c : c && (c.hex || c.value)); }).filter(Boolean);
      if (cols[0]) out.accent = cols[0];
      var fonts = arr(brand.fonts).map(function (f) { return typeof f === "string" ? f : f && (f.family || f.name); }).filter(Boolean);
      if (fonts[0]) { out.headingFont = fonts[0]; out.bodyFont = fonts[1] && !/mono/i.test(fonts[1]) ? fonts[1] : fonts[0]; }
    }
    Object.keys(t).forEach(function (k) { if (t[k] !== "" && t[k] != null && k !== "preset") out[k] = t[k]; });
    ["bg", "fg", "muted", "surface", "line", "accent"].forEach(function (k) { out[k] = hex(out[k]) || base[k]; });
    out.accentFg = contrast(out.accent, "#ffffff") >= 3 ? "#ffffff" : "#111111";
    out.radius = Math.max(0, Math.min(40, parseInt(out.radius, 10) || 0));
    out.width = Math.max(880, Math.min(1440, parseInt(out.width, 10) || 1160));
    return out;
  };
  function fontStack(f) { return /serif|fraunces|playfair|lora|merriweather|garamond|baskerville/i.test(f) && !/sans/i.test(f) ? "'" + f + "',Georgia,serif" : /mono/i.test(f) ? "'" + f + "',ui-monospace,monospace" : "'" + f + "',system-ui,-apple-system,'Segoe UI',sans-serif"; }
  function fontsLink(th) {
    var fam = [th.headingFont, th.bodyFont].filter(function (f, i, a) { return f && FONTS.indexOf(f) >= 0 && a.indexOf(f) === i; });
    if (!fam.length) return "";
    return '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + fam.map(function (f) { return "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;500;600;700;800"; }).join("&") + '&display=swap">';
  }

  function css(th) {
    var r = th.radius + "px";
    return ":root{--bg:" + th.bg + ";--fg:" + th.fg + ";--mu:" + th.muted + ";--sf:" + th.surface + ";--ln:" + th.line + ";--ac:" + th.accent + ";--af:" + th.accentFg + ";--r:" + r + ";--max:" + th.width + "px;--fh:" + fontStack(th.headingFont) + ";--fb:" + fontStack(th.bodyFont) + "}"
      + "*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 var(--fb);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}"
      + "img,video,iframe{max-width:100%;display:block}a{color:inherit}h1,h2,h3,h4{font-family:var(--fh);line-height:1.12;margin:0 0 .5em;letter-spacing:-.02em;text-wrap:balance}"
      + "h1{font-size:clamp(36px,6vw,64px);font-weight:800}h2{font-size:clamp(28px,4vw,42px);font-weight:750}h3{font-size:20px;font-weight:700}p{margin:0 0 1em}"
      + ".w{width:100%;max-width:var(--max);margin:0 auto;padding:0 20px}.s{padding:clamp(56px,8vw,104px) 0}.s.ps{padding:clamp(32px,5vw,56px) 0}.s.pl{padding:clamp(80px,11vw,150px) 0}"
      + ".s.alt{background:var(--sf)}.s.acc{background:var(--ac);color:var(--af)}.s.acc .mu{color:inherit;opacity:.85}.s.drk{background:#0d0d0f;color:#f4f3ee}.s.drk .mu{color:#b4b4b4}.s.drk .cd{background:#18181b;border-color:#2a2a2e}"
      + ".s.c{text-align:center}.s.c .hd{margin-left:auto;margin-right:auto}.hd{max-width:760px;margin-bottom:clamp(28px,4vw,48px)}.mu{color:var(--mu)}.ey{display:inline-block;font:700 13px/1 var(--fb);letter-spacing:.12em;text-transform:uppercase;color:var(--ac);margin-bottom:14px}.s.acc .ey{color:inherit}"
      + ".lead{font-size:clamp(18px,2vw,21px)}.bt{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.s.c .bt{justify-content:center}"
      + ".b{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;border-radius:calc(var(--r) * .7 + 6px);font:700 16px/1 var(--fb);text-decoration:none;border:2px solid var(--ac);background:var(--ac);color:var(--af);transition:transform .15s ease,opacity .15s}.b:hover{transform:translateY(-1px);opacity:.92}"
      + ".b.o{background:transparent;color:inherit;border-color:currentColor}.s.acc .b{background:var(--af);color:var(--ac);border-color:var(--af)}.s.acc .b.o{background:transparent;color:var(--af)}"
      + ".g{display:grid;gap:clamp(16px,2.4vw,28px);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--cw,260px)),1fr))}.g2{--cw:380px}.g4{--cw:200px}"
      + ".cd{background:var(--bg);border:1px solid var(--ln);border-radius:var(--r);padding:clamp(20px,2.4vw,28px);text-align:left}.s.alt .cd{background:var(--bg)}.cd img{border-radius:calc(var(--r) * .6);margin-bottom:16px;width:100%;aspect-ratio:16/10;object-fit:cover}"
      + ".ic{width:44px;height:44px;border-radius:12px;background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac);display:grid;place-items:center;font-size:22px;margin-bottom:16px}"
      + ".sp{display:grid;gap:clamp(28px,5vw,64px);grid-template-columns:1fr 1fr;align-items:center}.sp.rv>:first-child{order:2}.sp img{width:100%;border-radius:var(--r);object-fit:cover}@media(max-width:820px){.sp{grid-template-columns:1fr}.sp.rv>:first-child{order:0}}"
      + ".hero h1{max-width:16ch}.s.c.hero h1{margin-left:auto;margin-right:auto}.hero .lead{max-width:62ch}.s.c.hero .lead{margin-left:auto;margin-right:auto}.hero .hi{margin-top:clamp(32px,5vw,56px);border-radius:var(--r);width:100%;object-fit:cover;max-height:620px}"
      + ".hero.bgi{position:relative;color:#fff;background:#111 center/cover no-repeat;min-height:min(86vh,760px);display:flex;align-items:center}.hero.bgi::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.6))}.hero.bgi>.w{position:relative}.hero.bgi .mu{color:#e9e9e9}.hero.bgi .ey{color:#fff}"
      + ".st{text-align:center}.st b{display:block;font:800 clamp(36px,5vw,56px)/1 var(--fh);color:var(--ac);margin-bottom:8px}.s.acc .st b{color:inherit}"
      + ".lg{display:flex;flex-wrap:wrap;gap:clamp(24px,5vw,56px);align-items:center;justify-content:center}.lg img{height:36px;width:auto;object-fit:contain;filter:grayscale(1);opacity:.75}.lg span{font:700 18px var(--fh);opacity:.6}"
      + ".tq{font-size:18px;margin-bottom:20px}.pp{display:flex;align-items:center;gap:12px}.pp img{width:44px;height:44px;border-radius:50%;object-fit:cover;margin:0}.pp small{display:block;color:var(--mu)}"
      + ".pr{display:flex;flex-direction:column}.pr.ft{border:2px solid var(--ac);box-shadow:0 18px 50px -24px var(--ac)}.pr .pz{font:800 44px/1 var(--fh);margin:10px 0 4px}.pr .pz small{font:500 15px var(--fb);color:var(--mu)}.pr ul{list-style:none;padding:0;margin:18px 0 24px;flex:1}.pr li{padding:7px 0 7px 26px;position:relative;border-top:1px solid var(--ln)}.pr li::before{content:'✓';position:absolute;left:2px;color:var(--ac);font-weight:800}.pr .b{width:100%}"
      + ".fq{max-width:820px;margin:0 auto}.fq details{border-bottom:1px solid var(--ln);padding:6px 0}.fq summary{cursor:pointer;list-style:none;font:700 19px/1.35 var(--fh);padding:16px 36px 16px 0;position:relative}.fq summary::-webkit-details-marker{display:none}.fq summary::after{content:'+';position:absolute;right:4px;top:12px;font-size:26px;font-weight:400;transition:transform .2s}.fq details[open] summary::after{transform:rotate(45deg)}.fq .an{padding:0 0 18px;color:var(--mu)}"
      + ".s.c .fq{text-align:left}.ga{columns:3 260px;column-gap:16px}.ga figure{margin:0 0 16px;break-inside:avoid}.ga img{width:100%;border-radius:calc(var(--r) * .7)}.ga figcaption{font-size:14px;color:var(--mu);margin-top:6px}"
      + ".tx{max-width:760px}.s.c .tx{margin:0 auto}.tx img{border-radius:var(--r);margin:1.4em 0}.tx h2,.tx h3{margin-top:1.4em}.tx blockquote{margin:1.4em 0;padding:4px 0 4px 20px;border-left:3px solid var(--ac);font-size:1.1em}.tx pre{background:var(--sf);padding:16px;border-radius:10px;overflow:auto;font-size:14px}.tx a{color:var(--ac)}"
      + ".vd{aspect-ratio:16/9;width:100%;border:0;border-radius:var(--r);background:#000}"
      + ".fm{max-width:620px;display:flex;flex-direction:column;gap:14px;text-align:left}.s.c .fm{margin:0 auto}.fm label{display:flex;flex-direction:column;gap:6px;font:600 14px var(--fb)}.fm input,.fm textarea,.fm select{font:inherit;font-size:16px;padding:13px 14px;border:1.5px solid var(--ln);border-radius:calc(var(--r) * .5 + 4px);background:var(--bg);color:var(--fg)}.fm input:focus,.fm textarea:focus{outline:2px solid var(--ac);outline-offset:1px}.fm textarea{min-height:120px;resize:vertical}.fm .hp{position:absolute;left:-9999px}.fm .er{color:#c62828;font-size:14px;min-height:1em;margin:0}.fm .ok{padding:22px;border-radius:var(--r);background:var(--sf)}.s.acc .fm input,.s.acc .fm textarea{border-color:transparent}"
      + ".cl a.cd{display:flex;flex-direction:column;text-decoration:none;transition:transform .15s,border-color .15s}.cl a.cd:hover{transform:translateY(-2px);border-color:var(--ac)}.cl .dt{font-size:13px;color:var(--mu);margin-bottom:6px}.cl.ls .g{grid-template-columns:1fr}.cl.ls a.cd{flex-direction:row;gap:20px;align-items:center}.cl.ls a.cd img{width:180px;margin:0;flex:0 0 180px}@media(max-width:600px){.cl.ls a.cd{flex-direction:column;align-items:stretch}.cl.ls a.cd img{width:100%;flex-basis:auto}}"
      + ".dz{position:relative;width:100%;overflow:hidden;border-radius:var(--r)}.dz>.dzi{position:absolute;left:0;top:0;transform-origin:0 0}"
      + ".hdr{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.4) blur(12px);-webkit-backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--ln)}.hdr .w{display:flex;align-items:center;gap:20px;min-height:68px}"
      + ".lo{display:flex;align-items:center;gap:10px;font:800 20px var(--fh);text-decoration:none;letter-spacing:-.02em;margin-right:auto}.lo img{height:32px;width:auto}"
      + ".nv{display:flex;align-items:center;gap:26px}.nv a{text-decoration:none;font-weight:600;font-size:15px;opacity:.82}.nv a:hover{opacity:1}.nv .b{min-height:42px;padding:0 18px;font-size:15px;opacity:1}"
      + ".mn{display:none}.mn summary{list-style:none;cursor:pointer;width:44px;height:44px;display:grid;place-items:center;border-radius:10px;border:1px solid var(--ln)}.mn summary::-webkit-details-marker{display:none}.mn summary i,.mn summary i::before,.mn summary i::after{display:block;width:18px;height:2px;background:currentColor;position:relative;content:''}.mn summary i::before{position:absolute;top:-6px}.mn summary i::after{position:absolute;top:6px}"
      + ".mn .mp{position:absolute;left:0;right:0;top:100%;background:var(--bg);border-bottom:1px solid var(--ln);padding:12px 20px 20px;display:flex;flex-direction:column;gap:4px}.mn .mp a{padding:12px 0;text-decoration:none;font-weight:600;border-bottom:1px solid var(--ln)}.mn .mp .b{margin-top:12px;border:0}"
      + "@media(max-width:820px){.nv{display:none}.mn{display:block}}"
      + ".ftr{border-top:1px solid var(--ln);padding:48px 0 32px;font-size:15px}.ftr .w{display:flex;flex-wrap:wrap;gap:24px 48px;justify-content:space-between}.ftr nav{display:flex;flex-wrap:wrap;gap:12px 24px}.ftr a{text-decoration:none;opacity:.75}.ftr a:hover{opacity:1}.ftr .cp{width:100%;color:var(--mu);font-size:13px;margin-top:8px}"
      + ".mbadge{position:fixed;right:14px;bottom:14px;z-index:40;display:inline-flex;align-items:center;gap:6px;background:#111;color:#fff;font:700 12px/1 Inter,system-ui,sans-serif;padding:9px 12px;border-radius:999px;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.25)}.mbadge b{color:#ff5e00}"
      + ".ent .cv{width:100%;border-radius:var(--r);margin:28px 0 8px;max-height:560px;object-fit:cover}.ent .mt{color:var(--mu);font-size:15px;display:flex;gap:16px;flex-wrap:wrap}.ent .tg{display:inline-block;padding:4px 10px;border-radius:999px;background:var(--sf);font-size:13px;margin-right:6px}.ent .fl{margin-top:22px}.ent .fl b{display:block;font-size:13px;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}.bc{font-size:14px;color:var(--mu);margin-bottom:20px}.bc a{text-decoration:none}"
      + "@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}";
  }

  /* ───────────────────────── bloques ───────────────────────── */
  var BTN = { k: "buttons", label: "Botones", type: "list", fields: [{ k: "label", label: "Texto", type: "text" }, { k: "href", label: "Enlace", type: "url", hint: "/contacto, #form, https://… o mailto:" }, { k: "style", label: "Estilo", type: "select", opts: [["", "Relleno"], ["o", "Contorno"]] }] };
  SR.BLOCKS = {
    hero: { label: "Portada", desc: "Título grande, bajada y botones", icon: "★",
      props: [{ k: "eyebrow", label: "Antetítulo", type: "text" }, { k: "title", label: "Título (H1)", type: "text" }, { k: "subtitle", label: "Bajada", type: "textarea" }, BTN, { k: "image", label: "Imagen", type: "image" }, { k: "imageAlt", label: "Texto alternativo de la imagen", type: "text" }, { k: "layout", label: "Diseño", type: "select", opts: [["center", "Centrado"], ["split", "Texto e imagen"], ["bg", "Imagen de fondo"], ["left", "A la izquierda"]] }],
      sample: { eyebrow: "Nuevo", title: "Una frase que explica lo que haces", subtitle: "Dos líneas que dicen para quién es y qué gana. Concreto y sin rodeos.", buttons: [{ label: "Empezar", href: "#contacto" }, { label: "Ver más", href: "#beneficios", style: "o" }], layout: "center" } },
    features: { label: "Beneficios", desc: "Tarjetas con ícono, título y texto", icon: "▦",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "subtitle", label: "Bajada", type: "textarea" }, { k: "items", label: "Tarjetas", type: "list", fields: [{ k: "icon", label: "Ícono (emoji o texto)", type: "text" }, { k: "title", label: "Título", type: "text" }, { k: "text", label: "Texto", type: "textarea" }, { k: "image", label: "Imagen (opcional)", type: "image" }, { k: "href", label: "Enlace (opcional)", type: "url" }] }, { k: "cols", label: "Columnas", type: "select", opts: [["3", "3"], ["2", "2"], ["4", "4"]] }],
      sample: { title: "Por qué elegirnos", subtitle: "Lo que cambia desde el primer día.", items: [{ icon: "⚡", title: "Rápido", text: "Resultados en días, no en meses." }, { icon: "🎯", title: "Enfocado", text: "Solo lo que mueve tus números." }, { icon: "🤝", title: "Cercano", text: "Una persona real te acompaña." }], cols: "3" } },
    split: { label: "Texto + imagen", desc: "Bloque de dos columnas", icon: "◧",
      props: [{ k: "eyebrow", label: "Antetítulo", type: "text" }, { k: "title", label: "Título", type: "text" }, { k: "text", label: "Texto", type: "md" }, BTN, { k: "image", label: "Imagen", type: "image" }, { k: "imageAlt", label: "Texto alternativo", type: "text" }, { k: "reverse", label: "Imagen a la izquierda", type: "bool" }],
      sample: { title: "Cómo trabajamos", text: "Explicamos el proceso en **tres pasos** claros:\n\n1. Diagnóstico\n2. Plan\n3. Ejecución y medición", buttons: [] } },
    logos: { label: "Logos", desc: "Clientes o medios que confían en ti", icon: "◎",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "items", label: "Logos", type: "list", fields: [{ k: "name", label: "Nombre", type: "text" }, { k: "image", label: "Logo", type: "image" }, { k: "href", label: "Enlace", type: "url" }] }],
      sample: { title: "Confían en nosotros", items: [{ name: "Marca Uno" }, { name: "Marca Dos" }, { name: "Marca Tres" }, { name: "Marca Cuatro" }] }, style: { pad: "ps", align: "c" } },
    stats: { label: "Cifras", desc: "Números que dan confianza (suman para GEO)", icon: "#",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "items", label: "Cifras", type: "list", fields: [{ k: "value", label: "Cifra", type: "text" }, { k: "label", label: "Qué mide", type: "text" }] }],
      sample: { items: [{ value: "+120", label: "clientes" }, { value: "4,9/5", label: "satisfacción" }, { value: "8 años", label: "de experiencia" }] } },
    testimonials: { label: "Testimonios", desc: "Lo que dicen tus clientes", icon: "❝",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "items", label: "Testimonios", type: "list", fields: [{ k: "quote", label: "Testimonio", type: "textarea" }, { k: "name", label: "Nombre", type: "text" }, { k: "role", label: "Cargo o empresa", type: "text" }, { k: "image", label: "Foto", type: "image" }] }],
      sample: { title: "Lo que dicen", items: [{ quote: "Nos ordenaron todo y vendimos más en el primer mes.", name: "Ana Torres", role: "Fundadora, Kuna" }, { quote: "Claros, rápidos y siempre disponibles.", name: "Luis Medina", role: "Gerente, Café Altura" }] } },
    pricing: { label: "Precios", desc: "Planes y lo que incluye cada uno", icon: "$",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "subtitle", label: "Bajada", type: "textarea" }, { k: "items", label: "Planes", type: "list", fields: [{ k: "name", label: "Plan", type: "text" }, { k: "price", label: "Precio", type: "text" }, { k: "period", label: "Periodo", type: "text" }, { k: "desc", label: "Para quién", type: "text" }, { k: "features", label: "Incluye (una por línea)", type: "textarea" }, { k: "label", label: "Botón", type: "text" }, { k: "href", label: "Enlace del botón", type: "url" }, { k: "featured", label: "Destacado", type: "bool" }] }],
      sample: { title: "Planes", items: [{ name: "Básico", price: "S/ 490", period: "/mes", features: "Diagnóstico\n4 piezas al mes\nReporte mensual", label: "Elegir", href: "#contacto" }, { name: "Pro", price: "S/ 990", period: "/mes", features: "Todo lo del Básico\n12 piezas al mes\nPauta incluida", label: "Elegir", href: "#contacto", featured: true }] } },
    faq: { label: "Preguntas frecuentes", desc: "Respuestas directas (AEO) con su schema FAQPage", icon: "?",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "items", label: "Preguntas", type: "list", fields: [{ k: "q", label: "Pregunta", type: "text" }, { k: "a", label: "Respuesta (empieza respondiendo en 1 frase)", type: "md" }] }],
      sample: { title: "Preguntas frecuentes", items: [{ q: "¿Cuánto tarda?", a: "Entre 2 y 4 semanas según el alcance." }, { q: "¿Tiene costo la primera reunión?", a: "No, la primera reunión es gratis." }, { q: "¿Trabajan con empresas fuera de Lima?", a: "Sí, trabajamos 100 % en línea con todo el país." }] } },
    cta: { label: "Llamado a la acción", desc: "Banda destacada con botón", icon: "➜",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "text", label: "Texto", type: "textarea" }, BTN],
      sample: { title: "¿Listo para empezar?", text: "Agenda una llamada de 20 minutos.", buttons: [{ label: "Agendar", href: "#contacto" }] }, style: { bg: "acc", align: "c" } },
    form: { label: "Formulario", desc: "Capta leads: llegan al CRM de Musa", icon: "✉",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "text", label: "Texto", type: "textarea" }, { k: "formId", label: "Formulario de Musa", type: "form", hint: "Crear › Formularios. Las respuestas crean el lead en Vender › Personas." }, { k: "submit", label: "Texto del botón", type: "text" }, { k: "success", label: "Mensaje al enviar", type: "text" }],
      sample: { title: "Hablemos", text: "Déjanos tus datos y te escribimos hoy.", submit: "Enviar", success: "¡Gracias! Te escribimos pronto." } },
    gallery: { label: "Galería", desc: "Fotos en mosaico", icon: "▤",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "items", label: "Imágenes", type: "list", fields: [{ k: "image", label: "Imagen", type: "image" }, { k: "alt", label: "Texto alternativo", type: "text" }, { k: "caption", label: "Pie de foto", type: "text" }] }],
      sample: { title: "Galería", items: [] } },
    collection: { label: "Lista del CMS", desc: "Últimas entradas de una colección (blog, productos…)", icon: "☰",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "subtitle", label: "Bajada", type: "textarea" }, { k: "collection", label: "Colección", type: "collection" }, { k: "limit", label: "Cuántas mostrar", type: "number" }, { k: "layout", label: "Diseño", type: "select", opts: [["grid", "Tarjetas"], ["list", "Lista"]] }, { k: "more", label: "Texto del enlace «ver todo»", type: "text" }],
      sample: { title: "Lo último", collection: "blog", limit: 3, layout: "grid", more: "Ver todo" } },
    text: { label: "Texto", desc: "Texto libre con formato (markdown)", icon: "¶",
      props: [{ k: "md", label: "Contenido", type: "md", hint: "## Subtítulo, **negrita**, [enlace](/pagina), - listas" }],
      sample: { md: "## Un subtítulo\n\nEscribe aquí. Usa **negrita**, [enlaces](/contacto) y listas:\n\n- Punto uno\n- Punto dos" } },
    video: { label: "Video", desc: "YouTube, Vimeo o un archivo", icon: "▶",
      props: [{ k: "title", label: "Título", type: "text" }, { k: "url", label: "URL del video", type: "url" }],
      sample: { title: "", url: "" } },
    design: { label: "Diseño de Musa", desc: "Inserta un diseño del editor", icon: "◆",
      props: [{ k: "templateId", label: "Diseño", type: "design" }, { k: "alt", label: "Descripción (para SEO)", type: "text" }, { k: "href", label: "Enlace al hacer clic", type: "url" }],
      sample: {} },
    html: { label: "HTML propio", desc: "Código HTML (sin scripts)", icon: "</>",
      props: [{ k: "html", label: "HTML", type: "code", hint: "Por seguridad se quitan scripts y eventos. Se permiten iframes de YouTube, Vimeo, Google Maps, Spotify y Calendly." }],
      sample: { html: "<div style=\"text-align:center\"><h2>Mi bloque</h2><p>HTML libre</p></div>" } },
  };
  SR.STYLE = [{ k: "bg", label: "Fondo", type: "select", opts: [["", "Normal"], ["alt", "Suave"], ["acc", "Color de marca"], ["drk", "Oscuro"]] }, { k: "align", label: "Alineación", type: "select", opts: [["", "Izquierda"], ["c", "Centrada"]] }, { k: "pad", label: "Espacio", type: "select", opts: [["", "Normal"], ["ps", "Compacto"], ["pl", "Amplio"]] }, { k: "anchor", label: "Ancla (#id para enlazar)", type: "text" }];
  SR.FIELD_TYPES = [["text", "Texto corto"], ["textarea", "Texto largo"], ["richtext", "Texto con formato"], ["image", "Imagen"], ["date", "Fecha"], ["number", "Número"], ["url", "Enlace"], ["bool", "Sí / no"], ["select", "Opciones"], ["tags", "Etiquetas"]];
  SR.SCHEMAS = [["BlogPosting", "Artículo de blog"], ["Article", "Noticia / artículo"], ["Product", "Producto"], ["Service", "Servicio"], ["Event", "Evento"], ["CreativeWork", "Caso / proyecto"], ["Person", "Persona / equipo"], ["", "Ninguno"]];

  SR.newSection = function (type) {
    var b = SR.BLOCKS[type]; if (!b) return null;
    return { id: newId("sec"), type: type, props: JSON.parse(JSON.stringify(b.sample || {})), style: JSON.parse(JSON.stringify(b.style || {})) };
  };

  function buttons(list, ctx) {
    list = arr(list).filter(function (b) { return b && str(b.label).trim(); });
    if (!list.length) return "";
    return '<div class="bt">' + list.map(function (b) { var h = safeHref(b.href, ctx), ext = /^https?:/i.test(h) && !(ctx.origin && h.indexOf(ctx.origin) === 0); return '<a class="b' + (b.style === "o" ? " o" : "") + '" href="' + esc(h) + '"' + (ext ? ' rel="noopener"' : "") + ">" + esc(b.label) + "</a>"; }).join("") + "</div>";
  }
  function head(p, ctx, tag) {
    var t = str(p.title).trim(), sub = str(p.subtitle).trim(), ey = str(p.eyebrow).trim();
    if (!t && !sub && !ey) return "";
    tag = tag || ctx.nextH();
    return '<div class="hd">' + (ey ? '<span class="ey">' + esc(ey) + "</span>" : "") + (t ? "<" + tag + ">" + esc(t) + "</" + tag + ">" : "") + (sub ? '<p class="lead mu">' + esc(sub).replace(/\n/g, "<br>") + "</p>" : "") + "</div>";
  }
  function img(src, alt, cls, extra) { var s = safeSrc(src); return s ? '<img src="' + esc(s) + '" alt="' + esc(alt || "") + '"' + (cls ? ' class="' + cls + '"' : "") + ' loading="lazy" decoding="async"' + (extra || "") + ">" : ""; }
  function videoEmbed(u) {
    u = str(u).trim(); var m;
    if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/))) return '<iframe class="vd" src="https://www.youtube-nocookie.com/embed/' + esc(m[1]) + '" title="Video" loading="lazy" allow="accelerometer;encrypted-media;gyroscope;picture-in-picture;fullscreen" allowfullscreen></iframe>';
    if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return '<iframe class="vd" src="https://player.vimeo.com/video/' + esc(m[1]) + '" title="Video" loading="lazy" allow="fullscreen;picture-in-picture" allowfullscreen></iframe>';
    if (/^https?:\/\/.+\.(mp4|webm|mov)(\?|$)/i.test(u)) return '<video class="vd" src="' + esc(u) + '" controls preload="metadata" playsinline></video>';
    return "";
  }
  function fmtDate(d, lang) { if (!d) return ""; var x = new Date(d); if (isNaN(x)) return ""; try { return x.toLocaleDateString(lang || "es", { year: "numeric", month: "long", day: "numeric" }); } catch (e) { return x.toISOString().slice(0, 10); } }
  SR.fmtDate = fmtDate;

  function colOf(ctx, slug) { return arr(ctx.collections).find(function (c) { return c.slug === slug; }); }
  function colPath(c) { return SR.normPath(obj(c.settings).path || "/" + c.slug); }
  SR.colPath = colPath;
  function entryUrl(c, e) { return colPath(c) + "/" + e.slug; }
  SR.entryUrl = entryUrl;
  function fieldOf(c, type) { return arr(c && c.fields).find(function (f) { return f.type === type; }); }
  function entryCover(c, e) { var f = arr(c && c.fields).find(function (x) { return x.type === "image"; }); return f ? str(obj(e.data)[f.k]) : ""; }
  function entryExcerpt(c, e) {
    var d = obj(e.data); if (d.excerpt) return str(d.excerpt);
    var f = arr(c && c.fields).find(function (x) { return x.type === "textarea" || x.type === "text"; });
    if (f && d[f.k]) return str(d[f.k]);
    var r = fieldOf(c, "richtext"); return r ? clip(plain(d[r.k]), 160) : "";
  }
  function entryDate(c, e) { var f = fieldOf(c, "date"); return (f && obj(e.data)[f.k]) || e.publish_at || e.created_at; }
  SR.entryCover = entryCover; SR.entryExcerpt = entryExcerpt; SR.entryDate = entryDate;

  function cards(c, list, ctx, layout) {
    if (!list.length) return '<p class="mu">' + (ctx.preview ? "Todavía no hay entradas publicadas en esta colección. Créalas en Websites › CMS." : "Pronto habrá contenido aquí.") + "</p>";
    return '<div class="cl' + (layout === "list" ? " ls" : "") + '"><div class="g">' + list.map(function (e) {
      var cv = entryCover(c, e), dt = fmtDate(entryDate(c, e), ctx.lang);
      return '<a class="cd" href="' + esc(safeHref(entryUrl(c, e), ctx)) + '">' + img(cv, e.title) + "<div>" + (dt ? '<div class="dt">' + esc(dt) + "</div>" : "") + "<h3>" + esc(e.title) + "</h3>" + '<p class="mu">' + esc(clip(entryExcerpt(c, e), 180)) + "</p></div></a>";
    }).join("") + "</div></div>";
  }

  var RENDER = {
    hero: function (p, ctx, s) {
      var lay = p.layout || "center", h = ctx.nextH("h1"), src = safeSrc(p.image);
      var t = '<div class="hd" style="max-width:none">' + (p.eyebrow ? '<span class="ey">' + esc(p.eyebrow) + "</span>" : "") + "<" + h + ">" + esc(p.title || "") + "</" + h + ">" + (p.subtitle ? '<p class="lead mu">' + esc(p.subtitle).replace(/\n/g, "<br>") + "</p>" : "") + buttons(p.buttons, ctx) + "</div>";
      if (lay === "split") return { cls: "hero", html: '<div class="sp"><div>' + t + "</div><div>" + img(p.image, p.imageAlt || p.title, "", ' fetchpriority="high"') + "</div></div>" };
      if (lay === "bg" && src) return { cls: "hero bgi", style: "background-image:url(&quot;" + esc(src) + "&quot;)", html: t };
      return { cls: "hero" + (lay === "left" ? "" : " c"), html: t + (src ? img(p.image, p.imageAlt || p.title, "hi", ' fetchpriority="high"') : "") };
    },
    features: function (p, ctx) {
      var cols = String(p.cols || "3");
      var hs = ctx.subH();
      return { html: head(p, ctx) + '<div class="g' + (cols === "2" ? " g2" : cols === "4" ? " g4" : "") + '">' + arr(p.items).map(function (it) {
        var inner = (it.image ? img(it.image, it.title) : it.icon ? '<div class="ic" aria-hidden="true">' + esc(it.icon) + "</div>" : "") + "<" + hs + ">" + esc(it.title || "") + "</" + hs + ">" + '<p class="mu">' + esc(it.text || "").replace(/\n/g, "<br>") + "</p>";
        return it.href ? '<a class="cd" style="text-decoration:none" href="' + esc(safeHref(it.href, ctx)) + '">' + inner + "</a>" : '<div class="cd">' + inner + "</div>";
      }).join("") + "</div>" };
    },
    split: function (p, ctx) {
      return { html: '<div class="sp' + (p.reverse ? " rv" : "") + '"><div>' + head({ eyebrow: p.eyebrow, title: p.title }, ctx) + '<div class="tx">' + SR.md(p.text, ctx, 1) + "</div>" + buttons(p.buttons, ctx) + "</div><div>" + (img(p.image, p.imageAlt || p.title) || (ctx.preview ? '<div class="cd mu" style="aspect-ratio:4/3;display:grid;place-items:center">Agrega una imagen</div>' : "")) + "</div></div>" };
    },
    logos: function (p, ctx) {
      return { html: (p.title ? '<p class="mu" style="text-align:center;font-weight:600;margin-bottom:28px">' + esc(p.title) + "</p>" : "") + '<div class="lg">' + arr(p.items).map(function (it) {
        var inner = safeSrc(it.image) ? img(it.image, it.name) : "<span>" + esc(it.name || "") + "</span>";
        return it.href ? '<a href="' + esc(safeHref(it.href, ctx)) + '" rel="noopener">' + inner + "</a>" : inner;
      }).join("") + "</div>" };
    },
    stats: function (p, ctx) { return { html: head(p, ctx) + '<div class="g g4">' + arr(p.items).map(function (it) { return '<div class="st"><b>' + esc(it.value || "") + '</b><span class="mu">' + esc(it.label || "") + "</span></div>"; }).join("") + "</div>" }; },
    testimonials: function (p, ctx) {
      return { html: head(p, ctx) + '<div class="g g2">' + arr(p.items).map(function (it) {
        return '<figure class="cd" style="margin:0"><blockquote class="tq" style="margin:0 0 20px">“' + esc(it.quote || "") + '”</blockquote><figcaption class="pp">' + img(it.image, it.name) + "<div><b>" + esc(it.name || "") + "</b><small>" + esc(it.role || "") + "</small></div></figcaption></figure>";
      }).join("") + "</div>" };
    },
    pricing: function (p, ctx) {
      var hs = ctx.subH();
      return { html: head(p, ctx) + '<div class="g">' + arr(p.items).map(function (it) {
        var f = str(it.features).split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
        return '<div class="cd pr' + (it.featured ? " ft" : "") + '"><' + hs + ">" + esc(it.name || "") + "</" + hs + ">" + (it.desc ? '<p class="mu" style="margin:0">' + esc(it.desc) + "</p>" : "") + '<div class="pz">' + esc(it.price || "") + (it.period ? " <small>" + esc(it.period) + "</small>" : "") + "</div><ul>" + f.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" + (it.label ? '<a class="b' + (it.featured ? "" : " o") + '" href="' + esc(safeHref(it.href, ctx)) + '">' + esc(it.label) + "</a>" : "") + "</div>";
      }).join("") + "</div>" };
    },
    faq: function (p, ctx) {
      var items = arr(p.items).filter(function (x) { return x && str(x.q).trim(); });
      ctx.faq = (ctx.faq || []).concat(items);
      return { html: head(p, ctx) + '<div class="fq">' + items.map(function (it, i) { return "<details" + (i === 0 ? " open" : "") + "><summary>" + esc(it.q) + '</summary><div class="an">' + SR.md(it.a, ctx) + "</div></details>"; }).join("") + "</div>" };
    },
    cta: function (p, ctx) { var t = ctx.nextH(); return { html: '<div class="hd" style="margin-bottom:0;max-width:820px">' + "<" + t + ">" + esc(p.title || "") + "</" + t + ">" + (p.text ? '<p class="lead mu">' + esc(p.text) + "</p>" : "") + buttons(p.buttons, ctx) + "</div>" }; },
    form: function (p, ctx, s) {
      var f = obj(p._form), fields = arr(f.fields);
      var body;
      if (!f.token && !ctx.preview) body = "";
      else {
        if (!fields.length) fields = [{ name: "nombre", label: "Nombre", type: "Texto", required: true }, { name: "email", label: "Email", type: "Email", required: true }, { name: "mensaje", label: "Mensaje", type: "Párrafo" }];
        var T = { Email: "email", "Teléfono": "tel", "Número": "number", Fecha: "date" };
        body = '<form class="fm" data-mform="' + esc(f.token || "") + '" data-ok="' + esc(p.success || "¡Gracias! Te escribimos pronto.") + '">' + fields.slice(0, 30).map(function (x) {
          var nm = esc(x.name), lab = esc(x.label || x.name) + (x.required ? " *" : ""), rq = x.required ? " required" : "";
          if (x.type === "Párrafo") return "<label>" + lab + '<textarea name="' + nm + '" maxlength="4000"' + rq + "></textarea></label>";
          if (x.type === "Opciones" && arr(x.options).length) return "<label>" + lab + '<select name="' + nm + '"' + rq + '><option value="">Elige…</option>' + arr(x.options).map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select></label>";
          return "<label>" + lab + '<input type="' + (T[x.type] || "text") + '" name="' + nm + '" maxlength="400"' + rq + (T[x.type] === "email" ? ' autocomplete="email"' : "") + "></label>";
        }).join("") + '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="b" type="submit">' + esc(p.submit || "Enviar") + '</button><p class="er" role="alert"></p></form>';
        if (!f.token && ctx.preview) body += '<p class="mu" style="font-size:13px;margin-top:10px">Vista previa: elige un formulario de Musa para recibir las respuestas en el CRM.</p>';
        ctx.hasForm = true;
      }
      return { html: head(p, ctx) + body };
    },
    gallery: function (p, ctx) {
      var it = arr(p.items).filter(function (x) { return safeSrc(x.image); });
      return { html: head(p, ctx) + (it.length ? '<div class="ga">' + it.map(function (x) { return "<figure>" + img(x.image, x.alt || x.caption) + (x.caption ? "<figcaption>" + esc(x.caption) + "</figcaption>" : "") + "</figure>"; }).join("") + "</div>" : ctx.preview ? '<p class="mu">Agrega imágenes a la galería.</p>' : "") };
    },
    collection: function (p, ctx) {
      var c = colOf(ctx, p.collection);
      if (!c) return { html: head(p, ctx) + (ctx.preview ? '<p class="mu">Elige una colección del CMS.</p>' : "") };
      var list = arr(obj(ctx.entries)[c.slug]).slice(0, Math.max(1, Math.min(48, parseInt(p.limit, 10) || 3)));
      return { html: head(p, ctx) + cards(c, list, ctx, p.layout) + (p.more ? '<div class="bt"><a class="b o" href="' + esc(safeHref(colPath(c), ctx)) + '">' + esc(p.more) + "</a></div>" : "") };
    },
    text: function (p, ctx) { return { html: '<div class="tx">' + SR.md(p.md, ctx, ctx.h1Done ? 0 : 0) + "</div>" }; },
    video: function (p, ctx) { var v = videoEmbed(p.url); return { html: head(p, ctx) + (v || (ctx.preview ? '<p class="mu">Pega una URL de YouTube, Vimeo o un .mp4.</p>' : "")) }; },
    design: function (p, ctx) {
      var d = obj(p._design), inner = "";
      if (d.html) {
        var w = parseInt(d.width, 10) || 1080, h = parseInt(d.height, 10) || 1080;
        inner = '<div class="dz" data-w="' + w + '" style="aspect-ratio:' + w + "/" + h + '"><div class="dzi" style="width:' + w + "px;height:" + h + 'px">' + (d.css ? "<style>" + str(d.css).replace(/<\/style/gi, "") + "</style>" : "") + SR.sanitize(d.html) + "</div></div>";
        ctx.hasDesign = true;
      } else if (safeSrc(d.image)) inner = img(d.image, p.alt || d.name);
      else if (ctx.preview) inner = '<p class="mu">Elige un diseño de Crear › Diseños.</p>';
      if (inner && p.href) inner = '<a href="' + esc(safeHref(p.href, ctx)) + '" aria-label="' + esc(p.alt || d.name || "") + '">' + inner + "</a>";
      return { html: inner };
    },
    html: function (p) { return { html: SR.sanitize(p.html) }; },
  };

  function section(s, ctx) {
    var fn = RENDER[s.type]; if (!fn) return "";
    var st = obj(s.style), r = fn(obj(s.props), ctx, s) || {};
    var cls = ["s", r.cls || "", st.bg || "", st.align === "c" ? "c" : "", st.pad || ""].filter(Boolean).join(" ").replace(/\bc c\b/, "c");
    var id = str(st.anchor).replace(/[^a-z0-9_-]/gi, "") || (s.type === "form" ? "contacto" : "");
    return "<section" + (id ? ' id="' + esc(id) + '"' : "") + ' class="' + cls + '"' + (r.style ? ' style="' + r.style + '"' : "") + (ctx.preview ? ' data-sec="' + esc(s.id) + '"' : "") + '><div class="w">' + r.html + "</div></section>";
  }

  /* ───────────────────────── página completa ───────────────────────── */
  function absUrl(ctx, path) { var o = str(ctx.origin).replace(/\/$/, ""), b = str(ctx.base); return o + b + (path === "/" ? "/" : path); }
  SR.absUrl = absUrl;
  function headerHtml(site, ctx) {
    var st = obj(site.settings), nav = arr(st.nav).filter(function (n) { return n && str(n.label).trim(); }), cta = obj(st.cta), logo = safeSrc(st.logo);
    if (st.header === false) return "";
    var links = nav.map(function (n) { return '<a href="' + esc(safeHref(n.href, ctx)) + '">' + esc(n.label) + "</a>"; }).join("");
    var ctaH = cta.label ? '<a class="b" href="' + esc(safeHref(cta.href, ctx)) + '">' + esc(cta.label) + "</a>" : "";
    return '<header class="hdr"><div class="w"><a class="lo" href="' + esc(safeHref("/", ctx)) + '">' + (logo ? '<img src="' + esc(logo) + '" alt="' + esc(site.name) + '">' + (st.logoText === false ? "" : "<span>" + esc(site.name) + "</span>") : "<span>" + esc(site.name) + "</span>") + "</a>"
      + '<nav class="nv" aria-label="Principal">' + links + ctaH + "</nav>"
      + ((links || ctaH) ? '<details class="mn"><summary aria-label="Menú"><i></i></summary><div class="mp">' + links + ctaH + "</div></details>" : "") + "</div></header>";
  }
  function footerHtml(site, ctx) {
    var st = obj(site.settings), f = obj(st.footer), links = arr(f.links).filter(function (n) { return n && n.label; }), soc = arr(obj(st.org).sameAs).filter(Boolean);
    var lk = links.map(function (n) { return '<a href="' + esc(safeHref(n.href, ctx)) + '">' + esc(n.label) + "</a>"; }).join("");
    var sc = soc.map(function (u) { var h = safeHref(u, ctx), nm = (str(u).match(/(instagram|facebook|linkedin|tiktok|youtube|x\.com|twitter|threads|behance|dribbble|github|wa\.me|whatsapp)/i) || [])[1] || "Red"; nm = { "x.com": "X", "wa.me": "WhatsApp" }[nm.toLowerCase()] || nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase(); return '<a href="' + esc(h) + '" rel="noopener me" target="_blank">' + esc(nm) + "</a>"; }).join("");
    return '<footer class="ftr"><div class="w"><div><b style="font-family:var(--fh);font-size:18px">' + esc(site.name) + "</b>" + (f.text ? '<p class="mu" style="margin:6px 0 0;max-width:42ch">' + esc(f.text) + "</p>" : "") + "</div>" + (lk ? '<nav aria-label="Pie">' + lk + "</nav>" : "") + (sc ? '<nav aria-label="Redes">' + sc + "</nav>" : "") + '<div class="cp">© ' + new Date().getFullYear() + " " + esc(obj(st.org).name || site.name) + (f.legal ? " · " + esc(f.legal) : "") + "</div></div></footer>";
  }

  function jsonLd(graph) { return '<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c") + "</script>"; }
  function orgNode(site, ctx) {
    var st = obj(site.settings), o = obj(st.org), n = { "@type": o.type || "Organization", "@id": absUrl(ctx, "/") + "#org", name: o.name || site.name, url: absUrl(ctx, "/") };
    if (safeSrc(o.logo || st.logo)) n.logo = o.logo || st.logo;
    var same = arr(o.sameAs).filter(function (u) { return /^https?:/i.test(u); }); if (same.length) n.sameAs = same;
    if (o.email) n.email = o.email; if (o.phone) n.telephone = o.phone;
    if (o.address) n.address = o.address;
    if (st.ai && st.ai.summary) n.description = clip(st.ai.summary, 300);
    return n;
  }

  /** Documento HTML completo. kind: page | entry | list. */
  function doc(site, ctx, o) {
    var th = SR.theme(site, ctx.brand), st = obj(site.settings), lang = str(st.lang || "es");
    var titleT = str(st.titleTemplate || "%s · " + site.name);
    var title = o.title ? (o.isHome && !o.seoTitle ? site.name + (st.tagline ? " · " + st.tagline : "") : (o.seoTitle || titleT.replace("%s", o.title))) : site.name;
    var desc = clip(o.description || st.description || "", 170);
    var url = absUrl(ctx, o.path), og = safeSrc(o.ogImage || st.ogImage);
    var robots = (o.noindex || st.index === false || ctx.noindex) ? "noindex, nofollow" : "index, follow, max-image-preview:large";
    var h = ['<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>" + esc(title) + "</title>", desc ? '<meta name="description" content="' + esc(desc) + '">' : "",
      '<meta name="robots" content="' + robots + '">', ctx.preview ? "" : '<link rel="canonical" href="' + esc(o.canonical && /^https?:/.test(o.canonical) ? o.canonical : url) + '">',
      '<meta property="og:type" content="' + (o.kind === "entry" ? "article" : "website") + '"><meta property="og:title" content="' + esc(o.seoTitle || o.title || site.name) + '"><meta property="og:site_name" content="' + esc(site.name) + '"><meta property="og:url" content="' + esc(url) + '">' + (desc ? '<meta property="og:description" content="' + esc(desc) + '">' : "") + (og ? '<meta property="og:image" content="' + esc(og) + '"><meta name="twitter:image" content="' + esc(og) + '">' : ""),
      '<meta name="twitter:card" content="' + (og ? "summary_large_image" : "summary") + '"><meta name="theme-color" content="' + th.accent + '">',
      safeSrc(st.favicon) ? '<link rel="icon" href="' + esc(st.favicon) + '">' : '<link rel="icon" href="data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="' + th.accent + '"/><text x="32" y="44" font-size="34" font-family="Arial" font-weight="700" text-anchor="middle" fill="' + th.accentFg + '">' + esc(str(site.name).charAt(0).toUpperCase() || "M") + "</text></svg>") + '">',
      arr(ctx.collections).filter(function (c) { return obj(c.settings).rss !== false; }).map(function (c) { return '<link rel="alternate" type="application/rss+xml" title="' + esc(site.name + " · " + c.name) + '" href="' + esc(absUrl(ctx, colPath(c) + "/rss.xml")) + '">'; }).join(""),
      st.ai && st.ai.llms === false ? "" : '<link rel="alternate" type="text/markdown" title="llms.txt" href="' + esc(absUrl(ctx, "/llms.txt")) + '">',
      fontsLink(th), "<style>" + css(th) + "</style>"];
    var graph = [{ "@type": "WebSite", "@id": absUrl(ctx, "/") + "#website", url: absUrl(ctx, "/"), name: site.name, inLanguage: lang, publisher: { "@id": absUrl(ctx, "/") + "#org" } }, orgNode(site, ctx)];
    graph.push({ "@type": o.kind === "list" ? "CollectionPage" : (o.pageType || "WebPage"), "@id": url + "#webpage", url: url, name: o.seoTitle || o.title || site.name, description: desc || undefined, isPartOf: { "@id": absUrl(ctx, "/") + "#website" }, inLanguage: lang });
    if (o.crumbs && o.crumbs.length > 1) graph.push({ "@type": "BreadcrumbList", itemListElement: o.crumbs.map(function (c, i) { return { "@type": "ListItem", position: i + 1, name: c[0], item: absUrl(ctx, c[1]) }; }) });
    if (o.ld) graph.push(o.ld);
    if (ctx.faq && ctx.faq.length) graph.push({ "@type": "FAQPage", mainEntity: ctx.faq.map(function (f) { return { "@type": "Question", name: str(f.q), acceptedAnswer: { "@type": "Answer", text: plain(f.a) } }; }) });
    h.push(jsonLd(graph));
    var an = obj(st.analytics), nonce = ctx.nonce ? ' nonce="' + esc(ctx.nonce) + '"' : "";
    if (!ctx.preview && /^G-[A-Z0-9]{4,}$/.test(str(an.ga))) h.push('<script async src="https://www.googletagmanager.com/gtag/js?id=' + esc(an.ga) + '"' + nonce + "></script><script" + nonce + ">window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','" + an.ga + "');</script>");
    if (!ctx.preview && /^\d{6,20}$/.test(str(an.pixel))) h.push("<script" + nonce + ">!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" + an.pixel + "');fbq('track','PageView');</script>");
    // Google Tag Manager, Hotjar y verificación de Search Console (los ids se validan: nunca entra texto libre al script)
    if (!ctx.preview && /^GTM-[A-Z0-9]{4,12}$/.test(str(an.gtm))) h.push("<script" + nonce + ">(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;" + (ctx.nonce ? "j.setAttribute('nonce','" + esc(ctx.nonce) + "');" : "") + "f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + an.gtm + "');</script>");
    if (!ctx.preview && /^\d{5,10}$/.test(str(an.hotjar))) h.push("<script" + nonce + ">(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:" + an.hotjar + ",hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');</script>");
    if (/^[A-Za-z0-9_-]{20,80}$/.test(str(an.gsc))) h.splice(1, 0, '<meta name="google-site-verification" content="' + esc(an.gsc) + '">');
    h.push("</head><body>" + headerHtml(site, ctx) + "<main>" + o.body + "</main>" + footerHtml(site, ctx));
    if (ctx.badge) h.push('<a class="mbadge" href="https://musa-v2.renzo-08c.workers.dev/?ref=site" rel="noopener" target="_blank">Hecho con <b>Musa</b></a>');
    var js = "";
    if (ctx.hasForm) js += "document.querySelectorAll('form[data-mform]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var t=f.getAttribute('data-mform'),er=f.querySelector('.er'),b=f.querySelector('button');if(!t){er.textContent='Formulario en vista previa: no se envía.';return}var d={};new FormData(f).forEach(function(v,k){d[k]=v});var qr=new URLSearchParams(location.search).get('qr');if(qr)d.__qr=qr;b.disabled=true;er.textContent='';fetch(" + JSON.stringify(ctx.formAction || "") + "+t,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'No se pudo enviar');return j})}).then(function(){var ok=document.createElement('div');ok.className='ok';ok.setAttribute('role','status');ok.textContent=f.getAttribute('data-ok');f.replaceWith(ok)}).catch(function(x){b.disabled=false;er.textContent=x.message})})});";
    if (ctx.hasDesign) js += "function mz(){document.querySelectorAll('.dz').forEach(function(z){var w=+z.getAttribute('data-w')||1080,i=z.firstElementChild;if(i)i.style.transform='scale('+(z.clientWidth/w)+')'})}mz();addEventListener('resize',mz);";
    if (ctx.preview) js += "document.addEventListener('click',function(e){var a=e.target.closest('a,button');if(a)e.preventDefault();var s=e.target.closest('[data-sec]');parent.postMessage({wb:'sel',id:s?s.getAttribute('data-sec'):null,area:e.target.closest('.hdr')?'hdr':e.target.closest('.ftr')?'ftr':null},'*')},true);addEventListener('message',function(e){var d=e.data||{};if(d.wb==='hl'){document.querySelectorAll('[data-sec]').forEach(function(s){s.style.outline=s.getAttribute('data-sec')===d.id?'3px solid #ff5e00':'';s.style.outlineOffset='-3px'});if(d.scroll){var t=document.querySelector('[data-sec=\"'+d.id+'\"]');if(t)t.scrollIntoView({block:'start',behavior:'smooth'})}}});document.querySelectorAll('[data-sec]').forEach(function(s){s.style.cursor='pointer'});var tx=null;addEventListener('touchstart',function(e){var t=e.touches[0];tx=[t.clientX,t.clientY]},{passive:true});addEventListener('touchend',function(e){var t=e.changedTouches[0];if(!tx||Math.abs(t.clientX-tx[0])>10||Math.abs(t.clientY-tx[1])>10)return;var el=document.elementFromPoint(t.clientX,t.clientY);if(!el)return;var s=el.closest('[data-sec]');parent.postMessage({wb:'sel',id:s?s.getAttribute('data-sec'):null,area:el.closest('.hdr')?'hdr':el.closest('.ftr')?'ftr':null},'*')},{passive:true});var st=0;addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(function(){parent.postMessage({wb:'scroll',y:scrollY},'*')},80)},{passive:true});" + (ctx.scrollY ? "scrollTo(0," + (parseInt(ctx.scrollY, 10) || 0) + ");" : "") + (ctx.hl ? "(function(){var s=document.querySelector('[data-sec=\"" + String(ctx.hl).replace(/[^a-z0-9_]/gi, "") + "\"]');if(s){s.style.outline='3px solid #ff5e00';s.style.outlineOffset='-3px'}})();" : "");
    if (js) h.push("<script" + nonce + ">" + js + "</script>");
    h.push("</body></html>");
    return h.filter(Boolean).join("");
  }

  function mkCtx(ctx) {
    var c = {}; Object.keys(ctx || {}).forEach(function (k) { c[k] = ctx[k]; });
    c.h1Done = false; c.lastH = "h2"; c.faq = []; c.hasForm = false; c.hasDesign = false;
    c.nextH = function (want) { var t = (!c.h1Done && (want === "h1" || true)) ? "h1" : "h2"; if (want === "h1" && c.h1Done) t = "h2"; c.h1Done = true; c.lastH = t; return t; };
    c.subH = function () { return c.lastH === "h1" ? "h2" : "h3"; };
    return c;
  }
  SR.renderSections = function (site, sections, ctx) { var c = mkCtx(ctx); return arr(sections).map(function (s) { return section(s, c); }).join(""); };

  SR.renderPage = function (site, page, ctx) {
    var c = mkCtx(ctx), seo = obj(page.seo);
    var body = arr(page.sections).map(function (s) { return section(s, c); }).join("");
    if (!body && c.preview) body = '<section class="s c"><div class="w"><p class="mu">Página vacía. Agrega una sección desde el panel.</p></div></section>';
    var path = SR.normPath(page.path), isHome = path === "/";
    var crumbs = isHome ? null : [[site.name, "/"], [page.title || path, path]];
    return doc(site, c, { kind: "page", path: path, isHome: isHome, title: page.title, seoTitle: seo.title, description: seo.description || obj(site.settings).description || firstText(page), ogImage: seo.ogImage || firstImage(page), canonical: seo.canonical, noindex: seo.noindex, crumbs: crumbs, body: body, pageType: seo.pageType });
  };
  function firstText(page) { var s = arr(page.sections).map(function (x) { var p = obj(x.props); return p.subtitle || p.text || (p.md ? plain(p.md) : ""); }).filter(Boolean)[0]; return clip(plain(s), 160); }
  function firstImage(page) { var s = arr(page.sections).map(function (x) { return safeSrc(obj(x.props).image); }).filter(Boolean)[0]; return s || ""; }
  SR.firstText = firstText;

  SR.renderList = function (site, col, entries, ctx) {
    var c = mkCtx(ctx), st = obj(col.settings), path = colPath(col);
    var body = '<section class="s"><div class="w"><div class="hd"><h1>' + esc(st.title || col.name) + "</h1>" + (st.description ? '<p class="lead mu">' + esc(st.description) + "</p>" : "") + "</div>" + cards(col, arr(entries), c, st.layout) + "</div></section>";
    c.h1Done = true;
    return doc(site, c, { kind: "list", path: path, title: st.title || col.name, description: st.description || (col.name + " de " + site.name), crumbs: [[site.name, "/"], [col.name, path]], body: body });
  };

  SR.renderEntry = function (site, col, e, ctx) {
    var c = mkCtx(ctx), d = obj(e.data), seo = obj(e.seo), path = entryUrl(col, e), cv = entryCover(col, e), dt = entryDate(col, e);
    var parts = [], used = {};
    arr(col.fields).forEach(function (f) {
      var v = d[f.k]; if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
      if (f.type === "image" && v === cv && !used.cover) { used.cover = 1; return; }
      if (f.type === "date" && v === dt) return;
      if (f.k === "excerpt") return;
      if (f.type === "richtext") parts.push('<div class="tx" style="margin-top:28px">' + SR.md(v, c, 0) + "</div>");
      else if (f.type === "image") parts.push(img(v, e.title, "cv"));
      else if (f.type === "url") parts.push('<div class="fl"><b>' + esc(f.label) + '</b><a href="' + esc(safeHref(v, c)) + '" rel="noopener">' + esc(v) + "</a></div>");
      else if (f.type === "bool") parts.push(v ? '<div class="fl"><b>' + esc(f.label) + "</b>Sí</div>" : "");
      else if (f.type === "tags" || f.type === "select") parts.push('<div class="fl"><b>' + esc(f.label) + "</b>" + (Array.isArray(v) ? v : str(v).split(",")).map(function (t) { return '<span class="tg">' + esc(String(t).trim()) + "</span>"; }).join("") + "</div>");
      else if (f.type === "textarea") parts.push('<p class="lead mu">' + esc(v).replace(/\n/g, "<br>") + "</p>");
      else parts.push('<div class="fl"><b>' + esc(f.label) + "</b>" + esc(f.type === "date" ? fmtDate(v, c.lang) : v) + "</div>");
    });
    var excerpt = entryExcerpt(col, e);
    var body = '<article class="s ent"><div class="w"><div class="tx" style="max-width:820px;margin:0 auto">' + '<nav class="bc" aria-label="Migas"><a href="' + esc(safeHref("/", c)) + '">' + esc(site.name) + '</a> › <a href="' + esc(safeHref(colPath(col), c)) + '">' + esc(col.name) + "</a></nav><h1>" + esc(e.title) + "</h1>"
      + (dt || d.author ? '<div class="mt">' + (dt ? "<time datetime=\"" + esc(new Date(dt).toISOString ? (isNaN(new Date(dt)) ? "" : new Date(dt).toISOString()) : "") + '">' + esc(fmtDate(dt, c.lang)) + "</time>" : "") + (d.author ? "<span>" + esc(d.author) + "</span>" : "") + "</div>" : "")
      + (cv ? img(cv, e.title, "cv", ' fetchpriority="high"') : "") + (d.excerpt ? '<p class="lead mu" style="margin-top:20px">' + esc(d.excerpt) + "</p>" : "") + parts.join("") + "</div></div></article>";
    c.h1Done = true;
    var type = obj(col.settings).schema === undefined ? "BlogPosting" : obj(col.settings).schema;
    var ld = null;
    if (type) {
      ld = { "@type": type, "@id": absUrl(c, path) + "#item", name: e.title, url: absUrl(c, path), description: clip(seo.description || excerpt, 300) || undefined, image: safeSrc(seo.ogImage || cv) || undefined, inLanguage: str(obj(site.settings).lang || "es") };
      if (/Posting|Article/.test(type)) { ld.headline = clip(e.title, 110); ld.datePublished = dt ? new Date(dt).toISOString() : undefined; ld.dateModified = e.updated_at ? new Date(e.updated_at).toISOString() : undefined; ld.author = d.author ? { "@type": "Person", name: d.author } : { "@id": absUrl(c, "/") + "#org" }; ld.publisher = { "@id": absUrl(c, "/") + "#org" }; ld.mainEntityOfPage = absUrl(c, path); }
      if (type === "Product" && d.price) ld.offers = { "@type": "Offer", price: String(d.price).replace(/[^\d.,]/g, "").replace(",", "."), priceCurrency: d.currency || "PEN", availability: "https://schema.org/InStock" };
      if (type === "Event" && dt) ld.startDate = new Date(dt).toISOString();
    }
    return doc(site, c, { kind: "entry", path: path, title: e.title, seoTitle: seo.title, description: seo.description || excerpt, ogImage: seo.ogImage || cv, canonical: seo.canonical, noindex: seo.noindex, crumbs: [[site.name, "/"], [col.name, colPath(col)], [e.title, path]], body: body, ld: ld });
  };

  /* ───────────────────────── archivos para buscadores e IA ───────────────────────── */
  function xmlEsc(s) { return esc(s); }
  SR.sitemap = function (site, pages, cols, entries, ctx) {
    var urls = [];
    arr(pages).forEach(function (p) { if (!p.hidden && !obj(p.seo).noindex) urls.push([SR.normPath(p.path), p.updated_at, SR.normPath(p.path) === "/" ? "1.0" : "0.8"]); });
    arr(cols).forEach(function (c) {
      var list = arr(obj(entries)[c.slug]);
      if (obj(c.settings).listPage !== false && !arr(pages).some(function (p) { return SR.normPath(p.path) === colPath(c); })) urls.push([colPath(c), list[0] && list[0].updated_at, "0.6"]);
      if (obj(c.settings).detail !== false) list.forEach(function (e) { if (!obj(e.seo).noindex) urls.push([entryUrl(c, e), e.updated_at, "0.6"]); });
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(function (u) { return "  <url><loc>" + xmlEsc(absUrl(ctx, u[0])) + "</loc>" + (u[1] ? "<lastmod>" + new Date(u[1]).toISOString().slice(0, 10) + "</lastmod>" : "") + "<priority>" + u[2] + "</priority></url>"; }).join("\n") + "\n</urlset>\n";
  };
  SR.AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider", "Meta-ExternalAgent"];
  SR.robots = function (site, ctx) {
    var st = obj(site.settings), ai = obj(st.ai), lines = [];
    if (st.index === false || ctx.noindex) return "User-agent: *\nDisallow: /\n";
    if (ai.allowBots === false) SR.AI_BOTS.forEach(function (b) { lines.push("User-agent: " + b + "\nDisallow: /\n"); });
    lines.push("User-agent: *\nAllow: /\nDisallow: /_form/\n");
    lines.push("Sitemap: " + absUrl(ctx, "/sitemap.xml"));
    return lines.join("\n") + "\n";
  };
  /** Una página en markdown limpio (para llms-full.txt y para respuestas de IA). */
  SR.pageMarkdown = function (page, ctx) {
    var out = [];
    arr(page.sections).forEach(function (s) {
      var p = obj(s.props);
      if (p.eyebrow) out.push("_" + p.eyebrow + "_");
      if (p.title) out.push((s.type === "hero" ? "# " : "## ") + p.title);
      if (p.subtitle) out.push(p.subtitle);
      if (p.text && s.type !== "faq") out.push(p.text);
      if (p.md) out.push(p.md);
      if (s.type === "faq") arr(p.items).forEach(function (q) { out.push("### " + q.q + "\n" + q.a); });
      else if (s.type === "pricing") arr(p.items).forEach(function (q) { out.push("- **" + q.name + "**: " + q.price + (q.period ? " " + q.period : "") + (q.features ? " — " + str(q.features).split(/\n+/).join("; ") : "")); });
      else if (s.type === "stats") arr(p.items).forEach(function (q) { out.push("- " + q.value + " " + q.label); });
      else if (s.type === "testimonials") arr(p.items).forEach(function (q) { out.push("> " + q.quote + " — " + q.name + (q.role ? ", " + q.role : "")); });
      else arr(p.items).forEach(function (q) { if (q && (q.title || q.name)) out.push("- **" + (q.title || q.name) + "**" + (q.text ? ": " + q.text : "")); });
      arr(p.buttons).forEach(function (b) { if (b && b.label && /^(https?:|\/)/.test(str(b.href))) out.push("[" + b.label + "](" + (/^\//.test(b.href) ? absUrl(ctx, b.href) : b.href) + ")"); });
    });
    return out.filter(Boolean).join("\n\n");
  };
  SR.llms = function (site, pages, cols, entries, ctx, full) {
    var st = obj(site.settings), ai = obj(st.ai), o = obj(st.org), out = ["# " + site.name];
    var sum = ai.summary || st.description; if (sum) out.push("> " + str(sum).replace(/\n+/g, " "));
    var facts = [];
    if (o.type && o.type !== "Organization") facts.push("Tipo: " + o.type);
    if (o.address) facts.push("Ubicación: " + (typeof o.address === "string" ? o.address : [o.address.addressLocality, o.address.addressCountry].filter(Boolean).join(", ")));
    if (o.email) facts.push("Contacto: " + o.email); if (o.phone) facts.push("Teléfono: " + o.phone);
    arr(o.sameAs).forEach(function (u) { facts.push("Perfil: " + u); });
    if (facts.length) out.push(facts.map(function (f) { return "- " + f; }).join("\n"));
    if (ai.facts) out.push(str(ai.facts));
    var vis = arr(pages).filter(function (p) { return !p.hidden && !obj(p.seo).noindex; });
    if (!full) {
      out.push("## Páginas\n" + vis.map(function (p) { return "- [" + (p.title || p.path) + "](" + absUrl(ctx, SR.normPath(p.path)) + ")" + (obj(p.seo).description || firstText(p) ? ": " + clip(obj(p.seo).description || firstText(p), 160) : ""); }).join("\n"));
      arr(cols).forEach(function (c) {
        var list = arr(obj(entries)[c.slug]).slice(0, 50); if (!list.length) return;
        out.push("## " + c.name + "\n" + list.map(function (e) { return "- [" + e.title + "](" + absUrl(ctx, entryUrl(c, e)) + ")" + (entryExcerpt(c, e) ? ": " + clip(entryExcerpt(c, e), 140) : ""); }).join("\n"));
      });
      out.push("## Opcional\n- [Contenido completo](" + absUrl(ctx, "/llms-full.txt") + ")\n- [Mapa del sitio](" + absUrl(ctx, "/sitemap.xml") + ")");
    } else {
      vis.forEach(function (p) { out.push("---\nURL: " + absUrl(ctx, SR.normPath(p.path)) + "\n\n" + SR.pageMarkdown(p, ctx)); });
      arr(cols).forEach(function (c) {
        arr(obj(entries)[c.slug]).slice(0, 100).forEach(function (e) {
          var d = obj(e.data), body = arr(c.fields).map(function (f) { var v = d[f.k]; if (v == null || v === "" || f.type === "image") return ""; return f.type === "richtext" ? str(v) : "**" + f.label + ":** " + (Array.isArray(v) ? v.join(", ") : v); }).filter(Boolean).join("\n\n");
          out.push("---\nURL: " + absUrl(ctx, entryUrl(c, e)) + "\n\n# " + e.title + "\n\n" + body);
        });
      });
    }
    return out.join("\n\n") + "\n";
  };
  SR.rss = function (site, col, entries, ctx) {
    var list = arr(entries).slice(0, 30);
    return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>' + xmlEsc(site.name + " · " + col.name) + "</title><link>" + xmlEsc(absUrl(ctx, colPath(col))) + "</link><description>" + xmlEsc(obj(col.settings).description || col.name) + '</description><atom:link href="' + xmlEsc(absUrl(ctx, colPath(col) + "/rss.xml")) + '" rel="self" type="application/rss+xml"/><language>' + xmlEsc(obj(site.settings).lang || "es") + "</language>"
      + list.map(function (e) { var u = absUrl(ctx, entryUrl(col, e)), d = entryDate(col, e); return "<item><title>" + xmlEsc(e.title) + "</title><link>" + xmlEsc(u) + '</link><guid isPermaLink="true">' + xmlEsc(u) + "</guid>" + (d && !isNaN(new Date(d)) ? "<pubDate>" + new Date(d).toUTCString() + "</pubDate>" : "") + "<description>" + xmlEsc(clip(entryExcerpt(col, e), 300)) + "</description></item>"; }).join("") + "</channel></rss>\n";
  };

  /* ───────────────────────── auditoría SEO / GEO / AEO ───────────────────────── */
  /** Revisa una página (o entrada) y devuelve puntaje y qué arreglar. Determinista, sin IA. */
  SR.audit = function (site, page, ctx) {
    ctx = ctx || {};
    var st = obj(site.settings), seo = obj(page.seo), secs = arr(page.sections), checks = [];
    function add(group, ok, w, text, fix, sec) { checks.push({ group: group, ok: !!ok, weight: w, text: text, fix: ok ? "" : fix, section: sec || null }); }
    var title = str(seo.title || page.title).trim(), isHome = SR.normPath(page.path) === "/";
    var effTitle = isHome && !seo.title ? site.name + (st.tagline ? " · " + st.tagline : "") : title;
    /* la misma descripción que llega a Google: la de la página, si no la del sitio, si no su primer texto */
    var descFrom = seo.description ? "de la página" : st.description ? "del sitio" : "tomada del primer texto";
    var desc = str(seo.description || st.description || firstText(page)).trim();
    var hero = secs.find(function (s) { return s.type === "hero"; });
    var h1 = secs.filter(function (s) { return obj(s.props).title; })[0];
    var md = SR.pageMarkdown(page, ctx), wc = words(md);
    var imgs = []; secs.forEach(function (s) { var p = obj(s.props); if (safeSrc(p.image)) imgs.push([s, p.imageAlt || p.title || p.alt]); arr(p.items).forEach(function (it) { if (safeSrc(it.image)) imgs.push([s, it.alt || it.title || it.name || it.caption]); }); });
    var links = 0; secs.forEach(function (s) { var p = obj(s.props); arr(p.buttons).concat(arr(p.items)).forEach(function (b) { if (b && /^\/|^#/.test(str(b.href))) links++; }); if (/\]\(\//.test(str(p.md) + str(p.text))) links++; });
    links += arr(st.nav).length;
    var faq = secs.filter(function (s) { return s.type === "faq"; }), faqItems = []; faq.forEach(function (s) { faqItems = faqItems.concat(arr(obj(s.props).items).filter(function (x) { return x && x.q && x.a; })); });
    var hasStats = secs.some(function (s) { return s.type === "stats"; }) || /\d+\s?(%|clientes|años|personas|proyectos)/i.test(md);
    // SEO
    add("seo", effTitle.length >= 15 && effTitle.length <= 65, 10, "Título de " + effTitle.length + " caracteres (ideal 15–65)", "Escribe en SEO un título que diga qué ofreces y para quién.");
    add("seo", desc.length >= 70 && desc.length <= 170, 10, desc ? "Descripción " + descFrom + ": " + desc.length + " caracteres (ideal 70–170)" : "Falta la descripción", "Escribe la descripción que saldrá en Google: beneficio + llamada a la acción.");
    add("seo", !!h1, 8, h1 ? "Tiene un título principal (H1)" : "La página no tiene título principal (H1)", "Agrega una Portada con título.", h1 && h1.id);
    add("seo", wc >= (isHome ? 150 : 250), 8, wc + " palabras de contenido", "Suma texto útil: beneficios, proceso, preguntas. Las páginas con poco texto casi no posicionan.");
    var noAlt = imgs.filter(function (x) { return !str(x[1]).trim(); });
    add("seo", !noAlt.length, 6, imgs.length ? (noAlt.length ? noAlt.length + " imagen(es) sin texto alternativo" : "Todas las imágenes tienen texto alternativo") : "Sin imágenes (está bien, pero ayudan)", "Completa el «texto alternativo» de cada imagen.", noAlt[0] && noAlt[0][0].id);
    add("seo", !!safeSrc(seo.ogImage || st.ogImage || firstImage(page)), 5, "Imagen para compartir en redes", "Sube una imagen para compartir (1200×630) en SEO de la página o del sitio.");
    add("seo", links >= 1, 4, links + " enlace(s) internos", "Enlaza a otras páginas tuyas (menú o botones).");
    add("seo", !seo.noindex && st.index !== false, 8, seo.noindex || st.index === false ? "La página está oculta para buscadores" : "Visible para buscadores", "Desactiva «No indexar» si quieres aparecer en Google.");
    add("seo", /^\/[a-z0-9/-]*$/.test(SR.normPath(page.path)) && SR.normPath(page.path).length <= 60, 3, "URL corta y legible", "Usa una URL corta con palabras clave, como /servicios.");
    // GEO
    add("geo", str(obj(st.ai).summary).length >= 80, 8, obj(st.ai).summary ? "Resumen para IA escrito" : "Falta el resumen para IA", "En Websites › SEO e IA escribe en 2–3 frases quién eres, qué haces, para quién y dónde: es lo que leerán ChatGPT, Claude y Perplexity.");
    add("geo", obj(st.ai).llms !== false, 4, "llms.txt publicado", "Activa llms.txt en SEO e IA.");
    add("geo", obj(st.ai).allowBots !== false, 5, obj(st.ai).allowBots === false ? "Bloqueas a los buscadores de IA" : "Los buscadores de IA pueden leerte", "Permite los bots de IA si quieres que te citen.");
    add("geo", !!(obj(st.org).name || site.name) && arr(obj(st.org).sameAs).length > 0, 5, arr(obj(st.org).sameAs).length ? "Perfiles de la marca enlazados" : "Faltan tus perfiles (redes, Google, LinkedIn)", "Agrega tus perfiles en SEO e IA › Organización: ayudan a que la IA te reconozca.");
    add("geo", hasStats, 4, hasStats ? "Tiene datos concretos (cifras)" : "Sin datos concretos", "Agrega un bloque de Cifras o datos verificables: la IA cita hechos, no adjetivos.");
    add("geo", new RegExp(str(obj(st.org).name || site.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40), "i").test(md), 3, "Nombra la marca en el contenido", "Menciona el nombre de tu marca en el texto.");
    // AEO
    add("aeo", faqItems.length >= 3, 8, faqItems.length ? faqItems.length + " preguntas frecuentes" : "Sin preguntas frecuentes", "Agrega un bloque de Preguntas frecuentes con al menos 3 preguntas reales de tus clientes.");
    var longA = faqItems.filter(function (x) { var first = plain(x.a).split(/[.!?]\s/)[0] || ""; return words(first) > 40; });
    add("aeo", faqItems.length > 0 && !longA.length, 4, longA.length ? longA.length + " respuesta(s) empiezan muy largas" : "Respuestas directas", "Empieza cada respuesta con una frase corta que responda (≤ 40 palabras) y luego detalla.", faq[0] && faq[0].id);
    var qH = secs.filter(function (s) { return /\?$/.test(str(obj(s.props).title).trim()); }).length;
    add("aeo", qH >= 1 || faqItems.length >= 3, 3, "Títulos en forma de pregunta", "Usa títulos como «¿Cómo funciona?»: los buscadores de respuestas los aprovechan.");
    var groups = { seo: [0, 0], geo: [0, 0], aeo: [0, 0] };
    checks.forEach(function (c) { groups[c.group][1] += c.weight; if (c.ok) groups[c.group][0] += c.weight; });
    var tot = checks.reduce(function (a, c) { return a + c.weight; }, 0), got = checks.reduce(function (a, c) { return a + (c.ok ? c.weight : 0); }, 0);
    return { score: Math.round(got * 100 / tot), seo: Math.round(groups.seo[0] * 100 / groups.seo[1]), geo: Math.round(groups.geo[0] * 100 / groups.geo[1]), aeo: Math.round(groups.aeo[0] * 100 / groups.aeo[1]), words: wc, checks: checks };
  };

  /* ───────────────────────── plantillas de inicio ───────────────────────── */
  function sec(type, props, style) { var s = SR.newSection(type); if (props) Object.keys(props).forEach(function (k) { s.props[k] = props[k]; }); if (style) s.style = style; return s; }
  SR.BLOG_FIELDS = [{ k: "cover", label: "Portada", type: "image" }, { k: "excerpt", label: "Resumen", type: "textarea" }, { k: "body", label: "Contenido", type: "richtext" }, { k: "author", label: "Autor", type: "text" }, { k: "date", label: "Fecha", type: "date" }, { k: "tags", label: "Etiquetas", type: "tags" }];
  SR.STARTERS = {
    landing: { label: "Landing de captación", desc: "Portada, beneficios, prueba social, precios, preguntas y formulario" },
    servicios: { label: "Sitio de servicios", desc: "Inicio, servicios y contacto, con blog" },
    blog: { label: "Blog / revista", desc: "Portada y blog con CMS listo para publicar" },
    blank: { label: "En blanco", desc: "Solo una portada para empezar" },
  };
  SR.starter = function (kind, o) {
    o = o || {}; var name = o.name || "Mi sitio";
    var settings = { lang: "es", description: "", tagline: "", nav: [], cta: { label: "Contacto", href: "#contacto" }, footer: { text: "", links: [] }, org: { type: "Organization", name: name, sameAs: [] }, ai: { summary: "", llms: true, allowBots: true }, index: true, analytics: {} };
    var pages = [], collections = [], entries = [];
    var faq = sec("faq"), form = sec("form", { title: "Escríbenos" }, { bg: "alt", align: "c" });
    if (kind === "blank") pages.push({ path: "/", title: "Inicio", sections: [sec("hero", { title: name, eyebrow: "" })] });
    else if (kind === "blog") {
      settings.nav = [{ label: "Blog", href: "/blog" }];
      collections.push({ name: "Blog", slug: "blog", fields: SR.BLOG_FIELDS, settings: { path: "/blog", schema: "BlogPosting", detail: true, rss: true, title: "Blog", description: "Ideas, guías y novedades de " + name + "." } });
      entries.push({ collection: "blog", title: "Bienvenidos a nuestro blog", slug: "bienvenidos", status: "published", data: { excerpt: "Aquí compartiremos guías, ideas y novedades.", body: "## Por qué este blog\n\nQueremos compartir lo que aprendemos cada semana.\n\n- Guías prácticas\n- Casos reales\n- Novedades", author: name, date: new Date().toISOString().slice(0, 10), tags: ["novedades"] } });
      pages.push({ path: "/", title: "Inicio", sections: [sec("hero", { title: name, subtitle: "Ideas y guías para hacerlo mejor.", buttons: [{ label: "Leer el blog", href: "/blog" }] }), sec("collection", { title: "Lo último", collection: "blog", limit: 6 }), sec("cta", { title: "Recibe lo nuevo", text: "Un correo al mes, sin spam.", buttons: [{ label: "Suscribirme", href: "#contacto" }] }, { bg: "acc", align: "c" }), form] });
    } else if (kind === "servicios") {
      settings.nav = [{ label: "Servicios", href: "/servicios" }, { label: "Blog", href: "/blog" }];
      collections.push({ name: "Blog", slug: "blog", fields: SR.BLOG_FIELDS, settings: { path: "/blog", schema: "BlogPosting", detail: true, rss: true, title: "Blog" } });
      pages.push({ path: "/", title: "Inicio", sections: [sec("hero", { title: name + ": lo que haces, en una frase", layout: "split" }), sec("logos"), sec("features", { title: "Servicios", items: [{ icon: "①", title: "Servicio uno", text: "Qué resuelve y para quién.", href: "/servicios" }, { icon: "②", title: "Servicio dos", text: "Qué resuelve y para quién.", href: "/servicios" }, { icon: "③", title: "Servicio tres", text: "Qué resuelve y para quién.", href: "/servicios" }] }), sec("stats", null, { bg: "alt", align: "c" }), sec("testimonials"), sec("collection", { title: "Del blog", collection: "blog", limit: 3 }), faq, form] });
      pages.push({ path: "/servicios", title: "Servicios", sections: [sec("hero", { title: "Servicios", subtitle: "Todo lo que hacemos y cómo trabajamos.", buttons: [{ label: "Cotizar", href: "#contacto" }] }), sec("split", { title: "Servicio uno" }), sec("split", { title: "Servicio dos", reverse: true }), sec("pricing", null, { bg: "alt", align: "c" }), sec("form", { title: "Pide tu cotización" }, { align: "c" })] });
    } else {
      pages.push({ path: "/", title: "Inicio", sections: [sec("hero"), sec("logos"), sec("features", null, { anchor: "beneficios", align: "c" }), sec("split"), sec("stats", null, { bg: "alt", align: "c" }), sec("testimonials"), sec("pricing", null, { align: "c" }), faq, sec("cta", null, { bg: "acc", align: "c" }), form] });
    }
    pages.forEach(function (p, i) { p.sort = i; p.seo = {}; });
    return { theme: { preset: "claro" }, settings: settings, pages: pages, collections: collections, entries: entries };
  };

  (root || globalThis).SiteRender = SR;
  if (typeof module === "object" && module && module.exports) module.exports = SR;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
