import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { ALL_DEAL_STAGES as DEAL_STAGES, buildFunnel, contactName, type DealStage, type FunnelMode } from "../lib/crmFunnel";
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
type AccountFilter = "all" | "lead" | "client" | "at_risk" | "churned";
/** The four CRM views: Ventas kanban, Personas table, Marcas accounts, Embudo. */
type CrmView = "pipeline" | "personas" | "accounts" | "embudo";

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
  primer_contacto: { label: "Primer contacto", icon: "👋" },
  reunion: { label: "Reunión", icon: "🤝" },
  llamada: { label: "Llamada", icon: "📞" },
  email: { label: "Correo", icon: "✉️" },
  whatsapp: { label: "WhatsApp", icon: "💬" },
  propuesta_enviada: { label: "Propuesta enviada", icon: "📄" },
  revision: { label: "Revisión", icon: "🔁" },
  aprobacion: { label: "Aprobación", icon: "✅" },
  publicacion: { label: "Publicación", icon: "🚀" },
  pago: { label: "Pago", icon: "💰" },
  follow_up: { label: "Seguimiento", icon: "🔔" },
  objecion: { label: "Objeción", icon: "⚠️" },
  otro: { label: "Otro", icon: "📌" },
};

function interactionMeta(type: string) {
  return INTERACTION_META[type] || { label: type, icon: "📌" };
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
}) {
  const [data, setData] = useState<CrmData | null>(null);
  const [ownView, setView] = useState<CrmView>("pipeline");
  const view = controlledView ?? ownView;
  const [loading, setLoading] = useState(true);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [showDealForm, setShowDealForm] = useState(false);
  /** v45 (DIATTA): persona enfocada que cruza vistas — se marca en Personas
   *  y el embudo se filtra a sus deals con un banner visible. */
  const [focusContactId, setFocusContactId] = useState("");

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
      <div className="crm-toolbar">
        {!controlledView && (
          <div className="crm-view-switch" role="group" aria-label="Vista del CRM">
            <button type="button" className={view === "pipeline" ? "active" : ""} aria-pressed={view === "pipeline"} onClick={() => setView("pipeline")}>Ventas</button>
            <button type="button" className={view === "personas" ? "active" : ""} aria-pressed={view === "personas"} onClick={() => setView("personas")}>Personas</button>
            <button type="button" className={view === "accounts" ? "active" : ""} aria-pressed={view === "accounts"} onClick={() => setView("accounts")}>Marcas</button>
            <button type="button" className={view === "embudo" ? "active" : ""} aria-pressed={view === "embudo"} onClick={() => setView("embudo")}>Embudo</button>
          </div>
        )}
        {view === "pipeline" && <button type="button" className="workspace-button" onClick={() => setShowDealForm((current) => !current)}>{showDealForm ? "Cerrar formulario" : "Nuevo deal"}</button>}
      </div>

      {view === "pipeline" ? (
        <>
          <CrmSummary data={data} />
          {showDealForm && <NewDealForm workspaceId={workspaceId} data={data} onCreated={async () => { setShowDealForm(false); setNotice("Deal creado con sus entregables."); await load(); }} setError={setError} />}
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
        </>
      ) : view === "personas" ? (
        <ContactsView
          workspaceId={workspaceId}
          data={data}
          focusContactId={focusContactId}
          onFocusContact={setFocusContactId}
          reload={load}
          setError={setError}
          setNotice={setNotice}
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
        />
      ) : (
        <FunnelView
          data={data}
          focusContactId={focusContactId}
          onClearFocus={() => setFocusContactId("")}
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
              <span>❌ Perdido — {deal.lost_reason ? <>motivo: «{deal.lost_reason}»</> : "sin motivo registrado"}</span>
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
              <span>✅ Entregado — valor final: <strong>{money(Number(deal.final_value ?? deal.value ?? 0), deal.currency)}</strong>{deal.final_value != null && deal.value != null && Number(deal.final_value) !== Number(deal.value) ? ` (estimado ${money(Number(deal.value), deal.currency)})` : ""}</span>
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
}: {
  workspaceId: string;
  data: CrmData;
  selectedBrand: Brand | null;
  setSelectedBrandId: (id: string) => void;
  onOpenTemplate?: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [search, setSearch] = useState("");
  const [brandName, setBrandName] = useState("");
  const [relationshipStatus, setRelationshipStatus] = useState<"lead" | "client">("lead");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const visibleBrands = useMemo(() => data.brands.filter((brand) => {
    if (search && !brand.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return false;
    if (filter === "lead" || filter === "client") return brand.relationship_status === filter;
    if (filter === "at_risk" || filter === "churned") return brand.account_health === filter;
    return true;
  }), [data.brands, filter, search]);

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

  return (
    <>
      <div className="crm-account-tools">
        <input type="search" aria-label="Buscar marcas" placeholder="Buscar marcas…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="crm-filter-group" role="group" aria-label="Filtrar marcas">
          {([
            ["all", "Todas"],
            ["lead", "Leads"],
            ["client", "Clientes"],
            ["at_risk", "En fuga"],
            ["churned", "Perdidas"],
          ] as Array<[AccountFilter, string]>).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
      </div>
      <div className="crm-summary" aria-label="Resumen de marcas">
        <article><strong>{data.brands.length}</strong><span>Marcas</span></article>
        <article><strong>{data.brands.filter((brand) => brand.relationship_status === "client").length}</strong><span>Clientes</span></article>
        <article><strong>{data.summary.atRiskAccounts ?? data.brands.filter((brand) => (brand.computed_health || brand.account_health) === "at_risk").length}</strong><span>En fuga (computada)</span></article>
        <article><strong>{data.summary.interactions ?? 0}</strong><span>Interacciones</span></article>
      </div>
      <div className="crm-accounts-layout">
        <section className="crm-account-list" aria-label="Marcas">
          {visibleBrands.map((brand) => (
            <button type="button" key={brand.id} className={selectedBrand?.id === brand.id ? "selected" : ""} aria-pressed={selectedBrand?.id === brand.id} onClick={() => setSelectedBrandId(brand.id)}>
              <span className="crm-account-avatar" aria-hidden="true">{brand.name.charAt(0).toLocaleUpperCase()}</span>
              <span><strong>{brand.name}</strong>{brand.has_design_system === false && <small style={{ color: "#fca5a5" }}> · ⚠️ sin Design System</small>}<small>{brand.relationship_status === "lead" ? "Lead" : brand.account_health === "at_risk" ? "Cliente en fuga" : brand.account_health === "churned" ? "Cliente perdido" : "Cliente"} · {brand.design_count} diseños</small></span>
            </button>
          ))}
          {visibleBrands.length === 0 && <p className="workspace-muted">No hay marcas con este filtro.</p>}
          <details className="crm-inline-form">
            <summary>+ Nueva marca</summary>
            <form onSubmit={createBrand}>
              <Field label="Nombre"><input value={brandName} onChange={(event) => setBrandName(event.target.value)} required /></Field>
              <Field label="Relación"><select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value as "lead" | "client")}><option value="lead">Lead</option><option value="client">Cliente</option></select></Field>
              <button className="workspace-button">Crear</button>
            </form>
          </details>
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
        ) : <div className="crm-empty"><h3>Selecciona una marca</h3><p>Aquí verás personas, deals, diseños y oportunidades.</p></div>}
      </div>
    </>
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
          <span style={{ flex: 1, minWidth: 200 }}>⚠️ Esta marca aún no tiene archivo Design System — tu IA no tendrá de dónde sacar estilo al diseñar para ella.</span>
          <button type="button" className="workspace-button" onClick={createDesignSystem} disabled={dsBusy}>{dsBusy ? "Creando…" : "Crear Design System"}</button>
        </div>
      ) : brand.design_system_template_id ? (
        <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>🎨 Design System de la marca listo — todo lo que extraigas va ahí.</span>
          <button type="button" className="workspace-button" onClick={() => onOpenTemplate?.(brand.design_system_template_id!)}>Abrir archivo</button>
        </div>
      ) : null}
      <form className="crm-brand-settings" onSubmit={save}>
        <Field label="Relación"><select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value as Brand["relationship_status"])}><option value="lead">Lead</option><option value="client">Cliente</option></select></Field>
        <Field label="Salud"><select value={healthMode} onChange={(event) => setHealthMode(event.target.value as "auto" | Brand["account_health"])}><option value="auto">🤖 Auto (recomendado)</option><option value="active">Activa</option><option value="at_risk">En fuga</option><option value="churned">Perdida</option></select></Field>
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
 * Vista tabla de personas (pestaña 2), layout DIATTA: tabla rica full-width —
 * avatar, marca con salud computada, estado editable inline, valor comercial
 * por persona, señal de atención, WhatsApp/embudo por fila, paginación — y la
 * ficha 360 abre debajo al hacer click en una fila.
 */
function ContactsView({
  workspaceId,
  data,
  focusContactId,
  onFocusContact,
  reload,
  setError,
  setNotice,
}: {
  workspaceId: string;
  data: CrmData;
  focusContactId: string;
  onFocusContact: (id: string) => void;
  reload: () => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const query = search.trim().toLocaleLowerCase();
  const visibleContacts = useMemo(() => data.contacts.filter((contact) => {
    if (!query) return true;
    const brandName = data.brands.find((brand) => brand.id === contact.brand_id)?.name;
    return [contact.first_name, contact.last_name, contact.email, contact.phone, contact.job_title, contact.brand_name, brandName]
      .some((value) => (value || "").toLocaleLowerCase().includes(query));
  }), [data.brands, data.contacts, query]);
  const pageCount = Math.max(1, Math.ceil(visibleContacts.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pagedContacts = visibleContacts.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selectedContact = data.contacts.find((contact) => contact.id === selectedContactId) || null;

  // KPI de la vista (F6): total, en deals, valor abierto y quién necesita atención.
  const inDeals = data.contacts.filter((contact) => (contact.dealStats?.dealCount || 0) > 0).length;
  const openValueTotal = data.contacts.reduce((total, contact) => total + (contact.dealStats?.openValue || 0), 0);
  const attentionCount = data.contacts.filter((contact) => contactNeedsAttention(data.brands.find((brand) => brand.id === contact.brand_id))).length;

  const patchStatus = async (contactId: string, status: string) => {
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice("Estado actualizado.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  return (
    <>
      <div className="crm-summary" aria-label="Resumen de personas">
        <article><strong>{data.contacts.length}</strong><span>Personas</span></article>
        <article><strong>{inDeals}</strong><span>En deals</span></article>
        <article><strong>{money(openValueTotal)}</strong><span>Valor abierto</span></article>
        <article><strong>{attentionCount}</strong><span>Necesitan atención</span></article>
      </div>
      <div className="crm-account-tools">
        <input type="search" aria-label="Buscar personas" placeholder="Buscar por nombre, marca, cargo o correo…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
        <span className="workspace-muted">{visibleContacts.length} de {data.contacts.length}</span>
      </div>
      <section className="crm-people-panel">
        <div className="crm-people-scroll">
          <table className="crm-people-table">
            <thead>
              <tr>
                <th scope="col">Persona</th>
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
                return (
                  <tr
                    key={contact.id}
                    className={`${contact.id === selectedContactId ? "selected" : ""}${attention ? " needs-attention" : ""}`}
                    onClick={() => setSelectedContactId(contact.id)}
                  >
                    <td>
                      <div className="crm-person-cell">
                        <span className="crm-person-avatar" aria-hidden="true">{initials(`${contact.first_name} ${contact.last_name || ""}`)}</span>
                        <button type="button" className="crm-contact-pick" aria-pressed={contact.id === selectedContactId} onClick={(event) => { event.stopPropagation(); setSelectedContactId(contact.id); }}>
                          <strong>{contact.first_name} {contact.last_name}</strong>
                          <small>{contact.job_title || "Sin cargo"}</small>
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className="crm-brand-cell">
                        {brand?.name || contact.brand_name || "Sin marca"}
                        {brand && <small className={`crm-dot-health ${brand.computed_health || brand.account_health}`} title={healthLabel(brand.computed_health || brand.account_health, brand.relationship_status)} />}
                      </span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select
                        className="crm-row-select"
                        aria-label={`Estado de ${contact.first_name}`}
                        value={contact.status || "lead"}
                        onChange={(event) => void patchStatus(contact.id, event.target.value)}
                      >
                        <option value="lead">Lead</option>
                        <option value="active">Activa</option>
                        <option value="inactive">Inactiva</option>
                      </select>
                    </td>
                    <td>
                      <span className="crm-value-cell" title={stats && stats.wonValue > 0 ? `Ganado: ${money(stats.wonValue, stats.currency || "USD")}` : undefined}>
                        <strong>{stats?.dealCount || 0}</strong>
                        {stats && stats.openValue > 0 ? ` · ${money(stats.openValue, stats.currency || "USD")}` : ""}
                      </span>
                    </td>
                    <td>
                      {attention ? (
                        <span className="crm-attention-flag">⚠️ {brand?.computed_health === "at_risk" ? "En fuga" : days === null ? "Sin contacto" : `${days}d sin contacto`}</span>
                      ) : (
                        <span className="crm-ok-flag">Al día</span>
                      )}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="crm-row-actions">
                        {wa && <a className="crm-wa-link" href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp de ${contact.first_name}`}>WhatsApp</a>}
                        <button
                          type="button"
                          className={`workspace-link${focusContactId === contact.id ? " active" : ""}`}
                          aria-pressed={focusContactId === contact.id}
                          onClick={() => onFocusContact(focusContactId === contact.id ? "" : contact.id)}
                        >
                          {focusContactId === contact.id ? "Quitar del embudo" : "Ver en embudo"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pagedContacts.length === 0 && (
                <tr><td colSpan={6} className="workspace-muted">{data.contacts.length === 0 ? "Aún no hay personas — agrega la primera aquí abajo." : "Nadie coincide con la búsqueda."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visibleContacts.length > 0 && (
          <div className="crm-pagination">
            <label className="crm-page-size">
              Filas
              <select value={pageSize} aria-label="Filas por página" onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button type="button" className="workspace-button secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹ Anterior</button>
            <span className="workspace-muted">Página {safePage + 1} de {pageCount}</span>
            <button type="button" className="workspace-button secondary" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Siguiente ›</button>
          </div>
        )}
        <NewContactForm workspaceId={workspaceId} data={data} reload={reload} setError={setError} setNotice={setNotice} onCreated={setSelectedContactId} />
      </section>
      {selectedContact ? (
        <PersonDetail
          workspaceId={workspaceId}
          contact={selectedContact}
          data={data}
          deals={data.deals.filter((deal) => deal.primary_contact_id === selectedContact.id)}
          onFocusContact={onFocusContact}
          focusContactId={focusContactId}
          reload={reload}
          setError={setError}
          setNotice={setNotice}
        />
      ) : (
        <div className="crm-empty">
          <h3>Selecciona una persona</h3>
          <p>Click en una fila para abrir su ficha 360: contacto directo, timeline comercial, embudo personal y deals donde es el contacto principal.</p>
        </div>
      )}
    </>
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
    <details className="crm-inline-form">
      <summary>+ Nueva persona</summary>
      <form onSubmit={create}>
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
        <button className="workspace-button">Agregar</button>
      </form>
    </details>
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
  focusContactId,
  onFocusContact,
  reload,
  setError,
  setNotice,
}: {
  workspaceId: string;
  contact: Contact;
  data: CrmData;
  deals: Deal[];
  focusContactId: string;
  onFocusContact: (id: string) => void;
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
          <button
            type="button"
            className={`workspace-button secondary${focusContactId === contact.id ? " active" : ""}`}
            aria-pressed={focusContactId === contact.id}
            onClick={() => onFocusContact(focusContactId === contact.id ? "" : contact.id)}
          >
            {focusContactId === contact.id ? "Quitar del embudo" : "Ver en embudo"}
          </button>
          <span className={`crm-health ${status === "inactive" ? "at_risk" : "active"}`}>{contactStatusLabel(status)}</span>
        </div>
      </header>
      {(contact.email || contact.phone) && (
        <div className="crm-person-links">
          {contact.email && <a href={`mailto:${contact.email}`}>✉️ {contact.email}</a>}
          {contact.phone && <a href={`tel:${contact.phone}`}>📞 {contact.phone}</a>}
          {wa && <a className="crm-wa-link" href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
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
                        <option key={value} value={value}>{meta.icon} {meta.label}</option>
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
                      <span className="crm-interaction-chip" aria-hidden="true">{meta.icon}</span>
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

/**
 * Vista embudo (pestaña 4): las mismas etapas del kanban, apiladas. El switch
 * cambia la unidad que fluye — deals por marca (barras segmentadas) o personas
 * distintas (contacto principal de cada deal). «Perdido» queda fuera del
 * embudo y se muestra aparte como fuga.
 */
function FunnelView({ data, focusContactId, onClearFocus }: { data: CrmData; focusContactId: string; onClearFocus: () => void }) {
  const [mode, setMode] = useState<FunnelMode>("brands");
  const [openStage, setOpenStage] = useState<DealStage | null>("discovery");
  // Foco de persona (DIATTA): el embudo se filtra a los deals de ESA persona
  // y un banner visible anuncia el filtro — mismo criterio cruzando vistas.
  const focusContact = focusContactId ? data.contacts.find((contact) => contact.id === focusContactId) || null : null;
  const effectiveDeals = useMemo(
    () => (focusContactId ? data.deals.filter((deal) => deal.primary_contact_id === focusContactId) : data.deals),
    [data.deals, focusContactId],
  );
  const funnel = useMemo(() => buildFunnel(effectiveDeals, data.brands, data.contacts, mode), [effectiveDeals, data, mode]);
  const maxCount = Math.max(1, ...funnel.rows.map((row) => row.count));
  const openDeals = effectiveDeals.filter((deal) => deal.stage !== "lost").length;
  const peopleInDeals = new Set(effectiveDeals.flatMap((deal) => (deal.primary_contact_id ? [deal.primary_contact_id] : []))).size;
  const focusPipelineValue = effectiveDeals
    .filter((deal) => deal.stage !== "lost" && deal.stage !== "delivered")
    .reduce((total, deal) => total + Number(deal.value || 0), 0);
  const brandColors = new Map(data.brands.map((brand, index): [string, string] => [brand.id, FUNNEL_BRAND_COLORS[index % FUNNEL_BRAND_COLORS.length]]));
  const legendBrands = new Map<string, string>();
  for (const row of funnel.rows) for (const entry of row.byBrand) if (entry.count > 0) legendBrands.set(entry.brandId, entry.name);
  const openRow = openStage ? funnel.rows.find((row) => row.stage === openStage) || null : null;
  const contactById = new Map(data.contacts.map((contact): [string, Contact] => [contact.id, contact]));
  const unit = mode === "brands" ? "deals" : "personas";

  return (
    <section className="crm-funnel" aria-label="Embudo de ventas">
      {focusContact && (
        <p className="crm-focus-banner" role="status">
          <span>🎯 Embudo filtrado a <strong>{focusContact.first_name} {focusContact.last_name}</strong> — {effectiveDeals.length} deal(s) como contacto principal.</span>
          <button type="button" className="workspace-link" onClick={onClearFocus}>Quitar filtro</button>
        </p>
      )}
      <div className="crm-funnel-head">
        <div className="crm-view-switch" role="group" aria-label="Unidad del embudo">
          <button type="button" className={mode === "brands" ? "active" : ""} aria-pressed={mode === "brands"} onClick={() => setMode("brands")}>Por marcas</button>
          <button type="button" className={mode === "personas" ? "active" : ""} aria-pressed={mode === "personas"} onClick={() => setMode("personas")}>Por personas</button>
        </div>
        <p className="workspace-muted">Mismas etapas que el kanban. {mode === "brands" ? "Cada barra segmenta deals por marca." : "Cuenta personas distintas — el contacto principal de cada deal."} «Perdido» queda fuera, como fuga.</p>
      </div>
      <div className="crm-summary" aria-label="Resumen del embudo">
        <article><strong>{openDeals}</strong><span>Deals abiertos</span></article>
        <article><strong>{peopleInDeals}</strong><span>Personas en deals</span></article>
        <article><strong>{money(focusPipelineValue)}</strong><span>Pipeline abierto</span></article>
        <article><strong>{funnel.endToEnd === null ? "—" : `${Math.round(funnel.endToEnd * 100)}%`}</strong><span>Conversión total</span></article>
      </div>
      <div className="crm-funnel-chart">
        {funnel.rows.map((row) => {
          const width = row.count === 0 ? 0 : Math.max(9, Math.round((row.count / maxCount) * 100));
          const open = openStage === row.stage;
          return (
            <div className="crm-funnel-row" key={row.stage}>
              <button type="button" className={`crm-funnel-label${open ? " active" : ""}`} aria-expanded={open} onClick={() => setOpenStage(open ? null : row.stage)}>
                {row.label}
                <small className="crm-funnel-desc">{STAGE_DESCRIPTIONS[row.stage]}</small>
              </button>
              <button type="button" className="crm-funnel-bar" style={{ width: `${width}%` }} disabled={row.deals.length === 0}
                aria-expanded={open}
                title={`${row.label}: ${row.count} ${unit}`}
                onClick={() => setOpenStage(open ? null : row.stage)}>
                {mode === "brands"
                  ? row.byBrand.map((entry) => <span key={entry.brandId} style={{ flexGrow: entry.count, background: brandColors.get(entry.brandId) }} title={`${entry.name}: ${entry.count}`} />)
                  : <span style={{ flexGrow: 1 }} />}
              </button>
              <span className="crm-funnel-count" aria-label={`${row.count} ${unit} en ${row.label}`}>{row.count}</span>
              {row.conversionFromPrev === null ? (
                <span className="crm-funnel-conv" title="Conversión desde la etapa anterior">—</span>
              ) : (
                <span
                  className={`crm-conv-badge${row.conversionFromPrev >= 0.6 ? " good" : " weak"}`}
                  title={`De cada 100 ${unit} que llegaron a la etapa anterior, ${Math.round(row.conversionFromPrev * 100)} avanzan aquí`}
                >
                  {Math.round(row.conversionFromPrev * 100)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {mode === "brands" && legendBrands.size > 0 && (
        <div className="crm-funnel-legend" aria-label="Marcas del embudo">
          {[...legendBrands.entries()].map(([brandId, name]) => (
            <span key={brandId}><i style={{ background: brandColors.get(brandId) }} aria-hidden="true" />{name}</span>
          ))}
        </div>
      )}
      {funnel.lost.count > 0 && (
        <p className="crm-funnel-lost">Fuga: {funnel.lost.count} deal(s) perdidos{funnel.lost.value ? ` · ${money(funnel.lost.value)}` : ""} — quedan fuera del embudo.</p>
      )}
      {openRow && (
        <div className="workspace-panel crm-funnel-detail">
          <h4>{openRow.label} — {openRow.count} {unit}{mode === "personas" && openRow.unassignedDeals > 0 ? ` (+${openRow.unassignedDeals} deal sin contacto)` : ""}</h4>
          {mode === "brands" ? (
            openRow.deals.length ? (
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
            ) : <p className="workspace-muted">Sin deals en esta etapa.</p>
          ) : (
            openRow.people.length ? (
              <div className="crm-compact-list">
                {openRow.people.map((person) => {
                  const personContact = contactById.get(person.contactId);
                  const personBrand = personContact ? data.brands.find((brand) => brand.id === personContact.brand_id) : null;
                  const personDeals = openRow.deals.filter((deal) => deal.primary_contact_id === person.contactId);
                  return (
                    <article key={person.contactId}>
                      <strong>{person.name}</strong>
                      <span>{personBrand?.name || personContact?.brand_name || "Sin marca"} · {[personContact?.job_title, `${personDeals.length} deal(s)`].filter(Boolean).join(" · ")}</span>
                    </article>
                  );
                })}
              </div>
            ) : <p className="workspace-muted">Sin personas asignadas en esta etapa.</p>
          )}
        </div>
      )}
    </section>
  );
}
