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

/** REQ Planilla v2: conversiones esperadas que alimenta la Atribución. La UI
 *  las sugiere (datalist) pero acepta texto libre — el objetivo a veces lleva
 *  nota ("DM con el CTO"). La misma lista vive en la descripción del schema
 *  MCP de add_content_idea/update_content. */
export const CONVERSION_GOALS = [
  "DM", "Comentar", "Agendar", "Link en bio", "Descargar", "Seguir",
] as const;

export type ContentStatus = typeof CONTENT_STATUSES[number];
export type PublishingStatus = "borrador" | "programado" | "publicando" | "publicado" | "error";
export { zonedDateTimeToIso, zernioScheduledFor } from "../../shared/socialSchedule.ts";

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
  // REQ Planilla v2: la dirección viaja con la pieza. Vacío = la IA decide
  // con el contexto; lleno = la IA obedece (aunque el copy sugiera otra cosa).
  // visual_type es una key del catálogo (src/components/chartCatalog.tsx).
  icp?: string | null;
  conversion_goal?: string | null;
  visual_type?: string | null;
  template_id?: string | null;
  /** REQ-023: the exact frame inside template_id's file. A grid is one file
   *  with several designs side by side; the file alone cannot say which art
   *  is this piece's. */
  frame_id?: string | null;
  asset_id?: string | null;
  external_url?: string | null;
  permalink?: string | null;
  publishing_status?: PublishingStatus;
  publishing_provider?: string | null;
  publishing_channels?: string[];
  publishing_scheduled_for?: string | null;
  publishing_timezone?: string | null;
  publishing_external_id?: string | null;
  publishing_request_id?: string | null;
  publishing_error?: string | null;
  publishing_platform_urls?: Record<string, string>;
  // ── Display-only, resolved at render time ─────────────────────────────
  // The sheet and the exports show NAMES ("Archivo", "Diseño"), not ids — a
  // client-facing grid that says "tpl_a83f…" is not a grid anyone can read.
  // Resolved client-side from the workspace's file list and each file's
  // frames, so exports stay pure functions of the rows plus these names.
  template_name?: string | null;
  frame_name?: string | null;
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

/**
 * How far along a metric is against its plan, as a fraction. This is the
 * "AVANCE" band of the agency report, and it is the number a client actually
 * reads first: 0.31 means a third of the budget is spent.
 */
export function pacing(actual: number | undefined, planned: number | undefined): number | null {
  if (!planned || planned <= 0) return null;
  return (actual || 0) / planned;
}

// ── Filters ────────────────────────────────────────────────────────────────

export interface ContentFilters {
  from?: string;      // YYYY-MM-DD inclusive
  to?: string;        // YYYY-MM-DD inclusive
  /** Single brand kept for backward compatibility; brandIds wins when set. */
  brandId?: string;
  /** Multi-brand pick: a corp group reviews several brands in one view. */
  brandIds?: string[];
  kind?: ContentKind | "";
  campaign?: string;
  channel?: string;
}

/**
 * Every filter narrows the last, none replaces it — an AND, not a switch.
 * That is the whole point: "Acelera, ads, marzo" is one question, and being
 * able to ask it is the difference between a report tool and a list.
 *
 * A blank filter is absent rather than a value to match, so an empty brand box
 * means "any brand", never "the brand whose name is empty string".
 */
export function applyFilters(rows: ContentRow[], f: ContentFilters): ContentRow[] {
  const brandIds = (f.brandIds && f.brandIds.length > 0 ? f.brandIds : undefined)
    ?? (f.brandId ? [f.brandId] : undefined);
  return rows.filter(r => {
    if (f.from && (r.scheduled_date || "") < f.from) return false;
    if (f.to && (r.scheduled_date || "") > f.to) return false;
    if (brandIds && !(r.brand_id && brandIds.includes(r.brand_id))) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.campaign && (r.campaign || "").trim().toLowerCase() !== f.campaign.trim().toLowerCase()) return false;
    if (f.channel && !(r.channels || []).includes(f.channel)) return false;
    return true;
  });
}

/** Human summary of what is currently narrowed, for the export's own header. */
export function describeFilters(f: ContentFilters): string {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`Periodo ${f.from || "inicio"} a ${f.to || "hoy"}`);
  const brandIds = f.brandIds?.length ? f.brandIds : f.brandId ? [f.brandId] : [];
  if (brandIds.length > 1) parts.push(`${brandIds.length} marcas`);
  if (f.kind) parts.push(KIND_LABEL[f.kind as ContentKind]);
  if (f.campaign) parts.push(`Campaña ${f.campaign}`);
  if (f.channel) parts.push(`Canal ${f.channel}`);
  return parts.length ? parts.join(" · ") : "Sin filtros";
}

// ── Export ─────────────────────────────────────────────────────────────────

/** Columns an exported report carries, in the order an agency reads them. */
export const EXPORT_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "scheduled_date", label: "Fecha" },
  { key: "scheduled_time", label: "Hora" },
  { key: "kind", label: "Tipo" },
  { key: "brandName", label: "Marca" },
  { key: "campaign", label: "Campaña" },
  { key: "ad_set", label: "Conjunto de anuncios" },
  { key: "topic", label: "Tema" },
  { key: "copy", label: "Copy" },
  { key: "icp", label: "Segmento ICP" },
  { key: "conversion_goal", label: "Acción / Objetivo" },
  { key: "visual_type", label: "Tipo de gráfico" },
  { key: "channels", label: "Canales" },
  { key: "status", label: "Estado" },
  { key: "plan_spend", label: "PROY Inversión" },
  { key: "plan_impressions", label: "PROY Impresiones" },
  { key: "plan_reach", label: "PROY Alcance" },
  { key: "plan_clicks", label: "PROY Clics" },
  { key: "plan_views", label: "PROY Views" },
  { key: "actual_spend", label: "REAL Inversión" },
  { key: "actual_impressions", label: "REAL Impresiones" },
  { key: "actual_reach", label: "REAL Alcance" },
  { key: "actual_clicks", label: "REAL Clics" },
  { key: "actual_views", label: "REAL Views" },
  { key: "avance_spend", label: "AVANCE Inversión" },
  { key: "avance_impressions", label: "AVANCE Impresiones" },
  // REQ-023: what the sheet shows as Archivo/Diseño, by name. The export
  // carries every column the UI has — an export that drops some is the one
  // the client asks to be re-sent as a screenshot.
  { key: "template_name", label: "Archivo" },
  { key: "frame_name", label: "Diseño" },
  { key: "permalink", label: "Enlace publicado" },
];

const cell = (row: any, key: string): string => {
  if (key === "channels") return (row.channels || []).join(", ");
  if (key === "kind") return KIND_LABEL[row.kind as ContentKind] || String(row.kind ?? "");
  if (key === "avance_spend") {
    const p = pacing(row.actual_spend, row.plan_spend);
    return p === null ? "" : String(p);
  }
  if (key === "avance_impressions") {
    const p = pacing(row.actual_impressions, row.plan_impressions);
    return p === null ? "" : String(p);
  }
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
};

/** Rows as a matrix — the one shape both CSV and the sheet writer need. */
export function toExportMatrix(rows: ContentRow[]): { headers: string[]; body: string[][] } {
  return {
    headers: EXPORT_COLUMNS.map(c => c.label),
    body: rows.map(r => EXPORT_COLUMNS.map(c => cell(r, c.key))),
  };
}

const csvQuote = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function toCSVExport(rows: ContentRow[]): string {
  const { headers, body } = toExportMatrix(rows);
  return [headers, ...body].map(line => line.map(csvQuote).join(",")).join("\n") + "\n";
}

/**
 * A SpreadsheetML 2003 workbook — XML that Excel and Sheets both open as a
 * real sheet, with no library and no server round trip. A .xlsx is a ZIP, and
 * shipping a zip writer to the browser to emit one table is not worth the
 * bytes when this opens in the same double-click.
 */
export function toExcelXml(rows: ContentRow[], title = "Reporte"): string {
  const { headers, body } = toExportMatrix(rows);
  const esc = (v: string) => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // A value Excel should treat as a number must be typed as one, or the whole
  // column arrives as text and no formula in the report can sum it.
  const cellXml = (v: string) => {
    const isNumber = v !== "" && /^-?\d+(\.\d+)?$/.test(v);
    return isNumber
      ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  };
  const row = (cells: string) => `<Row>${cells}</Row>`;
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${esc(title).slice(0, 31)}">
  <Table>
   ${row(headers.map(h => `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>`).join(""))}
   ${body.map(line => row(line.map(cellXml).join(""))).join("\n   ")}
  </Table>
 </Worksheet>
</Workbook>`;
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

// ── Import: the template, its parser, and the row mapper ──────────────────

const stripAccents = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (v: unknown) => stripAccents(String(v ?? "").trim().toLowerCase());

/** RFC-4180 enough: quoted fields, "" escapes, CRLF, Excel's BOM. Pure, so
 *  QA can hammer it without a DOM — a broken parser here eats someone's work. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = "";
    // A line of pure emptiness is a blank line, not a row of one empty cell.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Planning columns a fresh template carries. Deliberately narrower than
 *  EXPORT_COLUMNS — a human filling new content should not face the report
 *  columns — while the importer still accepts full exports, ignoring extras. */
export const IMPORT_COLUMNS = [
  "Fecha", "Hora", "Tipo", "Marca", "Campaña",
  "Conjunto de anuncios", "Tema", "Copy",
  "Segmento ICP", "Acción / Objetivo", "Tipo de gráfico",
  "Canales", "Estado",
] as const;

/** Header row + one worked example — a template without an example invites
 *  wrong formats, and a wrong format becomes a silent empty calendar. */
export function toImportTemplate(): string {
  const example = [
    "2026-09-10", "09:00", "Orgánico", "Mi marca", "Lanzamiento",
    "", "Idea del post", "Aquí va el copy completo…",
    "COO biotech", "Agendar", "timeline", "Instagram, LinkedIn", "idea",
  ];
  return [IMPORT_COLUMNS as readonly string[], example]
    .map(line => line.map(csvQuote).join(",")).join("\n") + "\n";
}

const KIND_ALIASES: Record<string, ContentKind> = {
  "organico": "organic", "organic": "organic",
  "ad": "ad", "anuncio": "ad", "pauta": "ad",
};

const STATUS_ALIASES: Record<string, ContentStatus> = {};
for (const status of CONTENT_STATUSES) STATUS_ALIASES[norm(status)] = status;

/** Spanish header (or alias) → the field the import API accepts. The export's
 *  own labels are aliases by construction, so export → edit → import
 *  round-trips without anyone retyping a header. */
const IMPORT_ALIASES: Record<string, string> = {
  "fecha": "scheduled_date", "dia": "scheduled_date",
  "hora": "scheduled_time",
  "tipo": "kind",
  "marca": "brand",
  "campana": "campaign",
  "conjunto de anuncios": "ad_set",
  "tema": "topic",
  "copy": "copy",
  "segmento icp": "icp", "icp": "icp", "segmento": "icp",
  // El slash sobrevive a norm() — el header del propio template es
  // "Acción / Objetivo", así que su variante con slash debe mapear sí o sí.
  "accion / objetivo": "conversion_goal", "objetivo": "conversion_goal",
  "accion": "conversion_goal", "conversion": "conversion_goal",
  "tipo de grafico": "visual_type", "grafico": "visual_type", "visual": "visual_type",
  "canales": "channels",
  "estado": "status",
  "proy inversion": "plan_spend",
  "proy impresiones": "plan_impressions",
  "proy alcance": "plan_reach",
  "proy clics": "plan_clicks",
  "proy views": "plan_views",
};

export interface ContentImportResult {
  /** Bodies ready for POST /api/content/import. */
  rows: Array<Record<string, unknown>>;
  /** Recovered judgment calls: unknown brands and channels, unknown labels. */
  warnings: string[];
  /** Unrecoverable rows, with their file line so the human can fix them. */
  errors: string[];
}

const IMPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns a CSV — the template or a real export, extras ignored — into import
 * bodies. Matching is accent- and case-insensitive because the export itself
 * writes "Orgánico" and "Diseño"; a round trip must not depend on the user
 * retyping accents correctly.
 */
export function mapContentImport(text: string, brands: Array<{ id: string; name: string }>): ContentImportResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], warnings: [], errors: ["El archivo está vacío"] };
  const columns = table[0].map(cellValue => IMPORT_ALIASES[norm(cellValue)] || null);
  if (!columns.some(Boolean)) {
    return {
      rows: [], warnings: [],
      errors: ["Encabezados no reconocidos — descarga la plantilla (⇩ Plantilla) y respeta sus columnas"],
    };
  }
  const brandByName = new Map(brands.map(b => [norm(b.name), b.id]));
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const number = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  for (let i = 1; i < table.length; i++) {
    const line = table[i];
    const lineNo = i + 1; // header is line 1
    const body: Record<string, unknown> = {};
    let hasContent = false;
    let validDate: string | null = null;
    columns.forEach((field, col) => {
      const raw = (line[col] ?? "").trim();
      if (!field || raw === "") return;
      hasContent = true;
      if (field === "scheduled_date") {
        if (IMPORT_DATE_RE.test(raw) && !Number.isNaN(new Date(`${raw}T12:00:00`).getTime())) {
          validDate = raw;
        }
        return;
      }
      if (field === "scheduled_time") {
        const match = raw.match(/^(\d{1,2}):(\d{2})/);
        if (match) body.scheduled_time = `${match[1].padStart(2, "0")}:${match[2]}`;
        return;
      }
      if (field === "kind") {
        const kind = KIND_ALIASES[norm(raw)];
        if (kind) body.kind = kind;
        else warnings.push(`Fila ${lineNo}: tipo «${raw}» no reconocido, se importó como Orgánico`);
        return;
      }
      if (field === "status") {
        const status = STATUS_ALIASES[norm(raw)];
        if (status) body.status = status;
        else warnings.push(`Fila ${lineNo}: estado «${raw}» no reconocido, quedó como idea`);
        return;
      }
      if (field === "brand") {
        const id = brandByName.get(norm(raw)) || null;
        if (id) body.brand_id = id;
        else warnings.push(`Fila ${lineNo}: la marca «${raw}» no existe en este workspace, quedó sin marca`);
        return;
      }
      if (field === "channels") {
        const list: string[] = [];
        for (const part of raw.split(/[,;]/).map(p => p.trim()).filter(Boolean)) {
          const channel = CHANNELS.find(c => norm(c) === norm(part));
          if (channel) list.push(channel);
          else warnings.push(`Fila ${lineNo}: canal «${part}» no reconocido, se omitió`);
        }
        if (list.length) body.channels = [...new Set(list)];
        return;
      }
      if (field.startsWith("plan_")) {
        const value = number(raw);
        if (value !== null) body[field] = value;
        return;
      }
      body[field] = raw;
    });
    if (!hasContent) continue; // blank padding line
    if (!validDate) {
      errors.push(`Fila ${lineNo}: fecha inválida o faltante (usa AAAA-MM-DD), la fila se omitió`);
      continue;
    }
    rows.push({ scheduled_date: validDate, ...body });
  }
  return { rows, warnings, errors };
}
