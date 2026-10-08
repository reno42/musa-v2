/**
 * panelPrefs — REQ041 P2.7: panel configuration as a workspace preference.
 *
 * Which Video-mode panels stay visible (Biblioteca, Inspector, Timeline) is
 * a user preference persisted to localStorage and RESTORED on reopen
 * (spec §10.4). Pure + store-injectable so QA can exercise it without a DOM.
 */

export interface VideoPanelPrefs {
  media: boolean;
  inspector: boolean;
  timeline: boolean;
}

export const VIDEO_PANELS_KEY = "musa.videoPanels";

export const DEFAULT_PANEL_PREFS: VideoPanelPrefs = { media: true, inspector: true, timeline: true };

/** Unknown/garbage input falls back panel-by-panel to visible (the default
 *  layout) — a corrupted preference must never hide the whole UI. */
export function sanitizePanelPrefs(raw: unknown): VideoPanelPrefs {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    media: typeof src.media === "boolean" ? src.media : DEFAULT_PANEL_PREFS.media,
    inspector: typeof src.inspector === "boolean" ? src.inspector : DEFAULT_PANEL_PREFS.inspector,
    timeline: typeof src.timeline === "boolean" ? src.timeline : DEFAULT_PANEL_PREFS.timeline,
  };
}

type MinimalStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function loadPanelPrefs(store?: MinimalStore | null): VideoPanelPrefs {
  if (!store || typeof store.getItem !== "function") return { ...DEFAULT_PANEL_PREFS };
  try {
    const raw = store.getItem(VIDEO_PANELS_KEY);
    if (!raw) return { ...DEFAULT_PANEL_PREFS };
    return sanitizePanelPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PANEL_PREFS };
  }
}

export function savePanelPrefs(prefs: VideoPanelPrefs, store?: MinimalStore | null): void {
  if (!store || typeof store.setItem !== "function") return;
  try {
    store.setItem(VIDEO_PANELS_KEY, JSON.stringify(sanitizePanelPrefs(prefs)));
  } catch {
    /* quota/privacy mode — the preference simply doesn't persist */
  }
}
