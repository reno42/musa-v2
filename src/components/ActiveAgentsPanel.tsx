import React from "react";

interface Agent {
  agentId: string;
  sectionId: string;
  onlineAt: string;
}

interface Props {
  agents: Agent[];
}

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)", padding: 12,
  color: "#e0e0e0", fontSize: 12, overflow: "auto",
};

export function ActiveAgentsPanel({ agents }: Props) {
  if (agents.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Active Agents</div>
        <div style={{ color: "#666", fontSize: 11 }}>No agents connected</div>
      </div>
    );
  }
  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        Active Agents ({agents.length})
      </div>
      {agents.map((a, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 500 }}>{a.agentId}</div>
            <div style={{ fontSize: 10, color: "#888" }}>
              {a.sectionId} · {new Date(a.onlineAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
