/**
 * Recetas de copywriting — hooks, tonos y frameworks de escritura (REQ-016).
 *
 * Same table the AIs read/write via MCP (list/create/update/delete_copy_recipe),
 * so anything saved here is immediately usable by an agent drafting calendar
 * copies — and a user can ask their AI to research frameworks online and store
 * them here for later. Styling follows the ContentTab brand-table language on
 * purpose: this is data entry, not chrome.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

export interface CopyRecipeRow {
  id: string;
  workspace_id: string;
  type: string;
  name: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string | null;
  updated_at: string | null;
}

const TYPE_OPTIONS: Array<[string, string]> = [
  ["", "Todos los tipos"],
  ["hook", "Hook"],
  ["tono", "Tono"],
  ["framework", "Framework"],
  ["otro", "Otro"],
];
const TYPE_LABEL: Record<string, string> = { hook: "Hook", tono: "Tono", framework: "Framework", otro: "Otro" };
const NEW_TYPES = TYPE_OPTIONS.slice(1);

const CELL: React.CSSProperties = {
  padding: "6px 10px",
  borderRight: "1px solid rgba(255,255,255,0.10)",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  fontSize: 12.5,
  color: "#fff",
  textAlign: "left",
  verticalAlign: "middle",
};

const btn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "transparent",
  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0, cursor: "pointer",
};

const control: React.CSSProperties = {
  padding: "3px 6px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "#000",
  border: "1px solid rgba(255,255,255,0.18)", borderRadius: 0, cursor: "pointer",
};

const field: React.CSSProperties = {
  width: "100%", background: "transparent", color: "#fff",
  border: "1px solid transparent", borderRadius: 0,
  padding: "3px 4px", fontSize: 12.5, fontFamily: "inherit", outline: "none",
};

const parseTags = (raw: string): string[] =>
  [...new Set(raw.split(",").map(t => t.trim()).filter(Boolean))];

export function CopyRecipesTab({ workspaceId }: { workspaceId: string | null }) {
  const [rows, setRows] = useState<CopyRecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [newType, setNewType] = useState("framework");
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError("");
    try {
      const res = await apiFetch<{ success?: boolean; data?: CopyRecipeRow[]; error?: string }>(
        `/api/copy-recipes?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      if (res && res.success === false) throw new Error(res.error || "El servidor rechazó la carga");
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las recetas");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  /** Optimistic write, same contract as the ContentTab sheet. */
  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setError("");
    const before = rows.find(r => r.id === id);
    setRows(cur => cur.map(r => (r.id === id ? { ...r, ...body } as CopyRecipeRow : r)));
    try {
      const res = await apiFetch<{ success?: boolean; error?: string }>(`/api/copy-recipes/${id}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      if (res && res.success === false) throw new Error(res.error || "El servidor rechazó el cambio");
    } catch (e) {
      if (before) setRows(cur => cur.map(r => (r.id === id ? before : r)));
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rows]);

  const remove = useCallback(async (id: string) => {
    const before = rows;
    setRows(cur => cur.filter(r => r.id !== id));
    try {
      await apiFetch(`/api/copy-recipes/${id}`, { method: "DELETE" });
    } catch (e) {
      setRows(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rows]);

  const add = useCallback(async () => {
    if (!workspaceId || !newName.trim() || !newContent.trim()) return;
    setError("");
    try {
      const res = await apiFetch<{ data?: CopyRecipeRow }>("/api/copy-recipes", {
        method: "POST",
        body: JSON.stringify({
          workspaceId,
          type: newType,
          name: newName.trim(),
          content: newContent.trim(),
          tags: parseTags(newTags),
          source: "humano",
        }),
      });
      if (res?.data) {
        setRows(cur => [res.data!, ...cur]);
        setNewName(""); setNewContent(""); setNewTags("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la receta");
    }
  }, [workspaceId, newType, newName, newContent, newTags]);

  const visible = rows.filter(r => !typeFilter || r.type === typeFilter);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.10)", flexShrink: 0,
      }}>
        <select value={typeFilter} style={control} aria-label="Tipo"
          onChange={e => setTypeFilter(e.target.value)}>
          {TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value} style={{ background: "#000" }}>{label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {visible.length} de {rows.length} recetas
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={load}>⟳ Recargar</button>
      </div>

      {/* The promise of this pane: whatever lands here, the IA can use it. */}
      <div style={{
        padding: "8px 16px", fontSize: 12, color: "rgba(255,255,255,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.10)", flexShrink: 0,
      }}>
        Tus IAs leen y escriben estas recetas vía MCP (list_copy_recipes / create_copy_recipe).
        Pídele que busque frameworks en internet y los guarde aquí, o que redacte los copys del
        calendario siguiendo tu tono. Las que guardan las IAs aparecen con origen «ia».
      </div>

      {error && (
        <div role="alert" style={{
          padding: "8px 16px", fontSize: 12, color: "#fff",
          background: "rgba(255,255,255,0.10)", borderBottom: "1px solid rgba(255,255,255,0.14)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError("")} style={btn}>Cerrar</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 16px 16px" }}>
        {loading ? (
          <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 24, color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
            {rows.length === 0
              ? "Sin recetas todavía. Crea una abajo o pídele a tu IA que traiga frameworks y los guarde."
              : "Ninguna receta de este tipo."}
          </div>
        ) : (
          <table className="ct" style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
            <thead>
              <tr>
                {["Tipo", "Nombre", "Receta", "Tags", "Origen", "Actualizada", ""].map(h => (
                  <th key={h} style={{
                    ...CELL, position: "sticky", top: 0, zIndex: 1, background: "#000",
                    fontWeight: 600, color: "rgba(255,255,255,0.65)", fontSize: 11.5,
                    borderBottom: "1px solid rgba(255,255,255,0.28)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id}>
                  <td style={CELL}>
                    <select value={r.type} style={{ ...control, width: "100%" }}
                      onChange={e => patch(r.id, { type: e.target.value })}>
                      {NEW_TYPES.map(([value, label]) => (
                        <option key={value} value={value} style={{ background: "#000" }}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...CELL, minWidth: 160 }}>
                    <input value={r.name} placeholder="Nombre" style={field}
                      onChange={e => patch(r.id, { name: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 320 }}>
                    <textarea value={r.content} placeholder="Instrucciones, estructura, ejemplo…" rows={2}
                      style={{ ...field, resize: "vertical", minHeight: 36 }}
                      onChange={e => patch(r.id, { content: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 130 }}>
                    <input value={(r.tags || []).join(", ")} placeholder="tag, tag" style={field}
                      onChange={e => patch(r.id, { tags: parseTags(e.target.value) })} />
                  </td>
                  <td style={CELL}>
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 100,
                      background: r.source === "ia" ? "rgba(139,92,246,0.10)" : "rgba(255,255,255,0.06)",
                      color: r.source === "ia" ? "rgba(167,139,250,0.9)" : "rgba(255,255,255,0.55)",
                    }}>{r.source === "ia" ? "IA" : "Humano"}</span>
                  </td>
                  <td style={{ ...CELL, fontSize: 11, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                    {r.updated_at ? new Date(r.updated_at).toLocaleDateString("es", { day: "2-digit", month: "short" }) : "—"}
                  </td>
                  <td style={CELL}>
                    <button type="button" onClick={() => remove(r.id)} title="Eliminar"
                      style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* New recipe — source 'humano' by provenance; the IA path is the MCP tool. */}
        <table className="ct" style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
          <tbody>
            <tr>
              <td style={CELL}>
                <select value={newType} style={{ ...control, width: "100%" }}
                  onChange={e => setNewType(e.target.value)} aria-label="Tipo de la nueva receta">
                  {NEW_TYPES.map(([value, label]) => (
                    <option key={value} value={value} style={{ background: "#000" }}>{label}</option>
                  ))}
                </select>
              </td>
              <td style={{ ...CELL, minWidth: 160 }}>
                <input value={newName} placeholder="Nombre (ej. AIDA para lanzamientos)" style={field}
                  onChange={e => setNewName(e.target.value)} aria-label="Nombre de la nueva receta" />
              </td>
              <td style={{ ...CELL, minWidth: 320 }}>
                <textarea value={newContent} placeholder="Receta: estructura, reglas y un ejemplo" rows={2}
                  style={{ ...field, resize: "vertical", minHeight: 36 }}
                  onChange={e => setNewContent(e.target.value)} aria-label="Contenido de la nueva receta" />
              </td>
              <td style={{ ...CELL, minWidth: 130 }}>
                <input value={newTags} placeholder="tags, separados, por coma" style={field}
                  onChange={e => setNewTags(e.target.value)} aria-label="Tags de la nueva receta" />
              </td>
              <td style={CELL}>
                <button type="button" onClick={add} disabled={!newName.trim() || !newContent.trim()}
                  style={{ ...btn, opacity: newName.trim() && newContent.trim() ? 1 : 0.4,
                    cursor: newName.trim() && newContent.trim() ? "pointer" : "not-allowed" }}>
                  + Agregar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
