import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getApiHeaders } from "../lib/apiKey";
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
  suggestions: Array<{ assetType: string; title: string; reason: string }>;
};

type Contact = {
  id: string;
  brand_id?: string | null;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  notes?: string | null;
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
  summary: { pipelineValue: number; weightedValue: number; openDeals: number; pendingDeliverables: number };
};
type DealStage = "discovery" | "proposal" | "negotiation" | "approved" | "in_production" | "review" | "ready" | "delivered" | "lost";
type AccountFilter = "all" | "lead" | "client" | "at_risk" | "churned";

const DEAL_STAGES: Array<{ value: DealStage; label: string }> = [
  { value: "discovery", label: "Discovery" },
  { value: "proposal", label: "Propuesta" },
  { value: "negotiation", label: "Negociación" },
  { value: "approved", label: "Aprobado" },
  { value: "in_production", label: "En producción" },
  { value: "review", label: "Revisión" },
  { value: "ready", label: "Listo" },
  { value: "delivered", label: "Entregado" },
  { value: "lost", label: "Perdido" },
];

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
   * -- the Red de Marcas tab bar hosts Pipeline and Marcas y Personas next to
   * Grafo and Tabla, so the internal switch would be a second, stale copy.
   */
  view?: "pipeline" | "accounts";
}) {
  const [data, setData] = useState<CrmData | null>(null);
  const [ownView, setView] = useState<"pipeline" | "accounts">("pipeline");
  const view = controlledView ?? ownView;
  const [loading, setLoading] = useState(true);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [showDealForm, setShowDealForm] = useState(false);

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
            <button type="button" className={view === "pipeline" ? "active" : ""} aria-pressed={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline</button>
            <button type="button" className={view === "accounts" ? "active" : ""} aria-pressed={view === "accounts"} onClick={() => setView("accounts")}>Marcas y Personas</button>
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
      ) : (
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
      // When the user has disabled auto-DS creation, tell the server to skip it.
      let skipDesignSystem = false;
      try { skipDesignSystem = localStorage.getItem("futuraria-auto-design-system") === "false"; } catch {}
      const result = await crmFetch<{ data: Brand }>(`/api/workspaces/${workspaceId}/brands`, {
        method: "POST",
        body: JSON.stringify({ name: brandName, relationshipStatus, skipDesignSystem }),
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
      <div className="crm-accounts-layout">
        <section className="crm-account-list" aria-label="Marcas">
          {visibleBrands.map((brand) => (
            <button type="button" key={brand.id} className={selectedBrand?.id === brand.id ? "selected" : ""} aria-pressed={selectedBrand?.id === brand.id} onClick={() => setSelectedBrandId(brand.id)}>
              <span className="crm-account-avatar" aria-hidden="true">{brand.name.charAt(0).toLocaleUpperCase()}</span>
              <span><strong>{brand.name}</strong><small>{brand.relationship_status === "lead" ? "Lead" : brand.account_health === "at_risk" ? "Cliente en fuga" : brand.account_health === "churned" ? "Cliente perdido" : "Cliente"} · {brand.design_count} diseños</small></span>
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
  const [accountHealth, setAccountHealth] = useState(brand.account_health);
  const [priority, setPriority] = useState(brand.crm_priority);
  const [notes, setNotes] = useState(brand.crm_notes || "");

  useEffect(() => {
    setRelationshipStatus(brand.relationship_status);
    setAccountHealth(brand.account_health);
    setPriority(brand.crm_priority);
    setNotes(brand.crm_notes || "");
  }, [brand]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await crmFetch(`/api/workspaces/${workspaceId}/brands/${brand.id}`, {
        method: "PATCH",
        body: JSON.stringify({ relationshipStatus, accountHealth, priority, crmNotes: notes }),
      });
      setNotice("Cuenta actualizada.");
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  return (
    <section className="workspace-panel crm-brand-detail">
      <header><div><p className="workspace-eyebrow">Cuenta comercial</p><h3>{brand.name}</h3></div><span className={`crm-health ${accountHealth}`}>{accountHealth === "at_risk" ? "En fuga" : accountHealth === "churned" ? "Perdida" : relationshipStatus === "lead" ? "Lead" : "Activa"}</span></header>
      <form className="crm-brand-settings" onSubmit={save}>
        <Field label="Relación"><select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value as Brand["relationship_status"])}><option value="lead">Lead</option><option value="client">Cliente</option></select></Field>
        <Field label="Salud"><select value={accountHealth} onChange={(event) => setAccountHealth(event.target.value as Brand["account_health"])}><option value="active">Activa</option><option value="at_risk">En fuga</option><option value="churned">Perdida</option></select></Field>
        <Field label="Prioridad"><select value={priority} onChange={(event) => setPriority(event.target.value as Brand["crm_priority"])}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></Field>
        <Field label="Notas"><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <button className="workspace-button">Guardar</button>
      </form>
      <div className="crm-brand-sections">
        <section><h4>Qué ofrecer</h4>{brand.suggestions.length ? <div className="crm-suggestions">{brand.suggestions.map((suggestion) => <article key={suggestion.assetType}><strong>{suggestion.title}</strong><p>{suggestion.reason}</p></article>)}</div> : <p className="workspace-muted">La cobertura base de assets está completa.</p>}</section>
        <section><h4>Stakeholders <span>{contacts.length}</span></h4><div className="crm-compact-list">{contacts.map((contact) => <article key={contact.id}><strong>{contact.first_name} {contact.last_name}</strong><span>{[contact.job_title, contact.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</span></article>)}</div>{children}</section>
        <section><h4>Deals <span>{deals.length}</span></h4><div className="crm-compact-list">{deals.map((deal) => <article key={deal.id}><strong>{deal.title}</strong><span>{DEAL_STAGES.find((stage) => stage.value === deal.stage)?.label} · {deal.progress.percentage}%</span></article>)}</div></section>
        <section><h4>Diseños vinculados <span>{designs.length}</span></h4><div className="crm-design-grid">{designs.map((design) => <button type="button" key={design.template_id} onClick={() => onOpenTemplate?.(design.template_id)}><span>{assetLabel.get(design.asset_type as any) || design.asset_type}</span><strong>{design.name}</strong></button>)}</div></section>
      </div>
    </section>
  );
}
