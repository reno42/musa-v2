import { TextDecoder } from "node:util";

export const JSON_UTF8_CONTENT_TYPE = "application/json; charset=utf-8";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Return a Netlify request body as a Unicode string without passing it through
 * the platform's legacy/default encoding. Base64 bodies are decoded strictly:
 * invalid UTF-8 is rejected instead of being saved with replacement glyphs.
 */
export function decodeNetlifyBody(event, fallback = "") {
  const body = event?.body;
  if (body === undefined || body === null || body === "") return fallback;
  if (!event?.isBase64Encoded) return String(body);
  return strictUtf8Decoder.decode(Buffer.from(body, "base64"));
}

export function parseNetlifyJson(event, fallback = {}) {
  const body = decodeNetlifyBody(event);
  return body ? JSON.parse(body) : fallback;
}

export function getNetlifyBodyBuffer(event) {
  return Buffer.from(decodeNetlifyBody(event), "utf8");
}
