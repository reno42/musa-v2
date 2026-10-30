/**
 * ds.tsx — Primitivas visuales del shell v2 (carril IDE agent, REQ-070).
 *
 * Solo usan tokens de src/styles/tokens.css (PROHIBIDO color/font fuera de
 * tokens.css). Espejan los patrones del prototipo test.futuraria.com:
 * h1 serif display, píldoras 50px, cards hueso.
 */
import type { CSSProperties, ReactNode } from "react";
import type { V2IconEl, V2RouteMeta } from "../../shell-v2/navConfig";

/** Icono de módulo: elementos SVG congelados del prototipo, stroke currentColor. */
export function DsIcon({ icon, size = 16 }: { icon: V2IconEl[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {icon.map((el, i) =>
        el.tag === "path" ? (
          <path key={i} d={el.d} />
        ) : el.tag === "rect" ? (
          <rect key={i} x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx} />
        ) : (
          <circle key={i} cx={el.cx} cy={el.cy} r={el.r} />
        ),
      )}
    </svg>
  );
}

/** Píldora del prototipo (radio 50px, hueso sobre oscuro / tinta sobre claro). */
export function DsPill({
  children,
  onClick,
  tone = "bone",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "bone" | "accent" | "ghost";
  title?: string;
}) {
  const style: CSSProperties =
    tone === "accent"
      ? { background: "var(--ds-accent)", color: "var(--ds-on-accent)" }
      : tone === "ghost"
        ? { background: "transparent", color: "var(--ds-muted)", boxShadow: "inset 0 0 0 1px var(--ds-border-2)" }
        : { background: "var(--ds-pill-bg)", color: "var(--ds-pill-fg)" };
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      title={title}
      onClick={onClick}
      style={{
        ...style,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 14px",
        borderRadius: "var(--ds-radius-pill)",
        border: 0,
        font: `400 14px/1 var(--ds-font-display)`,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {children}
    </Comp>
  );
}

/** Card del prototipo (fondo panel, borde, radio 8-12px). */
export function DsCard({
  children,
  span,
  alt,
}: {
  children: ReactNode;
  /** Columnas del grid de 12 que ocupa la card (3|4|6|8|12). */
  span?: 3 | 4 | 5 | 6 | 8 | 12;
  alt?: boolean;
}) {
  return (
    <section
      style={{
        gridColumn: `span ${span ?? 12}`,
        background: alt ? "var(--ds-card-2)" : "var(--ds-card-bg)",
        border: `1px solid var(--ds-card-line)`,
        borderRadius: "var(--ds-radius-card)",
        padding: 20,
        minWidth: 0,
      }}
    >
      {children}
    </section>
  );
}

/** Título de card: serif display del prototipo (.ch h3). */
export function DsCardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
      <h3 style={{ font: `400 24px/1 var(--ds-font-display)`, color: "var(--ds-bright)", textTransform: "uppercase", letterSpacing: "0.5px", margin: 0 }}>
        {children}
      </h3>
      {hint ? <small style={{ color: "var(--ds-muted)", fontSize: 11 }}>{hint}</small> : null}
    </div>
  );
}

/**
 * Header de vista del prototipo (.head): h1 serif display grande con una
 * palabra en acento, descripción del módulo y acción primaria en píldora.
 */
export function ViewHeader({ meta, onAction }: { meta: V2RouteMeta; onAction?: () => void }) {
  const words = meta.label.split(" ");
  const last = words.length > 1 ? words.pop()! : "";
  return (
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, margin: "26px 0 18px", flexWrap: "wrap" }}>
      <div>
        <h1 style={{ font: `400 44px/0.95 var(--ds-font-display)`, color: "var(--ds-bright)", textTransform: "uppercase", letterSpacing: "0.5px", margin: 0 }}>
          {words.join(" ")}{" "}
          {last ? <em style={{ color: "var(--ds-accent)", fontStyle: "normal" }}>{last}</em> : null}
        </h1>
        <p style={{ color: "var(--ds-muted)", margin: "8px 0 0", maxWidth: 560, fontFamily: "var(--ds-font-sans)", fontSize: 13 }}>
          {meta.module.description}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <DsPill tone="accent" onClick={onAction}>{meta.module.action}</DsPill>
      </div>
    </header>
  );
}

/** Chip pequeño de ruta (id navegable #mod/sub). */
export function RouteChip({ routeId }: { routeId: string }) {
  return (
    <code
      style={{
        font: `500 11px/1 ui-monospace, Consolas, monospace`,
        color: "var(--ds-accent)",
        background: "var(--ds-panel-2)",
        padding: "4px 9px",
        borderRadius: "var(--ds-radius-pill)",
      }}
    >
      #{routeId}
    </code>
  );
}

/**
 * Placeholder F0 de una vista sin contenido aún (REQ-069: "la estructura de
 * navegación debe estar COMPLETA aunque algunas muestren 'en construcción'").
 * Estado honesto: la vista existe y es navegable; sus datos reales llegan
 * cuando su módulo exista en src/lib/apiV2 (ver shell-v2/NEEDS.md).
 */
export function UnderConstruction({ meta }: { meta: V2RouteMeta }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />
      <DsCard span={12}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "48px 24px", textAlign: "center" }}>
          <span
            aria-hidden="true"
            style={{
              font: `400 15px/1 var(--ds-font-display)`,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              padding: "5px 14px",
              borderRadius: "6px",
              transform: "rotate(-2deg)",
              clipPath: "polygon(0 5%, 100% 0, 95% 100%, 5% 95%)",
              background: "var(--ds-lima)",
              color: "var(--ds-negro)",
            }}
          >
            En construcción
          </span>
          <h3 style={{ font: `400 22px/1.1 var(--ds-font-display)`, color: "var(--ds-bright)", textTransform: "uppercase", letterSpacing: "0.5px", margin: 0 }}>
            {meta.module.label} · {meta.label}
          </h3>
          <p style={{ color: "var(--ds-muted)", fontSize: 12.5, maxWidth: 460, margin: 0, fontFamily: "var(--ds-font-sans)", lineHeight: 1.5 }}>
            Vista registrada en el router desde F0 y navegable. Se conecta a datos
            reales vía <code style={{ color: "var(--ds-accent)" }}>src/lib/apiV2</code> cuando
            su módulo de datos esté disponible (fase F1).
          </p>
          <RouteChip routeId={meta.id} />
        </div>
      </DsCard>
    </div>
  );
}

/** Estados de datos: carga, error con reintento, vacío (DoD F1). */
export function DataState({
  state,
  message,
  onRetry,
}: {
  state: "loading" | "error" | "empty";
  message?: string;
  onRetry?: () => void;
}) {
  if (state === "loading") {
    return (
      <div style={{ display: "flex", gap: 10, padding: "32px 0" }} role="status" aria-busy="true">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              flex: 1, height: 12, borderRadius: "var(--ds-radius-pill)",
              background: "var(--ds-panel-2)",
              animation: "dsPulse 1.4s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
        <style>{"@keyframes dsPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }"}</style>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div
        role="alert"
        style={{
          display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10,
          padding: 16, borderRadius: "var(--ds-radius-sm)",
          background: "var(--ds-accent-dim)", color: "var(--ds-text)", fontSize: 12.5,
          fontFamily: "var(--ds-font-sans)",
        }}
      >
        <strong style={{ color: "var(--ds-accent)" }}>No pudimos cargar los datos</strong>
        <span>{message ?? "La API no respondió. Tu información no se perdió."}</span>
        {onRetry ? (
          <DsPill tone="bone" onClick={onRetry}>Reintentar</DsPill>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ padding: "32px 0", color: "var(--ds-muted)", fontSize: 12.5, fontFamily: "var(--ds-font-sans)", textAlign: "center" }}>
      {message ?? "Nada por aquí todavía."}
    </div>
  );
}
