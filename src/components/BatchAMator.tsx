import { useReducer, useRef } from "react";
import { IconX, IconFolder } from "../shared/icons";

interface BatchAMatorProps {
  templateId: string | null;
  onClose: () => void;
}

type BatchMode = "single-post" | "multi-post" | "carousel";

type BatchState = {
  mode: BatchMode;
  csvText: string;
  headers: string[];
  rows: Record<string, string>[];
  preview: Record<string, string>[];
  generating: boolean;
  results: any[] | null;
  error: string;
};

type BatchAction =
  | { type: "SET_MODE"; mode: BatchMode }
  | { type: "SET_CSV"; csvText: string; headers: string[]; rows: Record<string, string>[]; preview: Record<string, string>[] }
  | { type: "SET_GENERATING"; generating: boolean }
  | { type: "SET_RESULTS"; results: any[] | null }
  | { type: "SET_ERROR"; error: string };

function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case "SET_MODE": return { ...state, mode: action.mode, results: null };
    case "SET_CSV": return { ...state, csvText: action.csvText, headers: action.headers, rows: action.rows, preview: action.preview };
    case "SET_GENERATING": return { ...state, generating: action.generating };
    case "SET_RESULTS": return { ...state, results: action.results };
    case "SET_ERROR": return { ...state, error: action.error };
  }
}

const API_BASE = "/api";

export function BatchAMator({ templateId, onClose }: BatchAMatorProps) {
  const [state, dispatch] = useReducer(batchReducer, {
    mode: "single-post",
    csvText: "",
    headers: [],
    rows: [],
    preview: [],
    generating: false,
    results: null,
    error: "",
  });
  const { mode, csvText, headers, rows, preview, generating, results, error } = state;
  const fileRef = useRef<HTMLInputElement>(null);

  function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return { headers: [], rows: [] };
    const h = lines[0].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
    const r = lines.slice(1).map(line => {
      const vals = line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
      const obj: Record<string, string> = {};
      h.forEach((k, i) => { obj[k] = vals[i] || ""; });
      return obj;
    });
    return { headers: h, rows: r };
  }

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

  async function handleGenerate() {
    if (!templateId || rows.length === 0) return;
    dispatch({ type: "SET_GENERATING", generating: true });
    dispatch({ type: "SET_ERROR", error: "" });
    try {
      const res = await fetch(`${API_BASE}/templates/${templateId}/batch/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
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

  return (
    <div style={batchOverlayStyle}>
      <div style={batchDialogStyle}>
        {/* Header */}
        <div style={batchHeaderStyle}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Batch-a-mator</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer" }}><IconX size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Mode tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 18, background: "rgba(15, 15, 15, 0.5)", borderRadius: 8, padding: 3 }}>
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
              placeholder="Or paste CSV data here…&#10;Name,Title,Subtitle&#10;Post 1,Hello World,Welcome&#10;Post 2,Second Post,More content"
              style={batchTextareaStyle}
            />
          </div>

          {/* Column headers */}
          {headers.length > 0 && (
            <div style={{ marginBottom: 12, fontSize: 12, color: "#7a7668" }}>
              <span style={{ textTransform: "uppercase", letterSpacing: 1 }}>Columns: </span>
              {headers.map(h => (
                <span key={h} style={{ background: "rgba(200, 184, 152, 0.08)", padding: "2px 6px", borderRadius: 3, margin: "0 2px", color: "#f0ebe0" }}>
                  {h}
                </span>
              ))}
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
                    {preview.map((row) => {
                      const rowKey = headers.map(h => row[h] || "").join("-");
                      return (
                      <tr key={rowKey || `row-${preview.indexOf(row)}`}>
                        {headers.map(h => (
                          <td key={h} style={{ padding: "3px 8px", borderBottom: "1px solid rgba(255, 255, 255, 0.03)" }}>{row[h]}</td>
                        ))}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
            disabled={!templateId || rows.length === 0 || generating}
            style={batchGenerateBtnStyle(!templateId || rows.length === 0, generating)}
          >
            {generating ? "Generating…" : `Generate ${rows.length} Templates`}
          </button>

          {/* Results */}
          {results && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Generated {results.length} templates
              </div>
              <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid rgba(255, 255, 255, 0.04)", borderRadius: 6 }}>
                {results.slice(0, 20).map((r: any, i: number) => (
                  <div key={r.id} style={{ padding: "6px 10px", fontSize: 12, borderBottom: "1px solid rgba(255, 255, 255, 0.03)", display: "flex", justifyContent: "space-between" }}>
                    <span>{i + 1}. {r.name}</span>
                    <span style={{ color: "#7a7668" }}>{r.id}</span>
                  </div>
                ))}
                {results.length > 20 && (
                  <div style={{ padding: "6px 10px", fontSize: 12, color: "#7a7668", textAlign: "center" }}>
                    …and {results.length - 20} more
                  </div>
                )}
              </div>
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
  width: 700, maxHeight: "85vh", overflow: "auto",
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
