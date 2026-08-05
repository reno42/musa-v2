/**
 * Quiver AI streaming proxy.
 *
 * Endpoints (both proxied from /api/quiver/*):
 *   POST /api/quiver/vectorize — streaming image-to-SVG vectorization
 *   POST /api/quiver/generate  — streaming text-to-SVG generation
 *
 * Reads the user's Quiver key from the user_api_keys table (server-side),
 * calls the Quiver API with stream:true, and pipes the SSE events through
 * to the browser. The browser reads these via a fetch() body reader and
 * renders the SVG building live.
 *
 * SSE event types from Quiver:
 *   generating → initial ack (model, id)
 *   reasoning  → intermediate thinking
 *   draft      → partial SVG (building up)
 *   content    → final complete SVG
 *   [DONE]     → stream terminator
 */

import { getSupabaseAdmin } from "../../api/src/services/supabase.js";
import { getUserKey } from "./keys.mjs";
import { decodeNetlifyBody } from "./http-encoding.mjs";

const JSON_UTF8 = "application/json; charset=utf-8";
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

/** Validate Bearer JWT and return userId. */
async function authenticate(event) {
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(bearer);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": JSON_UTF8, "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(data),
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  // ── Auth ──
  const userId = await authenticate(event);
  if (!userId) {
    return jsonResponse(401, { error: "Authentication required." });
  }

  // ── Resolve Quiver key ──
  const { key: quiverKey, model: savedModel } = await getUserKey(userId, "quiver");
  if (!quiverKey) {
    return jsonResponse(403, { error: "NO_QUIVER_KEY: Configure your Quiver API key in AI Settings." });
  }

  // ── Parse request ──
  let body;
  try {
    body = JSON.parse(decodeNetlifyBody(event, "{}"));
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  // ── Route: vectorize or generate ──
  const path = (event.path || "").toLowerCase();
  const isGenerate = path.includes("/generate");

  let quiverUrl, quiverBody;

  if (isGenerate) {
    quiverUrl = "https://api.quiver.ai/v1/svgs/generations";
    quiverBody = {
      model: body.model || savedModel || "arrow-1.1",
      prompt: body.prompt,
      stream: true,
    };
    if (body.instructions) quiverBody.instructions = body.instructions;
    if (body.n) quiverBody.n = Math.min(Math.max(body.n, 1), 4);
  } else {
    quiverUrl = "https://api.quiver.ai/v1/svgs/vectorizations";
    quiverBody = {
      model: body.model || savedModel || "arrow-1.1",
      auto_crop: body.autoCrop !== false,
      stream: true,
    };
    if (body.imageBase64) {
      quiverBody.image = body.imageBase64;
    } else if (body.imageUrl) {
      quiverBody.image_url = body.imageUrl;
    } else {
      return jsonResponse(400, { error: "Either imageBase64 or imageUrl is required." });
    }
    if (body.targetSize) quiverBody.target_size = body.targetSize;
  }

  // ── Call Quiver with streaming ──
  let quiverRes;
  try {
    quiverRes = await fetch(quiverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${quiverKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(quiverBody),
    });
  } catch (err) {
    return jsonResponse(502, { error: `Failed to connect to Quiver: ${err.message}` });
  }

  if (!quiverRes.ok) {
    const errText = await quiverRes.text().catch(() => "");
    return jsonResponse(quiverRes.status, { error: `Quiver API error: ${errText.substring(0, 300)}` });
  }

  // ── Pipe the SSE stream through to the browser ──
  // Netlify Functions can return a ReadableStream in the body — the browser
  // reads it chunk-by-chunk via fetch().body.getReader().
  const stream = new ReadableStream({
    async start(controller) {
      const reader = quiverRes.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (err) {
        // Client disconnected or Quiver closed the stream
      } finally {
        controller.close();
        try { reader.releaseLock(); } catch {}
      }
    },
  });

  return {
    statusCode: 200,
    headers: SSE_HEADERS,
    body: stream,
  };
}
