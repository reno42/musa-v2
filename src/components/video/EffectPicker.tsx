/**
 * EffectPicker — catálogo builtin VID14 (fase 1, sin shaders) para aplicar
 * companions de efecto. Server-first: POST /effects crea UN material
 * kind=effect y lo linkea a extra_refs del segmento seleccionado — o de todo
 * el track de video si no hay selección (un companion compartido, como
 * CapCut). El doc que vuelve del server se aplica Y se absorbe como baseline
 * (onServerDocChange hace apply + absorbSaved): si no, el autosave
 * re-POSTe­aría el companion y fallaría por id duplicado.
 */
import { useState } from "react";
import { apiFetch } from "../../lib/supabase";
import type { VideoApplyMeta, VideoMaterial, VideoProjectDoc } from "../../lib/videoProjectStore";
import { CLIENT_BUILTIN_EFFECTS, TEXT_ANIM_MODES, type BuiltinEffect } from "../../lib/videoEffects";

interface EffectPickerProps {
  doc: VideoProjectDoc;
  selectedSegmentId: string | null;
  /** apply + absorbSaved (server-first: el autosave NO re-crea estas filas). */
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onError: (msg: string) => void;
}

interface EffectApplyResponse {
  data: {
    material: VideoMaterial;
    appliedTo: string[];
  };
}

/** Params por builtin — mínimos pero reales, con defaults del catálogo. */
function ParamsEditor({ effect, value, onChange }: {
  effect: BuiltinEffect;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (effect.id === "fx-lut") {
    return (
      <input
        className="vp-input"
        placeholder="saturate(1.25) contrast(1.06)"
        value={String(value.css ?? "")}
        onChange={(e) => onChange({ ...value, css: e.target.value })}
        aria-label="Filtro CSS del LUT"
      />
    );
  }
  if (effect.id === "fx-overlay") {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="vp-input"
          placeholder="rgba(0,0,0,0.35)"
          value={String(value.color ?? "")}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          aria-label="Color del overlay"
        />
        <select
          className="vp-input"
          value={String(value.blend ?? "normal")}
          onChange={(e) => onChange({ ...value, blend: e.target.value })}
          aria-label="Blend mode del overlay"
        >
          {["normal", "multiply", "screen", "overlay", "soft-light"].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
    );
  }
  if (effect.id === "fx-text-anim") {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="vp-input"
          placeholder="Texto del caption"
          value={String(value.text ?? "")}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          aria-label="Texto del caption"
        />
        <select
          className="vp-input"
          value={String(value.anim ?? "fade")}
          onChange={(e) => onChange({ ...value, anim: e.target.value })}
          aria-label="Animación del caption"
        >
          {TEXT_ANIM_MODES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
    );
  }
  // fx-sticker-kf: url + keyframe inicial (el resto se edita por MCP hoy).
  return (
    <input
      className="vp-input"
      placeholder="https://…/sticker.png"
      value={String(value.url ?? "")}
      onChange={(e) => onChange({ ...value, url: e.target.value })}
      aria-label="URL del sticker"
    />
  );
}

export function EffectPicker({ doc, selectedSegmentId, onServerDocChange, onError }: EffectPickerProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState(false);

  const applyEffect = async (effect: BuiltinEffect) => {
    if (busy) return;
    const params = { ...effect.defaults, ...(drafts[effect.id] ?? {}) };
    const videoTrack = doc.tracks.find((t) => t.type === "video");
    if (!selectedSegmentId && !videoTrack) {
      onError("Seleccioná un clip (o tené un track de video) para aplicar el efecto.");
      return;
    }
    setBusy(true);
    try {
      const pid = encodeURIComponent(doc.project.id);
      const res = await apiFetch<EffectApplyResponse>(`/api/video-projects/${pid}/effects`, {
        method: "POST",
        body: JSON.stringify({
          effectId: effect.id,
          params,
          ...(selectedSegmentId ? { segmentId: selectedSegmentId } : { trackId: videoTrack!.id }),
        }),
      });
      const { material, appliedTo } = res?.data ?? ({} as EffectApplyResponse["data"]);
      if (!material?.id || !Array.isArray(appliedTo)) throw new Error("La respuesta no incluyó el companion del efecto.");
      const next: VideoProjectDoc = {
        ...doc,
        materials: [...doc.materials, { ...material, slot: material.slot ?? null }],
        tracks: doc.tracks.map((t) => ({
          ...t,
          segments: t.segments.map((s) => (appliedTo.includes(s.id)
            ? { ...s, extra_refs: [...(s.extra_refs ?? []), material.id] }
            : s)),
        })),
      };
      onServerDocChange(next, { label: `efecto ${effect.id}` });
      setOpenId(null);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "No se pudo aplicar el efecto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vp-fx-list">
      {CLIENT_BUILTIN_EFFECTS.map((effect) => {
        const open = openId === effect.id;
        return (
          <div key={effect.id} className="vp-fx-item">
            <button
              type="button"
              className={open ? "vp-btn vp-btn-active vp-fx-toggle" : "vp-btn vp-fx-toggle"}
              onClick={() => setOpenId(open ? null : effect.id)}
              aria-expanded={open}
              title={effect.hint}
            >
              <span className="vp-fx-label">{effect.label}</span>
              <span className="vp-fx-z">z{effect.zorder}</span>
            </button>
            {open && (
              <div className="vp-fx-params">
                <ParamsEditor
                  effect={effect}
                  value={drafts[effect.id] ?? {}}
                  onChange={(next) => setDrafts((prev) => ({ ...prev, [effect.id]: next }))}
                />
                <button
                  type="button"
                  className="vp-btn vp-btn-primary"
                  disabled={busy}
                  onClick={() => void applyEffect(effect)}
                >
                  {selectedSegmentId ? "Aplicar al clip" : "Aplicar al track de video"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
