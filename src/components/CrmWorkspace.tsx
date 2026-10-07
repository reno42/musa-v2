import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getApiHeaders } from "../lib/apiKey";
import { ALL_DEAL_STAGES as DEAL_STAGES, buildFunnel, contactName, FUNNEL_LAYER_SKINS, FUNNEL_STAGE_DOTS, type DealStage } from "../lib/crmFunnel";
import { buildPersonStory, daysSincePerson, personLastContact, personOriginLabel } from "../lib/crmPerson";
import { downloadCsv, splitTags } from "../lib/tabularCsv";
import { CONTACT_FIELDS, type ImportSourceId } from "../lib/importMappers";
import { ImportWizardModal } from "./ImportWizardModal";
import { ASSET_TYPE_OPTIONS, type DesignAssetType } from "../lib/designGraph";
import { readDetailId, writeDetailId } from "../lib/detailRestore";
import { InspectorDrawer } from "./InspectorDrawer";
import { PeekHead, PeekPanel } from "./PeekPanel";

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

/** REQ-029 Items 1/3: origen de un touchpoint capturado (columna data JSONB
 *  de v45) — alimenta el link «Ver en {platform}» / «Ver en Bandeja». */
type InteractionOrigin = {
  origin?: string;
  platform?: string | null;
  itemId?: string;
  permalink?: string | null;
};

/** v45: un touchpoint comercial del timeline (crm_interactions). */
type Interaction = {
  id: string;
  // v58 (CRM-001): null = interacción sin marca (personas brand-less).
  brand_id: string | null;
  contact_id?: string | null;
  interaction_type: string;
  notes?: string | null;
  interaction_date: string;
  data?: InteractionOrigin | null;
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
  /** v48: próximo paso declarado por el humano — el sistema nunca lo sugiere. */
  next_step_note?: string | null;
  next_step_date?: string | null;
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

/** v54.2 (shell-first): datos vacíos con la forma de CrmData para que las
 *  tarjetas superiores (título + descriptor + CTA + nav) rendericen AL TOQUE,
 *  sin esperar a /crm; el contenido de cada vista muestra su propia carga. */
const EMPTY_CRM_DATA: CrmData = {
  brands: [],
  contacts: [],
  campaigns: [],
  deals: [],
  designs: [],
  summary: { pipelineValue: 0, weightedValue: 0, openDeals: 0, pendingDeliverables: 0 },
};
/** The five CRM views: Ventas kanban, Personas table, Marcas accounts, Embudo
 *  funnel and Captura (REQ-029 Item 2: la Bandeja social como etapa de
 *  captura del CRM). */
export type CrmView = "pipeline" | "personas" | "accounts" | "embudo" | "captura";

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
  // v58 (REQ-029 Item 3): touchpoint de comentarios capturados de la Bandeja.
  comentario: { label: "Comentario", icon: "chat" },
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

/** v56 — auto-log: touchpoint que se registra SOLO al avanzar a la etapa
 *  (arrastrar hacia adelante). in_production es trabajo interno: no ensucia
 *  el timeline. Retrocesos nunca loguean — reconsiderar no es un touchpoint.
 *  El apunte viaja con deal_id (v48): si la migración aún no corre, el API lo
 *  guarda a nivel marca y el sistema sigue 100% sincronizado. */
const STAGE_AUTO_LOG: Partial<Record<DealStage, string>> = {
  proposal: "propuesta_enviada",
  negotiation: "follow_up",
  approved: "aprobacion",
  review: "revision",
  ready: "publicacion",
  delivered: "pago",
  lost: "objecion",
};

function stageIndex(stage: DealStage) {
  return DEAL_STAGES.findIndex((item) => item.value === stage);
}

/** Etiqueta legible de etapa para el toast de CRM-004. */
function stageLabel(stage: DealStage) {
  return DEAL_STAGES.find((item) => item.value === stage)?.label || stage;
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

/** Días hasta la entrega: negativo = vencida, null sin fecha. Alimenta la
 *  pill de la tarjeta del kanban («Entrega en Nd» / «Vencida hace Nd»). */
function daysUntil(value?: string | null) {
  if (!value) return null;
  return Math.round((new Date(`${value}T00:00:00`).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
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

/** REQ-029 Items 1/3: link de origen de un touchpoint del timeline — permalink
 *  a la red social cuando el capture lo guardó, o salto a la vista Captura
 *  (Bandeja) cuando la interacción nació ahí sin permalink. */
function interactionOriginLink(interaction: Interaction): { href: string; label: string } | null {
  const data = interaction.data;
  if (!data) return null;
  if (data.permalink) return { href: data.permalink, label: `Ver en ${data.platform || "la red"}` };
  if (data.origin === "zernio_inbox") return { href: "#workspace/contactos/captura", label: "Ver en Bandeja" };
  return null;
}

/** REQ-029 Item 1: bloque colapsable de la ficha — <details> nativo (accesible
 *  de fábrica) con el open controlado por React para que el defaultOpen
 *  dependa de los datos (con marca abre Comercial, con embudo abre Embudo). */
function CrmCollapsible({ label, defaultOpen, children }: {
  label: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="crm-collapsible" open={open}>
      <summary aria-expanded={open} onClick={(event) => { event.preventDefault(); setOpen((wasOpen) => !wasOpen); }}>
        <span className="crm-collapsible-chevron" aria-hidden="true"><CrmIcon name="chevron" size={12} /></span>
        <span>{label}</span>
      </summary>
      <div className="crm-collapsible-body">{children}</div>
    </details>
  );
}

export function CrmWorkspace({
  workspaceId,
  onOpenTemplate,
  setError,
  setNotice,
  view: controlledView,
  navTabs,
  onViewChange,
}: {
  workspaceId: string;
  onOpenTemplate?: (templateId: string) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  /**
   * When set, the parent owns which view shows and renders the switch itself
   * -- the Red de Marcas tab bar hosts the CRM views (Ventas, Personas,
   * Marcas, Embudo, Captura) next to Grafo and Tabla, so the internal switch
   * would be a second, stale copy.
   */
  view?: CrmView;
  /**
   * v49: pestañas de solo íconos (CrmNavTabs) que el padre inyecta para que
   * vivan DENTRO de la fila de toolbar de cada vista — en Personas, en la
   * misma fila que búsqueda, dropdowns y «+ Agregar persona».
   */
  navTabs?: ReactNode;
  /** REQ-029 Item 2: avisa al padre (GraphTab → URL) cuando una acción
   *  interna cambia de vista — «Ver contacto» desde Captura salta a Personas. */
  onViewChange?: (next: CrmView) => void;
}) {
  const [data, setData] = useState<CrmData | null>(null);
  const [ownView, setView] = useState<CrmView>("pipeline");
  const view = controlledView ?? ownView;
  // REQ-029 Item 2: «Ver contacto» desde la vista Captura — cambia a Personas
  // y abre la ficha (initialSelectedContactId). El id se consume al montar.
  const [pendingContactId, setPendingContactId] = useState("");
  const openContactFromCaptura = useCallback((contactId: string) => {
    setPendingContactId(contactId);
    // Controlado (GraphTab): la vista la tiene el padre — vía onViewChange.
    if (controlledView) onViewChange?.("personas");
    else setView("personas");
  }, [controlledView, onViewChange]);
  useEffect(() => {
    if (view !== "personas" || !pendingContactId) return;
    // ContactsView ya leyó la prop en su mount; limpiar para que volver a
    // Personas (sin pasar por Captura) no reabra la ficha.
    const timer = window.setTimeout(() => setPendingContactId(""), 0);
    return () => window.clearTimeout(timer);
  }, [view, pendingContactId]);
  // v54.2: referencia a los datos ya cargados — las recargas tras una
  // mutación son silenciosas (la UI no vuelve a bloquearse ni parpadear).
  const dataRef = useRef<CrmData | null>(null);
  // v56: la ficha del deal vive en el InspectorDrawer; drawerTab elige la
  // pestaña (Resumen/Timeline/Persona/Marca) y focusOutcome abre Resumen
  // directo en el formulario de cierre cuando un drop a delivered/lost lo pide.
  // v57: ninguna ficha se preselecciona jamás — el drawer de Ventas y el de
  // Marcas se abren únicamente con click del usuario. La preselección
  // automática abría el drawer solo en cada carga y remount. Esto NO es
  // preselección: si el refresh llega con una ficha ABIERTA (el usuario hizo
  // click antes), la reabrimos — el id se guardó al abrirla y se borra al
  // cerrarla, así que un refresh posterior no reabre nada (lib/detailRestore).
  const [selectedDealId, setSelectedDealId] = useState(() => readDetailId("crm-deal", workspaceId) || "");
  useEffect(() => { writeDetailId("crm-deal", workspaceId, selectedDealId || null); }, [selectedDealId, workspaceId]);
  const [drawerTab, setDrawerTab] = useState<DealDrawerTab>("resumen");
  const [focusOutcome, setFocusOutcome] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [showDealForm, setShowDealForm] = useState(false);
  /** v52: marca enfocada que cruza vistas — se marca en Personas o en la
   *  ficha de una persona y el embudo resalta sus deals. */
  const [focusBrandId, setFocusBrandId] = useState("");
  /** REQ-030 Item 3 (CRM-004): red de seguridad del kanban — toast con la
   *  transición y Deshacer de 5s. Nada de modales: el flujo queda igual de
   *  rápido, solo con salida de emergencia. */
  const [stageToast, setStageToast] = useState<{ dealId: string; from: DealStage; to: DealStage } | null>(null);
  const stageToastTimer = useRef<number | null>(null);
  useEffect(() => () => { if (stageToastTimer.current) window.clearTimeout(stageToastTimer.current); }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return; // evita el 403 de /api/workspaces//crm al montar sin workspace resuelto
    try {
      const result = await crmFetch<{ data: CrmData }>(`/api/workspaces/${workspaceId}/crm`);
      dataRef.current = result.data;
      setData(result.data);
      // v57: ninguna ficha se preselecciona jamás — el drawer de Ventas y el de
      // Marcas se abren únicamente con click del usuario. La preselección
      // automática abría el drawer solo en cada carga y remount.
    } catch (cause: any) {
      setError(cause.message);
    }
  }, [setError, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const showStageToast = useCallback((dealId: string, from: DealStage, to: DealStage) => {
    if (stageToastTimer.current) window.clearTimeout(stageToastTimer.current);
    setStageToast({ dealId, from, to });
    stageToastTimer.current = window.setTimeout(() => setStageToast(null), 5000);
  }, []);

  const selectedDeal = data?.deals.find((deal) => deal.id === selectedDealId) || null;
  const selectedBrand = data?.brands.find((brand) => brand.id === selectedBrandId) || null;

  /**
   * v56 — movimiento de etapa por drag & drop (y por el select de la ficha):
   * update optimista, PATCH, auto-log del touchpoint SOLO en avances, y
   * reglas de cierre — un drop a delivered/lost abre la ficha pidiendo valor
   * final o motivo de pérdida, porque cerrar sin esas dos cosas rompe el
   * embudo. Si el PATCH falla, el optimismo se revierte y el error sube.
   */
  const handleStageDrop = useCallback(async (dealId: string, stage: DealStage) => {
    const deal = dataRef.current?.deals.find((item) => item.id === dealId);
    if (!deal || deal.stage === stage) return;
    const previous = dataRef.current;
    if (previous) {
      const nextData: CrmData = {
        ...previous,
        deals: previous.deals.map((item) => (item.id === dealId ? { ...item, stage } : item)),
      };
      dataRef.current = nextData;
      setData(nextData);
    }
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      const forward = stageIndex(stage) > stageIndex(deal.stage);
      const touchpoint = STAGE_AUTO_LOG[stage];
      if (forward && touchpoint) {
        // Best-effort: si v48 no corre, el API degrada el apunte a nivel
        // marca; cualquier otro fallo no revierte el movimiento de etapa.
        await crmFetch(`/api/workspaces/${workspaceId}/interactions`, {
          method: "POST",
          body: JSON.stringify({
            brandId: deal.brand_id,
            contactId: deal.primary_contact_id || null,
            dealId: deal.id,
            interactionType: touchpoint,
          }),
        }).catch(() => undefined);
      }
      setNotice(stage === "lost" ? "Deal movido a Perdido — registra el motivo." : stage === "delivered" ? "Deal entregado — confirma el valor final." : "Etapa actualizada.");
      // CRM-004: el feedback del movimiento es el toast con Deshacer (el
      // notice queda para los cierres, que abren la ficha pidiendo valor/motivo).
      if (stage !== "lost" && stage !== "delivered") showStageToast(dealId, deal.stage, stage);
      await load();
    } catch (cause: any) {
      if (previous) { dataRef.current = previous; setData(previous); }
      setError(cause.message);
      return;
    }
    if (stage === "delivered" || stage === "lost") {
      setSelectedDealId(dealId);
      setDrawerTab("resumen");
      setFocusOutcome(true);
    }
  }, [load, setError, setNotice, showStageToast, workspaceId]);

  /** CRM-004: deshace la última transición por la MISMA vía (PATCH existente).
   *  Los retrocesos nunca auto-loguean touchpoint — reconsiderar no es un
   *  touchpoint (misma regla del STAGE_AUTO_LOG). */
  const undoStage = useCallback(async () => {
    const toast = stageToast;
    if (!toast) return;
    if (stageToastTimer.current) window.clearTimeout(stageToastTimer.current);
    setStageToast(null);
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${toast.dealId}`, { method: "PATCH", body: JSON.stringify({ stage: toast.from }) });
      setNotice(`Etapa restaurada: ${stageLabel(toast.to)} → ${stageLabel(toast.from)}.`);
      await load();
    } catch (cause: any) {
      setError(cause.message);
    }
  }, [load, setError, setNotice, stageToast, workspaceId]);

  /** v56: abrir la ficha de un deal — un solo camino para kanban, Persona,
   *  Marca y cualquier lista de deals: el drawer entero cambia de deal. */
  const openDeal = useCallback((dealId: string) => {
    setSelectedDealId(dealId);
    setDrawerTab("resumen");
    setFocusOutcome(false);
  }, []);

  // v54.2 (shell-first): la tarjeta superior (título + descriptor + CTA + nav)
  // carga SIEMPRE primero — cambiar de vista nunca espera a los datos; solo
  // el contenido de la vista activa muestra su estado de carga.
  const crmLoading = !data;

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
            <button type="button" className={view === "captura" ? "active" : ""} aria-pressed={view === "captura"} onClick={() => setView("captura")}>Captura</button>
          </div>
        </div>
      )}

      {view === "pipeline" ? (
        /* v55: la tarjeta superior solo presenta (título serif + nav de íconos);
           los KPIs del resumen, el alta «+ Nuevo deal» y su formulario viven
           DENTRO de la tarjeta del tablero, encima del kanban. */
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
          </div>
          {data ? (<>
          <section className="crm-table-card" aria-label="Kanban de deals">
            <div className="crm-contacts-toolbar">
              <CrmSummary data={data} />
              <button type="button" className="workspace-button crm-toolbar-add" onClick={() => setShowDealForm((current) => !current)}>{showDealForm ? "Cerrar formulario" : "+ Nuevo deal"}</button>
            </div>
            {showDealForm && <NewDealForm workspaceId={workspaceId} data={data} onCreated={async () => { setShowDealForm(false); setNotice("Deal creado con sus entregables."); await load(); }} setError={setError} />}
            <PipelineBoard
              deals={data.deals}
              brands={data.brands}
              onOpenDeal={openDeal}
              onStageChange={handleStageDrop}
            />
          </section>
          {data.deals.length === 0 && (
            <div className="crm-empty">
              <h3>El pipeline está vacío</h3>
              <p>Crea un deal para convertir el alcance comercial en entregables medibles.</p>
              <button type="button" className="workspace-button" onClick={() => setShowDealForm(true)}>Crear primer deal</button>
            </div>
          )}
          </>) : <div className="crm-loading" role="status">Cargando CRM…</div>}
        </div>
      ) : view === "personas" ? (
        <ContactsView
          workspaceId={workspaceId}
          data={data}
          initialSelectedContactId={pendingContactId}
          focusBrandId={focusBrandId}
          onFocusBrand={setFocusBrandId}
          onOpenDeal={openDeal}
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
          onOpenDeal={openDeal}
          reload={load}
          setError={setError}
          setNotice={setNotice}
          navTabs={navTabs}
        />
      ) : view === "captura" ? (
        <CapturaView
          workspaceId={workspaceId}
          navTabs={navTabs}
          onOpenContact={openContactFromCaptura}
          setError={setError}
          setNotice={setNotice}
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

      {/* v56: la ficha del deal — InspectorDrawer con pestañas sincronizadas.
          Timeline muestra la historia de ESTA negociación (deal_id, v48, con
          chips por persona); Persona y Marca montan los MISMOS componentes
          que las vistas Personas/Marcas sobre el mismo estado — no hay copias
          que desincronizar, un solo load() alimenta todo. */}
      {selectedDeal && data && (
        <DealDrawer
          workspaceId={workspaceId}
          deal={selectedDeal}
          data={data}
          tab={drawerTab}
          onTabChange={(next) => { setDrawerTab(next); setFocusOutcome(false); }}
          focusOutcome={focusOutcome}
          onClose={() => setSelectedDealId("")}
          onOpenDeal={openDeal}
          onStageChange={handleStageDrop}
          onOpenTemplate={onOpenTemplate}
          reload={load}
          setError={setError}
          setNotice={setNotice}
        />
      )}

      {/* REQ-030 Item 3 (CRM-004): toast del movimiento de etapa con red de
          seguridad — Deshacer re-aplica la etapa anterior por la misma vía. */}
      {stageToast && createPortal(
        <div className="crm-stage-toast" role="status" aria-live="polite">
          <span>Etapa: {stageLabel(stageToast.from)} → {stageLabel(stageToast.to)}</span>
          <button type="button" className="crm-stage-toast-undo" onClick={() => void undoStage()}>Deshacer</button>
        </div>,
        document.body
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

/**
 * v56 — kanban de deals con drag & drop nativo (patrón DIATTA, sin lib):
 * la tarjeta es draggable, la columna resalta con drag-over y el drop mueve
 * la etapa. El select de etapa murió: click en la tarjeta abre la ficha
 * (drawer), que es también la vía accesible/touch para cambiar de etapa.
 * El header suma el valor de la columna para priorizar en frío.
 */
function PipelineBoard({
  deals,
  brands,
  onOpenDeal,
  onStageChange,
}: {
  deals: Deal[];
  brands: Brand[];
  onOpenDeal: (id: string) => void;
  onStageChange: (id: string, stage: DealStage) => Promise<void>;
}) {
  const [draggingId, setDraggingId] = useState("");
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  // v56 (fix): algunos navegadores disparan un click sintético sobre la
  // tarjeta al soltar un drag nativo (el mousedown nació ahí) y abría la
  // ficha sola; ignoramos clicks en los 300ms posteriores a un dragend.
  const lastDragEndRef = useRef(0);

  const releaseDrag = () => { setDraggingId(""); setDragOverStage(null); };

  const drop = (stage: DealStage) => {
    const id = draggingId;
    releaseDrag();
    if (!id) return;
    const deal = deals.find((item) => item.id === id);
    if (!deal || deal.stage === stage) return;
    void onStageChange(id, stage);
  };

  return (
    <div className="crm-board">
      {DEAL_STAGES.map((stage) => {
        const stageDeals = deals.filter((deal) => deal.stage === stage.value);
        const columnValue = stageDeals.reduce((total, deal) => total + Number(deal.value || 0), 0);
        return (
          <div
            className={`crm-column${dragOverStage === stage.value ? " drag-over" : ""}`}
            key={stage.value}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
            onDragEnter={() => setDragOverStage(stage.value)}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStage((current) => (current === stage.value ? null : current)); }}
            onDrop={(event) => { event.preventDefault(); drop(stage.value); }}
          >
            <header><h3>{stage.label}</h3><span>{stageDeals.length}</span></header>
            {columnValue > 0 && <p className="crm-column-value" aria-label="Valor de la etapa">{money(columnValue)}</p>}
            <div className="crm-column-body">
              {stageDeals.length === 0 && <p className="crm-column-empty">{dragOverStage === stage.value ? "Suéltalo aquí" : "Sin deals"}</p>}
              {stageDeals.map((deal) => {
                const brand = brands.find((item) => item.id === deal.brand_id);
                const due = daysUntil(deal.due_date);
                const overdue = due !== null && due < 0;
                const soon = due !== null && due >= 0 && due <= 7;
                const stepOverdue = deal.next_step_date ? new Date(`${deal.next_step_date}T00:00:00`).getTime() < Date.now() : false;
                return (
                  <article
                    className={`crm-deal-card${draggingId === deal.id ? " dragging" : ""}`}
                    key={deal.id}
                    draggable
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", deal.id); setDraggingId(deal.id); }}
                    onDragEnd={() => { lastDragEndRef.current = Date.now(); releaseDrag(); }}
                  >
                    <button type="button" className="crm-deal-main" onClick={() => { if (Date.now() - lastDragEndRef.current < 300) return; onOpenDeal(deal.id); }} aria-haspopup="dialog">
                      <span className="crm-deal-brand">{brand?.name || "Marca"}</span>
                      <strong>{deal.title}</strong>
                      <span className="crm-deal-meta">{deal.progress.completed}/{deal.progress.requested} entregables · {money(Number(deal.value || 0), deal.currency)}</span>
                      <progress value={deal.progress.completed} max={Math.max(1, deal.progress.requested)} aria-label={`${deal.progress.percentage}% completado`} />
                      {(overdue || soon || deal.next_step_note) && (
                        <span className="crm-deal-pills">
                          {(overdue || soon) && (
                            <span className={`crm-deal-pill${overdue ? " danger" : ""}`}>
                              {overdue ? `Vencida hace ${Math.abs(due ?? 0)}d` : `Entrega en ${due}d`}
                            </span>
                          )}
                          {deal.next_step_note && (
                            <span className={`crm-deal-pill${stepOverdue ? " danger" : ""}`} title="Próximo paso">
                              {deal.next_step_date ? `${shortDate(deal.next_step_date)} · ` : ""}{deal.next_step_note}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
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
            {/* M-14: filter(Boolean) evita "Ren " con espacio fantasma si falta el apellido. */}
            {brandContacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.first_name, contact.last_name].filter(Boolean).join(" ")}</option>)}
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
  contacts,
  focusOutcome,
  onOpenTemplate,
  onStageChange,
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
  /** Stakeholders de la marca del deal — elige el contacto principal. */
  contacts: Contact[];
  /** v56: un drop a delivered/lost abre el formulario de cierre directo. */
  focusOutcome: boolean;
  onOpenTemplate?: (id: string) => void;
  onStageChange: (id: string, stage: DealStage) => Promise<void>;
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
  // v56: datos comerciales editables desde la ficha — el PATCH ya los
  // aceptaba, solo faltaba la UI. Próximo paso incluido (nota + fecha):
  // el sistema nunca lo sugiere, solo lo muestra y lo vence.
  const [commercial, setCommercial] = useState(() => ({
    value: deal.value != null ? String(deal.value) : "",
    probability: String(deal.probability ?? 10),
    dueDate: deal.due_date || "",
    expectedCloseDate: deal.expected_close_date || "",
    primaryContactId: deal.primary_contact_id || "",
    nextStepNote: deal.next_step_note || "",
    nextStepDate: deal.next_step_date || "",
    notes: deal.notes || "",
  }));
  const [savingCommercial, setSavingCommercial] = useState(false);

  useEffect(() => {
    setOutcomeValue(deal.final_value != null ? String(deal.final_value) : "");
    setLostReason(deal.lost_reason || "");
    setEditingOutcome(false);
  }, [deal.id, deal.final_value, deal.lost_reason]);

  // Declarado DESPUÉS del reset anterior: cuando un drop pide el formulario
  // de cierre, este efecto gana y deja la edición abierta.
  useEffect(() => {
    setEditingOutcome(focusOutcome && (deal.stage === "delivered" || deal.stage === "lost"));
  }, [focusOutcome, deal.id, deal.stage]);

  useEffect(() => {
    setCommercial({
      value: deal.value != null ? String(deal.value) : "",
      probability: String(deal.probability ?? 10),
      dueDate: deal.due_date || "",
      expectedCloseDate: deal.expected_close_date || "",
      primaryContactId: deal.primary_contact_id || "",
      nextStepNote: deal.next_step_note || "",
      nextStepDate: deal.next_step_date || "",
      notes: deal.notes || "",
    });
  }, [deal.id, deal.value, deal.probability, deal.due_date, deal.expected_close_date, deal.primary_contact_id, deal.next_step_note, deal.next_step_date, deal.notes]);

  const saveCommercial = async (event: FormEvent) => {
    event.preventDefault();
    setSavingCommercial(true);
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          value: commercial.value === "" ? null : Number(commercial.value),
          probability: Math.max(0, Math.min(100, Number(commercial.probability) || 0)),
          dueDate: commercial.dueDate || null,
          expectedCloseDate: commercial.expectedCloseDate || null,
          primaryContactId: commercial.primaryContactId || null,
          nextStepNote: commercial.nextStepNote.trim() || null,
          nextStepDate: commercial.nextStepDate || null,
          notes: commercial.notes,
        }),
      });
      setNotice("Deal actualizado.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
    finally { setSavingCommercial(false); }
  };

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
          {/* v56: la etapa vuelve a ser editable sin drag — vía accesible y
              touch (el DnD del kanban no existe en pantallas táctiles). */}
          <label className="crm-campaign-select">
            <span>Etapa</span>
            <select value={deal.stage} onChange={(event) => void onStageChange(deal.id, event.target.value as DealStage)}>
              {DEAL_STAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
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
      {/* v56: datos comerciales del deal — antes solo se podían fijar al crear. */}
      <form className="crm-deal-commercial" onSubmit={saveCommercial}>
        <h4>Comercial</h4>
        <div className="crm-form-grid">
          <Field label="Valor estimado"><input type="number" min="0" step="0.01" value={commercial.value} onChange={(event) => setCommercial((current) => ({ ...current, value: event.target.value }))} placeholder="0" /></Field>
          <Field label="Probabilidad (%)"><input type="number" min="0" max="100" value={commercial.probability} onChange={(event) => setCommercial((current) => ({ ...current, probability: event.target.value }))} /></Field>
          <Field label="Fecha de entrega"><input type="date" value={commercial.dueDate} onChange={(event) => setCommercial((current) => ({ ...current, dueDate: event.target.value }))} /></Field>
          <Field label="Cierre estimado"><input type="date" value={commercial.expectedCloseDate} onChange={(event) => setCommercial((current) => ({ ...current, expectedCloseDate: event.target.value }))} /></Field>
          <Field label="Contacto principal">
            <select value={commercial.primaryContactId} onChange={(event) => setCommercial((current) => ({ ...current, primaryContactId: event.target.value }))}>
              <option value="">Sin contacto principal</option>
              {contacts.map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name}</option>)}
            </select>
          </Field>
          <Field label="Próximo paso"><input value={commercial.nextStepNote} onChange={(event) => setCommercial((current) => ({ ...current, nextStepNote: event.target.value }))} placeholder="Llamar el martes, enviar cotización por WhatsApp…" /></Field>
          <Field label="Fecha del paso"><input type="date" value={commercial.nextStepDate} onChange={(event) => setCommercial((current) => ({ ...current, nextStepDate: event.target.value }))} /></Field>
        </div>
        <Field label="Notas internas"><textarea rows={2} value={commercial.notes} onChange={(event) => setCommercial((current) => ({ ...current, notes: event.target.value }))} placeholder="Contexto de la negociación, objeciones, acuerdos…" /></Field>
        <button className="workspace-button" disabled={savingCommercial}>{savingCommercial ? "Guardando…" : "Guardar cambios"}</button>
      </form>
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

/** Pestañas de la ficha del deal (v56, InspectorDrawer). */
type DealDrawerTab = "resumen" | "timeline" | "persona" | "marca";

const DEAL_DRAWER_TABS: Array<{ id: DealDrawerTab; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "timeline", label: "Timeline" },
  { id: "persona", label: "Persona" },
  { id: "marca", label: "Marca" },
];

/**
 * Ficha del deal en el InspectorDrawer. Las pestañas Persona y Marca montan
 * los MISMOS PersonDetail/BrandDetail de las vistas Personas/Marcas sobre el
 * mismo estado global: la sincronización es por construcción, no hay copias.
 * La referencia cruzada vive en ambos sentidos — desde Marca, un click en un
 * deal abre SU ficha; desde Resumen, el eyebrow salta a la marca.
 */
function DealDrawer({
  workspaceId,
  deal,
  data,
  tab,
  onTabChange,
  focusOutcome,
  onClose,
  onOpenDeal,
  onStageChange,
  onOpenTemplate,
  reload,
  setError,
  setNotice,
}: {
  workspaceId: string;
  deal: Deal;
  data: CrmData;
  tab: DealDrawerTab;
  onTabChange: (tab: DealDrawerTab) => void;
  focusOutcome: boolean;
  onClose: () => void;
  onOpenDeal: (dealId: string) => void;
  onStageChange: (dealId: string, stage: DealStage) => Promise<void>;
  onOpenTemplate?: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const brand = data.brands.find((item) => item.id === deal.brand_id);
  const contact = data.contacts.find((item) => item.id === deal.primary_contact_id);
  const brandContacts = data.contacts.filter((item) => item.brand_id === deal.brand_id);
  const campaigns = data.campaigns.filter((item) => item.brand_id === deal.brand_id);
  const campaign = data.campaigns.find((item) => item.id === deal.campaign_id);
  const contactWa = whatsappLink(contact?.phone);

  return (
    <InspectorDrawer
      open
      onClose={onClose}
      ariaLabel={`Ficha del deal ${deal.title}`}
      storageKey="crm-deal-drawer-width"
      eyebrow={
        <>
          <button type="button" className="workspace-link" onClick={() => onTabChange("marca")}>{brand?.name || "Marca"}</button>
          {" · "}{campaign?.name || "Sin campaña"}
        </>
      }
      title={deal.title}
      actions={
        <>
          {contactWa && <a className="workspace-button secondary" href={contactWa} target="_blank" rel="noreferrer">WhatsApp</a>}
          {contact?.email && <a className="workspace-button secondary" href={`mailto:${contact.email}`}>Correo</a>}
        </>
      }
      tabs={DEAL_DRAWER_TABS}
      activeTab={tab}
      onTabChange={(id) => onTabChange(id as DealDrawerTab)}
    >
      {tab === "resumen" && (
        <DealDetail
          workspaceId={workspaceId}
          deal={deal}
          brand={brand}
          campaign={campaign}
          campaigns={campaigns}
          contact={contact}
          contacts={brandContacts}
          focusOutcome={focusOutcome}
          onOpenTemplate={onOpenTemplate}
          onStageChange={onStageChange}
          reload={reload}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === "timeline" && (
        <DealTimeline workspaceId={workspaceId} deal={deal} data={data} reload={reload} setError={setError} setNotice={setNotice} />
      )}
      {tab === "persona" && (contact ? (
        <PersonDetail
          workspaceId={workspaceId}
          contact={contact}
          data={data}
          deals={data.deals.filter((item) => item.primary_contact_id === contact.id)}
          focusBrandId=""
          reload={reload}
          setError={setError}
          setNotice={setNotice}
          onOpenDeal={onOpenDeal}
        />
      ) : (
        <div className="crm-empty compact">
          <h3>Sin contacto principal</h3>
          <p>Asigna uno en Resumen → Comercial → «Contacto principal» y su ficha 360 vive aquí dentro.</p>
        </div>
      ))}
      {tab === "marca" && (brand ? (
        <BrandDetail
          workspaceId={workspaceId}
          brand={brand}
          contacts={brandContacts}
          deals={data.deals.filter((item) => item.brand_id === brand.id)}
          designs={data.designs.filter((item) => item.brand_id === brand.id)}
          onOpenTemplate={onOpenTemplate}
          reload={reload}
          setError={setError}
          setNotice={setNotice}
          onOpenDeal={onOpenDeal}
        />
      ) : (
        <div className="crm-empty compact"><h3>Marca no encontrada</h3><p>El deal apunta a una marca que ya no existe en este workspace.</p></div>
      ))}
    </InspectorDrawer>
  );
}

/**
 * Timeline de UNA negociación (v48): touchpoints con deal_id, chips por
 * stakeholder — la misma negociación vista por persona, porque el influencer
 * no cuenta la misma historia que el decisor — y registro manual contextual.
 * Sin la migración v48 el API degrada a nivel marca: el timeline sigue vivo,
 * solo menos preciso, hasta correr el SQL.
 */
function DealTimeline({
  workspaceId,
  deal,
  data,
  reload,
  setError,
  setNotice,
}: {
  workspaceId: string;
  deal: Deal;
  data: CrmData;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [interactions, setInteractions] = useState<Interaction[] | null>(null);
  const [personFilter, setPersonFilter] = useState("");
  const [logType, setLogType] = useState("reunion");
  const [logContactId, setLogContactId] = useState(deal.primary_contact_id || "");
  const [logNotes, setLogNotes] = useState("");
  const [logging, setLogging] = useState(false);
  // Se incrementa tras cada registro: refresca el GET sin depender de load().
  const [version, setVersion] = useState(0);

  const brandContacts = data.contacts.filter((item) => item.brand_id === deal.brand_id);
  const contactById = new Map(data.contacts.map((item): [string, Contact] => [item.id, item]));

  useEffect(() => {
    let cancelled = false;
    setInteractions(null);
    setPersonFilter("");
    setLogContactId(deal.primary_contact_id || "");
    const params = new URLSearchParams({ brandId: deal.brand_id, dealId: deal.id });
    crmFetch<{ data: Interaction[] }>(`/api/workspaces/${workspaceId}/interactions?${params.toString()}`)
      .then((result) => { if (!cancelled) setInteractions(result.data || []); })
      .catch(() => { if (!cancelled) setInteractions([]); });
    return () => { cancelled = true; };
  }, [deal.brand_id, deal.id, deal.primary_contact_id, workspaceId, version]);

  // Stakeholders con al menos un touchpoint en ESTA negociación → chips.
  const people = new Map<string, string>();
  for (const interaction of interactions || []) {
    if (interaction.contact_id && !people.has(interaction.contact_id)) {
      const person = contactById.get(interaction.contact_id);
      people.set(interaction.contact_id, person ? `${person.first_name} ${person.last_name || ""}`.trim() : "Persona");
    }
  }
  const visible = (interactions || []).filter((item) => !personFilter || item.contact_id === personFilter);

  const log = async (event: FormEvent) => {
    event.preventDefault();
    setLogging(true);
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/interactions`, {
        method: "POST",
        body: JSON.stringify({
          brandId: deal.brand_id,
          contactId: logContactId || null,
          dealId: deal.id,
          interactionType: logType,
          notes: logNotes || undefined,
        }),
      });
      setLogNotes("");
      setNotice("Interacción registrada en la negociación.");
      setVersion((current) => current + 1);
      await reload();
    } catch (cause: any) { setError(cause.message); }
    finally { setLogging(false); }
  };

  return (
    <div className="crm-deal-timeline">
      <form className="crm-log-form" onSubmit={log} aria-label="Registrar interacción del deal">
        <div className="workspace-form-row">
          <Field label="Tipo">
            <select value={logType} onChange={(event) => setLogType(event.target.value)}>
              {Object.entries(INTERACTION_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
          </Field>
          <Field label="Con quién">
            <select value={logContactId} onChange={(event) => setLogContactId(event.target.value)}>
              <option value="">Sin persona</option>
              {brandContacts.map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notas"><textarea rows={2} value={logNotes} onChange={(event) => setLogNotes(event.target.value)} placeholder="Qué se acordó, objeciones, próximos pasos…" /></Field>
        <button className="workspace-button" disabled={logging}>{logging ? "Registrando…" : "Registrar interacción"}</button>
      </form>
      <section aria-label="Timeline de la negociación">
        <h4>Historia de la negociación <span>{visible.length}</span></h4>
        {people.size > 0 && (
          <div className="crm-person-chips" role="group" aria-label="Filtrar por stakeholder">
            <button type="button" className={personFilter === "" ? "active" : ""} onClick={() => setPersonFilter("")}>Todos</button>
            {[...people.entries()].map(([id, name]) => (
              <button key={id} type="button" className={personFilter === id ? "active" : ""} onClick={() => setPersonFilter(id)}>{name}</button>
            ))}
          </div>
        )}
        {interactions === null ? (
          <p className="workspace-muted">Cargando timeline…</p>
        ) : visible.length ? (
          <ol className="crm-interaction-list">
            {visible.map((interaction) => {
              const meta = interactionMeta(interaction.interaction_type);
              const person = interaction.contact_id ? contactById.get(interaction.contact_id) : null;
              return (
                <li key={interaction.id} className="crm-interaction">
                  <span className="crm-interaction-chip" aria-hidden="true"><CrmIcon name={meta.icon} /></span>
                  <div>
                    <strong>{meta.label}</strong>
                    <small>
                      {new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(interaction.interaction_date))}
                      {person ? ` · ${`${person.first_name} ${person.last_name || ""}`.trim()}` : ""}
                    </small>
                    {interaction.notes && <p>{interaction.notes}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="workspace-muted">Sin interacciones en esta negociación todavía — arrastra la tarjeta a la siguiente etapa o registra el primer touchpoint.</p>
        )}
      </section>
    </div>
  );
}

function AccountsView({
  workspaceId,
  data: rawData,
  selectedBrand,
  setSelectedBrandId,
  onOpenTemplate,
  onOpenDeal,
  reload,
  setError,
  setNotice,
  navTabs,
}: {
  workspaceId: string;
  data: CrmData | null;
  selectedBrand: Brand | null;
  setSelectedBrandId: (id: string) => void;
  onOpenTemplate?: (id: string) => void;
  /** v56: abre la ficha del deal (drawer) desde la lista de la cuenta. */
  onOpenDeal: (dealId: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  navTabs?: ReactNode;
}) {
  // v54.2 (shell-first): con datos vacíos la tarjeta superior carga al toque.
  const data = rawData ?? EMPTY_CRM_DATA;
  const crmLoading = !rawData;
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
  // serif + nav de íconos. v55: la toolbar del kit (búsqueda, dropdowns
  // CrmSelect y alta) vive dentro de la tarjeta de la tabla. El wrapper
  // crm-contacts acota el DS del kit; las clases de tabla se comparten.
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
      </div>
      <section className="crm-table-card" aria-label="Marcas">
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
                <tr><td colSpan={6} className="workspace-muted">{crmLoading ? "Cargando marcas…" : data.brands.length === 0 ? "Aún no hay marcas — agrega la primera con «+ Agregar marca»." : "Ninguna marca coincide con la búsqueda o el filtro."}</td></tr>
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
      {/* v56: la ficha de cuenta en el InspectorDrawer — mismo patrón que la
          ficha de deal y persona. «Selecciona una marca» ya no ocupa media
          pantalla: el click en una fila abre el drawer directo. */}
      {selectedBrand && (
        <InspectorDrawer
          open
          onClose={() => setSelectedBrandId("")}
          ariaLabel={`Ficha de la marca ${selectedBrand.name}`}
          storageKey="crm-brand-drawer-width"
          eyebrow={`Cuenta comercial · ${selectedBrand.relationship_status === "client" ? "Cliente" : "Lead"}`}
          title={selectedBrand.name}
        >
          <BrandDetail
            workspaceId={workspaceId}
            brand={selectedBrand}
            contacts={data.contacts.filter((contact) => contact.brand_id === selectedBrand.id)}
            deals={data.deals.filter((deal) => deal.brand_id === selectedBrand.id)}
            designs={data.designs.filter((design) => design.brand_id === selectedBrand.id)}
            onOpenTemplate={onOpenTemplate}
            onOpenDeal={onOpenDeal}
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
        </InspectorDrawer>
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
  onOpenDeal,
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
  /** v56: abre la ficha del deal (drawer) desde la lista de la cuenta. */
  onOpenDeal?: (dealId: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  children?: React.ReactNode;
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
      <header><div><p className="workspace-eyebrow">Cuenta comercial</p><h3>{brand.name}</h3><p className="workspace-muted">{brand.interaction_count ? `Interacciones de la marca: ${brand.interaction_count} · ` : ""}{lastContactDays === null ? "Sin contacto registrado" : `Último contacto de la marca hace ${lastContactDays} día${lastContactDays === 1 ? "" : "s"}`}</p></div><span className={`crm-health ${computedHealth}`} title={healthIsComputed ? "Salud computada: cliente sin deals abiertos y 30+ días sin contacto pasa a En fuga." : undefined}>{healthLabel(computedHealth, relationshipStatus)}{healthIsComputed ? " (auto)" : ""}</span></header>
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
        <section><h4>Deals <span>{deals.length}</span></h4><div className="crm-compact-list">{deals.map((deal) => (
          <button type="button" key={deal.id} className="crm-compact-deal" onClick={() => onOpenDeal?.(deal.id)} title={onOpenDeal ? "Abrir ficha del deal" : undefined}>
            <strong>{deal.title}</strong>
            <span>{DEAL_STAGES.find((stage) => stage.value === deal.stage)?.label} · {deal.progress.percentage}%</span>
          </button>
        ))}</div></section>
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
 * paginación. La ficha 360 abre en el InspectorDrawer (v56: antes modal).
 */
function ContactsView({
  workspaceId,
  data: rawData,
  initialSelectedContactId,
  focusBrandId,
  onFocusBrand,
  onOpenDeal,
  reload,
  setError,
  setNotice,
  navTabs,
}: {
  workspaceId: string;
  data: CrmData | null;
  /** REQ-029 Item 2: «Ver contacto» desde Captura — la ficha abre al montar. */
  initialSelectedContactId?: string;
  /** v52: marca enfocada en el Embudo — el funnel es por marcas (B2B). */
  focusBrandId: string;
  onFocusBrand: (id: string) => void;
  /** v56: abre la ficha del deal (drawer) desde la lista de la persona. */
  onOpenDeal: (dealId: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  navTabs?: ReactNode;
}) {
  // v54.2 (shell-first): con datos vacíos la tarjeta superior carga al toque.
  const data = rawData ?? EMPTY_CRM_DATA;
  const crmLoading = !rawData;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [selectedContactId, setSelectedContactId] = useState(initialSelectedContactId || "");
  const [showForm, setShowForm] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [csvOpen, setCsvOpen] = useState(false);
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

  const patchStatus = async (contactId: string, status: string) => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice("Estado actualizado.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  // CSV round-trip: export what the filters show; import through the same
  // POST /contacts the form uses — whose brandName auto-creates unknown
  // brands, so a HubSpot export lands with its accounts already assembled.
  const exportCsv = () => {
    downloadCsv(
      `personas-${workspaceId}.csv`,
      ["Nombre", "Apellido", "Email", "Teléfono", "Cargo", "Empresa", "Marca", "Estado", "Etiquetas"],
      visibleContacts.map(c => [
        c.first_name,
        c.last_name || "",
        c.email || "",
        c.phone || "",
        c.job_title || "",
        c.company || "",
        c.brand_name || data.brands.find(b => b.id === c.brand_id)?.name || "",
        c.status || "lead",
        (c.tags || []).join(", "),
      ]),
    );
  };

  const importCsv = async (drafts: Array<Record<string, string>>, _sourceId: ImportSourceId, note: (msg: string) => void) => {
    for (let i = 0; i < drafts.length; i++) {
      const row = drafts[i];
      note(`Importando ${i + 1}/${drafts.length}…`);
      await crmFetch(`/api/workspaces/${workspaceId}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          firstName: row.nombre?.trim(),
          lastName: row.apellido?.trim() || undefined,
          email: row.email?.trim() || undefined,
          phone: row.telefono?.trim() || undefined,
          jobTitle: row.cargo?.trim() || undefined,
          company: row.empresa?.trim() || undefined,
          brandName: row.marca?.trim() || undefined,
          status: "active",
          tags: splitTags(row.etiquetas || ""),
        }),
      });
    }
    await reload();
    setNotice(`Importadas ${drafts.length} personas.`);
  };

  // v50 (DS Diatta): el DS del UI Kit queda acotado a este módulo — las
  // clases de tabla se comparten con la vista Marcas. v55: la tarjeta
  // superior solo presenta (título + nav de íconos); la toolbar y el alta
  // viven dentro de la tarjeta de la tabla, misma receta glass.
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
      </div>
      <section className="crm-table-card" aria-label="Personas">
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
          <button type="button" className="crm-clear-filters" onClick={exportCsv} title="Descargar la tabla como CSV">⇩ CSV</button>
          <button type="button" className="crm-clear-filters" onClick={() => setCsvOpen(true)} title="Importar desde CSV o un export de HubSpot">⇧ Importar</button>
          <button type="button" className="workspace-button crm-toolbar-add" onClick={() => setShowForm((current) => !current)}>{showForm ? "Cerrar formulario" : "+ Agregar persona"}</button>
        </div>
        {csvOpen && (
          <ImportWizardModal
            title="Importar personas (CSV / HubSpot)"
            sources={["csv", "hubspot"]}
            fields={CONTACT_FIELDS}
            onClose={() => setCsvOpen(false)}
            onConfirm={importCsv}
          />
        )}
        {showForm && (
          <NewContactForm workspaceId={workspaceId} data={data} reload={reload} setError={setError} setNotice={setNotice} onCreated={setSelectedContactId} />
        )}
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
                          {/* M-14: nombre sin huecos cuando falta un campo. */}
                          <strong className="crm-entity-name">{[contact.first_name, contact.last_name].filter(Boolean).join(" ")}</strong>
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
                <tr><td colSpan={7} className="workspace-muted">{crmLoading ? "Cargando personas…" : data.contacts.length === 0 ? "Aún no hay personas — agrega la primera con «+ Agregar persona»." : "Nadie coincide con la búsqueda o el filtro."}</td></tr>
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
      {/* v56: la ficha 360 en el InspectorDrawer (antes modal): el tablero
          queda visible detrás y onOpenDeal cruza a la ficha del deal. */}
      {selectedContact && (
        <InspectorDrawer
          open
          onClose={() => setSelectedContactId("")}
          ariaLabel={`Ficha de ${selectedContact.first_name} ${selectedContact.last_name || ""}`.trim()}
          storageKey="crm-person-drawer-width"
          eyebrow={selectedContact.brand_name || data.brands.find((brand) => brand.id === selectedContact.brand_id)?.name || "Sin marca"}
          title={[selectedContact.first_name, selectedContact.last_name].filter(Boolean).join(" ")}
        >
          <PersonDetail
            workspaceId={workspaceId}
            contact={selectedContact}
            data={data}
            deals={data.deals.filter((deal) => deal.primary_contact_id === selectedContact.id)}
            onFocusBrand={onFocusBrand}
            focusBrandId={focusBrandId}
            onOpenDeal={onOpenDeal}
            reload={reload}
            setError={setError}
            setNotice={setNotice}
          />
        </InspectorDrawer>
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

/** REQ-029 Item 2: una conversación de la Bandeja social (social_inbox, v43)
 *  — la misma forma que lee ContentTab; el CRM la usa para capturar. */
type CapturaRow = {
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
  updated_at?: string | null;
};

function capturaStatusLabel(status: string) {
  return status === "nuevo" ? "Nuevo" : status === "respondido" ? "Respondido" : status === "capturado" ? "Capturado" : status;
}

/**
 * REQ-029 Item 2 / REQ-030 Item 4 — vista Captura (pestaña 5 del CRM): la
 * Bandeja social como etapa de captura. Resumen (nuevos · capturados hoy ·
 * respondidos), filtros por plataforma/estado/fecha y por fila: Capturar al
 * CRM (reusa contacto si el autor ya estaba y deja el touchpoint «comentario»
 * en su timeline — Item 3), Responder, Descartar (solo local) y Ver contacto
 * (salta a Personas y abre la ficha). Un solo fetch: sin conexión Zernio la
 * vista se explica — nunca rompe; la Bandeja de Copywriting sigue siendo la
 * fuente de la verdad.
 */
function CapturaView({ workspaceId, navTabs, onOpenContact, setError, setNotice }: {
  workspaceId: string;
  navTabs?: ReactNode;
  onOpenContact: (contactId: string) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [rows, setRows] = useState<CapturaRow[] | null>(null);
  const [rowsError, setRowsError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [replyFor, setReplyFor] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    crmFetch<{ data?: CapturaRow[] }>(`/api/content/integrations/social/zernio/inbox?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((result) => { if (!cancelled) setRows(result.data || []); })
      .catch((cause: any) => { if (!cancelled) { setRows([]); setRowsError(cause.message); } });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const platforms = useMemo(() => [...new Set((rows || []).map((row) => row.platform || "social"))].sort(), [rows]);
  const visibleRows = useMemo(() => (rows || []).filter((row) => {
    if (discarded.includes(row.id)) return false;
    if (platformFilter !== "all" && (row.platform || "social") !== platformFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (dateFilter !== "all") {
      if (!row.occurred_at) return false;
      const days = Math.floor((Date.now() - new Date(row.occurred_at).getTime()) / (24 * 60 * 60 * 1000));
      if (dateFilter === "hoy" && days > 0) return false;
      if (dateFilter === "semana" && days > 7) return false;
    }
    return true;
  }), [discarded, dateFilter, platformFilter, rows, statusFilter]);
  const allRows = rows || [];
  const nuevos = allRows.filter((row) => row.status === "nuevo").length;
  const respondidos = allRows.filter((row) => row.status === "respondido").length;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const capturadosHoy = allRows.filter((row) => row.status === "capturado" && row.updated_at && new Date(row.updated_at) >= todayStart).length;

  const patchRow = (row: CapturaRow) => setRows((current) => (current || []).map((item) => (item.id === row.id ? row : item)));

  const capture = async (row: CapturaRow) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const result = await crmFetch<{ data?: CapturaRow; contact?: { first_name: string }; matched?: boolean; warning?: string | null }>(
        `/api/content/integrations/social/zernio/inbox/${row.id}/capture`,
        { method: "POST", body: JSON.stringify({ workspaceId }) },
      );
      if (result.data) patchRow(result.data);
      if (result.warning) setNotice(result.warning);
      else setNotice(result.matched
        ? `${row.author_name || "El autor"} ya estaba en Personas — reusamos su contacto para esta conversación.`
        : `Contacto capturado: ${result.contact?.first_name || row.author_name || "autor"} — su comentario quedó en su timeline.`);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setBusyId("");
    }
  };

  const sendReply = async (row: CapturaRow) => {
    const content = replyDraft.trim();
    if (!content || busyId) return;
    setBusyId(row.id);
    try {
      const result = await crmFetch<{ data?: CapturaRow }>(
        `/api/content/integrations/social/zernio/inbox/${row.id}/reply`,
        { method: "POST", body: JSON.stringify({ workspaceId, content }) },
      );
      if (result.data) patchRow(result.data);
      setReplyFor("");
      setReplyDraft("");
      setNotice("Respuesta enviada.");
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="crm-contacts">
      <div className="crm-table-card crm-contacts-top">
        <header className="crm-contacts-head">
          <div>
            <h1>Captura</h1>
            <p>La Bandeja social como etapa del CRM: captura al autor en Personas (su comentario viaja a su timeline), responde o salta a la ficha.</p>
          </div>
          {navTabs}
        </header>
      </div>
      <section className="crm-table-card" aria-label="Bandeja social">
        <div className="crm-contacts-toolbar">
          <span className="crm-captura-statusbar" role="status">
            <strong>{nuevos}</strong> nuevos · <strong>{capturadosHoy}</strong> capturados hoy · <strong>{respondidos}</strong> respondidos
          </span>
          <div className="crm-toolbar-push" />
          <CrmSelect label="Plataforma" value={platformFilter} onChange={setPlatformFilter} options={[{ value: "all", label: "Toda plataforma" }, ...platforms.map((platform) => ({ value: platform, label: platform }))]} />
          <CrmSelect label="Estado" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "Todo estado" }, { value: "nuevo", label: "Nuevos" }, { value: "capturado", label: "Capturados" }, { value: "respondido", label: "Respondidos" }]} />
          <CrmSelect label="Fecha" value={dateFilter} onChange={setDateFilter} options={[{ value: "all", label: "Toda fecha" }, { value: "hoy", label: "Últimas 24h" }, { value: "semana", label: "Últimos 7 días" }]} />
        </div>
        {rows === null ? (
          <div className="crm-loading" role="status">Cargando bandeja…</div>
        ) : rowsError ? (
          <p className="workspace-muted" role="status">{rowsError} — conecta Zernio en Copywriting › Bandeja para traer las conversaciones.</p>
        ) : visibleRows.length === 0 ? (
          <p className="workspace-muted">Nada por acá — cuando llegue un comentario o mensaje por Zernio aparece listo para capturar.</p>
        ) : (
          <ul className="crm-captura-list">
            {visibleRows.map((row) => (
              <li key={row.id} className="crm-captura-row">
                <div className="crm-captura-main">
                  <strong>{row.author_name || "Sin nombre"}{row.author_handle ? ` (@${row.author_handle})` : ""}</strong>
                  <small>{[row.platform || "social", row.kind === "comment" ? "comentario" : "mensaje", row.occurred_at ? new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(row.occurred_at)) : null].filter(Boolean).join(" · ")}</small>
                  {row.content && <p>{row.content}</p>}
                </div>
                <div className="crm-captura-side">
                  <span className="crm-chip">{capturaStatusLabel(row.status)}</span>
                  <div className="crm-captura-actions">
                    {row.status === "nuevo" && (
                      <button type="button" disabled={busyId === row.id} onClick={() => void capture(row)}>Capturar al CRM</button>
                    )}
                    {row.crm_contact_id && (
                      <button type="button" onClick={() => row.crm_contact_id && onOpenContact(row.crm_contact_id)}>Ver contacto</button>
                    )}
                    <button type="button" onClick={() => { setReplyFor(replyFor === row.id ? "" : row.id); setReplyDraft(""); }}>Responder</button>
                    <button type="button" title="Solo la esconde de esta lista — la Bandeja de Copywriting sigue siendo la fuente" onClick={() => setDiscarded((current) => [...current, row.id])}>Descartar</button>
                  </div>
                  {replyFor === row.id && (
                    <form className="crm-captura-reply" onSubmit={(event) => { event.preventDefault(); void sendReply(row); }}>
                      <textarea rows={2} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Escribe la respuesta…" aria-label={`Responder a ${row.author_name || "el autor"}`} />
                      <button className="workspace-button" disabled={busyId === row.id || !replyDraft.trim()}>{busyId === row.id ? "Enviando…" : "Enviar"}</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
 * WhatsApp) + resumen (chips e historia de una línea). REQ-029 Item 1: la
 * ficha es una HISTORIA — el timeline protagoniza la columna principal con el
 * composer adentro; Comercial, Embudo personal y Datos quedan colapsables al
 * costado (CrmCollapsible).
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
  onOpenDeal,
}: {
  workspaceId: string;
  contact: Contact;
  data: CrmData;
  deals: Deal[];
  focusBrandId: string;
  /** v56: opcional — fuera de la vista con embudo (drawer del deal) no se
   *  muestra el atajo «Ver en embudo» porque no tiene a dónde saltar. */
  onFocusBrand?: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  /** v56: abre la ficha de un deal donde esta persona es contacto principal. */
  onOpenDeal?: (dealId: string) => void;
}) {
  const [jobTitle, setJobTitle] = useState(contact.job_title || "");
  const [email, setEmail] = useState(contact.email || "");
  const [phone, setPhone] = useState(contact.phone || "");
  const [status, setStatus] = useState(contact.status || "lead");
  const [notes, setNotes] = useState(contact.notes || "");
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  // REQ-029 Item 1: «Mostrar más» — el timeline abre con los 15 últimos.
  const [visibleCount, setVisibleCount] = useState(15);
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
    setVisibleCount(15); // nueva persona: el timeline vuelve a empezar colapsado
    crmFetch<{ data: Interaction[] }>(`/api/workspaces/${workspaceId}/interactions?contactId=${contact.id}`)
      .then((result) => { if (!cancelled) setInteractions(result.data || []); })
      .catch(() => { /* v45 pending */ });
    return () => { cancelled = true; };
  }, [contact.id, workspaceId]);

  const brand = data.brands.find((brand) => brand.id === contact.brand_id);
  const wa = whatsappLink(contact.phone);
  const stage = personalFunnelStage(deals, interactions);
  const brandHealth = brand?.computed_health || brand?.account_health;
  // REQ-030 Item 1 (CRM-002): «último contacto» es de la PERSONA — el más
  // nuevo de SU timeline. El de la marca vive solo en la ficha de marca.
  const lastContactDays = daysSincePerson(personLastContact(interactions));
  // Una sola fuente de verdad: la historia y los contadores del header se
  // construyen con la MISMA lista `interactions` que pinta el timeline.
  const personStory = buildPersonStory({
    interactions,
    dealsCount: deals.length,
    brandName: brand?.name || contact.brand_name,
    capturedFromInbox: (contact.tags || []).some((tag) => tag.trim().toLocaleLowerCase() === "zernio"),
  });

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
    // REQ-030 Item 2 (CRM-001): nunca un submit mudo — funciona también para
    // personas sin marca (brandId null, requiere supabase_migrations_v58.sql)
    // y cualquier fallo sube con su mensaje.
    if (logging) return;
    setLogging(true);
    try {
      const result = await crmFetch<{ data?: Interaction }>(`/api/workspaces/${workspaceId}/interactions`, {
        method: "POST",
        body: JSON.stringify({
          brandId: contact.brand_id ?? null,
          contactId: contact.id,
          interactionType: logType,
          notes: logNotes || undefined,
        }),
      });
      // Timeline optimista: la interacción aparece de inmediato (y el reload
      // la confirma con el server como fuente).
      if (result.data) setInteractions((current) => [result.data as Interaction, ...current]);
      setLogNotes("");
      setNotice(brand
        ? "Interacción registrada — last_contacted_at de la marca quedó actualizado."
        : "Interacción registrada en el timeline de la persona (sin marca).");
      await reload();
    } catch (cause: any) {
      setError(`No se pudo registrar la interacción: ${cause.message}`);
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
            {/* M-14: fullName ya viene recortado y sin null (L. arriba). */}
            <h3>{fullName}</h3>
            <p className="workspace-muted">{[contact.job_title, contact.company].filter(Boolean).join(" · ") || "Sin cargo registrado"}</p>
          </div>
        </div>
        {/* REQ-029 Item 1: header-resumen — chips + historia autogenerada,
            lo primero que se lee. Mismos datos que el timeline (CRM-002). */}
        <div className="crm-person-summary">
          <div className="crm-chip-row">
            <span className="crm-chip">{contactStatusLabel(status)}</span>
            <span className="crm-chip">{personOriginLabel(contact.tags)}</span>
            <span className="crm-chip">{lastContactDays === null ? "Sin interacciones" : `Última interacción hace ${lastContactDays} día${lastContactDays === 1 ? "" : "s"}`}</span>
          </div>
          <p className="crm-story-line">{personStory}</p>
        </div>
        <div className="crm-person-header-actions">
          {/* v52: el embudo es por marcas — el foco salta a la marca de la persona. */}
          {contact.brand_id && onFocusBrand && (
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
      {/* REQ-029 Item 1: ficha-historia — el timeline es el protagonista
          (columna principal, composer adentro arriba) y lo comercial queda
          colapsable al costado. */}
      <div className="crm-person-layout">
        <div className="crm-person-main">
          <section aria-label="Timeline de interacciones">
            <h4>Timeline comercial <span>{interactions.length}</span></h4>
            {/* Composer DENTRO del timeline: registrar es el primer acto.
                CRM-001: sigue visible siempre; sin marca, el aviso queda. */}
            <form className="crm-log-form crm-timeline-composer" onSubmit={logInteraction} aria-label="Registrar interacción">
              {!brand && (
                <p className="workspace-muted">Esta persona no tiene marca — la interacción queda registrada en su timeline.</p>
              )}
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
            {interactions.length ? (
              <>
                <ol className="crm-interaction-list">
                  {interactions.slice(0, visibleCount).map((interaction) => {
                    const meta = interactionMeta(interaction.interaction_type);
                    // REQ-029 Items 1/3: cada entrada enlaza a su origen —
                    // permalink a la red o salto a la vista Captura.
                    const origin = interactionOriginLink(interaction);
                    return (
                      <li key={interaction.id} className="crm-interaction">
                        <span className="crm-interaction-chip" aria-hidden="true"><CrmIcon name={meta.icon} /></span>
                        <div>
                          <strong>{meta.label}</strong>
                          <small>{new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(interaction.interaction_date))}</small>
                          {interaction.notes && <p>{interaction.notes}</p>}
                          {origin && <a className="crm-interaction-origin" href={origin.href}>{origin.label}</a>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {interactions.length > visibleCount && (
                  <button type="button" className="crm-show-more" onClick={() => setVisibleCount((count) => count + 15)}>
                    Mostrar más ({interactions.length - visibleCount})
                  </button>
                )}
              </>
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
                    <button type="button" key={deal.id} className="crm-compact-deal" onClick={() => onOpenDeal?.(deal.id)} title={onOpenDeal ? "Abrir ficha del deal" : undefined}>
                      <strong>{deal.title}</strong>
                      <span>{dealBrand?.name || "Marca"} · {DEAL_STAGES.find((item) => item.value === deal.stage)?.label || deal.stage} · {Number(deal.value || 0) > 0 ? money(Number(deal.final_value ?? deal.value), deal.currency) : "Sin valor"} · {deal.progress.percentage}%</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="workspace-muted">Ninguno todavía — asígnale un deal desde «Ventas» (campo Contacto principal) para que esta persona cuente en el embudo.</p>
            )}
          </section>
        </div>
        {/* key={contact.id}: los colapsables vuelven a su default por persona. */}
        <aside className="crm-person-side" key={contact.id}>
          <CrmCollapsible label="Comercial" defaultOpen={Boolean(brand)}>
            {brand ? (
              <dl className="crm-fact-list">
                <div><dt>Relación</dt><dd>{brand.relationship_status === "client" ? "Cliente" : "Lead"}</dd></div>
                <div>
                  <dt>Salud {brandHealth !== brand.account_health ? "(computada)" : ""}</dt>
                  <dd><span className={`crm-health ${brandHealth}`}>{healthLabel(brandHealth || "active", brand.relationship_status)}</span></dd>
                </div>
                <div><dt>Prioridad</dt><dd>{brand.crm_priority === "low" ? "Baja" : brand.crm_priority === "high" ? "Alta" : brand.crm_priority === "urgent" ? "Urgente" : "Media"}</dd></div>
                {/* CRM-002: persona ≠ marca — los dos datos de abajo son SIEMPRE
                    de la persona (su timeline), etiquetados como tales. */}
                <div><dt>Último contacto (de {fullName})</dt><dd>{lastContactDays === null ? "Sin registro" : `Hace ${lastContactDays} día${lastContactDays === 1 ? "" : "s"}`}</dd></div>
                <div><dt>Interacciones (de {fullName})</dt><dd>{interactions.length}</dd></div>
              </dl>
            ) : (
              <p className="workspace-muted">Esta persona no tiene marca asignada — asígnale una para ver su ficha comercial.</p>
            )}
          </CrmCollapsible>
          <CrmCollapsible label="Embudo personal" defaultOpen={stage >= 0}>
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
          </CrmCollapsible>
          <CrmCollapsible label="Datos de la persona" defaultOpen={Boolean(contact.job_title || contact.email || contact.phone || contact.notes)}>
            <form className="crm-person-form" onSubmit={save}>
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
          </CrmCollapsible>
        </aside>
      </div>
    </section>
  );
}

const FUNNEL_BRAND_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb923c", "#4ade80", "#22d3ee", "#f87171", "#e879f9"];

/**
 * Vista embudo (pestaña 4) — el punto de vista de MARKETING del CRM: cómo baja
 * cada marca por las etapas, de Discovery a Entregado (Ventas es el punto de
 * vista comercial: negocia deal por deal). v52: B2B puro — no hay cotización
 * sin marca, así que la unidad es siempre el deal desglosado por marca y el
 * switch «Por personas» quedó fuera. Anatomía: tarjeta superior (título serif
 * + nav de íconos); el simulador concentra la fila de chips de foco — capas
 * trapecio con la rampa beige de la marca, y cada capa abre el panel derecho
 * (peek) con el detalle de su etapa. El desglose por barras conserva su
 * detalle inline; métricas al pie. «Perdido» queda fuera del embudo.
 */
function FunnelView({ data: rawData, navTabs, focusBrandId, onFocusBrand, onClearFocus }: { data: CrmData | null; navTabs?: ReactNode; focusBrandId: string; onFocusBrand: (brandId: string) => void; onClearFocus: () => void }) {
  // v54.2 (shell-first): con datos vacíos la tarjeta superior carga al toque.
  const data = rawData ?? EMPTY_CRM_DATA;
  const crmLoading = !rawData;
  const [openStage, setOpenStage] = useState<DealStage | null>("discovery");
  // v57: el click en una capa del SIMULADOR abre el panel derecho con el
  // detalle de la etapa — la misma dinámica Notion del resto de la app. El
  // desglose por barras sigue usando openStage (detalle inline).
  const [peekStage, setPeekStage] = useState<DealStage | null>(null);
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
  const peekStageRow = peekStage ? funnel.rows.find((row) => row.stage === peekStage) || null : null;
  const contactById = new Map(data.contacts.map((contact): [string, Contact] => [contact.id, contact]));
  // Foco de marca (v52): resalta sus deals en el desglose — el embudo siempre
  // muestra el volumen completo, el foco no filtra.
  const focusedBrand = focusBrandId ? data.brands.find((brand) => brand.id === focusBrandId) || null : null;
  const unitNoun = "deal";
  const unitPlural = `${unitNoun}s`;
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  // Simulador: capas trapecio — el ancho baja lineal de 100% a 38% para que la
  // silueta sea de embudo real y la rampa beige (FUNNEL_LAYER_SKINS) oscurezca
  // hacia el fondo de la pirámide. Cada capa abre el panel derecho (peek).
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
      </div>
      {crmLoading ? (
        <div className="crm-loading" role="status">Cargando embudo…</div>
      ) : (<>
      <section className="crm-table-card crm-funnel-sim" aria-label="Simulador del embudo">
        <div className="crm-contacts-toolbar">
          <div className="crm-person-chips" role="group" aria-label="Enfocar una marca del embudo">
            <button type="button" className={`crm-person-chip${focusBrandId ? "" : " active"}`} aria-pressed={!focusBrandId} onClick={onClearFocus}>Todas las marcas</button>
            {[...legendBrands.entries()].map(([brandId, name]) => (
              <button key={brandId} type="button" className={`crm-person-chip${focusBrandId === brandId ? " active" : ""}`} aria-pressed={focusBrandId === brandId} onClick={() => onFocusBrand(focusBrandId === brandId ? "" : brandId)}>
                <i style={{ background: brandColors.get(brandId) }} aria-hidden="true" />{name}
              </button>
            ))}
          </div>
          <span className="crm-funnel-status">{`${data.deals.length} deals · ${money(pipelineValue)} en pipeline · ${data.brands.length} marca${data.brands.length === 1 ? "" : "s"}`}</span>
        </div>
        {focusedBrand && (
          <p className="crm-focus-banner" role="status">
            <span>Foco en <strong>{focusedBrand.name}</strong> — sus deals se resaltan en el desglose por etapa.</span>
            <button type="button" className="workspace-link" onClick={onClearFocus}>Quitar foco</button>
          </p>
        )}
        <div className="crm-funnel-sim-head">
          <h2>Simulador del embudo</h2>
          <p>{funnel.rows.length} etapas · de {funnel.rows[0].count} deals en Discovery a {funnel.rows[funnel.rows.length - 1].count} en Entregado · conversión total {funnel.endToEnd === null ? "—" : pct(funnel.endToEnd)}</p>
        </div>
        <div className="crm-funnel-sim-chart">
          {funnel.rows.map((row, index) => {
            const open = peekStage === row.stage;
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
                  aria-haspopup="dialog"
                  title={`${row.label}: ${row.count} ${row.count === 1 ? unitNoun : unitPlural}${row.conversionFromPrev === null || !prevLabel ? "" : ` · ${pct(row.conversionFromPrev)} desde ${prevLabel}`}`}
                  onClick={() => setPeekStage(row.stage)}
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
      </>)}

      {/* El panel derecho del simulador: una capa, todo su detalle — count,
          conversión y los deals que la componen (la misma lista del detalle
          inline del desglose, ahora donde el click la espera). */}
      <PeekPanel open={!!peekStageRow} onClose={() => setPeekStage(null)} label="Detalle de la etapa">
        {peekStageRow && (() => (<>
          <PeekHead label="Etapa del embudo" onClose={() => setPeekStage(null)} />
          <div style={{ padding: "12px 18px 26px", display: "grid", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="crm-funnel-dot" style={{ background: FUNNEL_STAGE_DOTS[peekStageRow.stage], width: 10, height: 10, flexShrink: 0 }} aria-hidden="true" />
              <div className="peek-title" style={{ flex: 1 }}>{peekStageRow.label}</div>
            </div>
            <div style={{ display: "grid", gap: 2, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
              <div className="peek-prop-row"><span className="peek-prop-label">Deals</span><span style={{ fontSize: 12.5 }}>{peekStageRow.count}</span></div>
              <div className="peek-prop-row"><span className="peek-prop-label">Conversión</span><span style={{ fontSize: 12.5 }}>
                {peekStageRow.conversionFromPrev === null ? "Entrada al embudo" : `↓ ${pct(peekStageRow.conversionFromPrev)} desde la etapa anterior`}
              </span></div>
              <div className="peek-prop-row" style={{ alignItems: "start" }}>
                <span className="peek-prop-label" style={{ paddingTop: 2 }}>Descripción</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{STAGE_DESCRIPTIONS[peekStageRow.stage]}</span>
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Deals en esta etapa</div>
              {peekStageRow.deals.length ? (
                <div className="crm-compact-list">
                  {peekStageRow.deals.map((deal) => {
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
          </div>
        </>))()}
      </PeekPanel>
    </div>
  );
}
