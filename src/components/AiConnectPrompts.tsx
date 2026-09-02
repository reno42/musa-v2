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
Guárdala permanente en tu configuración, confirma con tools/list (255 herramientas), lee https://design.futuraria.com/.well-known/mcp.json y https://design.futuraria.com/SKILL.md, y dime qué piezas empezamos a diseñar.`,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    badge: "CLI · mcp.json",
    how: "CLI: ejecuta claude mcp add … o agrega el servidor a tu .mcp.json; reinicia la sesión.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Ejecuta: claude mcp add futuraria --url https://design.futuraria.com/mcp --header "x-api-key: TU_CLAVE_AQUI"
(o agrégala a tu .mcp.json con headers: {"x-api-key": "TU_CLAVE_AQUI"}).
Guárdala permanente, confirma con tools/list (255 herramientas), lee https://design.futuraria.com/.well-known/mcp.json y https://design.futuraria.com/SKILL.md, y dime qué empezamos a diseñar.`,
  },
  {
    id: "claude-cowork",
    name: "Claude Cowork",
    badge: "Desktop · mcp.json",
    how: "Desktop: agrega el servidor a tu mcp.json de Cowork y reinicia la app.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Agrega el servidor a tu config de Cowork (mcp.json):
{"mcpServers": {"futuraria": {"url": "https://design.futuraria.com/mcp", "headers": {"x-api-key": "TU_CLAVE_AQUI"}}}}
Guárdala permanente, confirma con tools/list (255 herramientas), lee https://design.futuraria.com/.well-known/mcp.json y https://design.futuraria.com/SKILL.md, y dime qué empezamos a diseñar.`,
  },
  {
    id: "chatgpt-desktop-codex",
    name: "ChatGPT Desktop + Codex",
    badge: "Desktop · config.toml",
    how: "En el mismo equipo comparten ~/.codex/config.toml. La IA instala, verifica por capas y te pide reiniciar antes de validar las herramientas nativas. No aplica a ChatGPT web.",
    prompt: `Configura y verifica Futuraria exclusivamente en ChatGPT Desktop o Codex Desktop. No estoy hablando de ChatGPT web.

DATOS CANÓNICOS
- Futuraria significa exclusivamente https://design.futuraria.com y el servidor MCP llamado futuraria.
- Endpoint MCP exacto: https://design.futuraria.com/mcp
- Mi clave MCP de Futuraria: TU_CLAVE_AQUI

REGLAS FAIL-CLOSED
- No busques "Futuraria" en Internet.
- No abras futuraria.io ni ningún dominio distinto de design.futuraria.com.
- No uses búsqueda web, navegador ni fuentes externas como sustituto del MCP.
- No finjas una conexión por haber leído una URL, el manifiesto, SKILL.md o documentación.
- No afirmes que estás conectado por completar tools/list mediante una llamada HTTP directa si las herramientas no aparecen en el catálogo nativo de una tarea nueva.
- Éxito significa ejecutar realmente harness_healthcheck mediante el MCP nativo y recibir ok: true.

INSTALACIÓN PERMANENTE
1. Lee el archivo global ~/.codex/config.toml. En Windows es C:\\Users\\<USUARIO>\\.codex\\config.toml.
2. Preserva intactos todos los demás servidores, plugins y preferencias.
3. Busca cualquier bloque existente de Futuraria, aunque tenga otro nombre. Actualiza o reemplaza solo ese bloque; no crees duplicados.
4. Si hay conexiones de varias cuentas, no uses el bloque único del paso 5. Conserva cada cuenta con un nombre separado y deja habilitada únicamente la cuenta elegida. Ejemplo:

[mcp_servers.futuraria_personal]
enabled = false
url = "https://design.futuraria.com/mcp"
http_headers = { "x-api-key" = "<CLAVE_EXISTENTE>" }

[mcp_servers.futuraria_cliente]
enabled = true
url = "https://design.futuraria.com/mcp"
http_headers = { "x-api-key" = "TU_CLAVE_AQUI" }

No sobrescribas, imprimas ni borres la clave de otra cuenta sin autorización. En la tarea nueva, identifica como futuraria al bloque activo de la cuenta elegida.
5. Para una sola cuenta, deja exactamente este bloque:

[mcp_servers.futuraria]
url = "https://design.futuraria.com/mcp"
http_headers = { "x-api-key" = "TU_CLAVE_AQUI" }

6. Para esta ruta no uses OAuth, Authorization: Bearer, "Variable de entorno del token portador", STDIO, Node.js, npm ni npx. La autenticación es el encabezado x-api-key.
7. Guarda el archivo permanentemente. Si el sandbox bloquea la escritura global, solicita aprobación para editar ese archivo y continúa al recibirla. No abandones la tarea ni escribas la configuración dentro del repositorio.
8. No vuelvas a imprimir la clave completa en la respuesta ni en logs visibles.

VERIFICACIÓN POR CAPAS
Reporta cada capa por separado; no conviertas una capa parcial en éxito total.

A. CONFIGURADO
- Confirma que config.toml conserva lo anterior y contiene una sola conexión activa para la cuenta elegida, con la URL exacta.

B. ENDPOINT ACCESIBLE
- GET https://design.futuraria.com/.well-known/mcp.json debe responder HTTP 200.
- GET https://design.futuraria.com/SKILL.md debe responder HTTP 200.
- Esto solo prueba acceso al endpoint; todavía no prueba autenticación ni carga nativa.

C. AUTENTICADO Y HANDSHAKE VÁLIDO
- Envía initialize por JSON-RPC 2.0 a https://design.futuraria.com/mcp con x-api-key.
- Envía notifications/initialized. Debe responder HTTP 202 con cuerpo vacío.
- Envía tools/list. Actualmente debe devolver 255 herramientas. Usa el resultado real de tools/list como fuente del conteo.
- Esto prueba endpoint, clave y protocolo; todavía no prueba que esta conversación haya cargado las herramientas nativamente.

D. CARGADO NATIVAMENTE
- Editar config.toml no recarga una conversación abierta.
- Indícame que cierre completamente ChatGPT Desktop y Codex Desktop, incluidos procesos en segundo plano, vuelva a abrir la aplicación que usaré y cree una tarea nueva.
- No declares esta capa completa desde la conversación donde editaste el archivo.

VERIFICACIÓN OBLIGATORIA EN LA TAREA NUEVA
En la tarea nueva, Futuraria sigue significando exclusivamente el MCP futuraria de design.futuraria.com. No uses web.

1. Revisa el catálogo NATIVO de herramientas de esa tarea y exige la presencia de:
   - harness_healthcheck
   - harness_get_context
   - harness_list_features
   - list_workspaces
   - list_templates
2. Si no aparecen, detente. No navegues, no improvises y no afirmes conexión. Revisa ~/.codex/config.toml y los logs locales de Codex buscando server_name=futuraria, sin mostrar la clave. Reporta exactamente:
   "Futuraria está configurado, pero sus herramientas MCP no fueron cargadas en esta tarea. No utilicé búsqueda web."
3. Si aparecen, ejecuta realmente mediante MCP:
   harness_healthcheck({})
4. Si devuelve ok: false, detente y reporta exactamente qué check falló. No uses web como alternativa.
5. Solo si devuelve ok: true, ejecuta en este orden:
   harness_get_context({ agentType: "leader" })
   harness_list_features({ status: "backlog" })
   list_workspaces({})
   list_templates({ workspaceId: "<ID_DEL_WORKSPACE_ENCONTRADO>" })
6. Ejecuta también:
   list_assets({ workspaceId: "<ID_DEL_WORKSPACE_ENCONTRADO>" })
7. Responde con este formato:
   "Conexión MCP confirmada.
   harness_healthcheck: ok.
   Workspace autenticado: <NOMBRE>.
   Diseños/templates (<TOTAL>): <LISTA>.
   Assets (<TOTAL>): <LISTA O NINGUNO>.
   No utilicé búsqueda web.

   ¿Qué empezamos a diseñar?"

No sustituyas ninguna llamada MCP por lectura de documentación. Si una herramienta requiere parámetros adicionales, obténlos de los resultados MCP anteriores; no los inventes.`,
  },
  {
    id: "otra",
    name: "Otra IA",
    badge: "Endpoint + clave",
    how: "Si soporta MCP, dale endpoint + clave; si no, pásale la guía descargable (SKILL.md).",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Conecta https://design.futuraria.com/mcp enviando el encabezado (header) llamado x-api-key con el valor TU_CLAVE_AQUI (o ?key= en la URL si no soportas encabezados).
Guárdala permanente, confirma con tools/list (255 herramientas), lee https://design.futuraria.com/.well-known/mcp.json y https://design.futuraria.com/SKILL.md, y dime qué empezamos a diseñar.`,
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
                aria-label={`${copiedId === ai.id ? "Prompt copiado de" : "Copiar prompt de"} ${ai.name}`}
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
