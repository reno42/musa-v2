/**
 * InspectorPanel — propiedades del segmento seleccionado (REQ-VID11).
 * Inputs en µs EXACTOS (aceptación del REQ: "la UI muestra µs exactos").
 * Cada commit pasa por updateSegmentTiming → store.apply, con coalesceKey
 * por campo para que tipear no llene el journal de pasos.
 */
import { useEffect, useState } from "react";
import type { VideoApplyMeta, VideoProjectDoc } from "../../lib/videoProjectStore";
import { VIDEO_SPEED_MAX, VIDEO_SPEED_MIN, formatTimecode, targetDurForSource } from "../../lib/videoTimelineMath";
import { findSegment, materialDurationUs, materialMap, updateSegmentTiming } from "./videoDocOps";

interface InspectorPanelProps {
  doc: VideoProjectDoc;
  segmentId: string | null;
  onDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onDelete: (segmentId: string) => void;
}

function NumericField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  coalesceKey: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => { setDraft(String(props.value)); }, [props.value]);
  const commit = () => {
    const v = Number(draft.replace(",", "."));
    if (!Number.isFinite(v)) { setDraft(String(props.value)); return; }
    props.onCommit(Math.min(props.max, Math.max(props.min, v)));
  };
  return (
    <label className="vp-field">
      <span>{props.label}</span>
      <input
        className="vp-input"
        type="number"
        step={props.step ?? 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      />
    </label>
  );
}

export function InspectorPanel({ doc, segmentId, onDocChange, onDelete }: InspectorPanelProps) {
  const seg = findSegment(doc, segmentId);
  const materials = materialMap(doc);

  if (!seg) {
    return (
      <aside className="vp-inspector">
        <h3 className="vp-panel-title">Inspector</h3>
        <p className="vp-hint">Seleccioná un clip del timeline para ver y editar sus propiedades.</p>
      </aside>
    );
  }

  const material = materials.get(seg.material_id) ?? null;
  const matDur = materialDurationUs(material);
  const payload = (material?.payload ?? {}) as { text?: unknown; url?: unknown };
  const matLabel = typeof payload.text === "string" && payload.text.trim()
    ? payload.text.trim().slice(0, 40)
    : typeof payload.url === "string" ? (payload.url.split("/").pop() ?? payload.url) : material?.kind ?? "—";
  const companionLabels = seg.extra_refs
    .map((refId) => materials.get(refId))
    .filter(Boolean)
    .map((m) => (m as NonNullable<typeof m>).kind);

  return (
    <aside className="vp-inspector">
      <h3 className="vp-panel-title">Inspector</h3>
      <div className="vp-insp-head">
        <span className={`vp-track-chip vp-track-${material?.kind === "audio" || material?.kind === "text" ? material.kind : "video"}`}>{material?.kind ?? "?"}</span>
        <span className="vp-insp-name" title={seg.material_id}>{matLabel}</span>
      </div>

      <NumericField
        label="Inicio (µs)"
        value={seg.target_start_us}
        min={0}
        max={Number.MAX_SAFE_INTEGER}
        coalesceKey="start"
        onCommit={(v) => onDocChange(updateSegmentTiming(doc, seg.id, {
          target_start_us: Math.round(v),
          target_dur_us: seg.target_dur_us,
          source_start_us: seg.source_start_us,
          source_dur_us: seg.source_dur_us,
          speed: seg.speed,
        }), { label: "mover clip (inspector)", coalesceKey: `insp:start:${seg.id}` })}
      />
      <NumericField
        label="Duración (µs)"
        value={seg.target_dur_us}
        min={1}
        max={Number.MAX_SAFE_INTEGER}
        coalesceKey="dur"
        onCommit={(v) => {
          const targetDur = Math.max(1, Math.round(v));
          // Regla de oro inversa: target fijo → source = round(target × speed).
          const sourceDur = seg.source_dur_us === null ? null : Math.max(1, Math.round(targetDur * seg.speed));
          onDocChange(updateSegmentTiming(doc, seg.id, {
            target_start_us: seg.target_start_us,
            target_dur_us: targetDur,
            source_start_us: seg.source_start_us,
            source_dur_us: sourceDur,
            speed: seg.speed,
          }), { label: "editar duración (inspector)", coalesceKey: `insp:dur:${seg.id}` });
        }}
      />
      <NumericField
        label="Velocidad (×)"
        value={seg.speed}
        min={VIDEO_SPEED_MIN}
        max={VIDEO_SPEED_MAX}
        step={0.1}
        coalesceKey="speed"
        onCommit={(v) => {
          const speed = v > 0 ? v : 1;
          // La fuente no cambia; el target se re-deriva (mismo camino del server).
          const sourceDur = seg.source_dur_us ?? seg.target_dur_us;
          onDocChange(updateSegmentTiming(doc, seg.id, {
            target_start_us: seg.target_start_us,
            target_dur_us: targetDurForSource(sourceDur, speed),
            source_start_us: seg.source_start_us,
            source_dur_us: seg.source_dur_us,
            speed,
          }), { label: "cambiar velocidad (inspector)", coalesceKey: `insp:speed:${seg.id}` });
        }}
      />

      <div className="vp-insp-rows">
        <div className="vp-insp-row"><span>Source</span><code>{seg.source_start_us === null ? "—" : `${seg.source_start_us} + ${seg.source_dur_us} µs`}</code></div>
        <div className="vp-insp-row"><span>Rango</span><code>{formatTimecode(seg.target_start_us, 3)} → {formatTimecode(seg.target_start_us + seg.target_dur_us, 3)}</code></div>
        {matDur !== null && <div className="vp-insp-row"><span>Material</span><code>{matDur.toLocaleString("es-AR")} µs</code></div>}
        {companionLabels.length > 0 && <div className="vp-insp-row"><span>Compañeros</span><code>{companionLabels.join(", ")}</code></div>}
      </div>

      <button type="button" className="vp-btn vp-btn-danger" onClick={() => onDelete(seg.id)}>
        Eliminar clip
      </button>
    </aside>
  );
}
