/**
 * Content Machine sheet — the CSV side, with no DOM in it.
 *
 * The sheet is what a copywriter actually receives: a table with one row per
 * design, downloaded as CSV, filled in over days, and handed back. The whole
 * round trip hangs on every row carrying a stable id, so a returning file can
 * be matched against the rows that are already on screen instead of being
 * appended as a pile of new ones — by the designer, by the writer, and by an
 * agent reading the same file.
 *
 * Column detection needs the DOM and stays in BatchAMator; everything here is
 * pure, and QA/content-sheet.test.mjs covers it.
 */

/** The id column is first in the CSV and never edited by hand. */
export const ID_COLUMN = "id";

export interface SheetRow {
  id: string;
  values: Record<string, string>;
}

let rowSeq = 0;

/**
 * Short, readable, and unique enough that two sheets merged by hand do not
 * collide. Readability matters — a human scanning a spreadsheet has to be able
 * to say "row r-k3f9x2 is the one that came back wrong".
 */
export function newRowId(): string {
  rowSeq++;
  const stamp = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 6);
  return `r-${stamp}${rand}${rowSeq.toString(36)}`;
}

export function emptyRow(columns: string[]): SheetRow {
  const values: Record<string, string> = {};
  for (const column of columns) values[column] = "";
  return { id: newRowId(), values };
}

/**
 * RFC 4180 CSV parser. Handles quoted fields, escaped quotes (""), and commas
 * and newlines inside quotes.
 */
export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { currentField += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      currentField += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { currentRow.push(currentField); currentField = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") {
      currentRow.push(currentField);
      result.push(currentRow);
      currentRow = []; currentField = ""; i++; continue;
    }
    currentField += ch; i++;
  }
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    result.push(currentRow);
  }

  const nonEmpty = result.filter(r => r.some(c => c.trim() !== ""));
  if (nonEmpty.length < 2) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map(s => s.trim());
  const rows = nonEmpty.slice(1).map(line => {
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => { obj[key] = (line[idx] || "").trim(); });
    return obj;
  });
  return { headers, rows };
}

const quote = (value: string) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/** Serialise the sheet, id first, so what comes back can be matched to what went out. */
export function toCSV(columns: string[], rows: SheetRow[]): string {
  const header = [ID_COLUMN, ...columns].map(quote).join(",");
  const body = rows.map(row =>
    [row.id, ...columns.map(c => row.values[c] ?? "")].map(quote).join(","));
  return [header, ...body].join("\n") + "\n";
}

/**
 * Turn a parsed CSV into sheet rows.
 *
 * A file that already carries ids keeps them — that is the entire point of the
 * column. One without them (a writer who built the sheet from scratch, or
 * Excel dropping the column) still loads: those rows are given fresh ids
 * rather than rejected, because refusing the file helps nobody.
 */
export function rowsFromCsv(
  parsed: { headers: string[]; rows: Record<string, string>[] },
  columns: string[],
): SheetRow[] {
  const seen = new Set<string>();
  return parsed.rows.map(raw => {
    const values: Record<string, string> = {};
    for (const column of columns) values[column] = raw[column] ?? "";
    // Anything the sheet does not have a layer for is still carried, so a
    // column the writer added does not vanish on the next download.
    for (const [key, value] of Object.entries(raw)) {
      if (key !== ID_COLUMN && !(key in values)) values[key] = value;
    }
    const given = (raw[ID_COLUMN] || "").trim();
    const id = given && !seen.has(given) ? given : newRowId();
    seen.add(id);
    return { id, values };
  });
}

/** Every column present across the sheet, detected ones first. */
export function allColumns(detected: string[], rows: SheetRow[]): string[] {
  const out = [...detected];
  for (const row of rows) {
    for (const key of Object.keys(row.values)) {
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

/** True for something we can hand to the server to fetch and re-host. */
export function looksLikeUrl(value: string): boolean {
  const trimmed = (value || "").trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}
