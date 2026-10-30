/**
 * helpers.ts — lecturas seguras para filas de apiV2 con índice
 * `[k: string]: unknown` (la forma exacta la define el endpoint real).
 * Nada de mock: solo formateo de datos reales para celdas de tabla.
 */

/** Primer valor string/número entre las claves dadas, o undefined. */
export function pick(row: Record<string, unknown>, keys: string[]): string | number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Texto con fallback "—" para celdas de tabla. */
export function str(v: string | number | undefined, fallback = "—"): string {
  return v === undefined ? fallback : String(v);
}

/** Fecha ISO/epoch → "12 oct. 2026"; si no parsea, el texto tal cual. */
export function fmtDate(v: string | number | undefined): string {
  if (v === undefined) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/** Bytes → "1.2 GB" (uso de storage, contadores de agentes). */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
