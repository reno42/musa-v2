/** Level-1 migration: file-based import from Trello, Notion, HubSpot or a
 *  plain CSV, mapped onto Musa's own tables by one shared wizard.
 *
 *  Each source resolves to the same shape — a header row plus data rows —
 *  and each Musa table declares the fields it accepts with the aliases its
 *  sources actually use. The wizard auto-maps by alias, the user corrects
 *  in the UI, and the table's own endpoints stay the single writer.
 */
import { norm, parseCsvTable, toIsoDate } from "./tabularCsv";
import { CONTENT_STATUSES } from "./contentCalendar";

export type ImportSourceId = "csv" | "trello" | "notion" | "hubspot";

export interface ImportSource {
  id: ImportSourceId;
  label: string;
  accept: string;
  kind: "csv" | "json";
  hint: string;
}

export const IMPORT_SOURCES: Record<ImportSourceId, ImportSource> = {
  csv: {
    id: "csv", label: "CSV / Excel", accept: ".csv,text/csv", kind: "csv",
    hint: "Columnas separadas por coma, punto y coma o tabulación. La primera fila son los encabezados.",
  },
  trello: {
    id: "trello", label: "Trello (JSON)", accept: ".json,application/json", kind: "json",
    hint: "En Trello: Menú del tablero → … → Exportar → Exportar JSON. Sube ese archivo tal cual.",
  },
  notion: {
    id: "notion", label: "Notion (CSV)", accept: ".csv,text/csv", kind: "csv",
    hint: "En Notion: ••• de la base de datos → Exportar → Formato CSV. Sube el CSV descargado.",
  },
  hubspot: {
    id: "hubspot", label: "HubSpot (CSV)", accept: ".csv,text/csv", kind: "csv",
    hint: "En HubSpot: Contactos → Exportar → CSV. Sirve el export de vistas o de todas las propiedades.",
  },
};

export interface ImportField {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
  hint?: string;
}

// ── Field sets per target table ────────────────────────────────────────────
// Aliases are stored already normalized (norm(): lowercase, no accents) and
// every source header runs through the same norm before matching.

export const KANBAN_FIELDS: ImportField[] = [
  { key: "titulo", label: "Título", required: true, aliases: ["titulo", "title", "nombre", "name", "tarjeta", "card", "tarea", "task"] },
  { key: "lista", label: "Lista / columna de origen", aliases: ["lista", "list", "columna", "column", "estado", "status", "fase"],
    hint: "Contexto: la lista viaja dentro del brief — las tarjetas entran al estado inicial del tablero." },
  { key: "descripcion", label: "Descripción", aliases: ["descripcion", "desc", "description", "brief", "notas", "notes", "detalle"] },
  { key: "fecha", label: "Fecha límite", aliases: ["fecha", "fecha limite", "vencimiento", "vence", "due", "due date", "deadline"] },
  { key: "etiquetas", label: "Etiquetas", aliases: ["etiquetas", "labels", "tags"] },
  { key: "prioridad", label: "Prioridad", aliases: ["prioridad", "priority"] },
];

export const CONTENT_FIELDS: ImportField[] = [
  { key: "fecha", label: "Fecha", required: true, aliases: ["fecha", "dia", "date", "scheduled date", "fecha programada"] },
  { key: "hora", label: "Hora", aliases: ["hora", "time", "hora publicacion"] },
  { key: "tema", label: "Tema", aliases: ["tema", "topic", "titulo", "title", "idea", "nombre", "name"] },
  { key: "copy", label: "Copy", aliases: ["copy", "texto", "text", "caption", "contenido", "content", "post"] },
  { key: "tipo", label: "Tipo (orgánico/ad)", aliases: ["tipo", "kind", "formato", "type"] },
  { key: "estado", label: "Estado", aliases: ["estado", "status", "etapa"] },
  { key: "marca", label: "Marca", aliases: ["marca", "brand", "cliente", "client"] },
  { key: "campana", label: "Campaña", aliases: ["campana", "campaign"] },
  { key: "canales", label: "Canales", aliases: ["canales", "canal", "channels", "channel", "plataforma", "platform"] },
];

export const CONTACT_FIELDS: ImportField[] = [
  { key: "nombre", label: "Nombre", required: true, aliases: ["nombre", "first name", "firstname", "primer nombre", "name", "nombres"] },
  { key: "apellido", label: "Apellido", aliases: ["apellido", "apellidos", "last name", "lastname"] },
  { key: "email", label: "Email", aliases: ["email", "correo", "e-mail", "correo electronico", "mail"] },
  { key: "telefono", label: "Teléfono", aliases: ["telefono", "phone", "whatsapp", "movil", "celular", "phone number"] },
  { key: "cargo", label: "Cargo", aliases: ["cargo", "job title", "jobtitle", "puesto", "rol"] },
  { key: "empresa", label: "Empresa", aliases: ["empresa", "company", "compania", "organization", "organizacion"] },
  { key: "marca", label: "Marca", aliases: ["marca", "brand", "cliente", "client"],
    hint: "Si la marca no existe, se crea sola al importar (así migró el CRM completo)." },
  { key: "etiquetas", label: "Etiquetas", aliases: ["etiquetas", "tags"] },
  { key: "notas", label: "Notas", aliases: ["notas", "notes", "comentario", "comentarios"] },
];

export const BRAND_FIELDS: ImportField[] = [
  { key: "nombre", label: "Nombre de la marca", required: true, aliases: ["nombre", "name", "marca", "brand", "cliente"] },
  { key: "relacion", label: "Relación", aliases: ["relacion", "relationship", "tipo", "tipo de cliente"],
    hint: "«cliente» → client; cualquier otra cosa → lead." },
  { key: "notas", label: "Notas", aliases: ["notas", "notes"] },
];

// ── Content value aliases (mirrors contentCalendar's own import) ───────────

const CONTENT_KIND_ALIASES: Record<string, string> = {
  organico: "organic", organic: "organic", ad: "ad", anuncio: "ad", pauta: "ad", pago: "ad",
};

export function contentKindFrom(raw: string | undefined): string | null {
  const value = norm(raw);
  return CONTENT_KIND_ALIASES[value] || null;
}

const CONTENT_STATUS_BY_NORM = new Map(CONTENT_STATUSES.map(status => [norm(status), status]));

export function contentStatusFrom(raw: string | undefined): string | null {
  return CONTENT_STATUS_BY_NORM.get(norm(raw)) || null;
}

// ── Source → table extraction ──────────────────────────────────────────────

export interface ImportTable { headers: string[]; rows: string[][]; warnings: string[] }

/** A Trello board JSON becomes a pseudo-table: one row per open card, the
 *  list name riding along as its own column. */
function parseTrelloBoard(text: string): ImportTable {
  let board: any;
  try { board = JSON.parse(text); } catch { throw new Error("El archivo no es JSON válido"); }
  const cards = Array.isArray(board?.cards) ? board.cards : null;
  if (!cards) throw new Error("No parece un tablero de Trello (falta «cards»). Exporta: Menú → … → Exportar → JSON.");
  const listNames = new Map<string, string>((board.lists || []).map((l: any) => [String(l.id), String(l.name || "")]));
  const labelNames = new Map<string, string>((board.labels || []).map((l: any) => [String(l.id), String(l.name || l || "")]));
  const rows: string[][] = [];
  let skippedClosed = 0;
  for (const card of cards) {
    if (card.closed) { skippedClosed++; continue; }
    const labels = (Array.isArray(card.labels) ? card.labels : [])
      .map((l: any) => typeof l === "string" ? l : labelNames.get(String(l.id)) || "")
      .filter(Boolean)
      .join(", ");
    rows.push([
      listNames.get(String(card.idList)) || "",
      String(card.name || ""),
      String(card.desc || ""),
      card.due ? toIsoDate(String(card.due)) || "" : "",
      labels,
      String(card.shortUrl || card.url || ""),
    ]);
  }
  const warnings: string[] = [];
  if (skippedClosed > 0) warnings.push(`${skippedClosed} tarjeta(s) archivada(s) omitida(s)`);
  return {
    headers: ["Lista", "Título", "Descripción", "Fecha límite", "Etiquetas", "Enlace"],
    rows,
    warnings,
  };
}

/** Every source lands here: headers + rows + source-level warnings. */
export function extractTable(text: string, sourceId: ImportSourceId): ImportTable {
  if (IMPORT_SOURCES[sourceId].kind === "json") return parseTrelloBoard(text);
  const table = parseCsvTable(text);
  if (table.length === 0) throw new Error("El archivo está vacío");
  const [headers, ...rows] = table;
  const warnings: string[] = [];
  if (rows.length === 0) warnings.push("El archivo solo tiene encabezados, sin filas de datos");
  const width = headers.length;
  const ragged = rows.filter(r => r.length !== width).length;
  if (ragged > 0) warnings.push(`${ragged} fila(s) con columnas de más o de menos — se leen igual`);
  return { headers, rows, warnings };
}

/** Alias matching, two passes: exact hit first, then containment. Returns
 *  field.key → column index (-1 = unmapped, the user picks manually). */
export function autoMap(headers: string[], fields: ImportField[]): Record<string, number> {
  const normed = headers.map(norm);
  const mapping: Record<string, number> = {};
  for (const field of fields) {
    let hit = normed.findIndex(h => h !== "" && field.aliases.includes(h));
    if (hit < 0) hit = normed.findIndex(h => h !== "" && field.aliases.some(a => h.includes(a) || a.includes(h)));
    mapping[field.key] = hit;
  }
  // Two fields must not own the same column — first field (declaration
  // order) wins, the rest stay unmapped for the user to sort out.
  const claimed = new Set<number>();
  for (const field of fields) {
    const col = mapping[field.key];
    if (col >= 0 && !claimed.has(col)) claimed.add(col);
    else if (col >= 0) mapping[field.key] = -1;
  }
  return mapping;
}
