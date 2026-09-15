/**
 * TemplateInfoPanel — ficha «Ver información» de un archivo (sub-pestaña Archivos).
 *
 * Panel lateral Notion-style sobre InspectorDrawer (el mismo contenedor de las
 * fichas del CRM y de los nodos del Second Brain). Muestra y edita:
 *
 *  - Nombre (el mismo rename_template que usa el doble-click en la tarjeta).
 *  - Second Brain (design_file_meta): marca, rama del grafo y tags. Guardar
 *    hace PUT /api/meta/:id — el mismo upsert que alimenta el grafo y que
 *    resuelve/crea el vínculo brand_id en el CRM, así que «Sincronizar»
 *    escribe directo donde leen las IAs y Obsidian.
 *  - Detalles de solo lectura: dimensiones, frames, slug/id copiables,
 *    workspace, enlace Obsidian, portada y fechas (creación, última
 *    modificación, último cambio de contenido).
 */

import { useCallback, useEffect, useState } from "react";
import { InspectorDrawer } from "./InspectorDrawer";
import { useToast } from "./Toast";
import { apiFetch as sharedApiFetch, type ApiFetchOptions } from "../lib/supabase";
import { mcpCall } from "../lib/mcpClient";

const API_BASE = "/api";

function apiFetch<T = any>(url: string, options?: ApiFetchOptions): Promise<T> {
  return sharedApiFetch<T>(`${API_BASE}${url}`, options);
}

/** Forma mínima del DesignTemplate completo (GET /api/templates/:id). */
interface FullTemplate {
  id: string;
  name: string;
  slug?: string;
  width: number;
  height: number;
  engine?: string;
  workspaceId: string;
  frames?: unknown[];
  metadata?: { createdAt?: string; updatedAt?: string; contentUpdatedAt?: string };
}

/** Forma del meta del Second Brain (GET /api/meta/:templateId → rowToMeta). */
interface FileMeta {
  brand?: string;
  brand_id?: string | null;
  campaign?: string;
  category?: string;
  tags?: string[];
  theme?: string;
  format?: string;
  file_type?: string;
  cover_image_url?: string;
  cover_source?: string | null;
  cover_captured_at?: string | null;
  obsidian_link?: string;
  created_at?: string;
  updated_at?: string;
  content_updated_at?: string;
}

/** Ramas del grafo donde puede colgar el archivo (designMeta.CATEGORIES). */
const CATEGORIES = ["", "Design System", "Plantillas", "Assets", "Archivos"];

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase",
  color: "#a5b4fc", margin: "0 0 10px",
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, color: "#fff", padding: "7px 10px", fontSize: 13,
  outline: "none", width: "100%", fontFamily: "inherit",
};

const metaRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 12,
  fontSize: 12.5, padding: "5px 0", borderTop: "1px solid rgba(255,255,255,0.06)",
};

const metaKey: React.CSSProperties = { color: "rgba(255,255,255,0.45)", flexShrink: 0 };
const metaValue: React.CSSProperties = {
  color: "rgba(255,255,255,0.85)", textAlign: "right",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  userSelect: "text",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function TemplateInfoPanel({ templateId, initialName, onClose, onOpen, onRenamed }: {
  templateId: string;
  /** Nombre de la tarjeta — pinta el header sin esperar el fetch completo. */
  initialName?: string;
  onClose: () => void;
  onOpen: () => void;
  onRenamed?: (id: string, name: string) => void;
}) {
  const { addToast } = useToast();
  const [tpl, setTpl] = useState<FullTemplate | null>(null);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [loading, setLoading] = useState(true);

  // Borradores editables — nacen de lo que devuelve el servidor.
  const [name, setName] = useState(initialName || "");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [metaDirty, setMetaDirty] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [tplRes, metaRes] = await Promise.allSettled([
        apiFetch<{ success: boolean; data: FullTemplate }>(`/templates/${templateId}`),
        apiFetch<{ success: boolean; data: FileMeta | null }>(`/meta/${templateId}`),
      ]);
      if (cancelled) return;
      if (tplRes.status === "fulfilled" && tplRes.value?.data) {
        const full = tplRes.value.data;
        setTpl(full);
        setName(full.name);
      }
      // El meta es opcional: sin Supabase (o sin fila) la sección queda en
      // modo lectura y «Sincronizar» se desactiva en vez de reventar.
      if (metaRes.status === "fulfilled" && metaRes.value?.data) {
        const m = metaRes.value.data;
        setMeta(m);
        setBrand(m.brand || "");
        setCategory(m.category || "");
        setTags((m.tags || []).join(", "));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  const saveName = useCallback(async () => {
    const next = name.trim();
    if (!next || next === tpl?.name) return;
    setSavingName(true);
    try {
      const result = await mcpCall("rename_template", { templateId, name: next });
      if (result?.success) {
        setTpl(prev => prev ? { ...prev, name: next } : prev);
        onRenamed?.(templateId, next);
        addToast("Nombre actualizado.", "success");
      } else {
        throw new Error(result?.error || "Error desconocido");
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo renombrar el archivo.", "error");
    } finally {
      setSavingName(false);
    }
  }, [name, tpl?.name, templateId, onRenamed, addToast]);

  /** PUT /api/meta/:id — el mismo upsert del Second Brain: la marca se
      resuelve por nombre contra el CRM (y se crea si no existe). */
  const saveMeta = useCallback(async () => {
    if (!meta) return;
    setSavingMeta(true);
    try {
      await apiFetch(`/meta/${templateId}`, {
        method: "PUT",
        body: JSON.stringify({ brand: brand.trim(), category, tags: tags.split(",").map(s => s.trim()).filter(Boolean) }),
      });
      const fresh = await apiFetch<{ success: boolean; data: FileMeta | null }>(`/meta/${templateId}`);
      if (fresh?.data) {
        setMeta(fresh.data);
        setBrand(fresh.data.brand || "");
        setCategory(fresh.data.category || "");
        setTags((fresh.data.tags || []).join(", "));
      }
      setMetaDirty(false);
      addToast("Second Brain sincronizado — el grafo y tus IAs ya ven estos datos.", "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo sincronizar con el Second Brain.", "error");
    } finally {
      setSavingMeta(false);
    }
  }, [meta, templateId, brand, category, tags, addToast]);

  const copyText = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast(`${label} copiado.`, "success");
    } catch {
      addToast("No se pudo copiar al portapapeles.", "error");
    }
  }, [addToast]);

  const frameCount = Array.isArray(tpl?.frames) ? tpl!.frames!.length : null;
  const nameChanged = !!tpl && name.trim() !== tpl.name && name.trim().length > 0;

  return (
    <InspectorDrawer
      open
      onClose={onClose}
      ariaLabel={`Información de ${initialName || tpl?.name || "archivo"}`}
      eyebrow="Archivo · Second Brain"
      title={initialName || tpl?.name || "…"}
      actions={
        <button
          type="button"
          className="workspace-button"
          onClick={onOpen}
          title="Abrir este archivo en el editor"
        >
          Abrir
        </button>
      }
      storageKey="inspector-template-info"
    >
      {loading ? (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", padding: 40 }}>Cargando información…</div>
      ) : !tpl ? (
        <div style={{ textAlign: "center", color: "#fca5a5", padding: 40, fontSize: 13 }}>
          No se pudo cargar la información de este archivo.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 22 }}>
          {/* Nombre — editable (mismo rename que la tarjeta) */}
          <section>
            <h4 style={sectionTitle}>Nombre</h4>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); }}
                style={inputStyle}
                aria-label="Nombre del archivo"
              />
              <button
                type="button"
                className="workspace-button"
                disabled={!nameChanged || savingName}
                onClick={saveName}
                style={{ flexShrink: 0 }}
              >
                {savingName ? "…" : "Guardar"}
              </button>
            </div>
          </section>

          {/* Second Brain — design_file_meta, editable + sincronizable */}
          <section>
            <h4 style={sectionTitle}>Second Brain</h4>
            <div style={{ display: "grid", gap: 10 }}>
              <label>
                <span style={fieldLabel}>Marca (resuelve el vínculo en el CRM; crea una si no existe)</span>
                <input
                  value={brand}
                  onChange={e => { setBrand(e.target.value); setMetaDirty(true); }}
                  style={inputStyle}
                  placeholder="Ej: UContinental"
                  disabled={!meta}
                />
              </label>
              <label>
                <span style={fieldLabel}>Rama del grafo</span>
                <select
                  value={category}
                  onChange={e => { setCategory(e.target.value); setMetaDirty(true); }}
                  style={{ ...inputStyle, appearance: "auto" }}
                  disabled={!meta}
                >
                  {CATEGORIES.map(c => (
                    <option key={c || "none"} value={c}>{c || "Sin rama (cae en Archivos)"}</option>
                  ))}
                </select>
              </label>
              <label>
                <span style={fieldLabel}>Etiquetas (separadas por coma)</span>
                <input
                  value={tags}
                  onChange={e => { setTags(e.target.value); setMetaDirty(true); }}
                  style={inputStyle}
                  placeholder="social, landing…"
                  disabled={!meta}
                />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  className="workspace-button crm-toolbar-add"
                  disabled={!meta || !metaDirty || savingMeta}
                  onClick={saveMeta}
                >
                  {savingMeta ? "Sincronizando…" : "Sincronizar con Second Brain"}
                </button>
                {!meta && (
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                    Meta no disponible en esta sesión (sin Supabase).
                  </span>
                )}
              </div>
              {meta?.obsidian_link ? (
                <a
                  href={meta.obsidian_link}
                  target="_blank"
                  rel="noopener"
                  style={{ fontSize: 12, color: "#93c5fd", userSelect: "text" }}
                >
                  Abrir en Obsidian ↗
                </a>
              ) : null}
            </div>
          </section>

          {/* Detalles del archivo — solo lectura */}
          <section>
            <h4 style={sectionTitle}>Detalles del archivo</h4>
            <div>
              <div style={metaRow}><span style={metaKey}>Dimensiones</span><span style={metaValue}>{tpl.width} × {tpl.height}</span></div>
              <div style={metaRow}><span style={metaKey}>Frames</span><span style={metaValue}>{frameCount ?? "—"}</span></div>
              <div style={metaRow}><span style={metaKey}>Motor</span><span style={metaValue}>{tpl.engine || "html"}</span></div>
              <div style={metaRow}>
                <span style={metaKey}>Workspace</span>
                <span style={metaValue} title={tpl.workspaceId}>{tpl.workspaceId || "—"}</span>
              </div>
              <div style={metaRow}>
                <span style={metaKey}>Slug</span>
                <span style={{ ...metaValue, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tpl.slug || "—"}</span>
                  {tpl.slug ? (
                    <button type="button" onClick={() => copyText(tpl.slug!, "Slug")} title="Copiar slug"
                      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 12 }}>⧉</button>
                  ) : null}
                </span>
              </div>
              <div style={metaRow}>
                <span style={metaKey}>ID</span>
                <span style={{ ...metaValue, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tpl.id}</span>
                  <button type="button" onClick={() => copyText(tpl.id, "ID")} title="Copiar ID"
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 12 }}>⧉</button>
                </span>
              </div>
              {meta?.cover_image_url ? (
                <div style={metaRow}>
                  <span style={metaKey}>Portada</span>
                  <span style={metaValue}>
                    {meta.cover_source === "manual" ? "Curada (manual)" : "Automática"}
                    {meta.cover_captured_at ? ` · ${fmtDate(meta.cover_captured_at)}` : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          {/* Fechas */}
          <section>
            <h4 style={sectionTitle}>Fechas</h4>
            <div>
              <div style={metaRow}><span style={metaKey}>Creación</span><span style={metaValue}>{fmtDate(tpl.metadata?.createdAt || meta?.created_at)}</span></div>
              <div style={metaRow}><span style={metaKey}>Última modificación</span><span style={metaValue}>{fmtDate(tpl.metadata?.updatedAt || meta?.updated_at)}</span></div>
              <div style={metaRow}><span style={metaKey}>Contenido actualizado</span><span style={metaValue}>{fmtDate(meta?.content_updated_at || tpl.metadata?.contentUpdatedAt)}</span></div>
            </div>
          </section>
        </div>
      )}
    </InspectorDrawer>
  );
}
