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
import { CopyRecipesTab } from "./CopyRecipesTab";
import { SOCIAL_CAPABILITIES, type SocialCapabilities, type SocialProviderId } from "../../shared/socialProviders.ts";

type Pane = "calendar" | "sheet" | "reports" | "copies" | "recipes" | "inbox";
const PANES: readonly Pane[] = ["calendar", "sheet", "reports", "copies", "recipes", "inbox"];

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
}

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

export function ContentTab({ workspaceId, onOpenTemplate, paneHint, onOpenSettings }: Props) {
  const [pane, setPane] = useState<Pane>("calendar");
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishMenuId, setPublishMenuId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({ date: "", time: "", timezone: "America/Lima", channels: [] as string[], contentType: "post" as "post" | "story" | "reel" });

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

  const publishContent = useCallback(async (
    row: ContentRow,
    mode: "now" | "schedule",
    schedule?: typeof scheduleDraft,
  ) => {
    if (publishingId) return;
    setPublishingId(row.id);
    setError("");
    try {
      const channels = schedule?.channels || row.channels || [];
      let scheduledFor: string | undefined;
      if (mode === "schedule") {
        if (!schedule?.date || !schedule.time) throw new Error("Elige fecha y hora para programar");
        scheduledFor = zernioScheduledFor(schedule.date, schedule.time, schedule.timezone);
      }
      const res = await apiFetch<{ data?: ContentRow }>(`/api/content/${row.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          channels,
          contentType: schedule?.contentType || "post",
          timezone: schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          scheduledFor,
        }),
      });
      if (res?.data) setRows(current => current.map(item => item.id === row.id ? res.data! : item));
      setScheduleId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setPublishingId(null);
    }
  }, [publishingId, load]);

  const openSchedule = useCallback((row: ContentRow) => {
    setPublishMenuId(null);
    setScheduleId(current => current === row.id ? null : row.id);
    setScheduleDraft({
      date: row.scheduled_date || isoDate(new Date()),
      time: (row.scheduled_time || "09:00").slice(0, 5),
      timezone: row.publishing_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
      channels: row.channels || [],
      contentType: "post",
    });
  }, []);

  const publishControls = (row: ContentRow) => {
    const disabled = publishingId === row.id || ["programado", "publicando", "publicado"].includes(row.publishing_status || "");
    const runNow = (contentType: "post" | "story" | "reel") => {
      setPublishMenuId(null);
      void publishContent(row, "now", {
        date: "", time: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        channels: row.channels || [], contentType,
      });
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
            <button type="button" style={{ ...btn, width: "100%", textAlign: "left", border: 0 }} onClick={() => openSchedule(row)}>Programar…</button>
          </div>
        )}
      </div>
    );
  };

  const scheduleControls = (row: ContentRow) => scheduleId === row.id ? (
    <div id={`schedule-${row.id}`} style={{ marginTop: 8, padding: 8, border: "1px solid rgba(255,255,255,0.2)", display: "grid", gap: 6 }}>
      <label style={{ fontSize: 11 }}>Tipo
        <select value={scheduleDraft.contentType} style={{ ...control, display: "block", width: "100%", marginTop: 2 }}
          onChange={event => setScheduleDraft(value => ({ ...value, contentType: event.target.value as "post" | "story" | "reel" }))}>
          <option value="post">Post</option><option value="story">Story (Zernio)</option><option value="reel">Reel (Zernio)</option>
        </select>
      </label>
      <label style={{ fontSize: 11 }}>Fecha
        <input type="date" value={scheduleDraft.date} style={{ ...control, display: "block", width: "100%", marginTop: 2 }} onChange={event => setScheduleDraft(value => ({ ...value, date: event.target.value }))} />
      </label>
      <label style={{ fontSize: 11 }}>Hora
        <input type="time" value={scheduleDraft.time} style={{ ...control, display: "block", width: "100%", marginTop: 2 }} onChange={event => setScheduleDraft(value => ({ ...value, time: event.target.value }))} />
      </label>
      <label style={{ fontSize: 11 }}>Zona horaria
        <input value={scheduleDraft.timezone} style={{ ...control, display: "block", width: "100%", marginTop: 2 }} onChange={event => setScheduleDraft(value => ({ ...value, timezone: event.target.value }))} />
      </label>
      <label style={{ fontSize: 11 }}>Canales
        <select multiple value={scheduleDraft.channels} style={{ ...control, display: "block", width: "100%", height: 58, marginTop: 2 }} onChange={event => setScheduleDraft(value => ({ ...value, channels: [...event.target.selectedOptions].map(option => option.value) }))}>
          {CHANNELS.map(channel => <option key={channel} value={channel} style={{ background: "#000" }}>{channel}</option>)}
        </select>
      </label>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" style={{ ...btn, padding: "3px 7px" }} onClick={() => setScheduleId(null)}>Cancelar</button>
        <button type="button" style={{ ...btn, padding: "3px 7px" }} disabled={publishingId === row.id} onClick={() => void publishContent(row, "schedule", scheduleDraft)}>Confirmar</button>
      </div>
    </div>
  ) : null;

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
        <Tab active={pane === "recipes"} onClick={() => setPane("recipes")}>Recetas</Tab>
        <Tab active={pane === "inbox"} onClick={() => setPane("inbox")}>Bandeja</Tab>
        <div style={{ flex: 1 }} />
        {pane !== "copies" && pane !== "recipes" && pane !== "inbox" && (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            {visible.length} de {rows.length} piezas · {visible.filter(r => r.kind === "ad").length} ads
          </span>
        )}
        {/* Connections popover — present on every pane: a missing key is fixed
            right here instead of sending the user hunting for Configuración. */}
        <div style={{ position: "relative" }} onKeyDown={event => {
          if (event.key === "Escape") setConnOpen(false);
        }}>
          <button type="button" style={{ ...btn, padding: "4px 12px" }} aria-expanded={connOpen}
            aria-label="Conexiones sociales"
            onClick={() => setConnOpen(v => !v)}>
            Conexiones{publishProvider ? ` · publica ${PROVIDER_META[publishProvider].name}` : ""}
          </button>
          {connOpen && (
            <div style={{
              position: "absolute", zIndex: 30, right: 0, top: "calc(100% + 6px)", width: 320,
              background: "#111", border: "1px solid rgba(255,255,255,0.28)", padding: 12, display: "grid", gap: 12,
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
                        style={{ ...control, flex: 1 }}
                        onChange={e => setKeyDraft(cur => ({ ...cur, [id]: e.target.value }))} />
                      <button type="button" style={{ ...btn, padding: "3px 10px" }}
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
                  <button type="button" style={{ ...btn, padding: "3px 8px" }}
                    onClick={() => { setConnOpen(false); onOpenSettings(); }}>
                    Abrir
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pane !== "copies" && pane !== "recipes" && pane !== "inbox" && (
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
          {/* The PPT asks range and brand first — a grid is a per-client,
              per-month artifact, and downloading "everything" would be noise. */}
          <button type="button" style={btn} onClick={() => {
            const mm = String(cursor.getMonth() + 1).padStart(2, "0");
            setPptFrom(`${cursor.getFullYear()}-${mm}-01`);
            setPptTo(isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)));
            setPptBrandId(filters.brandId || "");
            setPptOpen(true);
          }}>⇩ PPT</button>
          {/* The upload path: a human fills the template elsewhere, the
              calendar eats it — same columns, no retyping. */}
          <button type="button" style={btn} onClick={downloadTemplate}
            title="Descarga el formato CSV para cargar contenido hecho fuera de Futuraria">⇩ Plantilla</button>
          <button type="button" style={btn} disabled={Boolean(importing)}
            onClick={() => importInputRef.current?.click()}
            title="Importa un CSV con el formato de la plantilla">
            {importing || "⇧ Importar"}
          </button>
          <input ref={importInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
            aria-label="Importar contenido desde CSV" onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }} />
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

      {loading && pane !== "copies" && pane !== "recipes" && pane !== "inbox" ? (
        <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando…</div>
      ) : pane === "calendar" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px" }}>
            <button type="button" style={btn} onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>←</button>
            <span style={{ fontSize: 13, color: "#fff", minWidth: 170, textTransform: "capitalize" }}>{monthLabel}</span>
            <button type="button" style={btn} onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>→</button>
            <button type="button" style={btn} onClick={() => setCursor(new Date())}>Hoy</button>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              Arrastra una pieza a otro día para moverla
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "0 16px 16px" }}>
            {/* Fit-to-viewport: the weekday row is auto and the week rows share
                the remaining height, so a whole month is visible without
                scrolling (user request). grid.length is always a multiple of 7. */}
            <div style={{ display: "grid", height: "100%", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gridTemplateRows: `auto repeat(${grid.length / 7}, minmax(0, 1fr))`, gap: 1, background: "rgba(255,255,255,0.10)" }}>
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => (
                <div key={d} style={{ background: "#000", padding: "6px 8px", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{d}</div>
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
                    background: "#000", minHeight: 0, overflow: "hidden", padding: 6,
                    opacity: cell.inMonth ? 1 : 0.35,
                    outline: dropDate === cell.date
                      ? "2px dashed rgba(255,255,255,0.7)"
                      : cell.isToday ? "1px solid rgba(255,255,255,0.55)" : "none",
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
                    <div
                      key={item.id}
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(item.id);
                      }}
                      onDragEnd={() => { setDragId(null); setDropDate(null); }}
                      style={{
                        opacity: dragId === item.id ? 0.35 : 1,
                        display: "flex", width: "100%", textAlign: "left", marginBottom: 3, gap: 4, alignItems: "center",
                        padding: "3px 5px", fontSize: 11, fontFamily: "inherit",
                        color: "#fff", background: "rgba(255,255,255,0.08)",
                        // An ad is money going out; it earns the heavier mark.
                        borderLeft: `2px solid ${item.kind === "ad" ? "#fff" : "rgba(255,255,255,0.3)"}`,
                        border: "none", borderLeftWidth: 2, borderLeftStyle: "solid",
                        position: "relative",
                      }}
                    >
                      <button type="button" onClick={() => setPane("sheet")} title={item.copy || item.topic || ""} style={{
                        minWidth: 0, flex: 1, padding: 0, border: 0, background: "transparent", color: "inherit",
                        textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer",
                      }}>
                        {item.scheduled_time ? `${item.scheduled_time.slice(0, 5)} ` : ""}{item.topic || item.copy || "(sin tema)"}
                      </button>
                      {publishControls(item)}
                      {scheduleControls(item)}
                    </div>
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
                      {publishControls(r)}
                    </div>
                    {r.publishing_error && (
                      <div role="alert" style={{ color: "#fca5a5", fontSize: 11, marginTop: 5, maxWidth: 280 }}>
                        {r.publishing_error}
                      </div>
                    )}
                    {scheduleControls(r)}
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
        <ReportsPane rows={visible} filters={filters} onExport={exportAs} />
      ) : pane === "copies" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <TextsTab workspaceId={workspaceId} onOpenTemplate={onOpenTemplate} />
        </div>
      ) : pane === "inbox" ? (
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
        />
      ) : (
        <CopyRecipesTab workspaceId={workspaceId} />
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
    </div>
  );
}

/**
 * The Zernio inbox: messages and comments mirrored into social_inbox, with
 * reply and CRM capture inline. Buffer deliberately has no pane here — its
 * capability set ends at publishing, so its absence is the honest UI.
 */
function InboxPane({ workspaceId, zernioConnected, rows, loading, filter, replyDraft, busyId, onFilter, onReplyDraft, onSync, onReply, onCapture, onOpenSettings }: {
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
}) {
  const visible = filter === "todos" ? rows : rows.filter(r => r.kind === filter);
  const statusLabel = (status: string) =>
    status === "respondido" ? "Respondido" : status === "capturado" ? "En el CRM" : "Nuevo";
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
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
