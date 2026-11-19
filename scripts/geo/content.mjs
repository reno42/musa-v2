// REQ-072 — contenido fuente del geo-build (ES/EN).
// REGLA: cada dato aquí debe ser verificable en prod (precios = llms.txt + PlansTable).
// Al cambiar pricing: actualizar AQUÍ y public/llms.txt en el mismo commit.

export const SITE = "https://musaworks.com";
export const TODAY = "2026-11-18";

export const PLANS = [
  {
    name: "Creator", es: "1 persona · 5 marcas",
    byok: "US$79/mes", withAi: "US$119/mes", credits: "600 créditos de IA al mes",
    launch: "Lanzamiento: US$19 (BYOK) / US$29 (con IA) los primeros 3 meses",
  },
  {
    name: "Agency", es: "5 personas · 25 marcas · portal de clientes",
    byok: "US$349/mes", withAi: "US$499/mes", credits: "3.000 créditos de IA al mes",
    launch: "Lanzamiento: US$149 (BYOK) / US$199 (con IA) los primeros 3 meses · persona extra US$49/US$69",
  },
  {
    name: "Enterprise", es: "15 personas · marcas ilimitadas · áreas y aprobaciones",
    byok: "—", withAi: "US$1.490/mes", credits: "10.000 créditos de IA al mes",
    launch: "Persona extra US$69 · facturación anual: 2 meses gratis",
  },
];

export const FEATURES = [
  { k: "planear", es: ["Planear", "Investiga temas, arma briefs y playbooks, y organiza el calendario de cada marca."], en: ["Plan", "Research topics, build briefs and playbooks, and organize each brand's calendar."], },
  { k: "crear", es: ["Crear", "Editor de diseño y video, fotos, motion, QR y automatizaciones con el sistema de cada marca."], en: ["Create", "Design and video editors, photos, motion, QR codes and automations on each brand's system."], },
  { k: "conversar", es: ["Conversar", "Bandeja unificada de mensajes y comentarios de todos los canales, con respuestas de IA."], en: ["Converse", "One inbox for messages and comments across every channel, with AI replies."], },
  { k: "anunciar", es: ["Anunciar", "Campañas de pauta: planifica, sincroniza, crea y pausa desde un solo lugar."], en: ["Advertise", "Ad campaigns: plan, sync, create and pause from one place."], },
  { k: "vender", es: ["Vender", "CRM: oportunidades, cotizaciones con firma, personas, empresas y embudo."], en: ["Sell", "CRM: opportunities, signable quotes, people, companies and funnel."], },
  { k: "medir", es: ["Medir", "Alcance, embudos, growth loops y reportes de cada una de tus marcas."], en: ["Measure", "Reach, funnels, growth loops and reports for every brand."], },
];

export const FAQ = [
  { es: ["¿Qué es Musa?", "Musa es la plataforma de contenido de Futuraria: reúne diseño, video, calendario y publicación en redes, bandeja de mensajes, pauta, CRM y portal de clientes para todas tus marcas, con tu equipo y tus agentes de IA operando dentro de la misma plataforma vía MCP."],
    en: ["What is Musa?", "Musa is Futuraria's content platform: design, video, social calendar and publishing, inbox, ads, CRM and a client portal for all your brands, with your team and your AI agents operating inside the same platform via MCP."], },
  { es: ["¿Qué significa que Musa sea MCP-first?", "Musa expone más de 280 capacidades de su editor como herramientas MCP (Model Context Protocol). Cualquier cliente MCP —Claude, Codex, Hermes, OpenClaw, Kimi u otro— puede operar la plataforma: crear diseños, publicar, responder mensajes o consultar el CRM con las mismas acciones que usa una persona en la web."],
    en: ["What does MCP-first mean?", "Musa exposes 280+ editor capabilities as MCP (Model Context Protocol) tools. Any MCP client —Claude, Codex, Hermes, OpenClaw, Kimi or another— can operate the platform: create designs, publish, answer messages or query the CRM with the same actions a person uses on the web."], },
  { es: ["¿Cómo conecto mi agente de IA a Musa?", "Apunta tu cliente MCP a https://musaworks.com/mcp (POST, transporte Streamable HTTP) con tu llave en el header x-api-key. La guía completa paso a paso está en /guides/connect-agent-mcp/ y el documento de descubrimiento en /.well-known/mcp.json."],
    en: ["How do I connect my AI agent to Musa?", "Point your MCP client at https://musaworks.com/mcp (POST, Streamable HTTP transport) with your key in the x-api-key header. The full step-by-step guide is at /guides/connect-agent-mcp/ and the discovery document at /.well-known/mcp.json."], },
  { es: ["¿Puedo usar Musa sin ser técnico?", "Sí. La web de Musa está hecha para personas: editores visuales, calendario, bandeja y CRM. La capa de agentes es opcional: sirve para quien quiera delegar el trabajo en IA, no es requisito para usar la plataforma."],
    en: ["Can I use Musa without being technical?", "Yes. Musa's web is made for people: visual editors, calendar, inbox and CRM. The agent layer is optional: it exists for those who want to delegate work to AI, it is not required to use the platform."], },
  { es: ["¿Qué es BYOK?", "BYOK (Bring Your Own Keys) significa usar tus propias llaves de IA para generar imágenes, video o voz: Gemini, Runway, ElevenLabs y otras. También existe el modo Musa IA, que incluye créditos de uso mensuales en todos los planes."],
    en: ["What is BYOK?", "BYOK (Bring Your Own Keys) means using your own AI keys for image, video or voice generation: Gemini, Runway, ElevenLabs and others. There is also the Musa AI mode, which includes monthly usage credits on every plan."], },
  { es: ["¿Cuánto cuesta Musa?", "Tres planes: Creator (1 persona, 5 marcas) US$79/mes con tus llaves (BYOK) o US$119/mes con Musa IA incluida (600 créditos). Agency (5 personas, 25 marcas, portal de clientes) US$349/mes BYOK o US$499/mes con IA (3.000 créditos). Enterprise (15 personas, marcas ilimitadas) US$1.490/mes con IA (10.000 créditos). Oferta de lanzamiento: Creator US$19/US$29 y Agency US$149/US$199 los primeros 3 meses. Facturación anual con 2 meses gratis."],
    en: ["How much does Musa cost?", "Three plans: Creator (1 person, 5 brands) US$79/month with your own keys (BYOK) or US$119/month with Musa AI included (600 credits). Agency (5 people, 25 brands, client portal) US$349/month BYOK or US$499/month with AI (3,000 credits). Enterprise (15 people, unlimited brands) US$1,490/month with AI (10,000 credits). Launch offer: Creator US$19/US$29 and Agency US$149/US$199 for the first 3 months. Yearly billing comes with 2 months free."], },
  { es: ["¿Hay plan gratis?", "Sí, puedes empezar gratis desde la web: creas tu cuenta, tu espacio personal y tus marcas sin pagar. Los planes de pago agregan personas, marcas, portal de clientes y créditos de IA."],
    en: ["Is there a free plan?", "Yes, you can start free from the web: create your account, your personal workspace and your brands at no cost. Paid plans add people, brands, a client portal and AI credits."], },
  { es: ["¿En qué se diferencia Musa de Canva o Figma?", "Canva y Figma son herramientas de diseño. Musa cubre el ciclo completo del contenido: investigar y planear, diseñar, producir video, publicar, conversar con la audiencia, pautar, vender y medir, para varias marcas y con agentes de IA vía MCP. Tenemos comparativas detalladas en /compare/ (inglés) y /comparar/ (español)."],
    en: ["How is Musa different from Canva or Figma?", "Canva and Figma are design tools. Musa covers the full content cycle: research and planning, design, video production, publishing, audience conversations, ads, sales and measurement, across brands, with AI agents via MCP. Detailed comparisons live at /compare/."], },
  { es: ["¿Musa publica en redes sociales?", "Sí: calendario de contenidos por marca, publicación y programación en redes, y una bandeja unificada de mensajes y comentarios con respuestas asistidas por IA y asignación entre el equipo."],
    en: ["Does Musa publish to social media?", "Yes: per-brand content calendar, publishing and scheduling, and a unified inbox for messages and comments with AI-assisted replies and team assignment."], },
  { es: ["¿Sirve para agencias?", "Sí. Musa nació multi-marca: espacios de agencia con equipo, portal de clientes (intranet donde el cliente aprueba piezas y ve avances), aprobaciones, áreas por empresa y cotizaciones con firma."],
    en: ["Does Musa work for agencies?", "Yes. Musa was born multi-brand: agency workspaces with team, a client portal (intranet where clients approve pieces and track progress), approvals, per-company areas and signable quotes."], },
  { es: ["¿Funciona en español?", "Sí: la interfaz y la web están en español y en inglés, con soporte en español. Los agentes también pueden operar Musa en español vía MCP."],
    en: ["Does Musa work in Spanish?", "Yes: the interface and website ship in Spanish and English, with Spanish support. Agents can also operate Musa in Spanish via MCP."], },
  { es: ["¿Quién hace Musa?", "Futuraria, un estudio de IA de Lima, Perú (futuraria.com). Musa es su producto principal: la plataforma de contenido para marcas, agencias y equipos con IA."],
    en: ["Who makes Musa?", "Futuraria, an AI studio from Lima, Peru (futuraria.com). Musa is its main product: the content platform for brands, agencies and AI teams."], },
  { es: ["¿Puedo exportar mis diseños?", "Sí: el editor exporta PNG, JPG, PDF y video; los decks se presentan en pantalla completa y las piezas se descargan en los formatos estándar para redes e impresión."],
    en: ["Can I export my designs?", "Yes: the editor exports PNG, JPG, PDF and video; decks present fullscreen and pieces download in the standard formats for social and print."], },
  { es: ["¿Qué es el portal de clientes?", "Es la intranet para agencias en planes Agency o superiores: cada cliente ve sus piezas aprobadas y en progreso desde su propio acceso, sin entrar al espacio interno del equipo."],
    en: ["What is the client portal?", "It is the agency intranet on Agency plans and above: each client sees their approved and in-progress pieces from their own access, without entering the team's internal workspace."], },
  { es: ["¿Qué son los checkpoints C1-C5?", "El flujo de calidad de Musa para entregables producidos por agentes: cada pieza pasa por criterios de aceptación explícitos antes de darse por terminada. Es el mismo estándar que usa el trabajo interno de Futuraria."],
    en: ["What are the C1-C5 checkpoints?", "Musa's quality flow for agent-produced deliverables: every piece passes explicit acceptance criteria before it counts as done. The same standard Futuraria's internal work passes."], },
  { es: ["¿Cómo empiezo?", "Entra a musaworks.com, crea tu cuenta gratis y arma tu primera marca. Si eres agente de IA o quieres conectar uno, empieza por /agents/ y la guía de conexión MCP."],
    en: ["How do I get started?", "Go to musaworks.com, create your free account and set up your first brand. If you are an AI agent or want to connect one, start at /agents/ and the MCP connection guide."], },
];

// Guía: conectar un agente de IA a Musa vía MCP (HowTo)
export const GUIDE_STEPS = [
  { es: ["Consigue tu cuenta y llave de API", "Crea tu cuenta en musaworks.com y genera una llave en Configuración › Llaves de API (formato fdr_ws_). Si eres un agente de la cohorte fundadora, tu cuenta y llave llegan provisionadas por Musa."],
    en: ["Get your account and API key", "Create your account at musaworks.com and generate a key under Settings › API keys (fdr_ws_ format). Founding-cohort agents receive a provisioned account and key from Musa."], },
  { es: ["Apunta tu cliente MCP al endpoint", "El transporte es Streamable HTTP: POST https://musaworks.com/mcp. No hay descargas ni servidores intermedios; el endpoint es el mismo para todos los clientes MCP."],
    en: ["Point your MCP client at the endpoint", "Transport is Streamable HTTP: POST https://musaworks.com/mcp. No downloads, no middle servers; the endpoint is the same for every MCP client."], },
  { es: ["Configura la autenticación", "Manda tu llave en el header x-api-key en cada llamada. verify_api_key no requiere autenticación y sirve para diagnosticar una llave antes de crear otra."],
    en: ["Configure authentication", "Send your key in the x-api-key header on every call. verify_api_key needs no auth and diagnoses a key before you create a new one."], },
  { es: ["Descubre las herramientas", "Ejecuta initialize y tools/list. Para no cargar el catálogo completo (280+ herramientas), conecta con /mcp?skills=diseño,marcas y verás solo las herramientas de esas skills más las base."],
    en: ["Discover the tools", "Run initialize and tools/list. To avoid loading the full catalog (280+ tools), connect with /mcp?skills=diseno,marcas and you will see only those skills' tools plus the base ones."], },
  { es: ["Identifica tu contexto", "whoami devuelve la sesión (persona, modo, espacios) y list_workspaces los espacios accesibles. Casi todas las herramientas piden el workspaceId."],
    en: ["Identify your context", "whoami returns the session (person, mode, workspaces) and list_workspaces lists accessible workspaces. Most tools require the workspaceId."], },
  { es: ["Carga la skill del módulo", "get_skill({ name }) trae la guía de cada módulo (musa-diseno, musa-redes, musa-vender…) con las herramientas exactas y cómo combinarlas. list_skills devuelve el índice ligero."],
    en: ["Load the module skill", "get_skill({ name }) fetches each module's guide (musa-diseno, musa-redes, musa-vender…) with the exact tools and how to combine them. list_skills returns the light index."], },
  { es: ["Ejecuta tu primera tarea de diseño", "resolve_brand({ workspaceId, brand }) primero si nombras una marca; luego crea la pieza con las herramientas de musa-diseno. Pregunta siempre en qué espacio va antes de crear."],
    en: ["Run your first design task", "resolve_brand({ workspaceId, brand }) first if a brand is named; then create the piece with musa-diseno tools. Always ask which workspace before creating."], },
  { es: ["Verifica el resultado real", "Renderiza o exporta el artefacto con las herramientas del MCP antes de reportar la tarea como terminada. Los entregables pasan por los checkpoints C1-C5 con criterios de aceptación explícitos."],
    en: ["Verify the real result", "Render or export the artifact with the MCP tools before reporting the task done. Deliverables pass the C1-C5 checkpoints with explicit acceptance criteria."], },
];

export const LINKS = [
  { href: "/compare/", es: "Comparativas (inglés)", en: "Comparisons (English)" },
  { href: "/comparar/", es: "Comparativas (español)", en: "Comparisons (Spanish)" },
  { href: "/agents/", es: "Para agentes de IA", en: "For AI agents" },
  { href: "/faq/", es: "Preguntas frecuentes (inglés)", en: "FAQ (English)" },
  { href: "/preguntas/", es: "Preguntas frecuentes (español)", en: "FAQ (Spanish)" },
  { href: "/guides/connect-agent-mcp/", es: "Guía: conectar un agente vía MCP", en: "Guide: connect an agent via MCP" },
  { href: "/llms.txt", es: "llms.txt (para modelos)", en: "llms.txt (for models)" },
  { href: "/.well-known/mcp.json", es: "Descubrimiento MCP", en: "MCP discovery" },
];
