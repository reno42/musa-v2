const REMINDER_PREFIX = "futuraria:preview-reminder";

export function localDayKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function previewReminderStorageKey(templateId: string, userId?: string | null): string {
  return `${REMINDER_PREFIX}:${userId || "anonymous"}:${templateId}`;
}

export function isPreviewStale(designUpdatedAt?: string | null, coverCapturedAt?: string | null): boolean {
  const designTime = Date.parse(designUpdatedAt || "");
  if (!Number.isFinite(designTime)) return false;
  const captureTime = Date.parse(coverCapturedAt || "");
  return !Number.isFinite(captureTime) || designTime > captureTime;
}

export function shouldShowPreviewReminder(params: {
  designUpdatedAt?: string | null;
  coverCapturedAt?: string | null;
  lastShownDay?: string | null;
  now?: Date;
}): boolean {
  const today = localDayKey(params.now);
  return isPreviewStale(params.designUpdatedAt, params.coverCapturedAt)
    && params.lastShownDay !== today;
}
