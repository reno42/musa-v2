// Formulario de config para nodos tool generado desde el catálogo curado
// (plan FLOW_NODE_PICKER F3): UN componente para TODAS las tools — los campos
// vienen del inputSchema real (tools_catalog.json → flowToolCatalog.ts).
// Igual que el resto del editor, cada campo acepta placeholders {{...}}.
import type { CSSProperties } from "react";
import type { FlowToolEntry } from "../../data/flowToolCatalog";

type Props = {
  entry: FlowToolEntry;
  args: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
  inputStyle: CSSProperties;
};

export function ToolConfigForm({ entry, args, onChange, inputStyle }: Props) {
  if (!entry.fields.length) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {entry.fields.map((f) => {
        const value = args[f.key];
        const label = (
          <label style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontFamily: "monospace" }}>
            {f.key}{f.required ? " *" : ""}
          </label>
        );
        if (f.type === "boolean") {
          return (
            <div key={f.key} style={{ display: "grid", gap: 2 }}>
              {label}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}>
                <input type="checkbox" checked={value === true} onChange={(e) => onChange({ [f.key]: e.target.checked })} aria-label={`${entry.label}: ${f.key}`} />
                {f.help || "activar"}
              </label>
            </div>
          );
        }
        if (f.type === "enum") {
          return (
            <div key={f.key} style={{ display: "grid", gap: 2 }}>
              {label}
              <select value={String(value ?? "")} onChange={(e) => onChange({ [f.key]: e.target.value })}
                style={{ ...inputStyle, padding: "5px 6px" }} aria-label={`${entry.label}: ${f.key}`}>
                <option value="">— elegir —</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              {f.help ? <Help text={f.help} /> : null}
            </div>
          );
        }
        if (f.type === "json") {
          return (
            <div key={f.key} style={{ display: "grid", gap: 2 }}>
              {label}
              <textarea style={{ ...inputStyle, minHeight: 42, fontFamily: "monospace", fontSize: 11 }}
                value={value == null ? "" : typeof value === "string" ? value : JSON.stringify(value)}
                onChange={(e) => { try { onChange({ [f.key]: e.target.value.trim() ? JSON.parse(e.target.value) : undefined }); } catch { /* tolera edición parcial */ } }}
                placeholder='JSON — ej. ["a","b"] · acepta {{steps.id.y}}'
                aria-label={`${entry.label}: ${f.key}`} />
              {f.help ? <Help text={f.help} /> : null}
            </div>
          );
        }
        if (f.type === "number") {
          return (
            <div key={f.key} style={{ display: "grid", gap: 2 }}>
              {label}
              <input type="number" style={inputStyle} value={value ?? ""}
                onChange={(e) => onChange({ [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}
                placeholder={f.help || undefined} aria-label={`${entry.label}: ${f.key}`} />
            </div>
          );
        }
        return (
          <div key={f.key} style={{ display: "grid", gap: 2 }}>
            {label}
            <input style={inputStyle} value={String(value ?? "")}
              onChange={(e) => onChange({ [f.key]: e.target.value })}
              placeholder={f.help || undefined} aria-label={`${entry.label}: ${f.key}`} />
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
        Cualquier campo acepta {"{{input.x}}"} / {"{{steps.id.y}}"} / {"{{item.x}}"} — se resuelven en cada run.
      </div>
    </div>
  );
}

function Help({ text }: { text: string }) {
  return <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.35 }}>{text}</div>;
}
