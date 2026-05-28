import { useReducer, useRef, useEffect } from "react";

export type DropdownAction =
  | { type: "TOGGLE_ALIGN" }
  | { type: "TOGGLE_BOOL" }
  | { type: "TOGGLE_SHAPES" }
  | { type: "TOGGLE_DRAW" }
  | { type: "CLOSE_ALIGN" }
  | { type: "CLOSE_BOOL" }
  | { type: "CLOSE_SHAPES" }
  | { type: "CLOSE_DRAW" }
  | { type: "CLOSE_ALL" };

interface DropdownState {
  alignOpen: boolean;
  boolOpen: boolean;
  shapesOpen: boolean;
  drawOpen: boolean;
}

function dropdownReducer(state: DropdownState, action: DropdownAction): DropdownState {
  switch (action.type) {
    case "TOGGLE_ALIGN":
      return { alignOpen: !state.alignOpen, boolOpen: false, shapesOpen: false, drawOpen: false };
    case "TOGGLE_BOOL":
      return { boolOpen: !state.boolOpen, alignOpen: false, shapesOpen: false, drawOpen: false };
    case "TOGGLE_SHAPES":
      return { shapesOpen: !state.shapesOpen, alignOpen: false, boolOpen: false, drawOpen: false };
    case "TOGGLE_DRAW":
      return { drawOpen: !state.drawOpen, alignOpen: false, boolOpen: false, shapesOpen: false };
    case "CLOSE_ALIGN":
      return { ...state, alignOpen: false };
    case "CLOSE_BOOL":
      return { ...state, boolOpen: false };
    case "CLOSE_SHAPES":
      return { ...state, shapesOpen: false };
    case "CLOSE_DRAW":
      return { ...state, drawOpen: false };
    case "CLOSE_ALL":
      return { alignOpen: false, boolOpen: false, shapesOpen: false, drawOpen: false };
    default:
      return state;
  }
}

export function useDropdowns() {
  const [dropdowns, dispatch] = useReducer(dropdownReducer, {
    alignOpen: false,
    boolOpen: false,
    shapesOpen: false,
    drawOpen: false,
  });

  const { alignOpen, boolOpen, shapesOpen, drawOpen } = dropdowns;

  const alignRef = useRef<HTMLDivElement>(null);
  const boolRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!alignOpen && !boolOpen && !shapesOpen && !drawOpen) return;
    const handler = (e: MouseEvent) => {
      if (alignRef.current && !alignRef.current.contains(e.target as Node)) dispatch({ type: "CLOSE_ALIGN" });
      if (boolRef.current && !boolRef.current.contains(e.target as Node)) dispatch({ type: "CLOSE_BOOL" });
      if (shapesRef.current && !shapesRef.current.contains(e.target as Node)) dispatch({ type: "CLOSE_SHAPES" });
      if (drawRef.current && !drawRef.current.contains(e.target as Node)) dispatch({ type: "CLOSE_DRAW" });
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [alignOpen, boolOpen, shapesOpen, drawOpen]);

  // Close on Escape
  useEffect(() => {
    if (!shapesOpen && !drawOpen && !alignOpen && !boolOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "CLOSE_ALL" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shapesOpen, drawOpen, alignOpen, boolOpen]);

  return {
    alignOpen,
    boolOpen,
    shapesOpen,
    drawOpen,
    dispatch,
    alignRef,
    boolRef,
    shapesRef,
    drawRef,
  } as const;
}
