/**
 * ImportWizardModal — the one import flow every table reuses.
 *
 * Pick a source (CSV, Trello JSON, Notion CSV, HubSpot CSV), the file's
 * columns get auto-mapped onto the table's fields by alias, the user
 * corrects anything in the mapping grid, previews exactly what will be
 * written, and confirms. The table's onConfirm receives plain string
 * drafts — no transformation happens after the preview, so what you see
 * is what lands.
 */
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  autoMap, extractTable, IMPORT_SOURCES,
  type ImportField, type ImportSourceId,
} from "../lib/importMappers";

type ImportTable = { headers: string[]; rows: string[][]; warnings: string[] };

export function ImportWizardModal({ title, sources, fields, onClose, onConfirm }: {
  title: string;
  sources: ImportSourceId[];
  fields: ImportField[];
  onClose: () => void;
  onConfirm: (
    drafts: Array<Record<string, string>>,
    sourceId: ImportSourceId,
    note: (msg: string) => void,
  ) => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState<ImportSourceId>(sources[0]);
  const [table, setTable] = useState<ImportTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const source = IMPORT_SOURCES[sourceId];

  const handleFile = (file: File) => {
    setError("");
    void file.text().then((text) => {
      try {
        const parsed = extractTable(text, sourceId);
        setTable(parsed);
        setFileName(file.name);
        setMapping(autoMap(parsed.headers, fields));
      } catch (cause) {
        setTable(null);
        setFileName("");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  /** Empty rows (nothing mapped has a value) never reach onConfirm. */
  const drafts = useMemo(() => {
    if (!table) return [];
    const out: Array<Record<string, string>> = [];
    for (const cells of table.rows) {
      const row: Record<string, string> = {};
      let hasValue = false;
      for (const field of fields) {
        const col = mapping[field.key];
        const raw = col !== undefined && col >= 0 ? (cells[col] ?? "").trim() : "";
        row[field.key] = raw;
        if (raw) hasValue = true;
      }
      if (hasValue) out.push(row);
    }
    return out;
  }, [table, mapping, fields]);

  const badRows = drafts.filter(d => fields.some(f => f.required && !d[f.key])).length;
  const usable = drafts.length - badRows;
  const mappedFields = fields.filter(f => (mapping[f.key] ?? -1) >= 0);

  const confirm = () => {
    setError("");
    const good = drafts.filter(d => fields.every(f => !f.required || d[f.key]));
    setBusy(`Importando 0/${good.length}…`);
    onConfirm(good, sourceId, (msg) => setBusy(msg))
      .then(() => onClose())
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy("");
      });
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
    border: active ? "1px solid rgba(108,92,231,0.55)" : "1px solid rgba(255,255,255,0.14)",
    background: active ? "rgba(108,92,231,0.2)" : "transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.55)",
  });

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", padding: 20,
    }}>
      <div role="dialog" aria-label={title} style={{
        width: "min(720px, 94vw)", maxHeight: "88vh", overflowY: "auto",
        background: "#101014", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 16,
        padding: "22px 24px", color: "#fff", boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 22, fontWeight: 400, fontFamily: "'Instrument Serif', serif" }}>{title}</h3>
          <button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="Cerrar"
            style={{ marginLeft: "auto", background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {/* 1 — Source + file */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {sources.map(id => (
            <button key={id} type="button" style={chip(id === sourceId)}
              onClick={() => { setSourceId(id); setTable(null); setFileName(""); setError(""); }}>
              {IMPORT_SOURCES[id].label}
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>{source.hint}</p>
        <input ref={fileRef} type="file" accept={source.accept} style={{ display: "none" }} aria-label="Elegir archivo"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          style={{
            width: "100%", padding: "14px 16px", fontSize: 13, fontFamily: "inherit", textAlign: "left",
            color: fileName ? "#fff" : "rgba(255,255,255,0.5)", cursor: "pointer",
            background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.25)", borderRadius: 10,
          }}>
          {fileName ? `✓ ${fileName} — clic para cambiar` : "Elegir archivo…"}
        </button>

        {/* 2 — Mapping */}
        {table && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 8px" }}>Mapeo de columnas</div>
            <div style={{ display: "grid", gap: 6 }}>
              {fields.map(field => {
                const col = mapping[field.key] ?? -1;
                return (
                  <div key={field.key} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.75)" }}>
                      {field.label}{field.required && <span style={{ color: "#fca5a5" }}> *</span>}
                    </span>
                    <select value={col} aria-label={`Columna para ${field.label}`}
                      onChange={e => setMapping(cur => ({ ...cur, [field.key]: Number(e.target.value) }))}
                      style={{
                        padding: "6px 10px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 8,
                        background: "#18181b", color: "#fff", border: "1px solid rgba(255,255,255,0.16)", cursor: "pointer",
                      }}>
                      <option value={-1}>— ignorar —</option>
                      {table.headers.map((h, i) => <option key={i} value={i}>{h || `(columna ${i + 1})`}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            {fields.some(f => f.hint) && (
              <div style={{ marginTop: 8, display: "grid", gap: 2 }}>
                {fields.filter(f => f.hint).map(f => (
                  <span key={f.key} style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>· {f.label}: {f.hint}</span>
                ))}
              </div>
            )}

            {/* 3 — Preview */}
            {mappedFields.length > 0 && drafts.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 8px" }}>Vista previa</div>
                <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {mappedFields.map(f => (
                          <th key={f.key} style={{
                            position: "sticky", top: 0, background: "#18181b", textAlign: "left",
                            padding: "6px 10px", color: "rgba(255,255,255,0.55)", fontWeight: 600,
                            borderBottom: "1px solid rgba(255,255,255,0.12)", whiteSpace: "nowrap",
                          }}>{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.slice(0, 6).map((row, ri) => (
                        <tr key={ri}>
                          {mappedFields.map(f => (
                            <td key={f.key} style={{
                              padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)",
                              color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis",
                            }}>{row[f.key] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {drafts.length > 6 && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                    Mostrando 6 de {drafts.length} filas
                  </div>
                )}
              </>
            )}

            <div style={{ marginTop: 14, display: "grid", gap: 4 }}>
              {table.warnings.map((w, i) => (
                <span key={i} style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>· {w}</span>
              ))}
              {badRows > 0 && (
                <span style={{ fontSize: 11.5, color: "#fcd34d" }}>
                  · {badRows} fila(s) sin {fields.filter(f => f.required).map(f => f.label).join(" o ")} se omitirán
                </span>
              )}
              {error && <span style={{ fontSize: 12, color: "#fca5a5" }}>{error}</span>}
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} disabled={Boolean(busy)}
            style={{
              padding: "8px 18px", fontSize: 12.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer",
              borderRadius: 999, background: "transparent", color: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}>Cancelar</button>
          <button type="button" onClick={confirm} disabled={!table || usable === 0 || Boolean(busy)}
            style={{
              padding: "8px 22px", fontSize: 12.5, fontFamily: "inherit", fontWeight: 700,
              borderRadius: 999, cursor: !table || usable === 0 || busy ? "default" : "pointer",
              background: !table || usable === 0 || busy ? "rgba(108,92,231,0.12)" : "#a78bfa",
              color: !table || usable === 0 || busy ? "rgba(255,255,255,0.4)" : "#0b0b0e",
              border: "none",
            }}>
            {busy || `Importar ${usable} fila${usable !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
