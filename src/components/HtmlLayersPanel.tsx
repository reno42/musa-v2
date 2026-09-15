import { measureContainerForBake, ungroupPreservingLayout } from "../lib/groupSemantics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameData, HtmlCanvasObject } from "./DesignFrame";
import type { LayerKind, LayerNode } from "../hooks/useLayerTree";
import { parseLayerTree } from "../hooks/useLayerTree";
import {
  groupLayersInHtml,
  reorderLayerInStack,
  ungroupLayerInHtml,
} from "../lib/htmlMutations";
import type { LayerDropPlacement, LayerStackChange, LayerStackDirection, LayerStackPlacement } from "../lib/htmlMutations";

interface Props {
  frames: FrameData[];
  canvasObjects: HtmlCanvasObject[];
  selectedFrameId: string | null;
  selectedFrameIds: Set<string>;
  selectedOrphanIds: Set<string>;
  selectedElementId: string | null;
  selectedElementIds: readonly string[];
  onSelectFrame: (frameId: string) => void;
  onFrameShiftClick?: (frameId: string) => void;
  onSelectElement: (frameId: string, layerId: string, path?: number[], additive?: boolean) => void;
  onSelectOrphan?: (id: string | null) => void;
  onOrphanShiftClick?: (id: string) => void;
  onOrphanDelete?: (id: string) => void;
  onHtmlChange: (frameId: string, newHtml: string) => void;
  onLayerStackChange: (frameId: string, change: LayerStackChange) => void;
  onLayerDrop: (
    sourceFrameId: string,
    layerId: string,
    targetFrameId: string,
    targetLayerId: string | null,
    placement: LayerDropPlacement,
  ) => void;
  onFrameReorder: (sourceFrameId: string, targetFrameId: string, placement: LayerStackPlacement) => void;
  onLayerDelete?: (frameId: string, layerId: string) => void;
  onLayerDuplicate?: (frameId: string, layerId: string) => void;
  onMultiSelectChange?: (ids: string[]) => void;
  onLockToggle?: (frameId: string, layerId: string, locked: boolean) => void;
  onHideToggle?: (frameId: string, layerId: string, hidden: boolean) => void;
  lockedLayersByFrame?: Map<string, Set<string>>;
  hiddenLayersByFrame?: Map<string, Set<string>>;
  /** Drop an orphan onto a frame (layers-panel drag) */
  onOrphanDropToFrame?: (orphanId: string, targetFrameId: string) => void;
}

interface FrameTree {
  frame: FrameData;
  nodes: LayerNode[];
  byId: Map<string, LayerNode>;
  roots: LayerNode[];
}

interface LayerDragSource {
  kind: "layer";
  frameId: string;
  layerId: string;
}

interface FrameDragSource {
  kind: "frame";
  frameId: string;
}

interface OrphanDragSource {
  kind: "orphan";
  orphanId: string;
}

type DragSource = LayerDragSource | FrameDragSource | OrphanDragSource;

type DropTarget =
  | { kind: "layer"; frameId: string; layerId: string; placement: LayerDropPlacement }
  | { kind: "frame"; frameId: string; placement: LayerDropPlacement };

interface ActionMenuState {
  x: number;
  y: number;
  frameId: string;
  layerId: string;
}

interface PointerDragState {
  source: DragSource;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
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
  container: { icon: "BOX", color: "#9dc9b7" },
  button: { icon: "BTN", color: "#a8c8e8" },
  component: { icon: "CMP", color: "#a8c8e8" },
};

function layerKey(frameId: string, layerId: string): string {
  return `${frameId}:${layerId}`;
}

function collapseKey(frameId: string, layerId?: string): string {
  return layerId ? `layer:${frameId}:${layerId}` : `frame:${frameId}`;
}

function buildFrameTree(frame: FrameData): FrameTree {
  const nodes = parseLayerTree(frame.html, frame.css);
  const byId = new Map(nodes.map(node => [node.layerId, node]));
  return { frame, nodes, byId, roots: nodes.filter(node => node.parentId === null) };
}

function buildFrameTrees(frames: FrameData[]): FrameTree[] {
  const trees = frames.map(buildFrameTree);
  const usedNumbers = new Set<number>();
  for (const tree of trees) {
    for (const node of tree.nodes) {
      if (node.kind !== "group" || node.autoNamed) continue;
      const match = /^Group\s+(\d+)$/i.exec(node.name);
      if (match) usedNumbers.add(Number(match[1]));
    }
  }

  let groupNumber = 1;
  for (const tree of trees) {
    for (const node of tree.nodes) {
      if (!node.autoNamed) continue;
      while (usedNumbers.has(groupNumber)) groupNumber++;
      node.name = `Group ${groupNumber}`;
      usedNumbers.add(groupNumber++);
    }
  }
  return trees;
}

function nextGroupName(frameTrees: FrameTree[]): string {
  let highest = 0;
  for (const tree of frameTrees) {
    for (const node of tree.nodes) {
      if (node.kind !== "group") continue;
      const match = /^Group\s+(\d+)$/i.exec(node.name);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  return `Group ${highest + 1}`;
}

function getLayerDropPlacement(bounds: DOMRect, clientY: number, canContain: boolean): LayerDropPlacement {
  const ratio = (clientY - bounds.top) / bounds.height;
  if (canContain && ratio >= 0.25 && ratio <= 0.75) return "inside";
  return ratio < 0.5 ? "above" : "below";
}

function getFrameDropPlacement(bounds: DOMRect, clientY: number, source: DragSource): LayerDropPlacement {
  if (source.kind === "layer" || source.kind === "orphan") return "inside";
  return clientY < bounds.top + bounds.height / 2 ? "above" : "below";
}

export function HtmlLayersPanel({
  frames,
  canvasObjects,
  selectedFrameId,
  selectedFrameIds,
  selectedOrphanIds,
  selectedElementId,
  selectedElementIds,
  onSelectFrame,
  onFrameShiftClick,
  onSelectElement,
  onSelectOrphan,
  onOrphanShiftClick,
  onOrphanDelete,
  onHtmlChange,
  onLayerStackChange,
  onLayerDrop,
  onFrameReorder,
  onLayerDelete,
  onLayerDuplicate,
  onMultiSelectChange,
  onLockToggle,
  onHideToggle,
  lockedLayersByFrame,
  hiddenLayersByFrame,
  onOrphanDropToFrame,
}: Props) {
  const frameTrees = useMemo(() => buildFrameTrees(frames), [frames]);
  const totalLayers = useMemo(
    () => frameTrees.reduce((total, tree) => total + tree.nodes.length, 0),
    [frameTrees],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const multiSelect = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const [dragging, setDragging] = useState<DragSource | null>(null);
  const draggingRef = useRef<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const suppressLayerClickRef = useRef(false);
  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const actionMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("");

  // Reveal the selected layer: auto-expand its ancestors, then scroll its
  // row into view so the user can see where the selection sits in the stack.
  useEffect(() => {
    if (!selectedFrameId || !selectedElementId) return;
    const tree = frameTrees.find(t => t.frame.id === selectedFrameId);
    if (!tree) return;
    const toExpand: string[] = [];
    let node = tree.byId.get(selectedElementId);
    while (node && node.parentId) {
      toExpand.push(collapseKey(selectedFrameId, node.parentId));
      node = tree.byId.get(node.parentId);
    }
    if (toExpand.length) {
      setCollapsed(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const k of toExpand) if (next.delete(k)) changed = true;
        return changed ? next : prev;
      });
    }
    const raf = requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedFrameId, selectedElementId, frameTrees]);

  useEffect(() => {
    if (selectedOrphanIds.size === 0) return;
    const raf = requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedOrphanIds]);

  useEffect(() => {
    if (!actionMenu) return;
    actionMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActionMenu(null);
      actionMenuTriggerRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionMenuRef.current?.contains(target) || actionMenuTriggerRef.current?.contains(target)) return;
      setActionMenu(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsidePointer);
    };
  }, [actionMenu]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectLayer = useCallback((frameId: string, layer: LayerNode, event: React.MouseEvent) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    onSelectElement(frameId, layer.layerId, layer.path, additive && selectedFrameId === frameId);
    setActionMenu(null);
  }, [onSelectElement, selectedFrameId]);

  const applyStackChange = useCallback((frameId: string, change: LayerStackChange | null) => {
    if (!change) {
      // reorderLayerInStack devuelve null tanto si la capa no comparte grupo
      // como si ya está al fondo/tope del stack — el mensaje anterior mentía
      // en el caso del borde y hacía creer que el z-reorder no existía
      // (dogfood BUG-23). Misma frase que el reorder del canvas (EditorV2).
      setStatus("La capa ya está en ese extremo de su grupo.");
      return;
    }
    setStatus("");
    onLayerStackChange(frameId, change);
  }, [onLayerStackChange]);

  const reorderLayer = useCallback((frameId: string, layerId: string, direction: LayerStackDirection) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    applyStackChange(frameId, reorderLayerInStack(frame.html, layerId, direction));
    setActionMenu(null);
  }, [frames, applyStackChange]);

  const clearDragState = useCallback(() => {
    draggingRef.current = null;
    dropTargetRef.current = null;
    pointerDragRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback((target: DropTarget) => {
    const source = draggingRef.current;
    if (!source) return;

    if (source.kind === "frame") {
      if (target.kind === "frame" && source.frameId !== target.frameId && target.placement !== "inside") {
        onFrameReorder(source.frameId, target.frameId, target.placement);
        setStatus("");
      }
    } else if (source.kind === "orphan") {
      if (target.kind === "frame") {
        onOrphanDropToFrame?.(source.orphanId, target.frameId);
        setStatus("");
      }
    } else {
      const targetLayerId = target.kind === "layer" ? target.layerId : null;
      if (source.frameId !== target.frameId || source.layerId !== targetLayerId) {
        onLayerDrop(source.frameId, source.layerId, target.frameId, targetLayerId, target.placement);
        setStatus("");
      }
    }
    clearDragState();
  }, [onFrameReorder, onLayerDrop, onOrphanDropToFrame, clearDragState]);

  const handleGroup = useCallback(() => {
    if (!selectedFrameId || multiSelect.size < 2) return;
    const frame = frames.find(item => item.id === selectedFrameId);
    if (!frame) return;
    const result = groupLayersInHtml(
      frame.html,
      [...multiSelect],
      `grp_${Date.now().toString(36)}`,
      nextGroupName(frameTrees),
    );
    if (result) onHtmlChange(frame.id, result);
    onMultiSelectChange?.([]);
    setActionMenu(null);
  }, [selectedFrameId, multiSelect, frames, frameTrees, onHtmlChange, onMultiSelectChange]);

  const handleUngroup = useCallback((frameId: string, groupId: string) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    // Safe ungroup: bake each child's rendered position + text styles before
    // dissolving the wrapper, so nothing jumps and typography never changes.
    const bake = measureContainerForBake(frameId, groupId);
    const result = bake
      ? ungroupPreservingLayout(frame.html, bake)
      : ungroupLayerInHtml(frame.html, groupId);
    if (result) onHtmlChange(frame.id, result);
    setActionMenu(null);
  }, [frames, onHtmlChange]);

  const openActionMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>, frameId: string, layerId: string) => {
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    actionMenuTriggerRef.current = event.currentTarget;
    setActionMenu({
      x: Math.min(window.innerWidth - 182, Math.max(8, bounds.right - 170)),
      y: Math.min(window.innerHeight - 230, bounds.bottom + 4),
      frameId,
      layerId,
    });
  }, []);

  const beginPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, source: DragSource) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".layers-tree-action, .layers-tree-disclosure")) return;
    pointerDragRef.current = {
      source,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, []);

  const updatePointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;

    event.preventDefault();
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    state.moved = true;
    draggingRef.current = state.source;
    setDragging(state.source);

    const targetElement = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-layer-drop-kind]");
    if (!targetElement) {
      dropTargetRef.current = null;
      setDropTarget(null);
      return;
    }

    const frameId = targetElement.dataset.layerFrameId;
    const targetKind = targetElement.dataset.layerDropKind;
    if (!frameId) return;

    let target: DropTarget | null = null;
    const bounds = targetElement.getBoundingClientRect();
    if (targetKind === "frame") {
      target = {
        kind: "frame",
        frameId,
        placement: getFrameDropPlacement(bounds, event.clientY, state.source),
      };
    } else if (targetKind === "layer" && state.source.kind === "layer") {
      const layerId = targetElement.dataset.dropLayerId;
      if (layerId) {
        target = {
          kind: "layer",
          frameId,
          layerId,
          placement: getLayerDropPlacement(bounds, event.clientY, ["group", "container", "component"].includes(targetElement.dataset.layerKind || "")),
        };
      }
    }
    dropTargetRef.current = target;
    setDropTarget(target);
  }, []);

  const finishPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (state.moved) {
      suppressLayerClickRef.current = true;
      const target = dropTargetRef.current;
      if (target) handleDrop(target);
      else clearDragState();
      window.setTimeout(() => { suppressLayerClickRef.current = false; }, 0);
    } else {
      clearDragState();
    }
  }, [handleDrop, clearDragState]);

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
    const currentDrop = dropTarget?.kind === "layer"
      && dropTarget.frameId === tree.frame.id
      && dropTarget.layerId === layer.layerId
      ? dropTarget
      : null;
    const childLayers = [...layer.children]
      .reverse()
      .map(childId => tree.byId.get(childId))
      .filter((child): child is LayerNode => Boolean(child));

    return (
      <div key={key} role="treeitem" aria-level={layer.depth + 2} aria-selected={isSelected}>
        <div
          ref={selectedElementId === layer.layerId ? selectedRowRef : undefined}
          className={`layers-tree-row${isSelected ? " is-selected" : ""}${dragging?.kind === "layer" && dragging.layerId === layer.layerId ? " is-dragging" : ""}${currentDrop?.placement === "inside" ? " is-drop-inside" : ""}`}
          data-layer-drop-kind="layer"
          data-layer-frame-id={tree.frame.id}
          data-drop-layer-id={layer.layerId}
          data-layer-kind={layer.kind}
          onPointerDown={event => {
            if (!isAutoLayer) beginPointerDrag(event, {
              kind: "layer",
              frameId: tree.frame.id,
              layerId: layer.layerId,
            });
          }}
          onPointerMove={updatePointerDrag}
          onPointerUp={finishPointerDrag}
          onPointerCancel={clearDragState}
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
            onClick={event => {
              if (suppressLayerClickRef.current) return;
              selectLayer(tree.frame.id, layer, event);
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
                aria-label={`More actions for ${layer.name}`}
                aria-haspopup="menu"
                aria-expanded={actionMenu?.frameId === tree.frame.id && actionMenu.layerId === layer.layerId}
                title="More actions"
                onClick={event => openActionMenu(event, tree.frame.id, layer.layerId)}
              >
                •••
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
    <div style={panelStyle} onClick={() => setActionMenu(null)}>
      <div className="layers-tree-header">
        <span>Layers · {frames.length} frame{frames.length !== 1 ? "s" : ""} · {totalLayers + canvasObjects.length} objects</span>
        {multiSelect.size > 1 && (
          <button type="button" className="layers-tree-group" onClick={handleGroup}>
            Group ({multiSelect.size})
          </button>
        )}
      </div>

      {status && <div className="layers-tree-status" role="status">{status}</div>}

      <div className="layers-tree" role="tree" aria-label="Design layers">
        {frameTrees.length === 0 && canvasObjects.length === 0 ? (
          <div className="layers-tree-empty">Create a frame to start organizing layers.</div>
        ) : null}
        {frameTrees.map(tree => {
          const frameCollapseKey = collapseKey(tree.frame.id);
          const isCollapsed = collapsed.has(frameCollapseKey);
          const isSelected = selectedFrameIds.has(tree.frame.id);
          const roots = [...tree.roots].reverse();
          const currentFrameDrop = dropTarget?.kind === "frame" && dropTarget.frameId === tree.frame.id
            ? dropTarget
            : null;
          return (
            <div key={tree.frame.id} role="treeitem" aria-level={1} aria-expanded={!isCollapsed} aria-selected={isSelected}>
              <div
                className={`layers-tree-frame${isSelected ? " is-selected" : ""}${dragging?.kind === "frame" && dragging.frameId === tree.frame.id ? " is-dragging" : ""}${currentFrameDrop?.placement === "inside" ? " is-drop-inside" : ""}`}
                data-layer-drop-kind="frame"
                data-layer-frame-id={tree.frame.id}
                onPointerDown={event => beginPointerDrag(event, { kind: "frame", frameId: tree.frame.id })}
                onPointerMove={updatePointerDrag}
                onPointerUp={finishPointerDrag}
                onPointerCancel={clearDragState}
                style={{
                  borderTop: currentFrameDrop?.placement === "above" ? "2px solid var(--accent, #c8b898)" : "2px solid transparent",
                  borderBottom: currentFrameDrop?.placement === "below" ? "2px solid var(--accent, #c8b898)" : "2px solid transparent",
                }}
              >
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
                  onClick={(event) => {
                    if (suppressLayerClickRef.current) return;
                    onMultiSelectChange?.([]);
                    if (event.shiftKey) onFrameShiftClick?.(tree.frame.id);
                    else onSelectFrame(tree.frame.id);
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
        {canvasObjects.length > 0 && (
          <>
            {[...canvasObjects].sort((a, b) => b.zIndex - a.zIndex).map(obj => {
              const isSelected = selectedOrphanIds.has(obj.id);
              const meta = KIND_META[obj.kind as LayerKind] || KIND_META.shape;
              const isDragging = dragging?.kind === "orphan" && dragging.orphanId === obj.id;
              return (
                <div
                  ref={isSelected ? selectedRowRef : undefined}
                  key={obj.id}
                  role="treeitem"
                  aria-level={1}
                  aria-selected={isSelected}
                  className={`layers-tree-row${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}`}
                  data-layer-drop-kind="orphan"
                  onPointerDown={event => beginPointerDrag(event, { kind: "orphan", orphanId: obj.id })}
                  onPointerMove={updatePointerDrag}
                  onPointerUp={finishPointerDrag}
                  onPointerCancel={clearDragState}
                  onClick={(event) => {
                    if (suppressLayerClickRef.current) return;
                    if (event.shiftKey) onOrphanShiftClick?.(obj.id);
                    else onSelectOrphan?.(obj.id);
                  }}
                  style={{ paddingLeft: 8 }}
                >
                  <span className="layers-tree-disclosure-spacer" />
                  <button
                    type="button"
                    className="layers-tree-select"
                    style={{ width: "100%", textAlign: "left" }}
                  >
                    <span className="layers-tree-kind" style={{ color: meta.color }}>{meta.icon}</span>
                    <span className="layers-tree-name">{obj.name}</span>
                  </button>
                  {isSelected && onOrphanDelete && (
                    <span className="layers-tree-actions">
                      <button
                        type="button"
                        className="layers-tree-action"
                        title="Delete object"
                        onClick={(e) => { e.stopPropagation(); onOrphanDelete(obj.id); }}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {actionMenu && (
        <div
          ref={actionMenuRef}
          className="layers-context-menu"
          role="menu"
          aria-label="Layer actions"
          style={{ left: actionMenu.x, top: actionMenu.y }}
          onClick={event => event.stopPropagation()}
        >
          <ActionMenuItem onClick={() => { onLayerDuplicate?.(actionMenu.frameId, actionMenu.layerId); setActionMenu(null); }}>
            Duplicate
          </ActionMenuItem>
          <ActionMenuItem onClick={() => { onLayerDelete?.(actionMenu.frameId, actionMenu.layerId); setActionMenu(null); }}>
            Delete
          </ActionMenuItem>
          <ActionMenuItem onClick={() => reorderLayer(actionMenu.frameId, actionMenu.layerId, "forward")}>
            Bring forward
          </ActionMenuItem>
          <ActionMenuItem onClick={() => reorderLayer(actionMenu.frameId, actionMenu.layerId, "backward")}>
            Send backward
          </ActionMenuItem>
          {multiSelect.size > 1 && <ActionMenuItem onClick={handleGroup}>Group ({multiSelect.size})</ActionMenuItem>}
          {frameTrees.some(tree => tree.frame.id === actionMenu.frameId && tree.byId.get(actionMenu.layerId)?.kind === "group") && (
            <ActionMenuItem onClick={() => handleUngroup(actionMenu.frameId, actionMenu.layerId)}>Ungroup</ActionMenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function ActionMenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" className="layers-context-menu-item" onClick={onClick}>
      {children}
    </button>
  );
}
