import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

/** Prompts listos para pegarle a cada IA (harnesses de escritorio con acceso a
 * sus propios archivos de config). El usuario pega su clave una vez y cada
 * prompt se arma con ella: la IA configura su MCP, guarda la clave permanente,
 * confirma con tools/list y empieza a diseñar. TU_CLAVE_AQUI es el placeholder.
 * Vive en Configuración → API MCP (junto a la creación de claves); usó estar en
 * la landing. Reutiliza las clases landing-* del stylesheet global. */
export interface AiPrompt {
  id: string;
  name: string;
  badge: string;
  how: string;
  prompt: string;
}

export const renderPrompt = (prompt: string, apiKey: string) =>
  prompt.split("TU_CLAVE_AQUI").join(apiKey || "TU_CLAVE_AQUI");

export const AI_PROMPTS: AiPrompt[] = [
  {
    id: "hermes",
    name: "Hermes",
    badge: "HTTP directo",
    how: "Agente propio con HTTP: endpoint + clave, sin archivos que tocar.",
    prompt: `Tengo cuenta en Futuraria (design.futuraria.com) y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Conéctate al endpoint https://design.futuraria.com/mcp enviando el encabezado (header) llamado x-api-key con el valor TU_CLAVE_AQUI (si no puedes mandar encabezados usa https://design.futuraria.com/mcp?key=TU_CLAVE_AQUI).
Guárdala permanente en tu configuración, confirma la conexión con tools/list, lee https://design.futuraria.com/MUSA_START.md y dime qué piezas empezamos a diseñar.`,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    badge: "CLI · mcp.json",
    how: "CLI: ejecuta claude mcp add … o agrega el servidor a tu .mcp.json; reinicia la sesión.",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Autoinstálate el servidor MCP:
1. Ejecuta: claude mcp add --transport http futuraria https://design.futuraria.com/mcp --header "x-api-key: TU_CLAVE_AQUI" --scope user
   (--scope user lo deja permanente para todos los proyectos; sin él solo existe en la carpeta actual. Alternativa: agregarlo al .mcp.json del proyecto con "type": "http" y headers {"x-api-key": "TU_CLAVE_AQUI"}).
2. Pre-autoriza las herramientas para que no pida permiso en cada uso: agrega "mcp__futuraria" al array permissions.allow de ~/.claude/settings.json (crea el archivo si no existe). Si no puedes editarlo, dile al usuario que responda "Always allow" la primera vez que Claude pida permiso. NO uses --dangerously-skip-permissions ni des permisos globales: solo este servidor.
3. Verifica con: claude mcp list y claude mcp get futuraria. Luego, en una sesión NUEVA (la actual no recarga el servidor): tools/list (usa el conteo REAL como fuente, no lo inventes) y ejecuta harness_healthcheck — ok:true significa conectado. Si falla la autenticación, ejecuta verify_api_key({apiKey}) vía el endpoint.
No finjas conexión por haber leído la documentación. Listo: dime qué empezamos a diseñar.`,
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    badge: "Connector OAuth · mcp-remote",
    how: "Ruta remota: conector OAuth nativo (sin Node). Fallback local: mcp-remote en claude_desktop_config.json (requiere Node, clave en args).",
    prompt: `Quiero conectar Futuraria (design.futuraria.com) a Claude Desktop. Elige UNA ruta y dime cuál usaste.

RUTA REMOTA (recomendada — sin Node, sin clave en archivos):
1. En Claude Desktop: Customize → Connectors → "+" → Add custom connector.
2. Pega la URL exacta: https://design.futuraria.com/mcp
3. Completa el login OAuth de Futuraria y acepta los permisos design.read y design.write. NO pegues ninguna clave API: esta ruta usa OAuth.
4. Activa el conector para la conversación (+ → Connectors).
Nota: el conector se conecta desde la nube de Anthropic — la URL es pública, funciona.

RUTA LOCAL (fallback — requiere Node/npm; clave dentro del config y del proceso):
1. Edita claude_desktop_config.json (Claude Desktop → Settings → Developer):
{"mcpServers": {"futuraria": {"command": "npx", "args": ["mcp-remote", "https://design.futuraria.com/mcp?key=TU_CLAVE_AQUI"]}}}
   (esta es mi clave MCP: TU_CLAVE_AQUI)
2. Reinicia Claude Desktop por completo (cierra procesos en segundo plano).

VERIFICACIÓN (conversación NUEVA, en ambas rutas): tools/list — reporta el conteo REAL, no lo inventes — y ejecuta harness_healthcheck: ok:true = conectado. No finjas conexión por haber leído documentación. Si algo falla, dime el paso exacto y el error. ¿Qué empezamos a diseñar?`,
  },
  {
    id: "claude-cowork",
    name: "Claude Cowork",
    badge: "Customize → Connectors · OAuth",
    how: "Cowork: conector remoto OAuth desde Customize → Connectors (NO mcp.json — los servidores locales de Desktop no existen en Cowork).",
    prompt: `Quiero conectar Futuraria (design.futuraria.com) a Claude Cowork.
La ruta correcta en Cowork es el CONECTOR REMOTO con OAuth — no edites ningún mcp.json ni busques archivos de configuración local (no aplican en Cowork):
1. Customize → Connectors → "+" → Add custom connector.
2. Pega la URL exacta: https://design.futuraria.com/mcp
3. Completa el login OAuth de Futuraria y acepta los permisos design.read y design.write. NO necesito pegar ninguna clave API en esta ruta.
4. Verifica que Futuraria aparezca activo en el menú de conectores y actívalo para la conversación (+ → Connectors).
Nota técnica: el conector se conecta desde la nube de Anthropic (la URL es pública, funciona). Los permisos de Cowork sobre mi computador (archivos, apps, pantalla) NO hacen falta para Futuraria — no los pidas ni los actives.
VERIFICACIÓN: tools/list — reporta el conteo REAL, no lo inventes — y ejecuta harness_healthcheck: ok:true = conectado. No finjas conexión por haber leído documentación. Si algo falla, dime el paso exacto y el error. ¿Qué empezamos a diseñar?`,
  },
  {
    id: "chatgpt-desktop-codex",
    name: "ChatGPT Desktop + Codex",
    badge: "Desktop · config.toml",
    how: "Guía unificada con dos rutas: configuración manual en Complementos o instalación automática en config.toml. Incluye cada casilla, reinicio y verificación MCP por capas. No aplica a ChatGPT web.",
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

ELIGE UNA SOLA RUTA: MANUAL O AUTOMÁTICA
- Ambas rutas configuran el mismo servidor MCP en el equipo. No completes las dos ni dejes conexiones duplicadas activas.
- Usa la RUTA MANUAL si vas a llenar el formulario de la aplicación.
- Usa la RUTA AUTOMÁTICA si esta IA puede editar el archivo global ~/.codex/config.toml.

RUTA MANUAL — CONFIGURACIÓN EN LA APLICACIÓN
1. Abre ChatGPT Desktop o Codex Desktop en el equipo donde usarás Futuraria. No abras ChatGPT web.
2. Ve a Configuración → Complementos → pestaña MCP → Añadir → Añadir MCP personalizado.
   - Según la versión, el último botón puede decir "Agregar servidor" o "MCP personalizado". Es el formulario MCP de la aplicación de escritorio; no busques ni abras una página web.
3. Completa el formulario exactamente así:
   - Nombre: futuraria
     Para una sola cuenta usa futuraria. Si administras varias cuentas, usa nombres distintos y genéricos, por ejemplo futuraria_personal y futuraria_cliente, y deja habilitada únicamente la cuenta que quieras usar.
   - Tipo: HTTP secuenciable o Streamable HTTP, según el idioma de la aplicación. NO selecciones STDIO.
   - URL: https://design.futuraria.com/mcp
     Escríbela exactamente como texto plano: sin Markdown, espacios, barra final ni dominio alternativo.
   - Variable de entorno del token portador: DEJAR VACÍO.
   - Encabezados: agrega una sola fila con:
     Clave: x-api-key
     Valor: TU_CLAVE_AQUI
   - Encabezados desde variables de entorno: DEJAR VACÍO.
4. Para esta ruta x-api-key:
   - No pegues la clave en "Variable de entorno del token portador", URL, comando, argumentos ni variables de entorno.
   - No uses Node.js, npm, npx, STDIO, OAuth ni el botón Autenticar.
5. Pulsa Guardar.
6. Vuelve a Configuración → Complementos → MCP y comprueba que futuraria esté habilitado.
   - Si ya existía un servidor de Futuraria con otra clave, edítalo y reemplaza la clave, o deshabilítalo antes de habilitar la cuenta nueva.
   - No dejes activas dos conexiones de Futuraria pertenecientes a cuentas distintas.
   - No borres ni modifiques otras integraciones.
7. Reinicia completamente la aplicación:
   - Si aparece un botón Reiniciar, úsalo.
   - Si no aparece, cierra todas las ventanas de ChatGPT Desktop y Codex Desktop, asegúrate de que no queden procesos de esas aplicaciones en segundo plano y vuelve a abrir únicamente la aplicación que usarás.
8. Crea una tarea o conversación nueva. No intentes validar la carga nativa en el chat donde agregaste el MCP.
9. Continúa en VERIFICACIÓN POR CAPAS, empezando por confirmar la configuración manual y luego el endpoint, handshake y carga nativa.

RESUMEN DE CASILLAS
Campo → Valor
Nombre → futuraria
Tipo → HTTP secuenciable / Streamable HTTP
URL → https://design.futuraria.com/mcp
Variable de entorno del token portador → VACÍO
Encabezados · Clave → x-api-key
Encabezados · Valor → TU_CLAVE_AQUI
Encabezados desde variables de entorno → VACÍO
STDIO / comando / argumentos → NO USAR
OAuth / Autenticar → NO USAR

ERRORES COMUNES QUE DEBES EVITAR
- Seleccionar STDIO en lugar de HTTP secuenciable / Streamable HTTP.
- Usar futuraria.io o cualquier dominio que no sea design.futuraria.com.
- Poner la clave en la variable de entorno del token portador en vez del encabezado x-api-key.
- Omitir el encabezado x-api-key o escribir otro nombre de encabezado.
- Pegar la URL como Markdown, por ejemplo [https://design.futuraria.com/mcp](https://design.futuraria.com/mcp), en vez de texto plano.
- Agregar una barra final, espacios o un error tipográfico a https://design.futuraria.com/mcp.
- Probar en una conversación antigua en vez de reiniciar y crear una tarea nueva.
- Confundir una URL accesible, documentación o tools/list por HTTP directo con herramientas MCP cargadas nativamente.
- Pulsar Autenticar o intentar OAuth para esta ruta x-api-key.
- Dejar activas simultáneamente conexiones de Futuraria de cuentas distintas.

RUTA AUTOMÁTICA — CONFIGURACIÓN MEDIANTE CONFIG.TOML
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
- Si elegiste la ruta manual, confirma en Configuración → Complementos → MCP que existe una sola conexión activa para la cuenta elegida, con tipo HTTP secuenciable / Streamable HTTP, la URL exacta y el encabezado x-api-key.
- Si elegiste la ruta automática, confirma que config.toml conserva lo anterior y contiene una sola conexión activa para la cuenta elegida, con la URL exacta.

B. ENDPOINT ACCESIBLE
- GET https://design.futuraria.com/.well-known/mcp.json debe responder HTTP 200.
- GET https://design.futuraria.com/MUSA_START.md debe responder HTTP 200.
- Esto solo prueba acceso al endpoint; todavía no prueba autenticación ni carga nativa.

C. AUTENTICADO Y HANDSHAKE VÁLIDO
- Envía initialize por JSON-RPC 2.0 a https://design.futuraria.com/mcp con x-api-key.
- Envía notifications/initialized. Debe responder HTTP 202 con cuerpo vacío.
- Envía tools/list y usa su resultado real como fuente de los nombres y esquemas disponibles.
- Esto prueba endpoint, clave y protocolo; todavía no prueba que esta conversación haya cargado las herramientas nativamente.

D. CARGADO NATIVAMENTE
- Agregar el servidor desde Complementos o editar config.toml no recarga una conversación abierta.
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
    how: "Si soporta MCP, dale endpoint + clave; si no, pásale la guía breve (MUSA_START.md).",
    prompt: `Tengo cuenta en Futuraria y esta clave API de Futuraria (la clave MCP): TU_CLAVE_AQUI.
Conecta https://design.futuraria.com/mcp enviando el encabezado (header) llamado x-api-key con el valor TU_CLAVE_AQUI (o ?key= en la URL si no soportas encabezados).
Guárdala permanente, confirma con tools/list, lee https://design.futuraria.com/MUSA_START.md y dime qué empezamos a diseñar.`,
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
