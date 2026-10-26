/**
 * AiClonesTab — REQ-059 (bloque D): videos con clon propio vía HeyGen (BYOK).
 *
 * Flujo pedido por Ren: tema → 3 guiones → elijo uno (editable) → un click
 * genera → reviso y descargo. Los guiones los escribe el LLM que el usuario ya
 * configuró (no HeyGen): así el texto es elegible/editable y los créditos de
 * HeyGen se gastan SOLO en el render.
 *
 * La clave vive en la BYOK del server (PUT /api/keys/heygen, AES-256-GCM);
 * jamás baja al navegador — todo lo de HeyGen pasa por /api/heygen/*.
 *
 * Honestidad de estado (decisión explícita): los jobs NO se persisten. Un
 * refresh pierde el progreso del poll, pero el video queda en la cuenta HeyGen
 * del usuario y "Refrescar videos" lo recupera de la lista. La UI lo dice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import { saveProviderKey, deleteProviderKey } from "../../lib/userKeys";
import {
  TAKE_FORMATS,
  countWords,
  estimateSpeechSeconds,
  formatElapsed,
  takeFormatById,
  type TakeFormatId,
} from "../../lib/takeRecorder";
import {
  fetchHeygenStatus,
  generateCloneVideo,
  generateScriptIdeas,
  listHeygenClones,
  listHeygenVideos,
  listHeygenVoices,
  pollHeygenVideo,
  sanitizeGeneratedScript,
  trainCloneFromTake,
  validateHeygenKey,
  type GeneratedScript,
  type HeygenAccountInfo,
  type HeygenAvatarLook,
  type HeygenVideoListItem,
  type HeygenVideoStatus,
  type HeygenVoice,
} from "../../lib/heygen";

interface AiClonesTabProps {
  workspaceId: string | null;
}

/** Toma del estudio, para elegir el footage que entrena el clon. */
interface TakeOption {
  id: string;
  createdAt: string;
  durationMs: number;
  sizeBytes: number;
  mime: string;
  state: string;
}

type JobPhase = "idle" | "submitting" | "processing" | "ready" | "failed" | "timeout";

function explainError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("HEYGEN_KEY_MISSING")) return "Guardá tu API key de HeyGen para usar los clones.";
  if (message.includes("HEYGEN_KEY_INVALID")) return "HeyGen rechazó la clave (401). Pegá una vigente.";
  if (message.includes("HEYGEN_NO_CREDITS")) return "Tu cuenta de HeyGen no tiene créditos disponibles para este video.";
  if (message.includes("HEYGEN_RATE_LIMITED")) return "HeyGen está limitando requests. Esperá un poco y reintentá.";
  // El proxy vive en el worker (/api/heygen); el server de desarrollo local no
  // lo monta, así que un 404 es "todavía no está en este entorno", no un fallo.
  if (message.includes("API error: 404") || message.includes("API error: 405")) {
    return "El proxy de HeyGen corre en el worker desplegado: en local todavía no atiende /api/heygen.";
  }
  if (message.includes("API error: 409")) return "El módulo de clones todavía no está desplegado en el server.";
  return message.replace(/^API error:\s*\d+\s*—\s*/, "");
}

export function AiClonesTab({ workspaceId }: AiClonesTabProps) {
  // ── Clave BYOK ──
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyLast4, setKeyLast4] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [account, setAccount] = useState<HeygenAccountInfo | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  // ── Catálogos ──
  const [clones, setClones] = useState<HeygenAvatarLook[]>([]);
  const [voices, setVoices] = useState<HeygenVoice[]>([]);
  const [videos, setVideos] = useState<HeygenVideoListItem[]>([]);
  const [takes, setTakes] = useState<TakeOption[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // ── Autor ──
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [targetSec, setTargetSec] = useState(45);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [authorBusy, setAuthorBusy] = useState(false);

  // ── Render ──
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [formatId, setFormatId] = useState<TakeFormatId>("vertical");
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [job, setJob] = useState<{ videoId: string | null; status: HeygenVideoStatus | null; attempts: number; timedOut: boolean }>({
    videoId: null, status: null, attempts: 0, timedOut: false,
  });

  // ── Entrenar clon ──
  const [trainTakeId, setTrainTakeId] = useState("");
  const [trainName, setTrainName] = useState("");
  const [trainBusy, setTrainBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadCatalogs = useCallback(async () => {
    if (!keyConfigured) return;
    setCatalogError(null);
    try {
      const [avatars, voiceList, videoList] = await Promise.all([
        listHeygenClones(),
        listHeygenVoices().catch(() => [] as HeygenVoice[]),
        listHeygenVideos().catch(() => [] as HeygenVideoListItem[]),
      ]);
      setClones(avatars);
      setVoices(voiceList);
      setVideos(videoList);
      // Un clon recién entrenado aparece con status 'processing': se refresca
      // solo una vez para no dejar la lista congelada sin acción del usuario.
      if (avatars.some(a => a.status && a.status !== "completed")) {
        setTimeout(() => {
          void listHeygenClones().then(setClones).catch(() => undefined);
        }, 20_000);
      }
    } catch (cause) {
      setCatalogError(explainError(cause));
    }
  }, [keyConfigured]);

  const loadTakes = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await apiFetch<{ takes: Array<{
        id: string; createdAt: string; durationMs: number; sizeBytes: number; mime: string; state: string;
      }> }>(`/api/video-takes?workspace_id=${encodeURIComponent(workspaceId)}`);
      setTakes((res.takes ?? []).map(t => ({
        id: t.id, createdAt: t.createdAt, durationMs: t.durationMs, sizeBytes: t.sizeBytes, mime: t.mime, state: t.state,
      })));
    } catch {
      setTakes([]); // sin módulo de tomas: el bloque de entrenamiento avisa solo
    }
  }, [workspaceId]);

  // Status de la BYOK: /api/keys es la fuente (nunca la clave, solo last4).
  useEffect(() => {
    let alive = true;
    void fetchHeygenStatus()
      .then(status => {
        if (!alive) return;
        setKeyConfigured(Boolean(status.configured));
        setKeyLast4(status.last4);
        setShowKeyForm(!status.configured);
      })
      .catch(cause => { if (alive) setError(explainError(cause)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { void loadCatalogs(); }, [loadCatalogs]);
  useEffect(() => { void loadTakes(); }, [loadTakes]);

  const readyClones = useMemo(() => clones.filter(c => c.ready), [clones]);
  const chosenFormat = useMemo(() => takeFormatById(formatId), [formatId]);
  const scriptWords = useMemo(() => countWords(scriptText), [scriptText]);
  const scriptSeconds = useMemo(() => estimateSpeechSeconds(scriptWords), [scriptWords]);

  // ── Acciones ──
  const saveKey = useCallback(async () => {
    const value = keyDraft.trim();
    if (!value) { setError("Pegá primero la API key de HeyGen (platform.heygen.com → API Keys)."); return; }
    setKeyBusy(true);
    setError(null);
    try {
      await saveProviderKey("heygen", value);
      setKeyDraft("");
      setShowKeyForm(false);
      setKeyConfigured(true);
      const info = await validateHeygenKey();
      setAccount(info);
      setNotice(`Clave guardada y validada. Plan: ${info.plan || "desconocido"} · créditos: ${info.remainingCredits ?? "sin dato"}. Los costos de render corren por tu cuenta de HeyGen.`);
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setKeyBusy(false);
    }
  }, [keyDraft]);

  const removeKey = useCallback(async () => {
    if (!window.confirm("¿Quitar la API key de HeyGen guardada en tu cuenta?")) return;
    setKeyBusy(true);
    try {
      await deleteProviderKey("heygen");
      setKeyConfigured(false);
      setKeyLast4(null);
      setAccount(null);
      setClones([]);
      setVideos([]);
      setShowKeyForm(true);
      setNotice("Clave eliminada del bóveda del server.");
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setKeyBusy(false);
    }
  }, []);

  const revalidate = useCallback(async () => {
    setKeyBusy(true);
    try {
      const info = await validateHeygenKey();
      setAccount(info);
      setNotice(`Clave vigente. Créditos restantes: ${info.remainingCredits ?? "sin dato"}.`);
      await loadCatalogs();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setKeyBusy(false);
    }
  }, [loadCatalogs]);

  const runScripts = useCallback(async () => {
    setAuthorBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateScriptIdeas({ topic, tone: tone || null, maxSeconds: targetSec });
      setScripts(result);
      const first = result[0];
      if (first) {
        setSelectedIdx(0);
        setScriptText(sanitizeGeneratedScript(first.text));
      }
      setNotice(`${result.length} guiones listos. Elegí uno o editá el texto antes de generar.`);
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setAuthorBusy(false);
    }
  }, [topic, tone, targetSec]);

  const pickScript = useCallback((index: number) => {
    const chosen = scripts[index];
    if (!chosen) return;
    setSelectedIdx(index);
    setScriptText(sanitizeGeneratedScript(chosen.text));
  }, [scripts]);

  const runGenerate = useCallback(async () => {
    const script = scriptText.trim();
    if (!avatarId) { setError("Elegí el clon que va a hablar."); return; }
    if (!script) { setError("No hay guion para locutar."); return; }
    setError(null);
    setNotice(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("submitting");
    try {
      const created = await generateCloneVideo({
        avatarId,
        script,
        formatId,
        voiceId: voiceId || null,
        title: topic.slice(0, 60) || "Clon Musa",
      });
      if (!created.videoId) throw new Error("HeyGen no devolvió video_id.");
      setJob({ videoId: created.videoId, status: null, attempts: 0, timedOut: false });
      setPhase("processing");
      const polled = await pollHeygenVideo({
        videoId: created.videoId,
        signal: controller.signal,
        onUpdate: status => setJob(prev => ({ ...prev, status, attempts: (prev.attempts || 0) + 1 })),
      });
      setJob(prev => ({ ...prev, status: polled.status, attempts: polled.attempts, timedOut: polled.timedOut }));
      if (polled.timedOut) setPhase("timeout");
      else if (polled.status.phase === "ready") setPhase("ready");
      else setPhase("failed");
      if (polled.status.phase === "ready") {
        await loadCatalogs();
        setNotice("Video listo. Descargalo: queda en tu cuenta de HeyGen, no en la biblioteca de tomas.");
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === "HEYGEN_POLL_ABORTED") {
        setPhase("idle");
        setNotice("Se dejó de seguir el video en esta pestaña. El render puede seguir en HeyGen: usá Refrescar videos.");
      } else {
        setPhase("failed");
        setError(explainError(cause));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [avatarId, formatId, loadCatalogs, scriptText, topic, voiceId]);

  const stopPolling = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
  }, []);

  const runTrain = useCallback(async () => {
    if (!trainTakeId) { setError("Elegí la toma que va a entrenar el clon."); return; }
    if (!trainName.trim()) { setError("Ponele un nombre al clon."); return; }
    setTrainBusy(true);
    setError(null);
    try {
      const result = await trainCloneFromTake({ takeId: trainTakeId, name: trainName.trim() });
      setNotice(`HeyGen entrenando "${trainName.trim()}"${result.status ? ` (${result.status})` : ""}. Tarda unos minutos: refrescá la lista de clones.`);
      setTrainName("");
      setTrainTakeId("");
      await loadCatalogs();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setTrainBusy(false);
    }
  }, [loadCatalogs, trainName, trainTakeId]);

  const downloadReady = useCallback(async () => {
    const url = job.status?.videoUrl;
    if (!url) return;
    // Se intenta por fetch (blob) para forzar el nombre del archivo; si el CDN
    // bloquea el cross-origin, se abre el enlace en una pestaña nueva.
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `musa-clon-${(job.videoId || "video").slice(0, 12)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      setNotice("El CDN de HeyGen no permite la descarga directa desde acá: se abrió el video en otra pestaña.");
    }
  }, [job.status, job.videoId]);

  const busy = phase === "submitting" || phase === "processing";

  return (
    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>AI Clones</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            Tema → guiones → tu clon locutando. Usa tu cuenta de HeyGen (BYOK): los créditos los consume HeyGen, no Musa.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="vp-btn" onClick={() => void loadCatalogs()} disabled={!keyConfigured}>Refrescar</button>
          <button type="button" className="vp-btn" onClick={() => void revalidate()} disabled={!keyConfigured || keyBusy}>Validar clave</button>
        </div>
      </header>

      {error && <div className="vp-error" role="alert">{error}</div>}
      {notice && <div className="vp-hint" style={{ color: "#9fe3b0" }}>{notice}</div>}
      {catalogError && <div className="vp-error" role="alert">{catalogError}</div>}

      {/* ── Clave BYOK ── */}
      <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, color: "#fff" }}>
            API key de HeyGen {keyConfigured && keyLast4 ? <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>terminada en {keyLast4}</span> : null}
          </strong>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            {keyConfigured ? "Guardada cifrada en el server; nunca baja al navegador." : "Se guarda cifrada (BYOK) en Ajustes > Invita IAs."}
          </span>
        </div>
        {account && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
            <span>Plan: <strong style={{ color: "#fff" }}>{account.plan || "sin dato"}</strong></span>
            <span>Créditos: <strong style={{ color: "#fff" }}>{account.remainingCredits ?? "sin dato"}</strong></span>
            {account.email && <span>Cuenta: <strong style={{ color: "#fff" }}>{account.email}</strong></span>}
          </div>
        )}
        {showKeyForm ? (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <input
              className="vp-input"
              type="password"
              autoComplete="off"
              placeholder="hg_xxxxxxxxxxxxxxxx"
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              style={{ flex: "1 1 260px" }}
            />
            <button type="button" className="vp-btn vp-btn-primary" onClick={() => void saveKey()} disabled={keyBusy}>
              {keyBusy ? "Guardando…" : "Guardar y validar"}
            </button>
            {keyConfigured && (
              <button type="button" className="vp-btn" onClick={() => setShowKeyForm(false)} disabled={keyBusy}>Cancelar</button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="vp-btn" onClick={() => setShowKeyForm(true)} disabled={keyBusy}>Reemplazar clave</button>
            <button type="button" className="vp-btn vp-btn-danger" onClick={() => void removeKey()} disabled={keyBusy}>Quitar clave</button>
          </div>
        )}
      </section>

      {keyConfigured && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)", gap: 14, alignItems: "start" }}>
          {/* ── Columna autor + render ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <strong style={{ fontSize: 14, color: "#fff" }}>1 · Tema del video</strong>
              <textarea
                className="vp-input"
                rows={2}
                placeholder="Ej: presentación del nuevo plan de Futuraria para clientes que aún no lo conocen"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label className="vp-field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
                  <span>Tono (opcional)</span>
                  <input className="vp-input" placeholder="cercano, sin tecnicismos" value={tone} onChange={e => setTone(e.target.value)} />
                </label>
                <label className="vp-field" style={{ minWidth: 160, marginBottom: 0 }}>
                  <span>Duración objetivo</span>
                  <select className="vp-input" value={targetSec} onChange={e => setTargetSec(Number(e.target.value))}>
                    <option value={20}>20 segundos</option>
                    <option value={30}>30 segundos</option>
                    <option value={45}>45 segundos</option>
                    <option value={60}>60 segundos</option>
                    <option value={90}>90 segundos</option>
                  </select>
                </label>
                <button type="button" className="vp-btn vp-btn-primary" onClick={() => void runScripts()} disabled={authorBusy || !topic.trim()}>
                  {authorBusy ? "Escribiendo…" : "Generar 3 guiones"}
                </button>
              </div>
            </section>

            <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <strong style={{ fontSize: 14, color: "#fff" }}>2 · Elegí y ajustá el guion</strong>
              {scripts.length === 0 ? (
                <p className="vp-hint" style={{ margin: 0 }}>Todavía no hay guiones. Generá primero: se escriben con tu IA configurada, no con HeyGen.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {scripts.map((s, i) => (
                    <button
                      key={`${s.title}-${i}`}
                      type="button"
                      className={selectedIdx === i ? "vp-btn vp-btn-active" : "vp-btn"}
                      style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", padding: "8px 10px" }}
                      onClick={() => pickScript(i)}
                    >
                      <span>
                        <strong style={{ color: "#fff" }}>{s.title}</strong>{" "}
                        <span style={{ color: "rgba(255,255,255,0.55)" }}>· {s.words} palabras ≈ {formatElapsed(s.estSeconds * 1000)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="vp-input"
                rows={6}
                placeholder="El texto que va a locutar el clon. Editá libremente."
                value={scriptText}
                onChange={e => setScriptText(e.target.value)}
              />
              <div className="vp-hint" style={{ fontSize: 12 }}>
                {scriptWords} palabras ≈ {formatElapsed(scriptSeconds * 1000)} leído en voz alta (~150 ppm)
              </div>
            </section>

            <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <strong style={{ fontSize: 14, color: "#fff" }}>3 · Clon, voz y formato</strong>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label className="vp-field" style={{ flex: "1 1 220px", marginBottom: 0 }}>
                  <span>Clon</span>
                  <select className="vp-input" value={avatarId} onChange={e => setAvatarId(e.target.value)}>
                    <option value="">Elegí un clon listo</option>
                    {readyClones.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="vp-field" style={{ flex: "1 1 200px", marginBottom: 0 }}>
                  <span>Voz</span>
                  <select className="vp-input" value={voiceId} onChange={e => setVoiceId(e.target.value)}>
                    <option value="">Voz del clon (default)</option>
                    {voices.slice(0, 120).map(v => <option key={v.voiceId} value={v.voiceId}>{v.name}{v.language ? ` · ${v.language}` : ""}</option>)}
                  </select>
                </label>
                <label className="vp-field" style={{ flex: "1 1 200px", marginBottom: 0 }}>
                  <span>Formato</span>
                  <select className="vp-input" value={formatId} onChange={e => setFormatId(e.target.value as TakeFormatId)}>
                    {TAKE_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="vp-btn vp-btn-primary"
                  onClick={() => void runGenerate()}
                  disabled={busy || !scriptText.trim() || !avatarId}
                >
                  Generar video con el clon
                </button>
                {busy && <button type="button" className="vp-btn" onClick={stopPolling}>Dejar de seguir</button>}
                <span className="vp-hint" style={{ fontSize: 12 }}>
                  Salida {chosenFormat.width}×{chosenFormat.height} · HeyGen cobra el render a tu cuenta
                </span>
              </div>

              {phase !== "idle" && phase !== "submitting" && (
                <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "rgba(255,255,255,0.75)" }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 9, height: 9, borderRadius: 999, display: "inline-block",
                        background: phase === "ready" ? "#4ade80" : phase === "failed" ? "#ef4444" : "#f5b942",
                      }}
                    />
                    <strong style={{ color: "#fff" }}>
                      {phase === "ready" ? "Listo" : phase === "failed" ? "Falló el render" : phase === "timeout" ? "Sigue procesando en HeyGen" : "Procesando"}
                    </strong>
                    <span>· {job.attempts} sondeos · {job.status?.rawStatus || "sin status"}</span>
                  </div>
                  {phase === "processing" && job.status?.progressPct != null && (
                    <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)" }}>
                      <div style={{ width: `${Math.min(100, Math.max(0, job.status.progressPct))}%`, height: "100%", borderRadius: 999, background: "#4f8cff" }} />
                    </div>
                  )}
                  {job.status?.errorMessage && <div className="vp-error">{job.status.errorMessage}</div>}
                  {phase === "timeout" && (
                    <p className="vp-hint" style={{ margin: 0, fontSize: 12 }}>
                      Esperamos 10 minutos y HeyGen no confirmó. El video está en tu cuenta: Refrescar lo trae.
                    </p>
                  )}
                  {phase === "ready" && job.status?.videoUrl && (
                    <>
                      <video
                        src={job.status.videoUrl}
                        controls
                        playsInline
                        style={{ width: "100%", maxHeight: 360, borderRadius: 10, background: "#000", aspectRatio: `${chosenFormat.width} / ${chosenFormat.height}` }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="vp-btn vp-btn-primary" onClick={() => void downloadReady()}>Descargar</button>
                        <a
                          className="vp-btn"
                          href={job.status.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          Abrir enlace
                        </a>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ── Columna clones + biblioteca HeyGen ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14, color: "#fff" }}>Tus clones ({clones.length})</strong>
                <button type="button" className="vp-icon-btn" onClick={() => void loadCatalogs()} title="Refrescar clones" aria-label="Refrescar clones">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
                  </svg>
                </button>
              </div>
              {clones.length === 0 ? (
                <p className="vp-hint" style={{ margin: "10px 0 0", fontSize: 12 }}>
                    Todavía no hay clones en tu cuenta HeyGen. Entrená uno desde una toma o crealo en platform.heygen.com.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                  {clones.map(c => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {c.previewImageUrl ? (
                        <img
                          src={c.previewImageUrl}
                          alt=""
                          style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(255,255,255,0.10)", flexShrink: 0 }}
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", flexShrink: 0 }}
                        />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>{c.avatarType || "avatar"}{c.id ? ` · ${c.id}` : ""}</div>
                      </div>
                      {!c.ready && (
                        <span style={{ fontSize: 11, color: "#f6d99a", border: "1px solid rgba(245,185,66,0.4)", borderRadius: 999, padding: "1px 8px" }}>
                          entrenando
                        </span>
                      )}
                      <button
                        type="button"
                        className={avatarId === c.id ? "vp-btn vp-btn-active" : "vp-btn"}
                        onClick={() => setAvatarId(c.id)}
                        disabled={!c.ready}
                      >
                        {avatarId === c.id ? "Elegido" : "Usar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <strong style={{ fontSize: 14, color: "#fff" }}>Entrenar un clon desde una toma</strong>
              <p className="vp-hint" style={{ margin: 0, fontSize: 12 }}>
                HeyGen necesita descargar el video: el server firma un enlace de tu toma con validez de 1 hora. Usá una toma de frente, buena luz y 15-60 s hablando.
              </p>
              <label className="vp-field" style={{ marginBottom: 0 }}>
                <span>Toma del estudio</span>
                <select className="vp-input" value={trainTakeId} onChange={e => setTrainTakeId(e.target.value)}>
                  <option value="">{takes.length ? "Elegí una toma" : "No hay tomas guardadas"}</option>
                  {takes.map(t => (
                    <option key={t.id} value={t.id}>
                      {new Date(t.createdAt).toLocaleString("es-AR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {formatElapsed(t.durationMs)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vp-field" style={{ marginBottom: 0 }}>
                <span>Nombre del clon</span>
                <input className="vp-input" placeholder="Ren · gemelo estudio" value={trainName} onChange={e => setTrainName(e.target.value)} />
              </label>
              <button
                type="button"
                className="vp-btn vp-btn-primary"
                onClick={() => void runTrain()}
                disabled={trainBusy || !trainTakeId || !trainName.trim() || takes.length === 0}
              >
                {trainBusy ? "Enviando…" : "Entrenar clon"}
              </button>
            </section>

            <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14, color: "#fff" }}>Videos en HeyGen ({videos.length})</strong>
                <button
                  type="button"
                  className="vp-icon-btn"
                  onClick={() => void listHeygenVideos().then(setVideos).catch(cause => setError(explainError(cause)))}
                  title="Refrescar videos"
                  aria-label="Refrescar videos"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
                  </svg>
                </button>
              </div>
              {videos.length === 0 ? (
                <p className="vp-hint" style={{ margin: "10px 0 0", fontSize: 12 }}>Aún no generaste videos con el clon.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                  {videos.slice(0, 12).map(v => (
                    <div key={v.videoId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
                        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
                          {v.phase === "ready" ? "listo" : v.phase === "failed" ? "falló" : v.phase === "queued" ? "en cola" : "procesando"}
                          {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleDateString("es-AR")}` : ""}
                        </div>
                      </div>
                      {v.videoUrl && (
                        <a className="vp-btn" href={v.videoUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>Ver</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
