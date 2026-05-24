import { useState, useEffect, useCallback } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string;
  description: string;
}

interface ShortcutCategory {
  name: string;
  icon: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "Tools",
    icon: "🛠",
    shortcuts: [
      { keys: "V", description: "Select tool" },
      { keys: "H", description: "Hand tool" },
      { keys: "P", description: "Pencil tool" },
      { keys: "B", description: "Pen / Bezier tool" },
      { keys: "R", description: "Rectangle" },
      { keys: "O", description: "Ellipse" },
      { keys: "L", description: "Line" },
      { keys: "F", description: "Frame" },
      { keys: "T", description: "Text" },
      { keys: "I", description: "Eyedropper" },
      { keys: "K", description: "Reset to Select" },
      { keys: "Space (hold)", description: "Temporary hand tool" },
    ],
  },
  {
    name: "Edit",
    icon: "✏️",
    shortcuts: [
      { keys: "⌘Z", description: "Undo" },
      { keys: "⌘⇧Z", description: "Redo" },
      { keys: "⌘C", description: "Copy" },
      { keys: "⌘V", description: "Paste" },
      { keys: "⌘⇧V", description: "Paste in place" },
      { keys: "⌘X", description: "Cut" },
      { keys: "⌘D", description: "Duplicate" },
      { keys: "⌘A", description: "Select all" },
      { keys: "⌘L", description: "Lock/Unlock layer" },
      { keys: "Delete / ⌫", description: "Delete selected" },
      { keys: "Esc", description: "Deselect / Cancel" },
      { keys: "Enter", description: "Edit text / Finish pen" },
      { keys: "⌘R", description: "Rename layer" },
      { keys: "⌘S", description: "Save version" },
    ],
  },
  {
    name: "View",
    icon: "👁",
    shortcuts: [
      { keys: "⌘+", description: "Zoom in" },
      { keys: "⌘−", description: "Zoom out" },
      { keys: "⌘0", description: "Reset zoom to 100%" },
      { keys: "⌘1", description: "Zoom to fit all" },
      { keys: "⌘2", description: "Zoom to selection" },
      { keys: "⌘\\", description: "Toggle side panels" },
      { keys: "⌘'", description: "Toggle grid overlay" },
      { keys: "⌘Y", description: "Toggle outline mode" },
      { keys: "⌘⇧S", description: "Toggle snap to grid" },
      { keys: "⌘⇧H", description: "Toggle smart guides" },
      { keys: "?", description: "Show keyboard shortcuts" },
    ],
  },
  {
    name: "Arrange",
    icon: "📐",
    shortcuts: [
      { keys: "⌘]", description: "Bring forward" },
      { keys: "⌘[", description: "Send backward" },
      { keys: "⌘⌥]", description: "Bring to front" },
      { keys: "⌘⌥[", description: "Send to back" },
      { keys: "⌘G", description: "Group" },
      { keys: "⌘⇧G", description: "Ungroup" },
      { keys: "⇧A", description: "Auto Layout" },
      { keys: "N", description: "Next frame" },
      { keys: "← ↑ ↓ →", description: "Nudge 1px" },
      { keys: "⇧← ↑ ↓ →", description: "Nudge 10px" },
    ],
  },
  {
    name: "Boolean",
    icon: "⬡",
    shortcuts: [
      { keys: "⌘⌥U", description: "Boolean union" },
      { keys: "⌘⌥S", description: "Boolean subtract" },
      { keys: "⌘⌥I", description: "Boolean intersect" },
      { keys: "⌘⌥E", description: "Boolean exclude" },
    ],
  },
  {
    name: "Prototype",
    icon: "▶",
    shortcuts: [
      { keys: "⌘P", description: "Toggle prototype preview" },
      { keys: "C", description: "Toggle comment mode" },
      { keys: "⌘⇧K", description: "Component library" },
    ],
  },
  {
    name: "Export",
    icon: "📤",
    shortcuts: [
      { keys: "⌘⇧E", description: "Open export dialog" },
      { keys: "Enter", description: "Finish pen path" },
    ],
  },
];

export function KeyboardShortcutsDialog({ isOpen, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Filter shortcuts by search
  const filteredCategories = searchQuery
    ? SHORTCUT_CATEGORIES.map((cat) => ({
        ...cat,
        shortcuts: cat.shortcuts.filter(
          (s) =>
            s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.keys.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter((cat) => cat.shortcuts.length > 0)
    : SHORTCUT_CATEGORIES;

  if (!isOpen) return null;

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="shortcuts-header">
          <div className="shortcuts-header-left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="6" y1="8" x2="6" y2="8" strokeLinecap="round" />
              <line x1="10" y1="8" x2="10" y2="8" strokeLinecap="round" />
              <line x1="14" y1="8" x2="14" y2="8" strokeLinecap="round" />
              <line x1="18" y1="8" x2="18" y2="8" strokeLinecap="round" />
              <line x1="8" y1="12" x2="16" y2="12" />
              <line x1="6" y1="16" x2="6" y2="16" strokeLinecap="round" />
              <line x1="18" y1="16" x2="18" y2="16" strokeLinecap="round" />
            </svg>
            <span>Keyboard Shortcuts</span>
          </div>
          <button className="shortcuts-close" onClick={onClose}>×</button>
        </div>

        {/* Search */}
        <div className="shortcuts-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="shortcuts-body">
          {/* Category tabs */}
          {!searchQuery && (
            <div className="shortcuts-categories">
              {SHORTCUT_CATEGORIES.map((cat, i) => (
                <button
                  key={cat.name}
                  className={`shortcuts-category-btn ${activeCategory === i ? "active" : ""}`}
                  onClick={() => setActiveCategory(i)}
                >
                  <span className="shortcuts-category-icon">{cat.icon}</span>
                  <span className="shortcuts-category-name">{cat.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Shortcuts list */}
          <div className="shortcuts-list">
            {(searchQuery ? filteredCategories : [SHORTCUT_CATEGORIES[activeCategory]]).map(
              (cat) => (
                <div key={cat.name} className="shortcuts-section">
                  {searchQuery && (
                    <div className="shortcuts-section-title">
                      <span>{cat.icon}</span> {cat.name}
                    </div>
                  )}
                  {cat.shortcuts.map((s, i) => (
                    <div key={i} className="shortcut-item">
                      <span className="shortcut-keys">
                        {s.keys.split(" + ").map((key, ki) => (
                          <span key={ki}>
                            {ki > 0 && <span className="shortcut-separator">+</span>}
                            <kbd className="shortcut-key">{key}</kbd>
                          </span>
                        ))}
                      </span>
                      <span className="shortcut-desc">{s.description}</span>
                    </div>
                  ))}
                </div>
              )
            )}
            {searchQuery && filteredCategories.length === 0 && (
              <div className="shortcuts-empty">
                No shortcuts matching "{searchQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shortcuts-footer">
          <span>Press <kbd className="shortcut-key">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
