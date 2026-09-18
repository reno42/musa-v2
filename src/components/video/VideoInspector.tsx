/**
 * VideoInspector — the Video Mode's right panel (CapCut property panel).
 * Context-aware: project format + reel summary + export/publish + storage
 * quota when nothing is selected; take / layer-object / media-clip /
 * text-clip / audio-clip editors when something is.
 *
 * V4 additions: project format picker (V4.0 — output canvas), per-take
 * framing/letterbox controls (V4.0), the AE-style Object editor for layers
 * (V4.1 — pos/escala/rotación/opacidad/anchor + stopwatches + auto-key) and
 * the extended 8-type transition vocabulary (V4.2).
 */

<<<<<<< HEAD
import { useMemo, useState } from "react";
=======
import { useState } from "react";
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
import {
  EASING_PRESETS,
  normalizeAnimation,
  sampleAnimationAt,
  type AnimationSchema,
  type TransitionType,
<<<<<<< HEAD
=======
  type Tween,
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
} from "../../../shared/animationSchema.ts";
import { resolveTakeLocal, sampleReelAt, takeStartSec, type ReelTimeline } from "../../lib/sequencePlayback";
import {
  coverScale,
  aspectMismatch,
  DEFAULT_TAKE_LAYOUT,
  type ReelTakeLayout,
} from "../../lib/reelLayout";
import {
  composeOrigin,
  composeTransform,
  parseOrigin,
  parseTransform,
  type TransformParts,
} from "../../lib/layerKeyframes";
import {
  REEL_FORMAT_PRESETS,
  type ReelAudioClip,
  type ReelMediaClip,
  type ReelProjectSettings,
  type ReelTextClip,
  type VideoTimelineDoc,
} from "../../lib/videoTimelineDoc";
<<<<<<< HEAD
import {
  LOOKS,
  LOOK_FAMILIES,
  TAKE_FX,
  OVERLAY_FX,
  LAYER_EFFECTS,
  TEXT_ANIMS,
} from "../../../shared/videoEffectsCatalog.ts";
import { TransitionLibrary } from "./TransitionLibrary";
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
import type { FrameData } from "../DesignFrame";
import type { TimelineSelection } from "./VideoTimeline";

/** V4.1 — one edit gesture from the Object editor. The mode root resolves it
 *  against the playhead (auto-key vs static hold lives in `animated`). */
export type LayerEdit =
  | { kind: "transform"; parts: TransformParts; animated: boolean }
  | { kind: "opacity"; value: number; animated: boolean }
  | { kind: "origin"; origin: string | null }
  | { kind: "easing"; easing: string }
  | { kind: "toggleKf"; prop: string; sampled: string }
  | { kind: "clear" };

export interface VideoInspectorProps {
  frames: FrameData[];
  included: FrameData[];
  tl: ReelTimeline;
  doc: VideoTimelineDoc;
  /** V4.0: the output canvas (format picker + letterbox math). */
  project: ReelProjectSettings;
  selection: TimelineSelection | null;
  /** Global playhead — the Object editor samples at it. */
  tSec: number;
  onSelect: (sel: TimelineSelection | null) => void;
  onTakeDuration: (frame: FrameData, d: number) => void;
  onAnimationFrameChange: (frameId: string, next: AnimationSchema | null) => void;
  onTransitionChange: (fromFrame: FrameData, toFrameId: string, next: { type: TransitionType; durationSec: number } | null) => void;
  onFrameReelChange: (frameId: string, reelExcluded: boolean) => void;
  /** V3.2: per-take CSS look ("" = original). */
  onFrameReelFilterChange: (frameId: string, filter: string) => void;
<<<<<<< HEAD
  /** V5.2: animated take FX (null = none). */
  onFrameReelFxChange: (frameId: string, fx: { id: string; intensity: number } | null) => void;
  /** V5.3: static overlay FX stack (empty = none). */
  onFrameReelOverlayFxChange: (frameId: string, ids: string[]) => void;
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
  /** V4.0: per-take framing on the project canvas (null = contain reset). */
  onFrameLayoutChange: (frameId: string, layout: ReelTakeLayout | null) => void;
  /** V4.0: change the project canvas. */
  onProjectChange: (p: ReelProjectSettings) => void;
  onAudioChange: (clipId: string, patch: Partial<ReelAudioClip> | null) => void;
  onMediaChange: (clipId: string, patch: Partial<ReelMediaClip> | null) => void;
  onTextChange: (clipId: string, patch: Partial<ReelTextClip> | null) => void;
  /** V3.6: apply an effect preset to a layer clip. */
  onApplyLayerEffect: (frameId: string, layerId: string, effectId: string) => void;
  /** V4.1: one Object-editor edit on a design layer. */
  onLayerEdit: (frameId: string, layerId: string, edit: LayerEdit) => void;
  /** V3.8: detect beats of an audio clip → timeline markers. */
  onDetectBeats: (clipId: string) => void;
  beatsBusy: boolean;
  exporting: boolean;
  progress: number;
  uploading: boolean;
  publishedUrl: string | null;
  onExport: () => void;
  onUploadPublish: () => void;
  onCopyUrl: () => void;
  /** V4.0: informational — takes whose aspect ≠ project (they letterbox). */
  mismatchCount: number;
  quota: { bytes: number; count: number } | null;
  exportFormat: "webm" | "mp4";
  onExportFormatChange: (f: "webm" | "mp4") => void;
  /** V4.3: open the AI-adapt flow for a frame (prompt → clipboard). */
  onAdaptWithAI: (frameId: string, w: number, h: number) => void;
  /** V4.3: bake the take's current framing INTO the design html. */
  onBakeToDesign: (frameId: string) => void;
  /** V4.1: auto-key is OWNED by the mode root (shared with the gizmo). */
  autoKey: boolean;
  onAutoKeyChange: (v: boolean) => void;
}

const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "3px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const inp: React.CSSProperties = {
  background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)",
  color: "#f0ebe0", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontFamily: "monospace",
};
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };
const sectionTitle: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 };

const TRANSITION_LABELS: Record<string, string> = {
  fade: "Fundido", slide: "Desliza", zoom: "Zoom", wipe: "Barrido",
  "slide-up": "Desliza ↑", "zoom-out": "Zoom out", blur: "Desenfoque", flash: "Flash",
};
const TRANSITION_ICONS: Record<string, string> = {
  fade: "◐", slide: "⇥", zoom: "⤢", wipe: "▥",
  "slide-up": "⤒", "zoom-out": "⤡", blur: "◍", flash: "✦",
};
const ALL_TRANSITIONS: TransitionType[] = ["fade", "slide", "zoom", "wipe", "slide-up", "zoom-out", "blur", "flash"];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (t: number) => `${t.toFixed(2)}s`;
const mb = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const r1 = (n: number) => Math.round(n * 10) / 10;

<<<<<<< HEAD
// V5: every effect vocabulary lives in the shared catalog (looks, take FX,
// overlays, 12 layer generators, 9 text anims). This module only re-exposes
// the layer generators under the V3.6 name the mode root imports.
export const EFFECT_PRESETS = LAYER_EFFECTS;
const activeSmall: React.CSSProperties = { borderColor: "rgba(200,184,152,0.6)", background: "rgba(200,184,152,0.14)" };

/** V5 look picker: catalog looks grouped by family + intensity slider. The
 *  persisted value stays the generated CSS filter string (V3.2 schema, no
 *  migration) — the active look/intensity is recovered by exact-match over a
 *  0.05-quantized sweep (legacy presets match exactly at i=1). */
function LookPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [fam, setFam] = useState<string>("all");
  const active = useMemo(() => {
    for (const look of LOOKS) {
      for (let q = 0; q <= 20; q++) {
        const i = q / 20;
        if (look.css(i) === value) return { look, i };
      }
    }
    return null;
  }, [value]);
  const shown = LOOKS.filter(l => fam === "all" || l.family === fam);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        <button type="button" onClick={() => setFam("all")} title="Todas las familias"
          style={{ ...smallBtn, padding: "2px 5px", ...(fam === "all" ? activeSmall : null) }}>▦</button>
        {LOOK_FAMILIES.map(f => (
          <button key={f.id} type="button" onClick={() => setFam(f.id)}
            style={{ ...smallBtn, padding: "2px 6px", ...(fam === f.id ? activeSmall : null) }}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
        {shown.map(l => (
          <button key={l.id} type="button" title={l.label + " — intensidad 100%"}
            onClick={() => onChange(l.css(1))}
            style={{ ...smallBtn, padding: "3px 2px", fontSize: 9, ...(active?.look.id === l.id ? activeSmall : null) }}>
            {l.label}
          </button>
        ))}
      </div>
      {active && active.look.id !== "none" && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ ...muted, flex: 1 }}>Intensidad</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(active.i * 100)}
            onChange={e => onChange(active.look.css(clamp(parseInt(e.target.value, 10) / 100, 0, 1)))}
            style={{ flex: 1.4, accentColor: "#c8b898" }} />
          <span style={{ ...muted, width: 28, textAlign: "right" }}>{Math.round(active.i * 100)}%</span>
        </div>
      )}
=======
/** V3.2 look presets — same CSS filter strings in preview AND export. */
export const REEL_FILTER_PRESETS: Array<{ id: string; label: string; value: string }> = [
  { id: "none", label: "Original", value: "" },
  { id: "warm", label: "Cálido", value: "saturate(1.15) sepia(0.18) brightness(1.03)" },
  { id: "cold", label: "Frío", value: "saturate(1.05) hue-rotate(-12deg) brightness(1.02)" },
  { id: "bw", label: "B/N", value: "grayscale(1) contrast(1.08)" },
  { id: "sepia", label: "Sepia", value: "sepia(0.55) contrast(1.05)" },
  { id: "punch", label: "Contraste", value: "contrast(1.25) saturate(1.1)" },
  { id: "soft", label: "Suave", value: "brightness(1.08) contrast(0.92) saturate(0.95)" },
  { id: "cine", label: "Cine", value: "contrast(1.15) saturate(0.85) brightness(0.97)" },
];

/** V3.6 effect presets for layer clips — tween generators following the
 *  shared grammar (keyframes t 0..1 across the clip window). Tweens replace
 *  same-prop tweens on the clip and keep the rest. The mode root consumes
 *  this list to apply effects through onApplyLayerEffect. */
export const EFFECT_PRESETS: Array<{ id: string; label: string; props: string[]; make: () => Tween[] }> = [
  { id: "shake", label: "Shake", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.55, 0.64, 0.73, 0.82, 0.91, 1].map((t, i) => ({
      t, value: `translateX(${(i % 2 === 0 ? 1 : -1) * 6}px) translateY(0px) scale(1) rotate(0deg)`,
    })),
  }] },
  { id: "pulse", label: "Pulse", props: ["transform"], make: () => [{
    prop: "transform", easing: "ease-in-out",
    keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
      { t: 0.5, value: "translateX(0px) translateY(0px) scale(1.06) rotate(0deg)" },
      { t: 1, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
    ],
  }] },
  { id: "glow", label: "Glow", props: ["filter"], make: () => [{
    prop: "filter", easing: "ease-in-out",
    keyframes: [
      { t: 0, value: "blur(0px) brightness(1)" },
      { t: 0.5, value: "blur(1.5px) brightness(1.35)" },
      { t: 1, value: "blur(0px) brightness(1)" },
    ],
  }] },
  { id: "pop-in", label: "Pop", props: ["transform"], make: () => [{
    prop: "transform", easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(0.4) rotate(0deg)" },
      { t: 0.35, value: "translateX(0px) translateY(0px) scale(1.08) rotate(0deg)" },
      { t: 1, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
    ],
  }] },
  { id: "ken-burns", label: "Ken Burns", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
      { t: 1, value: "translateX(0px) translateY(0px) scale(1.12) rotate(0deg)" },
    ],
  }] },
  { id: "fade-in", label: "Fade", props: ["opacity"], make: () => [{
    prop: "opacity", easing: "ease-out",
    keyframes: [{ t: 0, value: "0" }, { t: 0.3, value: "1" }, { t: 1, value: "1" }],
  }] },
];

/** Preset chips + free-form CSS input, shared by the take and media editors. */
function FilterRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const activeId = REEL_FILTER_PRESETS.find(p => p.value === value)?.id ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {REEL_FILTER_PRESETS.map(p => (
          <button key={p.id} type="button" title={p.value || "Sin filtro"}
            onClick={() => onChange(p.value)}
            style={{ ...smallBtn, padding: "2px 6px", borderColor: activeId === p.id ? "rgba(200,184,152,0.6)" : undefined, background: activeId === p.id ? "rgba(200,184,152,0.14)" : undefined }}>
            {p.label}
          </button>
        ))}
      </div>
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
      <input value={value} placeholder="CSS filter custom (ej. contrast(1.2))"
        onChange={e => onChange(e.target.value)} style={{ ...inp, width: "100%" }} />
    </div>
  );
}

/** Numeric field with a label — the Object editor's bread and butter. */
function NumField({ label, value, step, min, max, onCommit }: {
  label: string; value: number; step: number; min: number; max: number; onCommit: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ ...muted, width: 40 }}>{label}</span>
      <input type="number" step={step} min={min} max={max} value={r1(value)}
        onChange={e => onCommit(clamp(parseFloat(e.target.value) || 0, min, max))}
        style={{ ...inp, width: 58 }} />
    </label>
  );
}

/** Stopwatch (AE): filled when the prop has keyframes; click toggles one at
 *  the playhead with the currently sampled value. */
function Stopwatch({ on, count, onToggle, title }: { on: boolean; count: number; onToggle: () => void; title: string }) {
  return (
    <button type="button" title={`${title} — ${on ? `${count} keyframe(s); click para quitar el del playhead` : "sin keyframes; click para añadir uno en el playhead"}`}
      onClick={onToggle}
      style={{
        ...smallBtn, padding: "1px 5px", fontSize: 9, lineHeight: 1.2,
        color: on ? "#e0b57a" : "#5a5648",
        borderColor: on ? "rgba(224,181,122,0.5)" : "rgba(200,184,152,0.15)",
      }}>
      ◆{on ? count : ""}
    </button>
  );
}

export function VideoInspector({
  frames, included, tl, doc, project, selection, tSec, onSelect,
  onTakeDuration, onAnimationFrameChange, onTransitionChange, onFrameReelChange, onFrameReelFilterChange,
<<<<<<< HEAD
  onFrameReelFxChange, onFrameReelOverlayFxChange,
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
  onFrameLayoutChange, onProjectChange,
  onAudioChange, onMediaChange, onTextChange, onApplyLayerEffect, onLayerEdit, onDetectBeats, beatsBusy,
  exporting, progress, uploading, publishedUrl, onExport, onUploadPublish, onCopyUrl,
  mismatchCount, quota, exportFormat, onExportFormatChange, onAdaptWithAI, onBakeToDesign,
  autoKey, onAutoKeyChange: setAutoKey,
}: VideoInspectorProps) {
  const [customWh, setCustomWh] = useState<{ w: number; h: number } | null>(null);
  const frameById = new Map(frames.map(f => [f.id, f] as const));

  const patchTimeline = (frame: FrameData, patch: Partial<AnimationSchema["timeline"]>) => {
    const schema = frame.animation ? normalizeAnimation(frame.animation) : null;
    if (!schema) return;
    const next = normalizeAnimation({ ...schema, timeline: { ...schema.timeline, ...patch } });
    if (next) onAnimationFrameChange(frame.id, next);
  };

  const selTake = selection?.kind === "take" ? frameById.get(selection.frameId) || null : null;
  const selTakeIdx = selTake ? included.findIndex(f => f.id === selTake.id) : -1;
  const selAudio = selection?.kind === "audio" ? doc.audioClips.find(c => c.id === selection.clipId) || null : null;
  const selMedia = selection?.kind === "media" ? doc.mediaClips.find(c => c.id === selection.clipId) || null : null;
  const selText = selection?.kind === "text" ? doc.textClips.find(c => c.id === selection.clipId) || null : null;

  const activePreset = REEL_FORMAT_PRESETS.find(p => p.id === project.preset);
  const isCustom = project.preset === "custom";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "10px 12px", overflow: "auto", flex: 1, minHeight: 0 }}>
      {/* ── V4.0 project format ── */}
      <div>
        <div style={sectionTitle}>Formato del video (lienzo)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {REEL_FORMAT_PRESETS.map(p => (
            <button key={p.id} type="button" onClick={() => onProjectChange({ preset: p.id, width: p.width, height: p.height, bg: project.bg })}
              style={{ ...smallBtn, padding: "2px 6px", borderColor: project.preset === p.id ? "rgba(200,184,152,0.6)" : undefined, background: project.preset === p.id ? "rgba(200,184,152,0.14)" : undefined }}>
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => onProjectChange({ preset: "custom", width: customWh?.w ?? project.width, height: customWh?.h ?? project.height, bg: project.bg })}
            style={{ ...smallBtn, padding: "2px 6px", borderColor: isCustom ? "rgba(200,184,152,0.6)" : undefined, background: isCustom ? "rgba(200,184,152,0.14)" : undefined }}>
            Custom
          </button>
        </div>
        {isCustom && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
            <input type="number" min={16} max={8192} value={customWh?.w ?? project.width} title="Ancho en px"
              onChange={e => setCustomWh({ w: clamp(parseInt(e.target.value, 10) || 16, 16, 8192), h: customWh?.h ?? project.height })}
              style={{ ...inp, width: 62 }} />
            <span style={muted}>×</span>
            <input type="number" min={16} max={8192} value={customWh?.h ?? project.height} title="Alto en px"
              onChange={e => setCustomWh({ w: customWh?.w ?? project.width, h: clamp(parseInt(e.target.value, 10) || 16, 16, 8192) })}
              style={{ ...inp, width: 62 }} />
            <button type="button" onClick={() => { if (customWh) onProjectChange({ ...project, width: customWh.w, height: customWh.h }); }} style={smallBtn}>Aplicar</button>
          </div>
        )}
        <div style={{ ...muted, marginTop: 4 }}>
          Las tomas se reencuadran con letterbox{mismatchCount > 0 ? ` — ${mismatchCount} con otro aspect` : " · todas encajan"}.
        </div>
      </div>

      {/* ── Reel + export ── */}
      <div>
        <div style={sectionTitle}>Exportar reel</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
          {(["webm", "mp4"] as const).map(f => (
            <button key={f} type="button" onClick={() => onExportFormatChange(f)} title={f === "mp4" ? "MediaRecorder avc1 + audio en tiempo real" : "WebCodecs VP9/VP8 + Opus"}
              style={{ ...smallBtn, flex: 1, padding: "4px 0", borderColor: exportFormat === f ? "rgba(200,184,152,0.6)" : undefined, background: exportFormat === f ? "rgba(200,184,152,0.14)" : undefined }}>
              {f === "webm" ? "WebM" : "MP4"}
            </button>
          ))}
        </div>
        <button type="button" disabled={exporting || included.length === 0} onClick={onExport}
          style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, opacity: exporting ? 0.6 : 1 }}>
          {exporting ? `Renderizando… ${Math.round(progress * 100)}%` : `⬇ Exportar ${project.width}×${project.height} (${exportFormat === "mp4" ? "MP4" : "WebM"})`}
        </button>
        {exporting && (
          <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: "#c8b898", transition: "width 120ms linear" }} />
          </div>
        )}
        <div style={{ ...muted, marginTop: 5 }}>
          {included.length} toma{included.length === 1 ? "" : "s"} · {fmt(tl.totalDurationSec)} · {tl.fps} fps · render 100% en el navegador
        </div>
      </div>

      <div>
        <div style={sectionTitle}>Publicar</div>
        <button type="button" disabled={uploading} onClick={onUploadPublish} style={{ ...smallBtn, width: "100%", padding: "5px 8px", opacity: uploading ? 0.6 : 1 }}>
          {uploading ? "Subiendo…" : "⬆ Exportar y subir (URL pública)"}
        </button>
        {publishedUrl && (
          <div style={{ marginTop: 6 }}>
            <div style={{ ...inp, fontSize: 9, wordBreak: "break-all", padding: "4px 6px" }}>{publishedUrl}</div>
            <button type="button" onClick={onCopyUrl} style={{ ...smallBtn, marginTop: 4, width: "100%" }}>
              Copiar URL para mediaUrl (Zernio)
            </button>
          </div>
        )}
        {quota && (
          <div style={{ ...muted, marginTop: 6 }}>
            Storage: {mb(quota.bytes)} en {quota.count} archivo{quota.count === 1 ? "" : "s"}
            <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (quota.bytes / (1024 * 1024 * 1024)) * 100)}%`, background: quota.bytes > 800 * 1024 * 1024 ? "#e07a7a" : "#9fd6a0" }} />
            </div>
            <div style={{ marginTop: 2 }}>límite free tier ≈ 1 GB</div>
          </div>
        )}
      </div>

      {/* ── Selected take ── */}
      {selTake && selTakeIdx >= 0 && (() => {
        const take = tl.takes[selTakeIdx];
        const nextInc = included[selTakeIdx + 1];
<<<<<<< HEAD
=======
        const tr = take?.transitionOut || null;
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
        const layout: ReelTakeLayout = selTake.reelLayout ?? DEFAULT_TAKE_LAYOUT;
        const mismatch = aspectMismatch(project, selTake);
        const cover = coverScale(project, selTake);
        const setLayout = (l: ReelTakeLayout) => onFrameLayoutChange(selTake.id, l);
        return (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={sectionTitle}>Toma seleccionada</div>
            <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace" }}>{selTake.name}</div>
            <div style={muted}>{selTake.width}×{selTake.height} {mismatch ? "→ letterbox" : "→ llena el lienzo"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Duración</span>
              <input type="number" min={0.2} max={600} step={0.5} value={selTake.animation?.timeline.durationSec ?? 5}
                onChange={e => onTakeDuration(selTake, parseFloat(e.target.value) || 5)} style={{ ...inp, width: 56 }} />
              <span style={muted}>s</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Loop</span>
              <select value={selTake.animation?.timeline.loop ?? "once"} title="Comportamiento del loop dentro de la toma"
                onChange={e => patchTimeline(selTake, { loop: e.target.value as "once" | "loop" | "pingpong" })}
                style={{ ...inp, flex: 1 }}>
                <option value="once">Once</option>
                <option value="loop">Loop</option>
                <option value="pingpong">Ping-pong</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>FPS de la toma</span>
              <input type="number" min={1} max={60} value={selTake.animation?.timeline.fps ?? 30}
                onChange={e => patchTimeline(selTake, { fps: clamp(parseInt(e.target.value, 10) || 30, 1, 60) })} style={{ ...inp, width: 48 }} />
            </div>
            <label style={{ fontSize: 10, color: "#9fd6a0", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked onChange={e => onFrameReelChange(selTake.id, !e.target.checked)} style={{ accentColor: "#9fd6a0" }} />
              entra al reel
            </label>

            {/* V4.0: framing on the project canvas */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Encuadre en el lienzo (V4.0){mismatch ? " — toma con letterbox" : ""}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ ...muted, flex: 1 }}>Escala</span>
                <input type="range" min={5} max={400} step={5} value={Math.round(layout.scale * 100)}
                  onChange={e => setLayout({ ...layout, scale: clamp(parseInt(e.target.value, 10) / 100, 0.05, 4) })}
                  style={{ flex: 1.4, accentColor: "#c8b898" }} />
                <span style={{ ...muted, width: 34, textAlign: "right" }}>{Math.round(layout.scale * 100)}%</span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <NumField label="Pan X" value={layout.xPct} step={1} min={-200} max={200} onCommit={v => setLayout({ ...layout, xPct: v })} />
                <NumField label="Pan Y" value={layout.yPct} step={1} min={-200} max={200} onCommit={v => setLayout({ ...layout, yPct: v })} />
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                <button type="button" title="Contain fit centrado (layout por defecto)"
                  onClick={() => onFrameLayoutChange(selTake.id, null)} style={{ ...smallBtn, flex: 1 }}>
                  Ajustar
                </button>
                <button type="button" title={`Escala ${Math.round(cover * 100)}% — llena el lienzo sin letterbox`}
                  onClick={() => setLayout({ scale: cover, xPct: 0, yPct: 0 })} style={{ ...smallBtn, flex: 1 }}>
                  Rellenar
                </button>
                <button type="button" title="Arrastra la toma en el escenario para encuadrar"
                  onClick={() => setLayout({ ...layout, scale: Math.max(layout.scale, cover) })} style={{ ...smallBtn, flex: 1 }}>
                  ∔ Mover
                </button>
              </div>
              {mismatch && (
                <div style={{ display: "flex", gap: 3 }}>
                  <button type="button" title="Pide a la IA del chat una versión de este diseño en el formato del proyecto"
                    onClick={() => onAdaptWithAI(selTake.id, project.width, project.height)}
                    style={{ ...smallBtn, flex: 1, borderColor: "rgba(159,190,214,0.4)", color: "#9fbed6" }}>
                    ✦ Adaptar con IA
                  </button>
                  <button type="button" title={`Copia el encuadre actual DENTRO del diseño (el lienzo del diseño pasa a ${project.width}×${project.height})`}
                    onClick={() => onBakeToDesign(selTake.id)} style={{ ...smallBtn, flex: 1, borderColor: "rgba(159,214,178,0.4)", color: "#9fd6b2" }}>
                    ⌘ Hornear al diseño
                  </button>
                </div>
              )}
            </div>

            {/* V3.2: look filter */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
<<<<<<< HEAD
              <span style={muted}>Look (V5) — filtro CSS sobre la toma</span>
              <LookPicker value={selTake.reelFilter || ""} onChange={v => onFrameReelFilterChange(selTake.id, v)} />
            </div>

            {/* V5.2: animated take FX + V5.3 static overlay FX */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>FX de toma (V5) — movimiento animado</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                <button type="button" onClick={() => onFrameReelFxChange(selTake.id, null)}
                  style={{ ...smallBtn, padding: "2px 6px", ...(!selTake.reelFx ? activeSmall : null) }}>Ninguno</button>
                {TAKE_FX.map(fx => (
                  <button key={fx.id} type="button" title={fx.id}
                    onClick={() => onFrameReelFxChange(selTake.id, { id: fx.id, intensity: selTake.reelFx?.intensity ?? 0.7 })}
                    style={{ ...smallBtn, padding: "2px 6px", ...(selTake.reelFx?.id === fx.id ? activeSmall : null) }}>
                    {fx.label}
                  </button>
                ))}
              </div>
              {selTake.reelFx && (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ ...muted, flex: 1 }}>Intensidad</span>
                  <input type="range" min={0} max={100} step={5} value={Math.round(clamp(selTake.reelFx.intensity, 0, 1) * 100)}
                    onChange={e => onFrameReelFxChange(selTake.id, { id: selTake.reelFx!.id, intensity: clamp(parseInt(e.target.value, 10) / 100, 0, 1) })}
                    style={{ flex: 1.4, accentColor: "#c8b898" }} />
                  <span style={{ ...muted, width: 28, textAlign: "right" }}>{Math.round(selTake.reelFx.intensity * 100)}%</span>
                </div>
              )}
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Overlays (V5) — texturas sobre la toma</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {OVERLAY_FX.map(ofx => {
                  const on = !!selTake.reelOverlayFx?.includes(ofx.id);
                  const nextIds = on
                    ? (selTake.reelOverlayFx ?? []).filter(x => x !== ofx.id)
                    : [...(selTake.reelOverlayFx ?? []), ofx.id];
                  return (
                    <button key={ofx.id} type="button"
                      onClick={() => onFrameReelOverlayFxChange(selTake.id, nextIds)}
                      style={{ ...smallBtn, padding: "2px 6px", ...(on ? activeSmall : null) }}>
                      {ofx.icon} {ofx.label}
                    </button>
                  );
                })}
              </div>
=======
              <span style={muted}>Look (V3.2) — filtro CSS sobre la toma</span>
              <FilterRow value={selTake.reelFilter || ""} onChange={v => onFrameReelFilterChange(selTake.id, v)} />
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
            </div>

            {nextInc && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
<<<<<<< HEAD
                <span style={muted}>Transición → «{nextInc.name}» (V5)</span>
                <TransitionLibrary
                  current={(() => {
                    const trSel = selTake.animation?.transitions?.find(t => t.toFrameId === nextInc.id);
                    return trSel ? { type: trSel.type, durationSec: trSel.durationSec, params: trSel.params } : null;
                  })()}
                  onApply={pick => onTransitionChange(selTake, nextInc.id, { ...pick, type: pick.type as TransitionType })}
                  onRemove={() => onTransitionChange(selTake, nextInc.id, null)}
                />
=======
                <span style={muted}>Transición → «{nextInc.name}» (V4.2)</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3 }}>
                  {ALL_TRANSITIONS.map(t => (
                    <button key={t} type="button" title={`${TRANSITION_LABELS[t]} (${t})`}
                      onClick={() => onTransitionChange(selTake, nextInc.id, { type: t, durationSec: tr?.durationSec ?? 0.6 })}
                      style={{ ...smallBtn, padding: "4px 0", borderColor: tr?.type === t ? "rgba(200,184,152,0.6)" : undefined, background: tr?.type === t ? "rgba(200,184,152,0.14)" : undefined }}>
                      {TRANSITION_ICONS[t]}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ ...muted, flex: 1 }}>{tr ? TRANSITION_LABELS[tr.type] : "—"} · Duración</span>
                  <input type="number" min={0.1} max={5} step={0.1} value={tr?.durationSec ?? 0.6}
                    onChange={e => onTransitionChange(selTake, nextInc.id, { type: tr?.type ?? "fade", durationSec: clamp(parseFloat(e.target.value) || 0.6, 0.1, 5) })}
                    style={{ ...inp, width: 52 }} />
                  <span style={muted}>s</span>
                </div>
                {tr && (
                  <button type="button" onClick={() => onTransitionChange(selTake, nextInc.id, null)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
                    Quitar (corte seco)
                  </button>
                )}
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
              </div>
            )}
            <div style={muted}>Empieza en {fmt(takeStartSec(tl, selTakeIdx))} del reel.</div>
          </div>
        );
      })()}

      {/* ── Selected layer — AE-style Object editor (V4.1) ── */}
      {selection?.kind === "layer" && (() => {
        const frame = frameById.get(selection.frameId);
        const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
        const clip = schema?.clips.find(c => c.layerId === selection.layerId);
        if (!frame || !schema) return null;
        // Sample at the playhead — only exact when this frame is the active take.
        const s = sampleReelAt(tl, tSec);
        const localT = s.kind === "take" && included[s.takeIndex]?.id === frame.id ? s.localT : 0;
        const sample = sampleAnimationAt(schema, resolveTakeLocal(schema, localT)).get(selection.layerId) || {};
        const parts = parseTransform(sample.transform);
        const opacity = sample.opacity !== undefined ? parseFloat(sample.opacity) || 1 : 1;
        const trTween = clip?.tweens.find(t => String(t.prop) === "transform");
        const opTween = clip?.tweens.find(t => String(t.prop) === "opacity");
        const origin = parseOrigin(clip?.origin);
        return (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={sectionTitle}>Objeto (V4.1) · en «{trunc(frame.name, 14)}»</div>
            <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace" }}>{trunc(selection.layerId, 22)}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={autoKey} onChange={e => setAutoKey(e.target.checked)} style={{ accentColor: "#e0b57a" }} />
              <span style={muted}>Auto-key — cada cambio crea un keyframe en el playhead ({fmt(localT)})</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Posición X / Y (px)</span>
              <Stopwatch on={!!trTween} count={trTween?.keyframes.length ?? 0} title="Transform"
                onToggle={() => onLayerEdit(frame.id, selection.layerId, { kind: "toggleKf", prop: "transform", sampled: composeTransform(parts) })} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <NumField label="X" value={parts.x} step={1} min={-4000} max={4000}
                onCommit={v => onLayerEdit(frame.id, selection.layerId, { kind: "transform", parts: { ...parts, x: v }, animated: autoKey })} />
              <NumField label="Y" value={parts.y} step={1} min={-4000} max={4000}
                onCommit={v => onLayerEdit(frame.id, selection.layerId, { kind: "transform", parts: { ...parts, y: v }, animated: autoKey })} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <NumField label="Escala" value={parts.scale} step={0.05} min={0.02} max={8}
                onCommit={v => onLayerEdit(frame.id, selection.layerId, { kind: "transform", parts: { ...parts, scale: v }, animated: autoKey })} />
              <NumField label="Rot°" value={parts.rotate} step={1} min={-360} max={360}
                onCommit={v => onLayerEdit(frame.id, selection.layerId, { kind: "transform", parts: { ...parts, rotate: v }, animated: autoKey })} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Opacidad</span>
              <Stopwatch on={!!opTween} count={opTween?.keyframes.length ?? 0} title="Opacity"
                onToggle={() => onLayerEdit(frame.id, selection.layerId, { kind: "toggleKf", prop: "opacity", sampled: String(opacity) })} />
              <input type="range" min={0} max={100} value={Math.round(opacity * 100)}
                onChange={e => onLayerEdit(frame.id, selection.layerId, { kind: "opacity", value: clamp(parseInt(e.target.value, 10) / 100, 0, 1), animated: autoKey })}
                style={{ flex: 1.2, accentColor: "#c8b898" }} />
              <span style={{ ...muted, width: 30, textAlign: "right" }}>{Math.round(opacity * 100)}%</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={muted}>Anchor</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 14px)", gap: 2 }}>
                {[0, 1, 2].flatMap(gy => [0, 1, 2].map(gx => {
                  const active = Math.abs(origin.x - gx * 50) < 1 && Math.abs(origin.y - gy * 50) < 1;
                  return (
                    <button key={`${gx}-${gy}`} type="button"
                      onClick={() => onLayerEdit(frame.id, selection.layerId, { kind: "origin", origin: active ? null : composeOrigin(gx * 50, gy * 50) })}
                      title={`transform-origin ${gx * 50}% ${gy * 50}%`}
                      style={{
                        width: 14, height: 14, padding: 0, borderRadius: 2, cursor: "pointer",
                        border: "1px solid rgba(200,184,152,0.3)",
                        background: active ? "#e0b57a" : "rgba(200,184,152,0.07)",
                      }} />
                  );
                }))}
              </div>
              <span style={{ ...muted, flex: 1 }}>({origin.x}% {origin.y}%) — pivote de escala/rotación</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Easing del tween</span>
              <select value={trTween?.easing ?? "ease-out"}
                onChange={e => onLayerEdit(frame.id, selection.layerId, { kind: "easing", easing: e.target.value })}
                style={{ ...inp, flex: 1 }}>
                {EASING_PRESETS.map(p => <option key={p.id} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {/* V3.6: effect presets */}
            {clip && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={muted}>Efectos (V3.6) — reemplazan tweens de la misma propiedad</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {EFFECT_PRESETS.map(ef => (
                    <button key={ef.id} type="button" onClick={() => onApplyLayerEffect(frame.id, selection.layerId, ef.id)}
                      style={{ ...smallBtn, padding: "2px 6px" }}>
                      {ef.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {clip && (
              <div style={muted}>
                {clip.tweens.length} tween(s) · {fmt(clip.startSec)} → {fmt(clip.endSec)} de la toma
                <br />Arrastra el objeto en el escenario (mover) o sus manijas (escala ⟋ / rotación ✥).
              </div>
            )}
            <button type="button" onClick={() => onLayerEdit(frame.id, selection.layerId, { kind: "clear" })}
              style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
              Limpiar animación del objeto
            </button>
          </div>
        );
      })()}

      {/* ── Selected media clip (V3.4) ── */}
      {selMedia && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Clip de media</div>
          <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace", wordBreak: "break-all" }}>
            {selMedia.kind === "image" ? "🖼" : "🎬"} {selMedia.name}
          </div>
          {selMedia.kind === "video" && selMedia.sourceDurationSec > 0 && (
            <div style={muted}>Fuente: {fmt(selMedia.sourceDurationSec)}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Empieza en</span>
            <input type="number" min={0} max={3600} step={0.1} value={selMedia.startSec}
              onChange={e => onMediaChange(selMedia.id, { startSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Duración</span>
            <input type="number" min={0.2} max={3600} step={0.2} value={selMedia.durationSec}
              onChange={e => onMediaChange(selMedia.id, { durationSec: clamp(parseFloat(e.target.value) || 4, 0.2, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s</span>
          </div>
          {selMedia.kind === "video" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ ...muted, flex: 1 }}>Trim-in</span>
                <input type="number" min={0} max={3600} step={0.1} value={selMedia.trimInSec}
                  onChange={e => onMediaChange(selMedia.id, { trimInSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 56 }} />
                <span style={muted}>s</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ ...muted, flex: 1 }}>Volumen</span>
                <input type="range" min={0} max={150} value={Math.round(selMedia.volume * 100)}
                  onChange={e => onMediaChange(selMedia.id, { volume: clamp(parseInt(e.target.value, 10) / 100, 0, 1.5) })}
                  style={{ flex: 1.4, accentColor: "#c8b898" }} />
                <span style={{ ...muted, width: 30, textAlign: "right" }}>{Math.round(selMedia.volume * 100)}%</span>
              </div>
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={muted}>Look del clip</span>
<<<<<<< HEAD
            <LookPicker value={selMedia.filter} onChange={v => onMediaChange(selMedia.id, { filter: v })} />
=======
            <FilterRow value={selMedia.filter} onChange={v => onMediaChange(selMedia.id, { filter: v })} />
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
          </div>
          <button type="button" onClick={() => { onMediaChange(selMedia.id, null); onSelect(null); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
            Quitar del timeline
          </button>
        </div>
      )}

      {/* ── Selected text clip (V3.5) ── */}
      {selText && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Texto / sticker</div>
          <textarea value={selText.text} rows={2}
            onChange={e => onTextChange(selText.id, { text: e.target.value })}
            style={{ ...inp, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>X / Y (%)</span>
            <input type="number" min={0} max={100} value={Math.round(selText.xPct)}
              onChange={e => onTextChange(selText.id, { xPct: clamp(parseFloat(e.target.value) || 50, 0, 100) })} style={{ ...inp, width: 46 }} />
            <input type="number" min={0} max={100} value={Math.round(selText.yPct)}
              onChange={e => onTextChange(selText.id, { yPct: clamp(parseFloat(e.target.value) || 50, 0, 100) })} style={{ ...inp, width: 46 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...muted, flex: 1 }}>Tamaño</span>
            <input type="range" min={2} max={40} step={0.5} value={selText.sizePct}
              onChange={e => onTextChange(selText.id, { sizePct: clamp(parseFloat(e.target.value) || 5, 2, 40) })}
              style={{ flex: 1.4, accentColor: "#c8b898" }} />
            <span style={{ ...muted, width: 34, textAlign: "right" }}>{selText.sizePct}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Color / peso</span>
            <input type="color" value={selText.color} onChange={e => onTextChange(selText.id, { color: e.target.value })}
              style={{ width: 26, height: 20, padding: 0, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", cursor: "pointer" }} />
            <select value={String(selText.weight)} onChange={e => onTextChange(selText.id, { weight: clamp(parseInt(e.target.value, 10) || 700, 100, 900) })} style={inp}>
              <option value="400">400</option>
              <option value="700">700</option>
              <option value="900">900</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Fuente / fondo</span>
            <select value={selText.font} onChange={e => onTextChange(selText.id, { font: e.target.value })} style={{ ...inp, flex: 1 }}>
              <option value="system-ui, sans-serif">Sans</option>
              <option value="Georgia, serif">Serif</option>
              <option value="ui-monospace, monospace">Mono</option>
            </select>
            <input type="color" value={selText.bg || "#111111"} onChange={e => onTextChange(selText.id, { bg: e.target.value })}
              title="Fondo (píldora)" style={{ width: 26, height: 20, padding: 0, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", cursor: "pointer" }} />
            {selText.bg && (
              <button type="button" title="Quitar fondo" onClick={() => onTextChange(selText.id, { bg: "" })} style={{ ...smallBtn, padding: "2px 5px" }}>✕</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Animación</span>
            <select value={selText.anim} onChange={e => onTextChange(selText.id, { anim: e.target.value as ReelTextClip["anim"] })} style={{ ...inp, flex: 1 }}>
<<<<<<< HEAD
              {TEXT_ANIMS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
=======
              <option value="none">Ninguna</option>
              <option value="fade">Fade</option>
              <option value="pop">Pop</option>
              <option value="slide-up">Slide up</option>
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Inicio / duración</span>
            <input type="number" min={0} max={3600} step={0.1} value={selText.startSec}
              onChange={e => onTextChange(selText.id, { startSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 52 }} />
            <input type="number" min={0.2} max={3600} step={0.2} value={selText.durationSec}
              onChange={e => onTextChange(selText.id, { durationSec: clamp(parseFloat(e.target.value) || 3, 0.2, 3600) })} style={{ ...inp, width: 52 }} />
            <span style={muted}>s</span>
          </div>
          <button type="button" onClick={() => { onTextChange(selText.id, null); onSelect(null); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
            Quitar del timeline
          </button>
        </div>
      )}

      {/* ── Selected audio clip ── */}
      {selAudio && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Clip de audio</div>
          <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace", wordBreak: "break-all" }}>{selAudio.name}</div>
          <button type="button" disabled={beatsBusy} onClick={() => onDetectBeats(selAudio.id)}
            style={{ ...smallBtn, width: "100%", opacity: beatsBusy ? 0.6 : 1 }} title="Detecta onsets y añade markers de snap en el timeline (V3.8)">
            {beatsBusy ? "Analizando…" : "🥁 Detectar beats"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Empieza en</span>
            <input type="number" min={0} max={3600} step={0.1} value={selAudio.startSec}
              onChange={e => onAudioChange(selAudio.id, { startSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Duración</span>
            <input type="number" min={0.2} max={3600} step={0.5} value={selAudio.durationSec}
              onChange={e => onAudioChange(selAudio.id, { durationSec: clamp(parseFloat(e.target.value) || 10, 0.2, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s (loop)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...muted, flex: 1 }}>Volumen</span>
            <input type="range" min={0} max={150} value={Math.round(selAudio.volume * 100)}
              onChange={e => onAudioChange(selAudio.id, { volume: clamp(parseInt(e.target.value, 10) / 100, 0, 1.5) })}
              style={{ flex: 1.4, accentColor: "#c8b898" }} />
            <span style={{ ...muted, width: 30, textAlign: "right" }}>{Math.round(selAudio.volume * 100)}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted }}>Fade in</span>
            <input type="number" min={0} max={5} step={0.1} value={selAudio.fadeInSec}
              onChange={e => onAudioChange(selAudio.id, { fadeInSec: clamp(parseFloat(e.target.value) || 0, 0, 5) })} style={{ ...inp, width: 44 }} />
            <span style={{ ...muted }}>out</span>
            <input type="number" min={0} max={5} step={0.1} value={selAudio.fadeOutSec}
              onChange={e => onAudioChange(selAudio.id, { fadeOutSec: clamp(parseFloat(e.target.value) || 0, 0, 5) })} style={{ ...inp, width: 44 }} />
            <span style={muted}>s</span>
          </div>
          <button type="button" onClick={() => { onAudioChange(selAudio.id, null); onSelect(null); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
            Quitar del timeline
          </button>
        </div>
      )}

      {!selTake && !selAudio && !selMedia && !selText && selection?.kind !== "layer" && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          <div style={muted}>
            Selecciona un clip en el timeline (o un objeto en el escenario) para editarlo aquí.
          </div>
        </div>
      )}
    </div>
  );
}
