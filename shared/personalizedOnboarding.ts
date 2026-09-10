export type OnboardingGoalId =
  | "batch-designs" | "figma-import" | "design-system" | "brand-tokens" | "raster-editable"
  | "adapt-formats" | "motion-reels" | "product-images" | "content-grid" | "schedule-content"
  | "ppt-report" | "brand-copy" | "certificates" | "crm-ai-pitches" | "sales-pitches"
  | "ai-kanban" | "multi-ai" | "second-brain" | "team-workspace" | "client-comments"
  | "brand-patterns" | "process-patterns" | "code-export" | "sales-funnel" | "churn-risk";

export type OnboardingGoal = {
  id: OnboardingGoalId;
  title: string;
  group: "Diseño" | "Contenido" | "Ventas" | "Colaboración";
  route: string;
  target?: string;
  guide: string;
};

/** Code-versioned catalog. Progress is per person; adding an item never changes old selections. */
export const ONBOARDING_GOALS: readonly OnboardingGoal[] = [
  ["batch-designs", "Hacer diseños en batch usando tus propias plantillas", "Diseño", "agentes", "[data-tour='templates-grid']", "Abre Kanban, crea una tarea y usa tus templates como base."],
  ["figma-import", "Migrar diseños desde Figma hacia Musa", "Diseño", "diseno", "[data-tour='templates-grid']", "En Archivos elige Importar y pega un enlace de Figma."],
  ["design-system", "Crear design systems para tu logo o en base a un póster", "Diseño", "diseno/ds", "[data-tour='design-system-panel']", "Abre Design systems y crea o selecciona una marca."],
  ["brand-tokens", "Generar tus códigos de color corporativo y tipografías", "Diseño", "diseno/ds", "[data-tour='design-system-panel']", "Desde el design system define colores y tipografías de la marca."],
  ["raster-editable", "Convertir piezas de JPG/PNG a editable", "Diseño", "diseno", "[data-tour='templates-grid']", "Importa el archivo desde Archivos y elige convertirlo a capas editables."],
  ["adapt-formats", "Adaptar diseños a posts, banners y stories", "Diseño", "diseno", "[data-tour='templates-grid']", "Abre un diseño y usa sus formatos para crear las adaptaciones."],
  ["motion-reels", "Generar animaciones motion graphics y reels usando tus diseños", "Diseño", "diseno", "[data-tour='templates-grid']", "Abre un diseño, anima sus capas y expórtalo como video."],
  ["product-images", "Generar fotos de producto para redes y ecommerce usando fotos reales", "Diseño", "diseno", "[data-tour='templates-grid']", "Abre el editor, añade tu foto y usa la herramienta de imagen IA."],
  ["content-grid", "Armar una grilla de contenidos y que Musa la diseñe", "Contenido", "copywriting", "[data-tour='templates-grid']", "En Copywriting crea tu calendario y convierte ideas en piezas."],
  ["schedule-content", "Programar todo tu mes de contenidos", "Contenido", "copywriting/calendar", "[data-tour='templates-grid']", "Desde el calendario conecta tu canal y programa las publicaciones."],
  ["ppt-report", "Crear reportes PPT compatibles con Google Slides", "Contenido", "copywriting/reports", "[data-tour='templates-grid']", "Desde Reportes elige exportar un PPT con copys, imágenes y editables."],
  ["brand-copy", "Redactar textos con el tono de comunicación de tu marca", "Contenido", "copywriting/copies", "[data-tour='templates-grid']", "Configura la marca y crea copys desde Copywriting."],
  ["certificates", "Generar 50 certificados con nombres distintos desde un Excel", "Contenido", "diseno", "[data-tour='templates-grid']", "Prepara un template y aplica la hoja de cálculo para generar variantes."],
  ["crm-ai-pitches", "Llevar tracking de ventas para que tus IAs automaticen pitches y propuestas", "Ventas", "contactos/pipeline", "[data-tour='graph-view']", "Registra marcas y oportunidades en el pipeline antes de pedir apoyo a tu IA."],
  ["sales-pitches", "Automatizar la generación de propuestas comerciales y pitches de ventas", "Ventas", "contactos/pipeline", "[data-tour='graph-view']", "Crea una oportunidad y usa sus datos como contexto para tu propuesta."],
  ["ai-kanban", "Delegar producción a IAs a través del Kanban", "Ventas", "agentes/kanban", "[data-tour='templates-grid']", "Crea una tarea en Kanban y configura el cronjob en tu propia IA."],
  ["multi-ai", "Conectar múltiples IAs para que diseñen a la vez múltiples marcas", "Ventas", "configuracion/ais", "[data-tour='templates-grid']", "En Configuración crea una clave y copia la guía para cada IA."],
  ["second-brain", "Generar un Second Brain compatible entre humanos e IAs", "Ventas", "contactos", "[data-tour='graph-view']", "Relaciona marcas, notas y diseños para formar el mapa de conocimiento."],
  ["team-workspace", "Colaborar con otros miembros de tu equipo en un espacio compartido", "Colaboración", "configuracion/humans", "[data-tour='templates-grid']", "Invita a tu equipo desde Configuración y asigna su rol."],
  ["client-comments", "Compartir editables a clientes vía enlace para recibir comentarios", "Colaboración", "diseno", "[data-tour='templates-grid']", "Abre un diseño, comparte el enlace y revisa los comentarios anclados."],
  ["brand-patterns", "Detectar patrones de servicios entre marcas y aplicarlos a otra", "Colaboración", "diseno/ds", "[data-tour='design-system-panel']", "Organiza los assets por marca para reutilizar patrones entre ellas."],
  ["process-patterns", "Detectar patrones automatizables en tus procesos", "Colaboración", "agentes/kanban", "[data-tour='templates-grid']", "Registra tareas recurrentes en Kanban para encontrar qué automatizar."],
  ["code-export", "Exportar diseños a código para tu web u otros assets", "Colaboración", "diseno", "[data-tour='templates-grid']", "Abre un diseño y usa el panel de código para revisar y exportar HTML/CSS."],
  ["sales-funnel", "Medir embudos de venta para tu marca o agencia", "Ventas", "contactos/embudo", "[data-tour='graph-view']", "Abre Embudo para revisar las etapas y conversiones de tus oportunidades."],
  ["churn-risk", "Detectar clientes en fuga o peligro de fuga", "Ventas", "contactos/accounts", "[data-tour='graph-view']", "En Marcas revisa el estado de cuenta y prioriza las que estén en riesgo."],
].map(([id, title, group, route, target, guide]) => ({ id: id as OnboardingGoalId, title, group: group as OnboardingGoal["group"], route: `/#workspace/${route}`, target, guide }));

export function isOnboardingGoalId(value: unknown): value is OnboardingGoalId {
  return typeof value === "string" && ONBOARDING_GOALS.some(goal => goal.id === value);
}

export function getOnboardingGoal(id: string) {
  return ONBOARDING_GOALS.find(goal => goal.id === id);
}
