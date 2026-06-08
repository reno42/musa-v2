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
        transparent: {
          type: "boolean",
          description: "Render with transparent background instead of white (default false)",
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
        blendMode: { type: "string", enum: ["source-over", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "difference", "exclusion"], description: "CSS globalCompositeOperation blend mode" },
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
        parentFrameId: { type: "string", description: "Optional parent frame ID for nested frames" },
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
    name: "render_frame",
    description: "Render a single frame to a viewable image URL (PNG/JPG/SVG). Returns the render URL that can be opened in a browser.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to render" },
        format: { type: "string", enum: ["png", "jpg", "svg"], description: "Output format (default png)" },
        scale: { type: "number", description: "Render scale 1-4 (default 1)" },
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
  {
    name: "set_gradient",
    description: "Apply a linear, radial, or angular gradient fill to an object. Specify type, angle (for linear), and multiple color stops with offsets.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Layer name to apply gradient to" },
        frameId: { type: "string", description: "Optional frame ID" },
        type: { type: "string", enum: ["linear", "radial"], description: "Gradient type" },
        angle: { type: "number", description: "Angle in degrees for linear gradients (default 135)" },
        colorStops: { type: "array", items: { type: "object", properties: { offset: { type: "number" }, color: { type: "string" } } }, description: "Array of {offset: 0-1, color: '#hex'} stops" },
      },
      required: ["templateId", "targetLayerName", "type", "colorStops"],
    },
  },
  {
    name: "set_shadow",
    description: "Apply drop shadow or inner shadow to an object with color, blur, offset, and spread.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Layer name to apply shadow to" },
        frameId: { type: "string", description: "Optional frame ID" },
        color: { type: "string", description: "Shadow color hex (default #000000)" },
        blur: { type: "number", description: "Blur radius in px (default 4)" },
        offsetX: { type: "number", description: "Horizontal offset in px (default 2)" },
        offsetY: { type: "number", description: "Vertical offset in px (default 2)" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "image_filter",
    description: "Apply CSS-like filters to an image layer: brightness, contrast, saturation, blur, grayscale, sepia, hue-rotate, invert.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Image layer name to filter" },
        frameId: { type: "string", description: "Optional frame ID" },
        brightness: { type: "number", description: "Brightness multiplier (1 = normal, 0 = black, 2 = double)" },
        contrast: { type: "number", description: "Contrast multiplier (1 = normal)" },
        saturation: { type: "number", description: "Saturation multiplier (1 = normal, 0 = grayscale)" },
        blur: { type: "number", description: "Blur radius in px (0 = none)" },
        grayscale: { type: "number", description: "Grayscale amount 0-1" },
        sepia: { type: "number", description: "Sepia amount 0-1" },
        hueRotate: { type: "number", description: "Hue rotation in degrees" },
        invert: { type: "number", description: "Invert amount 0-1" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "image_crop",
    description: "Crop an image layer by setting cropX, cropY, width, and height properties.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Image layer name to crop" },
        frameId: { type: "string", description: "Optional frame ID" },
        cropX: { type: "number", description: "Crop origin X (default 0)" },
        cropY: { type: "number", description: "Crop origin Y (default 0)" },
        width: { type: "number", description: "Crop width in px" },
        height: { type: "number", description: "Crop height in px" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "add_block",
    description: "Add a document block: header, paragraph, bullet list, toggle, callout, or quote. These render as styled text blocks on the canvas.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        blockType: { type: "string", enum: ["header", "subheader", "paragraph", "bullet_list", "toggle", "callout", "quote"], description: "Block type" },
        text: { type: "string", description: "Text content (for bullet_list, separate with \n)" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Max width in px (default 600)" },
        fontSize: { type: "number", description: "Font size override" },
        color: { type: "string", description: "Text color (default #e4e4f0)" },
        fontFamily: { type: "string", description: "Font family (default Inter)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "blockType", "text"],
    },
  },
  {
    name: "add_code_block",
    description: "Add a code block with monospace font, dark background, and optional language label.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        code: { type: "string", description: "Code content" },
        language: { type: "string", description: "Language label (e.g. 'javascript', 'python', 'css')" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 600)" },
        fontSize: { type: "number", description: "Font size (default 14)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "code"],
    },
  },
  {
    name: "add_table",
    description: "Add an editable table with headers and rows. Renders as styled rects + text objects.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        headers: { type: "array", items: { type: "string" }, description: "Column header names" },
        rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Row data as array of string arrays" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        colWidths: { type: "array", items: { type: "number" }, description: "Column widths in px (default 120 each)" },
        rowHeight: { type: "number", description: "Row height in px (default 36)" },
        fontSize: { type: "number", description: "Font size (default 13)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "headers", "rows"],
    },
  },
  {
    name: "embed_video",
    description: "Embed a YouTube or Vimeo video as a placeholder frame with URL metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        url: { type: "string", description: "YouTube or Vimeo video URL" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 640)" },
        height: { type: "number", description: "Height in px (default 360)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "url"],
    },
  },
  {
    name: "embed_figma",
    description: "Embed a Figma file or frame as a placeholder with link metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        figmaUrl: { type: "string", description: "Figma file or frame URL" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 640)" },
        height: { type: "number", description: "Height in px (default 480)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "figmaUrl"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a specific object or position on the canvas. Comments are stored in template metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        text: { type: "string", description: "Comment text" },
        targetLayerName: { type: "string", description: "Layer name to attach comment to (optional)" },
        x: { type: "number", description: "X position for canvas-level comment" },
        y: { type: "number", description: "Y position for canvas-level comment" },
        author: { type: "string", description: "Comment author name (default 'Anonymous')" },
        resolved: { type: "boolean", description: "Mark as resolved (default false)" },
      },
      required: ["templateId", "text"],
    },
  },
  {
    name: "share_template",
    description: "Generate a shareable link for a template with optional permissions (view, comment, edit).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to share" },
        permission: { type: "string", enum: ["view", "comment", "edit"], description: "Access level (default view)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "set_blur",
    description: "Apply a gaussian blur effect to a layer. For background blur (frosted glass), use image_filter with blur on a background object.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Layer name to apply blur to" },
        blur: { type: "number", description: "Blur radius in pixels (0-50, default 8)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "preview_font",
    description: "Render a font preview on the canvas showing the font family name at large size and a sample pangram in that typeface.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        fontFamily: { type: "string", description: "Google Font family name (e.g. 'Inter', 'Roboto', 'Playfair Display')" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 600)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "fontFamily"],
    },
  },
  {
    name: "add_columns",
    description: "Add a multi-column layout with equal-width columns. Each column gets styled text objects with optional headers.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        columns: { type: "number", description: "Number of columns (2-6, default 2)" },
        columnTexts: { type: "array", items: { type: "string" }, description: "Text content for each column" },
        headers: { type: "array", items: { type: "string" }, description: "Optional header text for each column" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Total width in px (default 720)" },
        gap: { type: "number", description: "Gap between columns in px (default 16)" },
        fontSize: { type: "number", description: "Body font size (default 14)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "columnTexts"],
    },
  },
  {
    name: "embed_audio",
    description: "Embed an audio player placeholder for SoundCloud, Spotify, or direct audio URLs. Renders as a sleek audio card.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        url: { type: "string", description: "Audio URL (SoundCloud, Spotify, or direct .mp3 link)" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 480)" },
        height: { type: "number", description: "Height in px (default 80)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "url"],
    },
  },
  {
    name: "embed_pdf",
    description: "Embed a PDF document as a placeholder with file metadata. Requires a PDF URL accessible from Supabase Storage or external CDN.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        url: { type: "string", description: "PDF file URL" },
        title: { type: "string", description: "Document title (default extracted from URL)" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 480)" },
        height: { type: "number", description: "Height in px (default 320)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "url"],
    },
  },
  {
    name: "embed_social",
    description: "Embed a social media post placeholder (Twitter/X, GitHub repo, Instagram, LinkedIn). Auto-detects platform from URL.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        url: { type: "string", description: "Social media post URL" },
        platform: { type: "string", enum: ["twitter", "github", "instagram", "linkedin"], description: "Platform (auto-detected if omitted)" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 480)" },
        height: { type: "number", description: "Height in px (default 200)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "url"],
    },
  },
  {
    name: "mention_user",
    description: "Add an @mention annotation to an object or canvas position. Stored as a styled comment with the mention data.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        username: { type: "string", description: "Username to mention (e.g. 'lara', '@lara' — @ prefix added if missing)" },
        targetLayerName: { type: "string", description: "Layer name to attach mention to (optional)" },
        x: { type: "number", description: "X position for canvas-level mention" },
        y: { type: "number", description: "Y position for canvas-level mention" },
        message: { type: "string", description: "Optional message text with the mention" },
      },
      required: ["templateId", "username"],
    },
  },
  {
    name: "ai_generate_text",
    description: "Generate AI text content using OpenRouter (GPT-4o-mini). Requires OPENROUTER_API_KEY env var. Optionally adds generated text to canvas.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text generation prompt" },
        templateId: { type: "string", description: "Optional template ID to add generated text to" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Text width in px (default 600)" },
        fontSize: { type: "number", description: "Font size (default 16)" },
        systemPrompt: { type: "string", description: "Custom system prompt (default: 'You are a design assistant')" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ai_generate_image",
    description: "Generate an AI image via OpenRouter (model-agnostic) and optionally add it to the canvas. Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image generation prompt" },
        templateId: { type: "string", description: "Optional template ID to add generated image to" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Image width in px (default 512)" },
        height: { type: "number", description: "Image height in px (default 512)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ai_palette",
    description: "Generate a color palette (5-7 colors) based on a theme, mood, or description using AI. Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Theme or description for the palette (e.g. 'ocean sunset', 'corporate tech', 'warm minimal')" },
        count: { type: "number", description: "Number of colors (3-9, default 6)" },
        includeNeutrals: { type: "boolean", description: "Include background/surface neutrals (default true)" },
      },
      required: ["theme"],
    },
  },
  {
    name: "ai_suggest_layout",
    description: "Analyze the current template canvas and suggest layout improvements (alignment, spacing, hierarchy). Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to analyze" },
        aspect: { type: "string", enum: ["alignment", "spacing", "hierarchy", "all"], description: "Layout aspect to analyze (default all)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "ai_translate",
    description: "Translate text on the canvas or supplied text to another language using AI. Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID whose text objects to translate" },
        targetLayerName: { type: "string", description: "Specific layer to translate (optional; translates all text objects if omitted)" },
        targetLanguage: { type: "string", description: "Target language (e.g. 'Spanish', 'French', 'Japanese'). Default: 'English'." },
        text: { type: "string", description: "Direct text to translate (alternative to templateId+layer)" },
      },
      required: [],
    },
  },
  {
    name: "create_style",
    description: "Create a reusable style (fill, stroke, text, or effect) from a layer's current properties. Styles can be applied to other layers via apply_style.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Style name (e.g. 'Primary Blue', 'Heading H1')" },
        type: { type: "string", enum: ["fill", "stroke", "text", "effect"], description: "Style type" },
        sourceLayerName: { type: "string", description: "Layer name to extract style properties from" },
        frameId: { type: "string", description: "Optional frame ID for source layer lookup" },
      },
      required: ["templateId", "name", "type", "sourceLayerName"],
    },
  },
  {
    name: "apply_style",
    description: "Apply a saved style to one or more target layers, transferring fill/stroke/text/effect properties.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        styleId: { type: "string", description: "Style ID to apply" },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Array of layer names to apply the style to" },
        frameId: { type: "string", description: "Optional frame ID for target layer lookup" },
      },
      required: ["templateId", "styleId", "targetLayerNames"],
    },
  },
  {
    name: "create_variable",
    description: "Create a design token variable (color, number, string) that can be bound to layer properties and reused across templates.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Variable name (e.g. 'primary-color', 'spacing-md')" },
        type: { type: "string", enum: ["color", "number", "string"], description: "Variable type" },
        value: { type: "string", description: "Variable value (hex for color, number as string for number, any string for string)" },
        collectionId: { type: "string", description: "Optional collection ID to group this variable" },
      },
      required: ["templateId", "name", "type", "value"],
    },
  },
  {
    name: "create_collection",
    description: "Create a variable collection with optional modes (e.g. 'Light/Dark'). Collections group related design tokens.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Collection name (e.g. 'Colors', 'Spacing', 'Typography')" },
        modes: { type: "array", items: { type: "string" }, description: "Mode names (e.g. ['Light', 'Dark']). Default: ['Default']" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "link_variable",
    description: "Bind a design token variable to a layer property, so the property value tracks the variable.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        variableId: { type: "string", description: "Variable ID to link" },
        targetLayerName: { type: "string", description: "Layer name to bind the variable to" },
        property: { type: "string", enum: ["fill", "stroke", "fontSize", "opacity", "width", "height"], description: "Property to bind" },
        frameId: { type: "string", description: "Optional frame ID for layer lookup" },
      },
      required: ["templateId", "variableId", "targetLayerName", "property"],
    },
  },
  {
    name: "export_batch",
    description: "Batch export frames or layers as PNG/SVG with configurable presets (scale, suffix, format). Renders via the render pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameIds: { type: "array", items: { type: "string" }, description: "Frame IDs to export (exports all frames if omitted)" },
        format: { type: "string", enum: ["png", "svg", "png@2x", "png@3x"], description: "Export format (default png)" },
        scale: { type: "number", description: "Scale multiplier (1, 2, 3). Overridden by format suffix." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "copy_as",
    description: "Copy a layer or selection as code: SVG markup, CSS styles, or JSON representation. Useful for developer handoff.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Layer name to export as code" },
        format: { type: "string", enum: ["svg", "css", "json"], description: "Output format (default json)" },
        frameId: { type: "string", description: "Optional frame ID for layer lookup" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "export_pdf",
    description: "Export the entire template or specific frames as a PDF document via the render pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameIds: { type: "array", items: { type: "string" }, description: "Frame IDs to include (all frames if omitted)" },
        orientation: { type: "string", enum: ["portrait", "landscape"], description: "Page orientation (default landscape)" },
        format: { type: "string", enum: ["a4", "letter", "screen"], description: "Page size (default screen = canvas size)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "canvas_grid",
    description: "Configure canvas grid settings: cell size, visibility, snap-to-grid, and color. Stored in template metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        gridSize: { type: "number", description: "Grid cell size in px (default 8)" },
        visible: { type: "boolean", description: "Show/hide grid overlay" },
        snapToGrid: { type: "boolean", description: "Enable snap-to-grid" },
        color: { type: "string", description: "Grid line color hex (default #333344)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "canvas_rulers",
    description: "Configure ruler visibility, measurement units, and guide lines on the canvas.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        visible: { type: "boolean", description: "Show/hide rulers" },
        units: { type: "string", enum: ["px", "pt", "in", "mm", "cm"], description: "Ruler measurement units (default px)" },
        guides: { type: "array", items: { type: "object", properties: { axis: { type: "string", enum: ["x", "y"] }, position: { type: "number" } } }, description: "Guide lines [{ axis: 'x'|'y', position: px }]" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "canvas_snap",
    description: "Configure snap behavior: snap-to-object, snap-to-grid, and snap threshold distance.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        snapToObject: { type: "boolean", description: "Enable snap to other objects (edges/centers)" },
        snapToGrid: { type: "boolean", description: "Enable snap to grid" },
        snapThreshold: { type: "number", description: "Snap distance threshold in px (default 5)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "history_undo",
    description: "Undo the last canvas mutation by restoring the most recent snapshot before the current state. Uses the snapshot store.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "history_redo",
    description: "Redo a previously undone mutation by restoring forward in the snapshot history.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "canvas_pages",
    description: "Manage multiple pages per template: add, remove, reorder, and switch the active page. Pages store independent canvas states.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        action: { type: "string", enum: ["list", "add", "remove", "set_active", "reorder"], description: "Page action" },
        pageName: { type: "string", description: "Page name (for add/set_active actions)" },
        pageId: { type: "string", description: "Page ID (for remove/set_active actions)" },
        pageIndex: { type: "number", description: "Target index (for reorder)" },
      },
      required: ["templateId", "action"],
    },
  },
  {
    name: "color_picker",
    description: "Color utilities: parse hex/rgba/hsl, generate complementary/analogous/triadic palettes, create light-dark shade gradients. Pure computation, no canvas required.",
    inputSchema: {
      type: "object",
      properties: {
        color: { type: "string", description: "Hex color (#cba6f7, #cba6f7ff, cba6f7) or rgb/rgba string" },
        action: { type: "string", enum: ["parse", "complementary", "analogous", "triadic", "shades", "gradient"], description: "Color action (default: parse)" },
        steps: { type: "number", description: "Number of steps for shades/gradient (default 5, max 20)" },
      },
      required: ["color"],
    },
  },
  {
    name: "frame_auto_layout",
    description: "Enable auto-layout on a frame: direction, gap, padding, resizing behavior (hug/fill/fixed), alignment per axis, and absolute positioning support.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to apply auto-layout to" },
        direction: { type: "string", enum: ["horizontal", "vertical"], description: "Layout direction (default horizontal)" },
        gap: { type: "number", description: "Gap between children in px (default 16)" },
        padding: { type: "number", description: "Inner padding in px (default 0)" },
        resize: { type: "string", enum: ["hug", "fill", "fixed"], description: "Resizing strategy for children (default fixed)" },
        alignPrimary: { type: "string", enum: ["start", "center", "end", "space-between"], description: "Primary axis alignment (default start)" },
        alignCounter: { type: "string", enum: ["start", "center", "end", "stretch"], description: "Counter axis alignment (default start)" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "render_markdown",
    description: "Parse markdown text and render it as styled canvas objects: headings, paragraphs, bold/italic, lists, code blocks, quotes, and dividers.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        markdown: { type: "string", description: "Markdown content to render" },
        x: { type: "number", description: "Start X position (default 0)" },
        y: { type: "number", description: "Start Y position (default 0)" },
        width: { type: "number", description: "Max content width in px (default 640)" },
        fontSize: { type: "number", description: "Base font size for body text (default 14)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "markdown"],
    },
  },
  {
    name: "gallery_create",
    description: "Create an image gallery from an array of URLs. Renders as a responsive grid of image objects with optional captions.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        images: { type: "array", items: { type: "object", properties: { url: { type: "string" }, caption: { type: "string" } } }, description: "Array of { url, caption? } objects" },
        x: { type: "number", description: "Start X position (default 0)" },
        y: { type: "number", description: "Start Y position (default 0)" },
        columns: { type: "number", description: "Images per row (default 3, max 6)" },
        imageWidth: { type: "number", description: "Width per image in px (default 200)" },
        imageHeight: { type: "number", description: "Height per image in px (default 200)" },
        gap: { type: "number", description: "Gap between images in px (default 12)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "images"],
    },
  },
  {
    name: "create_component",
    description: "Create a reusable component from selected canvas objects. Components support variants (alternative configurations) and property overrides (boolean, text, instance swap). Stored in template metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Component name (e.g. Button/Primary)" },
        description: { type: "string", description: "Optional description of the component" },
        objectIds: { type: "array", items: { type: "string" }, description: "Array of object IDs to include in the component" },
        frameId: { type: "string", description: "Optional frame ID to scope the component" },
      },
      required: ["templateId", "name", "objectIds"],
    },
  },
  {
    name: "create_instance",
    description: "Create an instance of a component. Instances inherit the component master's properties but can override specific values. Changes to the master propagate to instances that haven't overridden the changed property.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        componentId: { type: "string", description: "Component ID to instantiate" },
        x: { type: "number", description: "X position for the instance (default 0)" },
        y: { type: "number", description: "Y position for the instance (default 0)" },
        frameId: { type: "string", description: "Optional frame ID to place instance inside" },
      },
      required: ["templateId", "componentId"],
    },
  },
  {
    name: "add_variant",
    description: "Add a variant to an existing component. Variants define alternative configurations (e.g. Button/Primary, Button/Secondary, Button/Disabled) with per-property overrides.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        componentId: { type: "string", description: "Component ID to add variant to" },
        name: { type: "string", description: "Variant name (e.g. Hover, Disabled, Secondary)" },
        overrides: { type: "object", description: "Key-value overrides for object properties (e.g. { \"fill\": \"#45475a\", \"opacity\": 0.5 })" },
      },
      required: ["templateId", "componentId", "name"],
    },
  },
  {
    name: "set_component_prop",
    description: "Define or override a component property on an instance. Properties can be boolean (visible/hidden), text (label override), or instance swap (swap one nested instance for another).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        componentId: { type: "string", description: "Component ID (master definition)" },
        instanceId: { type: "string", description: "Instance ID to override (if omitted, defines on master)" },
        propName: { type: "string", description: "Property name (e.g. visible, label, iconSwap)" },
        propType: { type: "string", enum: ["boolean", "text", "instanceSwap"], description: "Property type" },
        value: { type: ["string", "boolean", "number"], description: "Property value — boolean for boolean type, string for text/instanceSwap" },
      },
      required: ["templateId", "componentId", "propName", "propType", "value"],
    },
  },
  {
    name: "add_interaction",
    description: "Add an interaction between frames or objects. Supports click-to-navigate, hover-to-overlay, press, and delay triggers with navigation, overlay, and scroll actions.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        sourceId: { type: "string", description: "Source frame or object ID that triggers the interaction" },
        trigger: { type: "string", enum: ["onClick", "onHover", "onPress", "onDelay"], description: "Trigger type (default onClick)" },
        action: { type: "string", enum: ["navigate", "overlay", "scroll", "back", "close"], description: "Action to perform (default navigate)" },
        targetId: { type: "string", description: "Target frame ID for navigation or overlay" },
        transition: { type: "string", enum: ["instant", "dissolve", "slide", "push", "smartAnimate"], description: "Transition animation (default instant)" },
        duration: { type: "number", description: "Animation duration in ms (default 300)" },
        delay: { type: "number", description: "Delay before trigger in ms (for onDelay trigger)" },
        easing: { type: "string", enum: ["easeIn", "easeOut", "easeInOut", "linear"], description: "Easing curve (default easeOut)" },
      },
      required: ["templateId", "sourceId"],
    },
  },
  {
    name: "set_animation",
    description: "Set entrance/exit animation on a frame or object. Supports dissolve, slide, smart animate, and custom easing curves.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        objectId: { type: "string", description: "Frame or object ID to animate" },
        type: { type: "string", enum: ["dissolve", "slideIn", "slideOut", "push", "smartAnimate", "fade"], description: "Animation type" },
        direction: { type: "string", enum: ["left", "right", "up", "down"], description: "Direction for slide animations" },
        duration: { type: "number", description: "Duration in ms (default 300)" },
        easing: { type: "string", enum: ["easeIn", "easeOut", "easeInOut", "linear", "spring", "bounce"], description: "Easing curve (default easeOut)" },
        delay: { type: "number", description: "Delay in ms before animation starts" },
      },
      required: ["templateId", "objectId", "type"],
    },
  },
  {
    name: "add_overlay",
    description: "Configure a frame as an overlay with positioning, backdrop, and close-on-click-outside behavior. Used for modals, tooltips, dropdowns, and slide-out panels.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to configure as overlay" },
        position: { type: "string", enum: ["center", "topLeft", "topRight", "bottomLeft", "bottomRight", "manual"], description: "Overlay position (default center)" },
        backdrop: { type: "boolean", description: "Show semi-transparent backdrop (default true)" },
        backdropColor: { type: "string", description: "Backdrop color with opacity (default rgba(0,0,0,0.5))" },
        closeOnBackdrop: { type: "boolean", description: "Close overlay when clicking backdrop (default true)" },
        manualX: { type: "number", description: "Manual X offset (for manual position)" },
        manualY: { type: "number", description: "Manual Y offset (for manual position)" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "set_scroll_position",
    description: "Set scroll behavior for frames or objects within a scrolling container. Supports fixed positioning (stays in place during scroll) and sticky positioning.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        objectId: { type: "string", description: "Frame or object ID" },
        behavior: { type: "string", enum: ["fixed", "sticky", "scroll", "auto"], description: "Scroll behavior (default auto)" },
        stickyTop: { type: "number", description: "Top offset in px for sticky positioning" },
        stickyBottom: { type: "number", description: "Bottom offset in px for sticky positioning" },
        overflow: { type: "string", enum: ["visible", "hidden", "scroll", "auto"], description: "Overflow behavior for the container (default visible)" },
      },
      required: ["templateId", "objectId", "behavior"],
    },
  },
  {
    name: "canvas_pan",
    description: "Pan the canvas viewport by delta X/Y or to an absolute position. Supports both relative and absolute panning.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        deltaX: { type: "number", description: "Horizontal pan delta in px (relative mode)" },
        deltaY: { type: "number", description: "Vertical pan delta in px (relative mode)" },
        x: { type: "number", description: "Absolute viewport X position" },
        y: { type: "number", description: "Absolute viewport Y position" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "canvas_zoom",
    description: "Zoom the canvas viewport to a specific level, by delta, or fit-to-selection. Zoom is centered on the cursor or a specific point.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        zoom: { type: "number", description: "Absolute zoom level (1 = 100%, 0.5 = 50%, 2 = 200%)" },
        delta: { type: "number", description: "Zoom delta (e.g. 0.1 = zoom in 10%, -0.1 = zoom out 10%)" },
        centerX: { type: "number", description: "Zoom center X coordinate (optional, for zoom-to-point)" },
        centerY: { type: "number", description: "Zoom center Y coordinate (optional, for zoom-to-point)" },
        fitSelection: { type: "boolean", description: "Zoom to fit all objects within viewport" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "add_toggle",
    description: "Add a toggle/accordion block with a title and collapsible content. The toggle can be expanded or collapsed by default.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        title: { type: "string", description: "Toggle title text" },
        content: { type: "string", description: "Toggle body content (supports markdown)" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Toggle width (default 400)" },
        expanded: { type: "boolean", description: "Start expanded (default false)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "title", "content"],
    },
  },
  {
    name: "add_callout",
    description: "Add a callout block with icon, background color, and text. Used for tips, warnings, info boxes, and notes — similar to Notion callouts.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        type: { type: "string", enum: ["info", "warning", "tip", "note", "success", "error"], description: "Callout type (default info)" },
        text: { type: "string", description: "Callout body text" },
        title: { type: "string", description: "Optional callout title" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Callout width (default 400)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "text"],
    },
  },
  {
    name: "add_quote",
    description: "Add a styled quote block with attribution. Renders a vertical accent bar with italic quote text and optional author caption.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        text: { type: "string", description: "Quote text" },
        author: { type: "string", description: "Optional attribution author" },
        source: { type: "string", description: "Optional source/title" },
        color: { type: "string", description: "Accent bar color (default #cba6f7)" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Quote width (default 500)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "text"],
    },
  },
  {
    name: "publish_library",
    description: "Publish a style library from a template. Collections of styles (color, text, effect, grid) can be published and imported by other templates, enabling design system reuse across projects.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Source template ID containing the styles" },
        name: { type: "string", description: "Library name (e.g. 'Brand Design System')" },
        description: { type: "string", description: "Library description" },
        styleIds: { type: "array", items: { type: "string" }, description: "Array of style IDs to include (omit to publish all)" },
        visibility: { type: "string", enum: ["workspace", "public"], description: "Visibility scope (default workspace)" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "register_tool",
    description: "Register a custom MCP tool (plugin) dynamically. Third-party tools can extend the MCP server with new functionality. Tools are validated and added to the runtime tool registry.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique tool name (must start with plugin_ prefix)" },
        description: { type: "string", description: "Tool description" },
        inputSchema: { type: "object", description: "JSON Schema for tool parameters" },
        handler: { type: "string", description: "Handler endpoint URL (webhook) that will receive tool calls" },
        secret: { type: "string", description: "Optional shared secret for webhook authentication" },
      },
      required: ["name", "description", "inputSchema", "handler"],
    },
  },
  {
    name: "auth_token",
    description: "Create a Personal Access Token (PAT) for API authentication. Tokens support scoped permissions (read, write, admin) and optional expiry. Used for headless API access and CI/CD pipelines.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID to create token for" },
        name: { type: "string", description: "Token name/label (e.g. 'CI/CD Pipeline')" },
        scopes: { type: "array", items: { type: "string", enum: ["read", "write", "admin"] }, description: "Permission scopes (default ['read'])" },
        expiresIn: { type: "number", description: "Expiry in seconds (default 31536000 = 1 year, 0 = never)" },
      },
      required: ["userId", "name"],
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

/** RGB → HSL conversion (used by color_picker) */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100) / 100, l: Math.round(l * 100) / 100 };
}

/** HSL → RGB conversion (used by color_picker) */
function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
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
      const transparent = params.transparent === true;
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
            renderParams: { format, scale, width: (tpl.width || 1080) * scale, height: (tpl.height || 1080) * scale, transparent },
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

      // Read from snapshot store (autoSnapshot creates these)
      const snapshots = store.listSnapshots(tplId) || [];
      const snapshotVersions = snapshots.map((s, i) => ({
        id: s.id || `v${i}`,
        version: i + 1,
        timestamp: s.timestamp || s.createdAt,
        label: `${s.type} · ${s.trigger}`,
        type: s.type,
        trigger: s.trigger,
        objectCount: s.objectCount,
        frameCount: s.frameCount,
      }));

      // Merge with legacy tpl.versions if any exist
      const legacyVersions = (tpl.versions || []).map((v, i) => ({
        id: v.id || `v${i}`,
        version: snapshotVersions.length + i + 1,
        timestamp: v.timestamp || v.createdAt,
        label: v.label || `Version ${i + 1}`,
        canvasHash: v.canvasHash || "",
      }));

      const allVersions = [...snapshotVersions, ...legacyVersions];
      return {
        templateId: tplId,
        versions: allVersions,
        total: allVersions.length,
      };
    }
    case "restore_version": {
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.getTemplate(tplId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };

      // Try snapshot store first
      const snapshot = store.getSnapshot(tplId, params.versionId);
      if (snapshot && snapshot.data) {
        const restored = await templates.updateTemplate(tplId, { canvas: snapshot.data.canvas });
        return {
          restored: true,
          templateId: tplId,
          versionId: params.versionId,
          template: restored,
        };
      }

      // Fallback to legacy tpl.versions
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

      // Map blendMode to Fabric.js globalCompositeOperation
      if (rest.blendMode !== undefined) {
        rest.globalCompositeOperation = rest.blendMode;
        delete rest.blendMode;
      }

      Object.assign(obj, rest);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return obj;
    }

    // ── draw_shape ──
    case "draw_shape": {
      const VALID_TOOLS = ["rect", "ellipse", "line", "triangle", "star", "polygon"];
      if (!VALID_TOOLS.includes(params.tool))
        throw { code: -32602, message: `Invalid tool type: ${params.tool}. Must be one of: ${VALID_TOOLS.join(", ")}` };

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
      const padding = params.padding || 0;
      const resize = params.resize || "fixed";
      const alignPrimary = params.alignPrimary || "start";
      const alignCounter = params.alignCounter || "start";

      // Calculate bounds and total size
      let totalSize = padding;
      for (const obj of targets) {
        totalSize += (dir === "horizontal" ? (obj.width || 0) * (obj.scaleX || 1) : (obj.height || 0) * (obj.scaleY || 1)) + gap;
      }
      totalSize -= gap; // remove trailing gap
      totalSize += padding;

      const startX = targets[0].left;
      const startY = targets[0].top;
      let curX = startX + padding;
      let curY = startY + padding;

      // Measure counter-axis extremes
      let maxCounter = 0;
      for (const obj of targets) {
        const cs = dir === "horizontal" ? (obj.height || 0) * (obj.scaleY || 1) : (obj.width || 0) * (obj.scaleX || 1);
        if (cs > maxCounter) maxCounter = cs;
      }

      for (const obj of targets) {
        // Primary axis positioning
        obj.left = curX;
        obj.top = curY;

        const pw = (obj.width || 0) * (obj.scaleX || 1);
        const ph = (obj.height || 0) * (obj.scaleY || 1);

        // Counter axis alignment
        if (dir === "horizontal") {
          if (alignCounter === "center") obj.top = curY + (maxCounter - ph) / 2;
          else if (alignCounter === "end") obj.top = curY + maxCounter - ph;
          else if (alignCounter === "stretch") { obj.height = maxCounter / (obj.scaleY || 1); obj.scaleY = 1; }
        } else {
          if (alignCounter === "center") obj.left = curX + (maxCounter - pw) / 2;
          else if (alignCounter === "end") obj.left = curX + maxCounter - pw;
          else if (alignCounter === "stretch") { obj.width = maxCounter / (obj.scaleX || 1); obj.scaleX = 1; }
        }

        // Resize: fill extends last child to fill remaining space
        if (resize === "fill" && obj === targets[targets.length - 1]) {
          // Fill remaining width/height (based on container — not implemented here as no explicit container)
        }

        if (dir === "horizontal") {
          const spacing = alignPrimary === "space-between" && targets.length > 1
            ? gap + (totalSize - padding * 2 - targets.reduce((s, t) => s + (t.width || 0) * (t.scaleX || 1), 0)) / (targets.length - 1)
            : gap;
          curX += pw + spacing;
        } else {
          curY += ph + gap;
        }
      }

      // Store layout metadata on objects
      for (const obj of targets) {
        obj.layoutDirection = dir;
        obj.layoutGap = gap;
        obj.layoutResize = resize;
      }

      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { direction: dir, gap, padding, resize, alignPrimary, alignCounter, affected: targets.length };
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
      for (const obj of (tpl.canvas?.objects || [])) scan(obj);
      for (const frame of (tpl.frames || [])) for (const obj of (frame.objects || [])) scan(obj);

      const fonts = Object.entries(fontMap)
        .map(([family, info]) => ({ family, count: info.count, sizes: [...info.sizes].sort((a, b) => a - b), weights: [...info.weights] }))
        .sort((a, b) => b.count - a.count);
      return { fonts, total: fonts.length };
    }

    // ── create_frame ──
    case "create_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      // 1. Create frame metadata DIRECTLY on tpl (bypass store cold-start issue)
      const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const frame = {
        id: frameId,
        templateId: params.templateId,
        name: params.name,
        x: params.x || 0, y: params.y || 0,
        width: params.width || 400, height: params.height || 300,
        fill: params.fill || "#ffffff",
        opacity: 1, order: (tpl.frames || []).length,
        objects: [],
        parentFrameId: params.parentFrameId || null,
      };
      if (!tpl.frames) tpl.frames = [];
      tpl.frames.push(frame);

      // 2. Create visual object in canvas.objects
      const visualObj = {
        type: "rect",
        layerName: `frame_visual_${frameId}`,
        frameId,
        isFrameVisual: true,
        frameName: frame.name,
        frameFill: frame.fill,
        left: frame.x, top: frame.y,
        width: frame.width, height: frame.height,
        fill: frame.fill,
        stroke: "#6366f1", strokeWidth: 1,
        rx: 0, ry: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
      };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      if (!tpl.canvas.objects) tpl.canvas.objects = [];
      tpl.canvas.objects.push(visualObj);

      // 3. Persist in one operation
      await templates.updateTemplate(params.templateId, {
        frames: tpl.frames,
        canvas: tpl.canvas,
      });
      autoSnapshot(params.templateId, "create_frame");

      // 4. Return frameId consistently (BUG-011 fix)
      return {
        frameId,
        name: frame.name,
        x: frame.x, y: frame.y,
        width: frame.width, height: frame.height,
        fill: frame.fill,
        parentFrameId: frame.parentFrameId,
      };
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

    // ── set_gradient ──
    case "set_gradient": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const stops = params.colorStops.map((s, i) => ({
        offset: Math.max(0, Math.min(1, s.offset ?? i / (params.colorStops.length - 1))),
        color: s.color || "#cccccc",
      })).sort((a, b) => a.offset - b.offset);
      const angle = params.angle ?? 135;
      const rad = angle * Math.PI / 180;
      const coords = params.type === "radial"
        ? { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }
        : { x1: 0.5 - 0.5 * Math.cos(rad), y1: 0.5 - 0.5 * Math.sin(rad), x2: 0.5 + 0.5 * Math.cos(rad), y2: 0.5 + 0.5 * Math.sin(rad) };
      obj.fill = { type: params.type, gradientUnits: "percentage", coords, colorStops: stops };
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { applied: true, targetLayerName: params.targetLayerName, type: params.type, stops: stops.length };
    }

    // ── set_shadow ──
    case "set_shadow": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      obj.shadow = {
        color: params.color || "#000000",
        blur: params.blur ?? 4,
        offsetX: params.offsetX ?? 2,
        offsetY: params.offsetY ?? 2,
        affectStroke: false,
        nonScaling: false,
      };
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { applied: true, targetLayerName: params.targetLayerName, shadow: obj.shadow };
    }

    // ── image_filter ──
    case "image_filter": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const filters = [];
      const f = params;
      if (f.brightness !== undefined) filters.push({ type: "brightness", brightness: f.brightness });
      if (f.contrast !== undefined) filters.push({ type: "contrast", contrast: f.contrast });
      if (f.saturation !== undefined) filters.push({ type: "saturation", saturation: f.saturation });
      if (f.blur !== undefined) filters.push({ type: "blur", blur: f.blur });
      if (f.grayscale !== undefined) filters.push({ type: "grayscale", grayscale: f.grayscale });
      if (f.sepia !== undefined) filters.push({ type: "sepia", sepia: f.sepia });
      if (f.hueRotate !== undefined) filters.push({ type: "hueRotate", rotation: f.hueRotate });
      if (f.invert !== undefined) filters.push({ type: "invert", invert: f.invert });
      obj.filters = filters.length > 0 ? filters : undefined;
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { applied: true, targetLayerName: params.targetLayerName, filters: obj.filters?.length || 0 };
    }

    // ── image_crop ──
    case "image_crop": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      if (params.cropX !== undefined) obj.cropX = params.cropX;
      if (params.cropY !== undefined) obj.cropY = params.cropY;
      if (params.width !== undefined) obj.width = params.width;
      if (params.height !== undefined) obj.height = params.height;
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { cropped: true, targetLayerName: params.targetLayerName, cropX: obj.cropX, cropY: obj.cropY, width: obj.width, height: obj.height };
    }

    // ── F3: Document Blocks / Media / Collaboration ──
    case "add_block": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const text = params.text || "";
      const blockType = params.blockType || "paragraph";
      const styleMap = {
        header: { fontSize: 28, fontWeight: "bold", lineHeight: 1.2 },
        subheader: { fontSize: 22, fontWeight: "600", lineHeight: 1.3 },
        paragraph: { fontSize: 16, fontWeight: "normal", lineHeight: 1.5 },
        bullet_list: { fontSize: 16, fontWeight: "normal", lineHeight: 1.5 },
        toggle: { fontSize: 16, fontWeight: "600", lineHeight: 1.4 },
        callout: { fontSize: 15, fontWeight: "normal", lineHeight: 1.5 },
        quote: { fontSize: 18, fontWeight: "italic", lineHeight: 1.5 },
      };
      const s = styleMap[blockType] || styleMap.paragraph;
      let displayText = text;
      if (blockType === "bullet_list") {
        displayText = text.split("\n").map(line => `• ${line}`).join("\n");
      } else if (blockType === "toggle") {
        displayText = `▸ ${text}`;
      } else if (blockType === "quote") {
        displayText = `| ${text}`;
      } else if (blockType === "callout") {
        displayText = `💡 ${text}`;
      }
      const obj = {
        type: "text",
        layerName: `${blockType}_${Date.now()}`,
        text: displayText,
        left: params.x ?? 0,
        top: params.y ?? 0,
        width: params.width ?? 600,
        fontSize: params.fontSize ?? s.fontSize,
        fontFamily: params.fontFamily ?? "Inter",
        fill: params.color ?? "#e4e4f0",
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        frameId: params.frameId || undefined,
        blockType,
      };
      if (blockType === "callout") {
        obj.background = "rgba(99,130,255,0.12)";
        obj.rx = 8; obj.ry = 8;
        obj.padding = 12;
      }
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      tpl.canvas.objects.push(obj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, layerName: obj.layerName, blockType, text: text.substring(0, 80) };
    }

    case "add_code_block": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const code = params.code || "";
      const lang = params.language || "plain";
      const lines = code.split("\n");
      const fontSize = params.fontSize ?? 14;
      const lineHeight = fontSize * 1.5;
      const bgHeight = lines.length * lineHeight + 40;
      const w = params.width ?? 600;
      const bgObj = {
        type: "rect",
        layerName: `code_bg_${Date.now()}`,
        left: params.x ?? 0,
        top: params.y ?? 0,
        width: w,
        height: bgHeight,
        fill: "#1e1e2e",
        rx: 8, ry: 8,
        frameId: params.frameId || undefined,
      };
      const labelObj = {
        type: "text",
        layerName: `code_label_${Date.now()}`,
        text: lang.toUpperCase(),
        left: (params.x ?? 0) + 12,
        top: (params.y ?? 0) + 6,
        fontSize: 11,
        fontFamily: "JetBrains Mono, monospace",
        fill: "#6c7086",
        frameId: params.frameId || undefined,
      };
      const codeObj = {
        type: "text",
        layerName: `code_text_${Date.now()}`,
        text: code,
        left: (params.x ?? 0) + 12,
        top: (params.y ?? 0) + 26,
        fontSize,
        fontFamily: "JetBrains Mono, monospace",
        fill: "#cdd6f4",
        lineHeight: 1.5,
        frameId: params.frameId || undefined,
      };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      tpl.canvas.objects.push(bgObj, labelObj, codeObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, language: lang, lines: lines.length, layerName: codeObj.layerName };
    }

    case "add_table": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const headers = params.headers || [];
      const rows = params.rows || [];
      const colWidths = params.colWidths || headers.map(() => 120);
      while (colWidths.length < headers.length) colWidths.push(120);
      const rowH = params.rowHeight ?? 36;
      const fontSize = params.fontSize ?? 13;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const objects = [];
      // Header row
      let cx = x;
      for (let ci = 0; ci < headers.length; ci++) {
        const cw = colWidths[ci] || 120;
        objects.push({
          type: "rect", layerName: `th_bg_${ci}_${Date.now()}`,
          left: cx, top: y, width: cw, height: rowH,
          fill: "#313244", stroke: "#45475a", strokeWidth: 1,
          frameId: params.frameId || undefined,
        });
        objects.push({
          type: "text", layerName: `th_txt_${ci}_${Date.now()}`,
          text: String(headers[ci] || ""),
          left: cx + 8, top: y + (rowH - fontSize) / 2,
          fontSize, fontFamily: "Inter", fontWeight: "bold", fill: "#cdd6f4",
          frameId: params.frameId || undefined,
        });
        cx += cw;
      }
      // Data rows
      for (let ri = 0; ri < rows.length; ri++) {
        cx = x;
        const ry = y + (ri + 1) * rowH;
        for (let ci = 0; ci < headers.length; ci++) {
          const cw = colWidths[ci] || 120;
          objects.push({
            type: "rect", layerName: `td_bg_${ri}_${ci}_${Date.now()}`,
            left: cx, top: ry, width: cw, height: rowH,
            fill: ri % 2 === 0 ? "#1e1e2e" : "#181825", stroke: "#45475a", strokeWidth: 1,
            frameId: params.frameId || undefined,
          });
          objects.push({
            type: "text", layerName: `td_txt_${ri}_${ci}_${Date.now()}`,
            text: String((rows[ri] && rows[ri][ci]) ?? ""),
            left: cx + 8, top: ry + (rowH - fontSize) / 2,
            fontSize, fontFamily: "Inter", fill: "#bac2de",
            frameId: params.frameId || undefined,
          });
          cx += cw;
        }
      }
      tpl.canvas.objects.push(...objects);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, headers: headers.length, rows: rows.length, totalObjects: objects.length };
    }

    case "embed_video": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const w = params.width ?? 640;
      const h = params.height ?? 360;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      // YouTube thumbnail URL fallback
      let thumbUrl = null;
      const ytMatch = params.url.match(/(?:youtu\.be\/|watch\?v=)([\w-]{11})/);
      const vimeoMatch = params.url.match(/vimeo\.com\/(\d+)/);
      if (ytMatch) thumbUrl = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const bgObj = {
        type: "rect", layerName: `video_bg_${Date.now()}`,
        left: x, top: y, width: w, height: h,
        fill: "#181825", stroke: "#45475a", strokeWidth: 2, rx: 12, ry: 12,
        frameId: params.frameId || undefined,
        embedType: "video", embedUrl: params.url,
      };
      const playObj = {
        type: "text", layerName: `video_play_${Date.now()}`,
        text: "▶",
        left: x + w / 2 - 20, top: y + h / 2 - 20,
        fontSize: 40, fontFamily: "Inter", fill: "#cdd6f4",
        frameId: params.frameId || undefined,
      };
      const labelObj = {
        type: "text", layerName: `video_label_${Date.now()}`,
        text: params.url.substring(0, 60),
        left: x + 12, top: y + h - 24,
        fontSize: 11, fontFamily: "Inter", fill: "#6c7086",
        frameId: params.frameId || undefined,
      };
      tpl.canvas.objects.push(bgObj);
      if (thumbUrl) {
        const thumbObj = {
          type: "image", layerName: `video_thumb_${Date.now()}`,
          src: thumbUrl, left: x, top: y, width: w, height: h, opacity: 0.6,
          frameId: params.frameId || undefined,
        };
        tpl.canvas.objects.push(thumbObj);
      }
      tpl.canvas.objects.push(playObj, labelObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, url: params.url, width: w, height: h, hasThumbnail: !!thumbUrl };
    }

    case "embed_figma": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const w = params.width ?? 640;
      const h = params.height ?? 480;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const bgObj = {
        type: "rect", layerName: `figma_bg_${Date.now()}`,
        left: x, top: y, width: w, height: h,
        fill: "#1e1e2e", stroke: "#a6e3a1", strokeWidth: 2, rx: 12, ry: 12,
        frameId: params.frameId || undefined,
        embedType: "figma", embedUrl: params.figmaUrl,
      };
      const iconObj = {
        type: "text", layerName: `figma_icon_${Date.now()}`,
        text: "⬡",
        left: x + w / 2 - 18, top: y + h / 2 - 30,
        fontSize: 36, fontFamily: "Inter", fill: "#a6e3a1",
        frameId: params.frameId || undefined,
      };
      const labelObj = {
        type: "text", layerName: `figma_label_${Date.now()}`,
        text: params.figmaUrl.substring(0, 60),
        left: x + 12, top: y + h - 24,
        fontSize: 11, fontFamily: "Inter", fill: "#6c7086",
        frameId: params.frameId || undefined,
      };
      tpl.canvas.objects.push(bgObj, iconObj, labelObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, figmaUrl: params.figmaUrl, width: w, height: h };
    }

    case "add_comment": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.comments) tpl.comments = [];
      const comment = {
        id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: params.author || "anonymous",
        text: params.text,
        targetLayerName: params.targetLayerName || null,
        x: params.x ?? 0,
        y: params.y ?? 0,
        resolved: params.resolved ?? false,
        createdAt: new Date().toISOString(),
      };
      tpl.comments.push(comment);
      await templates.updateTemplate(params.templateId, { comments: tpl.comments });
      autoSnapshot(params.templateId, method);
      return { created: true, commentId: comment.id, totalComments: tpl.comments.length };
    }

    case "share_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const permission = params.permission || "view";
      const shareToken = `shr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const shareUrl = `https://futuraria.app/share/${shareToken}`;
      if (!tpl.metadata) tpl.metadata = {};
      tpl.metadata.shareToken = shareToken;
      tpl.metadata.sharePermission = permission;
      tpl.metadata.shareUrl = shareUrl;
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { shared: true, shareUrl, permission, shareToken };
    }

    case "set_blur": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const blurRadius = params.blur ?? 8;
      if (!obj.filters) obj.filters = [];
      const existingIdx = obj.filters.findIndex(f => f.type === "blur");
      if (blurRadius <= 0) {
        if (existingIdx >= 0) obj.filters.splice(existingIdx, 1);
        obj.filters = obj.filters.length > 0 ? obj.filters : undefined;
      } else {
        const blurFilter = { type: "blur", blur: Math.min(50, Math.max(0, blurRadius)) };
        if (existingIdx >= 0) obj.filters[existingIdx] = blurFilter;
        else obj.filters.push(blurFilter);
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { applied: true, targetLayerName: params.targetLayerName, blur: blurRadius };
    }

    case "preview_font": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const fontFamily = params.fontFamily || "Inter";
      const pangram = "The quick brown fox jumps over the lazy dog";
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const titleObj = {
        type: "text", layerName: `font_title_${Date.now()}`,
        text: fontFamily,
        left: params.x ?? 0, top: params.y ?? 0,
        width: params.width ?? 600,
        fontSize: 36, fontFamily, fontWeight: "bold", fill: "#cdd6f4",
        frameId: params.frameId || undefined,
      };
      const sampleObj = {
        type: "text", layerName: `font_sample_${Date.now()}`,
        text: pangram,
        left: params.x ?? 0, top: (params.y ?? 0) + 50,
        width: params.width ?? 600,
        fontSize: 18, fontFamily, fontWeight: "normal", fill: "#bac2de",
        frameId: params.frameId || undefined,
      };
      tpl.canvas.objects.push(titleObj, sampleObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, fontFamily, layerName: sampleObj.layerName };
    }

    case "add_columns": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const texts = params.columnTexts || [];
      const headers = params.headers || [];
      const numCols = Math.max(2, Math.min(6, params.columns || texts.length || 2));
      const totalW = params.width ?? 720;
      const gap = params.gap ?? 16;
      const colW = (totalW - gap * (numCols - 1)) / numCols;
      const fontSize = params.fontSize ?? 14;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const objects = [];
      for (let i = 0; i < numCols; i++) {
        const cx = x + i * (colW + gap);
        const header = headers[i] || null;
        const text = texts[i] || "";
        let cy = y;
        if (header) {
          objects.push({
            type: "text", layerName: `col_hdr_${i}_${Date.now()}`,
            text: header,
            left: cx, top: cy,
            width: colW - 8,
            fontSize: fontSize + 4, fontFamily: "Inter", fontWeight: "bold", fill: "#cdd6f4",
            frameId: params.frameId || undefined,
          });
          cy += fontSize + 20;
        }
        objects.push({
          type: "text", layerName: `col_body_${i}_${Date.now()}`,
          text,
          left: cx, top: cy,
          width: colW - 8,
          fontSize, fontFamily: "Inter", lineHeight: 1.6, fill: "#bac2de",
          frameId: params.frameId || undefined,
        });
      }
      tpl.canvas.objects.push(...objects);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, columns: numCols, totalObjects: objects.length };
    }

    case "embed_audio": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const w = params.width ?? 480;
      const h = params.height ?? 80;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      let platformHint = "audio";
      if (params.url.includes("soundcloud")) platformHint = "SoundCloud";
      else if (params.url.includes("spotify")) platformHint = "Spotify";
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const bgObj = {
        type: "rect", layerName: `audio_bg_${Date.now()}`,
        left: x, top: y, width: w, height: h,
        fill: "#1e1e2e", stroke: "#cba6f7", strokeWidth: 2, rx: 10, ry: 10,
        frameId: params.frameId || undefined,
        embedType: "audio", embedUrl: params.url,
      };
      const iconObj = {
        type: "text", layerName: `audio_icon_${Date.now()}`,
        text: "♪",
        left: x + 14, top: y + (h - 28) / 2,
        fontSize: 28, fontFamily: "Inter", fill: "#cba6f7",
        frameId: params.frameId || undefined,
      };
      const labelObj = {
        type: "text", layerName: `audio_label_${Date.now()}`,
        text: `${platformHint}: ${params.url.substring(0, 50)}`,
        left: x + 50, top: y + (h - 14) / 2,
        fontSize: 13, fontFamily: "Inter", fill: "#a6adc8",
        frameId: params.frameId || undefined,
      };
      tpl.canvas.objects.push(bgObj, iconObj, labelObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, url: params.url, platform: platformHint };
    }

    case "embed_pdf": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const w = params.width ?? 480;
      const h = params.height ?? 320;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      const title = params.title || params.url.split("/").pop()?.replace(/\.pdf$/i, "") || "PDF Document";
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const bgObj = {
        type: "rect", layerName: `pdf_bg_${Date.now()}`,
        left: x, top: y, width: w, height: h,
        fill: "#181825", stroke: "#f38ba8", strokeWidth: 2, rx: 10, ry: 10,
        frameId: params.frameId || undefined,
        embedType: "pdf", embedUrl: params.url,
      };
      const iconObj = {
        type: "text", layerName: `pdf_icon_${Date.now()}`,
        text: "📄",
        left: x + w / 2 - 20, top: y + h / 2 - 40,
        fontSize: 40, fontFamily: "Inter", fill: "#f38ba8",
        frameId: params.frameId || undefined,
      };
      const titleObj = {
        type: "text", layerName: `pdf_title_${Date.now()}`,
        text: title,
        left: x + 12, top: y + h / 2 + 10,
        width: w - 24,
        fontSize: 16, fontFamily: "Inter", fontWeight: "bold", fill: "#cdd6f4", textAlign: "center",
        frameId: params.frameId || undefined,
      };
      const urlObj = {
        type: "text", layerName: `pdf_url_${Date.now()}`,
        text: params.url.substring(0, 60),
        left: x + 12, top: y + h - 24,
        fontSize: 10, fontFamily: "Inter", fill: "#6c7086",
        frameId: params.frameId || undefined,
      };
      tpl.canvas.objects.push(bgObj, iconObj, titleObj, urlObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, title, url: params.url };
    }

    case "embed_social": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const url = params.url || "";
      let platform = params.platform || null;
      let icon = "🔗";
      let color = "#89b4fa";
      if (!platform) {
        if (url.includes("twitter.com") || url.includes("x.com")) { platform = "twitter"; icon = "𝕏"; color = "#74c7ec"; }
        else if (url.includes("github.com")) { platform = "github"; icon = "⬡"; color = "#a6e3a1"; }
        else if (url.includes("instagram.com")) { platform = "instagram"; icon = "📷"; color = "#f5c2e7"; }
        else if (url.includes("linkedin.com")) { platform = "linkedin"; icon = "in"; color = "#89b4fa"; }
        else platform = "link";
      } else {
        const platIcons = { twitter: "𝕏", github: "⬡", instagram: "📷", linkedin: "in" };
        const platColors = { twitter: "#74c7ec", github: "#a6e3a1", instagram: "#f5c2e7", linkedin: "#89b4fa" };
        icon = platIcons[platform] || "🔗";
        color = platColors[platform] || "#89b4fa";
      }
      const w = params.width ?? 480;
      const h = params.height ?? 200;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const bgObj = {
        type: "rect", layerName: `social_bg_${Date.now()}`,
        left: x, top: y, width: w, height: h,
        fill: "#1e1e2e", stroke: color, strokeWidth: 2, rx: 12, ry: 12,
        frameId: params.frameId || undefined,
        embedType: "social", embedPlatform: platform, embedUrl: url,
      };
      const iconObj = {
        type: "text", layerName: `social_icon_${Date.now()}`,
        text: icon,
        left: x + 16, top: y + 16,
        fontSize: 24, fontFamily: "Inter", fill: color,
        frameId: params.frameId || undefined,
      };
      const platObj = {
        type: "text", layerName: `social_plat_${Date.now()}`,
        text: platform.charAt(0).toUpperCase() + platform.slice(1),
        left: x + 50, top: y + 20,
        fontSize: 14, fontFamily: "Inter", fontWeight: "bold", fill: color,
        frameId: params.frameId || undefined,
      };
      const urlObj = {
        type: "text", layerName: `social_url_${Date.now()}`,
        text: url.substring(0, 65),
        left: x + 16, top: y + h / 2 - 8,
        width: w - 32,
        fontSize: 12, fontFamily: "Inter", fill: "#bac2de",
        frameId: params.frameId || undefined,
      };
      tpl.canvas.objects.push(bgObj, iconObj, platObj, urlObj);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, platform, url: params.url };
    }

    case "mention_user": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      let username = params.username || "anonymous";
      if (!username.startsWith("@")) username = "@" + username;
      if (!tpl.comments) tpl.comments = [];
      const mention = {
        id: `mtn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: username,
        text: params.message ? `${username} ${params.message}` : `${username}`,
        targetLayerName: params.targetLayerName || null,
        x: params.x ?? 0,
        y: params.y ?? 0,
        resolved: false,
        createdAt: new Date().toISOString(),
        type: "mention",
      };
      tpl.comments.push(mention);
      await templates.updateTemplate(params.templateId, { comments: tpl.comments });
      autoSnapshot(params.templateId, method);
      return { created: true, username, mentionId: mention.id };
    }

    // ── F3: AI Features (OpenRouter) ──
    case "ai_generate_text": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured. Set it in Netlify environment variables." };
      const prompt = params.prompt || "";
      const systemPrompt = params.systemPrompt || "You are a design assistant. Generate clean, professional content for a design canvas. Respond with ONLY the requested text, no explanations.";
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], max_tokens: 2000 }),
      });
      if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status} ${await resp.text().catch(() => "")}` };
      const data = await resp.json();
      const generated = data.choices?.[0]?.message?.content || "";
      let layerName = null;
      if (params.templateId) {
        const tpl = await templates.getTemplate(params.templateId);
        if (tpl) {
          if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
          const obj = {
            type: "text", layerName: `ai_text_${Date.now()}`,
            text: generated,
            left: params.x ?? 0, top: params.y ?? 0,
            width: params.width ?? 600,
            fontSize: params.fontSize ?? 16, fontFamily: "Inter", fill: "#cdd6f4", lineHeight: 1.6,
          };
          tpl.canvas.objects.push(obj);
          await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
          autoSnapshot(params.templateId, method);
          layerName = obj.layerName;
        }
      }
      return { generated, layerName, model: data.model };
    }

    case "ai_generate_image": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const prompt = params.prompt || "";
      let imageUrl = null;
      // Try text-to-image via a capable model; fall back to placeholder description
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: `Describe this image in 20 words for an alt-text (do not generate the image itself, just describe what it would look like): ${prompt}` }],
            max_tokens: 120,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const description = data.choices?.[0]?.message?.content || prompt;
          // Placeholder: generate a colored rect with the description as text
          if (params.templateId) {
            const tpl = await templates.getTemplate(params.templateId);
            if (tpl) {
              if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
              const w = params.width ?? 512;
              const h = params.height ?? 512;
              const x = params.x ?? 0;
              const y = params.y ?? 0;
              tpl.canvas.objects.push({
                type: "rect", layerName: `ai_img_bg_${Date.now()}`,
                left: x, top: y, width: w, height: h,
                fill: "#313244", stroke: "#f5c2e7", strokeWidth: 2, rx: 8, ry: 8,
                aiGenerated: true, aiPrompt: prompt,
              });
              tpl.canvas.objects.push({
                type: "text", layerName: `ai_img_label_${Date.now()}`,
                text: `[AI IMAGE]\n\n${description}`,
                left: x + 16, top: y + h / 2 - 30,
                width: w - 32, fontSize: 14, fontFamily: "Inter", fill: "#cdd6f4", lineHeight: 1.5, textAlign: "center",
              });
              await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
              autoSnapshot(params.templateId, method);
            }
          }
          imageUrl = `ai://generated/${Date.now()}`;
          return { generated: true, description, prompt, imageUrl, note: "Image generation placeholder. For actual image output, configure a dedicated image model via OpenRouter." };
        }
      } catch (e) {
        throw { code: -32000, message: `Image generation failed: ${e.message}` };
      }
      return { generated: false, message: "No image URL returned" };
    }

    case "ai_palette": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const theme = params.theme || "professional tech";
      const count = Math.max(3, Math.min(9, params.count || 6));
      const includeNeutrals = params.includeNeutrals !== false;
      const prompt = `Generate a ${count}-color palette for the theme "${theme}". ${includeNeutrals ? "Include 1-2 neutral background/surface colors." : ""} Return ONLY valid JSON: { "colors": [{ "name": "...", "hex": "#...", "role": "primary|secondary|accent|surface|text" }] }`;
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 600, response_format: { type: "json_object" } }),
      });
      if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status}` };
      const data = await resp.json();
      let palette;
      try {
        palette = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      } catch {
        palette = { colors: [] };
      }
      return { theme, colors: palette.colors || [], model: data.model };
    }

    case "ai_suggest_layout": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const aspect = params.aspect || "all";
      const objects = (tpl.canvas?.objects || []).map(o => ({
        type: o.type, layerName: o.layerName || o.name,
        left: o.left, top: o.top, width: o.width, height: o.height,
        text: o.text?.substring(0, 60),
      }));
      const canvasInfo = { width: tpl.width, height: tpl.height, objectCount: objects.length, objects };
      const prompt = `Analyze this design canvas layout and suggest improvements for ${aspect}. Canvas: ${JSON.stringify(canvasInfo)}. Return ONLY valid JSON: { "score": 0-100, "issues": [{ "severity": "low|medium|high", "description": "...", "suggestion": "..." }], "summary": "..." }`;
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 1500, response_format: { type: "json_object" } }),
      });
      if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status}` };
      const data = await resp.json();
      let analysis;
      try {
        analysis = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      } catch {
        analysis = { score: 0, issues: [], summary: "Failed to parse AI response" };
      }
      return { templateId: params.templateId, aspect, ...analysis, model: data.model };
    }

    case "ai_translate": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const targetLang = params.targetLanguage || "English";
      let textToTranslate = params.text || null;
      let translatedCount = 0;
      if (params.templateId && !textToTranslate) {
        const tpl = await templates.getTemplate(params.templateId);
        if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
        const objects = getFrameObjects(tpl, params.frameId);
        const targets = params.targetLayerName
          ? objects.filter(o => (o.layerName || o.name) === params.targetLayerName && o.type === "text" && o.text)
          : objects.filter(o => o.type === "text" && o.text);
        if (targets.length === 0) throw { code: -32000, message: "No text objects found to translate" };
        for (const obj of targets) {
          const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini",
              messages: [{ role: "system", content: `Translate the following text to ${targetLang}. Return ONLY the translated text, no explanations.` }, { role: "user", content: obj.text }],
              max_tokens: 1000,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            obj.text = data.choices?.[0]?.message?.content || obj.text;
            translatedCount++;
          }
        }
        await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
        autoSnapshot(params.templateId, method);
        return { translated: translatedCount, total: targets.length, targetLanguage: targetLang };
      } else if (textToTranslate) {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "system", content: `Translate the following text to ${targetLang}. Return ONLY the translated text, no explanations.` }, { role: "user", content: textToTranslate }],
            max_tokens: 1000,
          }),
        });
        if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status}` };
        const data = await resp.json();
        return { original: textToTranslate, translated: data.choices?.[0]?.message?.content || "", targetLanguage: targetLang };
      }
      throw { code: -32000, message: "Provide either templateId (with targetLayerName) or text to translate" };
    }

    // ── F4: Styles, Variables, Export ──
    case "create_style": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.sourceLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.sourceLayerName}` };
      const styleType = params.type || "fill";
      const props = {};
      if (styleType === "fill") {
        if (obj.fill) props.fill = obj.fill;
        if (obj.opacity !== undefined) props.opacity = obj.opacity;
      } else if (styleType === "stroke") {
        if (obj.stroke) props.stroke = obj.stroke;
        if (obj.strokeWidth !== undefined) props.strokeWidth = obj.strokeWidth;
      } else if (styleType === "text") {
        if (obj.fontSize) props.fontSize = obj.fontSize;
        if (obj.fontFamily) props.fontFamily = obj.fontFamily;
        if (obj.fontWeight) props.fontWeight = obj.fontWeight;
        if (obj.fill) props.fill = obj.fill;
        if (obj.lineHeight) props.lineHeight = obj.lineHeight;
        if (obj.textAlign) props.textAlign = obj.textAlign;
      } else if (styleType === "effect") {
        if (obj.shadow) props.shadow = obj.shadow;
        if (obj.filters) props.filters = obj.filters;
      }
      if (!tpl.styles) tpl.styles = [];
      const style = {
        id: `sty_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: params.name,
        type: styleType,
        properties: props,
      };
      tpl.styles.push(style);
      await templates.updateTemplate(params.templateId, { styles: tpl.styles });
      autoSnapshot(params.templateId, method);
      return { created: true, styleId: style.id, name: style.name, type: styleType, properties: props };
    }

    case "apply_style": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.styles) throw { code: -32000, message: "No styles defined in this template" };
      const style = tpl.styles.find(s => s.id === params.styleId);
      if (!style) throw { code: -32000, message: `Style not found: ${params.styleId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const targets = objects.filter(o => (params.targetLayerNames || []).includes(o.layerName || o.name));
      if (targets.length === 0) throw { code: -32000, message: "No matching layers found for targetLayerNames" };
      for (const obj of targets) {
        Object.assign(obj, style.properties);
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { applied: true, styleId: style.id, styleName: style.name, targetCount: targets.length };
    }

    case "create_variable": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.variables) tpl.variables = { collections: [], variables: [], bindings: {} };
      if (!tpl.variables.variables) tpl.variables.variables = [];
      const variable = {
        id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: params.name,
        type: params.type,
        value: params.value,
        collectionId: params.collectionId || null,
      };
      tpl.variables.variables.push(variable);
      await templates.updateTemplate(params.templateId, { variables: tpl.variables });
      autoSnapshot(params.templateId, method);
      return { created: true, variableId: variable.id, name: variable.name, type: variable.type, value: variable.value };
    }

    case "create_collection": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.variables) tpl.variables = { collections: [], variables: [], bindings: {} };
      if (!tpl.variables.collections) tpl.variables.collections = [];
      const modes = params.modes?.length ? params.modes : ["Default"];
      const collection = {
        id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: params.name,
        modes,
      };
      tpl.variables.collections.push(collection);
      await templates.updateTemplate(params.templateId, { variables: tpl.variables });
      autoSnapshot(params.templateId, method);
      return { created: true, collectionId: collection.id, name: collection.name, modes };
    }

    case "link_variable": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.variables?.variables) throw { code: -32000, message: "No variables defined in this template" };
      const variable = tpl.variables.variables.find(v => v.id === params.variableId);
      if (!variable) throw { code: -32000, message: `Variable not found: ${params.variableId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const prop = params.property;
      if (!tpl.variables.bindings) tpl.variables.bindings = {};
      const key = `${obj.layerName || obj.name}.${prop}`;
      if (!tpl.variables.bindings[key]) tpl.variables.bindings[key] = [];
      tpl.variables.bindings[key].push({ variableId: variable.id, variableName: variable.name });
      obj[prop] = variable.value;
      if (prop === "fontSize" || prop === "width" || prop === "height") obj[prop] = Number(variable.value) || variable.value;
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, variables: tpl.variables });
      autoSnapshot(params.templateId, method);
      return { linked: true, variableName: variable.name, targetLayerName: params.targetLayerName, property: prop, value: variable.value };
    }

    case "export_batch": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const fmt = params.format || "png";
      let scale = params.scale || 1;
      if (fmt === "png@2x") scale = 2;
      else if (fmt === "png@3x") scale = 3;
      const isSvg = fmt === "svg";
      const frameIds = params.frameIds?.length ? params.frameIds : (tpl.frames || []).map(f => f.id);
      const results = [];
      for (const fid of frameIds) {
        const frame = tpl.frames?.find(f => f.id === fid);
        if (!frame && frameIds.length === 1 && !params.frameIds?.length) {
          // Export whole canvas when no frames specified and no frames exist
          results.push({
            frameId: "canvas",
            url: `https://futuraria.app/render/${params.templateId}?format=${isSvg ? "svg" : "png"}&scale=${scale}`,
            width: (tpl.width || 1080) * scale,
            height: (tpl.height || 1080) * scale,
            format: isSvg ? "svg" : `png@${scale}x`,
          });
          continue;
        }
        if (!frame) continue;
        results.push({
          frameId: fid,
          frameName: frame.name,
          url: `https://futuraria.app/render/${params.templateId}/${fid}?format=${isSvg ? "svg" : "png"}&scale=${scale}`,
          width: (frame.width || tpl.width) * scale,
          height: (frame.height || tpl.height) * scale,
          format: isSvg ? "svg" : `png@${scale}x`,
        });
      }
      return { exported: results.length, results, format: isSvg ? "svg" : `png@${scale}x` };
    }

    case "copy_as": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = getFrameObjects(tpl, params.frameId);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const fmt = params.format || "json";
      if (fmt === "svg") {
        let svg = "";
        if (obj.type === "rect") {
          const rx = obj.rx || 0;
          svg = `<rect x="${obj.left || 0}" y="${obj.top || 0}" width="${obj.width || 100}" height="${obj.height || 100}" rx="${rx}" fill="${obj.fill || "#ccc"}"${obj.stroke ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth || 1}"` : ""} />`;
        } else if (obj.type === "text") {
          svg = `<text x="${obj.left || 0}" y="${(obj.top || 0) + (obj.fontSize || 16)}" font-family="${obj.fontFamily || "sans-serif"}" font-size="${obj.fontSize || 16}" fill="${obj.fill || "#000"}">${(obj.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
        } else if (obj.type === "ellipse" || obj.type === "circle") {
          const cx = (obj.left || 0) + (obj.width || 100) / 2;
          const cy = (obj.top || 0) + (obj.height || 100) / 2;
          svg = `<ellipse cx="${cx}" cy="${cy}" rx="${(obj.width || 100) / 2}" ry="${(obj.height || 100) / 2}" fill="${obj.fill || "#ccc"}" />`;
        } else {
          svg = `<!-- ${obj.type}: use JSON format for full data -->`;
        }
        return { format: "svg", layerName: params.targetLayerName, type: obj.type, svg };
      } else if (fmt === "css") {
        const props = [];
        if (obj.left !== undefined) props.push(`  left: ${obj.left}px;`);
        if (obj.top !== undefined) props.push(`  top: ${obj.top}px;`);
        if (obj.width) props.push(`  width: ${obj.width}px;`);
        if (obj.height) props.push(`  height: ${obj.height}px;`);
        if (obj.fill) props.push(`  background-color: ${obj.fill};`);
        if (obj.opacity !== undefined) props.push(`  opacity: ${obj.opacity};`);
        if (obj.rx) props.push(`  border-radius: ${obj.rx}px;`);
        if (obj.fontSize) props.push(`  font-size: ${obj.fontSize}px;`);
        if (obj.fontFamily) props.push(`  font-family: ${obj.fontFamily};`);
        if (obj.shadow) props.push(`  box-shadow: ${obj.shadow.offsetX || 0}px ${obj.shadow.offsetY || 0}px ${obj.shadow.blur || 4}px ${obj.shadow.color || "#000"};`);
        const css = `.${params.targetLayerName.replace(/\s+/g, "-").toLowerCase()} {\n${props.join("\n")}\n}`;
        return { format: "css", layerName: params.targetLayerName, type: obj.type, css };
      } else {
        return { format: "json", layerName: params.targetLayerName, type: obj.type, data: obj };
      }
    }

    case "export_pdf": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const orientation = params.orientation || "landscape";
      const pageFormat = params.format || "screen";
      const frameIds = params.frameIds?.length ? params.frameIds : (tpl.frames || []).map(f => f.id);
      if (frameIds.length === 0) {
        frameIds.push("canvas");
      }
      const pages = [];
      for (const fid of frameIds) {
        if (fid === "canvas") {
          pages.push({
            frameId: "canvas",
            url: `https://futuraria.app/render/${params.templateId}?format=pdf&orientation=${orientation}&format=${pageFormat}`,
            width: tpl.width || 1080,
            height: tpl.height || 1080,
          });
        } else {
          const frame = tpl.frames?.find(f => f.id === fid);
          if (!frame) continue;
          pages.push({
            frameId: fid,
            frameName: frame.name,
            url: `https://futuraria.app/render/${params.templateId}/${fid}?format=pdf&orientation=${orientation}&format=${pageFormat}`,
            width: frame.width,
            height: frame.height,
          });
        }
      }
      return { exported: pages.length, orientation, pageFormat, pages, note: "PDF render URLs ready for the render pipeline." };
    }

    // ── F1: Canvas Controls & Navigation ──
    case "canvas_grid": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (params.gridSize !== undefined) tpl.metadata.gridSize = Math.max(1, Math.min(256, params.gridSize));
      if (params.visible !== undefined) tpl.metadata.gridVisible = params.visible;
      if (params.snapToGrid !== undefined) tpl.metadata.gridSnap = params.snapToGrid;
      if (params.color !== undefined) tpl.metadata.gridColor = params.color;
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return {
        gridSize: tpl.metadata.gridSize || 8,
        visible: tpl.metadata.gridVisible !== false,
        snapToGrid: tpl.metadata.gridSnap || false,
        color: tpl.metadata.gridColor || "#333344",
      };
    }

    case "canvas_rulers": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (params.visible !== undefined) tpl.metadata.rulersVisible = params.visible;
      if (params.units) tpl.metadata.rulerUnits = params.units;
      if (params.guides) {
        if (!tpl.metadata.guides) tpl.metadata.guides = [];
        for (const g of params.guides) {
          tpl.metadata.guides.push({ id: `guide_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, axis: g.axis || "x", position: g.position || 0 });
        }
      }
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return {
        visible: tpl.metadata.rulersVisible !== false,
        units: tpl.metadata.rulerUnits || "px",
        guides: tpl.metadata.guides || [],
      };
    }

    case "canvas_snap": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (params.snapToObject !== undefined) tpl.metadata.snapToObject = params.snapToObject;
      if (params.snapToGrid !== undefined) tpl.metadata.snapToGrid = params.snapToGrid;
      if (params.snapThreshold !== undefined) tpl.metadata.snapThreshold = Math.max(1, Math.min(50, params.snapThreshold));
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return {
        snapToObject: tpl.metadata.snapToObject !== false,
        snapToGrid: tpl.metadata.snapToGrid || false,
        snapThreshold: tpl.metadata.snapThreshold || 5,
      };
    }

    case "history_undo": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const snaps = store.listSnapshots(params.templateId);
      if (snaps.length < 2) throw { code: -32000, message: "Nothing to undo. At least 2 snapshots required." };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.redoStack) tpl.metadata.redoStack = [];
      // Save current state to redo stack
      tpl.metadata.redoStack.push({ canvas: JSON.parse(JSON.stringify(tpl.canvas)), timestamp: new Date().toISOString() });
      // Restore from previous snapshot (index 1 = state before latest change)
      const prevSnap = snaps[1];
      if (prevSnap.data?.canvas) {
        tpl.canvas = JSON.parse(JSON.stringify(prevSnap.data.canvas));
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { undone: true, snapshotLabel: prevSnap.trigger || prevSnap.label, redoDepth: tpl.metadata.redoStack.length };
    }

    case "history_redo": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata?.redoStack?.length) throw { code: -32000, message: "Nothing to redo." };
      const redoEntry = tpl.metadata.redoStack.pop();
      // Save current state for potential undo
      store.snapshotAuto(params.templateId, "ia", "redo_before");
      if (redoEntry.canvas) {
        tpl.canvas = redoEntry.canvas;
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { redone: true, redoDepth: tpl.metadata.redoStack.length };
    }

    case "canvas_pages": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const action = params.action || "list";
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.pages) tpl.metadata.pages = [];
      if (!tpl.metadata.activePageId && tpl.metadata.pages.length === 0) {
        // Initialize with default page
        tpl.metadata.pages.push({ id: `page_${Date.now()}`, name: "Page 1", canvas: JSON.parse(JSON.stringify(tpl.canvas)), order: 0 });
        tpl.metadata.activePageId = tpl.metadata.pages[0].id;
      }
      if (action === "list") {
        return {
          pages: tpl.metadata.pages.map(p => ({ id: p.id, name: p.name, order: p.order, isActive: p.id === tpl.metadata.activePageId })),
          activePageId: tpl.metadata.activePageId,
          total: tpl.metadata.pages.length,
        };
      } else if (action === "add") {
        const page = {
          id: `page_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          name: params.pageName || `Page ${tpl.metadata.pages.length + 1}`,
          canvas: { objects: [], viewport: { x: 0, y: 0, zoom: 1 } },
          order: tpl.metadata.pages.length,
        };
        tpl.metadata.pages.push(page);
        tpl.metadata.activePageId = page.id;
        tpl.canvas = JSON.parse(JSON.stringify(page.canvas));
      } else if (action === "remove") {
        const idx = params.pageId ? tpl.metadata.pages.findIndex(p => p.id === params.pageId) : params.pageIndex;
        if (idx < 0 || idx >= tpl.metadata.pages.length) throw { code: -32000, message: "Page not found" };
        tpl.metadata.pages.splice(idx, 1);
        if (tpl.metadata.activePageId === (params.pageId || tpl.metadata.pages[idx]?.id)) {
          tpl.metadata.activePageId = tpl.metadata.pages[0]?.id || null;
        }
      } else if (action === "set_active") {
        const page = tpl.metadata.pages.find(p => p.id === params.pageId || p.name === params.pageName);
        if (!page) throw { code: -32000, message: "Page not found" };
        // Save current canvas to current page
        const curPage = tpl.metadata.pages.find(p => p.id === tpl.metadata.activePageId);
        if (curPage) curPage.canvas = JSON.parse(JSON.stringify(tpl.canvas));
        tpl.metadata.activePageId = page.id;
        tpl.canvas = JSON.parse(JSON.stringify(page.canvas));
      } else if (action === "reorder") {
        const page = tpl.metadata.pages.find(p => p.id === params.pageId);
        if (!page) throw { code: -32000, message: "Page not found" };
        const from = tpl.metadata.pages.indexOf(page);
        const to = Math.max(0, Math.min(tpl.metadata.pages.length - 1, params.pageIndex ?? 0));
        tpl.metadata.pages.splice(from, 1);
        tpl.metadata.pages.splice(to, 0, page);
        tpl.metadata.pages.forEach((p, i) => { p.order = i; });
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { action, activePageId: tpl.metadata.activePageId, totalPages: tpl.metadata.pages.length };
    }

    case "color_picker": {
      const raw = (params.color || "#000000").trim();
      const action = params.action || "parse";
      const steps = Math.max(2, Math.min(20, params.steps || 5));
      // Parse hex/rgb/rgba to {r,g,b,a}
      let r = 0, g = 0, b = 0, a = 1;
      const hexMatch = raw.match(/^#?([0-9a-fA-F]{3,8})$/);
      const rgbMatch = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)/);
      if (hexMatch) {
        let h = hexMatch[1];
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        if (h.length === 6) h += "ff";
        r = parseInt(h.substring(0,2), 16);
        g = parseInt(h.substring(2,4), 16);
        b = parseInt(h.substring(4,6), 16);
        a = parseInt(h.substring(6,8), 16) / 255;
      } else if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
        a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
      } else {
        throw { code: -32000, message: `Unparseable color: ${raw}. Use hex (#cba6f7) or rgb/rgba.` };
      }
      const toHex = (rr, gg, bb) => "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
      const toRgba = (rr, gg, bb, aa) => `rgba(${Math.round(rr)},${Math.round(gg)},${Math.round(bb)},${aa.toFixed(2)})`;
      const hex = toHex(r, g, b);
      let result = { hex, rgba: toRgba(r, g, b, a), r, g, b, a };
      if (action === "complementary") {
        result.complementary = toHex(255 - r, 255 - g, 255 - b);
        result.palette = [hex, result.complementary];
      } else if (action === "analogous") {
        const hsl = rgbToHsl(r, g, b);
        const c1 = hslToRgb(((hsl.h - 30) + 360) % 360, hsl.s, hsl.l);
        const c2 = hslToRgb(((hsl.h + 30) + 360) % 360, hsl.s, hsl.l);
        result.palette = [toHex(c1.r, c1.g, c1.b), hex, toHex(c2.r, c2.g, c2.b)];
      } else if (action === "triadic") {
        const hsl = rgbToHsl(r, g, b);
        const c1 = hslToRgb(((hsl.h + 120) % 360), hsl.s, hsl.l);
        const c2 = hslToRgb(((hsl.h + 240) % 360), hsl.s, hsl.l);
        result.palette = [hex, toHex(c1.r, c1.g, c1.b), toHex(c2.r, c2.g, c2.b)];
      } else if (action === "shades") {
        const shades = [];
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const sr = Math.round(r + (255 - r) * t * 0.5);
          const sg = Math.round(g + (255 - g) * t * 0.5);
          const sb = Math.round(b + (255 - b) * t * 0.5);
          shades.push(toHex(sr, sg, sb));
        }
        result.shades = shades;
      } else if (action === "gradient") {
        const gradient = [];
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          gradient.push({
            offset: Math.round(t * 100) / 100,
            color: toHex(Math.round(r + (255 - r) * t * 0.6), Math.round(g + (255 - g) * t * 0.6), Math.round(b + (255 - b) * t * 0.6)),
          });
        }
        result.gradient = gradient;
      }
      return result;
    }

    // ── F2: Frame Auto Layout ──
    case "frame_auto_layout": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frame = tpl.frames?.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      const dir = params.direction || "horizontal";
      const gap = params.gap ?? 16;
      const padding = params.padding ?? 0;
      frame.layoutDirection = dir;
      frame.layoutGap = gap;
      frame.layoutPadding = padding;
      if (params.resize) frame.layoutResize = params.resize;
      if (params.alignPrimary) frame.layoutAlignPrimary = params.alignPrimary;
      if (params.alignCounter) frame.layoutAlignCounter = params.alignCounter;
      // Apply auto-layout to frame children
      if ((frame.objects || []).length >= 2) {
        let cx = frame.x + padding;
        let cy = frame.y + padding;
        for (const obj of frame.objects) {
          obj.left = cx;
          obj.top = cy;
          if (dir === "horizontal") cx += (obj.width || 0) * (obj.scaleX || 1) + gap;
          else cy += (obj.height || 0) * (obj.scaleY || 1) + gap;
        }
      }
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { frameId: params.frameId, direction: dir, gap, padding, childrenCount: (frame.objects || []).length };
    }

    // ── F3: Markdown Rendering ──
    case "render_markdown": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const md = params.markdown || "";
      const x = params.x ?? 0;
      const baseFontSize = params.fontSize ?? 14;
      const maxW = params.width ?? 640;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      let cy = params.y ?? 0;
      const objects = [];
      const lines = md.split("\n");
      let inCodeBlock = false, codeLines = [], codeLang = "";
      for (const line of lines) {
        // Code block detection
        if (line.trim().startsWith("```")) {
          if (inCodeBlock) {
            objects.push({
              type: "rect", layerName: `md_code_bg_${Date.now()}`,
              left: x, top: cy, width: maxW, height: codeLines.length * (baseFontSize * 1.5) + 32,
              fill: "#1e1e2e", rx: 6, ry: 6, frameId: params.frameId || undefined,
            });
            objects.push({
              type: "text", layerName: `md_code_${Date.now()}`,
              text: codeLines.join("\n"),
              left: x + 10, top: cy + 8,
              width: maxW - 20, fontSize: baseFontSize - 2, fontFamily: "JetBrains Mono, monospace",
              fill: "#cdd6f4", lineHeight: 1.5, frameId: params.frameId || undefined,
            });
            cy += codeLines.length * (baseFontSize * 1.5) + 40;
            codeLines = [];
            inCodeBlock = false;
          } else {
            inCodeBlock = true;
            codeLang = line.trim().slice(3).trim();
          }
          continue;
        }
        if (inCodeBlock) { codeLines.push(line); continue; }
        // Headings
        const h1Match = line.match(/^# (.+)/);
        const h2Match = line.match(/^## (.+)/);
        const h3Match = line.match(/^### (.+)/);
        if (h1Match) {
          objects.push({ type: "text", layerName: `md_h1_${Date.now()}`, text: h1Match[1], left: x, top: cy, width: maxW, fontSize: baseFontSize + 14, fontFamily: "Inter", fontWeight: "bold", fill: "#cdd6f4", lineHeight: 1.3, frameId: params.frameId || undefined });
          cy += (baseFontSize + 14) * 1.3 + 12;
          continue;
        }
        if (h2Match) {
          objects.push({ type: "text", layerName: `md_h2_${Date.now()}`, text: h2Match[1], left: x, top: cy, width: maxW, fontSize: baseFontSize + 10, fontFamily: "Inter", fontWeight: "bold", fill: "#cdd6f4", lineHeight: 1.3, frameId: params.frameId || undefined });
          cy += (baseFontSize + 10) * 1.3 + 10;
          continue;
        }
        if (h3Match) {
          objects.push({ type: "text", layerName: `md_h3_${Date.now()}`, text: h3Match[1], left: x, top: cy, width: maxW, fontSize: baseFontSize + 6, fontFamily: "Inter", fontWeight: "600", fill: "#cdd6f4", lineHeight: 1.3, frameId: params.frameId || undefined });
          cy += (baseFontSize + 6) * 1.3 + 8;
          continue;
        }
        // Horizontal rule
        if (line.match(/^[-*_]{3,}$/)) {
          objects.push({ type: "rect", layerName: `md_hr_${Date.now()}`, left: x, top: cy, width: maxW, height: 1, fill: "#45475a", frameId: params.frameId || undefined });
          cy += 16;
          continue;
        }
        // Blockquote
        if (line.startsWith("> ")) {
          const quoteText = line.slice(2);
          objects.push({ type: "rect", layerName: `md_qt_bar_${Date.now()}`, left: x, top: cy, width: 3, height: baseFontSize * 1.5, fill: "#cba6f7", frameId: params.frameId || undefined });
          objects.push({ type: "text", layerName: `md_qt_${Date.now()}`, text: quoteText, left: x + 10, top: cy, width: maxW - 10, fontSize: baseFontSize, fontFamily: "Inter", fontWeight: "italic", fill: "#bac2de", lineHeight: 1.5, frameId: params.frameId || undefined });
          cy += baseFontSize * 1.5 + 6;
          continue;
        }
        // Bullet list
        if (line.match(/^[-*] (.+)/)) {
          const itemText = line.replace(/^[-*] /, "• ");
          objects.push({ type: "text", layerName: `md_li_${Date.now()}`, text: itemText, left: x + 12, top: cy, width: maxW - 12, fontSize: baseFontSize, fontFamily: "Inter", fill: "#bac2de", lineHeight: 1.5, frameId: params.frameId || undefined });
          cy += baseFontSize * 1.5 + 4;
          continue;
        }
        // Empty line = paragraph break
        if (!line.trim()) { cy += 10; continue; }
        // Regular paragraph (bold/italic stripped for simplicity)
        const clean = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
        objects.push({ type: "text", layerName: `md_p_${Date.now()}`, text: clean, left: x, top: cy, width: maxW, fontSize: baseFontSize, fontFamily: "Inter", fill: "#bac2de", lineHeight: 1.6, frameId: params.frameId || undefined });
        cy += baseFontSize * 1.6 + 6;
      }
      tpl.canvas.objects.push(...objects);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { rendered: true, blocks: objects.length, totalHeight: cy - (params.y ?? 0) };
    }

    // ── F3: Image Gallery ──
    case "gallery_create": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const images = params.images || [];
      if (images.length === 0) throw { code: -32000, message: "At least one image required" };
      const cols = Math.max(1, Math.min(6, params.columns || 3));
      const iw = params.imageWidth || 200;
      const ih = params.imageHeight || 200;
      const gap = params.gap || 12;
      const startX = params.x ?? 0;
      const startY = params.y ?? 0;
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const objects = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ix = startX + col * (iw + gap);
        const iy = startY + row * (ih + gap + (img.caption ? 24 : 0));
        objects.push({
          type: "image", layerName: `gallery_img_${i}_${Date.now()}`,
          src: img.url,
          left: ix, top: iy, width: iw, height: ih, scaleX: 1, scaleY: 1,
          rx: 4, ry: 4,
          frameId: params.frameId || undefined,
        });
        // Border rect for gallery card effect
        objects.push({
          type: "rect", layerName: `gallery_border_${i}_${Date.now()}`,
          left: ix, top: iy, width: iw, height: ih,
          fill: "transparent", stroke: "#45475a", strokeWidth: 1, rx: 4, ry: 4,
          frameId: params.frameId || undefined,
        });
        if (img.caption) {
          objects.push({
            type: "text", layerName: `gallery_cap_${i}_${Date.now()}`,
            text: img.caption,
            left: ix, top: iy + ih + 6,
            width: iw, fontSize: 11, fontFamily: "Inter", fill: "#a6adc8", textAlign: "center",
            frameId: params.frameId || undefined,
          });
        }
      }
      tpl.canvas.objects.push(...objects);
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      const rows = Math.ceil(images.length / cols);
      return { created: true, images: images.length, columns: cols, rows, totalWidth: cols * iw + (cols - 1) * gap, totalHeight: rows * (ih + gap + (images[0]?.caption ? 24 : 0)) };
    }

    // ── F4: Components ──
    case "create_component": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.components) tpl.metadata.components = [];
      const compId = `comp_${Date.now().toString(36)}`;
      const compObjects = (tpl.canvas?.objects || []).filter(o => params.objectIds.includes(o.id || o.layerName));
      if (compObjects.length === 0) throw { code: -32000, message: "No matching objects found for the given IDs" };
      const component = {
        id: compId, name: params.name, description: params.description || "",
        objectIds: params.objectIds, objects: JSON.parse(JSON.stringify(compObjects)),
        variants: [], properties: [], created: new Date().toISOString(),
      };
      tpl.metadata.components.push(component);
      // Tag source objects with componentId
      for (const obj of tpl.canvas.objects) {
        if (params.objectIds.includes(obj.id || obj.layerName)) obj.componentId = compId;
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, componentId: compId, name: params.name, objectCount: compObjects.length };
    }

    case "create_instance": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const components = tpl.metadata?.components || [];
      const comp = components.find(c => c.id === params.componentId);
      if (!comp) throw { code: -32000, message: `Component not found: ${params.componentId}` };
      const instanceId = `inst_${Date.now().toString(36)}`;
      const x = params.x ?? 0, y = params.y ?? 0;
      // Clone component objects as instance
      for (const obj of comp.objects) {
        const instObj = JSON.parse(JSON.stringify(obj));
        instObj.id = instObj.id ? `${instObj.id}_${instanceId}` : `obj_${Date.now().toString(36)}`;
        instObj.layerName = (instObj.layerName || "instance") + `_${instanceId}`;
        instObj.left = (instObj.left || 0) + x;
        instObj.top = (instObj.top || 0) + y;
        instObj.componentId = params.componentId;
        instObj.instanceId = instanceId;
        instObj.componentOverrides = {};
        if (params.frameId) instObj.frameId = params.frameId;
        tpl.canvas.objects.push(instObj);
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, instanceId, componentId: params.componentId, componentName: comp.name, objectCount: comp.objects.length };
    }

    case "add_variant": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata?.components) throw { code: -32000, message: "No components found in this template" };
      const comp = tpl.metadata.components.find(c => c.id === params.componentId);
      if (!comp) throw { code: -32000, message: `Component not found: ${params.componentId}` };
      if (!comp.variants) comp.variants = [];
      const varId = `var_${Date.now().toString(36)}`;
      comp.variants.push({
        id: varId, name: params.name,
        overrides: params.overrides || {},
        created: new Date().toISOString(),
      });
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, variantId: varId, componentId: params.componentId, name: params.name, overrides: params.overrides || {} };
    }

    case "set_component_prop": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata?.components) throw { code: -32000, message: "No components found in this template" };
      const comp = tpl.metadata.components.find(c => c.id === params.componentId);
      if (!comp) throw { code: -32000, message: `Component not found: ${params.componentId}` };
      if (!comp.properties) comp.properties = [];
      if (params.instanceId) {
        // Override on instance
        for (const obj of tpl.canvas?.objects || []) {
          if (obj.instanceId === params.instanceId) {
            if (!obj.componentOverrides) obj.componentOverrides = {};
            obj.componentOverrides[params.propName] = { type: params.propType, value: params.value };
            // Apply boolean override (e.g. visibility)
            if (params.propType === "boolean") obj.visible = params.value;
          }
        }
      } else {
        // Define on master
        const existing = comp.properties.find(p => p.name === params.propName);
        if (existing) { existing.type = params.propType; existing.defaultValue = params.value; }
        else comp.properties.push({ name: params.propName, type: params.propType, defaultValue: params.value });
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { updated: true, componentId: params.componentId, propName: params.propName, propType: params.propType, value: params.value };
    }

    // ── F4: Prototyping ──
    case "add_interaction": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.interactions) tpl.metadata.interactions = [];
      const interaction = {
        id: `iact_${Date.now().toString(36)}`,
        sourceId: params.sourceId,
        trigger: params.trigger || "onClick",
        action: params.action || "navigate",
        targetId: params.targetId || null,
        transition: params.transition || "instant",
        duration: params.duration ?? 300,
        delay: params.delay ?? 0,
        easing: params.easing || "easeOut",
      };
      tpl.metadata.interactions.push(interaction);
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, interactionId: interaction.id, sourceId: params.sourceId, trigger: interaction.trigger, action: interaction.action };
    }

    case "set_animation": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.animations) tpl.metadata.animations = [];
      // Remove existing animation for this object
      tpl.metadata.animations = tpl.metadata.animations.filter(a => a.objectId !== params.objectId);
      const anim = {
        id: `anim_${Date.now().toString(36)}`,
        objectId: params.objectId,
        type: params.type,
        direction: params.direction || null,
        duration: params.duration ?? 300,
        easing: params.easing || "easeOut",
        delay: params.delay ?? 0,
      };
      tpl.metadata.animations.push(anim);
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, animationId: anim.id, objectId: params.objectId, type: params.type, duration: anim.duration };
    }

    case "add_overlay": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frames = tpl.data?.frames || [];
      const frameIdx = frames.findIndex(f => f.id === params.frameId);
      if (frameIdx === -1) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      if (!frames[frameIdx].metadata) frames[frameIdx].metadata = {};
      frames[frameIdx].metadata.overlay = {
        position: params.position || "center",
        backdrop: params.backdrop !== false,
        backdropColor: params.backdropColor || "rgba(0,0,0,0.5)",
        closeOnBackdrop: params.closeOnBackdrop !== false,
        manualX: params.manualX ?? null,
        manualY: params.manualY ?? null,
      };
      tpl.data.frames = frames;
      await templates.updateTemplate(params.templateId, { data: tpl.data });
      autoSnapshot(params.templateId, method);
      return { updated: true, frameId: params.frameId, position: frames[frameIdx].metadata.overlay.position };
    }

    case "set_scroll_position": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      // Check frames first
      const frames = tpl.data?.frames || [];
      const frameIdx = frames.findIndex(f => f.id === params.objectId);
      if (frameIdx !== -1) {
        if (!frames[frameIdx].metadata) frames[frameIdx].metadata = {};
        frames[frameIdx].metadata.scrollBehavior = params.behavior;
        if (params.stickyTop !== undefined) frames[frameIdx].metadata.stickyTop = params.stickyTop;
        if (params.stickyBottom !== undefined) frames[frameIdx].metadata.stickyBottom = params.stickyBottom;
        if (params.overflow) frames[frameIdx].metadata.overflow = params.overflow;
        tpl.data.frames = frames;
        await templates.updateTemplate(params.templateId, { data: tpl.data });
      } else {
        // Check canvas objects
        const obj = (tpl.canvas?.objects || []).find(o => (o.id || o.layerName) === params.objectId);
        if (!obj) throw { code: -32000, message: `Object not found: ${params.objectId}` };
        if (!obj.metadata) obj.metadata = {};
        obj.metadata.scrollBehavior = params.behavior;
        if (params.stickyTop !== undefined) obj.metadata.stickyTop = params.stickyTop;
        if (params.overflow) obj.metadata.overflow = params.overflow;
        await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      }
      autoSnapshot(params.templateId, method);
      return { updated: true, objectId: params.objectId, behavior: params.behavior };
    }

    // ── F1: Canvas Navigation ──
    case "canvas_pan": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      if (!tpl.canvas.viewport) tpl.canvas.viewport = { x: 0, y: 0, zoom: 1 };
      if (params.x !== undefined) tpl.canvas.viewport.x = params.x;
      else if (params.deltaX !== undefined) tpl.canvas.viewport.x = (tpl.canvas.viewport.x || 0) + params.deltaX;
      if (params.y !== undefined) tpl.canvas.viewport.y = params.y;
      else if (params.deltaY !== undefined) tpl.canvas.viewport.y = (tpl.canvas.viewport.y || 0) + params.deltaY;
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      return { viewport: { x: tpl.canvas.viewport.x, y: tpl.canvas.viewport.y, zoom: tpl.canvas.viewport.zoom || 1 } };
    }

    case "canvas_zoom": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      if (!tpl.canvas.viewport) tpl.canvas.viewport = { x: 0, y: 0, zoom: 1 };
      const vp = tpl.canvas.viewport;
      let newZoom = vp.zoom || 1;
      if (params.zoom !== undefined) newZoom = Math.max(0.01, Math.min(10, params.zoom));
      else if (params.delta !== undefined) newZoom = Math.max(0.01, Math.min(10, (vp.zoom || 1) + params.delta));
      else if (params.fitSelection) {
        const objects = tpl.canvas.objects || [];
        if (objects.length > 0) {
          const minX = Math.min(...objects.map(o => o.left || 0));
          const minY = Math.min(...objects.map(o => o.top || 0));
          const maxX = Math.max(...objects.map(o => (o.left || 0) + (o.width || 100) * (o.scaleX || 1)));
          const maxY = Math.max(...objects.map(o => (o.top || 0) + (o.height || 100) * (o.scaleY || 1)));
          const contentW = maxX - minX + 100, contentH = maxY - minY + 100;
          newZoom = Math.min(1, Math.max(0.05, 1200 / Math.max(contentW, contentH)));
          vp.x = minX - 50; vp.y = minY - 50;
        }
      }
      // Zoom to point: adjust pan so centerX/Y stays in place
      if (params.centerX !== undefined && params.centerY !== undefined) {
        const oldZoom = vp.zoom || 1;
        const ratio = newZoom / oldZoom;
        vp.x = params.centerX - (params.centerX - vp.x) * ratio;
        vp.y = params.centerY - (params.centerY - vp.y) * ratio;
      }
      vp.zoom = newZoom;
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      return { viewport: { x: vp.x || 0, y: vp.y || 0, zoom: newZoom } };
    }

    // ── F3: Paper-like Blocks ──
    case "add_toggle": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const x = params.x ?? 0, y = params.y ?? 0;
      const w = params.width || 400;
      const expanded = params.expanded || false;
      // Toggle header with arrow
      tpl.canvas.objects.push({
        type: "rect", layerName: `toggle_bg_${Date.now()}`, left: x, top: y, width: w, height: 36,
        fill: "#313244", rx: 6, ry: 6, stroke: "#45475a", strokeWidth: 1,
        frameId: params.frameId || undefined,
      });
      tpl.canvas.objects.push({
        type: "text", layerName: `toggle_arrow_${Date.now()}`, text: expanded ? "▾" : "▸",
        left: x + 10, top: y + 8, width: 16, fontSize: 14, fontFamily: "Inter",
        fill: "#cdd6f4", frameId: params.frameId || undefined,
      });
      tpl.canvas.objects.push({
        type: "text", layerName: `toggle_title_${Date.now()}`, text: params.title,
        left: x + 30, top: y + 8, width: w - 40, fontSize: 14, fontFamily: "Inter",
        fontWeight: "600", fill: "#cdd6f4", frameId: params.frameId || undefined,
      });
      // Content (visible if expanded)
      if (expanded) {
        tpl.canvas.objects.push({
          type: "rect", layerName: `toggle_content_bg_${Date.now()}`, left: x, top: y + 36, width: w, height: 60,
          fill: "#1e1e2e", rx: 0, ry: 0, stroke: "#45475a", strokeWidth: 1,
          frameId: params.frameId || undefined,
        });
        tpl.canvas.objects.push({
          type: "text", layerName: `toggle_content_${Date.now()}`, text: params.content,
          left: x + 10, top: y + 42, width: w - 20, fontSize: 13, fontFamily: "Inter",
          fill: "#a6adc8", lineHeight: 1.5, frameId: params.frameId || undefined,
        });
      }
      // Store toggle metadata
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.toggles) tpl.metadata.toggles = [];
      tpl.metadata.toggles.push({ x, y, w, title: params.title, expanded, createdAt: new Date().toISOString() });
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas, metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, title: params.title, expanded };
    }

    case "add_callout": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const x = params.x ?? 0, y = params.y ?? 0;
      const w = params.width || 400;
      const calloutType = params.type || "info";
      const palettes = { info: { bg: "#1e1e2e", border: "#89b4fa", icon: "ℹ" }, warning: { bg: "#2a2218", border: "#f9e2af", icon: "⚠" }, tip: { bg: "#1e2a1e", border: "#a6e3a1", icon: "💡" }, note: { bg: "#1e1e2e", border: "#cba6f7", icon: "📝" }, success: { bg: "#1e2e1e", border: "#a6e3a1", icon: "✓" }, error: { bg: "#2a1818", border: "#f38ba8", icon: "✕" } };
      const p = palettes[calloutType] || palettes.info;
      const h = 48 + (params.title ? 20 : 0);
      tpl.canvas.objects.push({
        type: "rect", layerName: `callout_bg_${Date.now()}`, left: x, top: y, width: w, height: h,
        fill: p.bg, rx: 8, ry: 8, stroke: p.border, strokeWidth: 1,
        frameId: params.frameId || undefined,
      });
      tpl.canvas.objects.push({
        type: "text", layerName: `callout_icon_${Date.now()}`, text: p.icon,
        left: x + 12, top: y + 10, width: 20, fontSize: 16, fontFamily: "Inter",
        frameId: params.frameId || undefined,
      });
      if (params.title) {
        tpl.canvas.objects.push({
          type: "text", layerName: `callout_title_${Date.now()}`, text: params.title,
          left: x + 38, top: y + 8, width: w - 50, fontSize: 13, fontFamily: "Inter",
          fontWeight: "600", fill: "#cdd6f4", frameId: params.frameId || undefined,
        });
        tpl.canvas.objects.push({
          type: "text", layerName: `callout_text_${Date.now()}`, text: params.text,
          left: x + 38, top: y + 28, width: w - 50, fontSize: 12, fontFamily: "Inter",
          fill: "#a6adc8", lineHeight: 1.4, frameId: params.frameId || undefined,
        });
      } else {
        tpl.canvas.objects.push({
          type: "text", layerName: `callout_text_${Date.now()}`, text: params.text,
          left: x + 38, top: y + 10, width: w - 50, fontSize: 13, fontFamily: "Inter",
          fill: "#a6adc8", lineHeight: 1.4, frameId: params.frameId || undefined,
        });
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, type: calloutType };
    }

    case "add_quote": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const x = params.x ?? 0, y = params.y ?? 0;
      const w = params.width || 500;
      const color = params.color || "#cba6f7";
      // Accent bar
      tpl.canvas.objects.push({
        type: "rect", layerName: `quote_bar_${Date.now()}`, left: x, top: y, width: 4, height: 60,
        fill: color, rx: 2, ry: 2, frameId: params.frameId || undefined,
      });
      // Quote text
      tpl.canvas.objects.push({
        type: "text", layerName: `quote_text_${Date.now()}`, text: `"${params.text}"`,
        left: x + 16, top: y + 2, width: w - 16, fontSize: 16, fontFamily: "Inter",
        fontWeight: "italic", fill: "#cdd6f4", lineHeight: 1.5, fontStyle: "italic",
        frameId: params.frameId || undefined,
      });
      let cy = y + 36;
      if (params.author) {
        tpl.canvas.objects.push({
          type: "text", layerName: `quote_author_${Date.now()}`, text: `— ${params.author}${params.source ? `, ${params.source}` : ""}`,
          left: x + 16, top: cy, width: w - 16, fontSize: 12, fontFamily: "Inter",
          fill: "#a6adc8", frameId: params.frameId || undefined,
        });
        cy += 20;
      }
      await templates.updateTemplate(params.templateId, { canvas: tpl.canvas });
      autoSnapshot(params.templateId, method);
      return { created: true, author: params.author || null };
    }

    // ── F4: Libraries & Plugins ──
    case "publish_library": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      const styles = (tpl.data?.styles || []).filter(s => !params.styleIds || params.styleIds.includes(s.id));
      const library = {
        id: `lib_${Date.now().toString(36)}`,
        name: params.name,
        description: params.description || "",
        styles: JSON.parse(JSON.stringify(styles)),
        variables: tpl.metadata.variables || [],
        collections: tpl.metadata.collections || [],
        visibility: params.visibility || "workspace",
        sourceTemplateId: params.templateId,
        published: new Date().toISOString(),
      };
      // Store library globally in Supabase (or in-memory fallback)
      const sb = getSupabase();
      if (sb) {
        const { error } = await sb.from("libraries").upsert({ id: library.id, data: library }, { onConflict: "id" });
        if (error) throw { code: -32000, message: `Supabase error: ${error.message}` };
      }
      if (!tpl.metadata.libraries) tpl.metadata.libraries = [];
      tpl.metadata.libraries.push({ id: library.id, name: params.name, published: library.published });
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { published: true, libraryId: library.id, name: params.name, styleCount: styles.length };
    }

    case "register_tool": {
      const name = params.name;
      if (!name.startsWith("plugin_")) throw { code: -32000, message: `Plugin tool names must start with 'plugin_' prefix. Got: ${name}` };
      if (MCP_TOOLS.some(t => t.name === name)) throw { code: -32000, message: `Tool '${name}' is already registered` };
      // Validate inputSchema is a valid JSON Schema object
      if (!params.inputSchema || typeof params.inputSchema !== "object") throw { code: -32000, message: "inputSchema must be a valid JSON Schema object" };
      // Store in in-memory plugin registry (survives warm instances)
      if (!globalThis.__mcp_plugins) globalThis.__mcp_plugins = new Map();
      globalThis.__mcp_plugins.set(name, {
        name, description: params.description, inputSchema: params.inputSchema,
        handler: params.handler, secret: params.secret || null,
        registered: new Date().toISOString(),
      });
      // Dynamically add to MCP_TOOLS for discovery
      MCP_TOOLS.push({
        name, description: params.description, inputSchema: params.inputSchema,
      });
      return { registered: true, name, handler: params.handler, totalTools: MCP_TOOLS.length };
    }

    case "auth_token": {
      const tokenId = `pat_${Date.now().toString(36)}`;
      const scopes = params.scopes || ["read"];
      const expiresIn = params.expiresIn ?? 31536000; // 1 year default
      const expiresAt = expiresIn === 0 ? null : new Date(Date.now() + expiresIn * 1000).toISOString();
      // Hash the token for storage (simple hash for free-tier, not cryptographic)
      const tokenRaw = `${tokenId}_${params.userId}_${Date.now()}`;
      const tokenHashed = [...tokenRaw].reduce((h, c) => (h = ((h << 5) - h) + c.charCodeAt(0)) & 0xffffffff, 0).toString(36);
      // Store in metadata
      const sb = getSupabase();
      const patData = { id: tokenId, userId: params.userId, name: params.name, scopes, expiresAt, tokenHashed, created: new Date().toISOString() };
      if (sb) {
        const { error } = await sb.from("personal_access_tokens").upsert({ id: tokenId, data: patData }, { onConflict: "id" });
        if (error) throw { code: -32000, message: `Supabase error: ${error.message}` };
      }
      return { created: true, tokenId, token: tokenRaw, name: params.name, scopes, expiresAt, note: "Store this token securely. It will not be shown again." };
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
        capabilities: { tools: { listChanged: true } },
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

  // Direct method fallback: if method matches a tool name, route to tools/call
  if (MCP_TOOLS.some(t => t.name === method)) {
    try {
      const result = await handleMethod(method, params || {}, userId);
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
