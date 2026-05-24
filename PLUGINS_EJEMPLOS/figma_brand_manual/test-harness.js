// ═══════════════════════════════════════════════════════════════════════
// Enhanced Figma Plugin Test Harness v2
// Validates: enum values, paint types, font loads, node creation,
// UI messages, selection flow, error handling, and full main() execution
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const vm = require('vm');

// ─── Enum validation ─────────────────────────────────────────────────

const VALID_ENUMS = {
  layoutMode: ['NONE', 'HORIZONTAL', 'VERTICAL'],
  primaryAxisSizingMode: ['FIXED', 'AUTO'],
  counterAxisSizingMode: ['FIXED', 'AUTO'],
  primaryAxisAlignItems: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'],
  counterAxisAlignItems: ['MIN', 'CENTER', 'MAX'],
  textAlignHorizontal: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'],
  textAlignVertical: ['TOP', 'CENTER', 'BOTTOM'],
  textAutoResize: ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT'],
  strokeAlign: ['INSIDE', 'OUTSIDE', 'CENTER'],
};

const VALID_PAINT_TYPES = ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'EMOJI', 'VIDEO'];

// ─── Tracking ────────────────────────────────────────────────────────

let nodeCount = 0;
let errors = [];
let warnings = [];
let fontsLoaded = [];
let notifications = [];
let uiMessages = [];
let createdNodes = [];

function track(label, data) {
  createdNodes.push({ id: nodeCount, label, ...data });
}

// ─── Validation helpers ──────────────────────────────────────────────

function validateEnum(prop, value) {
  if (VALID_ENUMS[prop] && !VALID_ENUMS[prop].includes(value)) {
    const err = `INVALID ENUM: ${prop} = "${value}". Valid: ${VALID_ENUMS[prop].join(', ')}`;
    errors.push(err);
    console.log(`  ✗ ${err}`);
  }
}

function validatePaint(paint) {
  if (!paint || !paint.type) return;
  if (!VALID_PAINT_TYPES.includes(paint.type)) {
    errors.push(`INVALID PAINT TYPE: "${paint.type}". Valid: ${VALID_PAINT_TYPES.join(', ')}`);
  }
  if (paint.type === 'SOLID') {
    if (!paint.color) { errors.push('SOLID paint missing color'); return; }
    ['r', 'g', 'b'].forEach(c => {
      if (typeof paint.color[c] !== 'number' || paint.color[c] < 0 || paint.color[c] > 1) {
        errors.push(`Invalid SOLID color: ${c}=${paint.color[c]} (must be 0-1)`);
      }
    });
  }
  if (paint.type && paint.type.startsWith('GRADIENT')) {
    if (!paint.gradientStops || !Array.isArray(paint.gradientStops)) {
      errors.push('Gradient paint missing gradientStops');
    }
  }
}

function validatePaints(label, paints) {
  if (!Array.isArray(paints)) return;
  paints.forEach((p, i) => {
    const original = errors.length;
    validatePaint(p);
    if (errors.length > original) {
      errors[errors.length - 1] += ` (on ${label}, index ${i})`;
    }
  });
}

// ─── Mock node factory ───────────────────────────────────────────────

function mockNode(type, name) {
  const id = ++nodeCount;
  const children = [];
  const store = {
    _fills: [], _strokes: [], _effects: [],
    _layoutMode: 'NONE',
    _primaryAxisSizingMode: 'FIXED',
    _counterAxisSizingMode: 'FIXED',
    _primaryAxisAlignItems: 'MIN',
    _counterAxisAlignItems: 'MIN',
    _textAlignHorizontal: 'LEFT',
    _textAlignVertical: 'TOP',
    _textAutoResize: 'NONE',
    _strokeAlign: 'INSIDE',
  };

  const node = {
    id, type, name: name || type, children,
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0,
    cornerRadius: 0, fontSize: 16,
    characters: '', dashPattern: [],
    lineHeight: null, letterSpacing: null,
    strokeWeight: 0, strokeBottomWeight: 0, strokeTopWeight: 0,
    strokeLeftWeight: 0, strokeRightWeight: 0,
    opacity: 1, visible: true,
    paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
    itemSpacing: 0,
    fontName: { family: 'Inter', style: 'Regular' },
  };

  // Enum-validated properties
  for (const prop of Object.keys(VALID_ENUMS)) {
    Object.defineProperty(node, prop, {
      get() { return store['_' + prop]; },
      set(v) {
        validateEnum(prop, v);
        store['_' + prop] = v;
      },
      enumerable: true,
    });
  }

  // Paint properties with validation
  ['fills', 'strokes', 'effects'].forEach(prop => {
    const key = '_' + prop;
    Object.defineProperty(node, prop, {
      get() { return store[key]; },
      set(v) {
        if (prop !== 'effects') validatePaints(`${name || type}.${prop}`, v);
        store[key] = v;
      },
      enumerable: true,
    });
  });

  // Methods
  node.appendChild = function(child) {
    child.parent = node;
    children.push(child);
  };
  node.insertChild = function(index, child) {
    child.parent = node;
    children.splice(index, 0, child);
  };
  node.clone = function() {
    const c = mockNode(type, name + ' (clone)');
    c.width = node.width;
    c.height = node.height;
    c._fills = JSON.parse(JSON.stringify(store._fills));
    c._strokes = JSON.parse(JSON.stringify(store._strokes));
    c.fontName = node.fontName ? { ...node.fontName } : null;
    c.fontSize = node.fontSize;
    c.characters = node.characters;
    return c;
  };
  node.resize = function(w, h) {
    if (typeof w !== 'number' || typeof h !== 'number' || w < 0 || h < 0) {
      errors.push(`Invalid resize: ${w}x${h} on ${name || type}`);
    }
    node.width = w;
    node.height = h;
  };
  node.remove = function() {};
  node.findAll = function(cb) {
    const results = [];
    (function walk(n) {
      if (cb(n)) results.push(n);
      if (n.children) n.children.forEach(walk);
    })(node);
    return results;
  };
  node.findOne = function(cb) {
    return node.findAll(cb)[0] || null;
  };
  node.findChildren = function(cb) {
    return children.filter(cb);
  };
  node.findAllWithCriteria = function(criteria) {
    return node.findAll(n => criteria.types.includes(n.type));
  };

  track(name || type, { type });
  return node;
}

// ─── Node type factories ─────────────────────────────────────────────

function mockFrame(name) {
  return mockNode('FRAME', name);
}
function mockText(name) {
  const n = mockNode('TEXT', name);
  n.textAutoResize = 'NONE';
  return n;
}
function mockRectangle(name) {
  return mockNode('RECTANGLE', name);
}
function mockPage(name) {
  return mockNode('PAGE', name);
}

// ─── Mock document structure ─────────────────────────────────────────

const selectedFrame = mockFrame('Test Logo');
selectedFrame.width = 200;
selectedFrame.height = 100;
selectedFrame._fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8 }, visible: true }];

const childText = mockText('Brand');
childText.fontName = { family: 'Montserrat', style: 'Bold' };
childText.fontSize = 48;
childText._fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, visible: true }];
selectedFrame.appendChild(childText);

const childRect = mockRectangle('Icon');
childRect._fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.1 }, visible: true }];
childRect.width = 50;
childRect.height = 50;
selectedFrame.appendChild(childRect);

const childFrame = mockFrame('Sub Frame');
childFrame._fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.6, b: 0.3 }, visible: true }];
childFrame.width = 80;
childFrame.height = 40;
selectedFrame.appendChild(childFrame);

const mockPageNode = mockPage('Page 1');
mockPageNode.selection = [selectedFrame];
mockPageNode.appendChild(selectedFrame);

// ─── Mock figma global ───────────────────────────────────────────────

const fontsLoadedInfo = [];
const figma = {
  currentPage: mockPageNode,
  root: { children: [mockPageNode] },
  editorType: 'figma',
  apiVersion: '1.0.0',
  pluginId: 'brand-manual-generator',
  command: undefined,

  viewport: {
    scrollAndZoomIntoView: function(nodes) {
      if (Array.isArray(nodes)) {
        console.log(`  ✓ viewport.scrollAndZoomIntoView([${nodes.length} nodes])`);
      } else {
        console.log(`  ✓ viewport.scrollAndZoomIntoView(...)`);
      }
    },
  },

  showUI: function(html, opts) {
    console.log(`  ✓ showUI(width=${opts && opts.width}, height=${opts && opts.height})`);
    figma.ui = createUIAPI();
  },

  on: function(event, cb) {
    console.log(`  ✓ on("${event}")`);
  },
  once: function(event, cb) {
    console.log(`  ✓ once("${event}")`);
  },
  off: function(event, cb) {
    console.log(`  ✓ off("${event}")`);
  },

  loadFontAsync: async function(font) {
    fontsLoadedInfo.push(`${font.family} ${font.style}`);
    console.log(`  ✓ loadFontAsync("${font.family}", "${font.style}")`);
  },
  listAvailableFontsAsync: async function() {
    return [{ family: 'Inter', style: 'Regular' }, { family: 'Inter', style: 'Bold' }];
  },

  notify: function(msg, opts) {
    notifications.push({ msg, opts });
    const prefix = (opts && opts.error) ? '  ✗' : '  ✓';
    console.log(`${prefix} notify: ${msg.substring(0, 120)}`);
  },

  createFrame: () => mockFrame(),
  createText: () => mockText(),
  createRectangle: () => mockRectangle(),
  createEllipse: () => mockNode('ELLIPSE'),
  createLine: () => mockNode('LINE'),
  createVector: () => mockNode('VECTOR'),
  createGroup: () => mockNode('GROUP'),
  createComponent: () => mockNode('COMPONENT'),
  createPage: () => mockPage(),
  createSection: () => mockNode('SECTION'),
  createSlice: () => mockNode('SLICE'),

  closePlugin: function(msg) {
    console.log(`  ✓ closePlugin("${msg || ''}")`);
  },

  clientStorage: {
    getAsync: async function(key) { return null; },
    setAsync: async function(key, value) {},
    deleteAsync: async function(key) {},
    keysAsync: async function() { return []; },
  },
};

function createUIAPI() {
  return {
    postMessage: function(msg) {
      uiMessages.push(msg);
      if (msg.type === 'status') console.log(`  → UI status: ${msg.message}`);
      else if (msg.type === 'done') console.log(`  → UI done: ${msg.message}`);
      else if (msg.type === 'error') console.log(`  → UI error: ${msg.message}`);
      else if (msg.type === 'selection') console.log(`  → UI selection: ${msg.name || 'none'}`);
      else console.log(`  → UI [${msg.type}]: ${JSON.stringify(msg).substring(0, 80)}`);
    },
    on: function(event, cb) {
      console.log(`  ✓ ui.on("${event}")`);
    },
    once: function(event, cb) {
      console.log(`  ✓ ui.once("${event}")`);
    },
    off: function(event, cb) {
      console.log(`  ✓ ui.off("${event}")`);
    },
    resize: function(w, h) {
      console.log(`  ✓ ui.resize(${w}, ${h})`);
    },
    close: function() {
      console.log(`  ✓ ui.close()`);
    },
    show: function() { console.log(`  ✓ ui.show()`); },
    hide: function() { console.log(`  ✓ ui.hide()`); },
  };
}

// ─── Globals ─────────────────────────────────────────────────────────

const __html__ = '<html><body>mock</body></html>';

// ─── Execute plugin ──────────────────────────────────────────────────

const codeFile = process.argv[2] || './code.js';
if (!fs.existsSync(codeFile)) {
  console.error(`File not found: ${codeFile}`);
  process.exit(1);
}

const code = fs.readFileSync(codeFile, 'utf8');

const context = { figma, console, __html__, setTimeout, Promise, Date, Math, Array, Object, JSON, Error };
vm.createContext(context);

console.log('═══════════════════════════════════════════════════════════');
console.log('  Figma Plugin Test Harness v2');
console.log(`  File: ${codeFile}`);
console.log('═══════════════════════════════════════════════════════════\n');

async function run() {
  const startTime = Date.now();

  try {
    const script = new vm.Script(code, { filename: codeFile });
    const result = script.runInContext(context);

    if (result && typeof result.then === 'function') {
      await result;
    }

    // Execute main() if available
    if (typeof context.main === 'function') {
      console.log('\n  ── Calling main() ──────────────────────────────────\n');
      await context.main();
    }

    await new Promise(r => setTimeout(r, 500));

  } catch (e) {
    errors.push(`CRASH: ${e.message}`);
    console.log(`\n  ✗✗✗ CRASH: ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(0, 8).join('\n'));
  }

  const elapsed = Date.now() - startTime;

  // ── Report ────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Time:       ${elapsed}ms`);
  console.log(`  Nodes:      ${nodeCount}`);
  console.log(`  Fonts:      ${fontsLoadedInfo.length} (${fontsLoadedInfo.join(', ') || 'none'})`);
  console.log(`  UI msgs:    ${uiMessages.length}`);
  console.log(`  Notifs:     ${notifications.length}`);
  console.log(`  Warnings:   ${warnings.length}`);
  console.log(`  Errors:     ${errors.length}`);

  if (warnings.length > 0) {
    console.log('\n  WARNINGS:');
    warnings.forEach(w => console.log(`    ⚠ ${w}`));
  }

  if (errors.length > 0) {
    console.log('\n  ERRORS:');
    errors.forEach(e => console.log(`    ✗ ${e}`));

    // ── Error summary by category ───────────────────────────────────
    const categories = {};
    errors.forEach(e => {
      const cat = e.split(':')[0].trim();
      categories[cat] = (categories[cat] || 0) + 1;
    });
    console.log('\n  ERROR SUMMARY:');
    Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
      console.log(`    ${cat}: ${count}`);
    });

    process.exit(1);
  } else {
    console.log('\n  ✓ All tests passed — no API errors detected');
    process.exit(0);
  }
}

run();
