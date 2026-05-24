// ═══════════════════════════════════════════════════════════════════════
// Figma Debug Helper — Drop into any plugin for instant debugging
// Usage: paste at top of code.js, remove when done
// ═══════════════════════════════════════════════════════════════════════

const DEBUG = true;

function debugLog(...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substr(11, 12);
  console.log(`[${ts}]`, ...args);
}

function debugNode(node, depth = 0) {
  if (!DEBUG) return;
  const indent = '  '.repeat(depth);
  const props = [];
  if (node.width && node.height) props.push(`${Math.round(node.width)}×${Math.round(node.height)}`);
  if (node.x !== undefined && node.y !== undefined) props.push(`(${Math.round(node.x)},${Math.round(node.y)})`);
  if (node.fontName && typeof node.fontName === 'object') props.push(`${node.fontName.family} ${node.fontName.style}`);
  if (node.fontSize) props.push(`${node.fontSize}px`);
  if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
    const f = node.fills[0];
    if (f.type === 'SOLID' && f.color) {
      props.push(`rgb(${Math.round(f.color.r*255)},${Math.round(f.color.g*255)},${Math.round(f.color.b*255)})`);
    }
  }
  console.log(`${indent}[${node.type}] ${node.name} ${props.join(' | ')}`);
  if (node.children && typeof node.children[Symbol.iterator] === 'function') {
    for (const child of node.children) {
      debugNode(child, depth + 1);
    }
  }
}

function debugSelection() {
  if (!DEBUG) return;
  const sel = figma.currentPage.selection;
  console.log(`\n--- Selection (${sel.length}) ---`);
  sel.forEach(n => debugNode(n));
  console.log('---\n');
}

function debugTimer(label) {
  if (!DEBUG) return { end: () => {} };
  const start = Date.now();
  return {
    end: () => {
      const elapsed = Date.now() - start;
      debugLog(`⏱ ${label}: ${elapsed}ms`);
    }
  };
}

function debugPaint(paint) {
  if (!DEBUG || !paint) return 'null';
  if (paint.type === 'SOLID' && paint.color) {
    return `SOLID rgb(${Math.round(paint.color.r*255)},${Math.round(paint.color.g*255)},${Math.round(paint.color.b*255)})`;
  }
  return paint.type;
}

function debugValidate(node) {
  const issues = [];

  // Check layoutMode
  if (node.layoutMode && !['NONE', 'HORIZONTAL', 'VERTICAL'].includes(node.layoutMode)) {
    issues.push(`Invalid layoutMode: ${node.layoutMode}`);
  }

  // Check sizing modes
  if (node.primaryAxisSizingMode && !['FIXED', 'AUTO'].includes(node.primaryAxisSizingMode)) {
    issues.push(`Invalid primaryAxisSizingMode: ${node.primaryAxisSizingMode}`);
  }

  // Check fills
  if (node.fills && Array.isArray(node.fills)) {
    node.fills.forEach((f, i) => {
      if (!f.type) issues.push(`Fill[${i}] missing type`);
      if (f.type === 'SOLID' && f.color) {
        ['r', 'g', 'b'].forEach(c => {
          if (typeof f.color[c] !== 'number' || f.color[c] < 0 || f.color[c] > 1) {
            issues.push(`Fill[${i}].color.${c} out of range: ${f.color[c]}`);
          }
        });
      }
    });
  }

  // Check font
  if (node.type === 'TEXT' && node.fontName) {
    if (typeof node.fontName === 'object' && (!node.fontName.family || !node.fontName.style)) {
      issues.push('TextNode fontName missing family or style');
    }
  }

  // Recursively check children
  if (node.children) {
    for (const child of node.children) {
      issues.push(...debugValidate(child).map(i => `${node.name} > ${i}`));
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: Color conversion
// ═══════════════════════════════════════════════════════════════════════

function colorToHex(r, g, b) {
  const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function colorToRgb(r, g, b) {
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function colorToCmyk(r, g, b) {
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.99) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100)
  };
}

function colorDistance(a, b) {
  return Math.sqrt(Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2));
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: Font loading with timeout
// ═══════════════════════════════════════════════════════════════════════

async function loadFontSafe(font, timeoutMs = 3000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Font timeout: ${font.family} ${font.style}`)), timeoutMs)
  );
  return Promise.race([figma.loadFontAsync(font), timeout]);
}

async function loadFontsSafe(fonts) {
  const loaded = [];
  for (const font of fonts) {
    try {
      await loadFontSafe(font);
      loaded.push(font);
    } catch (e) {
      debugLog(`⚠ Font skipped: ${font.family} ${font.style} — ${e.message}`);
    }
  }
  return loaded;
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: Node tree traversal
// ═══════════════════════════════════════════════════════════════════════

function walkTree(node, callback, depth = 0) {
  callback(node, depth);
  if ('children' in node) {
    for (const child of node.children) {
      walkTree(child, callback, depth + 1);
    }
  }
}

function findByType(node, type) {
  const results = [];
  walkTree(node, n => { if (n.type === type) results.push(n); });
  return results;
}

function findByPredicate(node, predicate) {
  const results = [];
  walkTree(node, n => { if (predicate(n)) results.push(n); });
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: Safe frame builder
// ═══════════════════════════════════════════════════════════════════════

function safeCreateFrame(config = {}) {
  const f = figma.createFrame();
  f.name = config.name || 'Frame';

  if (config.width && config.height) f.resize(config.width, config.height);
  if (config.fills) f.fills = config.fills;
  if (config.layoutMode) f.layoutMode = config.layoutMode;
  if (config.primaryAxisAlignItems) f.primaryAxisAlignItems = config.primaryAxisAlignItems;
  if (config.counterAxisAlignItems) f.counterAxisAlignItems = config.counterAxisAlignItems;
  if (config.primaryAxisSizingMode) f.primaryAxisSizingMode = config.primaryAxisSizingMode;
  if (config.counterAxisSizingMode) f.counterAxisSizingMode = config.counterAxisSizingMode;
  if (config.itemSpacing !== undefined) f.itemSpacing = config.itemSpacing;
  if (config.paddingTop !== undefined) f.paddingTop = config.paddingTop;
  if (config.paddingBottom !== undefined) f.paddingBottom = config.paddingBottom;
  if (config.paddingLeft !== undefined) f.paddingLeft = config.paddingLeft;
  if (config.paddingRight !== undefined) f.paddingRight = config.paddingRight;
  if (config.cornerRadius !== undefined) f.cornerRadius = config.cornerRadius;
  if (config.x !== undefined) f.x = config.x;
  if (config.y !== undefined) f.y = config.y;
  if (config.strokes) f.strokes = config.strokes;
  if (config.strokeWeight !== undefined) f.strokeWeight = config.strokeWeight;
  if (config.dashPattern) f.dashPattern = config.dashPattern;

  return f;
}

async function safeCreateText(content, font, config = {}) {
  const t = figma.createText();
  t.characters = content;
  t.fontName = font;
  if (config.fontSize) t.fontSize = config.fontSize;
  if (config.fills) t.fills = config.fills;
  if (config.textAlignHorizontal) t.textAlignHorizontal = config.textAlignHorizontal;
  if (config.lineHeight) t.lineHeight = config.lineHeight;
  if (config.letterSpacing) t.letterSpacing = config.letterSpacing;
  if (config.textAutoResize) t.textAutoResize = config.textAutoResize;
  if (config.width) {
    t.resize(config.width, 10);
    t.textAutoResize = 'HEIGHT';
  }
  return t;
}

// ═══════════════════════════════════════════════════════════════════════
// Exports (for test harness use)
// ═══════════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined') {
  module.exports = {
    debugLog, debugNode, debugSelection, debugTimer,
    debugPaint, debugValidate,
    colorToHex, colorToRgb, colorToCmyk, colorDistance,
    loadFontSafe, loadFontsSafe,
    walkTree, findByType, findByPredicate,
    safeCreateFrame, safeCreateText,
  };
}
