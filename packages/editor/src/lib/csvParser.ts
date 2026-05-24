// csvParser.ts — CSV/TSV parser (ported from Batch-a-mator Figma plugin)
// Supports: commas, tabs, quoted fields, Google Sheets Publish-to-Web URLs

/** Detect delimiter from header line */
export function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  return ",";
}

/** Parse a TEXT field inside quotes, handling escaped quotes */
function unquote(val: string): string {
  let v = val.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** Split a CSV line respecting quoted fields */
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") {
    return line.split("\t").map((s) => unquote(s));
  }
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === delimiter && !inQuotes) {
      result.push(unquote(current));
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(unquote(current));
  return result;
}

/** Parse CSV text into array of objects (header→column mapping) */
export function csvToJSON(csv: string): Record<string, string>[] | null {
  if (!csv || !csv.trim()) return null;
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter)
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  if (headers.length === 0) return null;

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitLine(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx].trim() : "";
    });
    // Skip rows where all values are empty
    if (Object.values(obj).some((v) => v !== "")) {
      rows.push(obj);
    }
  }
  return rows.length > 0 ? rows : null;
}

/**
 * Parse CSV input that may be:
 * - Raw CSV text pasted by user
 * - URL to Google Sheets "Publish to Web" CSV
 *
 * Returns the CSV text string, or null on failure.
 */
export async function parseCSVInput(raw: string): Promise<string | null> {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  // If it's a URL, fetch it
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      // Try direct fetch first (works for Sheets if CORS allows)
      let res = await fetch(trimmed);
      if (!res.ok) {
        // Fallback to our Netlify proxy
        res = await fetch(
          `/api/csv-proxy?url=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) {
          console.error("[csvParser] Proxy fetch failed:", res.status);
          return null;
        }
        const data = await res.json();
        return data.text || null;
      }
      return await res.text();
    } catch (e) {
      // Last resort: try proxy
      try {
        const res = await fetch(
          `/api/csv-proxy?url=${encodeURIComponent(trimmed)}`,
        );
        if (res.ok) {
          const data = await res.json();
          return data.text || null;
        }
      } catch {}
      console.error("[csvParser] Failed to fetch CSV:", e);
      return null;
    }
  }
  // Raw CSV text
  return trimmed;
}

/** Generate CSV template from layer names */
export function generateCSVTemplate(
  layerNames: string[],
  mode: "unico" | "variable" | "carrusel",
): string {
  const cols = layerNames.map((n) => n.replace(/^#/, ""));
  if (mode === "carrusel") {
    return ["ID_Carrusel,Plantilla_Slide," + cols.join(",")].join("\n");
  }
  if (mode === "variable") {
    return ["Plantilla," + cols.join(",")].join("\n");
  }
  // unico (single post)
  return [cols.join(",")].join("\n");
}
