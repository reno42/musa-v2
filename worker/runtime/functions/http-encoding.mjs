import { TextDecoder } from "node:util";

export const JSON_UTF8_CONTENT_TYPE = "application/json; charset=utf-8";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Return a handler request body as a Unicode string without passing it through
 * the platform's legacy/default encoding. Base64 bodies are decoded strictly:
 * invalid UTF-8 is rejected instead of being saved with replacement glyphs.
 */
export function decodeHandlerBody(event, fallback = "") {
  const body = event?.body;
  if (body === undefined || body === null || body === "") return fallback;
  if (!event?.isBase64Encoded) return String(body);
  return strictUtf8Decoder.decode(Buffer.from(body, "base64"));
}

export function parseHandlerJson(event, fallback = {}) {
  const body = decodeHandlerBody(event);
  return body ? JSON.parse(body) : fallback;
}

export function getHandlerBodyBuffer(event) {
  return Buffer.from(decodeHandlerBody(event), "utf8");
}
