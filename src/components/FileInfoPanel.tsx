import { useCallback, useEffect, useRef, useState } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { notifyMetaChanged, onMetaChanged } from "../lib/metaSync";
import { ASSET_TYPE_OPTIONS, DESIGNER_TYPE_OPTIONS, type DesignerType } from "../lib/designGraph";

interface FileMeta {
  brand_id: string | null;
  brand: string;
  campaign_id: string | null;
  campaign: string;
  category: string;
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

const FORMATS = ["", "web", "mobile", "social", "print", "email", "packaging", "large_format", "signage", "textile"];
const FILE_TYPES = ["", "frame", "deck", "template", "export"];
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

// Group ASSET_TYPE_OPTIONS by group for <optgroup> rendering
const ASSET_TYPE_GROUPS = [...new Set(ASSET_TYPE_OPTIONS.map((o) => o.group))];

export function FileInfoPanel({ templateId, thumbnailUrl, onCoverCapture }: Props) {
  const [meta, setMeta] = useState<FileMeta>({
    brand_id: null, brand: "", campaign_id: null, campaign: "", category: "", asset_type: "other",
    designer_type: "other", is_permanent: false,
    tags: [], theme: "", format: "", file_type: "", cover_image_url: "", obsidian_link: "",
    production_data: {},
  });
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
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

  // Fetch metadata on mount / templateId change
  useEffect(() => {
    if (!templateId) { setLoading(false); return; }
    setLoading(true);
    void loadMeta().finally(() => setLoading(false));

    fetch(`/api/meta/${templateId}/taxonomy`, { headers: getApiHeaders() })
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setBrands(Array.isArray(d.data?.brands) ? d.data.brands : []);
        setCampaigns(Array.isArray(d.data?.campaigns) ? d.data.campaigns : []);
      })
      .catch(() => { setBrands([]); setCampaigns([]); });
  }, [templateId, loadMeta]);

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

      {/* Brand */}
      <label style={sectionStyle}>
        <span style={labelStyle}>Marca</span>
        <select
          style={selectStyle}
          value={meta.brand_id || (meta.brand ? `legacy:${meta.brand}` : "")}
          onChange={event => {
            const selected = brands.find(brand => brand.id === event.target.value);
            scheduleSave({ brand_id: selected?.id || null, brand: selected?.name || "", campaign_id: null, campaign: "" });
          }}
        >
          <option value="">Sin marca</option>
          {meta.brand && !meta.brand_id && <option value={`legacy:${meta.brand}`}>{meta.brand} (sin vincular)</option>}
          {/* The name and nothing else. The old "· Cliente / · Lead" suffix was
              relationship_status painted onto the label, so this picker and the
              brand table disagreed about what a brand is called — and a name
              that really does contain a dash became impossible to tell from
              one this was decorating. */}
          {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>

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

      <label style={sectionStyle}>
        <span style={labelStyle}>Tipo de asset</span>
        <select style={selectStyle} value={meta.asset_type} onChange={event => scheduleSave({ asset_type: event.target.value })}>
          {ASSET_TYPE_GROUPS.map(group => (
            <optgroup key={group} label={group}>
              {ASSET_TYPE_OPTIONS.filter(o => o.group === group).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {/* Designer Type */}
      <label style={sectionStyle}>
        <span style={labelStyle}>Perfil de diseño</span>
        <select style={selectStyle} value={meta.designer_type} onChange={event => scheduleSave({ designer_type: event.target.value })}>
          {DESIGNER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {/* Is Permanent */}
      <div style={sectionStyle}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={meta.is_permanent}
            onChange={e => scheduleSave({ is_permanent: e.target.checked })}
            style={{ width: 14, height: 14, cursor: "pointer" }}
          />
          <span style={{ fontSize: 11, color: "#ccc" }}>Activo permanente (lineamientos de marca)</span>
        </label>
      </div>

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

      {/* Format */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Format</label>
        <select
          style={selectStyle}
          value={meta.format}
          onChange={e => scheduleSave({ format: e.target.value })}
        >
          {FORMATS.map(f => <option key={f} value={f}>{f || "—"}</option>)}
        </select>
      </div>

      {/* File Type */}
      <div style={sectionStyle}>
        <label style={labelStyle}>File Type</label>
        <select
          style={selectStyle}
          value={meta.file_type}
          onChange={e => scheduleSave({ file_type: e.target.value })}
        >
          {FILE_TYPES.map(f => <option key={f} value={f}>{f || "—"}</option>)}
        </select>
      </div>

      {/* Obsidian Link */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Obsidian Link</label>
        <input
          style={inputStyle}
          value={meta.obsidian_link}
          onChange={e => scheduleSave({ obsidian_link: e.target.value })}
          placeholder="obsidian://open?vault=design&file=..."
        />
        {meta.obsidian_link && (
          <a href={meta.obsidian_link} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontSize: 11, marginTop: 4, display: "inline-block" }}>
            Open in Obsidian ↗
          </a>
        )}
      </div>

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
