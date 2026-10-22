/**
 * MediaBin — bin de materiales, tracks y efectos (REQ-VID11/14). Los ALTOS
 * resuelven server-first (POST → fila real con id) y recién entonces el
 * editor aplica el doc CON absorbSaved (onServerDocChange): el journal solo
 * conoce ids reales (el undo de un delete re-crea la MISMA fila) y el
 * autosave NO re-POSTea lo que el server ya creó (ids únicos).
 */
import { useState } from "react";
import { apiFetch } from "../../lib/supabase";
import type { VideoApplyMeta, VideoMaterial, VideoProjectDoc, VideoSegment } from "../../lib/videoProjectStore";
import { DEFAULT_DROP_DUR_US } from "../../lib/videoTimelineMath";
import { EffectPicker } from "./EffectPicker";
import { materialDurationUs, trackForMaterialKind } from "./videoDocOps";

interface MediaBinProps {
  doc: VideoProjectDoc;
  selectedSegmentId: string | null;
  /** store.apply + store.absorbSaved — server-first sin re-POST. */
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onError: (msg: string) => void;
}

type AddKind = "text" | "video" | "image" | "audio";

export function MediaBin({ doc, selectedSegmentId, onServerDocChange, onError }: MediaBinProps) {
  const [openKind, setOpenKind] = useState<AddKind | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const labelFor = (m: VideoMaterial): string => {
    const p = (m.payload ?? {}) as { url?: unknown; text?: unknown };
    if (typeof p.text === "string" && p.text.trim()) return p.text.trim().slice(0, 36);
    if (typeof p.url === "string" && p.url) return (p.url.split("/").pop() || p.url).slice(0, 36);
    return m.kind;
  };

  const addMaterial = async (kind: AddKind, payload: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      const pid = encodeURIComponent(doc.project.id);
      const res = await apiFetch<{ data: { material: VideoMaterial } }>(`/api/video-projects/${pid}/materials`, {
        method: "POST",
        body: JSON.stringify({ kind, payload }),
      });
      const material = res?.data?.material;
      if (!material) throw new Error("La respuesta no incluyó el material.");
      onServerDocChange({ ...doc, materials: [...doc.materials, { ...material, slot: material.slot ?? null }] }, { label: "agregar material" });
      setOpenKind(null);
      setDraft("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "No se pudo crear el material.");
    } finally {
      setBusy(false);
    }
  };

  /** Material → timeline: append al final del track compatible (server-first). */
  const addToTimeline = async (material: VideoMaterial) => {
    if (busy) return;
    const track = trackForMaterialKind(doc, material.kind);
    if (!track) { onError(`No hay un track de ${material.kind === "audio" ? "audio" : material.kind === "text" ? "texto" : "video"} — crealo abajo.`); return; }
    setBusy(true);
    try {
      const pid = encodeURIComponent(doc.project.id);
      const appendAt = track.segments.reduce((max, s) => Math.max(max, s.target_start_us + s.target_dur_us), 0);
      const dur = materialDurationUs(material) ?? DEFAULT_DROP_DUR_US;
      const res = await apiFetch<{ data: { segment: VideoSegment } }>(`/api/video-projects/${pid}/segments`, {
        method: "POST",
        body: JSON.stringify({
          trackId: track.id,
          materialId: material.id,
          targetStartUs: appendAt,
          targetDurUs: dur,
          sourceStartUs: 0,
          sourceDurUs: dur,
        }),
      });
      const segment = res?.data?.segment;
      if (!segment) throw new Error("La respuesta no incluyó el segmento.");
      const seg: VideoSegment = { ...segment, extra_refs: segment.extra_refs ?? [] };
      const tracks = doc.tracks.map((t) => (t.id === track.id
        ? { ...t, segments: [...t.segments, seg].sort((a, b) => a.target_start_us - b.target_start_us) }
        : t));
      onServerDocChange({ ...doc, tracks }, { label: "agregar clip al timeline" });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "No se pudo agregar el clip al timeline.");
    } finally {
      setBusy(false);
    }
  };

  const addTrack = async (type: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const pid = encodeURIComponent(doc.project.id);
      const zOrder = doc.tracks.reduce((max, t) => Math.max(max, t.z_order), -1) + 1;
      const res = await apiFetch<{ data: { track: { id: string; project_id: string; type: string; z_order: number } } }>(`/api/video-projects/${pid}/tracks`, {
        method: "POST",
        body: JSON.stringify({ type, zOrder }),
      });
      const track = res?.data?.track;
      if (!track) throw new Error("La respuesta no incluyó el track.");
      onServerDocChange({ ...doc, tracks: [...doc.tracks, { ...track, segments: [] }] }, { label: "agregar track" });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "No se pudo crear el track.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="vp-bin">
      <h3 className="vp-panel-title">Materiales</h3>
      <div className="vp-bin-actions">
        <button type="button" className={openKind === "text" ? "vp-btn vp-btn-active" : "vp-btn"} onClick={() => { setOpenKind(openKind === "text" ? null : "text"); setDraft(""); }}>Texto</button>
        <button type="button" className={openKind === "video" ? "vp-btn vp-btn-active" : "vp-btn"} onClick={() => { setOpenKind(openKind === "video" ? null : "video"); setDraft(""); }}>Video URL</button>
        <button type="button" className={openKind === "image" ? "vp-btn vp-btn-active" : "vp-btn"} onClick={() => { setOpenKind(openKind === "image" ? null : "image"); setDraft(""); }}>Imagen URL</button>
        <button type="button" className={openKind === "audio" ? "vp-btn vp-btn-active" : "vp-btn"} onClick={() => { setOpenKind(openKind === "audio" ? null : "audio"); setDraft(""); }}>Audio URL</button>
      </div>
      {openKind && (
        <div className="vp-bin-form">
          {openKind === "text" ? (
            <textarea
              className="vp-input"
              rows={2}
              placeholder="Contenido del texto…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <input
              className="vp-input"
              placeholder="https://…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          <button
            type="button"
            className="vp-btn vp-btn-primary"
            disabled={busy || !draft.trim()}
            onClick={() => void addMaterial(openKind, openKind === "text" ? { text: draft.trim() } : { url: draft.trim() })}
          >
            Agregar
          </button>
        </div>
      )}

      <div className="vp-bin-list">
        {doc.materials.length === 0 && <p className="vp-hint">Sin materiales todavía.</p>}
        {doc.materials.map((m) => (
          <div key={m.id} className="vp-bin-item">
            <span className={`vp-track-chip vp-track-${m.kind === "audio" || m.kind === "text" ? m.kind : "video"}`}>{m.kind}</span>
            <span className="vp-bin-item-label" title={m.id}>{labelFor(m)}</span>
            <button
              type="button"
              className="vp-icon-btn"
              title="Agregar al timeline"
              aria-label={`Agregar ${labelFor(m)} al timeline`}
              disabled={busy}
              onClick={() => void addToTimeline(m)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            </button>
          </div>
        ))}
      </div>

      <h3 className="vp-panel-title">Efectos</h3>
      <EffectPicker
        doc={doc}
        selectedSegmentId={selectedSegmentId}
        onServerDocChange={onServerDocChange}
        onError={onError}
      />

      <h3 className="vp-panel-title">Tracks</h3>
      <div className="vp-bin-actions">
        {(["video", "audio", "text"] as const).map((type) => (
          <button key={type} type="button" className="vp-btn" disabled={busy} onClick={() => void addTrack(type)}>
            + {type}
          </button>
        ))}
      </div>
    </aside>
  );
}
