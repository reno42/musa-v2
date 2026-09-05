import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { mcpCall } from "../lib/mcpClient";
import { apiFetch } from "../lib/supabase";
import { useToast } from "./Toast";

// ── Types ──

interface TextEntry {
  templateId: string;
  templateName: string;
  frameId: string | null;
  frameName: string;
  location: "frame" | "canvas";
  layerId: string;
  layerName: string | null;
  tag: string;
  text: string;
  charCount: number;
  brand: string;
  campaign: string;
  format: string;
  fileType: string;
}

interface TemplateMeta {
  templateId: string;
  templateName: string;
  updatedAt: string;
  brand: string;
  campaign: string;
  format: string;
  fileType: string;
  obsidianLink: string;
  coverImage: string | null;
  frameCount: number;
}

interface TextsTabProps {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
  /** Slot for the Conexiones gear — mounts it on this row, same height as
      the filters and the search bar (v55: actions never float alone). */
  actions?: React.ReactNode;
}

// ── Confirm Modal ──

interface ConfirmAction {
  type: "single-edit" | "bulk-edit" | "delete";
  entries: TextEntry[];
  newText?: string;
  edits?: { layerId: string; templateId: string; frameId: string | null; oldText: string; newText: string }[];
}

function ConfirmModal({
  action, onConfirm, onCancel,
}: {
  action: ConfirmAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isBulk = action.type === "bulk-edit";
  const isDelete = action.type === "delete";
  const count = action.entries.length;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          border: "1px solid rgba(139,92,246,0.3)", borderRadius: 16,
          padding: 28, maxWidth: 520, width: "90%", maxHeight: "80vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: isDelete ? "rgba(248,113,113,0.15)" : "rgba(250,204,21,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
          }}>
            {isDelete ? "🗑️" : "⚠️"}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>
              {isDelete ? `Eliminar ${count} texto${count > 1 ? "s" : ""}` : isBulk ? `Editar ${count} textos` : "Modificar texto"}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              {isDelete ? "Los elementos se eliminarán del diseño" : "Los cambios se guardarán en el diseño"}
            </div>
          </div>
        </div>

        {/* Summary of changes */}
        <div style={{
          background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14,
          maxHeight: 240, overflowY: "auto", marginBottom: 18,
        }}>
          {((isBulk ? action.edits : action.entries.map(e => ({
            layerId: e.layerId, templateId: e.templateId, frameId: e.frameId,
            oldText: e.text,
            newText: isDelete ? "(eliminar)" : action.newText || e.text,
          }))) || []).slice(0, 50).map((edit, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, alignItems: "flex-start",
              padding: "6px 0", borderBottom: i < 49 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}>
              <span style={{ fontSize: 16, lineHeight: "22px", color: "rgba(255,255,255,0.3)", minWidth: 20, textAlign: "right" }}>{i + 1}.</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "rgba(139,92,246,0.6)", marginBottom: 2 }}>
                  {action.entries[i]?.templateName} → {action.entries[i]?.frameName}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 13, color: "rgba(255,255,255,0.5)",
                    textDecoration: isDelete ? "line-through" : "none",
                    maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>"{edit.oldText}"</span>
                  {!isDelete && (
                    <>
                      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>→</span>
                      <span style={{
                        fontSize: 13, color: "#a78bfa", fontWeight: 500,
                        maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>"{edit.newText}"</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {((isBulk ? action.edits : action.entries) || []).length > 50 && (
            <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              y {((isBulk ? action.edits : action.entries) || []).length - 50} más…
            </div>
          )}
        </div>

        <div style={{
          fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 18,
          display: "flex", gap: 6, alignItems: "center",
        }}>
          <span>💡</span>
          <span>Si tienes el editor abierto con estos diseños, deberás recargar para ver los cambios.</span>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 500,
              border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
              color: "rgba(255,255,255,0.6)", cursor: "pointer",
            }}
          >Cancelar</button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: "none", cursor: "pointer",
              background: isDelete
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #8b5cf6, #6366f1)",
              color: "#fff",
              boxShadow: isDelete
                ? "0 4px 14px rgba(239,68,68,0.3)"
                : "0 4px 14px rgba(139,92,246,0.3)",
            }}
          >
            {isDelete ? `Eliminar ${count}` : `Confirmar ${count} cambio${count > 1 ? "s" : ""}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Bulk Edit Modal ──

function BulkEditModal({
  entries, onApply, onCancel,
}: {
  entries: TextEntry[];
  onApply: (edits: { layerId: string; templateId: string; frameId: string | null; oldText: string; newText: string }[]) => void;
  onCancel: () => void;
}) {
  const [edits, setEdits] = useState(() =>
    entries.map(e => ({ layerId: e.layerId, templateId: e.templateId, frameId: e.frameId, oldText: e.text, newText: e.text }))
  );

  const changedCount = edits.filter(e => e.newText !== e.oldText).length;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          border: "1px solid rgba(139,92,246,0.3)", borderRadius: 16,
          padding: 24, maxWidth: 680, width: "92%", maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Edición masiva</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              {entries.length} textos · {changedCount} modificados
            </div>
          </div>
          <button type="button" onClick={onCancel} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 20, padding: 4,
          }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {edits.map((edit, i) => (
            <div key={edit.layerId} style={{
              display: "flex", gap: 8, alignItems: "center",
              padding: "8px 10px", borderRadius: 8,
              background: edit.newText !== edit.oldText ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.02)",
              border: edit.newText !== edit.oldText ? "1px solid rgba(139,92,246,0.15)" : "1px solid rgba(255,255,255,0.04)",
            }}>
              <span style={{
                fontSize: 10, color: entries[i] ? "rgba(255,255,255,0.3)" : "transparent",
                minWidth: 24, textAlign: "right",
              }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "rgba(139,92,246,0.5)", marginBottom: 2 }}>
                  {entries[i]?.templateName} → {entries[i]?.frameName} · &lt;{entries[i]?.tag}&gt;
                </div>
                <input
                  type="text"
                  value={edit.newText}
                  onChange={e => {
                    const next = [...edits];
                    next[i] = { ...next[i], newText: e.target.value };
                    setEdits(next);
                  }}
                  style={{
                    width: "100%", padding: "6px 10px", borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(0,0,0,0.2)", color: "#fff", fontSize: 13,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button type="button" onClick={onCancel} style={{
            padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 500,
            border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
            color: "rgba(255,255,255,0.6)", cursor: "pointer",
          }}>Cancelar</button>
          <button
            type="button"
            disabled={changedCount === 0}
            onClick={() => onApply(edits.filter(e => e.newText !== e.oldText))}
            style={{
              padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: "none", cursor: changedCount === 0 ? "not-allowed" : "pointer",
              opacity: changedCount === 0 ? 0.4 : 1,
              background: "linear-gradient(135deg, #8b5cf6, #6366f1)", color: "#fff",
              boxShadow: "0 4px 14px rgba(139,92,246,0.3)",
            }}
          >Aplicar {changedCount} cambio{changedCount !== 1 ? "s" : ""}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Component ──

const selectStyle: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 100, fontSize: 13,
  border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)",
  color: "rgba(255,255,255,0.7)", cursor: "pointer",
};

const colTh = (w?: number): React.CSSProperties => ({
  padding: "10px 8px", textAlign: "left",
  background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.35)", fontSize: 10,
  textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 500,
  ...(w ? { width: w } : {}),
});

const colTd: React.CSSProperties = {
  padding: "8px 8px", verticalAlign: "middle",
};

const actionBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "rgba(255,255,255,0.3)", fontSize: 14, padding: "4px 6px", borderRadius: 4,
};

export function TextsTab({ workspaceId, onOpenTemplate, actions }: TextsTabProps) {
  const { addToast } = useToast();
  const [allTexts, setAllTexts] = useState<TextEntry[]>([]);
  const [templateMetaMap, setTemplateMetaMap] = useState<Map<string, TemplateMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBrand, setFilterBrand] = useState<string>("");
  const [filterCampaign, setFilterCampaign] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [autoTagInfo, setAutoTagInfo] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Load texts ──
  const loadTexts = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      // Lightweight REST endpoint: no iframe HTML/CSS, just text + template metadata
      const result = await apiFetch<{ success: boolean; texts: TextEntry[]; templateMeta: TemplateMeta[]; autoTagged: number; templatesUpdated: number }>(
        `/api/workspaces/${workspaceId}/texts`,
      );
      const texts: TextEntry[] = result.texts || [];
      const metaArr: TemplateMeta[] = result.templateMeta || [];
      const metaMap = new Map<string, TemplateMeta>();
      for (const m of metaArr) metaMap.set(m.templateId, m);
      setAllTexts(texts);
      setTemplateMetaMap(metaMap);
      if (result.autoTagged > 0) {
        setAutoTagInfo(`${result.autoTagged} textos auto-etiquetados en ${result.templatesUpdated} diseño(s)`);
        setTimeout(() => setAutoTagInfo(null), 5000);
      }
    } catch (err: any) {
      console.error("[TextsTab] loadTexts failed:", err);
      addToast("Error al cargar textos: " + (err?.message || ""), "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, addToast]);

  useEffect(() => { loadTexts(); }, [loadTexts]);

  // ── Derived filter options ──
  const brands = useMemo(() => {
    const set = new Set<string>();
    allTexts.forEach(t => { if (t.brand) set.add(t.brand); });
    return [...set].sort();
  }, [allTexts]);

  const campaigns = useMemo(() => {
    const set = new Set<string>();
    allTexts.forEach(t => { if (t.campaign) set.add(t.campaign); });
    return [...set].sort();
  }, [allTexts]);

  // ── Filtered + searched ──
  const filteredTexts = useMemo(() => {
    let result = allTexts;
    if (filterBrand) result = result.filter(t => t.brand === filterBrand);
    if (filterCampaign) result = result.filter(t => t.campaign === filterCampaign);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.text.toLowerCase().includes(q) ||
        t.templateName.toLowerCase().includes(q) ||
        t.frameName.toLowerCase().includes(q) ||
        (t.layerName || "").toLowerCase().includes(q) ||
        t.brand.toLowerCase().includes(q) ||
        t.campaign.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allTexts, filterBrand, filterCampaign, searchQuery]);

  // ── Group filtered texts by template (one row per file) ──
  const grouped = useMemo(() => {
    const map = new Map<string, TextEntry[]>();
    for (const t of filteredTexts) {
      if (!map.has(t.templateId)) map.set(t.templateId, []);
      map.get(t.templateId)!.push(t);
    }
    return [...map.entries()].map(([templateId, texts]) => {
      // Sub-group texts by frameName (preserve insertion order = DOM order)
      const frameMap = new Map<string, TextEntry[]>();
      for (const t of texts) {
        const fname = t.frameName || "Sin frame";
        if (!frameMap.has(fname)) frameMap.set(fname, []);
        frameMap.get(fname)!.push(t);
      }
      return {
        templateId,
        meta: templateMetaMap.get(templateId),
        texts,
        frames: [...frameMap.entries()].map(([frameName, frameTexts]) => ({ frameName, frameTexts })),
      };
    });
  }, [filteredTexts, templateMetaMap]);

  // ── Date formatter ──
  const fmtDate = (iso: string) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return ""; }
  };

  // ── Accordion toggle ──
  const toggleExpand = (templateId: string) => {
    setExpandedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const expandAll = () => {
    if (expandedTemplates.size === grouped.length) {
      setExpandedTemplates(new Set());
    } else {
      setExpandedTemplates(new Set(grouped.map(g => g.templateId)));
    }
  };

  // ── Debounced search ──
  const handleSearch = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(val), 200);
  }, []);

  // ── Inline edit ──
  const startEdit = (entry: TextEntry) => {
    setEditingId(entry.layerId);
    setEditValue(entry.text);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const commitInlineEdit = (entry: TextEntry) => {
    if (editValue === entry.text) { setEditingId(null); return; }
    setConfirmAction({
      type: "single-edit", entries: [entry], newText: editValue,
    });
  };

  // ── Delete ──
  const handleDelete = (entry: TextEntry) => {
    setConfirmAction({ type: "delete", entries: [entry] });
  };

  // ── Bulk select ──
  const toggleSelect = (layerId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  const toggleSelectTemplate = (templateId: string, textLayerIds: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = textLayerIds.every(id => next.has(id));
      if (allSelected) {
        textLayerIds.forEach(id => next.delete(id));
      } else {
        textLayerIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTexts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTexts.map(t => t.layerId)));
    }
  };

  const handleBulkDelete = () => {
    const selected = filteredTexts.filter(t => selectedIds.has(t.layerId));
    if (selected.length === 0) return;
    setConfirmAction({ type: "delete", entries: selected });
  };

  // ── Apply confirmed action ──
  const applyAction = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setLoading(true);

    try {
      if (action.type === "delete") {
        // Delete each element via remove_element
        let successCount = 0;
        for (const entry of action.entries) {
          try {
            await mcpCall("remove_element", {
              templateId: entry.templateId,
              frameId: entry.frameId,
              elementId: entry.layerId,
            });
            successCount++;
          } catch (e) {
            console.error("[TextsTab] delete failed for", entry.layerId, e);
          }
        }
        addToast(`${successCount} texto(s) eliminado(s)`, "success");
      } else if (action.type === "single-edit") {
        const entry = action.entries[0];
        await mcpCall("edit_text_content", {
          templateId: entry.templateId,
          frameId: entry.frameId || undefined,
          layerId: entry.layerId,
          text: action.newText!,
        });
        addToast("Texto actualizado", "success");
      } else if (action.type === "bulk-edit") {
        let successCount = 0;
        for (const edit of action.edits || []) {
          try {
            await mcpCall("edit_text_content", {
              templateId: edit.templateId,
              frameId: edit.frameId || undefined,
              layerId: edit.layerId,
              text: edit.newText,
            });
            successCount++;
          } catch (e) {
            console.error("[TextsTab] bulk edit failed for", edit.layerId, e);
          }
        }
        addToast(`${successCount} texto(s) actualizado(s)`, "success");
      }

      // Reload from server to reflect changes
      setSelectedIds(new Set());
      setEditingId(null);
      await loadTexts();
    } catch (err: any) {
      addToast("Error: " + (err?.message || ""), "error");
    } finally {
      setLoading(false);
    }
  };

  // ── Apply bulk edits from modal ──
  const applyBulkEdits = (edits: { layerId: string; templateId: string; frameId: string | null; oldText: string; newText: string }[]) => {
    const entries = edits.map(e => allTexts.find(t => t.layerId === e.layerId)!).filter(Boolean);
    setConfirmAction({ type: "bulk-edit", entries, edits });
    setShowBulkEdit(false);
  };

  const selectedEntries = useMemo(
    () => filteredTexts.filter(t => selectedIds.has(t.layerId)),
    [filteredTexts, selectedIds]
  );

  // ── Render ──
  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        {/* Sync button */}
        <button
          type="button"
          onClick={loadTexts}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 100, fontSize: 13, fontWeight: 500,
            border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)",
            color: "#a78bfa", cursor: loading ? "wait" : "pointer", whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>⟳</span>
          Sincronizar
        </button>

        {/* Brand filter */}
        <select
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
          style={selectStyle}
        >
          <option value="">Marcas ({brands.length})</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>

        {/* Campaign filter */}
        <select
          value={filterCampaign}
          onChange={e => setFilterCampaign(e.target.value)}
          style={selectStyle}
        >
          <option value="">Campañas ({campaigns.length})</option>
          {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Expand / Collapse all */}
        {grouped.length > 0 && (
          <button
            type="button"
            onClick={expandAll}
            style={{
              ...selectStyle,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {expandedTemplates.size === grouped.length ? "Contraer todo" : "Expandir todo"}
          </button>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Buscar texto…"
          onChange={e => handleSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 150, padding: "8px 14px", borderRadius: 100, fontSize: 13,
            border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)",
            color: "#fff", outline: "none",
          }}
        />

        {actions}

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              {selectedIds.size} seleccionado{selectedIds.size > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => setShowBulkEdit(true)}
              style={{
                padding: "8px 14px", borderRadius: 100, fontSize: 12, fontWeight: 600,
                border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.1)",
                color: "#a78bfa", cursor: "pointer",
              }}
            >✏️ Editar</button>
            <button
              type="button"
              onClick={handleBulkDelete}
              style={{
                padding: "8px 14px", borderRadius: 100, fontSize: 12, fontWeight: 600,
                border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.1)",
                color: "#f87171", cursor: "pointer",
              }}
            >🗑️ Eliminar</button>
          </>
        )}
      </div>

      {/* Auto-tag notification */}
      <AnimatePresence>
        {autoTagInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            style={{
              background: "rgba(139,92,246,0.08)", borderBottom: "1px solid rgba(139,92,246,0.15)",
              padding: "8px 20px", fontSize: 12, color: "#a78bfa",
              display: "flex", alignItems: "center", gap: 8, overflow: "hidden",
            }}
          >
            <span>✨</span>
            <span>{autoTagInfo}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table: one row per file, expandable dropdown shows texts grouped by frame */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {loading && allTexts.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 80, fontSize: 14 }}>
            Cargando textos…
          </div>
        ) : grouped.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: 80, fontSize: 14 }}>
            {allTexts.length === 0 ? "No hay textos en los diseños todavía." : "Sin resultados para los filtros."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <th style={colTh(28)}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredTexts.length && filteredTexts.length > 0}
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer", accentColor: "#8b5cf6" }}
                  />
                </th>
                <th style={{ ...colTh(28), textAlign: "center" }}></th>
                <th style={{ ...colTh(200), minWidth: 140 }}>Título</th>
                <th style={colTh(110)}>Red social</th>
                <th style={colTh(90)}>Formato</th>
                <th style={colTh(90)}>Fecha</th>
                <th style={colTh(80)}>Estado</th>
                <th style={{ ...colTh(80), textAlign: "right" }}>Archivo</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ templateId, meta, texts, frames }) => {
                const isExpanded = expandedTemplates.has(templateId);
                const layerIds = texts.map(t => t.layerId);
                const allSelected = layerIds.every(id => selectedIds.has(id));
                const someSelected = layerIds.some(id => selectedIds.has(id));
                const handleOpen = onOpenTemplate ? () => onOpenTemplate(templateId) : undefined;
                const brand = meta?.brand || texts[0].brand || "";
                const format = meta?.format || texts[0].format || "";
                const date = fmtDate(meta?.updatedAt || "");
                const COLSPAN = 8;

                return (
                  <Fragment key={templateId}>
                    {/* ── File row ── */}
                    <tr
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        transition: "background 0.15s",
                        cursor: "pointer",
                      }}
                      onClick={() => toggleExpand(templateId)}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Checkbox */}
                      <td style={colTd}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                          onChange={() => toggleSelectTemplate(templateId, layerIds)}
                          onClick={e => e.stopPropagation()}
                          style={{ cursor: "pointer", accentColor: "#8b5cf6" }}
                        />
                      </td>

                      {/* Expand toggle */}
                      <td style={{ ...colTd, textAlign: "center" }}>
                        <span style={{
                          fontSize: 12, color: "rgba(255,255,255,0.4)",
                          transition: "transform 0.2s",
                          transform: isExpanded ? "rotate(90deg)" : "none",
                          display: "inline-block",
                        }}>▸</span>
                      </td>

                      {/* Título */}
                      <td style={{ ...colTd, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>
                        <span
                          style={{
                            maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            display: "inline-block",
                          }}
                          title={texts[0].templateName}
                        >
                          {texts[0].templateName}
                        </span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginLeft: 6 }}>
                          ({texts.length})
                        </span>
                      </td>

                      {/* Red social */}
                      <td style={colTd}>
                        {brand
                          ? <span style={{ fontSize: 11, color: "rgba(91,156,246,0.8)" }}>{brand}</span>
                          : <span style={{ color: "rgba(255,255,255,0.12)" }}>—</span>
                        }
                      </td>

                      {/* Formato */}
                      <td style={colTd}>
                        {format
                          ? <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(139,92,246,0.08)", color: "rgba(139,92,246,0.7)", textTransform: "capitalize" }}>{format}</span>
                          : <span style={{ color: "rgba(255,255,255,0.12)" }}>—</span>
                        }
                      </td>

                      {/* Fecha */}
                      <td style={{ ...colTd, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                        {date || "—"}
                      </td>

                      {/* Estado */}
                      <td style={colTd}>
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 100,
                          background: "rgba(52,211,153,0.08)", color: "rgba(52,211,153,0.6)",
                        }}>Activo</span>
                      </td>

                      {/* Archivo (open link) */}
                      <td style={{ ...colTd, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          {handleOpen && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleOpen(); }}
                              style={{ ...actionBtnStyle, color: "rgba(139,92,246,0.5)" }}
                              title="Abrir en editor"
                            >↗</button>
                          )}
                          {meta?.obsidianLink && (
                            <a
                              href={meta.obsidianLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              title="Obsidian"
                              style={{ ...actionBtnStyle, color: "rgba(255,200,100,0.4)", textDecoration: "none" }}
                            >🔗</a>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── Expanded row: texts grouped by frame ── */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={COLSPAN} style={{ padding: 0, background: "rgba(0,0,0,0.15)" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <tbody>
                              {frames.map(({ frameName, frameTexts }, fi) => {
                                return (
                                <Fragment key={`${templateId}-f-${fi}`}>
                                  {/* Frame group header */}
                                  <tr>
                                    <td colSpan={COLSPAN} style={{
                                      padding: "6px 16px 4px 44px",
                                      fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
                                      color: "rgba(139,92,246,0.4)",
                                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                                    }}>
                                      {frameName}
                                      <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.15)", marginLeft: 6 }}>
                                        · {frameTexts.length} texto{frameTexts.length !== 1 ? "s" : ""}
                                      </span>
                                    </td>
                                  </tr>

                                  {/* Text lines within this frame */}
                                  {frameTexts.map((entry, j) => {
                                    const isSelected = selectedIds.has(entry.layerId);
                                    const isEditing = editingId === entry.layerId;
                                    return (
                                      <tr
                                        key={entry.layerId || `${fi}-${j}`}
                                        style={{
                                          background: isSelected ? "rgba(139,92,246,0.04)" : "transparent",
                                        }}
                                      >
                                        {/* Checkbox */}
                                        <td style={{ width: 28, padding: "4px 4px 4px 44px", verticalAlign: "middle" }}>
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(entry.layerId)}
                                            style={{ cursor: "pointer", accentColor: "#8b5cf6" }}
                                          />
                                        </td>
                                        {/* Empty cell (was expand col) */}
                                        <td style={{ width: 28 }} />
                                        {/* Text content (editable) */}
                                        <td style={{ padding: "3px 8px", verticalAlign: "middle", minWidth: 200 }}>
                                          {isEditing ? (
                                            <input
                                              ref={editInputRef}
                                              type="text"
                                              value={editValue}
                                              onChange={e => setEditValue(e.target.value)}
                                              onBlur={() => commitInlineEdit(entry)}
                                              onKeyDown={e => {
                                                if (e.key === "Enter") commitInlineEdit(entry);
                                                if (e.key === "Escape") setEditingId(null);
                                              }}
                                              style={{
                                                width: "100%", padding: "4px 8px", borderRadius: 6, fontSize: 12,
                                                border: "1px solid rgba(139,92,246,0.4)", background: "rgba(0,0,0,0.3)",
                                                color: "#fff", outline: "none",
                                              }}
                                            />
                                          ) : (
                                            <div
                                              onClick={e => { e.stopPropagation(); startEdit(entry); }}
                                              style={{
                                                cursor: "pointer", color: "rgba(255,255,255,0.75)",
                                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                padding: "3px 6px", borderRadius: 4, border: "1px solid transparent",
                                              }}
                                              title="Click para editar"
                                              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.2)"; }}
                                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}
                                            >
                                              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", marginRight: 6 }}>{entry.tag}</span>
                                              {entry.text || <span style={{ color: "rgba(255,255,255,0.2)", fontStyle: "italic" }}>(vacío)</span>}
                                            </div>
                                          )}
                                        </td>
                                        {/* Empty cells to maintain table alignment */}
                                        <td />
                                        <td />
                                        <td />
                                        <td />
                                        {/* Actions */}
                                        <td style={{ textAlign: "right", padding: "3px 8px", verticalAlign: "middle" }}>
                                          <button type="button" onClick={(e) => { e.stopPropagation(); startEdit(entry); }} style={actionBtnStyle} title="Editar">✏️</button>
                                          <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(entry); }} style={{ ...actionBtnStyle, color: "rgba(248,113,113,0.4)" }} title="Eliminar">🗑️</button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Summary */}
        {filteredTexts.length > 0 && (
          <div style={{
            padding: "12px 0", fontSize: 12, color: "rgba(255,255,255,0.25)",
            display: "flex", justifyContent: "space-between",
          }}>
            <span>{filteredTexts.length} texto{filteredTexts.length !== 1 ? "s" : ""}</span>
            <span>{grouped.length} archivo{grouped.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showBulkEdit && selectedEntries.length > 0 && (
          <BulkEditModal
            entries={selectedEntries}
            onApply={applyBulkEdits}
            onCancel={() => setShowBulkEdit(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmAction && (
          <ConfirmModal
            action={confirmAction}
            onConfirm={applyAction}
            onCancel={() => { setConfirmAction(null); setEditingId(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
