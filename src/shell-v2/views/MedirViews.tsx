/**
 * MedirViews.tsx — vista medir/reportes con datos reales (apiV2/medir.ts:
 * GET /api/metrics/activity + GET /api/storage/usage). Los subs embudos,
 * loops y ads siguen en placeholder (ver shell-v2/NEEDS.md).
 */
import { loadMedir } from "../../lib/apiV2";
import { DataState, DsCard, DsCardTitle, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { humanBytes } from "./helpers";
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
