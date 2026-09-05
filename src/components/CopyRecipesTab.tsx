/**
 * Recetas de copywriting — hooks, tonos y frameworks de escritura (REQ-016).
 *
 * Same table the AIs read/write via MCP (list/create/update/delete_copy_recipe),
 * so anything saved here is immediately usable by an agent drafting calendar
 * copies — and a user can ask their AI to research frameworks online and store
 * them here for later. Styling follows the ContentTab glass kit — rounded
 * controls, soft row separators — the same visual language as every other
 * Copywriting pane (v55).
 *
 * REQ-020 (v33): the library mixes 10 factory-default frameworks (is_default,
 * read-only, shared by every account) with personal recipes. A NAME is enough
 * to add a row (Enter submits); the content can be filled in later, inline.
 *
 * Brand scope (v44): a recipe with a Marca applies to that brand only; the
 * default «General» covers every brand of the workspace. Optional by design —
 * the human decides the scope, nothing infers it.
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
  brand_id?: string | null;
  is_default?: boolean;
  owner_id?: string | null;
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
  padding: "8px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  fontSize: 12.5,
  color: "#fff",
  textAlign: "left",
  verticalAlign: "middle",
};

const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontFamily: "inherit",
  color: "#d4d4d8", background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 100, cursor: "pointer",
};

const control: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12, fontFamily: "inherit",
  color: "#e4e4e7", background: "#18181b",
  border: "1px solid #3f3f46", borderRadius: 8, cursor: "pointer",
};

const field: React.CSSProperties = {
  width: "100%", background: "transparent", color: "#fff",
  border: "1px solid transparent", borderRadius: 6,
  padding: "3px 4px", fontSize: 12.5, fontFamily: "inherit", outline: "none",
};

const parseTags = (raw: string): string[] =>
  [...new Set(raw.split(",").map(t => t.trim()).filter(Boolean))];

export function CopyRecipesTab({ workspaceId, actions }: { workspaceId: string | null; actions?: React.ReactNode }) {
  const [rows, setRows] = useState<CopyRecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  // Marca scope: the same list the calendar filters by, so both panes name
  // the brands identically.
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);

  const [newType, setNewType] = useState("framework");
  const [newBrandId, setNewBrandId] = useState("");
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

  // Brands drive the Marca column — a recipe scoped to a deleted brand would
  // be uneditable, so the list must be live, not stale.
  useEffect(() => {
    if (!workspaceId) return;
    void apiFetch<{ data?: Array<{ id: string; name: string }> }>(`/api/workspaces/${workspaceId}/brands`)
      .then(res => setBrands(Array.isArray(res?.data) ? res.data : []))
      .catch(() => { /* the pane still works with General-only scope */ });
  }, [workspaceId]);

  /** Optimistic write, same contract as the ContentTab sheet. `optimistic`
   *  overlays the row when the wire shape differs from the stored shape —
   *  the Marca select edits brand_id but sends brandId, as the API expects. */
  const patch = useCallback(async (id: string, body: Record<string, unknown>, optimistic?: Record<string, unknown>) => {
    setError("");
    const before = rows.find(r => r.id === id);
    setRows(cur => cur.map(r => (r.id === id ? { ...r, ...(optimistic || body) } as CopyRecipeRow : r)));
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

  /** REQ-020: a name alone is enough — Enter in the name/tags field submits. */
  const add = useCallback(async () => {
    if (!workspaceId || !newName.trim()) return;
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
          brandId: newBrandId || null,
          source: "humano",
        }),
      });
      if (res?.data) {
        setRows(cur => [res.data!, ...cur]);
        setNewName(""); setNewContent(""); setNewTags(""); setNewBrandId("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la receta");
    }
  }, [workspaceId, newType, newBrandId, newName, newContent, newTags]);

  const submitNew = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void add(); }
  }, [add]);

  const visible = rows.filter(r => !typeFilter || r.type === typeFilter);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        <select value={typeFilter} className="ct-input" style={{ cursor: "pointer" }} aria-label="Tipo"
          onChange={e => setTypeFilter(e.target.value)}>
          {TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value} style={{ background: "#18181b" }}>{label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {visible.length} de {rows.length} recetas
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="ct-chip" onClick={load}>⟳ Recargar</button>
        {actions}
      </div>

      {/* The promise of this pane: whatever lands here, the IA can use it. */}
      <div style={{
        padding: "8px 16px", fontSize: 12, color: "rgba(255,255,255,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        Tus IAs leen y escriben estas recetas vía MCP (list_copy_recipes / create_copy_recipe).
        Las marcadas como «Default» vienen de fábrica para todas las cuentas y son de solo
        lectura; las que agregues —o guarde tu IA— son exclusivamente tuyas. Con un nombre
        basta para agregar, y Enter la crea de una. Con Marca acotas la receta a una marca;
        «General» aplica a todas. Pídele a tu IA que redacte los copys del
        calendario siguiendo tu tono.
      </div>

      {error && (
        <div role="alert" style={{
          padding: "8px 16px", fontSize: 12, color: "#fff",
          background: "rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.08)",
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
                {["Tipo", "Marca", "Nombre", "Receta", "Tags", "Origen", "Actualizada", ""].map(h => (
                  <th key={h} style={{
                    ...CELL, position: "sticky", top: 0, zIndex: 1,
                    background: "rgba(10,10,20,0.95)", backdropFilter: "blur(8px)",
                    fontWeight: 600, color: "rgba(255,255,255,0.35)", fontSize: 10,
                    textTransform: "uppercase", letterSpacing: 0.5,
                    borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                // Factory defaults are shared by every account → read-only here.
                const locked = Boolean(r.is_default);
                return (
                <tr key={r.id}>
                  <td style={CELL}>
                    <select value={r.type} style={{ ...control, width: "100%" }} disabled={locked}
                      title={locked ? "Receta default (solo lectura)" : undefined}
                      onChange={e => patch(r.id, { type: e.target.value })}>
                      {NEW_TYPES.map(([value, label]) => (
                        <option key={value} value={value} style={{ background: "#18181b" }}>{label}</option>
                      ))}
                    </select>
                  </td>
                  {/* Factory defaults are shared by every account, so their
                      only honest scope is «General» — no select on locked rows. */}
                  <td style={{ ...CELL, minWidth: 110 }}>
                    {locked ? (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}
                        title="Receta default: aplica a todas las marcas">General</span>
                    ) : (
                      <select value={r.brand_id || ""} style={{ ...control, width: "100%" }}
                        aria-label={`Marca de ${r.name}`}
                        onChange={e => {
                          const next = e.target.value || null;
                          // The wire says brandId; the row stores brand_id.
                          void patch(r.id, { brandId: next }, { brand_id: next });
                        }}>
                        <option value="" style={{ background: "#18181b" }}>General</option>
                        {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#18181b" }}>{b.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td style={{ ...CELL, minWidth: 160 }}>
                    <input value={r.name} placeholder="Nombre" style={field} disabled={locked}
                      title={locked ? "Receta default (solo lectura)" : undefined}
                      onChange={e => patch(r.id, { name: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 320 }}>
                    <textarea value={r.content} placeholder="Instrucciones, estructura, ejemplo…" rows={2}
                      style={{ ...field, resize: "vertical", minHeight: 36 }} disabled={locked}
                      title={locked ? "Receta default (solo lectura)" : undefined}
                      onChange={e => patch(r.id, { content: e.target.value })} />
                  </td>
                  <td style={{ ...CELL, minWidth: 130 }}>
                    <input value={(r.tags || []).join(", ")} placeholder="tag, tag" style={field} disabled={locked}
                      title={locked ? "Receta default (solo lectura)" : undefined}
                      onChange={e => patch(r.id, { tags: parseTags(e.target.value) })} />
                  </td>
                  <td style={CELL}>
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 100,
                      background: locked
                        ? "rgba(251,191,36,0.10)"
                        : r.source === "ia" ? "rgba(139,92,246,0.10)" : "rgba(255,255,255,0.06)",
                      color: locked
                        ? "rgba(252,211,77,0.9)"
                        : r.source === "ia" ? "rgba(167,139,250,0.9)" : "rgba(255,255,255,0.55)",
                    }}>{locked ? "Default" : r.source === "ia" ? "IA" : "Humano"}</span>
                  </td>
                  <td style={{ ...CELL, fontSize: 11, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                    {r.updated_at ? new Date(r.updated_at).toLocaleDateString("es", { day: "2-digit", month: "short" }) : "—"}
                  </td>
                  <td style={CELL}>
                    {!locked && (
                      <button type="button" onClick={() => remove(r.id)} title="Eliminar"
                        style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>×</button>
                    )}
                  </td>
                </tr>
                );
              })}
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
                    <option key={value} value={value} style={{ background: "#18181b" }}>{label}</option>
                  ))}
                </select>
              </td>
              <td style={{ ...CELL, minWidth: 110 }}>
                <select value={newBrandId} style={{ ...control, width: "100%" }}
                  onChange={e => setNewBrandId(e.target.value)} aria-label="Marca de la nueva receta">
                  <option value="" style={{ background: "#18181b" }}>General</option>
                  {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#18181b" }}>{b.name}</option>)}
                </select>
              </td>
              <td style={{ ...CELL, minWidth: 160 }}>
                <input value={newName} placeholder="Nombre (ej. AIDA para lanzamientos)" style={field}
                  onChange={e => setNewName(e.target.value)} onKeyDown={submitNew} aria-label="Nombre de la nueva receta" />
              </td>
              <td style={{ ...CELL, minWidth: 320 }}>
                <textarea value={newContent} placeholder="Receta (opcional): estructura, reglas y un ejemplo — puedes llenarla después" rows={2}
                  style={{ ...field, resize: "vertical", minHeight: 36 }}
                  onChange={e => setNewContent(e.target.value)} aria-label="Contenido de la nueva receta"
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitNew(e); }} />
              </td>
              <td style={{ ...CELL, minWidth: 130 }}>
                <input value={newTags} placeholder="tags, separados, por coma" style={field}
                  onChange={e => setNewTags(e.target.value)} onKeyDown={submitNew} aria-label="Tags de la nueva receta" />
              </td>
              <td style={CELL}>
                <button type="button" onClick={add} disabled={!newName.trim()}
                  style={{ ...btn, opacity: newName.trim() ? 1 : 0.4,
                    cursor: newName.trim() ? "pointer" : "not-allowed" }}>
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
