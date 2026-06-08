import { useState, useEffect, useRef } from "react";
import { mcpCall } from "../lib/mcpClient";

interface CreativePanelProps {
  templateId: string | null;
  selectedObjects: any[];
  onClose: () => void;
  onUpdate: () => void;
}

type TabId = "layout" | "remix" | "diff" | "observe";
type LayoutAlgo = "grid" | "masonry" | "golden-ratio" | "circular" | "zigzag" | "flex-wrap";
type RemixStyle = "brutalist" | "glassmorphism" | "swiss" | "cyberpunk" | "minimal" | "art-deco" | "bauhaus";

interface DiffResult {
  similarityScore: number;
  a: { objects: number; types: Record<string, number>; fonts: Record<string, number>; };
  b: { objects: number; types: Record<string, number>; fonts: Record<string, number>; };
  diffs: Array<{ layer: string; status: string; detail?: string; }>;
}

interface ObserveEvent {
  time: number;
  type: string;
  tool?: string;
  detail?: string;
}

export function CreativePanel({ templateId, selectedObjects, onClose, onUpdate }: CreativePanelProps) {
  const [tab, setTab] = useState<TabId>("layout");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Layout state
  const [layoutAlgo, setLayoutAlgo] = useState<LayoutAlgo>("grid");
  const [layoutCols, setLayoutCols] = useState(3);
  const [layoutGap, setLayoutGap] = useState(16);
  const [layoutStartX, setLayoutStartX] = useState(0);
  const [layoutStartY, setLayoutStartY] = useState(0);
  const [layoutRadius, setLayoutRadius] = useState(300);
  const [layoutAmplitude, setLayoutAmplitude] = useState(40);
  const [layoutMaxWidth, setLayoutMaxWidth] = useState(1080);
  const [layoutTarget, setLayoutTarget] = useState("");

  // Remix state
  const [remixStyle, setRemixStyle] = useState<RemixStyle>("brutalist");
  const [remixCount, setRemixCount] = useState(1);
  const [remixResults, setRemixResults] = useState<any[]>([]);

  // Diff state
  const [diffA, setDiffA] = useState("");
  const [diffB, setDiffB] = useState("");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [workspaceTemplates, setWorkspaceTemplates] = useState<any[]>([]);

  // Observe state
  const [isRecording, setIsRecording] = useState(false);
  const [observeEvents, setObserveEvents] = useState(0);
  const [observeResult, setObserveResult] = useState<any>(null);
  const observeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Load workspace templates for diff
  useEffect(() => {
    if (!templateId || tab !== "diff") return;
    (async () => {
      try {
        const tpl = await mcpCall("get_template", { id: templateId });
        if (tpl?.workspaceId) {
          const res = await fetch("/api/templates?workspaceId=" + tpl.workspaceId);
          const json = await res.json();
          setWorkspaceTemplates(json.templates || json || []);
          setDiffA(templateId);
        }
      } catch { /* silent */ }
    })();
  }, [templateId, tab]);

  // Cleanup observe timer
  useEffect(() => {
    return () => {
      if (observeTimerRef.current) clearInterval(observeTimerRef.current);
    };
  }, []);

  // ── Layout handlers ──

  const handleLayout = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const params: any = { templateId, layout: layoutAlgo };
      if (layoutAlgo === "grid" || layoutAlgo === "masonry") { params.columns = layoutCols; params.gap = layoutGap; }
      if (layoutAlgo === "golden-ratio") { params.startX = layoutStartX; params.startY = layoutStartY; }
      if (layoutAlgo === "circular") { params.radius = layoutRadius; params.startX = layoutStartX; params.startY = layoutStartY; }
      if (layoutAlgo === "zigzag") { params.amplitude = layoutAmplitude; params.gap = layoutGap; }
      if (layoutAlgo === "flex-wrap") { params.maxWidth = layoutMaxWidth; params.gap = layoutGap; }
      if (layoutTarget) params.targetLayerNames = layoutTarget.split(",").map(s => s.trim()).filter(Boolean);
      await mcpCall("smart_layout", params);
      onUpdate();
    } catch (e: any) {
      setError(e?.message || "Layout application failed");
    }
    setLoading(false);
  };

  // ── Remix handlers ──

  const handleRemix = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setRemixResults([]);
    try {
      const result = await mcpCall("remix_template", { templateId, style: remixStyle, count: remixCount });
      setRemixResults(result.variations || result.templates || result.generated || []);
    } catch (e: any) {
      setError(e?.message || "Remix failed");
    }
    setLoading(false);
  };

  // ── Diff handlers ──

  const handleDiff = async () => {
    if (!diffA || !diffB) { setError("Select two templates to compare"); return; }
    setLoading(true);
    setError(null);
    setDiffResult(null);
    try {
      const result = await mcpCall("design_diff", { templateIdA: diffA, templateIdB: diffB });
      setDiffResult({
        similarityScore: result.similarityScore || result.similarity || 0,
        a: result.a || result.templateA || result.summary?.a || { objects: 0, types: {}, fonts: {} },
        b: result.b || result.templateB || result.summary?.b || { objects: 0, types: {}, fonts: {} },
        diffs: result.diffs || result.differences || result.changes || [],
      });
    } catch (e: any) {
      setError(e?.message || "Diff failed");
    }
    setLoading(false);
  };

  // ── Observe handlers ──

  const handleObserve = async (action: "start" | "stop" | "analyze") => {
    setLoading(true);
    setError(null);
    try {
      const userId = "session-" + Date.now();
      const result = await mcpCall("observe_session", { action, userId, templateId });

      if (action === "start") {
        setIsRecording(true);
        setElapsed(0);
        setObserveEvents(0);
        setObserveResult(null);
        // Poll every 2s for event count
        observeTimerRef.current = setInterval(async () => {
          setElapsed(prev => prev + 2);
          try {
            const check = await mcpCall("observe_session", { action: "analyze", userId });
            if (check?.totalEvents) setObserveEvents(check.totalEvents);
          } catch { /* silent */ }
        }, 2000);
      }

      if (action === "stop") {
        setIsRecording(false);
        if (observeTimerRef.current) { clearInterval(observeTimerRef.current); observeTimerRef.current = null; }
      }

      if (action === "analyze") {
        setObserveResult(result);
      }
    } catch (e: any) {
      setError(e?.message || `Observe ${action} failed`);
    }
    setLoading(false);
  };

  // ── Layout preview SVGs ──

  const layoutPreview = (algo: LayoutAlgo) => {
    const size = 50;
    const dots = (algo: LayoutAlgo) => {
      const els: any[] = [];
      const r = 2;
      const n = 9;
      for (let i = 0; i < n; i++) {
        let cx = 0, cy = 0;
        if (algo === "grid") {
          const cols = 3;
          cx = 8 + (i % cols) * 16;
          cy = 8 + Math.floor(i / cols) * 16;
        } else if (algo === "masonry") {
          const cols = 3;
          cx = 6 + (i % cols) * 16;
          cy = 6 + (i % 3 === 0 ? 0 : i % 3 === 1 ? 8 : 4) * (10 + (i % 4) * 2);
        } else if (algo === "golden-ratio") {
          const phi = 1.618;
          const angle = i * phi * Math.PI * 2;
          const rad = i * 4 + 5;
          cx = size / 2 + Math.cos(angle) * rad;
          cy = size / 2 + Math.sin(angle) * rad;
        } else if (algo === "circular") {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          cx = size / 2 + Math.cos(angle) * (size / 2 - 8);
          cy = size / 2 + Math.sin(angle) * (size / 2 - 8);
        } else if (algo === "zigzag") {
          cx = 6 + (i / (n - 1)) * (size - 12);
          cy = size / 2 + (i % 2 === 0 ? -10 : 10);
        } else {
          cx = 8 + (i % 4) * 12;
          cy = 8 + (i >= 4 ? 24 : 0);
        }
        els.push(<circle key={i} cx={cx} cy={cy} r={r} fill="#818cf8" opacity={0.6 + (i / n) * 0.4} />);
      }
      return els;
    };

    return (
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <rect width={size} height={size} rx={4} fill="#0a0a10" />
        {dots(algo)}
      </svg>
    );
  };

  const layouts: { value: LayoutAlgo; label: string; icon: string }[] = [
    { value: "grid", label: "Grid", icon: "📐" },
    { value: "masonry", label: "Masonry", icon: "🧱" },
    { value: "golden-ratio", label: "Golden Ratio", icon: "φ" },
    { value: "circular", label: "Circular", icon: "⭕" },
    { value: "zigzag", label: "Zigzag", icon: "⚡" },
    { value: "flex-wrap", label: "Flex-Wrap", icon: "📏" },
  ];

  const remixStyles: { value: RemixStyle; label: string; desc: string; bg: string; accent: string }[] = [
    { value: "brutalist", label: "Brutalist", desc: "Raw, high contrast, bold", bg: "#1a1a14", accent: "#f87171" },
    { value: "glassmorphism", label: "Glass", desc: "Frosted, blur, translucent", bg: "#141a2a", accent: "#60a5fa" },
    { value: "swiss", label: "Swiss", desc: "Clean, grid-based, minimal", bg: "#141414", accent: "#e4e4e4" },
    { value: "cyberpunk", label: "Cyberpunk", desc: "Neon, glitch, dystopian", bg: "#1a0a1a", accent: "#c084fc" },
    { value: "minimal", label: "Minimal", desc: "Essential, spacious, subtle", bg: "#0f0f0f", accent: "#a4a4a4" },
    { value: "art-deco", label: "Art Deco", desc: "Geometric, luxurious, gold", bg: "#1a140a", accent: "#fbbf24" },
    { value: "bauhaus", label: "Bauhaus", desc: "Geometric, primary colors", bg: "#1a0a0a", accent: "#4ade80" },
  ];

  const tabs: { id: TabId; label: string }[] = [
    { id: "layout", label: "Layout" },
    { id: "remix", label: "Remix" },
    { id: "diff", label: "Diff" },
    { id: "observe", label: "Observe" },
  ];

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, sans-serif",
    }}>
      <div style={{
        width: 600, maxHeight: "85vh", background: "#0e0e14",
        border: "1px solid #1c1c26", borderRadius: 10,
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        fontSize: 12, color: "#c4c4d4",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid #1c1c26",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>🎨 Creative Tools</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#7a7a90", cursor: "pointer", fontSize: 18,
          }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1c1c26" }}>
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "8px 4px", border: "none", cursor: "pointer",
                background: tab === t.id ? "#1a1a2e" : "transparent",
                color: tab === t.id ? "#c4b5fd" : "#6a6a80",
                borderBottom: tab === t.id ? "2px solid #818cf8" : "2px solid transparent",
                fontSize: 11, fontWeight: tab === t.id ? 600 : 400,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {/* ── Layout Tab ── */}
          {tab === "layout" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
                {layouts.map(l => (
                  <button key={l.value} type="button" onClick={() => setLayoutAlgo(l.value)}
                    style={{
                      padding: "8px 6px", borderRadius: 6, cursor: "pointer",
                      background: layoutAlgo === l.value ? "#1a1a2e" : "transparent",
                      border: layoutAlgo === l.value ? "1px solid #818cf8" : "1px solid #2a2a3a",
                      color: layoutAlgo === l.value ? "#c4b5fd" : "#7a7a90",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    }}>
                    {layoutPreview(l.value)}
                    <span style={{ fontSize: 9 }}>
                      {l.icon} {l.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Dynamic options per layout */}
              <div style={{ padding: "8px 10px", background: "#0a0a10", borderRadius: 6, border: "1px solid #1c1c26", marginBottom: 14 }}>
                {(layoutAlgo === "grid" || layoutAlgo === "masonry") && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={labelStyle}>Columns</label>
                      <input type="number" value={layoutCols} onChange={e => setLayoutCols(Number(e.target.value))}
                        min={1} max={12} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Gap (px)</label>
                      <input type="number" value={layoutGap} onChange={e => setLayoutGap(Number(e.target.value))}
                        min={0} style={inputStyle} />
                    </div>
                  </div>
                )}

                {(layoutAlgo === "golden-ratio" || layoutAlgo === "circular") && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={labelStyle}>Start X</label>
                      <input type="number" value={layoutStartX} onChange={e => setLayoutStartX(Number(e.target.value))}
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Start Y</label>
                      <input type="number" value={layoutStartY} onChange={e => setLayoutStartY(Number(e.target.value))}
                        style={inputStyle} />
                    </div>
                    {layoutAlgo === "circular" && (
                      <div>
                        <label style={labelStyle}>Radius (px)</label>
                        <input type="number" value={layoutRadius} onChange={e => setLayoutRadius(Number(e.target.value))}
                          min={50} style={inputStyle} />
                      </div>
                    )}
                  </div>
                )}

                {layoutAlgo === "zigzag" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={labelStyle}>Amplitude (px)</label>
                      <input type="number" value={layoutAmplitude} onChange={e => setLayoutAmplitude(Number(e.target.value))}
                        min={10} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Gap (px)</label>
                      <input type="number" value={layoutGap} onChange={e => setLayoutGap(Number(e.target.value))}
                        min={0} style={inputStyle} />
                    </div>
                  </div>
                )}

                {layoutAlgo === "flex-wrap" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={labelStyle}>Max Width (px)</label>
                      <input type="number" value={layoutMaxWidth} onChange={e => setLayoutMaxWidth(Number(e.target.value))}
                        min={200} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Gap (px)</label>
                      <input type="number" value={layoutGap} onChange={e => setLayoutGap(Number(e.target.value))}
                        min={0} style={inputStyle} />
                    </div>
                  </div>
                )}
              </div>

              <label style={labelStyle}>Target Layers (optional, comma-separated)</label>
              <input type="text" value={layoutTarget} onChange={e => setLayoutTarget(e.target.value)}
                placeholder="e.g. Button 1, Button 2, Card" style={inputStyle} />

              <button type="button" onClick={handleLayout} disabled={loading || !templateId}
                style={{ ...btnPrimary, marginTop: 14, width: "100%", fontSize: 13,
                  opacity: loading || !templateId ? 0.5 : 1 }}>
                {loading ? "Applying..." : "🎯 Apply Layout"}
              </button>
            </>
          )}

          {/* ── Remix Tab ── */}
          {tab === "remix" && (
            <>
              <div style={{ fontSize: 10, color: "#6a6a80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Choose Style
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
                {remixStyles.map(s => (
                  <button key={s.value} type="button" onClick={() => setRemixStyle(s.value)}
                    style={{
                      padding: "12px 10px", borderRadius: 8, cursor: "pointer",
                      background: remixStyle === s.value ? s.bg : "#0a0a10",
                      border: remixStyle === s.value ? `1px solid ${s.accent}` : "1px solid #2a2a3a",
                      textAlign: "left",
                    }}>
                    <div style={{
                      width: "100%", height: 32, borderRadius: 4, marginBottom: 8,
                      background: `linear-gradient(135deg, ${s.accent}44, ${s.accent}22)`,
                      border: `1px solid ${s.accent}33`,
                    }} />
                    <div style={{ fontSize: 11, fontWeight: 600, color: remixStyle === s.value ? s.accent : "#c4c4d4" }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 9, color: "#6a6a80", marginTop: 2 }}>
                      {s.desc}
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Variations ({remixCount})</label>
                  <input type="range" min={1} max={5} value={remixCount}
                    onChange={e => setRemixCount(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#818cf8" }} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button type="button" onClick={handleRemix} disabled={loading || !templateId}
                    style={{ ...btnPrimary, width: "100%", opacity: loading || !templateId ? 0.5 : 1 }}>
                    {loading ? "Remixing..." : "🎭 Remix"}
                  </button>
                </div>
              </div>

              {remixResults.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 10, color: "#6a6a80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    Variations
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {remixResults.map((r, i) => (
                      <div key={i} style={{
                        padding: "8px 10px", background: "#111118",
                        border: "1px solid #1c1c26", borderRadius: 6,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>
                            {r.style || r.name || `Variation ${i + 1}`}
                          </div>
                          <div style={{ fontSize: 9, color: "#6a6a80", fontFamily: "monospace" }}>
                            {r.templateId || r.id || `#${i + 1}`}
                          </div>
                        </div>
                        {r.templateId && (
                          <button type="button" onClick={() => {
                            // Navigate to template
                            window.location.hash = "#editor/" + r.templateId;
                          }}
                            style={{
                              padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                              background: "#1a1a2e", border: "1px solid #2a2a3a",
                              color: "#818cf8", fontSize: 10,
                            }}>
                            Open
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Diff Tab ── */}
          {tab === "diff" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Baseline (A)</label>
                  <select value={diffA} onChange={e => setDiffA(e.target.value)} style={selectStyle}>
                    <option value="">Select...</option>
                    {workspaceTemplates.map((t: any) => (
                      <option key={t.id || t.templateId} value={t.id || t.templateId}>
                        {t.name || t.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Comparison (B)</label>
                  <select value={diffB} onChange={e => setDiffB(e.target.value)} style={selectStyle}>
                    <option value="">Select...</option>
                    {workspaceTemplates.map((t: any) => (
                      <option key={t.id || t.templateId} value={t.id || t.templateId}>
                        {t.name || t.id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button type="button" onClick={handleDiff} disabled={loading || !diffA || !diffB}
                style={{ ...btnPrimary, width: "100%", opacity: loading || !diffA || !diffB ? 0.5 : 1 }}>
                {loading ? "Comparing..." : "🔍 Compare"}
              </button>

              {diffResult && (
                <div style={{ marginTop: 16 }}>
                  {/* Similarity score */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
                    padding: "10px 14px", background: "#111118", borderRadius: 8,
                    border: "1px solid #1c1c26",
                  }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color: scoreColor(diffResult.similarityScore) }}>
                      {Math.round(diffResult.similarityScore)}%
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>Similarity Score</div>
                      <div style={{ height: 4, background: "#0a0a10", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${diffResult.similarityScore}%`,
                          background: scoreColor(diffResult.similarityScore), borderRadius: 2,
                        }} />
                      </div>
                    </div>
                  </div>

                  {/* Side-by-side summaries */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <div style={{ ...summaryBox }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>Template A</div>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>
                        Objects: {diffResult.a.objects}
                      </div>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>
                        Types: {Object.entries(diffResult.a.types).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>
                        Fonts: {Object.entries(diffResult.a.fonts).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}
                      </div>
                    </div>
                    <div style={{ ...summaryBox }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#4ade80", marginBottom: 4 }}>Template B</div>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>
                        Objects: {diffResult.b.objects}
                      </div>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>
                        Types: {Object.entries(diffResult.b.types).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6a6a80" }}>
                        Fonts: {Object.entries(diffResult.b.fonts).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}
                      </div>
                    </div>
                  </div>

                  {/* Diff list */}
                  {diffResult.diffs.length > 0 && (
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      <div style={{ fontSize: 10, color: "#6a6a80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                        Layer Differences ({diffResult.diffs.length})
                      </div>
                      {diffResult.diffs.map((d, i) => (
                        <div key={i} style={{
                          padding: "5px 8px", marginBottom: 3, borderRadius: 3,
                          background: d.status === "added" ? "rgba(74,222,128,0.08)" : d.status === "removed" ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.05)",
                          borderLeft: `3px solid ${d.status === "added" ? "#4ade80" : d.status === "removed" ? "#f87171" : "#fbbf24"}`,
                          fontSize: 10,
                        }}>
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600, marginRight: 6,
                            background: d.status === "added" ? "rgba(74,222,128,0.15)" : d.status === "removed" ? "rgba(248,113,113,0.15)" : "rgba(251,191,36,0.1)",
                            color: d.status === "added" ? "#4ade80" : d.status === "removed" ? "#f87171" : "#fbbf24",
                          }}>
                            {d.status.toUpperCase()}
                          </span>
                          <span style={{ color: "#818cf8" }}>{d.layer}</span>
                          {d.detail && <span style={{ color: "#6a6a80", marginLeft: 6 }}>{d.detail}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Observe Tab ── */}
          {tab === "observe" && (
            <>
              {/* Recording indicator */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
                padding: "8px 12px", background: isRecording ? "#1a0a0a" : "#0a0a0a",
                border: `1px solid ${isRecording ? "#3a1a1a" : "#1c1c26"}`,
                borderRadius: 6,
              }}>
                <div style={{
                  width: 12, height: 12, borderRadius: "50%",
                  background: isRecording ? "#f87171" : "#4a4a5a",
                  animation: isRecording ? "pulse 1.5s infinite" : "none",
                }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: isRecording ? "#f87171" : "#6a6a80" }}>
                  {isRecording ? "🔴 RECORDING" : "⚪ IDLE"}
                </span>
                {isRecording && (
                  <span style={{ fontSize: 10, color: "#7a7a90", marginLeft: "auto" }}>
                    {Math.floor(elapsed / 60)}m {elapsed % 60}s · {observeEvents} events
                  </span>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {!isRecording ? (
                  <button type="button" onClick={() => handleObserve("start")} disabled={loading}
                    style={{ ...btnPrimary, flex: 1, opacity: loading ? 0.5 : 1, fontSize: 13 }}>
                    ▶ Start Recording
                  </button>
                ) : (
                  <button type="button" onClick={() => handleObserve("stop")} disabled={loading}
                    style={{
                      ...btnPrimary, flex: 1, opacity: loading ? 0.5 : 1, fontSize: 13,
                      background: "#4a1a1a", border: "1px solid #7a2a2a", color: "#f87171",
                    }}>
                    ⏹ Stop Recording
                  </button>
                )}
                <button type="button" onClick={() => handleObserve("analyze")} disabled={loading}
                  style={{ ...btnSecondary, flex: 1, opacity: loading ? 0.5 : 1 }}>
                  📊 Analyze
                </button>
              </div>

              {observeResult && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 10, color: "#6a6a80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    Session Analysis
                  </div>

                  <div style={{ ...codeBlock, padding: "12px 14px" }}>
                    {/* Duration & events */}
                    <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "#6a6a80" }}>Duration</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#c4c4d4" }}>
                          {observeResult.duration || observeResult.elapsed || "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#6a6a80" }}>Total Events</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#c4c4d4" }}>
                          {observeResult.totalEvents || 0}
                        </div>
                      </div>
                    </div>

                    {/* Top tools */}
                    {observeResult.topTools?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 9, color: "#6a6a80", marginBottom: 4 }}>Most Used Tools</div>
                        {observeResult.topTools.slice(0, 5).map((t: any, i: number) => {
                          const max = observeResult.topTools[0]?.count || 1;
                          const barWidth = Math.max(4, (t.count / max) * 120);
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <div style={{
                                height: 8, width: barWidth, borderRadius: 2,
                                background: i === 0 ? "#818cf8" : i === 1 ? "#6366f1" : "#4f46e5",
                                flexShrink: 0,
                              }} />
                              <span style={{ fontSize: 9, color: "#c4c4d4" }}>{t.name || t.tool}</span>
                              <span style={{ fontSize: 9, color: "#6a6a80", marginLeft: "auto" }}>{t.count} calls</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Action breakdown */}
                    {observeResult.breakdown && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 9, color: "#6a6a80", marginBottom: 4 }}>Action Breakdown</div>
                        {Object.entries(observeResult.breakdown).map(([k, v]: [string, any], i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 2 }}>
                            <span style={{ color: "#c4c4d4" }}>{k}</span>
                            <span style={{ color: "#6a6a80" }}>{v} ({observeResult.totalEvents ? Math.round((Number(v) / observeResult.totalEvents) * 100) : 0}%)</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Insights */}
                    {observeResult.insights?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: "#6a6a80", marginBottom: 4 }}>Insights</div>
                        {observeResult.insights.map((ins: any, i: number) => (
                          <div key={i} style={{ fontSize: 9, color: "#c4b5fd", marginBottom: 2 }}>
                            • {typeof ins === "string" ? ins : ins.message || JSON.stringify(ins)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Pulse animation style */}
              <style>{`
                @keyframes pulse {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.3; }
                }
              `}</style>
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
              style={{ background: "none", border: "none", color: "#7a7a90", cursor: "pointer", fontSize: 14 }}>
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
  display: "block", fontSize: 10, color: "#6a6a80",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: 1,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 8px", borderRadius: 4,
  background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#e4e4f0", fontSize: 11, outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "#2a1a4a", border: "1px solid #4a2a7a",
  color: "#c4b5fd", fontSize: 12, fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 4,
  background: "#111118", border: "1px solid #2a2a3a",
  color: "#818cf8", fontSize: 11, cursor: "pointer",
};

const codeBlock: React.CSSProperties = {
  padding: "8px 10px", background: "#0a0a10",
  border: "1px solid #1c1c26", borderRadius: 6,
  fontSize: 10, fontFamily: "monospace",
  lineHeight: 1.5, color: "#c4c4d4",
};

const summaryBox: React.CSSProperties = {
  padding: "8px 10px", background: "#0a0a10",
  border: "1px solid #1c1c26", borderRadius: 6,
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#60a5fa";
  if (score >= 40) return "#fbbf24";
  return "#f87171";
}
