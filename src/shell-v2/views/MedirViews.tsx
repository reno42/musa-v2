/**
 * MedirViews.tsx — vistas MEDIR con datos reales (apiV2/medir.ts:
 * GET /api/metrics/activity + GET /api/storage/usage + crm_deals).
 * medir/reportes ← loadMedir. medir/embudos ← buildFunnelTrends (F3).
 * medir/loops ← loadLoops (reusa buildLoops de vender.ts).
 * medir/ads ← fetchAdsRows (campaigns + deals por campaign_id, F3 oleada 2).
 */
import { buildFunnelTrends, fetchAdsRows, loadLoops, loadMedir } from "../../lib/apiV2";
import type { AdsRow } from "../../lib/apiV2/medir";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, fmtMoney, humanBytes, str } from "./helpers";
import { STAGE_LABEL } from "./VenderViews";
import { ActivityBars } from "./ActivityBars";
import type { V2ViewProps } from "../router";

const nf = new Intl.NumberFormat("es-PE");

function Stat({ value, suffix }: { value: string; suffix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </b>
      {suffix ? <span style={{ color: "var(--ds-muted)" }}>{suffix}</span> : null}
    </div>
  );
}

/** medir/embudos — pipeline CRM por etapa + actividad del periodo (30 días). */
export function MedirEmbudos({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, ws => buildFunnelTrends(ws, 30)), [workspaceId]);
  const funnel = data ? data.funnel : [];
  const totalDeals = funnel.reduce((acc, f) => acc + f.cantidad, 0);
  const maxValor = Math.max(...funnel.map(f => f.valorUsd), 1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <>
          <DsCard span={4}>
            <DsCardTitle hint="30 días">Resumen</DsCardTitle>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
                {nf.format(data.totales.deals)}
              </b>
              <span style={{ color: "var(--ds-muted)" }}>deals en CRM</span>
            </div>
            <small style={{ display: "block", marginTop: 10, color: "var(--ds-muted)", fontSize: 11 }}>
              {nf.format(data.totales.designOps)} diseño ops · {nf.format(data.totales.framesCreated)} frames ·{" "}
              {nf.format(data.totales.templatesCreated)} plantillas creadas
            </small>
          </DsCard>
          <DsCard span={8}>
            <DsCardTitle hint={`${totalDeals} deals · suma de montos por etapa`}>Valor por etapa</DsCardTitle>
            {totalDeals === 0 ? (
              <DataState state="empty" message="Sin deals registrados: el embudo refleja los stages reales de crm_deals apenas existan." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {funnel.map(f => (
                  <div key={f.stage}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--ds-bright)" }}>{STAGE_LABEL[f.stage] ?? f.stage}</span>
                      <span style={{ color: "var(--ds-muted)" }}>
                        {fmtMoney(f.valorUsd)} · {nf.format(f.cantidad)} deal{f.cantidad === 1 ? "" : "s"} · prob. ~{f.probabilidadPromedio}%
                      </span>
                    </div>
                    <div style={{ height: 10, borderRadius: "var(--ds-radius-sm)", background: "var(--ds-panel-2)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: f.valorUsd > 0 ? `${Math.max(4, (f.valorUsd / maxValor) * 100)}%` : "0%",
                          background: "var(--ds-accent)",
                          borderRadius: "var(--ds-radius-sm)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

/** medir/loops — seguimientos activos de crm_deals (next_step), lectura de medición. */
export function MedirLoops({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadLoops), [workspaceId]);
  const loops = data ?? [];
  const vencidos = loops.filter(l => l.vencido).length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <DsCard span={12}>
          <DsCardTitle hint={`${loops.length} loops · ${vencidos} vencidos`}>Loops activos</DsCardTitle>
          {loops.length === 0 ? (
            <DataState state="empty" message="Sin loops: los deals de crm_deals con next_step (fecha o nota) aparecen aquí ordenados por vencimiento." />
          ) : (
            <DsTable
              rows={loops}
              rowKey={(r) => r.dealId}
              cols={[
                { label: "Loop", cell: r => str(r.title) },
                { label: "Métrica", cell: r => str(r.stage ? STAGE_LABEL[r.stage] ?? r.stage : null) },
                { label: "Próximo paso", cell: r => str(r.nextStepNote) },
                { label: "Fecha", cell: r => (r.nextStepDate ? fmtDate(r.nextStepDate) : "—") },
                {
                  label: "Estado",
                  cell: r => (
                    <span style={{ color: r.vencido ? "var(--ds-rojo)" : "var(--ds-verde)" }}>
                      {r.vencido ? "vencido" : "programado"}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

/** Color de estado de una campaña de pauta (solo tokens). */
function adsTone(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "active" || s === "activa" || s === "activo") return "var(--ds-verde)";
  if (s.startsWith("paus")) return "var(--ds-warn)";
  return "var(--ds-muted)";
}

/** medir/ads — presupuesto plan vs resultado por campaña (campaigns + deals). */
export function MedirAds({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchAdsRows), [workspaceId]);
  const rows: AdsRow[] = data ?? [];
  const totalPlan = rows.reduce((acc, r) => acc + r.budgetPlanUsd, 0);
  const totalResultado = rows.reduce((acc, r) => acc + r.resultadoUsd, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <>
          <DsCard span={4}>
            <DsCardTitle hint={`${rows.length} campañas`}>Resumen</DsCardTitle>
            <Stat value={fmtMoney(totalPlan)} suffix="presupuesto plan" />
            <div style={{ marginTop: 10 }}>
              <Stat value={fmtMoney(totalResultado)} suffix="resultado (deals)" />
            </div>
            <small style={{ display: "block", marginTop: 10, color: "var(--ds-muted)", fontSize: 11 }}>
              Resultado = suma de deals de crm_deals con campaign_id de la campaña.
            </small>
          </DsCard>
          <DsCard span={8}>
            <DsCardTitle hint="presupuesto plan vs resultado derivado">Campañas</DsCardTitle>
            {rows.length === 0 ? (
              <DataState state="empty" message="Sin campañas: las campañas con pauta y sus deals asociados aparecen aquí." />
            ) : (
              <DsTable
                rows={rows}
                rowKey={(r) => r.campaignName}
                cols={[
                  { label: "Campaña", cell: r => str(r.campaignName) },
                  { label: "Estado", cell: r => <span style={{ color: adsTone(r.status) }}>{str(r.status, "sin estado")}</span> },
                  { label: "Presupuesto plan", cell: r => fmtMoney(r.budgetPlanUsd) },
                  { label: "Resultado (deals)", cell: r => fmtMoney(r.resultadoUsd) },
                ]}
              />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

/** medir/reportes — métricas de actividad y uso de almacenamiento. */
export function MedirReportes({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadMedir), [workspaceId]);
  const a = data?.activity;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data && a ? (
        <>
          <DsCard span={3}>
            <DsCardTitle hint="30 días">Diseño ops</DsCardTitle>
            <Stat value={nf.format(a.totals.designOps)} suffix="operaciones" />
          </DsCard>
          <DsCard span={3}>
            <DsCardTitle hint="30 días">Frames</DsCardTitle>
            <Stat value={nf.format(a.totals.framesCreated)} suffix="creados" />
          </DsCard>
          <DsCard span={3}>
            <DsCardTitle hint="30 días">Plantillas</DsCardTitle>
            <Stat value={nf.format(a.totals.templatesCreated)} suffix="creadas" />
          </DsCard>
          <DsCard span={3}>
            <DsCardTitle>Storage</DsCardTitle>
            <Stat value={humanBytes(Number(data.storage.bytes ?? 0))} suffix="usados" />
            <small style={{ color: "var(--ds-muted)", fontSize: 11 }}>
              {nf.format(Number(data.storage.objectCount ?? 0))} objetos
            </small>
          </DsCard>

          <DsCard span={12}>
            <DsCardTitle hint={`${a.from} → ${a.to}`}>Actividad por día</DsCardTitle>
            {a.days.some(d => d.designOps + d.framesCreated + d.templatesCreated > 0) ? (
              <ActivityBars data={a} />
            ) : (
              <DataState state="empty" message="Sin actividad registrada en el rango." />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}
