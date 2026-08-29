import type { CSSProperties, ReactNode } from "react";

// Fase 1 (topbar legibility): shared shell for the editor topbar dropdowns
// (IA, Vista, Batchamator, Compartir, Exportar, ⋯ paneles) — same glass
// panel the Batchamator menu used, plus the click-away overlay.
// align="right" for triggers anchored near the screen edge so the panel
// never spills off-screen.
export const batchMenuItemStyle: CSSProperties = {
  textAlign: "left", background: "transparent", border: "none", borderRadius: 6,
  padding: "8px 10px", cursor: "pointer", color: "#f0ebe0", fontFamily: "inherit",
};

export function TopbarMenu({ open, onClose, align = "left", width = 250, children }: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  width?: number;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
      <div
        style={{
          position: "absolute", top: "calc(100% + 6px)", zIndex: 1000,
          ...(align === "right" ? { right: 0 } : { left: 0 }),
          background: "var(--glass-bg)", backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid var(--glass-border)", borderRadius: 10,
          padding: 6, width, display: "flex", flexDirection: "column", gap: 2,
        }}
      >
        {children}
      </div>
    </>
  );
}

// One named entry inside a topbar dropdown: title + one-line description —
// the legibility rule from the topbar audit: every action reads by name,
// never by glyph alone (nothing emoji-only, nothing under 11px).
export function TopbarMenuItem({ icon, title, desc, active = false, disabled = false, onClick, trailing = null }: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={desc ? `${title} — ${desc}` : title}
      style={{
        ...batchMenuItemStyle,
        display: "flex", alignItems: "center", gap: 8,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
      }}
      onMouseOver={e => { if (!disabled) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
      onMouseOut={e => { e.currentTarget.style.background = active ? "rgba(255,255,255,0.06)" : "transparent"; }}
    >
      {icon != null && (
        <span style={{ width: 18, display: "inline-flex", justifyContent: "center", alignItems: "center", fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 12.5 }}>{title}</span>
        {desc && <span style={{ display: "block", fontSize: 11, color: "#9a9484", marginTop: 1 }}>{desc}</span>}
      </span>
      {trailing}
    </button>
  );
}
