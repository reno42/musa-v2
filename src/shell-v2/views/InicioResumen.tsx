/**
 * InicioResumen.tsx — Vista inicio/resumen del shell v2 con datos REALES.
 *
 * Consume exclusivamente src/lib/apiV2/inicio.ts (loadInicio →
 * GET /api/workspaces + GET /api/templates + GET /api/metrics/activity).
 * PROHIBIDO mock data: sin apiV2 no hay vista. Estados carga/error/vacío
 * diseñados (DoD F1). Los números usan tabular-nums como el prototipo.
 */
import { loadInicio, type InicioData } from "../../lib/apiV2/inicio";
import { DsCard, DsCardTitle, DataState, ViewHeader } from "../../components/v2/ds";
import { useApiData } from "../useApiData";
import { ActivityBars } from "./ActivityBars";
import type { V2ViewProps } from "../router";

const nf = new Intl.NumberFormat("es-PE");
const df = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" });

function titleOf(t: { title?: string; name?: string }): string {
  return t.title || t.name || "Sin título";
}

export function InicioResumen({ meta, onOpenTemplate }: V2ViewProps) {
  const { data, error, reload } = useApiData<InicioData>(() => loadInicio(), []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} onAction={() => { window.location.hash = "crear/disenos"; }} />

      {error && !data ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : null}

      {!error && !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : null}

      {/* F5: si un reload falla con datos previos, el error no debe quedar silencioso */}
      {error && data ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <>
          {/* Totales de los últimos 30 días (métricas reales) */}
          <DsCard span={4}>
            <DsCardTitle hint="30 días">Diseño ops</DsCardTitle>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
                {nf.format(data.activity.totals.designOps)}
              </b>
              <span style={{ color: "var(--ds-muted)" }}>operaciones</span>
            </div>
          </DsCard>
          <DsCard span={4}>
            <DsCardTitle hint="30 días">Frames creados</DsCardTitle>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
                {nf.format(data.activity.totals.framesCreated)}
              </b>
              <span style={{ color: "var(--ds-muted)" }}>frames</span>
            </div>
          </DsCard>
          <DsCard span={4}>
            <DsCardTitle hint="30 días">Plantillas</DsCardTitle>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
                {nf.format(data.activity.totals.templatesCreated)}
              </b>
              <span style={{ color: "var(--ds-muted)" }}>creadas</span>
            </div>
          </DsCard>

          {/* Actividad por día */}
          <DsCard span={8}>
            <DsCardTitle hint={`${data.activity.from} → ${data.activity.to}`}>Actividad por día</DsCardTitle>
            {data.activity.days.some(d => d.designOps + d.framesCreated + d.templatesCreated > 0) ? (
              <ActivityBars data={data.activity} />
            ) : (
              <DataState state="empty" message="Sin actividad registrada en el rango." />
            )}
            <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: "var(--ds-muted)" }}>
              <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--ds-accent)", marginRight: 6 }} />Hoy</span>
              <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--ds-l2)", marginRight: 6 }} />Días anteriores</span>
            </div>
          </DsCard>

          {/* Espacios de la cuenta */}
          <DsCard span={4}>
            <DsCardTitle hint={`${data.workspaces.length}`}>Tus espacios</DsCardTitle>
            {data.workspaces.length === 0 ? (
              <DataState state="empty" message="Aún no tienes espacios." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {data.workspaces.map(w => (
                  <div key={w.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: "1px solid var(--ds-border)", fontSize: 12 }}>
                    <span style={{ color: "var(--ds-muted)" }}>{typeof w.name === "string" ? w.name : w.id}</span>
                    <b style={{ color: "var(--ds-bright)", fontWeight: 500 }}>{typeof w.role === "string" ? w.role : ""}</b>
                  </div>
                ))}
              </div>
            )}
          </DsCard>

          {/* Diseños recientes */}
          <DsCard span={12}>
            <DsCardTitle hint={`${data.recentTemplates.length} recientes`}>Diseños recientes</DsCardTitle>
            {data.recentTemplates.length === 0 ? (
              <DataState state="empty" message="Todavía no hay diseños en este espacio." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {data.recentTemplates.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpenTemplate(t.id)}
                    title="Abrir en el editor"
                    style={{
                      textAlign: "left",
                      padding: 14,
                      borderRadius: "var(--ds-radius-sm)",
                      background: "var(--ds-card-2)",
                      border: "1px solid var(--ds-border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      transition: "border-color .15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--ds-accent)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--ds-border)"; }}
                  >
                    <b style={{ color: "var(--ds-bright)", fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {titleOf(t)}
                    </b>
                    <small style={{ color: "var(--ds-muted)", fontSize: 11 }}>
                      Editado {t.updatedAt ? df.format(new Date(t.updatedAt)) : "—"}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}
