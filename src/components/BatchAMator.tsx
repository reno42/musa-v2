import { useState, useRef, useMemo, useCallback } from "react";
import { IconFolder } from "../shared/icons";
import type { FrameData } from "./DesignFrame";

interface BatchAMatorProps {
  frames: FrameData[];
  /** Frame ids the user already has selected on canvas — preselected in the list. */
  initialSelectedFrameIds: Set<string>;
  /** Called with the full new frames array (existing + generated duplicates) to commit. */
  onGenerate: (newFrames: FrameData[]) => void;
}

const FRAME_GAP = 100;
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

/** Detect {{slot}} and data-slot="name" placeholders across a set of frames. */
function detectSlots(frames: FrameData[]): string[] {
  const slots = new Set<string>();
  const mustacheRe = /\{\{(\w+)\}\}/g;
  const dataSlotRe = /data-slot=["'](\w+)["']/g;
  for (const f of frames) {
    for (const text of [f.html, f.css]) {
      if (!text) continue;
      let m;
      mustacheRe.lastIndex = 0;
      while ((m = mustacheRe.exec(text))) slots.add(m[1]);
      dataSlotRe.lastIndex = 0;
      while ((m = dataSlotRe.exec(text))) slots.add(m[1]);
    }
  }
  return [...slots];
}

function substituteMustache(text: string, row: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(row)) {
    result = result.split(`{{${key}}}`).join(value || "");
  }
  return result;
}

function substituteDataSlots(html: string, row: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    const re = new RegExp(
      `(<[^>]*data-slot=["']${key}["'][^>]*>)([^<]*)(<\\/(?:div|span|p|h[1-6]|a|button|li|td|th|label|em|strong|b|i|small|sub|sup)>|<\\/[^>]+>)`,
      "gi"
    );
    result = result.replace(re, `$1${value}$3`);
    const imgRe = new RegExp(`(<img[^>]*data-slot=["']${key}["'][^>]*src=["'])([^"']*)(["'])`, "gi");
    result = result.replace(imgRe, `$1${value}$3`);
  }
  return result;
}

function substituteUnified(text: string, row: Record<string, string>, isCss = false): string {
  let result = substituteMustache(text, row);
  if (!isCss) result = substituteDataSlots(result, row);
  return result;
}

export function BatchAMator({ frames, initialSelectedFrameIds, onGenerate }: BatchAMatorProps) {
  const [checkedFrameIds, setCheckedFrameIds] = useState<Set<string>>(new Set(initialSelectedFrameIds));
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checkedFrames = useMemo(() => frames.filter(f => checkedFrameIds.has(f.id)), [frames, checkedFrameIds]);
  const slots = useMemo(() => detectSlots(checkedFrames), [checkedFrames]);

  const toggleFrame = useCallback((id: string) => {
    setCheckedFrameIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const applyCsvText = useCallback((text: string) => {
    const { headers: h, rows: r } = parseCSV(text);
    setCsvText(text);
    setHeaders(h);
    setRows(r);
    setPreview(r.slice(0, 5));
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyCsvText(reader.result as string);
    reader.readAsText(file);
  }

  function handleDownloadCsvTemplate() {
    if (slots.length === 0) {
      setMessage({ text: "Los frames seleccionados no tienen slots ({{slot}} o data-slot). Nada que exportar.", kind: "error" });
      return;
    }
    const header = slots.map(s => `"${s}"`).join(",");
    const example = slots.map(s => `"Ejemplo ${s}"`).join(",");
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

    const newFrames: FrameData[] = [];
    rows.forEach((row, rowIdx) => {
      const dy = rowIdx * (groupHeight + FRAME_GAP);
      const label = row.name || row.title || row.headline || `Fila ${rowIdx + 1}`;
      for (const f of checkedFrames) {
        newFrames.push({
          ...f,
          id: createFrameId(),
          name: `${f.name} — ${label}`,
          x: f.x + dx,
          y: f.y + dy,
          html: f.html ? substituteUnified(f.html, row) : f.html,
          css: f.css ? substituteUnified(f.css, row, true) : f.css,
        });
      }
    });

    onGenerate([...frames, ...newFrames]);
    setMessage({ text: `✓ ${newFrames.length} frame${newFrames.length === 1 ? "" : "s"} generado${newFrames.length === 1 ? "" : "s"} a partir de ${rows.length} fila${rows.length === 1 ? "" : "s"}.`, kind: "success" });
    setGenerating(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, overflow: "auto", flex: 1 }}>
      {/* Frame selection */}
      <div>
        <div style={batchSectionLabelStyle}>Frames a duplicar ({checkedFrameIds.size} seleccionados)</div>
        {frames.length === 0 ? (
          <div style={{ fontSize: 12, color: "#7a7668" }}>Este template no tiene frames todavía.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflow: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: 4 }}>
            {frames.map(f => (
              <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 12, color: "#f0ebe0", cursor: "pointer", borderRadius: 4 }}>
                <input type="checkbox" checked={checkedFrameIds.has(f.id)} onChange={() => toggleFrame(f.id)} />
                <span style={{ flex: 1 }}>{f.name}</span>
                <span style={{ color: "#7a7668", fontSize: 10 }}>{f.width}×{f.height}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Detected slots */}
      {checkedFrameIds.size > 0 && (
        <div style={{
          padding: "8px 12px", borderRadius: 6,
          background: "rgba(200, 184, 152, 0.04)", border: "1px solid rgba(200, 184, 152, 0.08)",
          fontSize: 11, lineHeight: 1.6,
        }}>
          <div style={{ color: "#c8b898", fontWeight: 600, marginBottom: 4 }}>
            {slots.length > 0 ? `Slots detectados (${slots.length}):` : "No se detectaron slots en estos frames."}
          </div>
          {slots.length > 0 && (
            <div style={{ color: "#7a7668" }}>
              {slots.map(s => (
                <span key={s} style={{ display: "inline-block", marginRight: 4, marginBottom: 2, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.03)", color: "#f0ebe0" }}>
                  {s}
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
        disabled={slots.length === 0}
        style={{
          padding: "8px 0", border: "1px solid rgba(200,184,152,0.2)", borderRadius: 6,
          background: "rgba(200,184,152,0.06)", color: slots.length === 0 ? "#5a5648" : "#c8b898",
          fontSize: 12, fontWeight: 500, cursor: slots.length === 0 ? "not-allowed" : "pointer",
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
          placeholder={"O pega los datos CSV aquí…\nName,Title,Subtitle\nPost 1,Hello World,Welcome"}
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
