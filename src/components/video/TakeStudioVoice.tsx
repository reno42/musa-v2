/**
 * TakeStudioVoice — REQ-063 (fase 1): "Voz IA" en Take Studio. Toma el guion
 * del teleprompter, genera la locución con ElevenLabs (BYOK vía proxy
 * same-origin) y la reproduce mientras el guion se desplaza — para ensayar
 * la lectura o grabar la voz en off encima de la toma. El MP3 queda
 * descargable para llevarlo al editor de video (donde también puede
 * generarse directo en la pestaña Voz IA).
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchElevenlabsStatus,
  generateVoiceover,
  listElevenlabsVoices,
  type ElevenLabsKeyStatus,
  type ElevenLabsVoice,
} from "../../lib/elevenlabs";
import { ELEVENLABS_TTS_MODELS, chunkScriptForTts } from "../../../shared/elevenlabsMappers";

interface TakeStudioVoiceProps {
  /** Guion del teleprompter (compartido con TakeStudio). */
  script: string;
}

const MODEL_LABELS: Record<string, string> = {
  eleven_multilingual_v2: "Multilingual v2 · calidad",
  eleven_flash_v2_5: "Flash v2.5 · rápido",
  eleven_turbo_v2_5: "Turbo v2.5 · intermedio",
};

export function TakeStudioVoice({ script }: TakeStudioVoiceProps) {
  const [status, setStatus] = useState<ElevenLabsKeyStatus | null>(null);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [model, setModel] = useState<string>(ELEVENLABS_TTS_MODELS[0]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState("voz_ia.mp3");
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await fetchElevenlabsStatus();
        if (!alive) return;
        setStatus(st);
        if (st.configured) {
          const list = await listElevenlabsVoices();
          if (!alive) return;
          setVoices(list);
          setVoiceId((cur) => (cur ? cur : list[0]?.id || ""));
        }
      } catch {
        if (alive) setStatus({ configured: false, last4: null, updatedAt: null });
      }
    })();
    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const generate = async () => {
    if (busy) return;
    const text = script.trim();
    if (!text) { setLocalError("Escribí el guion del teleprompter primero."); return; }
    if (!voiceId) { setLocalError("Elegí una voz."); return; }
    setBusy(true);
    setLocalError(null);
    setProgress("Generando audio…");
    try {
      const blob = await generateVoiceover(
        { text, voiceId, modelId: model },
        (done, total) => setProgress(total > 1 ? `Generando audio… parte ${done}/${total}` : "Generando audio…"),
      );
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setAudioUrl(url);
      setAudioName(`voz_ia_${new Date().toISOString().slice(0, 10)}.mp3`);
      setProgress("Listo — dale play para ensayar con el teleprompter.");
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo generar la locución.");
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.configured) {
    return (
      <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13, color: "#fff" }}>Voz IA</strong>
        <p className="vp-hint" style={{ margin: 0 }}>
          Conectá tu key de ElevenLabs en <strong>Ajustes → Integraciones</strong> para generar la voz del guion. Los créditos corren por tu cuenta.
        </p>
      </section>
    );
  }

  const chunkCount = script.trim() ? chunkScriptForTts(script).length : 0;

  return (
    <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 13, color: "#fff" }}>Voz IA del guion</strong>
        {status?.last4 && <span className="vp-hint" style={{ fontSize: 11 }}>key ····{status.last4}</span>}
      </div>
      <p className="vp-hint" style={{ margin: 0 }}>
        Genera la locución del guion del teleprompter para ensayar o grabar tu voz encima.
      </p>
      <label className="vp-field" style={{ marginBottom: 0 }}>
        <span>Voz</span>
        <select
          className="vp-input"
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          aria-label="Voz de ElevenLabs"
        >
          {voices.length === 0 && <option value="">{status ? "Cargando voces…" : "Sin conexión"}</option>}
          {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className="vp-field" style={{ marginBottom: 0 }}>
        <span>Modelo</span>
        <select className="vp-input" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Modelo de ElevenLabs">
          {ELEVENLABS_TTS_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="vp-btn vp-btn-primary"
        disabled={busy || !script.trim() || !voiceId}
        onClick={() => void generate()}
      >
        {busy ? (progress || "Generando…") : "Generar locución del guion"}
      </button>
      {chunkCount > 1 && <span className="vp-hint">El guion se envía en {chunkCount} partes (se concatenan solas).</span>}
      {audioUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <audio src={audioUrl} controls style={{ width: "100%" }} />
          <a className="vp-btn" href={audioUrl} download={audioName}>Descargar MP3</a>
        </div>
      )}
      {busy && progress && <p className="vp-hint" role="status">{progress}</p>}
      {localError && <p className="vp-hint vp-voice-error" role="alert">{localError}</p>}
    </section>
  );
}
