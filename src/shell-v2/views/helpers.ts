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

/** Texto con fallback "—" para celdas de tabla (acepta null de columnas nullable). */
export function str(v: string | number | null | undefined, fallback = "—"): string {
  return v === undefined || v === null ? fallback : String(v);
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

/** Número + moneda → "US$ 1,234" (formateadores cacheados por moneda). */
const moneyFmt = new Map<string, Intl.NumberFormat>();

export function fmtMoney(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const code = currency || "USD";
  let fmt = moneyFmt.get(code);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("es-PE", { style: "currency", currency: code, maximumFractionDigits: 0 });
    } catch {
      // Código de moneda inválido en la BD: número plano en vez de romper la vista.
      fmt = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });
    }
    moneyFmt.set(code, fmt);
  }
  return fmt.format(amount);
}
