export const PREVIEW_SNOOZE_DAYS = [1, 2, 3, 5, 20, 30] as const;
export type PreviewSnoozeDays = typeof PREVIEW_SNOOZE_DAYS[number];

export function isPreviewSnoozeDays(value: number): value is PreviewSnoozeDays {
  return PREVIEW_SNOOZE_DAYS.includes(value as PreviewSnoozeDays);
}

export function isPreviewStale(designUpdatedAt?: string | null, coverCapturedAt?: string | null): boolean {
  const designTime = Date.parse(designUpdatedAt || "");
  if (!Number.isFinite(designTime)) return false;
  const captureTime = Date.parse(coverCapturedAt || "");
  // Sin captura no hay preview viejo que anunciar: el recordatorio existe
  // para avisar que el preview quedó atrás del diseño, no para pedir el
  // primer cover. (La mayoría de los archivos nunca ha capturado uno.)
  if (!Number.isFinite(captureTime)) return false;
  return designTime > captureTime;
}

export function shouldShowPreviewReminder(params: {
  designUpdatedAt?: string | null;
  coverCapturedAt?: string | null;
  snoozedUntil?: string | null;
  now?: Date;
}): boolean {
  if (!isPreviewStale(params.designUpdatedAt, params.coverCapturedAt)) return false;
  const snoozedUntil = Date.parse(params.snoozedUntil || "");
  return !Number.isFinite(snoozedUntil) || snoozedUntil <= (params.now || new Date()).getTime();
}
