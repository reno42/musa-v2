/**
 * VideoProjectsTab — lista de proyectos de video (REQ-VID11), tab "Video" del
 * dashboard. Crear (con tracks base CapCut: video z0 / audio z1 / texto z2),
 * abrir (navega a #video/<projectId> vía onOpenProject) y borrar.
 * VID13: las cards marcadas is_template exponen "Usar plantilla" — dialog
 * con un campo por slot (key/label/kind) que instancia vía
 * POST /:templateId/instantiate { name, slots: { key: {kind, payload} } } y
 * abre el proyecto clonado.
 * MCP-first no aplica acá: la UI habla REST directo, igual que el editor.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import type { VideoProjectDoc } from "../../lib/videoProjectStore";
import { TakeStudio } from "./TakeStudio";
import { AiClonesTab } from "./AiClonesTab";

interface VideoProjectRowLite {
  id: string;
  name: string;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  ratio: string;
  is_template: boolean;
  updated_at?: string;
}

interface VideoProjectsTabProps {
  workspaceId: string | null;
  pane: string;
  onOpenProject: (projectId: string) => void;
}

const RATIO_PRESETS = [
  { ratio: "16:9", w: 1920, h: 1080, label: "Horizontal 16:9" },
  { ratio: "9:16", w: 1080, h: 1920, label: "Vertical 9:16" },
  { ratio: "1:1", w: 1080, h: 1080, label: "Cuadrado 1:1" },
] as const;

interface TemplateSlotDef { key: string; label: string; kind: string; }
interface SlotDraft { text: string; url: string; dur: string; }

/**
 * REQ-058 — routing de pane: "takes" monta el estudio de grabación; el resto,
 * la lista de proyectos. REQ-059 suma "clones" (AI Clones con HeyGen BYOK).
 * El wrapper va ANTES de los hooks (rules of hooks:
 * no puede haber return temprano dentro del componente con hooks).
 */
export function VideoProjectsTab(props: VideoProjectsTabProps) {
  if (props.pane === "takes") return <TakeStudio workspaceId={props.workspaceId} />;
  if (props.pane === "clones") return <AiClonesTab workspaceId={props.workspaceId} />;
  return <VideoProjectsPane {...props} />;
}

function VideoProjectsPane({ workspaceId, pane, onOpenProject }: VideoProjectsTabProps) {
  const [projects, setProjects] = useState<VideoProjectRowLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("Video sin título");
  const [presetIdx, setPresetIdx] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  // VID13: dialog de instanciación de plantillas.
  const [instantiating, setInstantiating] = useState<VideoProjectRowLite | null>(null);
  const [tplName, setTplName] = useState("");
  const [slotDefs, setSlotDefs] = useState<TemplateSlotDef[]>([]);
  const [slotDrafts, setSlotDrafts] = useState<Record<string, SlotDraft>>({});
  const [instBusy, setInstBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: { projects: VideoProjectRowLite[] } }>(
        `/api/video-projects?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setProjects(res?.data?.projects ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la lista de proyectos.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const createProject = async () => {
    if (!workspaceId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const preset = RATIO_PRESETS[presetIdx];
      const res = await apiFetch<{ data: { project: { id: string } } }>("/api/video-projects", {
        method: "POST",
        body: JSON.stringify({
          workspaceId,
          name: name.trim() || "Video sin título",
          fps: 30,
          canvasW: preset.w,
          canvasH: preset.h,
          ratio: preset.ratio,
        }),
      });
      const projectId = res?.data?.project?.id;
      if (!projectId) throw new Error("La respuesta no incluyó el proyecto creado.");
      // Tracks base CapCut: video abajo (z0), audio (z1), texto arriba (z2).
      // Best-effort: si falla alguno, el proyecto abre igual (se agregan
      // tracks desde el editor).
      for (const t of [{ type: "video", zOrder: 0 }, { type: "audio", zOrder: 1 }, { type: "text", zOrder: 2 }]) {
        try {
          await apiFetch(`/api/video-projects/${encodeURIComponent(projectId)}/tracks`, {
            method: "POST",
            body: JSON.stringify(t),
          });
        } catch { /* track faltante no bloquea la apertura */ }
      }
      setShowCreate(false);
      onOpenProject(projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el proyecto.");
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (busyId) return;
    if (!window.confirm("¿Borrar este proyecto de video? No se puede deshacer.")) return;
    setBusyId(projectId);
    setError(null);
    try {
      await apiFetch(`/api/video-projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo borrar el proyecto.");
    } finally {
      setBusyId(null);
    }
  };

  /** Abre el dialog leyendo los slots reales de la plantilla (materiales con
   *  slot {key,label}). Si no tiene slots, no se puede instanciar. */
  const openInstantiate = async (p: VideoProjectRowLite) => {
    setError(null);
    try {
      const res = await apiFetch<{ data: VideoProjectDoc }>(`/api/video-projects/${encodeURIComponent(p.id)}`);
      const tree = res?.data;
      if (!tree?.project?.id) throw new Error("No se pudo leer la plantilla.");
      const slots: TemplateSlotDef[] = (tree.materials ?? [])
        .filter((m) => m.slot && typeof (m.slot as { key?: unknown }).key === "string")
        .map((m) => {
          const marker = m.slot as { key: string; label?: unknown };
          return { key: marker.key, label: typeof marker.label === "string" && marker.label ? marker.label : marker.key, kind: m.kind };
        });
      if (slots.length === 0) throw new Error("La plantilla no tiene slots registrados (video_template_register primero).");
      const drafts: Record<string, SlotDraft> = {};
      for (const s of slots) drafts[s.key] = { text: "", url: "", dur: "" };
      setSlotDefs(slots);
      setSlotDrafts(drafts);
      setTplName("");
      setInstantiating(p);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la plantilla.");
    }
  };

  /** VID13: POST /instantiate — el server clona el árbol y rellena cada slot
   *  con {kind, payload}; target se mantiene y se clampea al nuevo source. */
  const submitInstantiate = async () => {
    if (!instantiating || instBusy) return;
    setInstBusy(true);
    setError(null);
    try {
      const slots: Record<string, { kind: string; payload: Record<string, unknown> }> = {};
      for (const s of slotDefs) {
        const d = slotDrafts[s.key];
        if (!d) throw new Error(`Falta completar el slot ${s.key}.`);
        if (s.kind === "text") {
          if (!d.text.trim()) throw new Error(`Slot "${s.label}": escribí el texto.`);
          slots[s.key] = { kind: "text", payload: { text: d.text } };
        } else {
          if (!d.url.trim()) throw new Error(`Slot "${s.label}": pegá la URL del ${s.kind === "audio" ? "audio" : "video"}.`);
          const payload: Record<string, unknown> = { url: d.url.trim() };
          const secs = Number(d.dur.replace(",", "."));
          if (d.dur.trim() && Number.isFinite(secs) && secs > 0) payload.durationUs = Math.round(secs * 1_000_000); // µs SIEMPRE
          slots[s.key] = { kind: s.kind, payload };
        }
      }
      const res = await apiFetch<{ data: { project: { id: string } } }>(
        `/api/video-projects/${encodeURIComponent(instantiating.id)}/instantiate`,
        { method: "POST", body: JSON.stringify({ name: tplName.trim() || undefined, slots }) },
      );
      const newId = res?.data?.project?.id;
      if (!newId) throw new Error("La respuesta no incluyó el proyecto instanciado.");
      setInstantiating(null);
      onOpenProject(newId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo instanciar la plantilla.");
    } finally {
      setInstBusy(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>Video</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            Proyectos de video con timeline drag &amp; drop (modelo CapCut).
          </p>
        </div>
        <button
          type="button"
          className="vp-btn vp-btn-primary"
          onClick={() => setShowCreate(true)}
          disabled={!workspaceId}
        >
          Nuevo proyecto
        </button>
      </header>

      {error && <div className="vp-error" role="alert">{error}</div>}

      {loading ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: 24 }}>Cargando proyectos…</div>
      ) : projects.length === 0 ? (
        <div className="vp-empty">
          <p style={{ margin: 0, fontWeight: 600 }}>Todavía no hay proyectos de video</p>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.55)" }}>
            Creá el primero con {RATIO_PRESETS[0].label.toLowerCase()} u otro formato.
          </p>
        </div>
      ) : (
        <div className="vp-project-grid">
          {projects.map((p) => (
            <div key={p.id} className="vp-project-card">
              {p.is_template && <span className="vp-template-badge" aria-hidden="true">Plantilla</span>}
              <button
                type="button"
                className="vp-project-open"
                onClick={() => onOpenProject(p.id)}
                title={`Abrir ${p.name}`}
              >
                <span
                  className="vp-project-thumb"
                  style={{ aspectRatio: `${p.canvas_w} / ${p.canvas_h}` }}
                  aria-hidden="true"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M10 9.5l5 2.5-5 2.5z" />
                  </svg>
                </span>
                <span className="vp-project-meta">
                  <strong>{p.name}</strong>
                  <span>{p.ratio} · {p.canvas_w}×{p.canvas_h} · {p.fps} fps</span>
                </span>
              </button>
              <button
                type="button"
                className="vp-icon-btn vp-project-delete"
                onClick={() => void deleteProject(p.id)}
                disabled={busyId === p.id}
                title="Borrar proyecto"
                aria-label={`Borrar ${p.name}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" />
                </svg>
              </button>
              {p.is_template && (
                <button
                  type="button"
                  className="vp-template-use"
                  onClick={() => void openInstantiate(p)}
                  disabled={busyId === p.id}
                >
                  Usar plantilla
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="vp-overlay" role="dialog" aria-modal="true" aria-label="Nuevo proyecto de video">
          <div className="vp-modal">
            <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Nuevo proyecto de video</h2>
            <label className="vp-field">
              <span>Nombre</span>
              <input
                className="vp-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </label>
            <div className="vp-field">
              <span>Formato</span>
              <div style={{ display: "flex", gap: 8 }}>
                {RATIO_PRESETS.map((p, i) => (
                  <button
                    key={p.ratio}
                    type="button"
                    className={i === presetIdx ? "vp-chip vp-chip-active" : "vp-chip"}
                    onClick={() => setPresetIdx(i)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button type="button" className="vp-btn" onClick={() => setShowCreate(false)}>Cancelar</button>
              <button type="button" className="vp-btn vp-btn-primary" onClick={() => void createProject()} disabled={creating}>
                {creating ? "Creando…" : "Crear y abrir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {instantiating && (
        <div className="vp-overlay" role="dialog" aria-modal="true" aria-label="Usar plantilla">
          <div className="vp-modal">
            <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Usar plantilla: {instantiating.name}</h2>
            <label className="vp-field">
              <span>Nombre del nuevo proyecto</span>
              <input
                className="vp-input"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                maxLength={120}
                placeholder={`${instantiating.name} — copia`}
                autoFocus
              />
            </label>
            {slotDefs.map((s) => (
              <div key={s.key} className="vp-field">
                <span>{s.label} <em className="vp-slot-kind">{s.kind}</em></span>
                {s.kind === "text" ? (
                  <textarea
                    className="vp-input"
                    rows={2}
                    placeholder="Contenido del texto…"
                    value={slotDrafts[s.key]?.text ?? ""}
                    onChange={(e) => setSlotDrafts((prev) => ({ ...prev, [s.key]: { ...prev[s.key], text: e.target.value } }))}
                  />
                ) : (
                  <>
                    <input
                      className="vp-input"
                      inputMode="url"
                      placeholder="https://…"
                      value={slotDrafts[s.key]?.url ?? ""}
                      onChange={(e) => setSlotDrafts((prev) => ({ ...prev, [s.key]: { ...prev[s.key], url: e.target.value } }))}
                    />
                    <input
                      className="vp-input"
                      inputMode="decimal"
                      placeholder="Duración en segundos (opcional)"
                      value={slotDrafts[s.key]?.dur ?? ""}
                      onChange={(e) => setSlotDrafts((prev) => ({ ...prev, [s.key]: { ...prev[s.key], dur: e.target.value } }))}
                    />
                  </>
                )}
              </div>
            ))}
            <p className="vp-hint">El layout (posiciones y duraciones del diseño) se mantiene; solo se reemplaza el contenido de los slots.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button type="button" className="vp-btn" onClick={() => setInstantiating(null)}>Cancelar</button>
              <button type="button" className="vp-btn vp-btn-primary" onClick={() => void submitInstantiate()} disabled={instBusy}>
                {instBusy ? "Instanciando…" : "Crear y abrir"}
              </button>
            </div>
          </div>
        </div>
      )}

      <span style={{ display: "none" }}>{pane}</span>
    </div>
  );
}
