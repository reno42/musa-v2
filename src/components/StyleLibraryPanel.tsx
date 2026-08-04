import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../lib/supabase";
import { downloadBlob } from "../lib/download";
import { AssetsPanel } from "./AssetsPanel";

interface Props {
  workspaceId: string;
  onToast?: (msg: string, type?: "info" | "success" | "error") => void;
  /** Extracts colors/typography/CSS from whichever frame(s) are currently
   *  selected on the canvas and creates or updates a Style Library entry
   *  under the given name. Naming is always explicit — never inferred from
   *  the frame or template name, since that's what caused unrelated
   *  captures to silently collide into the same entry. */
  onPublish?: (name: string) => Promise<boolean>;
  publishing?: boolean;
  /** Saves whichever frame(s) are currently selected as a Key Visual. */
  onSaveKeyVisual: () => Promise<void>;
  saveRecipeMsg: string;
  selectedFrameCount: number;
  /** Opens a template — used to jump into a design created from a Key Visual. */
  onOpenTemplate?: (id: string) => void;
  /** Recursos (Assets) tab — same contract as AssetsPanel's own props. */
  onAssetUploaded?: (asset: { id: string; name: string; filename: string; mimeType: string; sizeBytes: number; url: string; width?: number; height?: number; tags?: string[]; workspaceId?: string; createdAt?: string }) => void;
  onManageStorage?: () => void;
  selectedImageSrc?: string | null;
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

interface KeyVisual {
  id: string;
  name: string;
  structure?: { frames?: Array<{ name?: string }>; layout?: { width?: number; height?: number } };
  created_at?: string;
}

const panelStyle: React.CSSProperties = {
  color: "#e0e0e0", fontSize: 13, display: "flex", flexDirection: "column",
  height: "100%", overflow: "hidden",
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

export function StyleLibraryPanel({
  workspaceId, onToast, onPublish, publishing,
  onSaveKeyVisual, saveRecipeMsg, selectedFrameCount, onOpenTemplate,
  onAssetUploaded, onManageStorage, selectedImageSrc,
}: Props) {
  const [styles, setStyles] = useState<BrandStyle[]>([]);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"library" | "keyvisuals" | "assets">("library");
  const [showUpload, setShowUpload] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupGroups, setDupGroups] = useState<any[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [capturingName, setCapturingName] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const [uploadData, setUploadData] = useState({
    name: "", tokensJson: "", designMd: "", sharedCss: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [keyVisuals, setKeyVisuals] = useState<KeyVisual[]>([]);
  const [kvLoading, setKvLoading] = useState(false);
  const [kvBusyId, setKvBusyId] = useState<string | null>(null);

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

  // ── Load Key Visuals (this workspace only) ──
  const loadKeyVisuals = useCallback(async () => {
    setKvLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: KeyVisual[] }>(`/api/recipes?workspaceId=${encodeURIComponent(workspaceId)}`);
      setKeyVisuals(res.data || []);
    } catch {
      onToast?.("Failed to load Key Visuals", "error");
    }
    setKvLoading(false);
  }, [workspaceId, onToast]);

  useEffect(() => { if (tab === "keyvisuals") loadKeyVisuals(); }, [tab, loadKeyVisuals]);

  const handleAddKeyVisual = useCallback(async () => {
    await onSaveKeyVisual();
    loadKeyVisuals();
  }, [onSaveKeyVisual, loadKeyVisuals]);

  const handleUseKeyVisual = useCallback(async (id: string) => {
    setKvBusyId(id);
    try {
      const res = await apiFetch<{ success: boolean; data: { templateId: string } }>(`/api/recipes/${id}/execute`, {
        method: "POST",
        body: JSON.stringify({ variables: {} }),
      });
      if (res.data?.templateId) onOpenTemplate?.(res.data.templateId);
    } catch {
      onToast?.("Failed to create from Key Visual", "error");
    }
    setKvBusyId(null);
  }, [onToast, onOpenTemplate]);

  const handleDeleteKeyVisual = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/recipes/${id}`, { method: "DELETE" });
      setKeyVisuals(prev => prev.filter(k => k.id !== id));
    } catch {
      onToast?.("Failed to delete Key Visual", "error");
    }
  }, [onToast]);

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
        downloadBlob(blob, data.filename || "tokens-template.json");
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
        setShowUpload(false);
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
    setDupLoading(true);
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
    setDupLoading(false);
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
        if (Array.isArray(parsed.typography.families)) {
          parsed.typography.families.forEach((f: any) => {
            if (f?.name && !fonts.includes(f.name)) fonts.push(f.name);
          });
        }
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
    background: active ? "rgba(200,184,152,0.2)" : "transparent",
    borderBottom: active ? "2px solid #c8b898" : "2px solid transparent",
    borderRadius: 0, border: "none", flex: 1,
  });

  return (
    <div style={panelStyle}>
      {lockedIds.size > 0 && (
        <div style={{ padding: "8px 12px 0" }}>
          <span style={{
            background: "rgba(200,184,152,0.2)", color: "#dcd0b5",
            border: "1px solid rgba(200,184,152,0.3)",
            borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 600,
          }}>
            {lockedIds.size} LOCKED
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button style={tabBtnStyle(tab === "library")} onClick={() => setTab("library")} title="Brand Guidelines extraídas de tus diseños">
          🎨 Estilos
        </button>
        <button style={tabBtnStyle(tab === "keyvisuals")} onClick={() => setTab("keyvisuals")} title="Key Visuals — diseños completos reutilizables">
          🖼 Plantillas
        </button>
        <button style={tabBtnStyle(tab === "assets")} onClick={() => setTab("assets")} title="Assets de marca: logos, patrones, fondos">
          📦 Recursos
        </button>
      </div>

      {/* Content */}
      <div style={tab === "assets" ? { flex: 1, overflow: "hidden", display: "flex" } : { flex: 1, overflow: "auto", padding: 12 }}>
        {tab === "library" ? (
          /* ── Estilos Tab ── */
          loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#666" }}>Loading styles...</div>
          ) : (
          <div>
            <div style={{ marginBottom: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onPublish && !capturingName && (
                <button
                  onClick={() => setCapturingName(true)}
                  disabled={publishing || selectedFrameCount === 0}
                  title={selectedFrameCount === 0 ? "Selecciona uno o varios frames en el lienzo primero" : undefined}
                  style={{ ...btnStyle, opacity: publishing || selectedFrameCount === 0 ? 0.5 : 1, cursor: selectedFrameCount === 0 ? "not-allowed" : "pointer" }}
                >
                  {publishing ? "⏳ Capturando..." : `📸 Capturar estilo${selectedFrameCount > 0 ? ` (${selectedFrameCount} frame${selectedFrameCount > 1 ? "s" : ""})` : ""}`}
                </button>
              )}
              <button onClick={downloadTemplate} style={btnStyle}>
                📄 tokens-template.json
              </button>
              <button onClick={() => setShowUpload(v => !v)} style={btnStyle}>
                ⬆ {showUpload ? "Cancelar subida" : "Subir estilo manual"}
              </button>
              {styles.length > 1 && (
                <button
                  onClick={() => { const next = !showDuplicates; setShowDuplicates(next); if (next) findDuplicates(); }}
                  style={btnStyle}
                >
                  🔀 {showDuplicates ? "Ocultar duplicados" : "Buscar duplicados"}
                </button>
              )}
            </div>

            {onPublish && capturingName && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 8,
                background: "rgba(200,184,152,0.06)", border: "1px solid rgba(200,184,152,0.2)",
              }}>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>
                  Nombre del estilo — usa <code>Marca_Propósito</code> (ej: <code>Futuraria_SocialMedia</code>,{" "}
                  <code>Futuraria_BrandGuidelines</code>). No uses el nombre del frame ni del archivo: si ya existe
                  un estilo con este nombre exacto, se actualiza; si no, se crea uno nuevo.
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    autoFocus
                    value={captureName}
                    onChange={e => setCaptureName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") document.getElementById("style-capture-confirm")?.click(); if (e.key === "Escape") { setCapturingName(false); setCaptureName(""); } }}
                    placeholder="Marca_Propósito"
                    style={{
                      flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                      color: "#e0e0e0", fontSize: 12, outline: "none", fontFamily: "inherit",
                    }}
                  />
                  <button
                    id="style-capture-confirm"
                    disabled={!captureName.trim() || publishing}
                    onClick={async () => {
                      const ok = await onPublish!(captureName.trim());
                      if (ok) { setCapturingName(false); setCaptureName(""); loadStyles(); }
                    }}
                    style={{ ...btnStyle, background: "rgba(200,184,152,0.2)", borderColor: "rgba(200,184,152,0.3)", opacity: !captureName.trim() || publishing ? 0.5 : 1 }}
                  >
                    {publishing ? "…" : "Guardar"}
                  </button>
                  <button onClick={() => { setCapturingName(false); setCaptureName(""); }} style={btnStyle}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {onPublish && !capturingName && (
              <div style={{ fontSize: 10, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
                Extrae colores, tipografía y CSS de <strong>los frames que tengas seleccionados en el lienzo</strong> y
                los guarda con el nombre que elijas — un nombre nuevo crea una entrada nueva; un nombre que ya existe
                actualiza esa misma entrada.
              </div>
            )}

            {showUpload && (
              <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>💡 Cómo funciona</div>
                <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, marginBottom: 8 }}>
                  1. Descarga <code>tokens-template.json</code> arriba<br/>
                  2. Pégalo en Gemini/ChatGPT junto con imágenes de tu diseño<br/>
                  3. Pide que complete cada campo <code>$value</code> según las imágenes<br/>
                  4. Guarda el resultado como <code>.json</code> y súbelo aquí
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 8,
                    padding: 20, textAlign: "center", cursor: "pointer", marginBottom: 12,
                    transition: "border 0.15s",
                  }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#c8b898"; }}
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
                  <div style={{ fontSize: 22, marginBottom: 4 }}>📁</div>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    Suelta archivos aquí o haz clic para buscar<br/>
                    <span style={{ fontSize: 10 }}>Soporta: .json (tokens), .md (design ref), .css (variables)</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.md,.css"
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                  />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>Nombre del estilo *</label>
                  <input
                    value={uploadData.name}
                    onChange={e => setUploadData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Marca_Propósito"
                    style={{
                      width: "100%", padding: "8px 12px",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6, color: "#e0e0e0", fontSize: 12,
                      outline: "none", fontFamily: "inherit",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
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
                  <div>
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

                <div style={{ marginBottom: 10 }}>
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
                    background: "rgba(200,184,152,0.2)",
                    borderColor: "rgba(200,184,152,0.3)",
                    width: "100%", fontWeight: 600,
                  }}
                >
                  ⬆ Subir estilo
                </button>
              </div>
            )}

            {styles.length === 0 && !showUpload ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
                <div>No styles yet. Capture one from the current design, or upload one.</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  Usa "📸 Capturar estilo" arriba, o "⬆ Subir estilo manual".
                </div>
              </div>
            ) : styles.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {styles.map(style => {
                  const isLocked = lockedIds.has(style.id);
                  const colors = extractColors(style.tokensJson);
                  const fonts = extractFonts(style.tokensJson);
                  return (
                    <div
                      key={style.id}
                      style={{
                        ...cardStyle,
                        borderColor: isLocked ? "rgba(200,184,152,0.5)" : "rgba(255,255,255,0.08)",
                        background: isLocked ? "rgba(200,184,152,0.05)" : "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                          {style.name}
                        </div>
                        <button
                          onClick={() => toggleLock(style.id, isLocked)}
                          style={{
                            background: isLocked ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 4, padding: "3px 8px",
                            fontSize: 11, cursor: "pointer", color: isLocked ? "#dcd0b5" : "#888",
                            fontFamily: "inherit", whiteSpace: "nowrap",
                          }}
                          title={isLocked ? "Click to unlock" : "Click to lock — AI must use this style"}
                        >
                          {isLocked ? "🔒 Locked" : "🔓 Lock"}
                        </button>
                      </div>

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

                      {fonts.length > 0 && (
                        <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
                          {fonts.join(" · ")}
                        </div>
                      )}

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

            {/* ── Duplicates (inline, toggled) ── */}
            {showDuplicates && (
              <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
                <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {dupGroups.length > 0
                      ? `${dupGroups.length} group(s) of duplicate styles found`
                      : dupLoading ? "Checking for duplicates..." : "No duplicates found."}
                  </div>
                  <button onClick={findDuplicates} style={{ ...btnStyle, fontSize: 11 }}>
                    ↻ Refresh
                  </button>
                </div>

                {dupGroups.map((group, gi) => (
                  <div key={gi} style={{
                    ...cardStyle, cursor: "default",
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
                          style={{ accentColor: "#c8b898" }}
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
                ))}
              </div>
            )}
          </div>
          )
        ) : tab === "keyvisuals" ? (
          /* ── Key Visuals Tab ── */
          <div>
            <button
              onClick={handleAddKeyVisual}
              disabled={selectedFrameCount === 0}
              style={{
                ...btnStyle, width: "100%", fontWeight: 600, marginBottom: 4,
                background: selectedFrameCount > 0 ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.04)",
                borderColor: selectedFrameCount > 0 ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.08)",
                color: selectedFrameCount > 0 ? "#e0e0e0" : "#666",
                cursor: selectedFrameCount > 0 ? "pointer" : "not-allowed",
              }}
            >
              ➕ Agregar como Key Visual{selectedFrameCount > 1 ? ` (${selectedFrameCount} frames)` : ""}
            </button>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
              {selectedFrameCount === 0
                ? "Selecciona uno o varios frames en el lienzo para guardarlos como Key Visual."
                : `Se guardará${selectedFrameCount > 1 ? "n" : ""} ${selectedFrameCount} frame(s) seleccionado(s), diseño completo (HTML+CSS), como plantilla reusable.`}
            </div>
            {saveRecipeMsg && (
              <div style={{ fontSize: 11, marginBottom: 12, color: saveRecipeMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>
                {saveRecipeMsg}
              </div>
            )}

            {kvLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>Loading...</div>
            ) : keyVisuals.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
                <div>No Key Visuals yet.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {keyVisuals.map(kv => {
                  const frameCount = kv.structure?.frames?.length || 1;
                  return (
                    <div key={kv.id} style={{ ...cardStyle, cursor: "default" }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{kv.name}</div>
                      <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>
                        {frameCount} frame(s)
                        {kv.created_at && <span> · {new Date(kv.created_at).toLocaleDateString()}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleUseKeyVisual(kv.id)}
                          disabled={kvBusyId === kv.id}
                          style={{ ...btnStyle, fontSize: 11, flex: 1, background: "rgba(200,184,152,0.15)", borderColor: "rgba(200,184,152,0.25)" }}
                        >
                          {kvBusyId === kv.id ? "…" : "▶ Usar"}
                        </button>
                        <button
                          onClick={() => handleDeleteKeyVisual(kv.id)}
                          style={{ ...btnStyle, fontSize: 11, color: "#f87171", borderColor: "rgba(239,68,68,0.2)" }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Recursos Tab (Assets de marca: logos, patrones, fondos) ── */
          <AssetsPanel
            workspaceId={workspaceId}
            onAssetUploaded={onAssetUploaded}
            onManageStorage={onManageStorage}
            selectedImageSrc={selectedImageSrc}
          />
        )}
      </div>
    </div>
  );
}
