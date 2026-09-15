/** Shared tabular plumbing for the CSV era: delimiter-sniffing parser,
 *  serializer, download helper and the small coercions every importer needs
 *  (dates people actually type, tag lists, priorities).
 *
 *  Self-contained on purpose — contentCalendar.parseCsv stays comma-only for
 *  its template round-trip; this one must survive whatever Excel, Notion and
 *  HubSpot export: `,` or `;` delimiters, tabs, BOM, CRLF, quoted fields.
 */
import { downloadBlob } from "./download";

/** Accent-stripped lowercase — the key every alias match runs through, so
 *  "Campaña", "campana" and "CAMPAÑA " all find the same field. */
export function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function countIn(line: string, ch: string): number {
  let count = 0, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) count++;
  }
  return count;
}

/** The header line decides: whatever separator carries the most unquoted
 *  hits wins. A file that uses none stays comma (the CSV default). */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t"];
  let best = ","; let bestCount = 0;
  for (const ch of candidates) {
    const count = countIn(firstLine, ch);
    if (count > bestCount) { best = ch; bestCount = count; }
  }
  return best;
}

/** RFC-4180 enough: quoted fields, "" escapes, CRLF, Excel's BOM, and the
 *  delimiter sniffed per file. Pure — a broken parser here eats someone's
 *  migration. */
export function parseCsvTable(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = sniffDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = "";
    // A line of pure emptiness is a blank line, not a row of one empty cell.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const csvEscape = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** BOM first: Excel misdetects UTF-8 without it and accents garble. */
export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const lines = [headers, ...rows.map(r => headers.map((_, i) => r[i]))]
    .map(line => line.map(csvEscape).join(","));
  downloadBlob(new Blob(["\uFEFF" + lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" }), filename);
}

/** Dates people actually type → YYYY-MM-DD. ISO timestamps truncate; DD/MM
 *  wins the ambiguous slash form (the office writes it that way); bare
 *  5-digit numbers are Excel serials. Returns null when nothing parses —
 *  the caller decides whether that skips the row. */
export function toIsoDate(raw: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const slash = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{5}$/.test(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** "a, b; c | d" → ["a","b","c","d"] — every source writes lists differently. */
export function splitTags(raw: string): string[] {
  return (raw || "")
    .split(/[,;|]/)
    .map(part => part.trim())
    .filter(Boolean);
}

/** Urgente/Alta/high/1 → 1 … Baja/low/3 → 3; anything else stays null and
 *  the table keeps its default priority. */
export function priorityFrom(raw: string): number | null {
  const value = norm(raw);
  if (!value) return null;
  if (/^(1|urgente?|urgent|alta?|high|critica|crítica)$/.test(value)) return 1;
  if (/^(3|baja?|low|minima|mínima)$/.test(value)) return 3;
  if (/^(2|normal|media?|medium)$/.test(value)) return 2;
  return null;
}
