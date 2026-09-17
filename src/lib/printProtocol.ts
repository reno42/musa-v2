/**
 * Mensajes entre el hilo principal y ghostscript.worker.ts (Fase 2/3 del
 * export de imprenta). Contrato único compartido por cmykEngine.ts (cliente)
 * y el worker — sin duplicar formas en ambos lados.
 */

export interface PrintProgressInfo {
  phase: "rendering" | "preparing" | "converting" | "proofing" | "done" | "error";
  current: number;
  total: number;
  /** Línea para el log del dialog (dpi efectivo, nombre de archivo, etc.). */
  message?: string;
}

export type PrintWorkerRequest =
  /** Carga del motor (descarga gs.wasm con progreso) sin job asociado. */
  | { kind: "init"; jobId: number }
  /** PDF RGB → PDF DeviceCMYK con OutputIntent del perfil. Los campos
   *  outputCondition* van cuando el PDF debe DECLARAR su condición de
   *  impresión (el worker incrusta el intent vía pdfOutputIntent). */
  | { kind: "convert"; jobId: number; pdfBytes: ArrayBuffer; iccBytes: ArrayBuffer; iccName: string; outputConditionIdentifier?: string; outputConditionInfo?: string }
  /** Convert + render a PNG (soft-proof ICC-preciso, Fase 3): el PNG sale
   *  de rasterizar el PDF CMYK, así que ya muestra los colores "caídos". */
  | { kind: "proof"; jobId: number; pdfBytes: ArrayBuffer; iccBytes: ArrayBuffer; iccName: string; renderDpi: number }
  /** Convert + render por placas (paridad parcial con Separations
   *  Preview): pamcmyk32 rasteriza el PDF CMYK a PAM de 4 canales y el
   *  worker parte la tira en C/M/Y/K. */
  | { kind: "separations"; jobId: number; pdfBytes: ArrayBuffer; iccBytes: ArrayBuffer; iccName: string; renderDpi: number };

/** Placas de tinta: cobertura 0-255 por píxel (0 = sin tinta). */
export interface SeparationsResult {
  width: number;
  height: number;
  plates: { c: ArrayBuffer; m: ArrayBuffer; y: ArrayBuffer; k: ArrayBuffer };
}

export type PrintWorkerResponse =
  | { kind: "ready"; jobId: number }
  | { kind: "engine-progress"; jobId: number; loaded: number; total: number }
  | { kind: "job-done"; jobId: number; bytes: ArrayBuffer; mime: "application/pdf" | "image/png" }
  | { kind: "separations-done"; jobId: number; result: SeparationsResult }
  | { kind: "job-error"; jobId: number; error: string };
