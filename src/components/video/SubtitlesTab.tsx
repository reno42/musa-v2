/**
 * SubtitlesTab — REQ-063 (fases 2-4): subtítulos manuales + automáticos y
 * editor de muletillas, dentro del panel izquierdo del editor standalone.
 *
 * · Los cues VIVEN como materials kind=text server-first (payload.caption =
 *   true, payload.style = preset de subtítulo) + segmentos en el track de
 *   texto — igual que MediaBin: el autosave NUNCA re-POSTea filas ajenas.
 * · Import/export SRT/VTT usa shared/srtVtt (puro, testado).
 * · "Generar automáticamente": extractTimelineWords (audio del timeline →
 *   Scribe) → buildCuesFromWords → cues server-first → transcript persistido
 *   (musa_video_transcripts, v86) para reuso en la fase de cortes.
 * · Muletillas: chips por palabra (toggle corto/conserva) sobre los words de
 *   Scribe + lista custom + trim de pausas → regiones fundidas (TimeCut[]).
 *   "Aplicar cortes" sube las regiones al editor (preview + export con
 *   paridad por construcción) y las persiste en el transcript.
 *
 * Honestidad: sin v86 el panel avisa exactamente qué migración falta; los
 * cortes son NO destructivos — el medio original nunca se toca.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseSubtitles, serializeSrt, serializeVtt, type SubtitleCue } from "../../../shared/srtVtt";
import {
  buildCuesFromWords,
  markFillers,
  mergeCuts,
  totalCutDuration,
  type TimeCut,
} from "../../../shared/fillerWords";
import type { ScribeWord } from "../../../shared/elevenlabsMappers";
import type { VideoApplyMeta, VideoMaterial, VideoProjectDoc, VideoSegment, VideoTrack } from "../../lib/videoProjectStore";
import { extractTimelineWords, loadTranscript, saveTranscript, type TranscriptState } from "../../lib/videoTranscripts";
import { createMaterial, ensureTrack, placeSegment } from "./serverMaterials";
import { removeSegment } from "./videoDocOps";

interface SubtitlesTabProps {
  doc: VideoProjectDoc;
  playheadUs: number;
  /** Cortes ACTIVOS (vacío = preview/export sin cortes). */
  activeCuts: TimeCut[];
  onActiveCutsChange: (cuts: TimeCut[]) => void;
  onDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onSeek: (us: number) => void;
  onError: (msg: string) => void;
}

const US = 1_000_000;
/** Techo de cues por import/transcripción (POSTs server-first acotados). */
const MAX_CUES = 500;
/** Chips renderizables antes de podar la lista (panel de ~360px). */
const MAX_CHIPS = 1200;
/** Padding del corte por lado (igual que el default de detectFillerCuts). */
const CUT_PAD_SEC = 0.05;
/** Pausa recortable por defecto. */
const TRIM_SILENCE_SEC = 0.8;

/** Preset de subtítulo: abajo al centro, estilo del set de captions.ts. */
const SUBTITLE_STYLE = {
  xPct: 50,
  yPct: 88,
  fontSize: 0.06,
  color: "#ffffff",
  background: "rgba(0,0,0,0.55)",
  fontFamily: "system-ui, sans-serif",
  fontWeight: 700,
  anim: "fade",
};

interface CueItem { seg: VideoSegment; material: VideoMaterial; track: VideoTrack }

/** Un chip = una palabra, o una secuencia de muletillas como "o sea". */
interface WordChip {
  index: number;
  span: number;
  texts: string[];
  defaultCut: boolean;
  startSec: number;
  endSec: number;
}

function buildChips(words: ScribeWord[], customWords: string[]): WordChip[] {
  const marks = markFillers(words, { customWords });
  const markAt = new Map(marks.map((m) => [m.index, m.words]));
  const chips: WordChip[] = [];
  for (let i = 0; i < words.length;) {
    const span = markAt.get(i);
    if (span && words[i].kind === "word") {
      const slice = words.slice(i, i + span);
      chips.push({
        index: i,
        span,
        texts: slice.map((w) => w.text.trim()),
        defaultCut: true,
        startSec: slice[0].startSec,
        endSec: slice[slice.length - 1].endSec,
      });
      i += span;
    } else {
      chips.push({
        index: i,
        span: 1,
        texts: [words[i].text.trim()],
        defaultCut: false,
        startSec: words[i].startSec,
        endSec: words[i].endSec,
      });
      i += 1;
    }
  }
  return chips;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

export function SubtitlesTab({
  doc, playheadUs, activeCuts, onActiveCutsChange, onDocChange, onServerDocChange, onSeek, onError,
}: SubtitlesTabProps) {
  const [transcript, setTranscript] = useState<TranscriptState | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftStart, setDraftStart] = useState(0);
  const [draftEnd, setDraftEnd] = useState(0);
  const [customWordsInput, setCustomWordsInput] = useState("");
  const [trimSilences, setTrimSilences] = useState(false);
  const [cutChips, setCutChips] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectId = doc.project.id;
  const workspaceId = doc.project.workspace_id;

  // ── Cues del doc (materiales caption + segmentos del track de texto) ──
  const cueItems = useMemo<CueItem[]>(() => {
    const out: CueItem[] = [];
    for (const track of doc.tracks) {
      if (track.type !== "text") continue;
      for (const seg of track.segments) {
        const material = doc.materials.find((m) => m.id === seg.material_id);
        if (!material || (material.payload as { caption?: unknown }).caption !== true) continue;
        out.push({ seg, material, track });
      }
    }
    return out.sort((a, b) => a.seg.target_start_us - b.seg.target_start_us);
  }, [doc]);

  const docCues = useCallback((): SubtitleCue[] => cueItems.map(({ seg }) => ({
    startSec: seg.target_start_us / US,
    endSec: (seg.target_start_us + seg.target_dur_us) / US,
    text: String((doc.materials.find((m) => m.id === seg.material_id)?.payload as { text?: unknown } | undefined)?.text ?? ""),
  })), [cueItems, doc.materials]);

  // ── Transcript persistido (v86): carga única por proyecto ──
  useEffect(() => {
    let alive = true;
    setTranscriptError(null);
    (async () => {
      try {
        const state = await loadTranscript(projectId);
        if (!alive) return;
        if (state) {
          setTranscript(state);
          setCustomWordsInput(state.customWords.join(", "));
        }
      } catch (cause) {
        if (alive) setTranscriptError(cause instanceof Error ? cause.message : "No se pudo leer el transcript.");
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const words = transcript?.words ?? [];
  const customWords = useMemo(
    () => customWordsInput.split(",").map((w) => w.trim()).filter(Boolean),
    [customWordsInput],
  );
  const chips = useMemo(
    () => (words.length ? buildChips(words, customWords) : []),
    [words, customWords],
  );

  // Reset de decisiones cuando cambia la base de detección (diccionario o
  // lista custom): los defaults vuelven a marcar todo lo detectado.
  useEffect(() => {
    setCutChips(new Set(chips.filter((c) => c.defaultCut).map((c) => c.index)));
  }, [chips]);

  /** Regiones fundidas de la selección actual (+ trim opcional de pausas). */
  const computedCuts = useMemo<TimeCut[]>(() => {
    if (!words.length) return [];
    const regions: TimeCut[] = [];
    for (const chip of chips) {
      if (!cutChips.has(chip.index)) continue;
      regions.push({
        startSec: Math.max(0, chip.startSec - CUT_PAD_SEC),
        endSec: chip.endSec + CUT_PAD_SEC,
      });
    }
    if (trimSilences) {
      for (let i = 0; i < words.length - 1; i++) {
        const gap = words[i + 1].startSec - words[i].endSec;
        if (gap > TRIM_SILENCE_SEC) regions.push({ startSec: words[i].endSec, endSec: words[i + 1].startSec });
      }
    }
    return mergeCuts(regions);
  }, [chips, cutChips, words, trimSilences]);

  const savedSeconds = totalCutDuration(computedCuts);
  const cutsOn = activeCuts.length > 0;
  const chipOverflow = chips.length > MAX_CHIPS;

  // ── Acciones server-first ──────────────────────────────────────────────

  const openEditor = (segId: string, text: string, startSec: number, endSec: number) => {
    setEditingId(segId);
    setDraftText(text);
    setDraftStart(Number(startSec.toFixed(2)));
    setDraftEnd(Number(endSec.toFixed(2)));
  };

  const addCueAtPlayhead = async () => {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const startUs = Math.max(0, Math.round(playheadUs));
      const nextStart = cueItems
        .map(({ seg }) => seg.target_start_us)
        .filter((s) => s > startUs)
        .sort((a, b) => a - b)[0];
      const durUs = Math.min(2_500_000, nextStart !== undefined ? Math.max(600_000, nextStart - startUs) : 2_500_000);
      const trackRes = await ensureTrack(doc, onServerDocChange, onError, "text");
      if (!trackRes) return;
      const materialRes = await createMaterial(
        trackRes.doc, onServerDocChange, onError, "text",
        { text: "Subtítulo", style: SUBTITLE_STYLE, caption: true },
        "crear subtítulo",
      );
      if (!materialRes) return;
      const placed = await placeSegment(
        materialRes.doc, onServerDocChange, onError,
        { trackId: trackRes.track.id, material: materialRes.material, startUs, durUs },
        "colocar subtítulo",
      );
      if (!placed) return;
      // Abrir el editor del cue recién creado (según su material único).
      const fresh = placed.tracks
        .find((t) => t.id === trackRes.track.id)?.segments
        .find((s) => s.material_id === materialRes.material.id);
      if (fresh) openEditor(fresh.id, "Subtítulo", startUs / US, (startUs + durUs) / US);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "No se pudo crear el subtítulo.";
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  /** Quita los segmentos de cues actuales (el material queda en Materiales:
   *  el autosave no tiene DELETE de materiales y no se inventa). */
  const removeAllCueSegments = () => {
    let next: VideoProjectDoc = doc;
    for (const { seg } of cueItems) {
      next = removeSegment(next, seg.id);
    }
    if (cueItems.length > 0) onDocChange(next, { label: "quitar subtítulos" });
    return next;
  };

  /** Crea cues server-first sobre el doc dado. Devuelve el doc final o null. */
  const createCues = async (startDoc: VideoProjectDoc, cues: SubtitleCue[]): Promise<VideoProjectDoc | null> => {
    let working = startDoc;
    const trackRes = await ensureTrack(working, onServerDocChange, onError, "text");
    if (!trackRes) return null;
    working = trackRes.doc;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const materialRes = await createMaterial(
        working, onServerDocChange, onError, "text",
        { text: cue.text, style: SUBTITLE_STYLE, caption: true },
        "crear subtítulo",
      );
      if (!materialRes) return null;
      working = materialRes.doc;
      const placed = await placeSegment(
        working, onServerDocChange, onError,
        {
          trackId: trackRes.track.id,
          material: materialRes.material,
          startUs: Math.max(0, Math.round(cue.startSec * US)),
          durUs: Math.max(200_000, Math.round((cue.endSec - cue.startSec) * US)),
        },
        "colocar subtítulo",
      );
      if (!placed) return null;
      working = placed;
      if ((i + 1) % 25 === 0) setProgress(`Subtítulos ${i + 1}/${cues.length}…`);
    }
    return working;
  };

  const importSubtitles = async (file: File | null) => {
    if (!file || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const cues = parseSubtitles(await file.text()).slice(0, MAX_CUES);
      if (cues.length === 0) throw new Error("El archivo no tiene cues legibles (SRT/VTT).");
      if (cueItems.length > 0 && !window.confirm(`¿Reemplazar los ${cueItems.length} subtítulos actuales por ${cues.length} del archivo?`)) return;
      setProgress(`Importando ${cues.length} subtítulos…`);
      const base = removeAllCueSegments();
      const finalDoc = await createCues(base, cues);
      if (!finalDoc) return;
      setProgress(`Listo: ${cues.length} subtítulos en el timeline.`);
      // Reflejar los cues importados en el transcript (si v86 existe).
      try {
        await saveTranscript(projectId, workspaceId, {
          words, cues, cuts: transcript?.cuts ?? [], customWords, languageCode: transcript?.languageCode ?? null,
        });
      } catch { /* sin v86 los cues viven igual en el doc */ }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "No se pudo importar el archivo.";
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
      setProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const autoGenerate = async () => {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      let autoWords = words;
      if (autoWords.length === 0) {
        const result = await extractTimelineWords(doc, (fraction, label) => setProgress(`${label} ${Math.round(fraction * 100)}%`));
        autoWords = result.words;
      }
      if (autoWords.length === 0) throw new Error("La transcripción no devolvió palabras — revisá que el timeline tenga voz.");
      const cues = buildCuesFromWords(autoWords);
      const truncated = cues.length > MAX_CUES;
      const list = cues.slice(0, MAX_CUES);
      if (cueItems.length > 0 && !window.confirm(`¿Reemplazar los ${cueItems.length} subtítulos actuales por ${list.length} generados?`)) return;
      const base = removeAllCueSegments();
      const finalDoc = await createCues(base, list);
      if (!finalDoc) return;
      await saveTranscript(projectId, workspaceId, {
        words: autoWords, cues: list, cuts: [], customWords, languageCode: transcript?.languageCode ?? null,
      });
      setTranscript({ words: autoWords, cues: list, cuts: [], customWords, languageCode: transcript?.languageCode ?? null });
      setTranscriptError(null);
      setProgress(truncated
        ? `Listo: ${list.length} subtítulos (se recortaron ${cues.length - list.length} por el techo de ${MAX_CUES}).`
        : `Listo: ${list.length} subtítulos desde la transcripción.`);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "No se pudo generar la transcripción.";
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const downloadSubtitles = (format: "srt" | "vtt") => {
    const cues = docCues().filter((c) => c.text.trim());
    if (cues.length === 0) {
      setLocalError("No hay subtítulos para exportar todavía.");
      return;
    }
    const body = format === "srt" ? serializeSrt(cues) : serializeVtt(cues);
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${(doc.project.name || "subtitulos").replace(/[^\w.-]+/g, "_").slice(0, 80)}.${format}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 4_000);
  };

  // ── Edición de un cue (autosave hace el PATCH; sin endpoint de DELETE de
  //    materiales, borrar un cue quita el segmento, no el material) ──
  const saveCueEdit = () => {
    const item = cueItems.find((c) => c.seg.id === editingId);
    if (!item) { setEditingId(null); return; }
    const text = draftText.trim();
    if (!text) { setLocalError("El subtítulo no puede quedar vacío."); return; }
    const startUs = Math.max(0, Math.round(draftStart * US));
    const endUs = Math.max(startUs + 200_000, Math.round(draftEnd * US));
    const next: VideoProjectDoc = {
      ...doc,
      materials: doc.materials.map((m) => (m.id === item.material.id
        ? { ...m, payload: { ...(m.payload as Record<string, unknown>), text } }
        : m)),
      tracks: doc.tracks.map((t) => (t.id !== item.track.id ? t : {
        ...t,
        segments: t.segments
          .map((s) => (s.id !== item.seg.id ? s : {
            ...s,
            target_start_us: startUs,
            target_dur_us: endUs - startUs,
            source_dur_us: endUs - startUs,
          }))
          .sort((a, b) => a.target_start_us - b.target_start_us),
      })),
    };
    onDocChange(next, { label: "editar subtítulo" });
    setEditingId(null);
  };

  const deleteCue = (segId: string) => {
    onDocChange(removeSegment(doc, segId), { label: "quitar subtítulo" });
    if (editingId === segId) setEditingId(null);
  };

  // ── Muletillas: aplicar cortes (persistir + activar remapeo) ──
  const applyCuts = async () => {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await saveTranscript(projectId, workspaceId, {
        words, cues: docCues(), cuts: computedCuts, customWords, languageCode: transcript?.languageCode ?? null,
      });
      setTranscript({
        words, cues: docCues(), cuts: computedCuts, customWords, languageCode: transcript?.languageCode ?? null,
      });
      onActiveCutsChange(computedCuts);
      setProgress(`Cortes guardados: −${savedSeconds.toFixed(1)}s.`);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "No se pudieron guardar los cortes.";
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const toggleCutChip = (index: number) => {
    setCutChips((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="vp-subtitles">
      {transcriptError && (
        <p className="vp-hint vp-voice-error" role="alert">
          {transcriptError} Ejecutá la migración v86 en Supabase para transcribir y cortar muletillas.
        </p>
      )}

      {/* ── Cues del timeline ── */}
      <div className="vp-bin-actions">
        <button type="button" className="vp-btn vp-btn-primary" disabled={busy} onClick={() => void addCueAtPlayhead()}>
          + Subtítulo en playhead
        </button>
        <button type="button" className="vp-btn" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          Importar SRT/VTT
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".srt,.vtt,text/plain"
          style={{ display: "none" }}
          onChange={(e) => void importSubtitles(e.target.files?.[0] || null)}
        />
        <button type="button" className="vp-btn" disabled={busy} onClick={() => downloadSubtitles("srt")}>Exportar SRT</button>
        <button type="button" className="vp-btn" disabled={busy} onClick={() => downloadSubtitles("vtt")}>VTT</button>
      </div>

      <div className="vp-bin-list">
        {cueItems.length === 0 && <p className="vp-hint">Sin subtítulos. Agregalos a mano, importá un SRT o generálos automáticamente.</p>}
        {cueItems.map(({ seg, material }) => {
          const startSec = seg.target_start_us / US;
          const endSec = (seg.target_start_us + seg.target_dur_us) / US;
          const text = String((material.payload as { text?: unknown }).text ?? "");
          const editing = editingId === seg.id;
          return (
            <div key={seg.id} className="vp-bin-item vp-cue-item">
              {editing ? (
                <div className="vp-cue-edit">
                  <textarea
                    className="vp-input"
                    rows={2}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    aria-label="Texto del subtítulo"
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <label className="vp-cue-time-field">
                      desde
                      <input className="vp-input" type="number" step={0.1} min={0} value={draftStart}
                        onChange={(e) => setDraftStart(Number(e.target.value))} />
                    </label>
                    <label className="vp-cue-time-field">
                      hasta
                      <input className="vp-input" type="number" step={0.1} min={0} value={draftEnd}
                        onChange={(e) => setDraftEnd(Number(e.target.value))} />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="vp-btn vp-btn-primary" onClick={saveCueEdit}>Guardar</button>
                    <button type="button" className="vp-btn" onClick={() => setEditingId(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="vp-cue-time"
                    title="Ir a este subtítulo"
                    onClick={() => onSeek(seg.target_start_us)}
                  >
                    {formatClock(startSec)}–{formatClock(endSec)}
                  </button>
                  <span className="vp-bin-item-label" title={text}>{text || "(vacío)"}</span>
                  <button type="button" className="vp-icon-btn" title="Editar" aria-label={`Editar subtítulo ${formatClock(startSec)}`}
                    onClick={() => openEditor(seg.id, text, startSec, endSec)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                  <button type="button" className="vp-icon-btn" title="Quitar subtítulo" aria-label={`Quitar subtítulo ${formatClock(startSec)}`}
                    onClick={() => deleteCue(seg.id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Transcripción automática (Scribe) ── */}
      <h3 className="vp-panel-title">Transcripción</h3>
      <div className="vp-bin-actions">
        <button
          type="button"
          className="vp-btn vp-btn-primary"
          disabled={busy}
          onClick={() => void autoGenerate()}
          title={words.length ? "Regenerar subtítulos desde el audio del timeline" : "Transcribir el audio del timeline con ElevenLabs Scribe"}
        >
          {words.length ? "Regenerar desde audio" : "Generar automáticamente"}
        </button>
        {words.length > 0 && (
          <span className="vp-hint">{words.length} palabras transcritas</span>
        )}
      </div>

      {/* ── Muletillas (fase 4) ── */}
      {words.length > 0 && (
        <>
          <h3 className="vp-panel-title">Muletillas</h3>
          <label className="vp-field-label" htmlFor="vp-fillers-custom">Lista custom (separadas por coma)</label>
          <input
            id="vp-fillers-custom"
            className="vp-input"
            placeholder="dale, o sea, tipo…"
            value={customWordsInput}
            onChange={(e) => setCustomWordsInput(e.target.value)}
          />
          <label className="vp-fillers-trim">
            <input type="checkbox" checked={trimSilences} onChange={(e) => setTrimSilences(e.target.checked)} />
            Recortar también pausas de más de {TRIM_SILENCE_SEC}s
          </label>
          <div className="vp-fillers-chips">
            {chipOverflow && <p className="vp-hint">Se muestran las primeras {MAX_CHIPS} palabras de {chips.length}.</p>}
            {chips.slice(0, MAX_CHIPS).map((chip) => {
              const cut = cutChips.has(chip.index);
              return (
                <button
                  key={chip.index}
                  type="button"
                  className={cut ? "vp-chip vp-chip-active" : "vp-chip"}
                  title={cut ? "Clic para conservar" : "Clic para cortar"}
                  onClick={() => toggleCutChip(chip.index)}
                >
                  {chip.texts.join(" ")}
                </button>
              );
            })}
            {chips.length === 0 && <p className="vp-hint">No hay palabras para marcar.</p>}
          </div>
          <p className="vp-hint">
            {cutChips.size} muletillas marcadas · ahorrás {savedSeconds.toFixed(1)}s en {computedCuts.length} cortes.
          </p>
          <div className="vp-bin-actions">
            <button
              type="button"
              className="vp-btn vp-btn-primary"
              disabled={busy || computedCuts.length === 0}
              onClick={() => void applyCuts()}
            >
              Aplicar cortes
            </button>
            <button
              type="button"
              className={cutsOn ? "vp-chip vp-chip-active" : "vp-chip"}
              disabled={activeCuts.length === 0 && computedCuts.length === 0}
              title="El preview y el export saltan las regiones cortadas (no destructivo)"
              onClick={() => onActiveCutsChange(cutsOn ? [] : (computedCuts.length ? computedCuts : transcript?.cuts ?? []))}
            >
              {cutsOn ? "Cortes activos" : "Cortes en pausa"}
            </button>
          </div>
          {!cutsOn && (transcript?.cuts.length ?? 0) > 0 && (
            <button
              type="button"
              className="vp-btn"
              onClick={() => onActiveCutsChange(transcript?.cuts ?? [])}
            >
              Usar los {transcript?.cuts.length} cortes guardados (−{totalCutDuration(transcript?.cuts ?? []).toFixed(1)}s)
            </button>
          )}
          <p className="vp-hint">Los cortes no tocan el medio original: se aplican en la preview y en el export.</p>
        </>
      )}

      {busy && progress && <p className="vp-hint" role="status">{progress}</p>}
      {localError && <p className="vp-hint vp-voice-error" role="alert">{localError}</p>}
    </div>
  );
}
