// apiV2/clientes.ts — módulo del carril datos para las vistas de Clientes y su información
// (briefs, cotizaciones, fees, proyectos, formularios). Todo PostgREST REAL vía apiFetch
// (el worker proxya /rest/v1/* con el JWT del usuario → RLS real). Sin mock data.
// Las vistas del shell-v2 importan de aquí; NUNCA hacen fetch propio.
import { getData, postData, patchData } from "./client";

/* ── Tipos = columnas reales de la BD (lnbsmnbvclxrwwcuuvud, verificado 2 nov 2026) ── */

export type Brief = {
  id: string;
  workspace_id: string;
  brand_id: string | null;          // brands usa ids TEXT (brand_xxx), NO uuid
  title: string;
  status: "borrador" | "por_completar" | "aprobado" | "en_proyecto";
  objective: string | null;
  audience: string | null;
  tone: string | null;
  deliverables: string[];
  content: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Rate = {
  id: string;
  workspace_id: string;
  label: string;
  price: number;
  unit: string;                     // "pieza" | "mes" | "día"
  sort: number;
};

export type QuoteItem = { label: string; qty: number };

export type Quote = {
  id: string;
  workspace_id: string;
  number: string;                   // "COT-0142"
  brand_id: string | null;
  brand_name: string | null;
  deal_id: string | null;
  title: string;
  status: "borrador" | "enviada" | "firmada" | "rechazada";
  items: QuoteItem[];               // por label del tarifario (workspace_rates)
  currency: string;                 // "PEN"
  total: number | null;             // si null: sumar items con el tarifario
  sent_at: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Fee = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  brand_name: string | null;
  monthly_fee: number;
  currency: string;
  hours_included: number;
  hours_used: number;
  pieces_included: number;
  pieces_delivered: number;
  out_of_scope: string[];
  period: string;                   // date "YYYY-MM-DD" (renovación mensual)
};

export type ProjectTask = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  kind: "interna" | "cliente";
  status: "todo" | "doing" | "review" | "done";
  due: string | null;
};

export type Project = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  brand_name: string | null;
  name: string;
  status: string;                   // planning|production|awaiting_signature|paused|delivered (y variantes es)
  brief_id: string | null;
  quote_id: string | null;
  playbook_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  budget: number;
  spent: number;
  hours_planned: number;
  hours_used: number;
  team: string[];
  files: unknown[];
  approvals: unknown[];
  progress: number;
};



/* ── Helpers PostgREST ── */

const REST = "/rest/v1";
function wsFilter(workspaceId: string, select: string, extra = "") {
  return `${REST}/briefs?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${select}${extra}`;
}
// genérico por tabla (briefs arriba es solo ejemplo de forma)
function list<T>(table: string, workspaceId: string, select: string, extra = ""): Promise<T[]> {
  return getData<T[]>(`${REST}/${table}?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${select}${extra}`);
}

/* ── Briefs ── */

export function fetchBriefs(workspaceId: string): Promise<Brief[]> {
  return list<Brief>("briefs", workspaceId, "*", "&order=updated_at.desc&limit=100");
}
export function createBrief(
  workspaceId: string,
  input: { brand_id?: string | null; title: string; status?: Brief["status"]; objective?: string; audience?: string; tone?: string; deliverables?: string[]; content?: Record<string, unknown> }
): Promise<Brief> {
  return postData<Brief>(`${REST}/briefs`, { workspace_id: workspaceId, status: "por_completar", ...input });
}
export function updateBrief(id: string, patch: Partial<Pick<Brief, "title" | "status" | "objective" | "audience" | "tone" | "deliverables" | "content" | "brand_id">>): Promise<Brief> {
  return patchData<Brief>(`${REST}/briefs?id=eq.${encodeURIComponent(id)}`, patch);
}
/** El flujo de la maqueta: aprobar el brief lo convierte en proyecto + cotización en borrador */
export async function convertBriefToProject(workspaceId: string, brief: Brief): Promise<{ project: Project; quote: Quote | null }> {
  await updateBrief(brief.id, { status: "en_proyecto" });
  const project = await postData<Project>(`${REST}/workspace_projects`, {
    workspace_id: workspaceId,
    brand_id: brief.brand_id,
    name: brief.title,
    status: "production",
    brief_id: brief.id,
  });
  let quote: Quote | null = null;
  try {
    quote = await postData<Quote>(`${REST}/crm_quotes`, {
      workspace_id: workspaceId,
      brand_id: brief.brand_id,
      number: "COT-" + String(Date.now()).slice(-4),
      title: brief.title,
      status: "borrador",
      items: [],
      currency: "PEN",
    });
  } catch { /* la cotización es opcional */ }
  return { project, quote };
}

/* ── Tarifario (los precios del board derecho de Cotizaciones) ── */

export function fetchRates(workspaceId: string): Promise<Rate[]> {
  return list<Rate>("workspace_rates", workspaceId, "*", "&order=sort.asc&limit=50");
}
export function upsertRates(workspaceId: string, rates: { label: string; price: number; unit: string; sort: number }[]): Promise<Rate[]> {
  return postData<Rate[]>(`${REST}/workspace_rates`, rates.map(r => ({ ...r, workspace_id: workspaceId })));
}
export const DEFAULT_RATES: { label: string; price: number; unit: string; sort: number }[] = [
  { label: "Post o carrusel", price: 180, unit: "pieza", sort: 0 },
  { label: "Story", price: 90, unit: "pieza", sort: 1 },
  { label: "Reel editado", price: 450, unit: "pieza", sort: 2 },
  { label: "Video largo (3 min)", price: 1200, unit: "pieza", sort: 3 },
  { label: "Lookbook / catálogo", price: 1500, unit: "pieza", sort: 4 },
  { label: "Gestión de ads", price: 900, unit: "mes", sort: 5 },
  { label: "Community management", price: 1600, unit: "mes", sort: 6 },
  { label: "Sesión de fotos", price: 1100, unit: "día", sort: 7 },
];

/* ── Cotizaciones ── */

export function fetchQuotes(workspaceId: string): Promise<Quote[]> {
  return list<Quote>("crm_quotes", workspaceId, "*", "&order=updated_at.desc&limit=100");
}
export function createQuote(workspaceId: string, input: { brand_id?: string | null; brand_name?: string; title: string; items?: QuoteItem[]; number?: string }): Promise<Quote> {
  return postData<Quote>(`${REST}/crm_quotes`, {
    workspace_id: workspaceId,
    number: input.number || "COT-" + String(Date.now()).slice(-4),
    status: "borrador",
    currency: "PEN",
    ...input,
  });
}
export function updateQuote(id: string, patch: Partial<Pick<Quote, "title" | "status" | "items" | "sent_at" | "signed_at" | "deal_id">>): Promise<Quote> {
  return patchData<Quote>(`${REST}/crm_quotes?id=eq.${encodeURIComponent(id)}`, patch);
}
/** Botón "Enviar para firma digital" / "Simular firma" de la maqueta, persistido */
export function signQuote(id: string): Promise<Quote> {
  return updateQuote(id, { status: "firmada", signed_at: new Date().toISOString() });
}
export function sendQuote(id: string): Promise<Quote> {
  return updateQuote(id, { status: "enviada", sent_at: new Date().toISOString() });
}

/* ── Fees y horas ── */

export function fetchFees(workspaceId: string): Promise<Fee[]> {
  return list<Fee>("workspace_fees", workspaceId, "*", "&order=updated_at.desc&limit=50");
}
export function logHours(fee: Fee, hours: number): Promise<Fee> {
  return patchData<Fee>(`${REST}/workspace_fees?id=eq.${encodeURIComponent(fee.id)}`, { hours_used: Number(fee.hours_used) + hours });
}
export function absorbOutOfScope(fee: Fee): Promise<Fee> {
  return patchData<Fee>(`${REST}/workspace_fees?id=eq.${encodeURIComponent(fee.id)}`, { out_of_scope: [] });
}
/** "Cotizar lo extra": genera la cotización en borrador con los items fuera de alcance */
export function quoteOutOfScope(workspaceId: string, fee: Fee): Promise<Quote> {
  return createQuote(workspaceId, { brand_id: fee.brand_id, brand_name: fee.brand_name || undefined, title: "Extras fuera del fee", items: (fee.out_of_scope || []).map(l => ({ label: l, qty: 1 })) });
}

/* ── Proyectos + tareas ── */

export function fetchProjects(workspaceId: string): Promise<Project[]> {
  return list<Project>("workspace_projects", workspaceId, "*", "&order=updated_at.desc&limit=100");
}
export function fetchProjectTasks(workspaceId: string): Promise<ProjectTask[]> {
  return list<ProjectTask>("workspace_project_tasks", workspaceId, "*", "&order=updated_at.desc&limit=300");
}
export function createProject(workspaceId: string, input: { brand_id?: string | null; brand_name?: string; name: string; status?: string; brief_id?: string; quote_id?: string; budget?: number; starts_on?: string; ends_on?: string }): Promise<Project> {
  return postData<Project>(`${REST}/workspace_projects`, { workspace_id: workspaceId, status: "planning", ...input });
}
export function updateProject(id: string, patch: Partial<Pick<Project, "name" | "status" | "budget" | "spent" | "progress" | "starts_on" | "ends_on" | "team">>): Promise<Project> {
  return patchData<Project>(`${REST}/workspace_projects?id=eq.${encodeURIComponent(id)}`, patch);
}
export function createTask(workspaceId: string, projectId: string, title: string, kind: "interna" | "cliente" = "interna", due?: string): Promise<ProjectTask> {
  return postData<ProjectTask>(`${REST}/workspace_project_tasks`, { workspace_id: workspaceId, project_id: projectId, title, kind, status: "todo", due: due || null });
}
export function updateTask(id: string, patch: Partial<Pick<ProjectTask, "status" | "kind" | "due">>): Promise<ProjectTask> {
  return patchData<ProjectTask>(`${REST}/workspace_project_tasks?id=eq.${encodeURIComponent(id)}`, patch);
}


/* NOTA: Mailing, Eventos, Formularios, Ads e Inbox YA tienen funciones reales en
 * crear.ts / conversar.ts / anunciar.ts (mismo carril). Este módulo agrega lo que
 * faltaba: briefs, tarifario, cotizaciones, fees y proyectos+tareas. */
