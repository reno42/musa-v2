import * as templates from "../../api/src/services/templates.js";
import { store } from "../../api/src/services/store.js";
import { getSupabase } from "../../api/src/services/supabase.js";

/** Utility: crypto-based UUID v4 (avoids uuid npm in Netlify edge) */
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** UUID v4 format — validates user_id before Supabase upsert */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Simple in-memory rate limiter (survives warm Edge Function instances) */
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 60;      // requests per window
const RATE_WINDOW_MS = 60_000;  // 1 minute
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

const MCP_TOOLS = [
  {
    name: "list_workspaces",
    description: "List all workspaces for the authenticated user",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_workspace",
    description: "Create a new workspace",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workspace name" },
        description: { type: "string", description: "Optional description" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_templates",
    description: "List templates with optional workspace filter and search",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Filter by workspace ID" },
        search: { type: "string", description: "Search by template name" },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: [],
    },
  },
  {
    name: "get_template",
    description: "Get a template by ID with full canvas data, frames, styles, variables",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID (tpl_xxxxxxxx)" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_template",
    description: "Create a new design template in a workspace",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name" },
        workspaceId: { type: "string", description: "Workspace ID to create in" },
        width: { type: "number", description: "Canvas width in pixels (default 1080)" },
        height: { type: "number", description: "Canvas height in pixels (default 1080)" },
      },
      required: ["name", "workspaceId"],
    },
  },
  {
    name: "update_template",
    description: "Update a template's name or canvas data",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID" },
        name: { type: "string", description: "New name" },
        canvas: { type: "object", description: "Full Fabric.js canvas JSON with objects and viewport" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_template",
    description: "Permanently delete a template",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "duplicate_template",
    description: "Create an independent copy of a template",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Source template ID" },
        name: { type: "string", description: "Name for the copy (default: original + ' (copy)')" },
      },
      required: ["id"],
    },
  },
  {
    name: "export_template",
    description: "Export a template as .futuraria JSON for backup/migration",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID to export" },
      },
      required: ["id"],
    },
  },
  {
    name: "import_template",
    description: "Import a .futuraria JSON export into a workspace",
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "object", description: "The .futuraria JSON object (must have format: 'futuraria/v1' and template.name)" },
        workspaceId: { type: "string", description: "Target workspace ID" },
      },
      required: ["data", "workspaceId"],
    },
  },
  {
    name: "batch_update",
    description: "Apply an update to multiple templates at once (e.g. change CTA text across all 18 styles)",
    inputSchema: {
      type: "object",
      properties: {
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "List of template IDs to update",
        },
        search: { type: "string", description: "Optional: update all templates matching this name search instead of explicit IDs" },
        workspaceId: { type: "string", description: "Required when using search to scope to a workspace" },
        canvas: { type: "object", description: "Canvas JSON to merge into each template" },
        objects: {
          type: "array",
          items: { type: "object" },
          description: "Raw Fabric.js objects to merge (simpler than full canvas JSON)",
        },
        name: { type: "string", description: "New name(s) — appended suffix like ' - Updated'" },
      },
      required: [],
    },
  },
  {
    name: "render_batch",
    description: "Render multiple templates to HTML+PNG in one call. Returns render URLs for each.",
    inputSchema: {
      type: "object",
      properties: {
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "List of template IDs to render",
        },
        format: {
          type: "string",
          enum: ["png", "jpg"],
          description: "Output format (default png)",
        },
        scale: {
          type: "number",
          description: "Render scale multiplier (default 1, max 4)",
        },
      },
      required: ["templateIds"],
    },
  },
  {
    name: "list_versions",
    description: "List all saved versions of a template for undo/restore",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "restore_version",
    description: "Restore a template to a previously saved version",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID" },
        versionId: { type: "string", description: "Version ID to restore (from list_versions)" },
      },
      required: ["id", "versionId"],
    },
  },
  {
    name: "transform_object",
    description: "Transform any object property: position, size, rotation, opacity, fill color, stroke, font family/size/weight/style, letter spacing, line height, text content, border radius (rx/ry), shadow, visibility. Also accepts fillGradient: { type: 'linear'|'radial', angle: 135, colorStops: [{offset:0, color:'#hex'}] } for gradient fills.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Layer name to transform" },
        frameId: { type: "string", description: "Optional frame ID" },
        left: { type: "number", description: "X position" },
        top: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width in px" },
        height: { type: "number", description: "Height in px" },
        scaleX: { type: "number", description: "Horizontal scale" },
        scaleY: { type: "number", description: "Vertical scale" },
        angle: { type: "number", description: "Rotation degrees" },
        opacity: { type: "number", description: "Opacity 0-1" },
        visible: { type: "boolean", description: "Visibility" },
        fill: { type: "string", description: "Fill color (hex)" },
        fillGradient: { type: "object", description: "Gradient: { type:'linear'|'radial', angle:135, colorStops:[{offset:0,color:'#hex'}] }" },
        stroke: { type: "string", description: "Stroke color" },
        strokeWidth: { type: "number", description: "Stroke width" },
        text: { type: "string", description: "Text content" },
        fontFamily: { type: "string", description: "Font family (Syne, Inter, etc.)" },
        fontSize: { type: "number", description: "Font size px" },
        fontWeight: { type: "number", description: "Font weight 100-900" },
        fontStyle: { type: "string", enum: ["normal", "italic"] },
        charSpacing: { type: "number", description: "Letter spacing px" },
        lineHeight: { type: "number", description: "Line height multiplier" },
        underline: { type: "boolean" },
        rx: { type: "number", description: "Corner radius horizontal" },
        ry: { type: "number", description: "Corner radius vertical" },
        shadow: { type: "object", description: "Shadow: { color, blur, offsetX, offsetY }" },
        textAlign: { type: "string", enum: ["left", "center", "right"], description: "Text alignment" },
        lockMovementX: { type: "boolean", description: "Lock horizontal movement" },
        lockMovementY: { type: "boolean", description: "Lock vertical movement" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "draw_shape",
    description: "Draw a shape on a template: rect, ellipse, line, triangle, star, polygon",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        tool: { type: "string", enum: ["rect", "ellipse", "line", "triangle", "star", "polygon"], description: "Shape type" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width" },
        height: { type: "number", description: "Height" },
        fill: { type: "string", description: "Fill color hex" },
        stroke: { type: "string", description: "Stroke color" },
        strokeWidth: { type: "number", description: "Stroke width" },
        layerName: { type: "string", description: "Custom layer name" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "tool", "x", "y", "width", "height"],
    },
  },
  {
    name: "add_text",
    description: "Add a text layer to a template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        text: { type: "string", description: "Text content" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        fontSize: { type: "number", description: "Font size (default 24)" },
        fontFamily: { type: "string", description: "Font family (default Inter)" },
        fill: { type: "string", description: "Text color hex" },
        layerName: { type: "string", description: "Custom layer name" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "text", "x", "y"],
    },
  },
  {
    name: "add_image",
    description: "Add an image layer by URL",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        src: { type: "string", description: "Image URL" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Display width" },
        height: { type: "number", description: "Display height" },
        layerName: { type: "string", description: "Custom layer name" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "src", "x", "y"],
    },
  },
  {
    name: "upload_image",
    description: "Upload a base64-encoded image to a template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        base64: { type: "string", description: "Base64 image data (with or without data: prefix)" },
        name: { type: "string", description: "Image file name" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Display width" },
        height: { type: "number", description: "Display height" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "base64"],
    },
  },
  {
    name: "delete_objects",
    description: "Delete objects by layer name(s)",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        layerNames: { type: "array", items: { type: "string" }, description: "Layer names to delete" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "layerNames"],
    },
  },
  {
    name: "reorder_object",
    description: "Change z-index of a layer: bring to top, send to bottom, move up/down one level",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        layerName: { type: "string", description: "Layer name" },
        position: { type: "string", enum: ["top", "bottom", "up", "down"], description: "New z-index position" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "layerName", "position"],
    },
  },
  {
    name: "align_objects",
    description: "Align objects left, center-h, right, top, center-v, bottom",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        direction: { type: "string", enum: ["left", "center-h", "right", "top", "center-v", "bottom"] },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Layer names to align (omit to align all)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "direction"],
    },
  },
  {
    name: "distribute_objects",
    description: "Distribute objects evenly horizontally or vertically",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        direction: { type: "string", enum: ["horizontal", "vertical"] },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Layer names to distribute (omit for all)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "direction"],
    },
  },
  {
    name: "group_objects",
    description: "Group multiple layers together",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        layerNames: { type: "array", items: { type: "string" }, description: "Layer names to group (min 2)" },
        groupName: { type: "string", description: "Custom group name" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "layerNames"],
    },
  },
  {
    name: "ungroup_objects",
    description: "Ungroup a group back into individual layers",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        layerName: { type: "string", description: "Group layer name to ungroup" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "layerName"],
    },
  },
  {
    name: "copy_object",
    description: "Copy a layer to another template or duplicate within the same template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Source template ID" },
        layerName: { type: "string", description: "Layer name to copy" },
        frameId: { type: "string", description: "Optional source frame ID" },
        targetTemplateId: { type: "string", description: "Target template ID (if different from source)" },
        targetFrameId: { type: "string", description: "Optional target frame ID" },
        targetLayerName: { type: "string", description: "Optional new layer name (default: original_copy)" },
        offsetX: { type: "number", description: "Horizontal offset for the copy (default 20)" },
        offsetY: { type: "number", description: "Vertical offset for the copy (default 20)" },
      },
      required: ["templateId", "layerName"],
    },
  },
  {
    name: "duplicate_object",
    description: "Duplicate a layer with optional offset",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        layerName: { type: "string", description: "Layer name to duplicate" },
        offsetX: { type: "number", description: "Horizontal offset (default 20)" },
        offsetY: { type: "number", description: "Vertical offset (default 20)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "layerName"],
    },
  },
  {
    name: "add_svg_path",
    description: "Add a custom SVG path shape",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        path: { type: "string", description: "SVG path 'd' attribute string" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        fill: { type: "string", description: "Fill color (default #cccccc)" },
        stroke: { type: "string", description: "Stroke color" },
        strokeWidth: { type: "number", description: "Stroke width" },
        layerName: { type: "string", description: "Custom layer name" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "path"],
    },
  },
  {
    name: "boolean_operation",
    description: "Apply boolean operation (union, subtract, intersect, exclude) between 2+ layers",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        operation: { type: "string", enum: ["union", "subtract", "intersect", "exclude"] },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Layer names (min 2)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "operation", "targetLayerNames"],
    },
  },
  {
    name: "auto_layout",
    description: "Auto-layout objects in a row or column with configurable gap",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Layer names to arrange" },
        direction: { type: "string", enum: ["horizontal", "vertical"], description: "Layout direction (default horizontal)" },
        gap: { type: "number", description: "Gap between items px (default 16)" },
        padding: { type: "number", description: "Padding px (default 16)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "targetLayerNames"],
    },
  },
  {
    name: "list_fonts",
    description: "List fonts used in a template with usage counts, sizes, and weights",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "create_frame",
    description: "Create a frame (artboard) inside a template for grouping/containing objects",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Frame name" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Frame width (default 400)" },
        height: { type: "number", description: "Frame height (default 300)" },
        fill: { type: "string", description: "Background fill color" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "list_frames",
    description: "List all frames in a template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_frame",
    description: "Get a single frame by ID",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "update_frame",
    description: "Update a frame's properties (name, position, size, fill)",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to update" },
        name: { type: "string", description: "New frame name" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width in px" },
        height: { type: "number", description: "Height in px" },
        fill: { type: "string", description: "Background fill color" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "delete_frame",
    description: "Delete a frame and all its contained objects",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to delete" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "snapshot_template",
    description: "Save the current state of a template as a reference point. Used with diff_template to detect changes made by another user or agent.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to snapshot" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "diff_template",
    description: "Compare current template state against the last snapshot. Returns object-by-object changes (added, deleted, modified with before/after values). Call snapshot_template first to set the reference point.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to diff against snapshot" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "snapshot_auto",
    description: "Store a typed snapshot automatically. type='ia'|'human'|'system', trigger='update_template'|'autosave'|'beforeunload'|'idle'|'visibility'|'manual'. Auto-enforces 50-per-template limit.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        type: { type: "string", enum: ["ia", "human", "system"], description: "Who triggered the snapshot" },
        trigger: { type: "string", description: "What triggered it (tool name, autosave, beforeunload, idle, visibility, manual)" },
      },
      required: ["templateId", "type", "trigger"],
    },
  },
  {
    name: "list_snapshots",
    description: "List all snapshots for a template as a timeline (newest first). Each entry has id, type, trigger, timestamp, objectCount, frameCount.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "diff_snapshots",
    description: "Compare two specific snapshots by ID. Returns object-by-object changes between them. Use list_snapshots first to find snapshot IDs.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        snapIdA: { type: "string", description: "First snapshot ID (older)" },
        snapIdB: { type: "string", description: "Second snapshot ID (newer, or omit for current state)" },
      },
      required: ["templateId", "snapIdA"],
    },
  },
  {
    name: "search_google_fonts",
    description: "Search and browse 94 Google Fonts by name or category (sans-serif, serif, display, handwriting, monospace). Returns family name, category, available weight variants, and the Google Fonts CSS URL. Use this to discover fonts for your designs before applying via add_text fontFamily or transform_object fontFamily.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by font name or category (e.g. 'play', 'serif', 'mono')" },
        category: { type: "string", enum: ["sans-serif", "serif", "display", "handwriting", "monospace"], description: "Filter by category" },
        limit: { type: "number", description: "Max results (default 20, max 100)" },
      },
      required: [],
    },
  },
];

function getUserId(event) {
  const headers = event.headers || {};
  return headers["x-api-key"] || headers["authorization"]?.replace("Bearer ", "") || "dev_user_default";
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/** Compare two values recursively, returning { path, old, new } diffs */
function compareValues(a, b, path = "") {
  const diffs = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b) { diffs.push({ path, old: a, new: b }); return diffs; }
  if (a === null || b === null) { if (a !== b) diffs.push({ path, old: a, new: b }); return diffs; }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      diffs.push(...compareValues(a[i], b[i], path + "[" + i + "]"));
    return diffs;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) diffs.push(...compareValues(a?.[k], b?.[k], path ? path + "." + k : k));
    if (diffs.length === 0 && JSON.stringify(a) !== JSON.stringify(b))
      diffs.push({ path, old: a, new: b });
    return diffs;
  }
  if (a !== b) diffs.push({ path, old: a, new: b });
  return diffs;
}

/** Compare snapshot vs current template, returning per-object changes */
function compareTemplates(snap, current) {
  const diffs = [], snapById = new Map(), currById = new Map();
  for (const o of snap.canvas?.objects || []) { const id = o.layerName || o.name || o.id; if (id) snapById.set(id, o); }
  for (const o of current.canvas?.objects || []) { const id = o.layerName || o.name || o.id; if (id) currById.set(id, o); }
  const allIds = new Set([...snapById.keys(), ...currById.keys()]);
  for (const id of allIds) {
    const s = snapById.get(id), c = currById.get(id);
    if (s && !c) {
      diffs.push({ layerName: id, action: "deleted", old: { type: s.type, left: s.left, top: s.top } });
    } else if (!s && c) {
      diffs.push({ layerName: id, action: "added", new: { type: c.type, left: c.left, top: c.top } });
    } else {
      const changes = compareValues(s, c);
      if (changes.length > 0) diffs.push({ layerName: id, action: "modified", changes });
    }
  }
  return diffs;
}

/** Route JSON-RPC method calls to template/workspace services */
async function handleMethod(method, params, userId) {
  // Helper: safely get objects array for a frame, merging frame.objects + canvas.objects
  const getFrameObjects = (tpl, frameId) => {
    if (!frameId) return tpl.canvas.objects;
    // Merge: frame.objects (explicit) + canvas.objects with matching frameId
    const frame = tpl.frames?.find(f => f.id === frameId);
    const fromFrame = frame?.objects || [];
    const fromCanvas = (tpl.canvas?.objects || []).filter(o => o.frameId === frameId && !o.isFrameVisual);
    // Deduplicate by layerName
    const seen = new Set(fromFrame.map(o => o.layerName || o.name));
    const merged = [...fromFrame];
    for (const o of fromCanvas) {
      if (!seen.has(o.layerName || o.name)) merged.push(o);
    }
    return merged;
  };

  // Helper: auto-snapshot before IA mutations (capture pre-state for diff)
  const autoSnapshot = (templateId, trigger, tplData) => {
    try {
      if (tplData) {
        store.snapshot(templateId, JSON.parse(JSON.stringify(tplData)));
      } else {
        store.snapshotAuto(templateId, "ia", trigger);
      }
    } catch { /* non-blocking */ }
  };

  switch (method) {
    // ── Workspaces ──
    case "list_workspaces": {
      const sb = getSupabase();
      if (sb) {
        try {
          const { data } = await sb.from("workspaces").select("*").order("updated_at", { ascending: false });
          if (data?.length) {
            const items = data.map(r => ({
              ...r.data, id: r.id, name: r.name, ownerId: r.owner_id,
              createdAt: r.created_at, updatedAt: r.updated_at,
            }));
            return { data: items, total: items.length };
          }
        } catch { /* fall through to store */ }
      }
      const data = store.listWorkspaces(userId);
      return { data, total: data.length };
    }
    case "create_workspace": {
      const ws = store.createWorkspace({ name: params.name, description: params.description, ownerId: userId });
      const sb = getSupabase();
      if (sb) {
        try {
          const row = {
            id: ws.id, name: ws.name,
            data: ws, updated_at: new Date().toISOString(),
          };
          if (UUID_RE.test(userId)) row.user_id = userId;
          await sb.from("workspaces").upsert(row);
        } catch { /* non-blocking */ }
      }
      return ws;
    }

    // ── Templates ──
    case "list_templates": {
      const result = await templates.listTemplatesPaginated(
        params.limit || 50, params.offset || 0,
        params.workspaceId, params.search,
      );
      return result;
    }
    case "get_template": {
      const tpl = await templates.getTemplate(params.id);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
      return {
        ...tpl,
        _objectCount: tpl.canvas?.objects?.length || 0,
        _frameCount: tpl.frames?.length || 0,
      };
    }
    case "create_template": {
      if (!params.workspaceId) throw { code: -32602, message: "workspaceId is required" };
      // Validate name
      const tplName = (params.name || "").trim();
      if (!tplName) throw { code: -32602, message: "name is required and cannot be empty" };
      if (tplName.length > 200) throw { code: -32602, message: "name must be 200 characters or less" };
      // Validate dimensions
      const tplWidth = params.width !== undefined ? Number(params.width) : 1080;
      const tplHeight = params.height !== undefined ? Number(params.height) : 1080;
      if (isNaN(tplWidth) || tplWidth <= 0 || tplWidth > 10000)
        throw { code: -32602, message: "width must be a number between 1 and 10000" };
      if (isNaN(tplHeight) || tplHeight <= 0 || tplHeight > 10000)
        throw { code: -32602, message: "height must be a number between 1 and 10000" };
      const tpl = await templates.createTemplate(
        tplName, tplWidth, tplHeight,
        undefined, userId, params.workspaceId,
      );
      autoSnapshot(tpl.id, "create_template");
      return tpl;
    }
    case "update_template": {
      const updates = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.canvas !== undefined) updates.canvas = params.canvas;
      // Support raw objects array (simpler API for programmatic use)
      if (params.objects !== undefined) {
        const objects = typeof params.objects === "string" ? JSON.parse(params.objects) : params.objects;
        updates.canvas = { objects, viewport: { x: 0, y: 0, zoom: 1 } };
      }
      // Also accept id or templateId
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.updateTemplate(tplId, updates);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };
      autoSnapshot(tplId, "update_template");
      return tpl;
    }
    case "delete_template": {
      const ok = await templates.deleteTemplate(params.id);
      if (!ok) throw { code: -32000, message: `Template not found: ${params.id}` };
      return { deleted: true, id: params.id };
    }
    case "duplicate_template": {
      const tpl = await templates.duplicateTemplate(params.id, params.name, userId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
      return tpl;
    }
    case "export_template": {
      const tpl = await templates.getTemplate(params.id);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
      return {
        format: "futuraria/v1",
        exportedAt: new Date().toISOString(),
        template: {
          name: tpl.name, width: tpl.width, height: tpl.height,
          canvas: tpl.canvas, frames: tpl.frames, styles: tpl.styles,
          variables: tpl.variables, metadata: tpl.metadata,
        },
      };
    }
    case "import_template": {
      const { format, template: tplData } = params.data;
      if (format !== "futuraria/v1") throw { code: -32602, message: "Invalid format. Expected 'futuraria/v1'" };
      if (!tplData?.name) throw { code: -32602, message: "template.name required" };

      const newTpl = store.createTemplate({
        workspaceId: params.workspaceId,
        name: tplData.name,
        width: tplData.width || 1080,
        height: tplData.height || 1080,
        canvas: tplData.canvas || { objects: [], viewport: { x: 0, y: 0, zoom: 1 } },
        userId,
      });
      if (tplData.frames) newTpl.frames = tplData.frames;
      if (tplData.styles) newTpl.styles = tplData.styles;
      if (tplData.variables) newTpl.variables = tplData.variables;
      // Dual-write to Supabase
      const sb = getSupabase();
      if (sb) {
        try {
          const row = {
            id: newTpl.id, name: newTpl.name, workspace_id: newTpl.workspaceId,
            data: newTpl, updated_at: new Date().toISOString(),
          };
          if (UUID_RE.test(userId)) row.user_id = userId;
          await sb.from("templates").upsert(row);
        } catch { /* non-blocking */ }
      }
      return newTpl;
    }

    // ── Batch Update ──
    case "batch_update": {
      let ids = params.templateIds || params.operations || [];
      // Resolve IDs via search if provided
      if (params.search) {
        const result = await templates.listTemplatesPaginated(200, 0, params.workspaceId, params.search);
        const found = (result?.data || []).map(t => t.id);
        ids = [...new Set([...ids, ...found])];
      }
      if (!ids.length) throw { code: -32602, message: "No templateIds or matching search results" };

      // Build base updates (non-objects fields)
      const baseUpdates = {};
      if (params.name !== undefined) baseUpdates.name = params.name;
      if (params.canvas !== undefined) baseUpdates.canvas = params.canvas;

      // Pre-parse objects array for merge
      let newObjects = null;
      if (params.objects !== undefined) {
        newObjects = typeof params.objects === "string" ? JSON.parse(params.objects) : params.objects;
        if (!Array.isArray(newObjects)) newObjects = [newObjects];
      }

      const results = [];
      for (const id of ids) {
        try {
          const tpl = await templates.getTemplate(id);
          if (!tpl) { results.push({ id, ok: false, error: "Template not found" }); continue; }

          const updates = { ...baseUpdates };

          // Merge objects by layerName instead of replacing
          if (newObjects) {
            const existing = tpl.canvas?.objects || [];
            const merged = [...existing];
            const indexByLayer = new Map();
            for (let i = 0; i < merged.length; i++) {
              const key = merged[i].layerName || merged[i].name;
              if (key) indexByLayer.set(key, i);
            }
            for (const newObj of newObjects) {
              const key = newObj.layerName || newObj.name;
              if (key && indexByLayer.has(key)) {
                // Update existing object in place
                Object.assign(merged[indexByLayer.get(key)], newObj);
              } else {
                // Append new object
                merged.push(newObj);
              }
            }
            updates.canvas = { ...tpl.canvas, objects: merged };
          }

          await templates.updateTemplate(id, updates);
          results.push({ id, ok: true });
        } catch (e) {
          results.push({ id, ok: false, error: e?.message || "update failed" });
        }
      }
      return {
        updated: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        total: ids.length,
        results,
      };
    }

    // ── Render Batch ──
    case "render_batch": {
      if (!params.templateIds?.length) throw { code: -32602, message: "templateIds array required" };
      const format = ["png", "jpg"].includes(params.format) ? params.format : "png";
      const scale = Math.min(Math.max(parseInt(String(params.scale), 10) || 1, 1), 4);
      const results = [];
      for (const id of params.templateIds) {
        try {
          const tpl = await templates.getTemplate(id);
          if (!tpl) { results.push({ templateId: id, error: "not found" }); continue; }
          results.push({
            templateId: id,
            name: tpl.name,
            status: "ready",
            _links: {
              render: `/api/templates/${id}/render`,
              view: `/api/render/${id}`,
            },
            renderParams: { format, scale, width: (tpl.width || 1080) * scale, height: (tpl.height || 1080) * scale },
          });
        } catch (e) {
          results.push({ templateId: id, error: e?.message || "load failed" });
        }
      }
      return { format, scale, total: params.templateIds.length, ready: results.filter(r => r.status === "ready").length, results };
    }

    // ── Versions ──
    case "list_versions": {
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.getTemplate(tplId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };
      return {
        templateId: tplId,
        versions: (tpl.versions || []).map((v, i) => ({
          id: v.id || `v${i}`,
          version: i + 1,
          timestamp: v.timestamp || v.createdAt,
          label: v.label || `Version ${i + 1}`,
          canvasHash: v.canvasHash || "",
        })),
      };
    }
    case "restore_version": {
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.getTemplate(tplId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };
      const versions = tpl.versions || [];
      const match = versions.find((v, i) => (v.id || `v${i}`) === params.versionId);
      if (!match) throw { code: -32000, message: `Version not found: ${params.versionId}` };
      if (!match.canvas) throw { code: -32000, message: "Version has no canvas data" };
      const restored = await templates.updateTemplate(tplId, { canvas: match.canvas });
      return {
        restored: true,
        templateId: tplId,
        versionId: params.versionId,
        template: restored,
      };
    }

    // ── transform_object ──
    case "transform_object": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      const objects = getFrameObjects(tpl, params.frameId);


      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };

      autoSnapshot(params.templateId, method, tpl); // Capture pre-mutation state for diff

      const { templateId, targetLayerName, frameId, fillGradient, shadow, ...rest } = params;

      // ── Range validation for numeric properties ──
      if (rest.opacity !== undefined) {
        if (typeof rest.opacity !== "number" || rest.opacity < 0 || rest.opacity > 1)
          throw { code: -32602, message: "opacity must be a number between 0 and 1" };
      }
      if (rest.angle !== undefined) {
        if (typeof rest.angle !== "number")
          throw { code: -32602, message: "angle must be a number" };
        rest.angle = ((rest.angle % 360) + 360) % 360; // Normalize 0-360
      }
      if (rest.width !== undefined && (typeof rest.width !== "number" || rest.width <= 0))
        throw { code: -32602, message: "width must be a number > 0" };
      if (rest.height !== undefined && (typeof rest.height !== "number" || rest.height <= 0))
        throw { code: -32602, message: "height must be a number > 0" };
      if (rest.scaleX !== undefined && rest.scaleX === 0)
        throw { code: -32602, message: "scaleX cannot be 0" };
      if (rest.scaleY !== undefined && rest.scaleY === 0)
        throw { code: -32602, message: "scaleY cannot be 0" };
      if (rest.strokeWidth !== undefined && (typeof rest.strokeWidth !== "number" || rest.strokeWidth < 0))
        throw { code: -32602, message: "strokeWidth must be a number >= 0" };
      if (rest.fontSize !== undefined && (typeof rest.fontSize !== "number" || rest.fontSize <= 0))
        throw { code: -32602, message: "fontSize must be a number > 0" };

      if (fillGradient) {
        rest.fill = {
          type: fillGradient.type || "linear",
          angle: fillGradient.angle || 0,
          colorStops: fillGradient.colorStops || fillGradient.stops || [],
          x1: fillGradient.x1, y1: fillGradient.y1,
          x2: fillGradient.x2, y2: fillGradient.y2,
        };
      }

      if (shadow) {
        rest.shadow = {
          color: shadow.color || "rgba(0,0,0,0.3)",
          blur: shadow.blur || 8,
          offsetX: shadow.offsetX || 0,
          offsetY: shadow.offsetY || 4,
        };
      }

      Object.assign(obj, rest);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── draw_shape ──
    case "draw_shape": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const llName = params.layerName || `${params.tool}_${uuid().slice(0, 8)}`;
      const obj = {
        type: params.tool, layerName: llName,
        left: params.x, top: params.y, width: params.width, height: params.height,
        fill: params.fill || "#cccccc", stroke: params.stroke || "transparent",
        strokeWidth: params.strokeWidth || 1,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };
      if (params.tool === "star") { obj.points = 5; obj.innerRadius = params.width * 0.4; obj.outerRadius = params.width * 0.5; }
      if (params.tool === "polygon") obj.sides = 6;

      const target = getFrameObjects(tpl, params.frameId);
      target.push(obj);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── add_text ──
    case "add_text": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const obj = {
        type: "text", layerName: params.layerName || `text_${uuid().slice(0, 8)}`,
        text: params.text, left: params.x, top: params.y,
        fontSize: params.fontSize || 24, fontFamily: params.fontFamily || "Inter",
        fill: params.fill || "#000000", padding: 0,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };

      const target = getFrameObjects(tpl, params.frameId);
      target.push(obj);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── add_image ──
    case "add_image": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const obj = {
        type: "image", layerName: params.layerName || `img_${uuid().slice(0, 8)}`,
        src: params.src, left: params.x, top: params.y,
        width: params.width || 200, height: params.height || 200,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };

      const target = getFrameObjects(tpl, params.frameId);
      target.push(obj);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── upload_image ──
    case "upload_image": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const fileName = params.name || `img_${uuid().slice(0, 8)}.png`;
      const dataUrl = params.base64.startsWith("data:") ? params.base64 : `data:image/png;base64,${params.base64}`;

      const obj = {
        type: "image", layerName: fileName,
        src: dataUrl, left: params.x || 0, top: params.y || 0,
        width: params.width || 200, height: params.height || 200,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };

      const target = getFrameObjects(tpl, params.frameId);
      target.push(obj);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── delete_objects ──
    case "delete_objects": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);

      const removed = [];
      for (const name of params.layerNames) {
        const idx = objects.findIndex(o => (o.layerName || o.name) === name);
        if (idx !== -1) { objects.splice(idx, 1); removed.push(name); }
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { removed, count: removed.length };
    }

    // ── reorder_object ──
    case "reorder_object": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const idx = objects.findIndex(o => (o.layerName || o.name) === params.layerName);
      if (idx === -1) throw { code: -32000, message: `Layer not found: ${params.layerName}` };

      const [item] = objects.splice(idx, 1);
      switch (params.position) {
        case "top": objects.push(item); break;
        case "bottom": objects.unshift(item); break;
        case "up": objects.splice(Math.min(idx + 1, objects.length), 0, item); break;
        case "down": objects.splice(Math.max(idx - 1, 0), 0, item); break;
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { layerName: params.layerName, position: params.position };
    }

    // ── align_objects ──
    case "align_objects": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const targets = params.targetLayerNames
        ? objects.filter(o => params.targetLayerNames.includes(o.layerName || o.name))
        : objects;
      if (targets.length < 2) throw { code: -32000, message: "Need at least 2 layers to align" };

      const bounds = targets.reduce((acc, o) => ({
        minX: Math.min(acc.minX, o.left || 0),
        minY: Math.min(acc.minY, o.top || 0),
        maxX: Math.max(acc.maxX, (o.left || 0) + (o.width || 0) * (o.scaleX || 1)),
        maxY: Math.max(acc.maxY, (o.top || 0) + (o.height || 0) * (o.scaleY || 1)),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

      for (const obj of targets) {
        const w = (obj.width || 0) * (obj.scaleX || 1);
        const h = (obj.height || 0) * (obj.scaleY || 1);
        switch (params.direction) {
          case "left": obj.left = bounds.minX; break;
          case "right": obj.left = bounds.maxX - w; break;
          case "center-h": obj.left = (bounds.minX + bounds.maxX) / 2 - w / 2; break;
          case "top": obj.top = bounds.minY; break;
          case "bottom": obj.top = bounds.maxY - h; break;
          case "center-v": obj.top = (bounds.minY + bounds.maxY) / 2 - h / 2; break;
        }
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { direction: params.direction, affected: targets.length };
    }

    // ── distribute_objects ──
    case "distribute_objects": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const targets = params.targetLayerNames
        ? objects.filter(o => params.targetLayerNames.includes(o.layerName || o.name))
        : objects;
      if (targets.length < 3) throw { code: -32000, message: "Need at least 3 layers to distribute" };

      if (params.direction === "horizontal") {
        targets.sort((a, b) => (a.left || 0) - (b.left || 0));
        const firstLeft = targets[0].left || 0;
        const last = targets[targets.length - 1];
        const lastRight = (last.left || 0) + (last.width || 0) * (last.scaleX || 1);
        const totalW = targets.reduce((s, o) => s + (o.width || 0) * (o.scaleX || 1), 0);
        const gap = (lastRight - firstLeft - totalW) / (targets.length - 1);
        let x = firstLeft;
        for (const obj of targets) { obj.left = x; x += (obj.width || 0) * (obj.scaleX || 1) + gap; }
      } else {
        targets.sort((a, b) => (a.top || 0) - (b.top || 0));
        const firstTop = targets[0].top || 0;
        const last = targets[targets.length - 1];
        const lastBottom = (last.top || 0) + (last.height || 0) * (last.scaleY || 1);
        const totalH = targets.reduce((s, o) => s + (o.height || 0) * (o.scaleY || 1), 0);
        const gap = (lastBottom - firstTop - totalH) / (targets.length - 1);
        let y = firstTop;
        for (const obj of targets) { obj.top = y; y += (obj.height || 0) * (obj.scaleY || 1) + gap; }
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { direction: params.direction, affected: targets.length };
    }

    // ── group_objects ──
    case "group_objects": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);

      const members = [];
      for (const name of params.layerNames) {
        const idx = objects.findIndex(o => (o.layerName || o.name) === name);
        if (idx !== -1) members.push(...objects.splice(idx, 1));
      }
      if (members.length < 2) throw { code: -32000, message: "Need at least 2 layers to group" };

      const bounds = members.reduce((acc, o) => ({
        left: Math.min(acc.left, o.left || 0),
        top: Math.min(acc.top, o.top || 0),
      }), { left: Infinity, top: Infinity });

      const group = {
        type: "group", layerName: params.groupName || `group_${uuid().slice(0, 8)}`,
        left: bounds.left, top: bounds.top, width: 0, height: 0,
        objects: members, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };
      objects.push(group);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return group;
    }

    // ── ungroup_objects ──
    case "ungroup_objects": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const idx = objects.findIndex(o => (o.layerName || o.name) === params.layerName && o.type === "group");
      if (idx === -1) throw { code: -32000, message: "Group not found" };

      const group = objects.splice(idx, 1)[0];
      const children = group.objects || [];
      for (const child of children) {
        child.left = (group.left || 0) + (child.left || 0);
        child.top = (group.top || 0) + (child.top || 0);
        objects.push(child);
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { children: children.length, layerNames: children.map(c => c.layerName || c.name) };
    }

    // ── copy_object ──
    case "copy_object": {
      const sourceTpl = await templates.getTemplate(params.templateId);
      if (!sourceTpl) throw { code: -32000, message: `Source template not found: ${params.templateId}` };

      const sourceObjects = getFrameObjects(sourceTpl, params.frameId);
      const obj = sourceObjects.find(o => (o.layerName || o.name) === params.layerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.layerName}` };

      // Clone the object
      const clone = JSON.parse(JSON.stringify(obj));
      clone.layerName = params.targetLayerName || `${params.layerName}_copy`;
      if (params.offsetX !== undefined) clone.left = (clone.left || 0) + params.offsetX;
      else clone.left = (clone.left || 0) + 20;
      if (params.offsetY !== undefined) clone.top = (clone.top || 0) + params.offsetY;
      else clone.top = (clone.top || 0) + 20;

      // Determine target
      const targetId = params.targetTemplateId || params.templateId;
      let targetTpl = targetId === params.templateId ? sourceTpl : await templates.getTemplate(targetId);
      if (!targetTpl) throw { code: -32000, message: `Target template not found: ${targetId}` };

      const targetObjects = getFrameObjects(targetTpl, params.targetFrameId || params.frameId);
      targetObjects.push(clone);
      targetTpl.metadata.updatedAt = new Date().toISOString();

      await templates.updateTemplate(targetId, { canvas: targetTpl.canvas, frames: targetTpl.frames });
      autoSnapshot(targetId, method);

      return {
        copied: true,
        sourceTemplateId: params.templateId,
        targetTemplateId: targetId,
        object: clone,
      };
    }

    // ── duplicate_object ──
    case "duplicate_object": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const idx = objects.findIndex(o => (o.layerName || o.name) === params.layerName);
      if (idx === -1) throw { code: -32000, message: `Layer not found: ${params.layerName}` };

      const clone = JSON.parse(JSON.stringify(objects[idx]));
      clone.layerName = `${params.layerName}_copy`;
      clone.left = (clone.left || 0) + (params.offsetX || 20);
      clone.top = (clone.top || 0) + (params.offsetY || 20);
      objects.push(clone);

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return clone;
    }

    // ── add_svg_path ──
    case "add_svg_path": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      const obj = {
        type: "path", path: params.path,
        layerName: params.layerName || `path_${uuid().slice(0, 8)}`,
        left: params.x || 0, top: params.y || 0,
        fill: params.fill || "#cccccc", stroke: params.stroke || "transparent",
        strokeWidth: params.strokeWidth || 1,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };

      const target = getFrameObjects(tpl, params.frameId);
      target.push(obj);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── boolean_operation ──
    case "boolean_operation": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const targets = objects.filter(o => params.targetLayerNames.includes(o.layerName || o.name));
      if (targets.length < 2) throw { code: -32000, message: "Need at least 2 matching layers" };

      const combinedName = `${params.operation}_${params.targetLayerNames.join("_")}`;
      for (const t of targets) {
        const idx = objects.indexOf(t);
        if (idx !== -1) objects.splice(idx, 1);
      }

      objects.push({
        type: "group", layerName: combinedName, booleanOperation: params.operation,
        objects: targets.map(t => ({ ...t })),
        left: targets[0].left, top: targets[0].top,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      });

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { operation: params.operation, combinedName, affected: params.targetLayerNames };
    }

    // ── auto_layout ──
    case "auto_layout": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = getFrameObjects(tpl, params.frameId);
      const targets = params.targetLayerNames
        .map(name => objects.find(o => (o.layerName || o.name) === name))
        .filter(Boolean);
      if (targets.length < 2) throw { code: -32000, message: "Need at least 2 layers" };

      const gap = params.gap || 16;
      const dir = params.direction || "horizontal";
      let curX = targets[0].left, curY = targets[0].top;
      for (const obj of targets) {
        obj.left = curX; obj.top = curY;
        if (dir === "horizontal") curX += (obj.width || 0) * (obj.scaleX || 1) + gap;
        else curY += (obj.height || 0) * (obj.scaleY || 1) + gap;
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { direction: dir, gap, affected: targets.length };
    }

    // ── list_fonts ──
    case "list_fonts": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      const fontMap = {};
      function scan(obj) {
        if (obj.type === "text" || obj.type === "i-text" || obj.type === "IText" || obj.type === "Textbox" || obj.type === "textbox") {
          const family = obj.fontFamily || "Inter";
          if (!fontMap[family]) fontMap[family] = { count: 0, sizes: new Set(), weights: new Set() };
          fontMap[family].count++;
          if (obj.fontSize) fontMap[family].sizes.add(obj.fontSize);
          if (obj.fontWeight != null) fontMap[family].weights.add(String(obj.fontWeight));
        }
        if (obj.objects && Array.isArray(obj.objects)) for (const child of obj.objects) scan(child);
      }
      for (const obj of tpl.canvas.objects) scan(obj);
      for (const frame of tpl.frames) for (const obj of frame.objects) scan(obj);

      const fonts = Object.entries(fontMap)
        .map(([family, info]) => ({ family, count: info.count, sizes: [...info.sizes].sort((a, b) => a - b), weights: [...info.weights] }))
        .sort((a, b) => b.count - a.count);
      return { fonts, total: fonts.length };
    }

    // ── create_frame ──
    case "create_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      // 1. Create frame metadata in store
      const frame = store.createFrame(params.templateId, {
        name: params.name, x: params.x || 0, y: params.y || 0,
        width: params.width || 400, height: params.height || 300,
        fill: params.fill || "transparent",
      });
      if (!frame) throw { code: -32000, message: "Failed to create frame" };

      // 2. Create visual object in canvas.objects (isFrameVisual) for renderer compatibility
      const visualObj = {
        type: "rect",
        layerName: `frame_visual_${frame.id}`,
        frameId: frame.id,
        isFrameVisual: true,
        frameName: frame.name,
        frameFill: frame.fill,
        left: frame.x || 0,
        top: frame.y || 0,
        width: frame.width || 400,
        height: frame.height || 300,
        fill: frame.fill || "#ffffff",
        stroke: "#6366f1",
        strokeWidth: 1,
        rx: 0, ry: 0,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      if (!tpl.canvas.objects) tpl.canvas.objects = [];
      tpl.canvas.objects.push(visualObj);

      // 3. Persist both frames metadata and canvas objects in one operation
      await templates.updateTemplate(params.templateId, {
        frames: tpl.frames,
        canvas: tpl.canvas,
      });
      autoSnapshot(params.templateId, method);

      // 4. Return with frameId for consistency (fix BUG-011)
      return { frameId: frame.id, name: frame.name, x: frame.x, y: frame.y, width: frame.width, height: frame.height, fill: frame.fill };
    }

    // ── list_frames ──
    case "list_frames": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      return { frames: tpl.frames, total: tpl.frames.length };
    }

    // ── get_frame ──
    case "get_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: "Frame not found" };
      return frame;
    }

    // ── update_frame ──
    case "update_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const { templateId, frameId, ...updates } = params;
      const frame = store.updateFrame(params.templateId, params.frameId, updates);
      if (!frame) throw { code: -32000, message: "Frame not found" };
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return frame;
    }

    // ── delete_frame ──
    case "delete_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const ok = store.deleteFrame(params.templateId, params.frameId);
      if (!ok) throw { code: -32000, message: "Frame not found" };
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { deleted: true, templateId: params.templateId, frameId: params.frameId };
    }

    // ── render_frame ──
    case "render_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      let frame = tpl.frames?.find(f => f.id === params.frameId);

      // Fallback: canvas.objects with isFrameVisual + frameId
      if (!frame) {
        const visualFrame = (tpl.canvas?.objects || []).find(
          o => o.isFrameVisual && o.frameId === params.frameId
        );
        if (visualFrame) {
          frame = {
            id: visualFrame.frameId,
            name: visualFrame.frameName || visualFrame.layerName || visualFrame.name || "Frame",
            width: visualFrame.width || 1080,
            height: visualFrame.height || 1080,
          };
        }
      }

      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const format = ["png", "jpg", "svg"].includes(params.format) ? params.format : "png";
      const scale = Math.min(Math.max(parseInt(String(params.scale), 10) || 1, 1), 4);
      const API_BASE = process.env.URL || "https://bejewelled-llama-a6719d.netlify.app";

      return {
        frameId: frame.id,
        frameName: frame.name,
        width: frame.width,
        height: frame.height,
        format,
        scale,
        viewUrl: `${API_BASE}/api/render/${params.templateId}/frame/${params.frameId}`,
      };
    }

    // ── snapshot_template ──
    case "snapshot_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      store.snapshot(params.templateId, JSON.parse(JSON.stringify(tpl)));
      return { snapshotted: true, templateId: params.templateId, objectCount: tpl.canvas?.objects?.length || 0 };
    }

    // ── diff_template ──
    case "diff_template": {
      const raw = store.getSnapshot(params.templateId);
      const snap = raw?.data || raw;
      if (!snap || !snap.canvas) throw { code: -32000, message: "No snapshot found. Call snapshot_template first." };
      const current = await templates.getTemplate(params.templateId);
      if (!current) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const diffs = compareTemplates(snap, current);
      return { templateId: params.templateId, changes: diffs, totalChanges: diffs.length };
    }

    // ── snapshot_auto ──
    case "snapshot_auto": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const type = ["ia", "human", "system"].includes(params.type) ? params.type : "ia";
      const entry = store.snapshotAuto(params.templateId, type, params.trigger || "manual");
      return { snapshotted: true, templateId: params.templateId, snapshot: entry };
    }

    // ── list_snapshots ──
    case "list_snapshots": {
      const timeline = store.listSnapshots(params.templateId);
      return {
        templateId: params.templateId,
        snapshots: timeline.map(e => ({
          id: e.id, type: e.type, trigger: e.trigger,
          timestamp: e.timestamp, objectCount: e.objectCount, frameCount: e.frameCount,
        })),
        total: timeline.length,
      };
    }

    // ── diff_snapshots ──
    case "diff_snapshots": {
      const snapA = store.getSnapshot(params.templateId, params.snapIdA);
      if (!snapA || !snapA.data) throw { code: -32000, message: `Snapshot A not found: ${params.snapIdA}` };
      const dataA = snapA.data;
      let dataB;
      if (params.snapIdB) {
        const snapB = store.getSnapshot(params.templateId, params.snapIdB);
        if (!snapB || !snapB.data) throw { code: -32000, message: `Snapshot B not found: ${params.snapIdB}` };
        dataB = snapB.data;
      } else {
        dataB = await templates.getTemplate(params.templateId);
        if (!dataB) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      }
      const diffs = compareTemplates(dataA, dataB);
      return { snapIdA: params.snapIdA, snapIdB: params.snapIdB || "current", changes: diffs, totalChanges: diffs.length };
    }

    // ── search_google_fonts ──
    case "search_google_fonts": {
      const GOOGLE_FONTS = [
        { family:"Inter", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Roboto", category:"sans-serif", variants:["400","500","700"] },
        { family:"Open Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Montserrat", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Poppins", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Lato", category:"sans-serif", variants:["400","700"] },
        { family:"Raleway", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Nunito", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Oswald", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"DM Sans", category:"sans-serif", variants:["400","500","700"] },
        { family:"Manrope", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Space Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Syne", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Archivo", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Lexend", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Plus Jakarta Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Outfit", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Sora", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Rubik", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Quicksand", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Work Sans", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Fira Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"IBM Plex Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Source Sans 3", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Public Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Figtree", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Onest", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Be Vietnam Pro", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Epilogue", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Urbanist", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Playfair Display", category:"serif", variants:["400","500","600","700","800"] },
        { family:"Merriweather", category:"serif", variants:["400","700"] },
        { family:"Lora", category:"serif", variants:["400","500","600","700"] },
        { family:"Libre Baskerville", category:"serif", variants:["400","700"] },
        { family:"Crimson Text", category:"serif", variants:["400","600","700"] },
        { family:"PT Serif", category:"serif", variants:["400","700"] },
        { family:"EB Garamond", category:"serif", variants:["400","500","600","700"] },
        { family:"DM Serif Display", category:"serif", variants:["400"] },
        { family:"Bitter", category:"serif", variants:["400","500","600","700"] },
        { family:"Cormorant Garamond", category:"serif", variants:["400","500","600","700"] },
        { family:"Zilla Slab", category:"serif", variants:["400","500","600","700"] },
        { family:"Bebas Neue", category:"display", variants:["400"] },
        { family:"Anton", category:"display", variants:["400"] },
        { family:"Abril Fatface", category:"display", variants:["400"] },
        { family:"Archivo Black", category:"display", variants:["400"] },
        { family:"Alfa Slab One", category:"display", variants:["400"] },
        { family:"Righteous", category:"display", variants:["400"] },
        { family:"Lobster", category:"display", variants:["400"] },
        { family:"Pacifico", category:"display", variants:["400"] },
        { family:"Orbitron", category:"display", variants:["400","500","600","700"] },
        { family:"Teko", category:"display", variants:["400","500","600","700"] },
        { family:"Permanent Marker", category:"display", variants:["400"] },
        { family:"Shadows Into Light", category:"display", variants:["400"] },
        { family:"Exo 2", category:"display", variants:["400","500","600","700"] },
        { family:"Comfortaa", category:"display", variants:["400","500","600","700"] },
        { family:"Titillium Web", category:"display", variants:["400","600","700"] },
        { family:"Dancing Script", category:"handwriting", variants:["400","500","600","700"] },
        { family:"Caveat", category:"handwriting", variants:["400","500","600","700"] },
        { family:"Kalam", category:"handwriting", variants:["400","700"] },
        { family:"Satisfy", category:"handwriting", variants:["400"] },
        { family:"Indie Flower", category:"handwriting", variants:["400"] },
        { family:"Patrick Hand", category:"handwriting", variants:["400"] },
        { family:"Great Vibes", category:"handwriting", variants:["400"] },
        { family:"Sacramento", category:"handwriting", variants:["400"] },
        { family:"JetBrains Mono", category:"monospace", variants:["400","500","600","700"] },
        { family:"Fira Code", category:"monospace", variants:["400","500","600","700"] },
        { family:"Source Code Pro", category:"monospace", variants:["400","500","600","700"] },
        { family:"IBM Plex Mono", category:"monospace", variants:["400","500","600","700"] },
        { family:"Space Mono", category:"monospace", variants:["400","700"] },
        { family:"Red Hat Mono", category:"monospace", variants:["400","500","600","700"] },
        { family:"Courier Prime", category:"monospace", variants:["400","700"] },
        { family:"Inconsolata", category:"monospace", variants:["400","500","600","700"] },
        { family:"Ubuntu", category:"sans-serif", variants:["400","500","700"] },
        { family:"Noto Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Josefin Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Arimo", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Cabin", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Mulish", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Red Hat Display", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Schibsted Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Familjen Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Albert Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Kumbh Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Geist", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Instrument Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Inter Tight", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Exo", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Maven Pro", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Jost", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Overpass", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Spline Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Commissioner", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Hanken Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Readex Pro", category:"sans-serif", variants:["400","500","600","700"] },
      ];

      const search = (params.search || "").toLowerCase();
      const category = params.category || "";
      const limit = Math.min(params.limit || 20, 100);

      let results = GOOGLE_FONTS;
      if (category) results = results.filter(f => f.category === category);
      if (search) {
        results = results.filter(f =>
          f.family.toLowerCase().includes(search) ||
          f.category.toLowerCase().includes(search)
        );
      }

      const total = results.length;
      results = results.slice(0, limit);

      const enriched = results.map(f => ({
        ...f,
        googleFontsUrl: `https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}:wght@${f.variants.join(";")}&display=swap`,
      }));

      return { fonts: enriched, total, categories: [...new Set(GOOGLE_FONTS.map(f => f.category))] };
    }

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

export const handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  // Rate limiting
  const clientIp = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify(jsonRpcError(null, -32000, "Rate limit exceeded. Try again in 60 seconds.")),
    };
  }

  const userId = getUserId(event);

  // SSE initialization (GET)
  if (event.httpMethod === "GET") {
    const sseBody = "event: endpoint\r\ndata: /mcp\r\n\r\n";
    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: sseBody,
    };
  }

  // JSON-RPC (POST)
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify(jsonRpcError(null, -32600, "Method not allowed")) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify(jsonRpcError(null, -32700, "Parse error")) };
  }

  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== "2.0") {
    return { statusCode: 400, headers, body: JSON.stringify(jsonRpcError(id, -32600, "Invalid Request")) };
  }

  // MCP lifecycle methods
  if (method === "initialize") {
    return {
      statusCode: 200, headers,
      body: JSON.stringify(jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "futuraria-mcp", version: "1.0.0" },
      })),
    };
  }

  if (method === "notifications/initialized") {
    return { statusCode: 200, headers, body: JSON.stringify(jsonRpcResult(id, {})) };
  }

  if (method === "tools/list") {
    return {
      statusCode: 200, headers,
      body: JSON.stringify(jsonRpcResult(id, { tools: MCP_TOOLS })),
    };
  }

  if (method === "tools/call") {
    try {
      const result = await handleMethod(params.name, params.arguments || {}, userId);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        statusCode: 200, headers,
        body: JSON.stringify(jsonRpcResult(id, { content: [{ type: "text", text }] })),
      };
    } catch (e) {
      const err = e?.code ? e : { code: -32000, message: e?.message || "Internal error" };
      return {
        statusCode: 200, headers,
        body: JSON.stringify(jsonRpcError(id, err.code, err.message)),
      };
    }
  }

  // Unknown method
  return {
    statusCode: 200, headers,
    body: JSON.stringify(jsonRpcError(id, -32601, `Method not found: ${method}`)),
  };
};
