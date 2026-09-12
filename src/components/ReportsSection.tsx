import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "../lib/supabase";

// ═══════════════════════════════════════════════════════════════
// ReportsSection — «Reportes» en Configuración. Humanos y agentes
// reportan bugs al mismo backend (MCP-first: el tool report_bug
// escribe la misma tabla). Cada reporte tiene ESTADO visible para
// todos: nuevo → en_progreso → corregido | descartado. Los de IA
// traen pasos exactos y hints de código listos para replicar.
// ═══════════════════════════════════════════════════════════════

type BugReport = {
  id: string;
  description: string;
  url: string | null;
  device_info: Record<string, unknown> | null;
  console_errors: string[] | null;
  screenshot_url: string | null;
  user_id: string | null;
  created_at: string;
  resolved_at: string | null;
  status?: string;
  severity?: string | null;
  workspace_id?: string | null;
  reporter_kind?: string;
  steps?: string | null;
  code_hints?: string | null;
  fix_notes?: string | null;
};

type StatusFilter = "todos" | "nuevo" | "en_progreso" | "corregido" | "descartado";
type KindFilter = "todos" | "ia" | "humano";

const STATUS_LABEL: Record<string, string> = {
  nuevo: "Nuevo",
  en_progreso: "En progreso",
  corregido: "Corregido",
  descartado: "Descartado",
};

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  nuevo: { bg: "rgba(59,130,246,0.16)", fg: "#93c5fd" },
  en_progreso: { bg: "rgba(250,204,21,0.14)", fg: "#facc15" },
  corregido: { bg: "rgba(34,197,94,0.14)", fg: "#4ade80" },
  descartado: { bg: "rgba(148,163,184,0.16)", fg: "#cbd5e1" },
};

const SEVERITIES = ["baja", "media", "alta", "critica"] as const;
const SEVERITY_LABEL: Record<string, string> = { baja: "Baja", media: "Media", alta: "Alta", critica: "Crítica" };
const SEVERITY_FG: Record<string, string> = { baja: "#94a3b8", media: "#93c5fd", alta: "#fbbf24", critica: "#f87171" };

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try { return new Date(value).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }); } catch { return value; }
}

function StatusPill({ status }: { status: string }) {
  const pill = STATUS_PILL[status] || STATUS_PILL.nuevo;
  return (
    <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: pill.bg, color: pill.fg, whiteSpace: "nowrap" }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function ReportsSection({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [kindFilter, setKindFilter] = useState<KindFilter>("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // { id, status, notes } — confirmación inline al cambiar de estado,
  // con campo de nota de corrección cuando el destino es «corregido».
  const [pending, setPending] = useState<{ id: string; status: string; notes: string } | null>(null);
  const [formDescription, setFormDescription] = useState("");
  const [formSeverity, setFormSeverity] = useState<string>("media");
  const [formUrl, setFormUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(""); setNotice("");
    try {
      const result = await apiFetch<{ data: BugReport[] }>("/api/bug-reports?limit=200");
      setReports(result.data || []);
    } catch (cause: any) { setError(cause?.message || "No se pudieron cargar los reportes"); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = reports.reduce<Record<string, number>>((acc, r) => {
    const key = r.status || "nuevo";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const visible = reports.filter(r => {
    if (statusFilter !== "todos" && (r.status || "nuevo") !== statusFilter) return false;
    if (kindFilter !== "todos" && (r.reporter_kind || "humano") !== kindFilter) return false;
    return true;
  });

  const submitReport = async (event: FormEvent) => {
    event.preventDefault();
    if (!formDescription.trim()) return;
    setError(""); setNotice("");
    try {
      await apiFetch("/api/bug-reports", {
        method: "POST",
        body: JSON.stringify({
          description: formDescription.trim(),
          severity: SEVERITIES.includes(formSeverity as any) ? formSeverity : undefined,
          url: formUrl.trim() || undefined,
          workspaceId: workspaceId || undefined,
          deviceInfo: { userAgent: navigator.userAgent, language: navigator.language, screen: `${window.screen.width}x${window.screen.height}` },
        }),
      });
      setFormDescription(""); setFormUrl("");
      setNotice("Reporte enviado. Las IAs y tu equipo lo ven al instante.");
      await load();
    } catch (cause: any) { setError(cause?.message || "No se pudo enviar el reporte"); }
  };

  const applyStatus = async () => {
    if (!pending) return;
    setError(""); setNotice("");
    try {
      await apiFetch(`/api/bug-reports/${pending.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: pending.status, ...(pending.notes.trim() ? { fixNotes: pending.notes.trim() } : {}) }),
      });
      setPending(null);
      setNotice(`Estado actualizado a «${STATUS_LABEL[pending.status] || pending.status}».`);
      await load();
    } catch (cause: any) { setError(cause?.message || "No se pudo actualizar el estado"); }
  };

  return (
    <div className="workspace-grid">
      <article className="workspace-panel">
        <h3>Reportar un bug</h3>
        <form className="workspace-form" onSubmit={submitReport}>
          <label className="workspace-field">
            <span>¿Qué pasó?</span>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={4} placeholder="Describe el problema: qué hiciste, qué esperabas y qué pasó." required />
          </label>
          <label className="workspace-field">
            <span>Severidad</span>
            <select value={formSeverity} onChange={e => setFormSeverity(e.target.value)}>
              {SEVERITIES.map(s => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="workspace-field">
            <span>URL (opcional)</span>
            <input type="url" value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://… (dónde lo viste)" />
          </label>
          <button className="workspace-button" disabled={loading}>Enviar reporte</button>
        </form>
        <p style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
          Los agentes reportan con el tool MCP <code>report_bug</code>: mismos estados, misma tabla, pero con pasos exactos y hints de código para replicar al instante.
        </p>
      </article>
      <article className="workspace-panel span">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <h3 style={{ marginRight: "auto" }}>Reportes ({visible.length})</h3>
          <button type="button" className="workspace-link" onClick={() => void load()} disabled={loading}>Refrescar</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {(["todos", "nuevo", "en_progreso", "corregido", "descartado"] as StatusFilter[]).map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: "1px solid " + (statusFilter === s ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.12)"), background: statusFilter === s ? "rgba(59,130,246,0.16)" : "transparent", color: statusFilter === s ? "#93c5fd" : "rgba(255,255,255,0.55)" }}>
              {s === "todos" ? "Todos" : STATUS_LABEL[s]}{s !== "todos" && counts[s] ? ` (${counts[s]})` : ""}
            </button>
          ))}
          <span style={{ width: 12 }} />
          {(["todos", "ia", "humano"] as KindFilter[]).map(k => (
            <button key={k} type="button" onClick={() => setKindFilter(k)}
              style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: "1px solid " + (kindFilter === k ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.12)"), background: kindFilter === k ? "rgba(168,85,247,0.14)" : "transparent", color: kindFilter === k ? "#d8b4fe" : "rgba(255,255,255,0.55)" }}>
              {k === "todos" ? "Todas las fuentes" : k === "ia" ? "🤖 IA" : "👤 Humano"}
            </button>
          ))}
        </div>
        <div className="workspace-list">
          {loading && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Cargando…</p>}
          {!loading && visible.length === 0 && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Sin reportes con estos filtros.</p>}
          {visible.map(report => {
            const expanded = expandedId === report.id;
            const isIa = report.reporter_kind === "ia";
            const severity = report.severity || "media";
            return (
              <div className="workspace-row" key={report.id} style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", flexWrap: "wrap" }}>
                  <StatusPill status={report.status || "nuevo"} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: SEVERITY_FG[severity] || "#94a3b8" }}>{SEVERITY_LABEL[severity] || severity}</span>
                  <span style={{ fontSize: 11, color: isIa ? "#d8b4fe" : "rgba(255,255,255,0.45)" }}>{isIa ? "🤖 IA" : "👤 Humano"}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>{fmtDate(report.created_at)}</span>
                  <button type="button" className="workspace-link" onClick={() => { setExpandedId(expanded ? null : report.id); setPending(null); }}>
                    {expanded ? "Ocultar" : "Ver"}
                  </button>
                </div>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.82)", whiteSpace: "pre-wrap", margin: 0, width: "100%" }}>
                  {report.description.length > 220 && !expanded ? report.description.slice(0, 220) + "…" : report.description}
                </p>
                {expanded && (
                  <div style={{ width: "100%", display: "grid", gap: 10, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    {report.steps && (
                      <div>
                        <strong style={{ color: "rgba(255,255,255,0.8)" }}>Pasos para replicar</strong>
                        <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontFamily: "inherit" }}>{report.steps}</pre>
                      </div>
                    )}
                    {report.code_hints && (
                      <div>
                        <strong style={{ color: "rgba(255,255,255,0.8)" }}>Hints de código</strong>
                        <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontFamily: "ui-monospace, monospace", fontSize: 11, background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 8 }}>{report.code_hints}</pre>
                      </div>
                    )}
                    {report.console_errors && report.console_errors.length > 0 && (
                      <div>
                        <strong style={{ color: "rgba(255,255,255,0.8)" }}>Errores de consola</strong>
                        <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontFamily: "ui-monospace, monospace", fontSize: 11, background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 8, color: "#fca5a5" }}>{report.console_errors.join("\n")}</pre>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {report.url && <span>URL: <a href={report.url} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>{report.url}</a></span>}
                      {report.screenshot_url && <a href={report.screenshot_url} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>Ver captura ↗</a>}
                      <span>Reportado: {fmtDate(report.created_at)}</span>
                      {report.resolved_at && <span>Resuelto: {fmtDate(report.resolved_at)}</span>}
                    </div>
                    {report.fix_notes && (
                      <div>
                        <strong style={{ color: "#4ade80" }}>Nota de corrección</strong>
                        <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{report.fix_notes}</p>
                      </div>
                    )}
                  </div>
                )}
                {expanded && (
                  pending?.id === report.id ? (
                    <div style={{ width: "100%", display: "grid", gap: 8, background: "rgba(0,0,0,0.2)", padding: 10, borderRadius: 8 }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                        Cambiar a «{STATUS_LABEL[pending.status]}»{pending.status === "corregido" ? " — ¿cómo se corrigió?" : "?"}
                      </span>
                      <textarea value={pending.notes} onChange={e => setPending({ ...pending, notes: e.target.value })} rows={2} placeholder={pending.status === "corregido" ? "Nota de corrección (opcional)…" : "Nota (opcional)…"} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="workspace-button" onClick={() => void applyStatus()}>Confirmar</button>
                        <button type="button" className="workspace-button secondary" onClick={() => setPending(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(report.status || "nuevo") !== "en_progreso" && (report.status || "nuevo") !== "corregido" && (
                        <button type="button" className="workspace-link" onClick={() => setPending({ id: report.id, status: "en_progreso", notes: "" })}>Marcar en progreso</button>
                      )}
                      {(report.status || "nuevo") !== "corregido" && (
                        <button type="button" className="workspace-link" onClick={() => setPending({ id: report.id, status: "corregido", notes: "" })}>Marcar corregido</button>
                      )}
                      {(report.status || "nuevo") !== "descartado" && (
                        <button type="button" className="workspace-link" onClick={() => setPending({ id: report.id, status: "descartado", notes: "" })}>Descartar</button>
                      )}
                      {(report.status === "corregido" || report.status === "descartado") && (
                        <button type="button" className="workspace-link" onClick={() => setPending({ id: report.id, status: "nuevo", notes: "" })}>Reabrir</button>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
}
