/**
 * VoiceTab — REQ-063 (bloque 1): locuciones IA con ElevenLabs en el editor
 * de video. Guion → voz (preview) → MP3 → R2 (uploadReelAudio) → material +
 * segment server-first en el track de audio, al playhead.
 *
 * La key vive en la BYOK del server (PUT /api/keys/elevenlabs); jamás baja al
 * navegador — todo pasa por /api/elevenlabs/*. Los guiones largos se trocean
 * por oración en el cliente (chunkScriptForTts) y los MP3 se concatenan.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearElevenlabsVoicesCache,
  fetchElevenlabsStatus,
  generateVoiceover,
  listElevenlabsModels,
  listElevenlabsVoices,
  type ElevenLabsKeyStatus,
  type ElevenLabsVoice,
} from "../../lib/elevenlabs";
import { uploadReelAudio } from "../../lib/reelUpload";
import { ELEVENLABS_TTS_MODELS, chunkScriptForTts } from "../../../shared/elevenlabsMappers";
import type { VideoApplyMeta, VideoProjectDoc } from "../../lib/videoProjectStore";
import { createMaterial, ensureTrack, placeSegment } from "./serverMaterials";

interface VoiceTabProps {
  doc: VideoProjectDoc;
  playheadUs: number;
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onError: (msg: string) => void;
}

const MODEL_LABELS: Record<string, string> = {
  eleven_multilingual_v2: "Multilingual v2 · mejor calidad",
  eleven_flash_v2_5: "Flash v2.5 · rápido / económico",
  eleven_turbo_v2_5: "Turbo v2.5 · intermedio",
};

/** Duración real del MP3 generado (decodifica con WebAudio). */
async function decodeDurationSec(blob: Blob): Promise<number> {
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("Web Audio no disponible para medir el audio.");
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    return decoded.duration;
  } finally {
    void ctx.close();
  }
}

export function VoiceTab({ doc, playheadUs, onServerDocChange, onError }: VoiceTabProps) {
  const [status, setStatus] = useState<ElevenLabsKeyStatus | null>(null);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [model, setModel] = useState<string>(ELEVENLABS_TTS_MODELS[0]);
  // Modelos extra que la key habilita (GET /v1/models); se FUSIONAN con los
  // curados, que siempre quedan disponibles (el default nunca desaparece).
  const [extraModels, setExtraModels] = useState<string[]>([]);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const modelOptions = useMemo(() => {
    const curated: string[] = [...ELEVENLABS_TTS_MODELS];
    const extra = extraModels.filter((id) => !curated.includes(id));
    return [...curated, ...extra];
  }, [extraModels]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await fetchElevenlabsStatus();
        if (!alive) return;
        setStatus(st);
        if (st.configured) {
          setLoadingVoices(true);
          const list = await listElevenlabsVoices();
          if (!alive) return;
          setVoices(list);
          setVoiceId((cur) => (cur ? cur : list[0]?.id || ""));
          // Los modelos son best-effort: si /v1/models falla, la UI igual usa
          // los curados (nunca bloquea la generación por un catálogo extra).
          listElevenlabsModels()
            .then((ms) => { if (alive) setExtraModels(ms.map((m) => m.id)); })
            .catch(() => { /* keep curated defaults */ });
        }
      } catch {
        if (alive) setStatus({ configured: false, last4: null, updatedAt: null });
      } finally {
        if (alive) setLoadingVoices(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Recargar voces: fuerza un /v1/voices nuevo (salta el cache del cliente)
  // para tomar voces creadas/clonadas desde la web de ElevenLabs.
  const refreshVoices = async () => {
    if (loadingVoices) return;
    setLoadingVoices(true);
    clearElevenlabsVoicesCache();
    try {
      const list = await listElevenlabsVoices({ force: true });
      setVoices(list);
      setVoiceId((cur) => (list.some((v) => v.id === cur) ? cur : list[0]?.id || ""));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "No se pudieron recargar las voces.");
    } finally {
      setLoadingVoices(false);
    }
  };

  // Preview de voz: un audio a la vez; cambiar de selección corta el anterior.
  useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

  const filteredVoices = useMemo(() => {
    const q = voiceFilter.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter((v) =>
      v.name.toLowerCase().includes(q)
      || (v.labels.accent || "").toLowerCase().includes(q)
      || (v.labels.gender || "").toLowerCase().includes(q)
      || (v.labels.description || "").toLowerCase().includes(q));
  }, [voices, voiceFilter]);

  const chunkCount = script.trim() ? chunkScriptForTts(script).length : 0;

  const playPreview = (voice: ElevenLabsVoice) => {
    try {
      previewAudioRef.current?.pause();
      if (!voice.previewUrl) return;
      const audio = new Audio(voice.previewUrl);
      previewAudioRef.current = audio;
      void audio.play().catch(() => { /* autoplay bloqueado: ignora */ });
    } catch { /* noop */ }
  };

  const generate = async () => {
    if (busy) return;
    const text = script.trim();
    if (!text) { setLocalError("Escribí el guion de la locución."); return; }
    if (!voiceId) { setLocalError("Elegí una voz."); return; }
    setBusy(true);
    setLocalError(null);
    setProgress("Generando audio…");
    try {
      const blob = await generateVoiceover(
        { text, voiceId, modelId: model },
        (done, total) => setProgress(total > 1 ? `Generando audio… parte ${done}/${total}` : "Generando audio…"),
      );
      setProgress("Subiendo al proyecto…");
      const durationSec = await decodeDurationSec(blob);
      const file = new File([blob], `voz_ia_${Date.now()}.mp3`, { type: "audio/mpeg" });
      const url = await uploadReelAudio(doc.project.workspace_id, file);
      let working = doc;
      const trackRes = await ensureTrack(working, onServerDocChange, onError, "audio");
      if (!trackRes) return;
      working = trackRes.doc;
      const materialRes = await createMaterial(
        working, onServerDocChange, onError,
        "audio",
        { url, durationUs: Math.round(durationSec * 1_000_000), name: `Voz IA · ${voices.find((v) => v.id === voiceId)?.name || voiceId}` },
        "agregar locución IA",
      );
      if (!materialRes) return;
      working = materialRes.doc;
      // Voz al playhead (voice-over se sincroniza con lo que se está viendo);
      // sin playhead explícito (0), al final del track de audio.
      const trackEnd = trackRes.track.segments.reduce((max, s) => Math.max(max, s.target_start_us + s.target_dur_us), 0);
      const startUs = playheadUs > 0 ? playheadUs : trackEnd;
      await placeSegment(
        working, onServerDocChange, onError,
        { trackId: trackRes.track.id, material: materialRes.material, startUs, durUs: Math.round(durationSec * 1_000_000) },
        "colocar locución IA",
      );
      setProgress("Listo: locución en el timeline.");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "No se pudo generar la locución.";
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.configured) {
    return (
      <div className="vp-voice-empty">
        <p className="vp-hint">Conectá tu key de ElevenLabs para generar locuciones IA y transcripciones.</p>
        <p className="vp-hint">Está en <strong>Ajustes → Integraciones → ElevenLabs</strong>. Los créditos corren por tu cuenta.</p>
      </div>
    );
  }

  return (
    <div className="vp-voice">
      <div className="vp-bin-form">
        <label className="vp-field-label" htmlFor="vp-voice-filter">Buscar voz</label>
        <input
          id="vp-voice-filter"
          className="vp-input"
          placeholder="español, narrador, mujer…"
          value={voiceFilter}
          onChange={(e) => setVoiceFilter(e.target.value)}
        />
        {loadingVoices && <p className="vp-hint">Cargando voces…</p>}
        {!loadingVoices && (
          <select
            className="vp-input"
            aria-label="Voz"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            {filteredVoices.length === 0 && <option value="">Sin voces para «{voiceFilter}»</option>}
            {filteredVoices.map((v) => {
              const bits = [v.labels.gender, v.labels.accent, v.labels.description].filter(Boolean).join(" · ");
              return <option key={v.id} value={v.id}>{v.name}{bits ? ` — ${bits}` : ""}</option>;
            })}
          </select>
        )}
        {voiceId && (() => {
          const v = voices.find((voice) => voice.id === voiceId);
          return v?.previewUrl ? (
            <button type="button" className="vp-btn" onClick={() => playPreview(v)}>Escuchar preview</button>
          ) : null;
        })()}
        <button type="button" className="vp-btn" disabled={loadingVoices} onClick={() => void refreshVoices()}>
          {loadingVoices ? "Recargando voces…" : `Recargar voces (${voices.length})`}
        </button>
        <label className="vp-field-label" htmlFor="vp-voice-model">Modelo</label>
        <select
          id="vp-voice-model"
          className="vp-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {modelOptions.map((m) => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
        </select>
        <label className="vp-field-label" htmlFor="vp-voice-script">Guion</label>
        <textarea
          id="vp-voice-script"
          className="vp-input"
          rows={6}
          placeholder="Texto que dirá la voz…"
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <span className="vp-hint">
          {script.trim().length} caracteres
          {chunkCount > 1 ? ` · se enviará en ${chunkCount} partes` : ""}
        </span>
        <button
          type="button"
          className="vp-btn vp-btn-primary"
          disabled={busy || !script.trim() || !voiceId}
          onClick={() => void generate()}
        >
          {busy ? (progress || "Generando…") : "Generar locución"}
        </button>
        {busy && progress && <p className="vp-hint" role="status">{progress}</p>}
        {localError && <p className="vp-hint vp-voice-error" role="alert">{localError}</p>}
        <p className="vp-hint">La locución se coloca en el playhead del track de audio{playheadUs > 0 ? " (posición actual)" : " (al final: el playhead está en 0)"}.</p>
      </div>
    </div>
  );
}
