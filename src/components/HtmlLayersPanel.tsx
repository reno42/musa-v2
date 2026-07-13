import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameData } from "./DesignFrame";
import type { LayerKind, LayerNode } from "../hooks/useLayerTree";
import { parseLayerTree } from "../hooks/useLayerTree";
import {
  groupLayersInHtml,
  moveLayerInStack,
  reorderLayerInStack,
  ungroupLayerInHtml,
} from "../lib/htmlMutations";
import type { LayerStackChange, LayerStackDirection, LayerStackPlacement } from "../lib/htmlMutations";

interface Props {
  frames: FrameData[];
  selectedFrameId: string | null;
  selectedElementId: string | null;
  onSelectFrame: (frameId: string) => void;
  onSelectElement: (frameId: string, layerId: string, path?: number[]) => void;
  onHtmlChange: (frameId: string, newHtml: string) => void;
  onLayerStackChange: (frameId: string, change: LayerStackChange) => void;
  onLayerDelete?: (frameId: string, layerId: string) => void;
  onLayerDuplicate?: (frameId: string, layerId: string) => void;
  onMultiSelectChange?: (ids: string[]) => void;
  onLockToggle?: (frameId: string, layerId: string, locked: boolean) => void;
  onHideToggle?: (frameId: string, layerId: string, hidden: boolean) => void;
  lockedLayersByFrame?: Map<string, Set<string>>;
  hiddenLayersByFrame?: Map<string, Set<string>>;
}

interface FrameTree {
  frame: FrameData;
  nodes: LayerNode[];
  byId: Map<string, LayerNode>;
  roots: LayerNode[];
}

interface LayerReference {
  frameId: string;
  layerId: string;
  parentId: string | null;
}

interface DropTarget extends LayerReference {
  placement: LayerStackPlacement;
}

interface ContextMenuState {
  x: number;
  y: number;
  frameId: string;
  layerId: string;
}

const panelStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  background: "transparent",
  color: "var(--text-primary, #dddbd4)",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const KIND_META: Record<LayerKind, { icon: string; color: string }> = {
  text: { icon: "T", color: "#a8c8e8" },
  image: { icon: "IMG", color: "#e8c8a8" },
  svg: { icon: "SVG", color: "#9dc9b7" },
  bezier: { icon: "PEN", color: "#e4bda1" },
  shape: { icon: "◆", color: "#9dc9b7" },
  group: { icon: "GRP", color: "#c8b898" },
  component: { icon: "CMP", color: "#a8c8e8" },
};

function layerKey(frameId: string, layerId: string): string {
  return `${frameId}:${layerId}`;
}

function collapseKey(frameId: string, layerId?: string): string {
  return layerId ? `layer:${frameId}:${layerId}` : `frame:${frameId}`;
}

function buildFrameTree(frame: FrameData): FrameTree {
  const nodes = parseLayerTree(frame.html);
  const byId = new Map(nodes.map(node => [node.layerId, node]));
  return { frame, nodes, byId, roots: nodes.filter(node => node.parentId === null) };
}

export function HtmlLayersPanel({
  frames,
  selectedFrameId,
  selectedElementId,
  onSelectFrame,
  onSelectElement,
  onHtmlChange,
  onLayerStackChange,
  onLayerDelete,
  onLayerDuplicate,
  onMultiSelectChange,
  onLockToggle,
  onHideToggle,
  lockedLayersByFrame,
  hiddenLayersByFrame,
}: Props) {
  const frameTrees = useMemo(() => frames.map(buildFrameTree), [frames]);
  const totalLayers = useMemo(
    () => frameTrees.reduce((total, tree) => total + tree.nodes.length, 0),
    [frameTrees],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<LayerReference | null>(null);
  const draggingRef = useRef<LayerReference | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    onMultiSelectChange?.([...multiSelect]);
  }, [multiSelect, onMultiSelectChange]);

  useEffect(() => {
    setMultiSelect(new Set());
  }, [selectedFrameId]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectLayer = useCallback((frameId: string, layer: LayerNode, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setMultiSelect(current => {
        const next = new Set(current);
        if (next.has(layer.layerId)) next.delete(layer.layerId);
        else next.add(layer.layerId);
        return next;
      });
    } else {
      setMultiSelect(new Set([layer.layerId]));
    }
    onSelectElement(frameId, layer.layerId, layer.path);
    setContextMenu(null);
  }, [onSelectElement]);

  const applyStackChange = useCallback((frameId: string, change: LayerStackChange | null) => {
    if (!change) {
      setStatus("Only layers inside the same group can be reordered.");
      return;
    }
    setStatus("");
    onLayerStackChange(frameId, change);
  }, [onLayerStackChange]);

  const reorderLayer = useCallback((frameId: string, layerId: string, direction: LayerStackDirection) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    applyStackChange(frameId, reorderLayerInStack(frame.html, layerId, direction));
    setContextMenu(null);
  }, [frames, applyStackChange]);

  const handleDrop = useCallback((target: DropTarget) => {
    const source = draggingRef.current;
    if (!source || source.frameId !== target.frameId || source.layerId === target.layerId) return;
    if (source.parentId !== target.parentId) {
      setStatus("Only layers inside the same group can be reordered.");
      draggingRef.current = null;
      setDragging(null);
      setDropTarget(null);
      return;
    }
    const frame = frames.find(item => item.id === target.frameId);
    if (frame) {
      applyStackChange(
        target.frameId,
        moveLayerInStack(frame.html, source.layerId, target.layerId, target.placement),
      );
    }
    draggingRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }, [frames, applyStackChange]);

  const handleGroup = useCallback(() => {
    if (!selectedFrameId || multiSelect.size < 2) return;
    const frame = frames.find(item => item.id === selectedFrameId);
    if (!frame) return;
    const result = groupLayersInHtml(frame.html, [...multiSelect], `grp_${Date.now().toString(36)}`);
    if (result) onHtmlChange(frame.id, result);
    setMultiSelect(new Set());
    setContextMenu(null);
  }, [selectedFrameId, multiSelect, frames, onHtmlChange]);

  const handleUngroup = useCallback((frameId: string, groupId: string) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    const result = ungroupLayerInHtml(frame.html, groupId);
    if (result) onHtmlChange(frame.id, result);
    setContextMenu(null);
  }, [frames, onHtmlChange]);

  const renderLayer = (tree: FrameTree, layer: LayerNode): React.ReactNode => {
    const key = layerKey(tree.frame.id, layer.layerId);
    const nodeCollapseKey = collapseKey(tree.frame.id, layer.layerId);
    const isCollapsed = collapsed.has(nodeCollapseKey);
    const isSelected = selectedFrameId === tree.frame.id
      && (selectedElementId === layer.layerId || multiSelect.has(layer.layerId));
    const isLocked = lockedLayersByFrame?.get(tree.frame.id)?.has(layer.layerId) || false;
    const isHidden = hiddenLayersByFrame?.get(tree.frame.id)?.has(layer.layerId) || false;
    const isAutoLayer = layer.layerId.startsWith("auto_");
    const meta = KIND_META[layer.kind];
    const currentDrop = dropTarget?.frameId === tree.frame.id && dropTarget.layerId === layer.layerId
      ? dropTarget
      : null;
    const childLayers = [...layer.children]
      .reverse()
      .map(childId => tree.byId.get(childId))
      .filter((child): child is LayerNode => Boolean(child));

    return (
      <div key={key} role="treeitem" aria-level={layer.depth + 2} aria-selected={isSelected}>
        <div
          className={`layers-tree-row${isSelected ? " is-selected" : ""}${dragging?.layerId === layer.layerId ? " is-dragging" : ""}`}
          draggable={!isAutoLayer}
          onDragStart={event => {
            if (isAutoLayer) return;
            const reference = { frameId: tree.frame.id, layerId: layer.layerId, parentId: layer.parentId };
            draggingRef.current = reference;
            setDragging(reference);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", key);
          }}
          onDragEnd={() => {
            draggingRef.current = null;
            setDragging(null);
            setDropTarget(null);
          }}
          onDragOver={event => {
            const source = draggingRef.current;
            if (!source || source.frameId !== tree.frame.id || source.parentId !== layer.parentId) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            const placement: LayerStackPlacement = event.clientY < bounds.top + bounds.height / 2 ? "above" : "below";
            event.dataTransfer.dropEffect = "move";
            setDropTarget({ frameId: tree.frame.id, layerId: layer.layerId, parentId: layer.parentId, placement });
          }}
          onDrop={event => {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            const placement: LayerStackPlacement = event.clientY < bounds.top + bounds.height / 2 ? "above" : "below";
            handleDrop({
              frameId: tree.frame.id,
              layerId: layer.layerId,
              parentId: layer.parentId,
              placement,
            });
          }}
          style={{
            paddingLeft: 8 + layer.depth * 14,
            borderTop: currentDrop?.placement === "above" ? "2px solid var(--accent, #c8b898)" : "2px solid transparent",
            borderBottom: currentDrop?.placement === "below" ? "2px solid var(--accent, #c8b898)" : "2px solid transparent",
          }}
        >
          {layer.children.length > 0 ? (
            <button
              type="button"
              className="layers-tree-disclosure"
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${layer.name}`}
              aria-expanded={!isCollapsed}
              onClick={event => {
                event.stopPropagation();
                toggleCollapsed(nodeCollapseKey);
              }}
            >
              {isCollapsed ? "›" : "⌄"}
            </button>
          ) : <span className="layers-tree-disclosure-spacer" />}

          <button
            type="button"
            className="layers-tree-select"
            aria-label={`Select ${layer.name}`}
            onClick={event => selectLayer(tree.frame.id, layer, event)}
            onContextMenu={event => {
              event.preventDefault();
              onSelectElement(tree.frame.id, layer.layerId, layer.path);
              setContextMenu({ x: event.clientX, y: event.clientY, frameId: tree.frame.id, layerId: layer.layerId });
            }}
            onKeyDown={event => {
              if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              reorderLayer(tree.frame.id, layer.layerId, event.key === "ArrowUp" ? "forward" : "backward");
            }}
          >
            <span className="layers-tree-kind" style={{ color: meta.color }}>{meta.icon}</span>
            <span className="layers-tree-name">{layer.name}</span>
          </button>

          {!isAutoLayer && isSelected && (
            <span className="layers-tree-actions">
              {onLockToggle && (
                <button
                  type="button"
                  className="layers-tree-action"
                  aria-label={`${isLocked ? "Unlock" : "Lock"} ${layer.name}`}
                  title={isLocked ? "Unlock" : "Lock"}
                  onClick={() => onLockToggle(tree.frame.id, layer.layerId, !isLocked)}
                >
                  {isLocked ? "■" : "□"}
                </button>
              )}
              {onHideToggle && (
                <button
                  type="button"
                  className="layers-tree-action"
                  aria-label={`${isHidden ? "Show" : "Hide"} ${layer.name}`}
                  title={isHidden ? "Show" : "Hide"}
                  onClick={() => onHideToggle(tree.frame.id, layer.layerId, !isHidden)}
                >
                  {isHidden ? "○" : "●"}
                </button>
              )}
              <button
                type="button"
                className="layers-tree-action"
                aria-label={`Bring ${layer.name} forward`}
                title="Bring forward"
                onClick={() => reorderLayer(tree.frame.id, layer.layerId, "forward")}
              >
                ↑
              </button>
              <button
                type="button"
                className="layers-tree-action"
                aria-label={`Send ${layer.name} backward`}
                title="Send backward"
                onClick={() => reorderLayer(tree.frame.id, layer.layerId, "backward")}
              >
                ↓
              </button>
            </span>
          )}
        </div>

        {!isCollapsed && childLayers.length > 0 && (
          <div role="group">{childLayers.map(child => renderLayer(tree, child))}</div>
        )}
      </div>
    );
  };

  return (
    <div style={panelStyle} onClick={() => setContextMenu(null)}>
      <div className="layers-tree-header">
        <span>Layers · {frames.length} frames · {totalLayers} objects</span>
        {multiSelect.size > 1 && (
          <button type="button" className="layers-tree-group" onClick={handleGroup}>
            Group ({multiSelect.size})
          </button>
        )}
      </div>

      {status && <div className="layers-tree-status" role="status">{status}</div>}

      <div className="layers-tree" role="tree" aria-label="Design layers">
        {frameTrees.length === 0 ? (
          <div className="layers-tree-empty">Create a frame to start organizing layers.</div>
        ) : frameTrees.map(tree => {
          const frameCollapseKey = collapseKey(tree.frame.id);
          const isCollapsed = collapsed.has(frameCollapseKey);
          const isSelected = selectedFrameId === tree.frame.id;
          const roots = [...tree.roots].reverse();
          return (
            <div key={tree.frame.id} role="treeitem" aria-level={1} aria-expanded={!isCollapsed} aria-selected={isSelected}>
              <div className={`layers-tree-frame${isSelected ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="layers-tree-disclosure"
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} frame ${tree.frame.name}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(frameCollapseKey)}
                >
                  {isCollapsed ? "›" : "⌄"}
                </button>
                <button
                  type="button"
                  className="layers-tree-frame-select"
                  onClick={() => {
                    setMultiSelect(new Set());
                    onSelectFrame(tree.frame.id);
                  }}
                >
                  <span className="layers-tree-frame-icon">F</span>
                  <span className="layers-tree-name">{tree.frame.name}</span>
                  <span className="layers-tree-dimensions">{tree.frame.width}×{tree.frame.height}</span>
                </button>
              </div>
              {!isCollapsed && roots.length > 0 && (
                <div role="group">{roots.map(layer => renderLayer(tree, layer))}</div>
              )}
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div
          className="layers-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={event => event.stopPropagation()}
        >
          <ContextMenuItem onClick={() => { onLayerDuplicate?.(contextMenu.frameId, contextMenu.layerId); setContextMenu(null); }}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { onLayerDelete?.(contextMenu.frameId, contextMenu.layerId); setContextMenu(null); }}>
            Delete
          </ContextMenuItem>
          <ContextMenuItem onClick={() => reorderLayer(contextMenu.frameId, contextMenu.layerId, "forward")}>
            Bring forward
          </ContextMenuItem>
          <ContextMenuItem onClick={() => reorderLayer(contextMenu.frameId, contextMenu.layerId, "backward")}>
            Send backward
          </ContextMenuItem>
          {multiSelect.size > 1 && <ContextMenuItem onClick={handleGroup}>Group ({multiSelect.size})</ContextMenuItem>}
          {frameTrees.some(tree => tree.frame.id === contextMenu.frameId && tree.byId.get(contextMenu.layerId)?.kind === "group") && (
            <ContextMenuItem onClick={() => handleUngroup(contextMenu.frameId, contextMenu.layerId)}>Ungroup</ContextMenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="layers-context-menu-item" onClick={onClick}>
      {children}
    </button>
  );
}
