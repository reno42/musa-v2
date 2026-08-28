import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

/** Prompts listos para pegarle a cada IA (harnesses de escritorio con acceso a
 * sus propios archivos de config). El usuario pega su clave una vez y cada
 * prompt se arma con ella: la IA configura su MCP, guarda la clave permanente,
 * confirma con tools/list y empieza a diseñar. TU_CLAVE_AQUI es el placeholder.
 * Vive en Configuración → API MCP (junto a la creación de claves); usó estar en
 * la landing. Reutiliza las clases landing-* del stylesheet global. */
interface AiPrompt {
  id: string;
  name: string;
  badge: string;
  how: string;
  prompt: string;
}

const renderPrompt = (prompt: string, apiKey: string) =>
  prompt.split("TU_CLAVE_AQUI").join(apiKey || "TU_CLAVE_AQUI");

const AI_PROMPTS: AiPrompt[] = [
  {
    id: "hermes",
    name: "Hermes",
    badge: "HTTP directo",
    how: "Agente propio con HTTP: endpoint + clave, sin archivos que tocar.",
    prompt: `Tengo cuenta en Futuraria (design.futuraria.com) y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Conéctate al endpoint https://design.futuraria.com/mcp enviando el encabezado (header) llamado x-api-key con el valor TU_CLAVE_AQUI (si no puedes mandar encabezados usa https://design.futuraria.com/mcp?key=TU_CLAVE_AQUI).
Guárdala permanente en tu configuración, confirma con tools/list (241 herramientas), lee /.well-known/mcp.json y /SKILL.md, y dime qué piezas empezamos a diseñar.`,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    badge: "CLI · mcp.json",
    how: "CLI: ejecuta claude mcp add … o agrega el servidor a tu .mcp.json; reinicia la sesión.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Ejecuta: claude mcp add futuraria --url https://design.futuraria.com/mcp --header "x-api-key: TU_CLAVE_AQUI"
(o agrégala a tu .mcp.json con headers: {"x-api-key": "TU_CLAVE_AQUI"}).
Guárdala permanente, confirma con tools/list (241 herramientas), lee /.well-known/mcp.json y /SKILL.md, y dime qué empezamos a diseñar.`,
  },
  {
    id: "claude-cowork",
    name: "Claude Cowork",
    badge: "Desktop · mcp.json",
    how: "Desktop: agrega el servidor a tu mcp.json de Cowork y reinicia la app.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Agrega el servidor a tu config de Cowork (mcp.json):
{"mcpServers": {"futuraria": {"url": "https://design.futuraria.com/mcp", "headers": {"x-api-key": "TU_CLAVE_AQUI"}}}}
Guárdala permanente, confirma con tools/list (241 herramientas), lee /.well-known/mcp.json y /SKILL.md, y dime qué empezamos a diseñar.`,
  },
  {
    id: "codex",
    name: "Codex",
    badge: "CLI · config.toml",
    how: "CLI: agrega el bloque [mcp_servers.futuraria] a ~/.codex/config.toml y reinicia la sesión.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Agrega a ~/.codex/config.toml:
[mcp_servers.futuraria]
url = "https://design.futuraria.com/mcp"
http_headers = { "x-api-key" = "TU_CLAVE_AQUI" }
Guárdala permanente, confirma con tools/list (241 herramientas), lee /.well-known/mcp.json y /SKILL.md, y dime qué empezamos a diseñar.`,
  },
  {
    id: "chatgpt-cowork",
    name: "ChatGPT Cowork",
    badge: "Desktop · config.toml",
    how: "Desktop: agrega el servidor MCP de Futuraria a tu config de Cowork y reinicia la app.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Agrega el servidor MCP de Futuraria a tu config de Cowork (config.toml):
[mcp_servers.futuraria]
url = "https://design.futuraria.com/mcp"
http_headers = { "x-api-key" = "TU_CLAVE_AQUI" }
Guárdala permanente, confirma con tools/list (241 herramientas), lee /.well-known/mcp.json y /SKILL.md, y dime qué empezamos a diseñar.`,
  },
  {
    id: "otra",
    name: "Otra IA",
    badge: "Endpoint + clave",
    how: "Si soporta MCP, dale endpoint + clave; si no, pásale la guía descargable (SKILL.md).",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Conecta https://design.futuraria.com/mcp enviando el encabezado (header) llamado x-api-key con el valor TU_CLAVE_AQUI (o ?key= en la URL si no soportas encabezados).
Guárdala permanente, confirma con tools/list (241 herramientas), lee /.well-known/mcp.json y /SKILL.md, y dime qué empezamos a diseñar.`,
  },
];

/** Pega tu clave MCP y copia el prompt de tu IA, ya armado con ella. La clave
 * recién creada (initialKey, mostrada una sola vez arriba) pre-rellena los
 * prompts. */
export function AiConnectPrompts({ initialKey = "" }: { initialKey?: string }) {
  const [apiKey, setApiKey] = useState(initialKey);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => { if (initialKey) setApiKey(initialKey); }, [initialKey]);

  // ── Copy one AI prompt (clipboard + execCommand fallback) ──
  const handleCopyPrompt = useCallback((id: string) => {
    const text = renderPrompt(AI_PROMPTS.find(p => p.id === id)?.prompt ?? "", apiKey);
    const done = () => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      /* clipboard no disponible */
    }
    document.body.removeChild(ta);
  }, [apiKey]);

  // ── One click on a prompt selects the whole text (easy copy-paste) ──
  const handleSelectPrompt = useCallback((e: ReactMouseEvent<HTMLPreElement>) => {
    const range = document.createRange();
    range.selectNodeContents(e.currentTarget);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  return (
    <div>
      <div className="landing-key-box">
        <label className="landing-key-label" htmlFor="ai-connect-key-input">Tu clave MCP (opcional)</label>
        <input
          id="ai-connect-key-input"
          className="landing-key-input"
          type="text"
          placeholder="fdr_ws_…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="landing-key-hint">
          {apiKey
            ? "Los prompts de abajo ya incluyen tu clave — copia el de tu IA y pégalo."
            : "Sin clave aún: crea una en el panel de arriba, cópiala acá y el prompt se arma solo."}
        </span>
      </div>
      <div className="landing-ai-prompts">
        {AI_PROMPTS.map(ai => (
          <div key={ai.id} className="landing-ai-prompt-box">
            <div className="landing-ai-prompt-head">
              <span className="landing-ai-prompt-name">{ai.name}</span>
              <span className="landing-ai-badge">{ai.badge}</span>
            </div>
            <p className="landing-ai-how">{ai.how}</p>
            <pre
              className="landing-code-block landing-copy-wrap landing-ai-pre"
              onClick={handleSelectPrompt}
              title="Clic para seleccionar todo el prompt"
            >
              {renderPrompt(ai.prompt, apiKey)}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleCopyPrompt(ai.id); }}
                className="landing-copy-btn"
              >
                {copiedId === ai.id ? "✓ Copiado" : "Copiar"}
              </button>
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
