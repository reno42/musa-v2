/**
 * TakeStudio — REQ-058 (grabación) + REQ-059 (modo estudio).
 *
 * Producto (decisiones explícitas):
 *  - Las tomas son INSUMO: se guardan máximo 24 horas y luego se borran — la
 *    descarga es el botón protagónico de cada fila.
 *  - El teleprompter es overlay DOM sobre el preview: entra por los ojos del
 *    presentador, JAMÁS al stream (captura getUserMedia, nunca getDisplayMedia
 *    de la misma pestaña).
 *  - MODO ESTUDIO (REQ-059 A/B/C): la pestaña NO scrollea. arriba quedan el
 *    escenario y el teleprompter; el único scroll vive DENTRO del panel de
 *    biblioteca (y del column lateral, que es panel propio).
 *  - FORMATOS REALES (REQ-059 B): lo que se elige en el dropdown es la medida
 *    EXACTA del archivo — takeRecorder compone la cámara sobre un canvas del
 *    formato (cover por default, letterbox opcional).
 *  - REVISIÓN ANTES DE SUBIR (REQ-059 C): al Detener queda una toma pendiente
 *    con player; Subir / Descargar / Descartar / Repetir son explícitos. Así
 *    el cupo de 8 GB no paga tomas descartadas.
 *  - IMPORT DE GUION (REQ-059 A): .txt / .md / .docx sin dependencias
 *    (src/lib/docxText.ts). El guion se autoguarda por workspace.
 *
 * La API habla con /api/video-takes (apiFetch añade auth); el PUT del video va
 * DESNUDO a la URL presigned de R2 (sin headers de Musa).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import {
  MAX_TAKE_DURATION_MS,
  TAKE_FORMATS,
  TakeRecorder,
  cameraConstraintsFor,
  countWords,
  estimateSpeechSeconds,
  estimateTakeBytes,
  formatElapsed,
  takeFormatById,
  uploadTake,
  type TakeFitMode,
  type TakeFormatId,
  type TakeRecording,
} from "../../lib/takeRecorder";
import { scriptFileToText } from "../../lib/docxText";
import {
  TAKES_SOFT_QUOTA_BYTES,
  humanBytes,
  takeFilename,
  takeStatus,
  type TakeState,
} from "../../../shared/takeTtl";

interface TakeRow {
  id: string;
  workspaceId: string;
  state: string;
  mime: string;
  sizeBytes: number;
  durationMs: number;
  createdBy: string;
  downloadedAt: string | null;
  createdAt: string;
  expiresAt: string;
  status: string;
  remainingMs: number;
  remainingLabel: string;
}

/** Toma que solo existe en esta pestaña (modo local / fallback). */
interface LocalTake {
  id: string;
  url: string;
  mime: string;
  ext: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
  width?: number;
  height?: number;
}

/** Toma recién grabada, esperando decisión (subir / descargar / descartar). */
interface PendingTake {
  recording: TakeRecording;
  url: string;
}

interface TakeStudioProps {
  workspaceId: string | null;
}

const SCRIPT_SLOT = (workspaceId: string | null) => `futuraria-take-script:${workspaceId || "local"}`;
const FORMAT_SLOT = "futuraria-take-format";

function extFromMime(mime: string): string {
  return typeof mime === "string" && mime.includes("mp4") ? "mp4" : "webm";
}

function explainCamError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError") return "Permiso de cámara/micrófono denegado. Habilitalo en el candado del navegador.";
  if (name === "NotFoundError") return "No se encontró cámara. Conectá una o elegí otro dispositivo.";
  if (name === "NotReadableError") return "La cámara está ocupada por otra app. Cerrala y volvé a activar.";
  return cause instanceof Error ? cause.message : "No se pudo activar la cámara.";
}

/** Del mensaje de apiFetch ("API error: 409 — TAKE_X: …") a texto humano. */
function explainSignFailure(message: string): string {
  if (message.includes("TAKE_QUOTA_EXCEEDED")) {
    return "El cupo de tomas está lleno (8 GB vivos). Descargá y borrá tomas viejas, o esperá el barrido.";
  }
  if (message.includes("TAKE_FORBIDDEN")) {
    return "Tu rol no permite grabar tomas en este workspace (requiere editor). La toma quedó solo en esta pestaña.";
  }
  if (message.includes("TAKE_STORAGE_NOT_CONFIGURED") || message.includes("API error: 404")) {
    return "El server todavía no tiene el almacenamiento de tomas. Modo local: descargá el video antes de cerrar la pestaña.";
  }
  return `La toma no se pudo subir al server (${message}). Quedó en esta pestaña: descargala.`;
}

function readInitialFormat(): TakeFormatId {
  try {
    const saved = localStorage.getItem(FORMAT_SLOT);
    if (saved && TAKE_FORMATS.some(f => f.id === saved)) return saved as TakeFormatId;
  } catch { /* localStorage bloqueado: default */ }
  return "horizontal";
}

function readInitialScript(workspaceId: string | null): string {
  try {
    return localStorage.getItem(SCRIPT_SLOT(workspaceId)) || "";
  } catch {
    return "";
  }
}

export function TakeStudio({ workspaceId }: TakeStudioProps) {
  // ── Cámara / mic ──
  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({ video: [], audio: [] });
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  // ── Formato de toma (REQ-059 B) ──
  const [formatId, setFormatId] = useState<TakeFormatId>(readInitialFormat);
  const [fitMode, setFitMode] = useState<TakeFitMode>("cover");

  // ── Grabación ──
  const [recState, setRecState] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recBytes, setRecBytes] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownSec, setCountdownSec] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  // ── Revisión y biblioteca (REQ-059 C) ──
  const [pending, setPending] = useState<PendingTake | null>(null);
  const [player, setPlayer] = useState<{ key: string; url: string; label: string } | null>(null);

  // ── Listado ──
  const [serverTakes, setServerTakes] = useState<TakeRow[]>([]);
  const [localTakes, setLocalTakes] = useState<LocalTake[]>([]);
  const [localMode, setLocalMode] = useState(false);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  // ── Teleprompter (overlay DOM — nunca entra al stream) ──
  const [prompterVisible, setPrompterVisible] = useState(true);
  const [prompterRunning, setPrompterRunning] = useState(false);
  const [script, setScript] = useState(() => readInitialScript(workspaceId));
  const [fontPx, setFontPx] = useState(42);
  const [speedPx, setSpeedPx] = useState(60);
  const [mirror, setMirror] = useState(true);
  const [leadPx, setLeadPx] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<TakeRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scriptBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const prompterViewportRef = useRef<HTMLDivElement | null>(null);
  const prompterInnerRef = useRef<HTMLDivElement | null>(null);
  const prompterScrollRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const localTakesRef = useRef<LocalTake[]>([]);
  const pendingRef = useRef<PendingTake | null>(null);
  const beginRef = useRef<() => void>(() => undefined);

  localTakesRef.current = localTakes;
  pendingRef.current = pending;

  const format = takeFormatById(formatId);
  const scriptWords = countWords(script);
  const scriptSeconds = estimateSpeechSeconds(scriptWords);

  // ── Preview: stream → <video> ──
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // ── Reloj de countdowns de la lista ──
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Toast autodescartable ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6_000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Autoguado del guion (por workspace) y del formato ──
  // El guardado espera al primer cambio del usuario: si el workspace carga
  // DESPUÉS del montaje (slot "local" → slot del workspace), escribir de una
  // pisaba el guion guardado con el estado vacío inicial.
  const scriptDirtyRef = useRef(false);
  useEffect(() => {
    if (!scriptDirtyRef.current) return;
    try {
      localStorage.setItem(SCRIPT_SLOT(workspaceId), script);
    } catch { /* cuota de localStorage llena: el guion sigue en memoria */ }
  }, [script, workspaceId]);

  // Workspace que llega tarde: si el usuario todavía no escribió nada, leér SU slot.
  useEffect(() => {
    if (scriptDirtyRef.current) return;
    setScript(readInitialScript(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    try {
      localStorage.setItem(FORMAT_SLOT, formatId);
    } catch { /* idem */ }
  }, [formatId]);

  // ── Cleanup total al desmontar ──
  useEffect(() => () => {
    recorderRef.current?.abort();
    streamRef.current?.getTracks().forEach(t => t.stop());
    for (const take of localTakesRef.current) URL.revokeObjectURL(take.url);
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const armPreview = useCallback(async (videoId?: string, audioId?: string) => {
    setCamError(null);
    try {
      const wanted = cameraConstraintsFor(takeFormatById(formatId));
      const constraints: MediaStreamConstraints = {
        video: videoId
          ? { deviceId: { exact: videoId }, width: wanted.width, height: wanted.height }
          : { width: wanted.width, height: wanted.height },
        audio: audioEnabled ? (audioId ? { deviceId: { exact: audioId } } : true) : false,
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = s;
      setStream(s);
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        video: list.filter(d => d.kind === "videoinput"),
        audio: list.filter(d => d.kind === "audioinput"),
      });
    } catch (cause) {
      setStream(null);
      setCamError(explainCamError(cause));
    }
  }, [audioEnabled, formatId]);

  const deactivateCamera = useCallback(() => {
    recorderRef.current?.abort();
    setRecState("idle");
    setPrompterRunning(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // ── Listado server ──
  const loadTakes = useCallback(async () => {
    if (!workspaceId || localMode) return;
    try {
      const res = await apiFetch<{ takes: TakeRow[] }>(
        `/api/video-takes?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      setServerTakes(res?.takes ?? []);
      setListError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("API error: 404")) {
        setLocalMode(true);
        setModeNotice("El server todavía no tiene el módulo de tomas. Modo local: grabá y descargá desde acá.");
      } else {
        setListError(message);
      }
    }
  }, [workspaceId, localMode]);

  useEffect(() => { void loadTakes(); }, [loadTakes]);

  const addLocalTake = useCallback((take: TakeRecording) => {
    const local: LocalTake = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: URL.createObjectURL(take.blob),
      mime: take.mime,
      ext: take.ext,
      sizeBytes: take.sizeBytes,
      durationMs: take.durationMs,
      createdAt: Date.now(),
      width: take.width,
      height: take.height,
    };
    setLocalTakes(prev => [local, ...prev]);
  }, []);

  const downloadBlob = useCallback((url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const downloadLocalTake = useCallback((take: LocalTake) => {
    downloadBlob(take.url, takeFilename(take.createdAt, take.ext));
  }, [downloadBlob]);

  // ── Subida explícita desde la revisión (REQ-059 C) ──
  const uploadPending = useCallback(async () => {
    const item = pendingRef.current;
    if (!item || !workspaceId || localMode) {
      if (!item) return;
      addLocalTake(item.recording);
      URL.revokeObjectURL(item.url);
      setPending(null);
      setToast("Modo local: la toma quedó en esta pestaña. Descargala antes de cerrar.");
      return;
    }
    setBusy("saving");
    setUploadPct(0);
    try {
      const sign = await apiFetch<{ take: TakeRow; upload: { url: string; method?: string; headers?: Record<string, string> } }>(
        "/api/video-takes/sign",
        {
          method: "POST",
          body: JSON.stringify({
            workspace_id: workspaceId,
            size_bytes: item.recording.sizeBytes,
            duration_ms: item.recording.durationMs,
            mime: item.recording.mime,
          }),
        },
      );
      await uploadTake(item.recording.blob, sign.upload, f => setUploadPct(Math.round(f * 100)));
      await apiFetch("/api/video-takes/complete", {
        method: "POST",
        body: JSON.stringify({ take_id: sign.take.id }),
      });
      setToast("Toma subida. Descargala antes de que venza (máximo 24 horas).");
      await loadTakes();
      URL.revokeObjectURL(item.url);
      setPending(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // La subida falló: la toma NO se pierde, baja a la lista local.
      addLocalTake(item.recording);
      URL.revokeObjectURL(item.url);
      setPending(null);
      setModeNotice(explainSignFailure(message));
      if (message.includes("TAKE_STORAGE_NOT_CONFIGURED") || message.includes("API error: 404")) setLocalMode(true);
    } finally {
      setBusy(null);
      setUploadPct(0);
    }
  }, [addLocalTake, loadTakes, localMode, workspaceId]);

  const discardPending = useCallback(() => {
    const item = pendingRef.current;
    if (!item) return;
    if (!window.confirm("¿Descartar esta toma? Se pierde el archivo de esta pestaña.")) return;
    URL.revokeObjectURL(item.url);
    setPending(null);
    if (player?.key === "pending") setPlayer(null);
  }, [player]);

  const downloadPending = useCallback(() => {
    const item = pendingRef.current;
    if (!item) return;
    downloadBlob(item.url, takeFilename(Date.now(), item.recording.ext));
  }, [downloadBlob]);

  // ── Inicio de grabación sobre el stream activo ──
  const begin = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    if (pendingRef.current) {
      setListError("Ya hay una toma esperando revisión. Subila, descartala o descargala antes de grabar otra.");
      return;
    }
    if (!recorderRef.current) {
      recorderRef.current = new TakeRecorder({
        onTick: ms => setElapsed(ms),
        onChunk: info => setRecBytes(info.totalBytes),
        onError: e => setListError(e.message),
      });
    }
    try {
      recorderRef.current.start(s, takeFormatById(formatId), fitMode);
      setRecState("recording");
      setElapsed(0);
      setRecBytes(0);
      if (prompterVisible && script.trim()) {
        prompterScrollRef.current = 0;
        setPrompterRunning(true);
      }
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo empezar la grabación.");
    }
  }, [prompterVisible, script, formatId, fitMode]);

  beginRef.current = begin;

  // ── Cuenta regresiva previa a grabar ──
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      beginRef.current();
      return;
    }
    const t = setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 1_000);
    return () => clearTimeout(t);
  }, [countdown]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.getState() === "idle") return;
    setPrompterRunning(false);
    setRecState("idle");
    setBusy("closing");
    try {
      const take = await rec.stop("user");
      streamRef.current = null;
      setStream(null);
      // ACÁ termina la grabación y EMPIEZA la revisión: nada se sube solo.
      setPending({ recording: take, url: URL.createObjectURL(take.blob) });
      setPlayer(null);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo cerrar la toma.");
    } finally {
      setBusy(null);
      setElapsed(0);
      setRecBytes(0);
      if (!camError) void armPreview(videoDeviceId || undefined, audioDeviceId || undefined);
    }
  }, [armPreview, camError, audioDeviceId, videoDeviceId]);

  // Auto-stop por techo de 3 min — el recorder avisa y cortamos igual.
  useEffect(() => {
    if (recState !== "recording" || elapsed < MAX_TAKE_DURATION_MS) return;
    void stopRecording();
  }, [recState, elapsed, stopRecording]);

  const startRecording = useCallback(() => {
    if (!streamRef.current || recState !== "idle" || busy) return;
    if (!workspaceId && !localMode) setLocalMode(true);
    if (countdownSec > 0) setCountdown(countdownSec);
    else beginRef.current();
  }, [recState, busy, countdownSec, workspaceId, localMode]);

  const repeatTake = useCallback(() => {
    const item = pendingRef.current;
    if (item) {
      URL.revokeObjectURL(item.url);
      setPending(null);
    }
    if (player?.key === "pending") setPlayer(null);
    const lanzar = () => {
      if (countdownSec > 0) setCountdown(countdownSec);
      else beginRef.current();
    };
    if (!streamRef.current) {
      // Tras la revisión la cámara se está re-encendiendo: grabar recién
      // cuando el stream esté (si no, begin() salía en silencio con countdown 0).
      void armPreview(videoDeviceId || undefined, audioDeviceId || undefined).then(lanzar);
      return;
    }
    lanzar();
  }, [armPreview, audioDeviceId, countdownSec, player, videoDeviceId]);

  const togglePause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.getState() === "recording") {
      rec.pause();
      setRecState("paused");
      setPrompterRunning(false);
    } else if (rec.getState() === "paused") {
      rec.resume();
      setRecState("recording");
      if (prompterVisible && script.trim()) setPrompterRunning(true);
    }
  }, [prompterVisible, script]);

  // ── Acciones de lista ──
  const downloadServerTake = useCallback(async (take: TakeRow) => {
    if (busy) return;
    setBusy(`dl:${take.id}`);
    try {
      const res = await apiFetch<{ downloadUrl: string; filename: string }>(
        `/api/video-takes/${encodeURIComponent(take.id)}/download`,
      );
      const fileRes = await fetch(res.downloadUrl);
      if (!fileRes.ok) throw new Error(`No se pudo bajar el archivo (${fileRes.status}).`);
      const blob = await fileRes.blob();
      const url = URL.createObjectURL(blob);
      downloadBlob(url, res.filename || takeFilename(Date.parse(take.createdAt), extFromMime(take.mime)));
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      await loadTakes();
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo descargar la toma.");
    } finally {
      setBusy(null);
    }
  }, [busy, downloadBlob, loadTakes]);

  /** Reproductor inline sin marcar la toma como descargada (?preview=1). */
  const previewServerTake = useCallback(async (take: TakeRow) => {
    if (busy) return;
    if (player?.key === take.id) {
      setPlayer(null);
      return;
    }
    setBusy(`pv:${take.id}`);
    try {
      const res = await apiFetch<{ downloadUrl: string }>(
        `/api/video-takes/${encodeURIComponent(take.id)}/download?preview=1`,
      );
      setPlayer({
        key: take.id,
        url: res.downloadUrl,
        label: `Toma ${new Date(take.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · ${formatElapsed(take.durationMs)}`,
      });
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo reproducir la toma.");
    } finally {
      setBusy(null);
    }
  }, [busy, player]);

  const deleteServerTake = useCallback(async (take: TakeRow) => {
    if (busy) return;
    if (!window.confirm("¿Borrar esta toma ahora? Se elimina del server inmediatamente.")) return;
    setBusy(`del:${take.id}`);
    try {
      await apiFetch(`/api/video-takes/${encodeURIComponent(take.id)}`, { method: "DELETE" });
      setServerTakes(prev => prev.filter(t => t.id !== take.id));
      if (player?.key === take.id) setPlayer(null);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo borrar la toma.");
    } finally {
      setBusy(null);
    }
  }, [busy, player]);

  const removeLocalTake = useCallback((take: LocalTake) => {
    URL.revokeObjectURL(take.url);
    setLocalTakes(prev => prev.filter(t => t.id !== take.id));
    if (player?.key === take.id) setPlayer(null);
  }, [player]);

  // ── Teleprompter: scroll por rAF (px/s), nunca en el stream ──
  useEffect(() => {
    if (!prompterRunning) return;
    lastFrameRef.current = performance.now();
    const step = (now: number) => {
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      prompterScrollRef.current += speedPx * dt;
      const inner = prompterInnerRef.current;
      const viewport = prompterViewportRef.current;
      if (inner && viewport) {
        const max = inner.scrollHeight - viewport.clientHeight;
        if (prompterScrollRef.current >= max) {
          prompterScrollRef.current = Math.max(0, max);
          setPrompterRunning(false);
        }
        inner.style.transform = `translateY(${-prompterScrollRef.current}px)`;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [prompterRunning, speedPx]);

  // Altura del viewport como "lead" para que el texto arranque abajo. Se
  // vuelve a medir con ResizeObserver: el viewport cambia de tamaño al
  // alternar formato (preview WYSIWYG) o al redimensionar la ventana.
  useEffect(() => {
    const el = prompterViewportRef.current;
    if (!prompterVisible || !el) return;
    setLeadPx(el.clientHeight || 0);
    const ro = new ResizeObserver(() => setLeadPx(el.clientHeight || 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [prompterVisible]);

  // ── Import de guion (.txt / .md / .docx) ──
  const importScript = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await scriptFileToText(file);
      scriptDirtyRef.current = true;
      setScript(text);
      prompterScrollRef.current = 0;
      if (prompterInnerRef.current) prompterInnerRef.current.style.transform = "translateY(0px)";
      setToast(`Guion importado de ${file.name} · ${countWords(text)} palabras ≈ ${formatElapsed(estimateSpeechSeconds(countWords(text)) * 1000)}.`);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo leer el archivo.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const focusScriptEditor = useCallback(() => {
    scriptBoxRef.current?.focus();
    scriptBoxRef.current?.setSelectionRange(scriptBoxRef.current.value.length, scriptBoxRef.current.value.length);
  }, []);

  const liveBytes = serverTakes.reduce((acc, t) => acc + (Number(t.sizeBytes) || 0), 0);
  const recording = recState === "recording" || recState === "paused";
  const estimatedBytes = estimateTakeBytes(format, MAX_TAKE_DURATION_MS);
  const remainingSec = Math.max(0, Math.ceil((MAX_TAKE_DURATION_MS - elapsed) / 1000));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* ── Cabecera: título + aviso 24 h en una sola línea (nada de scrollear) ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#fff" }}>Tomas</h1>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Teleprompter que solo ves vos · tomas de hasta 3:00 ·{" "}
            <strong style={{ color: "#f6d99a", fontWeight: 600 }}>se borran a las 24 h</strong>
            {!localMode && serverTakes.length > 0 && (
              <span> · {humanBytes(liveBytes)} de {humanBytes(TAKES_SOFT_QUOTA_BYTES)} en uso</span>
            )}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <label className="vp-field" style={{ margin: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <span>Formato</span>
            <select
              className="vp-input"
              value={formatId}
              disabled={recording}
              onChange={(e) => setFormatId(e.target.value as TakeFormatId)}
              style={{ minWidth: 210 }}
            >
              {TAKE_FORMATS.map(f => (
                <option key={f.id} value={f.id}>{f.label} · {f.hint} · ~{humanBytes(estimateTakeBytes(f, MAX_TAKE_DURATION_MS))}/3 min</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={fitMode === "contain" ? "vp-chip vp-chip-active" : "vp-chip"}
            onClick={() => setFitMode(v => (v === "cover" ? "contain" : "cover"))}
            disabled={recording}
            title={fitMode === "cover" ? "La cámara llena el cuadro (recorta bordes)" : "La cámara entra completa (bandas arriba/abajo)"}
          >
            {fitMode === "cover" ? "Recortar" : "Encajar"}
          </button>
          <button type="button" className="vp-btn" onClick={() => void loadTakes()} disabled={localMode || !workspaceId}>
            Refrescar
          </button>
        </div>
      </header>

      {(modeNotice || listError) && (
        <div className="vp-error" role="alert" style={{ flexShrink: 0 }}>{modeNotice || listError}</div>
      )}
      {toast && (
        <div className="vp-hint" style={{ color: "#9fe3b0", flexShrink: 0 }}>{toast}</div>
      )}

      {/* ── Cuerpo: escenario (izquierda) + panel de trabajo (derecha) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 360px)", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Escenario */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              padding: 10,
            }}
          >
            <div
              style={{
                position: "relative",
                aspectRatio: `${format.width} / ${format.height}`,
                maxWidth: "100%",
                maxHeight: "100%",
                width: format.width >= format.height ? "100%" : "auto",
                height: format.height > format.width ? "100%" : "auto",
                background: "#000",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: fitMode === "cover" ? "cover" : "contain", transform: "scaleX(-1)", background: "#000" }}
              />

              {/* Teleprompter overlay — DOM puro, no viaja en la grabación */}
              {prompterVisible && (
                <div
                  ref={prompterViewportRef}
                  onClick={focusScriptEditor}
                  style={{
                    position: "absolute",
                    inset: "8% 6%",
                    overflow: "hidden",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.62)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    cursor: "text",
                  }}
                >
                  <div ref={prompterInnerRef} style={{ willChange: "transform" }}>
                    <div style={{ height: leadPx }} aria-hidden="true" />
                    <div
                      style={{
                        transform: mirror ? "scaleX(-1)" : undefined,
                        padding: "0 28px 48px",
                        fontSize: fontPx,
                        lineHeight: 1.35,
                        color: "#fff",
                        whiteSpace: "pre-wrap",
                        textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                      }}
                    >
                      {script || "Escribí o importá el guion en el panel derecho. Se desplaza solo mientras grabás."}
                    </div>
                  </div>
                  <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                    {prompterRunning ? (
                      <button type="button" className="vp-btn" onClick={() => setPrompterRunning(false)}>Pausar guion</button>
                    ) : (
                      <button
                        type="button"
                        className="vp-btn"
                        onClick={() => {
                          prompterScrollRef.current = 0;
                          if (prompterInnerRef.current) prompterInnerRef.current.style.transform = "translateY(0px)";
                          setPrompterRunning(true);
                        }}
                        disabled={!script.trim()}
                      >
                        Desplazar
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* HUD de grabación */}
              {recording && (
                <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 999, background: "rgba(0,0,0,0.65)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: recState === "paused" ? "#f5b942" : "#e5534b", display: "inline-block" }} aria-hidden="true" />
                  <span style={{ fontSize: 13, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                    {recState === "paused" ? "EN PAUSA" : "REC"} {formatElapsed(elapsed)} · quedan {formatElapsed(remainingSec * 1000)}
                  </span>
                </div>
              )}
              {recBytes > 0 && recording && (
                <div style={{ position: "absolute", bottom: 10, left: 10, fontSize: 12, color: "rgba(255,255,255,0.75)", padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)" }}>
                  {humanBytes(recBytes)} · {format.width}×{format.height}
                </div>
              )}
              {countdown !== null && countdown > 0 && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", fontSize: 96, fontWeight: 800, color: "#fff" }}>
                  {countdown}
                </div>
              )}
              {!stream && !camError && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
                  Activá la cámara para empezar
                </div>
              )}
            </div>
          </div>

          {/* Transporte — siempre visible, sin scroll */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {!stream ? (
              <button type="button" className="vp-btn vp-btn-primary" onClick={() => void armPreview(videoDeviceId || undefined, audioDeviceId || undefined)} disabled={recording}>
                Activar cámara
              </button>
            ) : (
              <button type="button" className="vp-btn" onClick={deactivateCamera} disabled={recording}>
                Apagar cámara
              </button>
            )}
            <button
              type="button"
              className="vp-btn vp-btn-primary"
              onClick={startRecording}
              disabled={!stream || recording || Boolean(busy) || Boolean(pending)}
            >
              {countdown !== null ? `Listos… ${countdown}` : "Grabar toma"}
            </button>
            {recording && (
              <>
                <button type="button" className="vp-btn" onClick={togglePause}>
                  {recState === "paused" ? "Seguir" : "Pausar"}
                </button>
                <button type="button" className="vp-btn vp-btn-primary" onClick={() => void stopRecording()} disabled={Boolean(busy)}>
                  {busy === "closing" ? "Cerrando…" : "Detener y revisar"}
                </button>
              </>
            )}
            {busy === "saving" && (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>Subiendo toma… {uploadPct}%</span>
            )}
            <span className="vp-hint" style={{ fontSize: 11.5 }}>
              Salida {format.width}×{format.height} · {format.hint} · ~{humanBytes(estimatedBytes)} por toma de 3:00
            </span>
          </div>
        </div>

        {/* Panel lateral: teleprompter editable + dispositivos */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
          <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: 13, color: "#fff" }}>Guion del teleprompter</strong>
              <button type="button" className={prompterVisible ? "vp-chip vp-chip-active" : "vp-chip"} onClick={() => setPrompterVisible(v => !v)}>
                {prompterVisible ? "En pantalla" : "Oculto"}
              </button>
            </div>
            <textarea
              ref={scriptBoxRef}
              className="vp-input"
              rows={7}
              placeholder="Escribí acá, pegá un texto o importá .docx / .txt / .md. Se guarda solo."
              value={script}
              onChange={(e) => { scriptDirtyRef.current = true; setScript(e.target.value); }}
              style={{ resize: "vertical", minHeight: 120, lineHeight: 1.5 }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.txt,.md,.markdown,text/plain,text/markdown"
                style={{ display: "none" }}
                onChange={(e) => { void importScript(e.target.files?.[0] || null); }}
              />
              <button type="button" className="vp-btn" onClick={() => fileInputRef.current?.click()}>
                Importar .docx / .txt / .md
              </button>
              <span className="vp-hint" style={{ fontSize: 11.5 }}>
                {scriptWords} palabras ≈ {formatElapsed(scriptSeconds * 1000)} leído ({speedPx} px/s)
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="vp-field" style={{ marginBottom: 0 }}>
                <span>Velocidad: {speedPx} px/s</span>
                <input type="range" min={20} max={200} step={10} value={speedPx} onChange={(e) => setSpeedPx(Number(e.target.value))} />
              </label>
              <label className="vp-field" style={{ marginBottom: 0 }}>
                <span>Tamaño de letra: {fontPx} px</span>
                <input type="range" min={24} max={80} step={2} value={fontPx} onChange={(e) => setFontPx(Number(e.target.value))} />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={mirror ? "vp-chip vp-chip-active" : "vp-chip"} onClick={() => setMirror(v => !v)}>
                  {mirror ? "Espejado" : "Normal"}
                </button>
                <button
                  type="button"
                  className="vp-btn"
                  onClick={() => {
                    prompterScrollRef.current = 0;
                    if (prompterInnerRef.current) prompterInnerRef.current.style.transform = "translateY(0px)";
                    setPrompterRunning(true);
                  }}
                  disabled={!script.trim() || recording}
                >
                  Probar guion
                </button>
              </div>
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="vp-field">
              <span>Cámara</span>
              <select
                className="vp-input"
                value={videoDeviceId}
                disabled={recording}
                onChange={(e) => {
                  setVideoDeviceId(e.target.value);
                  if (streamRef.current && recState === "idle") void armPreview(e.target.value || undefined, audioDeviceId || undefined);
                }}
              >
                <option value="">Predeterminada</option>
                {devices.video.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || "Cámara"}</option>)}
              </select>
            </label>
            <label className="vp-field">
              <span>Micrófono</span>
              <select
                className="vp-input"
                value={audioDeviceId}
                disabled={recording}
                onChange={(e) => {
                  setAudioDeviceId(e.target.value);
                  if (streamRef.current && recState === "idle" && audioEnabled) void armPreview(videoDeviceId || undefined, e.target.value || undefined);
                }}
              >
                <option value="">Predeterminado</option>
                {devices.audio.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || "Micrófono"}</option>)}
              </select>
            </label>
            <div className="vp-field" style={{ marginBottom: 0 }}>
              <span>Audio</span>
              <button
                type="button"
                className={audioEnabled ? "vp-chip vp-chip-active" : "vp-chip"}
                onClick={() => setAudioEnabled(v => !v)}
                disabled={recording}
              >
                {audioEnabled ? "Con micrófono" : "Sin audio"}
              </button>
            </div>
            <label className="vp-field" style={{ marginBottom: 0 }}>
              <span>Cuenta regresiva</span>
              <select className="vp-input" value={countdownSec} onChange={(e) => setCountdownSec(Number(e.target.value))}>
                <option value={0}>Sin countdown</option>
                <option value={3}>3 segundos</option>
                <option value={5}>5 segundos</option>
              </select>
            </label>
            <p className="vp-hint" style={{ margin: 0, fontSize: 11.5 }}>
              Cada toma corta sola a los 3:00. Al detener se abre la revisión: nada se sube hasta que digas Subir.
            </p>
          </section>
        </div>
      </div>

      {/* ── Biblioteca: scroll INTERNO, la página nunca se mueve ── */}
      <section
        style={{
          flexShrink: 0,
          height: "clamp(200px, 32%, 320px)",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          borderTop: "1px solid rgba(255,255,255,0.10)",
          paddingTop: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>
            Biblioteca de tomas
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400, fontSize: 12 }}>
              {" "}{serverTakes.length} en el server · {localTakes.length} en esta pestaña
            </span>
          </h2>
          {player && (
            <button type="button" className="vp-btn" onClick={() => setPlayer(null)}>Cerrar reproductor</button>
          )}
        </div>

        <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
          {/* Revisión de la toma recién grabada */}
          {pending && (
            <div style={{ border: "1px solid rgba(99,102,241,0.5)", background: "rgba(99,102,241,0.08)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ color: "#fff", fontSize: 13 }}>Toma recién grabada · revisala antes de subir</strong>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                  {formatElapsed(pending.recording.durationMs)} · {humanBytes(pending.recording.sizeBytes)} ·{" "}
                  {pending.recording.width}×{pending.recording.height} · {pending.recording.ext.toUpperCase()}
                </span>
              </div>
              <video
                src={pending.url}
                controls
                playsInline
                style={{ width: "100%", maxHeight: 190, borderRadius: 10, background: "#000" }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="vp-btn vp-btn-primary"
                  onClick={() => void uploadPending()}
                  disabled={Boolean(busy)}
                >
                  {busy === "saving" ? `Subiendo… ${uploadPct}%` : localMode || !workspaceId ? "Guardar en esta pestaña" : "Subir a la biblioteca"}
                </button>
                <button type="button" className="vp-btn" onClick={downloadPending}>Descargar ahora</button>
                <button type="button" className="vp-btn" onClick={repeatTake} disabled={recording}>Repetir grabación</button>
                <button type="button" className="vp-btn" onClick={discardPending} disabled={Boolean(busy)}>Descartar</button>
                {busy === "saving" && (
                  <div style={{ flex: "1 1 120px", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)" }}>
                    <div style={{ width: `${uploadPct}%`, height: "100%", borderRadius: 999, background: "#4f8cff" }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reproductor de una toma guardada */}
          {player && (
            <div style={{ border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, padding: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>{player.label}</div>
              <video src={player.url} controls autoPlay playsInline style={{ width: "100%", maxHeight: 220, borderRadius: 10, background: "#000" }} />
            </div>
          )}

          {/* Tomas del server */}
          {!localMode && workspaceId && (
            serverTakes.length === 0 && !pending ? (
              <div className="vp-empty" style={{ minHeight: 90 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Todavía no hay tomas guardadas</p>
                <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.55)" }}>
                  Grabá la primera: queda 24 horas en el server y la bajás con un click.
                </p>
              </div>
            ) : (
              serverTakes.map((take) => {
                const info = takeStatus(take.state as TakeState, Date.parse(take.expiresAt), nowMs);
                return (
                  <div key={take.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", flexShrink: 0 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <strong style={{ color: "#fff", fontSize: 13 }}>
                          Toma {new Date(take.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                        </strong>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                          {formatElapsed(take.durationMs)} · {humanBytes(take.sizeBytes)} · {extFromMime(take.mime).toUpperCase()}
                        </span>
                        {take.downloadedAt && (
                          <span style={{ fontSize: 11, color: "#9fe3b0", border: "1px solid rgba(159,227,176,0.4)", borderRadius: 999, padding: "1px 8px" }}>descargada</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#f6d99a", marginTop: 2 }}>Se borra en {info.label}</div>
                    </div>
                    <button
                      type="button"
                      className={player?.key === take.id ? "vp-btn vp-btn-active" : "vp-btn"}
                      onClick={() => void previewServerTake(take)}
                      disabled={Boolean(busy) || take.state !== "ready"}
                    >
                      {busy === `pv:${take.id}` ? "Preparando…" : player?.key === take.id ? "Ocultar" : "Reproducir"}
                    </button>
                    <button
                      type="button"
                      className="vp-btn vp-btn-primary"
                      onClick={() => void downloadServerTake(take)}
                      disabled={Boolean(busy)}
                    >
                      {busy === `dl:${take.id}` ? "Bajando…" : "Descargar"}
                    </button>
                    <button
                      type="button"
                      className="vp-icon-btn"
                      onClick={() => void deleteServerTake(take)}
                      disabled={Boolean(busy)}
                      title="Borrar toma"
                      aria-label={`Borrar toma del ${new Date(take.createdAt).toLocaleTimeString("es-AR")}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )
          )}

          {/* Tomas locales (fallback / modo local) */}
          {localTakes.map((take) => (
            <div key={take.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 10, border: "1px dashed rgba(245,185,66,0.45)", background: "rgba(245,185,66,0.06)", flexShrink: 0 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ color: "#fff", fontSize: 13 }}>Toma local {new Date(take.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</strong>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                  {formatElapsed(take.durationMs)} · {humanBytes(take.sizeBytes)} · {take.ext.toUpperCase()}
                  {take.width ? ` · ${take.width}×${take.height}` : ""} · no está en el server
                </div>
              </div>
              <button
                type="button"
                className={player?.key === take.id ? "vp-btn vp-btn-active" : "vp-btn"}
                onClick={() => setPlayer(player?.key === take.id ? null : { key: take.id, url: take.url, label: "Toma local" })}
              >
                {player?.key === take.id ? "Ocultar" : "Reproducir"}
              </button>
              <button type="button" className="vp-btn vp-btn-primary" onClick={() => downloadLocalTake(take)}>
                Descargar
              </button>
              <button type="button" className="vp-btn" onClick={() => removeLocalTake(take)}>
                Descartar
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
