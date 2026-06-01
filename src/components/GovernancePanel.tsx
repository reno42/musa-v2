import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface SnapshotMeta {
  id: string;
  type: "ia" | "human" | "system";
  trigger: string;
  timestamp: string;
  objectCount: number;
  frameCount: number;
}

interface DiffResult {
  layerName?: string;
  action: "added" | "deleted" | "modified";
  old?: any;
  new?: any;
  changes?: { path: string; old: any; new: any }[];
}

interface GovernancePanelProps {
  templateId: string | null;
  onClose: () => void;
  onRestore?: (snapId: string) => void;
}

const TYPE_ICON: Record<string, string> = {
  ia: "\u{1F916}",     // 🤖
  human: "\u{1F464}",  // 👤
  system: "\u2699\uFE0F",  // ⚙️
};

const TYPE_LABEL: Record<string, string> = {
  ia: "IA",
  human: "Human",
  system: "System",
};

/** JSON-RPC helper: POST to /mcp, parse response */
async function mcpCall(method: string, params: Record<string, any>) {
  const res = await apiFetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}

export function GovernancePanel({ templateId, onClose, onRestore }: GovernancePanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnapId, setSelectedSnapId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<DiffResult[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const loadSnapshots = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await mcpCall("list_snapshots", { templateId });
      setSnapshots(result?.snapshots || []);
    } catch {
      setError("Failed to load snapshots. Ensure the MCP server is running.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleDiff = async (snapId: string) => {
    setSelectedSnapId(snapId);
    setDiffLoading(true);
    try {
      const result = await mcpCall("diff_template", { templateId });
      const changes = result?.changes ?? [];
      setDiffs(changes);
    } catch {
      setDiffs(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleRestore = async (snapId: string) => {
    if (!templateId) return;
    // Find the snapshot data and restore via update_template
    try {
      const result = await mcpCall("diff_snapshots", { templateId, snapIdA: snapId });
      // To actually restore, we'd need to get the snapshot data and call update_template
      // For now, emit the callback for external handling
      onRestore?.(snapId);
    } catch {
      // non-blocking
    }
  };

  const handleExportJson = (snap: SnapshotMeta) => {
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshot_${snap.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{
      position: "fixed", top: 48, right: 0, bottom: 0, width: 340,
      background: "#0e0e14", borderLeft: "1px solid #1c1c26",
      display: "flex", flexDirection: "column", zIndex: 50,
      fontFamily: "Inter, sans-serif", fontSize: 12, color: "#c4c4d4",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid #1c1c26",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>🕐 Governance Timeline</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#7a7a90", cursor: "pointer", fontSize: 16,
        }}>✕</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading && (
          <div style={{ padding: 20, textAlign: "center", color: "#7a7a90" }}>Loading...</div>
        )}
        {error && (
          <div style={{ padding: 20, textAlign: "center", color: "#e44" }}>{error}</div>
        )}
        {!loading && !error && snapshots.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#7a7a90" }}>
            No snapshots yet. Edits will auto-trigger snapshots.
          </div>
        )}

        {snapshots.map((snap, i) => (
          <div key={snap.id} style={{
            padding: "6px 12px", cursor: "pointer",
            background: selectedSnapId === snap.id ? "#1a1a2e" : "transparent",
            borderBottom: "1px solid #111118",
          }}
            onClick={() => handleDiff(snap.id)}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>{TYPE_ICON[snap.type] || "•"}</span>
              <span style={{ fontWeight: 600, fontSize: 11, color: "#7a7a90" }}>
                {formatTime(snap.timestamp)}
              </span>
              <span style={{
                fontSize: 10, padding: "1px 4px", borderRadius: 3,
                background: snap.type === "ia" ? "#1a2a1a" : snap.type === "human" ? "#2a1a1a" : "#1a1a2a",
                color: snap.type === "ia" ? "#4ade80" : snap.type === "human" ? "#f87171" : "#60a5fa",
              }}>
                {TYPE_LABEL[snap.type]}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#5a5a70", marginTop: 2 }}>
              {snap.trigger} • {snap.objectCount} objects • {snap.frameCount} frames
            </div>
            {selectedSnapId === snap.id && (
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button onClick={(e) => { e.stopPropagation(); handleRestore(snap.id); }}
                  style={actionBtn("#4ade80")}>Restore</button>
                <button onClick={(e) => { e.stopPropagation(); handleExportJson(snap); }}
                  style={actionBtn("#60a5fa")}>Export JSON</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Diff panel */}
      {diffs && diffs.length > 0 && (
        <div style={{
          borderTop: "1px solid #1c1c26", maxHeight: 200, overflowY: "auto", padding: "8px 12px",
        }}>
          <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>
            Changes ({diffs.length})
          </div>
          {diffs.slice(0, 10).map((d, i) => (
            <div key={i} style={{
              fontSize: 10, padding: "2px 0", borderBottom: "1px solid #111118",
              display: "flex", gap: 4, alignItems: "center",
            }}>
              <span style={{
                color: d.action === "added" ? "#4ade80" : d.action === "deleted" ? "#f87171" : "#fbbf24",
                fontWeight: 600, minWidth: 50,
              }}>
                {d.action.toUpperCase()}
              </span>
              <span style={{ color: "#7a7a90" }}>{d.layerName || "?"}</span>
            </div>
          ))}
          {diffs.length > 10 && (
            <div style={{ fontSize: 10, color: "#5a5a70", padding: "4px 0" }}>
              +{diffs.length - 10} more changes
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function actionBtn(color: string): React.CSSProperties {
  return {
    background: "#111118", border: `1px solid ${color}`, color,
    borderRadius: 3, padding: "2px 6px", fontSize: 10, cursor: "pointer",
  };
}
