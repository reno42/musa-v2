/**
 * Client-side Quiver AI streaming helper.
 *
 * Calls the server-side proxy at /api/quiver/* which pipes Quiver's SSE
 * events through. The browser reads these chunk-by-chunk via fetch().body
 * and renders the SVG building live.
 *
 * SSE event types from Quiver:
 *   generating → { id, model, status: "generating" }
 *   reasoning  → { reasoning: "..." }
 *   draft      → { svg: "<partial svg>" }
 *   content    → { id, svg: "<final svg>", credits }
 *   [DONE]     → stream terminator
 */

import { getApiHeaders } from "./apiKey";

export type QuiverEvent =
  | { type: "generating"; id: string; model: string }
  | { type: "reasoning"; reasoning: string }
  | { type: "draft"; svg: string }
  | { type: "content"; id: string; svg: string; credits?: number }
  | { type: "done" };

export interface QuiverStreamCallbacks {
  onEvent?: (event: QuiverEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * Parse a single SSE chunk into events.
 * SSE format: "event: <type>\ndata: <json>\n\n"
 */
function parseSSEChunk(chunk: string): QuiverEvent[] {
  const events: QuiverEvent[] = [];
  const blocks = chunk.split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    let eventType = "";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataStr += line.slice(5).trim();
      }
    }

    if (dataStr === "[DONE]") {
      events.push({ type: "done" });
      continue;
    }

    if (!eventType || !dataStr) continue;

    try {
      const data = JSON.parse(dataStr);
      switch (eventType) {
        case "generating":
          events.push({ type: "generating", id: data.id || "", model: data.model || "" });
          break;
        case "reasoning":
          events.push({ type: "reasoning", reasoning: data.reasoning || "" });
          break;
        case "draft":
          events.push({ type: "draft", svg: data.svg || "" });
          break;
        case "content":
          events.push({ type: "content", id: data.id || "", svg: data.svg || "", credits: data.credits });
          break;
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return events;
}

/**
 * Stream a Quiver vectorization (image → SVG).
 *
 * @param params Image data and options
 * @param callbacks Event callbacks for streaming updates
 * @returns An AbortController to cancel the stream
 */
export function streamVectorize(
  params: {
    imageBase64?: string;
    imageUrl?: string;
    autoCrop?: boolean;
    targetSize?: string;
    model?: string;
  },
  callbacks: QuiverStreamCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/quiver/vectorize", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Stream failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body to stream.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = parseSSEChunk(buffer);
        // Keep the last incomplete chunk in the buffer
        const lastDoubleNewline = buffer.lastIndexOf("\n\n");
        if (lastDoubleNewline >= 0) {
          buffer = buffer.slice(lastDoubleNewline + 2);
        }

        for (const event of events) {
          callbacks.onEvent?.(event);
          if (event.type === "done") {
            callbacks.onClose?.();
            return;
          }
        }
      }

      // Process any remaining buffered data
      if (buffer.trim()) {
        const events = parseSSEChunk(buffer + "\n\n");
        for (const event of events) {
          callbacks.onEvent?.(event);
        }
      }

      callbacks.onClose?.();
    } catch (err: any) {
      if (err.name === "AbortError") return;
      callbacks.onError?.(err);
    }
  })();

  return controller;
}

/**
 * Stream a Quiver generation (text → SVG).
 */
export function streamGenerate(
  params: {
    prompt: string;
    instructions?: string;
    n?: number;
    model?: string;
  },
  callbacks: QuiverStreamCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/quiver/generate", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Stream failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body to stream.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = parseSSEChunk(buffer);
        const lastDoubleNewline = buffer.lastIndexOf("\n\n");
        if (lastDoubleNewline >= 0) {
          buffer = buffer.slice(lastDoubleNewline + 2);
        }

        for (const event of events) {
          callbacks.onEvent?.(event);
          if (event.type === "done") {
            callbacks.onClose?.();
            return;
          }
        }
      }

      if (buffer.trim()) {
        const events = parseSSEChunk(buffer + "\n\n");
        for (const event of events) {
          callbacks.onEvent?.(event);
        }
      }

      callbacks.onClose?.();
    } catch (err: any) {
      if (err.name === "AbortError") return;
      callbacks.onError?.(err);
    }
  })();

  return controller;
}
