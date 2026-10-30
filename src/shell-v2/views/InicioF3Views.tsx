/**
 * InicioF3Views.tsx — vistas de INICIO sumadas en F3 con datos reales.
 * inicio/mi-trabajo ← apiV2/inicio.ts fetchMiTrabajo (deals con next_step
 * reutilizando buildLoops de vender.ts + templates recientes).
 * inicio/cerebro ← apiV2/inicio.ts fetchCerebro (notas archivo de brainNotes).
 */
import { fetchCerebro, fetchMiTrabajo, type CerebroNota, type MiTrabajoData, type TemplateSummary } from "../../lib/apiV2";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, str } from "./helpers";
import { STAGE_LABEL } from "./VenderViews";
import type { V2ViewProps } from "../router";

/** Fila compacta de diseño reciente con apertura al editor (patrón del resumen). */
function TemplateRow({ t, onOpenTemplate }: { t: TemplateSummary; onOpenTemplate: V2ViewProps["onOpenTemplate"] }) {
  return (
    <button
      type="button"
      onClick={() => onOpenTemplate(t.id)}
      title="Abrir en el editor"
      style={{
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        borderTop: "1px solid var(--ds-border)",
        padding: "9px 0",
        fontSize: 12,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        cursor: "pointer",
      }}
    >
      <span style={{ color: "var(--ds-bright)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {str(pickTitle(t), "Sin título")}
      </span>
      <span style={{ color: "var(--ds-muted)", flexShrink: 0 }}>{fmtDate(pickUpdated(t))}</span>
    </button>
  );
}

function pickTitle(t: TemplateSummary): string | undefined {
  const v = t.title ?? t.name;
  return typeof v === "string" ? v : undefined;
}

function pickUpdated(t: TemplateSummary): string | undefined {
  const v = t.updatedAt ?? t.createdAt;
  return typeof v === "string" ? v : undefined;
}

/** Cuerpo de la nota listo para mostrar: sin marcadores de zona <!-- -->. */
function cleanNoteBody(md: string | null): string {
  return (md ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** inicio/cerebro — notas "archivo" del segundo cerebro por pieza reciente. */
export function CerebroView({ meta, workspaceId, onOpenTemplate }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, ws => fetchCerebro(ws, 6)), [workspaceId]);
  const notas: CerebroNota[] = data?.notas ?? [];
  const fallos = data?.fallos ?? 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {error ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : null}

      {/* F4: sin notas Y con fallos de lectura es un ERROR, no un vacío. */}
      {data && notas.length === 0 && fallos > 0 ? (
        <DsCard span={12}>
          <DsCardTitle hint="brainNotes">Cerebro</DsCardTitle>
          <DataState
            state="error"
            message={`La lectura de notas falló para las ${fallos} piezas recientes del espacio.`}
            onRetry={reload}
          />
        </DsCard>
      ) : null}

      {data && notas.length === 0 && fallos === 0 ? (
        <DsCard span={12}>
          <DsCardTitle hint="brainNotes">Cerebro</DsCardTitle>
          <DataState state="empty" message="Sin notas todavía: el cerebro llena la nota de una pieza la primera vez que se consulta (últimas 6 piezas del espacio)." />
        </DsCard>
      ) : null}

      {data && notas.length > 0 ? (
        <>
          {fallos > 0 ? (
            <DsCard span={12}>
              <DataState
                state="error"
                message={`Se muestran ${notas.length} notas; la lectura falló para ${fallos} pieza${fallos === 1 ? "" : "s"}.`}
                onRetry={reload}
              />
            </DsCard>
          ) : null}
          {notas.map(n => {
            const cuerpo = cleanNoteBody(n.contenido);
            return (
              <DsCard key={n.slug || n.templateId} span={4}>
                <button
                  type="button"
                  onClick={() => onOpenTemplate(n.templateId)}
                  title="Abrir la pieza en el editor"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <b style={{ color: "var(--ds-bright)", fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                    {n.titulo}
                  </b>
                </button>
                <div style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--ds-muted)",
                  maxHeight: 260,
                  overflowY: "auto",
                }}>
                  {cuerpo || "—"}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10, fontSize: 11, color: "var(--ds-muted)" }}>
                  <span>{n.enlaces.length > 0 ? `⌲ ${n.enlaces.length} enlace${n.enlaces.length === 1 ? "" : "s"}` : "sin enlaces"}</span>
                  <span>{fmtDate(n.actualizadoAt ?? undefined)}</span>
                </div>
              </DsCard>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/** inicio/mi-trabajo — seguimientos CRM con next_step + diseños recientes. */
export function MiTrabajoView({ meta, workspaceId, onOpenTemplate }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchMiTrabajo), [workspaceId]);
  const followUps: MiTrabajoData["followUps"] = data ? data.followUps : [];
  const recientes = data ? data.recentTemplates : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {error ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : null}

      {data ? (
        <>
          <DsCard span={7}>
            <DsCardTitle hint={`${followUps.length} con próximo paso`}>Seguimientos (CRM)</DsCardTitle>
            {followUps.length === 0 ? (
              <DataState state="empty" message="Sin seguimientos: los deals con next_step_date o nota aparecen aquí ordenados por vencimiento." />
            ) : (
              <DsTable
                rows={followUps}
                rowKey={(r) => r.dealId}
                cols={[
                  { label: "Oportunidad", cell: r => str(r.title) },
                  { label: "Etapa", cell: r => str(r.stage ? STAGE_LABEL[r.stage] ?? r.stage : null) },
                  { label: "Próximo paso", cell: r => str(r.nextStepNote) },
                  {
                    label: "Vence",
                    cell: r => (
                      <span style={{ color: r.vencido ? "var(--ds-rojo)" : "var(--ds-verde)" }}>
                        {r.nextStepDate ? `${fmtDate(r.nextStepDate)}${r.vencido ? " · vencido" : ""}` : "—"}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </DsCard>
          <DsCard span={5}>
            <DsCardTitle hint={`${recientes.length} recientes`}>Diseños recientes</DsCardTitle>
            {recientes.length === 0 ? (
              <DataState state="empty" message="Todavía no hay diseños en este espacio." />
            ) : (
              <div>
                {recientes.map(t => (
                  <TemplateRow key={t.id} t={t} onOpenTemplate={onOpenTemplate} />
                ))}
              </div>
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}
