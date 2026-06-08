import { useState, useEffect, useRef, useCallback } from "react";
import { FabricObject } from "fabric";
import type { Canvas } from "fabric";

interface LayersPanelProps {
  canvasRef: React.RefObject<Canvas | null>;
  selectedObjects: FabricObject[];
  onSelect?: (layerName: string) => void;
  onDelete?: (layerName: string) => void;
  onFrameCreate?: () => void;
  onFrameDelete?: (frameId: string) => void;
  onFrameRename?: (frameId: string, name: string) => void;
  onMoveToFrame?: (objectId: string, frameId: string | null) => void;
}

interface LayerItem {
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  ref: FabricObject;
  frameId?: string | null;
  isFrame: boolean;
  objectId: string;
}

interface FrameGroup {
  frameId: string;
  frameName: string;
  ref: FabricObject;
  children: LayerItem[];
  collapsed: boolean;
}

function iconForType(t: string): string {
  const m: Record<string, string> = {
    rect: "\u25A2", Rect: "\u25A2", ellipse: "\u25CB", Ellipse: "\u25CB",
    triangle: "\u25B3", Triangle: "\u25B3", polygon: "\u2B21", Polygon: "\u2B21",
    line: "\u2571", Line: "\u2571", text: "T", "i-text": "T", IText: "T", Textbox: "T",
    group: "\u25A3", Group: "\u25A3", image: "\uD83D\uDDBC", Image: "\uD83D\uDDBC",
    star: "\u2605", Star: "\u2605", path: "\u2197", Path: "\u2197",
    frame: "\u25A3", Frame: "\u25A3",
  };
  return m[t] || "\u25AA";
}

export function LayersPanel({
  canvasRef, selectedObjects, onSelect, onDelete,
  onFrameCreate, onFrameDelete, onFrameRename, onMoveToFrame,
}: LayersPanelProps) {
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(new Set());
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; frameId: string } | null>(null);

  const refresh = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const items: LayerItem[] = [];
    const objs = [...c.getObjects()].reverse();
    for (const o of objs) {
      if ((o as any).isGridLine) continue;
      const isFrame = !!(o as any).isFrameVisual;
      const oid = (o as any).layerName || (o as any).name || `${o.type}_${Math.random().toString(36).slice(2, 6)}`;
      items.push({
        name: (o as any).frameName || (o as any).layerName || (o as any).name || oid,
        type: isFrame ? "frame" : (o.type || "unknown"),
        visible: o.visible !== false,
        locked: !!(o as any).lockMovementX,
        ref: o,
        frameId: (o as any).frameId || null,
        isFrame,
        objectId: oid,
      });
    }
    setLayers(items);
  }, [canvasRef]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    setTimeout(refresh, 0);
    c.on("object:added", refresh);
    c.on("object:removed", refresh);
    c.on("object:modified", refresh);
    return () => { c.off("object:added", refresh); c.off("object:removed", refresh); c.off("object:modified", refresh); };
  }, [canvasRef, refresh]);

  // Build frame groups
  const frameGroups: FrameGroup[] = [];
  const freeObjects: LayerItem[] = [];
  const frameMap = new Map<string, LayerItem>();
  for (const l of layers) {
    if (l.isFrame) {
      frameMap.set((l.ref as any).frameId, l);
      // Get children from frame.children[] (new model) or scan for frameId (legacy)
      const frameChildren = ((l.ref as any).children || []).map((child: any) => ({
        name: (child as any).layerName || (child as any).name || `${child.type}_${Math.random().toString(36).slice(2, 6)}`,
        type: (child as any).type || "unknown",
        visible: child.visible !== false,
        locked: !!(child as any).lockMovementX,
        ref: child,
        frameId: (l.ref as any).frameId || null,
        isFrame: false,
        objectId: (child as any).layerName || (child as any).name || `${child.type}_${Math.random().toString(36).slice(2, 6)}`,
      }));
      frameGroups.push({
        frameId: (l.ref as any).frameId,
        frameName: l.name,
        ref: l.ref,
        children: frameChildren,
        collapsed: collapsedFrames.has((l.ref as any).frameId),
      });
    }
  }
  for (const l of layers) {
    if (!l.isFrame) {
      if (l.frameId && frameMap.has(l.frameId)) {
        // Only add to freeObjects if not already in a frame's children[] array
        const fg = frameGroups.find(f => f.frameId === l.frameId);
        if (fg && !fg.children.some(c => c.ref === l.ref)) {
          fg.children.push(l);
        }
      } else {
        freeObjects.push(l);
      }
    }
  }

  const selNames = new Set(selectedObjects.map((o: any) => o.layerName || o.name || ""));

  const toggleFrameCollapse = (frameId: string) => {
    setCollapsedFrames(prev => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId); else next.add(frameId);
      return next;
    });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, item: LayerItem) => {
    e.dataTransfer.setData("text/plain", item.objectId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(targetId);
  };

  const handleDragLeave = () => {
    setDragOverTarget(null);
  };

  const handleDropOnFrame = (e: React.DragEvent, frameId: string) => {
    e.preventDefault();
    setDragOverTarget(null);
    const objectId = e.dataTransfer.getData("text/plain");
    onMoveToFrame?.(objectId, frameId);
  };

  const handleDropOnCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    const objectId = e.dataTransfer.getData("text/plain");
    onMoveToFrame?.(objectId, null);
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, frameId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, frameId });
  };

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const handleRenameSubmit = (frameId: string) => {
    if (editName.trim()) {
      onFrameRename?.(frameId, editName.trim());
    }
    setEditingFrameId(null);
    setEditName("");
  };

  return (
    <div className="glass-panel" style={panelStyle}>
      <div style={layersHeaderStyle}>
        <span>Layers ({layers.length})</span>
        <button
          type="button"
          aria-label="Add frame"
          onClick={onFrameCreate}
          style={addFrameBtnStyle}
          title="Add Frame"
        >
          + Frame
        </button>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {layers.length === 0 && (
          <div style={{ padding: 20, color: "#7a7668", fontSize: 12, textAlign: "center" }}>
            No layers yet
          </div>
        )}

        {/* Frame Groups */}
        {frameGroups.map(fg => (
          <div key={fg.frameId}>
            <div
              style={frameHeaderStyle(dragOverTarget === `frame-${fg.frameId}`)}
              onDragOver={(e) => handleDragOver(e, `frame-${fg.frameId}`)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnFrame(e, fg.frameId)}
              onContextMenu={(e) => handleContextMenu(e, fg.frameId)}
            >
              <button
                type="button"
                aria-label={`${fg.collapsed ? "Expand" : "Collapse"} frame ${fg.frameName}`}
                onClick={() => toggleFrameCollapse(fg.frameId)}
                style={chevronBtnStyle}
              >
                {fg.collapsed ? "\u25B8" : "\u25BE"}
              </button>
              <button
                type="button"
                aria-label={`Select frame ${fg.frameName}`}
                onClick={() => {
                  const c = canvasRef.current;
                  if (!c) return;
                  c.discardActiveObject();
                  c.setActiveObject(fg.ref);
                  c.requestRenderAll();
                }}
                style={frameSelectBtnStyle}
                onDoubleClick={() => {
                  setEditingFrameId(fg.frameId);
                  setEditName(fg.frameName);
                }}
              >
                {editingFrameId === fg.frameId ? (
                  <input
                    aria-label="Edit frame name"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleRenameSubmit(fg.frameId); if (e.key === "Escape") { setEditingFrameId(null); } }}
                    onBlur={() => handleRenameSubmit(fg.frameId)}
                    style={renameInputStyle}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span style={{ color: "#c8b898", marginRight: 4 }}>{'\u25A3'}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#f0ebe0", fontWeight: 500 }}>
                      {fg.frameName}
                    </span>
                    <span style={{ fontSize: 10, color: "#7a7668", marginLeft: 4 }}>
                      ({fg.children.length})
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Frame Children */}
            {!fg.collapsed && fg.children.map((child, i) => (
              <LayerRow
                key={child.objectId + i}
                item={child}
                isSelected={selNames.has(child.objectId)}
                indent
                canvasRef={canvasRef}
                onSelect={onSelect}
                onDelete={onDelete}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnCanvas}
                dragOverTarget={dragOverTarget}
              />
            ))}
          </div>
        ))}

        {/* Free Objects Section */}
        {freeObjects.length > 0 && (
          <div>
            <div style={sectionHeaderStyle}>Canvas</div>
            <div
              onDragOver={(e) => handleDragOver(e, "canvas")}
              onDragLeave={handleDragLeave}
              onDrop={handleDropOnCanvas}
              style={{ minHeight: 4 }}
            >
              {freeObjects.map((item, i) => (
                <LayerRow
                  key={item.objectId + i}
                  item={item}
                  isSelected={selNames.has(item.objectId)}
                  indent={false}
                  canvasRef={canvasRef}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDropOnCanvas}
                  dragOverTarget={dragOverTarget}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div style={contextMenuStyle(contextMenu.x, contextMenu.y)}>
          <button
            type="button"
            onClick={() => {
              setEditingFrameId(contextMenu.frameId);
              const fg = frameGroups.find(f => f.frameId === contextMenu.frameId);
              setEditName(fg?.frameName || "");
              setContextMenu(null);
            }}
            style={ctxMenuItemStyle}
          >
            Rename Frame
          </button>
          <button
            type="button"
            onClick={() => {
              const fg = frameGroups.find(f => f.frameId === contextMenu.frameId);
              if (fg) {
                const c = canvasRef.current;
                if (c) {
                  const frame = c.getObjects().find((o: any) => o.frameId === contextMenu.frameId && o.isFrameVisual);
                  if (frame) {
                    const origFid = (frame as any).frameId;
                    const origFill = (frame as any).frameFill || "#ffffff";
                    const origStroke = (frame as any).frameStroke || "#c8b898";
                    const origName = (frame as any).frameName || "Frame";
                  const json = (frame as any).toJSON(["isFrameVisual", "frameId", "frameName", "frameFill", "frameStroke", "layerId", "layerName", "styleId", "layoutMode", "clipsContent", "constraints", "padding", "children"]);
                    // Duplicate frame
                    const newFrameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    FabricObject.fromObject(json).then((clone: any) => {
                      // Auto-place to the right of the rightmost frame (30px gap)
                      const allFrames = c.getObjects().filter((o: any) => o.isFrameVisual);
                      let maxRight = 0;
                      for (const f of allFrames) {
                        const r = (f as any).left + ((f as any).width || 0) * ((f as any).scaleX || 1);
                        if (r > maxRight) maxRight = r;
                      }
                      clone.set({ left: maxRight + 30, top: (clone.top || 0) });
                      (clone as any).isFrameVisual = true;
                      (clone as any).frameId = newFrameId;
                      (clone as any).frameName = `${origName} (copy)`;
                      (clone as any).frameFill = origFill;
                      (clone as any).frameStroke = origStroke;
                      (clone as any).layerName = (clone as any).frameName;
                      c.add(clone);
                      // Duplicate children
                      const children = (frame as any).children || c.getObjects().filter((o: any) => o.frameId === origFid && !o.isFrameVisual);
                      const childClones: Promise<void>[] = [];
                      for (const child of children) {
                        const cjson = (child as any).toJSON(["layerId", "layerName", "frameId", "styleId"]);
                        if (cjson) {
                          childClones.push(
                            FabricObject.fromObject(cjson).then((cClone: any) => {
                              const dx = (clone.left || 0) - (frame.left || 0);
                              const dy = (clone.top || 0) - (frame.top || 0);
                              cClone.set({
                                left: (child.left || 0) + dx,
                                top: (child.top || 0) + dy,
                              });
                              (cClone as any).frameId = newFrameId;
                              (cClone as any).layerName = ((child as any).layerName || "") + "_copy";
                              c.add(cClone);
                            })
                          );
                        }
                      }
                      Promise.all(childClones).then(() => {
                        c.setActiveObject(clone);
                        c.requestRenderAll();
                      });
                    });
                  }
                }
              }
              setContextMenu(null);
            }}
            style={ctxMenuItemStyle}
          >
            Duplicate Frame
          </button>
          <button
            type="button"
            onClick={() => {
              onFrameDelete?.(contextMenu.frameId);
              setContextMenu(null);
            }}
            style={{ ...ctxMenuItemStyle, color: "#f87171" }}
          >
            Delete Frame
          </button>
        </div>
      )}
    </div>
  );
}

// ── Layer Row Sub-component ──

function LayerRow({
  item, isSelected, indent, canvasRef, onSelect, onDelete,
  onDragStart, onDragOver, onDragLeave, onDrop, dragOverTarget,
}: {
  item: LayerItem;
  isSelected: boolean;
  indent: boolean;
  canvasRef: React.RefObject<Canvas | null>;
  onSelect?: (name: string) => void;
  onDelete?: (name: string) => void;
  onDragStart: (e: React.DragEvent, item: LayerItem) => void;
  onDragOver: (e: React.DragEvent, targetId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  dragOverTarget: string | null;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragOver={(e) => onDragOver(e, `item-${item.objectId}`)}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={layerItemStyle(isSelected, item.visible, indent, dragOverTarget === `item-${item.objectId}`)}
    >
      <button
        type="button"
        aria-label="Bring forward"
        title="Bring forward"
        onClick={e => {
          e.stopPropagation();
          const c = canvasRef.current;
          if (!c) return;
          c.bringObjectForward(item.ref);
          c.requestRenderAll();
        }}
        style={{ ...tinyBtn("▲"), fontSize: 8 }}
      />
      <button
        type="button"
        aria-label="Send backward"
        title="Send backward"
        onClick={e => {
          e.stopPropagation();
          const c = canvasRef.current;
          if (!c) return;
          c.sendObjectBackwards(item.ref);
          c.requestRenderAll();
        }}
        style={{ ...tinyBtn("▼"), fontSize: 8 }}
      />
      <button
        type="button"
        aria-label={`Select layer ${item.name}`}
        onClick={() => {
          const c = canvasRef.current;
          if (!c) return;
          c.discardActiveObject();
          c.setActiveObject(item.ref);
          c.requestRenderAll();
          onSelect?.(item.name);
        }}
        style={layerSelectBtnStyle}
      >
        <span style={{ width: 16, textAlign: "center", fontSize: 12, opacity: 0.7 }}>{iconForType(item.type)}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#f0ebe0" }}>{item.name}</span>
      </button>
      <button
        type="button"
        aria-label={`Toggle visibility for ${item.name}`}
        onClick={e => { e.stopPropagation(); item.ref.set("visible", !item.visible); item.ref.canvas?.requestRenderAll(); }}
        style={tinyBtn(item.visible ? "\uD83D\uDC41" : "\u2014")}
      />
      <button
        type="button"
        aria-label={`Toggle lock for ${item.name}`}
        onClick={e => {
          e.stopPropagation();
          const lk = !(item.ref as any).lockMovementX;
          (item.ref as any).set({ lockMovementX: lk, lockMovementY: lk, lockRotation: lk, selectable: !lk, evented: !lk });
          item.ref.canvas?.requestRenderAll();
        }}
        style={tinyBtn(item.locked ? "\uD83D\uDD12" : "\uD83D\uDD13")}
      />
      <button
        type="button"
        aria-label={`Delete layer ${item.name}`}
        onClick={e => {
          e.stopPropagation();
          const c = canvasRef.current;
          if (!c) return;
          c.remove(item.ref);
          c.requestRenderAll();
          onDelete?.(item.name);
        }}
        style={{ ...tinyBtn("\u2715"), color: "#f87171" }}
      />
    </div>
  );
}

function tinyBtn(icon: string): React.CSSProperties {
  return { background: "none", border: "none", color: "#7a7668", fontSize: 10, cursor: "pointer", padding: 0, lineHeight: 1, width: 18, textAlign: "center" };
}

// ── Styles ──

const layersHeaderStyle: React.CSSProperties = {
  padding: "6px 10px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
  fontSize: 12, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1,
  display: "flex", justifyContent: "space-between", alignItems: "center",
};

const addFrameBtnStyle: React.CSSProperties = {
  background: "rgba(200, 184, 152, 0.1)", border: "1px solid rgba(200, 184, 152, 0.2)", color: "#c8b898",
  borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer",
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: "4px 10px", fontSize: 10, color: "#5a564c",
  textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
};

function frameHeaderStyle(dragOver: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 2,
    padding: "4px 8px", cursor: "pointer",
    background: dragOver ? "rgba(200, 184, 152, 0.1)" : "rgba(12, 12, 12, 0.4)",
    borderLeft: "2px solid #c8b898",
    borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
    borderTop: dragOver ? "1px solid #c8b898" : "1px solid transparent",
  };
}

function layerItemStyle(isSel: boolean, visible: boolean, indent: boolean, dragOver: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 4,
    padding: `3px 8px`, paddingLeft: indent ? 20 : 8, cursor: "grab",
    background: dragOver ? "rgba(200, 184, 152, 0.1)" : isSel ? "rgba(200, 184, 152, 0.06)" : "transparent",
    borderLeft: isSel ? "2px solid #c8b898" : "2px solid transparent",
    borderTop: dragOver ? "1px solid #c8b898" : "1px solid transparent",
    opacity: visible ? 1 : 0.4,
    fontSize: 12,
    transition: "background 0.2s ease",
  };
}

const chevronBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#7a7668",
  cursor: "pointer", padding: 0, fontSize: 10, width: 14, textAlign: "center",
};

const frameSelectBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, flex: 1,
  background: "none", border: "none", color: "inherit",
  cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit",
  textAlign: "left",
};

const layerSelectBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, flex: 1,
  background: "none", border: "none", color: "inherit",
  cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit",
};

const renameInputStyle: React.CSSProperties = {
  flex: 1, background: "rgba(15, 15, 15, 0.5)", border: "1px solid #c8b898", color: "#f0ebe0",
  borderRadius: 4, padding: "2px 4px", fontSize: 11, outline: "none",
  fontFamily: "inherit",
};

function contextMenuStyle(x: number, y: number): React.CSSProperties {
  return {
    position: "fixed", left: x, top: y, zIndex: 9999,
    background: "rgba(12, 12, 12, 0.8)", backdropFilter: "blur(16px) saturate(180%)",
    border: "1px solid rgba(255, 255, 255, 0.05)", borderRadius: 10,
    padding: "4px 0", minWidth: 160, boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
  };
}

const ctxMenuItemStyle: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left",
  background: "none", border: "none", color: "#c4c0b4",
  padding: "6px 14px", fontSize: 12, cursor: "pointer",
  fontFamily: "inherit",
};

const panelStyle: React.CSSProperties = {
  width: 200, height: "calc(100vh - 24px)", color: "#f0ebe0",
  fontFamily: "Inter, system-ui, sans-serif", fontSize: 12,
  display: "flex", flexDirection: "column",
  margin: "12px 12px 12px 0",
};
