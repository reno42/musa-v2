/**
 * Content — the calendar, the sheet, and the report, over one table.
 *
 * Three views of `content_calendar`, not three datasets. The calendar is what
 * you look at to plan a week; the sheet is what you fill in; the report is
 * what the client reads. They disagree only in shape.
 *
 * The shell follows the v54 shared hierarchy — glass header card with a serif
 * title per sub-section and the CRM icon nav, like CRM/Agentes — while the
 * panes keep the brand-table language (black, white text, no chrome): these
 * are the places this product asks someone to do data entry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { downloadBlob } from "../lib/download";
import { extractFrameTextBlocks, rasterizeFrame, rasterizeFrameWithoutText, type PptTextBlock } from "../lib/frameCapture";
import { useAuth } from "../lib/auth";
import {
  CHANNELS, CONTENT_KINDS, CONTENT_STATUSES, KIND_LABEL,
  applyFilters, buildMonthGrid, describeFilters, groupByPlan, isoDate, mapContentImport, pacing,
  toCSVExport, toExcelXml, toImportTemplate, zernioScheduledFor, type ContentFilters, type ContentRow,
} from "../lib/contentCalendar";
import { TextsTab } from "./TextsTab";
import { prepareSocialMedia } from "../../shared/socialPublishRequest.ts";
import { CopyRecipesTab } from "./CopyRecipesTab";
import { SOCIAL_CAPABILITIES, platformToChannel, publishProviderOrder, type SocialCapabilities, type SocialProviderId } from "../../shared/socialProviders.ts";

type Pane = "calendar" | "sheet" | "reports" | "copies" | "recipes" | "inbox";
const PANES: readonly Pane[] = ["calendar", "sheet", "reports", "copies", "recipes", "inbox"];

/** v54 shared hierarchy — one glass header card for the whole section, with a
 *  serif title + descriptor per sub-section and the CRM icon nav. Same
 *  language as the CRM and Agentes tabs: the shell is chrome, the panes below
 *  stay dense data-entry tables. */
const PANE_META: Record<Pane, { label: string; title: string; description: string; icon: JSX.Element }> = {
  calendar: {
    label: "Calendario",
    title: "Calendario de contenido",
    description: "El mes de un vistazo: arrastra una pieza a otro día para reprogramarla y usa el + para agregar contenido ese día.",
    icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="1.5" /><path d="M4 10h16M8.5 3.5V7M15.5 3.5V7" /></svg>),
  },
  sheet: {
    label: "Contenidos",
    title: "Planilla de contenidos",
    description: "Todas las piezas en filas editables: filtra por marca, canal o campaña y lleva el plan a CSV, Excel, PPT o la plantilla de carga.",
    icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 10.5h16M10 10.5V19" /></svg>),
  },
  reports: {
    label: "Reportes",
    title: "Reportes de campaña",
    description: "Lo que el cliente lee: proyección contra resultados por campaña, con CPM, CTR y avance, exportable en un click.",
    icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 20v-7M12 20V5M19 20v-11" /></svg>),
  },
  copies: {
    label: "Copys",
    title: "Biblioteca de textos",
    description: "Los textos vivos de tus plantillas: sincroniza, busca por marca o campaña y edita el copy de cada frame sin abrir el editor.",
    icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.5 4h7l4 4v11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 4.5V9h4.5M10 13h4.5M10 16.5h4.5" /></svg>),
  },
  recipes: {
    label: "Recetas",
    title: "Recetas de copywriting",
    description: "Hooks, tonos y frameworks de escritura: la misma tabla que los agentes leen vía MCP al redactar los copies del calendario.",
    icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21l-5.5-3-5.5 3z" /></svg>),
  },
  inbox: {
    label: "Bandeja",
    title: "Bandeja de entrada social",
    description: "Mensajes y comentarios que llegan por Zernio: responde desde acá y captura a la persona directamente en el CRM.",
    icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13.5 6.3 6.2A1.5 1.5 0 0 1 7.7 5h8.6a1.5 1.5 0 0 1 1.4 1.2L20 13.5" /><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20v4a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /></svg>),
  },
};

/** Short single-block label for the date-range chip: "9 ago – 5 sept.",
 *  "desde 9 ago", "hasta 5 sept." or "Fechas" when empty. */
function rangeLabel(from: string, to: string): string {
  const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });
  if (from && to) {
    const a = fmt(from);
    const b = fmt(to);
    return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(" ")[0]}–${b}` : `${a} – ${b}`;
  }
  if (from) return `desde ${fmt(from)}`;
  if (to) return `hasta ${fmt(to)}`;
  return "Fechas";
}

interface Props {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
  /** Landing pane requested from outside — the editor menu's "Recetas" and the
   *  URL hash name it, but the dashboard can only hand it down as a prop
   *  because these sub-tabs are this component's own state. */
  paneHint?: string;
  /** The Configuración tab's own route — the Conexiones popover fixes a
   *  missing key inline and hands off here for accounts and webhook secret. */
  onOpenSettings?: () => void;
  /** Fired on every in-page pane switch so the dashboard can keep the URL
   *  segment and the nav's "last visited" landing in sync with this state. */
  onPaneChange?: (pane: string) => void;
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
/* Toolbar kit — same visual language as crm-inline-filter/crm-clear-filters
   for the controls the CRM kit has no class for (dates, text, action chips). */
.ct-input { min-height: 34px; border: 1px solid #3f3f46; border-radius: 9px; background: #18181b; color: #e4e4e7; padding: 6px 10px; font: inherit; font-size: 12px; }
.ct-input:focus { border-color: #71717a; outline: none; }
.ct-chip { min-height: 34px; border: 0; border-radius: 8px; background: #27272a; color: #d4d4d8; padding: 7px 11px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: background .2s ease, color .2s ease; }
.ct-chip:hover { background: #3f3f46; color: #fff; }
.ct-chip:disabled { opacity: .5; cursor: default; }
/* Notion-style detail peek: the row hover "Abrir" affordance and the
   right-side panel both views open (card click, row click, or the button). */
.ct-cell-tema { position: relative; }
.ct-row-open {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  opacity: 0; pointer-events: none; transition: opacity .12s ease;
  padding: 2px 9px; border: 1px solid #3f3f46; border-radius: 6px;
  background: #27272a; color: #d4d4d8; font: inherit; font-size: 10px;
  font-weight: 700; letter-spacing: .06em; text-transform: uppercase; cursor: pointer;
}
.ct tbody tr:hover .ct-row-open { opacity: 1; pointer-events: auto; }
.ct-row-open:hover { background: #3f3f46; color: #fff; }
.ct-peek-backdrop { position: fixed; inset: 0; z-index: 990; background: rgba(5,7,12,0.38); animation: ct-fade .16s ease; }
.ct-peek {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 991;
  width: min(620px, 100vw); overflow-y: auto; color: #fff;
  background: #101013; border-left: 1px solid rgba(255,255,255,0.12);
  box-shadow: -28px 0 56px rgba(0,0,0,0.5);
  animation: ct-slide-in .22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.ct-peek-title { width: 100%; background: transparent; border: 0; border-bottom: 1px solid transparent; color: #fff; font: inherit; font-size: 21px; font-weight: 700; padding: 2px 0; outline: none; }
.ct-peek-title:focus { border-bottom-color: rgba(255,255,255,0.3); }
.ct-peek-title::placeholder { color: rgba(255,255,255,0.3); }
.ct-prop-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: center; min-height: 34px; }
.ct-prop-row input:hover, .ct-prop-row select:hover { border-color: rgba(255,255,255,0.18); }
.ct-prop-label { font-size: 12px; color: rgba(255,255,255,0.5); }
.ct-channel-chip { border: 1px solid #3f3f46; border-radius: 999px; background: transparent; color: #a1a1aa; font: inherit; font-size: 11px; font-weight: 600; padding: 3px 10px; cursor: pointer; }
.ct-channel-chip.on { background: #fff; border-color: #fff; color: #000; }
@keyframes ct-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ct-slide-in { from { transform: translateX(32px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ct-peek-backdrop, .ct-peek { animation: none; } }
`;

/** A conversation row exactly as social_inbox stores it (v43 migration). */
interface InboxRow {
  id: string;
  kind: string;
  platform: string | null;
  author_name: string | null;
  author_handle: string | null;
  author_email: string | null;
  content: string | null;
  occurred_at: string | null;
  status: string;
  crm_contact_id: string | null;
}

interface SocialConn {
  id: string;
  provider: SocialProviderId;
  enabled: boolean;
  hasCredentials: boolean;
  capabilities: SocialCapabilities | null;
  /** Workspace defaults: one account per platform. */
  accounts: Record<string, string>;
  /** Per-brand destination picks: brandId → account ids. */
  brandAccounts: Record<string, string[]>;
  /** Cached provider account list — the picker renders without a live call. */
  knownAccounts: Array<Omit<SocialAccount, "provider">>;
}

/** One concrete destination account, tagged with its provider. */
interface SocialAccount {
  id: string;
  platform: string;
  username: string;
  displayName: string;
  isActive: boolean;
  provider: SocialProviderId;
}

/** Everything one publish/schedule run needs, resolved or to confirm. */
interface PublishDraft {
  mode: "now" | "schedule";
  contentType: "post" | "story" | "reel";
  date: string;
  time: string;
  timezone: string;
  provider: SocialProviderId | null;
  accountIds: string[];
  mediaUrl: string;
  /** Persist the picked accounts as this piece's brand default. */
  saveBrandDefault: boolean;
}

const CONTENT_TYPE_LABEL: Record<PublishDraft["contentType"], string> = {
  post: "Post", story: "Story", reel: "Reel",
};

const CAPABILITY_LABEL: Record<keyof SocialCapabilities, string> = {
  publish: "Publicar", schedule: "Programar", inbox: "Bandeja", crmCapture: "Captura CRM",
};

const PROVIDER_META: Record<SocialProviderId, { name: string; blurb: string }> = {
  buffer: {
    name: "Buffer",
    blurb: "Publica y programa posts. Con ambas llaves los posts salen por Buffer y no gastan créditos Zernio.",
  },
  zernio: {
    name: "Zernio",
    blurb: "Publica, programa y además trae la bandeja: responde mensajes y comentarios, y captura al CRM.",
  },
};

function inboxDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

export function ContentTab({ workspaceId, onOpenTemplate, paneHint, onOpenSettings, onPaneChange }: Props) {
  const [pane, setPane] = useState<Pane>("calendar");
  // Every in-page switch reports up (URL + nav memory) — except the paneHint
  // effect, whose value came FROM the URL in the first place.
  const changePane = (id: Pane) => {
    setPane(id);
    onPaneChange?.(id);
  };
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishMenuId, setPublishMenuId] = useState<string | null>(null);
  // Publish/schedule dialog: the piece it edits and the draft it confirms.
  // One dialog serves both views — the calendar always opens it because a
  // cell cannot show destinations; the table only opens it when data is
  // missing, otherwise Programar is a single click.
  const [publishRow, setPublishRow] = useState<ContentRow | null>(null);
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);
  // Notion-style peek panel: the id of the piece whose detail is open —
  // from a calendar card click or a sheet row click alike.
  const [peekId, setPeekId] = useState<string | null>(null);
  const [accountOptions, setAccountOptions] = useState<SocialAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Social: who is connected (the Conexiones popover badges it) and the
  // Bandeja pane's own data. Connections load once per workspace; the inbox
  // syncs on demand because each sync is a real call to Zernio.
  const [connections, setConnections] = useState<SocialConn[]>([]);
  const [publishProvider, setPublishProvider] = useState<SocialProviderId | null>(null);
  const [connOpen, setConnOpen] = useState(false);
  const [connBusy, setConnBusy] = useState<string | null>(null);
  const [connMsg, setConnMsg] = useState("");
  const [keyDraft, setKeyDraft] = useState<Partial<Record<SocialProviderId, string>>>({});
  const [inboxRows, setInboxRows] = useState<InboxRow[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<"todos" | "message" | "comment">("todos");
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [inboxBusy, setInboxBusy] = useState<string | null>(null);

  // Follow an outside landing request (editor menu → "Recetas"). Runs only
  // when the hint changes, so the user's own tab clicks are never undone.
  useEffect(() => {
    if (paneHint && PANES.includes(paneHint as Pane)) setPane(paneHint as Pane);
  }, [paneHint]);
  const [cursor, setCursor] = useState(() => new Date());
  const [filters, setFilters] = useState<ContentFilters>({});
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  // Multi-brand filter popover: a corp group reviews several brands at once.
  const [brandFilterOpen, setBrandFilterOpen] = useState(false);
  // v55 toolbar: one exports dropdown, one compact date-range block with its
  // own mini calendar (first click = desde, second = hasta), gear-only
  // Conexiones. All outside the header card, one single row.
  const [exportOpen, setExportOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeCursor, setRangeCursor] = useState(() => new Date());
  // Calendar drag & drop: which piece is being dragged, and which day cell
  // is currently highlighted as the drop target.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);

  const { user } = useAuth();

  // REQ-023: the workspace's design files, so the sheet's Archivo column is
  // a name a human recognises, and Diseño can pin the exact frame of a grid.
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  // frame list per linked file — loaded lazily, the first time some row
  // points at that file. State (not a ref) because the Diseño select renders it.
  const [framesByFile, setFramesByFile] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const frameFetchTried = useRef<Set<string>>(new Set());

  // PPT export: the popup defines the range and the brand first — nothing
  // downloads behind the user's back.
  const [pptOpen, setPptOpen] = useState(false);
  const [pptFrom, setPptFrom] = useState("");
  const [pptTo, setPptTo] = useState("");
  const [pptBrandId, setPptBrandId] = useState("");
  // Design text on each slide: native boxes (copyable, movable) or baked
  // into the raster — the user picks per export, both are first-class.
  const [pptTextMode, setPptTextMode] = useState<"native" | "flat">("native");
  const [pptBusy, setPptBusy] = useState("");
  // CSV import: the file input stays hidden — the ⇧ Importar button clicks it.
  const [importing, setImporting] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

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

  // The Archivo column picks from real files — "which design" is a question
  // about names, not about pasting ids. 300 is the route's own cap.
  useEffect(() => {
    if (!workspaceId) return;
    void apiFetch<{ data?: Array<{ id: string; name: string }> }>(
      `/api/templates?workspaceId=${encodeURIComponent(workspaceId)}&limit=300`,
    )
      .then(res => setFiles(Array.isArray(res?.data)
        ? res.data.map(t => ({ id: t.id, name: t.name }))
        : []))
      .catch(() => { /* the sheet still works; ids just stop resolving */ });
  }, [workspaceId]);

  // Frames of every linked file, for the Diseño column — one GET per file,
  // only for files some row actually points at. `tried` keeps a deleted or
  // unreachable file from being re-fetched on every keystroke.
  useEffect(() => {
    const linked = new Set<string>();
    for (const r of rows) if (r.template_id) linked.add(r.template_id);
    const missing = [...linked].filter(id => !framesByFile[id] && !frameFetchTried.current.has(id));
    if (missing.length === 0) return;
    missing.forEach(id => frameFetchTried.current.add(id));
    missing.forEach(async id => {
      try {
        const res = await apiFetch<{ data?: { frames?: Array<{ id: string; name?: string }> } }>(`/api/templates/${id}`);
        const frames = (res?.data?.frames || []).map((f, i) => ({ id: f.id, name: f.name || `Frame ${i + 1}` }));
        setFramesByFile(cur => ({ ...cur, [id]: frames }));
      } catch { /* deleted file → empty select; the ↗ jump still shows the id */ }
    });
  }, [rows, framesByFile]);

  const brandNameById = useMemo(
    () => new Map(brands.map(b => [b.id, b.name])), [brands]);
  const templateNameById = useMemo(
    () => new Map(files.map(f => [f.id, f.name])), [files]);

  /** Every view below reads THIS, never `rows` — so an export is exactly what
   *  is on screen, which is the whole point of being able to stack filters.
   *  Archivo/Diseño resolve to names here, so the exports (which read these
   *  rows) carry names, never ids — a client-facing grid that says "tpl_a83f…"
   *  is not a grid anyone can read. */
  const visible = useMemo(
    () => applyFilters(rows, filters).map(r => {
      const frames = r.template_id ? framesByFile[r.template_id] : undefined;
      return {
        ...r,
        brandName: brandNameById.get(r.brand_id || "") || "",
        template_name: r.template_id ? (templateNameById.get(r.template_id) || "") : "",
        frame_name: r.frame_id && frames ? (frames.find(f => f.id === r.frame_id)?.name || "") : "",
      };
    }),
    [rows, filters, brandNameById, templateNameById, framesByFile]);

  // The open piece, resolved from `visible`: Marca/Archivo/Diseño arrive as
  // display names, and any patch re-renders the panel with the fresh row.
  const peekRow = useMemo(
    () => (peekId ? visible.find(r => r.id === peekId) ?? null : null),
    [peekId, visible]);

  // Escape closes the peek — but a publish menu or dialog stacked on top
  // closes first; the peek yields last.
  useEffect(() => {
    if (!peekId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (publishMenuId || publishRow || pptOpen) return;
      setPeekId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peekId, publishMenuId, publishRow, pptOpen]);

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

  // ── PPT export (REQ-023) ─────────────────────────────────────────────
  // One deck per range: a cover headed by the brand and the requesting
  // user, then one slide per piece — the caption AND the design's own
  // words as NATIVE text (selectable, copyable, movable in PowerPoint and
  // Google Slides, which is the point) over the exact art, whose own text
  // layer ships hidden so nothing renders twice.

  const pptRangeCount = useMemo(
    () => applyFilters(rows, {
      from: pptFrom || undefined,
      to: pptTo || undefined,
      brandId: pptBrandId || undefined,
    }).length,
    [rows, pptFrom, pptTo, pptBrandId]);

  // Escape closes the popup — unless a generation is in flight, which must
  // not be abandoned half-rendered.
  useEffect(() => {
    if (!pptOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pptBusy) setPptOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pptOpen, pptBusy]);

  const generatePpt = useCallback(async () => {
    if (!workspaceId) return;
    setError("");
    try {
      const pptRows = applyFilters(rows, {
        from: pptFrom || undefined,
        to: pptTo || undefined,
        brandId: pptBrandId || undefined,
      })
        .slice()
        .sort((a, b) =>
          `${a.scheduled_date} ${a.scheduled_time || ""}`
            .localeCompare(`${b.scheduled_date} ${b.scheduled_time || ""}`));
      if (pptRows.length === 0) {
        setError("No hay piezas en ese rango con esa marca.");
        return;
      }

      setPptBusy("Cargando generador…");
      // Dynamic import keeps pptxgenjs out of the main bundle: this button is
      // used once a month, not on every load.
      const { default: PptxGenJS } = await import("pptxgenjs");
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_16x9"; // 10" × 5.625"
      const userName = user?.user_metadata?.full_name || user?.email || "Futuraria";
      pptx.author = String(userName);
      const brandName = brands.find(b => b.id === pptBrandId)?.name || "Todas las marcas";

      // ── Portada: brand as the headline, who requested it, the range ──
      const cover = pptx.addSlide();
      cover.background = { color: "0B0D13" };
      // Every text below carries an explicit h: pptxgenjs defaults height
      // to 0, and cy="0" shapes render as invisible hairlines in several
      // PowerPoint/Slides renderers (the "empty cover" bug report).
      cover.addText("GRILLA DE CONTENIDO", { x: 0.7, y: 1.0, w: 8.6, h: 0.35, fontSize: 11, valign: "top", color: "6B7280", charSpacing: 4 });
      cover.addText(brandName, { x: 0.7, y: 1.4, w: 8.6, h: 0.85, fontSize: 44, valign: "top", bold: true, color: "FFFFFF" });
      cover.addText(`Presentado por ${userName}`, { x: 0.7, y: 2.55, w: 8.6, h: 0.4, fontSize: 17, valign: "top", bold: true, color: "A5B4FC" });
      cover.addText(`${pptFrom || "inicio"}  →  ${pptTo || "hoy"}`, { x: 0.7, y: 3.2, w: 8.6, h: 0.35, fontSize: 13, valign: "top", color: "9CA3AF" });
      cover.addText(
        `${new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })} · ${pptRows.length} ${pptRows.length === 1 ? "pieza" : "piezas"}`,
        { x: 0.7, y: 3.65, w: 8.6, h: 0.35, fontSize: 11.5, valign: "top", color: "6B7280" },
      );

      // Frame → PNG. Templates are read FRESH here (not from the sheet's
      // select cache): the grid must carry the art as it is right now.
      const tplCache = new Map<string, any>();
      const loadTemplate = async (templateId: string) => {
        if (!tplCache.has(templateId)) {
          try {
            const res = await apiFetch<{ data?: any }>(`/api/templates/${templateId}`);
            tplCache.set(templateId, res?.data || null);
          } catch { tplCache.set(templateId, null); }
        }
        return tplCache.get(templateId);
      };
      const frameToSlideArt = async (templateId: string, frameId: string) => {
        const tpl = await loadTemplate(templateId);
        const frame = tpl && Array.isArray(tpl.frames) ? tpl.frames.find((f: any) => f.id === frameId) : null;
        if (!frame) return null;
        const source = {
          html: frame.html ?? tpl.html ?? "",
          css: frame.css ?? tpl.css ?? "",
          width: Number(frame.width) || 1080,
          height: Number(frame.height) || 1080,
          background: frame.background || "#ffffff",
        };
        // "native" mode: the design's own words become real PowerPoint
        // text and the art under them is painted with its text hidden.
        // "flat" mode skips extraction entirely — the classic baked
        // raster, byte for byte yesterday's output. A failed extraction in
        // native mode falls back to that same raster, never an empty slide.
        let blocks: PptTextBlock[] = [];
        if (pptTextMode === "native") {
          try { blocks = await extractFrameTextBlocks(source); } catch { blocks = []; }
        }
        const canvas = blocks.length
          ? await rasterizeFrameWithoutText(source, 1.5)
          : await rasterizeFrame(source, 1.5);
        return { canvas, blocks, frameWidth: source.width, frameHeight: source.height };
      };

      for (let i = 0; i < pptRows.length; i++) {
        const r = pptRows[i];
        setPptBusy(`Generando… (${i + 1}/${pptRows.length})`);
        const slide = pptx.addSlide();
        slide.background = { color: "0B0D13" };

        const fecha = r.scheduled_date + (r.scheduled_time ? ` ${r.scheduled_time.slice(0, 5)}` : "");
        const canal = (r.channels || []).join(", ");
        slide.addText([fecha, canal].filter(Boolean).join("   ·   "),
          { x: 0.5, y: 0.3, w: 9, h: 0.35, fontSize: 12, valign: "top", color: "9CA3AF" });

        // Left: the copy. Native text boxes, so it selects and copies in
        // PowerPoint AND Google Slides — an image of text would defeat the
        // export for everyone who pastes captions into the scheduler.
        const runs: Array<Record<string, unknown>> = [];
        if (r.topic) runs.push({ text: r.topic, options: { fontSize: 17, bold: true, color: "FFFFFF", breakLine: true, paraSpaceAfter: 8 } });
        runs.push({ text: r.copy || "(sin copy todavía)", options: { fontSize: 12.5, color: "E5E7EB" } });
        slide.addText(runs as any, { x: 0.5, y: 1.05, w: 4.6, h: 4.1, valign: "top", shrinkText: true });

        // Right: the frame — art PNG with its text hidden, every design
        // line re-emitted as a NATIVE one-line text box (wrap off, see
        // extractFrameTextBlocks). The words select, copy, edit and move
        // like any PowerPoint object, and nothing is ever re-broken.
        const art = r.template_id && r.frame_id ? await frameToSlideArt(r.template_id, r.frame_id) : null;
        if (art) {
          // Frame pixels → slide inches, once; px→points is ×72.
          const fit = Math.min(4.0 / art.frameWidth, 4.4 / art.frameHeight);
          const w = art.frameWidth * fit, h = art.frameHeight * fit;
          const artX = 5.5 + (4.0 - w) / 2, artY = 0.85 + (4.4 - h) / 2;
          slide.addImage({ data: art.canvas.toDataURL("image/png").replace(/^data:/, ""), x: artX, y: artY, w, h });
          for (const b of art.blocks) {
            // +8% width headroom, capped at the frame edge: renderers that
            // ignore wrap="none" or substitute a wider font still keep the
            // line on ONE line instead of spilling onto a second.
            const lineW = Math.min(b.w * 1.08, art.frameWidth - b.x) * fit;
            slide.addText(b.text, {
              x: artX + b.x * fit,
              y: artY + b.y * fit,
              w: lineW,
              h: b.h * fit,
              fontSize: Math.max(1, b.fontSize * fit * 72),
              bold: b.bold,
              italic: b.italic,
              underline: b.underline ? { style: "sng" } : undefined,
              color: b.color,
              fontFace: b.fontFace || undefined,
              margin: 0,
              wrap: false,
              isTextBox: true,
            } as any);
          }
        } else {
          slide.addText(r.template_id ? "Diseño sin frame exacto" : "Sin diseño vinculado", {
            x: 5.6, y: 2.7, w: 3.8, h: 0.7, align: "center", valign: "middle",
            fontSize: 11, color: "6B7280", fill: { color: "151A26" },
          });
        }

        // Footer: which file ▸ which frame, by name — the same answer the
        // sheet's Archivo/Diseño columns give, so slide and sheet agree.
        const tplName = r.template_id ? (templateNameById.get(r.template_id) || "") : "";
        const frmName = r.frame_id && r.template_id
          ? (framesByFile[r.template_id]?.find(f => f.id === r.frame_id)?.name || "")
          : "";
        const designLabel = [tplName, frmName].filter(Boolean).join(" ▸ ");
        if (designLabel) {
          slide.addText(designLabel, { x: 0.5, y: 5.2, w: 9, h: 0.3, fontSize: 9.5, valign: "top", color: "4B5563" });
        }
      }

      setPptBusy("Escribiendo archivo…");
      const blob = (await pptx.write({ outputType: "blob" })) as Blob;
      const tag = (brands.find(b => b.id === pptBrandId)?.name || "marcas")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "marcas";
      downloadBlob(blob, `grilla-${tag}-${pptFrom || "inicio"}-a-${pptTo || "hoy"}.pptx`);
      setPptOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPptBusy("");
    }
  }, [workspaceId, rows, pptFrom, pptTo, pptBrandId, pptTextMode, brands, user, templateNameById, framesByFile]);

  /** Template + import: the calendar round-trips through CSV, so content
   *  prepared outside Futuraria lands here without retyping. The template is
   *  the export's own vocabulary — headers match on purpose. */
  const downloadTemplate = useCallback(() => {
    // Excel still misdetects UTF-8 without the BOM: accents would garble.
    downloadBlob(new Blob(["\uFEFF" + toImportTemplate()], { type: "text/csv;charset=utf-8" }), "plantilla-contenido.csv");
  }, []);

  const importFile = useCallback(async (file: File) => {
    if (!workspaceId || importing) return;
    setImporting("Leyendo archivo…");
    setError("");
    try {
      const parsed = mapContentImport(await file.text(), brands);
      if (parsed.rows.length === 0) {
        throw new Error(parsed.errors[0] || "El archivo no tiene filas importables");
      }
      setImporting(`Importando 0/${parsed.rows.length}…`);
      const res = await apiFetch<{ success?: boolean; error?: string; data?: ContentRow[]; imported?: number }>(
        "/api/content/import", { method: "POST", body: JSON.stringify({ workspaceId, rows: parsed.rows }) });
      if (res && res.success === false) throw new Error(res.error || "La importación fue rechazada");
      if (res?.data?.length) setRows(cur => [...cur, ...res.data!]);
      // Pure success needs no banner — the rows just appear. Judgment calls
      // (unknown brands, dropped rows) surface through the existing alert bar.
      const notes = [...parsed.warnings, ...parsed.errors];
      if (notes.length > 0) {
        setError(`Importadas ${res?.data?.length ?? 0} piezas — ${notes.slice(0, 4).join(" · ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting("");
    }
  }, [workspaceId, brands, importing]);

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

  const publishContent = useCallback(async (row: ContentRow, draft: PublishDraft) => {
    if (publishingId) return;
    setPublishingId(row.id);
    setError("");
    try {
      let scheduledFor: string | undefined;
      const retry = Boolean(row.publishing_request_id);
      if (!retry && draft.mode === "schedule") {
        if (!draft.date || !draft.time) throw new Error("Elige fecha y hora para programar");
        scheduledFor = zernioScheduledFor(draft.date, draft.time, draft.timezone);
      }
      if (!workspaceId) throw new Error("Selecciona un workspace antes de publicar");
      const mediaUrl = retry ? undefined : await prepareSocialMedia({ ...row, workspace_id: workspaceId }, draft.mediaUrl, draft.contentType, {
        loadTemplate: async id => {
          const response = await apiFetch<{ data: any }>(`/api/templates/${encodeURIComponent(id)}`);
          if (!response.data) throw new Error("No se pudo cargar el diseño vinculado");
          return response.data;
        },
        render: async source => (await rasterizeFrame(source, 1)).toDataURL("image/png"),
        upload: async data => {
          const response = await apiFetch<{ url: string }>("/api/assets/upload", {
            method: "POST", body: JSON.stringify({ name: `publicacion-${row.id}.png`, data, workspaceId }),
          });
          if (!response.url) throw new Error("No se pudo subir el diseño; no se publicó contenido");
          return response.url;
        },
      });
      const res = await apiFetch<{ data?: ContentRow }>(`/api/content/${row.id}/publish`, {
        method: "POST",
        body: JSON.stringify(retry ? { retry: true } : {
          mode: draft.mode,
          channels: row.channels || [],
          contentType: draft.contentType,
          timezone: draft.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          scheduledFor,
          mediaUrl,
          // Explicit destinations only when picked: without them the API
          // keeps its legacy channel → default-account mapping.
          ...(draft.provider ? { provider: draft.provider } : {}),
          ...(draft.accountIds.length ? { accountIds: draft.accountIds } : {}),
        }),
      });
      if (res?.data) setRows(current => current.map(item => item.id === row.id ? res.data! : item));
      setPublishRow(null);
      setPublishDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setPublishingId(null);
    }
  }, [publishingId, load, workspaceId]);

  /** Where a piece publishes by default: the provider that can run this
   *  content type, then the brand's saved picks, then the workspace
   *  defaults, then known accounts matching the row's channels. */
  const draftDefaults = useCallback((row: ContentRow, contentType: PublishDraft["contentType"]): { provider: SocialProviderId | null; accountIds: string[] } => {
    const provider = publishProviderOrder(contentType)
      .find(id => connections.some(c => c.provider === id && c.hasCredentials)) || null;
    const conn = provider ? connections.find(c => c.provider === provider) : undefined;
    if (!conn) return { provider: null, accountIds: [] };
    const brandPicks = row.brand_id ? conn.brandAccounts[row.brand_id] : undefined;
    if (brandPicks?.length) return { provider, accountIds: brandPicks };
    const workspacePicks = Object.values(conn.accounts);
    if (workspacePicks.length) return { provider, accountIds: workspacePicks };
    // Nothing saved: preselect accounts matching the row's channels so the
    // dialog opens ready instead of empty.
    const byChannel = conn.knownAccounts
      .filter(a => a.isActive && (row.channels || []).some(ch => platformToChannel(a.platform) === ch))
      .map(a => a.id);
    return { provider, accountIds: byChannel };
  }, [connections]);

  /** Live destination list for the dialog's picker, seeded from the cache so
   *  it renders instantly; a failed refresh keeps the cache visible. */
  const loadAccounts = useCallback(async (provider: SocialProviderId) => {
    if (!workspaceId) return;
    const cached = connections.find(c => c.provider === provider)?.knownAccounts || [];
    setAccountOptions(cached.map(a => ({ ...a, provider })));
    setAccountsLoading(true);
    try {
      const res = await apiFetch<{ success?: boolean; error?: string; data?: { accounts: Array<Omit<SocialAccount, "provider">> } }>(
        `/api/content/integrations/social/${provider}/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (res && res.success === false) throw new Error(res.error || "No se pudieron listar las cuentas");
      setAccountOptions((res.data?.accounts || []).map(a => ({ ...a, provider })));
    } catch (e) {
      if (cached.length === 0) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccountsLoading(false);
    }
  }, [workspaceId, connections]);

  // Opening the dialog (or switching its content type, which can change the
  // provider) loads that provider's accounts — cache first, then a refresh.
  useEffect(() => {
    if (publishRow && publishDraft?.provider) void loadAccounts(publishDraft.provider);
  }, [publishRow, publishDraft?.provider, loadAccounts]);

  const openPublishDialog = useCallback((row: ContentRow, mode: "now" | "schedule", contentType: PublishDraft["contentType"] = "post") => {
    setPublishMenuId(null);
    const defaults = draftDefaults(row, contentType);
    setPublishRow(row);
    setPublishDraft({
      mode,
      contentType,
      date: row.scheduled_date || isoDate(new Date()),
      time: (row.scheduled_time || "09:00").slice(0, 5),
      timezone: row.publishing_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
      provider: defaults.provider,
      accountIds: defaults.accountIds,
      mediaUrl: "",
      saveBrandDefault: false,
    });
  }, [draftDefaults]);

  /** The table already holds fecha, hora y canales — when the brand's
   *  destinations resolve too, Programar needs no questions. Only missing
   *  data falls back to the dialog. Returns whether the one-click path ran. */
  const quickSchedule = useCallback((row: ContentRow): boolean => {
    if (!row.scheduled_date || !row.scheduled_time) return false;
    const { provider, accountIds } = draftDefaults(row, "post");
    if (!provider || accountIds.length === 0) return false;
    void publishContent(row, {
      mode: "schedule",
      contentType: "post",
      date: row.scheduled_date,
      time: (row.scheduled_time || "09:00").slice(0, 5),
      timezone: row.publishing_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
      provider,
      accountIds,
      mediaUrl: "",
      saveBrandDefault: false,
    });
    return true;
  }, [draftDefaults, publishContent]);

  const publishControls = (row: ContentRow, from: "calendar" | "sheet") => {
    const disabled = publishingId === row.id || ["programado", "publicando", "publicado"].includes(row.publishing_status || "");
    const runNow = (contentType: "post" | "story" | "reel") => {
      setPublishMenuId(null);
      const { provider, accountIds } = draftDefaults(row, contentType);
      if (!row.publishing_request_id && (!accountIds.length || (contentType === "reel" && !row.external_url) || (contentType === "story" && !row.template_id && !row.external_url))) {
        openPublishDialog(row, "now", contentType);
        return;
      }
      void publishContent(row, {
        mode: "now",
        contentType,
        date: "", time: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        provider,
        accountIds,
        mediaUrl: "",
        saveBrandDefault: false,
      });
    };
    const schedule = () => {
      setPublishMenuId(null);
      // The table row already carries fecha y hora: one click when the
      // brand's destinations resolve too. The calendar cell has no such
      // data, so it always opens the dialog.
      if (from === "sheet" && quickSchedule(row)) return;
      openPublishDialog(row, "schedule");
    };
    return (
      <div style={{ position: "relative", display: "inline-block" }} onKeyDown={event => {
        if (event.key === "Escape") {
          setPublishMenuId(null);
          event.currentTarget.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
        }
      }}>
        {row.publishing_provider === "buffer" && row.publishing_external_id && (
          <button type="button" style={{ ...btn, padding: "3px 7px" }} disabled={Boolean(publishingId)} onClick={async () => {
            setPublishingId(row.id); setError("");
            try {
              const result = await apiFetch<{ data?: ContentRow }>(`/api/content/${row.id}/sync`, { method: "POST" });
              if (result.data) setRows(current => current.map(item => item.id === row.id ? result.data! : item));
            } catch (error) { setError(error instanceof Error ? error.message : "No se pudo actualizar Buffer"); }
            finally { setPublishingId(null); }
          }}>Actualizar estado</button>
        )}
        <button type="button" style={{ ...btn, padding: "3px 7px" }} disabled={disabled}
          aria-expanded={publishMenuId === row.id} aria-controls={`publish-menu-${row.id}`}
          onClick={() => setPublishMenuId(current => current === row.id ? null : row.id)}>
          {publishingId === row.id ? "Enviando…" : row.publishing_status === "error" ? "Reintentar ▾" : "Publicar ▾"}
        </button>
        {publishMenuId === row.id && (
          <div id={`publish-menu-${row.id}`} aria-label="Opciones de publicación" style={{
            position: "absolute", zIndex: 20, right: 0, top: "calc(100% + 4px)", minWidth: 170,
            background: "#111", border: "1px solid rgba(255,255,255,0.28)", padding: 4,
          }}>
            <button type="button" style={{ ...btn, width: "100%", textAlign: "left", border: 0 }} onClick={() => runNow("post")}>Post ahora</button>
            <button type="button" style={{ ...btn, width: "100%", textAlign: "left", border: 0 }} onClick={() => runNow("story")}>Story ahora</button>
            <button type="button" style={{ ...btn, width: "100%", textAlign: "left", border: 0 }} onClick={() => runNow("reel")}>Reel ahora</button>
            <button type="button" style={{ ...btn, width: "100%", textAlign: "left", border: 0 }} onClick={schedule}>Programar…</button>
          </div>
        )}
      </div>
    );
  };

  const brandIdsFilter = filters.brandIds || [];
  const brandFilterLabel = brandIdsFilter.length === 0
    ? "Todas las marcas"
    : brandIdsFilter.length === 1
      ? (brands.find(b => b.id === brandIdsFilter[0])?.name || "1 marca")
      : `${brandIdsFilter.length} marcas`;

  // ── Social connections and the Zernio inbox ─────────────────────────
  const loadConnections = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await apiFetch<{ publishProvider?: SocialProviderId | null; data?: SocialConn[] }>(
        `/api/content/integrations/social?workspaceId=${encodeURIComponent(workspaceId)}`);
      setConnections(res.data || []);
      setPublishProvider(res.publishProvider ?? null);
    } catch { /* the popover renders "sin llave" defaults; the inbox pane surfaces its own errors */ }
  }, [workspaceId]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  /** Saves the dialog's picks as a brand's default destinations. The API
   *  validates the ids against the provider's live list and merges — other
   *  brands' picks stay untouched. */
  const saveBrandDefaults = useCallback(async (provider: SocialProviderId, brandId: string, accountIds: string[]) => {
    const res = await apiFetch<{ success?: boolean; error?: string }>(`/api/content/integrations/social/${provider}`, {
      method: "PUT", body: JSON.stringify({ workspaceId, brandAccounts: { [brandId]: accountIds } }),
    });
    if (res && res.success === false) throw new Error(res.error || "No se pudo guardar el destino de la marca");
    await loadConnections();
  }, [workspaceId, loadConnections]);

  const confirmPublish = useCallback(async () => {
    if (!publishRow || !publishDraft || publishingId) return;
    if (!publishDraft.provider) { setError("Conecta Buffer o Zernio en Conexiones para publicar"); return; }
    if (publishDraft.accountIds.length === 0) { setError("Elige al menos una cuenta destino"); return; }
    if (publishDraft.mode === "schedule" && (!publishDraft.date || !publishDraft.time)) {
      setError("Elige fecha y hora para programar");
      return;
    }
    if (publishDraft.saveBrandDefault && publishRow.brand_id) {
      try {
        await saveBrandDefaults(publishDraft.provider, publishRow.brand_id, publishDraft.accountIds);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    await publishContent(publishRow, publishDraft);
  }, [publishRow, publishDraft, publishingId, saveBrandDefaults, publishContent]);

  /** Saves the key inline. The API validates it against the provider before
   *  encrypting, so a typo surfaces here instead of at publish time. */
  const saveConnection = useCallback(async (provider: SocialProviderId) => {
    const apiKey = (keyDraft[provider] || "").trim();
    if (!apiKey || !workspaceId) return;
    setConnBusy(provider);
    setConnMsg("");
    try {
      const res = await apiFetch<{ success?: boolean; error?: string }>(`/api/content/integrations/social/${provider}`, {
        method: "PUT", body: JSON.stringify({ workspaceId, apiKey }),
      });
      if (res && res.success === false) throw new Error(res.error || "No se pudo guardar la conexión");
      setKeyDraft(cur => ({ ...cur, [provider]: "" }));
      setConnMsg(`${PROVIDER_META[provider].name} conectado. La llave quedó cifrada en el servidor.`);
      await loadConnections();
    } catch (e) {
      setConnMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnBusy(null);
    }
  }, [keyDraft, workspaceId, loadConnections]);

  const loadInbox = useCallback(async () => {
    if (!workspaceId) return;
    setInboxLoading(true);
    try {
      const res = await apiFetch<{ success?: boolean; error?: string; data?: InboxRow[] }>(
        `/api/content/integrations/social/zernio/inbox?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (res && res.success === false) throw new Error(res.error || "No se pudo sincronizar la bandeja");
      setInboxRows(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInboxLoading(false);
    }
  }, [workspaceId]);

  // Entering Bandeja with Zernio connected pulls fresh conversations —
  // once per visit, not on an interval: every sync is a real provider call.
  useEffect(() => {
    if (pane === "inbox" && workspaceId && connections.some(c => c.provider === "zernio" && c.hasCredentials)) {
      void loadInbox();
    }
  }, [pane, workspaceId, connections, loadInbox]);

  const sendReply = useCallback(async (item: InboxRow) => {
    const content = (replyDraft[item.id] || "").trim();
    if (!content || !workspaceId) return;
    setInboxBusy(item.id);
    try {
      const res = await apiFetch<{ success?: boolean; error?: string; data?: InboxRow }>(
        `/api/content/integrations/social/zernio/inbox/${item.id}/reply`, {
        method: "POST", body: JSON.stringify({ workspaceId, content }),
      });
      if (res && res.success === false) throw new Error(res.error || "No se pudo enviar la respuesta");
      if (res?.data) setInboxRows(cur => cur.map(r => (r.id === item.id ? res.data! : r)));
      setReplyDraft(cur => ({ ...cur, [item.id]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInboxBusy(null);
    }
  }, [replyDraft, workspaceId]);

  const captureContact = useCallback(async (item: InboxRow) => {
    if (!workspaceId) return;
    setInboxBusy(item.id);
    try {
      const res = await apiFetch<{ success?: boolean; error?: string; data?: InboxRow }>(
        `/api/content/integrations/social/zernio/inbox/${item.id}/capture`, {
        method: "POST", body: JSON.stringify({ workspaceId }),
      });
      if (res && res.success === false) throw new Error(res.error || "No se pudo capturar el contacto");
      if (res?.data) setInboxRows(cur => cur.map(r => (r.id === item.id ? res.data! : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInboxBusy(null);
    }
  }, [workspaceId]);

  const grid = useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth(), visible),
    [cursor, visible],
  );

  const monthLabel = cursor.toLocaleDateString("es", { month: "long", year: "numeric" });

  // Connections popover — present on every pane: a missing key is fixed right
  // here instead of sending the user hunting for Configuración. Panes with
  // their own control row (biblioteca, recetas, bandeja) mount it on that row
  // via the `actions` slot; calendar/sheet/reports hang it at the end of the
  // shared toolbar row.
  const connControl = (
    <div style={{ position: "relative" }} onKeyDown={event => {
      if (event.key === "Escape") setConnOpen(false);
    }}>
      <button type="button" className="ct-chip" style={{ display: "inline-flex", alignItems: "center", gap: 5 }} aria-expanded={connOpen}
        aria-label="Conexiones sociales"
        title={`Conexiones${publishProvider ? ` · publica ${PROVIDER_META[publishProvider].name}` : ""}`}
        onClick={() => setConnOpen(v => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" /></svg>
        {publishProvider && <span style={{ width: 6, height: 6, borderRadius: 100, background: "#4ade80" }} aria-hidden="true" />}
      </button>
      {connOpen && (
        <div style={{
          position: "absolute", zIndex: 30, right: 0, top: "calc(100% + 6px)", width: 320,
          background: "#18181b", border: "1px solid #3f3f46", borderRadius: 9, padding: 12, display: "grid", gap: 12,
        }}>
          {(["buffer", "zernio"] as SocialProviderId[]).map(id => {
            const conn = connections.find(c => c.provider === id);
            const caps = conn?.capabilities ?? SOCIAL_CAPABILITIES[id];
            return (
              <div key={id} style={{ display: "grid", gap: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 12.5 }}>{PROVIDER_META[id].name}</strong>
                  <span style={{ fontSize: 11, color: conn?.hasCredentials ? "#4ade80" : "rgba(255,255,255,0.4)" }}>
                    {conn?.hasCredentials ? "conectado" : "sin llave"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>
                  {PROVIDER_META[id].blurb}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {(Object.keys(CAPABILITY_LABEL) as Array<keyof SocialCapabilities>)
                    .filter(k => caps[k])
                    .map(k => (
                      <span key={k} style={{
                        fontSize: 10, padding: "1px 6px",
                        border: "1px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.6)",
                      }}>{CAPABILITY_LABEL[k]}</span>
                    ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="password" autoComplete="off" value={keyDraft[id] || ""} placeholder="API key"
                    aria-label={`API key de ${PROVIDER_META[id].name}`}
                    className="ct-input" style={{ flex: 1 }}
                    onChange={e => setKeyDraft(cur => ({ ...cur, [id]: e.target.value }))} />
                  <button type="button" className="ct-chip"
                    disabled={connBusy === id || !(keyDraft[id] || "").trim()}
                    onClick={() => void saveConnection(id)}>
                    {connBusy === id ? "Guardando…" : conn?.hasCredentials ? "Actualizar" : "Conectar"}
                  </button>
                </div>
              </div>
            );
          })}
          {connMsg && (
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.75)" }}>{connMsg}</div>
          )}
          <div style={{
            fontSize: 11, color: "rgba(255,255,255,0.45)", paddingTop: 8,
            borderTop: "1px solid rgba(255,255,255,0.14)", display: "flex", gap: 8, alignItems: "center",
          }}>
            <span style={{ flex: 1 }}>Cuentas por canal y webhook secreto se configuran en Configuración.</span>
            {onOpenSettings && (
              <button type="button" className="ct-chip"
                onClick={() => { setConnOpen(false); onOpenSettings(); }}>
                Abrir
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14, padding: "20px 20px 16px", overflowY: "auto" }}>
      <style>{CSS}</style>

      {/* v54 shared hierarchy — the same glass header as CRM/Agentes: serif
          title + descriptor per sub-section and the icon nav. v55: no toolbar
          in the card — the working row sits below it, one single line. Like
          the CRM console, the PAGE itself scrolls: panes grow to their
          content (nothing pinned, no inner scrollbar), the card rides along. */}
      <div className="crm-table-card crm-contacts-top" style={{ flexShrink: 0 }}>
        <header className="crm-contacts-head">
          <div>
            <h1>{PANE_META[pane].title}</h1>
            <p>{PANE_META[pane].description}</p>
          </div>
          <div className="crm-nav-tabs" role="tablist" aria-label="Secciones de copywriting">
            {PANES.map(id => (
              <button key={id} type="button" role="tab" aria-selected={pane === id}
                title={PANE_META[id].label}
                className={pane === id ? "crm-nav-tab active" : "crm-nav-tab"}
                onClick={() => changePane(id)}>
                {PANE_META[id].icon}
              </button>
            ))}
          </div>
        </header>
      </div>

      {/* v55 — the toolbar row lives OUTSIDE the presentation card, one line:
          range chip → filters … exports dropdown · import · gear. The card
          presents; the row works. Only for calendar/sheet/reports: the other
          panes have their own control row and mount the gear there. */}
      {(pane === "calendar" || pane === "sheet" || pane === "reports") && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        <>
            {/* One short block for the range: click opens a mini calendar —
                first click picks desde, second picks hasta. */}
            <div style={{ position: "relative" }} onKeyDown={event => {
              if (event.key === "Escape") setRangeOpen(false);
            }}>
              <button type="button" className="ct-input" style={{ textAlign: "left", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                aria-expanded={rangeOpen} aria-label="Rango de fechas"
                onClick={() => setRangeOpen(open => {
                  if (!open) setRangeCursor(new Date(`${filters.from || isoDate(new Date())}T12:00:00`));
                  return !open;
                })}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="1.5" /><path d="M4 10h16M8.5 3.5V7M15.5 3.5V7" /></svg>
                {rangeLabel(filters.from || "", filters.to || "")}
              </button>
              {rangeOpen && (
                <div style={{ position: "absolute", zIndex: 30, left: 0, top: "calc(100% + 4px)", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 9, padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <button type="button" className="ct-chip" onClick={() => setRangeCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Mes anterior">←</button>
                    <span style={{ fontSize: 12, color: "#fff", flex: 1, textAlign: "center", textTransform: "capitalize" }}>
                      {rangeCursor.toLocaleDateString("es", { month: "long", year: "numeric" })}
                    </span>
                    <button type="button" className="ct-chip" onClick={() => setRangeCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Mes siguiente">→</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 26px)", gap: 2 }}>
                    {["L", "M", "X", "J", "V", "S", "D"].map(d => (
                      <div key={d} style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "2px 0" }}>{d}</div>
                    ))}
                    {buildMonthGrid(rangeCursor.getFullYear(), rangeCursor.getMonth(), []).map(cell => {
                      const inRange = filters.from && filters.to && cell.date >= filters.from && cell.date <= filters.to;
                      const isEnd = cell.date === filters.from || cell.date === filters.to;
                      return (
                        <button key={cell.date} type="button"
                          onClick={() => setFilters(f => {
                            if (!f.from || (f.from && f.to)) return { ...f, from: cell.date, to: undefined };
                            if (cell.date < f.from) return { ...f, from: cell.date, to: f.from };
                            return { ...f, to: cell.date };
                          })}
                          style={{
                            fontSize: 11, padding: "3px 0", borderRadius: 6, cursor: "pointer", font: "inherit",
                            color: isEnd ? "#000" : cell.inMonth ? "#fff" : "rgba(255,255,255,0.35)",
                            background: isEnd ? "#fff" : inRange ? "rgba(255,255,255,0.16)" : "transparent",
                            border: "none", opacity: cell.inMonth ? 1 : 0.5,
                          }}>
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", flex: 1 }}>Dos clicks: desde → hasta</span>
                    <button type="button" className="ct-chip" onClick={() => setFilters(f => ({ ...f, from: undefined, to: undefined }))}>Limpiar</button>
                  </div>
                </div>
              )}
            </div>
            {/* Each narrows the last. Stacking them is what lets one workspace
                produce a report per brand, per period, per kind. */}
              {/* Multi-brand on purpose: a corp group reviews several brands in
                  one view. Checkboxes, not a select — the picks accumulate. */}
              <div style={{ position: "relative" }} onKeyDown={event => {
                if (event.key === "Escape") setBrandFilterOpen(false);
              }}>
                <button type="button" className="ct-input" style={{ textAlign: "left", cursor: "pointer" }}
                  aria-expanded={brandFilterOpen} aria-label="Marcas"
                  onClick={() => setBrandFilterOpen(open => !open)}>
                  {brandFilterLabel} ▾
                </button>
                {brandFilterOpen && (
                  <div style={{
                    position: "absolute", zIndex: 30, left: 0, top: "calc(100% + 4px)", minWidth: 190,
                    background: "#18181b", border: "1px solid #3f3f46", borderRadius: 9, padding: 6,
                    maxHeight: 240, overflow: "auto",
                  }}>
                    {brands.map(b => (
                      <label key={b.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, padding: "3px 2px", cursor: "pointer" }}>
                        <input type="checkbox"
                          checked={brandIdsFilter.includes(b.id)}
                          onChange={e => setFilters(f => {
                            const current = f.brandIds || [];
                            const next = e.target.checked ? [...current, b.id] : current.filter(id => id !== b.id);
                            return { ...f, brandIds: next.length ? next : undefined, brandId: undefined };
                          })} />
                        {b.name}
                      </label>
                    ))}
                    {brands.length === 0 && (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", padding: 4 }}>Sin marcas en el workspace</div>
                    )}
                  </div>
                )}
              </div>
              <select value={filters.kind || ""} className="crm-inline-filter" aria-label="Tipo"
                onChange={e => setFilters(f => ({ ...f, kind: e.target.value as any }))}>
                <option value="">Ads y orgánico</option>
                {CONTENT_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <select value={filters.channel || ""} className="crm-inline-filter" aria-label="Canal"
                onChange={e => setFilters(f => ({ ...f, channel: e.target.value }))}>
                <option value="">Todos los canales</option>
                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={filters.campaign || ""} placeholder="Campaña" aria-label="Campaña"
                className="ct-input" style={{ width: 130 }}
                onChange={e => setFilters(f => ({ ...f, campaign: e.target.value }))} />
            {Object.values(filters).some(Boolean) && (
              <button type="button" className="crm-clear-filters" onClick={() => setFilters({})}>Limpiar</button>
            )}
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", alignSelf: "center" }}>
              {visible.length} de {rows.length} piezas · {visible.filter(r => r.kind === "ad").length} ads
            </span>
        </>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <>
              {/* One dropdown for the four exports — the filters decide what
                  leaves, the menu decides the format. */}
              <div style={{ position: "relative" }} onKeyDown={event => {
                if (event.key === "Escape") setExportOpen(false);
              }}>
                <button type="button" className="ct-chip" aria-expanded={exportOpen} aria-label="Exportar"
                  onClick={() => setExportOpen(open => !open)}>
                  Exportar ▾
                </button>
                {exportOpen && (
                  <div style={{ position: "absolute", zIndex: 30, right: 0, top: "calc(100% + 4px)", minWidth: 170, background: "#18181b", border: "1px solid #3f3f46", borderRadius: 9, padding: 6, display: "grid", gap: 2 }}>
                    {/* The PPT asks range and brand first — a grid is a per-client,
                        per-month artifact, and downloading "everything" would be noise. */}
                    <button type="button" className="ct-chip" style={{ textAlign: "left" }} onClick={() => {
                      setExportOpen(false);
                      const mm = String(cursor.getMonth() + 1).padStart(2, "0");
                      setPptFrom(`${cursor.getFullYear()}-${mm}-01`);
                      setPptTo(isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)));
                      setPptBrandId(filters.brandId || "");
                      setPptOpen(true);
                    }}>PPT</button>
                    <button type="button" className="ct-chip" style={{ textAlign: "left" }} onClick={() => { setExportOpen(false); exportAs("csv"); }}>CSV</button>
                    <button type="button" className="ct-chip" style={{ textAlign: "left" }} onClick={() => { setExportOpen(false); exportAs("xlsx"); }}>Excel</button>
                    {/* The upload path: a human fills the template elsewhere, the
                        calendar eats it — same columns, no retyping. */}
                    <button type="button" className="ct-chip" style={{ textAlign: "left" }} onClick={() => { setExportOpen(false); downloadTemplate(); }}
                      title="Descarga el formato CSV para cargar contenido hecho fuera de Futuraria">Plantilla</button>
                  </div>
                )}
              </div>
              <button type="button" className="ct-chip" disabled={Boolean(importing)}
                onClick={() => importInputRef.current?.click()}
                title="Importa un CSV con el formato de la plantilla">
                {importing || "⇧ Importar"}
              </button>
          </>
            <input ref={importInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
              aria-label="Importar contenido desde CSV" onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }} />
            {/* The gear itself lives in `connControl`: a missing key is fixed
                right here instead of sending the user hunting for Configuración.
                Every pane mounts it on its own control row; this shared row is
                calendar/sheet/reports' row. */}
            {connControl}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          padding: "10px 14px", fontSize: 12, color: "#fff",
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 9,
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError("")} style={btn}>Cerrar</button>
        </div>
      )}

      {loading && pane !== "copies" && pane !== "recipes" && pane !== "inbox" ? (
        <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando…</div>
      ) : pane === "calendar" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 0" }}>
            <button type="button" className="ct-chip" onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Mes anterior">←</button>
            <span style={{ fontSize: 13, color: "#fff", minWidth: 170, textTransform: "capitalize" }}>{monthLabel}</span>
            <button type="button" className="ct-chip" onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Mes siguiente">→</button>
            <button type="button" className="ct-chip" onClick={() => setCursor(new Date())}>Hoy</button>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              Arrastra una pieza a otro día para moverla
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "0 0 16px" }}>
            {/* Fit-to-viewport: the weekday row is auto and the week rows share
                the remaining height, so a whole month is visible without
                scrolling (user request). grid.length is always a multiple of 7. */}
            <div style={{ display: "grid", height: "100%", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gridTemplateRows: `auto repeat(${grid.length / 7}, minmax(0, 1fr))`, gap: 6 }}>
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => (
                <div key={d} style={{ padding: "6px 10px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: "rgba(255,255,255,0.4)" }}>{d}</div>
              ))}
              {grid.map(cell => (
                <div
                  key={cell.date}
                  className="cal-day"
                  // Dropping on a cell reschedules the piece to that date —
                  // the calendar equivalent of editing Fecha in the sheet.
                  onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropDate(cell.date);
                  }}
                  onDragLeave={() => setDropDate(cur => (cur === cell.date ? null : cur))}
                  onDrop={e => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    setDropDate(null);
                    setDragId(null);
                    if (id) patch(id, { scheduled_date: cell.date });
                  }}
                  style={{
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10, minHeight: 0, overflow: "hidden", padding: 6,
                    opacity: cell.inMonth ? 1 : 0.35,
                    outline: dropDate === cell.date
                      ? "2px dashed rgba(255,255,255,0.7)"
                      : cell.isToday ? "2px solid rgba(167,139,250,0.65)" : "none",
                    outlineOffset: -2,
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
                    <div
                      key={item.id}
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(item.id);
                      }}
                      onDragEnd={() => { setDragId(null); setDropDate(null); }}
                      // Clicking the card opens the detail panel; the day
                      // cells keep their own drop handlers untouched.
                      onClick={() => setPeekId(item.id)}
                      style={{
                        cursor: "pointer",
                        opacity: dragId === item.id ? 0.35 : 1,
                        display: "flex", width: "100%", textAlign: "left", marginBottom: 3, gap: 4, alignItems: "center",
                        padding: "3px 6px", fontSize: 11, fontFamily: "inherit",
                        color: "#fff", background: "#27272a", borderRadius: 7,
                        // An ad is money going out; it earns the heavier mark.
                        borderLeft: `2px solid ${item.kind === "ad" ? "#a78bfa" : "rgba(255,255,255,0.25)"}`,
                        position: "relative",
                      }}
                    >
                      {/* The piece's identity is its topic — the hour is
                          metadata and reads second (user request). */}
                      <button type="button" onClick={() => setPeekId(item.id)} title={item.copy || item.topic || ""} style={{
                        minWidth: 0, flex: 1, padding: 0, border: 0, background: "transparent", color: "inherit",
                        textAlign: "left", cursor: "pointer", display: "flex", gap: 6, alignItems: "baseline",
                      }}>
                        <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.topic || item.copy || "(sin tema)"}
                        </span>
                        {item.scheduled_time && (
                          <span style={{ flexShrink: 0, fontSize: 10, color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>
                            {item.scheduled_time.slice(0, 5)}
                          </span>
                        )}
                      </button>
                      <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", flexShrink: 0 }}>
                        {publishControls(item, "calendar")}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : pane === "sheet" ? (
        <div>
          <table className="ct" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["Tema", "Fecha", "Hora", "Tipo", "Marca", "Copy", "Canales", "Campaña", "Conjunto", "Estado",
                  "PROY $", "PROY Impr.", "REAL $", "REAL Impr.", "Avance", "Archivo", "Diseño", "Publicación", ""].map(h => (
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
                <tr key={r.id}
                  // Like a Notion row: clicking anywhere that is not a typed
                  // control opens the detail panel.
                  onClick={e => {
                    if ((e.target as HTMLElement).closest("input, select, textarea, button, a, option")) return;
                    setPeekId(r.id);
                  }}
                >
                  <td className="ct-cell-tema" style={{ ...CELL, minWidth: 170 }}>
                    <input value={r.topic || ""} placeholder="Tema" style={field}
                      onChange={e => patch(r.id, { topic: e.target.value })} />
                    <button type="button" className="ct-row-open" tabIndex={-1}
                      title="Abrir el detalle de esta pieza"
                      onClick={e => { e.stopPropagation(); setPeekId(r.id); }}>
                      Abrir
                    </button>
                  </td>
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
                  <td style={{ ...CELL, minWidth: 130 }}>
                    {/* The brand decides the publish destinations (see the
                        dialog's brand defaults), so it gets its own cell. */}
                    <select value={r.brand_id || ""} style={{ ...control, width: "100%" }} aria-label="Marca de la pieza"
                      onChange={e => patch(r.id, { brand_id: e.target.value || null })}>
                      <option value="" style={{ background: "#000" }}>(sin marca)</option>
                      {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#000" }}>{b.name}</option>)}
                    </select>
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
                  <td style={{ ...CELL, minWidth: 170 }}>
                    {/* A file picker, not an id input: "which design" is a
                        question about names. Changing the file clears the
                        frame — a frame id from another file would silently
                        point at nothing. One click still jumps to the editor. */}
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <select
                        value={r.template_id || ""}
                        onChange={e => {
                          const template_id = e.target.value || null;
                          const body: Record<string, unknown> = { template_id };
                          if (template_id !== (r.template_id || null)) body.frame_id = null;
                          patch(r.id, body);
                        }}
                        title="Archivo de diseño de esta pieza"
                        style={{ ...control, width: "auto", flex: 1 }}
                      >
                        <option value="" style={{ background: "#000" }}>(sin archivo)</option>
                        {r.template_id && !templateNameById.has(r.template_id) && (
                          <option value={r.template_id} style={{ background: "#000" }}>
                            {r.template_id.slice(0, 14)}… (no está en el workspace)
                          </option>
                        )}
                        {files.map(f => (
                          <option key={f.id} value={f.id} style={{ background: "#000" }}>{f.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="Abrir archivo en el editor"
                        disabled={!r.template_id}
                        onClick={() => r.template_id && onOpenTemplate?.(r.template_id)}
                        title="Abrir en el editor"
                        style={{
                          ...btn, padding: "3px 8px", flexShrink: 0,
                          opacity: r.template_id ? 1 : 0.35,
                          cursor: r.template_id ? "pointer" : "default",
                        }}
                      >↗</button>
                    </div>
                  </td>
                  <td style={{ ...CELL, minWidth: 150 }}>
                    {/* REQ-023: the exact frame inside the linked file. A grid
                        holds several designs in ONE file; "the file" cannot
                        say which art is this piece's. */}
                    {(() => {
                      const frames = r.template_id ? (framesByFile[r.template_id] || []) : [];
                      const loading = !!r.template_id && !framesByFile[r.template_id];
                      const known = frames.some(f => f.id === r.frame_id);
                      return (
                        <select
                          value={r.frame_id || ""}
                          disabled={!r.template_id}
                          title={r.template_id ? "Frame exacto del archivo" : "Elige primero un archivo"}
                          onChange={e => patch(r.id, { frame_id: e.target.value || null })}
                          style={{
                            ...control, width: "100%",
                            opacity: !r.template_id ? 0.45 : 1,
                            cursor: r.template_id ? "pointer" : "not-allowed",
                          }}
                        >
                          <option value="" style={{ background: "#000" }}>
                            {loading ? "(cargando frames…)" : r.template_id ? "(todo el archivo)" : "—"}
                          </option>
                          {r.frame_id && !known && !loading && (
                            <option value={r.frame_id} style={{ background: "#000" }}>
                              {r.frame_id.slice(0, 14)}… (frame no encontrado)
                            </option>
                          )}
                          {frames.map(f => (
                            <option key={f.id} value={f.id} style={{ background: "#000" }}>{f.name}</option>
                          ))}
                        </select>
                      );
                    })()}
                  </td>
                  <td style={{ ...CELL, minWidth: 250 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: r.publishing_status === "error" ? "#fca5a5" : "rgba(255,255,255,0.68)", fontSize: 11 }}>
                        {r.publishing_status || "borrador"}
                      </span>
                      {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" style={{ color: "#fff", fontSize: 11 }}>Ver post</a>}
                      {publishControls(r, "sheet")}
                    </div>
                    {r.publishing_error && (
                      <div role="alert" style={{ color: "#fca5a5", fontSize: 11, marginTop: 5, maxWidth: 280 }}>
                        {r.publishing_error}
                      </div>
                    )}
                  </td>
                  <td style={CELL}>
                    <button type="button" onClick={() => removeRow(r.id)} title="Eliminar" aria-label="Eliminar contenido"
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
        <div>
          <ReportsPane rows={visible} filters={filters} onExport={exportAs} />
        </div>
      ) : pane === "copies" ? (
        <div>
          <TextsTab workspaceId={workspaceId} onOpenTemplate={onOpenTemplate} actions={connControl} />
        </div>
      ) : pane === "inbox" ? (
        <div>
          <InboxPane
            workspaceId={workspaceId}
            zernioConnected={connections.some(c => c.provider === "zernio" && c.hasCredentials)}
            rows={inboxRows}
            loading={inboxLoading}
            filter={inboxFilter}
            replyDraft={replyDraft}
            busyId={inboxBusy}
            onFilter={setInboxFilter}
            onReplyDraft={(id, text) => setReplyDraft(cur => ({ ...cur, [id]: text }))}
            onSync={() => void loadInbox()}
            onReply={item => void sendReply(item)}
            onCapture={item => void captureContact(item)}
            onOpenSettings={onOpenSettings}
            actions={connControl}
          />
        </div>
      ) : (
        <div>
          <CopyRecipesTab workspaceId={workspaceId} actions={connControl} />
        </div>
      )}

      {pptOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Exportar grilla en PPT"
          onClick={() => { if (!pptBusy) setPptOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(5,7,12,0.66)", backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(430px, calc(100vw - 48px))",
              background: "rgba(15,18,28,0.98)",
              border: "1px solid rgba(99,102,241,0.35)",
              padding: 20, fontFamily: "inherit", color: "#fff",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Grilla en PPT</div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: "0 0 14px", lineHeight: 1.5 }}>
              Un documento para PowerPoint y Google Slides: portada con la marca, el rango y tu
              nombre, y un slide por pieza — copy seleccionable a la izquierda y, en el diseño,
              tú eliges si su texto llega editable o como parte de la imagen.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                Desde
                <input type="date" value={pptFrom} onChange={e => setPptFrom(e.target.value)}
                  aria-label="Desde"
                  style={{ ...control, colorScheme: "dark", display: "block", marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                Hasta
                <input type="date" value={pptTo} onChange={e => setPptTo(e.target.value)}
                  aria-label="Hasta"
                  style={{ ...control, colorScheme: "dark", display: "block", marginTop: 4 }} />
              </label>
            </div>
            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 12 }}>
              Marca
              <select value={pptBrandId} onChange={e => setPptBrandId(e.target.value)}
                aria-label="Marca de la grilla"
                style={{ ...control, display: "block", marginTop: 4, width: "100%" }}>
                <option value="" style={{ background: "#000" }}>Todas las marcas</option>
                {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#000" }}>{b.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 12 }}>
              Texto del diseño
              <select value={pptTextMode} onChange={e => setPptTextMode(e.target.value as "native" | "flat")}
                aria-label="Modo del texto del diseño"
                style={{ ...control, display: "block", marginTop: 4, width: "100%" }}>
                <option value="native" style={{ background: "#000" }}>Editable — texto copiable y movible</option>
                <option value="flat" style={{ background: "#000" }}>Imagen — fiel al diseño, no editable</option>
              </select>
            </label>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14 }}>
              {pptRangeCount} {pptRangeCount === 1 ? "pieza" : "piezas"} en el rango → {pptRangeCount + 1} slides (portada incluida)
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={{ ...btn, opacity: pptBusy ? 0.45 : 1 }}
                disabled={!!pptBusy} onClick={() => setPptOpen(false)}>Cancelar</button>
              <button type="button"
                style={{ ...btn, opacity: pptBusy || pptRangeCount === 0 ? 0.45 : 1 }}
                disabled={!!pptBusy || pptRangeCount === 0}
                onClick={() => void generatePpt()}>
                {pptBusy || "⇩ Generar PPT"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish / schedule: one dialog for both views. It asks only what the
          piece cannot answer — destinations first, date and hora when the
          run is a schedule. */}
      {publishRow && publishDraft && (() => {
        const brandName = brands.find(b => b.id === publishRow.brand_id)?.name;
        const platforms = [...new Set(accountOptions.map(a => a.platform))];
        const busy = publishingId === publishRow.id;
        const scheduleMissing = publishDraft.mode === "schedule" && (!publishDraft.date || !publishDraft.time);
        const close = () => { setPublishRow(null); setPublishDraft(null); };
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={publishDraft.mode === "now" ? "Publicar pieza" : "Programar pieza"}
            onClick={() => { if (!busy) close(); }}
            style={{
              position: "fixed", inset: 0, zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(5,7,12,0.66)", backdropFilter: "blur(2px)",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === "Escape" && !busy) close(); }}
              style={{
                width: "min(520px, calc(100vw - 48px))",
                maxHeight: "calc(100vh - 64px)", overflow: "auto",
                background: "rgba(15,18,28,0.98)",
                border: "1px solid rgba(99,102,241,0.35)",
                padding: 20, fontFamily: "inherit", color: "#fff",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
                {publishDraft.mode === "now" ? "Publicar ahora" : "Programar"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 12 }}>
                {publishRow.topic || publishRow.copy || "(sin tema)"}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                  Acción
                  <select value={publishDraft.mode} aria-label="Acción"
                    onChange={e => setPublishDraft(v => v ? { ...v, mode: e.target.value as PublishDraft["mode"] } : v)}
                    style={{ ...control, display: "block", marginTop: 4 }}>
                    <option value="now" style={{ background: "#000" }}>Publicar ahora</option>
                    <option value="schedule" style={{ background: "#000" }}>Programar</option>
                  </select>
                </label>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                  Tipo
                  <select value={publishDraft.contentType} aria-label="Tipo de contenido"
                    onChange={e => setPublishDraft(v => v ? { ...v, contentType: e.target.value as PublishDraft["contentType"] } : v)}
                    style={{ ...control, display: "block", marginTop: 4 }}>
                    {(["post", "story", "reel"] as const).map(ct => (
                      <option key={ct} value={ct} style={{ background: "#000" }}>
                        {CONTENT_TYPE_LABEL[ct]}{ct !== "post" ? " (Zernio)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {publishDraft.mode === "schedule" && (
                  <>
                    <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                      Fecha
                      <input type="date" value={publishDraft.date} aria-label="Fecha"
                        onChange={e => setPublishDraft(v => v ? { ...v, date: e.target.value } : v)}
                        style={{
                          ...control, colorScheme: "dark", display: "block", marginTop: 4,
                          ...(scheduleMissing && !publishDraft.date ? { outline: "1px solid #fca5a5" } : {}),
                        }} />
                    </label>
                    <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                      Hora
                      <input type="time" value={publishDraft.time} aria-label="Hora"
                        onChange={e => setPublishDraft(v => v ? { ...v, time: e.target.value } : v)}
                        style={{
                          ...control, colorScheme: "dark", display: "block", marginTop: 4,
                          ...(scheduleMissing && !publishDraft.time ? { outline: "1px solid #fca5a5" } : {}),
                        }} />
                    </label>
                  </>
                )}
              </div>
              {publishDraft.mode === "schedule" && (
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 10 }}>
                  Zona horaria
                  <input value={publishDraft.timezone} aria-label="Zona horaria"
                    onChange={e => setPublishDraft(v => v ? { ...v, timezone: e.target.value } : v)}
                    style={{ ...control, display: "block", marginTop: 4, width: "100%" }} />
                </label>
              )}

              <label style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
                URL de imagen o video (opcional; reemplaza el diseño vinculado)
                <input type="url" value={publishDraft.mediaUrl} disabled={busy} aria-label="URL de imagen o video"
                  onChange={event => setPublishDraft(value => value ? { ...value, mediaUrl: event.target.value } : value)}
                  placeholder="https://…" style={{ ...control, display: "block", marginTop: 4, width: "100%" }} />
              </label>
              {error && <p role="alert" style={{ color: "#fca5a5", fontSize: 12 }}>{error}</p>}
              {/* Destinations are concrete accounts, several at once, grouped
                  by platform — a corp group owns two Instagrams and both ship
                  the same post. */}
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>
                Destinos{publishDraft.provider ? ` — sale por ${PROVIDER_META[publishDraft.provider].name}` : ""}
              </div>
              {accountOptions.length === 0 ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", padding: "6px 0 10px" }}>
                  {accountsLoading
                    ? "Cargando cuentas…"
                    : publishDraft.provider
                      ? "Sin cuentas en este proveedor — revisa Conexiones."
                      : "Sin proveedor conectado — guarda una API key en Conexiones."}
                </div>
              ) : (
                <div style={{ border: "1px solid rgba(255,255,255,0.16)", padding: 8, maxHeight: 190, overflow: "auto", marginBottom: 10 }}>
                  {platforms.map(platform => (
                    <div key={platform} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 2 }}>
                        {platformToChannel(platform) || platform}
                      </div>
                      {accountOptions.filter(a => a.platform === platform).map(account => (
                        <label key={account.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
                          <input type="checkbox"
                            checked={publishDraft.accountIds.includes(account.id)}
                            onChange={e => setPublishDraft(v => v ? {
                              ...v,
                              accountIds: e.target.checked
                                ? [...v.accountIds, account.id]
                                : v.accountIds.filter(id => id !== account.id),
                            } : v)} />
                          <span style={{ opacity: account.isActive ? 1 : 0.45 }}>
                            {account.displayName || account.username || account.id}
                            {account.username ? ` · @${account.username}` : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                  {accountsLoading && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Actualizando lista…</div>}
                </div>
              )}

              {/* The dialog fills today's gap and can close it for next time:
                  the picks become the piece's brand default destinations. */}
              {publishRow.brand_id && brandName && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={publishDraft.saveBrandDefault}
                    onChange={e => setPublishDraft(v => v ? { ...v, saveBrandDefault: e.target.checked } : v)} />
                  Guardar como destinos predeterminados de {brandName}
                </label>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={{ ...btn, opacity: busy ? 0.45 : 1 }}
                  disabled={busy} onClick={close}>Cancelar</button>
                <button type="button" style={{ ...btn, opacity: busy ? 0.45 : 1 }}
                  disabled={busy} onClick={() => void confirmPublish()}>
                  {busy ? "Enviando…" : publishDraft.mode === "now" ? "Publicar ahora" : "Programar"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Notion-style peek: one piece's full detail, over either view. It
          edits through the same patch() as the sheet, so the panel IS the
          row — not a read-only summary. Backdrop click, ×, or Escape closes;
          anything stacked on top (publish menu/dialog) closes first. */}
      {peekRow && (() => {
        const peekFrames = peekRow.template_id ? (framesByFile[peekRow.template_id] || []) : [];
        const framesLoading = !!peekRow.template_id && !framesByFile[peekRow.template_id];
        const frameKnown = peekFrames.some(f => f.id === peekRow.frame_id);
        const avance = pacing((peekRow as any).actual_spend, (peekRow as any).plan_spend);
        const toggleChannel = (channel: string) => {
          const current = peekRow.channels || [];
          patch(peekRow.id, {
            channels: current.includes(channel) ? current.filter(c => c !== channel) : [...current, channel],
          });
        };
        const metricInput = (key: "plan_spend" | "plan_impressions" | "actual_spend" | "actual_impressions", label: string) => (
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            {label}
            <input inputMode="decimal" value={(peekRow as any)[key] ?? ""} placeholder="—"
              aria-label={label}
              style={{ ...field, border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, padding: "6px 9px" }}
              onChange={e => patch(peekRow.id, { [key]: e.target.value })} />
          </label>
        );
        return (
          <>
            <div className="ct-peek-backdrop" onClick={() => setPeekId(null)} aria-hidden="true" />
            <aside className="ct-peek" role="dialog" aria-label="Detalle de la pieza">
              <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px 0" }}>
                <span style={{ flex: 1, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>
                  Detalle de contenido
                </span>
                {publishControls(peekRow, "sheet")}
                <button type="button" aria-label="Cerrar detalle" onClick={() => setPeekId(null)}
                  style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "2px 6px" }}>×</button>
              </header>
              <div style={{ padding: "12px 18px 26px", display: "grid", gap: 16 }}>
                <input className="ct-peek-title" value={peekRow.topic || ""} placeholder="Sin tema"
                  aria-label="Tema de la pieza"
                  onChange={e => patch(peekRow.id, { topic: e.target.value })} />

                {/* Properties — the same fields the sheet edits, Notion-style */}
                <div style={{ display: "grid", gap: 2, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Tipo</span>
                    <select value={peekRow.kind} aria-label="Tipo" style={{ ...control, width: "100%" }}
                      onChange={e => patch(peekRow.id, { kind: e.target.value })}>
                      {CONTENT_KINDS.map(k => <option key={k} value={k} style={{ background: "#000" }}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Fecha</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input type="date" value={peekRow.scheduled_date || ""} aria-label="Fecha"
                        style={{ ...field, colorScheme: "dark" }}
                        onChange={e => patch(peekRow.id, { scheduled_date: e.target.value })} />
                      <input type="time" value={(peekRow.scheduled_time || "").slice(0, 5)} aria-label="Hora"
                        style={{ ...field, colorScheme: "dark", maxWidth: 110 }}
                        onChange={e => patch(peekRow.id, { scheduled_time: e.target.value })} />
                    </div>
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Estado</span>
                    <select value={peekRow.status} aria-label="Estado" style={{ ...control, width: "100%" }}
                      onChange={e => patch(peekRow.id, { status: e.target.value })}>
                      {CONTENT_STATUSES.map(s => <option key={s} value={s} style={{ background: "#000" }}>{s}</option>)}
                    </select>
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Marca</span>
                    <select value={peekRow.brand_id || ""} aria-label="Marca" style={{ ...control, width: "100%" }}
                      onChange={e => patch(peekRow.id, { brand_id: e.target.value || null })}>
                      <option value="" style={{ background: "#000" }}>(sin marca)</option>
                      {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#000" }}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="ct-prop-row" style={{ alignItems: "start" }}>
                    <span className="ct-prop-label" style={{ paddingTop: 7 }}>Canales</span>
                    {/* Toggle chips instead of the sheet's multi-select — a
                        panel reads, a list of pills scans. */}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", padding: "4px 0" }}>
                      {CHANNELS.map(c => (
                        <button key={c} type="button" aria-pressed={(peekRow.channels || []).includes(c)}
                          className={`ct-channel-chip${(peekRow.channels || []).includes(c) ? " on" : ""}`}
                          onClick={() => toggleChannel(c)}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Campaña</span>
                    <input value={peekRow.campaign || ""} placeholder="—" aria-label="Campaña" style={field}
                      onChange={e => patch(peekRow.id, { campaign: e.target.value })} />
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Conjunto</span>
                    <input value={peekRow.ad_set || ""} placeholder="—" aria-label="Conjunto de anuncios" style={field}
                      onChange={e => patch(peekRow.id, { ad_set: e.target.value })} />
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Archivo</span>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <select value={peekRow.template_id || ""} aria-label="Archivo de diseño"
                        title="Archivo de diseño de esta pieza"
                        onChange={e => {
                          const template_id = e.target.value || null;
                          const body: Record<string, unknown> = { template_id };
                          if (template_id !== (peekRow.template_id || null)) body.frame_id = null;
                          patch(peekRow.id, body);
                        }}
                        style={{ ...control, flex: 1, width: "auto" }}>
                        <option value="" style={{ background: "#000" }}>(sin archivo)</option>
                        {peekRow.template_id && !templateNameById.has(peekRow.template_id) && (
                          <option value={peekRow.template_id} style={{ background: "#000" }}>
                            {peekRow.template_id.slice(0, 14)}… (no está en el workspace)
                          </option>
                        )}
                        {files.map(f => <option key={f.id} value={f.id} style={{ background: "#000" }}>{f.name}</option>)}
                      </select>
                      <button type="button" aria-label="Abrir archivo en el editor" disabled={!peekRow.template_id}
                        onClick={() => peekRow.template_id && onOpenTemplate?.(peekRow.template_id)}
                        title="Abrir en el editor"
                        style={{ ...btn, padding: "3px 8px", opacity: peekRow.template_id ? 1 : 0.35, cursor: peekRow.template_id ? "pointer" : "default" }}>↗</button>
                    </div>
                  </div>
                  <div className="ct-prop-row">
                    <span className="ct-prop-label">Diseño</span>
                    <select value={peekRow.frame_id || ""} aria-label="Frame exacto del archivo"
                      disabled={!peekRow.template_id}
                      title={peekRow.template_id ? "Frame exacto del archivo" : "Elige primero un archivo"}
                      onChange={e => patch(peekRow.id, { frame_id: e.target.value || null })}
                      style={{ ...control, width: "100%", opacity: !peekRow.template_id ? 0.45 : 1, cursor: peekRow.template_id ? "pointer" : "not-allowed" }}>
                      <option value="" style={{ background: "#000" }}>
                        {framesLoading ? "(cargando frames…)" : peekRow.template_id ? "(todo el archivo)" : "—"}
                      </option>
                      {peekRow.frame_id && !frameKnown && !framesLoading && (
                        <option value={peekRow.frame_id} style={{ background: "#000" }}>
                          {peekRow.frame_id.slice(0, 14)}… (frame no encontrado)
                        </option>
                      )}
                      {peekFrames.map(f => <option key={f.id} value={f.id} style={{ background: "#000" }}>{f.name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>Copy</div>
                  <textarea value={peekRow.copy || ""} rows={7} placeholder="Escribe el copy completo de la pieza…"
                    aria-label="Copy de la pieza"
                    style={{ ...field, border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, padding: "10px 12px", fontSize: 13, lineHeight: 1.55, resize: "vertical", minHeight: 120 }}
                    onChange={e => patch(peekRow.id, { copy: e.target.value })} />
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>Rendimiento</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {metricInput("plan_spend", "PROY Inversión")}
                    {metricInput("plan_impressions", "PROY Impresiones")}
                    {metricInput("actual_spend", "REAL Inversión")}
                    {metricInput("actual_impressions", "REAL Impresiones")}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    Avance: {avance === null ? "—" : `${Math.round(avance * 100)}%`}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>Publicación</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ color: peekRow.publishing_status === "error" ? "#fca5a5" : "rgba(255,255,255,0.68)" }}>
                      {peekRow.publishing_status || "borrador"}
                    </span>
                    {peekRow.permalink && <a href={peekRow.permalink} target="_blank" rel="noreferrer" style={{ color: "#fff" }}>Ver post ↗</a>}
                  </div>
                  {peekRow.publishing_error && (
                    <div role="alert" style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.4 }}>{peekRow.publishing_error}</div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12, display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" title="Elimina esta pieza del calendario"
                    onClick={() => { removeRow(peekRow.id); setPeekId(null); }}
                    style={{ background: "transparent", border: "1px solid rgba(255,139,139,0.4)", borderRadius: 8, color: "#ffb4b4", font: "inherit", fontSize: 12, padding: "5px 12px", cursor: "pointer" }}>
                    Eliminar pieza
                  </button>
                </div>
              </div>
            </aside>
          </>
        );
      })()}
    </div>
  );
}

/**
 * The Zernio inbox: messages and comments mirrored into social_inbox, with
 * reply and CRM capture inline. Buffer deliberately has no pane here — its
 * capability set ends at publishing, so its absence is the honest UI.
 */
function InboxPane({ workspaceId, zernioConnected, rows, loading, filter, replyDraft, busyId, onFilter, onReplyDraft, onSync, onReply, onCapture, onOpenSettings, actions }: {
  workspaceId: string | null;
  zernioConnected: boolean;
  rows: InboxRow[];
  loading: boolean;
  filter: "todos" | "message" | "comment";
  replyDraft: Record<string, string>;
  busyId: string | null;
  onFilter: (value: "todos" | "message" | "comment") => void;
  onReplyDraft: (id: string, text: string) => void;
  onSync: () => void;
  onReply: (item: InboxRow) => void;
  onCapture: (item: InboxRow) => void;
  onOpenSettings?: () => void;
  actions?: React.ReactNode;
}) {
  const visible = filter === "todos" ? rows : rows.filter(r => r.kind === filter);
  const statusLabel = (status: string) =>
    status === "respondido" ? "Respondido" : status === "capturado" ? "En el CRM" : "Nuevo";
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {!workspaceId ? (
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          Abre un workspace para ver la bandeja.
        </div>
      ) : !zernioConnected ? (
        <div style={{ display: "grid", gap: 10, maxWidth: 480, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
          <div>
            La bandeja de mensajes y comentarios es una capacidad de Zernio. Pega tu API key en el botón{" "}
            <strong>Conexiones</strong> de la barra de arriba — o configúrala con más detalle (cuentas,
            webhook) en Configuración.
          </div>
          {onOpenSettings && (
            <div>
              <button type="button" style={btn} onClick={onOpenSettings}>Abrir Configuración</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={btn} disabled={loading} onClick={onSync}>
              {loading ? "Sincronizando…" : "⟳ Sincronizar"}
            </button>
            <select value={filter} style={control} aria-label="Filtrar por tipo"
              onChange={e => onFilter(e.target.value as "todos" | "message" | "comment")}>
              <option value="todos" style={{ background: "#000" }}>Mensajes y comentarios</option>
              <option value="message" style={{ background: "#000" }}>Solo mensajes</option>
              <option value="comment" style={{ background: "#000" }}>Solo comentarios</option>
            </select>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
              {visible.length} de {rows.length} conversaciones
            </span>
            {actions}
          </div>
          {rows.length === 0 && !loading ? (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
              Sincroniza para traer los mensajes y comentarios que llegaron a Zernio.
            </div>
          ) : (
            <table className="ct" style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {["Fecha", "Tipo", "Canal", "Autor", "Contenido", "Estado", "Acciones"].map(label => (
                    <th key={label} style={{
                      ...CELL, background: "#000", fontWeight: 600, fontSize: 11.5,
                      color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap",
                    }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(item => (
                  <tr key={item.id}>
                    <td style={{ ...CELL, whiteSpace: "nowrap" }}>{inboxDate(item.occurred_at)}</td>
                    <td style={CELL}>{item.kind === "comment" ? "Comentario" : "Mensaje"}</td>
                    <td style={CELL}>{item.platform || "—"}</td>
                    <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                      {item.author_name || item.author_handle || "Anónimo"}
                      {item.author_email && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{item.author_email}</div>
                      )}
                    </td>
                    <td style={{ ...CELL, whiteSpace: "normal", minWidth: 220, maxWidth: 360 }}>
                      {item.content || "—"}
                    </td>
                    <td style={{
                      ...CELL, whiteSpace: "nowrap", fontSize: 11.5,
                      color: item.status === "capturado" ? "#4ade80" : "rgba(255,255,255,0.6)",
                    }}>
                      {statusLabel(item.status)}
                    </td>
                    <td style={CELL}>
                      {item.status === "nuevo" ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
                          <textarea
                            value={replyDraft[item.id] || ""}
                            rows={2}
                            placeholder="Escribe la respuesta…"
                            aria-label={`Responder a ${item.author_name || item.author_handle || "esta conversación"}`}
                            style={{ ...field, border: "1px solid rgba(255,255,255,0.18)", resize: "vertical" }}
                            onChange={e => onReplyDraft(item.id, e.target.value)}
                          />
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" style={{ ...btn, padding: "3px 8px" }}
                              disabled={busyId === item.id || !(replyDraft[item.id] || "").trim()}
                              onClick={() => onReply(item)}>
                              {busyId === item.id ? "…" : "Responder"}
                            </button>
                            <button type="button" style={{ ...btn, padding: "3px 8px" }}
                              disabled={busyId === item.id}
                              onClick={() => onCapture(item)}>
                              Capturar al CRM
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
                          {item.status === "respondido" ? "Gestionada en Zernio" : "Visible en Contactos"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
