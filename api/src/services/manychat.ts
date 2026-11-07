/**
 * ManyChat — captura automática del bot al CRM.
 *
 * ManyChat (PRO) es el cerebro del bot en Facebook, Instagram, WhatsApp,
 * TikTok y el sitio web embebido. No tiene webhook nativo «push todo»: el
 * usuario agrega un bloque «External Request» a sus flows apuntando a
 * /api/content/webhooks/manychat/:connectionId con el header x-musa-secret,
 * y cada toque del bot llega acá. La ruta:
 *
 * 1. Guarda el evento crudo en social_inbox (idempotente por provider,
 *    external_id — redeliveries y reintentos no duplican).
 * 2. Resuelve la persona: teléfono exacto > email exacto > channel_ids
 *    (manychat:<canal>:<id>) > nombre completo exacto — SOLO contra contactos
 *    con tag «manychat» del MISMO ámbito de marca: las conexiones atadas a una
 *    marca matchean contactos de esa marca; las de agencia (sin marca), solo
 *    contactos sin marca. La data del cliente jamás se mezcla con la agencia.
 * 3. Crea o actualiza el contacto (tags, custom_fields y channel_ids se
 *    fusionan; lo que el equipo escribió a mano nunca se pisa).
 * 4. Deja el touchpoint en el timeline (crm_interactions) — best-effort.
 * 5. Atribución crm_signals SOLO si la conexión está atada a una marca —
 *    best-effort.
 *
 * Las funciones puras (parse/match/merge/build) viven separadas de las
 * llamadas API para que las pruebas de QA las importen sin DB. Degradación
 * con gracia: si la migración 26 no corrió, la captura funciona igual sin
 * custom_fields/channel_ids y la interacción cae a «otro» con avisos.
 */
import crypto from "node:crypto";

/** Eventos que entiende el webhook — todo lo demás llega como «message». */
export type ManyChatEventType = "message" | "comment" | "story_reply" | "form";

export interface ManyChatEvent {
  /** Canal normalizado (facebook, instagram, whatsapp, tiktok, website…). */
  channel: string;
  eventType: ManyChatEventType;
  /** El valor crudo que ManyChat mandó en eventType — se conserva en data. */
  rawEventType: string | null;
  /** Id del suscriptor ManyChat — el ancla de la identidad por canal. */
  subscriberId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: Record<string, string>;
  /** Contenido del mensaje/comentario/formulario (puede ser null). */
  text: string | null;
  /** ISO — cuándo ocurrió el toque, no cuándo llegó el webhook. */
  occurredAt: string;
  permalink: string | null;
}

export interface ManyChatConnectionConfig {
  brandId?: string | null;
  brandName?: string | null;
  channel?: string | null;
}

export interface ManyChatConnectionSecret {
  apiKey: string;
  webhookSecret?: string;
}

export interface ManyChatCaptureResult {
  duplicate: boolean;
  externalId: string;
  contactId: string | null;
  matchedBy: "phone" | "email" | "channel" | "name" | null;
  inboxStored: boolean;
  interactionStored: boolean;
  signalStored: boolean;
  warnings: string[];
}

/* ═══════════════ normalización (puras) ═══════════════ */

const KNOWN_CHANNELS = new Set([
  "facebook", "instagram", "whatsapp", "tiktok", "telegram", "sms", "email", "website",
]);

function slug(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Canal tolerante: alias comunes (fb, ig, wa, tt) y todo lo no conocido se
 *  conserva normalizado — el evento nunca se pierde por una etiqueta rara. */
export function normalizeManyChatChannel(value: unknown): string | null {
  const raw = slug(value);
  if (!raw) return null;
  if (raw === "fb" || raw === "messenger") return "facebook";
  if (raw === "ig") return "instagram";
  if (raw === "wa") return "whatsapp";
  if (raw === "tt") return "tiktok";
  if (raw === "web" || raw === "webchat" || raw === "site") return "website";
  return raw.slice(0, 30);
}

export function isKnownManyChatChannel(value: string): boolean {
  return KNOWN_CHANNELS.has(value);
}

export function normalizeManyChatEventType(value: unknown): ManyChatEventType {
  const raw = slug(value).replace(/[\s-]+/g, "_");
  if (raw === "comment" || raw === "comentario") return "comment";
  if (raw === "story_reply" || raw === "story" || raw === "storyreply") return "story_reply";
  if (raw === "form" || raw === "form_web" || raw === "formulario") return "form";
  return "message";
}

/** Etiqueta humana del evento para notas y vista. */
export function manyChatEventTypeLabel(eventType: ManyChatEventType): string {
  return { message: "mensaje", comment: "comentario", story_reply: "respuesta a story", form: "formulario web" }[eventType];
}

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** El external_id cruda el evento completo — mismo evento reenviado = misma
 *  fila (la unique provider,external_id de social_inbox hace el resto). */
export function manyChatExternalId(connectionId: string, event: Pick<ManyChatEvent, "subscriberId" | "eventType" | "text" | "occurredAt">): string {
  const hash = crypto.createHash("sha256")
    .update(`${connectionId}|${event.subscriberId}|${event.eventType}|${event.text ?? ""}|${event.occurredAt}`)
    .digest("hex")
    .slice(0, 32);
  return `manychat:${hash}`;
}

/** La referencia de identidad cruzada: manychat:<canal>:<suscriptor>. */
export function manyChatChannelRef(channel: string, subscriberId: string): string {
  return `manychat:${channel}:${subscriberId}`.slice(0, 120);
}

export function cleanManyChatTags(values: unknown): string[] {
  const raw = Array.isArray(values) ? values : [];
  const out: string[] = [];
  for (const item of raw) {
    const tag = typeof item === "string" ? item : String((item as any)?.name ?? (item as any)?.tag ?? "");
    const clean = tag.trim().slice(0, 40);
    if (clean) out.push(clean);
    if (out.length >= 30) break;
  }
  return [...new Set(out)];
}

/** Custom fields: objeto directo o array ManyChat [{name|field_name, value}] —
 *  valores a texto (≤500) y claves limpias; lo no-serializable se descarta. */
export function cleanManyChatCustomFields(values: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!values) return out;
  const entries: Array<[string, unknown]> = Array.isArray(values)
    ? values.map((item: any) => [String(item?.name ?? item?.field_name ?? ""), item?.value])
    : Object.entries(values as Record<string, unknown>);
  for (const [rawKey, rawValue] of entries.slice(0, 40)) {
    const key = String(rawKey || "").trim().slice(0, 60);
    if (!key || rawValue == null || typeof rawValue === "object") continue;
    out[key] = String(rawValue).slice(0, 500);
  }
  return out;
}

/** El cuerpo del External Request lo arma el usuario mapeando variables de
 *  ManyChat: aceptamos las variantes razonables del contrato documentado. */
export function parseManyChatEvent(body: unknown): { ok: true; event: ManyChatEvent } | { ok: false; error: string } {
  const payload = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, any>;
  const contact = (payload.contact && typeof payload.contact === "object" ? payload.contact : null)
    || (payload.subscriber && typeof payload.subscriber === "object" ? payload.subscriber : null) || {};
  const subscriberId = String(contact.id ?? payload.subscriberId ?? payload.contactId ?? payload.id ?? "").trim();
  if (!subscriberId) {
    return { ok: false, error: "El body necesita el id del suscriptor: { contact: { id } } (o contactId/subscriberId)" };
  }
  const channel = normalizeManyChatChannel(payload.channel ?? payload.platform) || "facebook";
  const rawEventType = typeof payload.eventType === "string" && payload.eventType.trim()
    ? payload.eventType.trim().slice(0, 40)
    : (typeof payload.event === "string" && payload.event.trim() ? payload.event.trim().slice(0, 40) : null);
  const occurredAt = toIso(payload.occurredAt ?? payload.timestamp ?? payload.date) || new Date().toISOString();
  const text = typeof payload.text === "string" && payload.text.trim() ? payload.text.trim().slice(0, 4000)
    : (typeof payload.message === "string" && payload.message.trim() ? payload.message.trim().slice(0, 4000) : null);
  const permalink = cleanUrl(payload.permalink ?? payload.url);
  return {
    ok: true,
    event: {
      channel,
      eventType: normalizeManyChatEventType(rawEventType ?? payload.type),
      rawEventType,
      subscriberId: subscriberId.slice(0, 120),
      firstName: cleanText(contact.firstName ?? contact.first_name ?? payload.firstName, 80),
      lastName: cleanText(contact.lastName ?? contact.last_name ?? payload.lastName, 80),
      email: cleanEmailOr(contact.email ?? payload.email),
      phone: cleanText(contact.phone ?? contact.phone_number ?? payload.phone, 40),
      tags: cleanManyChatTags(contact.tags ?? payload.tags),
      customFields: cleanManyChatCustomFields(contact.customFields ?? contact.custom_fields ?? payload.customFields),
      text,
      occurredAt,
      permalink,
    },
  };
}

function cleanText(value: unknown, max: number): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function cleanEmailOr(value: unknown): string | null {
  const s = normalizeEmail(value);
  return /.+@.+\..+/.test(s) ? s : null;
}

function cleanUrl(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return /^https?:\/\//.test(s) ? s.slice(0, 500) : null;
}

function toIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000; // ms vs segundos
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ═══════════════ identidad (puras) ═══════════════ */

export interface MatchableManyChatContact {
  id: string;
  brand_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  channel_ids?: string[] | null;
  tags?: string[] | null;
  custom_fields?: Record<string, unknown> | null;
}

export type ManyChatMatchBy = "phone" | "email" | "channel" | "name";

/**
 * Teléfono exacto > email exacto > channel_ids > nombre completo exacto —
 * en ese orden y solo contra contactos ya capturados por ManyChat (tag
 * «manychat»). Sin match devuelve null; la ruta crea el contacto nuevo.
 */
export function matchManyChatContact(
  identity: { phone?: string | null; email?: string | null; channelRef?: string | null; name?: string | null },
  contacts: MatchableManyChatContact[],
): { contact: MatchableManyChatContact | null; matchedBy: ManyChatMatchBy | null } {
  const phone = normalizePhone(identity.phone);
  // Mínimo 8 dígitos en AMBOS lados: teléfonos parciales no unifican personas.
  if (phone.length >= 8) {
    const hit = contacts.find((c) => normalizePhone(c.phone) === phone && normalizePhone(c.phone).length >= 8);
    if (hit) return { contact: hit, matchedBy: "phone" };
  }
  const email = normalizeEmail(identity.email);
  if (email) {
    const hit = contacts.find((c) => normalizeEmail(c.email) === email);
    if (hit) return { contact: hit, matchedBy: "email" };
  }
  if (identity.channelRef) {
    const hit = contacts.find((c) => (c.channel_ids || []).includes(identity.channelRef!));
    if (hit) return { contact: hit, matchedBy: "channel" };
  }
  const name = normalizeName(identity.name || "");
  if (name) {
    const hit = contacts.find((c) => normalizeName(`${c.first_name || ""} ${c.last_name || ""}`) === name);
    if (hit) return { contact: hit, matchedBy: "name" };
  }
  return { contact: null, matchedBy: null };
}

/** Tags fusionadas: manychat primero, luego el canal, luego lo que ya tenía el
 *  contacto y lo que manda el evento — sin duplicados. */
export function mergeManyChatTags(existing: string[] | null | undefined, channel: string, incoming: string[] | null | undefined): string[] {
  return [...new Set(["manychat", channel, ...(existing || []), ...(incoming || [])])].slice(0, 40);
}

export function mergeManyChatChannelIds(existing: string[] | null | undefined, channelRef: string): string[] {
  return [...new Set([channelRef, ...(existing || [])])].slice(0, 30);
}

export function mergeManyChatCustomFields(existing: Record<string, unknown> | null | undefined, incoming: Record<string, string>): Record<string, string> {
  // Lo guardado manda como base (valores no-texto se descartan); lo nuevo del
  // evento gana en las claves que toca.
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing || {})) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return { ...out, ...incoming };
}

/* ═══════════════ API de ManyChat (best-effort) ═══════════════ */

function manyChatBase(endpointUrl?: string | null): string {
  return String(endpointUrl || "https://api.manychat.com").replace(/\/+$/, "");
}

/** Valida el token contra la API real (GET /fb/page). Devuelve el nombre de
 *  la página conectada o lanza con un mensaje accionable. */
export async function validateManyChatToken(apiKey: string, endpointUrl?: string | null, fetcher: typeof fetch = fetch): Promise<string | null> {
  let response: Response;
  try {
    response = await fetcher(`${manyChatBase(endpointUrl)}/fb/page`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("No se pudo contactar la API de ManyChat (¿token PRO activo y red OK?)");
  }
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Token de ManyChat inválido: revísalo en ManyChat › Settings › API"
      : `ManyChat respondió HTTP ${response.status}`);
  }
  const page = payload?.data;
  return typeof page?.name === "string" && page.name ? page.name.slice(0, 120) : null;
}

/** Enriquecimiento best-effort del suscriptor (GET /fb/subscriber/{id}) —
 *  rellena email/teléfono/nombre/tags que el webhook no trajo. Cualquier
 *  fallo (canal sin endpoint fb, 404, timeout) devuelve null sin ruido. */
export async function fetchManyChatSubscriber(
  apiKey: string,
  subscriberId: string,
  endpointUrl?: string | null,
  fetcher: typeof fetch = fetch,
): Promise<{ email?: string; phone?: string; firstName?: string; lastName?: string; tags?: string[] } | null> {
  try {
    const response = await fetcher(`${manyChatBase(endpointUrl)}/fb/subscriber/${encodeURIComponent(subscriberId)}`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({})) as any;
    const data = payload?.data;
    if (!data || typeof data !== "object") return null;
    return {
      email: typeof data.email === "string" && data.email.includes("@") ? data.email : undefined,
      phone: typeof data.phone === "string" && data.phone ? data.phone : (typeof data.phone_number === "string" && data.phone_number ? data.phone_number : undefined),
      firstName: typeof data.first_name === "string" && data.first_name ? data.first_name : undefined,
      lastName: typeof data.last_name === "string" && data.last_name ? data.last_name : undefined,
      tags: Array.isArray(data.tags) ? data.tags.map((t: any) => (typeof t === "string" ? t : String(t?.name ?? ""))).filter(Boolean) : undefined,
    };
  } catch {
    return null;
  }
}

export function newManyChatWebhookSecret(): string {
  return `whs_${crypto.randomBytes(24).toString("base64url")}`;
}

/** Comparación en tiempo constante del secreto del webhook. */
export function manyChatSecretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ═══════════════ captura (orchestrator) ═══════════════ */

interface ConnectionRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  endpoint_url?: string | null;
  public_config?: ManyChatConnectionConfig | null;
}

const CONTACT_COLS_FULL = "id, brand_id, first_name, last_name, email, phone, tags, channel_ids, custom_fields";
// Sin migración 26: mismas columnas de siempre — la captura no se rompe.
const CONTACT_COLS_LEGACY = "id, brand_id, first_name, last_name, email, phone, tags";

/**
 * El pipeline completo de un evento ManyChat → CRM. Todo lo CRM es
 * best-effort: social_inbox es la verdad (si falla el resto, el evento queda
 * guardado y los avisos viajan en warnings).
 */
export async function captureManyChatEvent(
  sb: any,
  connection: ConnectionRow,
  credentials: ManyChatConnectionSecret,
  event: ManyChatEvent,
): Promise<ManyChatCaptureResult> {
  const warnings: string[] = [];
  const config = connection.public_config || {};
  const brandScope = config.brandId || null;
  const channelRef = manyChatChannelRef(event.channel, event.subscriberId);
  const externalId = manyChatExternalId(connection.id, event);
  const result: ManyChatCaptureResult = {
    duplicate: false, externalId, contactId: null, matchedBy: null,
    inboxStored: false, interactionStored: false, signalStored: false, warnings,
  };

  // Idempotencia primero: si el evento ya entró, no se re-captura la persona.
  const { data: seen } = await sb.from("social_inbox")
    .select("id, crm_contact_id").eq("provider", "manychat").eq("external_id", externalId).maybeSingle();
  if (seen) {
    result.duplicate = true;
    result.contactId = seen.crm_contact_id ?? null;
    return result;
  }

  // Enriquecimiento: el webhook manda lo esencial; la API rellena huecos
  // (email/teléfono/tags) para que la identidad cruce mejor. Webhook gana.
  const enriched = await fetchManyChatSubscriber(credentials.apiKey, event.subscriberId, connection.endpoint_url);
  const email = event.email || enriched?.email || null;
  const phone = event.phone || enriched?.phone || null;
  const firstName = event.firstName || enriched?.firstName || null;
  const lastName = event.lastName || enriched?.lastName || null;
  if (enriched?.tags?.length) event.tags = [...new Set([...event.tags, ...enriched.tags])].slice(0, 30);

  // 1) social_inbox — la entrada cruda del evento (bandeja + auditoría).
  const { error: inboxError } = await sb.from("social_inbox").upsert({
    workspace_id: connection.workspace_id,
    connection_id: connection.id,
    provider: "manychat",
    external_id: externalId,
    kind: event.eventType,
    platform: event.channel,
    author_name: [firstName, lastName].filter(Boolean).join(" ") || null,
    author_email: email,
    content: event.text,
    occurred_at: event.occurredAt,
    raw: { ...event, connectionId: connection.id, channelRef, brandId: brandScope },
  }, { onConflict: "provider,external_id", ignoreDuplicates: true });
  if (inboxError) {
    warnings.push(`El evento no pudo guardarse en la bandeja: ${inboxError.message}`);
    console.warn("[manychat] social_inbox upsert failed:", inboxError.message);
  } else {
    result.inboxStored = true;
  }

  // 2) Identidad: match solo dentro del ámbito de marca de la conexión.
  const baseQuery = (cols: string) => {
    let q = sb.from("crm_contacts").select(cols)
      .eq("workspace_id", connection.workspace_id)
      .contains("tags", ["manychat"]);
    if (brandScope) q = q.eq("brand_id", brandScope);
    else q = q.is("brand_id", null);
    return q;
  };
  // Columnas nuevas con gracia: si la migración 26 no corrió, la select con
  // channel_ids/custom_fields falla y se reintenta con las de siempre.
  const attemptCandidates = async (cols: string): Promise<MatchableManyChatContact[] | null> => {
    const { data, error } = await baseQuery(cols).limit(500);
    return error && cols === CONTACT_COLS_FULL ? null : (data || []);
  };
  const candidates = ((await attemptCandidates(CONTACT_COLS_FULL)) ?? (await attemptCandidates(CONTACT_COLS_LEGACY)));

  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const match = matchManyChatContact({ phone, email, channelRef, name: displayName }, candidates || []);
  const nowIso = new Date().toISOString();
  const contactTags = mergeManyChatTags(match.contact?.tags, event.channel, event.tags);
  const channelIds = mergeManyChatChannelIds(match.contact?.channel_ids, channelRef);
  const customFields = match.contact && "custom_fields" in match.contact
    ? mergeManyChatCustomFields(match.contact.custom_fields as Record<string, unknown> | null, event.customFields)
    : event.customFields;

  let contact: MatchableManyChatContact | null = match.contact;
  let degradedColumns = false;
  if (contact) {
    result.matchedBy = match.matchedBy;
    // Update: lo existente manda — el webhook solo rellena huecos y suma
    // tags/custom_fields/channel_ids. La marca nunca se re-attempta.
    const patchFull: Record<string, unknown> = {
      first_name: (!contact.first_name || contact.first_name === "Sin nombre") && firstName ? firstName : contact.first_name,
      last_name: contact.last_name || lastName || null,
      email: contact.email || email,
      phone: contact.phone || phone,
      tags: contactTags,
      channel_ids: channelIds,
      custom_fields: customFields,
      updated_at: nowIso,
    };
    const patchLegacy: Record<string, unknown> = {
      first_name: patchFull.first_name, last_name: patchFull.last_name,
      email: patchFull.email, phone: patchFull.phone, tags: contactTags, updated_at: nowIso,
    };
    let { error } = await sb.from("crm_contacts").update(patchFull).eq("id", contact.id);
    if (error) {
      degradedColumns = true;
      ({ error } = await sb.from("crm_contacts").update(patchLegacy).eq("id", contact.id));
    }
    if (error) warnings.push(`El contacto ${contact.id} no pudo actualizarse: ${error.message}`);
  } else {
    const localPart = email ? email.split("@")[0].replace(/[._-]+/g, " ").slice(0, 40) : "";
    const insertFull: Record<string, unknown> = {
      workspace_id: connection.workspace_id,
      first_name: firstName || localPart || "Sin nombre",
      last_name: lastName,
      email,
      phone,
      status: "lead",
      tags: contactTags,
      channel_ids: channelIds,
      custom_fields: customFields,
      brand_id: brandScope,
      brand_name: config.brandName || null,
      origin_source: "manychat",
      notes: `Capturado desde ManyChat — ${manyChatEventTypeLabel(event.eventType)}${event.channel ? ` en ${event.channel}` : ""}${event.text ? `: ${event.text.slice(0, 280)}` : ""}`,
      created_by: connection.created_by,
    };
    const insertLegacy: Record<string, unknown> = { ...insertFull };
    delete insertLegacy.channel_ids;
    delete insertLegacy.custom_fields;
    let created: any = null;
    let { data, error } = await sb.from("crm_contacts").insert(insertFull).select("id").single();
    if (error) {
      degradedColumns = true;
      ({ data, error } = await sb.from("crm_contacts").insert(insertLegacy).select("id").single());
    }
    if (error) {
      warnings.push(`No se pudo crear el contacto: ${error.message}`);
      console.warn("[manychat] crm_contacts insert failed:", error.message);
    } else {
      created = data;
      contact = created;
    }
  }
  if (degradedColumns) {
    warnings.push("Esta base aún no corrió la migración 26: el contacto se guardó sin custom_fields ni channel_ids.");
  }
  result.contactId = contact?.id ?? null;

  // 3) Timeline — el touchpoint en la ficha (tipo según el evento; cae a
  //    «otro» si el CHECK viejo aún no conoce los tipos nuevos).
  if (contact) {
    const interactionData = {
      origin: "manychat_webhook",
      channel: event.channel,
      eventType: event.eventType,
      rawEventType: event.rawEventType,
      subscriberId: event.subscriberId,
      channelRef,
      permalink: event.permalink,
      occurredAt: event.occurredAt,
    };
    const base = {
      workspace_id: connection.workspace_id,
      brand_id: (contact as any).brand_id ?? brandScope ?? null,
      contact_id: contact.id,
      notes: event.text || `${manyChatEventTypeLabel(event.eventType)} vía ManyChat${event.channel ? ` (${event.channel})` : ""}`,
      interaction_date: event.occurredAt,
      data: interactionData,
      created_by: connection.created_by,
    };
    const attemptInteraction = async (type: string) => {
      const { error } = await sb.from("crm_interactions").insert({ ...base, interaction_type: type });
      return error;
    };
    const mappedType = { message: "mensaje", comment: "comentario", story_reply: "story_reply", form: "form_web" }[event.eventType];
    let interactionError = await attemptInteraction(mappedType);
    if (interactionError) interactionError = await attemptInteraction("otro");
    if (interactionError) {
      warnings.push("La interacción no pudo registrarse en el timeline.");
      console.warn("[manychat] crm_interactions insert failed:", interactionError.message);
    } else {
      result.interactionStored = true;
    }

    // Link de vuelta en la bandeja (best-effort, no molesta si falla).
    void sb.from("social_inbox").update({ crm_contact_id: contact.id })
      .eq("provider", "manychat").eq("external_id", externalId);

    // 4) Atribución — SOLO conexiones atadas a marca (crm_signals.brand_id es
    //    NOT NULL y la agencia no atribuye capturas sin marca).
    if (brandScope) {
      const signalType = { message: "dm", comment: "comentario", story_reply: "story_reply", form: "otro" }[event.eventType];
      const { error: signalError } = await sb.from("crm_signals").insert({
        workspace_id: connection.workspace_id,
        brand_id: brandScope,
        contact_id: contact.id,
        signal_type: signalType,
        confidence: "directa",
        external_ref: externalId,
        occurred_at: event.occurredAt,
        data: interactionData,
      });
      if (signalError) {
        warnings.push("La señal de atribución no pudo registrarse.");
        console.warn("[manychat] crm_signals insert failed:", signalError.message);
      } else {
        result.signalStored = true;
      }
    }
  }

  return result;
}
