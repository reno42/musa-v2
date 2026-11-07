// Paridad humano ↔ IA (Musa v2): todo lo que la persona hace en la web, su IA
// lo puede hacer por MCP, sobre las MISMAS tablas y con los MISMOS valores que
// escriben los bridges de la maqueta (bridge-create / bridge-data / bridge-org…).
// El acceso al workspace (viewer para list_*, editor para escrituras, admin
// para PARITY_ADMIN_METHODS) lo valida authorizeMcpCall ANTES de llegar aquí;
// aquí cada fila se filtra además por workspace_id, así un id ajeno no cruza.
// Correo y ads reutilizan el núcleo de sus endpoints REST (emailCore/adsCore):
// mismas reglas, mismos límites, cero lógica duplicada.
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { emailCore } from "./email.mjs";
import { adsCore } from "./ads.mjs";

export const PARITY_TOOLS = [
  // ── Planear › Briefs y Playbooks ──
  {
    name: "list_briefs",
    description: "Musa v2 · Briefs del espacio (Planear › Briefs): título, marca, estado (por_completar | aprobado | en_proyecto), objetivo, público, tono, entregables, fecha, presupuesto y su enlace público para que el cliente lo complete.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, status: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "brief_save",
    description: "Musa v2 · Crea o actualiza un brief (lo mismo que «Nuevo brief» en Planear › Briefs). status: por_completar (default) | aprobado | en_proyecto. Devuelve { id, url } con la página pública /b/<token> donde el cliente lo completa sin cuenta.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" }, id: { type: "string" }, title: { type: "string" }, brandId: { type: "string" },
        status: { type: "string", enum: ["por_completar", "aprobado", "en_proyecto"] }, objective: { type: "string" }, audience: { type: "string" },
        tone: { type: "string" }, deliverables: { type: "array", items: { type: "string" } }, dueDate: { type: "string", description: "YYYY-MM-DD" }, budget: { type: "number" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "list_playbooks",
    description: "Musa v2 · Playbooks del espacio (Planear › Playbooks): campañas repetibles con pasos { d: día relativo, t: tarea, link: módulo, who: responsable } y cuántas veces se usaron.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "playbook_save",
    description: "Musa v2 · Crea o actualiza un playbook. steps: [{ d: día relativo al día D (puede ser negativo), t: tarea, link?: ruta del módulo (ej. 'crear/disenos'), who?: responsable }].",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, category: { type: "string" }, description: { type: "string" },
        steps: { type: "array", items: { type: "object", properties: { d: { type: "number" }, t: { type: "string" }, link: { type: "string" }, who: { type: "string" } }, required: ["d", "t"] } },
      },
      required: ["workspaceId", "name"],
    },
  },
  {
    name: "playbook_apply",
    description: "Musa v2 · Aplica un playbook a una marca (botón «Usar» de Playbooks): crea el proyecto con playbook_id y una tarea de proyecto por paso, con fecha = día D + d. Devuelve { projectId, tasks }.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, playbookId: { type: "string" }, brandId: { type: "string" }, startDate: { type: "string", description: "Día D, YYYY-MM-DD" } }, required: ["workspaceId", "playbookId", "brandId", "startDate"] },
  },
  // ── Vender › Cotizaciones, tarifario, fees, proyectos ──
  {
    name: "list_quotes",
    description: "Musa v2 · Cotizaciones (Vender › Cotizaciones): número, título, marca, oportunidad, estado (Borrador | Enviada | Firmada | Rechazada | Vencida), ítems, total, firma del cliente y enlace público /q/<token>.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, status: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "quote_save",
    description: "Musa v2 · Crea o actualiza una cotización en Borrador. items: [{ label, price, qty, unit? }] (usa list_rates para el tarifario del espacio); el total se calcula. El número COT-AAAA-NNN se asigna solo. Para enviarla usa quote_set_status.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" }, id: { type: "string" }, title: { type: "string" }, brandId: { type: "string" }, dealId: { type: "string" },
        currency: { type: "string", enum: ["PEN", "USD"] },
        items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, price: { type: "number" }, qty: { type: "number" }, unit: { type: "string" } }, required: ["label", "price", "qty"] } },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "quote_set_status",
    description: "Musa v2 · Cambia el estado de una cotización: Enviada (marca sent_at; el cliente la ve y firma en /q/<token>), Firmada, Rechazada, Vencida o Borrador. Devuelve la URL pública. Enviar el enlace por correo: email_send.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, status: { type: "string", enum: ["Borrador", "Enviada", "Firmada", "Rechazada", "Vencida"] } }, required: ["workspaceId", "id", "status"] },
  },
  {
    name: "list_rates",
    description: "Musa v2 · Tarifario del espacio (servicios con precio y unidad) que alimenta las cotizaciones.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "rates_save",
    description: "Musa v2 · Reemplaza el tarifario completo del espacio. rates: [{ label, price, unit? }] en el orden en que se muestran.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, rates: { type: "array", items: { type: "object", properties: { label: { type: "string" }, price: { type: "number" }, unit: { type: "string" } }, required: ["label", "price"] } } }, required: ["workspaceId", "rates"] },
  },
  {
    name: "list_fees",
    description: "Musa v2 · Fees mensuales por marca (Vender/Clientes › Fees): monto, horas y piezas incluidas y usadas, y pedidos fuera de alcance.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "fee_save",
    description: "Musa v2 · Crea o actualiza el fee mensual de una marca (monto, moneda, horas y piezas incluidas, periodo).",
    inputSchema: {
      type: "object",
      properties: { workspaceId: { type: "string" }, id: { type: "string" }, brandId: { type: "string" }, monthlyFee: { type: "number" }, currency: { type: "string", enum: ["PEN", "USD"] }, hoursIncluded: { type: "number" }, piecesIncluded: { type: "number" }, period: { type: "string" } },
      required: ["workspaceId"],
    },
  },
  {
    name: "fee_log",
    description: "Musa v2 · Registra consumo en un fee: suma horas (hours) y/o piezas entregadas (pieces), agrega pedidos fuera de alcance (outOfScope) o los da por resueltos (clearOutOfScope: true). Es el «Registrar horas» de la web.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, hours: { type: "number" }, pieces: { type: "number" }, outOfScope: { type: "array", items: { type: "string" } }, clearOutOfScope: { type: "boolean" } }, required: ["workspaceId", "id"] },
  },
  {
    name: "list_projects",
    description: "Musa v2 · Proyectos por marca (Marcas y proyectos): estado, brief, cotización, playbook, fechas, presupuesto y gasto, horas, avance y sus tareas.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, withTasks: { type: "boolean" } }, required: ["workspaceId"] },
  },
  {
    name: "project_save",
    description: "Musa v2 · Crea o actualiza un proyecto. status: Planificando | En producción | En revisión | Pausado | Entregado | Cerrado. progress 0-100.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, brandId: { type: "string" }, briefId: { type: "string" }, quoteId: { type: "string" },
        status: { type: "string", enum: ["Planificando", "En producción", "En revisión", "Pausado", "Entregado", "Cerrado"] }, startsOn: { type: "string" }, endsOn: { type: "string" }, budget: { type: "number" }, spent: { type: "number" },
        hoursPlanned: { type: "number" }, hoursUsed: { type: "number" }, progress: { type: "number" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "project_task_save",
    description: "Musa v2 · Crea, actualiza o borra (delete: true) una tarea de un proyecto. status: todo | doing | done.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, projectId: { type: "string" }, id: { type: "string" }, title: { type: "string" }, kind: { type: "string" }, status: { type: "string" }, due: { type: "string" }, delete: { type: "boolean" } }, required: ["workspaceId"] },
  },
  // ── Crear › Formularios, eventos, mailing, clones ──
  {
    name: "list_forms",
    description: "Musa v2 · Formularios de captura (Crear › Formularios): nombre, marca, campos, si está activo, respuestas y su página pública /f/<token>.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "form_save",
    description: "Musa v2 · Crea o actualiza un formulario. fields: [{ name, label, type: text|email|tel|textarea|select|number, required? }] (email y nombre van obligatorios por defecto). published: true lo activa. Cada respuesta entra al CRM como contacto. Devuelve { id, url }.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, brandId: { type: "string" }, type: { type: "string" }, published: { type: "boolean" },
        fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, label: { type: "string" }, type: { type: "string" }, required: { type: "boolean" } }, required: ["name"] } },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "list_form_responses",
    description: "Musa v2 · Respuestas de un formulario (datos, correo, contacto del CRM vinculado), más nuevas primero.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, formId: { type: "string" }, limit: { type: "number" } }, required: ["workspaceId", "formId"] },
  },
  {
    name: "list_events",
    description: "Musa v2 · Eventos del espacio con fecha, plataforma, cupo, inscritos y URL pública. Crear o editar: event_save.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "list_event_registrations",
    description: "Musa v2 · Inscritos de un evento (nombre, correo, teléfono, estado, origen).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, eventId: { type: "string" } }, required: ["workspaceId", "eventId"] },
  },
  {
    name: "list_mailings",
    description: "Musa v2 · Campañas y secuencias de correo: asunto, estado, segmento, marca, enviados/aperturas/clics. Crear o editar: mailing_save.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, kind: { type: "string", enum: ["campana", "secuencia"] } }, required: ["workspaceId"] },
  },
  {
    name: "get_email_settings",
    description: "Musa v2 · Proveedor de correo del espacio (Resend, Postmark o Musa), remitente y si tienes tu llave vinculada.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "mailing_send",
    description: "Musa v2 · ENVÍA una campaña a su audiencia (el botón Enviar de Mailing). Sin confirm:true solo cuenta destinatarios (dryRun). Con at (ISO futuro) la programa (solo Resend, ≤40). Si queda nextOffset, llama de nuevo con offset para el siguiente lote. Hazlo SOLO cuando la persona lo pidió explícitamente.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, confirm: { type: "boolean" }, at: { type: "string" }, offset: { type: "number" } }, required: ["workspaceId", "id"] },
  },
  {
    name: "mailing_test",
    description: "Musa v2 · Manda un correo de prueba (a ti o a to) con el asunto y HTML de un mailing (id) o los que pases.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, html: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "sequence_activate",
    description: "Musa v2 · Activa una secuencia: envía el paso del día 0 y programa los siguientes para su grupo (Resend). Requiere confirm:true y que la persona lo haya pedido.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, confirm: { type: "boolean" } }, required: ["workspaceId", "id", "confirm"] },
  },
  {
    name: "email_send",
    description: "Musa v2 · Envía UN correo a una persona con el proveedor del espacio (ej. el enlace de una cotización o brief). Requiere confirm:true.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, html: { type: "string" }, confirm: { type: "boolean" } }, required: ["workspaceId", "to", "subject", "html", "confirm"] },
  },
  {
    name: "list_clones",
    description: "Musa v2 · Clones IA del espacio (Crear › Clones IA): voces (ElevenLabs) y avatares (HeyGen) con estado y vista previa. Clonar voz: voice_clone_create.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, kind: { type: "string", enum: ["voz", "avatar"] } }, required: ["workspaceId"] },
  },
  // ── Conversar ──
  {
    name: "inbox_update",
    description: "Musa v2 · Gestiona un mensaje de la Bandeja como en la web: status nuevo | done | hidden, y/o assignedTo (userId de un miembro del equipo; null lo desasigna).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, itemId: { type: "string" }, status: { type: "string", enum: ["nuevo", "done", "hidden"] }, assignedTo: { type: ["string", "null"] } }, required: ["workspaceId", "itemId"] },
  },
  // ── Anunciar ──
  {
    name: "list_ad_campaigns",
    description: "Musa v2 · Pauta del espacio: campañas planificadas en Musa (Anunciar › Campañas: red, objetivo, presupuesto) y campañas reales sincronizadas de Meta/TikTok/LinkedIn/Google (gasto, impresiones, clics, conversiones, estado).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "ad_campaign_plan_save",
    description: "Musa v2 · Crea o actualiza una campaña planificada (Anunciar › Nueva campaña): marca, red (meta|tiktok|linkedin|google), objetivo, presupuesto en USD, tipo y notas. Para crearla en la red: ad_campaign_create.",
    inputSchema: {
      type: "object",
      properties: { workspaceId: { type: "string" }, id: { type: "string" }, brandId: { type: "string" }, name: { type: "string" }, network: { type: "string" }, objective: { type: "string" }, budgetUsd: { type: "number" }, type: { type: "string" }, status: { type: "string" }, notes: { type: "string" } },
      required: ["workspaceId"],
    },
  },
  {
    name: "list_ad_accounts",
    description: "Musa v2 · Cuentas publicitarias conectadas al espacio (red, cuenta, marca, última sincronización y error).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "ads_sync",
    description: "Musa v2 · Trae campañas y métricas reales de las cuentas conectadas (últimos days, default 30).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, days: { type: "number" } }, required: ["workspaceId"] },
  },
  {
    name: "ad_campaign_status",
    description: "Musa v2 · Pausa o reactiva una campaña real en su red (id de list_ad_campaigns › reales). Gasta o deja de gastar dinero real: solo con confirm:true y pedido explícito.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, action: { type: "string", enum: ["pause", "resume"] }, confirm: { type: "boolean" } }, required: ["workspaceId", "id", "action", "confirm"] },
  },
  {
    name: "ad_campaign_create",
    description: "Musa v2 · Crea una campaña en Meta o TikTok (queda PAUSADA) desde una cuenta conectada (accountRef = id de list_ad_accounts). Google/LinkedIn: se crean en su administrador y llegan al sincronizar.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, accountRef: { type: "string" }, name: { type: "string" }, objective: { type: "string" }, dailyBudget: { type: "number" }, campaignId: { type: "string" }, brandId: { type: "string" } }, required: ["workspaceId", "accountRef", "name"] },
  },
  // ── Organización ──
  {
    name: "list_org",
    description: "Musa v2 · Organización (planes corporativos): áreas (líder, marcas, si valida), agencias externas (contacto, áreas, SLA) y aprobaciones de piezas (estado pendiente | aprobado | cambios, checklist y comentario).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, approvalStatus: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "org_area_save",
    description: "Musa v2 · Crea, actualiza o borra (delete: true) un área interna. validates: true = esa área (ej. Marketing) aprueba las piezas de las demás.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, leadName: { type: "string" }, validates: { type: "boolean" }, brandIds: { type: "array", items: { type: "string" } }, delete: { type: "boolean" } }, required: ["workspaceId"] },
  },
  {
    name: "org_agency_save",
    description: "Musa v2 · Crea, actualiza o borra (delete: true) una agencia externa: contacto, áreas a las que sirve, SLA en horas y nota de acceso.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, contactEmail: { type: "string" }, areaIds: { type: "array", items: { type: "string" } }, slaHours: { type: "number" }, accessNote: { type: "string" }, delete: { type: "boolean" } }, required: ["workspaceId"] },
  },
  {
    name: "approval_request",
    description: "Musa v2 · Envía un diseño a aprobación de un área (Organización › Aprobaciones).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, templateId: { type: "string" }, areaId: { type: "string" }, requestedBy: { type: "string" } }, required: ["workspaceId", "templateId"] },
  },
  {
    name: "approval_decide",
    description: "Musa v2 · Decide una aprobación: aprobado | cambios | pendiente, con comentario y checklist [[punto, 1|0|null]]. Solo dueños o admins (igual que en la web).",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, status: { type: "string", enum: ["aprobado", "cambios", "pendiente"] }, comment: { type: "string" }, checks: { type: "array" } }, required: ["workspaceId", "id"] },
  },
  // ── Agentes y gobernanza ──
  {
    name: "list_agents",
    description: "Musa v2 · Agentes del espacio (Agentes › Chats/Computadoras): nombre, rol, plantilla, modelo, marcas, permisos, estado y tarea actual.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
  },
  {
    name: "agent_save",
    description: "Musa v2 · Crea o actualiza un agente del espacio (rol, plantilla openclaw|hermes|claude|musa, modelo, color, marcas, permisos, estado, tarea). delete: true lo quita.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, role: { type: "string" }, template: { type: "string" }, model: { type: "string" }, color: { type: "string" },
        brands: { type: "array", items: { type: "string" } }, permissions: { type: "array", items: { type: "string" } }, state: { type: "string" }, task: { type: "string" }, delete: { type: "boolean" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "list_governance",
    description: "Musa v2 · Gobernanza de IA del espacio: políticas (activas o no) y el registro reciente de acciones de los agentes (Permitido | Bloqueado | Pidió aprobación). Léelo antes de actuar: las políticas activas mandan.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, limit: { type: "number" } }, required: ["workspaceId"] },
  },
  {
    name: "governance_rule_save",
    description: "Musa v2 · Crea, activa/desactiva o borra (delete: true) una política de IA del espacio. Solo dueños o admins.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, rule: { type: "string" }, description: { type: "string" }, enabled: { type: "boolean" }, delete: { type: "boolean" } }, required: ["workspaceId"] },
  },
  {
    name: "agent_activity_log",
    description: "Musa v2 · Registra una acción de un agente en el log de Gobernanza (qué hizo y si fue permitido, bloqueado por una política o si pidió aprobación). Úsalo al terminar acciones relevantes.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, agentName: { type: "string" }, agentId: { type: "string" }, action: { type: "string" }, verdict: { type: "string", enum: ["Permitido", "Bloqueado", "Pidió aprobación"] } }, required: ["workspaceId", "action"] },
  },
];

export const PARITY_NAMES = new Set(PARITY_TOOLS.map((t) => t.name));
/** Escrituras que en la web solo hacen dueños/admins. */
export const PARITY_ADMIN_METHODS = new Set(["approval_decide", "governance_rule_save", "org_area_save", "org_agency_save", "rates_save"]);

// ── helpers ──
const E = (code, message) => ({ code, message });
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n / 2))].map((b) => b.toString(16).padStart(2, "0")).join("");
const origin = () => String(process.env.EVENTS_PUBLIC_ORIGIN || process.env.URL || "").replace(/\/$/, "");
const num = (v, d = 0) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));
function db() { const sb = getSupabaseAdmin(); if (!sb) throw E(-32603, "Base de datos no configurada"); return sb; }
function must(r) { if (r.error) throw E(-32000, r.error.message); return r.data; }
function pick(params, map) { const o = {}; for (const [k, col] of Object.entries(map)) if (params[k] !== undefined) o[col] = params[k]; return o; }
async function brandName(sb, ws, id) { if (!id) return null; const { data } = await sb.from("brands").select("name").eq("id", id).eq("workspace_id", ws).maybeSingle(); if (!data) throw E(-32004, `Marca no encontrada en este espacio: ${id}`); return data.name; }
/** Inserta o actualiza (por id + workspace) y devuelve la fila. */
async function save(sb, table, ws, id, row, cols = "*") {
  if (id) {
    const data = must(await sb.from(table).update(row).eq("id", id).eq("workspace_id", ws).select(cols).maybeSingle());
    if (!data) throw E(-32004, `No encontrado en este espacio: ${id}`);
    return data;
  }
  return must(await sb.from(table).insert({ workspace_id: ws, ...row }).select(cols).single());
}
async function del(sb, table, ws, id) { if (!id) throw E(-32602, "Falta id"); must(await sb.from(table).delete().eq("id", id).eq("workspace_id", ws)); return { id, deleted: true }; }
/** Llama al núcleo REST de correo/ads con el usuario de la sesión MCP. */
async function rest(core, auth, method, path, body) {
  const userId = auth?.userId;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(String(userId))) throw E(-32003, "Esta acción necesita una sesión de persona o una llave de espacio (no la llave de administrador).");
  const ev = method === "GET"
    ? { httpMethod: "GET", path, queryStringParameters: body, headers: {} }
    : { httpMethod: method, path, body: JSON.stringify(body || {}), isBase64Encoded: false, headers: {}, queryStringParameters: {} };
  const r = await core(ev, userId);
  let j = null; try { j = JSON.parse(r.body || "null"); } catch { /* sin cuerpo */ }
  if (r.statusCode >= 400) throw E(-32000, j?.error || `Error ${r.statusCode}`);
  return j;
}

export async function handleParityTool(method, params, auth) {
  const ws = String(params.workspaceId || "");
  if (!ws) throw E(-32602, "Falta workspaceId (usa list_workspaces)");
  const sb = db();
  const uid = auth?.userId && /^[0-9a-f-]{36}$/i.test(String(auth.userId)) ? auth.userId : null;

  switch (method) {
    // ── Briefs ──
    case "list_briefs": {
      let q = sb.from("briefs").select("id,title,status,brand_id,brand_name,objective,audience,tone,deliverables,due_date,budget,public_token,updated_at").eq("workspace_id", ws).order("updated_at", { ascending: false }).limit(200);
      if (params.brandId) q = q.eq("brand_id", params.brandId);
      if (params.status) q = q.eq("status", params.status);
      return { briefs: (must(await q) || []).map(({ public_token, ...b }) => ({ ...b, url: public_token ? `${origin()}/b/${public_token}` : null })) };
    }
    case "brief_save": {
      if (!params.id && !params.title) throw E(-32602, "title es requerido para crear");
      const row = pick(params, { title: "title", status: "status", objective: "objective", audience: "audience", tone: "tone", deliverables: "deliverables", dueDate: "due_date", budget: "budget" });
      if (params.brandId !== undefined) { row.brand_id = params.brandId || null; row.brand_name = await brandName(sb, ws, params.brandId); }
      if (!params.id) { row.status ||= "por_completar"; row.created_by = uid; }
      const b = await save(sb, "briefs", ws, params.id, row, "id,status,public_token");
      return { id: b.id, status: b.status, url: b.public_token ? `${origin()}/b/${b.public_token}` : null };
    }
    // ── Playbooks ──
    case "list_playbooks":
      return { playbooks: must(await sb.from("workspace_playbooks").select("id,name,category,description,steps,uses,updated_at").eq("workspace_id", ws).order("created_at").limit(100)) };
    case "playbook_save": {
      const row = pick(params, { name: "name", category: "category", description: "description" });
      if (params.steps !== undefined) row.steps = (params.steps || []).map((s) => ({ d: num(s.d), t: String(s.t || ""), link: s.link || "planear/calendario", who: s.who || "" })).filter((s) => s.t);
      if (!params.id) row.created_by = uid;
      return { id: (await save(sb, "workspace_playbooks", ws, params.id, row, "id")).id };
    }
    case "playbook_apply": {
      const pb = must(await sb.from("workspace_playbooks").select("id,name,steps,uses").eq("id", params.playbookId).eq("workspace_id", ws).maybeSingle());
      if (!pb) throw E(-32004, "Playbook no encontrado");
      const bn = await brandName(sb, ws, params.brandId);
      const d0 = new Date(`${params.startDate}T12:00:00Z`); if (isNaN(d0)) throw E(-32602, "startDate inválido (YYYY-MM-DD)");
      const proj = must(await sb.from("workspace_projects").insert({ workspace_id: ws, name: `${pb.name} · ${bn}`, brand_id: params.brandId, brand_name: bn, playbook_id: pb.id, status: "Planificando", starts_on: params.startDate, created_by: uid }).select("id").single());
      const tasks = (pb.steps || []).map((s) => ({ workspace_id: ws, project_id: proj.id, title: s.t, kind: s.link || null, status: "todo", due: new Date(d0.getTime() + num(s.d) * 864e5).toISOString().slice(0, 10) }));
      if (tasks.length) must(await sb.from("workspace_project_tasks").insert(tasks));
      await sb.from("workspace_playbooks").update({ uses: num(pb.uses) + 1 }).eq("id", pb.id);
      return { projectId: proj.id, tasks: tasks.length };
    }
    // ── Cotizaciones y tarifario ──
    case "list_quotes": {
      let q = sb.from("crm_quotes").select("id,number,title,status,brand_id,brand_name,deal_id,items,currency,total,sent_at,signed_at,signed_by_name,client_comment,public_token").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(200);
      if (params.brandId) q = q.eq("brand_id", params.brandId);
      if (params.status) q = q.ilike("status", params.status);
      return { quotes: (must(await q) || []).map(({ public_token, ...x }) => ({ ...x, url: public_token ? `${origin()}/q/${public_token}` : null })) };
    }
    case "quote_save": {
      const row = pick(params, { title: "title", currency: "currency", dealId: "deal_id" });
      if (params.brandId !== undefined) { row.brand_id = params.brandId || null; row.brand_name = await brandName(sb, ws, params.brandId); }
      if (params.items) {
        row.items = params.items.map((x) => ({ label: String(x.label), price: num(x.price), unit: x.unit || "pieza", qty: num(x.qty) })).filter((x) => x.qty > 0);
        row.total = row.items.reduce((s, x) => s + x.price * x.qty, 0);
      }
      if (!params.id) {
        if (!params.title || !row.items?.length) throw E(-32602, "Para crear: title e items (al menos uno con qty > 0)");
        const { count } = await sb.from("crm_quotes").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
        Object.assign(row, { number: `COT-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(3, "0")}`, status: "Borrador", currency: row.currency || "PEN", created_by: uid });
      }
      const x = await save(sb, "crm_quotes", ws, params.id, row, "id,number,total,currency,public_token");
      return { id: x.id, number: x.number, total: x.total, currency: x.currency, url: `${origin()}/q/${x.public_token}` };
    }
    case "quote_set_status": {
      const st = params.status, now = new Date().toISOString();
      const row = { status: st };
      if (st === "Enviada") row.sent_at = now;
      if (st === "Firmada") row.signed_at = now;
      const x = await save(sb, "crm_quotes", ws, params.id, row, "id,status,public_token");
      return { id: x.id, status: x.status, url: `${origin()}/q/${x.public_token}` };
    }
    case "list_rates":
      return { rates: must(await sb.from("workspace_rates").select("id,label,price,unit,sort").eq("workspace_id", ws).order("sort")) };
    case "rates_save": {
      const rows = (params.rates || []).map((r, i) => ({ workspace_id: ws, label: String(r.label), price: num(r.price), unit: r.unit || "pieza", sort: i }));
      if (!rows.length) throw E(-32602, "rates vacío");
      must(await sb.from("workspace_rates").delete().eq("workspace_id", ws));
      must(await sb.from("workspace_rates").insert(rows));
      return { saved: rows.length };
    }
    // ── Fees ──
    case "list_fees": {
      let q = sb.from("workspace_fees").select("id,brand_id,brand_name,monthly_fee,currency,hours_included,hours_used,pieces_included,pieces_delivered,out_of_scope,period").eq("workspace_id", ws).order("updated_at", { ascending: false });
      if (params.brandId) q = q.eq("brand_id", params.brandId);
      return { fees: must(await q) };
    }
    case "fee_save": {
      const row = pick(params, { monthlyFee: "monthly_fee", currency: "currency", hoursIncluded: "hours_included", piecesIncluded: "pieces_included", period: "period" });
      if (params.brandId !== undefined) { row.brand_id = params.brandId; row.brand_name = await brandName(sb, ws, params.brandId); }
      if (!params.id && !params.brandId) throw E(-32602, "brandId es requerido para crear");
      return { id: (await save(sb, "workspace_fees", ws, params.id, row, "id")).id };
    }
    case "fee_log": {
      const f = must(await sb.from("workspace_fees").select("hours_used,pieces_delivered,out_of_scope").eq("id", params.id).eq("workspace_id", ws).maybeSingle());
      if (!f) throw E(-32004, "Fee no encontrado");
      const row = { hours_used: num(f.hours_used) + num(params.hours), pieces_delivered: num(f.pieces_delivered) + Math.round(num(params.pieces)) };
      row.out_of_scope = params.clearOutOfScope ? [] : [...(f.out_of_scope || []), ...(params.outOfScope || [])];
      const x = await save(sb, "workspace_fees", ws, params.id, row, "id,hours_used,pieces_delivered,out_of_scope");
      return { id: x.id, hoursUsed: x.hours_used, piecesDelivered: x.pieces_delivered, outOfScope: x.out_of_scope };
    }
    // ── Proyectos ──
    case "list_projects": {
      let q = sb.from("workspace_projects").select("id,name,status,brand_id,brand_name,brief_id,quote_id,playbook_id,starts_on,ends_on,budget,spent,hours_planned,hours_used,progress").eq("workspace_id", ws).order("updated_at", { ascending: false }).limit(200);
      if (params.brandId) q = q.eq("brand_id", params.brandId);
      const projects = must(await q) || [];
      if (params.withTasks && projects.length) {
        const tasks = must(await sb.from("workspace_project_tasks").select("id,project_id,title,kind,status,due").eq("workspace_id", ws).in("project_id", projects.map((p) => p.id)).order("due")) || [];
        projects.forEach((p) => { p.tasks = tasks.filter((t) => t.project_id === p.id); });
      }
      return { projects };
    }
    case "project_save": {
      const row = pick(params, { name: "name", briefId: "brief_id", quoteId: "quote_id", status: "status", startsOn: "starts_on", endsOn: "ends_on", budget: "budget", spent: "spent", hoursPlanned: "hours_planned", hoursUsed: "hours_used", progress: "progress" });
      if (params.brandId !== undefined) { row.brand_id = params.brandId || null; row.brand_name = await brandName(sb, ws, params.brandId); }
      if (!params.id) { if (!params.name) throw E(-32602, "name es requerido para crear"); row.status ||= "Planificando"; row.created_by = uid; }
      return { id: (await save(sb, "workspace_projects", ws, params.id, row, "id")).id };
    }
    case "project_task_save": {
      if (params.delete) return del(sb, "workspace_project_tasks", ws, params.id);
      const row = pick(params, { title: "title", kind: "kind", status: "status", due: "due" });
      if (!params.id) {
        const p = must(await sb.from("workspace_projects").select("id").eq("id", params.projectId || "").eq("workspace_id", ws).maybeSingle());
        if (!p || !params.title) throw E(-32602, "Para crear: projectId válido y title");
        row.project_id = p.id; row.status ||= "todo";
      }
      return { id: (await save(sb, "workspace_project_tasks", ws, params.id, row, "id")).id };
    }
    // ── Formularios ──
    case "list_forms":
      return { forms: (must(await sb.from("workspace_forms").select("id,name,published,response_count,schema,public_token,updated_at").eq("workspace_id", ws).order("updated_at", { ascending: false })) || []).map(({ public_token, schema, ...f }) => ({ ...f, brandId: schema?.brand_id || null, type: schema?.type || null, fields: schema?.fields || [], url: `${origin()}/f/${public_token}` })) };
    case "form_save": {
      const row = pick(params, { name: "name", published: "published" });
      if (params.fields || params.brandId !== undefined || params.type) {
        const cur = params.id ? must(await sb.from("workspace_forms").select("schema").eq("id", params.id).eq("workspace_id", ws).maybeSingle()) : null;
        const schema = { ...(cur?.schema || {}) };
        if (params.brandId !== undefined) { await brandName(sb, ws, params.brandId); schema.brand_id = params.brandId || null; }
        if (params.type) schema.type = params.type;
        if (params.fields) schema.fields = params.fields.map((f) => ({ name: String(f.name), label: f.label || f.name, type: f.type || "text", required: f.required ?? (f.name === "email" || f.name === "nombre") }));
        row.schema = schema;
      }
      if (!params.id) { if (!params.name || !row.schema?.fields?.length) throw E(-32602, "Para crear: name y fields"); row.created_by = uid; row.published ??= false; }
      const f = await save(sb, "workspace_forms", ws, params.id, row, "id,published,public_token");
      return { id: f.id, published: f.published, url: `${origin()}/f/${f.public_token}` };
    }
    case "list_form_responses": {
      const f = must(await sb.from("workspace_forms").select("id").eq("id", params.formId).eq("workspace_id", ws).maybeSingle());
      if (!f) throw E(-32004, "Formulario no encontrado");
      return { responses: must(await sb.from("workspace_form_responses").select("id,data,email,contact_id,created_at").eq("form_id", f.id).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(Math.min(1000, num(params.limit, 200)))) };
    }
    // ── Eventos ──
    case "list_events": {
      const evs = must(await sb.from("workspace_events").select("id,name,date,starts_at,duration_min,platform,link,capacity,brand_id,published,slug").eq("workspace_id", ws).order("starts_at", { ascending: false }).limit(100)) || [];
      const regs = evs.length ? must(await sb.from("workspace_event_regs").select("event_id").eq("workspace_id", ws).in("event_id", evs.map((e) => e.id))) || [] : [];
      return { events: evs.map((e) => ({ ...e, registrations: regs.filter((r) => r.event_id === e.id).length, url: e.published && e.slug ? `${origin()}/e/${e.slug}` : null })) };
    }
    case "list_event_registrations":
      return { registrations: must(await sb.from("workspace_event_regs").select("id,name,email,phone,status,source,created_at").eq("event_id", params.eventId).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(5000)) };
    // ── Mailing ──
    case "list_mailings": {
      let q = sb.from("workspace_mailings").select("id,kind,subject,status,send_at,content,updated_at").eq("workspace_id", ws).order("updated_at", { ascending: false }).limit(200);
      if (params.kind) q = q.eq("kind", params.kind);
      return { mailings: (must(await q) || []).map(({ content: c = {}, ...m }) => ({ ...m, name: c.name || m.subject, brandId: c.brand_id || null, segment: c.seg || (c.groups || [])[0] || null, template: c.tpl || null, hasHtml: !!c.html, steps: c.steps || undefined, sent: c.sent || 0, open: c.open || 0, click: c.click || 0 })) };
    }
    case "get_email_settings":
      return rest(emailCore, auth, "GET", "/api/email/settings", { workspaceId: ws });
    case "mailing_send": {
      const action = params.at ? "schedule" : "send";
      if (params.confirm !== true) return { dryRun: true, ...(await rest(emailCore, auth, "POST", `/api/email/mailings/${params.id}/send`, { workspaceId: ws, dryRun: true })), note: "Nada se envió. Repite con confirm:true cuando la persona lo apruebe." };
      return rest(emailCore, auth, "POST", `/api/email/mailings/${params.id}/${action}`, { workspaceId: ws, at: params.at, offset: params.offset });
    }
    case "mailing_test": {
      let subject = params.subject, html = params.html;
      if (params.id) { const m = must(await sb.from("workspace_mailings").select("subject,content").eq("id", params.id).eq("workspace_id", ws).maybeSingle()); if (!m) throw E(-32004, "Mailing no encontrado"); subject ||= m.subject; html ||= m.content?.html; }
      return rest(emailCore, auth, "POST", "/api/email/test", { workspaceId: ws, to: params.to, subject, html });
    }
    case "sequence_activate":
      if (params.confirm !== true) throw E(-32602, "Requiere confirm:true (activar envía correos reales)");
      return rest(emailCore, auth, "POST", `/api/email/sequences/${params.id}/activate`, { workspaceId: ws });
    case "email_send":
      if (params.confirm !== true) throw E(-32602, "Requiere confirm:true (envía un correo real)");
      return rest(emailCore, auth, "POST", "/api/email/send", { workspaceId: ws, to: params.to, subject: params.subject, html: params.html });
    // ── Clones ──
    case "list_clones": {
      let q = sb.from("workspace_clones").select("id,kind,provider,external_id,name,status,brand_id,preview_url,created_at").eq("workspace_id", ws).order("created_at", { ascending: false });
      if (params.kind) q = q.eq("kind", params.kind);
      return { clones: must(await q) };
    }
    // ── Bandeja ──
    case "inbox_update": {
      const row = {};
      if (params.status) row.status = params.status;
      if (params.assignedTo !== undefined) {
        if (params.assignedTo) { const m = must(await sb.from("workspace_members").select("user_id").eq("workspace_id", ws).eq("user_id", params.assignedTo).maybeSingle()); if (!m) throw E(-32602, "assignedTo no es miembro del espacio"); }
        row.assigned_to = params.assignedTo || null;
      }
      if (!Object.keys(row).length) throw E(-32602, "Nada que cambiar: pasa status y/o assignedTo");
      const x = await save(sb, "social_inbox", ws, params.itemId, row, "id,status,assigned_to");
      return x;
    }
    // ── Anunciar ──
    case "list_ad_campaigns": {
      let a = sb.from("campaigns").select("id,name,status,brand_id,campaign_type,brief,budget_plan_usd,created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(200);
      let b = sb.from("ad_campaigns_ext").select("id,network,external_id,name,status,objective,daily_budget,currency,spend,impressions,clicks,conversions,reach,date_from,date_to,campaign_id,brand_id,synced_at").eq("workspace_id", ws).order("synced_at", { ascending: false }).limit(500);
      if (params.brandId) { a = a.eq("brand_id", params.brandId); b = b.eq("brand_id", params.brandId); }
      const [plan, real] = await Promise.all([a, b]);
      return {
        planned: (must(plan) || []).map(({ brief, ...c }) => { let j = {}; try { j = JSON.parse(brief || "{}"); } catch { /* texto libre */ } return { ...c, network: j.net || null, objective: j.obj || null, notes: j.notes || null }; }),
        real: must(real),
      };
    }
    case "ad_campaign_plan_save": {
      const row = pick(params, { name: "name", status: "status", type: "campaign_type", budgetUsd: "budget_plan_usd" });
      if (params.brandId !== undefined) { await brandName(sb, ws, params.brandId); row.brand_id = params.brandId; }
      if (params.network !== undefined || params.objective !== undefined || params.notes !== undefined) {
        let cur = {};
        if (params.id) { const c = must(await sb.from("campaigns").select("brief").eq("id", params.id).eq("workspace_id", ws).maybeSingle()); try { cur = JSON.parse(c?.brief || "{}"); } catch { cur = {}; } }
        row.brief = JSON.stringify({ net: params.network ?? cur.net ?? "meta", obj: params.objective ?? cur.obj ?? "Ventas", notes: params.notes ?? cur.notes ?? "" });
      }
      if (!params.id) { if (!params.name || !params.brandId) throw E(-32602, "Para crear: name y brandId"); row.id = "campaign_" + hex(16); row.status ||= "active"; row.campaign_type ||= params.network || "meta"; row.budget_plan_usd ??= 0; }
      return { id: (await save(sb, "campaigns", ws, params.id, row, "id")).id };
    }
    case "list_ad_accounts":
      return rest(adsCore, auth, "GET", "/api/ads/accounts", { workspaceId: ws });
    case "ads_sync":
      return rest(adsCore, auth, "POST", "/api/ads/sync", { workspaceId: ws, days: params.days });
    case "ad_campaign_status":
      if (params.confirm !== true) throw E(-32602, "Requiere confirm:true (afecta gasto real)");
      return rest(adsCore, auth, "POST", `/api/ads/campaigns/${params.id}/status`, { workspaceId: ws, action: params.action });
    case "ad_campaign_create":
      return rest(adsCore, auth, "POST", "/api/ads/campaigns/create", { workspaceId: ws, accountRef: params.accountRef, name: params.name, objective: params.objective, dailyBudget: params.dailyBudget, campaignId: params.campaignId, brandId: params.brandId });
    // ── Organización ──
    case "list_org": {
      let ap = sb.from("workspace_approvals").select("id,piece_id,piece_name,piece_type,brand_name,requested_by,status,requested_at,decided_at,area_id,checks,comment").eq("workspace_id", ws).order("requested_at", { ascending: false }).limit(200);
      if (params.approvalStatus) ap = ap.eq("status", params.approvalStatus);
      const [areas, agencies, approvals] = await Promise.all([
        sb.from("workspace_areas").select("id,name,description,lead_name,lead_user_id,member_count,validates,brand_ids").eq("workspace_id", ws).order("created_at"),
        sb.from("workspace_agencies").select("id,name,contact_email,area_ids,sla_hours,access_note,member_count").eq("workspace_id", ws).order("created_at"),
        ap,
      ]);
      return { areas: must(areas), agencies: must(agencies), approvals: must(approvals) };
    }
    case "org_area_save": {
      if (params.delete) return del(sb, "workspace_areas", ws, params.id);
      const row = pick(params, { name: "name", description: "description", leadName: "lead_name", validates: "validates", brandIds: "brand_ids" });
      if (!params.id) { if (!params.name) throw E(-32602, "name es requerido"); row.created_by = uid; }
      return { id: (await save(sb, "workspace_areas", ws, params.id, row, "id")).id };
    }
    case "org_agency_save": {
      if (params.delete) return del(sb, "workspace_agencies", ws, params.id);
      const row = pick(params, { name: "name", contactEmail: "contact_email", areaIds: "area_ids", slaHours: "sla_hours", accessNote: "access_note" });
      if (!params.id) { if (!params.name) throw E(-32602, "name es requerido"); row.created_by = uid; }
      return { id: (await save(sb, "workspace_agencies", ws, params.id, row, "id")).id };
    }
    case "approval_request": {
      const t = must(await sb.from("templates").select("id,name,data->>brandId").eq("id", params.templateId).eq("workspace_id", ws).maybeSingle());
      if (!t) throw E(-32004, "Diseño no encontrado en este espacio");
      const bid = t.brandId || null;
      const bn = bid ? (await sb.from("brands").select("name").eq("id", bid).maybeSingle()).data?.name || null : null;
      const row = { piece_id: t.id, piece_type: "template", piece_name: t.name || "Diseño", brand_name: bn, area_id: params.areaId || null, requested_by: params.requestedBy || "Agente IA", status: "pendiente", requested_at: new Date().toISOString(), created_by: uid };
      return { id: (await save(sb, "workspace_approvals", ws, null, row, "id")).id, status: "pendiente" };
    }
    case "approval_decide": {
      const row = pick(params, { comment: "comment", checks: "checks" });
      if (params.status) { row.status = params.status; row.decided_at = params.status === "pendiente" ? null : new Date().toISOString(); row.decided_by = params.status === "pendiente" ? null : uid; }
      const x = await save(sb, "workspace_approvals", ws, params.id, row, "id,status,decided_at");
      return x;
    }
    // ── Agentes y gobernanza ──
    case "list_agents":
      return { agents: must(await sb.from("workspace_agents").select("id,name,color,role,template,model,os,state,brands,permissions,wake,task,builtin,updated_at").eq("workspace_id", ws).order("created_at")) };
    case "agent_save": {
      if (params.delete) return del(sb, "workspace_agents", ws, params.id);
      const row = pick(params, { name: "name", role: "role", template: "template", model: "model", color: "color", brands: "brands", permissions: "permissions", state: "state", task: "task" });
      if (!params.id) { if (!params.name) throw E(-32602, "name es requerido"); Object.assign(row, { role: row.role || "Agente del equipo", template: row.template || "musa", os: "Linux", state: row.state || "idle", wake: "Solo a pedido (chat)", task: row.task || "Listo · esperando su primera tarea" }); }
      return { id: (await save(sb, "workspace_agents", ws, params.id, row, "id")).id };
    }
    case "list_governance": {
      const [rules, log] = await Promise.all([
        sb.from("agent_governance_rules").select("id,rule,description,enabled,created_at").eq("workspace_id", ws).order("created_at"),
        sb.from("agent_activity_log").select("id,agent_id,agent_name,action,verdict,created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(Math.min(500, num(params.limit, 50))),
      ]);
      return { rules: must(rules), activity: must(log) };
    }
    case "governance_rule_save": {
      if (params.delete) return del(sb, "agent_governance_rules", ws, params.id);
      const row = pick(params, { rule: "rule", description: "description", enabled: "enabled" });
      if (!params.id && !params.rule) throw E(-32602, "rule es requerido");
      return { id: (await save(sb, "agent_governance_rules", ws, params.id, row, "id")).id };
    }
    case "agent_activity_log": {
      const row = { agent_id: params.agentId || null, agent_name: String(params.agentName || auth?.keyLabel || "Agente IA").slice(0, 120), action: String(params.action).slice(0, 500), verdict: params.verdict || "Permitido" };
      return { id: (await save(sb, "agent_activity_log", ws, null, row, "id")).id };
    }
  }
  throw E(-32601, `Herramienta no implementada: ${method}`);
}
