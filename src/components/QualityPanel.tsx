import { useState } from "react";
import { mcpCall } from "../lib/mcpClient";

interface QualityPanelProps {
  templateId: string | null;
  onClose: () => void;
  onUpdate: () => void;
}

type TabId = "score" | "lint" | "polish" | "palette";
type HarmonyType = "complementary" | "analogous" | "triadic" | "monochromatic" | "split-complementary" | "tetradic";
type MoodType = "vibrant" | "muted" | "dark" | "light" | "pastel" | "professional";

interface AestheticBreakdown {
  balance: number;
  contrast: number;
  alignment: number;
  hierarchy: number;
  consistency: number;
  spacing: number;
}

interface LintIssue {
  severity: "error" | "warning" | "info";
  layer: string;
  message: string;
  fix?: string;
  autoFix?: boolean;
}

interface PaletteSwatch {
  hex: string;
  role?: string;
  name?: string;
}

export function QualityPanel({ templateId, onClose, onUpdate }: QualityPanelProps) {
  const [tab, setTab] = useState<TabId>("score");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Score state
  const [useAi, setUseAi] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<AestheticBreakdown | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  // Lint state
  const [strictness, setStrictness] = useState<"relaxed" | "normal" | "strict">("normal");
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [passRate, setPassRate] = useState<number>(0);
  const [lintFilter, setLintFilter] = useState<"all" | "error" | "warning">("all");

  // Polish state
  const [aggressiveness, setAggressiveness] = useState(0.7);
  const [alignToGrid, setAlignToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(8);
  const [boostContrast, setBoostContrast] = useState(true);
  const [polishBefore, setPolishBefore] = useState<number | null>(null);
  const [polishAfter, setPolishAfter] = useState<number | null>(null);
  const [polishChanges, setPolishChanges] = useState<string[]>([]);

  // Palette state
  const [baseColor, setBaseColor] = useState("#c8b898");
  const [harmonyType, setHarmonyType] = useState<HarmonyType>("analogous");
  const [paletteCount, setPaletteCount] = useState(5);
  const [mood, setMood] = useState<MoodType>("vibrant");
  const [swatches, setSwatches] = useState<PaletteSwatch[]>([]);

  // ── Handlers ──

  const handleScore = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setScore(null);
    setBreakdown(null);
    setAiInsight(null);
    try {
      const result = await mcpCall("aesthetic_score", { templateId, useAi });
      setScore(result.score);
      if (result.breakdown) setBreakdown(result.breakdown);
      if (result.aiInsight) setAiInsight(result.aiInsight);
    } catch (e: any) {
      setError(e?.message || "Scoring failed");
    }
    setLoading(false);
  };

  const handleLint = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setLintIssues([]);
    try {
      const result = await mcpCall("design_lint", { templateId, strictness });
      setLintIssues(result.issues || []);
      setPassRate(result.passRate || 0);
    } catch (e: any) {
      setError(e?.message || "Lint failed");
    }
    setLoading(false);
  };

  const handlePolish = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setPolishBefore(null);
    setPolishAfter(null);
    setPolishChanges([]);
    try {
      const result = await mcpCall("auto_polish", {
        templateId,
        aggressiveness,
        alignToGrid,
        gridSize,
        boostContrast,
      });
      setPolishBefore(result.scoreBefore || null);
      setPolishAfter(result.scoreAfter || null);
      setPolishChanges(result.changes || []);
      onUpdate();
    } catch (e: any) {
      setError(e?.message || "Polish failed");
    }
    setLoading(false);
  };

  const handlePalette = async () => {
    setLoading(true);
    setError(null);
    setSwatches([]);
    try {
      const result = await mcpCall("suggest_color_palette", {
        baseColor,
        type: harmonyType,
        count: paletteCount,
        mood,
      });
      setSwatches(result.palette || result.colors || []);
    } catch (e: any) {
      setError(e?.message || "Palette generation failed");
    }
    setLoading(false);
  };

  const copyHex = (hex: string) => {
    navigator.clipboard?.writeText(hex);
    setToastMsg(`Copied ${hex}!`);
    setTimeout(() => setToastMsg(null), 1500);
  };

  // ── Helpers ──

  const getScoreGradient = (s: number) => {
    if (s >= 80) return { bg: "rgba(74,222,128,0.1)", border: "#4ade80", text: "#4ade80" };
    if (s >= 60) return { bg: "rgba(96,165,250,0.1)", border: "#60a5fa", text: "#60a5fa" };
    if (s >= 40) return { bg: "rgba(251,191,36,0.1)", border: "#fbbf24", text: "#fbbf24" };
    return { bg: "rgba(248,113,113,0.1)", border: "#f87171", text: "#f87171" };
  };

  const severityIcon = (s: string) => s === "error" ? "🔴" : s === "warning" ? "🟡" : "🔵";
  const severityColor = (s: string) => s === "error" ? "#f87171" : s === "warning" ? "#fbbf24" : "#60a5fa";
  const severityBg = (s: string) => s === "error" ? "rgba(248,113,113,0.1)" : s === "warning" ? "rgba(251,191,36,0.08)" : "rgba(96,165,250,0.08)";

  const tabs: { id: TabId; label: string }[] = [
    { id: "score", label: "Score" },
    { id: "lint", label: "Lint" },
    { id: "polish", label: "Polish" },
    { id: "palette", label: "Palette" },
  ];

  const harmonyOptions: { value: HarmonyType; label: string; desc: string }[] = [
    { value: "complementary", label: "Complementary", desc: "180°" },
    { value: "analogous", label: "Analogous", desc: "±30°" },
    { value: "triadic", label: "Triadic", desc: "±120°" },
    { value: "monochromatic", label: "Monochromatic", desc: "Same hue" },
    { value: "split-complementary", label: "Split-Complement", desc: "±150°" },
    { value: "tetradic", label: "Tetradic", desc: "4 colors" },
  ];

  const moodOptions: MoodType[] = ["vibrant", "muted", "dark", "light", "pastel", "professional"];

  const filteredIssues = lintFilter === "all"
    ? lintIssues
    : lintIssues.filter(i => i.severity === lintFilter);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, sans-serif",
    }}>
      <div className="glass-panel" style={{
        width: 580, maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        fontSize: 12, color: "#c4c0b4",
        position: "relative",
      }}>
        {/* Toast */}
        {toastMsg && (
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
            padding: "6px 16px", borderRadius: 20, background: "#1a1a2e",
            border: "1px solid #5a4a3a", color: "#c8b898", fontSize: 11,
            zIndex: 10, fontWeight: 500,
          }}>
            {toastMsg}
          </div>
        )}

        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid #1c1c26",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>✨ Quality Tools</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 18,
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
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {/* ── Score Tab ── */}
          {tab === "score" && (
            <>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)}
                  style={{ accentColor: "#c8b898" }} />
                Use AI semantic analysis
              </label>

              <button type="button" onClick={handleScore} disabled={loading || !templateId}
                style={{ ...btnPrimary, marginTop: 12, width: "100%", opacity: loading || !templateId ? 0.5 : 1 }}>
                {loading ? "Analyzing..." : "📊 Analyze Design"}
              </button>

              {score !== null && (
                <div style={{ marginTop: 20 }}>
                  {/* Score circle */}
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                    <div style={{
                      width: 120, height: 120, borderRadius: "50%",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      background: getScoreGradient(score).bg,
                      border: `3px solid ${getScoreGradient(score).border}`,
                    }}>
                      <div style={{
                        fontSize: 40, fontWeight: 800,
                        color: getScoreGradient(score).text,
                        lineHeight: 1,
                      }}>
                        {Math.round(score)}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a7668", marginTop: 2 }}>/ 100</div>
                    </div>
                  </div>

                  {/* Breakdown bars */}
                  {breakdown && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(["balance", "contrast", "alignment", "hierarchy", "consistency", "spacing"] as const).map(k => (
                        <div key={k}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                            <span style={{ fontSize: 10, color: "#c4c0b4", textTransform: "capitalize" }}>{k}</span>
                            <span style={{ fontSize: 10, color: "#7a7668" }}>{breakdown[k]}/100</span>
                          </div>
                          <div style={{ height: 6, background: "#0a0a10", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 3, transition: "width 0.3s",
                              width: `${breakdown[k]}%`,
                              background: breakdown[k] >= 80 ? "#4ade80" : breakdown[k] >= 60 ? "#60a5fa" : breakdown[k] >= 40 ? "#fbbf24" : "#f87171",
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {aiInsight && (
                    <div style={{
                      marginTop: 14, padding: "8px 10px", background: "#111118",
                      border: "1px solid #1c1c26", borderRadius: 6,
                      fontSize: 10, lineHeight: 1.6, color: "#a4a4b4",
                    }}>
                      <span style={{ color: "#c8b898", fontWeight: 600 }}>AI Insight: </span>
                      {aiInsight}
                    </div>
                  )}

                  <button type="button" onClick={handleScore}
                    style={{ ...btnSecondary, marginTop: 12, width: "100%" }}>
                    Re-analyze
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── Lint Tab ── */}
          {tab === "lint" && (
            <>
              <label style={labelStyle}>Strictness</label>
              <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                {(["relaxed", "normal", "strict"] as const).map(s => (
                  <button key={s} type="button" onClick={() => setStrictness(s)}
                    style={{
                      flex: 1, padding: "6px 4px", borderRadius: 4, cursor: "pointer",
                      background: strictness === s ? "#1a1a2e" : "transparent",
                      border: strictness === s ? "1px solid #c8b898" : "1px solid #2a2a3a",
                      color: strictness === s ? "#c8b898" : "#7a7668", fontSize: 10,
                      textTransform: "capitalize",
                    }}>
                    {s}
                  </button>
                ))}
              </div>

              <button type="button" onClick={handleLint} disabled={loading || !templateId}
                style={{ ...btnPrimary, width: "100%", opacity: loading || !templateId ? 0.5 : 1 }}>
                {loading ? "Linting..." : "🔍 Lint Design"}
              </button>

              {lintIssues.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  {/* Summary */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
                    padding: "8px 10px", background: "#111118", borderRadius: 6,
                    border: "1px solid #1c1c26",
                  }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: scoreColor(passRate) }}>
                      {passRate}%
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#7a7668" }}>Pass Rate</div>
                      <div style={{ height: 4, background: "#0a0a10", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${passRate}%`, background: scoreColor(passRate), borderRadius: 2 }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: "#7a7668" }}>
                      {lintIssues.length} issue{lintIssues.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Filters */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    {(["all", "error", "warning"] as const).map(f => (
                      <button key={f} type="button" onClick={() => setLintFilter(f)}
                        style={{
                          padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                          background: lintFilter === f ? "#1a1a2e" : "transparent",
                          border: lintFilter === f ? "1px solid #c8b898" : "1px solid #2a2a3a",
                          color: lintFilter === f ? "#c8b898" : "#7a7668", fontSize: 9,
                          textTransform: "capitalize",
                        }}>
                        {f === "all" ? "All" : f === "error" ? "Errors Only" : "Warnings Only"}
                      </button>
                    ))}
                  </div>

                  {/* Issues list */}
                  <div style={{ ...codeBlock, maxHeight: 300, overflowY: "auto", padding: "4px 0" }}>
                    {filteredIssues.map((issue, i) => (
                      <div key={i} style={{
                        padding: "8px 10px", borderBottom: "1px solid #1c1c26",
                        background: severityBg(issue.severity),
                        borderLeft: `3px solid ${severityColor(issue.severity)}`,
                      }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 12 }}>{severityIcon(issue.severity)}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: "#c4c0b4" }}>
                              <span style={{
                                fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                                background: severityBg(issue.severity), color: severityColor(issue.severity),
                                marginRight: 6,
                              }}>
                                {issue.severity.toUpperCase()}
                              </span>
                              <span style={{ color: "#c8b898" }}>"{issue.layer}"</span>
                              <span style={{ marginLeft: 4 }}>{issue.message}</span>
                            </div>
                            {issue.fix && (
                              <div style={{ fontSize: 9, color: "#4ade80", marginTop: 3 }}>
                                💡 Fix: {issue.fix}
                              </div>
                            )}
                          </div>
                        </div>
                        {issue.autoFix && (
                          <button type="button" onClick={async () => {
                            try {
                              await mcpCall("auto_polish", { templateId, aggressiveness: 0.5, gridSize: 8 });
                              onUpdate();
                            } catch { /* silent */ }
                          }}
                            style={{
                              marginTop: 6, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                              background: "#0a1a0a", border: "1px solid #1a3a1a",
                              color: "#4ade80", fontSize: 9,
                            }}>
                            Fix
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Polish Tab ── */}
          {tab === "polish" && (
            <>
              <label style={labelStyle}>Aggressiveness: {Math.round(aggressiveness * 100)}%</label>
              <input type="range" min={0} max={100} value={Math.round(aggressiveness * 100)}
                onChange={e => setAggressiveness(Number(e.target.value) / 100)}
                style={{ width: "100%", accentColor: "#c8b898" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#7a7668", marginBottom: 12 }}>
                <span>Gentle</span><span>Aggressive</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#c4c0b4", cursor: "pointer" }}>
                  <input type="checkbox" checked={alignToGrid} onChange={e => setAlignToGrid(e.target.checked)}
                    style={{ accentColor: "#c8b898" }} />
                  Align to grid
                  {alignToGrid && (
                    <>
                      <span style={{ color: "#7a7668", fontSize: 10 }}>(</span>
                      <input type="number" value={gridSize} onChange={e => setGridSize(Number(e.target.value))}
                        style={{
                          width: 36, padding: "1px 4px", borderRadius: 3,
                          background: "#0a0a14", border: "1px solid #2a2a3a",
                          color: "#f0ebe0", fontSize: 10, textAlign: "center",
                        }} />
                      <span style={{ color: "#7a7668", fontSize: 10 }}>px)</span>
                    </>
                  )}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#c4c0b4", cursor: "pointer" }}>
                  <input type="checkbox" checked={boostContrast} onChange={e => setBoostContrast(e.target.checked)}
                    style={{ accentColor: "#c8b898" }} />
                  Boost contrast (WCAG AA)
                </label>
              </div>

              <button type="button" onClick={handlePolish} disabled={loading || !templateId}
                style={{ ...btnPrimary, width: "100%", fontSize: 13, padding: "10px",
                  opacity: loading || !templateId ? 0.5 : 1 }}>
                {loading ? "Polishing..." : "✨ Polish Design"}
              </button>

              {(polishBefore !== null && polishAfter !== null) && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                    <div style={{ textAlign: "center", padding: "10px 14px", background: "#111118", borderRadius: 8, flex: 1 }}>
                      <div style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", marginBottom: 2 }}>Before</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor(polishBefore) }}>{Math.round(polishBefore)}</div>
                    </div>
                    <div style={{ fontSize: 20, color: "#4ade80" }}>→</div>
                    <div style={{ textAlign: "center", padding: "10px 14px", background: "#111118", borderRadius: 8, flex: 1 }}>
                      <div style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", marginBottom: 2 }}>After</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor(polishAfter) }}>{Math.round(polishAfter)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: "#4ade80" }}>
                    +{Math.round(polishAfter - polishBefore)} 🎉
                  </div>

                  {polishChanges.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                        Changes Applied
                      </div>
                      <div style={{ ...codeBlock, maxHeight: 160, overflowY: "auto" }}>
                        {polishChanges.map((c: any, i: number) => (
                          <div key={i} style={{
                            fontSize: 10, padding: "3px 0", color: "#4ade80",
                            borderBottom: "1px solid #1c1c26",
                          }}>
                            ✓ {typeof c === "string" ? c : c.message || c.description || JSON.stringify(c)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button type="button" onClick={() => onUpdate()}
                    style={{ ...btnSecondary, marginTop: 10, width: "100%" }}>
                    Refresh Canvas
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── Palette Tab ── */}
          {tab === "palette" && (
            <>
              <label style={labelStyle}>Base Color</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <input type="color" value={baseColor}
                  onChange={e => setBaseColor(e.target.value)}
                  style={{
                    width: 36, height: 36, border: "none", borderRadius: 6,
                    cursor: "pointer", padding: 0, background: "transparent",
                  }} />
                <input type="text" value={baseColor}
                  onChange={e => setBaseColor(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }} />
              </div>

              <label style={labelStyle}>Harmony Type</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 12 }}>
                {harmonyOptions.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setHarmonyType(opt.value)}
                    style={{
                      padding: "6px 8px", borderRadius: 4, cursor: "pointer",
                      background: harmonyType === opt.value ? "#1a1a2e" : "transparent",
                      border: harmonyType === opt.value ? "1px solid #c8b898" : "1px solid #2a2a3a",
                      color: harmonyType === opt.value ? "#c8b898" : "#7a7668",
                      fontSize: 10, textAlign: "left",
                    }}>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: 8, color: "#4a4a5a" }}>{opt.desc}</div>
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Count ({paletteCount})</label>
                  <input type="range" min={2} max={8} value={paletteCount}
                    onChange={e => setPaletteCount(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#c8b898" }} />
                </div>
                <div>
                  <label style={labelStyle}>Mood</label>
                  <select value={mood} onChange={e => setMood(e.target.value as MoodType)} style={selectStyle}>
                    {moodOptions.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button type="button" onClick={handlePalette} disabled={loading}
                style={{ ...btnPrimary, width: "100%", opacity: loading ? 0.5 : 1 }}>
                {loading ? "Generating..." : "🎨 Generate Palette"}
              </button>

              {swatches.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    Generated Palette
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {swatches.map((s, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", background: "#111118",
                        borderRadius: 8, border: "1px solid #1c1c26",
                        cursor: "pointer",
                      }} onClick={() => copyHex(s.hex)}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 8,
                          background: s.hex, border: "2px solid #2a2a3a",
                          flexShrink: 0,
                          boxShadow: `0 2px 8px ${s.hex}44`,
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{s.name || s.role || `Color ${i + 1}`}</div>
                          <div style={{ fontSize: 10, color: "#7a7668", fontFamily: "monospace" }}>{s.hex}</div>
                          {s.role && <div style={{ fontSize: 9, color: "#7a7668" }}>{s.role}</div>}
                        </div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); copyHex(s.hex); }}
                          style={{
                            background: "none", border: "1px solid #2a2a3a",
                            color: "#7a7668", borderRadius: 3, padding: "2px 8px",
                            cursor: "pointer", fontSize: 10,
                          }} title="Copy hex">
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Error bar */}
        {error && (
          <div style={{
            padding: "8px 12px", borderTop: "1px solid #2a1a1a",
            background: "#1a0a0a", color: "#f87171", fontSize: 11,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>⚠ {error}</span>
            <button type="button" onClick={() => setError(null)}
              style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 14 }}>
              ✕
            </button>
          </div>
        )}
      </div>
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

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 4,
  background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
  color: "#c8b898", fontSize: 11, cursor: "pointer",
};

const codeBlock: React.CSSProperties = {
  padding: "8px 10px", background: "#0a0a10",
  border: "1px solid #1c1c26", borderRadius: 6,
  fontSize: 10, fontFamily: "monospace",
  lineHeight: 1.5, color: "#c4c0b4",
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#60a5fa";
  if (score >= 40) return "#fbbf24";
  return "#f87171";
}
