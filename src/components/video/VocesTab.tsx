/**
 * VocesTab — REQ-071: voces GRATIS (stock Workers AI de la plataforma) dentro
 * del tab Voz del editor de video. Fuente del render freemium: $0 para el
 * usuario, cuota diaria de chars, sin key.
 *
 *   [Stock]  catálogo aura-2 es/en → preview real → guion → Generar
 *   [Mis voces]  librería musa_voces (favoritos + clones)
 *   [Crear voz]  grabar mic / subir clip → clonar (ElevenLabs BYOK si hay
 *                key; propio queda en lista de espera hasta el backend)
 *
 * El pipeline de colocación es el MISMO de VoiceTab (decode → uploadReelAudio
 * → track audio → material → segmento en el playhead) — reutiliza los helpers
 * de serverMaterials para que la locución caiga igual en el timeline.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  blobToWavBase64,
  clonarVoz,
  decodeAudioDuration,
  fetchMisVoces,
  fetchStockCatalogo,
  sintetizarVoz,
  type VozMia,
  type VozStockCatalogo,
} from "../../lib/musaVoz";
import { uploadReelAudio } from "../../lib/reelUpload";
import { createMaterial, ensureTrack, placeSegment } from "./serverMaterials";
import type { VideoApplyMeta, VideoProjectDoc } from "../../lib/videoProjectStore";

interface VocesTabProps {
  doc: VideoProjectDoc;
  playheadUs: number;
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onError: (msg: string) => void;
  /** ¿Tiene el usuario key de ElevenLabs configurada? (decide el camino de clonar) */
  elevenlabsConfigured: boolean;
  onAskElevenlabs: () => void;
}

type Origen = "stock" | "mias" | "crear";

const PREVIEW_PHRASES: Record<string, string> = {
  es: "Hola, así suena mi voz para tus videos.",
  en: "Hi, this is how my voice sounds in your videos.",
};

export function VocesTab({
  doc, playheadUs, onServerDocChange, onError, elevenlabsConfigured, onAskElevenlabs,
}: VocesTabProps) {
  const [catalogo, setCatalogo] = useState<VozStockCatalogo | null>(null);
  const [idioma, setIdioma] = useState<"es" | "en">("es");
  const [speaker, setSpeaker] = useState("");
  const [origen, setOrigen] = useState<Origen>("stock");
  const [mias, setMias] = useState<VozMia[]>([]);
  const [miasEstado, setMiasEstado] = useState<"cargando" | "ok" | "pendiente" | "error">("cargando");
  const [vozMiaId, setVozMiaId] = useState("");
  const [guion, setGuion] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [cuota, setCuota] = useState<{ usado: number; limite: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // crear voz
  const [clonNombre, setClonNombre] = useState("");
  const [clonBlob, setClonBlob] = useState<Blob | null>(null);
  const [clonUrl, setClonUrl] = useState("");
  const [grabando, setGrabando] = useState(false);
  const [clonBusy, setClonBusy] = useState(false);
  const [clonMsg, setClonMsg] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const grupo = useMemo(
    () => catalogo?.stock.find((g) => g.idioma === idioma) || null,
    [catalogo, idioma],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cat = await fetchStockCatalogo();
        if (!alive) return;
        setCatalogo(cat);
        setSpeaker((cur) => cur || cat.stock.find((g) => g.idioma === "es")?.speakers[0]?.id || "");
      } catch (cause) {
        if (alive) onError(cause instanceof Error ? cause.message : "No se pudo cargar el catálogo de voces.");
      }
    })();
    return () => { alive = false; previewRef.current?.pause(); };
  }, [onError]);

  const recargarMias = async () => {
    setMiasEstado("cargando");
    const res = await fetchMisVoces();
    if (res.ok) {
      setMias(res.mias);
      setMiasEstado("ok");
      setVozMiaId((cur) => cur || res.mias[0]?.id || "");
    } else {
      setMiasEstado(res.code === "MIGRATION_PENDING" ? "pendiente" : "error");
    }
  };

  useEffect(() => { if (origen === "mias" && miasEstado === "cargando") void recargarMias(); }, [origen]); // eslint-disable-line react-hooks/exhaustive-deps

  const speakerActual = grupo?.speakers.find((s) => s.id === speaker);

  const previewStock = async () => {
    if (!grupo || !speakerActual) return;
    previewRef.current?.pause();
    setBusy(true);
    setProgress("Preparando preview…");
    try {
      const { blob, quota } = await sintetizarVoz({
        speaker: speakerActual.id, idioma: grupo.idioma,
        texto: PREVIEW_PHRASES[grupo.idioma] || PREVIEW_PHRASES.es,
      });
      setCuota(quota);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewRef.current = audio;
      void audio.play().catch(() => { /* autoplay bloqueado */ });
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo reproducir el preview.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const generar = async () => {
    if (busy) return;
    const texto = guion.trim();
    if (!texto) { setLocalError("Escribe el guion de la locución."); return; }
    setBusy(true);
    setLocalError(null);
    setProgress("Generando audio…");
    try {
      const body = origen === "mias"
        ? { vozId: vozMiaId, texto }
        : { speaker, idioma, texto };
      const { blob, quota, voz } = await sintetizarVoz(body);
      setCuota(quota);
      setProgress("Subiendo al proyecto…");
      const durationSec = await decodeAudioDuration(blob);
      const ext = blob.type.includes("wav") ? "wav" : "mp3";
      const file = new File([blob], `voz_${voz.nombre || "musa"}_${Date.now()}.${ext}`, { type: blob.type || "audio/mpeg" });
      const url = await uploadReelAudio(doc.project.workspace_id, file);
      let working = doc;
      const trackRes = await ensureTrack(working, onServerDocChange, onError, "audio");
      if (!trackRes) return;
      working = trackRes.doc;
      const materialRes = await createMaterial(
        working, onServerDocChange, onError,
        "audio",
        { url, durationUs: Math.round(durationSec * 1_000_000), name: `Voz · ${voz.nombre}` },
        "agregar locución",
      );
      if (!materialRes) return;
      working = materialRes.doc;
      const trackEnd = trackRes.track.segments.reduce((max, s) => Math.max(max, s.target_start_us + s.target_dur_us), 0);
      const startUs = playheadUs > 0 ? playheadUs : trackEnd;
      await placeSegment(
        working, onServerDocChange, onError,
        { trackId: trackRes.track.id, material: materialRes.material, startUs, durUs: Math.round(durationSec * 1_000_000) },
        "colocar locución",
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

  // ── Crear voz: grabar / subir ──
  const empezarGrabacion = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setClonBlob(blob);
        setClonUrl(URL.createObjectURL(blob));
      };
      rec.start();
      recorderRef.current = rec;
      setGrabando(true);
    } catch {
      setLocalError("No se pudo acceder al micrófono.");
    }
  };
  const pararGrabacion = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setGrabando(false);
  };

  const clonar = async () => {
    if (clonBusy) return;
    if (!clonNombre.trim()) { setLocalError("Ponle un nombre a la voz."); return; }
    if (!clonBlob) { setLocalError("Graba o sube un clip de tu voz (10-30 segundos)."); return; }
    setClonBusy(true);
    setClonMsg(null);
    setLocalError(null);
    try {
      const { b64, mimeType } = await blobToWavBase64(clonBlob);
      const proveedor = elevenlabsConfigured ? "elevenlabs" : "workers-ai";
      const res = await clonarVoz({ nombre: clonNombre.trim(), audioBase64: b64, mimeType, idioma, proveedor });
      if (proveedor === "workers-ai") {
        setClonMsg("Voz registrada. Los clones propios se activan cuando el backend de Musa esté listo; por ahora usa una voz stock o conecta ElevenLabs.");
      } else {
        setClonMsg(`Voz "${res.voz.nombre}" creada en tu cuenta de ElevenLabs y guardada en Mis voces.`);
        void recargarMias();
      }
      setClonBlob(null);
      setClonUrl("");
      setClonNombre("");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "No se pudo crear la voz.";
      if (/ELEVENLABS_KEY_MISSING/i.test(msg)) {
        onAskElevenlabs();
      } else {
        setLocalError(msg);
      }
    } finally {
      setClonBusy(false);
    }
  };

  const chars = guion.trim().length;

  return (
    <div className="vp-voice vp-voz">
      <div className="vp-voz-src" role="tablist" aria-label="Fuente de voz">
        {(["stock", "mias", "crear"] as Origen[]).map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={origen === o}
            className={origen === o ? "vp-voz-src-btn vp-voz-src-btn-active" : "vp-voz-src-btn"}
            onClick={() => setOrigen(o)}
          >
            {o === "stock" ? "Gratis" : o === "mias" ? "Mis voces" : "Crear voz"}
          </button>
        ))}
      </div>
      <p className="vp-hint">Voces gratis de Musa · {cuota ? `${cuota.usado.toLocaleString("es-PE")} / ${cuota.limite.toLocaleString("es-PE")} caracteres hoy` : `${catalogo?.cuota.charsDia.toLocaleString("es-PE") ?? "10.000"} caracteres al día`}</p>

      {origen === "stock" && (
        <div className="vp-bin-form">
          <div className="vp-voz-chips" role="group" aria-label="Idioma">
            {(["es", "en"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={idioma === id ? "vp-voz-chip vp-voz-chip-active" : "vp-voz-chip"}
                onClick={() => {
                  setIdioma(id);
                  const g = catalogo?.stock.find((x) => x.idioma === id);
                  setSpeaker(g?.speakers[0]?.id || "");
                }}
              >
                {id === "es" ? "Español" : "English"}
              </button>
            ))}
          </div>
          <label className="vp-field-label" htmlFor="vp-voz-speaker">Voz</label>
          <select
            id="vp-voz-speaker"
            className="vp-input"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
          >
            {(grupo?.speakers || []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre} — {s.rasgo}</option>
            ))}
          </select>
          <button type="button" className="vp-btn" disabled={busy} onClick={() => void previewStock()}>
            Escuchar esta voz
          </button>
        </div>
      )}

      {origen === "mias" && (
        <div className="vp-bin-form">
          {miasEstado === "pendiente" && (
            <p className="vp-hint">La librería de voces se está activando en este entorno. Mientras tanto puedes usar las voces gratis.</p>
          )}
          {miasEstado === "error" && (
            <p className="vp-hint vp-voice-error">No se pudo cargar tu librería. Vuelve a intentar.</p>
          )}
          {miasEstado === "ok" && mias.length === 0 && (
            <p className="vp-hint">Todavía no tienes voces guardadas. Crea una desde la pestaña «Crear voz».</p>
          )}
          {miasEstado === "ok" && mias.length > 0 && (
            <>
              <label className="vp-field-label" htmlFor="vp-voz-mia">Tu voz</label>
              <select
                id="vp-voz-mia"
                className="vp-input"
                value={vozMiaId}
                onChange={(e) => setVozMiaId(e.target.value)}
              >
                {mias.map((v) => (
                  <option key={v.id} value={v.id}>{v.nombre} · {v.proveedor === "elevenlabs" ? "ElevenLabs" : v.proveedor === "workers-ai" ? "Musa" : v.proveedor}</option>
                ))}
              </select>
              <button type="button" className="vp-btn" onClick={() => void recargarMias()}>Recargar</button>
            </>
          )}
        </div>
      )}

      {origen === "crear" && (
        <div className="vp-bin-form vp-voz-clon">
          <label className="vp-field-label" htmlFor="vp-voz-clon-nombre">Nombre de la voz</label>
          <input
            id="vp-voz-clon-nombre"
            className="vp-input"
            placeholder="Mi voz, Narrador…"
            value={clonNombre}
            onChange={(e) => setClonNombre(e.target.value)}
          />
          <div className="vp-voz-rec">
            {!grabando ? (
              <button type="button" className="vp-btn" onClick={() => void empezarGrabacion()}>Grabar con el micrófono</button>
            ) : (
              <button type="button" className="vp-btn vp-voz-rec-activo" onClick={pararGrabacion}>
                <span className="vp-voz-rec-dot" aria-hidden="true" /> Grabando… parar
              </button>
            )}
            <label className="vp-btn vp-voz-subir">
              Subir archivo
              <input
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setClonBlob(f); setClonUrl(URL.createObjectURL(f)); }
                }}
              />
            </label>
          </div>
          {clonUrl && (
            <>
              <audio controls src={clonUrl} className="vp-voz-audio" />
              <p className="vp-hint">Clip listo. 10-30 segundos con voz clara dan el mejor resultado.</p>
            </>
          )}
          <p className="vp-hint">
            {elevenlabsConfigured
              ? "Se creará con tu cuenta de ElevenLabs (Configuración › Integraciones)."
              : "Quedará en lista de espera hasta que Musa active sus clones propios; o conecta ElevenLabs para crearla ahora."}
          </p>
          <button type="button" className="vp-btn vp-btn-primary" disabled={clonBusy} onClick={() => void clonar()}>
            {clonBusy ? "Creando voz…" : "Crear voz"}
          </button>
          {clonMsg && <p className="vp-hint" role="status">{clonMsg}</p>}
        </div>
      )}

      {origen !== "crear" && (
        <div className="vp-bin-form">
          <label className="vp-field-label" htmlFor="vp-voz-guion">Guion</label>
          <textarea
            id="vp-voz-guion"
            className="vp-input"
            rows={6}
            placeholder="Texto que dirá la voz…"
            value={guion}
            onChange={(e) => setGuion(e.target.value)}
          />
          <span className="vp-hint">{chars} caracteres</span>
          <button
            type="button"
            className="vp-btn vp-btn-primary"
            disabled={busy || !chars || (origen === "mias" && !vozMiaId)}
            onClick={() => void generar()}
          >
            {busy ? (progress || "Generando…") : "Generar locución"}
          </button>
          {busy && progress && <p className="vp-hint" role="status">{progress}</p>}
          <p className="vp-hint">La locución se coloca en el playhead del track de audio{playheadUs > 0 ? " (posición actual)" : " (al final: el playhead está en 0)"}.</p>
        </div>
      )}

      {localError && <p className="vp-hint vp-voice-error" role="alert">{localError}</p>}
    </div>
  );
}

// v2
