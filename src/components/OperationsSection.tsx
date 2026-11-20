/**
 * REQ-081 — Operación: panel del operador zero-person (agencia).
 *
 * Una sola pantalla: cada fila = un CLIENTE (marca del workspace agencia)
 * con piezas de la semana, aprobaciones pendientes, publicaciones del mes,
 * uso de agentes (key_usage) y alertas ("Café X lleva N días sin aprobar").
 *
 * MCP-first / mismo patrón que ReportsSection: el agente puede leer lo
 * mismo con las tools existentes (list_brands + key_usage +
 * client_report_generate); esta vista solo agrega en una mirada.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

type BrandRow = {
  brandId: string;
  name: string;
  pieces7d: number;
  pendingApproval: number;
  scheduledPending: number;
  oldestPendingDays: number | null;
  published30d: number;
  jobs30d: number;
  delivered30d: number;
};

type OpSummary = {
  workspaceId: string;
  generatedAt: string;
  brands: BrandRow[];
  totals: {
    brands: number;
    pieces7d: number;
    pendingApproval: number;
    published30d: number;
    delivered30d: number;
  };
  agents: Array<{ label: string; calls: number }>;
  alerts: string[];
};

const n = (v: unknown) => Number(v || 0);

export function OperationsSection({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<OpSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<OpSummary>(`/api/operations/overview?workspaceId=${encodeURIComponent(workspaceId)}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la operación");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const t = data?.totals;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <p style={{ margin: 0, opacity: 0.72, fontSize: 14, lineHeight: 1.55 }}>
        Tu agencia en una mirada: cada cliente (marca) con su semana, su embudo y su alerta.
        Los agentes conectados aparecen con su uso del mes — el número con el que les facturas.
      </p>

      {loading && <p style={{ margin: 0, opacity: 0.6, fontSize: 14 }}>Cargando operación…</p>}
      {error && (
        <div style={{ border: "1px solid rgba(255,90,0,.4)", borderRadius: 10, padding: "10px 14px", fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Totales */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            {[
              { k: "Clientes", v: t?.brands ?? 0 },
              { k: "Piezas (7d)", v: t?.pieces7d ?? 0 },
              { k: "Por aprobar", v: t?.pendingApproval ?? 0 },
              { k: "Publicadas (30d)", v: t?.published30d ?? 0 },
              { k: "Entregas (30d)", v: t?.delivered30d ?? 0 },
            ].map((c) => (
              <div key={c.k} style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{c.v}</div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{c.k}</div>
              </div>
            ))}
          </div>

          {/* Alertas */}
          {data.alerts.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {data.alerts.map((a, i) => (
                <div key={i} style={{ border: "1px solid rgba(255,180,0,.45)", background: "rgba(255,180,0,.08)", borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>
                  ⚠ {a}
                </div>
              ))}
            </div>
          )}

          {/* Filas por cliente */}
          <div style={{ display: "grid", gap: 10 }}>
            {data.brands.map((b) => (
              <div key={b.brandId} style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <strong style={{ fontSize: 15 }}>{b.name}</strong>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>{b.published30d} publicadas · {b.jobs30d} jobs (30d)</span>
                </div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  {b.pieces7d} piezas esta semana · {b.pendingApproval} por aprobar
                  {b.oldestPendingDays != null && ` · la más vieja ${b.oldestPendingDays}d`} · {b.scheduledPending} programadas
                </div>
              </div>
            ))}
            {data.brands.length === 0 && (
              <p style={{ margin: 0, opacity: 0.6, fontSize: 14 }}>Sin marcas en este espacio: crea la marca de tu primer cliente para verla aquí.</p>
            )}
          </div>

          {/* Agentes */}
          <div style={{ display: "grid", gap: 6 }}>
            <strong style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", opacity: 0.6 }}>Agentes conectados (uso del mes)</strong>
            {data.agents.length === 0 && <p style={{ margin: 0, opacity: 0.6, fontSize: 13.5 }}>Ningún agente ha registrado llamadas este mes.</p>}
            {data.agents.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, borderBottom: "1px solid rgba(255,255,255,.08)", padding: "6px 2px" }}>
                <span>{a.label}</span>
                <span style={{ opacity: 0.7 }}>{n(a.calls)} llamadas</span>
              </div>
            ))}
          </div>

          <button onClick={load} style={{ justifySelf: "start", border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "inherit", borderRadius: 999, padding: "7px 16px", fontSize: 13.5, cursor: "pointer" }}>
            Refrescar
          </button>
        </>
      )}
    </div>
  );
}
