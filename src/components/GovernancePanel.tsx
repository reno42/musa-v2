import React, { useEffect, useState, useRef } from "react";
import { mcpCall } from "../lib/mcpClient";

// ── Types ──

export interface GovernanceSession {
  sessionId: string;
  taskId?: string;
  role: string;
  status: string;
  ts: number;
  label?: string;
  plan?: string;
  taskTitle?: string;
}

interface PlanEntry {
  plan: string;
  taskId?: string;
  role?: string;
  acceptance?: string;
}

interface ReviewEntry {
  verdict?: string;
  summary?: string;
  checkpoints?: Record<string, boolean>;
  notes?: string;
}

interface TraceEntry {
  type: "round";
  role?: string;
  round: number;
  assistantText: string | null;
  toolCalls: Array<{ name: string; id: string; argsPreview: string }>;
  toolResults: Array<{ tool_call_id: string; len: number; preview: string }>;
  tokens: { input: number; output: number; cumulative: number };
  truncated: boolean;
  finishReason?: string;
  conversationLen?: number;
}

interface DiagnosticEntry {
  error?: string;
  round?: number;
  messages?: Array<{
    i: number; role: string; tcCount: number;
    tcIds?: string; tcId?: string; contentPreview: string;
  }>;
  type?: string;
  role?: string;
  promptPreview?: string;
  promptLen?: number;
  toolCount?: number;
  toolNames?: string[];
  before?: number;
  after?: number;
  dropped?: number;
  reason?: string;
  detail?: string;
  orphanedAt?: number;
  pendingIds?: string[];
  requestBodyPreview?: string;
  requestBodyLen?: number;
  preflight?: any;
}

interface SessionData {
  session: GovernanceSession;
  planEntry?: PlanEntry;
  reviewEntry?: ReviewEntry;
  traces: TraceEntry[];
  diagnostics: DiagnosticEntry[];
  loading: boolean;
  error?: string;
}

// ── Styles ──

const overlayBg = { position: "fixed" as const, inset: 0, zIndex: 9200, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" };
const panelStyle = {
  position: "fixed" as const, top: 0, right: 0, bottom: 0, zIndex: 9201,
  width: 520, maxWidth: "90vw",
  background: "rgba(12,12,20,0.98)", borderLeft: "1px solid rgba(200,184,152,0.15)",
  display: "flex", flexDirection: "column" as const, overflow: "hidden",
};
const headerStyle = {
  display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
  borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
};
const badge = (color: string) => ({
  fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
  background: color, color: "#fff", textTransform: "uppercase" as const, letterSpacing: 0.5,
});
const pill = { fontSize: 9, padding: "1px 6px", borderRadius: 8, fontWeight: 600 };

// ── Helpers ──

function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function statusColor(s: string) {
  if (s === "failed" || s === "error") return "rgba(248,113,113,0.2)";
  if (s === "success") return "rgba(52,211,153,0.2)";
  return "rgba(251,191,36,0.2)";
}

// ── localStorage cache key ──
const LS_KEY_PREFIX = "gov_sessions_";

function loadCachedSessions(workspaceId?: string): GovernanceSession[] {
  if (!workspaceId) return [];
  try {
    const raw = localStorage.getItem(LS_KEY_PREFIX + workspaceId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveCachedSessions(workspaceId: string, sessions: GovernanceSession[]) {
  try {
    localStorage.setItem(LS_KEY_PREFIX + workspaceId, JSON.stringify(sessions.slice(-50)));
  } catch { /* quota exceeded — silently drop */ }
}

// ── Component ──

export function GovernancePanel({ sessions, workspaceId, onClose }: {
  sessions: GovernanceSession[];
  workspaceId?: string;
  onClose: () => void;
}) {
  // Merge prop sessions with localStorage cache to survive reloads
  const [mergedSessions, setMergedSessions] = useState<GovernanceSession[]>(() => {
    const cached = loadCachedSessions(workspaceId);
    if (cached.length === 0) return sessions;
    // Props win for same sessionId; cache fills in older sessions
    const propIds = new Set(sessions.map(s => s.sessionId));
    const merged = [...sessions];
    for (const c of cached) {
      if (!propIds.has(c.sessionId)) merged.push(c);
    }
    return merged.slice(-50);
  });

  // Persist to localStorage whenever sessions change
  useEffect(() => {
    if (!workspaceId) return;
    const allIds = new Set(mergedSessions.map(s => s.sessionId));
    const merged = [...mergedSessions];
    for (const s of sessions) {
      if (!allIds.has(s.sessionId)) merged.push(s);
    }
    if (merged.length > mergedSessions.length || sessions.length > 0) {
      setMergedSessions(merged.slice(-50));
    }
  }, [sessions, workspaceId]);

  useEffect(() => {
    if (workspaceId && mergedSessions.length > 0) {
      saveCachedSessions(workspaceId, mergedSessions);
    }
  }, [mergedSessions, workspaceId]);

  const [dataMap, setDataMap] = useState<Record<string, SessionData>>({});
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set());
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mergedSessions.forEach((s) => {
      if (fetchedRef.current.has(s.sessionId)) return;
      fetchedRef.current.add(s.sessionId);
      setDataMap(prev => ({ ...prev, [s.sessionId]: { session: s, traces: [], diagnostics: [], loading: true } }));
      (async () => {
        try {
          const result = await mcpCall("harness_get_entries", { sessionId: s.sessionId });
          const entries: any[] = Array.isArray(result?.entries) ? result.entries : [];
          const traces: TraceEntry[] = [];
          const diagnostics: DiagnosticEntry[] = [];
          let planEntry: PlanEntry | undefined;
          let reviewEntry: ReviewEntry | undefined;
          for (const e of entries) {
            if (e.entry_type === "subagent_trace") { try { traces.push(JSON.parse(e.content)); } catch { /* skip */ } }
            else if (e.entry_type === "diagnostic") { try { diagnostics.push(JSON.parse(e.content)); } catch { /* skip */ } }
            else if (e.entry_type === "plan" && !planEntry) { try { planEntry = JSON.parse(e.content); } catch { planEntry = { plan: e.content }; } }
            else if ((e.entry_type === "review" || e.entry_type === "verdict") && !reviewEntry) { try { reviewEntry = JSON.parse(e.content); } catch { reviewEntry = { summary: e.content }; } }
          }
          traces.sort((a, b) => a.round - b.round);
          setDataMap(prev => ({ ...prev, [s.sessionId]: { session: s, planEntry, reviewEntry, traces, diagnostics, loading: false } }));
        } catch (err: any) {
          setDataMap(prev => ({ ...prev, [s.sessionId]: { session: s, traces: [], diagnostics: [], loading: false, error: err?.message } }));
        }
      })();
    });
  }, [mergedSessions]);

  const toggleRound = (key: string) => {
    setExpandedRounds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <>
      <div style={overlayBg} onClick={onClose} />
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: 16 }}>🏛️</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)", flex: 1 }}>Gobernanza</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{mergedSessions.length} sesión{mergedSessions.length !== 1 ? "es" : ""}</span>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, borderRadius: 6, padding: "3px 8px", fontFamily: "inherit" }}>✕</button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
          {mergedSessions.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
              Sin sesiones aún. Ejecuta un diseño para ver sus trazas aquí.
            </div>
          )}
          {mergedSessions.map((s) => {
            const sd = dataMap[s.sessionId];
            const isExpanded = expandedSession === s.sessionId;
            // Fase 6: token totals for the session summary pills below.
            const traceSumIn = sd?.traces.reduce((acc, t) => acc + (t.tokens?.input || 0), 0) ?? 0;
            const traceSumOut = sd?.traces.reduce((acc, t) => acc + (t.tokens?.output || 0), 0) ?? 0;
            return (
              <div key={s.sessionId} style={{ marginBottom: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                {/* Session header */}
                <button
                  onClick={() => setExpandedSession(isExpanded ? null : s.sessionId)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                    background: isExpanded ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                    border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                    color: "rgba(255,255,255,0.7)", fontSize: 12,
                  }}
                >
                  <span style={{ fontSize: 10, transition: "transform 0.2s", transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</span>
                  <span style={{ ...badge(statusColor(s.status)), color: "rgba(255,255,255,0.9)" }}>
                    {s.role}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                    {s.label || s.taskTitle || s.sessionId}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    {new Date(s.ts).toLocaleTimeString()}
                  </span>
                  <span
                    title="Copiar sessionId"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.sessionId).catch(() => {}); }}
                    style={{ fontSize: 12, opacity: 0.4, cursor: "pointer", padding: "2px 4px" }}
                  >📋</span>
                </button>

                {/* Session body */}
                {isExpanded && (
                  <div style={{ padding: "8px 14px 14px" }}>
                    {sd?.loading && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>Cargando trazas...</div>}
                    {sd?.error && <div style={{ color: "#f87171", fontSize: 11 }}>Error: {sd.error}</div>}

                    {/* Plan entry */}
                    {sd?.planEntry && (
                      <div style={{ marginBottom: 10, borderRadius: 8, border: "1px solid rgba(167,139,250,0.2)", padding: 10, background: "rgba(167,139,250,0.05)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          📋 Plan de ejecución
                          <span
                            title="Copiar plan"
                            onClick={() => navigator.clipboard.writeText(sd.planEntry!.plan).catch(() => {})}
                            style={{ fontSize: 12, opacity: 0.4, cursor: "pointer", padding: "2px 4px" }}
                          >📋</span>
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflow: "auto" }}>
                          {sd.planEntry.plan}
                        </div>
                        {sd.planEntry.acceptance && (
                          <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
                            Acceptance: {sd.planEntry.acceptance}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Review entry */}
                    {sd?.reviewEntry && (
                      <div style={{ marginBottom: 10, borderRadius: 8, border: "1px solid rgba(52,211,153,0.2)", padding: 10, background: "rgba(52,211,153,0.05)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#34d399", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          ✅ Revisión
                          {sd.reviewEntry.verdict && (
                            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: sd.reviewEntry.verdict === "approved" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)", color: sd.reviewEntry.verdict === "approved" ? "#34d399" : "#f87171" }}>
                              {sd.reviewEntry.verdict}
                            </span>
                          )}
                          <span
                            title="Copiar revisión"
                            onClick={() => navigator.clipboard.writeText(sd.reviewEntry!.summary || JSON.stringify(sd.reviewEntry)).catch(() => {})}
                            style={{ fontSize: 12, opacity: 0.4, cursor: "pointer", padding: "2px 4px", marginLeft: "auto" }}
                          >📋</span>
                        </div>
                        {sd.reviewEntry.summary && (
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 80, overflow: "auto" }}>
                            {sd.reviewEntry.summary}
                          </div>
                        )}
                        {sd.reviewEntry.checkpoints && (
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {Object.entries(sd.reviewEntry.checkpoints).map(([k, v]) => (
                              <span key={k} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: v ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", color: v ? "#34d399" : "#f87171" }}>
                                {k}: {v ? "✓" : "✗"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* SessionId quick reference */}
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: "monospace" }}>{s.sessionId}</span>
                      <span
                        title="Copiar sessionId"
                        onClick={() => navigator.clipboard.writeText(s.sessionId).catch(() => {})}
                        style={{ cursor: "pointer", opacity: 0.5, fontSize: 10 }}
                      >📋</span>
                      {s.taskId && (
                        <>
                          <span style={{ margin: "0 4px" }}>·</span>
                          <span style={{ fontFamily: "monospace" }}>task: {s.taskId}</span>
                          <span
                            title="Copiar taskId"
                            onClick={() => navigator.clipboard.writeText(s.taskId!).catch(() => {})}
                            style={{ cursor: "pointer", opacity: 0.5, fontSize: 10 }}
                          >📋</span>
                        </>
                      )}
                    </div>

                    {/* Fase 6: resumen de tokens de toda la sesión */}
                    {sd && sd.traces.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                        <span style={{ ...pill, background: "rgba(52,211,153,0.1)", color: "#34d399" }}>Σ {fmtTokens(traceSumIn + traceSumOut)} tokens</span>
                        <span style={{ ...pill, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>{sd.traces.length} ronda{sd.traces.length !== 1 ? "s" : ""}</span>
                        <span style={{ ...pill, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>{fmtTokens(traceSumIn)} in / {fmtTokens(traceSumOut)} out</span>
                      </div>
                    )}

                    {/* Diagnostics first (if any) */}
                    {sd?.diagnostics.map((d, di) => (
                      <div key={`diag-${di}`} style={{ marginBottom: 10, borderRadius: 8, border: "1px solid rgba(248,113,113,0.2)", padding: 10, background: "rgba(248,113,113,0.05)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#f87171", marginBottom: 4 }}>
                          🔍 {d.type ? `${d.type.replace(/_/g, " ")} — ` : ""}Diagnóstico — Ronda {d.round ?? "?"}
                        </div>
                        {d.error && (
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6, wordBreak: "break-word" }}>
                            {d.error.slice(0, 200)}
                          </div>
                        )}
                        {/* Compaction audit */}
                        {d.type === "compaction" && (
                          <div style={{ fontSize: 10, color: "#fbbf24", marginBottom: 4 }}>
                            📦 Compactación: {d.before} → {d.after} msgs ({d.dropped} eliminados)
                            {d.role ? ` · ${d.role}` : ""}
                            {d.reason ? ` · ${d.reason}` : ""}
                          </div>
                        )}
                        {/* System prompt snapshot */}
                        {d.type === "system_prompt" && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 10, color: "#a78bfa" }}>
                              📋 System prompt ({d.role}): {d.promptLen?.toLocaleString()} chars · {d.toolCount} tools
                            </div>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", maxHeight: 60, overflow: "auto" }}>
                              {d.toolNames?.join(", ")}
                            </div>
                          </div>
                        )}
                        {/* Pre-flight failure */}
                        {d.type === "preflight_failure" && (
                          <div style={{ fontSize: 10, color: "#f87171", marginBottom: 4 }}>
                            ⚠️ Pre-flight FAILED: {d.detail}
                            {d.orphanedAt != null ? ` en índice ${d.orphanedAt}` : ""}
                            {d.pendingIds?.length ? ` · huérfanos: ${d.pendingIds.join(",")}` : ""}
                          </div>
                        )}
                        {/* Request body preview */}
                        {d.requestBodyPreview && (
                          <div style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.25)", marginBottom: 4, padding: "4px 6px", background: "rgba(255,255,255,0.02)", borderRadius: 3, maxHeight: 100, overflow: "auto" }}>
                            📤 Request body ({d.requestBodyLen?.toLocaleString()} chars): {d.requestBodyPreview.slice(0, 500)}
                          </div>
                        )}
                        {/* Preflight in diagnostic */}
                        {d.preflight && d.preflight !== "ok" && (
                          <div style={{ fontSize: 10, color: "#fbbf24", marginBottom: 4 }}>
                            🔎 Post-mortem preflight: huérfanos en índice {d.preflight.orphanedAt}: {d.preflight.detail}
                          </div>
                        )}
                        {d.messages && (
                          <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.35)", maxHeight: 200, overflow: "auto" }}>
                            {d.messages.map((m, mi) => (
                            <div key={mi} style={{
                              padding: "2px 0",
                              color: m.role === "assistant" && m.tcCount > 0 ? "#fbbf24" :
                                     m.role === "tool" ? "#34d399" :
                                     m.role === "assistant" ? "#a78bfa" : "rgba(255,255,255,0.4)",
                            }}>
                              [{m.i}] {m.role}{m.tcCount > 0 ? ` (${m.tcCount} tc: ${m.tcIds})` : ""}{m.tcId ? ` ← ${m.tcId}` : ""} {m.contentPreview.slice(0, 40)}
                            </div>
                          ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Round traces */}
                    {sd?.traces.length === 0 && !sd?.loading && (
                      <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, textAlign: "center", padding: 10 }}>
                        Sin trazas de ronda (el subagente no ejecutó tools).
                      </div>
                    )}
                    {sd?.traces.map((t, ti) => {
                      const roundKey = `${s.sessionId}:${t.round}`;
                      const isRoundOpen = expandedRounds.has(roundKey);
                      return (
                        <div key={ti} style={{ marginBottom: 6, borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", overflow: "hidden" }}>
                          <button
                            onClick={() => toggleRound(roundKey)}
                            style={{
                              width: "100%", display: "flex", alignItems: "center", gap: 6,
                              padding: "6px 10px", background: "rgba(255,255,255,0.02)",
                              border: "none", cursor: "pointer", fontFamily: "inherit",
                              color: "rgba(255,255,255,0.6)", fontSize: 11, textAlign: "left",
                            }}
                          >
                            <span style={{ fontSize: 9, transition: "transform 0.2s", transform: isRoundOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</span>
                            <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Ronda {t.round}</span>
                            {t.role && t.role !== "implementer" && (
                              <span style={{ ...pill, background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>{t.role}</span>
                            )}
                            <span style={{ ...pill, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
                              {fmtTokens(t.tokens.input)} in / {fmtTokens(t.tokens.output)} out
                            </span>
                            <span style={{ ...pill, background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>
                              {t.toolCalls.length} tool{t.toolCalls.length !== 1 ? "s" : ""}
                            </span>
                            {t.truncated && <span style={{ ...pill, background: "rgba(248,113,113,0.2)", color: "#f87171" }}>truncado</span>}
                            {t.finishReason && !t.truncated && <span style={{ ...pill, background: "rgba(52,211,153,0.12)", color: "#34d399" }}>{t.finishReason}</span>}
                            {t.finishReason && t.truncated && <span style={{ ...pill, background: "rgba(248,113,113,0.12)", color: "#f87171" }}>{t.finishReason}</span>}
                            <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                              {fmtTokens(t.tokens.cumulative)} acum
                            </span>
                          </button>
                          {isRoundOpen && (
                            <div style={{ padding: "6px 10px 10px 24px" }}>
                              {t.assistantText && (
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontStyle: "italic", padding: "4px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                                  💬 {t.assistantText}
                                </div>
                              )}
                              {t.toolCalls.map((tc, tci) => {
                                const tr = t.toolResults[tci];
                                return (
                                  <div key={tci} style={{ marginBottom: 6 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: "#a78bfa", marginBottom: 2 }}>
                                      🔧 {tc.name}
                                      <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{tc.id}</span>
                                    </div>
                                    <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginBottom: 2, wordBreak: "break-all", padding: "2px 6px", background: "rgba(255,255,255,0.02)", borderRadius: 3, maxHeight: 60, overflow: "auto" }}>
                                      {tc.argsPreview || "(sin args)"}
                                    </div>
                                    {tr && (
                                      <div style={{ fontSize: 9, fontFamily: "monospace", color: "#34d399", padding: "2px 6px", background: "rgba(52,211,153,0.05)", borderRadius: 3, maxHeight: 80, overflow: "auto" }}>
                                        ✅ {tr.len.toLocaleString()} chars: {tr.preview}
                                        {tr.len > 200 && <span style={{ color: "rgba(255,255,255,0.2)" }}>...</span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
