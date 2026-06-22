import { useState, useCallback, useEffect, useRef } from "react";

export type DockSide = "left" | "right" | null;

export interface DockState {
  x: number;
  y: number;
  isDocked: boolean;
  dockSide: DockSide;
}

const DOCK_THRESHOLD = 30;   // px from edge to trigger dock
const UNDOCK_THRESHOLD = 60; // px from edge to undock (when dragging docked panel)
const DOCK_ANIM_TIME = 200;  // ms transition

export function useDockablePanel(
  initialX: number,
  initialY: number,
  defaultDock: DockSide = null,
) {
  const [state, setState] = useState<DockState>({
    x: initialX,
    y: initialY,
    isDocked: defaultDock !== null,
    dockSide: defaultDock,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panelX: 0, panelY: 0, wasDocked: false, dockedSide: null as DockSide });

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const st = stateRef.current;
    draggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panelX: st.x,
      panelY: st.y,
      wasDocked: st.isDocked,
      dockedSide: st.dockSide,
    };
    // If docked, undock and position at cursor
    if (st.isDocked) {
      const panelWidth = (e.currentTarget as HTMLElement).parentElement?.offsetWidth || 260;
      const newX = st.dockSide === "right"
        ? window.innerWidth - panelWidth - 80
        : 80;
      setState({
        x: newX,
        y: Math.max(56, e.clientY - 20),
        isDocked: false,
        dockSide: null,
      });
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const ds = dragStartRef.current;
      const dx = e.clientX - ds.x;
      const dy = e.clientY - ds.y;
      setState(prev => ({
        ...prev,
        isDocked: false,
        dockSide: null,
        x: ds.panelX + dx,
        y: Math.max(44, ds.panelY + dy),
      }));
    };

    const onUp = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      setState(prev => {
        // Check if near left or right edge
        const panelWidth = 270; // approximate
        if (e.clientX < DOCK_THRESHOLD) {
          return { ...prev, x: 0, y: 56, isDocked: true, dockSide: "left" };
        }
        if (e.clientX > window.innerWidth - DOCK_THRESHOLD) {
          return { ...prev, x: window.innerWidth - panelWidth, y: 56, isDocked: true, dockSide: "right" };
        }
        // If previously docked and dragged far enough, stay undocked
        if (dragStartRef.current.wasDocked) {
          const fromEdge = dragStartRef.current.dockedSide === "left"
            ? e.clientX
            : window.innerWidth - e.clientX;
          if (fromEdge < UNDOCK_THRESHOLD) {
            // Snap back to dock
            const side = dragStartRef.current.dockedSide || "right";
            return {
              x: side === "left" ? 0 : window.innerWidth - panelWidth,
              y: 56,
              isDocked: true,
              dockSide: side,
            };
          }
        }
        return prev;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const toggleDock = useCallback((side: DockSide) => {
    setState(prev => {
      if (prev.isDocked && prev.dockSide === side) {
        // Undock
        return {
          x: side === "left" ? 80 : window.innerWidth - 350,
          y: prev.y,
          isDocked: false,
          dockSide: null,
        };
      }
      // Dock
      return {
        x: side === "left" ? 0 : window.innerWidth - 280,
        y: 56,
        isDocked: true,
        dockSide: side,
      };
    });
  }, []);

  const panelStyle = (width: number): React.CSSProperties => ({
    position: "fixed",
    left: state.isDocked
      ? (state.dockSide === "left" ? 0 : window.innerWidth - width)
      : state.x,
    top: state.isDocked ? 44 : state.y,
    zIndex: state.isDocked ? 15 : 25,
    transition: `left ${DOCK_ANIM_TIME}ms ease, top ${DOCK_ANIM_TIME}ms ease`,
  });

  const handleProps = {
    onMouseDown: startDrag,
    style: {
      cursor: "grab",
      userSelect: "none" as const,
    },
  };

  return { state, startDrag, toggleDock, panelStyle, handleProps };
}
