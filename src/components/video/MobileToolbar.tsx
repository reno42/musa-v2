/**
 * MobileToolbar — toolbar inferior contextual del editor en móvil (VID12):
 *   · sin selección → agregar (texto / video URL / audio URL, server-first
 *     con drop inmediato al timeline);
 *   · clip de video/audio → dividir en playhead / velocidad rápida / efecto;
 *   · clip de texto → estilo (abre la sheet) / dividir.
 * Targets ≥ 44px (CSS). El estilo y los efectos viven en la bottom sheet.
 */
import { useState } from "react";
import { apiFetch } from "../../lib/supabase";
import type { VideoApplyMeta, VideoMaterial, VideoProjectDoc, VideoSegment } from "../../lib/videoProjectStore";
import { DEFAULT_DROP_DUR_US } from "../../lib/videoTimelineMath";
import { findSegment, materialDurationUs, trackForMaterialKind } from "./videoDocOps";

interface MobileToolbarProps {
  doc: VideoProjectDoc;
  selectedSegmentId: string | null;
  /** apply + absorbSaved (server-first: material y clip ya existen). */
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onSplit: () => void;
  onSpeed: (v: number) => void;
  onOpenEffects: () => void;
  onOpenStyle: () => void;
  onError: (msg: string) => void;
}

type AddKind = "text" | "video" | "audio";

export function MobileToolbar({ doc, selectedSegmentId, onServerDocChange, onSplit, onSpeed, onOpenEffects, onOpenStyle, onError }: MobileToolbarProps) {
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const seg = findSegment(doc, selectedSegmentId);
  const material: VideoMaterial | null = seg ? (doc.materials.find((m) => m.id === seg.material_id) ?? null) : null;
  const mode: "add" | "clip" | "text" = !seg || !material
    ? "add"
    : material.kind === "text"
      ? "text"
      : "clip";

  /** Agrega el material Y lo suelta al final del track compatible (dos POST
   *  server-first; si no hay track compatible queda solo el material). */
  const addAndDrop = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      const pid = encodeURIComponent(doc.project.id);
      const kind = addKind as AddKind;
      const payload = kind === "text" ? { text: draft.trim() } : { url: draft.trim() };
      const matRes = await apiFetch<{ data: { material: VideoMaterial } }>(`/api/video-projects/${pid}/materials`, {
        method: "POST",
        body: JSON.stringify({ kind, payload }),
      });
      const materialNew = matRes?.data?.material;
      if (!materialNew) throw new Error("La respuesta no incluyó el material.");
      let materials = [...doc.materials, { ...materialNew, slot: materialNew.slot ?? null }];
      let tracks = doc.tracks;

      const track = trackForMaterialKind(doc, kind);
      if (track) {
        const appendAt = track.segments.reduce((max, s) => Math.max(max, s.target_start_us + s.target_dur_us), 0);
        const dur = materialDurationUs(materialNew) ?? DEFAULT_DROP_DUR_US;
        const segRes = await apiFetch<{ data: { segment: VideoSegment } }>(`/api/video-projects/${pid}/segments`, {
          method: "POST",
          body: JSON.stringify({
            trackId: track.id,
            materialId: materialNew.id,
            targetStartUs: appendAt,
            targetDurUs: dur,
            sourceStartUs: 0,
            sourceDurUs: dur,
          }),
        });
        const segment = segRes?.data?.segment;
        if (!segment) throw new Error("La respuesta no incluyó el segmento.");
        tracks = doc.tracks.map((t) => (t.id === track.id
          ? { ...t, segments: [...t.segments, { ...segment, extra_refs: segment.extra_refs ?? [] }].sort((a, b) => a.target_start_us - b.target_start_us) }
          : t));
      }
      onServerDocChange({ ...doc, materials, tracks }, { label: "agregar clip (móvil)" });
      setAddKind(null);
      setDraft("");
      if (!track) onError(`Material creado. Falta un track de ${kind} para soltarlo al timeline.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "No se pudo agregar el clip.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vp-mobile-toolbar" role="toolbar" aria-label="Acciones del editor">
      {mode === "add" && (
        <>
          {(["text", "video", "audio"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={addKind === kind ? "vp-btn vp-btn-active" : "vp-btn"}
              onClick={() => { setAddKind(addKind === kind ? null : kind); setDraft(""); }}
              aria-expanded={addKind === kind}
            >
              + {kind === "text" ? "Texto" : kind === "video" ? "Video" : "Audio"}
            </button>
          ))}
          {addKind && (
            <div className="vp-mt-form">
              {addKind === "text" ? (
                <textarea className="vp-input" rows={2} placeholder="Contenido del texto…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              ) : (
                <input className="vp-input" inputMode="url" placeholder="https://…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              )}
              <button type="button" className="vp-btn vp-btn-primary" disabled={busy || !draft.trim()} onClick={() => void addAndDrop()}>
                Agregar
              </button>
            </div>
          )}
        </>
      )}

      {mode === "clip" && (
        <>
          <button type="button" className="vp-btn" onClick={onSplit} disabled={!seg}>Dividir</button>
          {[0.5, 1, 2].map((v) => (
            <button key={v} type="button" className="vp-btn" disabled={!seg || seg.speed === v} onClick={() => onSpeed(v)}>
              {v}×
            </button>
          ))}
          <button type="button" className="vp-btn" onClick={onOpenEffects}>Efecto</button>
        </>
      )}

      {mode === "text" && (
        <>
          <button type="button" className="vp-btn" onClick={onOpenStyle}>Estilo</button>
          <button type="button" className="vp-btn" onClick={onSplit} disabled={!seg}>Dividir</button>
        </>
      )}
    </div>
  );
}
