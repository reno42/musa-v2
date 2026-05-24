// Test harness — simula la API de Figma para detectar errores
// Ejecutar: node test-figma.js

const fs = require('fs');
const vm = require('vm');

// ─── Validaciones de enum ────────────────────────────────────────────

const VALID = {
  primaryAxisSizingMode: ['FIXED', 'AUTO'],
  counterAxisSizingMode: ['FIXED', 'AUTO'],
  primaryAxisAlignItems: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'],
  counterAxisAlignItems: ['MIN', 'CENTER', 'MAX'],
  layoutMode: ['NONE', 'HORIZONTAL', 'VERTICAL'],
  textAlignHorizontal: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'],
  textAlignVertical: ['TOP', 'CENTER', 'BOTTOM'],
  textAutoResize: ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT'],
  unit: ['PIXELS', 'PERCENT'],
};

function validateEnum(obj, prop, value) {
  if (VALID[prop] && !VALID[prop].includes(value)) {
    throw new Error(`INVALID ENUM: ${prop} = "${value}". Valid: ${VALID[prop].join(', ')}`);
  }
  obj['_' + prop] = value;
}

// ─── Mock Node base ──────────────────────────────────────────────────

let nodeCount = 0;
let errors = [];

function mockNode(type, name) {
  const id = ++nodeCount;
  const children = [];
  const node = {
    id, type, name: name || type, children,
    _fills: [], _strokes: [], _effects: [],
    _layoutMode: 'NONE',
    _primaryAxisSizingMode: 'FIXED',
    _counterAxisSizingMode: 'FIXED',
    _primaryAxisAlignItems: 'MIN',
    _counterAxisAlignItems: 'MIN',
    x: 0, y: 0, width: 100, height: 100,
    cornerRadius: 0, fontSize: 16,
    characters: '',
    dashPattern: [],
    lineHeight: null,
    letterSpacing: null,
    strokeWeight: 0,
    strokeBottomWeight: 0, strokeTopWeight: 0,
    strokeLeftWeight: 0, strokeRightWeight: 0,
    opacity: 1, visible: true,
    paddingTop: 0, paddingBottom: 0,
    paddingLeft: 0, paddingRight: 0,
    itemSpacing: 0,
    fontName: { family: 'Inter', style: 'Regular' },
    textAlignHorizontal: 'LEFT',
    textAutoResize: 'NONE',
  };

  // Define enum-validated setters
  for (const prop of Object.keys(VALID)) {
    Object.defineProperty(node, prop, {
      get() { return node['_' + prop]; },
      set(v) { validateEnum(node, prop, v); },
      enumerable: true,
    });
  }

  // fills
  Object.defineProperty(node, 'fills', {
    get() { return node._fills; },
    set(v) { node._fills = v; },
    enumerable: true,
  });
  Object.defineProperty(node, 'strokes', {
    get() { return node._strokes; },
    set(v) { node._strokes = v; },
    enumerable: true,
  });
  Object.defineProperty(node, 'effects', {
    get() { return node._effects; },
    set(v) { node._effects = v; },
    enumerable: true,
  });

  node.appendChild = function(child) { children.push(child); };
  node.clone = function() {
    const c = mockNode(type, name + ' (clone)');
    c.width = node.width;
    c.height = node.height;
    c._fills = JSON.parse(JSON.stringify(node._fills));
    return c;
  };
  node.resize = function(w, h) { node.width = w; node.height = h; };
  node.remove = function() {};

  return node;
}

// ─── Mock frame (adds text-specific props) ───────────────────────────

function mockFrame(name) {
  const node = mockNode('FRAME', name);
  return node;
}

function mockText(name) {
  const node = mockNode('TEXT', name);
  return node;
}

function mockRectangle(name) {
  const node = mockNode('RECTANGLE', name);
  return node;
}

// ─── Mock figma global ───────────────────────────────────────────────

const selectedFrame = mockFrame('Test Logo');
selectedFrame.width = 200;
selectedFrame.height = 100;
selectedFrame._fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8 }, visible: true }];

// Add some child elements to extract data from
const childText = mockText('Brand');
childText.fontName = { family: 'Montserrat', style: 'Bold' };
childText.fontSize = 48;
selectedFrame.appendChild(childText);

const childRect = mockRectangle('Icon');
childRect._fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.1 }, visible: true }];
childRect.width = 50;
childRect.height = 50;
selectedFrame.appendChild(childRect);

const mockPage = mockNode('PAGE', 'Page 1');
mockPage.selection = [selectedFrame];

const fontsLoaded = [];
const notifications = [];

const figma = {
  currentPage: mockPage,
  root: { children: [mockPage] },
  viewport: {
    scrollAndZoomIntoView: function(rect) {
      if (Array.isArray(rect)) {
        console.log(`  ✓ viewport.scrollAndZoomIntoView([${rect.length} nodes])`);
      } else {
        console.log(`  ✓ viewport.scrollAndZoomIntoView({x:${Math.round(rect.x)}, y:${Math.round(rect.y)}, w:${Math.round(rect.width)}, h:${Math.round(rect.height)}})`);
      }
    },
  },
  showUI: function(html, opts) {
    console.log(`  ✓ showUI(width=${opts && opts.width}, height=${opts && opts.height})`);
    figma.ui = {
      postMessage: function(msg) {
        if (msg.type === 'status') console.log(`  → UI status: ${msg.message}`);
        if (msg.type === 'done') console.log(`  → UI done: ${msg.message}`);
        if (msg.type === 'error') console.log(`  → UI error: ${msg.message}`);
        if (msg.type === 'selection') console.log(`  → UI selection: ${msg.name}`);
      },
      on: function(event, cb) {
        console.log(`  ✓ ui.on("${event}")`);
      }
    };
  },
  on: function(event, cb) {
    console.log(`  ✓ on("${event}")`);
  },
  loadFontAsync: async function(font) {
    fontsLoaded.push(`${font.family} ${font.style}`);
    console.log(`  ✓ loadFontAsync("${font.family}", "${font.style}")`);
  },
  notify: function(msg, opts) {
    notifications.push(msg);
    const prefix = msg.startsWith('ERROR') ? '  ✗' : '  ✓';
    console.log(`${prefix} notify: ${msg.substring(0, 120)}`);
  },
  createFrame: function() { return mockFrame(); },
  createText: function() { return mockText(); },
  createRectangle: function() { return mockRectangle(); },
};

// ─── Ejecutar el plugin ──────────────────────────────────────────────

const code = fs.readFileSync('./code.js', 'utf8');

const __html__ = '<html><body>mock</body></html>';
const context = { figma, console, __html__ };
vm.createContext(context);

console.log('═══════════════════════════════════════════════════════════');
console.log('  Figma Plugin Test Harness');
console.log('═══════════════════════════════════════════════════════════\n');

async function run() {
  try {
    const script = new vm.Script(code, { filename: 'code.js' });
    const result = script.runInContext(context);

    // If main() was called and returns a promise, await it
    if (result && typeof result.then === 'function') {
      await result;
    }

    // Actually call main() to test full flow
    if (typeof context.main === 'function') {
      console.log('\n  Calling main()...\n');
      await context.main();
    }

    // Wait a tick for any pending async operations
    await new Promise(r => setTimeout(r, 500));

  } catch (e) {
    errors.push(e.message);
    console.log(`\n  ✗✗✗ CRASH: ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Fonts loaded: ${fontsLoaded.length}`);
  console.log(`  Notifications: ${notifications.length}`);
  console.log(`  Nodes created: ${nodeCount}`);
  console.log(`  Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\n  ERRORS:');
    errors.forEach(e => console.log(`    ✗ ${e}`));
    process.exit(1);
  } else {
    console.log('\n  ✓ All tests passed — no API errors detected');
    process.exit(0);
  }
}

run();
