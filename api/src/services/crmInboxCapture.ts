/**
 * REQ-029 Item 3 — la cadena captura → timeline.
 *
 * Capturar un autor de la Bandeja social (Zernio) debe dejar un touchpoint en
 * el timeline de la persona, y capturar dos veces al mismo autor no debe
 * duplicar personas. Las dos piezas que lo hacen son funciones PURAS (los
 * tests de QA las importan sin DB):
 *
 * - matchCapturedContact: dado un item de la bandeja y los contactos ya
 *   capturados del workspace, decide si el autor ya tiene contacto — email
 *   exacto, luego handle (los captures previos lo guardan como «(@handle)»
 *   en las notas), luego nombre completo normalizado. Nunca fuzzy.
 * - buildCaptureInteraction: arma la fila de crm_interactions — tipo
 *   «comentario», notas = contenido original, y en data (JSONB de v45) el
 *   origen completo para que la ficha pueda enlazar «Ver en {platform}» /
 *   «Ver en Bandeja».
 */

/** Columnas mínimas de un item de social_inbox para matchear/serializar. */
export interface CapturableInboxItem {
  id: string;
  kind?: string | null;
  platform?: string | null;
  author_name?: string | null;
  author_handle?: string | null;
  author_email?: string | null;
  content?: string | null;
  occurred_at?: string | null;
  raw?: unknown;
}

/** Columnas mínimas de un contacto ya capturado para el matching. */
export interface MatchableContact {
  id: string;
  brand_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

export type CaptureMatchBy = "email" | "handle" | "name";

/** Un contacto «capturado de la Bandeja» es el que lleva el tag zernio —
 *  la única marca que el endpoint de captura deja (los manuales no). */
export function isCapturedFromInbox(contact: Pick<MatchableContact, "tags">): boolean {
  return (contact.tags || []).some((tag) => String(tag).trim().toLocaleLowerCase() === "zernio");
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Email exacto > handle exacto > nombre completo exacto — en ese orden y solo
 * contra contactos capturados de la Bandeja. Sin match devuelve null; la ruta
 * crea un contacto nuevo como siempre.
 */
export function matchCapturedContact(
  item: Pick<CapturableInboxItem, "author_email" | "author_handle" | "author_name">,
  contacts: MatchableContact[],
): { contact: MatchableContact | null; matchedBy: CaptureMatchBy | null } {
  const candidates = contacts.filter((contact) => isCapturedFromInbox(contact));
  const email = typeof item.author_email === "string" ? item.author_email.trim().toLocaleLowerCase() : "";
  if (email) {
    const byEmail = candidates.find((contact) => typeof contact.email === "string" && contact.email.trim().toLocaleLowerCase() === email);
    if (byEmail) return { contact: byEmail, matchedBy: "email" };
  }
  const handle = typeof item.author_handle === "string" ? item.author_handle.trim().replace(/^@+/, "").toLocaleLowerCase() : "";
  if (handle) {
    const byHandle = candidates.find((contact) => typeof contact.notes === "string" && contact.notes.toLocaleLowerCase().includes(`(@${handle})`));
    if (byHandle) return { contact: byHandle, matchedBy: "handle" };
  }
  const name = normalizeName(item.author_name || "");
  if (name) {
    const byName = candidates.find((contact) => normalizeName(`${contact.first_name || ""} ${contact.last_name || ""}`) === name);
    if (byName) return { contact: byName, matchedBy: "name" };
  }
  return { contact: null, matchedBy: null };
}

/** El permalink que el sync/webhook guardó en raw (postUrl como fallback) —
 *  sin permalink la interacción no lleva link, nunca uno inventado. */
export function inboxItemPermalink(item: Pick<CapturableInboxItem, "raw">): string | null {
  const rawItem = (item.raw || {}) as { permalink?: string | null; postUrl?: string | null };
  return rawItem.permalink || rawItem.postUrl || null;
}

/**
 * Fila de crm_interactions para una captura: un touchpoint «comentario» con
 * el contenido original en notes y el origen en data. brand_id puede ser null
 * (v58): si el contacto reusado no tiene marca, el touchpoint igual vive en SU
 * timeline. interaction_date respeta el occurred_at del item — el touchpoint
 * ocurrió cuando ocurrió el comentario, no cuando se capturó.
 */
export function buildCaptureInteraction(
  item: CapturableInboxItem,
  contact: Pick<MatchableContact, "id" | "brand_id">,
  workspaceId: string,
) {
  const permalink = inboxItemPermalink(item);
  const occurredAt = typeof item.occurred_at === "string" && item.occurred_at ? item.occurred_at : new Date().toISOString();
  return {
    workspace_id: workspaceId,
    // v58 (CRM-001): null válido — la base vieja (NOT NULL) degrada con aviso.
    brand_id: contact.brand_id ?? null,
    contact_id: contact.id,
    interaction_type: "comentario",
    notes: item.content ? String(item.content) : null,
    interaction_date: occurredAt,
    data: {
      origin: "zernio_inbox",
      platform: item.platform || null,
      itemId: item.id,
      permalink,
      occurredAt,
    },
  };
}
