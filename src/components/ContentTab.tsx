/**
 * Content — the calendar, the sheet, and the report, over one table.
 *
 * Three views of `content_calendar`, not three datasets. The calendar is what
 * you look at to plan a week; the sheet is what you fill in; the report is
 * what the client reads. They disagree only in shape.
 *
 * Styling follows the brand table on purpose — black, white text, no
 * chrome — because these two are the places this product asks someone to do
 * data entry, and switching visual language between them would make the same
 * gesture feel like two different tools.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { downloadBlob } from "../lib/download";
import {
  CHANNELS, CONTENT_KINDS, CONTENT_STATUSES, KIND_LABEL,
  applyFilters, buildMonthGrid, describeFilters, groupByPlan, isoDate, pacing,
  toCSVExport, toExcelXml, type ContentFilters, type ContentRow,
} from "../lib/contentCalendar";
import { TextsTab } from "./TextsTab";

type Pane = "calendar" | "sheet" | "reports" | "copies";

interface Props {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
}

const CELL: React.CSSProperties = {
  padding: "6px 10px",
  borderRight: "1px solid rgba(255,255,255,0.10)",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  fontSize: 12.5,
  color: "#fff",
  textAlign: "left",
  verticalAlign: "middle",
};

const btn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "transparent",
  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0, cursor: "pointer",
};

const control: React.CSSProperties = {
  padding: "3px 6px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "#000",
  border: "1px solid rgba(255,255,255,0.18)", borderRadius: 0, cursor: "pointer",
};

const field: React.CSSProperties = {
  width: "100%", background: "transparent", color: "#fff",
  border: "1px solid transparent", borderRadius: 0,
  padding: "3px 4px", fontSize: 12.5, fontFamily: "inherit", outline: "none",
};

const CSS = `
.ct tbody tr:hover td { background: rgba(255,255,255,0.05); }
.ct input:focus, .ct select:focus, .ct textarea:focus { border-color: rgba(255,255,255,0.5); }
.cal-day:hover .cal-add { opacity: 1; }
`;

export function ContentTab({ workspaceId, onOpenTemplate }: Props) {
  const [pane, setPane] = useState<Pane>("calendar");
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(() => new Date());
  const [filters, setFilters] = useState<ContentFilters>({});
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError("");
    try {
      const res = await apiFetch<{ success?: boolean; data?: ContentRow[] }>(
        `/api/content?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el calendario");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // Brands drive the filter, so a report can be cut per client.
  useEffect(() => {
    if (!workspaceId) return;
    void apiFetch<{ data?: Array<{ id: string; name: string }> }>(`/api/workspaces/${workspaceId}/brands`)
      .then(res => setBrands(Array.isArray(res?.data) ? res.data : []))
      .catch(() => { /* the section works unfiltered */ });
  }, [workspaceId]);

  const brandNameById = useMemo(
    () => new Map(brands.map(b => [b.id, b.name])), [brands]);

  /** Every view below reads THIS, never `rows` — so an export is exactly what
   *  is on screen, which is the whole point of being able to stack filters. */
  const visible = useMemo(
    () => applyFilters(rows, filters).map(r => ({ ...r, brandName: brandNameById.get(r.brand_id || "") || "" })),
    [rows, filters, brandNameById]);

  const exportAs = useCallback((format: "csv" | "xlsx") => {
    const stamp = isoDate(new Date());
    if (format === "csv") {
      downloadBlob(new Blob([toCSVExport(visible)], { type: "text/csv;charset=utf-8" }),
        `reporte-${stamp}.csv`);
    } else {
      // SpreadsheetML: Excel and Sheets both open it as a real sheet, with no
      // zip writer shipped to the browser for one table.
      downloadBlob(new Blob([toExcelXml(visible, "Reporte")], { type: "application/vnd.ms-excel" }),
        `reporte-${stamp}.xls`);
    }
  }, [visible]);

  /** Optimistic write: the cell changes before the request leaves. */
  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setError("");
    const before = rows.find(r => r.id === id);
    setRows(cur => cur.map(r => (r.id === id ? { ...r, ...body } as ContentRow : r)));
    try {
      const res = await apiFetch<{ success?: boolean; error?: string }>(`/api/content/${id}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      if (res && res.success === false) throw new Error(res.error || "El servidor rechazó el cambio");
    } catch (e) {
      if (before) setRows(cur => cur.map(r => (r.id === id ? before : r)));
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rows]);

  const addRow = useCallback(async (date?: string) => {
    if (!workspaceId) return;
    setError("");
    try {
      const res = await apiFetch<{ data?: ContentRow }>("/api/content", {
        method: "POST",
        body: JSON.stringify({
          workspaceId,
          scheduled_date: date || isoDate(new Date()),
          kind: "organic",
          status: "idea",
          channels: [],
        }),
      });
      if (res?.data) setRows(cur => [...cur, res.data!]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workspaceId]);

  const removeRow = useCallback(async (id: string) => {
    const before = rows;
    setRows(cur => cur.filter(r => r.id !== id));
    try {
      await apiFetch(`/api/content/${id}`, { method: "DELETE" });
    } catch (e) {
      setRows(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rows]);

  const grid = useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth(), visible),
    [cursor, visible],
  );

  const monthLabel = cursor.toLocaleDateString("es", { month: "long", year: "numeric" });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <style>{CSS}</style>

      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "8px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.14)", flexShrink: 0,
      }}>
        <Tab active={pane === "calendar"} onClick={() => setPane("calendar")}>Calendario</Tab>
        <Tab active={pane === "sheet"} onClick={() => setPane("sheet")}>Contenidos</Tab>
        <Tab active={pane === "reports"} onClick={() => setPane("reports")}>Reportes</Tab>
        <Tab active={pane === "copies"} onClick={() => setPane("copies")}>Copys</Tab>
        <div style={{ flex: 1 }} />
        {pane !== "copies" && (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            {visible.length} de {rows.length} piezas · {visible.filter(r => r.kind === "ad").length} ads
          </span>
        )}
      </div>

      {pane !== "copies" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.10)", flexShrink: 0,
        }}>
          {/* Each narrows the last. Stacking them is what lets one workspace
              produce a report per brand, per period, per kind. */}
          <input type="date" value={filters.from || ""} style={{ ...control, colorScheme: "dark" }}
            onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} aria-label="Desde" />
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>a</span>
          <input type="date" value={filters.to || ""} style={{ ...control, colorScheme: "dark" }}
            onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} aria-label="Hasta" />
          <select value={filters.brandId || ""} style={control} aria-label="Marca"
            onChange={e => setFilters(f => ({ ...f, brandId: e.target.value }))}>
            <option value="" style={{ background: "#000" }}>Todas las marcas</option>
            {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#000" }}>{b.name}</option>)}
          </select>
          <select value={filters.kind || ""} style={control} aria-label="Tipo"
            onChange={e => setFilters(f => ({ ...f, kind: e.target.value as any }))}>
            <option value="" style={{ background: "#000" }}>Ads y orgánico</option>
            {CONTENT_KINDS.map(k => <option key={k} value={k} style={{ background: "#000" }}>{KIND_LABEL[k]}</option>)}
          </select>
          <select value={filters.channel || ""} style={control} aria-label="Canal"
            onChange={e => setFilters(f => ({ ...f, channel: e.target.value }))}>
            <option value="" style={{ background: "#000" }}>Todos los canales</option>
            {CHANNELS.map(c => <option key={c} value={c} style={{ background: "#000" }}>{c}</option>)}
          </select>
          <input value={filters.campaign || ""} placeholder="Campaña" aria-label="Campaña"
            style={{ ...control, width: 130 }}
            onChange={e => setFilters(f => ({ ...f, campaign: e.target.value }))} />
          {Object.values(filters).some(Boolean) && (
            <button type="button" style={btn} onClick={() => setFilters({})}>Limpiar</button>
          )}
          <div style={{ flex: 1 }} />
          {/* Exports carry exactly what the filters left on screen. */}
          <button type="button" style={btn} onClick={() => exportAs("csv")}>⇩ CSV</button>
          <button type="button" style={btn} onClick={() => exportAs("xlsx")}>⇩ Excel</button>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          padding: "8px 16px", fontSize: 12, color: "#fff",
          background: "rgba(255,255,255,0.10)", borderBottom: "1px solid rgba(255,255,255,0.14)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError("")} style={btn}>Cerrar</button>
        </div>
      )}

      {loading && pane !== "copies" ? (
        <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando…</div>
      ) : pane === "calendar" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px" }}>
            <button type="button" style={btn} onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>←</button>
            <span style={{ fontSize: 13, color: "#fff", minWidth: 170, textTransform: "capitalize" }}>{monthLabel}</span>
            <button type="button" style={btn} onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>→</button>
            <button type="button" style={btn} onClick={() => setCursor(new Date())}>Hoy</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 16px 16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 1, background: "rgba(255,255,255,0.10)" }}>
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => (
                <div key={d} style={{ background: "#000", padding: "6px 8px", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{d}</div>
              ))}
              {grid.map(cell => (
                <div
                  key={cell.date}
                  className="cal-day"
                  style={{
                    background: "#000", minHeight: 104, padding: 6,
                    opacity: cell.inMonth ? 1 : 0.35,
                    outline: cell.isToday ? "1px solid rgba(255,255,255,0.55)" : "none",
                    outlineOffset: -1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{cell.day}</span>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="cal-add"
                      onClick={() => addRow(cell.date)}
                      title="Agregar contenido este día"
                      style={{
                        opacity: 0, transition: "opacity 120ms", background: "transparent",
                        border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer",
                        fontSize: 13, lineHeight: 1, padding: 0,
                      }}
                    >+</button>
                  </div>
                  {cell.items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPane("sheet")}
                      title={item.copy || item.topic || ""}
                      style={{
                        display: "block", width: "100%", textAlign: "left", marginBottom: 3,
                        padding: "3px 5px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                        color: "#fff", background: "rgba(255,255,255,0.08)",
                        // An ad is money going out; it earns the heavier mark.
                        borderLeft: `2px solid ${item.kind === "ad" ? "#fff" : "rgba(255,255,255,0.3)"}`,
                        border: "none", borderLeftWidth: 2, borderLeftStyle: "solid",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {item.scheduled_time ? `${item.scheduled_time.slice(0, 5)} ` : ""}
                      {item.topic || item.copy || "(sin tema)"}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : pane === "sheet" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 16px 16px" }}>
          <table className="ct" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["Fecha", "Hora", "Tipo", "Tema", "Copy", "Canales", "Campaña", "Conjunto", "Estado",
                  "PROY $", "PROY Impr.", "REAL $", "REAL Impr.", "Avance", "Archivo", ""].map(h => (
                  <th key={h} style={{
                    ...CELL, position: "sticky", top: 0, zIndex: 1, background: "#000",
                    fontWeight: 600, color: "rgba(255,255,255,0.65)", fontSize: 11.5,
                    borderBottom: "1px solid rgba(255,255,255,0.28)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id}>
                  <td style={CELL}>
                    <input type="date" value={r.scheduled_date || ""} style={field}
                      onChange={e => patch(r.id, { scheduled_date: e.target.value })} />
                  </td>
                  <td style={CELL}>
                    <input type="time" value={(r.scheduled_time || "").slice(0, 5)} style={field}
                      onChange={e => patch(r.id, { scheduled_time: e.target.value })} />
                  </td>
                  <td style={CELL}>
                    <select value={r.kind} style={{ ...control, width: "100%" }}
                      onChange={e => patch(r.id, { kind: e.target.value })}>
                      {CONTENT_KINDS.map(k => <option key={k} value={k} style={{ background: "#000" }}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td style={{ ...CELL, minWidth: 140 }}>
                    <input value={r.topic || ""} placeholder="Tema" style={field}
                      onChange={e => patch(r.id, { topic: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 220 }}>
                    <textarea value={r.copy || ""} placeholder="Copy" rows={1}
                      style={{ ...field, resize: "vertical", minHeight: 24 }}
                      onChange={e => patch(r.id, { copy: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 150 }}>
                    {/* Multi-select rather than a dropdown: one post routinely
                        goes to Instagram and Facebook at once. */}
                    <select
                      multiple
                      value={r.channels || []}
                      style={{ ...control, width: "100%", height: 46 }}
                      onChange={e => patch(r.id, {
                        channels: [...e.target.selectedOptions].map(o => o.value),
                      })}
                    >
                      {CHANNELS.map(c => <option key={c} value={c} style={{ background: "#000" }}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ ...CELL, minWidth: 120 }}>
                    <input value={r.campaign || ""} placeholder="—" style={field}
                      onChange={e => patch(r.id, { campaign: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 120 }}>
                    <input value={r.ad_set || ""} placeholder="—" style={field}
                      onChange={e => patch(r.id, { ad_set: e.target.value })} />
                  </td>
                  <td style={CELL}>
                    <select value={r.status} style={{ ...control, width: "100%" }}
                      onChange={e => patch(r.id, { status: e.target.value })}>
                      {CONTENT_STATUSES.map(s => <option key={s} value={s} style={{ background: "#000" }}>{s}</option>)}
                    </select>
                  </td>
                  {/* PROYECCIÓN against RESULTADOS, the two bands an agency
                      report is built on. Blank means no plan, which is not
                      zero — the avance column shows "—" rather than 0%. */}
                  {(["plan_spend", "plan_impressions", "actual_spend", "actual_impressions"] as const).map(key => (
                    <td key={key} style={{ ...CELL, minWidth: 84 }}>
                      <input
                        inputMode="decimal"
                        value={(r as any)[key] ?? ""}
                        placeholder="—"
                        style={{ ...field, textAlign: "right" }}
                        onChange={e => patch(r.id, { [key]: e.target.value })}
                      />
                    </td>
                  ))}
                  <td style={{ ...CELL, textAlign: "right", color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>
                    {(() => {
                      const p = pacing((r as any).actual_spend, (r as any).plan_spend);
                      return p === null ? "—" : `${Math.round(p * 100)}%`;
                    })()}
                  </td>
                  <td style={{ ...CELL, minWidth: 150 }}>
                    {r.template_id ? (
                      <button type="button" onClick={() => onOpenTemplate?.(r.template_id!)}
                        style={{ ...field, textAlign: "left", cursor: "pointer", textDecoration: "underline" }}>
                        abrir diseño
                      </button>
                    ) : (
                      <input value={r.external_url || ""} placeholder="ID de diseño o enlace" style={field}
                        onChange={e => patch(r.id, { external_url: e.target.value })} />
                    )}
                  </td>
                  <td style={CELL}>
                    <button type="button" onClick={() => removeRow(r.id)} title="Eliminar"
                      style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => addRow()} style={{ ...btn, marginTop: 8, width: "100%" }}>
            + Agregar contenido
          </button>
        </div>
      ) : pane === "reports" ? (
        <ReportsPane rows={visible} filters={filters} onExport={exportAs} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <TextsTab workspaceId={workspaceId} onOpenTemplate={onOpenTemplate} />
        </div>
      )}
    </div>
  );
}

/**
 * The agency report: dimensions, PROYECCIÓN against RESULTADOS, and how far
 * along it is — the four bands the Santander files are built on.
 *
 * Totals are summed from the rows the filters left, and the rates are derived
 * from those sums rather than averaged per row. Averaging a CPM weights a
 * 300-impression ad the same as a 300,000-impression one and yields a number
 * that is not the cost of anything.
 */
function ReportsPane({ rows, filters, onExport }: {
  rows: ContentRow[];
  filters: ContentFilters;
  onExport: (format: "csv" | "xlsx") => void;
}) {
  const { campaigns, loose } = useMemo(() => groupByPlan(rows), [rows]);

  const sum = (list: ContentRow[], key: string) =>
    list.reduce((acc, r) => acc + (Number((r as any)[key]) || 0), 0);

  const block = (list: ContentRow[]) => {
    const planSpend = sum(list, "plan_spend");
    const planImpr = sum(list, "plan_impressions");
    const realSpend = sum(list, "actual_spend");
    const realImpr = sum(list, "actual_impressions");
    const realClicks = sum(list, "actual_clicks");
    return {
      piezas: list.length,
      planSpend, planImpr, realSpend, realImpr,
      cpm: realImpr > 0 ? (realSpend / realImpr) * 1000 : null,
      ctr: realImpr > 0 ? (realClicks / realImpr) * 100 : null,
      avanceSpend: pacing(realSpend, planSpend),
      avanceImpr: pacing(realImpr, planImpr),
    };
  };

  const n = (v: number | null, digits = 0) =>
    v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("es", { maximumFractionDigits: digits });
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  const head = (label: string) => (
    <th key={label} style={{
      ...CELL, background: "#000", fontWeight: 600, fontSize: 11.5,
      color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap",
    }}>{label}</th>
  );

  const line = (label: string, list: ContentRow[], muted = false) => {
    const b = block(list);
    return (
      <tr key={label}>
        <td style={{ ...CELL, color: muted ? "rgba(255,255,255,0.5)" : "#fff", fontStyle: muted ? "italic" : "normal" }}>{label}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{b.piezas}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{n(b.planSpend, 2)}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{n(b.planImpr)}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{n(b.realSpend, 2)}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{n(b.realImpr)}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{n(b.cpm, 2)}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{b.ctr === null ? "—" : `${b.ctr.toFixed(2)}%`}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{pct(b.avanceSpend)}</td>
        <td style={{ ...CELL, textAlign: "right" }}>{pct(b.avanceImpr)}</td>
      </tr>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
        {describeFilters(filters)} · {rows.length} piezas
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          Nada que reportar con estos filtros.
        </div>
      ) : (
        <>
          <table className="ct" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {head("Campaña")}
                {head("Piezas")}
                {head("PROY Inversión")}
                {head("PROY Impresiones")}
                {head("REAL Inversión")}
                {head("REAL Impresiones")}
                {head("CPM")}
                {head("CTR")}
                {head("AVANCE $")}
                {head("AVANCE Impr.")}
              </tr>
            </thead>
            <tbody>
              {[...campaigns.entries()].map(([name, items]) => line(name, items))}
              {loose.length > 0 && line("sin campaña", loose, true)}
              {line("TOTAL", rows)}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" style={btn} onClick={() => onExport("csv")}>⇩ Exportar CSV</button>
            <button type="button" style={btn} onClick={() => onExport("xlsx")}>⇩ Exportar Excel</button>
          </div>
        </>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 14px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
        color: active ? "#000" : "#fff",
        background: active ? "#fff" : "transparent",
        border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0,
        fontWeight: active ? 600 : 400,
      }}
    >{children}</button>
  );
}
