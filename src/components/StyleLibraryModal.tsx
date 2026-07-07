import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../lib/supabase";

interface Props {
  workspaceId: string;
  onClose: () => void;
  onToast?: (msg: string, type?: "info" | "success" | "error") => void;
}

interface BrandStyle {
  id: string;
  name: string;
  description?: string;
  tokensJson?: string;
  designMd?: string;
  sharedCss?: string;
  styleFingerprint?: string;
  sourceTemplateIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9000,
  background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const modalStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.95)", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)", padding: 0,
  width: "90vw", maxWidth: 900, maxHeight: "85vh",
  display: "flex", flexDirection: "column", overflow: "hidden",
  color: "#e0e0e0", fontSize: 13,
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.08)", padding: 12,
  cursor: "pointer", transition: "border 0.15s",
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
  padding: "8px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

export function StyleLibraryModal({ workspaceId, onClose, onToast }: Props) {
  const [styles, setStyles] = useState<BrandStyle[]>([]);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"library" | "upload" | "duplicates">("library");
  const [dupGroups, setDupGroups] = useState<any[]>([]);
  const [uploadData, setUploadData] = useState({
    name: "", tokensJson: "", designMd: "", sharedCss: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load all styles + lock state ──
  const loadStyles = useCallback(async () => {
    setLoading(true);
    try {
      // Load all brands
      const brandsRes = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "list_brand_guidelines",
          params: { workspaceId }, id: 0,
        }),
      });
      const bText = brandsRes?.result?.content?.[0]?.text;
      const bData = bText ? (typeof bText === "string" ? JSON.parse(bText) : bText) : null;
      const allStyles = bData?.brands || [];
      setStyles(allStyles);

      // Load active (locked) styles
      const activeRes = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "get_active_styles",
          params: { workspaceId }, id: 0,
        }),
      });
      const aText = activeRes?.result?.content?.[0]?.text;
      const aData = aText ? (typeof aText === "string" ? JSON.parse(aText) : aText) : null;
      const active = aData?.styles || [];
      setLockedIds(new Set(active.map((s: any) => s.id)));
    } catch (e) {
      onToast?.("Failed to load styles", "error");
    }
    setLoading(false);
  }, [workspaceId, onToast]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  // ── Toggle lock ──
  const toggleLock = useCallback(async (brandId: string, currentlyLocked: boolean) => {
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "set_style_lock",
          params: { workspaceId, brandId, locked: !currentlyLocked },
          id: 0,
        }),
      });
      setLockedIds(prev => {
        const next = new Set(prev);
        if (currentlyLocked) next.delete(brandId);
        else next.add(brandId);
        return next;
      });
      onToast?.(
        currentlyLocked ? "Style unlocked" : "Style locked — AI will use this style",
        currentlyLocked ? "info" : "success"
      );
    } catch {
      onToast?.("Failed to toggle lock", "error");
    }
  }, [workspaceId, onToast]);

  // ── Download template ──
  const downloadTemplate = useCallback(async () => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "download_style_template",
          params: {}, id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
      if (data?.content) {
        const blob = new Blob([data.content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename || "tokens-template.json";
        a.click();
        URL.revokeObjectURL(url);
        onToast?.("tokens-template.json downloaded! Fill it with Gemini and upload back.", "success");
      }
    } catch {
      onToast?.("Failed to download template", "error");
    }
  }, [onToast]);

  // ── Upload style ──
  const handleUpload = useCallback(async () => {
    if (!uploadData.name.trim()) {
      onToast?.("Enter a style name", "error");
      return;
    }
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "create_brand_guideline",
          params: {
            workspaceId,
            name: uploadData.name.trim(),
            tokensJson: uploadData.tokensJson || undefined,
            designMd: uploadData.designMd || undefined,
            sharedCss: uploadData.sharedCss || undefined,
          },
          id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
      if (data?.id || data?.brand?.id) {
        onToast?.(`Style "${uploadData.name}" uploaded!`, "success");
        setUploadData({ name: "", tokensJson: "", designMd: "", sharedCss: "" });
        setTab("library");
        loadStyles();
      }
    } catch {
      onToast?.("Upload failed", "error");
    }
  }, [workspaceId, uploadData, onToast, loadStyles]);

  // ── Handle file upload (tokens.json or .md) ──
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (file.name.endsWith(".json")) {
        try {
          JSON.parse(content); // validate
          setUploadData(prev => ({ ...prev, tokensJson: content }));
          // Auto-fill name from filename
          const baseName = file.name.replace(/\.json$/i, "");
          if (!uploadData.name) setUploadData(prev => ({ ...prev, name: baseName }));
          onToast?.(`Loaded ${file.name}`, "success");
        } catch {
          onToast?.("Invalid JSON file", "error");
        }
      } else if (file.name.endsWith(".md") || file.name.endsWith(".css")) {
        if (file.name.endsWith(".md")) {
          setUploadData(prev => ({ ...prev, designMd: content }));
        } else {
          setUploadData(prev => ({ ...prev, sharedCss: content }));
        }
        const baseName = file.name.replace(/\.(md|css)$/i, "");
        if (!uploadData.name) setUploadData(prev => ({ ...prev, name: baseName }));
        onToast?.(`Loaded ${file.name}`, "success");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset
  }, [uploadData.name, onToast]);

  // ── Find duplicates ──
  const findDuplicates = useCallback(async () => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "find_duplicate_styles",
          params: { workspaceId }, id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
      setDupGroups(data?.groups || []);
      if ((data?.groups || []).length === 0) {
        onToast?.("No duplicate styles found — all unique!", "success");
      }
    } catch {
      onToast?.("Failed to find duplicates", "error");
    }
  }, [workspaceId, onToast]);

  // ── Merge duplicates ──
  const handleMerge = useCallback(async (targetId: string, sourceIds: string[]) => {
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "merge_brand_guidelines",
          params: {
            workspaceId,
            targetBrandId: targetId,
            sourceBrandIds: sourceIds,
          },
          id: 0,
        }),
      });
      onToast?.(`Merged ${sourceIds.length} styles into one`, "success");
      loadStyles();
      findDuplicates();
    } catch {
      onToast?.("Merge failed", "error");
    }
  }, [workspaceId, onToast, loadStyles, findDuplicates]);

  // ── Extract colors from tokens for preview (v1 + v2 compat) ──
  const extractColors = useCallback((tokensJson?: string): string[] => {
    if (!tokensJson) return [];
    try {
      const parsed = JSON.parse(tokensJson);
      const colors: string[] = [];
      // Both v1 and v2 use color.NAME.$value
      if (parsed.color) {
        Object.values(parsed.color).forEach((v: any) => {
          const hex = v?.$value || v;
          if (typeof hex === "string" && hex.startsWith("#")) colors.push(hex);
        });
      }
      return colors.slice(0, 6);
    } catch { return []; }
  }, []);

  // ── Extract fonts from tokens for preview (v1 + v2 compat) ──
  const extractFonts = useCallback((tokensJson?: string): string[] => {
    if (!tokensJson) return [];
    try {
      const parsed = JSON.parse(tokensJson);
      const fonts: string[] = [];
      if (parsed.typography) {
        // V2 format: families is an array of {name, ...}
        if (Array.isArray(parsed.typography.families)) {
          parsed.typography.families.forEach((f: any) => {
            if (f?.name && !fonts.includes(f.name)) fonts.push(f.name);
          });
        }
        // V1 format: fontFamily is an object of {key: {$value: "..."}}
        if (parsed.typography.fontFamily) {
          Object.values(parsed.typography.fontFamily).forEach((v: any) => {
            const name = v?.$value || v;
            if (typeof name === "string" && !fonts.includes(name)) fonts.push(name);
          });
        }
      }
      return fonts.slice(0, 4);
    } catch { return []; }
  }, []);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    ...btnStyle,
    background: active ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.04)",
    borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
    borderRadius: 0,
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🎨</span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Style Library</span>
            {lockedIds.size > 0 && (
              <span style={{
                background: "rgba(99,102,241,0.2)", color: "#a5b4fc",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 600,
              }}>
                {lockedIds.size} LOCKED
              </span>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#888",
            fontSize: 20, cursor: "pointer", padding: "4px 8px",
          }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button style={tabBtnStyle(tab === "library")} onClick={() => setTab("library")}>
            📚 Library ({styles.length})
          </button>
          <button style={tabBtnStyle(tab === "upload")} onClick={() => setTab("upload")}>
            ⬆ Upload Style
          </button>
          <button style={tabBtnStyle(tab === "duplicates")} onClick={() => { setTab("duplicates"); findDuplicates(); }}>
            🔀 Deduplicate
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#666" }}>Loading styles...</div>
          ) : tab === "library" ? (
            /* ── Library Tab ── */
            <div>
              {/* Download template button */}
              <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                <button onClick={downloadTemplate} style={btnStyle}>
                  📄 Download tokens-template.json
                </button>
              </div>

              {styles.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
                  <div>No styles yet. Upload one or extract from a design.</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    Use "Upload Style" tab or publish a design with <code>generate_design_artifacts</code>
                  </div>
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                  gap: 12,
                }}>
                  {styles.map(style => {
                    const isLocked = lockedIds.has(style.id);
                    const colors = extractColors(style.tokensJson);
                    const fonts = extractFonts(style.tokensJson);
                    return (
                      <div
                        key={style.id}
                        style={{
                          ...cardStyle,
                          borderColor: isLocked ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)",
                          background: isLocked ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.04)",
                        }}
                      >
                        {/* Lock toggle */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                            {style.name}
                          </div>
                          <button
                            onClick={() => toggleLock(style.id, isLocked)}
                            style={{
                              background: isLocked ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 4, padding: "3px 8px",
                              fontSize: 11, cursor: "pointer", color: isLocked ? "#a5b4fc" : "#888",
                              fontFamily: "inherit", whiteSpace: "nowrap",
                            }}
                            title={isLocked ? "Click to unlock" : "Click to lock — AI must use this style"}
                          >
                            {isLocked ? "🔒 Locked" : "🔓 Lock"}
                          </button>
                        </div>

                        {/* Color preview */}
                        {colors.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                            {colors.map((hex, i) => (
                              <div key={i} style={{
                                width: 24, height: 24, borderRadius: 4,
                                background: hex,
                                border: "1px solid rgba(255,255,255,0.15)",
                              }} title={hex} />
                            ))}
                          </div>
                        )}

                        {/* Font preview */}
                        {fonts.length > 0 && (
                          <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
                            {fonts.join(" · ")}
                          </div>
                        )}

                        {/* Template count */}
                        <div style={{ fontSize: 10, color: "#666" }}>
                          {(style.sourceTemplateIds || []).length} template(s)
                          {style.styleFingerprint && (
                            <span> · FP: {style.styleFingerprint.substring(0, 8)}...</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : tab === "upload" ? (
            /* ── Upload Tab ── */
            <div style={{ maxWidth: 600, margin: "0 auto" }}>
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(99,102,241,0.05)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.15)" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>💡 How it works</div>
                <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>
                  1. Download <code>tokens-template.json</code> below<br/>
                  2. Paste its content into Gemini/ChatGPT with your design images<br/>
                  3. Ask the AI to fill each <code>$value</code> field based on the images<br/>
                  4. Save the result as a <code>.json</code> file and drag-drop it here
                </div>
                <button onClick={downloadTemplate} style={{ ...btnStyle, marginTop: 8, fontSize: 11 }}>
                  📄 Download tokens-template.json
                </button>
              </div>

              {/* File upload zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 8,
                  padding: 24, textAlign: "center", cursor: "pointer", marginBottom: 12,
                  transition: "border 0.15s",
                }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#6366f1"; }}
                onDragLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const content = ev.target?.result as string;
                      if (file.name.endsWith(".json")) {
                        setUploadData(prev => ({ ...prev, tokensJson: content, name: prev.name || file.name.replace(/\.json$/i, "") }));
                      } else if (file.name.endsWith(".md")) {
                        setUploadData(prev => ({ ...prev, designMd: content, name: prev.name || file.name.replace(/\.md$/i, "") }));
                      } else if (file.name.endsWith(".css")) {
                        setUploadData(prev => ({ ...prev, sharedCss: content, name: prev.name || file.name.replace(/\.css$/i, "") }));
                      }
                      onToast?.(`Loaded ${file.name}`, "success");
                    };
                    reader.readAsText(file);
                  }
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 4 }}>📁</div>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Drop files here or click to browse<br/>
                  <span style={{ fontSize: 10 }}>Supports: .json (tokens), .md (design ref), .css (variables)</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.md,.css"
                  onChange={handleFileUpload}
                  style={{ display: "none" }}
                />
              </div>

              {/* Manual input fields */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>Style Name *</label>
                <input
                  value={uploadData.name}
                  onChange={e => setUploadData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Glassmorphism Dark"
                  style={{
                    width: "100%", padding: "8px 12px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, color: "#e0e0e0", fontSize: 12,
                    outline: "none", fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>
                    tokens.json {uploadData.tokensJson ? "✓" : ""}
                  </label>
                  <textarea
                    value={uploadData.tokensJson}
                    onChange={e => setUploadData(prev => ({ ...prev, tokensJson: e.target.value }))}
                    placeholder='{ "color": { ... } }'
                    rows={3}
                    style={{
                      width: "100%", padding: "8px 12px",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6, color: "#e0e0e0", fontSize: 10,
                      outline: "none", fontFamily: "monospace", resize: "vertical",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>
                    shared.css {uploadData.sharedCss ? "✓" : ""}
                  </label>
                  <textarea
                    value={uploadData.sharedCss}
                    onChange={e => setUploadData(prev => ({ ...prev, sharedCss: e.target.value }))}
                    placeholder=":root { --color-... }"
                    rows={3}
                    style={{
                      width: "100%", padding: "8px 12px",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6, color: "#e0e0e0", fontSize: 10,
                      outline: "none", fontFamily: "monospace", resize: "vertical",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>
                  DESIGN.md {uploadData.designMd ? "✓" : ""}
                </label>
                <textarea
                  value={uploadData.designMd}
                  onChange={e => setUploadData(prev => ({ ...prev, designMd: e.target.value }))}
                  placeholder="# Style Name..."
                  rows={4}
                  style={{
                    width: "100%", padding: "8px 12px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, color: "#e0e0e0", fontSize: 10,
                    outline: "none", fontFamily: "monospace", resize: "vertical",
                  }}
                />
              </div>

              <button
                onClick={handleUpload}
                disabled={!uploadData.name.trim()}
                style={{
                  ...btnStyle,
                  opacity: !uploadData.name.trim() ? 0.4 : 1,
                  background: "rgba(99,102,241,0.2)",
                  borderColor: "rgba(99,102,241,0.3)",
                  width: "100%", fontWeight: 600,
                }}
              >
                ⬆ Upload Style
              </button>
            </div>
          ) : (
            /* ── Duplicates Tab ── */
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "#888" }}>
                  {dupGroups.length > 0
                    ? `${dupGroups.length} group(s) of duplicate styles found`
                    : "Checking for duplicates..."}
                </div>
                <button onClick={findDuplicates} style={{ ...btnStyle, fontSize: 11 }}>
                  ↻ Refresh
                </button>
              </div>

              {dupGroups.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
                  {loading ? "Scanning..." : "No duplicates found. All styles are unique."}
                </div>
              ) : (
                dupGroups.map((group, gi) => (
                  <div key={gi} style={{
                    ...cardStyle,
                    marginBottom: 12,
                    borderColor: "rgba(251,191,36,0.2)",
                    background: "rgba(251,191,36,0.03)",
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "#fbbf24" }}>
                      Group {gi + 1}: {group.count} duplicate styles
                    </div>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>
                      Fingerprint: {group.fingerprint.substring(0, 16)}...
                    </div>
                    {group.brands.map((b: any, bi: number) => (
                      <div key={b.id} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 8px", marginBottom: 4,
                        background: "rgba(255,255,255,0.03)", borderRadius: 4,
                      }}>
                        <input
                          type="radio"
                          name={`group-${gi}`}
                          defaultChecked={bi === 0}
                          id={`brand-${b.id}`}
                          style={{ accentColor: "#6366f1" }}
                        />
                        <label htmlFor={`brand-${b.id}`} style={{ fontSize: 12, flex: 1, cursor: "pointer" }}>
                          {b.name} <span style={{ color: "#666", fontSize: 10 }}>
                            ({(b.sourceTemplateIds || []).length} templates)
                          </span>
                        </label>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const radios = document.querySelectorAll(`input[name="group-${gi}"]`);
                        let targetId = group.brands[0].id;
                        radios.forEach((r, ri) => {
                          if ((r as HTMLInputElement).checked) targetId = group.brands[ri].id;
                        });
                        const sourceIds = group.brands
                          .map((b: any) => b.id)
                          .filter((id: string) => id !== targetId);
                        handleMerge(targetId, sourceIds);
                      }}
                      style={{
                        ...btnStyle,
                        marginTop: 8, fontSize: 11, width: "auto",
                        background: "rgba(251,191,36,0.1)",
                        borderColor: "rgba(251,191,36,0.2)",
                      }}
                    >
                      🔀 Merge into selected
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
