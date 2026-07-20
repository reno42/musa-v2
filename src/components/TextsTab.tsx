import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { mcpCall } from "../lib/mcpClient";
import { useToast } from "./Toast";

// ── Types ──

interface TextEntry {
  templateId: string;
  templateName: string;
  frameId: string;
  frameName: string;
  layerId: string;
  layerName: string | null;
  tag: string;
  text: string;
  charCount: number;
}

interface TextsTabProps {
  workspaceId: string | null;
}

// ── Confirm Modal ──

interface ConfirmAction {
  type: "single-edit" | "bulk-edit" | "delete";
  entries: TextEntry[];
  newText?: string;
  edits?: { layerId: string; templateId: string; frameId: string; oldText: string; newText: string }[];
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
  onApply: (edits: { layerId: string; templateId: string; frameId: string; oldText: string; newText: string }[]) => void;
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

export function TextsTab({ workspaceId }: TextsTabProps) {
  const { addToast } = useToast();
  const [allTexts, setAllTexts] = useState<TextEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTpl, setFilterTpl] = useState<string>("");
  const [filterFrame, setFilterFrame] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [autoTagInfo, setAutoTagInfo] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Load texts ──
  const loadTexts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await mcpCall("list_all_texts", { workspaceId: workspaceId || undefined });
      const texts: TextEntry[] = result.texts || [];
      setAllTexts(texts);
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
  const templates = useMemo(() => {
    const map = new Map<string, string>();
    allTexts.forEach(t => map.set(t.templateId, t.templateName));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [allTexts]);

  const frames = useMemo(() => {
    const map = new Map<string, string>();
    allTexts
      .filter(t => !filterTpl || t.templateId === filterTpl)
      .forEach(t => map.set(t.frameId, t.frameName));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [allTexts, filterTpl]);

  // ── Filtered + searched ──
  const filteredTexts = useMemo(() => {
    let result = allTexts;
    if (filterTpl) result = result.filter(t => t.templateId === filterTpl);
    if (filterFrame) result = result.filter(t => t.frameId === filterFrame);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.text.toLowerCase().includes(q) ||
        t.templateName.toLowerCase().includes(q) ||
        t.frameName.toLowerCase().includes(q) ||
        (t.layerName || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [allTexts, filterTpl, filterFrame, searchQuery]);

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
          frameId: entry.frameId,
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
              frameId: edit.frameId,
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
  const applyBulkEdits = (edits: { layerId: string; templateId: string; frameId: string; oldText: string; newText: string }[]) => {
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

        {/* Template filter */}
        <select
          value={filterTpl}
          onChange={e => { setFilterTpl(e.target.value); setFilterFrame(""); }}
          style={{
            padding: "8px 12px", borderRadius: 100, fontSize: 13,
            border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)",
            color: "rgba(255,255,255,0.7)", cursor: "pointer",
          }}
        >
          <option value="">All Templates ({templates.length})</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        {/* Frame filter */}
        <select
          value={filterFrame}
          onChange={e => setFilterFrame(e.target.value)}
          disabled={!filterTpl && frames.length === 0}
          style={{
            padding: "8px 12px", borderRadius: 100, fontSize: 13,
            border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)",
            color: "rgba(255,255,255,0.7)", cursor: "pointer",
            opacity: (!filterTpl && frames.length === 0) ? 0.4 : 1,
          }}
        >
          <option value="">All Frames ({frames.length})</option>
          {frames.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

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

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {loading && allTexts.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 80, fontSize: 14 }}>
            Cargando textos…
          </div>
        ) : filteredTexts.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: 80, fontSize: 14 }}>
            {allTexts.length === 0 ? "No hay textos en los diseños todavía." : "Sin resultados para los filtros."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <th style={{
                  padding: "10px 8px", textAlign: "left", background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)",
                  borderBottom: "1px solid rgba(255,255,255,0.06)", width: 36,
                }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredTexts.length && filteredTexts.length > 0}
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer", accentColor: "#8b5cf6" }}
                  />
                </th>
                <th style={{ padding: "10px 12px", textAlign: "left", background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, minWidth: 200 }}>
                  Texto
                </th>
                <th style={{ padding: "10px 12px", textAlign: "left", background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, minWidth: 120 }}>
                  Frame
                </th>
                <th style={{ padding: "10px 12px", textAlign: "left", background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, minWidth: 120 }}>
                  Archivo
                </th>
                <th style={{ padding: "10px 12px", textAlign: "center", background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, width: 60 }}>
                  Tag
                </th>
                <th style={{ padding: "10px 12px", textAlign: "center", background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.06)", width: 90 }}>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTexts.map((entry, i) => {
                const isSelected = selectedIds.has(entry.layerId);
                const isEditing = editingId === entry.layerId;
                return (
                  <tr
                    key={entry.layerId}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      background: isSelected ? "rgba(139,92,246,0.05)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      transition: "background 0.15s",
                    }}
                  >
                    {/* Checkbox */}
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(entry.layerId)}
                        style={{ cursor: "pointer", accentColor: "#8b5cf6" }}
                      />
                    </td>

                    {/* Text (editable) */}
                    <td style={{ padding: "8px 12px", maxWidth: 400 }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6 }}>
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
                              flex: 1, padding: "5px 8px", borderRadius: 6, fontSize: 13,
                              border: "1px solid rgba(139,92,246,0.4)", background: "rgba(0,0,0,0.3)",
                              color: "#fff", outline: "none",
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          onClick={() => startEdit(entry)}
                          style={{
                            cursor: "pointer", color: "rgba(255,255,255,0.8)",
                            maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis",
                            whiteSpace: "nowrap", padding: "4px 6px", borderRadius: 4,
                            border: "1px solid transparent",
                          }}
                          title="Click para editar"
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.2)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}
                        >
                          {entry.text || <span style={{ color: "rgba(255,255,255,0.2)", fontStyle: "italic" }}>(vacío)</span>}
                        </div>
                      )}
                    </td>

                    {/* Frame */}
                    <td style={{ padding: "8px 12px", color: "rgba(255,255,255,0.4)", fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.frameName}
                    </td>

                    {/* Template */}
                    <td style={{ padding: "8px 12px", color: "rgba(139,92,246,0.5)", fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.templateName}
                    </td>

                    {/* Tag */}
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <span style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: 100,
                        background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)",
                        fontFamily: "monospace",
                      }}>
                        {entry.tag}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "rgba(255,255,255,0.3)", fontSize: 14, padding: "4px 6px", borderRadius: 4,
                          }}
                          title="Editar"
                        >✏️</button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "rgba(248,113,113,0.4)", fontSize: 14, padding: "4px 6px", borderRadius: 4,
                          }}
                          title="Eliminar"
                        >🗑️</button>
                      </div>
                    </td>
                  </tr>
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
            <span>{templates.length} diseño{templates.length !== 1 ? "s" : ""} · {frames.length} frame{frames.length !== 1 ? "s" : ""}</span>
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
