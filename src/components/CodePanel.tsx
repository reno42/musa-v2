import React, { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface CodePanelProps {
  html: string;
  css: string;
  onHtmlChange: (html: string) => void;
  onCssChange: (css: string) => void;
}

export interface CodePanelRef {
  scrollToLine: (line: number) => void;
  switchToTab: (tab: "html" | "css") => void;
  undo: () => void;
  redo: () => void;
}

type Tab = "html" | "css";

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "rgba(18,18,36,0.85)",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)",
  overflow: "hidden",
};

const tabsBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  background: active ? "rgba(255,255,255,0.06)" : "transparent",
  color: active ? "#e0e0e0" : "#888",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
});

export const CodePanel = forwardRef<CodePanelRef, CodePanelProps>(function CodePanel(
  { html, css, onHtmlChange, onCssChange }, ref
) {
  const [tab, setTab] = useState<Tab>("html");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const htmlEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const cssEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Expose scrollToLine and switchToTab to parent via ref
  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      setTab("css");
      setTimeout(() => {
        const ed = cssEditorRef.current;
        if (ed) {
          ed.revealLineInCenter(line);
          ed.setPosition({ lineNumber: line, column: 1 });
          ed.focus();
        }
      }, 100);
    },
    switchToTab(t: "html" | "css") { setTab(t); },
    undo() {
      const ed = tab === "html" ? htmlEditorRef.current : cssEditorRef.current;
      ed?.trigger("keyboard", "undo", null);
    },
    redo() {
      const ed = tab === "html" ? htmlEditorRef.current : cssEditorRef.current;
      ed?.trigger("keyboard", "redo", null);
    },
  }), [tab]);

  // Debounced change handler (200ms)
  const handleHtmlChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onHtmlChange(value), 200);
  }, [onHtmlChange]);

  const handleCssChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onCssChange(value), 200);
  }, [onCssChange]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleHtmlEditorMount: OnMount = (editor) => {
    htmlEditorRef.current = editor;
    editor.updateOptions({
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
    });
  };

  const handleCssEditorMount: OnMount = (editor) => {
    cssEditorRef.current = editor;
    editor.updateOptions({
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
    });
  };

  return (
    <div style={panelStyle}>
      <div style={tabsBarStyle}>
        <button type="button" onClick={() => setTab("html")} style={tabStyle(tab === "html")}>HTML</button>
        <button type="button" onClick={() => setTab("css")} style={tabStyle(tab === "css")}>CSS</button>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => { const ed = tab === "html" ? htmlEditorRef.current : cssEditorRef.current; ed?.trigger("keyboard", "undo", null); }} style={{ ...tabStyle(false), padding: "8px 10px", fontSize: 16, lineHeight: 1 }} title="Undo (Ctrl+Z)">&#x21A9;</button>
        <button type="button" onClick={() => { const ed = tab === "html" ? htmlEditorRef.current : cssEditorRef.current; ed?.trigger("keyboard", "redo", null); }} style={{ ...tabStyle(false), padding: "8px 10px", fontSize: 16, lineHeight: 1 }} title="Redo (Ctrl+Shift+Z)">&#x21AA;</button>
      </div>
      <div style={{ flex: 1, display: tab === "html" ? "block" : "none" }}>
        <Editor
          height="100%"
          language="html"
          theme="vs-dark"
          value={html}
          onChange={handleHtmlChange}
          onMount={handleHtmlEditorMount}
          loading={<div style={{ padding: 16, color: "#888" }}>Loading editor...</div>}
          options={{
            readOnly: false,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
        />
      </div>
      <div style={{ flex: 1, display: tab === "css" ? "block" : "none" }}>
        <Editor
          height="100%"
          language="css"
          theme="vs-dark"
          value={css}
          onChange={handleCssChange}
          onMount={handleCssEditorMount}
          loading={<div style={{ padding: 16, color: "#888" }}>Loading editor...</div>}
          options={{
            readOnly: false,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
        />
      </div>
    </div>
  );
});
