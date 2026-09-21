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
  EASING_PRESETS,
  applyPresetToSchema,
  defaultAnimation,
  normalizeAnimation,
  type AnimationSchema,
  type Clip,
  type Keyframe,
  type Tween,
} from "../../shared/animationSchema.ts";
import {
  getFramePlayback,
  pauseFrame,
  playFrame,
  seekFrame,
  stopFrame,
  subscribeFramePlayback,
} from "../lib/animationPlayback";

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
  fontSize: 10, lineHeight: 1.5, color: "#7a7668", padding: "2px 2px 4px",
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
      <span style={{ fontSize: 10, color: "#7a7668", flex: "0 0 62px", textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>{children}</div>
    </div>
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
    const next = applyPresetToSchema(schema, targetLayerId, presetId);
    commit(next);
    // Defer one frame: commit → re-render → DesignFrame effect →
    // animator.update(next) must land BEFORE the clock starts, or the first
    // ticks would animate the OLD schema.
    requestAnimationFrame(() => playFrame(frameId, 0)); // immediate visual confirmation
  };

  const layerClip = layerMode ? schema?.clips.find(c => c.layerId === layerId) : undefined;

  const setClip = (next: Clip) => {
    const base = baseSchema();
    commit({ ...base, clips: base.clips.some(c => c.layerId === next.layerId)
      ? base.clips.map(c => (c.layerId === next.layerId ? next : c))
      : [...base.clips, next] });
  };

  const removeClip = (id: string) => {
    const base = baseSchema();
    commit({ ...base, clips: base.clips.filter(c => c.layerId !== id) });
    stopFrame(frameId);
  };

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
              <select value={EASING_PRESETS.some(e => e.value === tween.easing) ? tween.easing : "custom"} onChange={e => updateTween(ti, { ...tween, easing: e.target.value === "custom" ? tween.easing : e.target.value })} style={{ ...sel, flex: "0 0 110px", fontSize: 10 }}>
                {EASING_PRESETS.map(e => <option key={e.id} value={e.value}>{e.label}</option>)}
                <option value="custom">custom…</option>
              </select>
              {tween.easing.startsWith("spring(") || tween.easing.startsWith("cubic-bezier(") ? (
                <input value={tween.easing} onChange={e => updateTween(ti, { ...tween, easing: e.target.value })} style={{ ...inp, fontSize: 10 }} title="CSS easing: cubic-bezier(...) or spring(damping,stiffness)" />
              ) : null}
              <button type="button" onClick={() => removeTween(ti)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }} title="Quitar tween">✕</button>
            </div>
            {tween.keyframes.map((kf, ki) => (
              <div key={ki} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 9, color: "#555", width: 14, textAlign: "right" }}>{ki === 0 || ki === tween.keyframes.length - 1 ? (ki === 0 ? "0" : "1") : ""}</span>
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
        <button type="button" onClick={() => (playback.playing ? pauseFrame(frameId) : playFrame(frameId, playback.timeSec >= duration - 0.01 ? 0 : playback.timeSec))} style={{ ...smallBtn, flex: 1, padding: "4px 8px" }}>
          {playback.playing ? "❚❚ Pausa" : "▶ Play"}
        </button>
        <button type="button" onClick={() => stopFrame(frameId)} style={{ ...smallBtn, padding: "4px 8px" }} title="Stop y rebobinar">■</button>
        <span style={{ fontSize: 10, color: "#7a7668", fontFamily: "monospace", flexShrink: 0 }}>
          {playback.timeSec.toFixed(2)} / {duration.toFixed(2)}s
        </span>
      </div>
      <input type="range" min={0} max={duration} step={0.01} value={Math.min(playback.timeSec, duration)}
        onChange={e => seekFrame(frameId, parseFloat(e.target.value) || 0)}
        style={{ width: "100%", accentColor: "#c8b898" }} />
    </div>
  );

  // ── Layer mode ──
  if (layerMode) {
    return (
      <div style={{ overflow: "auto", flex: 1 }}>
        {transport}
        <Section label="Preset de entrada">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {ANIMATION_PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.id, layerId!)} style={smallBtn} title={`Aplicar ${p.label} a esta capa`}>{p.label}</button>
            ))}
          </div>
          <div style={mutedNote}>Reemplaza la animación actual de la capa y reproduce la preview.</div>
        </Section>
        {layerClip ? (
          <>
            <Section label="Ventana temporal">
              <Row label="Inicio (s)">
                <input type="number" min={0} max={layerClip.endSec - 0.05} step={0.1} value={layerClip.startSec}
                  onChange={e => setClip({ ...layerClip, startSec: Math.min(Math.max(0, parseFloat(e.target.value) || 0), layerClip.endSec - 0.05) })} style={inp} />
              </Row>
              <Row label="Fin (s)">
                <input type="number" min={layerClip.startSec + 0.05} max={duration} step={0.1} value={layerClip.endSec}
                  onChange={e => setClip({ ...layerClip, endSec: Math.min(Math.max(parseFloat(e.target.value) || 0.2, layerClip.startSec + 0.05), duration) })} style={inp} />
              </Row>
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

      <Section label="Preset a capa">
        {frameLayers.length > 0 ? (
          <>
            <Row label="Capa">
              <select value={presetTarget || frameLayers[0]} onChange={e => setPresetTarget(e.target.value)} style={sel}>
                {frameLayers.map(id => <option key={id} value={id}>{id.length > 18 ? id.slice(0, 15) + "…" : id}</option>)}
              </select>
            </Row>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
              {ANIMATION_PRESETS.map(p => (
                <button key={p.id} type="button" onClick={() => applyPreset(p.id, presetTarget || frameLayers[0])} style={smallBtn}>{p.label}</button>
              ))}
            </div>
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
              <span style={{ fontSize: 10, color: "#c8b898", flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>{clip.layerId}</span>
              <button type="button" onClick={() => removeClip(clip.layerId)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }} title="Quitar clip">✕</button>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <input type="number" min={0} max={600} step={0.1} value={clip.startSec} title="start (s)"
                onChange={e => setClip({ ...clip, startSec: Math.max(0, parseFloat(e.target.value) || 0) })} style={{ ...inp, fontSize: 10 }} />
              <span style={{ fontSize: 10, color: "#555" }}>→</span>
              <input type="number" min={0.05} max={600} step={0.1} value={clip.endSec} title="end (s)"
                onChange={e => setClip({ ...clip, endSec: Math.max(0.05, parseFloat(e.target.value) || 0.2) })} style={{ ...inp, fontSize: 10 }} />
              <span style={{ fontSize: 9, color: "#555", flexShrink: 0, alignSelf: "center" }}>
                {clip.tweens.length} tween{clip.tweens.length === 1 ? "" : "s"}
              </span>
            </div>
            {renderClipEditor(clip)}
          </div>
        ))}
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
