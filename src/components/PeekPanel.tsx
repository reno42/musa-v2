/**
 * PeekPanel — the shared Notion-style right drawer.
 *
 * Every "detalles al click" surface opens the same panel: Copywriting piezas,
 * campañas del reporte, recetas, etapas del embudo, tareas del Kanban y
 * archivos de Tablas. Portaled to document.body because the dashboard's
 * motion wrappers create stacking contexts that trap a fixed panel UNDER the
 * navbar — portaled, the peek competes at the root and wins.
 *
 * z 9010 sits above every app chrome — navbar (10), Tu plan (8000), generic
 * dialogs (1000) — and only below the toasts (99999). Overlays that open
 * FROM a peek must portal higher themselves (ContentTab's publish dialog
 * uses 9500; KanbanTab's edit modal 9300).
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface PeekPanelProps {
  open: boolean;
  onClose: () => void;
  /** Accessible dialog name. */
  label: string;
  /** Panel width in px; defaults to the ContentTab measurement. */
  width?: number;
  /** True while another overlay is stacked on top — Escape yields to it. */
  escGuard?: boolean;
  children: React.ReactNode;
}

export function PeekPanel({ open, onClose, label, width = 620, escGuard = false, children }: PeekPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || escGuard) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, escGuard]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="peek-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="peek" role="dialog" aria-label={label}
        style={width === 620 ? undefined : { width: `min(${width}px, 100vw)` }}>
        {children}
      </aside>
    </>,
    document.body,
  );
}

/** Standard peek header: uppercase context label, optional actions, × close. */
export function PeekHead({ label, onClose, actions }: {
  label: string;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <header className="peek-head">
      <span className="peek-head-label">{label}</span>
      {actions}
      <button type="button" aria-label="Cerrar detalle" className="peek-close" onClick={onClose}>×</button>
    </header>
  );
}
