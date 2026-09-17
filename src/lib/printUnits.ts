/**
 * printUnits — unidades físicas del export de imprenta (feedback de
 * producto: "tengo algo en px, ¿cuánto es en mm/cm?" + escalar el trabajo a
 * un tamaño físico concreto desde el dialog del export).
 *
 * Concepto: un diseño en px NO tiene tamaño físico hasta fijar una densidad.
 * El puente es el dpi (PRINT_DPI fijo de producto): mm = px / dpi × 25.4.
 * Escalar = elegir otra densidad de salida → el raster se re-renderiza
 * (rasterizeFrame escala el HTML: el texto sigue nítido) y el dpi efectivo
 * baja/sube — el dialog avisa cuando cae por debajo del estándar 300.
 *
 * Puro y sin DOM: la QA lo importa en Node igual que printExport.
 */
import { PRINT_DPI, MM_PER_INCH, pxToMm } from "./printExport.ts";

export type PrintUnit = "px" | "mm" | "cm" | "in";

/** mm que mide 1 unidad física (px no entra: depende del dpi). */
const UNIT_MM: Record<Exclude<PrintUnit, "px">, number> = { mm: 1, cm: 10, in: MM_PER_INCH };

export const PRINT_UNITS: PrintUnit[] = ["px", "mm", "cm", "in"];

/** Convierte un valor entre unidades. px ↔ físico usa PRINT_DPI como
 *  densidad de referencia — la misma de "medidas del archivo" (1080px ≡
 *  91.44mm), así el número en px del input coincide con el frame 1:1. */
export function convertUnit(value: number, from: PrintUnit, to: PrintUnit): number {
  if (!Number.isFinite(value) || from === to) return value;
  const mm = from === "px" ? (value / PRINT_DPI) * MM_PER_INCH : value * UNIT_MM[from];
  return to === "px" ? (mm / MM_PER_INCH) * PRINT_DPI : mm / UNIT_MM[to];
}

/** Escala (multiplicador sobre los px del frame) para que la página final
 *  mida targetMm de ancho. El dialog la acota con clampScale (printExport). */
export function scaleForPageWidth(targetMm: number, framePx: number): number {
  return targetMm / pxToMm(framePx);
}

/** Acepta coma decimal ("10,5") y espacios. Vacío o basura → NaN (el
 *  dialog lo trata como "no aplicar"). */
export function parseTargetValue(raw: string): number {
  const text = String(raw).trim();
  if (!text) return NaN;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** Formatea un valor en mm a la unidad destino con decimales sensatos
 *  (mm/px con 1, cm/in con 2 — suficiente para imprenta y sin ruido). */
export function formatInUnit(mm: number, unit: PrintUnit): string {
  const v = convertUnit(mm, "mm", unit);
  return v.toFixed(unit === "px" || unit === "mm" ? 1 : 2);
}
