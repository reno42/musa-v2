# Figma Plugin API — Reference Cheat Sheet

## 🏗️ Arquitectura del Plugin

```
┌─────────────────────────────────────────────────┐
│  Figma Editor (Main Thread)                     │
│                                                 │
│  code.js  ←→  figma global object               │
│     │                                           │
│     │  figma.showUI(__html__)                   │
│     │  figma.ui.postMessage(msg)                │
│     │  figma.ui.on("message", cb)               │
│     ▼                                           │
│  ┌───────────────────────┐                      │
│  │  <iframe> (ui.html)   │                      │
│  │  HTML + CSS + JS      │                      │
│  │  postMessage → code.js│                      │
│  │  onmessage ← code.js  │                      │
│  └───────────────────────┘                      │
└─────────────────────────────────────────────────┘
```

## 📦 manifest.json — Todos los campos

```json
{
  "name": "string",           // Nombre en el menú
  "id": "string",             // ID del plugin (de Figma)
  "api": "1.0.0",             // Versión de API
  "main": "code.js",          // Archivo principal JS
  "ui": "ui.html",            // Archivo(s) HTML del iframe
  "editorType": ["figma"],    // "figma" | "figjam" | "dev" | "slides" | "buzz"
  "documentAccess": "dynamic-page",  // REQUERIDO para plugins nuevos
  "networkAccess": {
    "allowedDomains": ["none"],  // ["none"] | ["*"] | dominios específicos
    "reasoning": "string",      // Requerido si allowedDomains=["*"]
    "devAllowedDomains": []     // Dominios solo para desarrollo
  },
  "parameters": [],           // Parámetros de entrada (quick actions)
  "parameterOnly": false,     // Solo ejecutar con parámetros
  "relaunchButtons": [        // Botones de relanzar en el panel de props
    { "command": "edit", "name": "Edit" }
  ],
  "menu": [],                 // Submenú con múltiples comandos
  "enablePrivatePluginApi": false,  // Para acceder a fileKey
  "capabilities": ["textreview"],   // Capacidades especiales
  "permissions": ["currentuser", "payments"]  // Permisos adicionales
}
```

## 🌐 Objetos globales

| Objeto | Descripción |
|--------|-------------|
| `figma` | Objeto principal — acceso a todo el API |
| `__html__` | Contenido del archivo `ui` del manifest como string |
| `__uiFiles__` | Mapa de archivos UI cuando `ui` es un objeto |
| `fetch()` | Fetch de red (con restricciones de `networkAccess`) |

## 🔑 figma — Propiedades principales

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `figma.apiVersion` | `'1.0.0'` | Versión de API del manifest |
| `figma.command` | `string` | Comando actual ejecutado |
| `figma.pluginId` | `string?` | ID del plugin del manifest |
| `figma.editorType` | `string` | `'figma'` \| `'figjam'` \| `'dev'` \| `'slides'` \| `'buzz'` |
| `figma.mode` | `string` | `'default'` \| `'textreview'` \| `'inspect'` \| `'codegen'` \| `'linkpreview'` \| `'auth'` |
| `figma.currentPage` | `PageNode` | Página actual (read-only si `dynamic-page`) |
| `figma.root` | `DocumentNode` | Raíz del documento |
| `figma.viewport` | `ViewportAPI` | Control del viewport |
| `figma.ui` | `UIAPI` | Comunicación con iframe |
| `figma.clientStorage` | `ClientStorageAPI` | Almacenamiento local del usuario |
| `figma.variables` | `VariablesAPI` | Variables y colecciones |
| `figma.teamLibrary` | `TeamLibraryAPI` | Assets del team library |
| `figma.annotations` | `AnnotationsAPI` | Anotaciones |
| `figma.currentUser` | `User \| null` | Usuario actual (requiere permission) |

## 🔧 figma — Métodos

### Crear nodos
```js
figma.createFrame()         // FrameNode
figma.createRectangle()     // RectangleNode
figma.createEllipse()       // EllipseNode
figma.createText()          // TextNode
figma.createVector()        // VectorNode
figma.createLine()          // LineNode
figma.createStar()          // StarNode
figma.createPolygon()       // PolygonNode
figma.createComponent()     // ComponentNode
figma.createComponentSet()  // ComponentSetNode
figma.createPage()          // PageNode
figma.createSection()       // SectionNode
figma.createSlice()         // SliceNode
figma.createGroup()         // GroupNode
figma.createBooleanOperation()  // BooleanOperationNode
```

### Estilos locales
```js
figma.createPaintStyle()      // PaintStyle
figma.createTextStyle()       // TextStyle
figma.createEffectStyle()     // EffectStyle
figma.createGridStyle()       // GridStyle
figma.getLocalPaintStyles()   // PaintStyle[]
figma.getLocalTextStyles()    // TextStyle[]
figma.getLocalEffectStyles()  // EffectStyle[]
figma.getLocalGridStyles()    // GridStyle[]
```

### Fuentes
```js
await figma.loadFontAsync({ family: "Inter", style: "Regular" })
await figma.listAvailableFontsAsync()
```

### Variables
```js
figma.variables.getLocalVariableCollections()
figma.variables.getLocalVariables()
figma.variables.createVariable(name, collectionId, resolvedType)
figma.variables.getVariableById(id)
figma.variables.getVariableCollectionById(id)
```

### Import/Export
```js
await figma.importComponentByKeyAsync(key)
await figma.importVariableByKeyAsync(key)
await figma.importStyleByKeyAsync(key)
```

### UI & Comunicación
```js
figma.showUI(__html__, { width: 380, height: 360 })
figma.ui.postMessage({ type: "status", message: "..." })
figma.ui.on("message", (msg) => { ... })
figma.ui.resize(width, height)
figma.ui.close()
figma.ui.show()
figma.ui.hide()
```

### Utilidades
```js
figma.notify(message, { error: false, timeout: 5000 })
figma.notify(message, { error: true, timeout: 15000 })  // Error
figma.closePlugin(message?)
figma.viewport.scrollAndZoomIntoView(nodes[])
await figma.loadAllPagesAsync()  // Carga todas las páginas
figma.currentPage = pageNode     // Cambiar página (si no es dynamic-page)
await figma.setCurrentPageAsync(page)  // Cambiar página (dynamic-page)
```

### Eventos
```js
figma.on("selectionchange", () => { ... })
figma.on("currentpagechange", () => { ... })
figma.on("documentchange", (event) => { ... })
figma.on("run", (event) => { ... })
figma.on("close", () => { ... })
figma.on("drop", (event) => { ... })
```

## 📐 Node Types — Jerarquía

```
DocumentNode
 └── PageNode (uno o más)
      └── SceneNode (cualquier capa)
           ├── FrameNode (contenedor, soporta children + auto layout)
           ├── GroupNode (agrupa capas)
           ├── ComponentNode (componente principal)
           ├── ComponentSetNode (variants)
           ├── InstanceNode (instancia de componente)
           ├── SectionNode (sección)
           ├── TextNode (texto)
           ├── RectangleNode / EllipseNode / PolygonNode / StarNode
           ├── VectorNode / LineNode / BooleanOperationNode
           └── ...otros
```

## 🎨 Node Properties — Mixins

### ChildrenMixin (Frame, Group, Component, ComponentSet, Section, Page)
```js
node.children          // ReadonlyArray<BaseNode>
node.appendChild(child)
node.insertChild(index, child)
node.findChildren(callback)
node.findOne(callback)
node.findAll(callback)
node.findAllWithCriteria(criteria)  // { types: [...] }
```

### LayoutMixin (Frame, Group, Text, etc.)
```js
node.x, node.y
node.width, node.height
node.resize(w, h)
node.resizeWithoutConstraints(w, h)
node.rotation  // grados
node.relativeTransform  // [[a,b,x],[c,d,y]]
```

### GeometryMixin
```js
node.fills              // Paint[] | PluginAPI.mixed
node.strokes            // Paint[]
node.strokeWeight       // number
node.strokeAlign        // 'INSIDE' | 'OUTSIDE' | 'CENTER'
node.dashPattern        // number[]
node.fillStyleId        // string
node.strokeStyleId      // string
```

### AutoLayoutMixin (Frame, Component, ComponentSet, Instance)
```js
node.layoutMode             // 'NONE' | 'HORIZONTAL' | 'VERTICAL'
node.primaryAxisSizingMode  // 'FIXED' | 'AUTO'
node.counterAxisSizingMode  // 'FIXED' | 'AUTO'
node.primaryAxisAlignItems  // 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
node.counterAxisAlignItems  // 'MIN' | 'CENTER' | 'MAX'
node.paddingTop/Bottom/Left/Right  // number
node.itemSpacing            // number
```

### TextMixin (TextNode)
```js
node.characters         // string (getter/setter)
node.fontName           // FontName | PluginAPI.mixed
node.fontSize           // number | PluginAPI.mixed
node.lineHeight         // LineHeight | PluginAPI.mixed
node.letterSpacing      // LetterSpacing | PluginAPI.mixed
node.textAlignHorizontal // 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
node.textAlignVertical   // 'TOP' | 'CENTER' | 'BOTTOM'
node.textAutoResize     // 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT'
node.setRangeFontName(start, end, fontName)
node.setRangeFontSize(start, end, size)
```

## 🎨 Paint (Fill/Stroke) Types

```js
// Solid
{ type: "SOLID", color: { r, g, b }, opacity: 1, visible: true }

// Gradient linear
{ type: "GRADIENT_LINEAR", gradientStops: [
    { color: { r, g, b, a }, position: 0 },
    { color: { r, g, b, a }, position: 1 }
], gradientTransform: [[a,b,c],[d,e,f]] }

// Image
{ type: "IMAGE", imageHash: "string", scaleMode: "FILL" | "FIT" | "CROP" | "TILE", opacity: 1 }
```

## ⚠️ Errores comunes y soluciones

### 1. `__html__ is not definido`
```js
// ❌ Mal
figma.showUI("<html>...</html>")

// ✅ Bien — usar archivo separado
figma.showUI(__html__, { width: 380, height: 360 })
```

### 2. `loadFontAsync` puede colgar
```js
// ✅ Usar timeout
async function loadFontSafe(font) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 3000)
  );
  return Promise.race([figma.loadFontAsync(font), timeout]);
}
```

### 3. `scrollAndZoomIntoView` requiere SceneNode[]
```js
// ❌ Mal — pasa coordenadas
figma.viewport.scrollAndZoomIntoView({ x: 0, y: 0, width: 100, height: 100 })

// ✅ Bien — pasa nodos reales
figma.viewport.scrollAndZoomIntoView([frame1, frame2])
```

### 4. Enum values inválidos
```js
// ✅ Valores válidos
layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
primaryAxisSizingMode: 'FIXED' | 'AUTO'
counterAxisSizingMode: 'FIXED' | 'AUTO'
primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX'
textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'
textAutoResize: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT'
strokeAlign: 'INSIDE' | 'OUTSIDE' | 'CENTER'
```

### 5. dynamic-page — `figma.currentPage` es read-only
```js
// ❌ Mal con dynamic-page
figma.currentPage = otherPage

// ✅ Bien
await figma.setCurrentPageAsync(otherPage)
```

### 6. Propiedades que requieren permissions
```js
// Solo si "permissions": ["currentuser"] en manifest
figma.currentUser  // null sin permiso

// Solo si "enablePrivatePluginApi": true
figma.fileKey
```

## 🧪 Test Harness — Patrón

```js
// Mock básico de figma para testing sin Figma
const figma = {
  currentPage: mockPage,
  root: { children: [mockPage] },
  showUI: (html, opts) => { /* mock */ },
  ui: {
    postMessage: (msg) => { /* mock */ },
    on: (event, cb) => { /* mock */ }
  },
  on: (event, cb) => { /* mock */ },
  loadFontAsync: async (font) => { /* mock */ },
  createFrame: () => mockFrame(),
  createText: () => mockText(),
  createRectangle: () => mockRectangle(),
  notify: (msg, opts) => { /* mock */ },
  viewport: {
    scrollAndZoomIntoView: (nodes) => { /* mock */ }
  }
};
```

## 📚 Recursos

- **API Reference:** https://developers.figma.com/docs/plugins/api/api-reference/
- **Manifest:** https://developers.figma.com/docs/plugins/manifest/
- **Node Types:** https://developers.figma.com/docs/plugins/api/nodes/
- **Quickstart:** https://developers.figma.com/docs/plugins/plugin-quickstart-guide/
- **Typings:** `npm install --save-dev @figma/plugin-typings`
- **ESLint Rules:** `npm install --save-dev @figma/eslint-plugin-figma-plugins`
- **Discord Dev Community:** https://discord.gg/xzQhe2Vcvx
