import { useState, useMemo, useCallback } from "react";
import * as fabric from "fabric";
import { generateCSS, generateStylesheet, generateSingleCSS } from "../lib/cssGenerator";
import { useToast } from "./Toast";

interface Props {
  selectedObj: fabric.FabricObject | null;
  fabricRef: React.RefObject<fabric.Canvas | null>;
}

export function CssSpecsPanel({ selectedObj, fabricRef }: Props) {
  const [showAllSelected, setShowAllSelected] = useState(false);
  const { addToast } = useToast();

  const singleCSS = useMemo(() => generateSingleCSS(selectedObj), [selectedObj]);

  const allCSS = useMemo(() => {
    const c = fabricRef.current;
    if (!c) return "/* No canvas */";
    const selection = c.getActiveObject();
    let objects: fabric.FabricObject[] = [];
    if (selection) {
      if ((selection as any)._objects) {
        objects = (selection as any)._objects as fabric.FabricObject[];
      } else {
        objects = [selection];
      }
    }
    if (objects.length === 0 && selectedObj) {
      objects = [selectedObj];
    }
    return generateStylesheet(objects);
  }, [fabricRef, selectedObj]);

  const displayCSS = showAllSelected ? allCSS : singleCSS;

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayCSS);
      addToast("success", "CSS copied!", "Ready to paste in your code editor");
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = displayCSS;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      addToast("success", "CSS copied!", "Ready to paste in your code editor");
    }
  }, [displayCSS, addToast]);

  const cssMeta = useMemo(() => {
    if (!selectedObj) return null;
    const block = generateCSS(selectedObj);
    return block?.meta || null;
  }, [selectedObj]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "8px 10px", borderBottom: "1px solid var(--bd, #1c1c26)",
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ac, #7c6fff)" }}>
          &lt;/&gt; CSS Specs
        </span>
        {cssMeta && (
          <span style={{ fontSize: 9, color: "var(--mu, #5a5a70)", fontFamily: "monospace" }}>
            .{cssMeta.nodeName?.slice(0, 20) || "element"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowAllSelected((v) => !v)}
          style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4,
            border: "1px solid var(--bd, #1c1c26)",
            background: showAllSelected ? "var(--ac, #7c6fff)" : "var(--sf, #111118)",
            color: showAllSelected ? "#fff" : "var(--mu2, #7a7a90)",
            cursor: "pointer",
          }}
          title="Toggle: single element or all selected"
        >
          {showAllSelected ? "All selected" : "Single"}
        </button>
      </div>

      {/* Metadata info */}
      {cssMeta && (
        <div style={{
          padding: "6px 10px", borderBottom: "1px solid var(--bd, #1c1c26)",
          display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap",
        }}>
          {cssMeta.fillHex && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 2,
                background: cssMeta.fillHex,
                border: "1px solid rgba(255,255,255,0.12)",
              }} />
              <span style={{ fontSize: 9, color: "var(--mu, #5a5a70)", fontFamily: "monospace" }}>
                {cssMeta.fillHex}
              </span>
            </div>
          )}
          {cssMeta.fillRgb && (
            <span style={{ fontSize: 9, color: "var(--mu2, #7a7a90)", fontFamily: "monospace" }}>
              {cssMeta.fillRgb}
            </span>
          )}
          {cssMeta.fillCmyk && (
            <span style={{ fontSize: 9, color: "var(--mu, #5a5a70)", fontFamily: "monospace" }}>
              {cssMeta.fillCmyk}
            </span>
          )}
          {cssMeta.fontFamily && (
            <span style={{ fontSize: 9, color: "var(--mu2, #7a7a90)", fontFamily: "monospace" }}>
              {cssMeta.fontFamily} {cssMeta.fontSize}px
            </span>
          )}
        </div>
      )}

      {/* Code area */}
      <div style={{
        flex: 1, overflow: "auto",
        padding: 12,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 10.5, lineHeight: 1.7,
        color: "#c4c4d4", whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        background: "var(--bg, #0a0a0f)",
      }}>
        {/* Syntax highlighting hints */}
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {highlightCSS(displayCSS)}
        </pre>
      </div>

      {/* Footer */}
      <div style={{
        padding: "8px 10px", borderTop: "1px solid var(--bd, #1c1c26)",
        display: "flex", gap: 6, flexShrink: 0,
      }}>
        <button
          onClick={copyToClipboard}
          style={{
            flex: 1, padding: "5px", borderRadius: 6,
            background: "var(--ac, #7c6fff)", color: "#fff",
            border: "none", fontSize: 11, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📋 Copy CSS
        </button>
        <button
          onClick={() => {
            const blob = new Blob([displayCSS], { type: "text/css" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "specs.css";
            a.click();
            URL.revokeObjectURL(url);
            addToast("success", "CSS downloaded", "specs.css saved to your computer");
          }}
          style={{
            flex: 1, padding: "5px", borderRadius: 6,
            background: "var(--sf, #111118)", color: "var(--mu2, #7a7a90)",
            border: "1px solid var(--bd, #1c1c26)", fontSize: 11,
            cursor: "pointer",
          }}
        >
          ⬇ Download
        </button>
      </div>
    </div>
  );
}

/** Very simple CSS syntax highlighting via dangerouslySetInnerHTML */
function highlightCSS(code: string): React.ReactNode {
  // Simple: wrap property names in one color, values in another, comments italic
  const lines = code.split("\n");
  return lines.map((line, i) => {
    // Comments
    if (line.trim().startsWith("/*")) {
      return (
        <span key={i} style={{ color: "#4a4a62", fontStyle: "italic" }}>
          {line}{"\n"}
        </span>
      );
    }
    // CSS property line: property: value;
    const m = line.match(/^(\s*)([a-z-]+)\s*:\s*(.+?);(\s*)$/);
    if (m) {
      return (
        <span key={i}>
          {m[1]}
          <span style={{ color: "#7dd3fc" }}>{m[2]}</span>
          {": "}
          <span style={{ color: "#86efac" }}>{m[3]}</span>
          {";"}{m[4]}
          {"\n"}
        </span>
      );
    }
    // Selector
    if (/^\s*\.\S+\s*\{/.test(line)) {
      return (
        <span key={i} style={{ color: "#c084fc" }}>
          {line}{"\n"}
        </span>
      );
    }
    // Closing brace
    if (line.trim() === "}") {
      return <span key={i}>{"}"}{"\n"}</span>;
    }
    return <span key={i}>{line}{"\n"}</span>;
  }) as any;
}
