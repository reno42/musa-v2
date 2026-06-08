import { useState, useRef, useEffect } from "react";

type BlockType = "text" | "header" | "code" | "table" | "columns" | "callout" | "toggle" | "quote" | "markdown";

interface BlocksDropdownProps {
  onBlockAction: (method: string, params: Record<string, any>) => void;
}

const blockOptions: { type: BlockType; label: string; icon: string }[] = [
  { type: "text", label: "📝 Text Block", icon: "¶" },
  { type: "header", label: "📰 Header", icon: "H" },
  { type: "code", label: "💻 Code Block", icon: "</>" },
  { type: "table", label: "📊 Table", icon: "⊞" },
  { type: "columns", label: "📑 Columns", icon: "|||" },
  { type: "callout", label: "💬 Callout", icon: "!" },
  { type: "toggle", label: "▸ Toggle", icon: "▶" },
  { type: "quote", label: "❝ Quote", icon: "\"" },
  { type: "markdown", label: "📋 Markdown Import", icon: "MD" },
];

export function BlocksDropdown({ onBlockAction }: BlocksDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<BlockType | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Form state ──
  const [textContent, setTextContent] = useState("");
  const [headerLevel, setHeaderLevel] = useState("h1");
  const [codeContent, setCodeContent] = useState("");
  const [codeLang, setCodeLang] = useState("javascript");
  const [tableHeaders, setTableHeaders] = useState("");
  const [tableRows, setTableRows] = useState("");
  const [colTexts, setColTexts] = useState("");
  const [colHeaders, setColHeaders] = useState("");
  const [calloutType, setCalloutType] = useState("info");
  const [calloutTitle, setCalloutTitle] = useState("");
  const [calloutText, setCalloutText] = useState("");
  const [toggleTitle, setToggleTitle] = useState("");
  const [toggleContent, setToggleContent] = useState("");
  const [toggleExpanded, setToggleExpanded] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [quoteAuthor, setQuoteAuthor] = useState("");
  const [quoteSource, setQuoteSource] = useState("");
  const [mdContent, setMdContent] = useState("");

  useEffect(() => {
    if (!open && !activeModal) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveModal(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, activeModal]);

  const handleSelect = (type: BlockType) => {
    setActiveModal(type);
    setOpen(false);
    // Reset form
    setTextContent(""); setHeaderLevel("h1"); setCodeContent(""); setCodeLang("javascript");
    setTableHeaders(""); setTableRows(""); setColTexts(""); setColHeaders("");
    setCalloutType("info"); setCalloutTitle(""); setCalloutText("");
    setToggleTitle(""); setToggleContent(""); setToggleExpanded(false);
    setQuoteText(""); setQuoteAuthor(""); setQuoteSource("");
    setMdContent("");
  };

  const handleSubmit = () => {
    if (!activeModal) return;
    switch (activeModal) {
      case "text":
        if (textContent.trim()) onBlockAction("add_block", { type: "text", content: textContent.trim() });
        break;
      case "header":
        if (textContent.trim()) onBlockAction("add_block", { type: headerLevel, content: textContent.trim() });
        break;
      case "code":
        if (codeContent.trim()) onBlockAction("add_code_block", { code: codeContent, language: codeLang });
        break;
      case "table":
        if (tableHeaders.trim() || tableRows.trim()) {
          const headers = tableHeaders.trim() ? tableHeaders.split(",").map(h => h.trim()) : [];
          const rows = tableRows.trim() ? JSON.parse(tableRows) : [];
          onBlockAction("add_table", { headers, rows });
        }
        break;
      case "columns":
        if (colTexts.trim()) {
          const texts = JSON.parse(colTexts);
          const hdrs = colHeaders.trim() ? colHeaders.split(",").map(h => h.trim()) : [];
          onBlockAction("add_columns", { columnTexts: texts, headers: hdrs });
        }
        break;
      case "callout":
        if (calloutText.trim()) onBlockAction("add_callout", { type: calloutType, title: calloutTitle || undefined, text: calloutText.trim() });
        break;
      case "toggle":
        if (toggleTitle.trim()) onBlockAction("add_toggle", { title: toggleTitle.trim(), content: toggleContent || undefined, expanded: toggleExpanded });
        break;
      case "quote":
        if (quoteText.trim()) onBlockAction("add_quote", { text: quoteText.trim(), author: quoteAuthor || undefined, source: quoteSource || undefined });
        break;
      case "markdown":
        if (mdContent.trim()) onBlockAction("render_markdown", { markdown: mdContent.trim() });
        break;
    }
    setActiveModal(null);
  };

  return (
    <div className="align-dropdown-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="tool-btn has-submenu"
        onClick={() => setOpen(!open)}
        title="Document Blocks" aria-label="Document Blocks"
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="15" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="corner-marker">
          <svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6" /></svg>
        </span>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="align-dropdown" style={{ top: -4 }}>
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Blocks</span>
            <div className="align-dropdown-row" style={{ flexDirection: "column", gap: 2 }}>
              {blockOptions.map(opt => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => handleSelect(opt.type)}
                  style={{
                    background: "none", border: "none", color: "#c4c4d4",
                    padding: "4px 8px", fontSize: 12, cursor: "pointer",
                    textAlign: "left", borderRadius: 4, width: "100%",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#1c1c2e")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Renderer by type ── */}
      {activeModal && (
        <div style={overlayStyle} onClick={() => setActiveModal(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "#e4e4f0" }}>
              {blockOptions.find(o => o.type === activeModal)?.label}
            </div>

            {/* Text / Header */}
            {(activeModal === "text" || activeModal === "header") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {activeModal === "header" && (
                  <div style={rowStyle}>
                    <span style={labelStyle}>Level</span>
                    <select value={headerLevel} onChange={e => setHeaderLevel(e.target.value)} style={selectStyle}>
                      <option value="h1">H1 (72px)</option><option value="h2">H2 (56px)</option>
                      <option value="h3">H3 (40px)</option><option value="h4">H4 (28px)</option>
                    </select>
                  </div>
                )}
                <textarea
                  autoFocus
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                  placeholder={activeModal === "text" ? "Enter text content..." : "Enter heading text..."}
                  rows={3}
                  style={textareaStyle}
                />
              </div>
            )}

            {/* Code Block */}
            {activeModal === "code" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={rowStyle}>
                  <span style={labelStyle}>Language</span>
                  <select value={codeLang} onChange={e => setCodeLang(e.target.value)} style={selectStyle}>
                    <option value="javascript">JavaScript</option><option value="typescript">TypeScript</option>
                    <option value="python">Python</option><option value="html">HTML</option>
                    <option value="css">CSS</option><option value="json">JSON</option>
                    <option value="bash">Bash</option><option value="sql">SQL</option>
                  </select>
                </div>
                <textarea autoFocus value={codeContent} onChange={e => setCodeContent(e.target.value)}
                  placeholder="Paste your code here..." rows={6} style={{ ...textareaStyle, fontFamily: "monospace", fontSize: 11 }} />
              </div>
            )}

            {/* Table */}
            {activeModal === "table" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={rowStyle}>
                  <span style={labelStyle}>Headers</span>
                  <input value={tableHeaders} onChange={e => setTableHeaders(e.target.value)}
                    placeholder="Name, Age, City" style={inputStl} />
                </div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Rows</span>
                </div>
                <textarea autoFocus value={tableRows} onChange={e => setTableRows(e.target.value)}
                  placeholder='[["Alice", "30", "NYC"], ["Bob", "25", "LA"]]' rows={3} style={{ ...textareaStyle, fontFamily: "monospace", fontSize: 11 }} />
              </div>
            )}

            {/* Columns */}
            {activeModal === "columns" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={rowStyle}>
                  <span style={labelStyle}>Headers</span>
                  <input value={colHeaders} onChange={e => setColHeaders(e.target.value)}
                    placeholder="Col 1, Col 2, Col 3" style={inputStl} />
                </div>
                <textarea autoFocus value={colTexts} onChange={e => setColTexts(e.target.value)}
                  placeholder='["Text for column 1", "Text for column 2", "Text for column 3"]' rows={3} style={{ ...textareaStyle, fontFamily: "monospace", fontSize: 11 }} />
              </div>
            )}

            {/* Callout */}
            {activeModal === "callout" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={rowStyle}>
                  <span style={labelStyle}>Type</span>
                  <select value={calloutType} onChange={e => setCalloutType(e.target.value)} style={selectStyle}>
                    <option value="info">Info</option><option value="warning">Warning</option>
                    <option value="tip">Tip</option><option value="note">Note</option>
                    <option value="success">Success</option><option value="error">Error</option>
                  </select>
                </div>
                <input autoFocus value={calloutTitle} onChange={e => setCalloutTitle(e.target.value)}
                  placeholder="Callout title (optional)" style={inputStl} />
                <textarea value={calloutText} onChange={e => setCalloutText(e.target.value)}
                  placeholder="Callout body text..." rows={3} style={textareaStyle} />
              </div>
            )}

            {/* Toggle */}
            {activeModal === "toggle" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input autoFocus value={toggleTitle} onChange={e => setToggleTitle(e.target.value)}
                  placeholder="Toggle title" style={inputStl} />
                <textarea value={toggleContent} onChange={e => setToggleContent(e.target.value)}
                  placeholder="Toggle content (hidden until expanded)" rows={3} style={textareaStyle} />
                <div style={rowStyle}>
                  <span style={labelStyle}>Expanded</span>
                  <button type="button" onClick={() => setToggleExpanded(!toggleExpanded)}
                    style={{
                      padding: "2px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                      background: toggleExpanded ? "#1a2a1a" : "#1a1111",
                      border: toggleExpanded ? "1px solid #2a4a2a" : "1px solid #2a1a1a",
                      color: toggleExpanded ? "#4ade80" : "#7a5a5a",
                    }}>{toggleExpanded ? "ON" : "OFF"}</button>
                </div>
              </div>
            )}

            {/* Quote */}
            {activeModal === "quote" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea autoFocus value={quoteText} onChange={e => setQuoteText(e.target.value)}
                  placeholder="Quote text..." rows={3} style={textareaStyle} />
                <input value={quoteAuthor} onChange={e => setQuoteAuthor(e.target.value)}
                  placeholder="Author (optional)" style={inputStl} />
                <input value={quoteSource} onChange={e => setQuoteSource(e.target.value)}
                  placeholder="Source (optional)" style={inputStl} />
              </div>
            )}

            {/* Markdown */}
            {activeModal === "markdown" && (
              <textarea autoFocus value={mdContent} onChange={e => setMdContent(e.target.value)}
                placeholder="# My Document&#10;&#10;## Section 1&#10;&#10;Content with **bold** and *italic*..."
                rows={8} style={{ ...textareaStyle, fontFamily: "monospace", fontSize: 11 }} />
            )}

            {/* Submit / Cancel */}
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setActiveModal(null)}
                style={{ ...btnSm, background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90" }}>
                Cancel
              </button>
              <button type="button" onClick={handleSubmit}
                style={{ ...btnSm, background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80" }}>
                Add Block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.6)", zIndex: 100,
  display: "flex", alignItems: "center", justifyContent: "center",
};

const modalStyle: React.CSSProperties = {
  background: "#14141e", border: "1px solid #2a2a3a", borderRadius: 8,
  padding: 16, width: 380, maxHeight: "80vh", overflowY: "auto",
};

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: "#7a7a90", minWidth: 65, textAlign: "right" };

const inputStl: React.CSSProperties = {
  flex: 1, background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#e4e4f0", borderRadius: 4, padding: "5px 8px", fontSize: 12,
  fontFamily: "monospace", boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  width: "100%", background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#e4e4f0", borderRadius: 4, padding: "6px 8px", fontSize: 12,
  resize: "vertical", boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  flex: 1, background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#e4e4f0", borderRadius: 4, padding: "4px 6px", fontSize: 11,
};

const btnSm: React.CSSProperties = { padding: "4px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer" };
