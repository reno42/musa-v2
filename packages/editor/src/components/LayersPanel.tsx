import { useState, useEffect } from "react";
import type { FabricObject, Canvas } from "fabric";

interface LayersPanelProps {
  canvasRef: React.RefObject<Canvas | null>;
  selectedObjects: FabricObject[];
  onSelect?: (layerName: string) => void;
  onDelete?: (layerName: string) => void;
}

interface LayerItem {
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  ref: FabricObject;
}

function iconForType(t: string): string {
  const m: Record<string, string> = {
    rect: "▢", Rect: "▢", ellipse: "○", Ellipse: "○",
    triangle: "△", Triangle: "△", polygon: "⬡", Polygon: "⬡",
    line: "╱", Line: "╱", text: "T", "i-text": "T", IText: "T", Textbox: "T",
    group: "▣", Group: "▣", image: "🖼", Image: "🖼",
    star: "★", Star: "★", path: "↗", Path: "↗",
  };
  return m[t] || "▪";
}

export function LayersPanel({ canvasRef, selectedObjects, onSelect, onDelete }: LayersPanelProps) {
  const [layers, setLayers] = useState<LayerItem[]>([]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const refresh = () => {
      const items: LayerItem[] = [];
      const objs = [...c.getObjects()].reverse();
      for (const o of objs) {
        if ((o as any).isGridLine) continue;
        items.push({
          name: (o as any).layerName || (o as any).name || `${o.type}_${Math.random().toString(36).slice(2, 6)}`,
          type: o.type || "unknown",
          visible: o.visible !== false,
          locked: !!(o as any).lockMovementX,
          ref: o,
        });
      }
      setLayers(items);
    };
    setTimeout(refresh, 0);
    c.on("object:added", refresh);
    c.on("object:removed", refresh);
    c.on("object:modified", refresh);
    return () => { c.off("object:added", refresh); c.off("object:removed", refresh); c.off("object:modified", refresh); };
  }, [canvasRef]);

  const selNames = new Set(selectedObjects.map((o: any) => o.layerName || o.name || ""));

  return (
    <div style={panelStyle}>
      <div style={layersHeaderStyle}>
        Layers ({layers.length})
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {layers.length === 0 && (
          <div style={{ padding: 20, color: "#4a4a60", fontSize: 12, textAlign: "center" }}>
            No layers yet
          </div>
        )}
        {layers.map((l, i) => {
          const isSel = selNames.has(l.name);
          return (
            <div
              key={l.name + i}
              style={layerItemStyle(isSel, l.visible)}
            >
              <button
                type="button"
                aria-label={`Select layer ${l.name}`}
                onClick={() => {
                  const c = canvasRef.current;
                  if (!c) return;
                  c.discardActiveObject();
                  c.setActiveObject(l.ref);
                  c.requestRenderAll();
                  onSelect?.(l.name);
                }}
                style={layerSelectBtnStyle}
              >
                <span style={{ width: 16, textAlign: "center", fontSize: 12, opacity: 0.7 }}>{iconForType(l.type)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e4e4f0" }}>{l.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Toggle visibility for ${l.name}`}
                onClick={e => { e.stopPropagation(); l.ref.set("visible", !l.visible); l.ref.canvas?.requestRenderAll(); }}
                style={tinyBtn(l.visible ? "👁" : "—")}
              />
              <button
                type="button"
                aria-label={`Toggle lock for ${l.name}`}
                onClick={e => { e.stopPropagation(); const lk = !(l.ref as any).lockMovementX; (l.ref as any).set({ lockMovementX: lk, lockMovementY: lk, lockRotation: lk, selectable: !lk, evented: !lk }); l.ref.canvas?.requestRenderAll(); }}
                style={tinyBtn(l.locked ? "🔒" : "🔓")}
              />
              <button
                type="button"
                aria-label={`Delete layer ${l.name}`}
                onClick={e => {
                  e.stopPropagation();
                  const c = canvasRef.current;
                  if (!c) return;
                  c.remove(l.ref);
                  c.requestRenderAll();
                  onDelete?.(l.name);
                }}
                style={{ ...tinyBtn("✕"), color: "#f87171" }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tinyBtn(icon: string): React.CSSProperties {
  return { background: "none", border: "none", color: "#5a5a70", fontSize: 10, cursor: "pointer", padding: 0, lineHeight: 1, width: 18, textAlign: "center" };
}

const layersHeaderStyle: React.CSSProperties = {
  padding: "6px 10px", borderBottom: "1px solid #1c1c26",
  fontSize: 12, color: "#5a5a70", textTransform: "uppercase", letterSpacing: 1,
};

function layerItemStyle(isSel: boolean, visible: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 4,
    padding: "3px 8px", cursor: "pointer",
    background: isSel ? "#17171f" : "transparent",
    borderLeft: isSel ? "2px solid #7c6fff" : "2px solid transparent",
    opacity: visible ? 1 : 0.4,
    fontSize: 12,
  };
}

const layerSelectBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, flex: 1,
  background: "none", border: "none", color: "inherit",
  cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit",
};

const panelStyle: React.CSSProperties = {
  width: 200, height: "100%", background: "#0a0a0f", color: "#e4e4f0",
  fontFamily: "Inter, system-ui, sans-serif", fontSize: 12,
  display: "flex", flexDirection: "column",
  borderLeft: "1px solid #1c1c26",
};
