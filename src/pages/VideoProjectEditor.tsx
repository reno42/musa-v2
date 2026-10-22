/**
 * VideoProjectEditor — superficie del editor de video standalone (REQ-VID11).
 * Shell: MediaBin | Preview | Inspector + ProjectTimeline abajo.
 *
 * · Carga: GET /api/video-projects/:id → normalizeTree; el store (con
 *   baseline + journal reconciliado desde localStorage) nace en el componente
 *   interno, montado con key=projectId — un store por proyecto, sin swaps.
 * · TODA mutación pasa por store.apply → undo/redo snapshot + autosave diff
 *   (materials → tracks → segments) contra la REST.
 * · VID12 (≤768px): inspector como bottom sheet (props/efectos/estilo),
 *   toolbar contextual (agregar / dividir / velocidad / efecto / estilo),
 *   preview fullscreen con scrub nativo. La detección es matchMedia — el
 *   mismo código React sirve para desktop y móvil.
 * · Atajos: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Supr elimina clip, Esc suelta
 *   selección. Ignora los atajos cuando el foco está en inputs.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "../lib/supabase";
import {
  VideoProjectStore,
  normalizeTree,
  type VideoApplyMeta,
  type VideoProjectDoc,
  type SaveState,
} from "../lib/videoProjectStore";
import { formatTimecode, targetDurForSource } from "../lib/videoTimelineMath";
import { downloadVideoBlob, exportStandaloneVideo } from "../lib/standaloneVideoExport";
import { InspectorPanel } from "../components/video/InspectorPanel";
import { MediaBin } from "../components/video/MediaBin";
import { MobileSheet, type MobileSheetTab } from "../components/video/MobileSheet";
import { MobileToolbar } from "../components/video/MobileToolbar";
import { ProjectTimeline } from "../components/video/ProjectTimeline";
import { VideoPreview } from "../components/video/VideoPreview";
import {
  contentEndUs,
  findSegment,
  genSegmentId,
  removeSegment,
  splitSegment,
  updateSegmentTiming,
} from "../components/video/videoDocOps";

interface VideoProjectEditorProps {
  projectId: string;
  onBack: () => void;
}

interface TreeResponse { data: VideoProjectDoc }

/** VID12: mismo código React, layout responsive — matchMedia es la verdad. */
function useIsMobileVideo(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function VideoProjectEditor({ projectId, onBack }: VideoProjectEditorProps) {
  const [tree, setTree] = useState<VideoProjectDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTree(null);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch<TreeResponse>(`/api/video-projects/${encodeURIComponent(projectId)}`);
        if (!alive) return;
        if (!res?.data?.project?.id) throw new Error("el proyecto no existe o no respondió completo");
        setTree(normalizeTree(res.data));
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "No se pudo abrir el proyecto.");
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (error) {
    return (
      <div className="vp-editor vp-editor-loading">
        <p>No se pudo abrir el proyecto: {error}</p>
        <button type="button" className="vp-btn vp-btn-primary" onClick={onBack}>Volver a Video</button>
      </div>
    );
  }
  if (!tree) {
    return <div className="vp-editor vp-editor-loading" role="status">Abriendo proyecto de video…</div>;
  }
  // key=projectId: store nuevo por proyecto (journal propio, autosave propio).
  return <VideoProjectEditorReady key={projectId} initialDoc={tree} onBack={onBack} />;
}

function VideoProjectEditorReady({ initialDoc, onBack }: { initialDoc: VideoProjectDoc; onBack: () => void }) {
  // Lazy init: baseline + journal reconciliado ANTES del primer render.
  const [store] = useState(() => {
    const s = new VideoProjectStore(initialDoc);
    s.syncFromServer(initialDoc);
    return s;
  });
  const doc = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const saveState: SaveState = useSyncExternalStore(store.subscribe, store.getSaveSnapshot);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [playheadUs, setPlayheadUs] = useState(0);
  const [usPerPx, setUsPerPx] = useState(1000);
  const isMobile = useIsMobileVideo();
  const [sheet, setSheet] = useState<{ open: boolean; tab: MobileSheetTab }>({ open: false, tab: "props" });
  const [fullscreen, setFullscreen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const playOriginRef = useRef<{ at: number; playheadUs: number } | null>(null);
  const endUs = Math.max(1, contentEndUs(doc));

  const onDocChange = useCallback((next: VideoProjectDoc, meta: VideoApplyMeta) => {
    store.apply(next, meta);
  }, [store]);

  const deleteSegment = useCallback((segmentId: string) => {
    store.apply(removeSegment(store.getSnapshot(), segmentId), { label: "eliminar clip" });
    setSelectedSegmentId((cur) => (cur === segmentId ? null : cur));
  }, [store]);

  // Server-first: el doc que devuelve la REST ya existe en el server — se
  // aplica Y se absorbe como baseline (si no, el autosave re-crearía las filas
  // y fallarían por id duplicado).
  const applyServerDoc = useCallback((next: VideoProjectDoc, meta: VideoApplyMeta) => {
    store.apply(next, meta);
    store.absorbSaved(next);
  }, [store]);

  // VID12: dividir en el playhead — mitad izquierda conserva el id (patch),
  // derecha nace con id nuevo (add); el diff del autosave lo expresa solo.
  const splitSelected = useCallback(() => {
    if (!selectedSegmentId) return;
    const next = splitSegment(store.getSnapshot(), selectedSegmentId, playheadUs, genSegmentId());
    if (!next) return;
    onDocChange(next, { label: "dividir clip" });
  }, [store, selectedSegmentId, playheadUs, onDocChange]);

  /** Velocidad rápida (VID12): el source físico no cambia; el target se
   *  recalcula por regla de oro target' = round(source' / speed'). */
  const setClipSpeed = useCallback((v: number) => {
    const seg = findSegment(store.getSnapshot(), selectedSegmentId);
    if (!seg) return;
    const speed = seg.speed > 0 ? seg.speed : 1;
    const srcStart0 = seg.source_start_us ?? 0;
    const srcDur0 = seg.source_dur_us ?? Math.max(1, Math.round(seg.target_dur_us * speed));
    const next = updateSegmentTiming(store.getSnapshot(), seg.id, {
      target_start_us: seg.target_start_us,
      target_dur_us: targetDurForSource(srcDur0, v),
      source_start_us: srcStart0,
      source_dur_us: srcDur0,
      speed: v,
    });
    onDocChange(next, { label: `velocidad ${v}×`, coalesceKey: `speed:${seg.id}` });
  }, [store, selectedSegmentId, onDocChange]);

  const reportError = useCallback((msg: string) => {
    console.error("[VideoProjectEditor]", msg);
    setRuntimeError(msg);
  }, []);

  const togglePlayback = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) return false;
      setPlayheadUs((current) => {
        const start = current >= endUs ? 0 : current;
        playOriginRef.current = { at: performance.now(), playheadUs: start };
        return start;
      });
      return true;
    });
  }, [endUs]);

  useEffect(() => {
    if (!playing) {
      playOriginRef.current = null;
      return;
    }
    const origin = playOriginRef.current ?? { at: performance.now(), playheadUs };
    playOriginRef.current = origin;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.round(origin.playheadUs + (now - origin.at) * 1000);
      if (next >= endUs) {
        setPlayheadUs(endUs);
        setPlaying(false);
        return;
      }
      setPlayheadUs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, endUs]);

  const exportVideo = useCallback(async () => {
    if (exporting) return;
    setRuntimeError(null);
    setExporting(true);
    setExportProgress(0);
    try {
      const result = await exportStandaloneVideo(store.getSnapshot(), { onProgress: setExportProgress });
      const ext = result.mimeType.includes("mp4") ? "mp4" : "webm";
      downloadVideoBlob(result.blob, `${doc.project.name.replace(/[^\w.-]+/g, "_").slice(0, 90) || "video"}.${ext}`);
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : "No se pudo exportar el video.");
    } finally {
      setExporting(false);
    }
  }, [doc.project.name, exporting, reportError, store]);

  // requestFullscreen necesita el overlay ya montado → se pide en el efecto.
  const openFullscreen = useCallback(() => setFullscreen(true), []);
  const closeFullscreen = useCallback(() => {
    setFullscreen(false);
    try {
      if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const el = stageWrapRef.current;
    try {
      if (el && !document.fullscreenElement && el.requestFullscreen) void el.requestFullscreen().catch(() => {});
    } catch { /* el overlay CSS cubre el fallback */ }
  }, [fullscreen]);

  // Aviso único de huérfanos: undo de un add de track/material (sin endpoint
  // de borrado) deja la fila en el server; el reload la vuelve a mostrar.
  useEffect(() => {
    for (const key of store.missingBaselineEntities()) store.warnOrphanOnce(key);
  }, [doc, store]);

  // ── Atajos de teclado (mismos que el editor de diseño) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          store.undo();
        } else if ((key === "z" && e.shiftKey) || key === "y") {
          e.preventDefault();
          store.redo();
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedSegmentId) {
        e.preventDefault();
        deleteSegment(selectedSegmentId);
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === "Escape") {
        setFullscreen(false);
        setSheet((cur) => ({ ...cur, open: false }));
        setSelectedSegmentId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, selectedSegmentId, deleteSegment, togglePlayback]);

  // Salida con guardado pendiente: aviso estándar del navegador.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState.status === "pending" || saveState.status === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState.status]);

  const saveLabel = saveState.status === "error"
    ? "Error al guardar"
    : saveState.status === "pending" || saveState.status === "saving"
      ? "Guardando…"
      : "Guardado";

  return (
    <div className="vp-editor">
      <header className="vp-editor-head">
        <button type="button" className="vp-btn" onClick={onBack} title="Volver a la lista de proyectos">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Video
        </button>
        <strong className="vp-editor-title">{doc.project.name}</strong>
        <span className={saveState.status === "error" ? "vp-save vp-save-error" : "vp-save"} role="status">{saveLabel}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="vp-btn" onClick={togglePlayback} aria-label={playing ? "Pausar" : "Reproducir"}>
          {playing ? "Pausar" : "Reproducir"}
        </button>
        <button type="button" className="vp-btn vp-btn-primary" disabled={exporting} onClick={() => void exportVideo()}>
          {exporting ? `Exportando ${Math.round(exportProgress * 100)}%` : "Exportar WebM"}
        </button>
        <button
          type="button"
          className="vp-btn"
          onClick={() => store.undo()}
          disabled={!store.canUndo}
          title={store.undoLabel ? `Deshacer: ${store.undoLabel}` : "Deshacer"}
          aria-label="Deshacer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button
          type="button"
          className="vp-btn"
          onClick={() => store.redo()}
          disabled={!store.canRedo}
          title={store.redoLabel ? `Rehacer: ${store.redoLabel}` : "Rehacer"}
          aria-label="Rehacer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
        </button>
      </header>
      {runtimeError && <div className="vp-error" role="alert">{runtimeError}</div>}

      <div className="vp-editor-body">
        <MediaBin
          doc={doc}
          selectedSegmentId={selectedSegmentId}
          onServerDocChange={applyServerDoc}
          onError={reportError}
        />
        <div className="vp-editor-center">
          <div className="vp-preview-zone">
            <VideoPreview
              doc={doc}
              playheadUs={playheadUs}
              selectedSegmentId={selectedSegmentId}
              onSelectSegment={setSelectedSegmentId}
              playing={!fullscreen && playing}
            />
            <button
              type="button"
              className="vp-fs-btn"
              onClick={openFullscreen}
              aria-label="Pantalla completa"
              title="Pantalla completa"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
            </button>
          </div>
          <ProjectTimeline
            doc={doc}
            selectedSegmentId={selectedSegmentId}
            playheadUs={playheadUs}
            usPerPx={usPerPx}
            onSeek={(us) => setPlayheadUs(Math.max(0, us))}
            onSelectSegment={setSelectedSegmentId}
            onDocChange={onDocChange}
            onZoomChange={setUsPerPx}
          />
        </div>
        <InspectorPanel
          doc={doc}
          segmentId={selectedSegmentId}
          onDocChange={onDocChange}
          onDelete={deleteSegment}
        />
      </div>

      {isMobile && (
        <MobileToolbar
          doc={doc}
          selectedSegmentId={selectedSegmentId}
          onServerDocChange={applyServerDoc}
          onSplit={splitSelected}
          onSpeed={setClipSpeed}
          onOpenEffects={() => setSheet({ open: true, tab: "effects" })}
          onOpenStyle={() => setSheet({ open: true, tab: "style" })}
          onError={reportError}
        />
      )}
      {isMobile && (
        <MobileSheet
          open={sheet.open}
          tab={sheet.tab}
          doc={doc}
          selectedSegmentId={selectedSegmentId}
          onTabChange={(tab) => setSheet((cur) => ({ ...cur, tab }))}
          onClose={() => setSheet((cur) => ({ ...cur, open: false }))}
          onDocChange={onDocChange}
          onServerDocChange={applyServerDoc}
          onDelete={deleteSegment}
        />
      )}

      {fullscreen && (
        <div className="vp-fullscreen" ref={stageWrapRef}>
          <VideoPreview
            doc={doc}
            playheadUs={playheadUs}
            selectedSegmentId={null}
            onSelectSegment={() => {}}
            playing={fullscreen && playing}
            variant="fullscreen"
          />
          <div className="vp-fs-controls">
            <span className="vp-fs-time">{formatTimecode(playheadUs)} / {formatTimecode(endUs)}</span>
            <input
              className="vp-fs-scrub"
              type="range"
              min={0}
              max={endUs}
              step={1000}
              value={Math.min(playheadUs, endUs)}
              onChange={(e) => setPlayheadUs(Number(e.target.value))}
              aria-label="Posición de reproducción"
            />
            <button type="button" className="vp-btn" onClick={closeFullscreen}>Salir</button>
          </div>
        </div>
      )}
    </div>
  );
}
