import { useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface Props {
  templateId: string;
  onRestore: () => void;
}

interface Version {
  version: number;
  createdAt: string;
  snapshot?: any;
}

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)", padding: 12,
  color: "#e0e0e0", fontSize: 12, overflow: "auto",
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
  padding: "6px 10px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", width: "100%", textAlign: "left" as const,
};

export function VersionHistoryPanel({ templateId, onRestore }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "list_versions",
          params: { templateId }, id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      if (text) {
        const data = typeof text === "string" ? JSON.parse(text) : text;
        setVersions(data.versions || []);
        setLoaded(true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [templateId]);

  const restore = useCallback(async (version: number) => {
    setRestoring(version);
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "restore_version",
          params: { templateId, version }, id: 0,
        }),
      });
      onRestore();
    } catch { /* ignore */ }
    setRestoring(null);
  }, [templateId, onRestore]);

  if (!loaded) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Version History</div>
        <button type="button" onClick={loadVersions} disabled={loading} style={btnStyle}>
          {loading ? "Loading..." : "Load History"}
        </button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        Versions ({versions.length})
      </div>
      {versions.length === 0 && (
        <div style={{ color: "#666", fontSize: 11 }}>No saved versions yet</div>
      )}
      {versions.map((v, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 6px", marginBottom: 2, borderRadius: 4,
          background: "rgba(255,255,255,0.03)",
        }}>
          <div>
            <span style={{ fontWeight: 600, color: "#60a5fa" }}>v{v.version}</span>
            <span style={{ color: "#666", fontSize: 10, marginLeft: 6 }}>
              {v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}
            </span>
          </div>
          <button
            onClick={() => restore(v.version)}
            disabled={restoring !== null}
            style={{
              ...btnStyle, width: "auto", padding: "3px 8px", fontSize: 10,
              opacity: restoring === v.version ? 0.5 : 1,
            }}
          >
            {restoring === v.version ? "..." : "Restore"}
          </button>
        </div>
      ))}
    </div>
  );
}
