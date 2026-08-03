import { useState, useRef, useMemo, useCallback } from "react";
import { IconFolder } from "../shared/icons";
import type { FrameData } from "./DesignFrame";

interface BatchAMatorProps {
  frames: FrameData[];
  /** Controlled by the parent so the canvas can highlight checked frames. */
  checkedFrameIds: Set<string>;
  onCheckedFrameIdsChange: (ids: Set<string>) => void;
  /** Reports which frame (if any) the mouse is hovering in the list, so the parent can highlight it on canvas. */
  onFrameHover?: (frameId: string | null) => void;
  /** Called with the full new frames array (existing + generated duplicates) to commit. */
  onGenerate: (newFrames: FrameData[]) => void;
}

const FRAME_GAP = 100;
const MAX_ROWS = 30;
let generatedFrameSeq = 0;
function createFrameId(): string {
  generatedFrameSeq++;
  return `frame_b${Date.now().toString(36)}_${generatedFrameSeq.toString(36)}`;
}

/**
 * RFC 4180 compliant CSV parser.
 * Handles quoted fields, escaped quotes (""), commas and newlines inside quotes.
 */
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      currentField += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      currentRow.push(currentField);
      currentField = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      currentRow.push(currentField);
      currentField = "";
      result.push(currentRow);
      currentRow = [];
      i++;
      if (text[i] === "\n") i++;
      continue;
    }
    if (ch === "\n") {
      currentRow.push(currentField);
      currentField = "";
      result.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }
    currentField += ch;
    i++;
  }

  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    result.push(currentRow);
  }

  const nonEmpty = result.filter(r => r.some(c => c.trim() !== ""));
  if (nonEmpty.length < 2) return { headers: [], rows: [] };

  const h = nonEmpty[0].map(s => s.trim());
  const dataRows = nonEmpty.slice(1).map(line => {
    const obj: Record<string, string> = {};
    h.forEach((key, idx) => { obj[key] = (line[idx] || "").trim(); });
    return obj;
  });

  return { headers: h, rows: dataRows };
}

interface TextLayerRef {
  frameId: string;
  layerId: string;
}

interface CsvColumn {
  column: string;
  sample: string;
  refs: TextLayerRef[];
}

/**
 * Auto-detects every `data-layer-kind="text"` element inside the given
 * frames — no manual `{{slot}}`/`data-slot` markup required. Layers sharing
 * the same `data-layer-name` are grouped into one CSV column, so one value
 * fills every same-named text layer across every checked frame (handy when
 * duplicated frames share layer names like "Headline").
 */
function detectTextColumns(frames: FrameData[]): CsvColumn[] {
  const byLabel = new Map<string, CsvColumn>();
  const wrapper = document.createElement("div");
  for (const f of frames) {
    if (!f.html) continue;
    wrapper.innerHTML = f.html;
    wrapper.querySelectorAll('[data-layer-kind="text"]').forEach(el => {
      const layerId = el.getAttribute("data-layer-id");
      if (!layerId) return;
      const label = (el.getAttribute("data-layer-name") || "Text").trim() || "Text";
      const sample = (el.textContent || "").trim();
      const existing = byLabel.get(label);
      if (existing) {
        existing.refs.push({ frameId: f.id, layerId });
      } else {
        byLabel.set(label, { column: label, sample, refs: [{ frameId: f.id, layerId }] });
      }
    });
  }
  return [...byLabel.values()];
}

/** Sets the text content of every `data-layer-id` match found in `html`. */
function applyTextReplacements(html: string, valuesByLayerId: Record<string, string>): string {
  if (Object.keys(valuesByLayerId).length === 0) return html;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  let changed = false;
  for (const [layerId, value] of Object.entries(valuesByLayerId)) {
    const el = wrapper.querySelector(`[data-layer-id="${CSS.escape(layerId)}"]`);
    if (el) { el.textContent = value; changed = true; }
  }
  return changed ? wrapper.innerHTML : html;
}

export function BatchAMator({ frames, checkedFrameIds, onCheckedFrameIdsChange, onFrameHover, onGenerate }: BatchAMatorProps) {
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checkedFrames = useMemo(() => frames.filter(f => checkedFrameIds.has(f.id)), [frames, checkedFrameIds]);
  const columns = useMemo(() => detectTextColumns(checkedFrames), [checkedFrames]);

  const toggleFrame = useCallback((id: string) => {
    const next = new Set(checkedFrameIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onCheckedFrameIdsChange(next);
  }, [checkedFrameIds, onCheckedFrameIdsChange]);

  const applyCsvText = useCallback((text: string) => {
    const { headers: h, rows: r } = parseCSV(text);
    const capped = r.length > MAX_ROWS;
    const finalRows = capped ? r.slice(0, MAX_ROWS) : r;
    setCsvText(text);
    setHeaders(h);
    setRows(finalRows);
    setPreview(finalRows.slice(0, 5));
    setMessage(capped ? { text: `Se usarán solo las primeras ${MAX_ROWS} filas (máximo soportado).`, kind: "error" } : null);
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyCsvText(reader.result as string);
    reader.readAsText(file);
  }

  function handleDownloadCsvTemplate() {
    if (columns.length === 0) {
      setMessage({ text: "Los frames seleccionados no tienen texto detectable. Nada que exportar.", kind: "error" });
      return;
    }
    const header = columns.map(c => `"${c.column}"`).join(",");
    const example = columns.map(c => `"${(c.sample || `Ejemplo ${c.column}`).replace(/"/g, '""')}"`).join(",");
    const csv = `${header}\n${example}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "batchamator-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleGenerate() {
    if (checkedFrames.length === 0) {
      setMessage({ text: "Selecciona al menos un frame para duplicar.", kind: "error" });
      return;
    }
    if (rows.length === 0) {
      setMessage({ text: "Sube o pega un CSV con datos primero.", kind: "error" });
      return;
    }
    setGenerating(true);
    setMessage(null);

    const groupMinX = Math.min(...checkedFrames.map(f => f.x));
    const groupMinY = Math.min(...checkedFrames.map(f => f.y));
    const groupMaxY = Math.max(...checkedFrames.map(f => f.y + f.height));
    const groupHeight = groupMaxY - groupMinY;
    const startX = Math.max(...frames.map(f => f.x + f.width), 0) + FRAME_GAP;
    const dx = startX - groupMinX;

    // For each row, resolve column values → per-frame {layerId: value} maps.
    const newFrames: FrameData[] = [];
    rows.forEach((row, rowIdx) => {
      const dy = rowIdx * (groupHeight + FRAME_GAP);
      const label = row.name || row.title || row.headline || columns[0]?.column && row[columns[0].column] || `Fila ${rowIdx + 1}`;
      const valuesByFrame = new Map<string, Record<string, string>>();
      for (const col of columns) {
        const value = row[col.column];
        if (value === undefined) continue;
        for (const ref of col.refs) {
          if (!valuesByFrame.has(ref.frameId)) valuesByFrame.set(ref.frameId, {});
          valuesByFrame.get(ref.frameId)![ref.layerId] = value;
        }
      }
      for (const f of checkedFrames) {
        const replacements = valuesByFrame.get(f.id) || {};
        newFrames.push({
          ...f,
          id: createFrameId(),
          name: `${f.name} — ${label}`,
          x: f.x + dx,
          y: f.y + dy,
          html: applyTextReplacements(f.html, replacements),
        });
      }
    });

    onGenerate([...frames, ...newFrames]);
    setMessage({ text: `✓ ${newFrames.length} frame${newFrames.length === 1 ? "" : "s"} generado${newFrames.length === 1 ? "" : "s"} a partir de ${rows.length} fila${rows.length === 1 ? "" : "s"}.`, kind: "success" });
    setGenerating(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, overflow: "auto", flex: 1 }}>
      <div style={{ fontSize: 11.5, color: "#9a9484", lineHeight: 1.5 }}>
        Selecciona frames, exporta sus textos a un CSV (hasta {MAX_ROWS} filas), edítalo y vuelve a subirlo para generar tus variantes al instante.
      </div>

      {/* Frame selection */}
      <div>
        <div style={batchSectionLabelStyle}>Frames a duplicar ({checkedFrameIds.size} de {frames.length} seleccionados)</div>
        {frames.length === 0 ? (
          <div style={{ fontSize: 12, color: "#7a7668" }}>Este template no tiene frames todavía.</div>
        ) : (
          <div className="batch-frame-list" style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 240, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: 4 }}>
            {frames.map(f => {
              const checked = checkedFrameIds.has(f.id);
              return (
                <label
                  key={f.id}
                  onMouseEnter={() => onFrameHover?.(f.id)}
                  onMouseLeave={() => onFrameHover?.(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", fontSize: 12,
                    color: "#f0ebe0", cursor: "pointer", borderRadius: 4,
                    background: checked ? "rgba(200,184,152,0.16)" : "transparent",
                    transition: "background 0.1s ease",
                  }}
                  onMouseOver={e => { if (!checked) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseOut={e => { e.currentTarget.style.background = checked ? "rgba(200,184,152,0.16)" : "transparent"; }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleFrame(f.id)} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ color: "#7a7668", fontSize: 10, flexShrink: 0 }}>{f.width}×{f.height}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Detected text columns */}
      {checkedFrameIds.size > 0 && (
        <div style={{
          padding: "8px 12px", borderRadius: 6,
          background: "rgba(200, 184, 152, 0.04)", border: "1px solid rgba(200, 184, 152, 0.08)",
          fontSize: 11, lineHeight: 1.6,
        }}>
          <div style={{ color: "#c8b898", fontWeight: 600, marginBottom: 4 }}>
            {columns.length > 0 ? `Textos detectados (${columns.length}):` : "No se detectó texto editable en estos frames."}
          </div>
          {columns.length > 0 && (
            <div style={{ color: "#7a7668" }}>
              {columns.map(c => (
                <span key={c.column} style={{ display: "inline-block", marginRight: 4, marginBottom: 2, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.03)", color: "#f0ebe0" }}>
                  {c.column}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate CSV template */}
      <button
        type="button"
        onClick={handleDownloadCsvTemplate}
        disabled={columns.length === 0}
        style={{
          padding: "8px 0", border: "1px solid rgba(200,184,152,0.2)", borderRadius: 6,
          background: "rgba(200,184,152,0.06)", color: columns.length === 0 ? "#5a5648" : "#c8b898",
          fontSize: 12, fontWeight: 500, cursor: columns.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        ⇩ Generar CSV de ejemplo
      </button>

      {/* CSV Upload */}
      <div>
        <div style={batchSectionLabelStyle}>Subir CSV</div>
        <button
          type="button"
          aria-label="Upload CSV file"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => applyCsvText(reader.result as string);
            reader.readAsText(file);
          }}
          style={batchDropZoneStyle}
          onClick={() => fileRef.current?.click()}
        >
          <div style={{ fontSize: 20, marginBottom: 4 }}><IconFolder size={22} color="#7a7668" /></div>
          <div style={{ fontSize: 12, color: "#7a7668" }}>Suelta el CSV aquí o haz clic para buscar</div>
          <input ref={fileRef} type="file" accept=".csv" aria-label="CSV file input" style={{ display: "none" }} onChange={handleFile} />
        </button>
        <textarea
          aria-label="CSV data"
          value={csvText}
          onChange={e => applyCsvText(e.target.value)}
          placeholder={"O pega los datos CSV aquí…\nHeadline,Subtitle\nHello World,Welcome"}
          style={batchTextareaStyle}
        />
      </div>

      {/* Preview table */}
      {preview.length > 0 && (
        <div>
          <div style={batchSectionLabelStyle}>Vista previa (primeras {preview.length} de {rows.length} filas)</div>
          <div style={{ overflow: "auto", maxHeight: 140, border: "1px solid rgba(255, 255, 255, 0.04)", borderRadius: 6 }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(15, 15, 15, 0.5)" }}>
                  {headers.map(h => (
                    <th key={h} style={{ padding: "4px 8px", textAlign: "left", color: "#7a7668", fontWeight: 400, borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, rowIdx) => {
                  const rowKey = headers.map(h => row[h] || "").join("-") || `row-${rowIdx}`;
                  return (
                    <tr key={rowKey}>
                      {headers.map(h => (
                        <td key={h} style={{ padding: "3px 8px", borderBottom: "1px solid rgba(255, 255, 255, 0.03)", color: "#f0ebe0" }}>{row[h] || ""}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {message && (
        <div style={{
          padding: "8px 12px", borderRadius: 6, fontSize: 12,
          background: message.kind === "error" ? "rgba(248,113,113,0.08)" : "rgba(74,222,128,0.08)",
          color: message.kind === "error" ? "#f87171" : "#4ade80",
        }}>
          {message.text}
        </div>
      )}

      {/* Generate button */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={checkedFrameIds.size === 0 || rows.length === 0 || generating}
        style={batchGenerateBtnStyle(checkedFrameIds.size === 0 || rows.length === 0, generating)}
      >
        {generating ? "Generando…" : `Generar ${rows.length || ""} duplicado${rows.length === 1 ? "" : "s"}`.trim()}
      </button>
    </div>
  );
}

const batchSectionLabelStyle: React.CSSProperties = {
  fontSize: 11, color: "#7a7668", marginBottom: 6,
  textTransform: "uppercase", letterSpacing: 1,
};
const batchDropZoneStyle: React.CSSProperties = {
  border: "1px dashed rgba(200, 184, 152, 0.12)", borderRadius: 8, padding: 16,
  textAlign: "center", cursor: "pointer", marginBottom: 8, width: "100%", background: "transparent",
};
const batchTextareaStyle: React.CSSProperties = {
  width: "100%", height: 70, background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
  color: "#f0ebe0", borderRadius: 6, padding: 8, fontSize: 12,
  fontFamily: "monospace", resize: "vertical",
};
function batchGenerateBtnStyle(disabled: boolean, generating: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "10px 0", border: "none", borderRadius: 8,
    background: disabled ? "rgba(200, 184, 152, 0.05)" : "#c8b898",
    color: "#fff", fontSize: 13, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: generating ? 0.7 : 1,
  };
}
