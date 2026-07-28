import { useState, useEffect, useCallback } from "react";
import { browserSupabase } from "../lib/supabaseClient";

type KanbanTask = {
  id: string;
  title: string;
  brand_id: string | null;
  workspace_id: string | null;
  type: string;
  format: string | null;
  status: string;
  priority: number;
  deadline: string | null;
  brief: string | null;
  copy_draft: string | null;
  tone: string | null;
  cta: string | null;
  template_id: string | null;
  frame_id: string | null;
  render_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  cronjob_id: string | null;
  tags: string[];
  workspace_name?: string;
  brand_name?: string;
  template_name?: string;
};

const STATUS_COLUMNS = [
  { key: "backlog", label: "Backlog", color: "rgba(255,255,255,0.25)" },
  { key: "research", label: "Research", color: "#60a5fa" },
  { key: "draft", label: "Draft", color: "#a78bfa" },
  { key: "design", label: "Design", color: "#f472b6" },
  { key: "review", label: "Review", color: "#fbbf24" },
  { key: "feedback", label: "Feedback", color: "#fb923c" },
  { key: "done", label: "Done", color: "#34d399" },
];

const PRIORITY_LABELS: Record<number, string> = { 1: "Urgente", 2: "Normal", 3: "Baja" };
const PRIORITY_COLORS: Record<number, string> = {
  1: "rgba(248,113,113,0.25)", 2: "rgba(255,255,255,0.08)", 3: "rgba(255,255,255,0.04)"
};

const TYPE_ICONS: Record<string, string> = {
  banner: "🏷️", post: "📱", deck: "📊", template: "📐",
  landing: "🌐", factura: "📄", cotizacion: "💰", other: "📌",
};

interface Props {
  workspaceId: string;
}

export function KanbanTab({ workspaceId }: Props) {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    setSchemaMissing(false);
    try {
      const sb = browserSupabase;
      if (!sb) {
        setError("Supabase no está configurado. Conecta tu backend en Settings.");
        setLoading(false);
        return;
      }

      // Try the kanban_board view first, fall back to direct table query
      let result;
      try {
        result = await sb
          .from("design_kanban_tasks")
          .select("*")
          .order("priority", { ascending: true })
          .order("deadline", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });
      } catch {
        // View might not exist — try direct table
      }

      if (result?.error) {
        // Check if table doesn't exist (42P01 = undefined_table)
        if (result.error.code === "42P01" || result.error.message?.includes("does not exist") || result.error.message?.includes("relation") && result.error.message?.includes("not exist")) {
          setSchemaMissing(true);
          setLoading(false);
          return;
        }
        throw new Error(result.error.message);
      }

      const data = (result?.data || []) as KanbanTask[];
      setTasks(data);
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : "Error al cargar el Kanban.";
      if (msg.includes("does not exist") || msg.includes("42P01")) {
        setSchemaMissing(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const tasksByStatus = (status: string) => tasks.filter(t => t.status === status);

  const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.05)",
    transition: "all 0.2s ease",
    marginBottom: 10,
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)" }}>
        Loading Kanban…
      </div>
    );
  }

  if (schemaMissing) {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 40 }}>
        <div style={{
          maxWidth: 560, margin: "0 auto", textAlign: "center",
          background: "rgba(255,255,255,0.03)", borderRadius: 16,
          padding: 40, border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px", color: "rgba(255,255,255,0.85)" }}>
            Design Kanban — Schema pendiente
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 24 }}>
            La tabla <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: 4 }}>design_kanban_tasks</code> no existe aún en Supabase.
            Ejecutá el SQL de migración para crear las tablas del Kanban.
          </p>
          <div style={{
            background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "16px 20px",
            textAlign: "left", fontSize: 12, color: "rgba(255,255,255,0.5)",
            fontFamily: "monospace", marginBottom: 20,
          }}>
            <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>SQL a ejecutar en Supabase SQL Editor:</div>
            supabase_migrations/design_kanban.sql
          </div>
          <button
            type="button"
            onClick={fetchTasks}
            style={{
              borderRadius: 100, padding: "10px 24px", fontSize: 13, fontWeight: 500,
              cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(108,92,231,0.15)", color: "rgba(255,255,255,0.8)",
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "rgba(255,255,255,0.4)" }}>
        <span>{error}</span>
        <button type="button" onClick={fetchTasks}
          style={{ borderRadius: 100, padding: "8px 20px", fontSize: 13, cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)" }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "20px 20px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "rgba(255,255,255,0.85)" }}>Design Kanban</h2>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "2px 0 0" }}>
            {tasks.length} tarea{tasks.length !== 1 ? "s" : ""} · Producción de diseños por marca
          </p>
        </div>
        <button type="button" onClick={fetchTasks}
          style={{
            borderRadius: 100, padding: "6px 16px", fontSize: 12, fontWeight: 500,
            cursor: "pointer", border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.5)",
            transition: "all 0.2s ease",
          }}>
          ↻ Refresh
        </button>
      </div>

      {/* Kanban Board */}
      <div style={{ display: "flex", gap: 12, minHeight: "calc(100vh - 240px)", paddingBottom: 20 }}>
        {STATUS_COLUMNS.map(col => {
          const columnTasks = tasksByStatus(col.key);
          return (
            <div
              key={col.key}
              style={{
                flex: "1 1 0",
                minWidth: 220,
                maxWidth: 360,
                display: "flex",
                flexDirection: "column",
                background: "rgba(255,255,255,0.015)",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.04)",
                overflow: "hidden",
              }}
            >
              {/* Column Header */}
              <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: col.color, flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {col.label}
                </span>
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 600,
                  color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)",
                  borderRadius: 100, padding: "2px 8px",
                }}>
                  {columnTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
                {columnTasks.length === 0 ? (
                  <div style={{
                    textAlign: "center", padding: 20, color: "rgba(255,255,255,0.1)",
                    fontSize: 12, fontStyle: "italic",
                  }}>
                    Sin tareas
                  </div>
                ) : (
                  columnTasks.map(task => (
                    <div
                      key={task.id}
                      style={cardStyle}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)";
                        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.1)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
                        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.05)";
                      }}
                    >
                      {/* Priority badge + Type */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        {task.priority === 1 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                            background: PRIORITY_COLORS[task.priority],
                            color: "#fca5a5",
                          }}>
                            {PRIORITY_LABELS[task.priority]}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                          {TYPE_ICONS[task.type] || "📌"} {task.type}
                        </span>
                        {task.deadline && (
                          <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                            {new Date(task.deadline).toLocaleDateString("es-PE", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)",
                        lineHeight: 1.4, marginBottom: 6,
                      }}>
                        {task.title}
                      </div>

                      {/* Brand + Format */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {task.brand_name && (
                          <span style={{
                            fontSize: 10, color: "rgba(255,255,255,0.35)",
                            background: "rgba(255,255,255,0.04)", borderRadius: 100, padding: "2px 8px",
                          }}>
                            {task.brand_name}
                          </span>
                        )}
                        {task.format && (
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                            {task.format}
                          </span>
                        )}
                        {task.assigned_to && task.assigned_to !== "default" && (
                          <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                            @{task.assigned_to}
                          </span>
                        )}
                      </div>

                      {/* Brief preview */}
                      {task.brief && (
                        <div style={{
                          fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.4,
                          marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.03)",
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}>
                          {task.brief}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
