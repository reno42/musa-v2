/**
 * AgentesViews.tsx — vistas AGENTES con datos reales:
 * · agentes/computadoras → apiV2/agentes.ts (GET /api/ghost/jobs + /api/ghost/summary,
 *   router aditivo de solo lectura).
 * · agentes/chats → apiV2/agentes.ts (fetchAgentChats → GET /api/chat/messages).
 */
import { fetchAgentChats, loadAgentes } from "../../lib/apiV2";
import type { ChatMessage, GhostJob } from "../../lib/apiV2/agentes";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, str } from "./helpers";
import { RowAction } from "./CrearViews";
import type { V2ViewProps } from "../router";

const nf = new Intl.NumberFormat("es-PE");

/** agentes/computadoras — sesiones de agentes IA (ghost jobs) y su resumen. */
export function AgentesComputadoras({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadAgentes), [workspaceId]);
  const jobs: GhostJob[] = data ? data.jobs : [];
  const summary = data?.summary;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {error ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : null}

      {data ? (
        <>
          {/* F4: el resumen puede faltar sin que los jobs fallen — la tabla
              no depende de él y la vista nunca queda en blanco silencioso. */}
          {summary ? (
            <DsCard span={4}>
              <DsCardTitle>Sesiones</DsCardTitle>
              <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
                {nf.format(summary.total)}
              </b>
              <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
                {Object.entries(summary.byStatus).map(([status, n]) => (
                  <div key={status} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--ds-border)", padding: "7px 0", fontSize: 12 }}>
                    <span style={{ color: "var(--ds-muted)" }}>{status}</span>
                    <b style={{ color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>{nf.format(n)}</b>
                  </div>
                ))}
              </div>
            </DsCard>
          ) : null}
          <DsCard span={summary ? 8 : 12}>
            <DsCardTitle hint={`${jobs.length} registros`}>Jobs de agentes</DsCardTitle>
            {jobs.length === 0 ? (
              <DataState state="empty" message="Ningún agente ha trabajado en este espacio todavía." />
            ) : (
              <DsTable
                rows={jobs}
                rowKey={r => r.id}
                cols={[
                  { label: "Tarea", cell: r => str(r.task ?? r.id) },
                  { label: "Modo", cell: r => str(r.mode) },
                  { label: "Estado", cell: r => str(r.status) },
                  { label: "Creado", cell: r => fmtDate(r.created_at) },
                  {
                    label: "",
                    cell: r => {
                      const url = typeof r.link === "string" && r.link !== "" ? r.link : null;
                      return url ? <RowAction label="Ver" onClick={() => window.open(url, "_blank", "noopener")} /> : "—";
                    },
                  },
                ]}
              />
            )}
          </DsCard>
        </>
      ) : null}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  user: "Usuario",
  assistant: "Agente",
  system: "Sistema",
  tool: "Tool",
};

const ROLE_COLOR: Record<string, string> = {
  user: "var(--ds-accent)",
  assistant: "var(--ds-azul)",
  system: "var(--ds-muted)",
  tool: "var(--ds-verde)",
};

/** agentes/chats — historial conversacional con agentes (GET /api/chat/messages). */
export function AgentesChats({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(
    () => requireWs(workspaceId, id => fetchAgentChats(id, 100)),
    [workspaceId]
  );
  const chats: ChatMessage[] = data ?? [];
  const ordenados = [...chats].sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
  const byRole = new Map<string, number>();
  for (const c of chats) {
    const role = c.role || "user";
    byRole.set(role, (byRole.get(role) || 0) + 1);
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {error ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : (
        <>
          <DsCard span={4}>
            <DsCardTitle>Mensajes</DsCardTitle>
            <b style={{ font: `400 44px/1 var(--ds-font-display)`, color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>
              {nf.format(chats.length)}
            </b>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
              {[...byRole.entries()].map(([role, n]) => (
                <div key={role} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--ds-border)", padding: "7px 0", fontSize: 12 }}>
                  <span style={{ color: "var(--ds-muted)" }}>{ROLE_LABEL[role] ?? role}</span>
                  <b style={{ color: "var(--ds-bright)", fontVariantNumeric: "tabular-nums" }}>{nf.format(n)}</b>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--ds-muted)", fontSize: 11.5, fontFamily: "var(--ds-font-sans)", lineHeight: 1.5, margin: "12px 0 0" }}>
              Últimos 100 mensajes del historial del espacio (tabla chat_messages).
            </p>
          </DsCard>
          <DsCard span={8}>
            <DsCardTitle hint="orden cronológico">Conversación</DsCardTitle>
            {ordenados.length === 0 ? (
              <DataState state="empty" message="Sin mensajes de chat en este espacio todavía." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
                {ordenados.map(m => (
                  <div key={m.id} style={{ borderLeft: `3px solid ${ROLE_COLOR[m.role ?? ""] ?? "var(--ds-muted)"}`, padding: "4px 0 4px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                      <b style={{ font: `400 10px/1.4 var(--ds-font-display)`, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--ds-bright)" }}>
                        {ROLE_LABEL[m.role ?? ""] ?? str(m.role, "Mensaje")}
                      </b>
                      <span style={{ color: "var(--ds-muted)", fontSize: 11 }}>{fmtDate(m.ts)}</span>
                    </div>
                    <div style={{ color: "var(--ds-text)", fontSize: 12.5, fontFamily: "var(--ds-font-sans)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                      {str(m.content)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DsCard>
        </>
      )}
    </div>
  );
}
