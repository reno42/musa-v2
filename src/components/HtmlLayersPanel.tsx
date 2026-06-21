import { useState, useCallback } from "react";
import type { LayerNode } from "../hooks/useLayerTree";
import { useLayerTree, reorderLayerInHtml, groupLayersInHtml, ungroupLayerInHtml } from "../hooks/useLayerTree";

interface Props {
  html: string;
  frameId: string;
  selectedElementId: string | null;
  onSelectElement: (layerId: string, path?: number[]) => void;
  onHtmlChange: (newHtml: string) => void;
  onLayerDelete?: (layerId: string) => void;
  onLayerDuplicate?: (layerId: string) => void;
}

const panelStyle: React.CSSProperties = {
  width: 260,
  background: "rgba(18,18,36,0.85)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8,
  color: "#e0e0e0",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  maxHeight: "100%",
};

const TAGS_WITH_ICONS: Record<string, string> = {
  h1: "H1", h2: "H2", h3: "H3", h4: "H4", h5: "H5", h6: "H6",
  p: "¶", span: "S", a: "🔗", button: "▢", img: "🖼",
  svg: "📐", div: "▣", section: "§", header: "⌂", footer: "⊥",
  nav: "☰", main: "⛶", ul: "≡", ol: "≣", li: "•",
  input: "✎", form: "▤", label: "Ⓛ",
};

function tagIcon(tag: string): string {
  return TAGS_WITH_ICONS[tag.toLowerCase()] || tag.substring(0, 1).toUpperCase();
}

function tagColor(tag: string): string {
  const t = tag.toLowerCase();
  if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(t)) return "#c8b898";
  if (["p", "span", "a"].includes(t)) return "#a8c8e8";
  if (["div", "section", "article", "header", "footer", "nav", "main"].includes(t)) return "#8ab8a8";
  if (["img", "svg"].includes(t)) return "#e8c8a8";
  if (["ul", "ol", "li"].includes(t)) return "#c8a8e8";
  return "#888";
}

export function HtmlLayersPanel({
  html, frameId, selectedElementId,
  onSelectElement, onHtmlChange, onLayerDelete, onLayerDuplicate,
}: Props) {
  const layers = useLayerTree(html);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerId: string } | null>(null);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const handleClick = useCallback((layer: LayerNode, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setMultiSelect(prev => {
        const next = new Set(prev);
        if (next.has(layer.layerId)) next.delete(layer.layerId);
        else next.add(layer.layerId);
        return next;
      });
    } else {
      setMultiSelect(new Set([layer.layerId]));
    }
    onSelectElement(layer.layerId, layer.path);
    setContextMenu(null);
  }, [onSelectElement]);

  const handleContextMenu = useCallback((layerId: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!multiSelect.has(layerId)) {
      setMultiSelect(new Set([layerId]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, layerId });
  }, [multiSelect]);

  const handleReorder = useCallback((layerId: string, dir: "up" | "down") => {
    const reordered = reorderLayerInHtml(html, layerId, dir);
    if (reordered) onHtmlChange(reordered);
    setContextMenu(null);
  }, [html, onHtmlChange]);

  const handleGroup = useCallback(() => {
    const ids = Array.from(multiSelect);
    if (ids.length < 2) return;
    const result = groupLayersInHtml(html, ids);
    if (result) onHtmlChange(result.html);
    setContextMenu(null);
    setMultiSelect(new Set());
  }, [html, onHtmlChange, multiSelect]);

  const handleUngroup = useCallback((groupId: string) => {
    const result = ungroupLayerInHtml(html, groupId);
    if (result) onHtmlChange(result);
    setContextMenu(null);
  }, [html, onHtmlChange]);

  // Close context menu on outside click
  const closeContext = useCallback(() => setContextMenu(null), []);

  if (layers.length === 0) {
    return (
      <div style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Layers
        </div>
        <div style={{ color: "#666", fontSize: 11, textAlign: "center", padding: 20 }}>
          No layers found. Draw a rectangle, circle, or add text to create layers.
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle} onClick={closeContext}>
      <div style={{
        padding: "8px 10px", fontSize: 10, color: "#7a7668",
        textTransform: "uppercase", letterSpacing: 1,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>Layers · {layers.length}</span>
        {multiSelect.size > 1 && (
          <button type="button" onClick={handleGroup}
            style={{ fontSize: 9, color: "#c8b898", background: "none", border: "1px solid rgba(200,184,152,0.3)", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>
            Group ({multiSelect.size})
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {layers.map((layer, i) => {
          const isSelected = selectedElementId === layer.layerId || multiSelect.has(layer.layerId);
          const isGroup = layer.tag === "div" && layer.children.length > 0;
          const isCollapsed = collapsed.has(layer.layerId);

          return (
            <div key={layer.layerId}>
              <div
                onClick={(e) => handleClick(layer, e)}
                onContextMenu={(e) => handleContextMenu(layer.layerId, e)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", layer.layerId);
                  (e.currentTarget as HTMLElement).style.opacity = "0.4";
                }}
                onDragEnd={(e) => {
                  (e.currentTarget as HTMLElement).style.opacity = "1";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData("text/plain");
                  if (draggedId && draggedId !== layer.layerId) {
                    // Reorder: move dragged layer before/after the drop target
                    const reordered = reorderLayerInHtml(html, draggedId, "up");
                    if (reordered) onHtmlChange(reordered);
                  }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 8px", paddingLeft: 8 + layer.depth * 16,
                  cursor: "pointer",
                  background: isSelected ? "rgba(59,130,246,0.15)" : "transparent",
                  borderLeft: isSelected ? "2px solid #3B82F6" : "2px solid transparent",
                  fontSize: 11, userSelect: "none",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {/* Collapse toggle for groups */}
                {isGroup && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed(prev => {
                        const next = new Set(prev);
                        if (next.has(layer.layerId)) next.delete(layer.layerId);
                        else next.add(layer.layerId);
                        return next;
                      });
                    }}
                    style={{ fontSize: 8, cursor: "pointer", color: "#7a7668", width: 10, flexShrink: 0 }}
                  >
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                )}
                {!isGroup && <span style={{ width: 10, flexShrink: 0 }} />}

                {/* Tag badge */}
                <span style={{
                  display: "inline-block", minWidth: 20, textAlign: "center",
                  color: tagColor(layer.tag), fontSize: 9, fontWeight: 600,
                  fontFamily: "monospace", flexShrink: 0,
                }}>
                  {tagIcon(layer.tag)}
                </span>

                {/* Text preview */}
                <span style={{
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", color: isSelected ? "#e0e0e0" : "#a0a098",
                }}>
                  {layer.text || layer.tag}
                </span>

                {/* Action buttons (visible on hover or selection, only for non-auto layers) */}
                {!layer.layerId.startsWith("auto_") && (
                <span style={{ display: "flex", gap: 2, opacity: isSelected ? 1 : 0, flexShrink: 0 }}>
                  {/* Move up */}
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleReorder(layer.layerId, "up"); }}
                    title="Move up"
                    style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 10, padding: 0, lineHeight: 1 }}>
                    ▲
                  </button>
                  {/* Move down */}
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleReorder(layer.layerId, "down"); }}
                    title="Move down"
                    style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 10, padding: 0, lineHeight: 1 }}>
                    ▼
                  </button>
                </span>
                )}
              </div>

              {/* Children (recursive nesting not needed for flat model — parent-child shown via indent) */}
            </div>
          );
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 100,
            background: "rgba(18,18,36,0.96)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6, padding: 4, minWidth: 160,
            backdropFilter: "blur(10px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", gap: 2,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <CMItem onClick={() => { onLayerDuplicate?.(contextMenu.layerId); closeContext(); }}>
            Duplicate
          </CMItem>
          <CMItem onClick={() => { onLayerDelete?.(contextMenu.layerId); closeContext(); }}>
            Delete
          </CMItem>
          <CMItem onClick={() => { handleReorder(contextMenu.layerId, "up"); }}>
            Move Up
          </CMItem>
          <CMItem onClick={() => { handleReorder(contextMenu.layerId, "down"); }}>
            Move Down
          </CMItem>
          {multiSelect.size > 1 && (
            <CMItem onClick={handleGroup}>
              Group ({multiSelect.size})
            </CMItem>
          )}
          {layers.find(l => l.layerId === contextMenu.layerId && l.children.length > 0) && (
            <CMItem onClick={() => handleUngroup(contextMenu.layerId)}>
              Ungroup
            </CMItem>
          )}
        </div>
      )}
    </div>
  );
}

function CMItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "5px 10px",
        background: "transparent", border: "none", borderRadius: 4,
        color: "#dddbd4", fontSize: 11, cursor: "pointer",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
