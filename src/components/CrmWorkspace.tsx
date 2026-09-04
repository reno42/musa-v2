import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getApiHeaders } from "../lib/apiKey";
import { ALL_DEAL_STAGES as DEAL_STAGES, buildFunnel, contactName, type DealStage } from "../lib/crmFunnel";
import { ASSET_TYPE_OPTIONS, type DesignAssetType } from "../lib/designGraph";

type Brand = {
  id: string;
  name: string;
  relationship_status: "lead" | "client";
  account_health: "active" | "at_risk" | "churned";
  crm_priority: "low" | "medium" | "high" | "urgent";
  crm_notes?: string;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  contact_count: number;
  design_count: number;
  deal_count: number;
  design_system_template_id?: string | null;
  brand_guideline_id?: string | null;
  has_design_system?: boolean;
  suggestions: Array<{ assetType: string; title: string; reason: string }>;
  /** v45 (DIATTA): salud computada server-side — el override manual gana. */
  computed_health?: "active" | "at_risk" | "churned";
  /** v45: pin manual del humano; null/undefined = salud automática. */
  account_health_override?: "active" | "at_risk" | "churned" | null;
  interaction_count?: number;
};

type Contact = {
  id: string;
  brand_id?: string | null;
  brand_name?: string | null;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  company?: string | null;
  status?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  /** v45 (DIATTA): números comerciales por persona (tabla Personas). */
  dealStats?: { dealCount: number; openDeals: number; openValue: number; wonValue: number; currency: string | null };
  interaction_count?: number;
};

/** v45: un touchpoint comercial del timeline (crm_interactions). */
type Interaction = {
  id: string;
  brand_id: string;
  contact_id?: string | null;
  interaction_type: string;
  notes?: string | null;
  interaction_date: string;
};

type Campaign = { id: string; brand_id: string; name: string; status: string };
type DesignFile = {
  template_id: string;
  brand_id?: string | null;
  campaign_id?: string | null;
  asset_type: string;
  name: string;
  thumbnail?: string | null;
};
type Deliverable = {
  id: string;
  deal_id: string;
  asset_type: string;
  label: string;
  quantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  status: "complete" | "partial" | "pending";
  matchedFiles: DesignFile[];
  candidateFiles: DesignFile[];
};
type Deal = {
  id: string;
  brand_id: string;
  campaign_id?: string | null;
  primary_contact_id?: string | null;
  title: string;
  description?: string | null;
  stage: DealStage;
  value?: number | null;
  final_value?: number | null;
  lost_reason?: string | null;
  currency: string;
  probability: number;
  expected_close_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  progress: {
    requested: number;
    completed: number;
    percentage: number;
    complete: boolean;
    canReconcile: boolean;
    warning?: string | null;
    deliverables: Deliverable[];
  };
};
type CrmData = {
  brands: Brand[];
  contacts: Contact[];
  campaigns: Campaign[];
  deals: Deal[];
  designs: DesignFile[];
  summary: {
    pipelineValue: number;
    weightedValue: number;
    openDeals: number;
    pendingDeliverables: number;
    atRiskAccounts?: number;
    interactions?: number;
  };
};
/** The four CRM views: Ventas kanban, Personas table, Marcas accounts, Embudo. */
export type CrmView = "pipeline" | "personas" | "accounts" | "embudo";

/** v46 (DIATTA): pie de tabla «Mostrar N por página · Mostrando X-Y de Z resultados». */
function CrmTablePagination({ pageSize, onPageSizeChange, page, onPageChange, pageCount, total }: {
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  page: number;
  onPageChange: (page: number) => void;
  pageCount: number;
  total: number;
}) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  return (
    <div className="crm-pagination-section">
      <div className="crm-pagination-info">
        <label className="crm-page-size">
          Mostrar:
          <select value={pageSize} aria-label="Filas por página" onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span>por página</span>
        </label>
        <span className="crm-results-info">Mostrando {start}-{end} de {total} resultados</span>
      </div>
      <div className="crm-pagination-controls">
        <button type="button" className="crm-page-btn" disabled={page === 0} onClick={() => onPageChange(page - 1)}>← Anterior</button>
        {Array.from({ length: pageCount }, (_, index) => (
          <button type="button" key={index} className={`crm-page-btn${index === page ? " active" : ""}`} aria-current={index === page ? "page" : undefined} onClick={() => onPageChange(index)}>{index + 1}</button>
        ))}
        <button type="button" className="crm-page-btn" disabled={page >= pageCount - 1} onClick={() => onPageChange(page + 1)}>Siguiente →</button>
      </div>
    </div>
  );
}

const assetLabel = new Map(ASSET_TYPE_OPTIONS.map((option) => [option.value, option.label]));

async function crmFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: getApiHeaders(options?.headers as Record<string, string>) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

function shortDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

// ── v45 (DIATTA): helpers del timeline comercial y la tabla de personas ──

/** Catálogo de touchpoints: id → etiqueta legible + ícono, mismo vocabulario
 *  que la migración v45, el api y las tools MCP log_interaction/list_interactions. */
const INTERACTION_META: Record<string, { label: string; icon: string }> = {
  primer_contacto: { label: "Primer contacto", icon: "user" },
  reunion: { label: "Reunión", icon: "calendar" },
  llamada: { label: "Llamada", icon: "phone" },
  email: { label: "Correo", icon: "mail" },
  whatsapp: { label: "WhatsApp", icon: "chat" },
  propuesta_enviada: { label: "Propuesta enviada", icon: "doc" },
  revision: { label: "Revisión", icon: "repeat" },
  aprobacion: { label: "Aprobación", icon: "check" },
  publicacion: { label: "Publicación", icon: "send" },
  pago: { label: "Pago", icon: "coin" },
  follow_up: { label: "Seguimiento", icon: "bell" },
  objecion: { label: "Objeción", icon: "warn" },
  otro: { label: "Otro", icon: "pin" },
};

function interactionMeta(type: string) {
  return INTERACTION_META[type] || { label: type, icon: "pin" };
}

/** v49 — íconos SVG de línea. Regla interna: nada de emojis en la UI; toda la
 *  iconografía es SVG (caja 24, trazo currentColor 1.8, mismo vocabulario que
 *  las pestañas del CRM). */
const CRM_ICON_PATHS: Record<string, ReactNode> = {
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19.5c.9-3.4 3.4-5 6.5-5s5.6 1.6 6.5 5" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="15" rx="2" /><path d="M4 10.5h16M9 3.5v4M15 3.5v4" /></>,
  phone: <path d="M5 4h4l1.5 4.5-2.2 1.6a12.5 12.5 0 0 0 5.6 5.6l1.6-2.2L20 15v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4z" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7.5 7.5 5.5 7.5-5.5" /></>,
  chat: <path d="M4 5h16v11H9.5L5.5 20v-4H4V5z" />,
  doc: <><path d="M7 3.5h7l4 4v13H7v-17z" /><path d="M14 3.5V8h4" /></>,
  repeat: <><path d="M17 2.5l3.5 3.5L17 9.5" /><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13" /><path d="M7 21.5l-3.5-3.5L7 14.5" /><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" /></>,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  send: <><path d="M21.5 2.5 10.8 13.2" /><path d="M21.5 2.5 14.5 21.5l-3.7-8.3-8.3-3.7 19-7z" /></>,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v10" /><path d="M14.8 9.2c-.5-.8-1.6-1.4-2.8-1.4-1.6 0-2.9.9-2.9 2.1s1.3 1.8 2.9 2.1 2.9 1 2.9 2.1-1.3 2.1-2.9 2.1c-1.2 0-2.3-.6-2.8-1.4" /></>,
  bell: <><path d="M18 9.5a6 6 0 1 0-12 0c0 5.5-2 6.5-2 6.5h16s-2-1-2-6.5" /><path d="M10 19.5a2.2 2.2 0 0 0 4 0" /></>,
  warn: <><path d="M12 4 2.5 20h19L12 4z" /><path d="M12 10v4.5" /><path d="M12 17.5v.01" /></>,
  pin: <><path d="M12 21s6.5-5.3 6.5-10.3a6.5 6.5 0 1 0-13 0C5.5 15.7 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.2" /></>,
  chevron: <path d="m6 9.5 6 6 6-6" />,
  chart: <><path d="M4.5 4.5v15h15" /><path d="M9 15.5v-4M13 15.5V8M17 15.5v-6" /></>,
  refresh: <><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>,
};

function CrmIcon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      {CRM_ICON_PATHS[name] || CRM_ICON_PATHS.pin}
    </svg>
  );
}

// v49.6 — Dropdown del kit para la toolbar: el popup nativo de <select> no
// admite radius ni estados completos en Chromium/Firefox, así que los filtros
// visibles usan este listbox propio (menú redondeado, hover, check SVG).
// Patrón WAI-ARIA: trigger con aria-expanded + menú role="listbox";
// Esc o click fuera cierra, flechas mueven el foco entre opciones.
function CrmSelect({ label, value, options, onChange, className }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    // v49.6.2 — el menú viaja en un portal a document.body y se ancla fixed al
    // rectángulo del trigger: dentro de la tabla lo recortaba el overflow del
    // scroll horizontal (.crm-table-scroll). Scroll o resize cierran el menú.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 200)) });
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);
  const current = options.find((option) => option.value === value) || options[0];
  const menuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".crm-select-option"));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
    items[next]?.focus();
  };
  return (
    <div ref={rootRef} className={className ? `crm-select ${className}` : "crm-select"}>
      <button ref={triggerRef} type="button" className="crm-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((wasOpen) => !wasOpen)}>
        <span>{current?.label}</span>
        <CrmIcon name="chevron" size={12} />
      </button>
      {open && createPortal(
        <ul ref={menuRef} className="crm-select-menu" role="listbox" aria-label={label} onKeyDown={menuKeyDown} style={{ top: menuPos.top, left: menuPos.left }}>
          {options.map((option) => (
            <li key={option.value}>
              <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "crm-select-option active" : "crm-select-option"} onClick={() => { onChange(option.value); setOpen(false); }}>
                <span>{option.label}</span>
                {option.value === value && <CrmIcon name="check" size={13} />}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

/** Descripciones de etapa estilo DIATTA: qué significa estar aquí y qué sigue. */
const STAGE_DESCRIPTIONS: Record<DealStage, string> = {
  discovery: "Primer contacto y descubrimiento — califica la necesidad antes de cotizar.",
  proposal: "Propuesta enviada — da seguimiento hasta tener respuesta clara.",
  negotiation: "Negociación de alcance, precio o condiciones.",
  approved: "Aprobado — convierte el alcance en entregables medibles.",
  in_production: "En producción — los diseños se van confirmando contra los entregables.",
  review: "Revisión con el cliente — ajustes antes del cierre.",
  ready: "Listo para entrega — falta confirmación final.",
  delivered: "Entregado — deal cerrado ganado.",
  lost: "Perdido — registra el motivo para aprender de la fuga.",
};

function daysSince(value?: string | null) {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toLocaleUpperCase()).join("") || "?";
}

function whatsappLink(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function healthLabel(health: string, relationship?: string) {
  if (health === "at_risk") return "En fuga";
  if (health === "churned") return "Perdida";
  return relationship === "lead" ? "Lead" : "Activa";
}

/** Señal de atención estilo DIATTA: cliente en fuga computada, o marca
 *  cliente sin contacto hace 30+ días. Pinta la fila en la tabla Personas. */
function contactNeedsAttention(brand?: Brand) {
  if (!brand) return false;
  if (brand.computed_health === "at_risk") return true;
  if (brand.relationship_status !== "client") return false;
  const days = daysSince(brand.last_contacted_at);
  return days === null || days > 30;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="workspace-field"><span>{label}</span>{children}</label>;
}

export function CrmWorkspace({
  workspaceId,
  onOpenTemplate,
  setError,
  setNotice,
  view: controlledView,
  navTabs,
}: {
  workspaceId: string;
  onOpenTemplate?: (templateId: string) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  /**
   * When set, the parent owns which view shows and renders the switch itself
   * -- the Red de Marcas tab bar hosts the four CRM views (Ventas, Personas,
   * Marcas, Embudo) next to Grafo and Tabla, so the internal switch would be
   * a second, stale copy.
   */
  view?: CrmView;
  /**
   * v49: pestañas de solo íconos (CrmNavTabs) que el padre inyecta para que
   * vivan DENTRO de la fila de toolbar de cada vista — en Personas, en la
   * misma fila que búsqueda, dropdowns y «+ Agregar persona».
   */
  navTabs?: ReactNode;
}) {
  const [data, setData] = useState<CrmData | null>(null);
  const [ownView, setView] = useState<CrmView>("pipeline");
  const view = controlledView ?? ownView;
  const [loading, setLoading] = useState(true);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [showDealForm, setShowDealForm] = useState(false);
  /** v52: marca enfocada que cruza vistas — se marca en Personas o en la
   *  ficha de una persona y el embudo resalta sus deals. */
  const [focusBrandId, setFocusBrandId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await crmFetch<{ data: CrmData }>(`/api/workspaces/${workspaceId}/crm`);
      setData(result.data);
      setSelectedDealId((current) => current || result.data.deals[0]?.id || "");
      setSelectedBrandId((current) => current || result.data.brands[0]?.id || "");
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }, [setError, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const selectedDeal = data?.deals.find((deal) => deal.id === selectedDealId) || null;
  const selectedBrand = data?.brands.find((brand) => brand.id === selectedBrandId) || null;

  if (loading && !data) return <p className="workspace-muted crm-loading" role="status">Cargando CRM…</p>;
  if (!data) return null;

  return (
    <div className="crm-shell">
      {/* v52: las cuatro vistas integran la nav de íconos en su tarjeta
          superior; esta fila solo existe para el switch interno (standalone). */}
      {!controlledView && (
        <div className="crm-toolbar">
          <div className="crm-view-switch" role="group" aria-label="Vista del CRM">
            <button type="button" className={view === "pipeline" ? "active" : ""} aria-pressed={view === "pipeline"} onClick={() => setView("pipeline")}>Ventas</button>
            <button type="button" className={view === "personas" ? "active" : ""} aria-pressed={view === "personas"} onClick={() => setView("personas")}>Personas</button>
            <button type="button" className={view === "accounts" ? "active" : ""} aria-pressed={view === "accounts"} onClick={() => setView("accounts")}>Marcas</button>
            <button type="button" className={view === "embudo" ? "active" : ""} aria-pressed={view === "embudo"} onClick={() => setView("embudo")}>Embudo</button>
          </div>
        </div>
      )}

      {view === "pipeline" ? (
        /* v51.1 (Diatta): misma jerarquía que Personas/Marcas — tarjeta superior
           con título serif + nav de íconos + fila de toolbar (KPIs del resumen y
           el alta «+ Nuevo deal» pegada a la derecha); el kanban queda como
           tarjeta propia sobre el ambiente. */
        <div className="crm-contacts">
          <div className="crm-table-card crm-contacts-top">
            <header className="crm-contacts-head">
              <div>
                <h1>Ventas</h1>
                <p>Vista comercial: negocia y cierra deal por deal. Arrastra las tarjetas entre etapas y abre una ficha para mover la operación.</p>
              </div>
              {/* Nav de secciones (íconos) a la misma altura del título. */}
              {navTabs}
            </header>
            <div className="crm-contacts-toolbar">
              <CrmSummary data={data} />
              <button type="button" className="workspace-button crm-toolbar-add" onClick={() => setShowDealForm((current) => !current)}>{showDealForm ? "Cerrar formulario" : "+ Nuevo deal"}</button>
            </div>
            {showDealForm && <NewDealForm workspaceId={workspaceId} data={data} onCreated={async () => { setShowDealForm(false); setNotice("Deal creado con sus entregables."); await load(); }} setError={setError} />}
          </div>
          <PipelineBoard
            deals={data.deals}
            brands={data.brands}
            selectedDealId={selectedDealId}
            setSelectedDealId={setSelectedDealId}
            onStageChange={async (dealId, stage) => {
              try {
                await crmFetch(`/api/workspaces/${workspaceId}/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ stage }) });
                setNotice("Etapa actualizada.");
                await load();
              } catch (cause: any) { setError(cause.message); }
            }}
          />
          {data.deals.length === 0 && (
            <div className="crm-empty">
              <h3>El pipeline está vacío</h3>
              <p>Crea un deal para convertir el alcance comercial en entregables medibles.</p>
              <button type="button" className="workspace-button" onClick={() => setShowDealForm(true)}>Crear primer deal</button>
            </div>
          )}
          {selectedDeal && (
            <DealDetail
              workspaceId={workspaceId}
              deal={selectedDeal}
              brand={data.brands.find((brand) => brand.id === selectedDeal.brand_id)}
              campaign={data.campaigns.find((campaign) => campaign.id === selectedDeal.campaign_id)}
              campaigns={data.campaigns.filter((campaign) => campaign.brand_id === selectedDeal.brand_id)}
              contact={data.contacts.find((contact) => contact.id === selectedDeal.primary_contact_id)}
              onOpenTemplate={onOpenTemplate}
              reload={load}
              setError={setError}
              setNotice={setNotice}
            />
          )}
        </div>
      ) : view === "personas" ? (
        <ContactsView
          workspaceId={workspaceId}
          data={data}
          focusBrandId={focusBrandId}
          onFocusBrand={setFocusBrandId}
          reload={load}
          setError={setError}
          setNotice={setNotice}
          navTabs={navTabs}
        />
      ) : view === "accounts" ? (
        <AccountsView
          workspaceId={workspaceId}
          data={data}
          selectedBrand={selectedBrand}
          setSelectedBrandId={setSelectedBrandId}
          onOpenTemplate={onOpenTemplate}
          reload={load}
          setError={setError}
          setNotice={setNotice}
          navTabs={navTabs}
        />
      ) : (
        <FunnelView
          data={data}
          focusBrandId={focusBrandId}
          onFocusBrand={setFocusBrandId}
          onClearFocus={() => setFocusBrandId("")}
          navTabs={navTabs}
        />
      )}
    </div>
  );
}

function CrmSummary({ data }: { data: CrmData }) {
  return (
    <div className="crm-summary" aria-label="Resumen del pipeline">
      <article><strong>{money(data.summary.pipelineValue)}</strong><span>Pipeline abierto</span></article>
      <article><strong>{money(data.summary.weightedValue)}</strong><span>Valor ponderado</span></article>
      <article><strong>{data.summary.openDeals}</strong><span>Deals activos</span></article>
      <article><strong>{data.summary.pendingDeliverables}</strong><span>Entregables pendientes</span></article>
    </div>
  );
}

function PipelineBoard({
  deals,
  brands,
  selectedDealId,
  setSelectedDealId,
  onStageChange,
}: {
  deals: Deal[];
  brands: Brand[];
  selectedDealId: string;
  setSelectedDealId: (id: string) => void;
  onStageChange: (id: string, stage: DealStage) => Promise<void>;
}) {
  return (
    <section className="crm-board" aria-label="Kanban de deals">
      {DEAL_STAGES.map((stage) => {
        const stageDeals = deals.filter((deal) => deal.stage === stage.value);
        return (
          <div className="crm-column" key={stage.value}>
            <header><h3>{stage.label}</h3><span>{stageDeals.length}</span></header>
            <div className="crm-column-body">
              {stageDeals.length === 0 && <p className="crm-column-empty">Sin deals</p>}
              {stageDeals.map((deal) => {
                const brand = brands.find((item) => item.id === deal.brand_id);
                return (
                  <article className={`crm-deal-card${selectedDealId === deal.id ? " selected" : ""}`} key={deal.id}>
                    <button type="button" className="crm-deal-main" onClick={() => setSelectedDealId(deal.id)} aria-pressed={selectedDealId === deal.id}>
                      <span className="crm-deal-brand">{brand?.name || "Marca"}</span>
                      <strong>{deal.title}</strong>
                      <span>{deal.progress.completed}/{deal.progress.requested} entregables · {money(Number(deal.value || 0), deal.currency)}</span>
                      <progress value={deal.progress.completed} max={Math.max(1, deal.progress.requested)} aria-label={`${deal.progress.percentage}% completado`} />
                    </button>
                    <label className="crm-stage-select">
                      <span className="sr-only">Etapa de {deal.title}</span>
                      <select value={deal.stage} onChange={(event) => void onStageChange(deal.id, event.target.value as DealStage)}>
                        {DEAL_STAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function NewDealForm({
  workspaceId,
  data,
  onCreated,
  setError,
}: {
  workspaceId: string;
  data: CrmData;
  onCreated: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const firstAsset = ASSET_TYPE_OPTIONS[0];
  const [brandId, setBrandId] = useState(data.brands[0]?.id || "");
  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [contactId, setContactId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [probability, setProbability] = useState("10");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deliverables, setDeliverables] = useState([{ assetType: firstAsset.value, label: firstAsset.label, quantity: 1 }]);
  const brandCampaigns = data.campaigns.filter((campaign) => campaign.brand_id === brandId);
  const brandContacts = data.contacts.filter((contact) => contact.brand_id === brandId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals`, {
        method: "POST",
        body: JSON.stringify({
          brandId,
          campaignId: campaignId || null,
          campaignName: campaignId ? undefined : campaignName,
          primaryContactId: contactId || null,
          title,
          value: value ? Number(value) : null,
          probability: Number(probability),
          dueDate: dueDate || null,
          deliverables,
        }),
      });
      await onCreated();
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (data.brands.length === 0) {
    return <div className="crm-empty compact"><h3>Primero crea una marca</h3><p>Los deals siempre pertenecen a una cuenta comercial.</p></div>;
  }

  return (
    <form className="workspace-panel crm-create-deal" onSubmit={submit}>
      <header><div><h3>Nuevo deal</h3><p className="workspace-muted">Define el alcance ahora para poder confirmarlo contra archivos reales después.</p></div></header>
      <div className="crm-form-grid">
        <Field label="Marca">
          <select value={brandId} onChange={(event) => { setBrandId(event.target.value); setCampaignId(""); setContactId(""); }} required>
            {data.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
        </Field>
        <Field label="Título"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Campaña de lanzamiento" required /></Field>
        <Field label="Campaña existente">
          <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            <option value="">Crear o asignar después</option>
            {brandCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </Field>
        {!campaignId && <Field label="Nueva campaña (opcional)"><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Lanzamiento 2026" /></Field>}
        <Field label="Contacto principal">
          <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">Sin contacto principal</option>
            {brandContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.first_name} {contact.last_name}</option>)}
          </select>
        </Field>
        <Field label="Valor"><input type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0" /></Field>
        <Field label="Probabilidad (%)"><input type="number" min="0" max="100" value={probability} onChange={(event) => setProbability(event.target.value)} /></Field>
        <Field label="Fecha de entrega"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
      </div>
      <fieldset className="crm-deliverable-builder">
        <legend>Entregables</legend>
        {deliverables.map((deliverable, index) => (
          <div className="crm-deliverable-row" key={`${index}-${deliverable.assetType}`}>
            <Field label="Tipo de asset">
              <select value={deliverable.assetType} onChange={(event) => {
                const option = ASSET_TYPE_OPTIONS.find((item) => item.value === event.target.value);
                setDeliverables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, assetType: event.target.value as DesignAssetType, label: option?.label || event.target.value } : item));
              }}>
                {ASSET_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Nombre"><input value={deliverable.label} onChange={(event) => setDeliverables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} required /></Field>
            <Field label="Cantidad"><input type="number" min="1" max="10000" value={deliverable.quantity} onChange={(event) => setDeliverables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} required /></Field>
            <button type="button" className="workspace-link danger" aria-label={`Quitar ${deliverable.label}`} disabled={deliverables.length === 1} onClick={() => setDeliverables((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
          </div>
        ))}
        <button type="button" className="workspace-button secondary" onClick={() => setDeliverables((current) => [...current, { assetType: firstAsset.value, label: firstAsset.label, quantity: 1 }])}>Agregar entregable</button>
      </fieldset>
      <button className="workspace-button" disabled={submitting}>{submitting ? "Creando…" : "Crear deal"}</button>
    </form>
  );
}

function DealDetail({
  workspaceId,
  deal,
  brand,
  campaign,
  campaigns,
  contact,
  onOpenTemplate,
  reload,
  setError,
  setNotice,
}: {
  workspaceId: string;
  deal: Deal;
  brand?: Brand;
  campaign?: Campaign;
  campaigns: Campaign[];
  contact?: Contact;
  onOpenTemplate?: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [assetType, setAssetType] = useState(ASSET_TYPE_OPTIONS[0].value);
  const [label, setLabel] = useState(ASSET_TYPE_OPTIONS[0].label);
  const [quantity, setQuantity] = useState(1);
  // v45 (F7): cierre del deal — valor final facturado / motivo de pérdida.
  const [outcomeValue, setOutcomeValue] = useState(deal.final_value != null ? String(deal.final_value) : "");
  const [lostReason, setLostReason] = useState(deal.lost_reason || "");
  const [editingOutcome, setEditingOutcome] = useState(false);

  useEffect(() => {
    setOutcomeValue(deal.final_value != null ? String(deal.final_value) : "");
    setLostReason(deal.lost_reason || "");
    setEditingOutcome(false);
  }, [deal.id, deal.final_value, deal.lost_reason]);

  const saveOutcome = async () => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          finalValue: deal.stage === "delivered" ? (outcomeValue === "" ? null : Number(outcomeValue)) : undefined,
          lostReason: deal.stage === "lost" ? (lostReason.trim() || null) : undefined,
        }),
      });
      setNotice(deal.stage === "lost" ? "Motivo de pérdida registrado." : "Valor final actualizado.");
      setEditingOutcome(false);
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const reconcile = async () => {
    try {
      const result = await crmFetch<{ data: { linked: number } }>(`/api/workspaces/${workspaceId}/deals/${deal.id}/reconcile`, { method: "POST", body: "{}" });
      setNotice(result.data.linked ? `${result.data.linked} archivo(s) confirmado(s).` : "No se encontraron archivos nuevos que coincidan.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const updateCampaign = async (campaignId: string) => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ campaignId: campaignId || null }),
      });
      setNotice(campaignId ? "Campaña asignada al deal." : "Campaña retirada del deal.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const linkFile = async (deliverableId: string, templateId: string) => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${deal.id}/deliverables/${deliverableId}/files`, {
        method: "POST",
        body: JSON.stringify({ templateId }),
      });
      setNotice("Archivo vinculado al entregable.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const addDeliverable = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${deal.id}/deliverables`, {
        method: "POST",
        body: JSON.stringify({ assetType, label, quantity }),
      });
      setAdding(false);
      setQuantity(1);
      setNotice("Entregable agregado.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  return (
    <section className="workspace-panel crm-deal-detail" aria-labelledby={`deal-${deal.id}`}>
      <header className="crm-detail-header">
        <div>
          <p className="workspace-eyebrow">{brand?.name || "Marca"} · {campaign?.name || "Sin campaña"}</p>
          <h3 id={`deal-${deal.id}`}>{deal.title}</h3>
          <p className="workspace-muted">{[contact && `${contact.first_name} ${contact.last_name || ""}`, `Entrega ${shortDate(deal.due_date)}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="crm-detail-actions">
          <label className="crm-campaign-select">
            <span>Campaña</span>
            <select value={deal.campaign_id || ""} onChange={(event) => void updateCampaign(event.target.value)}>
              <option value="">Sin campaña</option>
              {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <span className={`crm-progress-badge${deal.progress.complete ? " complete" : ""}`}>{deal.progress.percentage}% · {deal.progress.completed}/{deal.progress.requested}</span>
          <button type="button" className="workspace-button secondary" disabled={!deal.progress.canReconcile} onClick={() => void reconcile()}>Cruzar archivos</button>
        </div>
      </header>
      {deal.progress.warning && <p className="crm-warning">{deal.progress.warning}</p>}
      {deal.stage === "lost" && (
        <div className="crm-outcome-box lost" role="group" aria-label="Cierre del deal">
          {editingOutcome ? (
            <>
              <Field label="Motivo de pérdida"><textarea rows={2} value={lostReason} onChange={(event) => setLostReason(event.target.value)} placeholder="Precio, sin respuesta, eligió otra agencia…" /></Field>
              <div className="crm-outcome-actions">
                <button type="button" className="workspace-button" onClick={() => void saveOutcome()}>Guardar motivo</button>
                <button type="button" className="workspace-button secondary" onClick={() => setEditingOutcome(false)}>Cancelar</button>
              </div>
            </>
          ) : (
            <div className="crm-outcome-view">
              <span>Perdido — {deal.lost_reason ? <>motivo: «{deal.lost_reason}»</> : "sin motivo registrado"}</span>
              <button type="button" className="workspace-link" onClick={() => setEditingOutcome(true)}>{deal.lost_reason ? "Editar motivo" : "Registrar motivo"}</button>
            </div>
          )}
        </div>
      )}
      {deal.stage === "delivered" && (
        <div className="crm-outcome-box won" role="group" aria-label="Valor final del deal">
          {editingOutcome ? (
            <>
              <Field label="Valor final facturado"><input type="number" min="0" step="0.01" value={outcomeValue} onChange={(event) => setOutcomeValue(event.target.value)} placeholder={deal.value != null ? String(deal.value) : "0"} /></Field>
              <div className="crm-outcome-actions">
                <button type="button" className="workspace-button" onClick={() => void saveOutcome()}>Guardar valor</button>
                <button type="button" className="workspace-button secondary" onClick={() => setEditingOutcome(false)}>Cancelar</button>
              </div>
            </>
          ) : (
            <div className="crm-outcome-view">
              <span>Entregado — valor final: <strong>{money(Number(deal.final_value ?? deal.value ?? 0), deal.currency)}</strong>{deal.final_value != null && deal.value != null && Number(deal.final_value) !== Number(deal.value) ? ` (estimado ${money(Number(deal.value), deal.currency)})` : ""}</span>
              <button type="button" className="workspace-link" onClick={() => setEditingOutcome(true)}>Editar valor final</button>
            </div>
          )}
        </div>
      )}
      <div className="crm-deliverable-list">
        {deal.progress.deliverables.map((deliverable) => (
          <article className="crm-deliverable" key={deliverable.id}>
            <div className="crm-deliverable-heading">
              <div><strong>{deliverable.label}</strong><span>{assetLabel.get(deliverable.asset_type as any) || deliverable.asset_type}</span></div>
              <span>{deliverable.completedQuantity}/{deliverable.quantity}</span>
            </div>
            <progress value={deliverable.completedQuantity} max={deliverable.quantity} aria-label={`${deliverable.label}: ${deliverable.completedQuantity} de ${deliverable.quantity}`} />
            {deliverable.matchedFiles.length > 0 && (
              <div className="crm-file-list">
                {deliverable.matchedFiles.map((file) => <button type="button" key={file.template_id} onClick={() => onOpenTemplate?.(file.template_id)}>{file.name}<span>Confirmado</span></button>)}
              </div>
            )}
            {deliverable.candidateFiles.length > 0 && deliverable.remainingQuantity > 0 && (
              <div className="crm-candidates">
                <span>Coincidencias por revisar</span>
                {deliverable.candidateFiles.map((file) => <button type="button" key={file.template_id} onClick={() => void linkFile(deliverable.id, file.template_id)}>Vincular {file.name}</button>)}
              </div>
            )}
          </article>
        ))}
      </div>
      {adding ? (
        <form className="crm-add-deliverable" onSubmit={addDeliverable}>
          <Field label="Tipo">
            <select value={assetType} onChange={(event) => { setAssetType(event.target.value as DesignAssetType); setLabel(assetLabel.get(event.target.value as any) || event.target.value); }}>
              {ASSET_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Nombre"><input value={label} onChange={(event) => setLabel(event.target.value)} required /></Field>
          <Field label="Cantidad"><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} required /></Field>
          <button className="workspace-button">Agregar</button>
          <button type="button" className="workspace-button secondary" onClick={() => setAdding(false)}>Cancelar</button>
        </form>
      ) : <button type="button" className="workspace-link crm-add-link" onClick={() => setAdding(true)}>+ Agregar entregable</button>}
    </section>
  );
}

function AccountsView({
  workspaceId,
  data,
  selectedBrand,
  setSelectedBrandId,
  onOpenTemplate,
  reload,
  setError,
  setNotice,
  navTabs,
}: {
  workspaceId: string;
  data: CrmData;
  selectedBrand: Brand | null;
  setSelectedBrandId: (id: string) => void;
  onOpenTemplate?: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  navTabs?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [relationFilter, setRelationFilter] = useState("");
  const [healthFilter, setHealthFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [brandName, setBrandName] = useState("");
  const [relationshipStatus, setRelationshipStatus] = useState<"lead" | "client">("lead");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  // v46 (DIATTA): deals y valor abierto agregados por marca para la tabla.
  const brandStats = useMemo(() => {
    const stats = new Map<string, { count: number; openValue: number; currency: string }>();
    for (const deal of data.deals) {
      const entry = stats.get(deal.brand_id) || { count: 0, openValue: 0, currency: deal.currency || "USD" };
      entry.count += 1;
      if (deal.stage !== "lost" && deal.stage !== "delivered") entry.openValue += deal.value || 0;
      stats.set(deal.brand_id, entry);
    }
    return stats;
  }, [data.deals]);

  const query = search.trim().toLocaleLowerCase();
  const visibleBrands = useMemo(() => data.brands.filter((brand) => {
    if (relationFilter && brand.relationship_status !== relationFilter) return false;
    if (healthFilter && (brand.computed_health || brand.account_health) !== healthFilter) return false;
    if (query && !brand.name.toLocaleLowerCase().includes(query)) return false;
    return true;
  }), [data.brands, healthFilter, query, relationFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleBrands.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pagedBrands = visibleBrands.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const createBrand = async (event: FormEvent) => {
    event.preventDefault();
    try {
      // Every brand gets its Design System file — the server creates it
      // unconditionally now ("one brand = one DS file", v35).
      const result = await crmFetch<{ data: Brand }>(`/api/workspaces/${workspaceId}/brands`, {
        method: "POST",
        body: JSON.stringify({ name: brandName, relationshipStatus }),
      });
      setBrandName("");
      setSelectedBrandId(result.data.id);
      setNotice("Marca agregada.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const createContact = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedBrand) return;
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/contacts`, {
        method: "POST",
        body: JSON.stringify({ brandId: selectedBrand.id, firstName, lastName, email, jobTitle, status: "active", tags: [] }),
      });
      setFirstName(""); setLastName(""); setEmail(""); setJobTitle("");
      setNotice("Stakeholder agregado.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const patchRelation = async (brandId: string, value: string) => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/brands/${brandId}`, { method: "PATCH", body: JSON.stringify({ relationshipStatus: value }) });
      setNotice("Relación actualizada.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  // v51 (Diatta): misma jerarquía que Personas — tarjeta superior con título
  // serif + nav de íconos + toolbar del kit (búsqueda, dropdowns CrmSelect y
  // alta), y la tabla en su propia tarjeta. El wrapper crm-contacts acota el
  // DS del kit a la vista; las clases de tabla se comparten con Personas.
  return (
    <div className="crm-contacts">
      <div className="crm-table-card crm-contacts-top">
        <header className="crm-contacts-head">
          <div>
            <h1>Marcas</h1>
            <p>Agrega una marca, filtra por relación o salud y haz click en una fila para abrir su ficha.</p>
          </div>
          {/* Nav de secciones (íconos) a la misma altura del título. */}
          {navTabs}
        </header>
        <div className="crm-contacts-toolbar">
          <input type="search" className="crm-header-search" aria-label="Buscar marcas" placeholder="Buscar por nombre de marca…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
          {/* Dropdowns del kit (listbox propio: el popup nativo no se puede vestir
              completo) y «Agregar» pegados al borde derecho. */}
          <CrmSelect
            className="crm-toolbar-push"
            label="Filtrar por relación"
            value={relationFilter}
            options={[
              { value: "", label: "Relación: Todas" },
              { value: "lead", label: "Lead" },
              { value: "client", label: "Cliente" },
            ]}
            onChange={(next) => { setRelationFilter(next); setPage(0); }}
          />
          <CrmSelect
            label="Filtrar por salud de cuenta"
            value={healthFilter}
            options={[
              { value: "", label: "Salud: Toda" },
              { value: "active", label: "Activa" },
              { value: "at_risk", label: "En fuga" },
              { value: "churned", label: "Perdida" },
            ]}
            onChange={(next) => { setHealthFilter(next); setPage(0); }}
          />
          {(relationFilter || healthFilter) && (
            <button type="button" className="crm-clear-filters" onClick={() => { setRelationFilter(""); setHealthFilter(""); }}>Limpiar</button>
          )}
          <button type="button" className="workspace-button crm-toolbar-add" onClick={() => setShowForm((current) => !current)}>{showForm ? "Cerrar formulario" : "+ Agregar marca"}</button>
        </div>
        {showForm && (
          <form className="crm-create-panel" onSubmit={createBrand}>
            <div className="workspace-form-row">
              <Field label="Nombre"><input value={brandName} onChange={(event) => setBrandName(event.target.value)} required /></Field>
              <Field label="Relación"><select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value as "lead" | "client")}><option value="lead">Lead</option><option value="client">Cliente</option></select></Field>
            </div>
            <button className="workspace-button">Crear marca</button>
          </form>
        )}
      </div>
      <section className="crm-table-card" aria-label="Marcas">
        <div className="crm-table-scroll">
          <table className="crm-table crm-brands-grid">
            <thead>
              <tr>
                <th scope="col">Marca</th>
                <th scope="col">Relación</th>
                <th scope="col">Salud</th>
                <th scope="col">Diseños</th>
                <th scope="col">Deals · Valor</th>
                <th scope="col">Atención</th>
              </tr>
            </thead>
            <tbody>
              {pagedBrands.map((brand) => {
                const health = brand.computed_health || brand.account_health;
                const stats = brandStats.get(brand.id);
                const attention = contactNeedsAttention(brand);
                const days = daysSince(brand.last_contacted_at);
                return (
                  <tr
                    key={brand.id}
                    className={`table-row${attention ? " row-needs-attention" : ""}${selectedBrand?.id === brand.id ? " selected" : ""}`}
                    onClick={() => setSelectedBrandId(brand.id)}
                  >
                    <td>
                      <div className="crm-entity-cell">
                        <span className="crm-entity-avatar" aria-hidden="true">{brand.name.charAt(0).toLocaleUpperCase()}</span>
                        <span className="crm-entity-id">
                          <strong className="crm-entity-name">{brand.name}</strong>
                          <small>{brand.design_count} diseño{brand.design_count === 1 ? "" : "s"}{brand.has_design_system === false ? " · sin Design System" : ""}</small>
                        </span>
                      </div>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select
                        className={`crm-pill-select ${brand.relationship_status}`}
                        aria-label={`Relación de ${brand.name}`}
                        value={brand.relationship_status}
                        onChange={(event) => void patchRelation(brand.id, event.target.value)}
                      >
                        <option value="lead">Lead</option>
                        <option value="client">Cliente</option>
                      </select>
                    </td>
                    <td>
                      <span className={`crm-status-pill ${health}`} title={health === "at_risk" ? "En fuga: cliente sin deals abiertos y 30+ días sin contacto (o pin manual)." : "Se calcula sola con cada interacción — fíjala como pin manual desde la ficha."}>
                        {healthLabel(health, brand.relationship_status)}
                      </span>
                    </td>
                    <td><span className="crm-monto">{brand.design_count}</span></td>
                    <td>
                      <span className="crm-monto" title={stats && stats.openValue > 0 ? `Valor abierto: ${money(stats.openValue, stats.currency)}` : undefined}>
                        {stats?.count || 0}
                        {stats && stats.openValue > 0 ? ` · ${money(stats.openValue, stats.currency)}` : ""}
                      </span>
                    </td>
                    <td>
                      {attention ? (
                        <span className="crm-status-pill warning">{health === "at_risk" ? "En fuga" : days === null ? "Sin contacto" : `${days}d sin contacto`}</span>
                      ) : (
                        <span className="crm-status-pill neutral">Al día</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pagedBrands.length === 0 && (
                <tr><td colSpan={6} className="workspace-muted">{data.brands.length === 0 ? "Aún no hay marcas — agrega la primera con «+ Agregar marca»." : "Ninguna marca coincide con la búsqueda o el filtro."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visibleBrands.length > 0 && (
          <CrmTablePagination
            pageSize={pageSize}
            onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
            page={safePage}
            onPageChange={setPage}
            pageCount={pageCount}
            total={visibleBrands.length}
          />
        )}
      </section>
      {selectedBrand ? (
          <BrandDetail
            workspaceId={workspaceId}
            brand={selectedBrand}
            contacts={data.contacts.filter((contact) => contact.brand_id === selectedBrand.id)}
            deals={data.deals.filter((deal) => deal.brand_id === selectedBrand.id)}
            designs={data.designs.filter((design) => design.brand_id === selectedBrand.id)}
            onOpenTemplate={onOpenTemplate}
            reload={reload}
            setError={setError}
            setNotice={setNotice}
          >
            <details className="crm-inline-form">
              <summary>+ Agregar stakeholder</summary>
              <form onSubmit={createContact}>
                <div className="workspace-form-row"><Field label="Nombre"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></Field><Field label="Apellido"><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field></div>
                <Field label="Cargo"><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></Field>
                <Field label="Correo"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                <button className="workspace-button">Agregar</button>
              </form>
            </details>
          </BrandDetail>
      ) : (
        <div className="crm-empty">
          <h3>Selecciona una marca</h3>
          <p>Click en una fila para abrir la ficha de cuenta: personas, deals, diseños vinculados y oportunidades.</p>
        </div>
      )}
    </div>
  );
}

function BrandDetail({
  workspaceId,
  brand,
  contacts,
  deals,
  designs,
  onOpenTemplate,
  reload,
  setError,
  setNotice,
  children,
}: {
  workspaceId: string;
  brand: Brand;
  contacts: Contact[];
  deals: Deal[];
  designs: DesignFile[];
  onOpenTemplate?: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  children: React.ReactNode;
}) {
  const [relationshipStatus, setRelationshipStatus] = useState(brand.relationship_status);
  // v45: "auto" = la salud la calcula el servidor; un valor fijo es el pin manual.
  const [healthMode, setHealthMode] = useState<"auto" | Brand["account_health"]>(brand.account_health_override || "auto");
  const [priority, setPriority] = useState(brand.crm_priority);
  const [notes, setNotes] = useState(brand.crm_notes || "");
  const [dsBusy, setDsBusy] = useState(false);
  // v45 (DIATTA): la salud mostrada es la computada (override manual gana).
  const computedHealth = brand.computed_health || brand.account_health;
  const healthIsComputed = brand.computed_health !== undefined && brand.computed_health !== brand.account_health;
  const lastContactDays = daysSince(brand.last_contacted_at);

  useEffect(() => {
    setRelationshipStatus(brand.relationship_status);
    setHealthMode(brand.account_health_override || "auto");
    setPriority(brand.crm_priority);
    setNotes(brand.crm_notes || "");
  }, [brand]);

  const createDesignSystem = async () => {
    setDsBusy(true);
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/brands/${brand.id}/design-system`, { method: "POST" });
      setNotice(`Design System creado para "${brand.name}".`);
      await reload();
    } catch (cause: any) { setError(cause.message); } finally { setDsBusy(false); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/brands/${brand.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          relationshipStatus,
          priority,
          crmNotes: notes,
          // v45: el pin manual gana sobre la salud computada; "auto" lo limpia.
          accountHealthOverride: healthMode === "auto" ? null : healthMode,
          ...(healthMode === "auto" ? {} : { accountHealth: healthMode }),
        }),
      });
      setNotice("Cuenta actualizada.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  return (
    <section className="workspace-panel crm-brand-detail">
      <header><div><p className="workspace-eyebrow">Cuenta comercial</p><h3>{brand.name}</h3><p className="workspace-muted">{brand.interaction_count ? `${brand.interaction_count} interacción(es) · ` : ""}{lastContactDays === null ? "Sin contacto registrado" : `Último contacto hace ${lastContactDays} día${lastContactDays === 1 ? "" : "s"}`}</p></div><span className={`crm-health ${computedHealth}`} title={healthIsComputed ? "Salud computada: cliente sin deals abiertos y 30+ días sin contacto pasa a En fuga." : undefined}>{healthLabel(computedHealth, relationshipStatus)}{healthIsComputed ? " (auto)" : ""}</span></header>
      {brand.has_design_system === false ? (
        <div role="alert" style={{ border: "1px solid rgba(252,165,165,0.4)", borderRadius: 8, padding: "10px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 200 }}>Esta marca aún no tiene archivo Design System — tu IA no tendrá de dónde sacar estilo al diseñar para ella.</span>
          <button type="button" className="workspace-button" onClick={createDesignSystem} disabled={dsBusy}>{dsBusy ? "Creando…" : "Crear Design System"}</button>
        </div>
      ) : brand.design_system_template_id ? (
        <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>Design System de la marca listo — todo lo que extraigas va ahí.</span>
          <button type="button" className="workspace-button" onClick={() => onOpenTemplate?.(brand.design_system_template_id!)}>Abrir archivo</button>
        </div>
      ) : null}
      <form className="crm-brand-settings" onSubmit={save}>
        <Field label="Relación"><select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value as Brand["relationship_status"])}><option value="lead">Lead</option><option value="client">Cliente</option></select></Field>
        <Field label="Salud"><select value={healthMode} onChange={(event) => setHealthMode(event.target.value as "auto" | Brand["account_health"])}><option value="auto">Auto (recomendado)</option><option value="active">Activa</option><option value="at_risk">En fuga</option><option value="churned">Perdida</option></select></Field>
        <Field label="Prioridad"><select value={priority} onChange={(event) => setPriority(event.target.value as Brand["crm_priority"])}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></Field>
        <Field label="Notas"><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <button className="workspace-button">Guardar</button>
      </form>
      <p className="crm-health-note">Con «Auto» la salud se calcula sola: un cliente sin deals abiertos y con 30+ días sin contacto pasa a «En fuga» — cada interacción registrada reinicia el conteo. Si fijas Activa / En fuga / Perdida, ese pin manual gana hasta que vuelvas a Auto.</p>
      <div className="crm-brand-sections">
        <section><h4>Qué ofrecer</h4>{brand.suggestions.length ? <div className="crm-suggestions">{brand.suggestions.map((suggestion) => <article key={suggestion.assetType}><strong>{suggestion.title}</strong><p>{suggestion.reason}</p></article>)}</div> : <p className="workspace-muted">La cobertura base de assets está completa.</p>}</section>
        <section><h4>Stakeholders <span>{contacts.length}</span></h4><div className="crm-compact-list">{contacts.map((contact) => <article key={contact.id}><strong>{contact.first_name} {contact.last_name}</strong><span>{[contact.job_title, contact.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</span></article>)}</div>{children}</section>
        <section><h4>Deals <span>{deals.length}</span></h4><div className="crm-compact-list">{deals.map((deal) => <article key={deal.id}><strong>{deal.title}</strong><span>{DEAL_STAGES.find((stage) => stage.value === deal.stage)?.label} · {deal.progress.percentage}%</span></article>)}</div></section>
        <section><h4>Diseños vinculados <span>{designs.length}</span></h4><div className="crm-design-grid">{designs.map((design) => <button type="button" key={design.template_id} onClick={() => onOpenTemplate?.(design.template_id)}><span>{assetLabel.get(design.asset_type as any) || design.asset_type}</span><strong>{design.name}</strong></button>)}</div></section>
      </div>
    </section>
  );
}

function contactStatusLabel(status?: string | null) {
  return status === "lead" ? "Lead" : status === "inactive" ? "Inactiva" : "Activa";
}

/**
 * Vista tabla de personas (pestaña 2), layout DIATTA: una sola fila de toolbar
 * (navTabs de íconos + búsqueda + dropdowns + «+ Agregar persona») y tabla rica
 * full-width — avatar, marca con salud computada, estado editable inline,
 * valor comercial por persona, señal de atención, WhatsApp/embudo por fila,
 * paginación. La ficha 360 abre en un modal al hacer click en una fila.
 */
function ContactsView({
  workspaceId,
  data,
  focusBrandId,
  onFocusBrand,
  reload,
  setError,
  setNotice,
  navTabs,
}: {
  workspaceId: string;
  data: CrmData;
  /** v52: marca enfocada en el Embudo — el funnel es por marcas (B2B). */
  focusBrandId: string;
  onFocusBrand: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  navTabs?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const query = search.trim().toLocaleLowerCase();
  const visibleContacts = useMemo(() => data.contacts.filter((contact) => {
    if (statusFilter && (contact.status || "lead") !== statusFilter) return false;
    if (brandFilter && contact.brand_id !== brandFilter) return false;
    if (!query) return true;
    const brandName = data.brands.find((brand) => brand.id === contact.brand_id)?.name;
    return [contact.first_name, contact.last_name, contact.email, contact.phone, contact.job_title, contact.brand_name, brandName]
      .some((value) => (value || "").toLocaleLowerCase().includes(query));
  }), [brandFilter, data.brands, data.contacts, query, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleContacts.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pagedContacts = visibleContacts.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selectedContact = data.contacts.find((contact) => contact.id === selectedContactId) || null;

  // La ficha vive en un modal: Esc la cierra (además del × y del click en el velo).
  useEffect(() => {
    if (!selectedContactId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedContactId(""); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedContactId]);

  const patchStatus = async (contactId: string, status: string) => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice("Estado actualizado.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  // v50 (DS Diatta): el DS del UI Kit queda acotado a este módulo — las
  // clases de tabla se comparten con la vista Marcas. La zona superior
  // (título + nav de íconos + toolbar + formulario de alta) vive en su
  // propia tarjeta, misma receta glass que la tabla.
  return (
    <div className="crm-contacts">
      <div className="crm-table-card crm-contacts-top">
        <header className="crm-contacts-head">
          <div>
            <h1>Personas</h1>
            <p>Agrega un contacto, filtra por estado o marca y haz click en una fila para abrir su ficha.</p>
          </div>
          {/* Nav de secciones (íconos) a la misma altura del título. */}
          {navTabs}
        </header>
        <div className="crm-contacts-toolbar">
          <input type="search" className="crm-header-search" aria-label="Buscar personas" placeholder="Buscar por nombre, marca o correo…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
          {/* Dropdowns del kit (listbox propio: el popup nativo no se puede
              vestir completo) y «Agregar» pegados al borde derecho. */}
          <CrmSelect
            className="crm-toolbar-push"
            label="Filtrar por estado"
            value={statusFilter}
            options={[
              { value: "", label: "Estado: Todos" },
              { value: "lead", label: "Lead" },
              { value: "active", label: "Activa" },
              { value: "inactive", label: "Inactiva" },
            ]}
            onChange={(next) => { setStatusFilter(next); setPage(0); }}
          />
          <CrmSelect
            label="Filtrar por marca"
            value={brandFilter}
            options={[{ value: "", label: "Marca: Todas" }, ...data.brands.map((brand) => ({ value: brand.id, label: brand.name }))]}
            onChange={(next) => { setBrandFilter(next); setPage(0); }}
          />
          {(statusFilter || brandFilter) && (
            <button type="button" className="crm-clear-filters" onClick={() => { setStatusFilter(""); setBrandFilter(""); }}>Limpiar</button>
          )}
          <button type="button" className="workspace-button crm-toolbar-add" onClick={() => setShowForm((current) => !current)}>{showForm ? "Cerrar formulario" : "+ Agregar persona"}</button>
        </div>
        {showForm && (
          <NewContactForm workspaceId={workspaceId} data={data} reload={reload} setError={setError} setNotice={setNotice} onCreated={setSelectedContactId} />
        )}
      </div>
      <section className="crm-table-card" aria-label="Personas">
        <div className="crm-table-scroll">
          <table className="crm-table crm-people-grid">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">WhatsApp</th>
                <th scope="col">Marca</th>
                <th scope="col">Estado</th>
                <th scope="col">Deals · Valor</th>
                <th scope="col">Atención</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagedContacts.map((contact) => {
                const brand = data.brands.find((item) => item.id === contact.brand_id);
                const wa = whatsappLink(contact.phone);
                const stats = contact.dealStats;
                const attention = contactNeedsAttention(brand);
                const days = daysSince(brand?.last_contacted_at);
                const status = contact.status || "lead";
                return (
                  <tr
                    key={contact.id}
                    className={`table-row${attention ? " row-needs-attention" : ""}${contact.id === selectedContactId ? " selected" : ""}`}
                    onClick={() => setSelectedContactId(contact.id)}
                  >
                    <td>
                      <div className="crm-entity-cell">
                        <span className="crm-entity-avatar" aria-hidden="true">{initials(`${contact.first_name} ${contact.last_name || ""}`)}</span>
                        <span className="crm-entity-id">
                          <strong className="crm-entity-name">{contact.first_name} {contact.last_name}</strong>
                          <small>{contact.job_title || "Sin cargo"}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {wa
                        ? <a className="crm-wa-cell" href={wa} target="_blank" rel="noreferrer" title="Abrir WhatsApp" onClick={(event) => event.stopPropagation()}>{contact.phone}</a>
                        : <span>—</span>}
                    </td>
                    <td>
                      <span className="crm-brand-cell">
                        {brand?.name || contact.brand_name || "Sin marca"}
                        {brand && <small className={`crm-dot-health ${brand.computed_health || brand.account_health}`} title={healthLabel(brand.computed_health || brand.account_health, brand.relationship_status)} />}
                      </span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <CrmSelect
                        className="crm-select-pill"
                        label={`Estado de ${contact.first_name}`}
                        value={status}
                        options={[
                          { value: "lead", label: "Lead" },
                          { value: "active", label: "Activa" },
                          { value: "inactive", label: "Inactiva" },
                        ]}
                        onChange={(next) => void patchStatus(contact.id, next)}
                      />
                    </td>
                    <td>
                      <span className="crm-monto" title={stats && stats.wonValue > 0 ? `Ganado: ${money(stats.wonValue, stats.currency || "USD")}` : undefined}>
                        {stats?.dealCount || 0}
                        {stats && stats.openValue > 0 ? ` · ${money(stats.openValue, stats.currency || "USD")}` : ""}
                      </span>
                    </td>
                    <td>
                      {attention ? (
                        <span className="crm-status-pill warning">{brand?.computed_health === "at_risk" ? "En fuga" : days === null ? "Sin contacto" : `${days}d sin contacto`}</span>
                      ) : (
                        <span className="crm-status-pill neutral">Al día</span>
                      )}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {contact.brand_id && (
                        <button
                          type="button"
                          className={`workspace-link${focusBrandId === contact.brand_id ? " active" : ""}`}
                          aria-pressed={focusBrandId === contact.brand_id}
                          onClick={() => contact.brand_id && onFocusBrand(focusBrandId === contact.brand_id ? "" : contact.brand_id)}
                        >
                          {focusBrandId === contact.brand_id ? "Quitar del embudo" : "Ver en embudo"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pagedContacts.length === 0 && (
                <tr><td colSpan={7} className="workspace-muted">{data.contacts.length === 0 ? "Aún no hay personas — agrega la primera con «+ Agregar persona»." : "Nadie coincide con la búsqueda o el filtro."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visibleContacts.length > 0 && (
          <CrmTablePagination
            pageSize={pageSize}
            onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
            page={safePage}
            onPageChange={setPage}
            pageCount={pageCount}
            total={visibleContacts.length}
          />
        )}
      </section>
      {selectedContact && (
        <div className="crm-modal-overlay" onClick={() => setSelectedContactId("")}>
          <div
            className="crm-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Ficha de ${selectedContact.first_name} ${selectedContact.last_name || ""}`.trim()}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="crm-modal-close" aria-label="Cerrar ficha" onClick={() => setSelectedContactId("")}>×</button>
            <PersonDetail
              workspaceId={workspaceId}
              contact={selectedContact}
              data={data}
              deals={data.deals.filter((deal) => deal.primary_contact_id === selectedContact.id)}
              onFocusBrand={onFocusBrand}
              focusBrandId={focusBrandId}
              reload={reload}
              setError={setError}
              setNotice={setNotice}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function NewContactForm({
  workspaceId,
  data,
  reload,
  setError,
  setNotice,
  onCreated,
}: {
  workspaceId: string;
  data: CrmData;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onCreated: (contactId: string) => void;
}) {
  const [brandId, setBrandId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("lead");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await crmFetch<{ data?: { id?: string } }>(`/api/workspaces/${workspaceId}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          brandId: brandId || null,
          firstName,
          lastName,
          email: email || undefined,
          phone: phone || undefined,
          jobTitle: jobTitle || undefined,
          status,
          tags: [],
        }),
      });
      setFirstName(""); setLastName(""); setJobTitle(""); setEmail(""); setPhone("");
      setNotice("Persona agregada.");
      await reload();
      if (result.data?.id) onCreated(result.data.id);
    } catch (cause: any) { setError(cause.message); }
  };

  return (
    <form className="crm-create-panel" onSubmit={create}>
      <Field label="Marca">
        <select value={brandId} onChange={(event) => setBrandId(event.target.value)}>
          <option value="">Sin marca</option>
          {data.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </Field>
      <div className="workspace-form-row">
        <Field label="Nombre"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></Field>
        <Field label="Apellido"><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
      </div>
      <Field label="Cargo"><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Decisor, influencer, marketing…" /></Field>
      <Field label="Estado">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="lead">Lead</option>
          <option value="active">Activa</option>
          <option value="inactive">Inactiva</option>
        </select>
      </Field>
      <div className="workspace-form-row">
        <Field label="Correo"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Teléfono"><input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
      </div>
      <button className="workspace-button">Agregar persona</button>
    </form>
  );
}

/** Etapas del mini-embudo personal (DIATTA): se derivan de los deals y del
 *  timeline de interacciones de ESA persona, con marcador «← Actual». */
const PERSON_FUNNEL = ["Contactado", "Propuesta", "Negociación", "Aprobado", "Entregado"];

function personalFunnelStage(deals: Deal[], interactions: Interaction[]) {
  const fromDeal: Record<string, number> = {
    discovery: 0, proposal: 1, negotiation: 2,
    approved: 3, in_production: 3, review: 3,
    ready: 4, delivered: 4,
  };
  const fromType: Record<string, number> = {
    primer_contacto: 0, reunion: 0, llamada: 0, email: 0, whatsapp: 0, follow_up: 0,
    propuesta_enviada: 1, revision: 2, objecion: 2, aprobacion: 3, publicacion: 4, pago: 4,
  };
  let stage = interactions.length > 0 || deals.length > 0 ? 0 : -1;
  for (const deal of deals) {
    if (deal.stage === "lost") continue;
    stage = Math.max(stage, fromDeal[deal.stage] ?? 0);
  }
  for (const interaction of interactions) {
    stage = Math.max(stage, fromType[interaction.interaction_type] ?? 0);
  }
  return stage;
}

/**
 * Ficha 360 de la persona (DIATTA): header con acceso directo (correo, tel,
 * WhatsApp), sidebar comercial (marca, salud computada, registro rápido de
 * interacción, datos editables) y columna principal con mini-embudo personal
 * («← Actual»), timeline de interacciones y deals donde es contacto principal.
 */
function PersonDetail({
  workspaceId,
  contact,
  data,
  deals,
  focusBrandId,
  onFocusBrand,
  reload,
  setError,
  setNotice,
}: {
  workspaceId: string;
  contact: Contact;
  data: CrmData;
  deals: Deal[];
  focusBrandId: string;
  onFocusBrand: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [jobTitle, setJobTitle] = useState(contact.job_title || "");
  const [email, setEmail] = useState(contact.email || "");
  const [phone, setPhone] = useState(contact.phone || "");
  const [status, setStatus] = useState(contact.status || "lead");
  const [notes, setNotes] = useState(contact.notes || "");
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [logType, setLogType] = useState("reunion");
  const [logNotes, setLogNotes] = useState("");
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    setJobTitle(contact.job_title || "");
    setEmail(contact.email || "");
    setPhone(contact.phone || "");
    setStatus(contact.status || "lead");
    setNotes(contact.notes || "");
  }, [contact]);

  // Timeline comercial de la persona (v45). Si la migración aún no corre, la
  // ficha sigue funcionando — solo el timeline queda vacío.
  useEffect(() => {
    let cancelled = false;
    setInteractions([]);
    crmFetch<{ data: Interaction[] }>(`/api/workspaces/${workspaceId}/interactions?contactId=${contact.id}`)
      .then((result) => { if (!cancelled) setInteractions(result.data || []); })
      .catch(() => { /* v45 pending */ });
    return () => { cancelled = true; };
  }, [contact.id, workspaceId]);

  const brand = data.brands.find((brand) => brand.id === contact.brand_id);
  const wa = whatsappLink(contact.phone);
  const stage = personalFunnelStage(deals, interactions);
  const brandHealth = brand?.computed_health || brand?.account_health;
  const lastContactDays = daysSince(brand?.last_contacted_at);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/contacts/${contact.id}`, {
        method: "PATCH",
        // Empty strings are deliberate: the API maps them to null, so the
        // user can actually clear an email, a phone or the notes.
        body: JSON.stringify({ jobTitle, email, phone, status, notes }),
      });
      setNotice("Persona actualizada.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const logInteraction = async (event: FormEvent) => {
    event.preventDefault();
    if (!brand) return;
    setLogging(true);
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/interactions`, {
        method: "POST",
        body: JSON.stringify({
          brandId: brand.id,
          contactId: contact.id,
          interactionType: logType,
          notes: logNotes || undefined,
        }),
      });
      setLogNotes("");
      setNotice("Interacción registrada — last_contacted_at de la marca quedó actualizado.");
      await reload();
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLogging(false);
    }
  };

  const fullName = `${contact.first_name} ${contact.last_name || ""}`.trim();

  return (
    <section className="workspace-panel crm-person-detail" aria-label={`Ficha de ${fullName}`}>
      <header className="crm-person-header">
        <div className="crm-person-cell">
          <span className="crm-person-avatar big" aria-hidden="true">{initials(fullName)}</span>
          <div>
            <p className="workspace-eyebrow">{brand?.name || contact.brand_name || "Sin marca"}</p>
            <h3>{contact.first_name} {contact.last_name}</h3>
            <p className="workspace-muted">{[contact.job_title, contact.company].filter(Boolean).join(" · ") || "Sin cargo registrado"}</p>
          </div>
        </div>
        <div className="crm-person-header-actions">
          {/* v52: el embudo es por marcas — el foco salta a la marca de la persona. */}
          {contact.brand_id && (
            <button
              type="button"
              className={`workspace-button secondary${focusBrandId === contact.brand_id ? " active" : ""}`}
              aria-pressed={focusBrandId === contact.brand_id}
              onClick={() => contact.brand_id && onFocusBrand(focusBrandId === contact.brand_id ? "" : contact.brand_id)}
            >
              {focusBrandId === contact.brand_id ? "Quitar del embudo" : "Ver en embudo"}
            </button>
          )}
          <span className={`crm-health ${status === "inactive" ? "at_risk" : "active"}`}>{contactStatusLabel(status)}</span>
        </div>
      </header>
      {(contact.email || contact.phone) && (
        <div className="crm-person-links">
          {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
          {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
          {wa && <a className="crm-wa-link" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      )}
      <div className="crm-person-layout">
        <aside className="crm-person-side">
          <section aria-label="Ficha comercial">
            <h4>Comercial</h4>
            {brand ? (
              <dl className="crm-fact-list">
                <div><dt>Relación</dt><dd>{brand.relationship_status === "client" ? "Cliente" : "Lead"}</dd></div>
                <div>
                  <dt>Salud {brandHealth !== brand.account_health ? "(computada)" : ""}</dt>
                  <dd><span className={`crm-health ${brandHealth}`}>{healthLabel(brandHealth || "active", brand.relationship_status)}</span></dd>
                </div>
                <div><dt>Prioridad</dt><dd>{brand.crm_priority === "low" ? "Baja" : brand.crm_priority === "high" ? "Alta" : brand.crm_priority === "urgent" ? "Urgente" : "Media"}</dd></div>
                <div><dt>Último contacto</dt><dd>{lastContactDays === null ? "Sin registro" : `Hace ${lastContactDays} día${lastContactDays === 1 ? "" : "s"}`}</dd></div>
                <div><dt>Interacciones</dt><dd>{brand.interaction_count || interactions.length}</dd></div>
              </dl>
            ) : (
              <p className="workspace-muted">Esta persona no tiene marca asignada — asígnale una para ver su ficha comercial.</p>
            )}
            {brand && (
              <form className="crm-log-form" onSubmit={logInteraction}>
                <h4>Registrar interacción</h4>
                <div className="workspace-form-row">
                  <Field label="Tipo">
                    <select value={logType} onChange={(event) => setLogType(event.target.value)}>
                      {Object.entries(INTERACTION_META).map(([value, meta]) => (
                        <option key={value} value={value}>{meta.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Notas"><textarea rows={2} value={logNotes} onChange={(event) => setLogNotes(event.target.value)} placeholder="Qué se acordó, objeciones, próximos pasos…" /></Field>
                <button className="workspace-button" disabled={logging}>{logging ? "Registrando…" : "Registrar"}</button>
              </form>
            )}
          </section>
          <form className="crm-person-form" onSubmit={save}>
            <h4>Datos de la persona</h4>
            <Field label="Cargo"><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></Field>
            <Field label="Estado">
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="lead">Lead</option>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>
            </Field>
            <div className="workspace-form-row">
              <Field label="Correo"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
              <Field label="Teléfono"><input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
            </div>
            <Field label="Notas"><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
            <button className="workspace-button">Guardar</button>
          </form>
        </aside>
        <div className="crm-person-main">
          <section aria-label="Embudo personal">
            <h4>Embudo personal</h4>
            {stage >= 0 ? (
              <ol className="crm-mini-funnel">
                {PERSON_FUNNEL.map((label, index) => (
                  <li key={label} className={`${index <= stage ? "reached" : ""}${index === stage ? " current" : ""}`}>
                    <span>{label}</span>
                    {index === stage && <em aria-current="step">← Actual</em>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="workspace-muted">Sin interacciones ni deals todavía.</p>
            )}
          </section>
          <section aria-label="Timeline de interacciones">
            <h4>Timeline comercial <span>{interactions.length}</span></h4>
            {interactions.length ? (
              <ol className="crm-interaction-list">
                {interactions.map((interaction) => {
                  const meta = interactionMeta(interaction.interaction_type);
                  return (
                    <li key={interaction.id} className="crm-interaction">
                      <span className="crm-interaction-chip" aria-hidden="true"><CrmIcon name={meta.icon} /></span>
                      <div>
                        <strong>{meta.label}</strong>
                        <small>{new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(interaction.interaction_date))}</small>
                        {interaction.notes && <p>{interaction.notes}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="workspace-muted">Sin interacciones registradas — la primera reunión, llamada o propuesta aparece aquí.</p>
            )}
          </section>
          <section aria-label="Deals de la persona">
            <h4>Deals donde es contacto principal <span>{deals.length}</span></h4>
            {deals.length ? (
              <div className="crm-compact-list">
                {deals.map((deal) => {
                  const dealBrand = data.brands.find((item) => item.id === deal.brand_id);
                  return (
                    <article key={deal.id}>
                      <strong>{deal.title}</strong>
                      <span>{dealBrand?.name || "Marca"} · {DEAL_STAGES.find((item) => item.value === deal.stage)?.label || deal.stage} · {Number(deal.value || 0) > 0 ? money(Number(deal.final_value ?? deal.value), deal.currency) : "Sin valor"} · {deal.progress.percentage}%</span>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="workspace-muted">Ninguno todavía — asígnale un deal desde «Ventas» (campo Contacto principal) para que esta persona cuente en el embudo.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

const FUNNEL_BRAND_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb923c", "#4ade80", "#22d3ee", "#f87171", "#e879f9"];

/** Punto de color por etapa — la referencia DIATTA marca cada fila del embudo
 *  con un indicador de estado a la izquierda del nombre. */
const FUNNEL_STAGE_DOTS: Record<DealStage, string> = {
  discovery: "#60a5fa",
  proposal: "#a78bfa",
  negotiation: "#fbbf24",
  approved: "#34d399",
  in_production: "#fb923c",
  review: "#22d3ee",
  ready: "#4ade80",
  delivered: "#a1a1aa",
  lost: "#ef4444",
};

/** Rampa beige del simulador (marca Futuraria): capa 0 = luz arriba, capa n =
 *  fondo de pirámide. fg legible sobre cada fondo; sin morado (regla dura). */
const FUNNEL_LAYER_SKINS: Array<{ bg: string; fg: string }> = [
  { bg: "linear-gradient(180deg, #e9ddc1, #dbcba6)", fg: "#1c1810" },
  { bg: "linear-gradient(180deg, #d6c49c, #c3ac7e)", fg: "#1c1810" },
  { bg: "linear-gradient(180deg, #b89f70, #a38a5c)", fg: "#201a0e" },
  { bg: "linear-gradient(180deg, #967f52, #7c6841)", fg: "#fff7e8" },
  { bg: "linear-gradient(180deg, #6d5c39, #554628)", fg: "#fff7e8" },
  { bg: "linear-gradient(180deg, #483c22, #372e19)", fg: "#ecdfc2" },
  { bg: "linear-gradient(180deg, #2e2715, #241e10)", fg: "#d8cba9" },
  { bg: "linear-gradient(180deg, #1f1a0d, #16130a)", fg: "#c0b493" },
];

/**
 * Vista embudo (pestaña 4) — el punto de vista de MARKETING del CRM: cómo baja
 * cada marca por las etapas, de Discovery a Entregado (Ventas es el punto de
 * vista comercial: negocia deal por deal). v52: B2B puro — no hay cotización
 * sin marca, así que la unidad es siempre el deal desglosado por marca y el
 * switch «Por personas» quedó fuera. Anatomía: tarjeta superior compartida
 * (título serif + nav de íconos + chips de foco por marca), simulador de capas
 * trapecio con la rampa beige de la marca, desglose de barras por etapa
 * (punto + descripción + drop de conversión), métricas y detalle por etapa.
 * «Perdido» queda fuera del embudo y se muestra aparte como fuga.
 */
function FunnelView({ data, navTabs, focusBrandId, onFocusBrand, onClearFocus }: { data: CrmData; navTabs?: ReactNode; focusBrandId: string; onFocusBrand: (brandId: string) => void; onClearFocus: () => void }) {
  const [openStage, setOpenStage] = useState<DealStage | null>("discovery");
  const funnel = useMemo(() => buildFunnel(data.deals, data.brands), [data.deals, data.brands]);
  const maxCount = Math.max(1, ...funnel.rows.map((row) => row.count));
  const openDeals = data.deals.filter((deal) => deal.stage !== "lost").length;
  const pipelineValue = data.deals
    .filter((deal) => deal.stage !== "lost" && deal.stage !== "delivered")
    .reduce((total, deal) => total + Number(deal.value || 0), 0);
  const deliveredCount = data.deals.filter((deal) => deal.stage === "delivered").length;
  const successRate = deliveredCount + funnel.lost.count > 0 ? deliveredCount / (deliveredCount + funnel.lost.count) : null;
  const openRate = data.deals.length > 0 ? openDeals / data.deals.length : null;
  const attentionCount = data.brands.filter((brand) => contactNeedsAttention(brand)).length;
  const brandColors = new Map(data.brands.map((brand, index): [string, string] => [brand.id, FUNNEL_BRAND_COLORS[index % FUNNEL_BRAND_COLORS.length]]));
  const legendBrands = new Map<string, string>();
  for (const row of funnel.rows) for (const entry of row.byBrand) if (entry.count > 0) legendBrands.set(entry.brandId, entry.name);
  const openRow = openStage ? funnel.rows.find((row) => row.stage === openStage) || null : null;
  const contactById = new Map(data.contacts.map((contact): [string, Contact] => [contact.id, contact]));
  // Foco de marca (v52): resalta sus deals en el desglose — el embudo siempre
  // muestra el volumen completo, el foco no filtra.
  const focusedBrand = focusBrandId ? data.brands.find((brand) => brand.id === focusBrandId) || null : null;
  const unitNoun = "deal";
  const unitPlural = `${unitNoun}s`;
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  // Simulador: capas trapecio — el ancho baja lineal de 100% a 38% para que la
  // silueta sea de embudo real y la rampa beige (FUNNEL_LAYER_SKINS) oscurezca
  // hacia el fondo de la pirámide. Cada capa abre el detalle de su etapa.
  const layerWidth = (index: number) => 100 - Math.round((62 * index) / Math.max(1, funnel.rows.length - 1));
  const layerClip = (index: number) => {
    const topWidth = layerWidth(index);
    const bottomWidth = layerWidth(Math.min(index + 1, funnel.rows.length - 1));
    const leftTop = (100 - topWidth) / 2;
    const leftBottom = (100 - bottomWidth) / 2;
    return `polygon(${leftTop}% 0%, ${100 - leftTop}% 0%, ${100 - leftBottom}% 100%, ${leftBottom}% 100%)`;
  };

  return (
    <div className="crm-contacts">
      <div className="crm-table-card crm-contacts-top">
        <header className="crm-contacts-head">
          <div>
            <h1>Embudo</h1>
            <p>Vista de marketing: cómo baja cada marca por las etapas, de Discovery a Entregado. Haz click en una capa para ver sus deals y rescata las marcas frenadas.</p>
          </div>
          {/* Nav de secciones (íconos) a la misma altura del título. */}
          {navTabs}
        </header>
        <div className="crm-contacts-toolbar">
          <div className="crm-person-chips" role="group" aria-label="Enfocar una marca del embudo">
            <button type="button" className={`crm-person-chip${focusBrandId ? "" : " active"}`} aria-pressed={!focusBrandId} onClick={onClearFocus}>Todas las marcas</button>
            {[...legendBrands.entries()].map(([brandId, name]) => (
              <button key={brandId} type="button" className={`crm-person-chip${focusBrandId === brandId ? " active" : ""}`} aria-pressed={focusBrandId === brandId} onClick={() => onFocusBrand(focusBrandId === brandId ? "" : brandId)}>
                <i style={{ background: brandColors.get(brandId) }} aria-hidden="true" />{name}
              </button>
            ))}
          </div>
          <span className="crm-funnel-status">{data.deals.length} deals · {money(pipelineValue)} en pipeline · {data.brands.length} marca{data.brands.length === 1 ? "" : "s"}</span>
        </div>
        {focusedBrand && (
          <p className="crm-focus-banner" role="status">
            <span>Foco en <strong>{focusedBrand.name}</strong> — sus deals se resaltan en el desglose por etapa.</span>
            <button type="button" className="workspace-link" onClick={onClearFocus}>Quitar foco</button>
          </p>
        )}
      </div>
      <section className="crm-table-card crm-funnel-sim" aria-label="Simulador del embudo">
        <div className="crm-funnel-sim-head">
          <h2>Simulador del embudo</h2>
          <p>{funnel.rows.length} etapas · de {funnel.rows[0].count} deals en Discovery a {funnel.rows[funnel.rows.length - 1].count} en Entregado · conversión total {funnel.endToEnd === null ? "—" : pct(funnel.endToEnd)}</p>
        </div>
        <div className="crm-funnel-sim-chart">
          {funnel.rows.map((row, index) => {
            const open = openStage === row.stage;
            const skin = FUNNEL_LAYER_SKINS[index % FUNNEL_LAYER_SKINS.length];
            const empty = row.count === 0;
            const prevLabel = index > 0 ? funnel.rows[index - 1].label : "";
            return (
              <div className="crm-funnel-layer-row" key={row.stage}>
                <button
                  type="button"
                  className={`crm-funnel-layer${open ? " open" : ""}${empty ? " empty" : ""}`}
                  style={{ clipPath: layerClip(index), background: empty ? "rgba(255,255,255,.04)" : skin.bg, color: empty ? "#8b8b94" : skin.fg }}
                  aria-expanded={open}
                  title={`${row.label}: ${row.count} ${row.count === 1 ? unitNoun : unitPlural}${row.conversionFromPrev === null || !prevLabel ? "" : ` · ${pct(row.conversionFromPrev)} desde ${prevLabel}`}`}
                  onClick={() => setOpenStage(open ? null : row.stage)}
                >
                  <span className="crm-funnel-layer-name">{row.label}</span>
                  <span className="crm-funnel-layer-count">{row.count}</span>
                </button>
                <div className="crm-funnel-layer-side">
                  <strong>{row.count} {row.count === 1 ? unitNoun : unitPlural}</strong>
                  <small>{row.conversionFromPrev === null || !prevLabel ? "Entrada al embudo" : `↓ ${pct(row.conversionFromPrev)} desde ${prevLabel}`}</small>
                </div>
              </div>
            );
          })}
        </div>
        {funnel.lost.count > 0 && (
          <p className="crm-funnel-lost">Fuga fuera del embudo: {funnel.lost.count} deal(s) perdidos{funnel.lost.value ? ` · ${money(funnel.lost.value)}` : ""}.</p>
        )}
      </section>
      <section className="crm-table-card" aria-label="Desglose del embudo por etapa">
        <div className="crm-funnel-chart">
          {funnel.rows.map((row, index) => {
            const width = row.count === 0 ? 0 : Math.max(12, Math.round((row.count / maxCount) * 100));
            const open = openStage === row.stage;
            const toggle = () => setOpenStage(open ? null : row.stage);
            const prevLabel = index > 0 ? funnel.rows[index - 1].label : "";
            const unitLabel = `${row.count} ${row.count === 1 ? unitNoun : unitPlural}`;
            return (
              <div className="crm-funnel-stage" key={row.stage}>
                <div className="crm-funnel-side">
                  <span className="crm-funnel-dot" style={{ background: FUNNEL_STAGE_DOTS[row.stage] }} aria-hidden="true" />
                  <button type="button" className={`crm-funnel-name${open ? " active" : ""}`} aria-expanded={open} onClick={toggle}>
                    {row.label}
                    <small className="crm-funnel-desc">{STAGE_DESCRIPTIONS[row.stage]}</small>
                  </button>
                </div>
                <div className="crm-funnel-track">
                  {row.count === 0 ? (
                    <div className="crm-funnel-zero">
                      <button type="button" className="crm-funnel-bar is-zero" aria-expanded={open} title={`${row.label}: 0 ${unitPlural}`} onClick={toggle}>0</button>
                      <span className="crm-funnel-total">0 {unitPlural}</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="crm-funnel-bar"
                      style={{ width: `${width}%` }}
                      aria-expanded={open}
                      title={`${row.label}: ${unitLabel}${row.conversionFromPrev === null ? "" : ` · ${pct(row.conversionFromPrev)} desde ${prevLabel}`}`}
                      onClick={toggle}
                    >
                      {row.byBrand.map((entry) => <span key={entry.brandId} style={{ flexGrow: entry.count, background: brandColors.get(entry.brandId), opacity: focusBrandId && entry.brandId !== focusBrandId ? 0.18 : undefined }} title={`${entry.name}: ${entry.count}`} />)}
                      <span className="crm-funnel-bar-count">{row.count}</span>
                    </button>
                  )}
                  {row.count === 0 && row.conversionFromPrev !== null && (
                    <p className="crm-funnel-drop" title={`De cada 100 deals que llegaron a ${prevLabel}, ${Math.round(row.conversionFromPrev * 100)} avanzan aquí`}>
                      <strong>↓ {pct(row.conversionFromPrev)}</strong> {prevLabel} → {row.label}
                    </p>
                  )}
                </div>
                <span className="crm-funnel-total" aria-label={`${unitLabel} en ${row.label}`}>{unitLabel}</span>
              </div>
            );
          })}
        </div>
        {legendBrands.size > 0 && (
          <div className="crm-funnel-legend" aria-label="Marcas del embudo">
            {[...legendBrands.entries()].map(([brandId, name]) => (
              <span key={brandId} style={focusBrandId && focusBrandId !== brandId ? { opacity: 0.35 } : undefined}><i style={{ background: brandColors.get(brandId) }} aria-hidden="true" />{name}</span>
            ))}
          </div>
        )}
        <div className="crm-stats-grid" aria-label="Métricas del embudo">
          <article className="crm-stat-card">
            <span className="crm-stat-label">Conversión general</span>
            <p className="crm-stat-main"><span className="crm-stat-icon" aria-hidden="true"><CrmIcon name="chart" size={16} /></span><strong>{funnel.endToEnd === null ? "—" : pct(funnel.endToEnd)}</strong></p>
            <span className="crm-stat-caption">Discovery → Entregado</span>
          </article>
          <article className="crm-stat-card">
            <span className="crm-stat-label">Tasa de éxito</span>
            <p className="crm-stat-main"><span className="crm-stat-icon" aria-hidden="true"><CrmIcon name="check" size={16} /></span><strong>{successRate === null ? "—" : pct(successRate)}</strong></p>
            <span className="crm-stat-caption">Entregado vs Perdido</span>
          </article>
          <article className="crm-stat-card">
            <span className="crm-stat-label">Retención</span>
            <p className="crm-stat-main"><span className="crm-stat-icon" aria-hidden="true"><CrmIcon name="refresh" size={16} /></span><strong>{openRate === null ? "—" : pct(openRate)}</strong></p>
            <span className="crm-stat-caption">Deals abiertos vs total</span>
          </article>
          <article className="crm-stat-card attention">
            <span className="crm-stat-label">Requieren atención</span>
            <p className="crm-stat-main"><span className="crm-stat-icon" aria-hidden="true"><CrmIcon name="warn" size={16} /></span><strong>{attentionCount}</strong></p>
            <span className="crm-stat-caption">Marcas en riesgo o sin contacto 30+ días</span>
          </article>
        </div>
        {openRow && (
          <div className="workspace-panel crm-funnel-detail">
            <h4>{openRow.label} — {openRow.count} {openRow.count === 1 ? unitNoun : unitPlural}</h4>
            {openRow.deals.length ? (
              <div className="crm-compact-list">
                {openRow.deals.map((deal) => {
                  const dealBrand = data.brands.find((brand) => brand.id === deal.brand_id);
                  const dealContact = deal.primary_contact_id ? contactById.get(deal.primary_contact_id) : null;
                  return (
                    <article key={deal.id}>
                      <strong>{deal.title}</strong>
                      <span>{dealBrand?.name || "Marca"} · {[dealContact && contactName(dealContact), Number(deal.value || 0) > 0 ? money(Number(deal.value), deal.currency) : null].filter(Boolean).join(" · ") || "Sin contacto ni valor"}</span>
                    </article>
                  );
                })}
              </div>
            ) : <p className="workspace-muted">Sin deals en esta etapa.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
