import type { VersionFrame } from "./versionDiff.js";

export interface CompatibleVersionPayload {
  frames: VersionFrame[];
  canvasObjects?: unknown[];
  templateName?: string;
}

function recordValue(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

/**
 * Convert payloads left by the original Postgres-only version table into the
 * current frame-based shape.
 */
export function legacyVersionDataToPayload(value: unknown): CompatibleVersionPayload | null {
  let current = recordValue(value);
  for (let depth = 0; current && depth < 3; depth++) {
    if (Array.isArray(current.frames)) {
      const frames = current.frames
        .map((frame: unknown, index: number) => {
          const item = recordValue(frame);
          if (!item) return null;
          return {
            ...item,
            id: String(item.id || `legacy-frame-${index + 1}`),
            html: String(item.html || ""),
            css: String(item.css || ""),
          } as VersionFrame;
        })
        .filter((frame: VersionFrame | null): frame is VersionFrame => Boolean(frame));
      if (frames.length > 0) {
        return {
          frames,
          canvasObjects: Array.isArray(current.canvasObjects) ? current.canvasObjects : undefined,
          templateName: typeof current.templateName === "string"
            ? current.templateName
            : typeof current.name === "string"
              ? current.name
              : undefined,
        };
      }
    }

    if (typeof current.html === "string" || typeof current.css === "string") {
      return {
        frames: [{
          id: String(current.frameId || current.id || "legacy-frame-1"),
          name: typeof current.name === "string" ? current.name : "Versión heredada",
          html: String(current.html || ""),
          css: String(current.css || ""),
        }],
        canvasObjects: Array.isArray(current.canvasObjects) ? current.canvasObjects : undefined,
        templateName: typeof current.templateName === "string" ? current.templateName : undefined,
      };
    }

    current = recordValue(current.data)
      || recordValue(current.template)
      || recordValue(current.snapshot);
  }
  return null;
}
