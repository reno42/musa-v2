import React, { useState, useCallback } from "react";
import type { TemplateVersion } from "@futuraria/shared";

interface VersionHistoryPanelProps {
  versions: TemplateVersion[];
  currentVersionId: string | null;
  isLoading: boolean;
  onRestore: (versionId: string) => void;
  onSaveNamed: (message: string) => void;
  onClose: () => void;
}

export function VersionHistoryPanel({
  versions,
  currentVersionId,
  isLoading,
  onRestore,
  onSaveNamed,
  onClose,
}: VersionHistoryPanelProps) {
  const [saveMessage, setSaveMessage] = useState("");
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    onSaveNamed(saveMessage || `Manual save — ${new Date().toLocaleString()}`);
    setSaveMessage("");
  }, [saveMessage, onSaveNamed]);

  const handleRestore = useCallback(
    (versionId: string) => {
      if (confirmRestoreId === versionId) {
        onRestore(versionId);
        setConfirmRestoreId(null);
      } else {
        setConfirmRestoreId(versionId);
        // Auto-dismiss confirm after 3s
        setTimeout(() => setConfirmRestoreId((prev) => (prev === versionId ? null : prev)), 3000);
      }
    },
    [confirmRestoreId, onRestore],
  );

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      style={{
        width: 300,
        height: "100%",
        background: "#0f0f14",
        borderLeft: "1px solid #1e1e2e",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, sans-serif",
        color: "#e2e8f0",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e1e2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          🕐 Version History
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 16,
            padding: "2px 6px",
          }}
        >
          ×
        </button>
      </div>

      {/* Manual save */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #1e1e2e",
        }}
      >
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, fontWeight: 500 }}>
          Save version (⌘S)
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={saveMessage}
            onChange={(e) => setSaveMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="Version message..."
            style={{
              flex: 1,
              background: "#16161e",
              border: "1px solid #2d2d44",
              borderRadius: 6,
              padding: "6px 10px",
              color: "#e2e8f0",
              fontSize: 12,
              fontFamily: "Inter, sans-serif",
              outline: "none",
            }}
          />
          <button
            onClick={handleSave}
            style={{
              background: "#6366f1",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Version list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {isLoading && (
          <div style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: 13 }}>
            Loading versions...
          </div>
        )}

        {!isLoading && versions.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: 13 }}>
            No versions yet. Press ⌘S to save the first version.
          </div>
        )}

        {versions.map((version) => (
          <div
            key={version.id}
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid #1a1a2e",
              background:
                version.id === currentVersionId ? "#1a1a2e" : "transparent",
            }}
          >
            {/* Version header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#818cf8",
                  background: "#1e1b4b",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                v{version.versionNumber}
              </span>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>
                {formatTime(version.createdAt)}
              </span>
            </div>

            {/* Message */}
            {version.message && (
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 12,
                  color: "#cbd5e1",
                  lineHeight: 1.3,
                }}
              >
                {version.message}
              </p>
            )}

            {/* Author */}
            {version.author && (
              <span style={{ fontSize: 11, color: "#64748b" }}>
                by {version.author}
              </span>
            )}

            {/* Restore button */}
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => handleRestore(version.id)}
                style={{
                  background:
                    confirmRestoreId === version.id ? "#ef4444" : "transparent",
                  border: `1px solid ${
                    confirmRestoreId === version.id ? "#ef4444" : "#2d2d44"
                  }`,
                  borderRadius: 4,
                  color: confirmRestoreId === version.id ? "#fff" : "#818cf8",
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {confirmRestoreId === version.id
                  ? "⚠ Confirm Restore"
                  : "↩ Restore"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer info */}
      <div
        style={{
          padding: "8px 16px",
          borderTop: "1px solid #1e1e2e",
          fontSize: 11,
          color: "#475569",
          textAlign: "center",
        }}
      >
        {versions.length}/50 versions · Auto-saved on changes
      </div>
    </div>
  );
}
