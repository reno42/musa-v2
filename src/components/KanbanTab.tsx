import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

type CheckpointJson = Record<string, { passed: boolean; description?: string; notes?: string | null; reviewedAt?: string }>;

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
  // Harness fields (added by harness.sql ALTER TABLE)
  account_id?: string | null;
  acceptance?: string[] | null;
  blocker_reason?: string | null;
  checkpoint_json?: CheckpointJson | null;
  completed_at?: string | null;
};

type KanbanColumns = Record<string, KanbanTask[]>;

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
const NEXT_STATUS: Record<string, string> = {
  backlog: "research", research: "draft", draft: "design",
  design: "review", review: "done", feedback: "design",
};

interface Props {
  workspaceId: string;
}

export function KanbanTab({ workspaceId }: Props) {
  const [columns, setColumns] = useState<KanbanColumns>({});
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [sessionEntries, setSessionEntries] = useState<Record<string, any[]>>({});
  const [createAcceptance, setCreateAcceptance] = useState("");
  const [createForm, setCreateForm] = useState({ title: "", type: "post", priority: 2, brief: "", deadline: "" });

  // ── Fetch harness entries for a task's most recent session ──
  const fetchTaskEntries = useCallback(async (taskId: string) => {
    if (sessionEntries[taskId]) return; // cached
    try {
      // First find the most recent session for this task
      const sessJson = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          // Reuse studio_get_card which returns activity log; entries come via separate call
          method: "studio_get_card",
          params: { cardId: taskId },
          id: 1,
        }),
      });
      const sessText = sessJson?.result?.content?.[0]?.text;
      const sessData = sessText ? JSON.parse(sessText) : sessJson?.result || {};
      // We don't have a session list tool yet — use the activity log as a proxy for now.
      // If we wanted harness_entries we'd add harness_list_sessions({ taskId }).
      setSessionEntries(prev => ({ ...prev, [taskId]: sessData?.activityLog || [] }));
    } catch {
      setSessionEntries(prev => ({ ...prev, [taskId]: [] }));
    }
  }, [sessionEntries]);

  // ── Fetch via MCP ──
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    setSchemaMissing(false);
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
        const msg = json.error.message || "Error desconocido";
        if (msg.includes("design_kanban_tasks") && (msg.includes("does not exist") || msg.includes("42P01"))) {
          setSchemaMissing(true);
        } else {
          setError(msg);
        }
        return;
      }
      // MCP wraps result in content[0].text (JSON string)
      const text = json?.result?.content?.[0]?.text;
      const data = text ? JSON.parse(text) : (json?.result || {});
      setTasks(data.cards || []);
      setColumns(data.columns || {});
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : "Error al cargar el Kanban.";
      if (msg.includes("does not exist") || msg.includes("42P01")) {
        setSchemaMissing(true);
      } else if (msg.includes("Method not found")) {
        setError("La herramienta MCP studio_list_cards no está disponible. ¿Hiciste deploy?");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // ── Move card to next status ──
  const advanceCard = useCallback(async (cardId: string) => {
    const task = tasks.find(t => t.id === cardId);
    if (!task) return;
    const next = NEXT_STATUS[task.status] || task.status;
    if (next === task.status) return;
    setMovingCardId(cardId);
    try {
      await apiFetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "studio_move_card",
          params: { cardId, status: next },
          id: 1,
        }),
      });
      // Optimistic update
      setTasks(prev => prev.map(t => t.id === cardId ? { ...t, status: next } : t));
      setColumns(prev => {
        const nextCols = { ...prev };
        for (const key of Object.keys(nextCols)) {
          nextCols[key] = nextCols[key].filter(t => t.id !== cardId);
        }
        const moved = { ...task, status: next };
        if (!nextCols[next]) nextCols[next] = [];
        nextCols[next].push(moved);
        return nextCols;
      });
    } catch (e: any) {
      setError(e?.message || "Error al mover tarjeta");
      fetchTasks(); // refresh on error
    } finally {
      setMovingCardId(null);
    }
  }, [tasks, fetchTasks]);

  // ── Create card via MCP ──
  const handleCreate = useCallback(async () => {
    if (!createForm.title.trim()) return;
    try {
      // Parse acceptance criteria: one per line, ignore blanks
      const acceptanceLines = createAcceptance
        .split("\n")
        .map(l => l.replace(/^[\s\-*]+/, "").trim())
        .filter(Boolean);
      await apiFetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "studio_create_card",
          params: {
            title: createForm.title.trim(),
            workspaceId,
            type: createForm.type,
            priority: createForm.priority,
            brief: createForm.brief.trim() || undefined,
            deadline: createForm.deadline || undefined,
            acceptance: acceptanceLines.length > 0 ? acceptanceLines : undefined,
          },
          id: 1,
        }),
      });
      setShowCreateModal(false);
      setCreateForm({ title: "", type: "post", priority: 2, brief: "", deadline: "" });
      setCreateAcceptance("");
      await fetchTasks();
    } catch (e: any) {
      setError(e?.message || "Error al crear tarjeta");
    }
  }, [createForm, createAcceptance, workspaceId, fetchTasks]);

  const tasksByStatus = (status: string) => tasks.filter(t => t.status === status);

  const cardBase: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    padding: "14px 16px",
    border: "1px solid rgba(255,255,255,0.05)",
    transition: "all 0.2s ease",
    marginBottom: 10,
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 14 }}>Cargando Kanban…</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}>Conectando vía MCP a design_kanban_tasks</span>
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
            fontFamily: "monospace", marginBottom: 20, lineHeight: 1.8,
          }}>
            <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>SQL a ejecutar en Supabase SQL Editor:</div>
            <div>1. Abrí <span style={{ color: "#60a5fa" }}>Supabase → SQL Editor</span></div>
            <div>2. Pegá el contenido de:</div>
            <div style={{ color: "#a78bfa", margin: "4px 0" }}>   supabase_migrations/design_kanban.sql</div>
            <div>3. Ejecutá y refrescá esta página</div>
          </div>
          <button type="button" onClick={fetchTasks}
            style={{
              borderRadius: 100, padding: "10px 24px", fontSize: 13, fontWeight: 500,
              cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(108,92,231,0.15)", color: "rgba(255,255,255,0.8)",
            }}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "rgba(255,255,255,0.4)", padding: 40 }}>
        <span style={{ fontSize: 14, textAlign: "center", maxWidth: 480, lineHeight: 1.6 }}>{error}</span>
        <button type="button" onClick={fetchTasks}
          style={{ borderRadius: 100, padding: "8px 20px", fontSize: 13, cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)" }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "20px 20px 0", position: "relative" }}>
      {/* Create Modal */}
      {showCreateModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9100,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            background: "rgba(18,18,36,0.97)", borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.1)", padding: 28,
            width: 420, maxWidth: "90vw",
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 20px", color: "rgba(255,255,255,0.85)" }}>Nueva tarea de diseño</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input
                placeholder="Título de la tarea"
                value={createForm.title}
                onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                style={inputStyle}
                autoFocus
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <select value={createForm.type} onChange={e => setCreateForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                  {Object.keys(TYPE_ICONS).map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
                </select>
                <select value={createForm.priority} onChange={e => setCreateForm(f => ({ ...f, priority: Number(e.target.value) }))} style={inputStyle}>
                  <option value={1}>🔴 Urgente</option>
                  <option value={2}>🟡 Normal</option>
                  <option value={3}>🟢 Baja</option>
                </select>
              </div>
              <input
                placeholder="Deadline (YYYY-MM-DD)"
                value={createForm.deadline}
                onChange={e => setCreateForm(f => ({ ...f, deadline: e.target.value }))}
                style={inputStyle}
              />
              <textarea
                placeholder="Brief / descripción"
                value={createForm.brief}
                onChange={e => setCreateForm(f => ({ ...f, brief: e.target.value }))}
                style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                rows={3}
              />
              <div>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>
                  Acceptance criteria (uno por línea)
                </label>
                <textarea
                  placeholder={"Ej: Botón Publicar existe en topbar\nAl click llama generate_design_artifacts\nMuestra toast con brandId"}
                  value={createAcceptance}
                  onChange={e => setCreateAcceptance(e.target.value)}
                  style={{ ...inputStyle, minHeight: 70, resize: "vertical", fontSize: 12 }}
                  rows={3}
                />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" onClick={() => setShowCreateModal(false)} style={btnSecondary}>Cancelar</button>
                <button type="button" onClick={handleCreate} disabled={!createForm.title.trim()} style={btnPrimary(!!createForm.title.trim())}>Crear</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "rgba(255,255,255,0.85)" }}>Design Kanban</h2>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "2px 0 0" }}>
            {tasks.length} tarea{tasks.length !== 1 ? "s" : ""} · vía MCP (studio_list_cards)
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setShowCreateModal(true)}
            style={{
              borderRadius: 100, padding: "6px 20px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", border: "1px solid rgba(108,92,231,0.3)",
              background: "rgba(108,92,231,0.12)", color: "rgba(255,255,255,0.8)",
              transition: "all 0.2s ease",
            }}>
            + Nueva
          </button>
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
      </div>

      {/* Kanban Board */}
      <div style={{ display: "flex", gap: 12, minHeight: "calc(100vh - 240px)", paddingBottom: 20 }}>
        {STATUS_COLUMNS.map(col => {
          const columnTasks = tasksByStatus(col.key);
          return (
            <div key={col.key} style={{
              flex: "1 1 0", minWidth: 220, maxWidth: 360,
              display: "flex", flexDirection: "column",
              background: "rgba(255,255,255,0.015)", borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden",
            }}>
              {/* Column Header */}
              <div style={{
                padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {col.label}
                </span>
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 600,
                  color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)",
                  borderRadius: 100, padding: "2px 8px",
                }}>{columnTasks.length}</span>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
                {columnTasks.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.1)", fontSize: 12, fontStyle: "italic" }}>
                    Sin tareas
                  </div>
                ) : (
                  columnTasks.map(task => {
                    const isMoving = movingCardId === task.id;
                    const hasNext = NEXT_STATUS[task.status] && NEXT_STATUS[task.status] !== task.status;
                    return (
                      <div key={task.id}
                        style={{
                          ...cardBase,
                          cursor: task.template_id ? "pointer" : "default",
                          opacity: isMoving ? 0.5 : 1,
                          position: "relative",
                        }}
                        onClick={() => {
                          if (task.template_id) window.location.href = `/?templateId=${task.template_id}`;
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                          e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
                        }}
                      >
                        {/* Advance button */}
                        {hasNext && (
                          <button
                            type="button"
                            disabled={isMoving}
                            onClick={e => { e.stopPropagation(); advanceCard(task.id); }}
                            title={`Mover a ${STATUS_COLUMNS.find(s => s.key === NEXT_STATUS[task.status])?.label || NEXT_STATUS[task.status]}`}
                            style={{
                              position: "absolute", top: 10, right: 10,
                              width: 24, height: 24, borderRadius: "50%",
                              border: "1px solid rgba(255,255,255,0.1)",
                              background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)",
                              cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
                              padding: 0, lineHeight: 1,
                            }}>
                            →
                          </button>
                        )}

                        {/* Priority + Type */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingRight: hasNext ? 30 : 0 }}>
                          {task.priority === 1 && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100, background: PRIORITY_COLORS[1], color: "#fca5a5" }}>
                              Urgente
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
                        <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)", lineHeight: 1.4, marginBottom: 6 }}>
                          {task.title}
                        </div>

                        {/* Brand + Template */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {task.brand_name && (
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.04)", borderRadius: 100, padding: "2px 8px" }}>
                              {task.brand_name}
                            </span>
                          )}
                          {task.template_name && (
                            <span style={{ fontSize: 10, color: "rgba(108,92,231,0.5)" }}>
                              📐 {task.template_name}
                            </span>
                          )}
                          {task.format && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{task.format}</span>}
                        </div>

                        {/* Brief preview */}
                        {task.brief && (
                          <div style={{
                            fontSize: 11, color: "rgba(255,255,255,0.22)", lineHeight: 1.4,
                            marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.03)",
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}>
                            {task.brief}
                          </div>
                        )}

                        {/* Acceptance + Checkpoint badges (harness) */}
                        {((task.acceptance && task.acceptance.length > 0) || (task.checkpoint_json && Object.keys(task.checkpoint_json).length > 0)) && (
                          <div style={{
                            display: "flex", alignItems: "center", gap: 6,
                            marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.03)",
                            flexWrap: "wrap",
                          }}>
                            {task.acceptance && task.acceptance.length > 0 && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  const newId = expandedCard === task.id ? null : task.id;
                                  setExpandedCard(newId);
                                  if (newId) fetchTaskEntries(task.id);
                                }}
                                style={{
                                  fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)",
                                  background: "rgba(255,255,255,0.04)", borderRadius: 100,
                                  padding: "2px 8px", border: "1px solid rgba(255,255,255,0.06)",
                                  cursor: "pointer", fontFamily: "inherit",
                                }}>
                                {expandedCard === task.id ? "▾" : "▸"} {task.acceptance.length} acceptance
                              </button>
                            )}
                            {task.checkpoint_json && Object.entries(task.checkpoint_json).slice(0, 5).map(([cid, cp]) => (
                              <span key={cid} title={`${cid}: ${cp.passed ? "PASS" : "FAIL"}${cp.notes ? " — " + cp.notes : ""}`}
                                style={{
                                  fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 100,
                                  background: cp.passed ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
                                  color: cp.passed ? "#6ee7b7" : "#fca5a5",
                                  border: `1px solid ${cp.passed ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                                }}>
                                {cid} {cp.passed ? "✓" : "✕"}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Expanded panel: acceptance criteria + activity log */}
                        {expandedCard === task.id && (
                          <div style={{
                            marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)",
                            fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5,
                          }} onClick={e => e.stopPropagation()}>
                            {task.acceptance && task.acceptance.length > 0 && (
                              <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                                  Acceptance criteria
                                </div>
                                <ul style={{ margin: 0, paddingLeft: 16 }}>
                                  {task.acceptance.map((a, i) => {
                                    // Match by index to checkpoint C2_item_<i+1> if exists
                                    const cpKey = `C2_item_${i + 1}`;
                                    const cp = task.checkpoint_json?.[cpKey];
                                    return (
                                      <li key={i} style={{ marginBottom: 3, color: cp ? (cp.passed ? "#6ee7b7" : "#fca5a5") : "rgba(255,255,255,0.45)" }}>
                                        {cp ? (cp.passed ? "✓" : "✕") : "•"} {a}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                            {(sessionEntries[task.id] || []).length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                                  Actividad reciente
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {(sessionEntries[task.id] || []).slice(0, 4).map((log: any, i: number) => (
                                    <div key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.08)" }}>
                                      <strong style={{ color: "rgba(255,255,255,0.6)" }}>{log.from_status || "start"}</strong>
                                      {" → "}
                                      <strong style={{ color: "rgba(255,255,255,0.6)" }}>{log.to_status}</strong>
                                      {log.comment && <span style={{ color: "rgba(255,255,255,0.3)" }}> · {log.comment}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e0e0e0",
  outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const btnSecondary: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
  padding: "10px 20px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const btnPrimary = (enabled: boolean): React.CSSProperties => ({
  background: enabled ? "rgba(108,92,231,0.25)" : "rgba(255,255,255,0.03)",
  color: enabled ? "#e0e0e0" : "rgba(255,255,255,0.2)",
  border: `1px solid ${enabled ? "rgba(108,92,231,0.4)" : "rgba(255,255,255,0.05)"}`,
  borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600,
  cursor: enabled ? "pointer" : "not-allowed", fontFamily: "inherit",
});
