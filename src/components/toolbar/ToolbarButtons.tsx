import type { ToolName } from "../../hooks/useCanvas";

interface ToolBtnProps {
  id: ToolName;
  tool: ToolName;
  onChange: (t: ToolName) => void;
  title: string;
  shortcut?: string;
  children: React.ReactNode;
}

export function ToolBtn({ id, tool, onChange, title, shortcut, children }: ToolBtnProps) {
  return (
    <button type="button" className={`tool-btn ${tool === id ? "active" : ""}`} onClick={() => onChange(id)} title={title} aria-label={title}>
      <svg viewBox="0 0 24 24">{children}</svg>
      {shortcut && <span className="shortcut">{shortcut}</span>}
    </button>
  );
}

interface AlignBtnProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}

export function AlignBtn({ icon, title, onClick }: AlignBtnProps) {
  return (
    <button type="button" className="align-dropdown-btn" onClick={onClick} title={title} aria-label={title}>
      <svg viewBox="0 0 24 24">{icon}</svg>
    </button>
  );
}

interface PopupBtnProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}

export function PopupBtn({ icon, label, shortcut, active, onClick }: PopupBtnProps) {
  return (
    <button
      type="button"
      className={`popup-item-btn${active ? " active" : ""}`}
      onClick={onClick}
      title={label + (shortcut ? ` (${shortcut})` : "")}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" className="popup-item-icon">{icon}</svg>
      <span className="popup-item-label">{label}</span>
      {shortcut && <span className="popup-item-shortcut">{shortcut}</span>}
    </button>
  );
}

export function Divider() {
  return <div className="toolbar-divider" />;
}

export function Spacer() {
  return <div className="toolbar-spacer" />;
}
