import { useCallback, useEffect, useRef, useState } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { notifyMetaChanged, onMetaChanged } from "../lib/metaSync";

interface FileMeta {
  brand_id: string | null;
  brand: string;
  campaign_id: string | null;
  campaign: string;
  category: string;
  content_kind: string;
  asset_type: string;
  designer_type: string;
  is_permanent: boolean;
  tags: string[];
  theme: string;
  format: string;
  file_type: string;
  cover_image_url: string;
  obsidian_link: string;
  production_data: Record<string, string>;
}

interface BrandOption { id: string; name: string; relationship_status: "lead" | "client" }
interface CampaignOption { id: string; brand_id: string; name: string; status: string }

interface Props {
  templateId: string | null;
  thumbnailUrl?: string | null;      // auto-generated, fallback
  onCoverCapture?: () => Promise<string | null>;  // returns base64 data URL
}

/** Must match CATEGORIES in BrandGraphDataTable and the API's normalizeCategory. */
const CATEGORIES = ["Design System", "Plantillas", "Assets", "Archivos"];

/** The house brand. A design file with no brand at all is never what is meant,
 *  so a file that arrives unfiled is put here rather than left as "Sin marca". */
const DEFAULT_BRAND_NAME = "Futuraria";

const PRODUCTION_FIELDS = [
  ["supplier", "Proveedor / imprenta"],
  ["print_run", "Tiraje (cantidad)"],
  ["substrate", "Sustrato (papel, vinilo, tela...)"],
  ["finish", "Acabados (laminado, UV, hot-stamp)"],
  ["technique", "Técnica (offset, flexo, serigrafía, digital)"],
  ["color_mode", "Color (CMYK, Pantone)"],
  ["unit_cost", "Costo unitario"],
  ["turnaround", "Tiempo de producción"],
  ["approved_version", "Versión aprobada"],
] as const;


export function FileInfoPanel({ templateId, thumbnailUrl, onCoverCapture }: Props) {
  const [meta, setMeta] = useState<FileMeta>({
    brand_id: null, brand: "", campaign_id: null, campaign: "", category: "", content_kind: "", asset_type: "other",
    designer_type: "other", is_permanent: false,
    tags: [], theme: "", format: "", file_type: "", cover_image_url: "", obsidian_link: "",
    production_data: {},
  });
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandError, setBrandError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const metaRef = useRef<FileMeta>(meta);

  /** Read the row back from the server. Also the listener below, so an edit
   *  made in the brand table lands here without reopening the file. */
  const loadMeta = useCallback(async () => {
    if (!templateId) return;
    try {
      const d = await fetch(`/api/meta/${templateId}`, { headers: getApiHeaders() }).then(r => r.json());
      if (!d.success || !d.data) return;
      const m = {
        brand_id: d.data.brand_id || null,
        brand: d.data.brand || "",
        campaign_id: d.data.campaign_id || null,
        campaign: d.data.campaign || "",
        category: d.data.category || "",
        content_kind: d.data.content_kind || "",
        asset_type: d.data.asset_type || "other",
        designer_type: d.data.designer_type || "other",
        is_permanent: Boolean(d.data.is_permanent),
        tags: d.data.tags || [],
        theme: d.data.theme || "",
        format: d.data.format || "",
        file_type: d.data.file_type || "",
        cover_image_url: d.data.cover_image_url || "",
        obsidian_link: d.data.obsidian_link || "",
        production_data: d.data.production_data || {},
      };
      setMeta(m);
      metaRef.current = m;
    } catch { /* keep whatever is on screen */ }
  }, [templateId]);

  /** Workspace brands + campaigns, and the workspace id the brand-creation
   * endpoint needs. Separate from loadMeta so creating a brand can refresh
   * the list without touching the row being edited. */
  const loadTaxonomy = useCallback(async () => {
    if (!templateId) { setBrands([]); setCampaigns([]); return; }
    try {
      const d = await fetch(`/api/meta/${templateId}/taxonomy`, { headers: getApiHeaders() }).then(r => r.json());
      if (!d.success) return;
      setBrands(Array.isArray(d.data?.brands) ? d.data.brands : []);
      setCampaigns(Array.isArray(d.data?.campaigns) ? d.data.campaigns : []);
      if (d.data?.workspaceId) setWorkspaceId(d.data.workspaceId);
    } catch { setBrands([]); setCampaigns([]); }
  }, [templateId]);

  // Fetch metadata on mount / templateId change
  useEffect(() => {
    if (!templateId) { setLoading(false); return; }
    setLoading(true);
    void loadMeta().finally(() => setLoading(false));
    void loadTaxonomy();
  }, [templateId, loadMeta, loadTaxonomy]);

  // Re-read when this same file was written somewhere else in the app — the
  // brand table is the other view of this row.
  useEffect(() => {
    if (!templateId) return;
    return onMetaChanged(changedId => {
      // Skip while an edit of ours is still pending, or the debounce would be
      // overwritten by the value it is about to replace.
      if (changedId === templateId && !saveTimer.current) void loadMeta();
    });
  }, [templateId, loadMeta]);

  // ── Nothing stays unfiled ──
  // A design file with no brand is never what was meant, so one that arrives
  // unfiled is adopted by the house brand and saved straight away. Sent as a
  // bare name with no brand_id on purpose: that is the shape the API resolves
  // against the workspace's brands, creating Futuraria if this workspace does
  // not have it yet. Once per template, and never over an existing choice.
  const adoptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!templateId || loading) return;
    if (meta.brand_id || meta.brand) return;
    if (adoptedRef.current === templateId) return;
    adoptedRef.current = templateId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/meta/${templateId}`, {
          method: "PUT",
          headers: getApiHeaders(),
          body: JSON.stringify({ brand: DEFAULT_BRAND_NAME }),
        });
        if (!res.ok || cancelled) return;
        const fresh = await fetch(`/api/meta/${templateId}`, { headers: getApiHeaders() }).then(r => r.json());
        if (cancelled || !fresh?.success || !fresh.data) return;
        setMeta(prev => {
          const next = { ...prev, brand_id: fresh.data.brand_id || null, brand: fresh.data.brand || "" };
          metaRef.current = next;
          return next;
        });
        notifyMetaChanged(templateId);
      } catch { /* the panel still works unfiled; the next open retries */ }
    })();
    return () => { cancelled = true; };
  }, [templateId, loading, meta.brand_id, meta.brand]);

  // Debounced auto-save
  const scheduleSave = useCallback((patch: Partial<FileMeta>) => {
    if (!templateId) return;
    const next = { ...metaRef.current, ...patch };
    setMeta(next);
    metaRef.current = next;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/meta/${templateId}`, {
          method: "PUT",
          headers: getApiHeaders(),
          body: JSON.stringify(next),
        });
        // Cleared before announcing: the listener above ignores an event while
        // a save of ours is pending, and this one is no longer pending.
        saveTimer.current = undefined;
        notifyMetaChanged(templateId);
      } catch {} finally { setSaving(false); }
    }, 2000);
  }, [templateId]);

  // Cleanup timer
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  /** Create a brand from the panel and file this design under it. Goes through
   * the SAME endpoint the CRM uses, so the row is identical everywhere: it
   * appears in the CRM, in the grafo (the API lists every brand, designs or
   * not) and in every brand dropdown — and it gets its Design System file
   * unless the user opted out of auto-DS creation. */
  const createBrand = useCallback(async () => {
    const name = newBrandName.trim();
    if (!name || !templateId) return;
    setBrandError("");
    // Local dedupe first: the endpoint's own ilike-dedupe path would also
    // overwrite CRM fields, and an existing brand only needs linking here.
    const existing = brands.find(brand => brand.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      scheduleSave({ brand_id: existing.id, brand: existing.name, campaign_id: null, campaign: "" });
      setAddingBrand(false); setNewBrandName("");
      return;
    }
    if (!workspaceId) { setBrandError("No se pudo resolver el workspace."); return; }
    setBrandBusy(true);
    try {
      let skipDesignSystem = false;
      try { skipDesignSystem = localStorage.getItem("futuraria-auto-design-system") === "false"; } catch {}
      const res = await fetch(`/api/workspaces/${workspaceId}/brands`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ name, relationshipStatus: "lead", skipDesignSystem }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || "No se pudo crear la marca");
      const created = d.data as { id: string; name: string };
      const option: BrandOption = { id: created.id, name: created.name, relationship_status: "lead" };
      setBrands(cur => [...cur, option].sort((a, b) => a.name.localeCompare(b.name)));
      scheduleSave({ brand_id: created.id, brand: created.name, campaign_id: null, campaign: "" });
      setAddingBrand(false); setNewBrandName("");
    } catch (cause) {
      setBrandError(cause instanceof Error ? cause.message : "No se pudo crear la marca");
    } finally { setBrandBusy(false); }
  }, [newBrandName, templateId, workspaceId, brands, scheduleSave]);

  // Tags
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || meta.tags.includes(t)) return;
    scheduleSave({ tags: [...meta.tags, t] });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    scheduleSave({ tags: meta.tags.filter(t => t !== tag) });
  };

  // Upload cover
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !templateId) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const res = await fetch(`/api/meta/${templateId}/cover`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const d = await res.json();
      if (d.success) scheduleSave({ cover_image_url: d.data.cover_image_url });
    } catch {} finally { setUploading(false); }
  }, [templateId]);

  const handleSnapshot = useCallback(async () => {
    if (!onCoverCapture || !templateId) return;
    setUploading(true);
    try {
      const b64 = await onCoverCapture();
      if (!b64) return;
      const res = await fetch(`/api/meta/${templateId}/cover`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const d = await res.json();
      if (d.success) scheduleSave({ cover_image_url: d.data.cover_image_url });
    } catch {} finally { setUploading(false); }
  }, [templateId, onCoverCapture]);

  if (loading) return <div style={panelStyle}>Loading…</div>;

  const coverSrc = meta.cover_image_url || thumbnailUrl;

  return (
    <div style={panelStyle}>
      {/* Cover Image */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Cover</label>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {coverSrc ? (
            <img src={coverSrc} alt="Cover" style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)" }} />
          ) : (
            <div style={{ width: 80, height: 60, borderRadius: 4, border: "1px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 10 }}>
              No cover
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={uploadBtnStyle}>
              {uploading ? "Uploading…" : "Upload PNG/JPG"}
              <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={handleFileUpload} disabled={uploading} />
            </label>
            {onCoverCapture && (
              <button type="button" style={snapshotBtnStyle} onClick={handleSnapshot} disabled={uploading}>
                Use snapshot
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Brand — a closed dropdown over the workspace's brands (the same
          `brands` table the CRM and the grafo read), plus an in-place creation
          option. Created brands are identical to CRM-created ones: same row,
          same Design System file, same graph node. */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Marca</label>
        <select
          style={selectStyle}
          value={(() => {
            const byId = brands.find(brand => brand.id === meta.brand_id);
            if (byId) return byId.id;
            const byName = meta.brand
              ? brands.find(brand => brand.name.toLocaleLowerCase() === meta.brand.toLocaleLowerCase())
              : undefined;
            return byName ? byName.id : "";
          })()}
          onChange={event => {
            if (event.target.value === "__add__") {
              setAddingBrand(true);
              setNewBrandName("");
              setBrandError("");
              return; // the controlled value above never moved — the select snaps back
            }
            const brand = brands.find(item => item.id === event.target.value);
            scheduleSave({ brand_id: brand?.id || null, brand: brand?.name || "", campaign_id: null, campaign: "" });
          }}
        >
          <option value="">Sin marca</option>
          {brands.map(brand => (
            <option key={brand.id} value={brand.id}>{brand.name}</option>
          ))}
          <option value="__add__">➕ Agregar marca nueva…</option>
        </select>
        {addingBrand && (
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <input
              style={inputStyle}
              value={newBrandName}
              autoFocus
              disabled={brandBusy}
              onChange={event => setNewBrandName(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void createBrand(); } }}
              placeholder="Nombre de la nueva marca"
            />
            <button type="button" style={uploadBtnStyle} onClick={() => void createBrand()} disabled={brandBusy || !newBrandName.trim()}>
              {brandBusy ? "Creando…" : "Crear"}
            </button>
            <button type="button" style={uploadBtnStyle} onClick={() => { setAddingBrand(false); setBrandError(""); }} disabled={brandBusy} aria-label="Cancelar">
              ✕
            </button>
          </div>
        )}
        {brandError
          ? <div style={{ fontSize: 10, color: "#f87171", marginTop: 3 }}>{brandError}</div>
          : <div style={{ fontSize: 10, color: "#666", marginTop: 3 }}>
              Se crea al instante y queda sincronizada con el CRM y el grafo.
            </div>}
      </div>

      {/* Categoria — the same four branches the brand table writes, on the
          same design_file_meta.category column, so the two panels cannot
          disagree about where a file is filed. */}
      <label style={sectionStyle}>
        <span style={labelStyle}>Categoría</span>
        <select
          style={selectStyle}
          value={CATEGORIES.includes(meta.category) ? meta.category : ""}
          onChange={event => scheduleSave({ category: event.target.value })}
        >
          <option value="">Archivos (por defecto)</option>
          {CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>

      {/* Orgánico o Ad — provenance, not current state. A design that ran as
          an ad and did well often becomes an organic post later; this records
          what it was FIRST used for, and the calendar row carries what it is
          doing now. Images pulled in by Content Machine inherit it. */}
      <label style={sectionStyle}>
        <span style={labelStyle}>Orgánico / Ad</span>
        <select
          style={selectStyle}
          value={meta.content_kind}
          onChange={event => scheduleSave({ content_kind: event.target.value })}
        >
          <option value="">Sin definir</option>
          <option value="organic">Orgánico</option>
          <option value="ad">Ad</option>
        </select>
      </label>

      {/* Campaign */}
      <label style={sectionStyle}>
        <span style={labelStyle}>Campaña</span>
        <input
          style={inputStyle}
          list={`campaigns-${templateId || "none"}`}
          value={meta.campaign}
          onChange={event => {
            const campaign = campaigns.find(item => item.name === event.target.value && (!meta.brand_id || item.brand_id === meta.brand_id));
            scheduleSave({ campaign_id: campaign?.id || null, campaign: event.target.value });
          }}
          placeholder="Ej. Black Friday 2026"
        />
        <datalist id={`campaigns-${templateId || "none"}`}>
          {campaigns.filter(campaign => !meta.brand_id || campaign.brand_id === meta.brand_id).map(campaign => (
            <option key={campaign.id} value={campaign.name} />
          ))}
        </datalist>
      </label>

      {/* "Tipo de asset", "Perfil de diseño" and "Activo permanente" lived here.
          All three were write-only: stored, echoed back, and read by nothing
          that makes a decision. The panel is for what a person needs to file a
          design, not for every column the table happens to have.

          asset_type still decides whether the production block below appears,
          so it is kept in state and set by the API's default; it just has no
          control of its own any more. */}

      {/* Production Data (only for print-type assets) */}
      {(meta.designer_type === "print" || ["packaging", "label", "dieline", "pop_display", "large_format", "signage", "textile", "merch", "stand"].includes(meta.asset_type)) && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Datos de producción</label>
          {PRODUCTION_FIELDS.map(([key, label]) => (
            <input
              key={key}
              style={{ ...inputStyle, marginBottom: 4 }}
              value={meta.production_data[key] || ""}
              onChange={e => {
                const next = { ...meta.production_data, [key]: e.target.value };
                if (!e.target.value) delete next[key];
                scheduleSave({ production_data: next });
              }}
              placeholder={label}
            />
          ))}
        </div>
      )}

      {/* Tags */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Tags</label>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Add tag…"
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {meta.tags.map(tag => (
            <span key={tag} style={chipStyle}>
              {tag}
              <button type="button" aria-label={`Eliminar etiqueta ${tag}`} onClick={() => removeTag(tag)} style={chipRemoveStyle}>×</button>
            </span>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Theme</label>
        <input
          style={inputStyle}
          value={meta.theme}
          onChange={e => scheduleSave({ theme: e.target.value })}
          placeholder="e.g. corporate, minimal"
        />
      </div>

      {/* Format, File Type and Obsidian Link lived here. Same story: three
          more fields nothing downstream reads. Their values are still carried
          in state and round-tripped on save, so anything already stored is
          preserved rather than blanked by the next edit. */}

      {/* Save indicator */}
      <div style={{ padding: "4px 0", fontSize: 10, color: "#666", textAlign: "right" }}>
        {saving ? "Saving…" : templateId ? "Auto-saved" : "No template selected"}
      </div>
    </div>
  );
}

// ── Styles ──

const panelStyle: React.CSSProperties = {
  width: "100%", minWidth: 0, minHeight: 0, flex: 1,
  overflowY: "auto", overflowX: "hidden",
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  color: "var(--text-primary, #dddbd4)",
};

const sectionStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  fontSize: 11,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  color: "#ddd",
  fontFamily: "Inter, system-ui, sans-serif",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  appearance: "auto",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: "1px 6px",
  fontSize: 10,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: "#ccc",
};

const chipRemoveStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
  padding: "0 1px",
};

const uploadBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 10px",
  fontSize: 10,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  color: "#ccc",
  cursor: "pointer",
};

const snapshotBtnStyle: React.CSSProperties = {
  ...uploadBtnStyle,
  background: "rgba(59,130,246,0.15)",
  border: "1px solid rgba(59,130,246,0.3)",
  color: "#93c5fd",
};
