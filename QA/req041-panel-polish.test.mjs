/**
 * QA REQ041 — P2.7 hover thumbnails, panel configuration, contrast polish.
 * Plain .mjs (node --experimental-strip-types). panelPrefs.ts is DOM-free
 * (store injectable), so it runs functional tests; the hover thumbnail card
 * and the wiring are covered as source contracts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const {
  VIDEO_PANELS_KEY,
  DEFAULT_PANEL_PREFS,
  sanitizePanelPrefs,
  loadPanelPrefs,
  savePanelPrefs,
} = await import("../src/lib/panelPrefs.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
}

test("P27-1a sanitizePanelPrefs: garbage falls back per-panel to visible", () => {
  assert.deepEqual(sanitizePanelPrefs(null), DEFAULT_PANEL_PREFS);
  assert.deepEqual(sanitizePanelPrefs("junk"), DEFAULT_PANEL_PREFS);
  assert.deepEqual(sanitizePanelPrefs({ media: false }), { media: false, inspector: true, timeline: true });
  // Per-panel fallback: the valid boolean survives, garbage reverts.
  assert.deepEqual(sanitizePanelPrefs({ media: "no", inspector: false, timeline: 1 }), { media: true, inspector: false, timeline: true });
  assert.deepEqual(sanitizePanelPrefs({ media: true, inspector: false, timeline: false }), { media: true, inspector: false, timeline: false });
});

test("P27-1b load/save: round-trip, corrupted JSON, hostile store", () => {
  // No store → defaults.
  assert.deepEqual(loadPanelPrefs(null), DEFAULT_PANEL_PREFS);
  assert.deepEqual(loadPanelPrefs(undefined), DEFAULT_PANEL_PREFS);
  // Empty store → defaults.
  assert.deepEqual(loadPanelPrefs(fakeStore()), DEFAULT_PANEL_PREFS);
  // Valid payload round-trips.
  const store = fakeStore({ [VIDEO_PANELS_KEY]: JSON.stringify({ media: false, inspector: true, timeline: false }) });
  assert.deepEqual(loadPanelPrefs(store), { media: false, inspector: true, timeline: false });
  // Corrupted JSON → defaults (never throw, never hide the UI).
  const bad = fakeStore({ [VIDEO_PANELS_KEY]: "{not json" });
  assert.deepEqual(loadPanelPrefs(bad), DEFAULT_PANEL_PREFS);
  // Save sanitizes before writing.
  const out = fakeStore();
  savePanelPrefs({ media: true, inspector: false, timeline: "x" }, out);
  assert.deepEqual(JSON.parse(out.dump()[VIDEO_PANELS_KEY]), { media: true, inspector: false, timeline: true });
  // A throwing store must not propagate (quota/privacy mode).
  const hostile = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.doesNotThrow(() => savePanelPrefs(DEFAULT_PANEL_PREFS, hostile));
});

test("P27-2 hover thumbnail: time window + loading state (VideoTimeline)", () => {
  const t = src("src/components/video/VideoTimeline.tsx");
  // Hover state carries the take's identity AND its time window.
  assert.match(t, /setHoverTake\(\{ frameId: vc\.frameId, name: f\?\.name \|\| vc\.frameId, startSec: vc\.startSec, durSec: vc\.durSec, idx: i \}\)/);
  assert.match(t, /onMouseLeave=\{\(\) => setHoverTake\(h => \(h\?\.frameId === vc\.frameId \? null : h\)\)\}/);
  // The card: data hook, thumbnail-or-loading branch, and WHICH time it covers.
  assert.match(t, /data-video-hover-thumb/);
  assert.match(t, /thumbs\[hoverTake\.frameId\]/);
  assert.match(t, /Generando miniatura…/);
  assert.match(t, /Toma \{hoverTake\.idx \+ 1\} · \{fmt\(hoverTake\.startSec\)\} → \{fmt\(hoverTake\.startSec \+ hoverTake\.durSec\)\}/);
  // The card never steals the pointer from the clip underneath.
  assert.match(t, /pointerEvents: "none",\s*\n\s*background: "rgba\(12,12,12,0\.95\)"/);
});

test("P27-3 panel configuration: persisted, restored, three panels", () => {
  const o = src("src/components/VideoModeOverlay.tsx");
  assert.match(o, /import \{ loadPanelPrefs, savePanelPrefs, type VideoPanelPrefs \} from "\.\.\/lib\/panelPrefs";/);
  // Restored on mount (workspace preference), saved on every toggle.
  assert.match(o, /loadPanelPrefs\(typeof localStorage !== "undefined" \? localStorage : null\)/);
  assert.match(o, /const togglePanel = \(key: keyof VideoPanelPrefs\)/);
  assert.match(o, /savePanelPrefs\(next, typeof localStorage !== "undefined" \? localStorage : null\)/);
  // The popover and its three panels.
  assert.match(o, /data-video-panel-toggle/);
  assert.match(o, /data-video-panel-menu/);
  assert.match(o, /\["media", "Biblioteca"\], \["inspector", "Inspector"\], \["timeline", "Timeline"\]/);
  assert.match(o, /checked=\{panelPrefs\[key\]\} onChange=\{\(\) => togglePanel\(key\)\}/);
  // Guards: each panel actually unmounts when unchecked.
  assert.match(o, /\{panelPrefs\.media && \(/);
  assert.match(o, /\{panelPrefs\.inspector && \(/);
  assert.match(o, /\{panelPrefs\.timeline && \(/);
});

test("P27-4 contrast: the flagged low-contrast literals are gone from motion surfaces", () => {
  const files = [
    "src/components/VideoModeOverlay.tsx",
    "src/components/video/VideoInspector.tsx",
    "src/components/video/VideoTimeline.tsx",
    "src/components/video/VideoMediaPanel.tsx",
    "src/components/video/FxLibraryPanel.tsx",
    "src/components/video/TransitionLibrary.tsx",
    "src/components/AnimationPanel.tsx",
  ];
  for (const f of files) {
    const s = src(f);
    assert.ok(!s.includes("#7a7668"), `${f} still uses #7a7668`);
    assert.ok(!s.includes("#5a5648"), `${f} still uses #5a5648`);
    assert.ok(!s.includes("#5a564a"), `${f} still uses #5a564a`);
    assert.ok(!s.includes('"#555"'), `${f} still uses "#555"`);
  }
  // The replacement tokens landed.
  assert.ok(src("src/components/VideoModeOverlay.tsx").includes("#96917f"));
  assert.ok(src("src/components/video/VideoTimeline.tsx").includes("#8a8578"));
});
