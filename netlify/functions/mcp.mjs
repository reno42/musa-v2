import * as templates from "../../api/src/services/templates.js";
import { store } from "../../api/src/services/store.js";

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

/** Route JSON-RPC method calls to template/workspace services */
async function handleMethod(method, params, userId) {
  switch (method) {
    // ── Workspaces ──
    case "list_workspaces": {
      const data = store.listWorkspaces(userId);
      return { data, total: data.length };
    }
    case "create_workspace": {
      const ws = store.createWorkspace({ name: params.name, description: params.description, ownerId: userId });
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
      return tpl;
    }
    case "create_template": {
      const tpl = await templates.createTemplate(
        params.name, params.width || 1080, params.height || 1080,
        undefined, userId, params.workspaceId,
      );
      return tpl;
    }
    case "update_template": {
      const updates = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.canvas !== undefined) updates.canvas = params.canvas;
      const tpl = await templates.updateTemplate(params.id, updates);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
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
      return newTpl;
    }

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

export const handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
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
