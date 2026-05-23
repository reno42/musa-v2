import type { SaveStatus } from "../hooks/useAutoSave";

const labels: Record<SaveStatus, { text: string; color: string }> = {
  idle: { text: "", color: "transparent" },
  saving: { text: "Saving…", color: "#f59e0b" },
  saved: { text: "Saved ✓", color: "#22c55e" },
  error: { text: "Error saving", color: "#ef4444" },
};

export function AutoSaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const { text, color } = labels[status];
  return (
    <span
      style={{
        fontSize: 12,
        color,
        fontWeight: 500,
        marginLeft: 8,
        transition: "opacity 0.3s",
      }}
    >
      {text}
    </span>
  );
}
