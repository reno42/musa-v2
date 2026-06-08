import { useState, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";

interface AIPanelProps {
  templateId: string | null;
  selectedObjects: any[];
  onUpdate: () => void;
  onClose: () => void;
}

type TabId = "generate" | "layout" | "palette" | "translate";

interface PaletteColor {
  name: string;
  hex: string;
  role: string;
}

export function AIPanel({ templateId, selectedObjects, onUpdate, onClose }: AIPanelProps) {
  const [tab, setTab] = useState<TabId>("generate");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate state
  const [genPrompt, setGenPrompt] = useState("");
  const [genType, setGenType] = useState<"text" | "image">("text");
  const [genX, setGenX] = useState(100);
  const [genY, setGenY] = useState(100);
  const [genWidth, setGenWidth] = useState(600);
  const [genHeight, setGenHeight] = useState(512);
  const [genFontSize, setGenFontSize] = useState(16);
  const [placeOnCanvas, setPlaceOnCanvas] = useState(true);
  const [genResult, setGenResult] = useState<string | null>(null);

  // Layout state
  const [layoutAspect, setLayoutAspect] = useState<string>("all");
  const [layoutResult, setLayoutResult] = useState<any>(null);

  // Palette state
  const [palTheme, setPalTheme] = useState("");
  const [palCount, setPalCount] = useState(6);
  const [palNeutrals, setPalNeutrals] = useState(true);
  const [palColors, setPalColors] = useState<PaletteColor[]>([]);

  // Translate state
  const [transLang, setTransLang] = useState("English");
  const [transResult, setTransResult] = useState<string | null>(null);

  // ── Handlers ──

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setLoading(true);
    setError(null);
    setGenResult(null);
    try {
      const method = genType === "text" ? "ai_generate_text" : "ai_generate_image";
      const params: any = { prompt: genPrompt.trim() };
      if (placeOnCanvas && templateId) {
        params.templateId = templateId;
        params.x = genX;
        params.y = genY;
        params.width = genWidth;
        if (genType === "text") params.fontSize = genFontSize;
        else params.height = genHeight;
      }
      const result = await mcpCall(method, params);
      if (result?.generated) {
        setGenResult(result.generated);
      } else if (result?.description) {
        setGenResult(`Image generated: ${result.description}`);
      } else {
        setGenResult("Done. Check canvas.");
      }
      if (placeOnCanvas) onUpdate();
    } catch (e: any) {
      setError(e?.message || "AI generation failed");
    }
    setLoading(false);
  };

  const handleLayoutAnalyze = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setLayoutResult(null);
    try {
      const result = await mcpCall("ai_suggest_layout", { templateId, aspect: layoutAspect });
      setLayoutResult(result);
    } catch (e: any) {
      setError(e?.message || "Layout analysis failed");
    }
    setLoading(false);
  };

  const handlePalette = async () => {
    if (!palTheme.trim()) return;
    setLoading(true);
    setError(null);
    setPalColors([]);
    try {
      const result = await mcpCall("ai_palette", {
        theme: palTheme.trim(),
        count: palCount,
        includeNeutrals: palNeutrals,
      });
      setPalColors(result?.colors || []);
    } catch (e: any) {
      setError(e?.message || "Palette generation failed");
    }
    setLoading(false);
  };

  const handleTranslate = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setTransResult(null);
    try {
      const result = await mcpCall("ai_translate", {
        templateId,
        targetLanguage: transLang,
      });
      setTransResult(`Translated to ${transLang}`);
      onUpdate();
    } catch (e: any) {
      setError(e?.message || "Translation failed");
    }
    setLoading(false);
  };

  // ── UI ──

  const tabs: { id: TabId; label: string }[] = [
    { id: "generate", label: "Generate" },
    { id: "layout", label: "Layout" },
    { id: "palette", label: "Palette" },
    { id: "translate", label: "Translate" },
  ];

  return (
    <div className="glass-panel" style={{
      position: "fixed", top: 48, right: 0, bottom: 0, width: 360,
      display: "flex", flexDirection: "column", zIndex: 50,
      fontFamily: "Inter, sans-serif", fontSize: 12, color: "#c4c0b4",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid #1c1c26",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>🤖 AI Tools</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 16,
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1c1c26" }}>
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: "8px 4px", border: "none", cursor: "pointer",
              background: tab === t.id ? "#1a1a2e" : "transparent",
              color: tab === t.id ? "#c8b898" : "#7a7668",
              borderBottom: tab === t.id ? "2px solid #c8b898" : "2px solid transparent",
              fontSize: 11, fontWeight: tab === t.id ? 600 : 400,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {/* ── Generate Tab ── */}
        {tab === "generate" && (
          <>
            {/* Type selector */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {(["text", "image"] as const).map(t => (
                <button key={t} type="button" onClick={() => setGenType(t)}
                  style={{
                    flex: 1, padding: "6px", borderRadius: 4, cursor: "pointer",
                    background: genType === t ? "#1a1a2e" : "transparent",
                    border: genType === t ? "1px solid #c8b898" : "1px solid #2a2a3a",
                    color: genType === t ? "#c8b898" : "#7a7668",
                    fontSize: 11, textTransform: "capitalize",
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Prompt */}
            <label style={labelStyle}>Prompt</label>
            <textarea
              value={genPrompt}
              onChange={e => setGenPrompt(e.target.value)}
              placeholder={genType === "text" ? "Describe what to write..." : "Describe the image..."}
              rows={3}
              style={textareaStyle}
            />

            {/* Placement toggle */}
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input type="checkbox" checked={placeOnCanvas} onChange={e => setPlaceOnCanvas(e.target.checked)}
                style={{ accentColor: "#c8b898" }} />
              Place result on canvas
            </label>

            {placeOnCanvas && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                <div>
                  <label style={labelStyle}>X</label>
                  <input type="number" value={genX} onChange={e => setGenX(Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Y</label>
                  <input type="number" value={genY} onChange={e => setGenY(Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Width</label>
                  <input type="number" value={genWidth} onChange={e => setGenWidth(Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{genType === "text" ? "Font Size" : "Height"}</label>
                  {genType === "text" ? (
                    <input type="number" value={genFontSize} onChange={e => setGenFontSize(Number(e.target.value))} style={inputStyle} />
                  ) : (
                    <input type="number" value={genHeight} onChange={e => setGenHeight(Number(e.target.value))} style={inputStyle} />
                  )}
                </div>
              </div>
            )}

            <button type="button" onClick={handleGenerate} disabled={loading || !genPrompt.trim()}
              style={{
                ...btnPrimary, marginTop: 12, width: "100%",
                opacity: loading || !genPrompt.trim() ? 0.5 : 1,
              }}>
              {loading ? "Generating..." : `Generate ${genType === "text" ? "Text" : "Image"}`}
            </button>

            {genResult && (
              <div style={{
                marginTop: 10, padding: "8px 10px", background: "#111118",
                border: "1px solid #1c1c26", borderRadius: 6,
                maxHeight: 200, overflowY: "auto", fontSize: 11,
                whiteSpace: "pre-wrap", lineHeight: 1.6,
              }}>
                {genResult}
              </div>
            )}
          </>
        )}

        {/* ── Layout Tab ── */}
        {tab === "layout" && (
          <>
            <label style={labelStyle}>Analyze aspect</label>
            <select value={layoutAspect} onChange={e => setLayoutAspect(e.target.value)} style={selectStyle}>
              <option value="all">All aspects</option>
              <option value="alignment">Alignment</option>
              <option value="spacing">Spacing</option>
              <option value="hierarchy">Hierarchy</option>
            </select>

            <button type="button" onClick={handleLayoutAnalyze} disabled={loading || !templateId}
              style={{
                ...btnPrimary, marginTop: 10, width: "100%",
                opacity: loading || !templateId ? 0.5 : 1,
              }}>
              {loading ? "Analyzing..." : "Analyze Canvas Layout"}
            </button>

            {layoutResult && (
              <div style={{ marginTop: 12 }}>
                {/* Score badge */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                  padding: "8px 10px", background: "#111118", borderRadius: 6,
                  border: "1px solid #1c1c26",
                }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: scoreColor(layoutResult.score) }}>
                    {layoutResult.score}
                  </span>
                  <span style={{ fontSize: 11, color: "#7a7668" }}>Layout Score / 100</span>
                </div>

                {/* Summary */}
                {layoutResult.summary && (
                  <div style={{
                    fontSize: 11, lineHeight: 1.6, color: "#a4a4b4",
                    marginBottom: 10, padding: "8px 10px",
                    background: "#111118", borderRadius: 6,
                  }}>
                    {layoutResult.summary}
                  </div>
                )}

                {/* Issues */}
                {layoutResult.issues?.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: "#7a7668", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
                      Issues ({layoutResult.issues.length})
                    </div>
                    {layoutResult.issues.map((issue: any, i: number) => (
                      <div key={i} style={{
                        padding: "6px 10px", marginBottom: 4,
                        background: "#111118", borderRadius: 4,
                        borderLeft: `3px solid ${severityColor(issue.severity)}`,
                      }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                            background: severityBg(issue.severity), color: severityColor(issue.severity),
                          }}>
                            {issue.severity?.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 500 }}>{issue.description}</span>
                        </div>
                        {issue.suggestion && (
                          <div style={{ fontSize: 10, color: "#c8b898", marginTop: 2 }}>
                            💡 {issue.suggestion}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Palette Tab ── */}
        {tab === "palette" && (
          <>
            <label style={labelStyle}>Theme / Mood</label>
            <input
              type="text"
              value={palTheme}
              onChange={e => setPalTheme(e.target.value)}
              placeholder="e.g. ocean sunset, tech startup, warm minimal"
              style={inputStyle}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <div>
                <label style={labelStyle}>Colors ({palCount})</label>
                <input type="range" min={3} max={9} value={palCount}
                  onChange={e => setPalCount(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#c8b898" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={palNeutrals} onChange={e => setPalNeutrals(e.target.checked)}
                  style={{ accentColor: "#c8b898" }} />
                <label style={{ ...labelStyle, marginTop: 0, cursor: "pointer" }}>Neutrals</label>
              </div>
            </div>

            <button type="button" onClick={handlePalette} disabled={loading || !palTheme.trim()}
              style={{
                ...btnPrimary, marginTop: 10, width: "100%",
                opacity: loading || !palTheme.trim() ? 0.5 : 1,
              }}>
              {loading ? "Generating..." : "Generate Palette"}
            </button>

            {/* Color swatches */}
            {palColors.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {palColors.map((c, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 10px", background: "#111118",
                    borderRadius: 6, border: "1px solid #1c1c26",
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 6,
                      background: c.hex, border: "1px solid #2a2a3a",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: "#7a7668" }}>{c.hex} · {c.role}</div>
                    </div>
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(c.hex); }}
                      style={{
                        background: "none", border: "1px solid #2a2a3a",
                        color: "#7a7668", borderRadius: 3, padding: "2px 6px",
                        cursor: "pointer", fontSize: 10,
                      }} title="Copy hex">
                      📋
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Translate Tab ── */}
        {tab === "translate" && (
          <>
            <label style={labelStyle}>Target Language</label>
            <select value={transLang} onChange={e => setTransLang(e.target.value)} style={selectStyle}>
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Italian">Italian</option>
              <option value="Portuguese">Portuguese</option>
              <option value="Japanese">Japanese</option>
              <option value="Korean">Korean</option>
              <option value="Chinese (Simplified)">Chinese (Simplified)</option>
              <option value="Arabic">Arabic</option>
            </select>

            <p style={{ fontSize: 10, color: "#7a7668", marginTop: 8, lineHeight: 1.5 }}>
              Translates all text objects on the canvas to the selected language using AI.
            </p>

            <button type="button" onClick={handleTranslate} disabled={loading || !templateId}
              style={{
                ...btnPrimary, marginTop: 10, width: "100%",
                opacity: loading || !templateId ? 0.5 : 1,
              }}>
              {loading ? "Translating..." : `Translate to ${transLang}`}
            </button>

            {transResult && (
              <div style={{
                marginTop: 10, padding: "8px 10px", background: "#111118",
                border: "1px solid #2a4a2a", borderRadius: 6, fontSize: 11,
                color: "#4ade80",
              }}>
                ✓ {transResult}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom error */}
      {error && (
        <div style={{
          padding: "8px 12px", borderTop: "1px solid #2a1a1a",
          background: "#1a0a0a", color: "#f87171", fontSize: 11,
        }}>
          ⚠ {error}
          <button type="button" onClick={() => setError(null)}
            style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer", float: "right" }}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ──

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, color: "#7a7668",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: 1,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 8px", borderRadius: 4,
  background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#f0ebe0", fontSize: 11, outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical", minHeight: 60,
  fontFamily: "Inter, sans-serif",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "rgba(200, 184, 152, 0.12)", border: "1px solid #c8b898",
  color: "#c8b898", fontSize: 12, fontWeight: 600,
  cursor: "pointer",
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#fbbf24";
  return "#f87171";
}

function severityColor(severity: string): string {
  if (severity === "high") return "#f87171";
  if (severity === "medium") return "#fbbf24";
  return "#60a5fa";
}

function severityBg(severity: string): string {
  if (severity === "high") return "rgba(248,113,113,0.12)";
  if (severity === "medium") return "rgba(251,191,36,0.12)";
  return "rgba(96,165,250,0.12)";
}
