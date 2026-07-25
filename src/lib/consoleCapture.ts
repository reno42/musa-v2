/**
 * Console error capture — silently records console.error/warn messages
 * for inclusion in bug reports. Stores last 50 entries in a ring buffer.
 * Does NOT interfere with normal console behavior.
 */

interface ConsoleEntry {
  level: "error" | "warn";
  args: string[];
  timestamp: string;
}

const MAX_ENTRIES = 50;
const buffer: ConsoleEntry[] = [];

function serializeArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || ""}`;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function pushEntry(level: "error" | "warn", args: unknown[]) {
  buffer.push({
    level,
    args: args.map(serializeArg),
    timestamp: new Date().toISOString(),
  });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

let installed = false;

export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = function (...args: unknown[]) {
    pushEntry("error", args);
    originalError(...args);
  };

  console.warn = function (...args: unknown[]) {
    pushEntry("warn", args);
    originalWarn(...args);
  };

  // Also capture unhandled errors
  window.addEventListener("error", (event) => {
    pushEntry("error", [
      `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
    ]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    pushEntry("error", [
      `Unhandled Promise: ${serializeArg(event.reason)}`,
    ]);
  });
}

/** Returns a snapshot of captured console entries (most recent first). */
export function getConsoleErrors(): ConsoleEntry[] {
  return [...buffer].reverse();
}

/** Clear the buffer (e.g., after submitting a report). */
export function clearConsoleErrors(): void {
  buffer.length = 0;
}
