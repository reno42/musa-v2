/**
 * AgentsPanel — static view of the harness agent infrastructure.
 *
 * Shows the three default roles (Leader, Implementer, Reviewer), what each
 * does, the model it runs on, and how they interact. This is the "open the
 * hood" pane: no live data, just the architecture the user would want to see
 * before trusting a process to run itself.
 */

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "#fff",
};

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.6)",
  lineHeight: 1.6,
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 4,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 0",
  borderTop: "1px solid rgba(255,255,255,0.06)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.4)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const valueStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.8)",
  fontWeight: 500,
};

interface AgentCard {
  name: string;
  icon: string;
  color: string;
  description: string;
  responsibilities: string[];
  model: string;
  invokeMethod: string;
}

const AGENTS: AgentCard[] = [
  {
    name: "Leader",
    icon: "M",
    color: "#818cf8",
    description: "Orquesta. Descompone tareas. Nunca implementa codigo directamente.",
    responsibilities: [
      "Lee el backlog y elige la siguiente tarea",
      "Descompone features complejas en pasos",
      "Lanza implementers y reviewers como subagentes",
      "Reporta al humano y pide decisiones",
    ],
    model: "El modelo que configures en el chat",
    invokeMethod: "Eres tu (la IA) hablando con el humano",
  },
  {
    name: "Implementer",
    icon: "I",
    color: "#34d399",
    description: "Ejecuta UNA feature a la vez. Registra cada paso. Pide review al terminar.",
    responsibilities: [
      "Lee el context_summary del harness_start_session",
      "Implementa la feature logueando cada paso con harness_log_entry",
      "Corre healthcheck y checkpoints antes de declarar done",
      "Llama harness_submit_for_review al terminar",
    ],
    model: "El modelo que configures en el chat",
    invokeMethod: "harness_start_session({ role: \"implementer\" })",
  },
  {
    name: "Reviewer",
    icon: "R",
    color: "#fbbf24",
    description: "Verifica contra acceptance criteria y checkpoints C1-C5. Aprueba o rechaza.",
    responsibilities: [
      "Lee las entradas de la sesion con harness_get_entries",
      "Corre harness_healthcheck y harness_evaluate_checkpoint",
      "Aprueba (harness_complete_feature) o rechaza con feedback",
      "Si rechaza, el implementer relanza con el feedback",
    ],
    model: "El modelo que configures en el chat",
    invokeMethod: "harness_start_session({ role: \"reviewer\" })",
  },
];

function AgentCardView({ agent }: { agent: AgentCard }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `${agent.color}22`,
          border: `1px solid ${agent.color}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 700, color: agent.color,
          fontFamily: "'Instrument Serif', serif",
        }}>{agent.icon}</div>
        <div>
          <div style={titleStyle}>{agent.name}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Rol del harness</div>
        </div>
      </div>

      <div style={descStyle}>{agent.description}</div>

      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {agent.responsibilities.map((r, i) => (
          <li key={i} style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>{r}</li>
        ))}
      </ul>

      <div style={metaStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>Modelo</span>
          <span style={valueStyle}>{agent.model}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Como se invoca</span>
          <span style={{ ...valueStyle, fontFamily: "'SF Mono', monospace", fontSize: 11.5 }}>{agent.invokeMethod}</span>
        </div>
      </div>
    </div>
  );
}

const lifecycleSteps = [
  { step: 1, text: "Leader elige una tarea del backlog (harness_list_features)" },
  { step: 2, text: "Leader la reclama (harness_claim_feature)" },
  { step: 3, text: "Leader lanza un implementer (harness_start_session)" },
  { step: 4, text: "Implementer trabaja, logueando cada paso (harness_log_entry)" },
  { step: 5, text: "Implementer termina y envia a review (harness_submit_for_review)" },
  { step: 6, text: "Leader lanza un reviewer (harness_start_session { role: \"reviewer\" })" },
  { step: 7, text: "Reviewer verifica checkpoints C1-C5 (harness_evaluate_checkpoint)" },
  { step: 8, text: "Si pasa: harness_complete_feature. Si no: implementer relanza con feedback" },
];

export function AgentsPanel() {
  return (
    <div style={{
      flex: 1, overflowY: "auto", padding: "28px 32px",
      background: "#06080d", display: "flex", flexDirection: "column", gap: 28,
    }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Infraestructura de Agentes</h2>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 700 }}>
          El harness de Futuraria opera con tres roles. Cada feature pasa por un ciclo:
          el Leader la asigna, un Implementer la ejecuta, y un Reviewer la verifica
          contra checkpoints objetivos antes de marcarla como done.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 20,
      }}>
        {AGENTS.map(a => <AgentCardView key={a.name} agent={a} />)}
      </div>

      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "rgba(255,255,255,0.8)" }}>
          Ciclo de vida de una feature
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {lifecycleSteps.map(s => (
            <div key={s.step} style={{
              display: "flex", alignItems: "flex-start", gap: 14,
              padding: "10px 0",
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 600, color: "#818cf8",
                flexShrink: 0,
              }}>{s.step}</div>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, paddingTop: 4 }}>{s.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        background: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.2)",
        borderRadius: 14,
        padding: 20,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 8 }}>
          Regla: una feature a la vez
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
          harness_claim_feature falla si ya hay una task en draft o design.
          Es el equivalente cloud del check de init.sh que rechaza mas de un
          in_progress. Esto evita que dos agentes pisen el mismo trabajo.
        </div>
      </div>
    </div>
  );
}
