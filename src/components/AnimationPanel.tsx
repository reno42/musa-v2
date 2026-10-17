/**
 * AnimationPanel — the "Animation" tab UI, shared by two hosts:
 *
 *  • Layer mode (HtmlContextualPanel subTab "animation"): author ONE layer's
 *    clip — presets, time window, per-tween keyframes/easing.
 *  • Frame mode (EditorV2, frame selected): timeline settings, playback,
 *    clip overview, cross-frame transitions and the video export button.
 *
 * The panel never touches CSS/WAAPI itself: it edits `frame.animation` (the
 * single JSON source of truth) and drives preview through the playback store
 * (playFrame/seekFrame/…) which the per-frame animator engine consumes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANIMATION_PRESETS,
  ANIMATION_PROPS,
  PRESET_CATEGORIES,
  defaultAnimation,
  normalizeAnimation,
  type AnimationSchema,
  type Clip,
  type Keyframe,
  type PresetCategory,
  type Tween,
} from "../../shared/animationSchema.ts";
import {
  applyPresetConsistent,
  checkPresetCompat,
  filterPresets,
  previewAnimationValue,
  previewCssBlock,
  removeLayerAnimation,
  staggerClips,
  type AnimationPreset,
} from "../lib/presetLibrary";
import {
  getFramePlayback,
  pauseFrame,
  playFrame,
  seekFrame,
  stopFrame,
  subscribeFramePlayback,
} from "../lib/animationPlayback";
import {
  EXPRESSION_RULES,
  applyExpressionToSchema,
  defaultExpressionParams,
  expressionOfLayer,
  findExpressionRule,
  updateExpressionParams,
} from "../lib/expressionRules";
import { bakePresetInstance } from "../lib/presetInstances";
import { EasingPicker } from "./EasingPicker";
import { AnimationTimeline } from "./AnimationTimeline";

// ── Local idiom (matches HtmlContextualPanel's glass styling) ──

const inp: React.CSSProperties = {
  flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)",
  color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0,
};
const sel: React.CSSProperties = { ...inp, fontFamily: "inherit" };
const smallBtn: React.CSSProperties = {
  fontSize: 9, padding: "3px 7px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer",
};
const sectionBody: React.CSSProperties = {
  padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};
const sectionHead: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "6px 10px", background: "transparent", border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  color: "#9a968a", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, cursor: "pointer",
  fontFamily: "inherit", textAlign: "left", width: "100%",
};
const mutedNote: React.CSSProperties = {
  fontSize: 10, lineHeight: 1.5, color: "#96917f", padding: "2px 2px 4px",
};

function Section({ label, children, defaultOpen = true }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button type="button" style={sectionHead} onClick={() => setOpen(o => !o)}>
        {label} <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={sectionBody}>{children}</div>}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: "#96917f", flex: "0 0 62px", textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── P2.6 preset cards: live hover/focus preview + explicit apply ──

const cardBtn: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch",
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 5, padding: 5, cursor: "pointer", textAlign: "left", width: "calc(50% - 2px)",
  fontFamily: "inherit",
};
const cardBtnLive: React.CSSProperties = {
  borderColor: "rgba(200,184,152,0.5)", background: "rgba(200,184,152,0.08)",
};
const previewBox: React.CSSProperties = {
  height: 34, borderRadius: 3, background: "rgba(0,0,0,0.35)",
  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.05)",
};
const previewDot: React.CSSProperties = {
  width: 16, height: 16, borderRadius: "50%",
  background: "linear-gradient(135deg, #c8b898, #8a7a5a)",
};

function PresetCard({ preset, onApply }: { preset: AnimationPreset; onApply: (id: string) => void }) {
  const [live, setLive] = useState(false);
  return (
    <button
      type="button"
      style={live ? { ...cardBtn, ...cardBtnLive } : cardBtn}
      onMouseEnter={() => setLive(true)}
      onMouseLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
      onClick={() => onApply(preset.id)}
      title={`${preset.label} — ${preset.about}`}
    >
      <span style={previewBox}>
        <span style={{ ...previewDot, animation: live ? previewAnimationValue(preset.id) : "none" }} />
      </span>
      <span style={{ fontSize: 10, color: "#e8e2d4", lineHeight: 1.3 }}>{preset.label}</span>
      <span style={{ fontSize: 9, color: "#96917f", lineHeight: 1.3 }}>{preset.about}</span>
    </button>
  );
}

// ── Top-level layer discovery (frame mode: pick a preset target) ──

/** Layer ids of the direct children of the frame body that carry
 *  data-layer-id — the same set the Layers panel lists. */
function extractTopLevelLayerIds(html: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const ids: string[] = [];
    for (const el of Array.from(doc.body.children)) {
      const id = el.getAttribute?.("data-layer-id");
      if (id) ids.push(id);
    }
    return ids;
  } catch { return []; }
}

// ── Component ──

export interface AnimationPanelProps {
  frameId: string;
  /** Author this layer's clip only (layer mode). Absent = frame mode. */
  layerId?: string;
  /** frame.html — frame mode only, to list targetable layers. */
  frameHtml?: string;
  animation?: AnimationSchema | null;
  onAnimationChange: (next: AnimationSchema | null) => void;
  /** Frame mode: other frames in this template, as transition targets. */
  siblingFrames?: Array<{ id: string; name: string }>;
  /** Frame mode: F1 client-side export (WebM) handler. */
  onExportVideo?: () => void;
  exportingVideo?: boolean;
  /** Frame mode: open the full-screen Modo Video (storyboard + timeline). */
  onOpenVideoMode?: () => void;
}

/** Sensible first keyframes when a user adds a tween from scratch. */
function defaultTweenFor(prop: string): Tween {
  const id = { transform: "translateX(0px) translateY(0px) scale(1) rotate(0deg)", opacity: "1", filter: "blur(0px) brightness(1)" }[prop];
  const from: Record<string, string> = {
    opacity: "0",
    transform: "translateX(-40px) translateY(0px) scale(1) rotate(0deg)",
    filter: "blur(8px) brightness(1)",
  };
  const a = from[prop] ?? id ?? "0";
  const b = id ?? "1";
  return { prop, easing: "ease-out", keyframes: [{ t: 0, value: a }, { t: 1, value: b }] };
}

export function AnimationPanel({
  frameId, layerId, frameHtml, animation, onAnimationChange,
  siblingFrames, onExportVideo, exportingVideo, onOpenVideoMode,
}: AnimationPanelProps) {
  const schema = animation || null;
  const layerMode = !!layerId;

  // ── P2.6 library state (search, category, notices, replace-confirm) ──
  const [presetQuery, setPresetQuery] = useState("");
  const [presetCat, setPresetCat] = useState<PresetCategory | "all">("all");
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [confirmPreset, setConfirmPreset] = useState<string | null>(null);
  const visiblePresets = useMemo(() => filterPresets(presetQuery, presetCat), [presetQuery, presetCat]);

  // ── REQ043 expression state (selected rule, draft params, notices) ──
  const [expSel, setExpSel] = useState<string | null>(null);
  const [expDraft, setExpDraft] = useState<Record<string, number> | null>(null);
  const [expNotice, setExpNotice] = useState<string | null>(null);
  const [confirmExp, setConfirmExp] = useState<string | null>(null);

  // ── G2 stagger/timing — which clips "Escalonar selección" touches (frame
  //    mode). Layer mode edits delay/duration on the selected layer directly. ──
  const [clipSel, setClipSel] = useState<Set<string>>(new Set());
  const [staggerMs, setStaggerMs] = useState(150);
  const [staggerNotice, setStaggerNotice] = useState<string | null>(null);

  // ── G1 work area (área de trabajo): preview range for Play, owned here so
  //    the transport and the multi-track timeline share one source. ──
  const [work, setWork] = useState<{ in: number; out: number } | null>(null);

  // ── Playback transport (mirrors the external store) ──
  const [playback, setPlayback] = useState(() => getFramePlayback(frameId));
  // The engine publishes timeSec at rAF rate while playing; re-rendering this
  // panel (and the EditorV2 tree behind it) on every tick is waste. Playing
  // flag flips pass through instantly; pure time updates throttle to ~20Hz —
  // finer than the time label shows and imperceptible on the scrub slider.
  const lastPushRef = useRef({ playing: false, timeSec: -1 });
  useEffect(() => {
    const s = getFramePlayback(frameId);
    lastPushRef.current = { playing: s.playing, timeSec: s.timeSec };
    setPlayback({ ...s });
    return subscribeFramePlayback(frameId, () => {
      const next = getFramePlayback(frameId);
      const last = lastPushRef.current;
      if (next.playing === last.playing && next.playing && Math.abs(next.timeSec - last.timeSec) < 0.05) return;
      lastPushRef.current = { playing: next.playing, timeSec: next.timeSec };
      setPlayback({ ...next });
    });
  }, [frameId]);

  const duration = schema?.timeline.durationSec ?? 5;

  // G1: the head pauses as soon as it leaves the work area (preview-only
  // enforcement — the engine keeps its own loop semantics, we stop ours).
  useEffect(() => {
    if (playback.playing && work && work.out < duration - 0.001 && playback.timeSec >= work.out - 0.01) {
      pauseFrame(frameId);
    }
  }, [playback.playing, playback.timeSec, work, duration, frameId]);

  /** Every keyframe time in the schema (clip windows applied) — prev/next
   *  navigation and the timeline's snap candidates. */
  const kfTimes = useMemo(() => {
    const ts: number[] = [];
    for (const c of schema?.clips || []) {
      const dur = Math.max(0, c.endSec - c.startSec);
      for (const tw of c.tweens) {
        for (const k of tw.keyframes) ts.push(Math.round((c.startSec + k.t * dur) * 100) / 100);
      }
    }
    return ts.sort((a, b) => a - b);
  }, [schema]);

  const jumpKf = (dir: -1 | 1) => {
    const now = playback.timeSec;
    const target = dir < 0
      ? [...kfTimes].reverse().find(t => t < now - 0.001)
      : kfTimes.find(t => t > now + 0.001);
    if (target !== undefined) seekFrame(frameId, Math.min(duration, Math.max(0, target)));
  };

  /** G1: Play honors the work area — outside it (or at the end), start at
   *  the area's in point; inside it, resume where the head stands. */
  const playFrom = () => {
    let start = playback.timeSec >= duration - 0.01 ? 0 : playback.timeSec;
    if (work && (start < work.in - 0.01 || start >= work.out - 0.01)) start = work.in;
    playFrame(frameId, start);
  };

  /** Edit-and-commit: normalize every mutation, drop the field entirely when
   *  nothing animation-shaped remains (keeps persisted frames lean). */
  const commit = (next: AnimationSchema | null) => {
    if (!next) { onAnimationChange(null); return; }
    const norm = normalizeAnimation(next);
    onAnimationChange(norm && (norm.clips.length > 0 || norm.transitions.length > 0) ? norm : null);
  };

  const baseSchema = (): AnimationSchema => schema ?? defaultAnimation();

  const setTimeline = (patch: Partial<AnimationSchema["timeline"]>) => {
    const base = baseSchema();
    commit({ ...base, timeline: { ...base.timeline, ...patch } });
  };

  const applyPreset = (presetId: string, targetLayerId: string) => {
    // P2.6 consistent apply: gate → clip + instance record in one step.
    const res = applyPresetConsistent(schema, presetId, { layerId: targetLayerId, visual: true });
    if (!res.ok) { setPresetNotice(res.reason); return; }
    commit(res.schema);
    setPresetNotice(null);
    // Defer one frame: commit → re-render → DesignFrame effect →
    // animator.update(next) must land BEFORE the clock starts, or the first
    // ticks would animate the OLD schema.
    requestAnimationFrame(() => playFrame(frameId, 0)); // immediate visual confirmation
  };

  /** P2.6 replacement confirms exact scope: a second click on the SAME card
   *  (or the inline "Aplicar y reemplazar") commits; the first click only
   *  raises the confirm row when the target already has animation. */
  const requestApply = (presetId: string, targetLayerId: string, hasExistingClip: boolean) => {
    const gate = checkPresetCompat(presetId, { layerId: targetLayerId, visual: true });
    if (!gate.ok) { setPresetNotice(gate.reason); setConfirmPreset(null); return; }
    if (hasExistingClip && confirmPreset !== presetId) {
      setConfirmPreset(presetId);
      setPresetNotice(null);
      return;
    }
    applyPreset(presetId, targetLayerId);
  };

  const layerClip = layerMode ? schema?.clips.find(c => c.layerId === layerId) : undefined;

  const setClip = (next: Clip) => {
    const base = baseSchema();
    commit({ ...base, clips: base.clips.some(c => c.layerId === next.layerId)
      ? base.clips.map(c => (c.layerId === next.layerId ? next : c))
      : [...base.clips, next] });
  };

  /** G2: clip edit that also grows the timeline when the window now ends past
   *  it — a delay/duración the timeline never reaches would be a silent lie. */
  const setClipWithRoom = (next: Clip) => {
    const base = baseSchema();
    const timeline = next.endSec > base.timeline.durationSec
      ? { ...base.timeline, durationSec: Math.min(600, Math.round(next.endSec * 10) / 10) }
      : base.timeline;
    commit({ ...base, timeline, clips: base.clips.some(c => c.layerId === next.layerId)
      ? base.clips.map(c => (c.layerId === next.layerId ? next : c))
      : [...base.clips, next] });
  };

  /** G2 "Escalonar selección": re-base the marked clips at 0, N, 2N… ms
   *  keeping each clip's own duration; the timeline grows when the cascade
   *  overflows it. Panel order = cascade order. */
  const staggerSelected = () => {
    if (!schema) { setStaggerNotice("Marca los clips a escalonar (cada uno con clip propio)."); return; }
    const order = schema.clips.map(c => c.layerId).filter(id => clipSel.has(id));
    const res = staggerClips(schema, order, staggerMs / 1000);
    if (!res) { setStaggerNotice("Marca los clips a escalonar (cada uno con clip propio)."); return; }
    const timeline = res.lastEndSec > schema.timeline.durationSec
      ? { ...schema.timeline, durationSec: Math.min(600, Math.round(res.lastEndSec * 10) / 10) }
      : schema.timeline;
    commit({ ...res.schema, timeline });
    setStaggerNotice(`${res.moved} clip${res.moved === 1 ? "" : "s"} escalonado${res.moved === 1 ? "" : "s"} cada ${staggerMs} ms — inicios ${order.map((_, i) => ((i * staggerMs) / 1000).toFixed(2)).join(" · ")}s.`);
    requestAnimationFrame(() => playFrame(frameId, 0)); // confirmation, same idiom as presets
  };

  const removeClip = (id: string) => {
    // P2.6 consistent removal: clip + instance records go together.
    commit(removeLayerAnimation(schema, id));
    stopFrame(frameId);
  };

  // ── REQ043 expression handlers (apply / live-param edit / bake) ──
  const activeExp = layerMode && layerId ? expressionOfLayer(schema, layerId) : null;

  const applyExp = (ruleId: string) => {
    if (!layerId) return;
    const res = applyExpressionToSchema(schema, layerId, ruleId, expDraft ?? undefined);
    if (!res.ok) { setExpNotice(res.reason); return; }
    commit(res.schema);
    setExpNotice(null);
    setConfirmExp(null);
    setExpSel(null);
    setExpDraft(null);
    requestAnimationFrame(() => playFrame(frameId, 0)); // immediate confirmation
  };

  const requestApplyExp = (ruleId: string) => {
    if (!layerId) return;
    if (layerClip && confirmExp !== ruleId) {
      setConfirmExp(ruleId);
      setExpNotice(null);
      return;
    }
    applyExp(ruleId);
  };

  /** Live param edit: recompiles only the instance's owned clip. */
  const patchExpParams = (instanceId: string, key: string, value: number) => {
    const inst = (schema?.instances || []).find(i => i.id === instanceId);
    if (!inst) return;
    const res = updateExpressionParams(schema, instanceId, { ...inst.params, [key]: value });
    if (!res.ok) { setExpNotice(res.reason); return; }
    commit(res.schema);
  };

  const bakeExp = (instanceId: string) => {
    const res = bakePresetInstance(schema, instanceId);
    if (res.schema) commit(res.schema);
  };

  /** P2.6 library body — search + category chips + preview cards, shared by
   *  layer mode and frame mode. `targetLayerId` null renders the
   *  no-selection guidance instead of the grid. */
  const libraryBody = (targetLayerId: string | null, hasExistingClip: boolean) => (
    <>
      <style>{previewCssBlock(visiblePresets)}</style>
      <input value={presetQuery} placeholder="Buscar preset…"
        onChange={e => { setPresetQuery(e.target.value); setConfirmPreset(null); }}
        style={{ ...inp, fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {PRESET_CATEGORIES.map(c => (
          <button key={c.id} type="button"
            onClick={() => { setPresetCat(c.id); setConfirmPreset(null); }}
            style={presetCat === c.id
              ? { ...smallBtn, borderColor: "rgba(200,184,152,0.55)", color: "#e8e2d4", background: "rgba(200,184,152,0.12)" }
              : smallBtn}>
            {c.label}
          </button>
        ))}
      </div>
      {presetNotice && <div style={{ ...mutedNote, color: "#e0a97a" }}>{presetNotice}</div>}
      {targetLayerId === null ? (
        <div style={mutedNote}>Selecciona un objeto para aplicar un preset.</div>
      ) : visiblePresets.length === 0 ? (
        <div style={mutedNote}>Sin resultados para “{presetQuery}”.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {visiblePresets.map(p => (
            <PresetCard key={p.id} preset={p} onApply={id => requestApply(id, targetLayerId, hasExistingClip)} />
          ))}
        </div>
      )}
      {confirmPreset && (() => {
        const p = ANIMATION_PRESETS.find(x => x.id === confirmPreset);
        if (!p || targetLayerId === null) return null;
        return (
          <div style={{ border: "1px solid rgba(224,169,122,0.3)", borderRadius: 4, padding: 5, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "#e0a97a", lineHeight: 1.4 }}>
              «{p.label}» reemplaza la animación actual de esta capa (una instancia activa por capa).
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => applyPreset(confirmPreset, targetLayerId)}
                style={{ ...smallBtn, borderColor: "rgba(224,169,122,0.5)", color: "#e8e2d4" }}>
                Aplicar y reemplazar
              </button>
              <button type="button" onClick={() => setConfirmPreset(null)} style={smallBtn}>Cancelar</button>
            </div>
          </div>
        );
      })()}
    </>
  );

  // ── Tween/keyframe editors (layer mode, and clip drill-down) ──
  const renderClipEditor = (clip: Clip) => {
    const updateTween = (idx: number, next: Tween) => setClip({ ...clip, tweens: clip.tweens.map((t, i) => (i === idx ? next : t)) });
    const removeTween = (idx: number) => setClip({ ...clip, tweens: clip.tweens.filter((_, i) => i !== idx) });
    const unusedProps = ANIMATION_PROPS.filter(p => !clip.tweens.some(t => t.prop === p));

    return (
      <>
        {clip.tweens.map((tween, ti) => (
          <div key={ti} style={{ border: "1px solid rgba(255,255,255,0.05)", borderRadius: 4, padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#c8b898", flex: 1, fontFamily: "monospace" }}>{tween.prop}</span>
              {/* G7: plain-language easing selector with mini-curva — the raw
                  cubic-bezier/spring string never shows as editable text. */}
              <EasingPicker easing={tween.easing} onPick={v => updateTween(ti, { ...tween, easing: v })} />
              <button type="button" onClick={() => removeTween(ti)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }} title="Quitar tween">✕</button>
            </div>
            {tween.keyframes.map((kf, ki) => (
              <div key={ki} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 9, color: "#8a8578", width: 14, textAlign: "right" }}>{ki === 0 || ki === tween.keyframes.length - 1 ? (ki === 0 ? "0" : "1") : ""}</span>
                {(ki > 0 && ki < tween.keyframes.length - 1) && (
                  <input type="number" min={0} max={1} step={0.05} value={kf.t}
                    onChange={e => { const t = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)); updateTween(ti, { ...tween, keyframes: tween.keyframes.map((k, j) => (j === ki ? { ...k, t } : k)) }); }}
                    style={{ ...inp, flex: "0 0 44px", fontSize: 10 }} title="t (0..1 dentro del clip)" />
                )}
                <input value={kf.value} onChange={e => updateTween(ti, { ...tween, keyframes: tween.keyframes.map((k, j) => (j === ki ? { ...k, value: e.target.value } : k)) })} style={{ ...inp, fontSize: 10 }} />
                {(ki > 0 && ki < tween.keyframes.length - 1) && (
                  <button type="button" onClick={() => updateTween(ti, { ...tween, keyframes: tween.keyframes.filter((_, j) => j !== ki) })} style={{ ...smallBtn, padding: "2px 5px" }}>✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => {
              // Insert at the largest gap between existing keyframes.
              const kfs = [...tween.keyframes].sort((a, b) => a.t - b.t);
              let bestT = 0.5, bestGap = -1;
              for (let i = 0; i < kfs.length - 1; i++) {
                const gap = kfs[i + 1].t - kfs[i].t;
                if (gap > bestGap) { bestGap = gap; bestT = (kfs[i].t + kfs[i + 1].t) / 2; }
              }
              const prev = kfs[Math.max(0, kfs.findIndex(k => k.t >= bestT) - 1)] ?? kfs[kfs.length - 1];
              updateTween(ti, { ...tween, keyframes: [...tween.keyframes, { t: Math.round(bestGap <= 0 ? 0.5 : bestT * 100) / 100, value: prev.value } as Keyframe] });
            }} style={{ ...smallBtn, alignSelf: "flex-start" }}>+ keyframe</button>
          </div>
        ))}
        {unusedProps.length > 0 && (
          <Row label="Añadir prop">
            <select value="" onChange={e => { if (e.target.value) setClip({ ...clip, tweens: [...clip.tweens, defaultTweenFor(e.target.value)] }); }} style={sel}>
              <option value="">—</option>
              {unusedProps.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Row>
        )}
      </>
    );
  };

  // ── Transport ──
  const transport = (
    <div style={{ padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button type="button" data-qa="g1-prev-kf" onClick={() => jumpKf(-1)} style={{ ...smallBtn, padding: "4px 6px" }} title="Keyframe anterior (todas las capas)">⏮</button>
        <button type="button" onClick={() => (playback.playing ? pauseFrame(frameId) : playFrom())} style={{ ...smallBtn, flex: 1, padding: "4px 8px" }}>
          {playback.playing ? "❚❚ Pausa" : "▶ Play"}
        </button>
        <button type="button" data-qa="g1-next-kf" onClick={() => jumpKf(1)} style={{ ...smallBtn, padding: "4px 6px" }} title="Keyframe siguiente (todas las capas)">⏭</button>
        <button type="button" onClick={() => stopFrame(frameId)} style={{ ...smallBtn, padding: "4px 8px" }} title="Stop y rebobinar">■</button>
        <span style={{ fontSize: 10, color: "#96917f", fontFamily: "monospace", flexShrink: 0 }}>
          {playback.timeSec.toFixed(2)} / {duration.toFixed(2)}s
        </span>
      </div>
      <input data-qa="anim-scrub" type="range" min={0} max={duration} step={0.01} value={Math.min(playback.timeSec, duration)}
        onChange={e => seekFrame(frameId, parseFloat(e.target.value) || 0)}
        style={{ width: "100%", accentColor: "#c8b898" }} />
    </div>
  );

  // ── Layer mode ──
  if (layerMode) {
    return (
      <div style={{ overflow: "auto", flex: 1 }}>
        {transport}
        <Section label="Biblioteca de movimiento">
          {libraryBody(layerId!, !!layerClip)}
          <div style={mutedNote}>Hover previsualiza; click aplica a esta capa. Si ya hay animación, el reemplazo pide confirmación.</div>
        </Section>
        <Section label="Expresiones">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {EXPRESSION_RULES.map(rule => (
              <button key={rule.id} type="button" title={rule.about}
                onClick={() => {
                  const already = expSel === rule.id;
                  setExpSel(already ? null : rule.id);
                  setExpDraft(already ? null : defaultExpressionParams(rule));
                  setConfirmExp(null);
                }}
                style={expSel === rule.id
                  ? { ...smallBtn, borderColor: "rgba(200,184,152,0.55)", color: "#e8e2d4", background: "rgba(200,184,152,0.12)" }
                  : smallBtn}>
                {rule.label}
              </button>
            ))}
          </div>
          {expSel && (() => {
            const rule = findExpressionRule(expSel);
            if (!rule) return null;
            const draft = expDraft ?? defaultExpressionParams(rule);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {rule.params.map(def => (
                  <Row key={def.key} label={def.label}>
                    <input type="number" min={def.min} max={def.max} step={def.step} value={draft[def.key]}
                      onChange={e => setExpDraft({ ...draft, [def.key]: Math.min(def.max, Math.max(def.min, parseFloat(e.target.value) || def.default)) })}
                      style={inp} />
                  </Row>
                ))}
                <button type="button" onClick={() => requestApplyExp(rule.id)}
                  style={{ ...smallBtn, alignSelf: "flex-start", borderColor: "rgba(200,184,152,0.4)" }}>
                  Aplicar expresión
                </button>
              </div>
            );
          })()}
          {expNotice && <div style={{ ...mutedNote, color: "#e0a97a" }}>{expNotice}</div>}
          {activeExp && (() => {
            const rule = findExpressionRule(activeExp.presetId);
            if (!rule) return null;
            return (
              <div style={{ border: "1px solid rgba(200,184,152,0.2)", borderRadius: 4, padding: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 10, color: "#c8b898" }}>Activa: {rule.label}</span>
                {rule.params.map(def => (
                  <Row key={def.key} label={def.label}>
                    <input type="number" min={def.min} max={def.max} step={def.step}
                      value={Number(activeExp.params[def.key] ?? def.default)}
                      onChange={e => patchExpParams(activeExp.id, def.key, Math.min(def.max, Math.max(def.min, parseFloat(e.target.value) || def.default)))}
                      style={inp} />
                  </Row>
                ))}
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" onClick={() => bakeExp(activeExp.id)} style={smallBtn}
                    title="Los keyframes quedan editables a mano y se borra el vínculo con la regla">
                    Convertir a keyframes
                  </button>
                  <button type="button" onClick={() => removeClip(layerId!)}
                    style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
                    Quitar
                  </button>
                </div>
              </div>
            );
          })()}
          {confirmExp && (() => {
            const rule = findExpressionRule(confirmExp);
            if (!rule) return null;
            return (
              <div style={{ border: "1px solid rgba(224,169,122,0.3)", borderRadius: 4, padding: 5, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: "#e0a97a", lineHeight: 1.4 }}>
                  «{rule.label}» reemplaza la animación actual de esta capa (una instancia activa por capa).
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" onClick={() => applyExp(confirmExp!)}
                    style={{ ...smallBtn, borderColor: "rgba(224,169,122,0.5)", color: "#e8e2d4" }}>
                    Aplicar y reemplazar
                  </button>
                  <button type="button" onClick={() => setConfirmExp(null)} style={smallBtn}>Cancelar</button>
                </div>
              </div>
            );
          })()}
          <div style={mutedNote}>Reglas sin código: se compilan a keyframes y reemplazan el clip de la capa. «Semilla» repite el mismo temblor en preview y export.</div>
        </Section>
        {layerClip ? (
          <>
            <Section label="Ventana temporal">
              <Row label="Retraso (s)">
                <input data-qa="g2-delay" type="number" min={0} max={600} step={0.1} value={layerClip.startSec} title="Delay antes de que la capa arranque"
                  onChange={e => {
                    const dur = Math.max(0.05, layerClip.endSec - layerClip.startSec);
                    const start = Math.min(600, Math.max(0, parseFloat(e.target.value) || 0));
                    setClipWithRoom({ ...layerClip, startSec: start, endSec: Math.min(600, start + dur) });
                  }} style={inp} />
              </Row>
              <Row label="Duración (s)">
                <input data-qa="g2-duration" type="number" min={0.05} max={600} step={0.1} value={Math.round((layerClip.endSec - layerClip.startSec) * 100) / 100}
                  title="Cuánto dura la animación de esta capa"
                  onChange={e => {
                    const dur = Math.min(600, Math.max(0.05, parseFloat(e.target.value) || 0.5));
                    setClipWithRoom({ ...layerClip, endSec: Math.min(600, layerClip.startSec + dur) });
                  }} style={inp} />
              </Row>
              <div style={mutedNote}>El retraso mueve la capa dentro de la línea de tiempo; la duración estira su ventana desde el inicio. La línea crece si hace falta.</div>
            </Section>
            <Section label="Tweens / keyframes">
              {renderClipEditor(layerClip)}
            </Section>
            <div style={{ padding: "6px 10px" }}>
              <button type="button" onClick={() => removeClip(layerId!)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)", width: "100%" }}>
                Quitar animación de la capa
              </button>
            </div>
          </>
        ) : (
          <div style={mutedNote}>Esta capa no tiene clip. Aplica un preset o añade tweens tras crear uno.</div>
        )}
      </div>
    );
  }

  // ── Frame mode ──
  const frameLayers = useMemo(() => {
    const fromClips = (schema?.clips || []).map(c => c.layerId);
    const fromHtml = frameHtml ? extractTopLevelLayerIds(frameHtml) : [];
    return Array.from(new Set([...fromClips, ...fromHtml]));
  }, [schema, frameHtml]);
  const [presetTarget, setPresetTarget] = useState("");

  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      {onOpenVideoMode && (
        <div style={{ padding: "8px 10px 0" }}>
          <button type="button" onClick={onOpenVideoMode}
            style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, borderColor: "rgba(200,184,152,0.4)", background: "rgba(200,184,152,0.12)" }}
            title="Storyboard multi-frame, timeline por capa, transiciones y export del reel">
            🎬 Modo Video — storyboard del reel
          </button>
        </div>
      )}
      {transport}
      {/* G1: multi-track timeline — ruler in seconds, playhead, row per layer,
          property lanes, zoom, snap and the shared work area. G4: rombo edits
          (drag/◇/◆/copiar/pegar/tiempo exacto) commit through the panel's own
          commit — one undo entry per gesture, same autosave as everything. */}
      <AnimationTimeline
        schema={schema}
        layers={frameLayers}
        timeSec={playback.timeSec}
        durationSec={duration}
        onSeek={t => seekFrame(frameId, t)}
        work={work}
        onWorkChange={setWork}
        onEdit={next => commit(next)}
      />

      <Section label="Timeline">
        <Row label="Duración (s)">
          <input type="number" min={0.2} max={600} step={0.5} value={duration}
            onChange={e => { const d = Math.min(600, Math.max(0.2, parseFloat(e.target.value) || 5)); setTimeline({ durationSec: d }); }} style={inp} />
        </Row>
        <Row label="Loop">
          <select value={schema?.timeline.loop || "once"} onChange={e => setTimeline({ loop: e.target.value as "once" | "loop" | "pingpong" })} style={sel}>
            <option value="once">Once</option>
            <option value="loop">Loop</option>
            <option value="pingpong">Ping-pong</option>
          </select>
        </Row>
        <Row label="FPS export">
          <input type="number" min={1} max={60} value={schema?.timeline.fps ?? 30}
            onChange={e => setTimeline({ fps: Math.min(60, Math.max(1, parseInt(e.target.value) || 30)) })} style={inp} />
        </Row>
      </Section>

      <Section label="Biblioteca a capa">
        {frameLayers.length > 0 ? (
          <>
            <Row label="Capa">
              <select data-qa="g2-preset-target" value={presetTarget || frameLayers[0]} onChange={e => { setPresetTarget(e.target.value); setConfirmPreset(null); }} style={sel}>
                {frameLayers.map(id => <option key={id} value={id}>{id.length > 18 ? id.slice(0, 15) + "…" : id}</option>)}
              </select>
            </Row>
            {libraryBody(presetTarget || frameLayers[0], (schema?.clips || []).some(c => c.layerId === (presetTarget || frameLayers[0])))}
          </>
        ) : (
          <div style={mutedNote}>Añade capas al frame para animarlas.</div>
        )}
      </Section>

      <Section label={`Clips (${schema?.clips.length || 0})`}>
        {(schema?.clips.length || 0) === 0 && <div style={mutedNote}>Sin clips. Anima una capa desde su panel contextual o con un preset arriba.</div>}
        {(schema?.clips || []).map(clip => (
          <div key={clip.layerId} style={{ border: "1px solid rgba(255,255,255,0.05)", borderRadius: 4, padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" data-qa="g2-clip-check" checked={clipSel.has(clip.layerId)} title="Marcar para escalonar"
                onChange={e => setClipSel(prev => { const next = new Set(prev); if (e.target.checked) next.add(clip.layerId); else next.delete(clip.layerId); return next; })}
                style={{ accentColor: "#c8b898", margin: 0 }} />
              <span style={{ fontSize: 10, color: "#c8b898", flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>{clip.layerId}</span>
              <button type="button" onClick={() => removeClip(clip.layerId)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }} title="Quitar clip">✕</button>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <input type="number" min={0} max={600} step={0.1} value={clip.startSec} title="start (s)"
                onChange={e => setClip({ ...clip, startSec: Math.max(0, parseFloat(e.target.value) || 0) })} style={{ ...inp, fontSize: 10 }} />
              <span style={{ fontSize: 10, color: "#8a8578" }}>→</span>
              <input type="number" min={0.05} max={600} step={0.1} value={clip.endSec} title="end (s)"
                onChange={e => setClip({ ...clip, endSec: Math.max(0.05, parseFloat(e.target.value) || 0.2) })} style={{ ...inp, fontSize: 10 }} />
              <span style={{ fontSize: 9, color: "#8a8578", flexShrink: 0, alignSelf: "center" }}>
                {clip.tweens.length} tween{clip.tweens.length === 1 ? "" : "s"}
              </span>
            </div>
            {renderClipEditor(clip)}
          </div>
        ))}
        {/* G2: stagger/timing — the cascade command over the marked clips. */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
          <input data-qa="g2-stagger-ms" type="number" min={0} max={5000} step={50} value={staggerMs} title="ms entre capas"
            onChange={e => setStaggerMs(Math.min(5000, Math.max(0, parseFloat(e.target.value) || 0)))} style={{ ...inp, flex: "0 0 56px" }} />
          <span style={{ fontSize: 9, color: "#8a8578", flexShrink: 0 }}>ms</span>
          <button type="button" data-qa="g2-stagger" disabled={clipSel.size < 2} onClick={staggerSelected}
            title={clipSel.size < 2 ? "Marca al menos dos clips" : "Cada clip marcado arranca N ms después del anterior, conservando su duración"}
            style={{ ...smallBtn, flex: 1, opacity: clipSel.size < 2 ? 0.6 : 1 }}>
            Escalonar selección ({clipSel.size})
          </button>
        </div>
        {staggerNotice && <div style={mutedNote}>{staggerNotice}</div>}
      </Section>

      <Section label={`Transiciones (${schema?.transitions.length || 0})`}>
        {(schema?.transitions || []).map((tr, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <select value={tr.type} onChange={e => { const base = baseSchema(); commit({ ...base, transitions: base.transitions.map((t, j) => (j === i ? { ...t, type: e.target.value as typeof t.type } : t)) }); }} style={{ ...sel, fontSize: 10 }}>
              {["fade", "slide", "zoom", "wipe"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={tr.toFrameId} onChange={e => { const base = baseSchema(); commit({ ...base, transitions: base.transitions.map((t, j) => (j === i ? { ...t, toFrameId: e.target.value } : t)) }); }} style={{ ...sel, fontSize: 10 }}>
              {(siblingFrames || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input type="number" min={0.1} max={5} step={0.1} value={tr.durationSec}
              onChange={e => { const base = baseSchema(); commit({ ...base, transitions: base.transitions.map((t, j) => (j === i ? { ...t, durationSec: Math.min(5, Math.max(0.1, parseFloat(e.target.value) || 0.6)) } : t)) }); }}
              style={{ ...inp, flex: "0 0 40px", fontSize: 10 }} title="duración (s)" />
            <button type="button" onClick={() => { const base = baseSchema(); commit({ ...base, transitions: base.transitions.filter((_, j) => j !== i) }); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>✕</button>
          </div>
        ))}
        {(siblingFrames?.length || 0) > 0 && (
          <button type="button" onClick={() => { const base = baseSchema(); commit({ ...base, transitions: [...base.transitions, { toFrameId: siblingFrames![0].id, type: "fade", durationSec: 0.6 }] }); }} style={{ ...smallBtn, alignSelf: "flex-start" }}>
            + transición al final
          </button>
        )}
        <div style={mutedNote}>La transición vive en este frame y describe cómo cede al siguiente en el video exportado.</div>
      </Section>

      {onExportVideo && (
        <div style={{ padding: "8px 10px" }}>
          <button type="button" disabled={exportingVideo} onClick={onExportVideo}
            style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 10, opacity: exportingVideo ? 0.5 : 1 }}>
            {exportingVideo ? "Exportando…" : "⬇ Exportar video (WebM)"}
          </button>
          <div style={mutedNote}>Render 100% en el navegador (0 invocaciones, 0 tokens LLM). El archivo se descarga localmente.</div>
        </div>
      )}
    </div>
  );
}
