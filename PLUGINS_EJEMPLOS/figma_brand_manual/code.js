// Brand Manual Generator - Figma Plugin v3 (corregido)
// Usa documentAccess: "dynamic-page" → todos los accesos son async

var PAGE_W = 1920;   // Ancho del canvas (slide 16:9)
var PAGE_H = 1080;   // Alto del canvas (slide 16:9)
var PAD = 80;         // Padding lateral
var GAP = 60;         // Gap entre secciones
var SLIDE_GAP = 200;  // Gap vertical entre slides del manual de marca

// ═══════════════════════════════════════════════════════════════════════
// FIX 1: Abrir la UI y conectarla al plugin
// Sin figma.showUI() la UI nunca se abría. Sin figma.ui.on() el botón
// "Generar" no hacía absolutamente nada.
// ═══════════════════════════════════════════════════════════════════════

figma.showUI(__html__, { width: 380, height: 360 });

// Envía el estado de la selección actual a la UI para activar/desactivar el botón
function sendSelection() {
  var sel = figma.currentPage.selection;
  if (sel.length > 0 && "children" in sel[0]) {
    figma.ui.postMessage({
      type: "selection",
      name: sel[0].name,
      children: sel[0].children.length
    });
  } else {
    figma.ui.postMessage({ type: "selection", name: null });
  }
}

// Enviar selección inicial al abrir el plugin
sendSelection();

// Actualizar la UI cada vez que el usuario cambie la selección en Figma
figma.on("selectionchange", sendSelection);

// Escuchar el clic del botón "Generar" desde la UI
figma.ui.on("message", function(msg) {
  if (msg.type === "generate") {
    main();
  }
});

// ─── Helpers de fuente ───────────────────────────────────────────────

async function loadFonts() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  return {
    reg: { family: "Inter", style: "Regular" },
    bold: { family: "Inter", style: "Bold" }
  };
}

// ─── Color utils ─────────────────────────────────────────────────────

function rgbHex(r, g, b) {
  var h = function(v) { return Math.round(v * 255).toString(16).padStart(2, "0"); };
  return "#" + h(r) + h(g) + h(b);
}

function rgbToCmyk(r, g, b) {
  var k = 1 - Math.max(r, g, b);
  if (k >= 0.99) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100)
  };
}

function isNearWhite(r, g, b) { return r > 0.93 && g > 0.93 && b > 0.93; }
function isNearBlack(r, g, b) { return r < 0.07 && g < 0.07 && b < 0.07; }

function colorDist(a, b) {
  return Math.sqrt(Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2));
}

// ─── Teoría del color: RGB ↔ HSL ─────────────────────────────────────

function rgbToHsl(r, g, b) {
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s, l: l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  var hNorm = h / 360;
  if (s === 0) return { r: l, g: l, b: l };
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  var p = 2 * l - q;
  var hue2rgb = function(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return { r: hue2rgb(p, q, hNorm + 1/3), g: hue2rgb(p, q, hNorm), b: hue2rgb(p, q, hNorm - 1/3) };
}

// Genera colores análogos (±30° en el círculo cromático)
function generateAnalogous(r, g, b, count) {
  var hsl = rgbToHsl(r, g, b);
  var result = [];
  var step = 30;
  for (var i = 1; i <= count; i++) {
    var shifted = hslToRgb(hsl.h + step * i, hsl.s, hsl.l);
    result.push({ r: shifted.r, g: shifted.g, b: shifted.b, hex: rgbHex(shifted.r, shifted.g, shifted.b) });
    if (result.length >= count) break;
    var shifted2 = hslToRgb(hsl.h - step * i, hsl.s, hsl.l);
    result.push({ r: shifted2.r, g: shifted2.g, b: shifted2.b, hex: rgbHex(shifted2.r, shifted2.g, shifted2.b) });
  }
  return result.slice(0, count);
}

// Genera color complementario (180° en el círculo cromático)
function generateComplementary(r, g, b) {
  var hsl = rgbToHsl(r, g, b);
  var comp = hslToRgb(hsl.h + 180, hsl.s, hsl.l);
  return [{ r: comp.r, g: comp.g, b: comp.b, hex: rgbHex(comp.r, comp.g, comp.b) }];
}

// Genera escala de tonos (tints + shades) para un color
function generateTintsAndShades(r, g, b, steps) {
  steps = steps || 9;
  var hsl = rgbToHsl(r, g, b);
  var result = [];
  // Tints: de claro al original
  var tintSteps = Math.floor(steps / 2);
  for (var i = tintSteps; i >= 1; i--) {
    var lightness = hsl.l + (1 - hsl.l) * (i / (tintSteps + 1));
    var t = hslToRgb(hsl.h, hsl.s * 0.7, lightness);
    result.push({ r: t.r, g: t.g, b: t.b, hex: rgbHex(t.r, t.g, t.b), type: "tint" });
  }
  // Color original
  result.push({ r: r, g: g, b: b, hex: rgbHex(r, g, b), type: "base" });
  // Shades: del original a oscuro
  var shadeSteps = steps - tintSteps - 1;
  for (var j = 1; j <= shadeSteps; j++) {
    var darkness = hsl.l * (1 - j / (shadeSteps + 1));
    var s = hslToRgb(hsl.h, hsl.s, darkness);
    result.push({ r: s.r, g: s.g, b: s.b, hex: rgbHex(s.r, s.g, s.b), type: "shade" });
  }
  return result;
}

// ─── Extracción de datos ─────────────────────────────────────────────

function extractColors(node) {
  var raw = [], seen = {};
  (function walk(n) {
    var i, f, hex;
    if ("fills" in n && Array.isArray(n.fills)) {
      for (i = 0; i < n.fills.length; i++) {
        f = n.fills[i];
        if (f.type === "SOLID" && f.visible !== false) {
          hex = rgbHex(f.color.r, f.color.g, f.color.b);
          if (!seen[hex] && !isNearWhite(f.color.r, f.color.g, f.color.b) && !isNearBlack(f.color.r, f.color.g, f.color.b)) {
            seen[hex] = true;
            raw.push({ r: f.color.r, g: f.color.g, b: f.color.b, hex: hex });
          }
        }
      }
    }
    if ("strokes" in n && Array.isArray(n.strokes)) {
      for (i = 0; i < n.strokes.length; i++) {
        f = n.strokes[i];
        if (f.type === "SOLID" && f.visible !== false) {
          hex = rgbHex(f.color.r, f.color.g, f.color.b);
          if (!seen[hex] && !isNearWhite(f.color.r, f.color.g, f.color.b) && !isNearBlack(f.color.r, f.color.g, f.color.b)) {
            seen[hex] = true;
            raw.push({ r: f.color.r, g: f.color.g, b: f.color.b, hex: hex });
          }
        }
      }
    }
    if ("children" in n) for (i = 0; i < n.children.length; i++) walk(n.children[i]);
  })(node);

  var grouped = [], used = {};
  for (var i = 0; i < raw.length; i++) {
    if (used[i]) continue;
    grouped.push(raw[i]);
    used[i] = true;
    for (var j = i + 1; j < raw.length; j++) {
      if (!used[j] && colorDist(raw[i], raw[j]) < 0.08) used[j] = true;
    }
  }
  return grouped;
}

function extractTypography(node) {
  var fonts = [], seen = {};
  (function walk(n) {
    if (n.type === "TEXT") {
      var fid = n.fontName.family + "|" + n.fontName.style + "|" + n.fontSize;
      if (!seen[fid]) {
        seen[fid] = true;
        fonts.push({ family: n.fontName.family, style: n.fontName.style, size: n.fontSize });
      }
    }
    if ("children" in n) for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
  })(node);
  fonts.sort(function(a, b) { return b.size - a.size; });
  return fonts;
}

// ─── Aplicar color a un nodo (para variantes) ────────────────────────

function applyColor(node, color) {
  if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
    var newFills = [];
    for (var i = 0; i < node.fills.length; i++) {
      var f = node.fills[i];
      // Solo reemplaza fills SOLID; los gradientes y demás se conservan sin cambios
      if (f.type === "SOLID") {
        newFills.push({ type: "SOLID", color: color, opacity: f.opacity, visible: f.visible });
      } else {
        newFills.push(f);
      }
    }
    node.fills = newFills;
  }
  if ("children" in node) {
    for (var j = 0; j < node.children.length; j++) {
      applyColor(node.children[j], color);
    }
  }
}

// ─── Crear sección dentro de un frame ────────────────────────────────

function makeSection(parent, yStart, fonts, title, sectionLabel) {
  var section = figma.createFrame();
  section.name = title;
  section.resize(PAGE_W, 10); // altura temporal; se actualiza con AUTO sizing
  section.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  section.layoutMode = "VERTICAL";
  section.primaryAxisAlignItems = "MIN";
  section.counterAxisAlignItems = "MIN";
  section.paddingLeft = PAD;
  section.paddingRight = PAD;
  section.paddingTop = 60;
  section.paddingBottom = 60;
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "FIXED";
  section.itemSpacing = 24;
  section.x = 0;
  section.y = yStart;
  parent.appendChild(section);

  if (sectionLabel) {
    var sl = figma.createText();
    sl.characters = sectionLabel.toUpperCase();
    sl.fontSize = 11;
    sl.fontName = fonts.reg;
    sl.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.65 } }];
    sl.letterSpacing = { value: 2, unit: "PIXELS" };
    section.appendChild(sl);
  }

  var t = figma.createText();
  t.characters = title;
  t.fontSize = 36;
  t.fontName = fonts.bold;
  t.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
  section.appendChild(t);

  return section;
}

function addBody(parent, text, fonts) {
  var b = figma.createText();
  b.characters = text;
  b.fontSize = 15;
  b.fontName = fonts.reg;
  b.fills = [{ type: "SOLID", color: { r: 0.35, g: 0.35, b: 0.38 } }];
  b.resize(PAGE_W - (PAD * 2), 100);
  b.textAutoResize = "HEIGHT";
  b.lineHeight = { value: 170, unit: "PERCENT" };
  parent.appendChild(b);
}

// ─── Design System Components (35 componentes) ──────────────────
// Usa posicionamiento absoluto (sin Auto Layout para el contenedor principal)
// porque el AUTO height de Figma no calcula bien alturas de frames anidados

function createDesignSystem(page, startX, startY, fonts, accent) {
  var createdFrames = [];
  var DS_W = PAGE_W - PAD * 2; // 1760px usable width (1920 - 160)
  var SEC_PAD = 32; // padding interno de cada sección
  var ROW_GAP = 24;
  var SEC_GAP = 56;

  // ── Frame principal: FIXED en ambas dimensiones ───────────
  var ds = figma.createFrame();
  ds.name = "Design System";
  ds.resize(PAGE_W, 8000); // Altura exagerada — se ajusta al final
  ds.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
  ds.layoutMode = "NONE"; // Sin Auto Layout — posicionamiento manual
  ds.clipsContent = false;
  ds.x = startX;
  ds.y = startY;
  page.appendChild(ds);
  createdFrames.push(ds);

  var cursorY = 60; // Y interno del frame DS

  // ── Helper: crear texto rápido ────────────────────────────
  function txt(content, size, font, color) {
    var t = figma.createText();
    t.characters = content;
    t.fontSize = size;
    t.fontName = font;
    t.fills = [{ type: "SOLID", color: color }];
    return t;
  }

  // ── Header ───────────────────────────────────────────────
  var label = txt("DESIGN SYSTEM", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  label.letterSpacing = { value: 2, unit: "PIXELS" };
  label.x = PAD;
  label.y = cursorY;
  label.resize(DS_W, 14);
  label.textAutoResize = "HEIGHT";
  ds.appendChild(label);
  cursorY += 20;

  var title = txt("Biblioteca de Componentes", 36, fonts.bold, { r: 0.08, g: 0.08, b: 0.1 });
  title.x = PAD;
  title.y = cursorY;
  title.resize(DS_W, 44);
  title.textAutoResize = "HEIGHT";
  ds.appendChild(title);
  cursorY += 56;

  var desc = txt("35 componentes esenciales para construir interfaces consistentes y profesionales.", 15, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  desc.x = PAD;
  desc.y = cursorY;
  desc.resize(DS_W, 22);
  desc.textAutoResize = "HEIGHT";
  desc.lineHeight = { value: 160, unit: "PERCENT" };
  ds.appendChild(desc);
  cursorY += 50;

  // ── Helper: iniciar sección de categoría ──────────────────
  function startSection(titleText, count) {
    // Título de sección
    var secLabel = txt(titleText.toUpperCase(), 11, fonts.bold, accent);
    secLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
    secLabel.x = PAD;
    secLabel.y = cursorY;
    secLabel.resize(DS_W, 14);
    secLabel.textAutoResize = "HEIGHT";
    ds.appendChild(secLabel);

    var countLabel = txt(count + " variantes", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
    countLabel.x = PAD + 180;
    countLabel.y = cursorY;
    countLabel.resize(100, 14);
    ds.appendChild(countLabel);

    cursorY += 20;

    // Separador
    var sep = figma.createRectangle();
    sep.resize(DS_W, 1);
    sep.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    sep.x = PAD;
    sep.y = cursorY;
    ds.appendChild(sep);

    cursorY += 16;
  }

  // ── Helper: agregar fila horizontal de componentes ────────
  function addRow(items) {
    var rowX = PAD;
    var maxH = 0;
    for (var i = 0; i < items.length; i++) {
      items[i].x = rowX;
      items[i].y = cursorY;
      ds.appendChild(items[i]);
      rowX += items[i].width + 16;
      if (items[i].height > maxH) maxH = items[i].height;
    }
    cursorY += maxH + ROW_GAP;
  }

  // ── Helper: agregar componente individual (vertical stack) ─
  function addSingle(item) {
    item.x = PAD;
    item.y = cursorY;
    ds.appendChild(item);
    cursorY += item.height + ROW_GAP;
  }

  // ── Helper: crear botón ───────────────────────────────────
  function makeButton(label, style) {
    var btn = figma.createFrame();
    btn.name = "Button — " + label;
    btn.layoutMode = "VERTICAL";
    btn.primaryAxisAlignItems = "CENTER";
    btn.counterAxisAlignItems = "CENTER";
    btn.paddingLeft = 24;
    btn.paddingRight = 24;
    btn.paddingTop = 12;
    btn.paddingBottom = 12;
    btn.cornerRadius = 8;
    btn.primaryAxisSizingMode = "AUTO";
    btn.counterAxisSizingMode = "AUTO";
    btn.itemSpacing = 0;

    if (style === "primary") { btn.fills = [{ type: "SOLID", color: accent }]; }
    else if (style === "secondary") { btn.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.95 } }]; }
    else if (style === "outline") { btn.fills = []; btn.strokes = [{ type: "SOLID", color: accent }]; btn.strokeWeight = 1.5; }
    else if (style === "ghost") { btn.fills = []; }
    else if (style === "disabled") { btn.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }]; btn.opacity = 0.5; }

    var txtColor = style === "primary" ? { r: 1, g: 1, b: 1 } :
                   style === "secondary" ? { r: 0.15, g: 0.15, b: 0.18 } :
                   (style === "outline" || style === "ghost") ? accent :
                   { r: 0.6, g: 0.6, b: 0.65 };

    var t = txt(label, 14, fonts.bold, txtColor);
    btn.appendChild(t);
    return btn;
  }

  function makeButtonWithLabel(name, style) {
    var wrap = figma.createFrame();
    wrap.layoutMode = "VERTICAL";
    wrap.itemSpacing = 6;
    wrap.counterAxisAlignItems = "CENTER";
    wrap.primaryAxisSizingMode = "AUTO";
    wrap.counterAxisSizingMode = "AUTO";
    wrap.fills = [];
    wrap.appendChild(makeButton(name, style));
    wrap.appendChild(txt(name, 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 }));
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════
  // 1. BOTONES (5 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Botones", 5);
  addRow([
    makeButtonWithLabel("Primario", "primary"),
    makeButtonWithLabel("Secundario", "secondary"),
    makeButtonWithLabel("Outline", "outline"),
    makeButtonWithLabel("Ghost", "ghost"),
    makeButtonWithLabel("Disabled", "disabled")
  ]);

  // ═══════════════════════════════════════════════════════════
  // 2. INPUTS (4 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Inputs", 4);

  function makeInput(labelText, placeholder, multiline) {
    var wrap = figma.createFrame();
    wrap.name = "Input — " + labelText;
    wrap.layoutMode = "VERTICAL";
    wrap.itemSpacing = 6;
    wrap.primaryAxisSizingMode = "AUTO";
    wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(240, 10);
    wrap.fills = [];

    wrap.appendChild(txt(labelText, 12, fonts.bold, { r: 0.2, g: 0.2, b: 0.25 }));

    var field = figma.createFrame();
    field.layoutMode = "VERTICAL";
    field.primaryAxisAlignItems = multiline ? "MIN" : "CENTER";
    field.paddingLeft = 14; field.paddingRight = 14;
    field.paddingTop = multiline ? 12 : 10;
    field.paddingBottom = multiline ? 12 : 10;
    field.cornerRadius = 8;
    field.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    field.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.85 } }];
    field.strokeWeight = 1;
    field.primaryAxisSizingMode = "AUTO";
    field.counterAxisSizingMode = "FIXED";
    field.resize(240, multiline ? 80 : 10);

    field.appendChild(txt(placeholder, 14, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 }));
    wrap.appendChild(field);
    return wrap;
  }

  function makeSelect() {
    var wrap = figma.createFrame();
    wrap.name = "Select";
    wrap.layoutMode = "VERTICAL";
    wrap.itemSpacing = 6;
    wrap.primaryAxisSizingMode = "AUTO";
    wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(240, 10);
    wrap.fills = [];
    wrap.appendChild(txt("Select", 12, fonts.bold, { r: 0.2, g: 0.2, b: 0.25 }));

    var sel = figma.createFrame();
    sel.layoutMode = "HORIZONTAL";
    sel.itemSpacing = 8;
    sel.counterAxisAlignItems = "CENTER";
    sel.primaryAxisAlignItems = "SPACE_BETWEEN";
    sel.paddingLeft = 14; sel.paddingRight = 14;
    sel.paddingTop = 10; sel.paddingBottom = 10;
    sel.cornerRadius = 8;
    sel.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    sel.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.85 } }];
    sel.strokeWeight = 1;
    sel.primaryAxisSizingMode = "FIXED";
    sel.counterAxisSizingMode = "AUTO";
    sel.resize(240, 10);
    sel.appendChild(txt("Seleccionar opción", 14, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 }));
    sel.appendChild(txt("▾", 14, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 }));
    wrap.appendChild(sel);
    return wrap;
  }

  function makeSearchBar() {
    var wrap = figma.createFrame();
    wrap.name = "Search Bar";
    wrap.layoutMode = "VERTICAL";
    wrap.itemSpacing = 6;
    wrap.primaryAxisSizingMode = "AUTO";
    wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(280, 10);
    wrap.fills = [];
    wrap.appendChild(txt("Search Bar", 12, fonts.bold, { r: 0.2, g: 0.2, b: 0.25 }));

    var bar = figma.createFrame();
    bar.layoutMode = "HORIZONTAL";
    bar.itemSpacing = 10;
    bar.counterAxisAlignItems = "CENTER";
    bar.paddingLeft = 14; bar.paddingRight = 14;
    bar.paddingTop = 10; bar.paddingBottom = 10;
    bar.cornerRadius = 24;
    bar.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.96 } }];
    bar.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    bar.strokeWeight = 1;
    bar.primaryAxisSizingMode = "AUTO";
    bar.counterAxisSizingMode = "FIXED";
    bar.resize(280, 10);

    var iconWrap = figma.createFrame();
    iconWrap.resize(18, 18);
    iconWrap.fills = [];
    var lens = figma.createEllipse();
    lens.resize(14, 14); lens.fills = [];
    lens.strokes = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    lens.strokeWeight = 1.5;
    iconWrap.appendChild(lens);
    var handle = figma.createRectangle();
    handle.resize(6, 1.5); handle.cornerRadius = 1;
    handle.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    handle.x = 12; handle.y = 13;
    iconWrap.appendChild(handle);
    bar.appendChild(iconWrap);
    bar.appendChild(txt("Buscar...", 14, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 }));
    wrap.appendChild(bar);
    return wrap;
  }

  addRow([makeInput("Input Text", "Escribe aquí..."), makeInput("Textarea", "Escribe un mensaje...", true), makeSelect(), makeSearchBar()]);

  // ═══════════════════════════════════════════════════════════
  // 3. TAGS & BADGES (4 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Tags & Badges", 4);

  function makeTag(label, bgColor, textColor) {
    var tag = figma.createFrame();
    tag.name = "Tag — " + label;
    tag.layoutMode = "VERTICAL";
    tag.primaryAxisAlignItems = "CENTER"; tag.counterAxisAlignItems = "CENTER";
    tag.paddingLeft = 12; tag.paddingRight = 12; tag.paddingTop = 5; tag.paddingBottom = 5;
    tag.cornerRadius = 100;
    tag.primaryAxisSizingMode = "AUTO"; tag.counterAxisSizingMode = "AUTO";
    tag.fills = [{ type: "SOLID", color: bgColor }];
    tag.appendChild(txt(label, 12, fonts.bold, textColor));
    return tag;
  }

  function makeBadge(label, type) {
    var colors = {
      success: { bg: { r: 0.86, g: 0.96, b: 0.88 }, text: { r: 0.1, g: 0.55, b: 0.2 } },
      warning: { bg: { r: 1, g: 0.95, b: 0.8 }, text: { r: 0.7, g: 0.5, b: 0.05 } },
      error: { bg: { r: 1, g: 0.88, b: 0.88 }, text: { r: 0.75, g: 0.15, b: 0.15 } }
    };
    var c = colors[type] || colors.success;
    var badge = figma.createFrame();
    badge.name = "Badge — " + label;
    badge.layoutMode = "HORIZONTAL"; badge.itemSpacing = 6;
    badge.counterAxisAlignItems = "CENTER";
    badge.paddingLeft = 10; badge.paddingRight = 10; badge.paddingTop = 4; badge.paddingBottom = 4;
    badge.cornerRadius = 100;
    badge.primaryAxisSizingMode = "AUTO"; badge.counterAxisSizingMode = "AUTO";
    badge.fills = [{ type: "SOLID", color: c.bg }];
    var dot = figma.createEllipse(); dot.resize(6, 6);
    dot.fills = [{ type: "SOLID", color: c.text }];
    badge.appendChild(dot);
    badge.appendChild(txt(label, 11, fonts.bold, c.text));
    return badge;
  }

  function makeCounterBadge(count) {
    var badge = figma.createFrame();
    badge.name = "Counter — " + count;
    badge.layoutMode = "VERTICAL";
    badge.primaryAxisAlignItems = "CENTER"; badge.counterAxisAlignItems = "CENTER";
    badge.paddingLeft = 7; badge.paddingRight = 7; badge.paddingTop = 2; badge.paddingBottom = 2;
    badge.cornerRadius = 100;
    badge.primaryAxisSizingMode = "AUTO"; badge.counterAxisSizingMode = "AUTO";
    badge.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.2, b: 0.2 } }];
    badge.appendChild(txt(count, 10, fonts.bold, { r: 1, g: 1, b: 1 }));
    return badge;
  }

  function makeRemovableTag(label) {
    var tag = figma.createFrame();
    tag.name = "Removable — " + label;
    tag.layoutMode = "HORIZONTAL"; tag.itemSpacing = 8;
    tag.counterAxisAlignItems = "CENTER";
    tag.paddingLeft = 12; tag.paddingRight = 8; tag.paddingTop = 5; tag.paddingBottom = 5;
    tag.cornerRadius = 100;
    tag.primaryAxisSizingMode = "AUTO"; tag.counterAxisSizingMode = "AUTO";
    tag.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.95 } }];
    tag.appendChild(txt(label, 12, fonts.reg, { r: 0.25, g: 0.25, b: 0.3 }));
    var close = figma.createFrame(); close.resize(16, 16); close.cornerRadius = 100;
    close.fills = [{ type: "SOLID", color: { r: 0.75, g: 0.75, b: 0.8 } }];
    close.layoutMode = "VERTICAL";
    close.primaryAxisAlignItems = "CENTER"; close.counterAxisAlignItems = "CENTER";
    close.appendChild(txt("×", 11, fonts.bold, { r: 1, g: 1, b: 1 }));
    tag.appendChild(close);
    return tag;
  }

  function wrapWithLabel(name, node) {
    var w = figma.createFrame();
    w.layoutMode = "VERTICAL"; w.itemSpacing = 6;
    w.counterAxisAlignItems = "CENTER";
    w.primaryAxisSizingMode = "AUTO"; w.counterAxisSizingMode = "AUTO";
    w.fills = [];
    w.appendChild(node);
    w.appendChild(txt(name, 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 }));
    return w;
  }

  addRow([
    wrapWithLabel("Tag Categoría", makeTag("Diseño", { r: 0.9, g: 0.92, b: 1 }, accent)),
    wrapWithLabel("Badge Estado", makeBadge("Activo", "success")),
    wrapWithLabel("Counter Badge", makeCounterBadge("12")),
    wrapWithLabel("Tag Removable", makeRemovableTag("Filtro activo"))
  ]);

  // ═══════════════════════════════════════════════════════════
  // 4. CARDS (3 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Cards", 3);

  function makeContentCard() {
    var card = figma.createFrame();
    card.name = "Card — Contenido";
    card.layoutMode = "VERTICAL"; card.itemSpacing = 12;
    card.paddingBottom = 16; card.cornerRadius = 12;
    card.primaryAxisSizingMode = "AUTO"; card.counterAxisSizingMode = "AUTO";
    card.resize(280, 10);
    card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    card.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 2 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];
    var img = figma.createRectangle(); img.resize(280, 140);
    img.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.93 } }];
    img.topLeftRadius = 12; img.topRightRadius = 12; img.bottomLeftRadius = 0; img.bottomRightRadius = 0;
    card.appendChild(img);
    var content = figma.createFrame();
    content.layoutMode = "VERTICAL"; content.itemSpacing = 6;
    content.paddingLeft = 16; content.paddingRight = 16;
    content.primaryAxisSizingMode = "AUTO"; content.counterAxisSizingMode = "FIXED";
    content.resize(280, 10); content.fills = [];
    content.appendChild(txt("Título del artículo", 16, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 }));
    var d = txt("Breve descripción del contenido que aparecerá en esta card informativa.", 13, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
    d.resize(248, 10); d.textAutoResize = "HEIGHT"; d.lineHeight = { value: 160, unit: "PERCENT" };
    content.appendChild(d);
    card.appendChild(content);
    return card;
  }

  function makeProductCard() {
    var card = figma.createFrame();
    card.name = "Card — Producto";
    card.layoutMode = "VERTICAL"; card.itemSpacing = 12;
    card.paddingBottom = 16; card.cornerRadius = 12;
    card.primaryAxisSizingMode = "AUTO"; card.counterAxisSizingMode = "AUTO";
    card.resize(260, 10);
    card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    card.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 2 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];
    var img = figma.createRectangle(); img.resize(260, 200);
    img.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.95 } }];
    img.topLeftRadius = 12; img.topRightRadius = 12; img.bottomLeftRadius = 0; img.bottomRightRadius = 0;
    card.appendChild(img);
    var content = figma.createFrame();
    content.layoutMode = "VERTICAL"; content.itemSpacing = 4;
    content.paddingLeft = 14; content.paddingRight = 14;
    content.primaryAxisSizingMode = "AUTO"; content.counterAxisSizingMode = "FIXED";
    content.resize(260, 10); content.fills = [];
    content.appendChild(txt("Nombre del producto", 15, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 }));
    content.appendChild(txt("$29.99", 18, fonts.bold, accent));
    card.appendChild(content);
    return card;
  }

  function makeTestimonialCard() {
    var card = figma.createFrame();
    card.name = "Card — Testimonial";
    card.layoutMode = "VERTICAL"; card.itemSpacing = 16;
    card.paddingLeft = 20; card.paddingRight = 20; card.paddingTop = 24; card.paddingBottom = 24;
    card.cornerRadius = 12;
    card.primaryAxisSizingMode = "AUTO"; card.counterAxisSizingMode = "AUTO";
    card.resize(320, 10);
    card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    card.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 2 }, radius: 10, spread: 0, visible: true, blendMode: "NORMAL" }];
    var quote = txt("\"Este producto transformó completamente mi flujo de trabajo. Lo recomiendo al 100%.\"", 14, fonts.reg, { r: 0.3, g: 0.3, b: 0.35 });
    quote.resize(280, 10); quote.textAutoResize = "HEIGHT"; quote.lineHeight = { value: 170, unit: "PERCENT" };
    card.appendChild(quote);
    var author = figma.createFrame();
    author.layoutMode = "HORIZONTAL"; author.itemSpacing = 10;
    author.counterAxisAlignItems = "CENTER";
    author.primaryAxisSizingMode = "AUTO"; author.counterAxisSizingMode = "AUTO";
    author.fills = [];
    var avatar = figma.createEllipse(); avatar.resize(36, 36);
    avatar.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    author.appendChild(avatar);
    var info = figma.createFrame(); info.layoutMode = "VERTICAL"; info.itemSpacing = 2;
    info.primaryAxisSizingMode = "AUTO"; info.counterAxisSizingMode = "AUTO"; info.fills = [];
    info.appendChild(txt("María García", 13, fonts.bold, { r: 0.15, g: 0.15, b: 0.18 }));
    info.appendChild(txt("Diseñadora UX", 11, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 }));
    author.appendChild(info);
    card.appendChild(author);
    return card;
  }

  addRow([makeContentCard(), makeProductCard(), makeTestimonialCard()]);

  // ═══════════════════════════════════════════════════════════
  // 5. NAVEGACIÓN (3 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Navegación", 3);

  function makeTabBar() {
    var wrap = figma.createFrame(); wrap.name = "Tab Bar";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 6;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "AUTO"; wrap.fills = [];
    wrap.appendChild(txt("Tab Bar", 12, fonts.bold, { r: 0.2, g: 0.2, b: 0.25 }));
    var bar = figma.createFrame(); bar.layoutMode = "HORIZONTAL"; bar.itemSpacing = 0;
    bar.primaryAxisSizingMode = "AUTO"; bar.counterAxisSizingMode = "AUTO"; bar.cornerRadius = 8;
    bar.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
    bar.paddingTop = 3; bar.paddingBottom = 3; bar.paddingLeft = 3; bar.paddingRight = 3;
    var tabs = ["Todos", "Activos", "Archivados"];
    for (var i = 0; i < tabs.length; i++) {
      var tab = figma.createFrame(); tab.layoutMode = "VERTICAL";
      tab.primaryAxisAlignItems = "CENTER"; tab.counterAxisAlignItems = "CENTER";
      tab.paddingLeft = 16; tab.paddingRight = 16; tab.paddingTop = 8; tab.paddingBottom = 8;
      tab.cornerRadius = 6;
      tab.primaryAxisSizingMode = "AUTO"; tab.counterAxisSizingMode = "AUTO";
      tab.fills = i === 0 ? [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] : [];
      if (i === 0) tab.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 1 }, radius: 3, spread: 0, visible: true, blendMode: "NORMAL" }];
      tab.appendChild(txt(tabs[i], 13, i === 0 ? fonts.bold : fonts.reg, i === 0 ? { r: 0.1, g: 0.1, b: 0.12 } : { r: 0.55, g: 0.55, b: 0.6 }));
      bar.appendChild(tab);
    }
    wrap.appendChild(bar);
    return wrap;
  }

  function makeBreadcrumb() {
    var wrap = figma.createFrame(); wrap.name = "Breadcrumb";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 6;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "AUTO"; wrap.fills = [];
    wrap.appendChild(txt("Breadcrumb", 12, fonts.bold, { r: 0.2, g: 0.2, b: 0.25 }));
    var bc = figma.createFrame(); bc.layoutMode = "HORIZONTAL"; bc.itemSpacing = 8;
    bc.counterAxisAlignItems = "CENTER";
    bc.primaryAxisSizingMode = "AUTO"; bc.counterAxisSizingMode = "AUTO"; bc.fills = [];
    var parts = ["Inicio", "Productos", "Categoría"];
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) bc.appendChild(txt("/", 13, fonts.reg, { r: 0.7, g: 0.7, b: 0.75 }));
      bc.appendChild(txt(parts[i], 13, i === parts.length - 1 ? fonts.bold : fonts.reg, i === parts.length - 1 ? { r: 0.1, g: 0.1, b: 0.12 } : accent));
    }
    wrap.appendChild(bc);
    return wrap;
  }

  function makePagination() {
    var wrap = figma.createFrame(); wrap.name = "Pagination";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 6;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "AUTO"; wrap.fills = [];
    wrap.appendChild(txt("Pagination", 12, fonts.bold, { r: 0.2, g: 0.2, b: 0.25 }));
    var pg = figma.createFrame(); pg.layoutMode = "HORIZONTAL"; pg.itemSpacing = 4;
    pg.counterAxisAlignItems = "CENTER";
    pg.primaryAxisSizingMode = "AUTO"; pg.counterAxisSizingMode = "AUTO"; pg.fills = [];
    var pages = ["←", "1", "2", "3", "...", "10", "→"];
    for (var i = 0; i < pages.length; i++) {
      var p = figma.createFrame(); p.layoutMode = "VERTICAL";
      p.primaryAxisAlignItems = "CENTER"; p.counterAxisAlignItems = "CENTER";
      p.resize(36, 36); p.cornerRadius = 8;
      p.fills = pages[i] === "1" ? [{ type: "SOLID", color: accent }] : [];
      p.appendChild(txt(pages[i], 13, pages[i] === "1" ? fonts.bold : fonts.reg, pages[i] === "1" ? { r: 1, g: 1, b: 1 } : { r: 0.4, g: 0.4, b: 0.45 }));
      pg.appendChild(p);
    }
    wrap.appendChild(pg);
    return wrap;
  }

  addRow([makeTabBar(), makeBreadcrumb(), makePagination()]);

  // ═══════════════════════════════════════════════════════════
  // 6. TIPOGRAFÍA (6 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Tipografía", 6);

  function makeTypeScale(labelText, size, weight, ls) {
    var wrap = figma.createFrame(); wrap.name = "Type — " + labelText;
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 4;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(DS_W, 10); wrap.fills = [];

    var info = txt(labelText + " — " + size + "px", 10, fonts.bold, { r: 0.6, g: 0.6, b: 0.65 });
    info.letterSpacing = { value: 1, unit: "PIXELS" };
    wrap.appendChild(info);

    var spec = txt("The quick brown fox jumps over the lazy dog", size, weight === "bold" ? fonts.bold : fonts.reg, { r: 0.1, g: 0.1, b: 0.12 });
    spec.resize(DS_W, 10); spec.textAutoResize = "HEIGHT";
    if (ls) spec.letterSpacing = { value: ls, unit: "PIXELS" };
    wrap.appendChild(spec);
    return wrap;
  }

  addSingle(makeTypeScale("H1 — Display", 48, "bold"));
  addSingle(makeTypeScale("H2 — Heading", 36, "bold"));
  addSingle(makeTypeScale("H3 — Subheading", 24, "bold"));
  addSingle(makeTypeScale("Body Text", 16, "reg"));
  addSingle(makeTypeScale("Small / Caption", 13, "reg"));
  addSingle(makeTypeScale("Label", 11, "bold", 1));

  // ═══════════════════════════════════════════════════════════
  // 7. ELEMENTOS DE CONTENIDO (6 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Elementos de contenido", 6);

  function makeQuoteBlock() {
    var wrap = figma.createFrame(); wrap.name = "Quote Block";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 12;
    wrap.paddingLeft = 20; wrap.paddingRight = 20; wrap.paddingTop = 20; wrap.paddingBottom = 20;
    wrap.cornerRadius = 10;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(480, 10);
    wrap.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
    wrap.appendChild(txt("\u201C", 48, fonts.bold, accent));
    var t = txt("La creatividad es la inteligencia divirtiéndose.", 16, fonts.reg, { r: 0.25, g: 0.25, b: 0.3 });
    t.resize(440, 10); t.textAutoResize = "HEIGHT";
    wrap.appendChild(t);
    wrap.appendChild(txt("— Albert Einstein", 13, fonts.bold, { r: 0.5, g: 0.5, b: 0.55 }));
    return wrap;
  }

  function makeStatsBlock(number, label) {
    var wrap = figma.createFrame(); wrap.name = "Stats — " + label;
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 4;
    wrap.counterAxisAlignItems = "CENTER";
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "AUTO"; wrap.fills = [];
    var num = txt(number, 42, fonts.bold, accent); num.textAlignHorizontal = "CENTER";
    wrap.appendChild(num);
    var lbl = txt(label, 13, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 }); lbl.textAlignHorizontal = "CENTER";
    wrap.appendChild(lbl);
    return wrap;
  }

  function makeChecklist(items) {
    var wrap = figma.createFrame(); wrap.name = "Checklist";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 10;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(400, 10); wrap.fills = [];
    for (var i = 0; i < items.length; i++) {
      var row = figma.createFrame(); row.layoutMode = "HORIZONTAL"; row.itemSpacing = 10;
      row.counterAxisAlignItems = "CENTER";
      row.primaryAxisSizingMode = "AUTO"; row.counterAxisSizingMode = "AUTO"; row.fills = [];
      var check = figma.createFrame(); check.resize(20, 20); check.cornerRadius = 100;
      check.fills = [{ type: "SOLID", color: items[i].done ? { r: 0.2, g: 0.75, b: 0.4 } : { r: 0.9, g: 0.9, b: 0.92 } }];
      check.layoutMode = "VERTICAL";
      check.primaryAxisAlignItems = "CENTER"; check.counterAxisAlignItems = "CENTER";
      if (items[i].done) check.appendChild(txt("✓", 12, fonts.bold, { r: 1, g: 1, b: 1 }));
      row.appendChild(check);
      var c = items[i].done ? { r: 0.5, g: 0.5, b: 0.55 } : { r: 0.2, g: 0.2, b: 0.25 };
      var itemTxt = txt(items[i].text, 14, fonts.reg, c);
      if (items[i].done) itemTxt.textDecoration = "STRIKETHROUGH";
      row.appendChild(itemTxt);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function makeDivider(label) {
    var wrap = figma.createFrame(); wrap.name = "Divider" + (label ? " — " + label : "");
    wrap.layoutMode = "HORIZONTAL"; wrap.itemSpacing = 16;
    wrap.counterAxisAlignItems = "CENTER";
    wrap.primaryAxisSizingMode = "FIXED"; wrap.counterAxisSizingMode = "AUTO";
    wrap.resize(DS_W, 10); wrap.fills = [];
    var line1 = figma.createRectangle();
    line1.resize(label ? 120 : DS_W, 1);
    line1.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
    wrap.appendChild(line1);
    if (label) {
      var lbl = txt(label, 11, fonts.bold, { r: 0.6, g: 0.6, b: 0.65 });
      lbl.letterSpacing = { value: 1, unit: "PIXELS" };
      wrap.appendChild(lbl);
      var line2 = figma.createRectangle(); line2.resize(120, 1);
      line2.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
      wrap.appendChild(line2);
    }
    return wrap;
  }

  function makeAvatarName(name, role) {
    var wrap = figma.createFrame(); wrap.name = "Avatar — " + name;
    wrap.layoutMode = "HORIZONTAL"; wrap.itemSpacing = 12;
    wrap.counterAxisAlignItems = "CENTER";
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "AUTO"; wrap.fills = [];
    var avatar = figma.createEllipse(); avatar.resize(40, 40);
    avatar.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    wrap.appendChild(avatar);
    var info = figma.createFrame(); info.layoutMode = "VERTICAL"; info.itemSpacing = 2;
    info.primaryAxisSizingMode = "AUTO"; info.counterAxisSizingMode = "AUTO"; info.fills = [];
    info.appendChild(txt(name, 14, fonts.bold, { r: 0.15, g: 0.15, b: 0.18 }));
    info.appendChild(txt(role, 12, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 }));
    wrap.appendChild(info);
    return wrap;
  }

  function makeCTABlock() {
    var wrap = figma.createFrame(); wrap.name = "CTA Block";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 16;
    wrap.paddingLeft = 32; wrap.paddingRight = 32; wrap.paddingTop = 32; wrap.paddingBottom = 32;
    wrap.cornerRadius = 12;
    wrap.primaryAxisAlignItems = "CENTER"; wrap.counterAxisAlignItems = "CENTER";
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(500, 10);
    wrap.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.09 } }];
    var title = txt("¿Listo para empezar?", 24, fonts.bold, { r: 1, g: 1, b: 1 });
    title.textAlignHorizontal = "CENTER";
    wrap.appendChild(title);
    var desc = txt("Únete a miles de usuarios que ya transformaron su flujo de trabajo.", 14, fonts.reg, { r: 0.65, g: 0.65, b: 0.7 });
    desc.textAlignHorizontal = "CENTER"; desc.resize(420, 10); desc.textAutoResize = "HEIGHT";
    wrap.appendChild(desc);
    var btn = figma.createFrame(); btn.layoutMode = "VERTICAL";
    btn.primaryAxisAlignItems = "CENTER"; btn.counterAxisAlignItems = "CENTER";
    btn.paddingLeft = 28; btn.paddingRight = 28; btn.paddingTop = 12; btn.paddingBottom = 12;
    btn.cornerRadius = 8;
    btn.primaryAxisSizingMode = "AUTO"; btn.counterAxisSizingMode = "AUTO";
    btn.fills = [{ type: "SOLID", color: accent }];
    btn.appendChild(txt("Comenzar ahora", 14, fonts.bold, { r: 1, g: 1, b: 1 }));
    wrap.appendChild(btn);
    return wrap;
  }

  addRow([makeQuoteBlock(), makeStatsBlock("2.4K", "Usuarios activos")]);

  addSingle(makeChecklist([
    { text: "Diseño del wireframe completado", done: true },
    { text: "Revisión del prototipo", done: true },
    { text: "Desarrollo del frontend", done: false },
    { text: "Testing de accesibilidad", done: false }
  ]));

  addSingle(makeDivider("Sección"));

  addRow([makeAvatarName("Ana López", "Product Designer"), makeAvatarName("Carlos Ruiz", "Developer")]);

  addSingle(makeCTABlock());

  // ═══════════════════════════════════════════════════════════
  // 8. SOCIAL & UI (4 variantes)
  // ═══════════════════════════════════════════════════════════
  startSection("Social & UI", 4);

  function makeFollowButton() {
    var btn = figma.createFrame(); btn.name = "Follow Button";
    btn.layoutMode = "HORIZONTAL"; btn.itemSpacing = 8;
    btn.counterAxisAlignItems = "CENTER";
    btn.paddingLeft = 20; btn.paddingRight = 20; btn.paddingTop = 10; btn.paddingBottom = 10;
    btn.cornerRadius = 8;
    btn.primaryAxisSizingMode = "AUTO"; btn.counterAxisSizingMode = "AUTO";
    btn.fills = [{ type: "SOLID", color: accent }];
    btn.appendChild(txt("+", 16, fonts.bold, { r: 1, g: 1, b: 1 }));
    btn.appendChild(txt("Seguir", 14, fonts.bold, { r: 1, g: 1, b: 1 }));
    return btn;
  }

  function makeProgressBar(percent) {
    var wrap = figma.createFrame(); wrap.name = "Progress — " + percent + "%";
    wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 8;
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "FIXED";
    wrap.resize(260, 10); wrap.fills = [];
    var labelRow = figma.createFrame(); labelRow.layoutMode = "HORIZONTAL"; labelRow.itemSpacing = 8;
    labelRow.primaryAxisAlignItems = "SPACE_BETWEEN";
    labelRow.primaryAxisSizingMode = "FIXED"; labelRow.counterAxisSizingMode = "AUTO";
    labelRow.resize(260, 10); labelRow.fills = [];
    labelRow.appendChild(txt("Progreso", 12, fonts.bold, { r: 0.3, g: 0.3, b: 0.35 }));
    labelRow.appendChild(txt(percent + "%", 12, fonts.bold, accent));
    wrap.appendChild(labelRow);
    var barBg = figma.createFrame(); barBg.resize(260, 8); barBg.cornerRadius = 100;
    barBg.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
    var barFill = figma.createFrame(); barFill.resize(Math.round(260 * percent / 100), 8);
    barFill.cornerRadius = 100;
    barFill.fills = [{ type: "SOLID", color: accent }];
    barBg.appendChild(barFill);
    wrap.appendChild(barBg);
    return wrap;
  }

  function makeToggle(on) {
    var wrap = figma.createFrame(); wrap.name = "Toggle — " + (on ? "ON" : "OFF");
    wrap.layoutMode = "HORIZONTAL"; wrap.itemSpacing = 10;
    wrap.counterAxisAlignItems = "CENTER";
    wrap.primaryAxisSizingMode = "AUTO"; wrap.counterAxisSizingMode = "AUTO"; wrap.fills = [];
    var track = figma.createFrame(); track.resize(44, 24); track.cornerRadius = 100;
    track.fills = [{ type: "SOLID", color: on ? accent : { r: 0.85, g: 0.85, b: 0.88 } }];
    var knob = figma.createEllipse(); knob.resize(20, 20);
    knob.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    knob.x = on ? 22 : 2; knob.y = 2;
    knob.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.15 }, offset: { x: 0, y: 1 }, radius: 3, spread: 0, visible: true, blendMode: "NORMAL" }];
    track.appendChild(knob);
    wrap.appendChild(track);
    wrap.appendChild(txt(on ? "Activado" : "Desactivado", 13, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 }));
    return wrap;
  }

  function makeToast() {
    var toast = figma.createFrame(); toast.name = "Toast";
    toast.layoutMode = "HORIZONTAL"; toast.itemSpacing = 10;
    toast.counterAxisAlignItems = "CENTER";
    toast.paddingLeft = 16; toast.paddingRight = 16; toast.paddingTop = 12; toast.paddingBottom = 12;
    toast.cornerRadius = 10;
    toast.primaryAxisSizingMode = "AUTO"; toast.counterAxisSizingMode = "AUTO";
    toast.fills = [{ type: "SOLID", color: { r: 0.12, g: 0.12, b: 0.16 } }];
    toast.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true, blendMode: "NORMAL" }];
    toast.appendChild(txt("✓", 16, fonts.bold, { r: 0.4, g: 0.9, b: 0.5 }));
    toast.appendChild(txt("Guardado correctamente", 13, fonts.reg, { r: 0.9, g: 0.9, b: 0.95 }));
    return toast;
  }

  addRow([makeFollowButton(), makeProgressBar(68), makeToggle(true), makeToggle(false), makeToast()]);

  // ── Ajustar altura final del frame DS ─────────────────────
  ds.resize(PAGE_W, cursorY + 60);

  return createdFrames;
}

// ═══════════════════════════════════════════════════════════════════════
// MOCKUPS — Papelería Corporativa (Items 1-9)
// Vectores realistas con datos demo, misma lógica que Design System:
// layoutMode: "NONE" + posicionamiento manual absoluto
// ═══════════════════════════════════════════════════════════════════════

function createMockups(page, startX, startY, fonts, accent, logoFrame) {
  var createdFrames = [];
  var DS_W = PAGE_W - PAD * 2; // 1760px usable
  var SEC_PAD = 40;

  // ── Frame principal ───────────────────────────────────────
  var mock = figma.createFrame();
  mock.name = "Mockups — Papelería Corporativa";
  mock.resize(PAGE_W, 10000);
  mock.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
  mock.layoutMode = "NONE";
  mock.clipsContent = false;
  mock.x = startX;
  mock.y = startY;
  page.appendChild(mock);
  createdFrames.push(mock);

  var cursorY = 60;

  // ── Helpers ───────────────────────────────────────────────
  function txt(content, size, font, color) {
    var t = figma.createText();
    t.characters = content;
    t.fontSize = size;
    t.fontName = font;
    t.fills = [{ type: "SOLID", color: color }];
    return t;
  }

  function place(item, x, y) {
    item.x = x;
    item.y = y;
    mock.appendChild(item);
  }

  function sectionHeader(title, count) {
    var lbl = txt(title.toUpperCase(), 11, fonts.bold, accent);
    lbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
    lbl.x = PAD; lbl.y = cursorY;
    lbl.resize(DS_W, 14); lbl.textAutoResize = "HEIGHT";
    mock.appendChild(lbl);

    var cnt = txt(count + " items", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
    cnt.x = PAD + 260; cnt.y = cursorY;
    mock.appendChild(cnt);

    cursorY += 20;
    var sep = figma.createRectangle();
    sep.resize(DS_W, 1);
    sep.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    sep.x = PAD; sep.y = cursorY;
    mock.appendChild(sep);
    cursorY += 24;
  }

  function mockLabel(text, x, y) {
    var lbl = txt(text, 11, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
    lbl.x = x; lbl.y = y;
    mock.appendChild(lbl);
    return lbl;
  }

  function addLogoTo(parentFrame, maxW, maxH) {
    var logo = logoFrame.clone();
    logo.name = "Logo";
    if (logo.width > maxW || logo.height > maxH) {
      var s = Math.min(maxW / logo.width, maxH / logo.height);
      logo.resize(Math.round(logo.width * s), Math.round(logo.height * s));
    }
    parentFrame.appendChild(logo);
    return logo;
  }

  function dashedLine(parent, w, x, y, color) {
    var line = figma.createRectangle();
    line.resize(w, 1);
    line.fills = [{ type: "SOLID", color: color || { r: 0.8, g: 0.8, b: 0.85 } }];
    line.x = x; line.y = y;
    line.dashPattern = [4, 3];
    parent.appendChild(line);
    return line;
  }

  // ═══════════════════════════════════════════════════════════
  // HEADER del grupo
  // ═══════════════════════════════════════════════════════════

  var mainLabel = txt("MOCKUPS", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  mainLabel.letterSpacing = { value: 2, unit: "PIXELS" };
  mainLabel.x = PAD; mainLabel.y = cursorY;
  mainLabel.resize(DS_W, 14);
  mock.appendChild(mainLabel);
  cursorY += 20;

  var mainTitle = txt("Papelería Corporativa", 36, fonts.bold, { r: 0.08, g: 0.08, b: 0.1 });
  mainTitle.x = PAD; mainTitle.y = cursorY;
  mainTitle.resize(DS_W, 44);
  mock.appendChild(mainTitle);
  cursorY += 52;

  var mainDesc = txt("Mockups vectoriales listos para aplicar la identidad de marca. Datos de ejemplo — reemplaza con tu información real.", 15, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  mainDesc.x = PAD; mainDesc.y = cursorY;
  mainDesc.resize(DS_W, 22); mainDesc.textAutoResize = "HEIGHT";
  mainDesc.lineHeight = { value: 160, unit: "PERCENT" };
  mock.appendChild(mainDesc);
  cursorY += 56;

  // ═══════════════════════════════════════════════════════════
  // 1. TARJETA DE PRESENTACIÓN — Frente + Reverso
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Tarjeta de Presentación", 2);

  var CARD_W = 360;
  var CARD_H = 210; // Proporción ~3.5:2

  // ── Frente ────────────────────────────────────────────
  var cardFront = figma.createFrame();
  cardFront.name = "Tarjeta — Frente";
  cardFront.resize(CARD_W, CARD_H);
  cardFront.cornerRadius = 8;
  cardFront.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  cardFront.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Barra de acento lateral izquierda
  var accentBar = figma.createRectangle();
  accentBar.resize(6, CARD_H);
  accentBar.fills = [{ type: "SOLID", color: accent }];
  accentBar.topLeftRadius = 8; accentBar.bottomLeftRadius = 8;
  cardFront.appendChild(accentBar);

  // Logo
  addLogoTo(cardFront, 120, 50);
  cardFront.children[cardFront.children.length - 1].x = 30;
  cardFront.children[cardFront.children.length - 1].y = 30;

  // Nombre
  var nameT = txt("María García López", 18, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  nameT.x = 30; nameT.y = 100;
  cardFront.appendChild(nameT);

  // Cargo
  var roleT = txt("Directora Creativa", 12, fonts.reg, accent);
  roleT.x = 30; roleT.y = 124;
  cardFront.appendChild(roleT);

  // Contacto
  var contactLines = ["+34 612 345 678", "maria@tuempresa.com", "www.tuempresa.com"];
  for (var ci = 0; ci < contactLines.length; ci++) {
    var cl = txt(contactLines[ci], 10, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
    cl.x = 30; cl.y = 155 + ci * 16;
    cardFront.appendChild(cl);
  }

  place(cardFront, PAD, cursorY);
  mockLabel("Frente (90×55 mm)", PAD, cursorY + CARD_H + 8);

  // ── Reverso ──────────────────────────────────────────
  var cardBack = figma.createFrame();
  cardBack.name = "Tarjeta — Reverso";
  cardBack.resize(CARD_W, CARD_H);
  cardBack.cornerRadius = 8;
  cardBack.fills = [{ type: "SOLID", color: accent }];
  cardBack.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Logo centrado en reverso
  var backLogo = addLogoTo(cardBack, 140, 60);
  backLogo.x = Math.round((CARD_W - backLogo.width) / 2);
  backLogo.y = Math.round((CARD_H - backLogo.height) / 2);

  place(cardBack, PAD + CARD_W + 32, cursorY);
  mockLabel("Reverso", PAD + CARD_W + 32, cursorY + CARD_H + 8);

  cursorY += CARD_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 2. HOJA MEMBRETADA — A4
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Hoja Membretada", 1);

  var A4_W = 420;
  var A4_H = 596; // Proporción A4 (210:297)

  var letterhead = figma.createFrame();
  letterhead.name = "Hoja Membretada — A4";
  letterhead.resize(A4_W, A4_H);
  letterhead.cornerRadius = 4;
  letterhead.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  letterhead.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header bar
  var headerBar = figma.createRectangle();
  headerBar.resize(A4_W, 6);
  headerBar.fills = [{ type: "SOLID", color: accent }];
  headerBar.topLeftRadius = 4; headerBar.topRightRadius = 4;
  letterhead.appendChild(headerBar);

  // Logo en header
  addLogoTo(letterhead, 100, 40);
  letterhead.children[letterhead.children.length - 1].x = 36;
  letterhead.children[letterhead.children.length - 1].y = 24;

  // Info empresa en header
  var empresaInfo = txt("Tu Empresa S.A.\nCalle Principal 123, Madrid\ntuempresa.com", 9, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  empresaInfo.textAlignHorizontal = "RIGHT";
  empresaInfo.x = A4_W - 200; empresaInfo.y = 26;
  empresaInfo.resize(164, 50);
  letterhead.appendChild(empresaInfo);

  // Línea separadora header
  dashedLine(letterhead, A4_W - 72, 36, 80, { r: 0.85, g: 0.85, b: 0.88 });

  // Fecha
  var fecha = txt("Madrid, 13 de abril de 2026", 11, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
  fecha.x = 36; fecha.y = 100;
  letterhead.appendChild(fecha);

  // Destinatario
  var dest = txt("Estimado/a Cliente:\n\nNombre de la Empresa\nDirección completa\nCiudad, País", 11, fonts.reg, { r: 0.3, g: 0.3, b: 0.35 });
  dest.x = 36; dest.y = 130;
  dest.resize(A4_W - 72, 80);
  letterhead.appendChild(dest);

  // Líneas de contenido simuladas
  for (var li = 0; li < 12; li++) {
    var contentLine = figma.createRectangle();
    contentLine.resize(A4_W - 72 - Math.round(Math.random() * 80), 1);
    contentLine.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    contentLine.x = 36;
    contentLine.y = 240 + li * 22;
    letterhead.appendChild(contentLine);
  }

  // Footer
  var footerBar = figma.createRectangle();
  footerBar.resize(A4_W, 1);
  footerBar.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
  footerBar.y = A4_H - 50;
  letterhead.appendChild(footerBar);

  var footerText = txt("Tu Empresa S.A. · CIF: B12345678 · Registro Mercantil de Madrid · info@tuempresa.com", 8, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  footerText.textAlignHorizontal = "CENTER";
  footerText.resize(A4_W - 72, 12);
  footerText.x = 36; footerText.y = A4_H - 36;
  letterhead.appendChild(footerText);

  place(letterhead, PAD, cursorY);
  mockLabel("A4 (210×297 mm)", PAD, cursorY + A4_H + 8);

  cursorY += A4_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 3. SOBRE TAMAÑO CARTA — #10
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Sobres", 2);

  var ENV_W = 480;
  var ENV_H = 230; // Proporción #10

  var envelope = figma.createFrame();
  envelope.name = "Sobre Tamaño Carta — #10";
  envelope.resize(ENV_W, ENV_H);
  envelope.cornerRadius = 4;
  envelope.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  envelope.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Borde sutil
  envelope.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
  envelope.strokeWeight = 1;

  // Ventana del sobre (rectángulo claro)
  var window = figma.createRectangle();
  window.resize(160, 50);
  window.cornerRadius = 2;
  window.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.96 } }];
  window.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
  window.strokeWeight = 0.5;
  window.x = 30; window.y = 55;
  envelope.appendChild(window);

  var windowLbl = txt("Ventana", 8, fonts.reg, { r: 0.7, g: 0.7, b: 0.75 });
  windowLbl.x = 80; windowLbl.y = 73;
  envelope.appendChild(windowLbl);

  // Logo en esquina superior derecha
  var envLogo = addLogoTo(envelope, 100, 40);
  envLogo.x = ENV_W - envLogo.width - 30;
  envLogo.y = 25;

  // Remitente
  var remitente = txt("Tu Empresa S.A.\nCalle Principal 123\n28001 Madrid, España", 9, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
  remitente.x = ENV_W - 180; remitente.y = 80;
  remitente.resize(150, 50);
  envelope.appendChild(remitente);

  // Franja de acento inferior
  var envBar = figma.createRectangle();
  envBar.resize(ENV_W, 4);
  envBar.fills = [{ type: "SOLID", color: accent }];
  envBar.bottomLeftRadius = 4; envBar.bottomRightRadius = 4;
  envBar.y = ENV_H - 4;
  envelope.appendChild(envBar);

  place(envelope, PAD, cursorY);
  mockLabel("#10 — Tamaño Carta (241×105 mm)", PAD, cursorY + ENV_H + 8);

  // ── Sobre Oficio ──────────────────────────────────────
  var ENV2_W = 380;
  var ENV2_H = 500;

  var envelope2 = figma.createFrame();
  envelope2.name = "Sobre Tamaño Oficio";
  envelope2.resize(ENV2_W, ENV2_H);
  envelope2.cornerRadius = 4;
  envelope2.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  envelope2.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];
  envelope2.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
  envelope2.strokeWeight = 1;

  // Logo centrado arriba
  var env2Logo = addLogoTo(envelope2, 120, 50);
  env2Logo.x = Math.round((ENV2_W - env2Logo.width) / 2);
  env2Logo.y = 30;

  // Info empresa centrada
  var env2Info = txt("Tu Empresa S.A.\nCalle Principal 123, Madrid\n+34 912 345 678\ntuempresa.com", 10, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  env2Info.textAlignHorizontal = "CENTER";
  env2Info.x = Math.round((ENV2_W - 200) / 2);
  env2Info.y = 100;
  env2Info.resize(200, 70);
  envelope2.appendChild(env2Info);

  // Franja acento inferior
  var env2Bar = figma.createRectangle();
  env2Bar.resize(ENV2_W, 4);
  env2Bar.fills = [{ type: "SOLID", color: accent }];
  env2Bar.bottomLeftRadius = 4; env2Bar.bottomRightRadius = 4;
  env2Bar.y = ENV2_H - 4;
  envelope2.appendChild(env2Bar);

  place(envelope2, PAD + ENV_W + 32, cursorY);
  mockLabel("Oficio (240×340 mm)", PAD + ENV_W + 32, cursorY + ENV2_H + 8);

  cursorY += Math.max(ENV_H, ENV2_H) + 50;

  // ═══════════════════════════════════════════════════════════
  // 5. FIRMA DIGITAL — Email
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Firma Digital", 1);

  var SIG_W = 560;
  var SIG_H = 180;

  var signature = figma.createFrame();
  signature.name = "Firma Digital — Email";
  signature.resize(SIG_W, SIG_H);
  signature.cornerRadius = 8;
  signature.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  signature.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 2 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Barra acento izquierda
  var sigBar = figma.createRectangle();
  sigBar.resize(4, SIG_H);
  sigBar.fills = [{ type: "SOLID", color: accent }];
  sigBar.topLeftRadius = 8; sigBar.bottomLeftRadius = 8;
  signature.appendChild(sigBar);

  // Logo
  addLogoTo(signature, 100, 40);
  signature.children[signature.children.length - 1].x = 24;
  signature.children[signature.children.length - 1].y = 20;

  // Nombre + cargo
  var sigName = txt("María García López", 16, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  sigName.x = 24; sigName.y = 75;
  signature.appendChild(sigName);

  var sigRole = txt("Directora Creativa", 11, fonts.reg, accent);
  sigRole.x = 24; sigRole.y = 96;
  signature.appendChild(sigRole);

  // Separador vertical
  var sigDiv = figma.createRectangle();
  sigDiv.resize(1, 80);
  sigDiv.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
  sigDiv.x = 230; sigDiv.y = 20;
  signature.appendChild(sigDiv);

  // Contacto a la derecha
  var sigContact = txt("📞  +34 612 345 678\n✉️   maria@tuempresa.com\n🌐  www.tuempresa.com", 10, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  sigContact.x = 248; sigContact.y = 30;
  sigContact.resize(280, 60);
  signature.appendChild(sigContact);

  // Redes sociales (íconos simulados)
  var socialRow = figma.createFrame();
  socialRow.layoutMode = "HORIZONTAL";
  socialRow.itemSpacing = 8;
  socialRow.primaryAxisSizingMode = "AUTO";
  socialRow.counterAxisSizingMode = "AUTO";
  socialRow.fills = [];
  socialRow.x = 248; socialRow.y = 110;

  var socials = ["in", "tw", "ig", "fb"];
  for (var si = 0; si < socials.length; si++) {
    var icon = figma.createFrame();
    icon.resize(24, 24); icon.cornerRadius = 12;
    icon.fills = [{ type: "SOLID", color: accent }];
    icon.layoutMode = "VERTICAL";
    icon.primaryAxisAlignItems = "CENTER";
    icon.counterAxisAlignItems = "CENTER";
    icon.appendChild(txt(socials[si].toUpperCase(), 8, fonts.bold, { r: 1, g: 1, b: 1 }));
    socialRow.appendChild(icon);
  }
  signature.appendChild(socialRow);

  place(signature, PAD, cursorY);
  mockLabel("600×200 px formato email", PAD, cursorY + SIG_H + 8);

  cursorY += SIG_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 6. TARJETA DE AGRADECIMIENTO
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Tarjeta de Agradecimiento", 1);

  var THANK_W = 340;
  var THANK_H = 470; // Proporción 5:7

  var thankYou = figma.createFrame();
  thankYou.name = "Tarjeta de Agradecimiento — 5×7\"";
  thankYou.resize(THANK_W, THANK_H);
  thankYou.cornerRadius = 12;
  thankYou.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  thankYou.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Franja superior de acento
  var thankBar = figma.createRectangle();
  thankBar.resize(THANK_W, 8);
  thankBar.fills = [{ type: "SOLID", color: accent }];
  thankBar.topLeftRadius = 12; thankBar.topRightRadius = 12;
  thankYou.appendChild(thankBar);

  // Logo centrado
  var thankLogo = addLogoTo(thankYou, 100, 45);
  thankLogo.x = Math.round((THANK_W - thankLogo.width) / 2);
  thankLogo.y = 50;

  // Ornamento decorativo (círculos concéntricos)
  var ornOuter = figma.createEllipse();
  ornOuter.resize(120, 120);
  ornOuter.fills = [];
  ornOuter.strokes = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
  ornOuter.strokeWeight = 1;
  ornOuter.x = Math.round((THANK_W - 120) / 2);
  ornOuter.y = 130;
  thankYou.appendChild(ornOuter);

  var ornInner = figma.createEllipse();
  ornInner.resize(80, 80);
  ornInner.fills = [];
  ornInner.strokes = [{ type: "SOLID", color: accent }];
  ornInner.strokeWeight = 1.5;
  ornInner.x = Math.round((THANK_W - 80) / 2);
  ornInner.y = 150;
  thankYou.appendChild(ornInner);

  // Texto principal
  var thankTitle = txt("Gracias", 36, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  thankTitle.textAlignHorizontal = "CENTER";
  thankTitle.x = 0; thankTitle.y = 270;
  thankTitle.resize(THANK_W, 44);
  thankYou.appendChild(thankTitle);

  var thankSub = txt("por tu confianza", 16, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  thankSub.textAlignHorizontal = "CENTER";
  thankSub.x = 0; thankSub.y = 310;
  thankSub.resize(THANK_W, 24);
  thankYou.appendChild(thankSub);

  // Mensaje
  var thankMsg = txt("Tu apoyo significa mucho para nosotros.\nEsperamos seguir trabajando juntos.", 12, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  thankMsg.textAlignHorizontal = "CENTER";
  thankMsg.resize(THANK_W - 60, 40);
  thankMsg.x = 30; thankMsg.y = 360;
  thankYou.appendChild(thankMsg);

  // Línea decorativa inferior
  var thankLine = figma.createRectangle();
  thankLine.resize(40, 2);
  thankLine.fills = [{ type: "SOLID", color: accent }];
  thankLine.x = Math.round((THANK_W - 40) / 2);
  thankLine.y = THANK_H - 40;
  thankYou.appendChild(thankLine);

  place(thankYou, PAD, cursorY);
  mockLabel("127×178 mm (5×7\")", PAD, cursorY + THANK_H + 8);

  cursorY += THANK_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 7. FOLDER / PORTADOCUMENTOS — A4 con solapa
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Folder / Portadocumentos", 1);

  var FOLDER_W = 460;
  var FOLDER_H = 520;

  var folder = figma.createFrame();
  folder.name = "Folder — A4 con solapa";
  folder.resize(FOLDER_W, FOLDER_H);
  folder.cornerRadius = 6;
  folder.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
  folder.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];
  folder.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
  folder.strokeWeight = 1;

  // Solapa (triángulo superior)
  var flap = figma.createRectangle();
  flap.resize(FOLDER_W, 60);
  flap.fills = [{ type: "SOLID", color: accent }];
  flap.topLeftRadius = 6; flap.topRightRadius = 6;
  folder.appendChild(flap);

  // Logo en solapa
  addLogoTo(folder, 100, 35);
  folder.children[folder.children.length - 1].x = Math.round((FOLDER_W - folder.children[folder.children.length - 1].width) / 2);
  folder.children[folder.children.length - 1].y = 12;

  // Texto en solapa
  var flapText = txt("PORTADOCUMENTOS", 10, fonts.bold, { r: 1, g: 1, b: 1 });
  flapText.letterSpacing = { value: 2, unit: "PIXELS" };
  flapText.textAlignHorizontal = "CENTER";
  flapText.x = 0; flapText.y = 42;
  flapText.resize(FOLDER_W, 14);
  folder.appendChild(flapText);

  // Bolsillo inferior (simulado con rectángulo)
  var pocket = figma.createFrame();
  pocket.name = "Bolsillo";
  pocket.resize(FOLDER_W - 40, 140);
  pocket.x = 20; pocket.y = FOLDER_H - 160;
  pocket.cornerRadius = 4;
  pocket.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
  pocket.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
  pocket.strokeWeight = 1;
  pocket.dashPattern = [4, 3];

  var pocketLbl = txt("Bolsillo para documentos", 10, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  pocketLbl.textAlignHorizontal = "CENTER";
  pocketLbl.resize(FOLDER_W - 80, 14);
  pocketLbl.x = 20; pocketLbl.y = 50;
  pocket.appendChild(pocketLbl);
  folder.appendChild(pocket);

  // Área de contenido (centro)
  var contentArea = figma.createFrame();
  contentArea.name = "Área de contenido";
  contentArea.resize(FOLDER_W - 60, 260);
  contentArea.x = 30; contentArea.y = 80;
  contentArea.fills = [];
  contentArea.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
  contentArea.strokeWeight = 0.5;
  contentArea.dashPattern = [6, 4];
  contentArea.layoutMode = "VERTICAL";
  contentArea.primaryAxisAlignItems = "CENTER";
  contentArea.counterAxisAlignItems = "CENTER";

  var areaLbl = txt("Área visible del documento A4", 11, fonts.reg, { r: 0.65, g: 0.65, b: 0.7 });
  contentArea.appendChild(areaLbl);
  folder.appendChild(contentArea);

  place(folder, PAD, cursorY);
  mockLabel("A4 con solapa y doble bolsillo", PAD, cursorY + FOLDER_H + 8);

  cursorY += FOLDER_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 8. PAPELERÍA INTERNA — Memorándum, Minutas, Reporte
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Papelería Interna", 3);

  var MEMO_W = 380;
  var MEMO_H = 500;

  // ── Memorándum ──────────────────────────────────────
  var memo = figma.createFrame();
  memo.name = "Memorándum";
  memo.resize(MEMO_W, MEMO_H);
  memo.cornerRadius = 4;
  memo.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  memo.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 2 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header
  var memoHeaderBar = figma.createRectangle();
  memoHeaderBar.resize(MEMO_W, 5);
  memoHeaderBar.fills = [{ type: "SOLID", color: accent }];
  memoHeaderBar.topLeftRadius = 4; memoHeaderBar.topRightRadius = 4;
  memo.appendChild(memoHeaderBar);

  var memoTitle = txt("MEMORÁNDUM", 20, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  memoTitle.x = 24; memoTitle.y = 20;
  memo.appendChild(memoTitle);

  // Campos del memo
  var memoFields = ["PARA:", "DE:", "FECHA:", "ASUNTO:"];
  var memoValues = ["Nombre del Destinatario", "Nombre del Remitente", "13 de abril de 2026", "Asunto del memorándum"];
  for (var mi = 0; mi < memoFields.length; mi++) {
    var mfLabel = txt(memoFields[mi], 10, fonts.bold, { r: 0.4, g: 0.4, b: 0.45 });
    mfLabel.x = 24; mfLabel.y = 60 + mi * 28;
    memo.appendChild(mfLabel);

    var mfValue = txt(memoValues[mi], 11, fonts.reg, { r: 0.2, g: 0.2, b: 0.25 });
    mfValue.x = 80; mfValue.y = 59 + mi * 28;
    memo.appendChild(mfValue);

    // Línea bajo cada campo
    dashedLine(memo, MEMO_W - 48, 24, 78 + mi * 28, { r: 0.9, g: 0.9, b: 0.92 });
  }

  // Contenido
  for (var mli = 0; mli < 8; mli++) {
    var ml = figma.createRectangle();
    ml.resize(MEMO_W - 48 - Math.round(Math.random() * 60), 1);
    ml.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
    ml.x = 24; ml.y = 190 + mli * 20;
    memo.appendChild(ml);
  }

  // Firma
  var memoSign = txt("Firma del remitente", 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  memoSign.x = 24; memoSign.y = MEMO_H - 50;
  memo.appendChild(memoSign);

  dashedLine(memo, 140, 24, MEMO_H - 56, { r: 0.75, g: 0.75, b: 0.8 });

  place(memo, PAD, cursorY);
  mockLabel("Memorándum", PAD, cursorY + MEMO_H + 8);

  // ── Minutas ──────────────────────────────────────────
  var minutes = figma.createFrame();
  minutes.name = "Minutas de Reunión";
  minutes.resize(MEMO_W, MEMO_H);
  minutes.cornerRadius = 4;
  minutes.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  minutes.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 2 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];

  var minHeaderBar = figma.createRectangle();
  minHeaderBar.resize(MEMO_W, 5);
  minHeaderBar.fills = [{ type: "SOLID", color: accent }];
  minHeaderBar.topLeftRadius = 4; minHeaderBar.topRightRadius = 4;
  minutes.appendChild(minHeaderBar);

  var minTitle = txt("MINUTAS DE REUNIÓN", 18, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  minTitle.x = 24; minTitle.y = 20;
  minutes.appendChild(minTitle);

  // Info de la reunión
  var minInfo = txt("Fecha: 13/04/2026 · Hora: 10:00 - 11:30\nLugar: Sala de conferencias\nAsistentes: 6 personas", 10, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  minInfo.x = 24; minInfo.y = 50;
  minInfo.resize(MEMO_W - 48, 45);
  minutes.appendChild(minInfo);

  // Agenda con puntos
  var agendaLabel = txt("ORDEN DEL DÍA", 10, fonts.bold, accent);
  agendaLabel.letterSpacing = { value: 1, unit: "PIXELS" };
  agendaLabel.x = 24; agendaLabel.y = 110;
  minutes.appendChild(agendaLabel);

  var agendaItems = ["1. Revisión de avances", "2. Presupuesto Q2", "3. Nuevos proyectos", "4. Acciones pendientes"];
  for (var ai = 0; ai < agendaItems.length; ai++) {
    var ag = txt(agendaItems[ai], 11, fonts.reg, { r: 0.3, g: 0.3, b: 0.35 });
    ag.x = 24; ag.y = 132 + ai * 22;
    minutes.appendChild(ag);
  }

  // Notas
  dashedLine(minutes, MEMO_W - 48, 24, 230, { r: 0.88, g: 0.88, b: 0.9 });
  for (var nli = 0; nli < 6; nli++) {
    var nl = figma.createRectangle();
    nl.resize(MEMO_W - 48 - Math.round(Math.random() * 50), 1);
    nl.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
    nl.x = 24; nl.y = 245 + nli * 20;
    minutes.appendChild(nl);
  }

  place(minutes, PAD + MEMO_W + 20, cursorY);
  mockLabel("Minutas", PAD + MEMO_W + 20, cursorY + MEMO_H + 8);

  // ── Encabezado de Reporte ────────────────────────────
  var report = figma.createFrame();
  report.name = "Encabezado de Reporte";
  report.resize(MEMO_W, MEMO_H);
  report.cornerRadius = 4;
  report.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  report.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 2 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];

  var repHeaderBar = figma.createRectangle();
  repHeaderBar.resize(MEMO_W, 6);
  repHeaderBar.fills = [{ type: "SOLID", color: accent }];
  repHeaderBar.topLeftRadius = 4; repHeaderBar.topRightRadius = 4;
  report.appendChild(repHeaderBar);

  // Logo + título en header
  addLogoTo(report, 80, 30);
  report.children[report.children.length - 1].x = 24;
  report.children[report.children.length - 1].y = 18;

  var repTitle = txt("INFORME TRIMESTRAL", 18, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  repTitle.textAlignHorizontal = "RIGHT";
  repTitle.x = MEMO_W - 220; repTitle.y = 20;
  repTitle.resize(196, 24);
  report.appendChild(repTitle);

  var repPeriod = txt("Q1 — Enero a Marzo 2026", 11, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  repPeriod.textAlignHorizontal = "RIGHT";
  repPeriod.x = MEMO_W - 220; repPeriod.y = 44;
  repPeriod.resize(196, 16);
  report.appendChild(repPeriod);

  dashedLine(report, MEMO_W - 48, 24, 70, { r: 0.88, g: 0.88, b: 0.9 });

  // Secciones del reporte
  var repSections = ["RESUMEN EJECUTIVO", "OBJETIVOS", "RESULTADOS", "CONCLUSIONES"];
  for (var ri = 0; ri < repSections.length; ri++) {
    var rs = txt(repSections[ri], 11, fonts.bold, { r: 0.3, g: 0.3, b: 0.35 });
    rs.x = 24; rs.y = 90 + ri * 60;
    report.appendChild(rs);

    for (var rli = 0; rli < 2; rli++) {
      var rl = figma.createRectangle();
      rl.resize(MEMO_W - 48 - Math.round(Math.random() * 40), 1);
      rl.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
      rl.x = 24; rl.y = 108 + ri * 60 + rli * 16;
      report.appendChild(rl);
    }
  }

  place(report, PAD + (MEMO_W + 20) * 2, cursorY);
  mockLabel("Encabezado de Reporte", PAD + (MEMO_W + 20) * 2, cursorY + MEMO_H + 8);

  cursorY += MEMO_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 9. FACTURA / RECIBO — A5
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Factura / Recibo", 1);

  var INV_W = 520;
  var INV_H = 620;

  var invoice = figma.createFrame();
  invoice.name = "Factura — A5";
  invoice.resize(INV_W, INV_H);
  invoice.cornerRadius = 4;
  invoice.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  invoice.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header con acento
  var invHeader = figma.createFrame();
  invHeader.resize(INV_W, 80);
  invHeader.fills = [{ type: "SOLID", color: accent }];
  invHeader.topLeftRadius = 4; invHeader.topRightRadius = 4;
  invoice.appendChild(invHeader);

  // Logo en header
  addLogoTo(invoice, 100, 40);
  invoice.children[invoice.children.length - 1].x = 24;
  invoice.children[invoice.children.length - 1].y = 20;

  // FACTURA título
  var invTitle = txt("FACTURA", 28, fonts.bold, { r: 1, g: 1, b: 1 });
  invTitle.textAlignHorizontal = "RIGHT";
  invTitle.x = INV_W - 220; invTitle.y = 16;
  invTitle.resize(196, 36);
  invoice.appendChild(invTitle);

  var invNum = txt("Nº: FAC-2026-0042", 12, fonts.reg, { r: 0.85, g: 0.85, b: 0.9 });
  invNum.textAlignHorizontal = "RIGHT";
  invNum.x = INV_W - 220; invNum.y = 52;
  invNum.resize(196, 16);
  invoice.appendChild(invNum);

  // Emisor / Cliente (dos columnas)
  var emisorBlock = txt("TU EMPRESA S.A.\nCalle Principal 123\n28001 Madrid, España\nCIF: B12345678", 9, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  emisorBlock.x = 24; emisorBlock.y = 96;
  emisorBlock.resize(220, 70);
  invoice.appendChild(emisorBlock);

  var clienteBlock = txt("CLIENTE S.L.\nAvenida Comercial 456\n08001 Barcelona, España\nCIF: B87654321", 9, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  clienteBlock.textAlignHorizontal = "RIGHT";
  clienteBlock.x = INV_W - 244; clienteBlock.y = 96;
  clienteBlock.resize(220, 70);
  invoice.appendChild(clienteBlock);

  // Fecha y condiciones
  var invDate = txt("Fecha: 13/04/2026\nVencimiento: 13/05/2026\nMétodo: Transferencia", 9, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  invDate.x = 24; invDate.y = 180;
  invDate.resize(200, 45);
  invoice.appendChild(invDate);

  dashedLine(invoice, INV_W - 48, 24, 235, { r: 0.88, g: 0.88, b: 0.9 });

  // Tabla de items
  // Header de tabla
  var tableHeader = figma.createFrame();
  tableHeader.resize(INV_W - 48, 28);
  tableHeader.x = 24; tableHeader.y = 248;
  tableHeader.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
  tableHeader.cornerRadius = 4;

  var colHeaders = ["DESCRIPCIÓN", "CANT.", "PRECIO", "TOTAL"];
  var colX = [16, 260, 330, 420];
  var colW = [240, 60, 80, 80];
  for (var thi = 0; thi < colHeaders.length; thi++) {
    var th = txt(colHeaders[thi], 9, fonts.bold, { r: 0.4, g: 0.4, b: 0.45 });
    th.letterSpacing = { value: 0.5, unit: "PIXELS" };
    th.x = colX[thi]; th.y = 8;
    tableHeader.appendChild(th);
  }
  invoice.appendChild(tableHeader);

  // Filas de items
  var items = [
    ["Diseño de identidad visual", "1", "2.500,00 €", "2.500,00 €"],
    ["Manual de marca", "1", "1.200,00 €", "1.200,00 €"],
    ["Plantillas redes sociales", "10", "85,00 €", "850,00 €"],
    ["Papelería corporativa", "1", "650,00 €", "650,00 €"]
  ];

  for (var ii = 0; ii < items.length; ii++) {
    for (var ici = 0; ici < 4; ici++) {
      var ic = txt(items[ii][ici], ici === 0 ? 10 : 10, ici === 0 ? fonts.reg : fonts.reg, { r: 0.25, g: 0.25, b: 0.3 });
      ic.x = 24 + colX[ici]; ic.y = 286 + ii * 28;
      invoice.appendChild(ic);
    }
    // Línea separadora
    if (ii < items.length - 1) {
      dashedLine(invoice, INV_W - 48, 24, 308 + ii * 28, { r: 0.93, g: 0.93, b: 0.95 });
    }
  }

  dashedLine(invoice, INV_W - 48, 24, 400, { r: 0.85, g: 0.85, b: 0.88 });

  // Totales
  var totals = [
    { label: "Subtotal", val: "5.200,00 €", bold: false },
    { label: "IVA (21%)", val: "1.092,00 €", bold: false },
    { label: "TOTAL", val: "6.292,00 €", bold: true }
  ];

  for (var ti = 0; ti < totals.length; ti++) {
    var tl = txt(totals[ti].label, totals[ti].bold ? 12 : 10, totals[ti].bold ? fonts.bold : fonts.reg, totals[ti].bold ? { r: 0.1, g: 0.1, b: 0.12 } : { r: 0.5, g: 0.5, b: 0.55 });
    tl.textAlignHorizontal = "RIGHT";
    tl.x = INV_W - 200; tl.y = 416 + ti * 26;
    tl.resize(100, 14);
    invoice.appendChild(tl);

    var tv = txt(totals[ti].val, totals[ti].bold ? 14 : 11, totals[ti].bold ? fonts.bold : fonts.reg, totals[ti].bold ? accent : { r: 0.25, g: 0.25, b: 0.3 });
    tv.textAlignHorizontal = "RIGHT";
    tv.x = INV_W - 100; tv.y = 414 + ti * 26;
    tv.resize(76, 16);
    invoice.appendChild(tv);
  }

  // Total destacado
  if (totals[2].bold) {
    var totalBg = figma.createRectangle();
    totalBg.resize(INV_W - 48, 32);
    totalBg.x = 24; totalBg.y = 460;
    totalBg.cornerRadius = 4;
    totalBg.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    // Añadir antes del texto total para que quede detrás
    invoice.appendChild(totalBg);
  }

  // Notas al pie
  dashedLine(invoice, INV_W - 48, 24, 510, { r: 0.88, g: 0.88, b: 0.9 });

  var invNotes = txt("Forma de pago: Transferencia bancaria\nIBAN: ES12 3456 7890 1234 5678 9012\nPago a 30 días desde la fecha de emisión.", 9, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  invNotes.x = 24; invNotes.y = 522;
  invNotes.resize(INV_W - 48, 45);
  invoice.appendChild(invNotes);

  // Footer
  var invFooter = txt("Tu Empresa S.A. · CIF: B12345678 · info@tuempresa.com · +34 912 345 678", 8, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  invFooter.textAlignHorizontal = "CENTER";
  invFooter.resize(INV_W - 48, 12);
  invFooter.x = 24; invFooter.y = INV_H - 28;
  invoice.appendChild(invFooter);

  place(invoice, PAD, cursorY);
  mockLabel("A5 / Media Carta (estructura contable)", PAD, cursorY + INV_H + 8);

  cursorY += INV_H + 60;

  // ── Ajustar altura final ─────────────────────────────
  mock.resize(PAGE_W, cursorY + 60);

  return createdFrames;
}

// ═══════════════════════════════════════════════════════════════════════
// MOCKUPS 2 — Señalética, Digital/Marketing, Packaging (Items 18-28)
// ═══════════════════════════════════════════════════════════════════════

function createMockups2(page, startX, startY, fonts, accent, logoFrame) {
  var createdFrames = [];
  var DS_W = PAGE_W - PAD * 2;

  var mock = figma.createFrame();
  mock.name = "Mockups — Señalética, Digital y Packaging";
  mock.resize(PAGE_W, 12000);
  mock.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
  mock.layoutMode = "NONE";
  mock.clipsContent = false;
  mock.x = startX;
  mock.y = startY;
  page.appendChild(mock);
  createdFrames.push(mock);

  var cursorY = 60;

  function txt(content, size, font, color) {
    var t = figma.createText();
    t.characters = content;
    t.fontSize = size;
    t.fontName = font;
    t.fills = [{ type: "SOLID", color: color }];
    return t;
  }

  function place(item, x, y) { item.x = x; item.y = y; mock.appendChild(item); }

  function sectionHeader(title, count) {
    var lbl = txt(title.toUpperCase(), 11, fonts.bold, accent);
    lbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
    lbl.x = PAD; lbl.y = cursorY; lbl.resize(DS_W, 14); lbl.textAutoResize = "HEIGHT";
    mock.appendChild(lbl);
    var cnt = txt(count + " items", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
    cnt.x = PAD + 280; cnt.y = cursorY; mock.appendChild(cnt);
    cursorY += 20;
    var sep = figma.createRectangle();
    sep.resize(DS_W, 1); sep.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    sep.x = PAD; sep.y = cursorY; mock.appendChild(sep);
    cursorY += 24;
  }

  function mockLabel(text, x, y) {
    var lbl = txt(text, 11, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
    lbl.x = x; lbl.y = y; mock.appendChild(lbl);
  }

  function addLogoTo(parentFrame, maxW, maxH) {
    var logo = logoFrame.clone(); logo.name = "Logo";
    if (logo.width > maxW || logo.height > maxH) {
      var s = Math.min(maxW / logo.width, maxH / logo.height);
      logo.resize(Math.round(logo.width * s), Math.round(logo.height * s));
    }
    parentFrame.appendChild(logo);
    return logo;
  }

  function dashedLine(parent, w, x, y, color) {
    var line = figma.createRectangle();
    line.resize(w, 1); line.fills = [{ type: "SOLID", color: color || { r: 0.8, g: 0.8, b: 0.85 } }];
    line.x = x; line.y = y; line.dashPattern = [4, 3]; parent.appendChild(line);
  }

  function fakeLines(parent, x, y, count, maxW) {
    for (var i = 0; i < count; i++) {
      var l = figma.createRectangle();
      l.resize(maxW - Math.round(Math.random() * 60), 1);
      l.fills = [{ type: "SOLID", color: { r: 0.91, g: 0.91, b: 0.93 } }];
      l.x = x; l.y = y + i * 18; parent.appendChild(l);
    }
  }

  // ── HEADER ────────────────────────────────────────────
  var mainLabel = txt("MOCKUPS", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  mainLabel.letterSpacing = { value: 2, unit: "PIXELS" };
  mainLabel.x = PAD; mainLabel.y = cursorY; mock.appendChild(mainLabel);
  cursorY += 20;

  var mainTitle = txt("Señalética, Digital y Packaging", 36, fonts.bold, { r: 0.08, g: 0.08, b: 0.1 });
  mainTitle.x = PAD; mainTitle.y = cursorY; mainTitle.resize(DS_W, 44); mock.appendChild(mainTitle);
  cursorY += 52;

  var mainDesc = txt("Mockups vectoriales de señalética corporativa, material de marketing digital y packaging. Datos de ejemplo.", 15, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  mainDesc.x = PAD; mainDesc.y = cursorY; mainDesc.resize(DS_W, 22); mainDesc.textAutoResize = "HEIGHT";
  mainDesc.lineHeight = { value: 160, unit: "PERCENT" }; mock.appendChild(mainDesc);
  cursorY += 56;

  // ═══════════════════════════════════════════════════════════
  // 18. TARJETA DE IDENTIFICACIÓN / CARNET
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Tarjeta de Identificación / Carnet", 2);

  var ID_W = 320;
  var ID_H = 500; // Proporción carné estándar

  // ── Frente ────────────────────────────────────────
  var idFront = figma.createFrame();
  idFront.name = "Carnet — Frente";
  idFront.resize(ID_W, ID_H);
  idFront.cornerRadius = 12;
  idFront.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  idFront.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header con acento
  var idHeader = figma.createRectangle();
  idHeader.resize(ID_W, 80); idHeader.fills = [{ type: "SOLID", color: accent }];
  idHeader.topLeftRadius = 12; idHeader.topRightRadius = 12;
  idFront.appendChild(idHeader);

  // Logo en header
  var idLogo = addLogoTo(idFront, 100, 35);
  idLogo.x = Math.round((ID_W - idLogo.width) / 2); idLogo.y = 22;

  // Texto en header
  var idCompany = txt("TU EMPRESA S.A.", 11, fonts.bold, { r: 1, g: 1, b: 1 });
  idCompany.textAlignHorizontal = "CENTER"; idCompany.resize(ID_W, 14);
  idCompany.x = 0; idCompany.y = 62; idFront.appendChild(idCompany);

  // Foto placeholder (círculo)
  var photo = figma.createEllipse();
  photo.resize(100, 100); photo.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.93 } }];
  photo.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.85 } }];
  photo.strokeWeight = 2;
  photo.x = Math.round((ID_W - 100) / 2); photo.y = 100;
  idFront.appendChild(photo);

  // Icono de persona en foto
  var photoIcon = txt("👤", 32, fonts.reg, { r: 0.7, g: 0.7, b: 0.75 });
  photoIcon.textAlignHorizontal = "CENTER"; photoIcon.resize(100, 40);
  photoIcon.x = Math.round((ID_W - 100) / 2); photoIcon.y = 128;
  idFront.appendChild(photoIcon);

  // Nombre
  var idName = txt("María García López", 18, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  idName.textAlignHorizontal = "CENTER"; idName.resize(ID_W, 22);
  idName.x = 0; idName.y = 225; idFront.appendChild(idName);

  // Cargo
  var idRole = txt("Directora Creativa", 13, fonts.reg, accent);
  idRole.textAlignHorizontal = "CENTER"; idRole.resize(ID_W, 18);
  idRole.x = 0; idRole.y = 252; idFront.appendChild(idRole);

  // ID Number
  var idNum = txt("ID: EMP-2026-0042", 11, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  idNum.textAlignHorizontal = "CENTER"; idNum.resize(ID_W, 16);
  idNum.x = 0; idNum.y = 280; idFront.appendChild(idNum);

  // Línea separadora
  dashedLine(idFront, ID_W - 60, 30, 310, { r: 0.88, g: 0.88, b: 0.9 });

  // Info contacto
  var idContact = txt("Calle Principal 123, Madrid\n+34 912 345 678\ninfo@tuempresa.com", 10, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
  idContact.textAlignHorizontal = "CENTER"; idContact.resize(ID_W - 40, 55);
  idContact.x = 20; idContact.y = 325; idFront.appendChild(idContact);

  // Footer con acento
  var idFooter = figma.createRectangle();
  idFooter.resize(ID_W, 6); idFooter.fills = [{ type: "SOLID", color: accent }];
  idFooter.bottomLeftRadius = 12; idFooter.bottomRightRadius = 12;
  idFooter.y = ID_H - 6; idFront.appendChild(idFooter);

  // Vigencia
  var idExp = txt("Válido hasta: 12/2026", 9, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  idExp.textAlignHorizontal = "CENTER"; idExp.resize(ID_W, 14);
  idExp.x = 0; idExp.y = ID_H - 30; idFront.appendChild(idExp);

  place(idFront, PAD, cursorY);
  mockLabel("Frente — Foto, nombre, cargo", PAD, cursorY + ID_H + 8);

  // ── Reverso ──────────────────────────────────────
  var idBack = figma.createFrame();
  idBack.name = "Carnet — Reverso";
  idBack.resize(ID_W, ID_H);
  idBack.cornerRadius = 12;
  idBack.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
  idBack.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Franja acento arriba
  var idBackBar = figma.createRectangle();
  idBackBar.resize(ID_W, 6); idBackBar.fills = [{ type: "SOLID", color: accent }];
  idBackBar.topLeftRadius = 12; idBackBar.topRightRadius = 12;
  idBack.appendChild(idBackBar);

  // QR Code placeholder
  var qrFrame = figma.createFrame();
  qrFrame.name = "QR Code";
  qrFrame.resize(140, 140); qrFrame.cornerRadius = 8;
  qrFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  qrFrame.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.85 } }];
  qrFrame.strokeWeight = 1;
  qrFrame.x = Math.round((ID_W - 140) / 2); qrFrame.y = 40;
  qrFrame.layoutMode = "VERTICAL"; qrFrame.primaryAxisAlignItems = "CENTER"; qrFrame.counterAxisAlignItems = "CENTER";

  // Simular QR con grid de rects
  var qrGrid = figma.createFrame(); qrGrid.resize(100, 100); qrGrid.fills = [];
  for (var qr = 0; qr < 10; qr++) {
    for (var qc = 0; qc < 10; qc++) {
      if (Math.random() > 0.45) {
        var qrDot = figma.createRectangle();
        qrDot.resize(10, 10); qrDot.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.15 } }];
        qrDot.x = qc * 10; qrDot.y = qr * 10;
        qrGrid.appendChild(qrDot);
      }
    }
  }
  qrFrame.appendChild(qrGrid);
  idBack.appendChild(qrFrame);

  var qrLabel = txt("ESCANEAR PARA VERIFICAR", 9, fonts.bold, { r: 0.5, g: 0.5, b: 0.55 });
  qrLabel.letterSpacing = { value: 1, unit: "PIXELS" };
  qrLabel.textAlignHorizontal = "CENTER"; qrLabel.resize(ID_W, 14);
  qrLabel.x = 0; qrLabel.y = 200; idBack.appendChild(qrLabel);

  // Instrucciones
  var idInstr = txt("En caso de pérdida, devolver a:\nTu Empresa S.A.\nCalle Principal 123, Madrid\nTel: +34 912 345 678", 10, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
  idInstr.textAlignHorizontal = "CENTER"; idInstr.resize(ID_W - 60, 70);
  idInstr.x = 30; idInstr.y = 240; idBack.appendChild(idInstr);

  dashedLine(idBack, ID_W - 60, 30, 330, { r: 0.88, g: 0.88, b: 0.9 });

  // Footer empresa
  var idBackLogo = addLogoTo(idBack, 80, 30);
  idBackLogo.x = Math.round((ID_W - idBackLogo.width) / 2); idBackLogo.y = 360;

  var idBackCompany = txt("Tu Empresa S.A. · tuempresa.com", 9, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  idBackCompany.textAlignHorizontal = "CENTER"; idBackCompany.resize(ID_W, 14);
  idBackCompany.x = 0; idBackCompany.y = 410; idBack.appendChild(idBackCompany);

  place(idBack, PAD + ID_W + 32, cursorY);
  mockLabel("Reverso — QR + info", PAD + ID_W + 32, cursorY + ID_H + 8);

  cursorY += ID_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 19. PAPELERÍA DE BIENVENIDA — Carta de onboarding
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Papelería de Bienvenida", 1);

  var WEL_W = 420;
  var WEL_H = 560;

  var welcome = figma.createFrame();
  welcome.name = "Carta de Bienvenida — Onboarding";
  welcome.resize(WEL_W, WEL_H);
  welcome.cornerRadius = 4;
  welcome.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  welcome.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header degradado simulado (dos rectángulos)
  var welHeaderTop = figma.createRectangle();
  welHeaderTop.resize(WEL_W, 50); welHeaderTop.fills = [{ type: "SOLID", color: accent }];
  welHeaderTop.topLeftRadius = 4; welHeaderTop.topRightRadius = 4;
  welcome.appendChild(welHeaderTop);

  // Logo
  var welLogo = addLogoTo(welcome, 100, 35);
  welLogo.x = Math.round((WEL_W - welLogo.width) / 2); welLogo.y = 8;

  // Banner texto
  var welBanner = txt("¡BIENVID@ A NUESTRO EQUIPO!", 16, fonts.bold, { r: 1, g: 1, b: 1 });
  welBanner.textAlignHorizontal = "CENTER"; welBanner.resize(WEL_W, 20);
  welBanner.x = 0; welBanner.y = 60; welcome.appendChild(welBanner);

  // Contenido
  var welDate = txt("Madrid, 13 de abril de 2026", 11, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  welDate.x = 36; welDate.y = 100; welcome.appendChild(welDate);

  var welGreeting = txt("Estimad@ María García López,", 13, fonts.reg, { r: 0.2, g: 0.2, b: 0.25 });
  welGreeting.x = 36; welGreeting.y = 130; welcome.appendChild(welGreeting);

  var welBody = txt("Nos complace darte la bienvenida a nuestro equipo. Estamos emocionados de que formes parte de Tu Empresa S.A. como Directora Creativa.\n\nA continuación encontrarás la información clave para tus primeros días:", 12, fonts.reg, { r: 0.35, g: 0.35, b: 0.4 });
  welBody.resize(WEL_W - 72, 80); welBody.textAutoResize = "HEIGHT";
  welBody.lineHeight = { value: 170, unit: "PERCENT" };
  welBody.x = 36; welBody.y = 165; welcome.appendChild(welBody);

  // Checklist de onboarding
  var onbLabel = txt("TUS PRIMEROS PASOS", 10, fonts.bold, accent);
  onbLabel.letterSpacing = { value: 1, unit: "PIXELS" };
  onbLabel.x = 36; onbLabel.y = 270; welcome.appendChild(onbLabel);

  var onbItems = ["Recoger tu carnet de identificación", "Configurar tu email corporativo", "Reunión con tu manager — Lunes 10:00", "Tour por las oficinas", "Revisar el handbook del empleado"];
  for (var oi = 0; oi < onbItems.length; oi++) {
    var oCircle = figma.createEllipse();
    oCircle.resize(16, 16); oCircle.cornerRadius = 100;
    oCircle.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.96 } }];
    oCircle.strokes = [{ type: "SOLID", color: accent }]; oCircle.strokeWeight = 1.5;
    oCircle.x = 36; oCircle.y = 294 + oi * 28;
    welcome.appendChild(oCircle);

    var oItem = txt(onbItems[oi], 11, fonts.reg, { r: 0.3, g: 0.3, b: 0.35 });
    oItem.x = 62; oItem.y = 293 + oi * 28;
    welcome.appendChild(oItem);
  }

  dashedLine(welcome, WEL_W - 72, 36, 455, { r: 0.88, g: 0.88, b: 0.9 });

  var welSign = txt("Recursos Humanos\nTu Empresa S.A.", 11, fonts.bold, { r: 0.25, g: 0.25, b: 0.3 });
  welSign.x = 36; welSign.y = 472; welcome.appendChild(welSign);

  var welContact = txt("¿Preguntas? Escríbenos a hr@tuempresa.com", 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  welContact.textAlignHorizontal = "CENTER"; welContact.resize(WEL_W - 72, 14);
  welContact.x = 36; welContact.y = 520; welcome.appendChild(welContact);

  place(welcome, PAD, cursorY);
  mockLabel("Carta de onboarding — A5", PAD, cursorY + WEL_H + 8);

  cursorY += WEL_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 20. CALENDARIO — 1 página mensual
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Calendario", 1);

  var CAL_W = 520;
  var CAL_H = 580;

  var cal = figma.createFrame();
  cal.name = "Calendario — Abril 2026";
  cal.resize(CAL_W, CAL_H);
  cal.cornerRadius = 8;
  cal.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  cal.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header
  var calHeader = figma.createFrame();
  calHeader.resize(CAL_W, 100); calHeader.fills = [{ type: "SOLID", color: accent }];
  calHeader.topLeftRadius = 8; calHeader.topRightRadius = 8;
  cal.appendChild(calHeader);

  var calLogo = addLogoTo(cal, 90, 30);
  calLogo.x = CAL_W - calLogo.width - 24; calLogo.y = 12;

  var calMonth = txt("ABRIL", 42, fonts.bold, { r: 1, g: 1, b: 1 });
  calMonth.x = 24; calMonth.y = 20; cal.appendChild(calMonth);

  var calYear = txt("2026", 18, fonts.reg, { r: 1, g: 1, b: 1 });
  calYear.x = 24; calYear.y = 65; cal.appendChild(calYear);

  // Días de la semana
  var weekDays = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
  var cellW = Math.floor((CAL_W - 48) / 7);

  for (var wd = 0; wd < 7; wd++) {
    var dayLbl = txt(weekDays[wd], 10, fonts.bold, wd >= 5 ? { r: 0.7, g: 0.7, b: 0.75 } : { r: 0.5, g: 0.5, b: 0.55 });
    dayLbl.textAlignHorizontal = "CENTER"; dayLbl.resize(cellW, 14);
    dayLbl.x = 24 + wd * cellW; dayLbl.y = 120;
    cal.appendChild(dayLbl);
  }

  // Grid de días (abril 2026 empieza en miércoles = índice 2)
  var startDay = 2; // Miércoles
  var daysInMonth = 30;
  var cellH = 64;
  var dayNum = 1;

  for (var row = 0; row < 6; row++) {
    for (var col = 0; col < 7; col++) {
      var cellIndex = row * 7 + col;
      if (cellIndex >= startDay && dayNum <= daysInMonth) {
        // Celda
        var cellBg = figma.createFrame();
        cellBg.resize(cellW - 2, cellH - 2);
        cellBg.x = 24 + col * cellW + 1;
        cellBg.y = 142 + row * cellH + 1;
        cellBg.cornerRadius = 6;

        // Destacar día actual (13)
        if (dayNum === 13) {
          cellBg.fills = [{ type: "SOLID", color: accent }];
          var dayT = txt(String(dayNum), 14, fonts.bold, { r: 1, g: 1, b: 1 });
          dayT.x = 24 + col * cellW + 8; dayT.y = 142 + row * cellH + 8;
          cal.appendChild(dayT);
        } else {
          cellBg.fills = col >= 5 ? [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }] : [];
          var dayT2 = txt(String(dayNum), 14, col >= 5 ? fonts.reg : fonts.reg, col >= 5 ? { r: 0.7, g: 0.7, b: 0.75 } : { r: 0.2, g: 0.2, b: 0.25 });
          dayT2.x = 24 + col * cellW + 8; dayT2.y = 142 + row * cellH + 8;
          cal.appendChild(dayT2);
        }

        // Evento de ejemplo en día 13 y 20
        if (dayNum === 13 || dayNum === 20) {
          var evtDot = figma.createRectangle();
          evtDot.resize(cellW - 20, 4); evtDot.cornerRadius = 2;
          evtDot.fills = [{ type: "SOLID", color: dayNum === 13 ? { r: 1, g: 1, b: 1 } : accent }];
          evtDot.x = 24 + col * cellW + 8; evtDot.y = 142 + row * cellH + 42;
          cal.appendChild(evtDot);
        }

        cal.appendChild(cellBg);
        dayNum++;
      }
    }
  }

  place(cal, PAD, cursorY);
  mockLabel("1 página mensual con branding", PAD, cursorY + CAL_H + 8);

  cursorY += CAL_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 21. PRESENTACIÓN (PT) — Portada + Slide
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Presentación", 2);

  var PT_W = 400;
  var PT_H = 225; // 16:9

  // ── Portada ────────────────────────────────────────
  var ptCover = figma.createFrame();
  ptCover.name = "Presentación — Portada";
  ptCover.resize(PT_W, PT_H);
  ptCover.cornerRadius = 6;
  ptCover.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.09 } }];
  ptCover.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Barra lateral acento
  var ptSideBar = figma.createRectangle();
  ptSideBar.resize(6, PT_H); ptSideBar.fills = [{ type: "SOLID", color: accent }];
  ptSideBar.topLeftRadius = 6; ptSideBar.bottomLeftRadius = 6;
  ptCover.appendChild(ptSideBar);

  var ptLogo = addLogoTo(ptCover, 80, 30);
  ptLogo.x = 24; ptLogo.y = 20;

  var ptTitle = txt("Tu Título de\nPresentación", 24, fonts.bold, { r: 1, g: 1, b: 1 });
  ptTitle.resize(PT_W - 48, 60); ptTitle.textAutoResize = "HEIGHT";
  ptTitle.lineHeight = { value: 120, unit: "PERCENT" };
  ptTitle.x = 24; ptTitle.y = 80; ptCover.appendChild(ptTitle);

  var ptSub = txt("Subtítulo descriptivo · Fecha", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  ptSub.x = 24; ptSub.y = 165; ptCover.appendChild(ptSub);

  var ptSlideNum = txt("01", 10, fonts.bold, accent);
  ptSlideNum.x = PT_W - 40; ptSlideNum.y = PT_H - 30; ptCover.appendChild(ptSlideNum);

  place(ptCover, PAD, cursorY);
  mockLabel("Portada 16:9", PAD, cursorY + PT_H + 8);

  // ── Slide de contenido ─────────────────────────────
  var ptContent = figma.createFrame();
  ptContent.name = "Presentación — Contenido";
  ptContent.resize(PT_W, PT_H);
  ptContent.cornerRadius = 6;
  ptContent.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  ptContent.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header bar
  var ptHeaderBar = figma.createRectangle();
  ptHeaderBar.resize(PT_W, 4); ptHeaderBar.fills = [{ type: "SOLID", color: accent }];
  ptHeaderBar.topLeftRadius = 6; ptHeaderBar.topRightRadius = 6;
  ptContent.appendChild(ptHeaderBar);

  var ptSlideTitle = txt("Título del Slide", 18, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  ptSlideTitle.x = 24; ptSlideTitle.y = 20; ptContent.appendChild(ptSlideTitle);

  // Dos columnas de contenido
  var ptCol1 = txt("Punto clave uno\ncon explicación breve del concepto principal.", 10, fonts.reg, { r: 0.35, g: 0.35, b: 0.4 });
  ptCol1.resize(170, 80); ptCol1.textAutoResize = "HEIGHT";
  ptCol1.lineHeight = { value: 160, unit: "PERCENT" };
  ptCol1.x = 24; ptCol1.y = 55; ptContent.appendChild(ptCol1);

  var ptCol2 = txt("Punto clave dos\ncon información complementaria relevante.", 10, fonts.reg, { r: 0.35, g: 0.35, b: 0.4 });
  ptCol2.resize(170, 80); ptCol2.textAutoResize = "HEIGHT";
  ptCol2.lineHeight = { value: 160, unit: "PERCENT" };
  ptCol2.x = 210; ptCol2.y = 55; ptContent.appendChild(ptCol2);

  // Imagen placeholder
  var ptImg = figma.createRectangle();
  ptImg.resize(PT_W - 48, 80); ptImg.cornerRadius = 6;
  ptImg.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
  ptImg.x = 24; ptImg.y = 135; ptContent.appendChild(ptImg);

  var ptImgLbl = txt("Imagen / Gráfico", 10, fonts.reg, { r: 0.65, g: 0.65, b: 0.7 });
  ptImgLbl.textAlignHorizontal = "CENTER"; ptImgLbl.resize(PT_W - 48, 14);
  ptImgLbl.x = 24; ptImgLbl.y = 168; ptContent.appendChild(ptImgLbl);

  // Logo + slide num
  var ptLogo2 = addLogoTo(ptContent, 50, 18);
  ptLogo2.x = 24; ptLogo2.y = PT_H - 26;

  var ptNum2 = txt("02", 10, fonts.bold, { r: 0.6, g: 0.6, b: 0.65 });
  ptNum2.x = PT_W - 40; ptNum2.y = PT_H - 26; ptContent.appendChild(ptNum2);

  place(ptContent, PAD + PT_W + 20, cursorY);
  mockLabel("Slide de contenido", PAD + PT_W + 20, cursorY + PT_H + 8);

  cursorY += PT_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 22. PROPUESTA COMERCIAL
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Propuesta Comercial", 2);

  var PROP_W = 380;
  var PROP_H = 520;

  // ── Portada ────────────────────────────────────────
  var propCover = figma.createFrame();
  propCover.name = "Propuesta — Portada";
  propCover.resize(PROP_W, PROP_H);
  propCover.cornerRadius = 4;
  propCover.fills = [{ type: "SOLID", color: accent }];
  propCover.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  var propLogo = addLogoTo(propCover, 120, 50);
  propLogo.x = Math.round((PROP_W - propLogo.width) / 2); propLogo.y = 50;

  var propTitle = txt("PROPUESTA\nCOMERCIAL", 32, fonts.bold, { r: 1, g: 1, b: 1 });
  propTitle.textAlignHorizontal = "CENTER"; propTitle.resize(PROP_W - 48, 80);
  propTitle.lineHeight = { value: 110, unit: "PERCENT" };
  propTitle.x = 24; propTitle.y = 160; propCover.appendChild(propTitle);

  dashedLine(propCover, 60, Math.round((PROP_W - 60) / 2), 260, { r: 1, g: 1, b: 1 });

  var propClient = txt("Preparado para: Nombre del Cliente", 12, fonts.reg, { r: 1, g: 1, b: 1 });
  propClient.textAlignHorizontal = "CENTER"; propClient.resize(PROP_W - 48, 16);
  propClient.x = 24; propClient.y = 285; propCover.appendChild(propClient);

  var propDate = txt("Abril 2026", 11, fonts.reg, { r: 0.8, g: 0.8, b: 0.85 });
  propDate.textAlignHorizontal = "CENTER"; propDate.resize(PROP_W, 16);
  propDate.x = 0; propDate.y = 315; propCover.appendChild(propDate);

  place(propCover, PAD, cursorY);
  mockLabel("Portada de propuesta", PAD, cursorY + PROP_H + 8);

  // ── Página de contenido ────────────────────────────
  var propPage = figma.createFrame();
  propPage.name = "Propuesta — Contenido";
  propPage.resize(PROP_W, PROP_H);
  propPage.cornerRadius = 4;
  propPage.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  propPage.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  var propPageHeader = figma.createRectangle();
  propPageHeader.resize(PROP_W, 4); propPageHeader.fills = [{ type: "SOLID", color: accent }];
  propPageHeader.topLeftRadius = 4; propPageHeader.topRightRadius = 4;
  propPage.appendChild(propPageHeader);

  var propSecTitle = txt("NUESTRA PROPUESTA", 11, fonts.bold, accent);
  propSecTitle.letterSpacing = { value: 1, unit: "PIXELS" };
  propSecTitle.x = 24; propSecTitle.y = 20; propPage.appendChild(propSecTitle);

  var propH2 = txt("Solución Integral de Diseño", 20, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  propH2.x = 24; propH2.y = 44; propPage.appendChild(propH2);

  fakeLines(propPage, 24, 85, 4, PROP_W - 48);

  // Secciones de la propuesta
  var propSections = ["ALCANCE DEL PROYECTO", "CRONOGRAMA", "INVERSIÓN"];
  for (var psi = 0; psi < propSections.length; psi++) {
    var ps = txt(propSections[psi], 10, fonts.bold, { r: 0.35, g: 0.35, b: 0.4 });
    ps.letterSpacing = { value: 0.5, unit: "PIXELS" };
    ps.x = 24; ps.y = 170 + psi * 100; propPage.appendChild(ps);

    fakeLines(propPage, 24, 190 + psi * 100, 3, PROP_W - 48);
  }

  // Footer
  var propFooterLogo = addLogoTo(propPage, 50, 18);
  propFooterLogo.x = 24; propFooterLogo.y = PROP_H - 28;

  var propPageNum = txt("2", 10, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  propPageNum.x = PROP_W - 40; propPageNum.y = PROP_H - 28; propPage.appendChild(propPageNum);

  place(propPage, PAD + PROP_W + 20, cursorY);
  mockLabel("Página de contenido", PAD + PROP_W + 20, cursorY + PROP_H + 8);

  cursorY += PROP_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 23. BROCHURE / FOLLETO — Tríptico
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Brochure / Folleto — Tríptico", 2);

  var PANEL_W = 170;
  var PANEL_H = 400;

  // ── Exterior ───────────────────────────────────────
  var tripticoExt = figma.createFrame();
  tripticoExt.name = "Tríptico — Exterior (3 paneles)";
  tripticoExt.resize(PANEL_W * 3 + 8, PANEL_H); // gaps entre paneles
  tripticoExt.cornerRadius = 4;
  tripticoExt.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];

  var extPanels = [
    { label: "CONTRAPORTADA", title: "Contacto", bg: { r: 0.97, g: 0.97, b: 0.98 } },
    { label: "PORTADA", title: "Tu Empresa", bg: accent },
    { label: "INTERIOR DERECHA", title: "Servicios", bg: { r: 0.97, g: 0.97, b: 0.98 } }
  ];

  for (var epi = 0; epi < 3; epi++) {
    var ep = figma.createFrame();
    ep.name = extPanels[epi].label;
    ep.resize(PANEL_W, PANEL_H); ep.x = epi * (PANEL_W + 4);
    ep.cornerRadius = 4;
    ep.fills = [{ type: "SOLID", color: extPanels[epi].bg }];

    var isDark = epi === 1;
    var epTxtMain = isDark ? { r: 1, g: 1, b: 1 } : { r: 0.1, g: 0.1, b: 0.12 };
    var epTxtSub = isDark ? { r: 0.8, g: 0.8, b: 0.85 } : { r: 0.5, g: 0.5, b: 0.55 };

    // Logo
    var epLogo = addLogoTo(ep, 80, 30);
    epLogo.x = Math.round((PANEL_W - epLogo.width) / 2); epLogo.y = 30;

    var epTitle = txt(extPanels[epi].title, 16, fonts.bold, epTxtMain);
    epTitle.textAlignHorizontal = "CENTER"; epTitle.resize(PANEL_W - 24, 20);
    epTitle.x = 12; epTitle.y = 80; ep.appendChild(epTitle);

    if (epi === 1) {
      var epSub = txt("Tu marca merece\nser recordada", 11, fonts.reg, { r: 0.85, g: 0.85, b: 0.9 });
      epSub.textAlignHorizontal = "CENTER"; epSub.resize(PANEL_W - 24, 40);
      epSub.x = 12; epSub.y = 120; ep.appendChild(epSub);
    } else {
      fakeLines(ep, 16, 120, 6, PANEL_W - 32);
    }

    // Footer del panel
    var epFooter = txt("tuempresa.com", 9, fonts.reg, epTxtSub);
    epFooter.textAlignHorizontal = "CENTER"; epFooter.resize(PANEL_W, 12);
    epFooter.x = 0; epFooter.y = PANEL_H - 28; ep.appendChild(epFooter);

    tripticoExt.appendChild(ep);
  }

  place(tripticoExt, PAD, cursorY);
  mockLabel("Exterior — Portada / Interior / Contraportada", PAD, cursorY + PANEL_H + 8);

  // ── Interior ───────────────────────────────────────
  var tripticoInt = figma.createFrame();
  tripticoInt.name = "Tríptico — Interior (3 paneles)";
  tripticoInt.resize(PANEL_W * 3 + 8, PANEL_H);
  tripticoInt.cornerRadius = 4;
  tripticoInt.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];

  var intTitles = ["Nuestros Servicios", "Proceso de Trabajo", "Casos de Éxito"];
  for (var ipi = 0; ipi < 3; ipi++) {
    var ip = figma.createFrame();
    ip.name = "Panel " + (ipi + 1);
    ip.resize(PANEL_W, PANEL_H); ip.x = ipi * (PANEL_W + 4);
    ip.cornerRadius = 4;
    ip.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

    var ipTitle = txt(intTitles[ipi], 13, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
    ipTitle.x = 14; ipTitle.y = 20; ip.appendChild(ipTitle);

    dashedLine(ip, PANEL_W - 28, 14, 42, accent);

    fakeLines(ip, 14, 56, 10, PANEL_W - 28);

    tripticoInt.appendChild(ip);
  }

  place(tripticoInt, PAD, cursorY + PANEL_H + 40);
  mockLabel("Interior — 3 paneles de contenido", PAD, cursorY + PANEL_H * 2 + 48);

  cursorY += PANEL_H * 2 + 90;

  // ═══════════════════════════════════════════════════════════
  // 24. EMAIL TEMPLATE
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Email Template", 1);

  var EMAIL_W = 420;
  var EMAIL_H = 560;

  var email = figma.createFrame();
  email.name = "Email Template";
  email.resize(EMAIL_W, EMAIL_H);
  email.cornerRadius = 8;
  email.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
  email.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header
  var emailHeader = figma.createFrame();
  emailHeader.resize(EMAIL_W, 80); emailHeader.fills = [{ type: "SOLID", color: accent }];
  emailHeader.topLeftRadius = 8; emailHeader.topRightRadius = 8;
  email.appendChild(emailHeader);

  var emailLogo = addLogoTo(email, 100, 35);
  emailLogo.x = Math.round((EMAIL_W - emailLogo.width) / 2); emailLogo.y = 22;

  // Body
  var emailBody = figma.createFrame();
  emailBody.resize(EMAIL_W, 380); emailBody.y = 80;
  emailBody.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  emailBody.layoutMode = "VERTICAL"; emailBody.itemSpacing = 16;
  emailBody.paddingLeft = 32; emailBody.paddingRight = 32;
  emailBody.paddingTop = 24; emailBody.paddingBottom = 24;
  emailBody.primaryAxisSizingMode = "FIXED"; emailBody.counterAxisSizingMode = "FIXED";

  var emailTitle = txt("Asunto: Tu última actualización semanal", 16, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  emailBody.appendChild(emailTitle);

  var emailGreeting = txt("Hola María,", 13, fonts.reg, { r: 0.3, g: 0.3, b: 0.35 });
  emailBody.appendChild(emailGreeting);

  var emailText = txt("Aquí tienes un resumen de las novedades de esta semana. Hemos trabajado en nuevas funcionalidades que mejorarán tu experiencia.", 12, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  emailText.resize(EMAIL_W - 64, 50); emailText.textAutoResize = "HEIGHT";
  emailText.lineHeight = { value: 170, unit: "PERCENT" };
  emailBody.appendChild(emailText);

  // Imagen placeholder
  var emailImg = figma.createRectangle();
  emailImg.resize(EMAIL_W - 64, 120); emailImg.cornerRadius = 8;
  emailImg.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.95 } }];
  emailBody.appendChild(emailImg);

  // CTA Button
  var emailBtn = figma.createFrame();
  emailBtn.layoutMode = "VERTICAL"; emailBtn.primaryAxisAlignItems = "CENTER"; emailBtn.counterAxisAlignItems = "CENTER";
  emailBtn.paddingLeft = 28; emailBtn.paddingRight = 28; emailBtn.paddingTop = 12; emailBtn.paddingBottom = 12;
  emailBtn.cornerRadius = 8; emailBtn.primaryAxisSizingMode = "AUTO"; emailBtn.counterAxisSizingMode = "AUTO";
  emailBtn.fills = [{ type: "SOLID", color: accent }];
  emailBtn.appendChild(txt("Ver más detalles →", 13, fonts.bold, { r: 1, g: 1, b: 1 }));
  emailBody.appendChild(emailBtn);

  email.appendChild(emailBody);

  // Footer
  var emailFooter = figma.createFrame();
  emailFooter.resize(EMAIL_W, 100); emailFooter.y = EMAIL_H - 100;
  emailFooter.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.14 } }];
  emailFooter.cornerRadius = 0;
  emailFooter.bottomLeftRadius = 8; emailFooter.bottomRightRadius = 8;

  var emailFooterTxt = txt("Tu Empresa S.A. · Calle Principal 123, Madrid\nNo longer want these emails? Unsubscribe", 9, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  emailFooterTxt.textAlignHorizontal = "CENTER"; emailFooterTxt.resize(EMAIL_W - 48, 36);
  emailFooterTxt.x = 24; emailFooterTxt.y = 20; emailFooter.appendChild(emailFooterTxt);

  // Social icons en footer
  var emailSocial = figma.createFrame();
  emailSocial.layoutMode = "HORIZONTAL"; emailSocial.itemSpacing = 12;
  emailSocial.primaryAxisSizingMode = "AUTO"; emailSocial.counterAxisSizingMode = "AUTO";
  emailSocial.fills = []; emailSocial.x = Math.round((EMAIL_W - 120) / 2); emailSocial.y = 65;
  var emailSocials = ["in", "ig", "tw"];
  for (var esi = 0; esi < emailSocials.length; esi++) {
    var esIcon = figma.createFrame(); esIcon.resize(20, 20); esIcon.cornerRadius = 10;
    esIcon.fills = [{ type: "SOLID", color: { r: 0.25, g: 0.25, b: 0.3 } }];
    esIcon.layoutMode = "VERTICAL"; esIcon.primaryAxisAlignItems = "CENTER"; esIcon.counterAxisAlignItems = "CENTER";
    esIcon.appendChild(txt(emailSocials[esi].toUpperCase(), 7, fonts.bold, { r: 0.7, g: 0.7, b: 0.75 }));
    emailSocial.appendChild(esIcon);
  }
  emailFooter.appendChild(emailSocial);
  email.appendChild(emailFooter);

  place(email, PAD, cursorY);
  mockLabel("Header + Body + Footer con CTA", PAD, cursorY + EMAIL_H + 8);

  cursorY += EMAIL_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 25. TARJETA DIGITAL / NFC
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Tarjeta Digital / NFC", 1);

  var NFC_W = 400;
  var NFC_H = 240;

  var nfc = figma.createFrame();
  nfc.name = "Tarjeta Digital / NFC";
  nfc.resize(NFC_W, NFC_H);
  nfc.cornerRadius = 16;
  nfc.fills = [{ type: "SOLID", color: accent }];
  nfc.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.15 }, offset: { x: 0, y: 6 }, radius: 20, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Patrón decorativo (líneas sutiles)
  for (var ni = 0; ni < 5; ni++) {
    var nLine = figma.createRectangle();
    nLine.resize(NFC_W + 40, 1); nLine.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.95 } }];
    nLine.x = -20; nLine.y = 40 + ni * 45;
    nfc.appendChild(nLine);
  }

  // Logo
  var nfcLogo = addLogoTo(nfc, 120, 50);
  nfcLogo.x = 30; nfcLogo.y = 30;

  // Nombre
  var nfcName = txt("María García López", 22, fonts.bold, { r: 1, g: 1, b: 1 });
  nfcName.x = 30; nfcName.y = 100; nfc.appendChild(nfcName);

  var nfcRole = txt("Directora Creativa · Tu Empresa S.A.", 12, fonts.reg, { r: 0.85, g: 0.85, b: 0.9 });
  nfcRole.x = 30; nfcRole.y = 128; nfc.appendChild(nfcRole);

  // Contacto rápido
  var nfcContact = txt("📱 +34 612 345 678   ✉️ maria@tuempresa.com", 10, fonts.reg, { r: 0.8, g: 0.8, b: 0.85 });
  nfcContact.x = 30; nfcContact.y = 170; nfc.appendChild(nfcContact);

  // Icono NFC
  var nfcIcon = txt("📡", 24, fonts.reg, { r: 1, g: 1, b: 1 });
  nfcIcon.x = NFC_W - 50; nfcIcon.y = 20; nfc.appendChild(nfcIcon);

  // Badge "TAP"
  var nfcBadge = figma.createFrame();
  nfcBadge.layoutMode = "VERTICAL"; nfcBadge.primaryAxisAlignItems = "CENTER"; nfcBadge.counterAxisAlignItems = "CENTER";
  nfcBadge.paddingLeft = 12; nfcBadge.paddingRight = 12; nfcBadge.paddingTop = 6; nfcBadge.paddingBottom = 6;
  nfcBadge.cornerRadius = 100; nfcBadge.primaryAxisSizingMode = "AUTO"; nfcBadge.counterAxisSizingMode = "AUTO";
  nfcBadge.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.9 } }];
  nfcBadge.appendChild(txt("TAP TO SHARE", 8, fonts.bold, { r: 1, g: 1, b: 1 }));
  nfcBadge.x = NFC_W - 120; nfcBadge.y = NFC_H - 42;
  nfc.appendChild(nfcBadge);

  place(nfc, PAD, cursorY);
  mockLabel("Tarjeta digital / NFC para compartir contacto", PAD, cursorY + NFC_H + 8);

  cursorY += NFC_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 26. ETIQUETA DE PRODUCTO
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Packaging", 3);

  // ── Etiqueta circular ──────────────────────────────
  var LABEL_R = 120;

  var labelCircle = figma.createFrame();
  labelCircle.name = "Etiqueta — Circular";
  labelCircle.resize(LABEL_R * 2, LABEL_R * 2);
  labelCircle.cornerRadius = LABEL_R;
  labelCircle.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  labelCircle.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true, blendMode: "NORMAL" }];
  labelCircle.strokes = [{ type: "SOLID", color: accent }]; labelCircle.strokeWeight = 2;

  var lcLogo = addLogoTo(labelCircle, 80, 35);
  lcLogo.x = Math.round((LABEL_R * 2 - lcLogo.width) / 2); lcLogo.y = 40;

  var lcName = txt("PRODUCTO", 14, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  lcName.textAlignHorizontal = "CENTER"; lcName.resize(LABEL_R * 2, 18);
  lcName.x = 0; lcName.y = 95; labelCircle.appendChild(lcName);

  var lcSub = txt("Premium · 250ml", 10, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  lcSub.textAlignHorizontal = "CENTER"; lcSub.resize(LABEL_R * 2, 14);
  lcSub.x = 0; lcSub.y = 118; labelCircle.appendChild(lcSub);

  // Anillo interior decorativo
  var lcRing = figma.createEllipse();
  lcRing.resize(LABEL_R * 2 - 30, LABEL_R * 2 - 30);
  lcRing.fills = []; lcRing.strokes = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.93 } }];
  lcRing.strokeWeight = 1; lcRing.x = 15; lcRing.y = 15;
  labelCircle.appendChild(lcRing);

  var lcFooter = txt("tuempresa.com", 8, fonts.reg, accent);
  lcFooter.textAlignHorizontal = "CENTER"; lcFooter.resize(LABEL_R * 2, 12);
  lcFooter.x = 0; lcFooter.y = LABEL_R + 60; labelCircle.appendChild(lcFooter);

  place(labelCircle, PAD, cursorY);
  mockLabel("Etiqueta circular", PAD, cursorY + LABEL_R * 2 + 8);

  // ── Etiqueta rectangular ───────────────────────────
  var LABEL_RW = 280;
  var LABEL_RH = 160;

  var labelRect = figma.createFrame();
  labelRect.name = "Etiqueta — Rectangular";
  labelRect.resize(LABEL_RW, LABEL_RH);
  labelRect.cornerRadius = 8;
  labelRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  labelRect.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true, blendMode: "NORMAL" }];
  labelRect.strokes = [{ type: "SOLID", color: accent }]; labelRect.strokeWeight = 2;

  // Franja acento
  var lrBar = figma.createRectangle();
  lrBar.resize(LABEL_RW, 6); lrBar.fills = [{ type: "SOLID", color: accent }];
  lrBar.topLeftRadius = 8; lrBar.topRightRadius = 8;
  labelRect.appendChild(lrBar);

  var lrLogo = addLogoTo(labelRect, 70, 25);
  lrLogo.x = 16; lrLogo.y = 18;

  var lrName = txt("NOMBRE DEL PRODUCTO", 13, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  lrName.x = 16; lrName.y = 55; labelRect.appendChild(lrName);

  var lrDesc = txt("Descripción breve del producto.\nOrigen: España · Peso neto: 500g", 10, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
  lrDesc.resize(LABEL_RW - 32, 36); lrDesc.x = 16; lrDesc.y = 78; labelRect.appendChild(lrDesc);

  // Barcode placeholder
  var lrBarcode = figma.createFrame();
  lrBarcode.resize(100, 30); lrBarcode.fills = [];
  for (var bi = 0; bi < 20; bi++) {
    var bLine = figma.createRectangle();
    bLine.resize(Math.random() > 0.5 ? 3 : 2, 24);
    bLine.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.15 } }];
    bLine.x = bi * 5; bLine.y = 0; lrBarcode.appendChild(bLine);
  }
  lrBarcode.x = LABEL_RW - 116; lrBarcode.y = LABEL_RH - 42;
  labelRect.appendChild(lrBarcode);

  place(labelRect, PAD + LABEL_R * 2 + 40, cursorY);
  mockLabel("Etiqueta rectangular", PAD + LABEL_R * 2 + 40, cursorY + LABEL_RH + 8);

  cursorY += Math.max(LABEL_R * 2, LABEL_RH) + 50;

  // ═══════════════════════════════════════════════════════════
  // 27. CAJA / EMBALAJE — Dieline
  // ═══════════════════════════════════════════════════════════

  var BOX_W = 520;
  var BOX_H = 380;

  var box = figma.createFrame();
  box.name = "Caja / Embalaje — Desarrollo plano (dieline)";
  box.resize(BOX_W, BOX_H);
  box.cornerRadius = 4;
  box.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  box.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Dieline: centro + 4 solapas
  var cutColor = { r: 0.2, g: 0.2, b: 0.25 };   // Corte: línea sólida
  var foldColor = accent;                          // Pliegue: línea punteada

  // Panel frontal (centro)
  var boxFront = figma.createFrame();
  boxFront.name = "Panel Frontal";
  boxFront.resize(200, 260); boxFront.x = 160; boxFront.y = 60;
  boxFront.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
  boxFront.strokes = [{ type: "SOLID", color: cutColor }]; boxFront.strokeWeight = 2;

  var bfLogo = addLogoTo(boxFront, 80, 30);
  bfLogo.x = Math.round((200 - bfLogo.width) / 2); bfLogo.y = 50;

  var bfName = txt("PRODUCTO", 16, fonts.bold, { r: 0.1, g: 0.1, b: 0.12 });
  bfName.textAlignHorizontal = "CENTER"; bfName.resize(200, 20);
  bfName.x = 0; bfName.y = 100; boxFront.appendChild(bfName);

  var bfSub = txt("Premium Edition", 11, fonts.reg, accent);
  bfSub.textAlignHorizontal = "CENTER"; bfSub.resize(200, 16);
  bfSub.x = 0; bfSub.y = 125; boxFront.appendChild(bfSub);

  fakeLines(boxFront, 20, 160, 3, 160);

  box.appendChild(boxFront);

  // Panel derecho
  var boxRight = figma.createFrame();
  boxRight.name = "Panel Lateral";
  boxRight.resize(80, 260); boxRight.x = 360; boxRight.y = 60;
  boxRight.fills = [];
  boxRight.strokes = [{ type: "SOLID", color: cutColor }]; boxRight.strokeWeight = 2;
  dashedLine(boxRight, 1, 0, 0, foldColor); // borde izquierdo = pliegue
  box.appendChild(boxRight);

  // Panel izquierdo
  var boxLeft = figma.createFrame();
  boxLeft.name = "Panel Lateral";
  boxLeft.resize(80, 260); boxLeft.x = 80; boxLeft.y = 60;
  boxLeft.fills = [];
  boxLeft.strokes = [{ type: "SOLID", color: cutColor }]; boxLeft.strokeWeight = 2;
  box.appendChild(boxLeft);

  // Solapa superior
  var boxTopFlap = figma.createFrame();
  boxTopFlap.name = "Solapa Superior";
  boxTopFlap.resize(200, 50); boxTopFlap.x = 160; boxTopFlap.y = 10;
  boxTopFlap.fills = [];
  boxTopFlap.strokes = [{ type: "SOLID", color: cutColor }]; boxTopFlap.strokeWeight = 1.5;
  boxTopFlap.dashPattern = [6, 3];
  box.appendChild(boxTopFlap);

  // Solapa inferior
  var boxBottomFlap = figma.createFrame();
  boxBottomFlap.name = "Solapa Inferior";
  boxBottomFlap.resize(200, 50); boxBottomFlap.x = 160; boxBottomFlap.y = 320;
  boxBottomFlap.fills = [];
  boxBottomFlap.strokes = [{ type: "SOLID", color: cutColor }]; boxBottomFlap.strokeWeight = 1.5;
  boxBottomFlap.dashPattern = [6, 3];
  box.appendChild(boxBottomFlap);

  // Solapa lateral sup-der
  var boxTopR = figma.createFrame();
  boxTopR.name = "Solapa"; boxTopR.resize(80, 40); boxTopR.x = 360; boxTopR.y = 20;
  boxTopR.fills = []; boxTopR.strokes = [{ type: "SOLID", color: cutColor }]; boxTopR.strokeWeight = 1;
  boxTopR.dashPattern = [4, 3];
  box.appendChild(boxTopR);

  // Solapa lateral sup-izq
  var boxTopL = figma.createFrame();
  boxTopL.name = "Solapa"; boxTopL.resize(80, 40); boxTopL.x = 80; boxTopL.y = 20;
  boxTopL.fills = []; boxTopL.strokes = [{ type: "SOLID", color: cutColor }]; boxTopL.strokeWeight = 1;
  boxTopL.dashPattern = [4, 3];
  box.appendChild(boxTopL);

  // Leyenda
  var boxLegend = figma.createFrame();
  boxLegend.layoutMode = "HORIZONTAL"; boxLegend.itemSpacing = 16;
  boxLegend.primaryAxisSizingMode = "AUTO"; boxLegend.counterAxisSizingMode = "AUTO";
  boxLegend.fills = []; boxLegend.x = 20; boxLegend.y = BOX_H - 30;

  var cutSample = figma.createRectangle(); cutSample.resize(20, 2);
  cutSample.fills = [{ type: "SOLID", color: cutColor }];
  boxLegend.appendChild(cutSample);
  boxLegend.appendChild(txt("Corte", 9, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 }));

  var foldSample = figma.createRectangle(); foldSample.resize(20, 2);
  foldSample.fills = [{ type: "SOLID", color: foldColor }]; foldSample.dashPattern = [4, 3];
  boxLegend.appendChild(foldSample);
  boxLegend.appendChild(txt("Pliegue", 9, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 }));

  box.appendChild(boxLegend);

  place(box, PAD, cursorY);
  mockLabel("Desarrollo plano / Dieline de caja", PAD, cursorY + BOX_H + 8);

  cursorY += BOX_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 28. STICKER / SELLO
  // ═══════════════════════════════════════════════════════════

  var STK_R = 100;

  var sticker = figma.createFrame();
  sticker.name = "Sticker / Sello — Adhesivo redondo";
  sticker.resize(STK_R * 2, STK_R * 2);
  sticker.cornerRadius = STK_R;
  sticker.fills = [{ type: "SOLID", color: accent }];
  sticker.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.15 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Borde interior
  var stkInner = figma.createEllipse();
  stkInner.resize(STK_R * 2 - 16, STK_R * 2 - 16);
  stkInner.fills = []; stkInner.strokes = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  stkInner.strokeWeight = 1.5; stkInner.x = 8; stkInner.y = 8;
  sticker.appendChild(stkInner);

  // Logo centrado
  var stkLogo = addLogoTo(sticker, 80, 40);
  stkLogo.x = Math.round((STK_R * 2 - stkLogo.width) / 2);
  stkLogo.y = Math.round((STK_R * 2 - stkLogo.height) / 2) - 10;

  // Texto curvado simulado (arco superior)
  var stkTextTop = txt("TU EMPRESA S.A.", 9, fonts.bold, { r: 1, g: 1, b: 1 });
  stkTextTop.textAlignHorizontal = "CENTER"; stkTextTop.resize(STK_R * 2, 12);
  stkTextTop.x = 0; stkTextTop.y = STK_R + 30; sticker.appendChild(stkTextTop);

  var stkTextBottom = txt("★ CALIDAD PREMIUM ★", 8, fonts.reg, { r: 0.85, g: 0.85, b: 0.9 });
  stkTextBottom.textAlignHorizontal = "CENTER"; stkTextBottom.resize(STK_R * 2, 12);
  stkTextBottom.x = 0; stkTextBottom.y = STK_R + 46; sticker.appendChild(stkTextBottom);

  place(sticker, PAD, cursorY);
  mockLabel("Adhesivo redondo con logo", PAD, cursorY + STK_R * 2 + 8);

  cursorY += STK_R * 2 + 60;

  // ── Ajustar altura final ─────────────────────────────
  mock.resize(PAGE_W, cursorY + 60);

  return createdFrames;
}

// ═══════════════════════════════════════════════════════════════════════
// MOCKUPS 3 — Material de Oficina (Items 10-17)
// ═══════════════════════════════════════════════════════════════════════

function createMockups3(page, startX, startY, fonts, accent, logoFrame) {
  var createdFrames = [];
  var DS_W = PAGE_W - PAD * 2;

  var mock = figma.createFrame();
  mock.name = "Mockups — Material de Oficina";
  mock.resize(PAGE_W, 10000);
  mock.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
  mock.layoutMode = "NONE";
  mock.clipsContent = false;
  mock.x = startX;
  mock.y = startY;
  page.appendChild(mock);
  createdFrames.push(mock);

  var cursorY = 60;

  function txt(content, size, font, color) {
    var t = figma.createText();
    t.characters = content;
    t.fontSize = size;
    t.fontName = font;
    t.fills = [{ type: "SOLID", color: color }];
    return t;
  }

  function place(item, x, y) { item.x = x; item.y = y; mock.appendChild(item); }

  function sectionHeader(title, count) {
    var lbl = txt(title.toUpperCase(), 11, fonts.bold, accent);
    lbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
    lbl.x = PAD; lbl.y = cursorY; lbl.resize(DS_W, 14); lbl.textAutoResize = "HEIGHT";
    mock.appendChild(lbl);
    var cnt = txt(count + " items", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
    cnt.x = PAD + 280; cnt.y = cursorY; mock.appendChild(cnt);
    cursorY += 20;
    var sep = figma.createRectangle();
    sep.resize(DS_W, 1); sep.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    sep.x = PAD; sep.y = cursorY; mock.appendChild(sep);
    cursorY += 24;
  }

  function mockLabel(text, x, y) {
    var lbl = txt(text, 11, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
    lbl.x = x; lbl.y = y; mock.appendChild(lbl);
  }

  function addLogoTo(parentFrame, maxW, maxH) {
    var logo = logoFrame.clone(); logo.name = "Logo";
    if (logo.width > maxW || logo.height > maxH) {
      var s = Math.min(maxW / logo.width, maxH / logo.height);
      logo.resize(Math.round(logo.width * s), Math.round(logo.height * s));
    }
    parentFrame.appendChild(logo);
    return logo;
  }

  // ── HEADER ────────────────────────────────────────────
  var mainLabel = txt("MOCKUPS", 11, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  mainLabel.letterSpacing = { value: 2, unit: "PIXELS" };
  mainLabel.x = PAD; mainLabel.y = cursorY; mock.appendChild(mainLabel);
  cursorY += 20;

  var mainTitle = txt("Material de Oficina", 36, fonts.bold, { r: 0.08, g: 0.08, b: 0.1 });
  mainTitle.x = PAD; mainTitle.y = cursorY; mainTitle.resize(DS_W, 44); mock.appendChild(mainTitle);
  cursorY += 52;

  var mainDesc = txt("Artículos de oficina personalizados con la identidad de marca. Mockups vectoriales con datos demo.", 15, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  mainDesc.x = PAD; mainDesc.y = cursorY; mainDesc.resize(DS_W, 22); mainDesc.textAutoResize = "HEIGHT";
  mainDesc.lineHeight = { value: 160, unit: "PERCENT" }; mock.appendChild(mainDesc);
  cursorY += 56;

  // ═══════════════════════════════════════════════════════════
  // 10. LAPICERO / BOLÍGRAFO
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Lapicero / Bolígrafo", 1);

  var PEN_W = 500;
  var PEN_H = 120;

  var pen = figma.createFrame();
  pen.name = "Bolígrafo — Vista lateral";
  pen.resize(PEN_W, PEN_H);
  pen.cornerRadius = 8;
  pen.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  pen.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Cuerpo del bolígrafo (rectángulo redondeado horizontal)
  var penBody = figma.createFrame();
  penBody.name = "Cuerpo";
  penBody.resize(420, 28); penBody.cornerRadius = 14;
  penBody.fills = [{ type: "SOLID", color: accent }];
  penBody.x = 40; penBody.y = 46;
  pen.appendChild(penBody);

  // Punta
  var penTip = figma.createFrame();
  penTip.resize(40, 12); penTip.x = 0; penTip.y = 8;
  penTip.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.65 } }];
  penTip.cornerRadius = 4;
  penBody.appendChild(penTip);

  // Clip (rectángulo fino arriba)
  var penClip = figma.createFrame();
  penClip.resize(60, 8); penClip.cornerRadius = 2;
  penClip.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.75 } }];
  penClip.x = 360; penClip.y = -6;
  penBody.appendChild(penClip);

  // Logo grabado en el cuerpo
  var penLogo = addLogoTo(penBody, 80, 20);
  penLogo.x = 160; penLogo.y = 4;

  // Clicker (parte superior)
  var penClicker = figma.createFrame();
  penClicker.resize(20, 20); penClicker.cornerRadius = 10;
  penClicker.fills = [{ type: "SOLID", color: { r: 0.75, g: 0.75, b: 0.8 } }];
  penClicker.x = 440; penClicker.y = 50;
  pen.appendChild(penClicker);

  // Label
  var penLbl = txt("Grabado con láser · Vista lateral", 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  penLbl.x = 40; penLbl.y = 92; pen.appendChild(penLbl);

  place(pen, PAD, cursorY);
  mockLabel("Vista lateral + clip, con logo grabado", PAD, cursorY + PEN_H + 8);

  cursorY += PEN_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 11. LÁPIZ
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Lápiz", 1);

  var PENCIL_W = 480;
  var PENCIL_H = 110;

  var pencil = figma.createFrame();
  pencil.name = "Lápiz — Vista lateral";
  pencil.resize(PENCIL_W, PENCIL_H);
  pencil.cornerRadius = 8;
  pencil.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  pencil.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Cuerpo hexagonal simulado con rectángulo
  var pBody = figma.createFrame();
  pBody.name = "Cuerpo";
  pBody.resize(360, 22); pBody.cornerRadius = 2;
  pBody.fills = [{ type: "SOLID", color: accent }];
  pBody.x = 60; pBody.y = 44;
  pencil.appendChild(pBody);

  // Punta de lápiz (triángulo simulado)
  var pTip = figma.createFrame();
  pTip.resize(40, 22); pTip.x = 20; pTip.y = 44;
  pTip.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.75, b: 0.55 } }]; // madera
  pencil.appendChild(pTip);

  var pLead = figma.createRectangle();
  pLead.resize(12, 6); pLead.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
  pLead.x = 12; pLead.y = 52;
  pencil.appendChild(pLead);

  // Borrador
  var pEraser = figma.createFrame();
  pEraser.resize(20, 18); pEraser.cornerRadius = 2;
  pEraser.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.75, b: 0.75 } }]; // rosa
  pEraser.x = 420; pEraser.y = 46;
  pencil.appendChild(pEraser);

  var pBand = figma.createRectangle();
  pBand.resize(8, 22); pBand.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.75 } }];
  pBand.x = 416; pBand.y = 44;
  pencil.appendChild(pBand);

  // Grabado
  var pEngrave = txt("TU EMPRESA", 8, fonts.bold, { r: 1, g: 1, b: 1 });
  pEngrave.x = 200; pEngrave.y = 51; pencil.appendChild(pEngrave);

  place(pencil, PAD, cursorY);
  mockLabel("Vista lateral con grabado", PAD, cursorY + PENCIL_H + 8);

  cursorY += PENCIL_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 12. CUADERNO / NOTEBOOK
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Cuaderno / Notebook", 3);

  var NB_W = 240;
  var NB_H = 320;

  // ── Portada ────────────────────────────────────────
  var nbFront = figma.createFrame();
  nbFront.name = "Notebook — Portada";
  nbFront.resize(NB_W, NB_H);
  nbFront.cornerRadius = 4;
  nbFront.fills = [{ type: "SOLID", color: accent }];
  nbFront.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Espiral (círculos a la izquierda)
  for (var spi = 0; spi < 10; spi++) {
    var spiral = figma.createEllipse();
    spiral.resize(12, 12); spiral.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.75 } }];
    spiral.x = 8; spiral.y = 30 + spi * 28;
    nbFront.appendChild(spiral);
  }

  var nbLogo = addLogoTo(nbFront, 100, 40);
  nbLogo.x = Math.round((NB_W - nbLogo.width) / 2); nbLogo.y = 80;

  var nbTitle = txt("NOTEBOOK", 20, fonts.bold, { r: 1, g: 1, b: 1 });
  nbTitle.textAlignHorizontal = "CENTER"; nbTitle.resize(NB_W, 26);
  nbTitle.x = 0; nbTitle.y = 140; nbFront.appendChild(nbTitle);

  var nbYear = txt("2026", 12, fonts.reg, { r: 0.85, g: 0.85, b: 0.9 });
  nbYear.textAlignHorizontal = "CENTER"; nbYear.resize(NB_W, 16);
  nbYear.x = 0; nbYear.y = 170; nbFront.appendChild(nbYear);

  place(nbFront, PAD, cursorY);
  mockLabel("Portada", PAD, cursorY + NB_H + 8);

  // ── Contraportada ──────────────────────────────────
  var nbBack = figma.createFrame();
  nbBack.name = "Notebook — Contraportada";
  nbBack.resize(NB_W, NB_H);
  nbBack.cornerRadius = 4;
  nbBack.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.12 } }];
  nbBack.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  var nbBackLogo = addLogoTo(nbBack, 80, 30);
  nbBackLogo.x = Math.round((NB_W - nbBackLogo.width) / 2); nbBackLogo.y = Math.round((NB_H - nbBackLogo.height) / 2);

  var nbBackWeb = txt("tuempresa.com", 10, fonts.reg, { r: 0.4, g: 0.4, b: 0.45 });
  nbBackWeb.textAlignHorizontal = "CENTER"; nbBackWeb.resize(NB_W, 14);
  nbBackWeb.x = 0; nbBackWeb.y = NB_H - 40; nbBack.appendChild(nbBackWeb);

  place(nbBack, PAD + NB_W + 20, cursorY);
  mockLabel("Contraportada", PAD + NB_W + 20, cursorY + NB_H + 8);

  // ── Página interior ────────────────────────────────
  var nbInner = figma.createFrame();
  nbInner.name = "Notebook — Página interior";
  nbInner.resize(NB_W, NB_H);
  nbInner.cornerRadius = 4;
  nbInner.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  nbInner.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header con logo small
  var niLogo = addLogoTo(nbInner, 50, 16);
  niLogo.x = NB_W - niLogo.width - 16; niLogo.y = 12;

  // Líneas de escritura
  for (var nli = 0; nli < 14; nli++) {
    var nLine = figma.createRectangle();
    nLine.resize(NB_W - 50, 1);
    nLine.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    nLine.x = 30; nLine.y = 48 + nli * 20;
    nbInner.appendChild(nLine);
  }

  // Margen rojo
  var margin = figma.createRectangle();
  margin.resize(1, NB_H - 40); margin.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.4, b: 0.4 } }];
  margin.x = 28; margin.y = 20;
  nbInner.appendChild(margin);

  place(nbInner, PAD + (NB_W + 20) * 2, cursorY);
  mockLabel("Página interior", PAD + (NB_W + 20) * 2, cursorY + NB_H + 8);

  cursorY += NB_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 13. AGENDA
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Agenda", 2);

  var AG_W = 300;
  var AG_H = 400;

  // ── Portada ────────────────────────────────────────
  var agenda = figma.createFrame();
  agenda.name = "Agenda — Portada";
  agenda.resize(AG_W, AG_H);
  agenda.cornerRadius = 6;
  agenda.fills = [{ type: "SOLID", color: { r: 0.12, g: 0.12, b: 0.16 } }];
  agenda.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Franja acento
  var agBar = figma.createRectangle();
  agBar.resize(AG_W, 6); agBar.fills = [{ type: "SOLID", color: accent }];
  agBar.topLeftRadius = 6; agBar.topRightRadius = 6;
  agenda.appendChild(agBar);

  var agLogo = addLogoTo(agenda, 100, 40);
  agLogo.x = Math.round((AG_W - agLogo.width) / 2); agLogo.y = 50;

  var agTitle = txt("AGENDA", 32, fonts.bold, { r: 1, g: 1, b: 1 });
  agTitle.textAlignHorizontal = "CENTER"; agTitle.resize(AG_W, 40);
  agTitle.x = 0; agTitle.y = 120; agenda.appendChild(agTitle);

  var agYear = txt("2026", 16, fonts.reg, { r: 0.6, g: 0.6, b: 0.65 });
  agYear.textAlignHorizontal = "CENTER"; agYear.resize(AG_W, 22);
  agYear.x = 0; agYear.y = 165; agenda.appendChild(agYear);

  // Franja inferior
  var agBarBot = figma.createRectangle();
  agBarBot.resize(AG_W, 4); agBarBot.fills = [{ type: "SOLID", color: accent }];
  agBarBot.bottomLeftRadius = 6; agBarBot.bottomRightRadius = 6;
  agBarBot.y = AG_H - 4; agenda.appendChild(agBarBot);

  place(agenda, PAD, cursorY);
  mockLabel("Portada", PAD, cursorY + AG_H + 8);

  // ── Página semanal ─────────────────────────────────
  var agWeek = figma.createFrame();
  agWeek.name = "Agenda — Página semanal";
  agWeek.resize(AG_W * 2 + 20, AG_H);
  agWeek.cornerRadius = 4;
  agWeek.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  agWeek.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Header
  var awHeader = figma.createFrame();
  awHeader.resize(AG_W * 2 + 20, 50); awHeader.fills = [{ type: "SOLID", color: accent }];
  awHeader.topLeftRadius = 4; awHeader.topRightRadius = 4;
  agWeek.appendChild(awHeader);

  var awTitle = txt("SEMANA 16 — 13 al 19 de Abril", 13, fonts.bold, { r: 1, g: 1, b: 1 });
  awTitle.x = 16; awTitle.y = 16; agWeek.appendChild(awTitle);

  var awLogo = addLogoTo(agWeek, 60, 20);
  awLogo.x = AG_W * 2 + 20 - awLogo.width - 16; awLogo.y = 15;

  // Dos columnas: Lun-Jue | Vie-Dom
  var dayNames = [["LUNES 13", "MARTES 14", "MIÉRCOLES 15", "JUEVES 16"],
                  ["VIERNES 17", "SÁBADO 18", "DOMINGO 19"]];
  var colW = Math.floor((AG_W * 2 + 20 - 48) / 2);

  for (var acol = 0; acol < 2; acol++) {
    for (var aday = 0; aday < dayNames[acol].length; aday++) {
      var cellY = 64 + aday * 82;
      var cellX = 16 + acol * (colW + 16);

      // Header día
      var dayH = figma.createFrame();
      dayH.resize(colW, 24); dayH.x = cellX; dayH.y = cellY;
      dayH.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
      dayH.cornerRadius = 4;

      var dayT = txt(dayNames[acol][aday], 10, fonts.bold, { r: 0.3, g: 0.3, b: 0.35 });
      dayT.x = cellX + 8; dayT.y = cellY + 5;
      agWeek.appendChild(dayT);
      agWeek.appendChild(dayH);

      // Líneas de notas
      for (var anl = 0; anl < 2; anl++) {
        var anLine = figma.createRectangle();
        anLine.resize(colW - 16, 1);
        anLine.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
        anLine.x = cellX + 8; anLine.y = cellY + 32 + anl * 18;
        agWeek.appendChild(anLine);
      }
    }
  }

  place(agWeek, PAD + AG_W + 20, cursorY);
  mockLabel("Página semanal sample", PAD + AG_W + 20, cursorY + AG_H + 8);

  cursorY += AG_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 14. CLIP / PAPELERA — Elementos metálicos
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Clip / Papelera", 2);

  var CLIP_Y = cursorY;

  // ── Clip personalizado ─────────────────────────────
  var clipFrame = figma.createFrame();
  clipFrame.name = "Clip personalizado";
  clipFrame.resize(200, 260);
  clipFrame.cornerRadius = 8;
  clipFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  clipFrame.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Forma de clip (rectángulo con esquina doblada)
  var clipOuter = figma.createFrame();
  clipOuter.name = "Clip";
  clipOuter.resize(60, 160); clipOuter.cornerRadius = 30;
  clipOuter.fills = [{ type: "SOLID", color: { r: 0.75, g: 0.75, b: 0.8 } }]; // metal plateado
  clipOuter.x = 70; clipOuter.y = 20;
  clipFrame.appendChild(clipOuter);

  // Interior del clip
  var clipInner = figma.createFrame();
  clipInner.resize(36, 130); clipInner.cornerRadius = 18;
  clipInner.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  clipInner.x = 12; clipInner.y = 15;
  clipOuter.appendChild(clipInner);

  // Logo grabado
  var clipLogo = addLogoTo(clipOuter, 30, 12);
  clipLogo.x = Math.round((60 - clipLogo.width) / 2); clipLogo.y = 55;

  // Label
  var clipLbl = txt("Clip metálico con logo grabado\nPack de 12 unidades", 10, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  clipLbl.textAlignHorizontal = "CENTER"; clipLbl.resize(180, 30);
  clipLbl.x = 10; clipLbl.y = 200; clipFrame.appendChild(clipLbl);

  place(clipFrame, PAD, CLIP_Y);
  mockLabel("Clip metálico", PAD, CLIP_Y + 268);

  // ── Papelera ───────────────────────────────────────
  var binFrame = figma.createFrame();
  binFrame.name = "Papelera de escritorio";
  binFrame.resize(200, 260);
  binFrame.cornerRadius = 8;
  binFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  binFrame.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Cuerpo de la papelera (cilindro simulado)
  var binBody = figma.createFrame();
  binBody.name = "Papelera";
  binBody.resize(80, 140); binBody.cornerRadius = 8;
  binBody.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
  binBody.x = 60; binBody.y = 30;
  binFrame.appendChild(binBody);

  // Borde superior
  var binRim = figma.createFrame();
  binRim.resize(90, 12); binRim.cornerRadius = 4;
  binRim.fills = [{ type: "SOLID", color: { r: 0.78, g: 0.78, b: 0.82 } }];
  binRim.x = 55; binRim.y = 24;
  binFrame.appendChild(binRim);

  // Logo en el cuerpo
  var binLogo = addLogoTo(binBody, 50, 20);
  binLogo.x = Math.round((80 - binLogo.width) / 2); binLogo.y = 50;

  // Label
  var binLbl = txt("Papelera de escritorio\nPersonalizada con logo", 10, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
  binLbl.textAlignHorizontal = "CENTER"; binLbl.resize(180, 30);
  binLbl.x = 10; binLbl.y = 200; binFrame.appendChild(binLbl);

  place(binFrame, PAD + 220, CLIP_Y);
  mockLabel("Papelera de escritorio", PAD + 220, CLIP_Y + 268);

  cursorY = CLIP_Y + 310;

  // ═══════════════════════════════════════════════════════════
  // 15. USB PERSONALIZADO
  // ═══════════════════════════════════════════════════════════

  sectionHeader("USB Personalizado", 1);

  var USB_W = 400;
  var USB_H = 140;

  var usb = figma.createFrame();
  usb.name = "USB Personalizado";
  usb.resize(USB_W, USB_H);
  usb.cornerRadius = 8;
  usb.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  usb.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Cuerpo USB
  var usbBody = figma.createFrame();
  usbBody.name = "USB";
  usbBody.resize(180, 56); usbBody.cornerRadius = 6;
  usbBody.fills = [{ type: "SOLID", color: accent }];
  usbBody.x = 110; usbBody.y = 42;
  usb.appendChild(usbBody);

  // Cap (tapa)
  var usbCap = figma.createFrame();
  usbCap.resize(60, 52); usbCap.cornerRadius = 6;
  usbCap.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
  usbCap.x = 290; usbCap.y = 44;
  usb.appendChild(usbCap);

  // Connector USB
  var usbConn = figma.createFrame();
  usbConn.resize(30, 24); usbConn.cornerRadius = 2;
  usbConn.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.75 } }];
  usbConn.x = 80; usbConn.y = 58;
  usb.appendChild(usbConn);

  // Logo
  var usbLogo = addLogoTo(usbBody, 80, 24);
  usbLogo.x = Math.round((180 - usbLogo.width) / 2); usbLogo.y = 16;

  // Capacidad
  var usbCap2 = txt("32GB", 10, fonts.bold, { r: 0.6, g: 0.6, b: 0.65 });
  usbCap2.x = 300; usbCap2.y = 64; usb.appendChild(usbCap2);

  var usbLbl = txt("Vista frontal · Logo grabado · Capacidad: 32GB", 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  usbLbl.x = 110; usbLbl.y = 112; usb.appendChild(usbLbl);

  place(usb, PAD, cursorY);
  mockLabel("Vista frontal con logo", PAD, cursorY + USB_H + 8);

  cursorY += USB_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 16. TAZA / MUG
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Taza / Mug", 1);

  var MUG_W = 340;
  var MUG_H = 300;

  var mug = figma.createFrame();
  mug.name = "Taza / Mug — Vista frontal";
  mug.resize(MUG_W, MUG_H);
  mug.cornerRadius = 8;
  mug.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  mug.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Cuerpo de la taza
  var mugBody = figma.createFrame();
  mugBody.name = "Taza";
  mugBody.resize(160, 180); mugBody.cornerRadius = 12;
  mugBody.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  mugBody.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.85 } }];
  mugBody.strokeWeight = 2;
  mugBody.x = 60; mugBody.y = 50;
  mug.appendChild(mugBody);

  // Asa de la taza
  var mugHandle = figma.createFrame();
  mugHandle.resize(40, 80); mugHandle.cornerRadius = 20;
  mugHandle.fills = [];
  mugHandle.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.85 } }];
  mugHandle.strokeWeight = 3;
  mugHandle.x = 218; mugHandle.y = 95;
  mug.appendChild(mugHandle);

  // Logo wrap-around
  var mugLogo = addLogoTo(mugBody, 100, 40);
  mugLogo.x = Math.round((160 - mugLogo.width) / 2); mugLogo.y = 50;

  var mugText = txt("TU EMPRESA", 12, fonts.bold, accent);
  mugText.textAlignHorizontal = "CENTER"; mugText.resize(160, 16);
  mugText.x = 0; mugText.y = 110; mugBody.appendChild(mugText);

  var mugSub = txt("Premium Coffee", 9, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  mugSub.textAlignHorizontal = "CENTER"; mugSub.resize(160, 12);
  mugSub.x = 0; mugSub.y = 130; mugBody.appendChild(mugSub);

  // Interior (borde superior)
  var mugInner = figma.createEllipse();
  mugInner.resize(140, 30); mugInner.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.95 } }];
  mugInner.x = 70; mugInner.y = 46;
  mug.appendChild(mugInner);

  // Sombra en base
  var mugShadow = figma.createEllipse();
  mugShadow.resize(170, 20); mugShadow.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
  mugShadow.x = 55; mugShadow.y = 234;
  mug.appendChild(mugShadow);

  var mugLbl = txt("Wrap-around · Vista frontal", 10, fonts.reg, { r: 0.55, g: 0.55, b: 0.6 });
  mugLbl.x = 60; mugLbl.y = 270; mug.appendChild(mugLbl);

  place(mug, PAD, cursorY);
  mockLabel("Vista frontal con wrap-around", PAD, cursorY + MUG_H + 8);

  cursorY += MUG_H + 50;

  // ═══════════════════════════════════════════════════════════
  // 17. BOTELLA TERMO
  // ═══════════════════════════════════════════════════════════

  sectionHeader("Botella Termo", 1);

  var THM_W = 200;
  var THM_H = 420;

  var thermo = figma.createFrame();
  thermo.name = "Botella Termo — Vista frontal";
  thermo.resize(THM_W, THM_H);
  thermo.cornerRadius = 8;
  thermo.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  thermo.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true, blendMode: "NORMAL" }];

  // Tapa
  var thCap = figma.createFrame();
  thCap.resize(60, 30); thCap.cornerRadius = 6;
  thCap.fills = [{ type: "SOLID", color: { r: 0.25, g: 0.25, b: 0.3 } }];
  thCap.x = Math.round((THM_W - 60) / 2); thCap.y = 10;
  thermo.appendChild(thCap);

  // Cuello
  var thNeck = figma.createFrame();
  thNeck.resize(40, 30); thNeck.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
  thNeck.x = Math.round((THM_W - 40) / 2); thNeck.y = 38;
  thermo.appendChild(thNeck);

  // Cuerpo principal
  var thBody = figma.createFrame();
  thBody.name = "Cuerpo";
  thBody.resize(120, 300); thBody.cornerRadius = 20;
  thBody.fills = [{ type: "SOLID", color: accent }];
  thBody.x = Math.round((THM_W - 120) / 2); thBody.y = 65;
  thermo.appendChild(thBody);

  // Logo
  var thLogo = addLogoTo(thBody, 70, 30);
  thLogo.x = Math.round((120 - thLogo.width) / 2); thLogo.y = 80;

  var thText = txt("TU\nEMPRESA", 14, fonts.bold, { r: 1, g: 1, b: 1 });
  thText.textAlignHorizontal = "CENTER"; thText.resize(120, 44);
  thText.lineHeight = { value: 120, unit: "PERCENT" };
  thText.x = 0; thText.y = 130; thBody.appendChild(thText);

  var thCapLabel = txt("500ml · Acero inoxidable", 9, fonts.reg, { r: 0.85, g: 0.85, b: 0.9 });
  thCapLabel.textAlignHorizontal = "CENTER"; thCapLabel.resize(120, 14);
  thCapLabel.x = 0; thCapLabel.y = 200; thBody.appendChild(thCapLabel);

  // Base
  var thBase = figma.createFrame();
  thBase.resize(120, 8); thBase.cornerRadius = 4;
  thBase.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
  thBase.x = Math.round((THM_W - 120) / 2); thBase.y = 365;
  thermo.appendChild(thBase);

  // Sombra
  var thShadow = figma.createEllipse();
  thShadow.resize(130, 16); thShadow.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
  thShadow.x = Math.round((THM_W - 130) / 2); thShadow.y = 380;
  thermo.appendChild(thShadow);

  place(thermo, PAD, cursorY);
  mockLabel("Vista frontal · 500ml acero inoxidable", PAD, cursorY + THM_H + 8);

  cursorY += THM_H + 60;

  // ── Ajustar altura final ─────────────────────────────
  mock.resize(PAGE_W, cursorY + 60);

  return createdFrames;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  try {
    var page = figma.currentPage;
    var sel = page.selection;

    if (sel.length === 0) {
      figma.ui.postMessage({ type: "error", message: "Selecciona un frame primero." });
      return;
    }

    var frame = sel[0];
    if (!("children" in frame)) {
      figma.ui.postMessage({ type: "error", message: "Selecciona un frame, no una capa individual." });
      return;
    }

    // Informar a la UI que el proceso comenzó
    figma.ui.postMessage({ type: "status", message: "Extrayendo datos del diseño..." });

    var colors = extractColors(frame);
    var fontsDetected = extractTypography(frame);
    var accent = colors.length > 0
      ? { r: colors[0].r, g: colors[0].g, b: colors[0].b }
      : { r: 0.2, g: 0.2, b: 0.85 };

    var fonts = await loadFonts();

    // ═══════════════════════════════════════════════════════════════════
// FIX 2 + TIMEOUT: loadFontAsync puede colgar indefinidamente con fuentes
// locales. Promise.race lo cancela si no responde en 3 segundos.
function loadFontSafe(font) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error("timeout")); }, 3000);
  });
  return Promise.race([figma.loadFontAsync(font), timeout]);
}

var loadableFonts = fontsDetected.slice(0, 5);
var fontsOk = [];
for (var fi = 0; fi < loadableFonts.length; fi++) {
  try {
    await loadFontSafe({ family: loadableFonts[fi].family, style: loadableFonts[fi].style });
    fontsOk.push(loadableFonts[fi]);
  } catch (e) {
    // Font local no disponible o timeout → se omite el specimen
    console.warn("Fuente omitida: " + loadableFonts[fi].family + " " + loadableFonts[fi].style);
  }
}

    figma.ui.postMessage({ type: "status", message: "Creando manual de marca..." });

    // ═══════════════════════════════════════════════════════════════
    // POSICIONES FIJAS — cada sección en su columna X, todo desde Y:0
    // ═══════════════════════════════════════════════════════════════
    var X_GUIDE    = 78;     // Brand Guidelines (manual de marca)
    var X_DS       = 4200;   // Design System
    var X_MOCK1    = 6261;   // Mockups — Papelería Corporativa
    var X_MOCK2    = 8322;   // Mockups — Señalética, Digital y Packaging
    var X_MOCK3    = 10383;   // Mockups — Material de Oficina
    var X_SOCIAL   = 2139;   // Redes sociales

    var slideW = PAGE_W;  // 1920
    var slideH = PAGE_H;  // 1080
    var safeTop = 80;
    var safeBottom = 80;
    var safeContentH = slideH - safeTop - safeBottom; // 920px usable height

    var createdFrames = [];

    // Helper: crear un slide de 1920×1080
    function makeSlide(name, x, y) {
      var s = figma.createFrame();
      s.name = name;
      s.resize(slideW, slideH);
      s.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      s.layoutMode = "VERTICAL";
      s.primaryAxisAlignItems = "MIN";
      s.counterAxisAlignItems = "MIN";
      s.paddingLeft = PAD;
      s.paddingRight = PAD;
      s.paddingTop = safeTop;
      s.paddingBottom = safeBottom;
      s.primaryAxisSizingMode = "FIXED";
      s.counterAxisSizingMode = "FIXED";
      s.itemSpacing = 20;
      s.clipsContent = true;
      s.x = x;
      s.y = y;
      page.appendChild(s);
      createdFrames.push(s);
      return s;
    }

    // Helper: crear slide oscuro (portada, etc.)
    function makeDarkSlide(name, x, y) {
      var s = figma.createFrame();
      s.name = name;
      s.resize(slideW, slideH);
      s.fills = [{ type: "SOLID", color: { r: 0.04, g: 0.04, b: 0.06 } }];
      s.layoutMode = "VERTICAL";
      s.primaryAxisAlignItems = "CENTER";
      s.counterAxisAlignItems = "CENTER";
      s.paddingLeft = PAD;
      s.paddingRight = PAD;
      s.paddingTop = safeTop;
      s.paddingBottom = safeBottom;
      s.primaryAxisSizingMode = "FIXED";
      s.counterAxisSizingMode = "FIXED";
      s.itemSpacing = 24;
      s.x = x;
      s.y = y;
      page.appendChild(s);
      createdFrames.push(s);
      return s;
    }

    // Helper: texto rápido
    function txt(content, size, font, color) {
      var t = figma.createText();
      t.characters = content;
      t.fontSize = size;
      t.fontName = font;
      t.fills = [{ type: "SOLID", color: color }];
      t.textAutoResize = "HEIGHT";
      return t;
    }

    // Helper: label de sección pequeña
    function sectionLabel(parent, text) {
      var sl = txt(text.toUpperCase(), 13, fonts.bold, { r: 0.6, g: 0.6, b: 0.65 });
      sl.letterSpacing = { value: 2.5, unit: "PIXELS" };
      parent.appendChild(sl);
    }

    // Helper: título de slide
    function slideTitle(parent, text, color) {
      var t = txt(text, 56, fonts.bold, color || { r: 0.08, g: 0.08, b: 0.1 });
      parent.appendChild(t);
    }

    // Helper: cuerpo de texto
    function slideBody(parent, text) {
      var b = txt(text, 18, fonts.reg, { r: 0.35, g: 0.35, b: 0.38 });
      b.resize(slideW - (PAD * 2), 10);
      b.textAutoResize = "HEIGHT";
      b.lineHeight = { value: 170, unit: "PERCENT" };
      parent.appendChild(b);
    }

    // Helper: número de página en esquina inferior derecha
    function addPageNum(parent, num, total) {
      if (parent.layoutMode !== "NONE") {
        // Calculate correct positions before switching layout
        var positions = [];
        for (var pi = 0; pi < parent.children.length; pi++) {
          var pc = parent.children[pi];
          positions.push({
            x: pc.x,
            y: pc.y
          });
        }
        parent.layoutMode = "NONE";
        // Restore children to correct positions
        for (var pi2 = 0; pi2 < parent.children.length; pi2++) {
          parent.children[pi2].x = positions[pi2].x;
          parent.children[pi2].y = positions[pi2].y;
        }
      }
      var pn = txt(num + " / " + total, 16, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
      pn.x = slideW - PAD - 53;
      pn.y = slideH - safeBottom - 15;
      parent.appendChild(pn);
    }

    // Helper: medir altura total del contenido Auto Layout de un slide
    function getContentHeight(slide) {
      var h = 0;
      for (var ci = 0; ci < slide.children.length; ci++) {
        var ch = slide.children[ci];
        var bottom = ch.y + ch.height;
        if (bottom > h) h = bottom;
      }
      return h;
    }

    // Helper: verificar si cabe más contenido en un slide (dejando margen)
    function fitsInSlide(slide, extraHeight) {
      return getContentHeight(slide) + extraHeight < safeContentH;
    }

    var TOTAL_PAGES = 9; // Brand Guidelines

    // ════════════════════════════════════════════════════════════════
    // 1. PORTADA — Slide oscuro centrado
    // ════════════════════════════════════════════════════════════════

    var cover = makeDarkSlide("Portada", X_GUIDE, 0);

    var coverLogo = frame.clone();
    coverLogo.name = "Logo";
    if (coverLogo.width > 700 || coverLogo.height > 350) {
      var s = Math.min(700 / coverLogo.width, 350 / coverLogo.height);
      coverLogo.resize(Math.round(coverLogo.width * s), Math.round(coverLogo.height * s));
    }
    cover.appendChild(coverLogo);

    var coverTitle = txt("MANUAL\nDE MARCA", 96, fonts.bold, { r: 1, g: 1, b: 1 });
    coverTitle.textAlignHorizontal = "CENTER";
    coverTitle.lineHeight = { value: 95, unit: "PERCENT" };
    cover.appendChild(coverTitle);

    var coverSub = txt(frame.name.toUpperCase(), 20, fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
    coverSub.textAlignHorizontal = "CENTER";
    cover.appendChild(coverSub);

    var coverDiv = figma.createRectangle();
    coverDiv.resize(80, 2);
    coverDiv.fills = [{ type: "SOLID", color: accent }];
    cover.appendChild(coverDiv);

    // Línea intro
    var coverIntro = txt("Este documento establece los principios, normas y estándares\nque definen la identidad visual de la marca.", 18, fonts.reg, { r: 0.45, g: 0.45, b: 0.5 });
    coverIntro.textAlignHorizontal = "CENTER";
    coverIntro.lineHeight = { value: 160, unit: "PERCENT" };
    cover.appendChild(coverIntro);

    var coverDate = txt("\u00a9 " + new Date().getFullYear(), 16, fonts.reg, { r: 0.3, g: 0.3, b: 0.36 });
    coverDate.textAlignHorizontal = "CENTER";
    cover.appendChild(coverDate);

    addPageNum(cover, "01", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 2. ÍNDICE — Slide con tabla de contenidos
    // ════════════════════════════════════════════════════════════════

    var idx = makeSlide("Índice", X_GUIDE, (slideH + SLIDE_GAP) * 1);
    sectionLabel(idx, "Contenido");
    slideTitle(idx, "Índice");

    var sections = [
      { num: "01", title: "Logotipo", desc: "Versión principal, proporciones, tamaño mínimo y anatomía" },
      { num: "02", title: "Variantes", desc: "Versiones aprobadas para cada fondo y contexto de uso" },
      { num: "03", title: "Do's & Don'ts", desc: "Usos correctos e incorrectos de la identidad visual" },
      { num: "04", title: "Tipografía", desc: "Fuentes, jerarquía, escala y reglas de composición" },
      { num: "05", title: "Paleta de colores", desc: "Colores primarios, secundarios y valores exactos" },
      { num: "06", title: "Grilla de construcción", desc: "Área de respeto, tamaño mínimo y co-branding" },
      { num: "07", title: "Redes sociales", desc: "Plantillas listas para cada plataforma y formato" },
      { num: "08", title: "Mockups", desc: "Papelería e identidad aplicada sobre materiales reales" },
      { num: "09", title: "Design System", desc: "35 componentes de interfaz listos para usar" }
    ];

    for (var i = 0; i < sections.length; i++) {
      var row = figma.createFrame();
      row.name = sections[i].title;
      row.layoutMode = "HORIZONTAL";
      row.itemSpacing = 24;
      row.counterAxisAlignItems = "CENTER";
      row.primaryAxisSizingMode = "FIXED";
      row.counterAxisSizingMode = "AUTO";
      row.resize(slideW - PAD * 2, 63);
      row.paddingTop = 22;
      row.paddingBottom = 22;
      row.paddingLeft = 28;
      row.paddingRight = 28;
      row.fills = [];
      row.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
      row.strokeBottomWeight = 1;
      row.strokeTopWeight = 0;
      row.strokeLeftWeight = 0;
      row.strokeRightWeight = 0;
      row.cornerRadius = 10;

      var num = figma.createText();
      num.characters = sections[i].num;
      num.fontSize = 20;
      num.fontName = fonts.bold;
      num.fills = [{ type: "SOLID", color: accent }];
      row.appendChild(num);

      var info = figma.createFrame();
      info.layoutMode = "VERTICAL";
      info.itemSpacing = 6;
      info.layoutGrow = 1;
      info.primaryAxisSizingMode = "AUTO";
      info.counterAxisSizingMode = "AUTO";
      info.fills = [];

      var ti = figma.createText();
      ti.characters = sections[i].title;
      ti.fontSize = 26;
      ti.fontName = fonts.bold;
      ti.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
      ti.textAutoResize = "HEIGHT";
      info.appendChild(ti);

      var di = figma.createText();
      di.characters = sections[i].desc;
      di.fontSize = 15;
      di.fontName = fonts.reg;
      di.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
      di.textAutoResize = "HEIGHT";
      info.appendChild(di);

      row.appendChild(info);
      idx.appendChild(row);
    }

    addPageNum(idx, "02", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 3. LOGOTIPO — Layout 2 columnas: reglas (izq) + visual (der)
    // ════════════════════════════════════════════════════════════════

    var logoPage = makeSlide("Logotipo", X_GUIDE, (slideH + SLIDE_GAP) * 2);
    logoPage.layoutMode = "NONE";

    var lpY = safeTop;
    var lpLeftW = 560;   // columna izquierda: texto + reglas
    var lpRightW = slideW - PAD * 2 - lpLeftW - 60; // columna derecha: visual
    var lpRightX = PAD + lpLeftW + 60;

    // ── Columna izquierda ──────────────────────────────────────

    // Section label
    var lpLabel = figma.createText();
    lpLabel.characters = "IDENTIDAD VISUAL";
    lpLabel.fontSize = 12;
    lpLabel.fontName = fonts.bold;
    lpLabel.fills = [{ type: "SOLID", color: accent }];
    lpLabel.letterSpacing = { value: 2.5, unit: "PIXELS" };
    lpLabel.x = PAD;
    lpLabel.y = lpY;
    logoPage.appendChild(lpLabel);
    lpY += 28;

    // Título
    var lpTitle = figma.createText();
    lpTitle.characters = "Logotipo";
    lpTitle.fontSize = 56;
    lpTitle.fontName = fonts.bold;
    lpTitle.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.08 } }];
    lpTitle.resize(lpLeftW, 70);
    lpTitle.textAutoResize = "HEIGHT";
    lpTitle.x = PAD;
    lpTitle.y = lpY;
    logoPage.appendChild(lpTitle);
    lpY += lpTitle.height + 20;

    // Línea divisora bajo título
    var lpDivider = figma.createRectangle();
    lpDivider.resize(48, 3);
    lpDivider.fills = [{ type: "SOLID", color: accent }];
    lpDivider.cornerRadius = 2;
    lpDivider.x = PAD;
    lpDivider.y = lpY;
    logoPage.appendChild(lpDivider);
    lpY += 24;

    // Párrafo introductorio
    var lpIntro = figma.createText();
    lpIntro.characters = "El logotipo es el elemento más reconocible de la marca. Concentra la personalidad, los valores y la promesa de la organización en una sola forma.\n\nDebe usarse siempre en su versión original, sin alteraciones, sobre fondos que garanticen legibilidad y contraste suficiente.";
    lpIntro.fontSize = 15;
    lpIntro.fontName = fonts.reg;
    lpIntro.fills = [{ type: "SOLID", color: { r: 0.32, g: 0.32, b: 0.38 } }];
    lpIntro.resize(lpLeftW, 10);
    lpIntro.textAutoResize = "HEIGHT";
    lpIntro.lineHeight = { value: 175, unit: "PERCENT" };
    lpIntro.x = PAD;
    lpIntro.y = lpY;
    logoPage.appendChild(lpIntro);
    lpY += lpIntro.height + 40;

    // Sub-label: Reglas de uso
    var rulesLabel = figma.createText();
    rulesLabel.characters = "REGLAS DE USO";
    rulesLabel.fontSize = 11;
    rulesLabel.fontName = fonts.bold;
    rulesLabel.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    rulesLabel.letterSpacing = { value: 2, unit: "PIXELS" };
    rulesLabel.x = PAD;
    rulesLabel.y = lpY;
    logoPage.appendChild(rulesLabel);
    lpY += 26;

    // Lista de reglas con bullet de acento
    var rules = [
      { icon: "→", text: "Respetar siempre el clearspace mínimo alrededor del logo" },
      { icon: "→", text: "Usar únicamente las variantes aprobadas en este manual" },
      { icon: "→", text: "Escalar siempre de forma proporcional, desde las esquinas" },
      { icon: "→", text: "No aplicar efectos: sombras, gradientes ni transparencias" }
    ];

    for (var ri = 0; ri < rules.length; ri++) {
      var ruleRow = figma.createFrame();
      ruleRow.name = "Regla " + (ri + 1);
      ruleRow.layoutMode = "HORIZONTAL";
      ruleRow.itemSpacing = 12;
      ruleRow.counterAxisAlignItems = "MIN";
      ruleRow.primaryAxisSizingMode = "AUTO";
      ruleRow.counterAxisSizingMode = "AUTO";
      ruleRow.fills = [];
      ruleRow.x = PAD;
      ruleRow.y = lpY;

      var bulletT = figma.createText();
      bulletT.characters = rules[ri].icon;
      bulletT.fontSize = 13;
      bulletT.fontName = fonts.bold;
      bulletT.fills = [{ type: "SOLID", color: accent }];
      bulletT.textAutoResize = "WIDTH_AND_HEIGHT";
      ruleRow.appendChild(bulletT);

      var ruleT = figma.createText();
      ruleT.characters = rules[ri].text;
      ruleT.fontSize = 14;
      ruleT.fontName = fonts.reg;
      ruleT.fills = [{ type: "SOLID", color: { r: 0.28, g: 0.28, b: 0.34 } }];
      ruleT.resize(lpLeftW - 30, 10);
      ruleT.textAutoResize = "HEIGHT";
      ruleT.lineHeight = { value: 165, unit: "PERCENT" };
      ruleRow.appendChild(ruleT);

      logoPage.appendChild(ruleRow);
      lpY += ruleRow.height + 16;
    }

    lpY += 20;

    // Bloque: Tamaño mínimo
    var minSizeBlock = figma.createFrame();
    minSizeBlock.name = "Tamaño mínimo";
    minSizeBlock.layoutMode = "HORIZONTAL";
    minSizeBlock.itemSpacing = 24;
    minSizeBlock.counterAxisAlignItems = "CENTER";
    minSizeBlock.primaryAxisSizingMode = "AUTO";
    minSizeBlock.counterAxisSizingMode = "AUTO";
    minSizeBlock.paddingLeft = 20;
    minSizeBlock.paddingRight = 20;
    minSizeBlock.paddingTop = 18;
    minSizeBlock.paddingBottom = 18;
    minSizeBlock.cornerRadius = 12;
    minSizeBlock.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.98 } }];
    minSizeBlock.x = PAD;
    minSizeBlock.y = lpY;

    var minLabel = figma.createText();
    minLabel.characters = "TAMAÑO MÍNIMO";
    minLabel.fontSize = 11;
    minLabel.fontName = fonts.bold;
    minLabel.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    minLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
    minLabel.textAutoResize = "WIDTH_AND_HEIGHT";
    minSizeBlock.appendChild(minLabel);

    var minDigital = figma.createFrame();
    minDigital.layoutMode = "VERTICAL";
    minDigital.itemSpacing = 2;
    minDigital.primaryAxisSizingMode = "AUTO";
    minDigital.counterAxisSizingMode = "AUTO";
    minDigital.fills = [];
    var mdVal = figma.createText();
    mdVal.characters = "40 px";
    mdVal.fontSize = 22;
    mdVal.fontName = fonts.bold;
    mdVal.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    mdVal.textAutoResize = "WIDTH_AND_HEIGHT";
    var mdLbl = figma.createText();
    mdLbl.characters = "Digital";
    mdLbl.fontSize = 12;
    mdLbl.fontName = fonts.reg;
    mdLbl.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    mdLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    minDigital.appendChild(mdVal);
    minDigital.appendChild(mdLbl);
    minSizeBlock.appendChild(minDigital);

    var minSep = figma.createRectangle();
    minSep.resize(1, 36);
    minSep.fills = [{ type: "SOLID", color: { r: 0.86, g: 0.86, b: 0.9 } }];
    minSizeBlock.appendChild(minSep);

    var minPrint = figma.createFrame();
    minPrint.layoutMode = "VERTICAL";
    minPrint.itemSpacing = 2;
    minPrint.primaryAxisSizingMode = "AUTO";
    minPrint.counterAxisSizingMode = "AUTO";
    minPrint.fills = [];
    var mpVal = figma.createText();
    mpVal.characters = "15 mm";
    mpVal.fontSize = 22;
    mpVal.fontName = fonts.bold;
    mpVal.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    mpVal.textAutoResize = "WIDTH_AND_HEIGHT";
    var mpLbl = figma.createText();
    mpLbl.characters = "Impresión";
    mpLbl.fontSize = 12;
    mpLbl.fontName = fonts.reg;
    mpLbl.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    mpLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    minPrint.appendChild(mpVal);
    minPrint.appendChild(mpLbl);
    minSizeBlock.appendChild(minPrint);

    logoPage.appendChild(minSizeBlock);

    // ── Columna derecha: visual del logo ──────────────────────

    // Caja display del logo
    var logoDisplay = figma.createFrame();
    logoDisplay.name = "Logo display";
    logoDisplay.resize(lpRightW, 480);
    logoDisplay.cornerRadius = 24;
    logoDisplay.layoutMode = "VERTICAL";
    logoDisplay.primaryAxisAlignItems = "CENTER";
    logoDisplay.counterAxisAlignItems = "CENTER";
    logoDisplay.primaryAxisSizingMode = "FIXED";
    logoDisplay.counterAxisSizingMode = "FIXED";
    // Patrón de fondo tipo "checker" simulado con color muy suave
    logoDisplay.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    logoDisplay.x = lpRightX;
    logoDisplay.y = safeTop;
    logoPage.appendChild(logoDisplay);

    var mainLogo = frame.clone();
    mainLogo.name = "Logotipo";
    var lMaxW = lpRightW - 120;
    var lMaxH = 300;
    if (mainLogo.width > lMaxW || mainLogo.height > lMaxH) {
      var sl = Math.min(lMaxW / mainLogo.width, lMaxH / mainLogo.height);
      mainLogo.resize(Math.round(mainLogo.width * sl), Math.round(mainLogo.height * sl));
    }
    logoDisplay.appendChild(mainLogo);

    // Nombre oficial de la marca debajo del display
    var brandNameT = figma.createText();
    brandNameT.characters = frame.name;
    brandNameT.fontSize = 13;
    brandNameT.fontName = fonts.reg;
    brandNameT.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    brandNameT.letterSpacing = { value: 1.5, unit: "PIXELS" };
    brandNameT.textAlignHorizontal = "LEFT";
    brandNameT.textAutoResize = "WIDTH_AND_HEIGHT";
    brandNameT.x = lpRightX;
    brandNameT.y = safeTop + 492;
    logoPage.appendChild(brandNameT);

    // Fila de dimensiones
    var dimRowY = safeTop + 520;
    var dimProps = [
      { label: "ANCHO", val: Math.round(frame.width) + " px" },
      { label: "ALTO", val: Math.round(frame.height) + " px" },
      { label: "RELACIÓN", val: (frame.width / frame.height).toFixed(2) + " : 1" }
    ];

    var dimRowX = lpRightX;
    for (var d = 0; d < dimProps.length; d++) {
      var dimBlock = figma.createFrame();
      dimBlock.layoutMode = "VERTICAL";
      dimBlock.itemSpacing = 4;
      dimBlock.primaryAxisSizingMode = "AUTO";
      dimBlock.counterAxisSizingMode = "AUTO";
      dimBlock.paddingLeft = 20;
      dimBlock.paddingRight = 20;
      dimBlock.paddingTop = 16;
      dimBlock.paddingBottom = 16;
      dimBlock.cornerRadius = 10;
      dimBlock.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
      dimBlock.x = dimRowX;
      dimBlock.y = dimRowY;

      var dlabel = figma.createText();
      dlabel.characters = dimProps[d].label;
      dlabel.fontSize = 11;
      dlabel.fontName = fonts.bold;
      dlabel.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
      dlabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
      dlabel.textAutoResize = "WIDTH_AND_HEIGHT";
      dimBlock.appendChild(dlabel);

      var dval = figma.createText();
      dval.characters = dimProps[d].val;
      dval.fontSize = 24;
      dval.fontName = fonts.bold;
      dval.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
      dval.textAutoResize = "WIDTH_AND_HEIGHT";
      dimBlock.appendChild(dval);

      logoPage.appendChild(dimBlock);
      dimRowX += dimBlock.width + 16;
    }

    addPageNum(logoPage, "03", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 4. VARIANTES — Layout 2 cols: texto izq + cards der
    // ════════════════════════════════════════════════════════════════

    var varPage = makeSlide("Variantes", X_GUIDE, (slideH + SLIDE_GAP) * 3);
    varPage.layoutMode = "NONE";
    var vpY = safeTop;
    var vpW = slideW - PAD * 2; // 1760

    // ── Columna izquierda: header + explicación ───────────────

    var vpSecLbl = figma.createText();
    vpSecLbl.characters = "IDENTIDAD VISUAL";
    vpSecLbl.fontSize = 12;
    vpSecLbl.fontName = fonts.bold;
    vpSecLbl.fills = [{ type: "SOLID", color: accent }];
    vpSecLbl.letterSpacing = { value: 2.5, unit: "PIXELS" };
    vpSecLbl.x = PAD;
    vpSecLbl.y = vpY;
    varPage.appendChild(vpSecLbl);
    vpY += 28;

    var vpTitle = figma.createText();
    vpTitle.characters = "Variantes";
    vpTitle.fontSize = 56;
    vpTitle.fontName = fonts.bold;
    vpTitle.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.08 } }];
    vpTitle.resize(560, 70);
    vpTitle.textAutoResize = "HEIGHT";
    vpTitle.x = PAD;
    vpTitle.y = vpY;
    varPage.appendChild(vpTitle);
    vpY += vpTitle.height + 16;

    // Divisor
    var vpDiv = figma.createRectangle();
    vpDiv.resize(48, 3);
    vpDiv.fills = [{ type: "SOLID", color: accent }];
    vpDiv.cornerRadius = 2;
    vpDiv.x = PAD;
    vpDiv.y = vpY;
    varPage.appendChild(vpDiv);
    vpY += 24;

    var vpIntro = figma.createText();
    vpIntro.characters = "Un mismo logotipo convive con múltiples entornos: fondos claros, oscuros, fondos de color, impresión en escala de grises.\n\nCada variante está diseñada para preservar el contraste y la legibilidad sin alterar la identidad. Solo están permitidas las cuatro versiones mostradas a la derecha.";
    vpIntro.fontSize = 15;
    vpIntro.fontName = fonts.reg;
    vpIntro.fills = [{ type: "SOLID", color: { r: 0.32, g: 0.32, b: 0.38 } }];
    vpIntro.resize(560, 10);
    vpIntro.textAutoResize = "HEIGHT";
    vpIntro.lineHeight = { value: 175, unit: "PERCENT" };
    vpIntro.x = PAD;
    vpIntro.y = vpY;
    varPage.appendChild(vpIntro);
    vpY += vpIntro.height + 40;

    // Nota de advertencia
    var vpNote = figma.createFrame();
    vpNote.name = "Nota";
    vpNote.layoutMode = "HORIZONTAL";
    vpNote.itemSpacing = 12;
    vpNote.counterAxisAlignItems = "MIN";
    vpNote.paddingLeft = 16;
    vpNote.paddingRight = 16;
    vpNote.paddingTop = 14;
    vpNote.paddingBottom = 14;
    vpNote.cornerRadius = 10;
    vpNote.primaryAxisSizingMode = "AUTO";
    vpNote.counterAxisSizingMode = "AUTO";
    vpNote.fills = [{ type: "SOLID", color: { r: accent.r, g: accent.g, b: accent.b }, opacity: 0.08 }];
    vpNote.x = PAD;
    vpNote.y = vpY;

    var vpNoteIcon = figma.createText();
    vpNoteIcon.characters = "!";
    vpNoteIcon.fontSize = 14;
    vpNoteIcon.fontName = fonts.bold;
    vpNoteIcon.fills = [{ type: "SOLID", color: accent }];
    vpNoteIcon.textAutoResize = "WIDTH_AND_HEIGHT";
    vpNote.appendChild(vpNoteIcon);

    var vpNoteT = figma.createText();
    vpNoteT.characters = "Nunca crear variantes no aprobadas.\nSi el fondo no es compatible con ninguna de estas versiones, el logo no debe aparecer.";
    vpNoteT.fontSize = 13;
    vpNoteT.fontName = fonts.reg;
    vpNoteT.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.26 } }];
    vpNoteT.resize(490, 10);
    vpNoteT.textAutoResize = "HEIGHT";
    vpNoteT.lineHeight = { value: 165, unit: "PERCENT" };
    vpNote.appendChild(vpNoteT);
    varPage.appendChild(vpNote);

    // ── Columna derecha: 4 cards ──────────────────────────────

    var accentHex = rgbHex(accent.r, accent.g, accent.b);
    var accentCmyk = rgbToCmyk(accent.r, accent.g, accent.b);

    var variants = [
      {
        name: "Original",
        bg: { r: 1, g: 1, b: 1 },
        bgHex: "#FFFFFF",
        bgCmyk: { c: 0, m: 0, y: 0, k: 0 },
        logoColor: { r: 0.1, g: 0.1, b: 0.12 },
        logoHex: "#1A1A1F",
        logoCmyk: { c: 0, m: 0, y: 0, k: 90 },
        desc: "Versión preferida. Para fondos blancos o muy claros (L >90%). Es la versión estándar para todos los materiales digitales e impresos a color.",
        textCol: { r: 0.15, g: 0.15, b: 0.18 },
        subCol: { r: 0.45, g: 0.45, b: 0.5 },
        colorFn: null,
        badge: "PRINCIPAL"
      },
      {
        name: "Invertido",
        bg: { r: 0.04, g: 0.04, b: 0.06 },
        bgHex: "#0A0A0F",
        bgCmyk: { c: 0, m: 0, y: 0, k: 97 },
        logoColor: { r: 1, g: 1, b: 1 },
        logoHex: "#FFFFFF",
        logoCmyk: { c: 0, m: 0, y: 0, k: 0 },
        desc: "Para fondos oscuros, dark mode o fotografías de baja luminosidad. Garantiza contraste y legibilidad sin modificar la identidad.",
        textCol: { r: 1, g: 1, b: 1 },
        subCol: { r: 0.65, g: 0.65, b: 0.7 },
        colorFn: { r: 1, g: 1, b: 1 },
        badge: "DARK"
      },
      {
        name: "Escala de grises",
        bg: { r: 0.95, g: 0.95, b: 0.95 },
        bgHex: "#F2F2F2",
        bgCmyk: { c: 0, m: 0, y: 0, k: 5 },
        logoColor: { r: 0.4, g: 0.4, b: 0.4 },
        logoHex: "#666666",
        logoCmyk: { c: 0, m: 0, y: 0, k: 60 },
        desc: "Para impresión sin color, fotocopias o documentos en blanco y negro. Usar cuando el presupuesto de producción no admite tinta a color.",
        textCol: { r: 0.15, g: 0.15, b: 0.18 },
        subCol: { r: 0.5, g: 0.5, b: 0.55 },
        colorFn: { r: 0.4, g: 0.4, b: 0.4 },
        badge: "B/N"
      },
      {
        name: "Sobre color",
        bg: accent,
        bgHex: accentHex.toUpperCase(),
        bgCmyk: accentCmyk,
        logoColor: { r: 1, g: 1, b: 1 },
        logoHex: "#FFFFFF",
        logoCmyk: { c: 0, m: 0, y: 0, k: 0 },
        desc: "Exclusivo para el color corporativo principal como fondo. El logo aparece en blanco para garantizar contraste. No usar sobre variantes del color.",
        textCol: { r: 1, g: 1, b: 1 },
        subCol: { r: 0.9, g: 0.9, b: 0.95 },
        colorFn: { r: 1, g: 1, b: 1 },
        badge: "COLOR"
      }
    ];

    // Layout: 2 filas × 2 cols en la zona derecha
    var varRightX = PAD + 620;
    var varW = slideW - varRightX - PAD;
    var cardGap = 16;
    var cardW = Math.floor((varW - cardGap) / 2);
    var cardH = 380;

    for (var v = 0; v < variants.length; v++) {
      var vt = variants[v];
      var col = v % 2;
      var row = Math.floor(v / 2);
      var cardX = varRightX + col * (cardW + cardGap);
      var cardY = safeTop + row * (cardH + cardGap);

      // Card contenedor
      var card = figma.createFrame();
      card.name = vt.name;
      card.resize(cardW, cardH);
      card.cornerRadius = 20;
      card.paddingLeft = 28;
      card.paddingRight = 28;
      card.paddingTop = 28;
      card.paddingBottom = 24;
      card.layoutMode = "VERTICAL";
      card.itemSpacing = 12;
      card.primaryAxisAlignItems = "CENTER";
      card.counterAxisAlignItems = "CENTER";
      card.primaryAxisSizingMode = "FIXED";
      card.counterAxisSizingMode = "FIXED";
      card.fills = [{ type: "SOLID", color: vt.bg }];
      card.strokes = (v === 0) ? [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.92 } }] : [];
      card.strokeWeight = 1;
      card.x = cardX;
      card.y = cardY;

      // Badge de tipo
      var badgeF = figma.createFrame();
      badgeF.name = "Badge";
      badgeF.layoutMode = "HORIZONTAL";
      badgeF.primaryAxisAlignItems = "CENTER";
      badgeF.counterAxisAlignItems = "CENTER";
      badgeF.paddingLeft = 10;
      badgeF.paddingRight = 10;
      badgeF.paddingTop = 4;
      badgeF.paddingBottom = 4;
      badgeF.cornerRadius = 100;
      badgeF.primaryAxisSizingMode = "AUTO";
      badgeF.counterAxisSizingMode = "AUTO";
      var badgeBg = (v === 0) ? { r: accent.r, g: accent.g, b: accent.b } : { r: 1, g: 1, b: 1, opacity: 0.15 };
      badgeF.fills = [{ type: "SOLID", color: v === 0 ? accent : { r: 1, g: 1, b: 1 }, opacity: v === 0 ? 1 : 0.15 }];
      var badgeT = figma.createText();
      badgeT.characters = vt.badge;
      badgeT.fontSize = 10;
      badgeT.fontName = fonts.bold;
      badgeT.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      badgeT.letterSpacing = { value: 1, unit: "PIXELS" };
      badgeT.textAutoResize = "WIDTH_AND_HEIGHT";
      badgeF.appendChild(badgeT);
      card.appendChild(badgeF);

      // Logo clonado
      var vl = frame.clone();
      vl.name = "Logo — " + vt.name;
      var logoMaxW = cardW - 56;
      var logoMaxH = 130;
      if (vl.width > logoMaxW || vl.height > logoMaxH) {
        var vs = Math.min(logoMaxW / vl.width, logoMaxH / vl.height);
        vl.resize(Math.round(vl.width * vs), Math.round(vl.height * vs));
      }
      if (vt.colorFn) applyColor(vl, vt.colorFn);
      card.appendChild(vl);

      // Separador
      var cardSep = figma.createRectangle();
      cardSep.resize(cardW - 56, 1);
      cardSep.fills = [{ type: "SOLID", color: vt.textCol, opacity: 0.12 }];
      card.appendChild(cardSep);

      // Nombre de variante
      var cl = figma.createText();
      cl.characters = vt.name;
      cl.fontSize = 17;
      cl.fontName = fonts.bold;
      cl.fills = [{ type: "SOLID", color: vt.textCol }];
      cl.textAlignHorizontal = "CENTER";
      cl.textAutoResize = "WIDTH_AND_HEIGHT";
      card.appendChild(cl);

      // Descripción extendida
      var cd = figma.createText();
      cd.characters = vt.desc;
      cd.fontSize = 12;
      cd.fontName = fonts.reg;
      cd.fills = [{ type: "SOLID", color: vt.subCol }];
      cd.textAlignHorizontal = "CENTER";
      cd.resize(cardW - 56, 10);
      cd.textAutoResize = "HEIGHT";
      cd.lineHeight = { value: 165, unit: "PERCENT" };
      card.appendChild(cd);

      // Valores de color
      var valStr = vt.bgHex.toUpperCase() + "   RGB " +
        Math.round(vt.bg.r * 255) + " " + Math.round(vt.bg.g * 255) + " " + Math.round(vt.bg.b * 255);
      var valT = figma.createText();
      valT.characters = valStr;
      valT.fontSize = 10;
      valT.fontName = fonts.reg;
      valT.fills = [{ type: "SOLID", color: vt.subCol, opacity: 0.65 }];
      valT.textAlignHorizontal = "CENTER";
      valT.textAutoResize = "WIDTH_AND_HEIGHT";
      card.appendChild(valT);

      varPage.appendChild(card);
    }

    addPageNum(varPage, "04", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 5. DO'S & DON'TS — Layout 2 columnas: verde (do) | rojo (don't)
    // ════════════════════════════════════════════════════════════════

    var dndPage = makeSlide("Do's y Don'ts", X_GUIDE, (slideH + SLIDE_GAP) * 4);
    dndPage.layoutMode = "NONE";

    // ── Header ────────────────────────────────────────────────

    var dndLabel = figma.createText();
    dndLabel.characters = "IDENTIDAD VISUAL";
    dndLabel.fontSize = 12;
    dndLabel.fontName = fonts.bold;
    dndLabel.fills = [{ type: "SOLID", color: accent }];
    dndLabel.letterSpacing = { value: 2.5, unit: "PIXELS" };
    dndLabel.x = PAD;
    dndLabel.y = safeTop;
    dndPage.appendChild(dndLabel);

    var dndTitle = figma.createText();
    dndTitle.characters = "Do's & Don'ts";
    dndTitle.fontSize = 56;
    dndTitle.fontName = fonts.bold;
    dndTitle.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.08 } }];
    dndTitle.textAutoResize = "WIDTH_AND_HEIGHT";
    dndTitle.x = PAD;
    dndTitle.y = safeTop + 32;
    dndPage.appendChild(dndTitle);

    var dndSub = figma.createText();
    dndSub.characters = "El uso correcto de la identidad visual es responsabilidad de todos los que trabajan con la marca.";
    dndSub.fontSize = 15;
    dndSub.fontName = fonts.reg;
    dndSub.fills = [{ type: "SOLID", color: { r: 0.45, g: 0.45, b: 0.52 } }];
    dndSub.resize(slideW - PAD * 2, 10);
    dndSub.textAutoResize = "HEIGHT";
    dndSub.lineHeight = { value: 165, unit: "PERCENT" };
    dndSub.x = PAD;
    dndSub.y = safeTop + 108;
    dndPage.appendChild(dndSub);

    // ── Helper: crear una tarjeta Do o Don't ─────────────────
    function makeDndCard(isGood, title, desc, simulationFn, cardX, cardY, cardWidth, cardHeight) {
      var greenColor = { r: 0.1, g: 0.65, b: 0.35 };
      var redColor = { r: 0.85, g: 0.18, b: 0.18 };
      var col = isGood ? greenColor : redColor;
      var bgCol = isGood ? { r: 0.95, g: 1, b: 0.97 } : { r: 1, g: 0.96, b: 0.96 };

      var cardF = figma.createFrame();
      cardF.name = (isGood ? "✓ " : "✗ ") + title;
      cardF.resize(cardWidth, cardHeight);
      cardF.cornerRadius = 20;
      cardF.layoutMode = "VERTICAL";
      cardF.itemSpacing = 0;
      cardF.primaryAxisSizingMode = "FIXED";
      cardF.counterAxisSizingMode = "FIXED";
      cardF.fills = [{ type: "SOLID", color: bgCol }];
      cardF.x = cardX;
      cardF.y = cardY;

      // Zona de simulación visual
      var simZone = figma.createFrame();
      simZone.name = "Simulación";
      simZone.resize(cardWidth, Math.round(cardHeight * 0.52));
      simZone.layoutMode = "VERTICAL";
      simZone.primaryAxisAlignItems = "CENTER";
      simZone.counterAxisAlignItems = "CENTER";
      simZone.primaryAxisSizingMode = "FIXED";
      simZone.counterAxisSizingMode = "FIXED";
      simZone.cornerRadius = 0;
      simZone.topLeftRadius = 20;
      simZone.topRightRadius = 20;
      simZone.fills = [{ type: "SOLID", color: isGood ? { r: 0.97, g: 0.97, b: 0.98 } : { r: 0.15, g: 0.06, b: 0.06 } }];
      cardF.appendChild(simZone);

      // Aplicar función de simulación visual
      simulationFn(simZone, isGood);

      // Zona de texto
      var textZone = figma.createFrame();
      textZone.layoutMode = "VERTICAL";
      textZone.itemSpacing = 6;
      textZone.paddingLeft = 20;
      textZone.paddingRight = 20;
      textZone.paddingTop = 18;
      textZone.paddingBottom = 18;
      textZone.primaryAxisSizingMode = "AUTO";
      textZone.counterAxisSizingMode = "FIXED";
      textZone.resize(cardWidth, 10);
      textZone.fills = [];

      // Badge con icono
      var badgeRow = figma.createFrame();
      badgeRow.layoutMode = "HORIZONTAL";
      badgeRow.itemSpacing = 8;
      badgeRow.counterAxisAlignItems = "CENTER";
      badgeRow.primaryAxisSizingMode = "AUTO";
      badgeRow.counterAxisSizingMode = "AUTO";
      badgeRow.fills = [];

      var badgeIcon = figma.createText();
      badgeIcon.characters = isGood ? "✓" : "✗";
      badgeIcon.fontSize = 13;
      badgeIcon.fontName = fonts.bold;
      badgeIcon.fills = [{ type: "SOLID", color: col }];
      badgeIcon.textAutoResize = "WIDTH_AND_HEIGHT";
      badgeRow.appendChild(badgeIcon);

      var badgeLabel = figma.createText();
      badgeLabel.characters = isGood ? "CORRECTO" : "INCORRECTO";
      badgeLabel.fontSize = 11;
      badgeLabel.fontName = fonts.bold;
      badgeLabel.fills = [{ type: "SOLID", color: col }];
      badgeLabel.letterSpacing = { value: 1.2, unit: "PIXELS" };
      badgeLabel.textAutoResize = "WIDTH_AND_HEIGHT";
      badgeRow.appendChild(badgeLabel);
      textZone.appendChild(badgeRow);

      var cardTitle = figma.createText();
      cardTitle.characters = title;
      cardTitle.fontSize = 15;
      cardTitle.fontName = fonts.bold;
      cardTitle.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
      cardTitle.resize(cardWidth - 40, 10);
      cardTitle.textAutoResize = "HEIGHT";
      textZone.appendChild(cardTitle);

      var cardDesc = figma.createText();
      cardDesc.characters = desc;
      cardDesc.fontSize = 13;
      cardDesc.fontName = fonts.reg;
      cardDesc.fills = [{ type: "SOLID", color: { r: 0.42, g: 0.42, b: 0.48 } }];
      cardDesc.resize(cardWidth - 40, 10);
      cardDesc.textAutoResize = "HEIGHT";
      cardDesc.lineHeight = { value: 165, unit: "PERCENT" };
      textZone.appendChild(cardDesc);

      cardF.appendChild(textZone);
      return cardF;
    }

    // ── Definir simulaciones visuales ─────────────────────────

    // Función helper para logo mini dentro de simulación
    function addLogoSim(parent, maxW, maxH, colorOverride) {
      var lg = frame.clone();
      if (lg.width > maxW || lg.height > maxH) {
        var sc = Math.min(maxW / lg.width, maxH / lg.height);
        lg.resize(Math.round(lg.width * sc), Math.round(lg.height * sc));
      }
      if (colorOverride) applyColor(lg, colorOverride);
      parent.appendChild(lg);
      return lg;
    }

    // Do 1: Clearspace correcto
    function simDoClearspace(parent) {
      var inner = figma.createFrame();
      inner.resize(180, 90);
      inner.cornerRadius = 8;
      inner.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      inner.layoutMode = "VERTICAL";
      inner.primaryAxisAlignItems = "CENTER";
      inner.counterAxisAlignItems = "CENTER";
      inner.paddingTop = 20; inner.paddingBottom = 20;
      inner.paddingLeft = 20; inner.paddingRight = 20;
      inner.strokes = [{ type: "SOLID", color: { r: 0.1, g: 0.65, b: 0.35 } }];
      inner.strokeWeight = 1.5;
      inner.dashPattern = [5, 3];
      inner.primaryAxisSizingMode = "FIXED";
      inner.counterAxisSizingMode = "FIXED";
      addLogoSim(inner, 120, 40, null);
      parent.appendChild(inner);
    }

    // Do 2: Sobre fondo con buen contraste
    function simDoContrast(parent) {
      var bg = figma.createFrame();
      bg.resize(180, 90);
      bg.fills = [{ type: "SOLID", color: accent }];
      bg.cornerRadius = 8;
      bg.layoutMode = "VERTICAL";
      bg.primaryAxisAlignItems = "CENTER";
      bg.counterAxisAlignItems = "CENTER";
      bg.primaryAxisSizingMode = "FIXED";
      bg.counterAxisSizingMode = "FIXED";
      addLogoSim(bg, 120, 40, { r: 1, g: 1, b: 1 });
      parent.appendChild(bg);
    }

    // Do 3: Escalar proporcionalmente
    function simDoScale(parent) {
      var row = figma.createFrame();
      row.layoutMode = "HORIZONTAL";
      row.itemSpacing = 12;
      row.counterAxisAlignItems = "CENTER";
      row.primaryAxisSizingMode = "AUTO";
      row.counterAxisSizingMode = "AUTO";
      row.fills = [];
      var sizes = [100, 70, 45];
      for (var si = 0; si < sizes.length; si++) {
        var box = figma.createFrame();
        box.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        box.cornerRadius = 6;
        var lgo = frame.clone();
        var sc2 = Math.min(sizes[si] / lgo.width, (sizes[si] * 0.5) / lgo.height);
        lgo.resize(Math.round(lgo.width * sc2), Math.round(lgo.height * sc2));
        box.resize(sizes[si], Math.round(sizes[si] * 0.5) + 16);
        box.layoutMode = "VERTICAL";
        box.primaryAxisAlignItems = "CENTER";
        box.counterAxisAlignItems = "CENTER";
        box.primaryAxisSizingMode = "FIXED";
        box.counterAxisSizingMode = "FIXED";
        box.appendChild(lgo);
        row.appendChild(box);
      }
      parent.appendChild(row);
    }

    // Don't 1: Logo distorsionado
    function simDontDistort(parent) {
      var lg = frame.clone();
      var newW = Math.round(lg.width * 1.6);
      var newH = Math.round(lg.height * 0.6);
      lg.resize(newW, newH);
      // Agregar líneas de "mal uso" encima
      var overlay = figma.createFrame();
      overlay.resize(newW, newH);
      overlay.fills = [];
      overlay.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.18, b: 0.18 } }];
      overlay.strokeWeight = 2;
      overlay.layoutMode = "VERTICAL";
      overlay.primaryAxisAlignItems = "CENTER";
      overlay.counterAxisAlignItems = "CENTER";
      overlay.primaryAxisSizingMode = "FIXED";
      overlay.counterAxisSizingMode = "FIXED";
      var wrapD = figma.createFrame();
      wrapD.layoutMode = "VERTICAL";
      wrapD.primaryAxisAlignItems = "CENTER";
      wrapD.counterAxisAlignItems = "CENTER";
      wrapD.primaryAxisSizingMode = "AUTO";
      wrapD.counterAxisSizingMode = "AUTO";
      wrapD.fills = [];
      wrapD.appendChild(lg);
      parent.appendChild(wrapD);
    }

    // Don't 2: Logo con efectos (sombra + opacity baja)
    function simDontEffects(parent) {
      var bg = figma.createFrame();
      bg.resize(180, 80);
      bg.cornerRadius = 8;
      bg.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.3, b: 0.3 } }];
      bg.layoutMode = "VERTICAL";
      bg.primaryAxisAlignItems = "CENTER";
      bg.counterAxisAlignItems = "CENTER";
      bg.primaryAxisSizingMode = "FIXED";
      bg.counterAxisSizingMode = "FIXED";
      var lg = frame.clone();
      var sc3 = Math.min(120 / lg.width, 40 / lg.height);
      lg.resize(Math.round(lg.width * sc3), Math.round(lg.height * sc3));
      lg.opacity = 0.4;
      lg.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 4, y: 4 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];
      applyColor(lg, { r: 1, g: 1, b: 1 });
      bg.appendChild(lg);
      parent.appendChild(bg);
    }

    // Don't 3: Logo recortado / fuera del clearspace
    function simDontCrop(parent) {
      var bg = figma.createFrame();
      bg.resize(180, 80);
      bg.cornerRadius = 8;
      bg.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
      bg.clipsContent = true;
      bg.layoutMode = "NONE";
      bg.primaryAxisSizingMode = "FIXED";
      bg.counterAxisSizingMode = "FIXED";
      var lg = frame.clone();
      var sc4 = Math.min(160 / lg.width, 60 / lg.height);
      lg.resize(Math.round(lg.width * sc4), Math.round(lg.height * sc4));
      lg.x = -10; // recortado a propósito
      lg.y = 10;
      bg.appendChild(lg);
      parent.appendChild(bg);
    }

    // ── Layout de 6 cards (3×2) ───────────────────────────────

    var dndCardGap = 16;
    var dndContentY = safeTop + 165;
    var dndContentH = slideH - dndContentY - safeBottom;
    var dndCardH = Math.floor((dndContentH - dndCardGap) / 2);
    var halfW = Math.floor((slideW - PAD * 2 - dndCardGap * 2) / 3);

    var dndItems = [
      // Do's (izquierda, fondo claro)
      { isGood: true, title: "Usar el clearspace mínimo", desc: "Siempre respetar el área de exclusión alrededor del logo para garantizar visibilidad.", simFn: simDoClearspace },
      { isGood: true, title: "Aplicar sobre fondos con contraste", desc: "Asegurarse de que el fondo garantice un contraste suficiente con todos los elementos del logo.", simFn: simDoContrast },
      { isGood: true, title: "Escalar siempre de forma proporcional", desc: "Reducir o ampliar el logo manteniendo sus proporciones originales. Nunca modificar un eje solo.", simFn: simDoScale },
      // Don'ts (derecha, fondo oscuro)
      { isGood: false, title: "No distorsionar las proporciones", desc: "Estirar o comprimir el logo altera su geometría y destruye la identidad. No modificar sus dimensiones de forma no proporcional.", simFn: simDontDistort },
      { isGood: false, title: "No aplicar efectos visuales", desc: "Sombras, resplandores, gradientes, transparencias o contornos están estrictamente prohibidos sobre el logo.", simFn: simDontEffects },
      { isGood: false, title: "No recortar ni superponer elementos", desc: "El logo debe mostrarse completo y sin que otros elementos interfieran con su área de respeto.", simFn: simDontCrop }
    ];

    for (var di = 0; di < dndItems.length; di++) {
      var dcol = di % 3;
      var drow = Math.floor(di / 3);
      var dX = PAD + dcol * (halfW + dndCardGap);
      var dY = dndContentY + drow * (dndCardH + dndCardGap);
      var dndCard = makeDndCard(dndItems[di].isGood, dndItems[di].title, dndItems[di].desc, dndItems[di].simFn, dX, dY, halfW, dndCardH);
      dndPage.appendChild(dndCard);
    }

    addPageNum(dndPage, "05", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 6. TIPOGRAFÍA — Specimen real + escala + demo de combinación
    // ════════════════════════════════════════════════════════════════

    var typoPage = makeSlide("Tipografía", X_GUIDE, (slideH + SLIDE_GAP) * 5);
    typoPage.layoutMode = "NONE";
    var tpY = safeTop;
    var tpW = slideW - PAD * 2; // 1760

    // Header alineado a la izquierda (como el resto)
    var tpSecLbl = figma.createText();
    tpSecLbl.characters = "SISTEMA TIPOGRÁFICO";
    tpSecLbl.fontSize = 12;
    tpSecLbl.fontName = fonts.bold;
    tpSecLbl.fills = [{ type: "SOLID", color: accent }];
    tpSecLbl.letterSpacing = { value: 2.5, unit: "PIXELS" };
    tpSecLbl.x = PAD;
    tpSecLbl.y = tpY;
    typoPage.appendChild(tpSecLbl);
    tpY += 28;

    var tpTitle = figma.createText();
    tpTitle.characters = "Tipografía";
    tpTitle.fontSize = 56;
    tpTitle.fontName = fonts.bold;
    tpTitle.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.08 } }];
    tpTitle.textAlignHorizontal = "LEFT";
    tpTitle.resize(tpW, 70);
    tpTitle.textAutoResize = "HEIGHT";
    tpTitle.x = PAD;
    tpTitle.y = tpY;
    typoPage.appendChild(tpTitle);
    tpY += tpTitle.height + 16;

    // Divisor
    var tpDivider = figma.createRectangle();
    tpDivider.resize(48, 3);
    tpDivider.fills = [{ type: "SOLID", color: accent }];
    tpDivider.cornerRadius = 2;
    tpDivider.x = PAD;
    tpDivider.y = tpY;
    typoPage.appendChild(tpDivider);
    tpY += 24;

    var tpBody = figma.createText();
    tpBody.characters = "La tipografía es la voz escrita de la marca. Define jerarquía visual, guía la lectura y transmite personalidad. Usar las fuentes correctas garantiza coherencia en todos los canales.";
    tpBody.fontSize = 15;
    tpBody.fontName = fonts.reg;
    tpBody.fills = [{ type: "SOLID", color: { r: 0.32, g: 0.32, b: 0.38 } }];
    tpBody.textAlignHorizontal = "LEFT";
    tpBody.resize(860, 10);
    tpBody.textAutoResize = "HEIGHT";
    tpBody.lineHeight = { value: 175, unit: "PERCENT" };
    tpBody.x = PAD;
    tpBody.y = tpY;
    typoPage.appendChild(tpBody);
    tpY += tpBody.height + 48;

    if (fontsOk.length > 0) {

      // ══════════════════════════════════════════════════════════
      // Detección: ¿cuál es heading, cuál es body?
      // La fuente más grande detectada → headings, la otra → body
      // ══════════════════════════════════════════════════════════
      var headingFont = fontsOk[0]; // la de mayor tamaño (extractTypography ordena por size desc)
      var bodyFont = fontsOk.length > 1 ? fontsOk[1] : fontsOk[0];
      var hasPair = fontsOk.length > 1 && fontsOk[0].family !== fontsOk[1].family;

      // ── Specimen principal (izquierda o completo si solo 1 fuente) ──
      var specLeftW = hasPair ? Math.floor(tpW * 0.55) : tpW;
      var specRightX = PAD + specLeftW + 40;
      var specRightW = tpW - specLeftW - 40;

      // Nombre de la fuente heading (en grande, con la propia fuente)
      var heroName = figma.createText();
      heroName.characters = headingFont.family;
      heroName.fontSize = 72;
      try { heroName.fontName = { family: headingFont.family, style: headingFont.style }; }
      catch(e) { heroName.fontName = fonts.bold; }
      heroName.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
      heroName.textAutoResize = "WIDTH_AND_HEIGHT";
      heroName.x = PAD;
      heroName.y = tpY;
      typoPage.appendChild(heroName);
      tpY += 80;

      // Rol
      var roleLbl = figma.createText();
      roleLbl.characters = hasPair ? "HEADINGS & TÍTULOS" : "HEADINGS & BODY";
      roleLbl.fontSize = 11;
      roleLbl.fontName = fonts.bold;
      roleLbl.fills = [{ type: "SOLID", color: accent }];
      roleLbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
      roleLbl.x = PAD;
      roleLbl.y = tpY;
      typoPage.appendChild(roleLbl);
      tpY += 24;

      // Abecedario completo
      var alphaSpecimens = [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "abcdefghijklmnopqrstuvwxyz",
        "0123456789 !@#$%&*()-_=+[]{}|;:',.<>?/"
      ];
      var alphaSizes = [32, 28, 22];
      for (var ai = 0; ai < alphaSpecimens.length; ai++) {
        var alphaT = figma.createText();
        alphaT.characters = alphaSpecimens[ai];
        alphaT.fontSize = alphaSizes[ai];
        try { alphaT.fontName = { family: headingFont.family, style: headingFont.style }; }
        catch(e) { alphaT.fontName = fonts.reg; }
        alphaT.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
        alphaT.resize(specLeftW, 10);
        alphaT.textAutoResize = "HEIGHT";
        alphaT.x = PAD;
        alphaT.y = tpY;
        typoPage.appendChild(alphaT);
        tpY += alphaT.height + 6;
      }
      tpY += 16;

      // ── Escala tipográfica con la fuente real ──
      var scaleSec = figma.createText();
      scaleSec.characters = "ESCALA";
      scaleSec.fontSize = 11;
      scaleSec.fontName = fonts.bold;
      scaleSec.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
      scaleSec.letterSpacing = { value: 1.5, unit: "PIXELS" };
      scaleSec.x = PAD;
      scaleSec.y = tpY;
      typoPage.appendChild(scaleSec);
      tpY += 24;

      var scaleItems = [
        { label: "H1 Display", size: 48, sample: "Título Principal" },
        { label: "H2 Heading", size: 36, sample: "Subtítulo de Sección" },
        { label: "H3 Subheading", size: 24, sample: "Encabezado de Contenido" },
        { label: "Body", size: 16, sample: "Texto de párrafo estándar" },
        { label: "Small", size: 13, sample: "Notas al pie y captions" }
      ];

      for (var sci = 0; sci < scaleItems.length; sci++) {
        var si = scaleItems[sci];
        var scY = tpY;

        // Label (tamaño)
        var scLbl = figma.createText();
        scLbl.characters = si.label + " — " + si.size + "px";
        scLbl.fontSize = 11;
        scLbl.fontName = fonts.reg;
        scLbl.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
        scLbl.x = PAD;
        scLbl.y = scY;
        typoPage.appendChild(scLbl);

        // Sample text con la fuente real
        var scSample = figma.createText();
        scSample.characters = si.sample;
        scSample.fontSize = Math.min(si.size, 42); // cap para que no se salga
        try { scSample.fontName = { family: headingFont.family, style: si.size > 20 ? headingFont.style : headingFont.style }; }
        catch(e) { scSample.fontName = si.size > 20 ? fonts.bold : fonts.reg; }
        scSample.fills = [{ type: "SOLID", color: { r: 0.12, g: 0.12, b: 0.15 } }];
        scSample.textAutoResize = "WIDTH_AND_HEIGHT";
        scSample.x = PAD + 200;
        scSample.y = scY - 4;
        typoPage.appendChild(scSample);

        tpY = scY + Math.max(si.size, 18) + 12;
      }
      tpY += 8;

      // ── Si hay segunda fuente (serif vs sans-serif pairing) ──
      if (hasPair) {
        // Specimen de la segunda fuente (lado derecho)
        var rY = safeTop + 26 + 56 + 48; // empezar debajo del header

        var pairLabel = figma.createText();
        pairLabel.characters = "COMBINACIÓN";
        pairLabel.fontSize = 11;
        pairLabel.fontName = fonts.bold;
        pairLabel.fills = [{ type: "SOLID", color: accent }];
        pairLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
        pairLabel.x = specRightX;
        pairLabel.y = rY;
        typoPage.appendChild(pairLabel);
        rY += 28;

        // Nombre de la segunda fuente
        var bodyName = figma.createText();
        bodyName.characters = bodyFont.family;
        bodyName.fontSize = 48;
        try { bodyName.fontName = { family: bodyFont.family, style: bodyFont.style }; }
        catch(e) { bodyName.fontName = fonts.bold; }
        bodyName.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
        bodyName.textAutoResize = "WIDTH_AND_HEIGHT";
        bodyName.x = specRightX;
        bodyName.y = rY;
        typoPage.appendChild(bodyName);
        rY += 56;

        // Rol de la segunda fuente
        var bodyRole = figma.createText();
        bodyRole.characters = "BODY & PÁRRAFOS";
        bodyRole.fontSize = 11;
        bodyRole.fontName = fonts.bold;
        bodyRole.fills = [{ type: "SOLID", color: accent }];
        bodyRole.letterSpacing = { value: 1.5, unit: "PIXELS" };
        bodyRole.x = specRightX;
        bodyRole.y = rY;
        typoPage.appendChild(bodyRole);
        rY += 24;

        // Abecedario de la segunda fuente
        var bodyAlpha = [
          "ABCDEFGHIJKLM",
          "NOPQRSTUVWXYZ",
          "abcdefghijklm",
          "nopqrstuvwxyz"
        ];
        for (var bai = 0; bai < bodyAlpha.length; bai++) {
          var baT = figma.createText();
          baT.characters = bodyAlpha[bai];
          baT.fontSize = 20;
          try { baT.fontName = { family: bodyFont.family, style: bodyFont.style }; }
          catch(e) { baT.fontName = fonts.reg; }
          baT.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
          baT.resize(specRightW, 10);
          baT.textAutoResize = "HEIGHT";
          baT.x = specRightX;
          baT.y = rY;
          typoPage.appendChild(baT);
          rY += baT.height + 4;
        }
        rY += 16;

        // ── Demo de combinación: párrafo real ──
        var demoLbl = figma.createText();
        demoLbl.characters = "DEMO DE COMBINACIÓN";
        demoLbl.fontSize = 11;
        demoLbl.fontName = fonts.bold;
        demoLbl.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        demoLbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
        demoLbl.x = specRightX;
        demoLbl.y = rY;
        typoPage.appendChild(demoLbl);
        rY += 28;

        // Demo container
        var demoFrame = figma.createFrame();
        demoFrame.name = "Demo combinación";
        demoFrame.resize(specRightW, 280);
        demoFrame.cornerRadius = 16;
        demoFrame.paddingLeft = 28;
        demoFrame.paddingRight = 28;
        demoFrame.paddingTop = 28;
        demoFrame.paddingBottom = 28;
        demoFrame.layoutMode = "VERTICAL";
        demoFrame.itemSpacing = 12;
        demoFrame.primaryAxisSizingMode = "AUTO";
        demoFrame.counterAxisSizingMode = "FIXED";
        demoFrame.resize(specRightW, 10);
        demoFrame.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
        demoFrame.x = specRightX;
        demoFrame.y = rY;
        typoPage.appendChild(demoFrame);

        // Título del demo con heading font
        var demoH = figma.createText();
        demoH.characters = "El diseño es pensar hecho visible";
        demoH.fontSize = 28;
        try { demoH.fontName = { family: headingFont.family, style: headingFont.style }; }
        catch(e) { demoH.fontName = fonts.bold; }
        demoH.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
        demoH.textAutoResize = "HEIGHT";
        demoFrame.appendChild(demoH);

        // Subtítulo
        var demoSub = figma.createText();
        demoSub.characters = "Cómo estas dos tipografías trabajan juntas";
        demoSub.fontSize = 15;
        try { demoSub.fontName = { family: bodyFont.family, style: bodyFont.style }; }
        catch(e) { demoSub.fontName = fonts.reg; }
        demoSub.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.45 } }];
        demoSub.textAutoResize = "HEIGHT";
        demoFrame.appendChild(demoSub);

        // Separador
        var demoSep = figma.createRectangle();
        demoSep.resize(40, 2);
        demoSep.fills = [{ type: "SOLID", color: accent }];
        demoSep.cornerRadius = 1;
        demoFrame.appendChild(demoSep);

        // Párrafo del demo con body font
        var demoP = figma.createText();
        demoP.characters = "Una buena combinación tipográfica crea contraste sin conflicto. " +
          "La tipografía de títulos aporta carácter y presencia, mientras que la de cuerpo " +
          "prioriza la legibilidad en textos largos. Juntas forman un sistema coherente " +
          "que guía al lector a través del contenido de forma natural y profesional.";
        demoP.fontSize = 14;
        try { demoP.fontName = { family: bodyFont.family, style: bodyFont.style }; }
        catch(e) { demoP.fontName = fonts.reg; }
        demoP.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.35 } }];
        demoP.textAutoResize = "HEIGHT";
        demoP.lineHeight = { value: 170, unit: "PERCENT" };
        demoFrame.appendChild(demoP);
      }

    } else {
      // Sin fuentes detectadas
      var noFontT = figma.createText();
      noFontT.characters = "No se detectaron fuentes personalizadas. Se usa Inter por defecto.";
      noFontT.fontSize = 18;
      noFontT.fontName = fonts.reg;
      noFontT.fills = [{ type: "SOLID", color: { r: 0.45, g: 0.45, b: 0.5 } }];
      noFontT.textAlignHorizontal = "CENTER";
      noFontT.resize(tpW, 30);
      noFontT.x = PAD;
      noFontT.y = tpY;
      typoPage.appendChild(noFontT);

      // Mostrar Inter como specimen por defecto
      tpY += 48;
      var defaultAlpha = [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "abcdefghijklmnopqrstuvwxyz",
        "0123456789 !@#$%&*()-_=+"
      ];
      var defaultSizes = [32, 28, 22];
      for (var dai = 0; dai < defaultAlpha.length; dai++) {
        var daT = figma.createText();
        daT.characters = defaultAlpha[dai];
        daT.fontSize = defaultSizes[dai];
        daT.fontName = fonts.reg;
        daT.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
        daT.resize(tpW, 10);
        daT.textAutoResize = "HEIGHT";
        daT.x = PAD;
        daT.y = tpY;
        typoPage.appendChild(daT);
        tpY += daT.height + 6;
      }
    }

    addPageNum(typoPage, "06", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 6. PALETA DE COLORES — Layout centrado y pro (1920×1080)
    // ════════════════════════════════════════════════════════════════

    var colorPage = makeSlide("Paleta de colores", X_GUIDE, (slideH + SLIDE_GAP) * 6);
    colorPage.layoutMode = "NONE";

    var cpY = safeTop;
    var contentW = slideW - PAD * 2; // 1760px

    // Header izquierda
    var sectionLbl = figma.createText();
    sectionLbl.characters = "SISTEMA DE COLOR";
    sectionLbl.fontSize = 12;
    sectionLbl.fontName = fonts.bold;
    sectionLbl.fills = [{ type: "SOLID", color: accent }];
    sectionLbl.letterSpacing = { value: 2.5, unit: "PIXELS" };
    sectionLbl.x = PAD;
    sectionLbl.y = cpY;
    colorPage.appendChild(sectionLbl);
    cpY += 28;

    var titleT = figma.createText();
    titleT.characters = "Paleta de colores";
    titleT.fontSize = 56;
    titleT.fontName = fonts.bold;
    titleT.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.08 } }];
    titleT.textAlignHorizontal = "LEFT";
    titleT.resize(contentW, 70);
    titleT.textAutoResize = "HEIGHT";
    titleT.x = PAD;
    titleT.y = cpY;
    colorPage.appendChild(titleT);
    cpY += titleT.height + 16;

    // Divisor
    var cpDivider = figma.createRectangle();
    cpDivider.resize(48, 3);
    cpDivider.fills = [{ type: "SOLID", color: accent }];
    cpDivider.cornerRadius = 2;
    cpDivider.x = PAD;
    cpDivider.y = cpY;
    colorPage.appendChild(cpDivider);
    cpY += 24;

    var bodyT = figma.createText();
    bodyT.characters = "Los colores de la marca no son arbitrarios. Cada uno cumple un rol semántico específico y debe usarse de acuerdo a las reglas de jerarquía establecidas. Los valores exactos garantizan consistencia entre medios digitales e impresos.";
    bodyT.fontSize = 15;
    bodyT.fontName = fonts.reg;
    bodyT.fills = [{ type: "SOLID", color: { r: 0.32, g: 0.32, b: 0.38 } }];
    bodyT.textAlignHorizontal = "LEFT";
    bodyT.resize(contentW, 10);
    bodyT.textAutoResize = "HEIGHT";
    bodyT.lineHeight = { value: 175, unit: "PERCENT" };
    bodyT.x = PAD;
    bodyT.y = cpY;
    colorPage.appendChild(bodyT);
    cpY += bodyT.height + 40;

    if (colors.length > 0) {

      if (colors.length <= 3) {
        // ══════════════════════════════════════════════════════════
        // MODO 1: Pocos colores → layout de dos columnas
        // Izquierda: color hero grande (560px)
        // Derecha: análogos + complementarios (1160px)
        // ══════════════════════════════════════════════════════════

        var leftW = 520;
        var rightW = contentW - leftW - 40;
        var rightX = PAD + leftW + 40;

        for (var ci = 0; ci < colors.length && ci < 3; ci++) {
          var cc = colors[ci];
          var cmyk = rgbToCmyk(cc.r, cc.g, cc.b);
          var rowTop = cpY;

          // Rol semántico del color
          var colorRoles = ["COLOR PRIMARIO", "COLOR SECUNDARIO", "COLOR DE APOYO"];
          var colorRoleLabel = figma.createText();
          colorRoleLabel.characters = colorRoles[ci] || ("COLOR " + (ci + 1));
          colorRoleLabel.fontSize = 11;
          colorRoleLabel.fontName = fonts.bold;
          colorRoleLabel.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
          colorRoleLabel.letterSpacing = { value: 1.8, unit: "PIXELS" };
          colorRoleLabel.x = PAD;
          colorRoleLabel.y = rowTop - 22;
          colorPage.appendChild(colorRoleLabel);

          // ── IZQUIERDA: Color hero ──
          var hero = figma.createFrame();
          hero.name = "Color " + cc.hex;
          hero.resize(leftW, 260);
          hero.cornerRadius = 20;
          hero.fills = [{ type: "SOLID", color: { r: cc.r, g: cc.g, b: cc.b } }];
          hero.x = PAD;
          hero.y = rowTop;
          colorPage.appendChild(hero);

          // HEX sobre el swatch (grande, con sombra)
          var heroHex = figma.createText();
          heroHex.characters = cc.hex.toUpperCase();
          heroHex.fontSize = 36;
          heroHex.fontName = fonts.bold;
          heroHex.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.95 }];
          heroHex.x = PAD + 28;
          heroHex.y = rowTop + 28;
          colorPage.appendChild(heroHex);

          // Valores debajo del swatch
          var valY = rowTop + 260 + 16;
          var valLabels = [
            "RGB  " + Math.round(cc.r * 255) + ", " + Math.round(cc.g * 255) + ", " + Math.round(cc.b * 255),
            "CMYK  " + cmyk.c + "%, " + cmyk.m + "%, " + cmyk.y + "%, " + cmyk.k + "%"
          ];
          for (var vi = 0; vi < valLabels.length; vi++) {
            var vT = figma.createText();
            vT.characters = valLabels[vi];
            vT.fontSize = 13;
            vT.fontName = fonts.reg;
            vT.fills = [{ type: "SOLID", color: { r: 0.45, g: 0.45, b: 0.5 } }];
            vT.x = PAD + 8;
            vT.y = valY + vi * 22;
            colorPage.appendChild(vT);
          }

          // ── DERECHA: Análogos + Complementarios ──
          var anColors = generateAnalogous(cc.r, cc.g, cc.b, 4);
          var compColors = generateComplementary(cc.r, cc.g, cc.b);

          // Label "ANÁLOGOS"
          var anLbl = figma.createText();
          anLbl.characters = "ANÁLOGOS";
          anLbl.fontSize = 11;
          anLbl.fontName = fonts.bold;
          anLbl.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
          anLbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
          anLbl.x = rightX;
          anLbl.y = rowTop;
          colorPage.appendChild(anLbl);

          // Grid de análogos (2x2)
          var anSw = 130;
          var anSh = 130;
          var anGap = 14;
          for (var aj = 0; aj < anColors.length; aj++) {
            var acol = aj % 2;
            var arow = Math.floor(aj / 2);
            var ax = rightX + acol * (anSw + anGap);
            var ay = rowTop + 24 + arow * (anSh + 36);

            var anFrame = figma.createFrame();
            anFrame.name = "Análogo " + anColors[aj].hex;
            anFrame.resize(anSw, anSh);
            anFrame.cornerRadius = 14;
            anFrame.fills = [{ type: "SOLID", color: { r: anColors[aj].r, g: anColors[aj].g, b: anColors[aj].b } }];
            anFrame.x = ax;
            anFrame.y = ay;
            colorPage.appendChild(anFrame);

            var anHexT = figma.createText();
            anHexT.characters = anColors[aj].hex.toUpperCase();
            anHexT.fontSize = 12;
            anHexT.fontName = fonts.bold;
            anHexT.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.9 }];
            anHexT.x = ax + 10;
            anHexT.y = ay + anSh - 24;
            colorPage.appendChild(anHexT);
          }

          // Label "COMPLEMENTARIO"
          var compSectionY = rowTop + 24 + 2 * (anSh + 36);
          var compLbl = figma.createText();
          compLbl.characters = "COMPLEMENTARIO";
          compLbl.fontSize = 11;
          compLbl.fontName = fonts.bold;
          compLbl.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
          compLbl.letterSpacing = { value: 1.5, unit: "PIXELS" };
          compLbl.x = rightX;
          compLbl.y = compSectionY;
          colorPage.appendChild(compLbl);

          // Par complementario lado a lado
          var compSw = 260;
          var compSh = 90;

          // Original mini
          var origMini = figma.createFrame();
          origMini.name = "Base";
          origMini.resize(compSw, compSh);
          origMini.cornerRadius = 14;
          origMini.fills = [{ type: "SOLID", color: { r: cc.r, g: cc.g, b: cc.b } }];
          origMini.x = rightX;
          origMini.y = compSectionY + 24;
          colorPage.appendChild(origMini);

          var origHex = figma.createText();
          origHex.characters = cc.hex.toUpperCase();
          origHex.fontSize = 14;
          origHex.fontName = fonts.bold;
          origHex.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.9 }];
          origHex.x = rightX + 12;
          origHex.y = compSectionY + 24 + compSh - 28;
          colorPage.appendChild(origHex);

          // Flecha
          var arrowT = figma.createText();
          arrowT.characters = "→";
          arrowT.fontSize = 28;
          arrowT.fontName = fonts.reg;
          arrowT.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.75 } }];
          arrowT.textAutoResize = "WIDTH_AND_HEIGHT";
          arrowT.x = rightX + compSw + 12;
          arrowT.y = compSectionY + 24 + 24;
          colorPage.appendChild(arrowT);

          // Complementario
          var compFrame = figma.createFrame();
          compFrame.name = "Complementario " + compColors[0].hex;
          compFrame.resize(compSw, compSh);
          compFrame.cornerRadius = 14;
          compFrame.fills = [{ type: "SOLID", color: { r: compColors[0].r, g: compColors[0].g, b: compColors[0].b } }];
          compFrame.x = rightX + compSw + 44;
          compFrame.y = compSectionY + 24;
          colorPage.appendChild(compFrame);

          var compHexT = figma.createText();
          compHexT.characters = compColors[0].hex.toUpperCase();
          compHexT.fontSize = 14;
          compHexT.fontName = fonts.bold;
          compHexT.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.9 }];
          compHexT.x = rightX + compSw + 44 + 12;
          compHexT.y = compSectionY + 24 + compSh - 28;
          colorPage.appendChild(compHexT);

          cpY = Math.max(cpY + 260 + 50, compSectionY + 24 + compSh + 40);
        }

      } else {
        // ══════════════════════════════════════════════════════════
        // MODO 2: 4+ colores → degradados centrados
        // ══════════════════════════════════════════════════════════

        var gradLabel = figma.createText();
        gradLabel.characters = "ESCALAS DE COLOR";
        gradLabel.fontSize = 11;
        gradLabel.fontName = fonts.bold;
        gradLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        gradLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
        gradLabel.textAlignHorizontal = "CENTER";
        gradLabel.resize(contentW, 18);
        gradLabel.x = PAD;
        gradLabel.y = cpY;
        colorPage.appendChild(gradLabel);
        cpY += 32;

        var steps = 9;
        var barH = 80;
        var barGap = 20;
        var hexLabelH = 24;

        for (var gi = 0; gi < colors.length && gi < 6; gi++) {
          var gc = colors[gi];
          var scale = generateTintsAndShades(gc.r, gc.g, gc.b, steps);
          var segW = Math.floor(contentW / steps);

          // Nombre del color + HEX base
          var colorInfo = figma.createText();
          colorInfo.characters = gc.hex.toUpperCase();
          colorInfo.fontSize = 16;
          colorInfo.fontName = fonts.bold;
          colorInfo.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.18 } }];
          colorInfo.x = PAD;
          colorInfo.y = cpY;
          colorPage.appendChild(colorInfo);
          cpY += 26;

          // Barra de degradado completa
          for (var si = 0; si < scale.length; si++) {
            var sW = (si === 0 || si === scale.length - 1) ? segW - 2 : segW;
            var sX = PAD + si * segW;
            if (si === scale.length - 1 && si > 0) sX = PAD + si * segW + 2;

            var sRect = figma.createFrame();
            sRect.name = scale[si].hex;
            sRect.resize(sW, barH);
            sRect.fills = [{ type: "SOLID", color: { r: scale[si].r, g: scale[si].g, b: scale[si].b } }];

            // Bordes redondeados solo en los extremos
            if (si === 0) { sRect.topLeftRadius = 12; sRect.bottomLeftRadius = 12; }
            if (si === scale.length - 1) { sRect.topRightRadius = 12; sRect.bottomRightRadius = 12; }

            sRect.x = sX;
            sRect.y = cpY;
            colorPage.appendChild(sRect);

            // HEX debajo
            var sHexT = figma.createText();
            sHexT.characters = scale[si].hex.toUpperCase();
            sHexT.fontSize = 10;
            sHexT.fontName = fonts.reg;
            sHexT.fills = [{ type: "SOLID", color: { r: 0.45, g: 0.45, b: 0.5 } }];
            sHexT.textAlignHorizontal = "CENTER";
            sHexT.resize(segW, hexLabelH);
            sHexT.x = sX;
            sHexT.y = cpY + barH + 4;
            colorPage.appendChild(sHexT);
          }

          cpY += barH + hexLabelH + barGap;
        }
      }

    } else {
      var noColorT = figma.createText();
      noColorT.characters = "No se detectaron colores en el diseño.";
      noColorT.fontSize = 18;
      noColorT.fontName = fonts.reg;
      noColorT.fills = [{ type: "SOLID", color: { r: 0.45, g: 0.45, b: 0.5 } }];
      noColorT.textAlignHorizontal = "CENTER";
      noColorT.resize(contentW, 30);
      noColorT.x = PAD;
      noColorT.y = cpY;
      colorPage.appendChild(noColorT);
    }

    addPageNum(colorPage, "07", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 8. GRILLA DE CONSTRUCCIÓN — Clearspace + tamaño mínimo + usos incorrectos
    // ════════════════════════════════════════════════════════════════

    var gridPage = makeSlide("Grilla de construcción", X_GUIDE, (slideH + SLIDE_GAP) * 7);
    gridPage.layoutMode = "NONE";

    var gpY = safeTop;

    // ── Header ────────────────────────────────────────────────

    var gpLabel = figma.createText();
    gpLabel.characters = "SISTEMA DE IDENTIDAD";
    gpLabel.fontSize = 12;
    gpLabel.fontName = fonts.bold;
    gpLabel.fills = [{ type: "SOLID", color: accent }];
    gpLabel.letterSpacing = { value: 2.5, unit: "PIXELS" };
    gpLabel.x = PAD;
    gpLabel.y = gpY;
    gridPage.appendChild(gpLabel);
    gpY += 28;

    var gpTitleT = figma.createText();
    gpTitleT.characters = "Grilla de construcción";
    gpTitleT.fontSize = 56;
    gpTitleT.fontName = fonts.bold;
    gpTitleT.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.08 } }];
    gpTitleT.resize(800, 70);
    gpTitleT.textAutoResize = "HEIGHT";
    gpTitleT.x = PAD;
    gpTitleT.y = gpY;
    gridPage.appendChild(gpTitleT);
    gpY += gpTitleT.height + 16;

    var gpDivider = figma.createRectangle();
    gpDivider.resize(48, 3);
    gpDivider.fills = [{ type: "SOLID", color: accent }];
    gpDivider.cornerRadius = 2;
    gpDivider.x = PAD;
    gpDivider.y = gpY;
    gridPage.appendChild(gpDivider);
    gpY += 28;

    var gpBodyT = figma.createText();
    gpBodyT.characters = "El logotipo necesita espacio para respirar. Las reglas de esta sección protegen su integridad en cualquier contexto, asegurando legibilidad y presencia visual correcta.";
    gpBodyT.fontSize = 15;
    gpBodyT.fontName = fonts.reg;
    gpBodyT.fills = [{ type: "SOLID", color: { r: 0.32, g: 0.32, b: 0.38 } }];
    gpBodyT.resize(860, 10);
    gpBodyT.textAutoResize = "HEIGHT";
    gpBodyT.lineHeight = { value: 175, unit: "PERCENT" };
    gpBodyT.x = PAD;
    gpBodyT.y = gpY;
    gridPage.appendChild(gpBodyT);
    gpY += gpBodyT.height + 44;

    // ── Layout: 3 bloques en fila ─────────────────────────────
    var CLRSP = 30;
    var gridContentW = slideW - PAD * 2;
    var blockW = Math.floor((gridContentW - 40) / 3);
    var blockH = 440;

    // ─ BLOQUE 1: Clearspace ────────────────────────────────────
    var csBlock = figma.createFrame();
    csBlock.name = "Clearspace";
    csBlock.resize(blockW, blockH);
    csBlock.cornerRadius = 20;
    csBlock.layoutMode = "VERTICAL";
    csBlock.itemSpacing = 0;
    csBlock.primaryAxisSizingMode = "FIXED";
    csBlock.counterAxisSizingMode = "FIXED";
    csBlock.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    csBlock.x = PAD;
    csBlock.y = gpY;
    gridPage.appendChild(csBlock);

    // Zona visual del clearspace (60% del bloque)
    var csVisual = figma.createFrame();
    csVisual.resize(blockW, Math.round(blockH * 0.58));
    csVisual.cornerRadius = 0;
    csVisual.topLeftRadius = 20;
    csVisual.topRightRadius = 20;
    csVisual.layoutMode = "VERTICAL";
    csVisual.primaryAxisAlignItems = "CENTER";
    csVisual.counterAxisAlignItems = "CENTER";
    csVisual.primaryAxisSizingMode = "FIXED";
    csVisual.counterAxisSizingMode = "FIXED";
    csVisual.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

    // Frame con clearspace (borde punteado rojo)
    var csBox = figma.createFrame();
    csBox.name = "Área de respeto";
    csBox.layoutMode = "VERTICAL";
    csBox.primaryAxisAlignItems = "CENTER";
    csBox.counterAxisAlignItems = "CENTER";
    csBox.paddingLeft = CLRSP;
    csBox.paddingRight = CLRSP;
    csBox.paddingTop = CLRSP;
    csBox.paddingBottom = CLRSP;
    csBox.primaryAxisSizingMode = "AUTO";
    csBox.counterAxisSizingMode = "AUTO";
    csBox.cornerRadius = 4;
    csBox.fills = [];
    csBox.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.15, b: 0.15 } }];
    csBox.strokeWeight = 1.5;
    csBox.dashPattern = [6, 4];

    var gridLogo = frame.clone();
    gridLogo.name = "Logo";
    if (gridLogo.width > 160 || gridLogo.height > 80) {
      var gs = Math.min(160 / gridLogo.width, 80 / gridLogo.height);
      gridLogo.resize(Math.round(gridLogo.width * gs), Math.round(gridLogo.height * gs));
    }
    csBox.appendChild(gridLogo);
    csVisual.appendChild(csBox);
    csBlock.appendChild(csVisual);

    // Texto del bloque clearspace
    var csTextZone = figma.createFrame();
    csTextZone.layoutMode = "VERTICAL";
    csTextZone.itemSpacing = 8;
    csTextZone.paddingLeft = 24;
    csTextZone.paddingRight = 24;
    csTextZone.paddingTop = 24;
    csTextZone.paddingBottom = 24;
    csTextZone.primaryAxisSizingMode = "AUTO";
    csTextZone.counterAxisSizingMode = "FIXED";
    csTextZone.resize(blockW, 10);
    csTextZone.fills = [];

    var csNumLbl = figma.createText();
    csNumLbl.characters = "01";
    csNumLbl.fontSize = 11;
    csNumLbl.fontName = fonts.bold;
    csNumLbl.fills = [{ type: "SOLID", color: accent }];
    csNumLbl.letterSpacing = { value: 1, unit: "PIXELS" };
    csNumLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    csTextZone.appendChild(csNumLbl);

    var csTitleT = figma.createText();
    csTitleT.characters = "Área de respeto";
    csTitleT.fontSize = 18;
    csTitleT.fontName = fonts.bold;
    csTitleT.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    csTitleT.textAutoResize = "WIDTH_AND_HEIGHT";
    csTextZone.appendChild(csTitleT);

    var csDescT = figma.createText();
    csDescT.characters = "El logo debe rodearse de un área libre de " + CLRSP + " px (digital) o 5 mm (impresión) en todos sus lados. Ningún elemento puede invadir esta zona.";
    csDescT.fontSize = 13;
    csDescT.fontName = fonts.reg;
    csDescT.fills = [{ type: "SOLID", color: { r: 0.42, g: 0.42, b: 0.48 } }];
    csDescT.resize(blockW - 48, 10);
    csDescT.textAutoResize = "HEIGHT";
    csDescT.lineHeight = { value: 165, unit: "PERCENT" };
    csTextZone.appendChild(csDescT);

    var csTag = figma.createText();
    csTag.characters = CLRSP + " px mínimo · 5 mm impresión";
    csTag.fontSize = 11;
    csTag.fontName = fonts.bold;
    csTag.fills = [{ type: "SOLID", color: { r: 0.8, g: 0.15, b: 0.15 } }];
    csTag.textAutoResize = "WIDTH_AND_HEIGHT";
    csTextZone.appendChild(csTag);

    csBlock.appendChild(csTextZone);

    // ─ BLOQUE 2: Tamaño mínimo ──────────────────────────────────

    var minBlock = figma.createFrame();
    minBlock.name = "Tamaño mínimo";
    minBlock.resize(blockW, blockH);
    minBlock.cornerRadius = 20;
    minBlock.layoutMode = "VERTICAL";
    minBlock.itemSpacing = 0;
    minBlock.primaryAxisSizingMode = "FIXED";
    minBlock.counterAxisSizingMode = "FIXED";
    minBlock.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    minBlock.x = PAD + blockW + 20;
    minBlock.y = gpY;
    gridPage.appendChild(minBlock);

    var minVisual = figma.createFrame();
    minVisual.resize(blockW, Math.round(blockH * 0.58));
    minVisual.topLeftRadius = 20;
    minVisual.topRightRadius = 20;
    minVisual.layoutMode = "HORIZONTAL";
    minVisual.itemSpacing = 20;
    minVisual.counterAxisAlignItems = "CENTER";
    minVisual.primaryAxisAlignItems = "CENTER";
    minVisual.primaryAxisSizingMode = "FIXED";
    minVisual.counterAxisSizingMode = "FIXED";
    minVisual.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

    // Dos logos: uno grande (40px), uno pequeño (20px — debajo del límite)
    var minLogoBig = frame.clone();
    var bigH = 40;
    var bigW = Math.round((bigH / frame.height) * frame.width);
    minLogoBig.resize(bigW, bigH);

    var minLogoSmall = frame.clone();
    var smallH = 18;
    var smallW = Math.round((smallH / frame.height) * frame.width);
    minLogoSmall.resize(smallW, smallH);
    minLogoSmall.opacity = 0.4; // visualmente "mal" — demasiado pequeño

    var minWrapper = figma.createFrame();
    minWrapper.layoutMode = "HORIZONTAL";
    minWrapper.itemSpacing = 28;
    minWrapper.counterAxisAlignItems = "CENTER";
    minWrapper.primaryAxisSizingMode = "AUTO";
    minWrapper.counterAxisSizingMode = "AUTO";
    minWrapper.fills = [];

    var bigLabel = figma.createFrame();
    bigLabel.layoutMode = "VERTICAL";
    bigLabel.itemSpacing = 6;
    bigLabel.counterAxisAlignItems = "CENTER";
    bigLabel.primaryAxisSizingMode = "AUTO";
    bigLabel.counterAxisSizingMode = "AUTO";
    bigLabel.fills = [];
    bigLabel.appendChild(minLogoBig);
    var bigT = figma.createText();
    bigT.characters = "40 px ✓";
    bigT.fontSize = 11;
    bigT.fontName = fonts.bold;
    bigT.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.65, b: 0.35 } }];
    bigT.textAutoResize = "WIDTH_AND_HEIGHT";
    bigLabel.appendChild(bigT);
    minWrapper.appendChild(bigLabel);

    // Divisor vertical
    var minDivV = figma.createRectangle();
    minDivV.resize(1, 60);
    minDivV.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
    minWrapper.appendChild(minDivV);

    var smallLabel = figma.createFrame();
    smallLabel.layoutMode = "VERTICAL";
    smallLabel.itemSpacing = 6;
    smallLabel.counterAxisAlignItems = "CENTER";
    smallLabel.primaryAxisSizingMode = "AUTO";
    smallLabel.counterAxisSizingMode = "AUTO";
    smallLabel.fills = [];
    smallLabel.appendChild(minLogoSmall);
    var smallT = figma.createText();
    smallT.characters = "< 40 px ✗";
    smallT.fontSize = 11;
    smallT.fontName = fonts.bold;
    smallT.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.18, b: 0.18 } }];
    smallT.textAutoResize = "WIDTH_AND_HEIGHT";
    smallLabel.appendChild(smallT);
    minWrapper.appendChild(smallLabel);

    minVisual.appendChild(minWrapper);
    minBlock.appendChild(minVisual);

    var minTextZone = figma.createFrame();
    minTextZone.layoutMode = "VERTICAL";
    minTextZone.itemSpacing = 8;
    minTextZone.paddingLeft = 24;
    minTextZone.paddingRight = 24;
    minTextZone.paddingTop = 24;
    minTextZone.paddingBottom = 24;
    minTextZone.primaryAxisSizingMode = "AUTO";
    minTextZone.counterAxisSizingMode = "FIXED";
    minTextZone.resize(blockW, 10);
    minTextZone.fills = [];

    var minNumLbl = figma.createText();
    minNumLbl.characters = "02";
    minNumLbl.fontSize = 11;
    minNumLbl.fontName = fonts.bold;
    minNumLbl.fills = [{ type: "SOLID", color: accent }];
    minNumLbl.letterSpacing = { value: 1, unit: "PIXELS" };
    minNumLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    minTextZone.appendChild(minNumLbl);

    var minTitleT = figma.createText();
    minTitleT.characters = "Tamaño mínimo";
    minTitleT.fontSize = 18;
    minTitleT.fontName = fonts.bold;
    minTitleT.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    minTitleT.textAutoResize = "WIDTH_AND_HEIGHT";
    minTextZone.appendChild(minTitleT);

    var minDescT = figma.createText();
    minDescT.characters = "Por debajo del tamaño mínimo, el logo pierde legibilidad y se desintegra visualmente. Si el espacio disponible es menor, no usar el logo.";
    minDescT.fontSize = 13;
    minDescT.fontName = fonts.reg;
    minDescT.fills = [{ type: "SOLID", color: { r: 0.42, g: 0.42, b: 0.48 } }];
    minDescT.resize(blockW - 48, 10);
    minDescT.textAutoResize = "HEIGHT";
    minDescT.lineHeight = { value: 165, unit: "PERCENT" };
    minTextZone.appendChild(minDescT);

    var minMeasures = figma.createFrame();
    minMeasures.layoutMode = "HORIZONTAL";
    minMeasures.itemSpacing = 20;
    minMeasures.counterAxisAlignItems = "CENTER";
    minMeasures.primaryAxisSizingMode = "AUTO";
    minMeasures.counterAxisSizingMode = "AUTO";
    minMeasures.fills = [];

    var minDigBlock = figma.createFrame();
    minDigBlock.layoutMode = "VERTICAL";
    minDigBlock.itemSpacing = 2;
    minDigBlock.primaryAxisSizingMode = "AUTO";
    minDigBlock.counterAxisSizingMode = "AUTO";
    minDigBlock.fills = [];
    var minDigVal = figma.createText();
    minDigVal.characters = "40 px";
    minDigVal.fontSize = 20;
    minDigVal.fontName = fonts.bold;
    minDigVal.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    minDigVal.textAutoResize = "WIDTH_AND_HEIGHT";
    var minDigLbl = figma.createText();
    minDigLbl.characters = "Digital";
    minDigLbl.fontSize = 11;
    minDigLbl.fontName = fonts.reg;
    minDigLbl.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    minDigLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    minDigBlock.appendChild(minDigVal);
    minDigBlock.appendChild(minDigLbl);
    minMeasures.appendChild(minDigBlock);

    var minDivM = figma.createRectangle();
    minDivM.resize(1, 32);
    minDivM.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
    minMeasures.appendChild(minDivM);

    var minPrintBlock = figma.createFrame();
    minPrintBlock.layoutMode = "VERTICAL";
    minPrintBlock.itemSpacing = 2;
    minPrintBlock.primaryAxisSizingMode = "AUTO";
    minPrintBlock.counterAxisSizingMode = "AUTO";
    minPrintBlock.fills = [];
    var minPrintVal = figma.createText();
    minPrintVal.characters = "15 mm";
    minPrintVal.fontSize = 20;
    minPrintVal.fontName = fonts.bold;
    minPrintVal.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    minPrintVal.textAutoResize = "WIDTH_AND_HEIGHT";
    var minPrintLbl = figma.createText();
    minPrintLbl.characters = "Impresión";
    minPrintLbl.fontSize = 11;
    minPrintLbl.fontName = fonts.reg;
    minPrintLbl.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    minPrintLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    minPrintBlock.appendChild(minPrintVal);
    minPrintBlock.appendChild(minPrintLbl);
    minMeasures.appendChild(minPrintBlock);
    minTextZone.appendChild(minMeasures);

    minBlock.appendChild(minTextZone);

    // ─ BLOQUE 3: Co-branding ────────────────────────────────────

    var coBlock = figma.createFrame();
    coBlock.name = "Co-branding";
    coBlock.resize(blockW, blockH);
    coBlock.cornerRadius = 20;
    coBlock.layoutMode = "VERTICAL";
    coBlock.itemSpacing = 0;
    coBlock.primaryAxisSizingMode = "FIXED";
    coBlock.counterAxisSizingMode = "FIXED";
    coBlock.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    coBlock.x = PAD + (blockW + 20) * 2;
    coBlock.y = gpY;
    gridPage.appendChild(coBlock);

    var coVisual = figma.createFrame();
    coVisual.resize(blockW, Math.round(blockH * 0.58));
    coVisual.topLeftRadius = 20;
    coVisual.topRightRadius = 20;
    coVisual.layoutMode = "HORIZONTAL";
    coVisual.itemSpacing = 20;
    coVisual.counterAxisAlignItems = "CENTER";
    coVisual.primaryAxisAlignItems = "CENTER";
    coVisual.primaryAxisSizingMode = "FIXED";
    coVisual.counterAxisSizingMode = "FIXED";
    coVisual.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

    var coLogoLeft = frame.clone();
    var clH = 36;
    var clW2 = Math.round((clH / frame.height) * frame.width);
    coLogoLeft.resize(clW2, clH);

    var coSepFrame = figma.createFrame();
    coSepFrame.layoutMode = "VERTICAL";
    coSepFrame.itemSpacing = 4;
    coSepFrame.counterAxisAlignItems = "CENTER";
    coSepFrame.primaryAxisSizingMode = "AUTO";
    coSepFrame.counterAxisSizingMode = "AUTO";
    coSepFrame.fills = [];
    var coLine = figma.createRectangle();
    coLine.resize(1, 36);
    coLine.fills = [{ type: "SOLID", color: { r: 0.75, g: 0.75, b: 0.78 } }];
    coSepFrame.appendChild(coLine);
    var co28 = figma.createText();
    co28.characters = "28%";
    co28.fontSize = 10;
    co28.fontName = fonts.bold;
    co28.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    co28.textAutoResize = "WIDTH_AND_HEIGHT";
    coSepFrame.appendChild(co28);

    var partnerBox = figma.createFrame();
    partnerBox.resize(Math.round(clW2 * 0.85), 36);
    partnerBox.cornerRadius = 6;
    partnerBox.layoutMode = "VERTICAL";
    partnerBox.primaryAxisAlignItems = "CENTER";
    partnerBox.counterAxisAlignItems = "CENTER";
    partnerBox.primaryAxisSizingMode = "FIXED";
    partnerBox.counterAxisSizingMode = "FIXED";
    partnerBox.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
    var partnerT = figma.createText();
    partnerT.characters = "PARTNER";
    partnerT.fontSize = 11;
    partnerT.fontName = fonts.bold;
    partnerT.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.65 } }];
    partnerT.textAutoResize = "WIDTH_AND_HEIGHT";
    partnerBox.appendChild(partnerT);

    coVisual.appendChild(coLogoLeft);
    coVisual.appendChild(coSepFrame);
    coVisual.appendChild(partnerBox);
    coBlock.appendChild(coVisual);

    var coTextZone = figma.createFrame();
    coTextZone.layoutMode = "VERTICAL";
    coTextZone.itemSpacing = 8;
    coTextZone.paddingLeft = 24;
    coTextZone.paddingRight = 24;
    coTextZone.paddingTop = 24;
    coTextZone.paddingBottom = 24;
    coTextZone.primaryAxisSizingMode = "AUTO";
    coTextZone.counterAxisSizingMode = "FIXED";
    coTextZone.resize(blockW, 10);
    coTextZone.fills = [];

    var coNumLbl = figma.createText();
    coNumLbl.characters = "03";
    coNumLbl.fontSize = 11;
    coNumLbl.fontName = fonts.bold;
    coNumLbl.fills = [{ type: "SOLID", color: accent }];
    coNumLbl.letterSpacing = { value: 1, unit: "PIXELS" };
    coNumLbl.textAutoResize = "WIDTH_AND_HEIGHT";
    coTextZone.appendChild(coNumLbl);

    var coTitleT = figma.createText();
    coTitleT.characters = "Co-branding";
    coTitleT.fontSize = 18;
    coTitleT.fontName = fonts.bold;
    coTitleT.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    coTitleT.textAutoResize = "WIDTH_AND_HEIGHT";
    coTextZone.appendChild(coTitleT);

    var coDescT = figma.createText();
    coDescT.characters = "Cuando el logo aparece junto a otra marca, la separación mínima debe ser el 28% del ancho de nuestro logo. Ambas marcas deben tener peso visual equivalente.";
    coDescT.fontSize = 13;
    coDescT.fontName = fonts.reg;
    coDescT.fills = [{ type: "SOLID", color: { r: 0.42, g: 0.42, b: 0.48 } }];
    coDescT.resize(blockW - 48, 10);
    coDescT.textAutoResize = "HEIGHT";
    coDescT.lineHeight = { value: 165, unit: "PERCENT" };
    coTextZone.appendChild(coDescT);

    var coTag = figma.createText();
    coTag.characters = "Separación: 28% del ancho del logo";
    coTag.fontSize = 11;
    coTag.fontName = fonts.bold;
    coTag.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.6 } }];
    coTag.textAutoResize = "WIDTH_AND_HEIGHT";
    coTextZone.appendChild(coTag);
    coBlock.appendChild(coTextZone);

    addPageNum(gridPage, "08", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 8. REDES SOCIALES — Plantillas por plataforma
    // ════════════════════════════════════════════════════════════════

    figma.ui.postMessage({ type: "status", message: "Generando plantillas de redes sociales..." });

    var socialPage = makeSlide("Redes sociales", X_SOCIAL, 0);
    socialPage.resize(slideW, 27887);
    socialPage.primaryAxisSizingMode = "AUTO";
    socialPage.clipsContent = false;
    //sectionLabel(socialPage, "Plantillas");
    //slideTitle(socialPage, "Redes sociales");
    //slideBody(socialPage, "Plantillas listas para usar en cada formato de red social. Cada plantilla incluye logo, área segura editable y contenido de ejemplo.");
    // ─── Configuración de formatos ─────────────────────────────────

    var IG = [
      { id: "ig-sq",      label: "Feed Cuadrado",      w: 1080, h: 1080,  safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "1:1 — 1080×1080 px" },
      { id: "ig-vert",    label: "Feed Vertical (4:5)", w: 1080, h: 1350,  safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "4:5 — 1080×1350 px" },
      { id: "ig-vert34",  label: "Feed Vertical (3:4)", w: 1080, h: 1440,  safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "3:4 — 1080×1440 px" },
      { id: "ig-horiz",   label: "Feed Horizontal",     w: 1080, h: 566,   safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "1.91:1 — 1080×566 px" },
      { id: "ig-story",   label: "Story / Reel",        w: 1080, h: 1920,  safe: { top: 310, right: 80, bottom: 310, left: 80 }, desc: "9:16 — 1080×1920 px" },
    ];

    var FB = [
      { id: "fb-sq",      label: "Post Cuadrado",      w: 1080, h: 1080,  safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "1:1 — 1080×1080 px" },
      { id: "fb-vert",    label: "Post Vertical",       w: 1080, h: 1350,  safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "4:5 — 1080×1350 px" },
      { id: "fb-horiz",   label: "Post Horizontal",     w: 1200, h: 630,   safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "1.91:1 — 1200×630 px" },
      { id: "fb-story",   label: "Story",               w: 1080, h: 1920,  safe: { top: 310, right: 80, bottom: 310, left: 80 }, desc: "9:16 — 1080×1920 px" },
      { id: "fb-banner",  label: "Portada de Página",   w: 851,  h: 315,   safe: { top: 40, right: 40, bottom: 40, left: 40 }, desc: "2.7:1 — 851×315 px" },
      { id: "fb-photo",   label: "Foto de Perfil",      w: 320,  h: 320,   safe: { top: 30, right: 30, bottom: 30, left: 30 }, desc: "1:1 — 320×320 px (círculo)" },
    ];

    var LI = [
      { id: "li-vert",    label: "Post Vertical",       w: 1080, h: 1350,  safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "4:5 — 1080×1350 px" },
      { id: "li-horiz",   label: "Post Horizontal",     w: 1200, h: 627,   safe: { top: 80, right: 80, bottom: 80, left: 80 }, desc: "1.91:1 — 1200×627 px" },
      { id: "li-banner",  label: "Banner Personal",     w: 1584, h: 396,   safe: { top: 40, right: 40, bottom: 40, left: 40 }, desc: "4:1 — 1584×396 px" },
      { id: "li-company", label: "Banner de Empresa",   w: 1128, h: 191,   safe: { top: 30, right: 30, bottom: 30, left: 30 }, desc: "5.9:1 — 1128×191 px" },
      { id: "li-photo",   label: "Foto de Perfil",      w: 400,  h: 400,   safe: { top: 30, right: 30, bottom: 30, left: 30 }, desc: "1:1 — 400×400 px (círculo)" },
    ];

    var TK = [
      { id: "tk-video",   label: "Video / Post",        w: 1080, h: 1920,  safe: { top: 310, right: 80, bottom: 310, left: 80 }, desc: "9:16 — 1080×1920 px" },
      { id: "tk-photo",   label: "Foto de Perfil",      w: 200,  h: 200,   safe: { top: 20, right: 20, bottom: 20, left: 20 }, desc: "1:1 — 200×200 px (círculo)" },
    ];

    var WA = [
      { id: "wa-status",  label: "Estado",              w: 1080, h: 1920,  safe: { top: 310, right: 80, bottom: 310, left: 80 }, desc: "9:16 — 1080×1920 px" },
      { id: "wa-photo",   label: "Foto de Perfil",      w: 500,  h: 500,   safe: { top: 40, right: 40, bottom: 40, left: 40 }, desc: "1:1 — 500×500 px (círculo)" },
    ];

    var CAROUSEL = {
      id: "ig-carousel",
      label: "Carrusel (5 slides)",
      slides: 5,
      slideW: 1080,
      slideH: 1080,
      safe: { top: 80, right: 80, bottom: 80, left: 80 },
      desc: "5× 1080×1080 px — Portada + 3 contenido + CTA"
    };

    // ─── Helper: crear template individual ──────────────────────────

    function createSocialTemplate(cfg, logoFrame, fonts, accent) {
      var template = figma.createFrame();
      template.name = cfg.label + " — " + cfg.desc;
      template.resize(cfg.w, cfg.h);

      // ── Detectar tipo de template ────────────────────────────
      var isStory = cfg.id.indexOf("story") >= 0 || cfg.id.indexOf("tk-") >= 0 || cfg.id.indexOf("wa-") >= 0;
      var isBanner = cfg.id.indexOf("banner") >= 0 || cfg.id.indexOf("company") >= 0;
      var isProfile = cfg.id.indexOf("photo") >= 0;
      var isDark = isStory || isBanner;

      // Fondo
      if (isStory) {
        template.fills = [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.08 } }];
      } else if (isBanner) {
        template.fills = [{ type: "SOLID", color: { r: accent.r * 0.12 + 0.04, g: accent.g * 0.12 + 0.04, b: accent.b * 0.12 + 0.04 } }];
      } else {
        template.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      }

      var txtMain = isDark ? { r: 1, g: 1, b: 1 } : { r: 0.08, g: 0.08, b: 0.1 };
      var txtSub = isDark ? { r: 0.75, g: 0.75, b: 0.8 } : { r: 0.4, g: 0.4, b: 0.45 };
      var txtMute = isDark ? { r: 0.45, g: 0.45, b: 0.5 } : { r: 0.6, g: 0.6, b: 0.65 };

      // ── Helpers ──────────────────────────────────────────────
      function txt(content, size, font, color) {
        var t = figma.createText();
        t.characters = content;
        t.fontSize = size;
        t.fontName = font;
        t.fills = [{ type: "SOLID", color: color }];
        return t;
      }

      function addLogoTo(parent, maxW, maxH) {
        var logo = logoFrame.clone(); logo.name = "Logo";
        if (logo.width > maxW || logo.height > maxH) {
          var s = Math.min(maxW / logo.width, maxH / logo.height);
          logo.resize(Math.round(logo.width * s), Math.round(logo.height * s));
        }
        parent.appendChild(logo);
        return logo;
      }

      // ── FOTO DE PERFIL ───────────────────────────────────────
      if (isProfile) {
        // Foto de perfil: fondo con marca + logo centrado + área segura
        template.fills = [{ type: "SOLID", color: isDark ? { r: 0.05, g: 0.05, b: 0.08 } : { r: 0.97, g: 0.97, b: 0.98 } }];

        var safeFrame = figma.createFrame();
        safeFrame.name = "Área segura — editable";
        safeFrame.resize(cfg.w - cfg.safe.left - cfg.safe.right, cfg.h - cfg.safe.top - cfg.safe.bottom);
        safeFrame.x = cfg.safe.left; safeFrame.y = cfg.safe.top;
        safeFrame.fills = [];
        safeFrame.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        safeFrame.strokeWeight = 1; safeFrame.dashPattern = [6, 4];
        template.appendChild(safeFrame);

        var logo = addLogoTo(template, cfg.w * 0.5, cfg.h * 0.3);
        logo.x = Math.round((cfg.w - logo.width) / 2);
        logo.y = Math.round((cfg.h - logo.height) / 2);

        return template;
      }

      // ── BANNERS ──────────────────────────────────────────────
      if (isBanner) {
        // Barra de acento arriba
        var bannerBar = figma.createRectangle();
        bannerBar.resize(cfg.w, Math.max(4, Math.round(cfg.h * 0.03)));
        bannerBar.fills = [{ type: "SOLID", color: accent }];
        template.appendChild(bannerBar);

        // Logo centrado
        var bannerLogo = addLogoTo(template, cfg.w * 0.25, cfg.h * 0.4);
        bannerLogo.x = Math.round((cfg.w - bannerLogo.width) / 2);
        bannerLogo.y = Math.round((cfg.h - bannerLogo.height) / 2);

        // Nombre empresa
        var bannerName = txt("TU EMPRESA S.A.", Math.max(12, Math.round(cfg.w / 50)), fonts.bold, { r: 1, g: 1, b: 1 });
        bannerName.textAlignHorizontal = "CENTER";
        bannerName.resize(cfg.w, Math.max(16, Math.round(cfg.w / 40)));
        bannerName.x = 0; bannerName.y = Math.round(cfg.h * 0.72);
        template.appendChild(bannerName);

        // Tagline
        var bannerTag = txt("Tu marca merece ser recordada", Math.max(9, Math.round(cfg.w / 80)), fonts.reg, { r: 0.7, g: 0.7, b: 0.75 });
        bannerTag.textAlignHorizontal = "CENTER";
        bannerTag.resize(cfg.w, 14);
        bannerTag.x = 0; bannerTag.y = Math.round(cfg.h * 0.82);
        template.appendChild(bannerTag);

        // Barra inferior acento
        var bannerBarBot = figma.createRectangle();
        bannerBarBot.resize(cfg.w, Math.max(4, Math.round(cfg.h * 0.03)));
        bannerBarBot.y = cfg.h - Math.max(4, Math.round(cfg.h * 0.03));
        bannerBarBot.fills = [{ type: "SOLID", color: accent }];
        template.appendChild(bannerBarBot);

        // Área segura
        var bSafe = figma.createFrame();
        bSafe.name = "Área segura — editable";
        bSafe.resize(cfg.w - cfg.safe.left - cfg.safe.right, cfg.h - cfg.safe.top - cfg.safe.bottom);
        bSafe.x = cfg.safe.left; bSafe.y = cfg.safe.top;
        bSafe.fills = [];
        bSafe.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        bSafe.strokeWeight = 1; bSafe.dashPattern = [6, 4];
        template.appendChild(bSafe);

        return template;
      }

      // ── STORIES / REELS ──────────────────────────────────────
      if (isStory) {
        // Degradado de acento en la parte inferior
        var storyAccentBg = figma.createFrame();
        storyAccentBg.resize(cfg.w, Math.round(cfg.h * 0.45));
        storyAccentBg.x = 0; storyAccentBg.y = Math.round(cfg.h * 0.55);
        storyAccentBg.fills = [{ type: "SOLID", color: { r: accent.r * 0.2, g: accent.g * 0.2, b: accent.b * 0.2 } }];
        template.appendChild(storyAccentBg);

        // Imagen placeholder grande (zona visual principal)
        var storyImg = figma.createFrame();
        storyImg.resize(cfg.w, Math.round(cfg.h * 0.5));
        storyImg.fills = [{ type: "SOLID", color: { r: accent.r * 0.12 + 0.06, g: accent.g * 0.12 + 0.06, b: accent.b * 0.12 + 0.06 } }];
        template.appendChild(storyImg);

        // Logo arriba
        var sLogo = addLogoTo(template, cfg.w * 0.25, cfg.h * 0.05);
        sLogo.x = cfg.safe.left; sLogo.y = cfg.safe.top;

        // Categoría
        var sCat = txt("CATEGORÍA", Math.max(9, Math.round(cfg.w / 60)), fonts.bold, accent);
        sCat.letterSpacing = { value: 2, unit: "PIXELS" };
        sCat.x = cfg.safe.left; sCat.y = Math.round(cfg.h * 0.28);
        template.appendChild(sCat);

        // Título grande
        var sTitle = txt("Tu titular\naquí", Math.max(28, Math.round(cfg.w / 18)), fonts.bold, { r: 1, g: 1, b: 1 });
        sTitle.resize(cfg.w - cfg.safe.left - cfg.safe.right, 10);
        sTitle.textAutoResize = "HEIGHT";
        sTitle.lineHeight = { value: 110, unit: "PERCENT" };
        sTitle.x = cfg.safe.left; sTitle.y = Math.round(cfg.h * 0.32);
        template.appendChild(sTitle);

        // Subtítulo
        var sSub = txt("Subtítulo con información relevante para tu audiencia.", Math.max(12, Math.round(cfg.w / 45)), fonts.reg, { r: 0.75, g: 0.75, b: 0.8 });
        sSub.resize(cfg.w - cfg.safe.left - cfg.safe.right, 10);
        sSub.textAutoResize = "HEIGHT"; sSub.lineHeight = { value: 160, unit: "PERCENT" };
        sSub.x = cfg.safe.left; sSub.y = Math.round(cfg.h * 0.58);
        template.appendChild(sSub);

        // CTA con flecha
        var sCtaBg = figma.createFrame();
        sCtaBg.layoutMode = "HORIZONTAL"; sCtaBg.itemSpacing = 8;
        sCtaBg.counterAxisAlignItems = "CENTER";
        sCtaBg.paddingLeft = 20; sCtaBg.paddingRight = 20; sCtaBg.paddingTop = 10; sCtaBg.paddingBottom = 10;
        sCtaBg.cornerRadius = 100;
        sCtaBg.primaryAxisSizingMode = "AUTO"; sCtaBg.counterAxisSizingMode = "AUTO";
        sCtaBg.fills = [{ type: "SOLID", color: accent }];
        sCtaBg.appendChild(txt("↑", 14, fonts.bold, { r: 1, g: 1, b: 1 }));
        sCtaBg.appendChild(txt("Desliza hacia arriba", 12, fonts.bold, { r: 1, g: 1, b: 1 }));
        sCtaBg.x = Math.round((cfg.w - 200) / 2); sCtaBg.y = Math.round(cfg.h * 0.78);
        template.appendChild(sCtaBg);

        // Handle abajo
        var sHandle = txt("@tumarca", Math.max(10, Math.round(cfg.w / 60)), fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
        sHandle.textAlignHorizontal = "CENTER"; sHandle.resize(cfg.w, 14);
        sHandle.x = 0; sHandle.y = cfg.h - cfg.safe.bottom - 20;
        template.appendChild(sHandle);

        // Área segura
        var sSafe = figma.createFrame();
        sSafe.name = "Área segura — editable";
        sSafe.resize(cfg.w - cfg.safe.left - cfg.safe.right, cfg.h - cfg.safe.top - cfg.safe.bottom);
        sSafe.x = cfg.safe.left; sSafe.y = cfg.safe.top;
        sSafe.fills = [];
        sSafe.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        sSafe.strokeWeight = 1; sSafe.dashPattern = [6, 4];
        template.appendChild(sSafe);

        return template;
      }

      // ── FEED POSTS (square, vertical, horizontal) ────────────

      var safeW = cfg.w - cfg.safe.left - cfg.safe.right;
      var safeH = cfg.h - cfg.safe.top - cfg.safe.bottom;

      // ── Header: barra de color + categoría ──────────────────
      var headerBar = figma.createFrame();
      headerBar.resize(cfg.w, Math.max(5, Math.round(cfg.h * 0.008)));
      headerBar.fills = [{ type: "SOLID", color: accent }];
      template.appendChild(headerBar);

      // Imagen placeholder — bloque grande con gradiente simulado
      var imgH = Math.round(cfg.h * 0.42);
      var imgBlock = figma.createFrame();
      imgBlock.name = "Imagen";
      imgBlock.resize(cfg.w, imgH);
      imgBlock.y = Math.max(5, Math.round(cfg.h * 0.008));
      imgBlock.fills = [{ type: "SOLID", color: { r: accent.r * 0.15 + 0.05, g: accent.g * 0.15 + 0.05, b: accent.b * 0.15 + 0.05 } }];
      template.appendChild(imgBlock);

      // Bloque decorativo dentro de la imagen (simula contenido visual)
      var decorBlock = figma.createFrame();
      decorBlock.resize(Math.round(cfg.w * 0.35), Math.round(imgH * 0.5));
      decorBlock.cornerRadius = Math.round(cfg.w * 0.02);
      decorBlock.fills = [{ type: "SOLID", color: accent }];
      decorBlock.x = Math.round(cfg.w * 0.08);
      decorBlock.y = Math.round((imgH - decorBlock.height) / 2);
      imgBlock.appendChild(decorBlock);

      // Segundo bloque decorativo
      var decorBlock2 = figma.createFrame();
      decorBlock2.resize(Math.round(cfg.w * 0.2), Math.round(imgH * 0.3));
      decorBlock2.cornerRadius = Math.round(cfg.w * 0.015);
      decorBlock2.fills = [{ type: "SOLID", color: { r: accent.r * 0.5 + 0.2, g: accent.g * 0.5 + 0.2, b: accent.b * 0.5 + 0.2 } }];
      decorBlock2.x = Math.round(cfg.w * 0.5);
      decorBlock2.y = Math.round(imgH * 0.25);
      imgBlock.appendChild(decorBlock2);

      // Texto "IMAGEN" centrado
      var imgLabel = txt("[ TU IMAGEN AQUÍ ]", Math.max(11, Math.round(cfg.w / 55)), fonts.reg, { r: 0.5, g: 0.5, b: 0.55 });
      imgLabel.textAlignHorizontal = "CENTER";
      imgLabel.resize(cfg.w, 16);
      imgLabel.x = 0; imgLabel.y = Math.round(imgH * 0.8);
      imgBlock.appendChild(imgLabel);

      // Logo en la imagen (esquina)
      var postLogo = addLogoTo(imgBlock, cfg.w * 0.15, imgH * 0.15);
      postLogo.x = cfg.w - postLogo.width - cfg.safe.right;
      postLogo.y = cfg.safe.top;

      // ── Contenido: debajo de la imagen ──────────────────────
      var contentY = imgH + Math.round(cfg.h * 0.02);

      // Badge de categoría
      var catBadge = figma.createFrame();
      catBadge.layoutMode = "HORIZONTAL";
      catBadge.paddingLeft = 10; catBadge.paddingRight = 10; catBadge.paddingTop = 4; catBadge.paddingBottom = 4;
      catBadge.cornerRadius = 100;
      catBadge.primaryAxisSizingMode = "AUTO"; catBadge.counterAxisSizingMode = "AUTO";
      catBadge.fills = [{ type: "SOLID", color: { r: accent.r * 0.12 + 0.04, g: accent.g * 0.12 + 0.04, b: accent.b * 0.12 + 0.04 } }];
      catBadge.appendChild(txt("CATEGORÍA", Math.max(8, Math.round(cfg.w / 80)), fonts.bold, accent));
      catBadge.x = cfg.safe.left; catBadge.y = contentY;
      template.appendChild(catBadge);
      contentY += catBadge.height + Math.round(cfg.h * 0.015);

      // Título principal
      var postTitle = txt("Tu titular aquí con\ndos líneas de impacto", Math.max(20, Math.round(cfg.w / 24)), fonts.bold, txtMain);
      postTitle.resize(safeW, 10);
      postTitle.textAutoResize = "HEIGHT";
      postTitle.lineHeight = { value: 115, unit: "PERCENT" };
      postTitle.x = cfg.safe.left; postTitle.y = contentY;
      template.appendChild(postTitle);
      contentY += postTitle.height + Math.round(cfg.h * 0.015);

      // Línea separadora acento
      var sepLine = figma.createRectangle();
      sepLine.resize(40, 3); sepLine.fills = [{ type: "SOLID", color: accent }];
      sepLine.x = cfg.safe.left; sepLine.y = contentY;
      template.appendChild(sepLine);
      contentY += Math.round(cfg.h * 0.02);

      // Descripción
      var postDesc = txt("Aquí va el contenido de tu post. Puede incluir datos, tips, o información relevante para tu audiencia. Mantén el texto conciso y usa párrafos cortos.", Math.max(11, Math.round(cfg.w / 50)), fonts.reg, txtSub);
      postDesc.resize(safeW, 10);
      postDesc.textAutoResize = "HEIGHT";
      postDesc.lineHeight = { value: 165, unit: "PERCENT" };
      postDesc.x = cfg.safe.left; postDesc.y = contentY;
      template.appendChild(postDesc);
      contentY += postDesc.height + Math.round(cfg.h * 0.02);

      // Botón CTA
      var ctaBtn = figma.createFrame();
      ctaBtn.layoutMode = "VERTICAL";
      ctaBtn.primaryAxisAlignItems = "CENTER"; ctaBtn.counterAxisAlignItems = "CENTER";
      ctaBtn.paddingLeft = 24; ctaBtn.paddingRight = 24; ctaBtn.paddingTop = 10; ctaBtn.paddingBottom = 10;
      ctaBtn.cornerRadius = 8;
      ctaBtn.primaryAxisSizingMode = "AUTO"; ctaBtn.counterAxisSizingMode = "AUTO";
      ctaBtn.fills = [{ type: "SOLID", color: accent }];
      ctaBtn.appendChild(txt("Leer más →", Math.max(11, Math.round(cfg.w / 55)), fonts.bold, { r: 1, g: 1, b: 1 }));
      ctaBtn.x = cfg.safe.left; ctaBtn.y = contentY;
      template.appendChild(ctaBtn);

      // ── Footer: handle + engagement ─────────────────────────
      var footerY = cfg.h - cfg.safe.bottom - Math.round(cfg.h * 0.06);

      // Separador
      var footerSep = figma.createRectangle();
      footerSep.resize(cfg.w, 1); footerSep.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
      footerSep.y = footerY;
      template.appendChild(footerSep);
      footerY += 10;

      // Handle
      var handle = txt("@tumarca", Math.max(10, Math.round(cfg.w / 65)), fonts.bold, txtMain);
      handle.x = cfg.safe.left; handle.y = footerY;
      template.appendChild(handle);

      // Engagement bar (corazones, comentarios simulados)
      var engBar = figma.createFrame();
      engBar.layoutMode = "HORIZONTAL"; engBar.itemSpacing = Math.round(cfg.w * 0.04);
      engBar.primaryAxisSizingMode = "AUTO"; engBar.counterAxisSizingMode = "AUTO";
      engBar.fills = [];

      var engItems = [
        { icon: "♥", label: "2.4K" },
        { icon: "💬", label: "128" },
        { icon: "↗", label: "Compartir" }
      ];
      for (var ei = 0; ei < engItems.length; ei++) {
        var engItem = figma.createFrame();
        engItem.layoutMode = "HORIZONTAL"; engItem.itemSpacing = 4;
        engItem.counterAxisAlignItems = "CENTER";
        engItem.primaryAxisSizingMode = "AUTO"; engItem.counterAxisSizingMode = "AUTO";
        engItem.fills = [];
        engItem.appendChild(txt(engItems[ei].icon, Math.max(10, Math.round(cfg.w / 60)), fonts.reg, txtMain));
        engItem.appendChild(txt(engItems[ei].label, Math.max(9, Math.round(cfg.w / 70)), fonts.reg, txtSub));
        engBar.appendChild(engItem);
      }
      engBar.x = cfg.w - cfg.safe.right - 200; engBar.y = footerY;
      template.appendChild(engBar);

      // ── Área segura (overlay) ──────────────────────────────
      var safeFrame = figma.createFrame();
      safeFrame.name = "Área segura — editable";
      safeFrame.resize(safeW, safeH);
      safeFrame.x = cfg.safe.left; safeFrame.y = cfg.safe.top;
      safeFrame.fills = [];
      safeFrame.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
      safeFrame.strokeWeight = 1; safeFrame.dashPattern = [6, 4];
      template.appendChild(safeFrame);

      return template;
    }

    // ─── Helper: crear carrusel completo (5 slides) ─────────────

    function createCarouselSlides(carCfg, logoFrame, fonts, accent) {
      var group = figma.createFrame();
      group.name = "Carrusel Instagram — 5 slides";
      group.resize(carCfg.slideW * carCfg.slides + 40 * (carCfg.slides - 1), carCfg.slideH);
      group.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];

      var slideContents = [
        { type: "cover", title: "5 Tips para\nmejorar tu marca", sub: "Desliza →", cta: "Desliza para leer" },
        { type: "content", num: "01", title: "Define tu identidad", body: "Tu marca es más que un logo. Es la promesa que haces a tu audiencia y cómo te perciben." },
        { type: "content", num: "02", title: "Sé consistente", body: "Usa siempre los mismos colores, tipografías y tono de voz en todos tus canales." },
        { type: "content", num: "03", title: "Conoce a tu audiencia", body: "Investiga qué necesitan, qué les preocupa y cómo puedes resolverles un problema real." },
        { type: "cta", title: "¿Te gustó?", body: "¡Guarda este post y compártelo con quien lo necesite!", cta: "Guardar + Compartir ❤️" },
      ];

      for (var s = 0; s < carCfg.slides; s++) {
        var slide = figma.createFrame();
        slide.name = "Slide " + (s + 1) + " — " + slideContents[s].type;
        slide.resize(carCfg.slideW, carCfg.slideH);
        slide.x = s * (carCfg.slideW + 40);

        var isSlideDark = false;

        if (slideContents[s].type === "cover") {
          slide.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.09 } }];
          isSlideDark = true;
        } else if (slideContents[s].type === "cta") {
          slide.fills = [{ type: "SOLID", color: { r: accent.r * 0.2, g: accent.g * 0.2, b: accent.b * 0.2 } }];
          isSlideDark = true;
        } else {
          slide.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
        }

        var sTxtMain = isSlideDark ? { r: 1, g: 1, b: 1 } : { r: 0.08, g: 0.08, b: 0.1 };
        var sTxtSub = isSlideDark ? { r: 0.7, g: 0.7, b: 0.75 } : { r: 0.45, g: 0.45, b: 0.5 };

        // Área segura editable
        var safeW = carCfg.slideW - carCfg.safe.left - carCfg.safe.right;
        var safeH = carCfg.slideH - carCfg.safe.top - carCfg.safe.bottom;

        var slideSafe = figma.createFrame();
        slideSafe.name = "Área segura";
        slideSafe.resize(safeW, safeH);
        slideSafe.x = carCfg.safe.left;
        slideSafe.y = carCfg.safe.top;
        slideSafe.fills = [];
        slideSafe.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        slideSafe.strokeWeight = 1;
        slideSafe.dashPattern = [6, 4];
        slide.appendChild(slideSafe);

        // Logo (pequeño, esquina superior)
        var sLogo = logoFrame.clone();
        sLogo.name = "Logo";
        if (sLogo.width > 150 || sLogo.height > 60) {
          var ss = Math.min(150 / sLogo.width, 60 / sLogo.height);
          sLogo.resize(Math.round(sLogo.width * ss), Math.round(sLogo.height * ss));
        }
        sLogo.x = Math.round((carCfg.slideW - sLogo.width) / 2);
        sLogo.y = carCfg.safe.top + 20;
        slide.appendChild(sLogo);

        // Número de slide (esquina inferior derecha)
        var slideNum = figma.createText();
        slideNum.characters = (s + 1) + "/" + carCfg.slides;
        slideNum.fontSize = 14;
        slideNum.fontName = fonts.reg;
        slideNum.fills = [{ type: "SOLID", color: sTxtSub }];
        slideNum.x = carCfg.slideW - carCfg.safe.right - 50;
        slideNum.y = carCfg.slideH - carCfg.safe.bottom - 30;
        slide.appendChild(slideNum);

        var sc = slideContents[s];

        if (sc.type === "cover") {
          // Título grande centrado
          var cTitle = figma.createText();
          cTitle.characters = sc.title;
          cTitle.fontSize = 56;
          cTitle.fontName = fonts.bold;
          cTitle.fills = [{ type: "SOLID", color: sTxtMain }];
          cTitle.textAlignHorizontal = "CENTER";
          cTitle.resize(safeW - 40, 10);
          cTitle.textAutoResize = "HEIGHT";
          cTitle.lineHeight = { value: 110, unit: "PERCENT" };
          cTitle.x = carCfg.safe.left + 20;
          cTitle.y = Math.round(carCfg.slideH * 0.35);
          slide.appendChild(cTitle);

          // Subtítulo
          var cSub = figma.createText();
          cSub.characters = sc.sub;
          cSub.fontSize = 24;
          cSub.fontName = fonts.reg;
          cSub.fills = [{ type: "SOLID", color: sTxtSub }];
          cSub.textAlignHorizontal = "CENTER";
          cSub.x = 0;
          cSub.y = Math.round(carCfg.slideH * 0.58);
          cSub.resize(carCfg.slideW, 30);
          cSub.textAutoResize = "HEIGHT";
          slide.appendChild(cSub);

          // CTA flecha
          var cCta = figma.createText();
          cCta.characters = sc.cta;
          cCta.fontSize = 16;
          cCta.fontName = fonts.bold;
          cCta.fills = [{ type: "SOLID", color: accent }];
          cCta.textAlignHorizontal = "CENTER";
          cCta.x = 0;
          cCta.y = carCfg.slideH - carCfg.safe.bottom - 60;
          cCta.resize(carCfg.slideW, 24);
          cCta.textAutoResize = "HEIGHT";
          slide.appendChild(cCta);

        } else if (sc.type === "content") {
          // Número grande
          var cNum = figma.createText();
          cNum.characters = sc.num;
          cNum.fontSize = 72;
          cNum.fontName = fonts.bold;
          cNum.fills = [{ type: "SOLID", color: accent }];
          cNum.textAlignHorizontal = "CENTER";
          cNum.x = 0;
          cNum.y = Math.round(carCfg.slideH * 0.22);
          cNum.resize(carCfg.slideW, 80);
          cNum.textAutoResize = "HEIGHT";
          slide.appendChild(cNum);

          // Título del punto
          var cTitle2 = figma.createText();
          cTitle2.characters = sc.title;
          cTitle2.fontSize = 36;
          cTitle2.fontName = fonts.bold;
          cTitle2.fills = [{ type: "SOLID", color: sTxtMain }];
          cTitle2.textAlignHorizontal = "CENTER";
          cTitle2.x = carCfg.safe.left + 20;
          cTitle2.y = Math.round(carCfg.slideH * 0.42);
          cTitle2.resize(safeW - 40, 10);
          cTitle2.textAutoResize = "HEIGHT";
          slide.appendChild(cTitle2);

          // Body text
          var cBody = figma.createText();
          cBody.characters = sc.body;
          cBody.fontSize = 22;
          cBody.fontName = fonts.reg;
          cBody.fills = [{ type: "SOLID", color: sTxtSub }];
          cBody.textAlignHorizontal = "CENTER";
          cBody.resize(safeW - 60, 10);
          cBody.textAutoResize = "HEIGHT";
          cBody.lineHeight = { value: 160, unit: "PERCENT" };
          cBody.x = carCfg.safe.left + 30;
          cBody.y = Math.round(carCfg.slideH * 0.55);
          slide.appendChild(cBody);

        } else if (sc.type === "cta") {
          // Título CTA
          var ctaTitle = figma.createText();
          ctaTitle.characters = sc.title;
          ctaTitle.fontSize = 52;
          ctaTitle.fontName = fonts.bold;
          ctaTitle.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
          ctaTitle.textAlignHorizontal = "CENTER";
          ctaTitle.x = 0;
          ctaTitle.y = Math.round(carCfg.slideH * 0.30);
          ctaTitle.resize(carCfg.slideW, 60);
          ctaTitle.textAutoResize = "HEIGHT";
          slide.appendChild(ctaTitle);

          // Body CTA
          var ctaBody = figma.createText();
          ctaBody.characters = sc.body;
          ctaBody.fontSize = 22;
          ctaBody.fontName = fonts.reg;
          ctaBody.fills = [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.85 } }];
          ctaBody.textAlignHorizontal = "CENTER";
          ctaBody.resize(safeW - 40, 10);
          ctaBody.textAutoResize = "HEIGHT";
          ctaBody.lineHeight = { value: 160, unit: "PERCENT" };
          ctaBody.x = carCfg.safe.left + 20;
          ctaBody.y = Math.round(carCfg.slideH * 0.45);
          slide.appendChild(ctaBody);

          // CTA button
          var ctaBtn = figma.createText();
          ctaBtn.characters = sc.cta;
          ctaBtn.fontSize = 20;
          ctaBtn.fontName = fonts.bold;
          ctaBtn.fills = [{ type: "SOLID", color: accent }];
          ctaBtn.textAlignHorizontal = "CENTER";
          ctaBtn.x = 0;
          ctaBtn.y = Math.round(carCfg.slideH * 0.62);
          ctaBtn.resize(carCfg.slideW, 30);
          ctaBtn.textAutoResize = "HEIGHT";
          slide.appendChild(ctaBtn);
        }

        group.appendChild(slide);
      }

      return group;
    }

    // ─── Helper: crear CTA especial ─────────────────────────────

    function createCTASlide(label, mainText, actionText, emoji, logoFrame, fonts, accent) {
      var template = figma.createFrame();
      template.name = label;
      template.resize(1080, 1080);
      template.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.06, b: 0.09 } }];

      // Área segura
      var safe = figma.createFrame();
      safe.name = "Área segura";
      safe.resize(920, 920);
      safe.x = 80;
      safe.y = 80;
      safe.fills = [];
      safe.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
      safe.strokeWeight = 1;
      safe.dashPattern = [6, 4];
      template.appendChild(safe);

      // Logo
      var logo = logoFrame.clone();
      logo.name = "Logo";
      if (logo.width > 180 || logo.height > 70) {
        var s = Math.min(180 / logo.width, 70 / logo.height);
        logo.resize(Math.round(logo.width * s), Math.round(logo.height * s));
      }
      logo.x = Math.round((1080 - logo.width) / 2);
      logo.y = 120;
      template.appendChild(logo);

      // Emoji grande
      var em = figma.createText();
      em.characters = emoji;
      em.fontSize = 64;
      em.fontName = fonts.reg;
      em.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      em.textAlignHorizontal = "CENTER";
      em.x = 0;
      em.y = 280;
      em.resize(1080, 80);
      em.textAutoResize = "HEIGHT";
      template.appendChild(em);

      // Texto principal
      var main = figma.createText();
      main.characters = mainText;
      main.fontSize = 48;
      main.fontName = fonts.bold;
      main.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      main.textAlignHorizontal = "CENTER";
      main.resize(840, 10);
      main.textAutoResize = "HEIGHT";
      main.lineHeight = { value: 120, unit: "PERCENT" };
      main.x = 120;
      main.y = 400;
      template.appendChild(main);

      // Acción
      var action = figma.createText();
      action.characters = actionText;
      action.fontSize = 28;
      action.fontName = fonts.bold;
      action.fills = [{ type: "SOLID", color: accent }];
      action.textAlignHorizontal = "CENTER";
      action.resize(920, 10);
      action.textAutoResize = "HEIGHT";
      action.x = 80;
      action.y = 620;
      template.appendChild(action);

      // Slide number
      var num = figma.createText();
      num.characters = "CTA";
      num.fontSize = 12;
      num.fontName = fonts.reg;
      num.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.45 } }];
      num.x = 1000;
      num.y = 1040;
      template.appendChild(num);

      return template;
    }

    // ─── Helper: crear plantilla post explicativo ────────────────

    function createExplanatoryPost(logoFrame, fonts, accent) {
      var template = figma.createFrame();
      template.name = "Post Explicativo — 1080×1350 px";
      template.resize(1080, 1350);
      template.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];

      // Área segura
      var safe = figma.createFrame();
      safe.name = "Área segura";
      safe.resize(920, 1190);
      safe.x = 80;
      safe.y = 80;
      safe.fills = [];
      safe.strokes = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
      safe.strokeWeight = 1;
      safe.dashPattern = [6, 4];
      template.appendChild(safe);

      // Barra superior con color de marca
      var topBar = figma.createFrame();
      topBar.name = "Header";
      topBar.resize(1080, 6);
      topBar.x = 0;
      topBar.y = 0;
      topBar.fills = [{ type: "SOLID", color: accent }];
      template.appendChild(topBar);

      // Logo
      var logo = logoFrame.clone();
      logo.name = "Logo";
      if (logo.width > 160 || logo.height > 60) {
        var s = Math.min(160 / logo.width, 60 / logo.height);
        logo.resize(Math.round(logo.width * s), Math.round(logo.height * s));
      }
      logo.x = 80;
      logo.y = 100;
      template.appendChild(logo);

      // Categoría
      var cat = figma.createText();
      cat.characters = "CATEGORÍA";
      cat.fontSize = 12;
      cat.fontName = fonts.bold;
      cat.fills = [{ type: "SOLID", color: accent }];
      cat.letterSpacing = { value: 2, unit: "PIXELS" };
      cat.x = 80;
      cat.y = 200;
      template.appendChild(cat);

      // Título
      var title = figma.createText();
      title.characters = "Tu titular aquí\ncon dos líneas";
      title.fontSize = 48;
      title.fontName = fonts.bold;
      title.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
      title.resize(900, 10);
      title.textAutoResize = "HEIGHT";
      title.lineHeight = { value: 115, unit: "PERCENT" };
      title.x = 80;
      title.y = 240;
      template.appendChild(title);

      // Línea separadora
      var div = figma.createRectangle();
      div.resize(60, 3);
      div.fills = [{ type: "SOLID", color: accent }];
      div.x = 80;
      div.y = 380;
      template.appendChild(div);

      // Contenido
      var body = figma.createText();
      body.characters = "Aquí va el contenido del post. Puedes incluir datos, pasos o información relevante para tu audiencia. Mantén el texto conciso y usa viñetas para facilitar la lectura.\n\n• Punto importante número uno\n• Punto importante número dos\n• Punto importante número tres";
      body.fontSize = 20;
      body.fontName = fonts.reg;
      body.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.35 } }];
      body.resize(900, 10);
      body.textAutoResize = "HEIGHT";
      body.lineHeight = { value: 170, unit: "PERCENT" };
      body.x = 80;
      body.y = 420;
      template.appendChild(body);

      // CTA inferior
      var cta = figma.createText();
      cta.characters = "¿Te fue útil? Guarda este post 📌";
      cta.fontSize = 16;
      cta.fontName = fonts.bold;
      cta.fills = [{ type: "SOLID", color: accent }];
      cta.textAlignHorizontal = "CENTER";
      cta.x = 0;
      cta.y = 1200;
      cta.resize(1080, 24);
      cta.textAutoResize = "HEIGHT";
      template.appendChild(cta);

      // Footer con handle
      var handle = figma.createText();
      handle.characters = "@tumarca";
      handle.fontSize = 13;
      handle.fontName = fonts.reg;
      handle.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.65 } }];
      handle.textAlignHorizontal = "CENTER";
      handle.x = 0;
      handle.y = 1280;
      handle.resize(1080, 20);
      handle.textAutoResize = "HEIGHT";
      template.appendChild(handle);

      return template;
    }

    // ─── Helper: card de plataforma ──────────────────────────────

    function makePlatformCard(name, emoji, templateCount, fonts) {
      var card = figma.createFrame();
      card.name = name;
      card.layoutMode = "HORIZONTAL";
      card.itemSpacing = 12;
      card.counterAxisAlignItems = "CENTER";
      card.primaryAxisSizingMode = "AUTO";
      card.counterAxisSizingMode = "AUTO";
      card.paddingTop = 8;
      card.paddingBottom = 8;
      card.fills = [];

      var em = figma.createText();
      em.characters = emoji;
      em.fontSize = 18;
      em.fontName = fonts.reg;
      em.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      card.appendChild(em);

      var label = figma.createText();
      label.characters = name + " — " + templateCount + " plantillas";
      label.fontSize = 14;
      label.fontName = fonts.bold;
      label.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.22 } }];
      card.appendChild(label);

      return card;
    }

    // ─── Helper: label con dimensiones ───────────────────────────

    function makeDimLabel(cfg, fonts, indent) {
      var row = figma.createFrame();
      row.name = cfg.label;
      row.layoutMode = "HORIZONTAL";
      row.itemSpacing = 12;
      row.counterAxisAlignItems = "CENTER";
      row.primaryAxisSizingMode = "AUTO";
      row.counterAxisSizingMode = "AUTO";
      row.paddingTop = 4;
      row.paddingBottom = 4;
      row.paddingLeft = indent ? 28 : 0;
      row.fills = [];

      var dim = figma.createText();
      dim.characters = cfg.desc;
      dim.fontSize = 12;
      dim.fontName = fonts.reg;
      dim.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
      row.appendChild(dim);

      var label = figma.createText();
      label.characters = cfg.label;
      label.fontSize = 13;
      label.fontName = fonts.bold;
      label.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.18 } }];
      row.appendChild(label);

      return row;
    }

    // ════════════════════════════════════════════════════════════════
    // Generar plantillas por plataforma
    // ════════════════════════════════════════════════════════════════

    var templateGroup = figma.createFrame();
    templateGroup.name = "Plantillas de Redes Sociales";
    templateGroup.resize(PAGE_W, 10);
    templateGroup.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
    templateGroup.layoutMode = "VERTICAL";
    templateGroup.primaryAxisAlignItems = "MIN";
    templateGroup.counterAxisAlignItems = "CENTER";
    templateGroup.paddingLeft = 40;
    templateGroup.paddingRight = 40;
    templateGroup.paddingTop = 40;
    templateGroup.paddingBottom = 40;
    templateGroup.itemSpacing = 40;
    templateGroup.primaryAxisSizingMode = "AUTO";
    templateGroup.counterAxisSizingMode = "FIXED";
    templateGroup.x = 0;
    templateGroup.y = 0;

    // ── ÍNDICE DE PLATAFORMAS ─────────────────────────────────────

    var platIdxLabel = figma.createText();
    platIdxLabel.characters = "ÍNDICE DE PLATAFORMAS";
    platIdxLabel.fontSize = 11;
    platIdxLabel.fontName = fonts.bold;
    platIdxLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
    platIdxLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
    templateGroup.appendChild(platIdxLabel);

    var totalTemplates = IG.length + FB.length + LI.length + TK.length + WA.length + CAROUSEL.slides + 3; // +3: explicativo, CTA follow, CTA palabra
    var platHeader = figma.createText();
    platHeader.characters = totalTemplates + " plantillas listas para usar";
    platHeader.fontSize = 28;
    platHeader.fontName = fonts.bold;
    platHeader.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
    templateGroup.appendChild(platHeader);

    templateGroup.appendChild(makePlatformCard("Instagram", "📸", IG.length + CAROUSEL.slides + 3, fonts));
    templateGroup.appendChild(makePlatformCard("Facebook", "👤", FB.length, fonts));
    templateGroup.appendChild(makePlatformCard("LinkedIn", "💼", LI.length, fonts));
    templateGroup.appendChild(makePlatformCard("TikTok", "🎵", TK.length, fonts));
    templateGroup.appendChild(makePlatformCard("WhatsApp", "💬", WA.length, fonts));

    // Separador
    var sep2 = figma.createRectangle();
    sep2.resize(PAGE_W - 80, 1);
    sep2.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    templateGroup.appendChild(sep2);

    // ══════════════════════════════════════════════════════════════
    // INSTAGRAM
    // ══════════════════════════════════════════════════════════════

    var igHeader = figma.createText();
    igHeader.characters = "📸 INSTAGRAM";
    igHeader.fontSize = 20;
    igHeader.fontName = fonts.bold;
    igHeader.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
    templateGroup.appendChild(igHeader);

    // Formatos básicos IG
    for (var igi = 0; igi < IG.length; igi++) {
      var igTemplate = createSocialTemplate(IG[igi], frame, fonts, accent);
      templateGroup.appendChild(igTemplate);
      templateGroup.appendChild(makeDimLabel(IG[igi], fonts, false));
    }

    // Carrusel
    var carHeader = figma.createText();
    carHeader.characters = "CARRUSEL — 5 SLIDES";
    carHeader.fontSize = 14;
    carHeader.fontName = fonts.bold;
    carHeader.fills = [{ type: "SOLID", color: accent }];
    carHeader.letterSpacing = { value: 1.5, unit: "PIXELS" };
    templateGroup.appendChild(carHeader);

    var carousel = createCarouselSlides(CAROUSEL, frame, fonts, accent);
    templateGroup.appendChild(carousel);
    templateGroup.appendChild(makeDimLabel({ label: "Carrusel completo (5 slides)", desc: "1080×1080 px cada uno" }, fonts, false));

    // CTA: Sígueme
    var ctaFollow = createCTASlide(
      "CTA — Sígueme",
      "¿Te gustó este contenido?",
      "¡Sígueme para más tips como este! →",
      "📲",
      frame, fonts, accent
    );
    templateGroup.appendChild(ctaFollow);

    // CTA: Escribe palabra
    var ctaWord = createCTASlide(
      "CTA — Escribe [PALABRA]",
      "Escribe BRAND\npara recibir tu Guía Gratis",
      "📩 Envíame la palabra por DM y te la envío al instante",
      "🎁",
      frame, fonts, accent
    );
    templateGroup.appendChild(ctaWord);

    // Post explicativo
    var explPost = createExplanatoryPost(frame, fonts, accent);
    templateGroup.appendChild(explPost);
    templateGroup.appendChild(makeDimLabel({ label: "Post explicativo", desc: "1080×1350 px (4:5)" }, fonts, false));

    // Separador
    var sepIG = figma.createRectangle();
    sepIG.resize(PAGE_W - 80, 1);
    sepIG.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    templateGroup.appendChild(sepIG);

    // ══════════════════════════════════════════════════════════════
    // FACEBOOK
    // ══════════════════════════════════════════════════════════════

    var fbHeader = figma.createText();
    fbHeader.characters = "👤 FACEBOOK";
    fbHeader.fontSize = 20;
    fbHeader.fontName = fonts.bold;
    fbHeader.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
    templateGroup.appendChild(fbHeader);

    for (var fbi = 0; fbi < FB.length; fbi++) {
      var fbTemplate = createSocialTemplate(FB[fbi], frame, fonts, accent);
      templateGroup.appendChild(fbTemplate);
      templateGroup.appendChild(makeDimLabel(FB[fbi], fonts, false));
    }

    // Separador
    var sepFB = figma.createRectangle();
    sepFB.resize(PAGE_W - 80, 1);
    sepFB.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    templateGroup.appendChild(sepFB);

    // ══════════════════════════════════════════════════════════════
    // LINKEDIN
    // ══════════════════════════════════════════════════════════════

    var liHeader = figma.createText();
    liHeader.characters = "💼 LINKEDIN";
    liHeader.fontSize = 20;
    liHeader.fontName = fonts.bold;
    liHeader.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
    templateGroup.appendChild(liHeader);

    for (var li = 0; li < LI.length; li++) {
      var liTemplate = createSocialTemplate(LI[li], frame, fonts, accent);
      templateGroup.appendChild(liTemplate);
      templateGroup.appendChild(makeDimLabel(LI[li], fonts, false));
    }

    // Separador
    var sepLI = figma.createRectangle();
    sepLI.resize(PAGE_W - 80, 1);
    sepLI.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    templateGroup.appendChild(sepLI);

    // ══════════════════════════════════════════════════════════════
    // TIKTOK
    // ══════════════════════════════════════════════════════════════

    var tkHeader = figma.createText();
    tkHeader.characters = "🎵 TIKTOK";
    tkHeader.fontSize = 20;
    tkHeader.fontName = fonts.bold;
    tkHeader.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
    templateGroup.appendChild(tkHeader);

    for (var tki = 0; tki < TK.length; tki++) {
      var tkTemplate = createSocialTemplate(TK[tki], frame, fonts, accent);
      templateGroup.appendChild(tkTemplate);
      templateGroup.appendChild(makeDimLabel(TK[tki], fonts, false));
    }

    // Separador
    var sepTK = figma.createRectangle();
    sepTK.resize(PAGE_W - 80, 1);
    sepTK.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.88 } }];
    templateGroup.appendChild(sepTK);

    // ══════════════════════════════════════════════════════════════
    // WHATSAPP
    // ══════════════════════════════════════════════════════════════

    var waHeader = figma.createText();
    waHeader.characters = "💬 WHATSAPP";
    waHeader.fontSize = 20;
    waHeader.fontName = fonts.bold;
    waHeader.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
    templateGroup.appendChild(waHeader);

    for (var wi = 0; wi < WA.length; wi++) {
      var waTemplate = createSocialTemplate(WA[wi], frame, fonts, accent);
      templateGroup.appendChild(waTemplate);
      templateGroup.appendChild(makeDimLabel(WA[wi], fonts, false));
    }

    // ══════════════════════════════════════════════════════════════
    // Agregar el grupo de plantillas a la página
    // ══════════════════════════════════════════════════════════════

    socialPage.appendChild(templateGroup);

    addPageNum(socialPage, "09", TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════
    // 9. MOCKUPS — Papelería Corporativa (Items 1-9) → X:3170
    // ════════════════════════════════════════════════════════════════

    figma.ui.postMessage({ type: "status", message: "Generando mockups de papelería..." });
    var mockFrames = createMockups(page, X_MOCK1, 0, fonts, accent, frame);

    // ════════════════════════════════════════════════════════════════
    // 10. MOCKUPS 2 — Señalética, Digital y Packaging (Items 18-28) → X:4689
    // ════════════════════════════════════════════════════════════════

    figma.ui.postMessage({ type: "status", message: "Generando mockups de señalética, digital y packaging..." });
    var mockFrames2 = createMockups2(page, X_MOCK2, 0, fonts, accent, frame);

    // ════════════════════════════════════════════════════════════════
    // 10b. MOCKUPS 3 — Material de Oficina (Items 10-17) → X:6208
    // ════════════════════════════════════════════════════════════════

    figma.ui.postMessage({ type: "status", message: "Generando mockups de material de oficina..." });
    var mockFrames3 = createMockups3(page, X_MOCK3, 0, fonts, accent, frame);

    // ════════════════════════════════════════════════════════════════
    // 11. DESIGN SYSTEM — 35 Componentes → X:1624
    // ════════════════════════════════════════════════════════════════

    figma.ui.postMessage({ type: "status", message: "Generando Design System..." });
    var dsFrames = createDesignSystem(page, X_DS, 0, fonts, accent);

    // ── Done ───────────────────────────────────────────────────────

    var pageCount = "Portada, Índice, Logotipo, Variantes, Tipografía, Paleta de colores, Grilla de construcción, Redes sociales, Mockups (28 items), Design System (35 componentes)";
    figma.notify("✓ Manual de marca + Design System creado: " + pageCount, { timeout: 8000 });

    // FIX 3: pasar el array de SceneNodes reales, no un objeto con coordenadas
    figma.viewport.scrollAndZoomIntoView(createdFrames);

    // Informar a la UI que todo terminó correctamente
    figma.ui.postMessage({ type: "done", message: "Manual generado con éxito" });

  } catch (e) {
    var errMsg = "ERROR: " + e.message;
    figma.notify(errMsg, { timeout: 15000 });
    // FIX 1: enviar el error a la UI para mostrarlo en el status
    figma.ui.postMessage({ type: "error", message: errMsg });
  }
}
