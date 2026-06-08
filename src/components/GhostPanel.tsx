import { useState, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";
import { IconGhost, IconBot, IconUser, IconSettings, IconX } from "../shared/icons";

interface GhostDiffResult {
  layerName?: string;
  action: "added" | "deleted" | "modified";
  color: string;
  old?: any;
  new?: any;
  changes?: { path: string; old: any; new: any }[];
}

interface GhostPanelProps {
  templateId: string | null;
}

const DIFF_COLORS: Record<string, string> = {
  added: "#4ade80",
  deleted: "#f87171",
  modified: "#fbbf24",
};

export function GhostPanel({ templateId }: GhostPanelProps) {
  const [ghostActive, setGhostActive] = useState(false);
  const [ghostType, setGhostType] = useState<"ia" | "human" | "system">("ia");
  const [opacity, setOpacity] = useState(0.25);
  const [tint, setTint] = useState("#a78bfa");
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<GhostDiffResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apply ghost overlay
  const applyGhost = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await mcpCall("ghost_show", {
        templateId,
        type: ghostType,
        opacity,
        tint,
        showDiff,
      });
      setGhostActive(true);
      if (result?.diff) {
        setDiffData(null); // diff handled separately via ghost_diff
      }
    } catch (e: any) {
      setError(e?.message || "Failed to apply ghost");
      setGhostActive(false);
    } finally {
      setLoading(false);
    }
  }, [templateId, ghostType, opacity, tint, showDiff]);

  // Clear ghost layer
  const clearGhost = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    try {
      // Clear ghost by updating metadata
      await mcpCall("update_template", {
        id: templateId,
        metadata: { ghostLayer: null },
      });
      setGhostActive(false);
      setDiffData(null);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to clear ghost");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  // Run ghost_diff
  const runDiff = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await mcpCall("ghost_diff", { templateId });
      setDiffData(result?.changes || []);
      if (!result?.changes?.length) {
        setError("No differences found between current state and baseline.");
      }
    } catch (e: any) {
      setError(e?.message || "Diff failed");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  // Run ghost_merge (keep current objects)
  const runMergeKeepCurrent = useCallback(async () => {
    if (!templateId || !diffData) return;
    const keepNames = diffData
      .filter(d => d.action === "deleted")
      .map(d => d.layerName!)
      .filter(Boolean);
    try {
      const allSnaps = await mcpCall("list_snapshots", { templateId });
      const lastHuman = allSnaps?.snapshots?.find((s: any) => s.type === "human");
      if (!lastHuman) { setError("No human snapshot to merge from"); return; }
      const result = await mcpCall("ghost_merge", {
        templateId,
        sourceSnapId: lastHuman.id,
        keepLayerNames: keepNames.length > 0 ? keepNames : undefined,
        mode: "prefer_current",
      });
      setError(null);
      setGhostActive(false);
      setDiffData(null);
      // Refresh canvas via window signal
      if ((window as any).__canvasControls?.pushHistory) {
        (window as any).__canvasControls.pushHistory();
      }
    } catch (e: any) {
      setError(e?.message || "Merge failed");
    }
  }, [templateId, diffData]);

  return (
    <div className="glass-panel" style={{
      padding: "8px 12px",
      fontFamily: "Inter, sans-serif", fontSize: 11, color: "#c4c0b4",
    }}>
      {/* Section Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 8,
      }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}><IconGhost size={14} style={{ marginRight: 4, verticalAlign: -3 }} />Ghost Layer</span>
        <span style={{
          fontSize: 10, padding: "2px 6px", borderRadius: 3,
          background: ghostActive ? "#1a2a2a" : "#1a1a1a",
          color: ghostActive ? "#4ade80" : "#7a7668",
        }}>
          {ghostActive ? "ACTIVE" : "OFF"}
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Type selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ minWidth: 36, color: "#7a7668", fontSize: 10 }}>Type</span>
          {(["ia", "human", "system"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setGhostType(t)}
              style={{
                flex: 1, padding: "3px 0", borderRadius: 4, border: "1px solid",
                borderColor: ghostType === t ? "#c8b898" : "rgba(255, 255, 255, 0.04)",
                background: ghostType === t ? "rgba(200, 184, 152, 0.08)" : "rgba(15, 15, 15, 0.5)",
                color: ghostType === t ? "#c4c0b4" : "#7a7668",
                cursor: "pointer", fontSize: 10, textAlign: "center" as const,
              }}>
              {t === "ia" ? <><IconBot size={12} style={{ marginRight: 2 }} />IA</> : t === "human" ? <><IconUser size={12} style={{ marginRight: 2 }} />Human</> : <><IconSettings size={12} style={{ marginRight: 2 }} />Sys</>}
            </button>
          ))}
        </div>

        {/* Opacity slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ minWidth: 36, color: "#7a7668", fontSize: 10 }}>Opacity</span>
          <input
            type="range"
            min={10} max={50} step={5}
            value={Math.round(opacity * 100)}
            onChange={e => setOpacity(Number(e.target.value) / 100)}
            style={{ flex: 1, accentColor: "#c8b898", height: 16 }}
          />
          <span style={{ fontSize: 10, color: "#c8b898", minWidth: 28, textAlign: "right" }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        {/* Tint color */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ minWidth: 36, color: "#7a7668", fontSize: 10 }}>Tint</span>
          <input
            type="color"
            value={tint}
            onChange={e => setTint(e.target.value)}
            style={{
              width: 28, height: 22, border: "none", borderRadius: 4,
              background: "transparent", cursor: "pointer",
            }}
          />
          <span style={{ fontSize: 10, color: "#7a7668" }}>{tint}</span>
        </div>

        {/* Diff toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ minWidth: 36, color: "#7a7668", fontSize: 10 }}>Diff</span>
          <button
            type="button"
            onClick={() => setShowDiff(!showDiff)}
            style={{
              padding: "3px 8px", borderRadius: 4,
              border: `1px solid ${showDiff ? "#fbbf24" : "rgba(255, 255, 255, 0.04)"}`,
              background: showDiff ? "rgba(200, 184, 152, 0.08)" : "rgba(15, 15, 15, 0.5)",
              color: showDiff ? "#fbbf24" : "#7a7668",
              cursor: "pointer", fontSize: 10,
            }}>
            {showDiff ? "Diff ON" : "Diff OFF"}
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <button type="button" onClick={applyGhost} disabled={loading || !templateId}
            style={primaryBtn(!!(loading || !templateId))}>
            {loading ? "..." : "Apply Ghost"}
          </button>
          <button type="button" onClick={clearGhost} disabled={loading || !ghostActive}
            style={secondaryBtn(!!(loading || !ghostActive))}>
            Clear
          </button>
          <button type="button" onClick={runDiff} disabled={loading || !templateId}
            style={secondaryBtn(!!(loading || !templateId))}>
            Diff
          </button>
        </div>

        {/* Merge button (visible when diff active) */}
        {diffData && diffData.length > 0 && (
          <button type="button" onClick={runMergeKeepCurrent}
            style={{
              ...primaryBtn(false),
              background: "#1a2a1a", borderColor: "#4ade80", color: "#4ade80",
            }}>
            Merge (Keep Mine)
          </button>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: 10, color: "#f87171", padding: "4px 0" }}>{error}</div>
        )}
      </div>

      {/* Diff results mini-view */}
      {diffData && diffData.length > 0 && (
        <div style={{
          marginTop: 8, padding: "6px 8px", background: "#0a0a10",
          borderRadius: 4, maxHeight: 140, overflowY: "auto",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, marginBottom: 4,
            display: "flex", justifyContent: "space-between",
          }}>
            <span>Diff Results ({diffData.length})</span>
            <span style={{
              color: "#fbbf24", cursor: "pointer",
            }} onClick={() => setDiffData(null)}><IconX size={14} /></span>
          </div>
          {diffData.map((d, i) => (
            <div key={i} style={{
              fontSize: 10, padding: "1px 0",
              display: "flex", gap: 4, alignItems: "center",
              borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
            }}>
              <span style={{
                color: DIFF_COLORS[d.action] || "#7a7668",
                fontWeight: 600, minWidth: 50, fontSize: 9,
              }}>
                {d.action.toUpperCase()}
              </span>
              <span style={{ color: "#7a7668" }}>{d.layerName || "?"}</span>
              {d.action === "modified" && d.changes && (
                <span style={{ color: "#7a7668", fontSize: 9 }}>
                  ({d.changes.length} fields)
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "4px 8px", borderRadius: 4,
    border: `1px solid ${disabled ? "rgba(255, 255, 255, 0.04)" : "#c8b898"}`,
    background: disabled ? "rgba(15, 15, 15, 0.5)" : "rgba(200, 184, 152, 0.1)",
    color: disabled ? "#7a7668" : "#c8b898",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 10, fontWeight: 600,
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 8px", borderRadius: 4,
    border: `1px solid ${disabled ? "rgba(255, 255, 255, 0.04)" : "rgba(200, 184, 152, 0.1)"}`,
    background: disabled ? "rgba(15, 15, 15, 0.5)" : "rgba(12, 12, 12, 0.4)",
    color: disabled ? "#7a7668" : "#c4c0b4",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 10,
  };
}
