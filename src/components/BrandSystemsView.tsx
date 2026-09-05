import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/supabase";
import { useToast } from "./Toast";

// ═══════════════════════════════════════════════════════════════
// BrandSystemsView — the "Design Systems" sub-tab of Diseño.
//
// One card per CRM brand with its three container slots (harness/
// DS_CONTAINER_CONVENTION.md): DS + Plantillas + Comunicación.
// The law enforced here: a Design System ALWAYS belongs to a brand —
// the create popup asks for the brand first (existing or new, created
// inline) and never asks for frame dimensions.
//   · DS slot        → opens the DS file in the editor
//   · Plantillas     → curated frames; opens the file (add frames via
//                      add_frame_to_brand(collection="plantillas"))
//   · Comunicación   → the Brand Strategy Canvas (strategyJson is the
//                      source of truth; V-frames are its render)
// ═══════════════════════════════════════════════════════════════

interface Completeness {
  score: number;
  total: number;
}

interface BrandRow {
  id: string;
  name: string;
  relationship_status: string;
  design_system_template_id: string | null;
  has_design_system: boolean;
  plantillas_template_id: string | null;
  plantillas_frame_count: number;
  communication_template_id: string | null;
  has_strategy: boolean;
  completeness: Completeness | null;
}

interface DsFile {
  id: string;
  name: string;
  thumbnail: string | null;
  width: number;
  height: number;
}

// ── Brand Strategy Canvas (BRAND_STRATEGY_V1) ──

interface StrategyDraft {
  essence?: {
    mission?: string;
    vision?: string;
    values?: string[];
    valueProposition?: string;
    positioning?: string;
  };
  tone?: {
    axes?: Record<string, number>;
    person?: "tu" | "usted" | "nosotros";
    emojiPolicy?: "never" | "occasional" | "free";
  };
  audience?: { personas?: Array<{ name: string; description?: string }> };
  voice?: {
    vocabularyYes?: string[];
    vocabularyNo?: string[];
    ctaPatterns?: string[];
  };
  advanced?: { archetype?: string };
}

const TONE_AXES: Array<{ id: string; label: string; low: string; high: string }> = [
  { id: "formal", label: "Formal", low: "Relajado", high: "Formal" },
  { id: "calido", label: "Calidez", low: "Frío", high: "Cercano" },
  { id: "energia", label: "Energía", low: "Sereno", high: "Explosivo" },
  { id: "minimal", label: "Minimalismo", low: "Expresivo", high: "Minimal" },
  { id: "tecnico", label: "Técnico", low: "Divulgativo", high: "Técnico" },
];

interface Props {
  workspaceId: string | null;
  onOpenTemplate: (templateId: string) => void;
}

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const slotBase: React.CSSProperties = {
  position: "relative",
  borderRadius: 12,
  overflow: "hidden",
  background: "rgba(0,0,0,0.25)",
  border: "1px solid rgba(255,255,255,0.08)",
  // Fixed floor instead of aspectRatio: three 4/3 slots in a ~360px card left
  // ~70px boxes that could not fit label + hint + button (the Crear pills
  // spilled over the border). Content now decides the height, centered.
  minHeight: 104,
  padding: "10px 8px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  textAlign: "center",
  cursor: "default",
};

const slotLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.4px",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.45)",
};

const slotHint: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(255,255,255,0.28)",
  textAlign: "center",
  padding: "0 8px",
  lineHeight: 1.4,
};

// Bottom strip label — identical on all three slots (Comunicación set the
// pattern): gradient fading to black keeps the caption readable over
// thumbnails and the empty background alike. Single source of truth.
const slotBottomLabel: React.CSSProperties = {
  ...slotLabel,
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "10px 6px 5px",
  background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.3)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "7px 10px",
  color: "#fff",
  fontSize: 13,
  outline: "none",
  width: "100%",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  background: "rgba(5,5,12,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};

const canvasPanelStyle: React.CSSProperties = {
  width: "min(860px, 100%)",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "#12121f",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 18,
  padding: "22px 24px 26px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "?";
}

function splitList(value: string): string[] {
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

function completenessColor(c: Completeness | null): string {
  if (!c || c.total === 0) return "rgba(255,255,255,0.35)";
  const ratio = c.score / c.total;
  if (ratio >= 0.8) return "#86efac";
  if (ratio >= 0.4) return "#fcd34d";
  return "rgba(255,255,255,0.45)";
}

// ── Brand Strategy Canvas modal — "hoja de papel" progressive form ──

function StrategyCanvas({ brand, workspaceId, onClose, onSaved }: {
  brand: BrandRow;
  workspaceId: string;
  onClose: () => void;
  onSaved: (completeness: Completeness) => void;
}) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<StrategyDraft>({});
  const [digest, setDigest] = useState("");
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ success: boolean; data?: { strategy: StrategyDraft | null; completeness: Completeness; digest: string } }>(
          `/api/workspaces/${workspaceId}/brands/${brand.id}/strategy`,
        );
        if (cancelled) return;
        setDraft(res.data?.strategy || {});
        setDigest(res.data?.digest || "");
        setCompleteness(res.data?.completeness || null);
      } catch {
        if (!cancelled) addToast("No se pudo cargar la estrategia.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brand.id, workspaceId, addToast]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; data?: { completeness: Completeness; digest: string }; issues?: string[]; error?: string }>(
        `/api/workspaces/${workspaceId}/brands/${brand.id}/strategy`,
        { method: "PUT", body: JSON.stringify({ strategy: draft }) },
      );
      if (res.data) {
        addToast("Estrategia guardada — los frames de Comunicación se regeneraron.", "success");
        setCompleteness(res.data.completeness);
        setDigest(res.data.digest);
        onSaved(res.data.completeness);
        onClose();
      } else {
        addToast(res.error || "Estrategia inválida.", "error");
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo guardar la estrategia.", "error");
    } finally {
      setSaving(false);
    }
  }, [draft, workspaceId, brand.id, addToast, onClose, onSaved]);

  const sectionTitle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase",
    color: "#a5b4fc", marginBottom: 10,
  };
  const fieldLabel: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 };

  const setEssence = (patch: Partial<NonNullable<StrategyDraft["essence"]>>) =>
    setDraft(d => ({ ...d, essence: { ...d.essence, ...patch } }));
  const setTone = (patch: Partial<NonNullable<StrategyDraft["tone"]>>) =>
    setDraft(d => ({ ...d, tone: { ...d.tone, ...patch } }));
  const setAxis = (axis: string, value: number) =>
    setDraft(d => ({ ...d, tone: { ...d.tone, axes: { ...d.tone?.axes, [axis]: value } } }));
  const setVoice = (patch: Partial<NonNullable<StrategyDraft["voice"]>>) =>
    setDraft(d => ({ ...d, voice: { ...d.voice, ...patch } }));

  const personas = draft.audience?.personas || [];

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={canvasPanelStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#a5b4fc",
          }}>{initials(brand.name)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Estrategia de comunicación</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{brand.name} · fuente de verdad: strategyJson → frames V-01…V-03</div>
          </div>
          {completeness && (
            <span style={{ fontSize: 12, fontWeight: 700, color: completenessColor(completeness) }}>
              {completeness.score}/{completeness.total}
            </span>
          )}
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", padding: 40 }}>Cargando estrategia…</div>
        ) : (
          <>
            {/* 1 · Esencia */}
            <div>
              <div style={sectionTitle}>1 · Esencia</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <span style={fieldLabel}>Misión</span>
                  <textarea value={draft.essence?.mission || ""} onChange={e => setEssence({ mission: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Por qué existe la marca…" />
                </label>
                <label>
                  <span style={fieldLabel}>Visión</span>
                  <textarea value={draft.essence?.vision || ""} onChange={e => setEssence({ vision: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Hacia dónde va…" />
                </label>
                <label>
                  <span style={fieldLabel}>Propuesta de valor</span>
                  <input value={draft.essence?.valueProposition || ""} onChange={e => setEssence({ valueProposition: e.target.value })} style={inputStyle} placeholder="Lo único que solo esta marca ofrece…" />
                </label>
                <label>
                  <span style={fieldLabel}>Valores (separados por coma)</span>
                  <input
                    value={(draft.essence?.values || []).join(", ")}
                    onChange={e => setEssence({ values: splitList(e.target.value) })}
                    style={inputStyle}
                    placeholder="Honestidad, Audacia…"
                  />
                </label>
              </div>
            </div>

            {/* 2 · Tono */}
            <div>
              <div style={sectionTitle}>2 · Tono</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {TONE_AXES.map(axis => (
                  <div key={axis.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 110px 44px", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{axis.label}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "right" }}>{axis.low}</span>
                    <input
                      type="range" min={0} max={100} step={1}
                      value={draft.tone?.axes?.[axis.id] ?? 50}
                      onChange={e => setAxis(axis.id, Number(e.target.value))}
                      style={{ width: "100%", accentColor: "#6366f1" }}
                    />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", textAlign: "right" }}>{draft.tone?.axes?.[axis.id] ?? "—"}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <label style={{ flex: 1, minWidth: 140 }}>
                    <span style={fieldLabel}>La marca habla de…</span>
                    <select value={draft.tone?.person || ""} onChange={e => setTone({ person: (e.target.value || undefined) as StrategyDraft["tone"] extends { person?: infer P } ? P : never })} style={{ ...inputStyle, appearance: "auto" }}>
                      <option value="">Elegir…</option>
                      <option value="tu">Tú (cercano)</option>
                      <option value="usted">Usted (formal)</option>
                      <option value="nosotros">Nosotros (colectivo)</option>
                    </select>
                  </label>
                  <label style={{ flex: 1, minWidth: 140 }}>
                    <span style={fieldLabel}>Emojis</span>
                    <select value={draft.tone?.emojiPolicy || ""} onChange={e => setTone({ emojiPolicy: (e.target.value || undefined) as "never" | "occasional" | "free" | undefined })} style={{ ...inputStyle, appearance: "auto" }}>
                      <option value="">Elegir…</option>
                      <option value="never">Nunca</option>
                      <option value="occasional">Ocasionales</option>
                      <option value="free">Libres</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            {/* 3 · Audiencia */}
            <details open={personas.length > 0}>
              <summary style={{ ...sectionTitle, cursor: "pointer" }}>3 · Audiencia — personas sintéticas</summary>
              {personas.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    value={p.name}
                    onChange={e => setDraft(d => ({
                      ...d,
                      audience: { personas: (d.audience?.personas || []).map((x, j) => j === i ? { ...x, name: e.target.value } : x) },
                    }))}
                    placeholder={`Persona ${i + 1} — nombre`}
                    style={{ ...inputStyle, maxWidth: 200 }}
                  />
                  <input
                    value={p.description || ""}
                    onChange={e => setDraft(d => ({
                      ...d,
                      audience: { personas: (d.audience?.personas || []).map((x, j) => j === i ? { ...x, description: e.target.value } : x) },
                    }))}
                    placeholder="Edad, rol, qué busca, qué lo frustra…"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(d => ({ ...d, audience: { personas: (d.audience?.personas || []).filter((_, j) => j !== i) } }))}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14 }}
                    title="Quitar persona"
                  >✕</button>
                </div>
              ))}
              {personas.length < 5 && (
                <button
                  type="button"
                  className="workspace-button"
                  onClick={() => setDraft(d => ({ ...d, audience: { personas: [...(d.audience?.personas || []), { name: "", description: "" }] } }))}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  + Persona
                </button>
              )}
            </details>

            {/* 4 · Voz en práctica */}
            <details>
              <summary style={{ ...sectionTitle, cursor: "pointer" }}>4 · Voz en práctica</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label>
                  <span style={fieldLabel}>Sí usar (separado por coma)</span>
                  <input value={(draft.voice?.vocabularyYes || []).join(", ")} onChange={e => setVoice({ vocabularyYes: splitList(e.target.value) })} style={inputStyle} placeholder="claro, directo, en beneficio de…" />
                </label>
                <label>
                  <span style={fieldLabel}>Nunca usar</span>
                  <input value={(draft.voice?.vocabularyNo || []).join(", ")} onChange={e => setVoice({ vocabularyNo: splitList(e.target.value) })} style={inputStyle} placeholder="sinergia, disruptivo, revolucionario…" />
                </label>
                <label>
                  <span style={fieldLabel}>Patrones de CTA</span>
                  <input value={(draft.voice?.ctaPatterns || []).join(", ")} onChange={e => setVoice({ ctaPatterns: splitList(e.target.value) })} style={inputStyle} placeholder="Reserva tu demo, Empieza hoy…" />
                </label>
              </div>
            </details>

            {/* 5 · Avanzado */}
            <details>
              <summary style={{ ...sectionTitle, cursor: "pointer" }}>5 · Avanzado</summary>
              <label>
                <span style={fieldLabel}>Arquetipo de marca</span>
                <input
                  value={draft.advanced?.archetype || ""}
                  onChange={e => setDraft(d => ({ ...d, advanced: { archetype: e.target.value } }))}
                  style={inputStyle}
                  placeholder="Héroe, Sabio, Explorador, Mago…"
                />
              </label>
            </details>

            {digest && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 10 }}>
                <b style={{ color: "rgba(255,255,255,0.55)" }}>Digest para IAs:</b> {digest}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 12 }}>
                Cancelar
              </button>
              <button type="button" className="workspace-button" disabled={saving} onClick={save}>
                {saving ? "Guardando…" : "Guardar estrategia"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main view ──

export function BrandSystemsView({ workspaceId, onOpenTemplate }: Props) {
  const { addToast } = useToast();
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [dsFiles, setDsFiles] = useState<Map<string, DsFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [relationship, setRelationship] = useState<"lead" | "client">("client");
  const [busy, setBusy] = useState(false);
  const [canvasBrand, setCanvasBrand] = useState<BrandRow | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const [brandsRes, tplRes] = await Promise.all([
        apiFetch<{ success: boolean; data?: BrandRow[] }>(`/api/workspaces/${workspaceId}/brands`),
        apiFetch<{ success: boolean; data?: Array<DsFile & { isBrandManual?: boolean; metadata?: { updatedAt: string } }> }>(
          // /api prefix is mandatory: API_BASE is empty, so a bare /templates
          // hits the Vite SPA fallback and comes back as HTML, not JSON.
          `/api/templates?workspaceId=${workspaceId}&limit=200&offset=0`),
      ]);
      const brandRows = brandsRes.data || [];
      const files = (tplRes.data || []).filter(t => t.isBrandManual);
      const byId = new Map<string, DsFile>();
      for (const f of files) {
        byId.set(f.id, { id: f.id, name: f.name, thumbnail: f.thumbnail || null, width: f.width, height: f.height });
      }
      setBrands(brandRows);
      setDsFiles(byId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los Design Systems.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  /** After any creation path: reload and land on the brand's DS file. */
  const reloadAndOpen = useCallback(async (brandId: string) => {
    const brandsRes = await apiFetch<{ success: boolean; data?: BrandRow[] }>(`/api/workspaces/${workspaceId}/brands`);
    const rows = brandsRes.data || [];
    setBrands(rows);
    await load();
    const target = rows.find(b => b.id === brandId);
    if (target?.design_system_template_id) onOpenTemplate(target.design_system_template_id);
  }, [workspaceId, load, onOpenTemplate]);

  /** Brand exists but its container was never created (legacy row).
   *  The endpoint also backfills Plantillas + Comunicación (v47). */
  const createForBrand = useCallback(async (brandId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/brands/${brandId}/design-system`, { method: "POST" });
      addToast("Design System creado para la marca.", "success");
      await reloadAndOpen(brandId);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo crear el Design System.", "error");
    } finally {
      setBusy(false);
    }
  }, [workspaceId, addToast, reloadAndOpen]);

  /** The popup path: pick an existing brand or create the brand inline —
   *  the server creates brand + DS atomically for the new-brand path. */
  const submitPopup = useCallback(async () => {
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!selectedBrandId) return;
        await createForBrand(selectedBrandId);
        setPopupOpen(false);
        return;
      }
      const name = newBrandName.trim();
      if (!name) return;
      const res = await apiFetch<{ success: boolean; data?: { id: string } }>(
        `/api/workspaces/${workspaceId}/brands`,
        { method: "POST", body: JSON.stringify({ name, relationshipStatus: relationship }) },
      );
      addToast(`Marca "${name}" creada con su Design System.`, "success");
      setPopupOpen(false);
      setNewBrandName("");
      if (res.data?.id) await reloadAndOpen(res.data.id);
      else await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo crear la marca.", "error");
    } finally {
      setBusy(false);
    }
  }, [mode, selectedBrandId, newBrandName, relationship, workspaceId, createForBrand, addToast, reloadAndOpen, load]);

  const openDsSlot = (brand: BrandRow) => {
    const file = brand.design_system_template_id ? dsFiles.get(brand.design_system_template_id) : null;
    if (file) onOpenTemplate(file.id);
  };

  const openPlantillasSlot = (brand: BrandRow) => {
    if (brand.plantillas_template_id) onOpenTemplate(brand.plantillas_template_id);
  };

  return (
    <div style={{ padding: "4px 2px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", flex: 1, minWidth: 220 }}>
          Un Design System pertenece siempre a una marca — el contenedor vive aquí, no en Archivos.
        </span>
        <button
          type="button"
          className="workspace-button crm-toolbar-add"
          onClick={() => { setPopupOpen(open => !open); setMode("existing"); setSelectedBrandId(""); }}
        >
          + Nuevo Design System
        </button>
      </div>

      {/* Create popup: the FIRST question is the brand. No dimensions here. */}
      {popupOpen && (
        <div style={{ ...cardStyle, borderColor: "rgba(99,102,241,0.35)", background: "rgba(99,102,241,0.06)" }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 220, flex: 1 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>¿A qué marca pertenece?</span>
              <select
                value={mode === "existing" ? selectedBrandId : "__new__"}
                onChange={e => {
                  if (e.target.value === "__new__") { setMode("new"); setSelectedBrandId(""); }
                  else { setMode("existing"); setSelectedBrandId(e.target.value); }
                }}
                style={{ ...inputStyle, appearance: "auto" }}
              >
                <option value="">Elegir marca…</option>
                {brands.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.has_design_system ? " · ya tiene DS" : ""}
                  </option>
                ))}
                <option value="__new__">+ Crear marca nueva…</option>
              </select>
            </label>
            {mode === "new" && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 200, flex: 1 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Nombre de la marca nueva</span>
                  <input
                    value={newBrandName}
                    onChange={e => setNewBrandName(e.target.value)}
                    placeholder="Ej: Acme Corp"
                    style={inputStyle}
                    autoFocus
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 120 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Relación</span>
                  <select
                    value={relationship}
                    onChange={e => setRelationship(e.target.value as "lead" | "client")}
                    style={{ ...inputStyle, appearance: "auto" }}
                  >
                    <option value="client">Cliente</option>
                    <option value="lead">Lead</option>
                  </select>
                </label>
              </>
            )}
            <button
              type="button"
              className="workspace-button"
              disabled={busy || (mode === "existing" ? !selectedBrandId : !newBrandName.trim())}
              onClick={submitPopup}
            >
              {busy ? "Creando…" : "Crear Design System"}
            </button>
            <button type="button" onClick={() => setPopupOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12 }}>
              Cancelar
            </button>
          </div>
          {mode === "existing" && selectedBrandId && brands.find(b => b.id === selectedBrandId)?.has_design_system && (
            <span style={{ fontSize: 11, color: "#fca5a5" }}>
              Esa marca ya tiene Design System — se abrirá el existente (una marca = un contenedor).
            </span>
          )}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>Cargando marcas…</div>
      ) : error ? (
        <div style={{ textAlign: "center", color: "#fca5a5", padding: 60, fontSize: 13, userSelect: "text", cursor: "text", maxWidth: 720, margin: "0 auto", lineHeight: 1.6 }}>{error}</div>
      ) : brands.length === 0 ? (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Aún no hay marcas en este workspace.</div>
          <div style={{ fontSize: 12 }}>Usa «+ Nuevo Design System» → «Crear marca nueva»: nace la marca en el CRM y su contenedor aquí.</div>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}>
          {brands.map(brand => {
            const dsFile = brand.design_system_template_id ? dsFiles.get(brand.design_system_template_id) : null;
            const plantillasFile = brand.plantillas_template_id ? dsFiles.get(brand.plantillas_template_id) : null;
            const commsFile = brand.communication_template_id ? dsFiles.get(brand.communication_template_id) : null;
            return (
              <div key={brand.id} style={cardStyle}>
                {/* Brand header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.35)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: "#a5b4fc",
                  }}>{initials(brand.name)}</div>
                  <span style={{ fontSize: 14, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {brand.name}
                  </span>
                  {brand.completeness && (
                    <span
                      title="Completitud del contenedor: DS + estrategia + plantillas"
                      style={{ fontSize: 11, fontWeight: 700, color: completenessColor(brand.completeness) }}
                    >
                      {brand.completeness.score}/{brand.completeness.total}
                    </span>
                  )}
                  <span style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.4px", textTransform: "uppercase",
                    padding: "2px 8px", borderRadius: 100,
                    background: brand.relationship_status === "client" ? "rgba(134,239,172,0.12)" : "rgba(251,191,36,0.10)",
                    color: brand.relationship_status === "client" ? "#86efac" : "#fcd34d",
                    border: `1px solid ${brand.relationship_status === "client" ? "rgba(134,239,172,0.25)" : "rgba(251,191,36,0.25)"}`,
                  }}>
                    {brand.relationship_status === "client" ? "Cliente" : "Lead"}
                  </span>
                </div>

                {/* Container slots: DS · Plantillas · Comunicación */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {/* DS slot — the whole card is the button: empty creates
                      right here, filled opens. The caption strip matches
                      Comunicación's (same gradient, position, hierarchy). */}
                  <div
                    role="button"
                    aria-disabled={busy && !dsFile}
                    onClick={() => { if (dsFile) openDsSlot(brand); else if (!busy) createForBrand(brand.id); }}
                    style={{
                      ...slotBase,
                      borderStyle: dsFile ? "solid" : "dashed",
                      cursor: busy && !dsFile ? "wait" : "pointer",
                    }}
                    title={dsFile ? `Abrir ${dsFile.name}` : `Crear el Design System de ${brand.name}`}
                  >
                    {dsFile ? (
                      <>
                        {dsFile.thumbnail
                          ? <img src={dsFile.thumbnail} alt={dsFile.name} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                          : <span style={{ fontSize: 22, color: "#a5b4fc", fontWeight: 700 }}>{initials(brand.name)}</span>}
                        <span style={slotBottomLabel}>
                          Design System
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={slotHint}>Sin archivo</span>
                        <span style={slotBottomLabel}>
                          Crear
                        </span>
                      </>
                    )}
                  </div>

                  {/* Plantillas slot — curated frames (batchamator source) */}
                  <div
                    role="button"
                    aria-disabled={busy && !plantillasFile}
                    onClick={() => { if (plantillasFile) openPlantillasSlot(brand); else if (!busy) createForBrand(brand.id); }}
                    style={{ ...slotBase, borderStyle: plantillasFile ? "solid" : "dashed", cursor: busy && !plantillasFile ? "wait" : "pointer" }}
                    title={plantillasFile ? `Abrir ${plantillasFile.name}` : "Crear el contenedor y cura frames con tu IA: add_frame_to_brand(collection='plantillas')"}
                  >
                    {plantillasFile ? (
                      <>
                        {plantillasFile.thumbnail
                          ? <img src={plantillasFile.thumbnail} alt={plantillasFile.name} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                          : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(165,180,252,0.75)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 8.5 4.5L12 11 3.5 6.5 12 2Z" /><path d="m3.5 11.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></svg>
                          )}
                        <span style={slotBottomLabel}>
                          Plantillas · {brand.plantillas_frame_count}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={slotHint}>Cura frames desde Archivos</span>
                        <span style={slotBottomLabel}>
                          Crear
                        </span>
                      </>
                    )}
                  </div>

                  {/* Comunicación slot — Brand Strategy Canvas */}
                  <div
                    role="button"
                    onClick={() => setCanvasBrand(brand)}
                    style={{ ...slotBase, borderStyle: brand.has_strategy ? "solid" : "dashed", cursor: "pointer" }}
                    title="Abrir la estrategia de comunicación (Brand Strategy Canvas)"
                  >
                    {brand.has_strategy ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(165,180,252,0.75)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>
                    ) : null}
                    <span style={slotBottomLabel}>
                      Comunicación{brand.has_strategy ? " ✓" : ""}
                    </span>
                    {!brand.has_strategy && (
                      <span style={slotHint}>Tono, voz y audiencia</span>
                    )}
                    {commsFile && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onOpenTemplate(commsFile.id); }}
                        title="Ver como frames"
                        style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, color: "rgba(255,255,255,0.6)", fontSize: 9, padding: "2px 6px", cursor: "pointer" }}
                      >
                        frames
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Brand Strategy Canvas modal */}
      {canvasBrand && workspaceId && (
        <StrategyCanvas
          brand={canvasBrand}
          workspaceId={workspaceId}
          onClose={() => setCanvasBrand(null)}
          onSaved={(completeness) => {
            setBrands(rows => rows.map(b => b.id === canvasBrand.id ? { ...b, has_strategy: true, completeness } : b));
          }}
        />
      )}
    </div>
  );
}
