// packages/editor/src/components/PresencePanel.tsx
// Mini panel showing connected users with avatars and online indicators.

import type { UserPresence } from "@futuraria/shared";

interface Props {
  users: UserPresence[];
  currentUserId: string;
  isOnline: boolean;
}

/** Get initials from a user name (max 2 chars). */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function PresencePanel({ users, currentUserId, isOnline }: Props) {
  // Sort: current user first, then alphabetically
  const sorted = [...users].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.userName.localeCompare(b.userName);
  });

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        display: "flex",
        alignItems: "center",
        gap: 0,
        zIndex: 100,
        background: "#1e1e2e",
        borderRadius: 8,
        padding: "4px 8px 4px 4px",
        border: "1px solid #333",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      {/* Online status dot */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: isOnline ? "#22c55e" : "#ef4444",
          marginRight: 8,
          flexShrink: 0,
          boxShadow: isOnline ? "0 0 6px #22c55e" : "none",
        }}
        title={isOnline ? "Connected" : "Offline"}
      />

      {/* User avatars */}
      <div style={{ display: "flex", alignItems: "center" }}>
        {sorted.map((user, i) => {
          const isSelf = user.userId === currentUserId;
          return (
            <div
              key={user.userId}
              title={`${user.userName}${isSelf ? " (you)" : ""}`}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: user.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "Inter, system-ui, sans-serif",
                color: "#fff",
                border: isSelf ? "2px solid #fff" : "2px solid #1e1e2e",
                marginLeft: i > 0 ? -6 : 0,
                position: "relative",
                zIndex: sorted.length - i,
                cursor: "default",
                transition: "transform 0.15s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.transform = "scale(1.15)";
                (e.currentTarget as HTMLDivElement).style.zIndex = "99";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
                (e.currentTarget as HTMLDivElement).style.zIndex = String(sorted.length - i);
              }}
            >
              {getInitials(user.userName)}
            </div>
          );
        })}
      </div>

      {/* User count */}
      {sorted.length > 1 && (
        <span
          style={{
            color: "#888",
            fontSize: 11,
            fontFamily: "Inter, system-ui, sans-serif",
            marginLeft: 6,
            whiteSpace: "nowrap",
          }}
        >
          {sorted.length} online
        </span>
      )}
    </div>
  );
}
