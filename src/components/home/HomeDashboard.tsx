/** Inicio — Dashboard Ejecutivo (REQ Dashboard Ejecutivo de Musa).
 *  Fase 2: shell del tab (ruta #workspace, default). Los widgets (fase 3)
 *  leen exclusivamente de los tools MCP de lectura: get_dashboard_summary,
 *  list_pending_actions, get_recent_activity y list_crm_deas — cada métrica
 *  trae su desglose por marca inline (sin segundas llamadas).
 *
 *  Diseño (ajuste de Ren): el botón a Diseño es visible en 1 click desde
 *  Inicio — Victor (y el equipo) viven dentro del editor, no del dashboard. */
import { useMemo } from "react";

export function HomeDashboard(props: { onOpenDesign: () => void }) {
  const { onOpenDesign } = props;

  // Saludo por franja horaria — trivial, real, sin datos falsos.
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return "Buenas noches";
    if (h < 13) return "Buenos días";
    if (h < 20) return "Buenas tardes";
    return "Buenas noches";
  }, []);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14,
      padding: "20px 20px 0", overflowY: "auto",
    }}>
      <div className="crm-table-card crm-contacts-top" style={{ flexShrink: 0 }}>
        <header className="crm-contacts-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400,
              color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em", marginBottom: 2,
            }}>
              {greeting}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
              Dashboard ejecutivo — piezas publicadas, pipeline, kanban y acciones pendientes.
            </div>
          </div>
          <button
            type="button"
            className="liquid-glass"
            onClick={onOpenDesign}
            title="Ir a Diseño"
            style={{
              borderRadius: 100, padding: "8px 16px", fontSize: 13, fontWeight: 500,
              cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", gap: 6,
              color: "#fff",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
            Abrir Diseño
          </button>
        </header>
      </div>

      {/* Widgets del dashboard (fase 3): cada tarjeta llama a su tool MCP y
          muestra su propio error si falla — nunca un bloqueo de todo el tab. */}
      <div id="home-widgets" style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 14, alignItems: "start", paddingBottom: 20,
      }} />
    </div>
  );
}
