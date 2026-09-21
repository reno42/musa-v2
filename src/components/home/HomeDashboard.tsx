/** Inicio — Dashboard Ejecutivo (REQ Dashboard Ejecutivo de Musa).
 *  MCP-first (regla del REQ): cada widget consume UN tool MCP de lectura y
 *  muestra su propio error — nunca un bloqueo de todo el tab.
 *  Cada métrica trae su desglose por marca inline (ajuste de Ren: el KPI nunca
 *  dispara una segunda llamada groupBy).
 *  Diseño: el botón a Diseño es visible en 1 click — Victor vive en el editor. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mcpCall } from "../../lib/mcpClient";
import html2canvas from "html2canvas";
// Misma grilla de calendario que la vista real (lunes primero, semanas
// completas) — el mini calendario del Inicio y el de Copywriting no pueden
// discrepar. Solo se IMPORTA: el archivo lo mantiene otro agente en paralelo.
import { buildMonthGrid, CONTENT_STATUSES, isoDate, type ContentRow, type ContentStatus } from "../../lib/contentCalendar";
// Rampa beige del simulador — la misma data que pinta el embudo del CRM.
import { FUNNEL_LAYER_SKINS } from "../../lib/crmFunnel";

// ── Tipos mínimos de los payloads MCP (ver casos en netlify/functions/mcp.mjs) ──
type ByBrand = { brandId: string | null; brandName: string; count: number; value: number };
type Summary = {
  range: string; from: string; generatedAt: string;
  kpis: {
    publishedPieces: { total: number; byBrand: ByBrand[] };
    leadsCaptured: { total: number; totalNewContacts?: number; byBrand: ByBrand[] };
    pipelineValue: { total: number; currency: string | string[] | null; byBrand: ByBrand[] };
    openDeals: { total: number; byBrand: ByBrand[] };
  };
  kanban: { total: number; byStatus: Record<string, number>; stalled7d: { total: number; byBrand: ByBrand[] } };
  calendar: { upcoming7d: { total: number; byStatus: Record<string, number> } };
};
type PendingItem = {
  source: "content_approval" | "kanban_stalled" | "deal_next_step" | "comment_unanswered";
  id: string; title: string; brandName?: string;
  dueDate?: string | null; ageDays?: number; status?: string; priority?: number;
  stage?: string; value?: number; currency?: string | null; nextStepOverdue?: boolean;
  author?: string; hint?: string;
};
type PendingPayload = { total: number; items: PendingItem[]; stalledDays: number };
type ActivityEvent = { source: "kanban" | "content" | "crm" | "lead"; at: string; title: string; from?: string | null; to?: string | null; by?: string | null; channels?: string[] };
type ActivityPayload = { total: number; events: ActivityEvent[] };
type DealsPayload = { total: number; byStage: Record<string, { count: number; value: number }> };
type CalendarPayload = { total: number; entries: Array<{ id: string; topic?: string; scheduledDate?: string; status?: string; channels?: string[]; brandName?: string }> };
// REQ-CW2: lo que devuelve list_campaign_report (buildCampaignReport).
type CampaignAggregateDto = {
  name: string; isBenchmark: boolean; piezas: number;
  planSpend: number; planImpr: number; realSpend: number; realImpr: number;
  cpm: number | null; ctr: number | null;
  avanceSpend: number | null; avanceImpr: number | null;
  winnerId: string | null; winnerTopic: string | null;
};
type CampaignPayload = { campaigns: CampaignAggregateDto[]; looseCount: number; total: number };

const OPEN_STAGES = ["discovery", "proposal", "negotiation", "approved", "in_production", "review", "ready"] as const;
const STAGE_LABEL: Record<string, string> = {
  discovery: "Descubrimiento", proposal: "Propuesta", negotiation: "Negociación",
  approved: "Aprobado", in_production: "Producción", review: "Revisión", ready: "Listo",
  delivered: "Entregado", lost: "Perdido",
};
const SOURCE_LABEL: Record<PendingItem["source"], string> = {
  content_approval: "Aprobar",
  kanban_stalled: "Kanban estancada",
  deal_next_step: "Deal sin paso",
  comment_unanswered: "Comentario sin respuesta",
};

const money = (v: number, currency?: string | string[] | null) => {
  const code = (Array.isArray(currency) ? currency[0] : currency) || "USD";
  return code + " " + new Intl.NumberFormat("es-CR", { notation: "compact", maximumFractionDigits: 1 }).format(v || 0);
};
const byBrandText = (rows: ByBrand[] | undefined, withValue = false) => {
  if (!rows || !rows.length) return "";
  const head = rows.slice(0, 3).map(b => b.brandName + " " + (withValue ? money(b.value) : "×" + b.count));
  return head.join(" · ") + (rows.length > 3 ? ` · +${rows.length - 3}` : "");
};
const relTime = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};
/** Semana ISO (etiqueta del reporte): musa-reporte-2026-W38.png */
const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
};
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/** CSV multi-sección (KPIs, funnel, piezas de la semana) con escape estándar. */
function toCsv(sections: Array<{ name: string; rows: Array<Record<string, unknown>> }>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = [];
  for (const s of sections) {
    if (!s.rows.length) continue;
    out.push("[" + s.name + "]");
    out.push(Object.keys(s.rows[0]).join(","));
    for (const r of s.rows) out.push(Object.values(r).map(esc).join(","));
    out.push("");
  }
  return out.join("\n");
}

// ── Hook por-widget: carga independiente + error aislado + reintentar ──
function useMcpWidget<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetcher()
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(e => { if (alive) { setError(e?.message || String(e)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1) };
}

// ── Tarjetas base ──
const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)", padding: 14,
};
const cardTitleStyle: React.CSSProperties = {
  fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
  color: "rgba(255,255,255,0.5)", marginBottom: 8, fontWeight: 600,
};
const ghostBtnStyle: React.CSSProperties = {
  background: "none", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6,
  color: "rgba(255,255,255,0.7)", fontSize: 11, padding: "3px 10px", cursor: "pointer",
};
const chipStyle: React.CSSProperties = {
  fontSize: 10, padding: "2px 8px", borderRadius: 100,
  border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.6)",
};

// ── Skeletons (shell-first): la concha de cada widget existe desde el primer
//    frame y el contenido llega después — la UI nunca se reacomoda. Reusa el
//    @keyframes shimmer global de index.css. ──
const shimmerStyle: React.CSSProperties = {
  background: "linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.12) 37%, rgba(255,255,255,0.05) 63%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.4s linear infinite",
};
function SkeletonBar(props: { w: number | string; h: number; style?: React.CSSProperties }) {
  return <div aria-hidden style={{ width: props.w, height: props.h, borderRadius: 6, ...shimmerStyle, ...props.style }} />;
}
/** Misma silueta que una KpiCard: título, número grande y desglose. */
function KpiSkeleton() {
  return (
    <div style={cardStyle}>
      <SkeletonBar w={72} h={9} />
      <SkeletonBar w={96} h={26} style={{ marginTop: 9 }} />
      <SkeletonBar w={132} h={8} style={{ marginTop: 9 }} />
    </div>
  );
}/** Filas tipo lista (chip + línea + meta) con la altura de las reales. */
function SkeletonRows(props: { rows?: number }) {
  const n = props.rows ?? 5;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SkeletonBar w={58} h={18} style={{ borderRadius: 100, flexShrink: 0 }} />
          <SkeletonBar w={`${Math.max(30, 88 - i * 9)}%`} h={11} />
          <SkeletonBar w={38} h={9} style={{ flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

function WidgetError(props: { message: string; onRetry: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#f87171" }}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{props.message}</span>
      <button type="button" style={ghostBtnStyle} onClick={props.onRetry}>Reintentar</button>
    </div>
  );
}
// ── Widget KPI ──
function KpiCard(props: { label: string; total: React.ReactNode; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={cardTitleStyle}>{props.label}</div>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 28, color: "rgba(255,255,255,0.92)", lineHeight: 1.1 }}>
        {props.total}
      </div>
      {props.sub ? (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={props.sub}>
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

// ── Widget: Se publica este mes (REQ-DASH2, list_calendar_entries) ──
// Calendario real en miniatura: la MISMA grilla del calendario de contenido
// (buildMonthGrid, lunes primero) con puntitos por estado — más visual que la
// lista anterior. Se trae el mes visible completo (no solo +7d) y el día
// seleccionado lista sus piezas abajo. La grilla es client-side: existe desde
// el primer frame y solo los puntitos se van llenando.
const STATUS_DOT: Record<string, string> = {
  idea: "#71717a",
  diseño: "#a78bfa",
  aprobación: "#fbbf24",
  programado: "#60a5fa",
  publicado: "#4ade80",
};
const dotColor = (status?: string | null) => (status && STATUS_DOT[status]) || "#71717a";

function UpcomingWidget(props: { workspaceId: string; onNavigate: (tab: any, pane?: string) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(() => isoDate(now));
  const ym = `${cursor.getFullYear()}-${cursor.getMonth()}`;
  const monthFrom = isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const monthTo = isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const w = useMcpWidget<CalendarPayload>(
    () => mcpCall("list_calendar_entries", { workspaceId: props.workspaceId, from: monthFrom, to: monthTo, limit: 100 }),
    [props.workspaceId, ym],
  );
  // El tool MCP devuelve el shape liviano; buildMonthGrid quiere ContentRow —
  // mapeo 1:1 (las filas sin fecha las descarta la propia grilla).
  const rows: ContentRow[] = useMemo(() => (w.data?.entries || []).map(e => ({
    id: e.id,
    scheduled_date: e.scheduledDate || "",
    topic: e.topic || null,
    kind: "organic" as const,
    channels: e.channels || [],
    status: (e.status || "idea") as ContentStatus,
    brandName: e.brandName ?? null,
  })), [w.data]);
  const cells = useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth(), rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ym, rows],
  );
  const monthLabel = cursor.toLocaleDateString("es-CR", { month: "long", year: "numeric" });
  const selLabel = new Date(selected + "T00:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "short" });
  const selItems = cells.find(c => c.date === selected)?.items || [];
  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    const t = new Date();
    setSelected(next.getFullYear() === t.getFullYear() && next.getMonth() === t.getMonth() ? isoDate(t) : isoDate(next));
  };
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={cardTitleStyle}>Se publica este mes</div>
        <button type="button" style={ghostBtnStyle} onClick={() => props.onNavigate("copywriting", "calendar")}>Calendario</button>
      </div>
      {w.error ? <WidgetError message={w.error} onRetry={w.reload} /> : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <button type="button" style={ghostBtnStyle} onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", textTransform: "capitalize" }}>{monthLabel}</span>
        <button type="button" style={ghostBtnStyle} onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {["L", "M", "X", "J", "V", "S", "D"].map(d => (
          <div key={d} style={{ fontSize: 9, letterSpacing: 0.5, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>{d}</div>
        ))}
        {cells.map(cell => {
          const shown = cell.items.slice(0, 3);
          const extra = cell.items.length - shown.length;
          const isSel = cell.date === selected;
          return (
            <button key={cell.date} type="button" onClick={() => setSelected(cell.date)}
              title={cell.items.length ? cell.items.map(e => e.topic || "(sin topic)").join(" · ") : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "4px 0 5px", minHeight: 36, borderRadius: 6, cursor: "pointer", font: "inherit", fontSize: 10,
                background: cell.isToday ? "rgba(139,92,246,0.16)" : isSel ? "rgba(255,255,255,0.06)" : "transparent",
                border: `1px solid ${isSel ? "rgba(139,92,246,0.55)" : "transparent"}`,
                color: cell.inMonth ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.22)",
              }}>
              {cell.day}
              <span style={{ display: "flex", alignItems: "center", gap: 2, height: 4 }}>
                {shown.map(e => <i key={e.id} style={{ width: 4, height: 4, borderRadius: 999, background: dotColor(e.status) }} />)}
                {extra > 0 ? <span style={{ fontSize: 7, lineHeight: "4px", color: "rgba(255,255,255,0.5)" }}>+{extra}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
        {CONTENT_STATUSES.map(s => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: "rgba(255,255,255,0.45)" }}>
            <i style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_DOT[s] }} />{s}
          </span>
        ))}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 5, minHeight: 64 }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "capitalize" }}>
          {selLabel} · {selItems.length === 1 ? "1 pieza" : `${selItems.length} piezas`}
        </div>
        {w.loading && !w.data ? (
          <SkeletonRows rows={2} />
        ) : selItems.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Sin contenido ese día.</div>
        ) : selItems.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <i style={{ width: 7, height: 7, borderRadius: 999, background: dotColor(e.status), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.85)" }} title={e.topic || undefined}>
              {e.topic || "(sin topic)"}
            </span>
            <span style={chipStyle}>{e.status || "?"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Widget: Necesita tu acción (REQ-DASH3, list_pending_actions) ──
const PENDING_TARGET: Record<PendingItem["source"], [any, string?]> = {
  content_approval: ["copywriting", "calendar"],
  // v59: la pestaña Agentes desapareció — el Kanban vive en Inicio.
  kanban_stalled: ["home", "kanban"],
  deal_next_step: ["contactos", "pipeline"],
  comment_unanswered: ["diseno"],
};
function PendingWidget(props: { workspaceId: string; onNavigate: (tab: any, pane?: string) => void }) {
  const w = useMcpWidget<PendingPayload>(
    () => mcpCall("list_pending_actions", { workspaceId: props.workspaceId, stalledDays: 7, limit: 50 }),
    [props.workspaceId],
  );
  const items = w.data?.items || [];
  const shown = items.slice(0, 8);
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={cardTitleStyle}>Necesita tu acción</div>
        {w.data && w.data.total > shown.length ? (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>+{w.data.total - shown.length} más</span>
        ) : null}
      </div>
      {w.loading ? <div style={{ minHeight: 190 }}><SkeletonRows rows={5} /></div> : w.error ? <WidgetError message={w.error} onRetry={w.reload} /> : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Todo al día — sin acciones pendientes.</div>
      ) : shown.map(it => {
        const meta = [
          it.brandName && it.brandName !== "Sin marca" ? it.brandName : null,
          it.dueDate ? "vence " + it.dueDate : null,
          typeof it.ageDays === "number" ? `${it.ageDays}d` : null,
          it.nextStepOverdue ? "paso VENCIDO" : null,
        ].filter(Boolean).join(" · ");
        const target = PENDING_TARGET[it.source];
        return (
          <button key={it.source + it.id} type="button" onClick={() => props.onNavigate(target[0], target[1])}
            title={it.hint || it.title}
            style={{ ...ghostBtnStyle, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: "rgba(255,255,255,0.03)" }}>
            <span style={{ ...chipStyle, flexShrink: 0, color: it.source === "deal_next_step" && it.nextStepOverdue ? "#f87171" : "rgba(255,255,255,0.6)" }}>
              {SOURCE_LABEL[it.source]}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.85)" }}>
              {it.title}
            </span>
            {meta ? <span style={{ flexShrink: 0, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{meta}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Widget: Mini-embudo (REQ-DASH4, list_crm_deals openOnly → byStage) ──
// Misma silueta del simulador del CRM: capas trapecio con la rampa beige
// (FUNNEL_LAYER_SKINS) y las clases globales crm-funnel-*. Las 7 etapas
// abiertas SIEMPRE visibles (vacía = capa gris) — la concha existe desde el
// primer frame y los valores llegan después. Columna lateral: valor +
// conversión vs la etapa anterior (por deals, igual que el CRM).
function FunnelWidget(props: { workspaceId: string; onNavigate: (tab: any, pane?: string) => void }) {
  const w = useMcpWidget<DealsPayload>(
    () => mcpCall("list_crm_deals", { workspaceId: props.workspaceId, openOnly: true, limit: 1 }),
    [props.workspaceId],
  );
  const byStage = w.data?.byStage || {};
  const total = OPEN_STAGES.reduce((s, st) => s + (byStage[st]?.count || 0), 0);
  const totalValue = OPEN_STAGES.reduce((s, st) => s + (byStage[st]?.value || 0), 0);
  // Geometría idéntica al simulador: el ancho baja lineal de 100% a 38%.
  const layerWidth = (index: number) => 100 - Math.round((62 * index) / Math.max(1, OPEN_STAGES.length - 1));
  const layerClip = (index: number) => {
    const topWidth = layerWidth(index);
    const bottomWidth = layerWidth(Math.min(index + 1, OPEN_STAGES.length - 1));
    const leftTop = (100 - topWidth) / 2;
    const leftBottom = (100 - bottomWidth) / 2;
    return `polygon(${leftTop}% 0%, ${100 - leftTop}% 0%, ${100 - leftBottom}% 100%, ${leftBottom}% 100%)`;
  };
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={cardTitleStyle}>Pipeline abierto</div>
        <button type="button" style={ghostBtnStyle} onClick={() => props.onNavigate("contactos", "pipeline")}>Ventas</button>
      </div>
      {w.error ? <WidgetError message={w.error} onRetry={w.reload} /> : (
        <>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
            {total} deals · {money(totalValue)}{total === 0 ? " — sin deals abiertos." : ""}
          </div>
          <div className="crm-funnel-sim-chart">
            {OPEN_STAGES.map((st, index) => {
              const count = byStage[st]?.count || 0;
              const value = byStage[st]?.value || 0;
              const empty = count === 0;
              const skin = FUNNEL_LAYER_SKINS[index % FUNNEL_LAYER_SKINS.length];
              const prev = index > 0 ? OPEN_STAGES[index - 1] : null;
              const prevCount = prev ? byStage[prev]?.count || 0 : 0;
              const conv = prev && prevCount > 0 ? `${Math.round((count / prevCount) * 100)}%` : null;
              return (
                <div className="crm-funnel-layer-row" key={st}>
                  <div
                    className={`crm-funnel-layer${empty ? " empty" : ""}`}
                    style={{ clipPath: layerClip(index), background: empty ? "rgba(255,255,255,.04)" : skin.bg, color: empty ? "#8b8b94" : skin.fg, cursor: "default" }}
                    title={`${STAGE_LABEL[st]}: ${count} deal${count === 1 ? "" : "s"}${value ? ` · ${money(value)}` : ""}`}
                  >
                    <span className="crm-funnel-layer-name">{STAGE_LABEL[st]}</span>
                    <span className="crm-funnel-layer-count">{count}</span>
                  </div>
                  <div className="crm-funnel-layer-side">
                    <strong>{money(value)}</strong>
                    <small>{conv ? `↓ ${conv} desde ${STAGE_LABEL[prev!]}` : index === 0 ? "Entrada al embudo" : "—"}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Widget: Actividad reciente (get_recent_activity) ──
const ACTIVITY_VERB: Record<ActivityEvent["source"], (e: ActivityEvent) => string> = {
  kanban: e => `Kanban: ${e.title} → ${e.to || "?"}`,
  content: e => `Publicado: ${e.title}`,
  crm: e => `Deal: ${e.title} (${STAGE_LABEL[e.from || ""] || e.from || "movido"})`,
  lead: e => `Lead: ${e.title}`,
};
function ActivityWidget(props: { workspaceId: string }) {
  const w = useMcpWidget<ActivityPayload>(
    () => mcpCall("get_recent_activity", { workspaceId: props.workspaceId, limit: 12 }),
    [props.workspaceId],
  );
  const rows = w.data?.events || [];
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={cardTitleStyle}>Actividad reciente</div>
      {w.loading ? <div style={{ minHeight: 150 }}><SkeletonRows rows={6} /></div> : w.error ? <WidgetError message={w.error} onRetry={w.reload} /> : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Sin movimientos en 30 días.</div>
      ) : rows.map((e, i) => (
        <div key={e.source + e.at + i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ ...chipStyle, flexShrink: 0, minWidth: 52, textAlign: "center" }}>{e.source}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.8)" }} title={ACTIVITY_VERB[e.source](e)}>
            {ACTIVITY_VERB[e.source](e)}
          </span>
          <span style={{ flexShrink: 0, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{relTime(e.at)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Widget: Campañas · Copywriting (REQ-CW2, list_campaign_report) ──
// El MISMO agregador que la vista Reportes (buildCampaignReport): el home no
// recalcula nada — cero drift entre widget, tool y pane.
const compactNum = new Intl.NumberFormat("es-CR", { notation: "compact", maximumFractionDigits: 1 });
function CampaignsWidget(props: { workspaceId: string; onNavigate: (tab: any, pane?: string) => void }) {
  const w = useMcpWidget<CampaignPayload>(
    () => mcpCall("list_campaign_report", { workspaceId: props.workspaceId }),
    [props.workspaceId],
  );
  const campaigns = (w.data?.campaigns || []).slice(0, 6);
  const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={cardTitleStyle}>Campañas · Copywriting</div>
        <button type="button" style={ghostBtnStyle} onClick={() => props.onNavigate("copywriting", "reports")}>Reportes</button>
      </div>
      {w.loading ? <div style={{ minHeight: 190 }}><SkeletonRows rows={5} /></div> : w.error ? <WidgetError message={w.error} onRetry={w.reload} /> : campaigns.length === 0 ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Sin campañas con piezas todavía.</div>
      ) : campaigns.map(c => (
        <div key={c.name} style={{ fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.85)" }} title={c.name}>
              {c.name}
            </span>
            <span style={chipStyle}>{c.piezas} pzas</span>
            <span style={{ flexShrink: 0, color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }} title="Impresiones reales">
              {compactNum.format(c.realImpr || 0)} impr
            </span>
            <span style={{ flexShrink: 0, width: 46, textAlign: "right", color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }} title="Avance de inversión">
              {pct(c.avanceSpend)} $
            </span>
          </div>
          {c.isBenchmark && c.winnerTopic ? (
            <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={`Ganadora provisional por impresiones reales: ${c.winnerTopic}`}>
              🏆 {c.winnerTopic}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── Componente raíz del tab Inicio ──
export function HomeDashboard(props: {
  workspaceId?: string;
  onOpenDesign: () => void;
  onNavigate: (tab: any, pane?: string) => void;
  /** Icon-nav de las vistas de Inicio (Dashboard/Kanban/Tabla): el shell lo
   *  inyecta para que esta tarjeta lleve las mismas pestañas que Kanban. */
  headerNav?: JSX.Element;
}) {
  const { workspaceId, onOpenDesign, onNavigate, headerNav } = props;
  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const [reportState, setReportState] = useState<"" | "working" | "done" | "error">("");
  const reportRef = useRef<HTMLDivElement>(null);

  // Saludo por franja horaria — trivial, real, sin datos falsos.
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 13) return "Buenos días";
    if (h < 20) return "Buenas tardes";
    return "Buenas noches";
  }, []);

  const summary = useMcpWidget<Summary>(
    () => mcpCall("get_dashboard_summary", { workspaceId, range }),
    [workspaceId, range],
  );
  const k = summary.data?.kpis;

  // REQ-DASH6: 1 click → PNG del dashboard + CSV de piezas/métricas.
  const exportReport = useCallback(async () => {
    if (!summary.data || reportState === "working") return;
    setReportState("working");
    try {
      const stamp = isoWeek();
      const s = summary.data;
      // CSV: KPIs con desglose por marca + funnel + piezas de la semana.
      const kpiRows: Array<Record<string, unknown>> = [];
      const pushKpi = (metric: string, byBrand: ByBrand[], total: number | string) => {
        kpiRows.push({ metric, total, marca: "(todas)", count: "", value: "" });
        for (const b of byBrand) kpiRows.push({ metric, total: "", marca: b.brandName, count: b.count, value: b.value });
      };
      pushKpi("piezas_publicadas", s.kpis.publishedPieces.byBrand, s.kpis.publishedPieces.total);
      pushKpi("leads_capturados", s.kpis.leadsCaptured.byBrand, s.kpis.leadsCaptured.total);
      pushKpi("pipeline_abierto", s.kpis.pipelineValue.byBrand, s.kpis.pipelineValue.total);
      pushKpi("deals_abiertos", s.kpis.openDeals.byBrand, s.kpis.openDeals.total);
      // El funnel vive en list_crm_deals (byStage); el export trae su propia
      // copia — export es esporádico y el widget sigue autónomo.
      const deals = await mcpCall("list_crm_deals", { workspaceId, openOnly: true, limit: 1 }) as DealsPayload;
      const funnelRows = OPEN_STAGES.map(st => ({
        stage: STAGE_LABEL[st] || st,
        count: deals.byStage?.[st]?.count ?? 0,
        value: deals.byStage?.[st]?.value ?? 0,
      }));
      const csv = toCsv([
        { name: "KPIs", rows: kpiRows },
        { name: "Funnel", rows: funnelRows },
      ]);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `musa-reporte-${stamp}.csv`);
      // PNG del área de widgets (html2canvas, precedido por BugReportButton).
      if (reportRef.current) {
        const canvas = await html2canvas(reportRef.current, { backgroundColor: "#0b0d14", scale: 2, logging: false });
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
        if (blob) downloadBlob(blob, `musa-reporte-${stamp}.png`);
      }
      setReportState("done");
      setTimeout(() => setReportState(""), 2500);
    } catch {
      setReportState("error");
      setTimeout(() => setReportState(""), 4000);
    }
  }, [summary.data, reportState, workspaceId]);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14,
      padding: "20px 20px 0", overflowY: "auto",
    }}>
      {/* Tarjeta de ENTRADA: saludo + nav de vistas, nada más. Los controles del
          contenido (rango, reporte, Diseño) son contenido de la sub-sección —
          viven en la toolbar de abajo, no aquí. */}
      <div className="crm-table-card crm-contacts-top" style={{ flexShrink: 0 }}>
        <header className="crm-contacts-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400,
              color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em", marginBottom: 2,
            }}>
              {greeting}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
              Dashboard ejecutivo — piezas, pipeline, kanban y acciones pendientes.
            </div>
          </div>
          {/* Vistas de Inicio (Dashboard/Kanban/Tabla) — el mismo tablist de
              íconos que llevan las tarjetas CRM; aquí con Dashboard activa.
              Sin headerNav (usos sueltos) no se pinta. */}
          {headerNav}
        </header>
      </div>

      {/* Toolbar de contenido: primera fila debajo de la tarjeta de entrada. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        {/* Rango: solo re-toma get_dashboard_summary (1 llamada, byBrand inline). */}
        {(["7d", "30d", "90d"] as const).map(r => (
          <button key={r} type="button" onClick={() => setRange(r)} style={{
            ...ghostBtnStyle,
            borderColor: range === r ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.14)",
            color: range === r ? "#c4b5fd" : "rgba(255,255,255,0.55)",
            fontWeight: range === r ? 600 : 400,
          }}>{r}</button>
        ))}
        <button type="button" onClick={exportReport} disabled={!summary.data || reportState === "working"}
          title="Descarga PNG del dashboard + CSV de métricas"
          style={{ ...ghostBtnStyle, opacity: !summary.data || reportState === "working" ? 0.5 : 1 }}>
          {reportState === "working" ? "Generando…" : reportState === "done" ? "Listo" : reportState === "error" ? "Error al exportar" : "Reporte semanal"}
        </button>
        <button type="button" className="liquid-glass" onClick={onOpenDesign} title="Ir a Diseño"
          style={{
            borderRadius: 100, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, color: "#fff", marginLeft: "auto",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none",
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
          </svg>
          Abrir Diseño
        </button>
      </div>

      {/* Contenido — shell-first: la misma concha (grillas con forma final)
          existe desde el primer frame; skeletons con la silueta de cada widget
          evitan que la UI se reacomode cuando los datos aterrizan. */}
      {!workspaceId ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
            <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ ...cardStyle, minHeight: 180 }}>
                <SkeletonBar w={110} h={9} />
                <div style={{ marginTop: 10 }}><SkeletonRows rows={4} /></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div ref={reportRef} style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 20 }}>
          {/* KPIs (REQ-DASH1): cada métrica con su desglose por marca inline.
              Al cambiar de rango las tarjetas previas se quedan puestas hasta
              que aterrizan las nuevas (data no se limpia durante la recarga). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
            {!k ? (
              summary.error ? (
                <div style={{ ...cardStyle, gridColumn: "1 / -1" }}><WidgetError message={summary.error} onRetry={summary.reload} /></div>
              ) : (
                <><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></>
              )
            ) : (
              <>
                <KpiCard label="Piezas publicadas" total={k.publishedPieces.total} sub={byBrandText(k.publishedPieces.byBrand)} />
                <KpiCard label="Leads capturados" total={k.leadsCaptured.total} sub={byBrandText(k.leadsCaptured.byBrand)} />
                <KpiCard label="Pipeline abierto" total={money(k.pipelineValue.total, k.pipelineValue.currency)} sub={byBrandText(k.pipelineValue.byBrand, true)} />
                <KpiCard label="Deals abiertos" total={k.openDeals.total} sub={byBrandText(k.openDeals.byBrand)} />
              </>
            )}
          </div>

          {/* Widgets: fuentes distintas, errores aislados por tarjeta. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
            <UpcomingWidget workspaceId={workspaceId} onNavigate={onNavigate} />
            <CampaignsWidget workspaceId={workspaceId} onNavigate={onNavigate} />
            <PendingWidget workspaceId={workspaceId} onNavigate={onNavigate} />
            <FunnelWidget workspaceId={workspaceId} onNavigate={onNavigate} />
            <ActivityWidget workspaceId={workspaceId} />
          </div>
        </div>
      )}
    </div>
  );
}
