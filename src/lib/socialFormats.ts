/**
 * REQ-022 — Shared social-media format presets.
 *
 * One list, two consumers: the dashboard "Nuevo archivo" popup and the
 * editor's zero-frame empty state. Keeping it here means a new format
 * appears in both places at once and custom dimensions stay the only
 * other path. Sizes are the current platform-recommended export sizes.
 */

export interface SocialFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  { id: "ig-square", label: "Instagram Post (cuadrado)", width: 1080, height: 1080 },
  { id: "ig-portrait", label: "Instagram Post (vertical)", width: 1080, height: 1350 },
  { id: "story-reel", label: "Story / Reel / TikTok", width: 1080, height: 1920 },
  { id: "fb-post", label: "Facebook Post", width: 1200, height: 630 },
  { id: "x-post", label: "X (Twitter) Post", width: 1600, height: 900 },
  { id: "li-post", label: "LinkedIn Post", width: 1200, height: 1200 },
  { id: "yt-thumb", label: "YouTube Miniatura", width: 1280, height: 720 },
  { id: "pin", label: "Pinterest Pin", width: 1000, height: 1500 },
  { id: "web-hd", label: "Web / Presentación HD", width: 1920, height: 1080 },
];

/** Select value for user-typed dimensions (dashboard popup + editor empty state). */
export const CUSTOM_FORMAT_ID = "custom";

/** Dashboard popup option: create the file with zero frames. */
export const EMPTY_FORMAT_ID = "empty";

/** Clamp helper shared by both pickers — mirrors the API's 1..10000 rule. */
export function clampFrameDimension(value: string | number, fallback = 1080): number {
  const parsed = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(10000, Math.round(parsed)));
}
