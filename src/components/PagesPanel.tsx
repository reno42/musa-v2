import { useState, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";
import { getTemplate } from "../lib/templateApi";
import { IconX, IconCheck } from "../shared/icons";

interface PageItem {
  id: string;
  name: string;
  order: number;
  canvas?: { objects?: any[]; background?: string };
}

interface PagesPanelProps {
  templateId: string | null;
  onPageChange: () => void;
}

export function PagesPanel({ templateId, onPageChange }: PagesPanelProps) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const loadPages = useCallback(async () => {
    if (!templateId) return;
    try {
      const tpl = await getTemplate(templateId);
      const p = (tpl as any)?.metadata?.pages || [];
      setPages(p);
      // Determine active page from metadata
      setActivePageId((tpl as any)?.metadata?.activePageId || (p.length > 0 ? p[0].id : null));
    } catch { /* silent */ }
  }, [templateId]);

  useEffect(() => { loadPages(); }, [loadPages]);

  const handleAdd = async () => {
    if (!templateId || !newPageName.trim()) return;
    setLoading(true);
    try {
      await mcpCall("canvas_pages", { templateId, action: "add", pageName: newPageName.trim() });
      setShowAdd(false);
      setNewPageName("");
      await loadPages();
    } catch { /* silent */ }
    setLoading(false);
  };

  const handleSwitch = async (pageId: string) => {
    if (!templateId || pageId === activePageId) return;
    setLoading(true);
    try {
      await mcpCall("canvas_pages", { templateId, action: "set_active", pageId });
      setActivePageId(pageId);
      // Reload the template to get the new page's canvas
      const tpl = await getTemplate(templateId);
      if (tpl && tpl.canvas) {
        // Store canvas JSON on window for CanvasEditor to pick up
        (window as any).__pageCanvas = tpl.canvas;
      }
      onPageChange();
    } catch { /* silent */ }
    setLoading(false);
  };

  const handleDelete = async (pageId: string) => {
    if (!templateId || pages.length <= 1) return;
    setLoading(true);
    try {
      await mcpCall("canvas_pages", { templateId, action: "remove", pageId });
      await loadPages();
    } catch { /* silent */ }
    setLoading(false);
  };

  const handleRename = async (pageId: string) => {
    if (!templateId || !renameValue.trim()) return;
    try {
      // canvas_pages doesn't directly support rename, but we update locally
      const updated = pages.map(p => p.id === pageId ? { ...p, name: renameValue.trim() } : p);
      setPages(updated);
      setRenamingId(null);
    } catch { /* silent */ }
  };

  const maxOrder = pages.reduce((max, p) => Math.max(max, p.order || 0), 0);

  return (
    <div className="glass-panel" style={{
      height: 34, display: "flex", alignItems: "center", gap: 2,
      padding: "0 8px", overflowX: "auto", flexShrink: 0,
    }}>
      {/* Page tabs */}
      {pages.map(page => {
        const isActive = page.id === activePageId;
        const isRenaming = renamingId === page.id;

        return (
          <div key={page.id} style={{
            display: "flex", alignItems: "center", gap: 2,
            padding: isActive ? "3px 8px" : "3px 6px",
            borderRadius: "4px 4px 0 0",
            background: isActive ? "#1a1a2e" : "transparent",
            border: isActive ? "1px solid #2a2a4a" : "1px solid transparent",
            borderBottom: isActive ? "2px solid #c8b898" : "2px solid transparent",
            cursor: "pointer", fontSize: 11, color: isActive ? "#f0ebe0" : "#7a7668",
            fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap",
            transition: "background 0.15s",
          }} onClick={() => handleSwitch(page.id)}>
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleRename(page.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onBlur={() => setRenamingId(null)}
                style={{
                  background: "#0a0a14", border: "1px solid #2a2a4a",
                  color: "#f0ebe0", borderRadius: 3, padding: "1px 4px",
                  fontSize: 11, width: 80,
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span onDoubleClick={() => { setRenamingId(page.id); setRenameValue(page.name); }}>
                {page.name || `Page ${page.order ?? "?"}`}
              </span>
            )}

            {pages.length > 1 && !isRenaming && (
              <button type="button" onClick={e => { e.stopPropagation(); handleDelete(page.id); }}
                style={{
                  background: "none", border: "none", color: "#4a4a60",
                  cursor: "pointer", fontSize: 10, padding: "1px 2px", lineHeight: 1,
                }} title="Delete page">
                <IconX size={12} />
              </button>
            )}
          </div>
        );
      })}

      {/* Add page button */}
      {showAdd ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            autoFocus
            value={newPageName}
            onChange={e => setNewPageName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setShowAdd(false); setNewPageName(""); }
            }}
            placeholder={`Page ${maxOrder + 2}`}
            style={{
              background: "#0a0a14", border: "1px solid #2a2a4a",
              color: "#f0ebe0", borderRadius: 4, padding: "2px 6px",
              fontSize: 11, width: 100,
            }}
          />
          <button type="button" onClick={handleAdd} disabled={loading || !newPageName.trim()}
            style={{
              padding: "2px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
              background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80",
            }}><IconCheck size={14} /></button>
        </div>
      ) : (
        <button type="button" onClick={() => { setShowAdd(true); setNewPageName(""); }}
          style={{
            padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
            background: "transparent", border: "1px solid transparent",
            color: "#7a7668", marginLeft: 4,
          }} title="Add page">
          + Page
        </button>
      )}

      {loading && <span style={{ fontSize: 10, color: "#7a7668", marginLeft: 8 }}>Loading...</span>}
    </div>
  );
}
