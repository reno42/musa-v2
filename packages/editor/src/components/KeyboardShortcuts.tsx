import { useState, Fragment, useRef, useEffect } from "react";

interface Shortcut {
  keys: string;
  description: string;
}

interface Category {
  name: string;
  shortcuts: Shortcut[];
}

const SHORTCUTS: Category[] = [
  {
    name: "Tools",
    shortcuts: [
      { keys: "V", description: "Select / Move tool" },
      { keys: "H", description: "Hand / Pan tool" },
      { keys: "R", description: "Rectangle tool" },
      { keys: "O", description: "Ellipse tool" },
      { keys: "L", description: "Line tool" },
      { keys: "T", description: "Text tool" },
      { keys: "F", description: "Frame tool" },
      { keys: "P", description: "Pen / Pencil tool" },
      { keys: "I", description: "Eyedropper tool" },
      { keys: "U", description: "Image tool" },
    ],
  },
  {
    name: "Edit",
    shortcuts: [
      { keys: "Ctrl+Z", description: "Undo" },
      { keys: "Ctrl+Shift+Z", description: "Redo" },
      { keys: "Ctrl+C", description: "Copy selection" },
      { keys: "Ctrl+V", description: "Paste" },
      { keys: "Ctrl+D", description: "Duplicate selection" },
      { keys: "Delete", description: "Delete selection" },
      { keys: "Ctrl+G", description: "Group selection" },
      { keys: "Ctrl+Shift+G", description: "Ungroup" },
      { keys: "Ctrl+A", description: "Select all" },
      { keys: "Escape", description: "Deselect all" },
    ],
  },
  {
    name: "View",
    shortcuts: [
      { keys: "Ctrl++", description: "Zoom in" },
      { keys: "Ctrl+-", description: "Zoom out" },
      { keys: "Ctrl+0", description: "Zoom to fit" },
      { keys: "G", description: "Toggle grid" },
      { keys: "Shift+G", description: "Toggle snap to grid" },
    ],
  },
  {
    name: "Alignment",
    shortcuts: [
      { keys: "Alt+A", description: "Align left" },
      { keys: "Alt+D", description: "Align right" },
      { keys: "Alt+W", description: "Align top" },
      { keys: "Alt+S", description: "Align bottom" },
      { keys: "Alt+H", description: "Align center horizontal" },
      { keys: "Alt+V", description: "Align center vertical" },
    ],
  },
  {
    name: "Navigation",
    shortcuts: [
      { keys: "Ctrl+K", description: "Open shortcuts dialog" },
      { keys: "Ctrl+B", description: "Open Batch-a-mator" },
      { keys: "Space+Drag", description: "Pan canvas" },
      { keys: "Ctrl+S", description: "Save" },
    ],
  },
];

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

// Extracted style constants
const dialogBaseStyle: React.CSSProperties = {
  border: "none", borderRadius: 10, padding: 0,
  background: "transparent", color: "#e4e4f0",
  maxWidth: 560, width: "100%", overflow: "visible",
};
const dialogStyle: React.CSSProperties = {
  background: "#0e0e16", border: "1px solid #1c1c26", borderRadius: 10,
  width: 560, maxHeight: "80vh", overflow: "auto",
  color: "#e4e4f0", fontFamily: "Inter, system-ui, sans-serif",
};
const headerStyle: React.CSSProperties = {
  padding: "14px 18px", borderBottom: "1px solid #1c1c26",
  display: "flex", alignItems: "center", justifyContent: "space-between",
};
const searchInputStyle: React.CSSProperties = {
  width: "100%", background: "#111118", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 6, padding: "6px 10px", fontSize: 12,
};
const categoryLabelStyle: React.CSSProperties = {
  fontSize: 12, color: "#5a5a70", textTransform: "uppercase",
  letterSpacing: 1, marginBottom: 6,
};
const kbdStyle: React.CSSProperties = {
  background: "#1c1c26", border: "1px solid #2a2a3a", borderRadius: 4,
  padding: "1px 8px", fontSize: 12, fontWeight: 500, fontFamily: "monospace",
  color: "#e4e4f0", whiteSpace: "nowrap",
};

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      el.showModal();
    } else {
      el.close();
    }
  }, [open]);

  if (!open) return null;

  const term = search.toLowerCase();
  const filtered = SHORTCUTS.reduce<Category[]>((acc, cat) => {
    const matching = cat.shortcuts.filter(
      s => s.description.toLowerCase().includes(term) ||
           s.keys.toLowerCase().includes(term)
    );
    if (matching.length > 0) {
      acc.push({ ...cat, shortcuts: matching });
    }
    return acc;
  }, []);

  return (
    <dialog
      ref={dialogRef}
      style={dialogBaseStyle}
      onCancel={onClose}
    >
      <div style={dialogStyle} role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
        {/* Header */}
        <div style={headerStyle}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Keyboard Shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", color: "#7a7a90", fontSize: 18, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid #1c1c26" }}>
          <input
            aria-label="Search shortcuts"
            placeholder="Search shortcuts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={searchInputStyle}
          />
        </div>

        {/* Content */}
        <div style={{ padding: "12px 18px" }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: "#5a5a70", padding: 20, fontSize: 12 }}>
              No shortcuts found
            </div>
          ) : (
            filtered.map(cat => (
              <div key={cat.name} style={{ marginBottom: 16 }}>
                <div style={categoryLabelStyle}>
                  {cat.name}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px" }}>
                  {cat.shortcuts.map(s => (
                    <Fragment key={s.keys}>
                      <div style={{ fontSize: 12, color: "#c4c4d0" }}>{s.description}</div>
                      <kbd style={kbdStyle}>
                        {s.keys}
                      </kbd>
                    </Fragment>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </dialog>
  );
}
