/**
 * KanbanTableView — the same Kanban tasks as a spreadsheet.
 *
 * Same data as KanbanTab's board view, just laid flat: one row per task,
 * columns for the fields you'd scan down. Styled to match BrandGraphDataTable
 * so the two "Tabla" panes feel like the same tool.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

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
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
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
      setTasks(data.cards || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las tareas");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const visible = statusFilter
    ? tasks.filter(t => t.status === statusFilter)
    : tasks;

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
              <tr key={t.id}>
                <td style={CELL}>{t.title}</td>
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
    </div>
  );
}
