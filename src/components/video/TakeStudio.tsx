/**
 * TakeStudio — REQ-058: grabación multi-toma con teleprompter invisible.
 *
 * Producto (decisiones explícitas):
 *  - Las tomas son INSUMO: el aviso dice que se guardan máximo 24 horas y
 *    luego se borran — la descarga es el botón protagónico de cada fila y
 *    el flujo termina en la carpeta local del usuario.
 *  - El teleprompter es overlay DOM sobre el preview: entra por los ojos
 *    del presentador, JAMÁS al stream (captura getUserMedia, nunca
 *    getDisplayMedia de la misma pestaña).
 *  - Sin cronjobs: si el server no tiene el módulo montado (404) o el
 *    storage no está configurado, el estudio degrada a MODO LOCAL (tomas
 *    solo en esta pestaña, descargables) en vez de romper.
 *
 * La API habla con /api/video-takes (apiFetch añade auth); el PUT del video
 * va DESNUDO a la URL presigned de R2 (sin headers de Musa).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import {
  MAX_TAKE_DURATION_MS,
  TakeRecorder,
  combineStreams,
  formatElapsed,
  uploadTake,
  type TakeRecording,
} from "../../lib/takeRecorder";
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
}

interface TakeStudioProps {
  workspaceId: string | null;
}

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

export function TakeStudio({ workspaceId }: TakeStudioProps) {
  // ── Cámara / mic ──
  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({ video: [], audio: [] });
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  // ── Grabación ──
  const [recState, setRecState] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recBytes, setRecBytes] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownSec, setCountdownSec] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  // ── Listado ──
  const [serverTakes, setServerTakes] = useState<TakeRow[]>([]);
  const [localTakes, setLocalTakes] = useState<LocalTake[]>([]);
  const [localMode, setLocalMode] = useState(false);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  // ── Teleprompter (overlay DOM — nunca entra al stream) ──
  const [prompterVisible, setPrompterVisible] = useState(false);
  const [prompterRunning, setPrompterRunning] = useState(false);
  const [script, setScript] = useState("");
  const [fontPx, setFontPx] = useState(42);
  const [speedPx, setSpeedPx] = useState(60);
  const [mirror, setMirror] = useState(true);
  const [leadPx, setLeadPx] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<TakeRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prompterViewportRef = useRef<HTMLDivElement | null>(null);
  const prompterInnerRef = useRef<HTMLDivElement | null>(null);
  const prompterScrollRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const localTakesRef = useRef<LocalTake[]>([]);
  const beginRef = useRef<() => void>(() => undefined);

  localTakesRef.current = localTakes;

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

  // ── Cleanup total al desmontar ──
  useEffect(() => () => {
    recorderRef.current?.abort();
    streamRef.current?.getTracks().forEach(t => t.stop());
    for (const take of localTakesRef.current) URL.revokeObjectURL(take.url);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const armPreview = useCallback(async (videoId?: string, audioId?: string) => {
    setCamError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: videoId ? { deviceId: { exact: videoId } } : true,
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
  }, [audioEnabled]);

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
    };
    setLocalTakes(prev => [local, ...prev]);
  }, []);

  const downloadLocalTake = useCallback((take: LocalTake) => {
    const a = document.createElement("a");
    a.href = take.url;
    a.download = takeFilename(take.createdAt, take.ext);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const saveTake = useCallback(async (take: TakeRecording) => {
    if (!workspaceId || localMode) {
      addLocalTake(take);
      return;
    }
    try {
      const sign = await apiFetch<{ take: TakeRow; upload: { url: string; method?: string; headers?: Record<string, string> } }>(
        "/api/video-takes/sign",
        {
          method: "POST",
          body: JSON.stringify({
            workspace_id: workspaceId,
            size_bytes: take.sizeBytes,
            duration_ms: take.durationMs,
            mime: take.mime,
          }),
        },
      );
      setUploadPct(0);
      await uploadTake(take.blob, sign.upload, f => setUploadPct(Math.round(f * 100)));
      await apiFetch("/api/video-takes/complete", {
        method: "POST",
        body: JSON.stringify({ take_id: sign.take.id }),
      });
      setToast("Toma guardada. Descargala antes de que venza (máximo 24 horas).");
      await loadTakes();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      addLocalTake(take);
      setModeNotice(explainSignFailure(message));
      if (message.includes("TAKE_STORAGE_NOT_CONFIGURED") || message.includes("API error: 404")) setLocalMode(true);
    }
  }, [workspaceId, localMode, addLocalTake, loadTakes]);

  const begin = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    if (!recorderRef.current) {
      recorderRef.current = new TakeRecorder({
        onTick: ms => setElapsed(ms),
        onChunk: info => setRecBytes(info.totalBytes),
        onError: e => setListError(e.message),
      });
    }
    try {
      recorderRef.current.start(s);
      setRecState("recording");
      setElapsed(0);
      setRecBytes(0);
      if (prompterVisible) {
        prompterScrollRef.current = 0;
        setPrompterRunning(true);
      }
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo empezar la grabación.");
    }
  }, [prompterVisible]);

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
    setBusy("saving");
    try {
      const take = await rec.stop("user");
      streamRef.current = null;
      setStream(null);
      await saveTake(take);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo cerrar la toma.");
    } finally {
      setBusy(null);
      setElapsed(0);
      setRecBytes(0);
      if (!camError) void armPreview(videoDeviceId || undefined, audioDeviceId || undefined);
    }
  }, [saveTake, camError, armPreview, videoDeviceId, audioDeviceId]);

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
    }
  }, []);

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
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename || takeFilename(Date.parse(take.createdAt), extFromMime(take.mime));
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      await loadTakes();
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo descargar la toma.");
    } finally {
      setBusy(null);
    }
  }, [busy, loadTakes]);

  const deleteServerTake = useCallback(async (take: TakeRow) => {
    if (busy) return;
    if (!window.confirm("¿Borrar esta toma ahora? Se elimina del server inmediatamente.")) return;
    setBusy(`del:${take.id}`);
    try {
      await apiFetch(`/api/video-takes/${encodeURIComponent(take.id)}`, { method: "DELETE" });
      setServerTakes(prev => prev.filter(t => t.id !== take.id));
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "No se pudo borrar la toma.");
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const removeLocalTake = useCallback((take: LocalTake) => {
    URL.revokeObjectURL(take.url);
    setLocalTakes(prev => prev.filter(t => t.id !== take.id));
  }, []);

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

  // Altura del viewport como "lead" para que el texto arranque abajo.
  useEffect(() => {
    if (!prompterVisible) return;
    setLeadPx(prompterViewportRef.current?.clientHeight || 0);
  }, [prompterVisible]);

  const liveBytes = serverTakes.reduce((acc, t) => acc + (Number(t.sizeBytes) || 0), 0);
  const recording = recState === "recording" || recState === "paused";
  const remainingSec = Math.max(0, Math.ceil((MAX_TAKE_DURATION_MS - elapsed) / 1000));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── AVISO 24 h: la promesa que motiva la descarga ── */}
      <div
        role="note"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid rgba(245, 185, 66, 0.45)",
          background: "rgba(245, 185, 66, 0.10)",
          color: "#f6d99a",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <strong>Las tomas se almacenan máximo 24 horas y luego se borran automáticamente.</strong>{" "}
          Descargá las que quieras conservar: son tu material de trabajo para editar localmente.
          {!localMode && serverTakes.length > 0 && (
            <span style={{ color: "rgba(255,255,255,0.55)" }}> {humanBytes(liveBytes)} de {humanBytes(TAKES_SOFT_QUOTA_BYTES)} en uso.</span>
          )}
        </div>
      </div>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>Tomas</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            Grabate en tomas de hasta 3 minutos, con teleprompter que solo ves vos.
          </p>
        </div>
        <button type="button" className="vp-btn" onClick={() => void loadTakes()} disabled={localMode || !workspaceId}>
          Refrescar
        </button>
      </header>

      {(modeNotice || listError) && (
        <div className="vp-error" role="alert">{modeNotice || listError}</div>
      )}
      {toast && (
        <div className="vp-hint" style={{ color: "#9fe3b0" }}>{toast}</div>
      )}

      {/* ── Estudio: preview + controles ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 1fr)", gap: 16 }}>
        <div
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />

          {/* Teleprompter overlay — DOM puro, no viaja en la grabación */}
          {prompterVisible && (
            <div
              ref={prompterViewportRef}
              style={{
                position: "absolute",
                inset: "8% 6%",
                overflow: "hidden",
                borderRadius: 10,
                background: "rgba(0,0,0,0.62)",
                border: "1px solid rgba(255,255,255,0.14)",
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
                  {script || "Escribí acá el guion que vas a leer mientras te grabás."}
                </div>
              </div>
              {prompterRunning && (
                <button
                  type="button"
                  className="vp-btn"
                  style={{ position: "absolute", top: 8, right: 8 }}
                  onClick={() => setPrompterRunning(false)}
                >
                  Pausar guion
                </button>
              )}
            </div>
          )}

          {/* HUD de grabación */}
          {recording && (
            <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 999, background: "rgba(0,0,0,0.65)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: recState === "paused" ? "#f5b942" : "#e5534b", display: "inline-block" }} aria-hidden="true" />
              <span style={{ fontSize: 13, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                {recState === "paused" ? "EN PAUSA" : "REC"} {formatElapsed(elapsed)} · queda {formatElapsed(MAX_TAKE_DURATION_MS - elapsed)}
              </span>
            </div>
          )}
          {recBytes > 0 && recording && (
            <div style={{ position: "absolute", bottom: 10, left: 10, fontSize: 12, color: "rgba(255,255,255,0.75)", padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)" }}>
              {humanBytes(recBytes)}
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

        {/* Panel de control */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
              disabled={!stream || recording || Boolean(busy)}
            >
              Grabar toma
            </button>
            {recording && (
              <>
                <button type="button" className="vp-btn" onClick={togglePause}>
                  {recState === "paused" ? "Seguir" : "Pausar"}
                </button>
                <button type="button" className="vp-btn vp-btn-primary" onClick={() => void stopRecording()} disabled={Boolean(busy)}>
                  {busy === "saving" ? "Guardando…" : "Detener"}
                </button>
              </>
            )}
          </div>
          {busy === "saving" && uploadPct > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>Subiendo toma… {uploadPct}%</div>
              <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)" }}>
                <div style={{ width: `${uploadPct}%`, height: "100%", borderRadius: 999, background: "#4f8cff" }} />
              </div>
            </div>
          )}

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
          <div className="vp-field">
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
          <label className="vp-field">
            <span>Cuenta regresiva</span>
            <select className="vp-input" value={countdownSec} onChange={(e) => setCountdownSec(Number(e.target.value))}>
              <option value={0}>Sin countdown</option>
              <option value={3}>3 segundos</option>
              <option value={5}>5 segundos</option>
            </select>
          </label>
          <p className="vp-hint">Cada toma corta sola a los 3:00. Al detener, la luz de la cámara se apaga.</p>
        </div>
      </div>

      {/* ── Teleprompter: guion + controles ── */}
      <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <strong style={{ fontSize: 14, color: "#fff" }}>Teleprompter (solo lo ves vos — no sale en la toma)</strong>
          <button type="button" className="vp-btn" onClick={() => setPrompterVisible(v => !v)}>
            {prompterVisible ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        <textarea
          className="vp-input"
          rows={4}
          placeholder="Pegá acá el guion. Se desplaza solo mientras grabás."
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
          <label className="vp-field" style={{ minWidth: 180 }}>
            <span>Velocidad: {speedPx} px/s</span>
            <input type="range" min={20} max={200} step={10} value={speedPx} onChange={(e) => setSpeedPx(Number(e.target.value))} />
          </label>
          <label className="vp-field" style={{ minWidth: 160 }}>
            <span>Tamaño: {fontPx} px</span>
            <input type="range" min={24} max={80} step={2} value={fontPx} onChange={(e) => setFontPx(Number(e.target.value))} />
          </label>
          <button type="button" className={mirror ? "vp-chip vp-chip-active" : "vp-chip"} onClick={() => setMirror(v => !v)}>
            {mirror ? "Espejado" : "Normal"}
          </button>
          {prompterVisible && (
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
          )}
        </div>
      </div>

      {/* ── Tomas del server ── */}
      {!localMode && workspaceId && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff" }}>
            Tomas guardadas {serverTakes.length > 0 && <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>· {humanBytes(liveBytes)} de {humanBytes(TAKES_SOFT_QUOTA_BYTES)}</span>}
          </h2>
          {serverTakes.length === 0 ? (
            <div className="vp-empty">
              <p style={{ margin: 0, fontWeight: 600 }}>Todavía no hay tomas</p>
              <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.55)" }}>
                Grabá la primera: queda guardada 24 horas y la bajás con un click.
              </p>
            </div>
          ) : (
            serverTakes.map((take) => {
              const info = takeStatus(take.state as TakeState, Date.parse(take.expiresAt), nowMs);
              return (
                <div key={take.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)" }}>
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
                    <div style={{ fontSize: 12, color: "#f6d99a", marginTop: 2 }}>
                      Se borra en {info.label}
                    </div>
                  </div>
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
          )}
        </section>
      )}

      {/* ── Tomas locales (fallback / modo local) ── */}
      {localTakes.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff" }}>
            Tomas en esta pestaña
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400, fontSize: 12 }}> · no están en el server: descargalas antes de cerrar</span>
          </h2>
          {localTakes.map((take) => (
            <div key={take.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px dashed rgba(245,185,66,0.45)", background: "rgba(245,185,66,0.06)" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ color: "#fff", fontSize: 13 }}>Toma local {new Date(take.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</strong>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                  {formatElapsed(take.durationMs)} · {humanBytes(take.sizeBytes)} · {take.ext.toUpperCase()}
                </div>
              </div>
              <button type="button" className="vp-btn vp-btn-primary" onClick={() => downloadLocalTake(take)}>
                Descargar
              </button>
              <button type="button" className="vp-btn" onClick={() => removeLocalTake(take)}>
                Descartar
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
