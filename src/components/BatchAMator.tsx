import { useReducer, useRef, useState, useEffect, useCallback } from "react";
import { IconX, IconFolder } from "../shared/icons";
import { getApiHeaders } from "../lib/apiKey";

interface BatchAMatorProps {
  templateId: string | null;
  workspaceId: string;
  onClose: () => void;
  onOpenTemplate?: (id: string) => void;
  onBackToDashboard?: () => void;
}

type BatchMode = "single-post" | "multi-post" | "carousel";

interface SlotInfo {
  name: string;
  mustacheSlots: string[];
  dataSlots: string[];
  rules: Array<{ name: string; required: boolean; maxLength?: number }>;
}

interface ValidationIssue {
  row: number;
  column: string;
  severity: "error" | "warning";
  message: string;
}

type BatchState = {
  mode: BatchMode;
  csvText: string;
  headers: string[];
  rows: Record<string, string>[];
  preview: Record<string, string>[];
  generating: boolean;
  validating: boolean;
  results: any[] | null;
  error: string;
  slotInfo: SlotInfo | null;
  issues: ValidationIssue[];
  batchReadyTemplates: Array<{ id: string; name: string; slotCount: number; slots: string[] }>;
  selectedTplOverride: string | null;
};

type BatchAction =
  | { type: "SET_MODE"; mode: BatchMode }
  | { type: "SET_CSV"; csvText: string; headers: string[]; rows: Record<string, string>[]; preview: Record<string, string>[] }
  | { type: "SET_GENERATING"; generating: boolean }
  | { type: "SET_VALIDATING"; validating: boolean }
  | { type: "SET_RESULTS"; results: any[] | null }
  | { type: "SET_ERROR"; error: string }
  | { type: "SET_SLOTS"; slotInfo: SlotInfo | null }
  | { type: "SET_ISSUES"; issues: ValidationIssue[] }
  | { type: "SET_BATCH_READY"; batchReadyTemplates: any[] }
  | { type: "SET_TPL_OVERRIDE"; selectedTplOverride: string | null };

function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case "SET_MODE": return { ...state, mode: action.mode, results: null, issues: [] };
    case "SET_CSV": return { ...state, csvText: action.csvText, headers: action.headers, rows: action.rows, preview: action.preview, issues: [] };
    case "SET_GENERATING": return { ...state, generating: action.generating };
    case "SET_VALIDATING": return { ...state, validating: action.validating };
    case "SET_RESULTS": return { ...state, results: action.results };
    case "SET_ERROR": return { ...state, error: action.error };
    case "SET_SLOTS": return { ...state, slotInfo: action.slotInfo };
    case "SET_ISSUES": return { ...state, issues: action.issues };
    case "SET_BATCH_READY": return { ...state, batchReadyTemplates: action.batchReadyTemplates };
    case "SET_TPL_OVERRIDE": return { ...state, selectedTplOverride: action.selectedTplOverride, slotInfo: null, issues: [] };
    default: return state;
  }
}

const API_BASE = "/api";

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

export function BatchAMator({ templateId, workspaceId, onClose, onOpenTemplate, onBackToDashboard }: BatchAMatorProps) {
  const [state, dispatch] = useReducer(batchReducer, {
    mode: "single-post",
    csvText: "",
    headers: [],
    rows: [],
    preview: [],
    generating: false,
    validating: false,
    results: null,
    error: "",
    slotInfo: null,
    issues: [],
    batchReadyTemplates: [],
    selectedTplOverride: null,
  });
  const { mode, csvText, headers, rows, preview, generating, validating, results, error, slotInfo, issues, batchReadyTemplates, selectedTplOverride } = state;
  const fileRef = useRef<HTMLInputElement>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const activeTplId = selectedTplOverride || templateId;

  // Fetch slots on mount / template change
  const fetchSlots = useCallback(async () => {
    if (!activeTplId) { dispatch({ type: "SET_SLOTS", slotInfo: null }); return; }
    setSlotsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/templates/${activeTplId}/batch/slots`, { headers: getApiHeaders() });
      const json = await res.json();
      if (json.success) {
        dispatch({ type: "SET_SLOTS", slotInfo: { name: "slots", mustacheSlots: json.mustacheSlots || [], dataSlots: json.dataSlots || [], rules: json.rules || [] } });
      }
    } catch { /* non-blocking */ }
    setSlotsLoading(false);
  }, [activeTplId]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  // Fetch batch-ready templates on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/templates/batch-ready?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: getApiHeaders() });
        const json = await res.json();
        if (json.success) {
          dispatch({ type: "SET_BATCH_READY", batchReadyTemplates: json.data || [] });
        }
      } catch { /* non-blocking */ }
    })();
  }, [workspaceId]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const { headers: h, rows: r } = parseCSV(text);
      dispatch({ type: "SET_CSV", csvText: text, headers: h, rows: r, preview: r.slice(0, 5) });
    };
    reader.readAsText(file);
  }

  function handleTextChange(text: string) {
    const { headers: h, rows: r } = parseCSV(text);
    dispatch({ type: "SET_CSV", csvText: text, headers: h, rows: r, preview: r.slice(0, 5) });
  }

  // Validate + Generate
  async function handleGenerate() {
    if (!activeTplId || rows.length === 0) return;
    dispatch({ type: "SET_GENERATING", generating: true });
    dispatch({ type: "SET_VALIDATING", validating: true });
    dispatch({ type: "SET_ERROR", error: "" });

    try {
      const valRes = await fetch(`${API_BASE}/templates/${activeTplId}/batch/validate`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ data: rows }),
      });
      const valJson = await valRes.json();
      dispatch({ type: "SET_ISSUES", issues: valJson.issues || [] });

      if (valJson.issues?.some((i: ValidationIssue) => i.severity === "error")) {
        dispatch({ type: "SET_ERROR", error: "Validation errors found. Fix CSV columns before generating." });
        dispatch({ type: "SET_GENERATING", generating: false });
        dispatch({ type: "SET_VALIDATING", validating: false });
        return;
      }
    } catch {
      // Validation non-blocking
    }
    dispatch({ type: "SET_VALIDATING", validating: false });

    try {
      const res = await fetch(`${API_BASE}/templates/${activeTplId}/batch/${mode}`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ data: rows }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      dispatch({ type: "SET_RESULTS", results: json.data });
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", error: err.message });
    }
    dispatch({ type: "SET_GENERATING", generating: false });
  }

  const issueCells = new Set<string>();
  issues.forEach((iss) => {
    if (iss.row > 0) issueCells.add(`${iss.row}:${iss.column}`);
  });
  const missingSlots = issues.filter((i) => i.row === 0 && i.severity === "error").map((i) => i.column);

  return (
    <div style={batchOverlayStyle}>
      <div style={batchDialogStyle}>
        <div style={batchHeaderStyle}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Batch-a-mator</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer" }}><IconX size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Template picker */}
          {batchReadyTemplates.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={batchSectionLabelStyle}>Batch-ready Template</div>
              <select
                aria-label="Select template"
                value={selectedTplOverride || ""}
                onChange={(e) => {
                  dispatch({ type: "SET_TPL_OVERRIDE", selectedTplOverride: e.target.value || null });
                  setTimeout(() => fetchSlots(), 50);
                }}
                style={{
                  width: "100%", padding: "7px 10px", fontSize: 12,
                  background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.06)",
                  color: "#f0ebe0", borderRadius: 6, cursor: "pointer",
                }}
              >
                <option value="">{templateId ? "Current editor template" : "— Select a template —"}</option>
                {batchReadyTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.slotCount} slots: {t.slots.join(", ")})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mode tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "rgba(15, 15, 15, 0.5)", borderRadius: 8, padding: 3 }}>
            {([
              ["single-post", "Post Único"],
              ["multi-post", "Multi Posts"],
              ["carousel", "Carruseles"],
            ] as [BatchMode, string][]).map(([m, label]) => (
              <button
                type="button"
                key={m}
                onClick={() => dispatch({ type: "SET_MODE", mode: m })}
                style={batchTabStyle(mode === m)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Slot hints banner */}
          {slotsLoading && (
            <div style={{ marginBottom: 14, fontSize: 11, color: "#7a7668", fontStyle: "italic" }}>
              Scanning template for slots…
            </div>
          )}
          {slotInfo && slotInfo.rules.length > 0 && (
            <div style={{
              marginBottom: 14, padding: "8px 12px", borderRadius: 6,
              background: "rgba(200, 184, 152, 0.04)",
              border: "1px solid rgba(200, 184, 152, 0.08)",
              fontSize: 11, lineHeight: 1.6,
            }}>
              <div style={{ color: "#c8b898", fontWeight: 600, marginBottom: 4 }}>
                Expected CSV columns ({slotInfo.rules.length} slots):
              </div>
              <div style={{ color: "#7a7668" }}>
                {slotInfo.rules.map((r) => (
                  <span key={r.name} style={{
                    display: "inline-block", marginRight: 4, marginBottom: 2,
                    padding: "1px 6px", borderRadius: 3,
                    background: missingSlots.includes(r.name) ? "rgba(248, 113, 113, 0.1)" : "rgba(255,255,255,0.03)",
                    color: missingSlots.includes(r.name) ? "#f87171" : "#f0ebe0",
                    border: missingSlots.includes(r.name) ? "1px solid rgba(248,113,113,0.2)" : "none",
                  }}>
                    {r.name}{r.maxLength ? ` (max ${r.maxLength})` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* CSV Upload */}
          <div style={{ marginBottom: 12 }}>
            <div style={batchSectionLabelStyle}>CSV Data</div>
            <button
              type="button"
              aria-label="Upload CSV file"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const text = reader.result as string;
                  const { headers: h, rows: r } = parseCSV(text);
                  dispatch({ type: "SET_CSV", csvText: text, headers: h, rows: r, preview: r.slice(0, 5) });
                };
                reader.readAsText(file);
              }}
              style={batchDropZoneStyle}
              onClick={() => fileRef.current?.click()}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}><IconFolder size={24} color="#7a7668" /></div>
              <div style={{ fontSize: 12, color: "#7a7668" }}>Drop CSV file or click to browse</div>
              <input ref={fileRef} type="file" accept=".csv" aria-label="CSV file input" style={{ display: "none" }} onChange={handleFile} />
            </button>
            <textarea
              aria-label="CSV data"
              value={csvText}
              onChange={e => handleTextChange(e.target.value)}
              placeholder={"Or paste CSV data here…\nName,Title,Subtitle\nPost 1,Hello World,Welcome"}
              style={batchTextareaStyle}
            />
          </div>

          {/* Column headers */}
          {headers.length > 0 && (
            <div style={{ marginBottom: 12, fontSize: 12, color: "#7a7668" }}>
              <span style={{ textTransform: "uppercase", letterSpacing: 1 }}>Columns: </span>
              {headers.map(h => {
                const isExpected = slotInfo && slotInfo.rules.some(r => r.name === h);
                const isMissing = slotInfo && !isExpected;
                return (
                  <span key={h} style={{
                    padding: "2px 6px", borderRadius: 3, margin: "0 2px",
                    background: isExpected ? "rgba(34, 197, 94, 0.06)" : isMissing ? "rgba(248, 113, 113, 0.06)" : "rgba(200, 184, 152, 0.08)",
                    color: isExpected ? "#4ade80" : isMissing ? "#f87171" : "#f0ebe0",
                  }}>
                    {h}{isExpected ? " ✓" : isMissing ? " ✗" : ""}
                  </span>
                );
              })}
            </div>
          )}

          {/* Preview table */}
          {preview.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={batchSectionLabelStyle}>
                Preview (first {preview.length} of {rows.length} rows)
              </div>
              <div style={{ overflow: "auto", maxHeight: 150, border: "1px solid rgba(255, 255, 255, 0.04)", borderRadius: 6 }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
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
                        {headers.map(h => {
                          const cellHasIssue = issueCells.has(`${rowIdx + 1}:${h}`);
                          const rule = slotInfo?.rules.find(r => r.name === h);
                          const val = row[h] || "";
                          const overLimit = rule?.maxLength && val.length > rule.maxLength;
                          return (
                          <td key={h} style={{
                            padding: "3px 8px",
                            borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                            background: overLimit ? "rgba(251, 191, 36, 0.06)" : cellHasIssue ? "rgba(248, 113, 113, 0.06)" : "transparent",
                            color: overLimit ? "#fbbf24" : "#f0ebe0",
                          }}>
                            {val}{overLimit ? ` (${val.length}/${rule!.maxLength})` : ""}
                          </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Validation issues */}
          {issues.length > 0 && (
            <div style={{ marginBottom: 12, maxHeight: 100, overflow: "auto" }}>
              {issues.slice(0, 10).map((iss, i) => (
                <div key={i} style={{
                  padding: "4px 10px", fontSize: 11, marginBottom: 2, borderRadius: 4,
                  background: iss.severity === "error" ? "rgba(248, 113, 113, 0.06)" : "rgba(251, 191, 36, 0.04)",
                  color: iss.severity === "error" ? "#f87171" : "#fbbf24",
                }}>
                  {iss.message}
                </div>
              ))}
              {issues.length > 10 && (
                <div style={{ fontSize: 11, color: "#7a7668", textAlign: "center", padding: 4 }}>
                  …and {issues.length - 10} more
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: "#2a1015", color: "#f87171", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!activeTplId || rows.length === 0 || generating}
            style={batchGenerateBtnStyle(!activeTplId || rows.length === 0, generating)}
          >
            {generating ? (validating ? "Validating…" : "Generating…") : `Generate ${rows.length} ${mode === "carousel" ? "Carousel Slides" : "Templates"}`}
          </button>

          {/* Results */}
          {results && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#4ade80" }}>
                ✓ Generated {results.length} {results.length === 1 ? "template" : "templates"} successfully
              </div>
              <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid rgba(255, 255, 255, 0.04)", borderRadius: 6 }}>
                {results.slice(0, 20).map((r: any, i: number) => (
                  <div key={r.id} style={{
                    padding: "6px 10px", fontSize: 12, borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span>{i + 1}. {r.name}</span>
                    {onOpenTemplate ? (
                      <button
                        type="button"
                        onClick={() => { onOpenTemplate(r.id); onClose(); }}
                        style={{
                          background: "rgba(200, 184, 152, 0.08)", border: "1px solid rgba(200, 184, 152, 0.12)",
                          color: "#c8b898", fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        Open
                      </button>
                    ) : (
                      <span style={{ color: "#7a7668", fontSize: 10 }}>{r.id}</span>
                    )}
                  </div>
                ))}
                {results.length > 20 && (
                  <div style={{ padding: "6px 10px", fontSize: 12, color: "#7a7668", textAlign: "center" }}>
                    …and {results.length - 20} more
                  </div>
                )}
              </div>
              {onBackToDashboard && (
                <button
                  type="button"
                  onClick={() => { onBackToDashboard(); onClose(); }}
                  style={{
                    width: "100%", marginTop: 8, padding: "8px 0", border: "none", borderRadius: 6,
                    background: "rgba(200, 184, 152, 0.06)", color: "#c8b898",
                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  Open Dashboard to see all {results.length} templates →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const batchOverlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 40,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(0,0,0,0.6)",
};
const batchDialogStyle: React.CSSProperties = {
  background: "rgba(12, 12, 12, 0.65)", backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.05)", borderRadius: 10,
  width: 720, maxHeight: "85vh", overflow: "auto",
  color: "#f0ebe0", fontFamily: "Inter, system-ui, sans-serif",
};
const batchHeaderStyle: React.CSSProperties = {
  padding: "14px 18px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
  display: "flex", alignItems: "center", justifyContent: "space-between",
};
function batchTabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "6px 0", border: "none", borderRadius: 6,
    background: active ? "#c8b898" : "transparent",
    color: active ? "#fff" : "#7a7668",
    fontSize: 12, cursor: "pointer", fontWeight: active ? 500 : 400,
  };
}
const batchSectionLabelStyle: React.CSSProperties = {
  fontSize: 12, color: "#7a7668", marginBottom: 6,
  textTransform: "uppercase", letterSpacing: 1,
};
const batchDropZoneStyle: React.CSSProperties = {
  border: "1px dashed rgba(200, 184, 152, 0.12)", borderRadius: 8, padding: 20,
  textAlign: "center", cursor: "pointer", marginBottom: 8,
};
const batchTextareaStyle: React.CSSProperties = {
  width: "100%", height: 80, background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
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
