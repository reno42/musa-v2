/**
 * Layers Panel Component
 * ──────────────────────────────────────────────────────────────
 * Left sidebar listing canvas objects by z-order with
 * visibility toggling, drag-to-reorder, rename, and lock.
 * Supports grouping/ungrouping.
 *
 * @module components/LayersPanel
 *
 * State: Reads canvas objects → LayerInfo[]
 * Events: Click → select object, Drag → reorder, Eye → toggle visibility
 * DB:    None (canvas state is ephemeral, saved via useRemoteSync)
 */

import { useState } from "react";
import type { LayerInfo, FrameInfo, PageInfo } from "../hooks/useCanvas";

interface Props {
  pages: PageInfo[];
  activePageId: string;
  frames: FrameInfo[];
  activeFrameId: string;
  layers: LayerInfo[];
  selectedLayer: LayerInfo | null;
  selectedFrameId: string | null;
  onSelectLayer: (layer: LayerInfo) => void;
  onSelectFrame: (frameId: string) => void;
  onAddPage: () => void;
  onSwitchPage: (pageId: string) => void;
  onRenamePage: (pageId: string, name: string) => void;
  onDeletePage: (pageId: string) => void;
  onAddFrame: () => void;
  onRenameFrame: (frameId: string, name: string) => void;
  onDeleteFrame: (frameId: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onToggleLock: (layerId: string) => void;
  onExportFrame: (frameId: string, format: "png" | "jpg" | "svg") => void;
}

const typeIcons: Record<string, string> = {
  frame: "▢", rect: "▭", ellipse: "○", textbox: "T", "i-text": "T",
  image: "🖼", group: "📁", path: "✎", line: "╱",
};

export function LayersPanel({
  pages, activePageId, frames, activeFrameId, layers,
  selectedLayer, selectedFrameId,
  onSelectLayer, onSelectFrame,
  onAddPage, onSwitchPage, onRenamePage, onDeletePage,
  onAddFrame, onRenameFrame, onDeleteFrame,
  onDelete, onDuplicate, onBringForward, onSendBackward,
  onToggleLock, onExportFrame,
}: Props) {
  const [pagesOpen, setPagesOpen] = useState(true);
  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ id: string; type: "page" | "frame"; x: number; y: number } | null>(null);

  const toggleFrame = (frameId: string) => {
    setExpandedFrames(prev => {
      const next = new Set(prev);
      next.has(frameId) ? next.delete(frameId) : next.add(frameId);
      return next;
    });
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingValue(currentName);
    setContextMenu(null);
  };

  const finishRename = (type: "page" | "frame") => {
    if (editingId && editingValue.trim()) {
      if (type === "page") onRenamePage(editingId, editingValue.trim());
      else onRenameFrame(editingId, editingValue.trim());
    }
    setEditingId(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string, type: "page" | "frame") => {
    e.preventDefault();
    setContextMenu({ id, type, x: e.clientX, y: e.clientY });
  };

  const getFrameLayers = (frameId: string) => {
    return layers.filter(l => l.frameId === frameId);
  };

  return (
    <div className="sidebar" onClick={() => setContextMenu(null)}>
      <div className="sidebar-header">
        <span>Design</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>v0.3</span>
      </div>

      {/* ─── Pages ─── */}
      <div className="tree-section">
        <div className="tree-title" onClick={() => setPagesOpen(!pagesOpen)}>
          {pagesOpen ? "▼" : "▶"} Pages
          <button className="tree-add-btn" onClick={(e) => { e.stopPropagation(); onAddPage(); }} title="Add Page">+</button>
        </div>
        {pagesOpen && pages.map((page) => (
          <div
            key={page.id}
            className={`tree-item sub ${activePageId === page.id ? "active" : ""}`}
            onClick={() => onSwitchPage(page.id)}
            onContextMenu={(e) => handleContextMenu(e, page.id, "page")}
          >
            <span className="tree-item-icon">📄</span>
            {editingId === page.id ? (
              <input
                className="tree-rename-input"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={() => finishRename("page")}
                onKeyDown={(e) => { if (e.key === "Enter") finishRename("page"); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tree-item-name">{page.name}</span>
            )}
            <span className="tree-item-count">{page.frames.length}f</span>
          </div>
        ))}
      </div>

      {/* ─── Frames (for active page) ─── */}
      <div className="tree-section" style={{ flex: 1, overflow: "auto" }}>
        <div className="tree-title">
          <span>Frames</span>
          <button className="tree-add-btn" onClick={onAddFrame} title="Add Frame">+</button>
        </div>
        {frames.map((frame) => {
          const isExpanded = expandedFrames.has(frame.id);
          const isActive = activeFrameId === frame.id;
          const isSelected = selectedFrameId === frame.id;
          const frameLayers = getFrameLayers(frame.id);

          return (
            <div key={frame.id}>
              <div
                className={`tree-item sub ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
                onClick={() => { onSelectFrame(frame.id); toggleFrame(frame.id); }}
                onContextMenu={(e) => handleContextMenu(e, frame.id, "frame")}
              >
                <span className="tree-expand">{isExpanded ? "▼" : "▶"}</span>
                <span className="tree-item-icon">▢</span>
                {editingId === frame.id ? (
                  <input
                    className="tree-rename-input"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => finishRename("frame")}
                    onKeyDown={(e) => { if (e.key === "Enter") finishRename("frame"); if (e.key === "Escape") setEditingId(null); }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="tree-item-name">{frame.name}</span>
                )}
                <span className="tree-item-count">{frameLayers.length}</span>
                <div className="tree-item-actions">
                  <button className="tree-action-btn" onClick={(e) => { e.stopPropagation(); onExportFrame(frame.id, "png"); }} title="Export PNG">↓</button>
                </div>
              </div>

              {/* Frame layers */}
              {isExpanded && frameLayers.map((layer) => (
                <div
                  key={layer.id}
                  className={`tree-item sub-sub ${selectedLayer?.id === layer.id ? "active" : ""}`}
                  onClick={() => onSelectLayer(layer)}
                >
                  <span className="tree-item-icon">{typeIcons[layer.type] || "□"}</span>
                  <span className="tree-item-name">{layer.name}</span>
                  <button
                    className="tree-lock-btn"
                    onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id); }}
                    title={layer.locked ? "Unlock (⌘L)" : "Lock (⌘L)"}
                    style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: layer.locked ? "#f59e0b" : "#555", fontSize: 13, padding: "0 4px" }}
                  >
                    {layer.locked ? "🔒" : "🔓"}
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* ─── Quick actions ─── */}
      <div className="sidebar-footer">
        <button className="sidebar-btn" onClick={onDuplicate} title="Duplicate">⧉</button>
        <button className="sidebar-btn" onClick={onBringForward} title="Bring Forward">↑</button>
        <button className="sidebar-btn" onClick={onSendBackward} title="Send Backward">↓</button>
        <button className="sidebar-btn danger" onClick={onDelete} title="Delete">🗑</button>
      </div>

      {/* ─── Context Menu ─── */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button onClick={() => startRename(contextMenu.id, contextMenu.type === "page"
            ? pages.find(p => p.id === contextMenu.id)?.name || ""
            : frames.find(f => f.id === contextMenu.id)?.name || ""
          )}>Rename</button>
          {contextMenu.type === "frame" && (
            <>
              <button onClick={() => { onExportFrame(contextMenu.id, "png"); setContextMenu(null); }}>Export PNG</button>
              <button onClick={() => { onExportFrame(contextMenu.id, "jpg"); setContextMenu(null); }}>Export JPG</button>
              <button onClick={() => { onExportFrame(contextMenu.id, "svg"); setContextMenu(null); }}>Export SVG</button>
            </>
          )}
          <button className="danger" onClick={() => {
            if (contextMenu.type === "page") onDeletePage(contextMenu.id);
            else onDeleteFrame(contextMenu.id);
            setContextMenu(null);
          }}>Delete</button>
        </div>
      )}
    </div>
  );
}
