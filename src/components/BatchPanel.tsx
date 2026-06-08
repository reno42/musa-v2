import { useState } from "react";
import { mcpCall } from "../lib/mcpClient";

interface BatchPanelProps {
  templateId: string | null;
  onClose: () => void;
}

type Step = 1 | 2 | 3;
type DataSource = "csv-file" | "csv-url" | "json-inline";

interface BatchRow {
  row: number;
  name: string;
  status: "success" | "warning" | "error";
  message?: string;
  templateId?: string;
}

export function BatchPanel({ templateId, onClose }: BatchPanelProps) {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Data source
  const [sourceType, setSourceType] = useState<DataSource>("csv-file");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvUrl, setCsvUrl] = useState("");
  const [jsonInline, setJsonInline] = useState("[\n  {\"title\": \"Post 1\", \"subtitle\": \"Hello World\"},\n  {\"title\": \"Post 2\", \"subtitle\": \"Foo Bar\"}\n]");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<any[]>([]);

  // Step 2: Field mapping
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [layerNames, setLayerNames] = useState<string[]>([
    "Title", "Subtitle", "Body", "Image", "Background", "Button", "Icon", "Footer"
  ]);
  const [customLayerName, setCustomLayerName] = useState("");

  // Step 3: Generate
  const [nameTemplate, setNameTemplate] = useState("Post - {title}");
  const [results, setResults] = useState<BatchRow[]>([]);

  // ── Step 1 Handlers ──

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setCsvFileName(file.name);
    parseCSV(file);
  };

  const parseCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const lines = text.trim().split("\n");
      if (lines.length < 2) { setError("CSV must have header + at least 1 row"); return; }
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map(line => {
        // Simple CSV parser: handle quoted fields
        const vals: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === "," && !inQuotes) { vals.push(current.trim()); current = ""; continue; }
          current += ch;
        }
        vals.push(current.trim());
        const row: any = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });
        return row;
      });
      setParsedHeaders(headers);
      setParsedRows(rows);
      // Auto-map headers to layer names
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const lower = h.toLowerCase();
        if (layerNames.some(l => l.toLowerCase().includes(lower) || lower.includes(l.toLowerCase()))) {
          const match = layerNames.find(l => l.toLowerCase().includes(lower) || lower.includes(l.toLowerCase()));
          if (match) autoMap[h] = match;
        }
      });
      setFieldMapping(autoMap);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const handleJsonParse = () => {
    try {
      const data = JSON.parse(jsonInline);
      const rows = Array.isArray(data) ? data : [data];
      if (rows.length === 0) { setError("JSON must contain at least 1 object"); return; }
      const headers = Object.keys(rows[0]);
      setParsedHeaders(headers);
      setParsedRows(rows);
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const lower = h.toLowerCase();
        const match = layerNames.find(l => l.toLowerCase().includes(lower) || lower.includes(l.toLowerCase()));
        if (match) autoMap[h] = match;
      });
      setFieldMapping(autoMap);
      setStep(2);
    } catch {
      setError("Invalid JSON format");
    }
  };

  const handleCsvUrlParse = async () => {
    if (!csvUrl.trim()) { setError("Please enter a CSV URL"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(csvUrl);
      const text = await res.text();
      const lines = text.trim().split("\n");
      if (lines.length < 2) { setError("Invalid CSV from URL"); setLoading(false); return; }
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map(line => {
        const vals: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === "," && !inQuotes) { vals.push(current.trim()); current = ""; continue; }
          current += ch;
        }
        vals.push(current.trim());
        const row: any = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });
        return row;
      });
      setParsedHeaders(headers);
      setParsedRows(rows);
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const lower = h.toLowerCase();
        const match = layerNames.find(l => l.toLowerCase().includes(lower) || lower.includes(l.toLowerCase()));
        if (match) autoMap[h] = match;
      });
      setFieldMapping(autoMap);
      setStep(2);
    } catch {
      setError("Failed to fetch CSV from URL");
    }
    setLoading(false);
  };

  const handleParse = () => {
    if (sourceType === "csv-file" && csvFile) {
      parseCSV(csvFile);
    } else if (sourceType === "json-inline") {
      handleJsonParse();
    } else if (sourceType === "csv-url") {
      handleCsvUrlParse();
    }
  };

  const addLayerMapping = () => {
    const header = parsedHeaders.find(h => !fieldMapping[h]);
    if (!header || !customLayerName.trim()) return;
    setFieldMapping({ ...fieldMapping, [header]: customLayerName.trim() });
    setCustomLayerName("");
  };

  // ── Step 3: Generate ──

  const handleGenerate = async () => {
    if (!templateId) { setError("No template selected"); return; }
    if (parsedRows.length === 0) { setError("No data rows to generate"); return; }
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      // Use JSON inline approach — pass data + fieldMapping
      const dataPayload = parsedRows.map((row, i) => {
        const mapped: any = {};
        Object.entries(fieldMapping).forEach(([col, layer]) => {
          mapped[layer] = row[col] || "";
        });
        // Generate name using template
        let name = nameTemplate;
        Object.entries(row).forEach(([k, v]) => {
          name = name.replace(`{${k}}`, String(v));
        });
        return { row: i + 1, data: mapped, name };
      });

      const result = await mcpCall("batch_design_from_csv", {
        baseTemplateId: templateId,
        data: dataPayload,
        fieldMapping,
        nameTemplate,
      });

      if (result?.results) {
        setResults(result.results);
        setStep(3);
      } else if (result?.generated) {
        setResults(result.generated.map((g: any, i: number) => ({
          row: i + 1,
          name: g.name || g.templateName || `Row ${i + 1}`,
          status: g.status || "success",
          templateId: g.templateId || g.id,
          message: g.message,
        })));
      }
    } catch (e: any) {
      setError(e?.message || "Batch generation failed");
    }
    setLoading(false);
  };

  // ── UI ──

  const stepLabels = ["1. Data Source", "2. Field Mapping", "3. Generate"];

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, sans-serif",
    }}>
      <div className="glass-panel" style={{
        width: 580, maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        fontSize: 12, color: "#c4c0b4",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>📦 Batch Design</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 18,
          }}>✕</button>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
          {stepLabels.map((label, i) => (
            <div key={i} style={{
              flex: 1, padding: "8px 4px", textAlign: "center",
              background: step === i + 1 ? "rgba(200, 184, 152, 0.08)" : "transparent",
              color: step === i + 1 ? "#c8b898" : "#7a7668",
              borderBottom: step === i + 1 ? "2px solid #c8b898" : "2px solid transparent",
              fontSize: 10, fontWeight: step === i + 1 ? 600 : 400,
              cursor: i + 1 < step ? "pointer" : "default",
            }} onClick={() => { if (i + 1 < step) setStep((i + 1) as Step); }}>
              {label}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {/* ── Step 1: Data Source ── */}
          {step === 1 && (
            <>
              <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                {(["csv-file", "csv-url", "json-inline"] as DataSource[]).map(t => (
                  <button key={t} type="button" onClick={() => setSourceType(t)}
                    style={{
                      flex: 1, padding: "6px 4px", borderRadius: 4, cursor: "pointer",
                      background: sourceType === t ? "rgba(200, 184, 152, 0.08)" : "transparent",
                      border: sourceType === t ? "1px solid #c8b898" : "1px solid rgba(255, 255, 255, 0.04)",
                      color: sourceType === t ? "#c8b898" : "#7a7668", fontSize: 10,
                      textTransform: "uppercase",
                    }}>
                    {t === "csv-file" ? "📁 CSV File" : t === "csv-url" ? "🔗 CSV URL" : "📝 JSON"}
                  </button>
                ))}
              </div>

              {sourceType === "csv-file" && (
                <div style={{
                  padding: "20px", border: "2px dashed rgba(200, 184, 152, 0.12)", borderRadius: 8,
                  textAlign: "center", cursor: "pointer",
                }} onClick={() => document.getElementById("csv-file-input")?.click()}>
                  <input id="csv-file-input" type="file" accept=".csv" style={{ display: "none" }}
                    onChange={handleCsvFile} />
                  <div style={{ fontSize: 24, marginBottom: 4 }}>📁</div>
                  <div style={{ fontSize: 12, color: "#c4c0b4", marginBottom: 2 }}>
                    {csvFileName || "Click to upload CSV file"}
                  </div>
                  <div style={{ fontSize: 10, color: "#7a7668" }}>
                    .csv files with headers in first row
                  </div>
                </div>
              )}

              {sourceType === "csv-url" && (
                <>
                  <label style={labelStyle}>CSV URL</label>
                  <input type="text" value={csvUrl} onChange={e => setCsvUrl(e.target.value)}
                    placeholder="https://example.com/data.csv" style={inputStyle} />
                  <button type="button" onClick={handleCsvUrlParse} disabled={loading}
                    style={{ ...btnPrimary, marginTop: 12, width: "100%", opacity: loading ? 0.5 : 1 }}>
                    {loading ? "Fetching..." : "Fetch & Parse"}
                  </button>
                </>
              )}

              {sourceType === "json-inline" && (
                <>
                  <label style={labelStyle}>JSON Data</label>
                  <textarea value={jsonInline} onChange={e => setJsonInline(e.target.value)}
                    rows={6} placeholder='[{"title":"Post 1", "subtitle":"Hello"}]'
                    style={{ ...textareaStyle, minHeight: 120 }} />
                  <button type="button" onClick={handleJsonParse}
                    style={{ ...btnPrimary, marginTop: 12, width: "100%" }}>
                    Parse JSON
                  </button>
                </>
              )}
            </>
          )}

          {/* ── Step 2: Field Mapping ── */}
          {step === 2 && (
            <>
              <div style={{ fontSize: 10, color: "#7a7668", marginBottom: 8 }}>
                {parsedHeaders.length} columns · {parsedRows.length} rows detected
              </div>

              <div style={{ ...codeBlock, marginBottom: 12, maxHeight: 80, overflowY: "auto" }}>
                <span style={{ color: "#7a7668", fontSize: 10 }}>Headers: </span>
                <span style={{ color: "#c8b898", fontSize: 10 }}>{parsedHeaders.join(", ")}</span>
              </div>

              <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Map Columns → Layers
              </div>

              {parsedHeaders.map(h => (
                <div key={h} style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
                  padding: "4px 8px", background: "#0a0a10", borderRadius: 4,
                  border: "1px solid rgba(255, 255, 255, 0.04)",
                }}>
                  <span style={{ fontSize: 11, color: "#c8b898", width: 100, flexShrink: 0 }}>{h}</span>
                  <span style={{ color: "#7a7668", fontSize: 14 }}>→</span>
                  <select value={fieldMapping[h] || ""} onChange={e => setFieldMapping({ ...fieldMapping, [h]: e.target.value })}
                    style={{ ...selectStyle, flex: 1, fontSize: 11 }}>
                    <option value="">Skip</option>
                    {layerNames.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              ))}

              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <input type="text" value={customLayerName} onChange={e => setCustomLayerName(e.target.value)}
                  placeholder="Custom layer name" style={{ ...inputStyle, flex: 1, fontSize: 10 }} />
                <button type="button" onClick={addLayerMapping} disabled={!customLayerName.trim()}
                  style={{
                    ...btnPrimary, fontSize: 10, padding: "4px 10px",
                    opacity: !customLayerName.trim() ? 0.5 : 1,
                  }}>
                  + Add
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="button" onClick={() => setStep(1)}
                  style={{ ...btnSecondary, flex: 1 }}>← Back</button>
                <button type="button" onClick={() => setStep(3)}
                  style={{ ...btnPrimary, flex: 1 }}>
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* ── Step 3: Generate ── */}
          {step === 3 && (
            <>
              <label style={labelStyle}>Base Template</label>
              <input type="text" value={templateId || ""} readOnly style={{ ...inputStyle, opacity: 0.6 }} />

              <label style={{ ...labelStyle, marginTop: 12 }}>Name Template</label>
              <input type="text" value={nameTemplate} onChange={e => setNameTemplate(e.target.value)}
                placeholder="Post - {title}" style={inputStyle} />
              <div style={{ fontSize: 9, color: "#7a7668", marginTop: 2 }}>
                Use {"{column}"} placeholders. Available: {parsedHeaders.map(h => `{${h}}`).join(", ")}
              </div>

              <button type="button" onClick={handleGenerate} disabled={loading || !templateId}
                style={{ ...btnPrimary, marginTop: 14, width: "100%", fontSize: 13, padding: "10px",
                  opacity: loading || !templateId ? 0.5 : 1 }}>
                {loading ? "Generating..." : `⚡ Generate ${parsedRows.length} Templates`}
              </button>

              {/* Results preview */}
              {results.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    Results ({results.length})
                  </div>
                  <div style={{ ...codeBlock, maxHeight: 250, overflowY: "auto", padding: 0 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                      <thead>
                        <tr style={{ background: "#0d0d14" }}>
                          <th style={{ padding: "6px 8px", textAlign: "left", color: "#7a7668", fontWeight: 500 }}>#</th>
                          <th style={{ padding: "6px 8px", textAlign: "left", color: "#7a7668", fontWeight: 500 }}>Name</th>
                          <th style={{ padding: "6px 8px", textAlign: "center", color: "#7a7668", fontWeight: 500 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
                            <td style={{ padding: "6px 8px", color: "#7a7668" }}>{r.row}</td>
                            <td style={{ padding: "6px 8px", color: "#c4c0b4" }}>{r.name}</td>
                            <td style={{ padding: "6px 8px", textAlign: "center" }}>
                              <span style={{ color: r.status === "success" ? "#4ade80" : r.status === "warning" ? "#fbbf24" : "#f87171" }}>
                                {r.status === "success" ? "✅" : r.status === "warning" ? "⚠️" : "❌"}
                              </span>
                              {r.message && (
                                <div style={{ fontSize: 8, color: "#7a7668" }} title={r.message}>
                                  {r.message.substring(0, 30)}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="button" onClick={() => setStep(2)}
                  style={{ ...btnSecondary, flex: 1 }}>← Edit Mapping</button>
              </div>
            </>
          )}
        </div>

        {/* Error bar */}
        {error && (
          <div style={{
            padding: "8px 12px", borderTop: "1px solid rgba(239, 68, 68, 0.15)",
            background: "rgba(239, 68, 68, 0.08)", color: "#f87171", fontSize: 11,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>⚠ {error}</span>
            <button type="button" onClick={() => setError(null)}
              style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 14 }}>
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, color: "#7a7668",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: 1,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 8px", borderRadius: 4,
  background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
  color: "#f0ebe0", fontSize: 11, outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical", minHeight: 80,
  fontFamily: "monospace", fontSize: 10,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "rgba(200, 184, 152, 0.12)", border: "1px solid #c8b898",
  color: "#c8b898", fontSize: 12, fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 4,
  background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
  color: "#c8b898", fontSize: 11, cursor: "pointer",
};

const codeBlock: React.CSSProperties = {
  padding: "8px 10px", background: "#0a0a10",
  border: "1px solid rgba(255, 255, 255, 0.04)", borderRadius: 6,
  fontSize: 10, fontFamily: "monospace",
  lineHeight: 1.5, color: "#c4c0b4",
};
