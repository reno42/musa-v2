/**
 * Shared channel for steering the live editor viewport — pan, zoom and frame
 * selection — from anywhere in the app (ChatFAB agent tools, Musa Hands
 * gestures). The canvas only exists in the current browser tab, so consumers
 * dispatch window events; nothing here ever reaches the MCP server.
 *
 * Consumers:
 *  - InfiniteHtmlCanvas.tsx handles { type: "pan" } with the SAME setPan the
 *    two-finger scroll commits.
 *  - EditorV2.tsx handles { type: "zoom" } (in | out | fit | set) through the
 *    SAME handleZoomIn/Out/Set/ToFit helpers as the trackpad, and since Musa
 *    Hands also { type: "frame" } (prev/next frame selection).
 *
 * Extracted from ChatFAB's runEditorViewportTool so the ChatFAB agent and the
 * gesture bridge share ONE definition of the event name and payload shape.
 */

export const EDITOR_VIEWPORT_EVENT = "futuraria:editor-viewport";

export type EditorViewportDetail =
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; action: "in" | "out" | "fit" | "set"; zoom?: number }
  | { type: "frame"; delta: number };

/** Dispatch a viewport action to the open EditorV2 (no-op on the server). */
export function dispatchEditorViewport(detail: EditorViewportDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EDITOR_VIEWPORT_EVENT, { detail }));
}

/** True when the live editor canvas is mounted in this document. */
export function isEditorOpen(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.getElementById("canvas-container");
}
