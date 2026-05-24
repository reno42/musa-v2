# Futuraria Design — AI Agent Skills Guide

> Use this guide when designing, modifying, or generating templates in Futuraria Design via its REST API. Futuraria is a Figma-like collaborative design tool where AI agents can create and manipulate visual designs programmatically — humans refine the output in the browser.

---

## 1. Quick Start

### 1.1 Base URL

```
https://futuraria.netlify.app
```

All endpoints accept both `/api/templates` and `/templates` as path prefixes.

### 1.2 Authentication

Every request needs an `X-API-Key` header. **Bootstrap** the first key when no keys exist:

```bash
# Create your first API key (no auth required if zero active keys)
curl -X POST https://futuraria.netlify.app/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-code-agent"}'

# Response:
{ "success": true, "data": { "id": "key_abc123", "name": "claude-code-agent", "key": "fd_abc123def456...", "key_prefix": "fd_abc", "message": "Copy this key now. It won't be shown again." } }
```

Save the `key` value. Use it in all subsequent requests:

```bash
curl -H "X-API-Key: fd_abc123def456..." \
  https://futuraria.netlify.app/api/templates
```

The frontend stores the key in `localStorage` under `futuraria_api_key`.

---

## 2. Templates API

A **template** is the top-level container — it holds a complete design with pages, frames, and all canvas objects.

### 2.1 Template Object

```typescript
interface Template {
  id: string;              // "tpl_abc12345"
  name: string;            // "Landing Page v3"
  canvas: {
    width: number;         // default 1080
    height: number;        // default 1080
    background: string;    // "#ffffff"
    version: string;       // "6.6.2"
    objects: FabricObject[]; // all layers, frames, shapes, text
  };
  layers: LayerInfo[];     // resolved layer tree
  pages: PageInfo[];       // multi-page support
  frames: FrameInfo[];     // frame/artboard definitions
  styles: StyleDefinition[];
  components: ComponentDefinition[];
  created_at: string;
  updated_at: string;
}
```

### 2.2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates` | List all templates (`?limit=50&offset=0`) |
| `POST` | `/api/templates` | Create template |
| `GET` | `/api/templates/:id` | Get full template (with canvas JSON) |
| `PUT` | `/api/templates/:id` | Full replace template |
| `DELETE` | `/api/templates/:id` | Delete template |
| `POST` | `/api/templates/:id/duplicate` | Clone template with new name |

**Create template:**
```json
POST /api/templates
{
  "name": "Brand Guidelines",
  "width": 1440,
  "height": 1024,
  "canvas": {
    "version": "6.6.2",
    "width": 1440,
    "height": 1024,
    "background": "#ffffff",
    "objects": []
  }
}
```

**Update template** (PUT replaces the entire canvas. Use PATCH layers for targeted edits):
```json
PUT /api/templates/tpl_abc12345
{
  "name": "Brand Guidelines v2",
  "canvas": { "version": "6.6.2", "width": 1440, "height": 1024, "background": "#1a1a2e", "objects": [...] }
}
```

---

## 3. Layers API (Targeted Edits)

Use layers to modify individual objects without resending the entire canvas.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates/:id/layers` | List all layers |
| `GET` | `/api/templates/:id/layers/:name` | Get single layer by name |
| `PATCH` | `/api/templates/:id/layers/:name` | Update layer properties |
| `PATCH` | `/api/templates/:id/layers` | Batch update (`{ "layers": { "bg": {...}, "title": {...} } }`) |

**Update a single layer:**
```json
PATCH /api/templates/tpl_abc/layers/title
{
  "text": "New Headline",
  "fill": "#ff3366",
  "fontSize": 48
}
```

---

## 4. Canvas JSON Format (Fabric.js 6.6.2)

The `canvas.objects` array contains Fabric.js serialized objects.

### 4.1 Standard Fabric Properties

Every object has:
```json
{
  "type": "rect",
  "version": "6.6.2",
  "left": 100,       // x position from origin
  "top": 200,        // y position from origin  
  "width": 300,
  "height": 200,
  "scaleX": 1,
  "scaleY": 1,
  "angle": 0,        // rotation in degrees
  "opacity": 1,      // 0-1
  "fill": "#3b82f6", // hex color, "transparent", or null
  "stroke": "#000000",
  "strokeWidth": 1,
  "visible": true,
  "selectable": true
}
```

### 4.2 Futuraria Custom Properties

These are preserved across save/load and enable Figma-like behavior:

| Property | Type | Description |
|----------|------|-------------|
| `layerId` | string | Unique layer ID (auto-assigned: `n_TIMESTAMP_COUNTER`) |
| `layerName` | string | Display name in layers panel |
| `frameId` | string | Parent frame/artboard ID (null if top-level) |
| `isFrameVisual` | boolean | Marks frame background rect |
| `isFrameBg` | boolean | Frame container background |
| `isFrameLabel` | boolean | Frame title text |
| `isSection` | boolean | Marks as a section (Figma-like) |
| `isSectionBg` | boolean | Section background |
| `isSectionLabel` | boolean | Section title |
| `isSectionIndicator` | boolean | Section visual indicator |
| `sectionId` | string | Parent section ID |
| `sectionColor` | string | Section highlight color |
| `styleId` | string | Linked style ID (e.g., `sty_abc12345`) |
| `componentId` | string | Component definition ID this is an instance of |
| `isComponentInstance` | boolean | True if this object is a component instance |
| `constraints` | object | Auto-layout constraints `{ x: "min"|"max"|"stretch", y: "min"|"max"|"stretch" }` |
| `isClosedPath` | boolean | Whether pencil/tool path forms a closed shape |
| `imageFilters` | array | Image filter settings |

### 4.3 Object Types

| type | Description | Extra Fields |
|------|-------------|-------------|
| `rect` | Rectangle | `rx`, `ry` for rounded corners |
| `circle` | Circle | `radius` |
| `ellipse` | Ellipse | `rx`, `ry` |
| `line` | Line segment | `x1`, `y1`, `x2`, `y2` |
| `path` | SVG path | `path` (array of commands) |
| `text` | Text label | `text`, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `textAlign`, `lineHeight`, `underline`, `linethrough` |
| `textbox` | Multi-line text | Same as text + `minWidth` |
| `group` | Group of objects | `objects[]` |
| `image` | Raster image | `src`, `filters` |
| `triangle` | Triangle | n/a |
| `polygon` | Polygon | `points` |
| `frame` | Frame/artboard | Contains `objects[]` children |

### 4.4 Frame Structure

Frames (artboards) are groups with `type: "frame"`:

```json
{
  "type": "group",
  "layerId": "frm_abc123",
  "layerName": "Desktop HD",
  "isFrameVisual": false,
  "left": 0,
  "top": 0,
  "width": 1440,
  "height": 1024,
  "fill": "#ffffff",
  "objects": [
    // Frame background rect (isFrameBg: true)
    { "type": "rect", "isFrameBg": true, "layerId": "...", ... },
    // Frame title label (isFrameLabel: true)
    { "type": "text", "isFrameLabel": true, "text": "Desktop HD", ... },
    // Child objects
    { "type": "rect", "layerId": "...", "frameId": "frm_abc123", ... },
    { "type": "text", "layerId": "...", "frameId": "frm_abc123", ... }
  ]
}
```

---

## 5. Styles API

Design tokens / reusable styles for colors, text, and effects.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/styles` | List all styles (optional `?type=color`) |
| `POST` | `/api/styles` | Create style |
| `GET` | `/api/styles/:id` | Get single style |
| `PUT` | `/api/styles/:id` | Update style |
| `DELETE` | `/api/styles/:id` | Delete style |

**Create a color style:**
```json
POST /api/styles
{
  "name": "Brand Primary",
  "type": "color",
  "value": "#3b82f6",
  "description": "Primary brand blue"
}
```

Response: `{ "success": true, "data": { "id": "sty_abc123", "name": "Brand Primary", "type": "color", "value": "#3b82f6", ... } }`

Valid `type` values: `"color"`, `"text"`, `"effect"`.

---

## 6. Components API

Reusable design components with definable properties.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/components` | List all components |
| `POST` | `/api/components` | Create component |
| `GET` | `/api/components/:id` | Get single component |
| `PUT` | `/api/components/:id` | Update component |
| `DELETE` | `/api/components/:id` | Delete component |

**Create a component:**
```json
POST /api/components
{
  "name": "CTA Button",
  "description": "Primary call-to-action button",
  "properties": [
    { "id": "label", "type": "text", "label": "Button Text", "defaultValue": "Click Me" },
    { "id": "color", "type": "color", "label": "Background", "defaultValue": "#3b82f6" }
  ],
  "canvas": { "version": "6.6.2", "width": 200, "height": 60, "background": "transparent", "objects": [...] },
  "layers": [...],
  "tags": ["ui", "button", "cta"]
}
```

---

## 7. Comments API

Add and manage comments on specific positions within templates.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/comments?templateId=TID` | List comments (add `&resolved=true/false` to filter) |
| `POST` | `/api/comments` | Create comment |
| `PATCH` | `/api/comments/:id` | Update (resolve/reopen/edit) |
| `DELETE` | `/api/comments/:id` | Delete comment |
| `POST` | `/api/comments/:id/replies` | Add threaded reply |

**Create a comment:**
```json
POST /api/comments
{
  "templateId": "tpl_abc123",
  "frameId": "frm_desktop",  // optional
  "x": 150,
  "y": 300,
  "author": "Claude",
  "text": "Consider increasing padding here to 24px for better spacing."
}
```

---

## 8. Version History API

Snapshot and restore template versions.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates/:id/versions` | List version history |
| `POST` | `/api/templates/:id/versions` | Create snapshot |
| `GET` | `/api/templates/:id/versions/:vid` | Get version details |
| `POST` | `/api/templates/:id/versions/:vid/restore` | Restore to version |

---

## 9. Additional Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/templates/:id/render` | Trigger template render |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/webhooks` | Register webhook for events |
| `GET` | `/api/webhooks` | List registered webhooks |
| `DELETE` | `/api/webhooks/:id` | Delete webhook |

---

## 10. Design Patterns & Conventions

### 10.1 ID Prefixes
- Templates: `tpl_`
- API keys: `key_` (stored), `fd_` (displayed key)
- Styles: `sty_`
- Components: `cmp_`
- Versions: `ver_`
- Comments: `cmt_`
- Replies: `rpl_`
- Layers/nodes: `n_` (auto-generated)

### 10.2 Layer Naming

Use semantic names for AI-discoverability:
```
"bg-hero"       // background layer
"headline-main" // primary headline
"cta-primary"   // CTA button
"logo-brand"    // brand logo
"card-1"        // card component
"frame-desktop" // desktop frame
```

### 10.3 Coordinate System

- Origin `(0, 0)` is top-left of the canvas
- Positive X = right, Positive Y = down
- Frame coordinates are relative to canvas origin
- Child objects within a frame use frame-local coordinates

### 10.4 Color Format

Always use hex colors with `#` prefix: `"#3b82f6"`, `"#ffffff"`, `"#1a1a2e"`. Supports 6-digit and 8-digit (with alpha) hex.

### 10.5 Typography

```json
{
  "type": "text",
  "text": "Modern Design System",
  "fontFamily": "Inter",
  "fontSize": 32,
  "fontWeight": 700,        // 400=normal, 700=bold
  "fontStyle": "normal",    // "normal" | "italic"
  "textAlign": "left",      // "left" | "center" | "right" | "justify"
  "lineHeight": 1.5,        // multiplier
  "fill": "#ffffff",
  "underline": false,
  "linethrough": false
}
```

---

## 11. Complete Examples

### Example 1: Create a Landing Page

```bash
# 1. Create blank template
curl -X POST https://futuraria.netlify.app/api/templates \
  -H "X-API-Key: fd_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SaaS Landing",
    "width": 1440,
    "height": 3000,
    "canvas": {
      "version": "6.6.2",
      "width": 1440,
      "height": 3000,
      "background": "#0f0f1a",
      "objects": []
    }
  }'

# 2. Response: { "success": true, "data": { "id": "tpl_X", ... } }

# 3. Update with design objects
curl -X PUT https://futuraria.netlify.app/api/templates/tpl_X \
  -H "X-API-Key: fd_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "canvas": {
      "version": "6.6.2",
      "width": 1440,
      "height": 3000,
      "background": "#0f0f1a",
      "objects": [
        {
          "type": "rect",
          "layerId": "n_bg_hero",
          "layerName": "bg-hero",
          "left": 0,
          "top": 0,
          "width": 1440,
          "height": 800,
          "fill": "#1a1a35",
          "rx": 0,
          "ry": 0
        },
        {
          "type": "text",
          "layerId": "n_headline",
          "layerName": "headline-main",
          "left": 120,
          "top": 250,
          "text": "Build Faster with AI Design",
          "fontFamily": "Inter",
          "fontSize": 64,
          "fontWeight": 700,
          "fill": "#ffffff",
          "textAlign": "left"
        },
        {
          "type": "rect",
          "layerId": "n_cta_btn",
          "layerName": "cta-primary",
          "left": 120,
          "top": 420,
          "width": 220,
          "height": 56,
          "fill": "#3b82f6",
          "rx": 12,
          "ry": 12
        },
        {
          "type": "text",
          "layerId": "n_cta_label",
          "layerName": "cta-label",
          "left": 140,
          "top": 434,
          "text": "Get Started",
          "fontFamily": "Inter",
          "fontSize": 18,
          "fontWeight": 600,
          "fill": "#ffffff",
          "textAlign": "center",
          "width": 180
        }
      ]
    }
  }'
```

### Example 2: Create a Style System

```bash
# Create color tokens
curl -X POST https://futuraria.netlify.app/api/styles \
  -H "X-API-Key: fd_yourkey" \
  -H "Content-Type: application/json" \
  -d '{"name": "Brand/Primary", "type": "color", "value": "#3b82f6"}'

curl -X POST https://futuraria.netlify.app/api/styles \
  -H "X-API-Key: fd_yourkey" \
  -H "Content-Type: application/json" \
  -d '{"name": "Brand/Secondary", "type": "color", "value": "#8b5cf6"}'

# Create text style
curl -X POST https://futuraria.netlify.app/api/styles \
  -H "X-API-Key: fd_yourkey" \
  -H "Content-Type: application/json" \
  -d '{"name": "Text/H1", "type": "text", "value": {"fontFamily": "Inter", "fontSize": 48, "fontWeight": 700, "lineHeight": 1.2}}'
```

### Example 3: Targeted Layer Update

```bash
# Change only the headline text, leave everything else
curl -X PATCH https://futuraria.netlify.app/api/templates/tpl_X/layers/headline-main \
  -H "X-API-Key: fd_yourkey" \
  -H "Content-Type: application/json" \
  -d '{"text": "AI-Powered Design, Human Refined", "fill": "#22d3ee"}'
```

---

## 12. Webhook Events

Register webhooks to get notified of changes:

```
Events: template.created | template.updated | template.deleted
        layer.updated | version.created | version.restored
        style.created | style.updated | style.deleted
        component.created | component.updated | component.deleted
        comment.created | comment.updated | comment.reply
        render.complete | webhook.registered
```

**Register:**
```json
POST /api/webhooks
{
  "url": "https://your-agent-webhook.example.com/events",
  "events": ["template.updated", "layer.updated"],
  "secret": "whsec_your_secret"
}
```

---

## 13. Gradient Fills (v0.3+)

Fabric.js 6.x gradient fills are fully supported for shapes, text, and closed paths.

### Gradient serialization format

```json
{
  "fill": {
    "type": "linear",
    "gradientType": "linear",
    "coords": { "x1": 0, "y1": 0, "x2": 300, "y2": 0 },
    "colorStops": [
      { "offset": 0, "color": "#3b82f6" },
      { "offset": 0.5, "color": "#8b5cf6" },
      { "offset": 1, "color": "#ec4899" }
    ]
  }
}
```

**Radial gradient:**
```json
{
  "fill": {
    "type": "radial",
    "gradientType": "radial",
    "coords": { "x1": 150, "y1": 100, "r1": 0, "x2": 150, "y2": 100, "r2": 150 },
    "colorStops": [
      { "offset": 0, "color": "#ffffff" },
      { "offset": 1, "color": "#1a1a2e" }
    ]
  }
}
```

**Key rules:**
- `type`: `"linear"` or `"radial"` — Fabric.js 6.x uses these values (NOT `"Gradient"`)
- `gradientType`: duplicate of `type` for compatibility — set both
- `colorStops`: minimum 2, maximum 5 stops. Each has `offset` (0-1 float) and `color` (hex string)
- Linear `coords`: `{ x1, y1, x2, y2 }` — start and end points
- Radial `coords`: `{ x1, y1, r1, x2, y2, r2 }` — inner and outer circles

Do NOT serialize Fabric.js class instances. Always use plain JSON objects with `type`, `coords`, and `colorStops` directly as shown above.

## 14. Lock/Unlock Layers (v0.3+)

Layers can be locked to prevent selection and movement. In the editor, toggle via the 🔒/🔓 icon in the Layers panel or press `Cmd+L` / `Ctrl+L`.

To lock via API, set on the fabric object:
```json
{
  "selectable": false,
  "evented": false
}
```

The `locked` property in `LayerInfo` (returned by layers API) reflects this: `locked: true` means `selectable === false`.

## 15. Rulers (v0.3+)

Figma-style pixel rulers are rendered as `<canvas>` overlays in the editor:
- **Horizontal ruler** (top, 24px height) and **vertical ruler** (left, 24px width)
- Dynamic tick mark steps based on zoom: 50px / 100px / 200px / 500px / 1000px
- Redraws automatically on pan and zoom via Fabric's `after:render` event
- Corner box covers the ruler intersection at `(0, 0)`
- Purely visual — no ruler data is persisted to the template

## 16. Fit-to-Screen (v0.3+)

The toolbar includes a "fit to screen" button (🔍 icon) that adjusts zoom and pan to frame all visible objects. Shortcut: `Cmd+1` / `Ctrl+1`. Persists as `viewport` in the template:
```json
{
  "viewport": { "zoom": 0.85, "x": -50, "y": -30 }
}
```

## 17. Keyboard Shortcuts Dialog (v0.3+)

Press `Cmd+K`, `Cmd+/`, `Ctrl+K`, or `Ctrl+/` to open the keyboard shortcuts reference dialog. Lists all available shortcuts organized by category (Editing, Drawing, Navigation, etc.).

## 18. Remote Agent Sync (v0.3+)

The editor polls the API every 15 seconds for external template changes (e.g., from AI agents). When changes are detected:
- If there are **no local unsaved changes**: canvas auto-reloads with agent modifications
- If there are **local changes pending**: a blue toast appears — "Agent modified this design externally" — with options to **Reload** (discard local) or **Dismiss** (keep local)

This enables seamless human-agent collaboration: agents design via REST API, humans refine in browser, and auto-sync keeps both in sync.

## 19. Common Pitfalls

1. **`layerId` is required**: Every object in `canvas.objects` must have a unique `layerId`. Use `n_TIMESTAMP_COUNTER` format.
2. **Frame children need `frameId`**: Objects inside frames must reference their parent `frameId`.
3. **PUT replaces everything**: Use `PUT /templates/:id` only when sending the complete canvas. For partial updates, use `PATCH` on layers.
4. **Colors require `#` prefix**: `"#3b82f6"` works. `"3b82f6"` does not.
5. **scaleX/scaleY vs width/height**: Fabric.js stores visual size as `width * scaleX`. Keep `scaleX: 1` and set `width` directly unless intentionally scaling.
6. **API key format**: The stored key `fd_abc...` is the hash prefix. The `X-API-Key` header must use the full key returned at creation time.
7. **Gradient `type` field**: Fabric.js 6.x uses `"linear"` or `"radial"` for gradient `type`, NOT `"Gradient"`. Using `"Gradient"` will cause the editor to crash when rendering the fill.
8. **Gradient colorStops order**: Must be sorted by `offset` ascending. Out-of-order stops produce undefined behavior in Fabric.js.
