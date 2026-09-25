/**
 * KanbanTableView — the same Kanban tasks as a spreadsheet.
 *
 * Same data as KanbanTab's board view, just laid flat: one row per task,
 * columns for the fields you'd scan down. Styled to match BrandGraphDataTable
 * so the two "Tabla" panes feel like the same tool.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { PeekHead, PeekPanel } from "./PeekPanel";
import { useAuth } from "../lib/auth";
import { readPaneCache, writePaneCache } from "../lib/paneCache";
import { normalizeTask } from "../lib/kanbanNormalize";
import { downloadCsv, priorityFrom, toIsoDate } from "../lib/tabularCsv";
import { KANBAN_FIELDS, type ImportSourceId } from "../lib/importMappers";
import { ImportWizardModal } from "./ImportWizardModal";

type KanbanTask = {
  id: string;
  title: string;
  brand_name?: string;
  status: string;
  priority: number;
  deadline: string | null;
  type: string;
  content_type?: string | null;
  ai_model?: string | null;
  // studio_list_cards returns the full card — these feed the read-only peek.
  brief?: string | null;
  copy_draft?: string | null;
  tone?: string | null;
  cta?: string | null;
  acceptance?: string[] | null;
  tags?: string[];
  template_id?: string | null;
  template_name?: string | null;
  source?: string | null;
  assigned_to?: string | null;
  created_at?: string;
  updated_at?: string;
};

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  research: "Research",
  draft: "Draft",
  design: "Design",
  review: "Review",
  feedback: "Feedback",
  done: "Done",
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "Urgente",
  2: "Normal",
  3: "Baja",
};

const CELL: React.CSSProperties = {
  padding: "7px 14px",
  borderRight: "1px solid rgba(255,255,255,0.10)",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  fontSize: 13,
  color: "#fff",
  textAlign: "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const btn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "transparent",
  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0, cursor: "pointer",
};

interface Props {
  workspaceId: string;
}

export function KanbanTableView({ workspaceId }: Props) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // Notion-style peek: the row's task in the right panel (read-only — this
  // view edits nothing, so the panel shows, it doesn't mutate).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const fetchTasks = useCallback(async () => {
    // SWR: cached rows paint instantly on the session's first fetch; the
    // network call below revalidates behind them.
    const cached = workspaceId
      ? readPaneCache<KanbanTask[]>("kanban-table", user?.id, workspaceId)
      : null;
    if (cached?.length) {
      // Normalize even the cache: snapshots written before the shared guard
      // existed can still carry legacy acceptance strings (REQ-026 BUG-001).
      setTasks(cached.map(normalizeTask));
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const json = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "studio_list_cards",
          params: { workspaceId },
          id: 1,
        }),
      });
      if (json?.error) {
        setError(json.error.message || "Error desconocido");
        return;
      }
      const text = json?.result?.content?.[0]?.text;
      const data = text ? JSON.parse(text) : (json?.result || {});
      // BUG-001: acceptance puede llegar como string multilínea (filas
      // legacy) — sin este map, detailTask.acceptance.map crashea (REQ-026).
      setTasks((data.cards || []).map(normalizeTask));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las tareas");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Write-through keeps the cache aligned after every sync/refetch.
  useEffect(() => {
    if (!workspaceId || tasks.length === 0) return;
    writePaneCache("kanban-table", user?.id, workspaceId, tasks);
  }, [tasks, workspaceId, user?.id]);

  const visible = statusFilter
    ? tasks.filter(t => t.status === statusFilter)
    : tasks;
  const detailTask = detailId ? tasks.find(t => t.id === detailId) ?? null : null;

  // CSV round-trip: same pipeline as the board — imported rows go through
  // studio_create_card so the MCP layer stays the single writer.
  const exportCsv = useCallback(() => {
    downloadCsv(
      `kanban-tabla-${workspaceId}.csv`,
      ["Título", "Estado", "Prioridad", "Marca", "Deadline", "Tipo", "Fuente"],
      visible.map(t => [
        t.title,
        STATUS_LABELS[t.status] || t.status,
        PRIORITY_LABELS[t.priority] || "Normal",
        t.brand_name || "",
        t.deadline ? t.deadline.slice(0, 10) : "",
        t.type || "",
        t.source || "",
      ]),
    );
  }, [visible, workspaceId]);
  const importTasks = useCallback(async (
    drafts: Array<Record<string, string>>,
    sourceId: ImportSourceId,
    note: (msg: string) => void,
  ) => {
    for (let i = 0; i < drafts.length; i++) {
      const row = drafts[i];
      note(`Importando ${i + 1}/${drafts.length}…`);
      const brief = row.descripcion?.trim() || "";
      const withList = row.lista?.trim() ? `[${row.lista.trim()}] ${brief}`.trim() : brief;
      await apiFetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "studio_create_card",
          params: {
            title: row.titulo.trim(),
            workspaceId,
            type: "post",
            priority: priorityFrom(row.prioridad) ?? 2,
            brief: withList || undefined,
            deadline: toIsoDate(row.fecha || "") || undefined,
            source: sourceId === "trello" ? "trello" : "csv",
          },
          id: 1,
        }),
      });
    }
    await fetchTasks();
  }, [workspaceId, fetchTasks]);

  if (loading) {
    return <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando...</div>;
  }
  if (error && !tasks.length) {
    return (
      <div style={{ padding: 24, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
        {error}{" "}
        <button type="button" onClick={fetchTasks} style={btn}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.14)", flexShrink: 0,
      }}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: "5px 10px", fontSize: 12, fontFamily: "inherit",
            color: "#fff", background: "#000",
            border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0, cursor: "pointer",
          }}
        >
          <option value="" style={{ background: "#000" }}>Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k} style={{ background: "#000" }}>{label}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {visible.length} tareas
        </span>
        <button type="button" onClick={exportCsv} disabled={!visible.length}
          title="Descargar la tabla como CSV"
          style={{ ...btn, opacity: visible.length ? 1 : 0.4, cursor: visible.length ? "pointer" : "default" }}>⇩ CSV</button>
        <button type="button" onClick={() => setCsvOpen(true)} style={btn}
          title="Importar desde CSV o un JSON de Trello">⇧ Importar</button>
        <button type="button" onClick={fetchTasks} style={btn}>Sincronizar</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 20px 20px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
          <thead>
            <tr>
              {["Titulo", "Estado", "Prioridad", "Marca", "Deadline", "Tipo"].map(h => (
                <th key={h} style={{
                  ...CELL, width: h === "Titulo" ? "auto" : "12%",
                  position: "sticky", top: 0, zIndex: 1,
                  background: "#000", fontWeight: 600,
                  color: "rgba(255,255,255,0.65)", fontSize: 12,
                  borderBottom: "1px solid rgba(255,255,255,0.28)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(t => (
              <tr key={t.id} onClick={() => setDetailId(t.id)} style={{ cursor: "pointer" }}>
                <td className="peek-cell" style={CELL}>
                  {t.title}
                  <button type="button" className="peek-open" aria-label={`Abrir detalle de ${t.title}`}
                    onClick={e => { e.stopPropagation(); setDetailId(t.id); }}>Abrir</button>
                </td>
                <td style={CELL}>{STATUS_LABELS[t.status] || t.status}</td>
                <td style={CELL}>{PRIORITY_LABELS[t.priority] || "Normal"}</td>
                <td style={CELL}>{t.brand_name || "—"}</td>
                <td style={CELL}>{t.deadline ? new Date(t.deadline).toLocaleDateString() : "—"}</td>
                <td style={CELL}>{t.type || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            No hay tareas.
          </div>
        )}
      </div>

      {/* Read-only detail: the same fields the Kanban board's peek shows,
          minus the CRUD — this table edits nothing. */}
      <PeekPanel open={!!detailTask} onClose={() => setDetailId(null)} label="Detalle de la tarea">
        {detailTask && (() => (<>
          <PeekHead label="Tarea del Kanban" onClose={() => setDetailId(null)} />
          <div style={{ padding: "12px 18px 26px", display: "grid", gap: 16 }}>
            <div className="peek-title">{detailTask.title}</div>
            <div style={{ display: "grid", gap: 2, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
              <div className="peek-prop-row"><span className="peek-prop-label">Estado</span><span style={{ fontSize: 12.5 }}>{STATUS_LABELS[detailTask.status] || detailTask.status}</span></div>
              <div className="peek-prop-row"><span className="peek-prop-label">Prioridad</span><span style={{ fontSize: 12.5 }}>{PRIORITY_LABELS[detailTask.priority] || "Normal"}</span></div>
              <div className="peek-prop-row"><span className="peek-prop-label">Marca</span><span style={{ fontSize: 12.5 }}>{detailTask.brand_name || "—"}</span></div>
              <div className="peek-prop-row"><span className="peek-prop-label">Deadline</span><span style={{ fontSize: 12.5 }}>{detailTask.deadline ? new Date(detailTask.deadline).toLocaleDateString() : "—"}</span></div>
              <div className="peek-prop-row"><span className="peek-prop-label">Tipo</span><span style={{ fontSize: 12.5 }}>{detailTask.type || "—"}</span></div>
              {detailTask.content_type && (
                <div className="peek-prop-row"><span className="peek-prop-label">Contenido</span><span style={{ fontSize: 12.5 }}>{detailTask.content_type === "ad" ? "Ad" : "Orgánico"}</span></div>
              )}
              {detailTask.ai_model && (
                <div className="peek-prop-row"><span className="peek-prop-label">Modelo IA</span><span style={{ fontSize: 12.5 }}>{detailTask.ai_model}</span></div>
              )}
              {detailTask.assigned_to && (
                <div className="peek-prop-row"><span className="peek-prop-label">Asignado</span><span style={{ fontSize: 12.5 }}>{detailTask.assigned_to}</span></div>
              )}
              {detailTask.template_id && (
                <div className="peek-prop-row">
                  <span className="peek-prop-label">Diseño</span>
                  <a href={`/?template=${detailTask.template_id}&v=2`} target="_blank" rel="noopener"
                    style={{ color: "#a78bfa", fontSize: 12.5, textDecoration: "underline", wordBreak: "break-all" }}>
                    {detailTask.template_name || detailTask.template_id}
                  </a>
                </div>
              )}
              <div className="peek-prop-row"><span className="peek-prop-label">Creado</span><span style={{ fontSize: 12.5 }}>{detailTask.created_at ? new Date(detailTask.created_at).toLocaleString("es") : "—"}</span></div>
              <div className="peek-prop-row"><span className="peek-prop-label">Actualizado</span><span style={{ fontSize: 12.5 }}>{detailTask.updated_at ? new Date(detailTask.updated_at).toLocaleString("es") : "—"}</span></div>
            </div>
            {detailTask.brief && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>Brief</div>
                <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>{detailTask.brief}</p>
              </div>
            )}
            {(detailTask.copy_draft || detailTask.tone || detailTask.cta) && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>Contenido editorial</div>
                {detailTask.tone && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Tono: <span style={{ color: "rgba(255,255,255,0.75)" }}>{detailTask.tone}</span></div>}
                {detailTask.copy_draft && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", lineHeight: 1.5, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 10 }}>{detailTask.copy_draft}</div>
                )}
                {detailTask.cta && <div style={{ fontSize: 12, color: "#a78bfa" }}>CTA: {detailTask.cta}</div>}
              </div>
            )}
            {detailTask.acceptance && detailTask.acceptance.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>Acceptance criteria ({detailTask.acceptance.length})</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {detailTask.acceptance.map((a, i) => (
                    <li key={i} style={{ marginBottom: 4, color: "rgba(255,255,255,0.5)" }}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>))()}
      </PeekPanel>

      {csvOpen && (
        <ImportWizardModal
          title="Importar tareas al Kanban"
          sources={["csv", "trello"]}
          fields={KANBAN_FIELDS}
          onClose={() => setCsvOpen(false)}
          onConfirm={importTasks}
        />
      )}
    </div>
  );
}
