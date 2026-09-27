/**
 * Pure helpers for the "person story" ficha (REQ-029 Item 1 / REQ-030 Item 1).
 *
 * CRM-002 root cause: the ficha header painted brand-level counters
 * (brand.interaction_count, brand.last_contacted_at) while the timeline
 * filtered by contact_id — two sources, two numbers. Everything here is
 * computed from ONE source: the per-contact interactions list the ficha
 * already fetches (?contactId=). Brand-level numbers stay in the brand ficha,
 * labeled as such.
 */

export type StoryInteraction = {
  id: string;
  interaction_type: string;
  notes?: string | null;
  interaction_date: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since a timestamp (or null when there is no value). */
export function daysSincePerson(value?: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

/**
 * Last contact OF THE PERSON: the newest touchpoint in her own timeline.
 * The server sends the list ordered desc; take the max anyway — one bad
 * ordering must not resurrect the brand-level lie (CRM-002).
 */
export function personLastContact(interactions: StoryInteraction[]): string | null {
  let newest: string | null = null;
  for (const interaction of interactions) {
    if (!newest || interaction.interaction_date > newest) newest = interaction.interaction_date;
  }
  return newest;
}

/**
 * Origin chip: where this contact came from. Capture tags the contact with
 * `zernio` (+ platform) at capture time; a hand-typed contact has no such
 * tag → "Manual". Never guessed beyond the tags themselves.
 */
export function personOriginLabel(tags?: string[] | null): string {
  const clean = (tags || []).map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
  if (clean.includes("zernio")) return "Bandeja Zernio";
  const social = clean.find((tag) => !["lead", "cliente", "client", "crm"].includes(tag));
  return social ? `Social · ${social}` : "Manual";
}

const DAY_FMT = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short" });

function fmtDay(value: string): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? DAY_FMT.format(new Date(time)) : value;
}

/**
 * One-line history (REQ-029: the ficha must be readable in ≤10 seconds):
 * what the person did, where she came from, what is open. Built ONLY from
 * the person's interactions and deals — never from brand counters, so header
 * and timeline can never disagree again (CRM-002 regression guard).
 */
export function buildPersonStory(input: {
  interactions: StoryInteraction[];
  dealsCount: number;
  brandName?: string | null;
  capturedFromInbox?: boolean;
}): string {
  const { interactions, dealsCount, brandName, capturedFromInbox } = input;
  const parts: string[] = [];
  const comments = interactions.filter((interaction) => interaction.interaction_type === "comentario");
  if (comments.length > 0) {
    const dates = comments.map((interaction) => interaction.interaction_date).sort();
    const range = dates.length > 1 ? ` (${fmtDay(dates[0])} — ${fmtDay(dates[dates.length - 1])})` : ` (${fmtDay(dates[0])})`;
    parts.push(`Comentó ${comments.length} ${comments.length === 1 ? "vez" : "veces"} en ${brandName ? `contenido de ${brandName}` : "las publicaciones"}${range}`);
  } else if (interactions.length > 0) {
    const dates = interactions.map((interaction) => interaction.interaction_date).sort();
    parts.push(`${interactions.length} interacción${interactions.length === 1 ? "" : "es"} registrada${interactions.length === 1 ? "" : "s"} desde ${fmtDay(dates[0])}`);
  }
  if (capturedFromInbox) parts.push("Capturado desde la Bandeja");
  parts.push(dealsCount > 0 ? `${dealsCount} deal${dealsCount === 1 ? "" : "s"} en el pipeline` : "Sin deals");
  return parts.join(" · ");
}
