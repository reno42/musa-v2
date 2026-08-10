/**
 * Content calendar — the vocabulary, and the shapes the two views need.
 *
 * Pure on purpose so QA can cover it without a DOM or a database. The report
 * side of this file encodes the column names Meta actually exports and the
 * bands a media agency actually reports in; both were read off the real files
 * (IPG / Santander), not invented.
 */

export type ContentKind = "organic" | "ad";

export const CONTENT_KINDS: ContentKind[] = ["organic", "ad"];

export const KIND_LABEL: Record<ContentKind, string> = {
  organic: "Orgánico",
  ad: "Ad",
};

/** Where a piece of content can go out. */
export const CHANNELS = [
  "Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube", "X", "WhatsApp", "Email", "Web",
] as const;
export type Channel = typeof CHANNELS[number];

/** The states a piece moves through. Mirrors the kanban's columns. */
export const CONTENT_STATUSES = ["idea", "diseño", "aprobación", "programado", "publicado"] as const;
export type ContentStatus = typeof CONTENT_STATUSES[number];

export interface ContentRow {
  id: string;
  scheduled_date: string;        // YYYY-MM-DD
  scheduled_time?: string | null;
  topic?: string | null;
  copy?: string | null;
  kind: ContentKind;
  channels: string[];
  status: ContentStatus;
  brand_id?: string | null;
  brandName?: string | null;
  campaign?: string | null;
  ad_set?: string | null;
  template_id?: string | null;
  asset_id?: string | null;
  external_url?: string | null;
  permalink?: string | null;
}

// ── Calendar layout ────────────────────────────────────────────────────────

export interface CalendarCell {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  items: ContentRow[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in LOCAL time. toISOString() would shift the day for anyone
 *  west of UTC — a post scheduled for the 1st showing up on the 31st. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Builds a month grid, Monday-first, padded to whole weeks so the calendar is
 * always a clean rectangle. Every row is placed on its scheduled date; a date
 * outside the visible range is simply not shown rather than clamped into an
 * edge cell, which would misreport when the work is due.
 */
export function buildMonthGrid(year: number, month: number, rows: ContentRow[], today = new Date()): CalendarCell[] {
  const byDate = new Map<string, ContentRow[]>();
  for (const row of rows) {
    if (!row.scheduled_date) continue;
    if (!byDate.has(row.scheduled_date)) byDate.set(row.scheduled_date, []);
    byDate.get(row.scheduled_date)!.push(row);
  }
  // Earlier in the day first; anything without a time sorts after, because an
  // unscheduled hour is less certain than a scheduled one.
  for (const list of byDate.values()) {
    list.sort((a, b) => (a.scheduled_time || "99:99").localeCompare(b.scheduled_time || "99:99"));
  }

  const first = new Date(year, month, 1);
  // getDay() is Sunday-0; this calendar starts on Monday, as a work week does.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const todayIso = isoDate(today);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const date = isoDate(d);
    cells.push({
      date,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: date === todayIso,
      items: byDate.get(date) || [],
    });
    // Stop at the end of the week that contains the last day of the month.
    if (i >= 27 && d.getMonth() !== month && (i + 1) % 7 === 0) break;
  }
  return cells;
}

/** Groups rows by campaign, leaving the ones with none loose — the same rule
 *  the brand graph uses, so the two views agree about what "organised" means. */
export function groupByPlan(rows: ContentRow[]): {
  campaigns: Map<string, ContentRow[]>;
  loose: ContentRow[];
} {
  const campaigns = new Map<string, ContentRow[]>();
  const loose: ContentRow[] = [];
  for (const row of rows) {
    const name = (row.campaign || "").trim();
    if (!name) { loose.push(row); continue; }
    if (!campaigns.has(name)) campaigns.set(name, []);
    campaigns.get(name)!.push(row);
  }
  return { campaigns, loose };
}

// ── Meta ads reporting ─────────────────────────────────────────────────────

/**
 * Meta's export column names, in Spanish, exactly as Ads Manager writes them.
 * Read off the real files rather than guessed: an export whose headers do not
 * match is an export we silently misread.
 */
export const META_COLUMNS = {
  campaign: "Nombre de la campaña",
  adSet: "Nombre del conjunto de anuncios",
  ad: "Nombre del anuncio",
  spend: "Importe gastado (USD)",
  impressions: "Impresiones",
  reach: "Alcance",
  cpm: "CPM (costo por mil impresiones)",
  frequency: "Frecuencia",
  linkClicks: "Clics en el enlace",
  cpc: "CPC (costo por clic en el enlace)",
  ctr: "CTR (porcentaje de clics en el enlace)",
  results: "Resultados",
  costPerResult: "Costo por resultado",
  resultType: "Tipo de resultado",
  thruPlays: "ThruPlays",
  videoTo100: "Reproducciones de video hasta el 100%",
  start: "Inicio del informe",
  end: "Fin del informe",
} as const;

/** The metrics an agency report carries on both the plan and the actual side. */
export const REPORT_METRICS = [
  { key: "spend", label: "Inversión" },
  { key: "impressions", label: "Impresiones" },
  { key: "reach", label: "Alcance" },
  { key: "frequency", label: "Frecuencia" },
  { key: "cpm", label: "CPM" },
  { key: "clicks", label: "Clics" },
  { key: "cpc", label: "CPC" },
  { key: "ctr", label: "CTR" },
  { key: "views", label: "Views 100%" },
  { key: "cpv", label: "CPV" },
] as const;
export type ReportMetric = typeof REPORT_METRICS[number]["key"];

export type MetricTotals = Partial<Record<ReportMetric, number>>;

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const parsed = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Sums a Meta export into plan-comparable totals.
 *
 * Rates are recomputed from their components rather than averaged. Averaging
 * CPM across rows weights a 300-impression ad the same as a 300,000-impression
 * one and produces a number that is not any real cost — the single most common
 * way these reports lie.
 */
export function summarizeMetaRows(rows: Record<string, unknown>[]): MetricTotals {
  let spend = 0, impressions = 0, reach = 0, clicks = 0, views = 0;
  for (const r of rows) {
    spend += num(r[META_COLUMNS.spend]);
    impressions += num(r[META_COLUMNS.impressions]);
    reach += num(r[META_COLUMNS.reach]);
    clicks += num(r[META_COLUMNS.linkClicks]);
    views += num(r[META_COLUMNS.videoTo100]);
  }
  return {
    spend, impressions, reach, clicks, views,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpv: views > 0 ? spend / views : 0,
    // Reach is deduplicated by Meta per row, so summing it overcounts people
    // seen by more than one ad. Frequency from the sum is therefore a floor.
    frequency: reach > 0 ? impressions / reach : 0,
  };
}

/**
 * How far along a metric is against its plan, as a fraction. This is the
 * "AVANCE" band of the agency report, and it is the number a client actually
 * reads first: 0.31 means a third of the budget is spent.
 */
export function pacing(actual: number | undefined, planned: number | undefined): number | null {
  if (!planned || planned <= 0) return null;
  return (actual || 0) / planned;
}
