// ============================================================
// ndaContent.ts — Acuerdo de Acceso Alfa (NDA): texto y planes.
//
// Solo contenido: el consentimiento se registra vía
// POST /api/account/nda-acceptance (nunca con escrituras directas
// desde el cliente). Si editas las cláusulas, actualiza también la
// landing pública del acuerdo para mantener consistencia.
// ============================================================

export type NdaSection = {
  title: string;
  body?: string;
  bullets?: string[];
};

/** Agreement version. Must match NDA_VERSION in api/src/routes/saas.ts. */
export const NDA_VERSION = "1.0";

export type PlanId = "friends_family" | "corporate";

export const planOptions: { value: PlanId; label: string; detail: string }[] = [
  { value: "friends_family", label: "Friends & Family", detail: "Acceso alfa anticipado · 1 IA propia" },
  { value: "corporate", label: "Corporativo", detail: "Por invitación · todo el equipo y sus IAs" },
];

export const planBullets: Record<PlanId, string[]> = {
  friends_family: [
    "Ingreso vía el formulario \"Design Tool Futuraria — ¿Qué quieres crear?\", compartido en Instagram, Facebook y WhatsApp.",
    "Acceso para el usuario y las marcas con las que trabaje.",
    "Permite conectar una (1) IA propia.",
    "Intransferible: no puede cederse ni compartirse con terceros.",
  ],
  corporate: [
    "Entregado exclusivamente por invitación, vía correo y videollamada.",
    "Permite conectar a todo el equipo y las IAs respectivas de cada integrante.",
    "Despliegue completo en la organización.",
  ],
};

export const ndaSections: NdaSection[] = [
  {
    title: "1. Información Confidencial",
    body: "Se considera confidencial todo lo revelado en relación con la Herramienta, en cualquier formato: interfaz, funcionalidades, flujos de trabajo, prompts, arquitectura, código, datos, plantillas, roadmap, precios, modelo de negocio, integraciones y cualquier material de las sesiones.",
  },
  {
    title: "2. Obligaciones",
    body: "Quien acepta se compromete a usar la información únicamente para evaluar la Herramienta; a no divulgarla, copiarla ni compartirla con terceros; y a protegerla con la misma diligencia que su propia información confidencial.",
  },
  {
    title: "3. Prohibiciones expresas",
    bullets: [
      "Grabar, transcribir (con IA o sin ella), capturar pantalla o reenviar las sesiones o cualquier material, sin autorización escrita.",
      "Usar bots, notetakers o asistentes de IA en las videollamadas o reuniones.",
      "Scrapear, extraer, minar o automatizar la recolección de datos o contenido de la Herramienta.",
      "Ingeniería inversa o derivar el código, la lógica o los procesos internos.",
      "Desarrollar, comercializar o financiar un producto o servicio sustancialmente similar a la Herramienta (clonación).",
    ],
  },
  {
    title: "4. Propiedad intelectual",
    body: "Toda la propiedad intelectual de la Herramienta es y seguirá siendo de Futuraria. La aceptación no otorga licencia ni derecho de uso comercial.",
  },
  {
    title: "5. No competencia y duración",
    body: "La prohibición de crear un producto competidor o sustancialmente similar, y las obligaciones de confidencialidad, rigen por siete (7) años. Los secretos comerciales se protegen de forma indefinida.",
  },
  {
    title: "6. Consecuencias del incumplimiento",
    body: "El incumplimiento implica la revocación inmediata y permanente del acceso, y el derecho de Futuraria a reclamar daños y perjuicios y medidas cautelares.",
  },
  {
    title: "7. Protección de tus datos (reciprocidad)",
    body: "Futuraria se compromete a no recopilar, almacenar ni usar tus diseños, datos ni nada de lo que crees dentro de la Herramienta. Tu contenido es y seguirá siendo de tu exclusiva propiedad, y no se comparte con terceros.",
  },
  {
    title: "8. Sesiones de coordinación",
    body: "Las llamadas de los viernes (WhatsApp o videollamada) sirven para que compartas tu experiencia y posibles mejoras. Por privacidad y reciprocidad, ninguna de las partes las grabará ni transcribirá: Futuraria se compromete a no grabarlas ni transcribirlas, y el Receptor se compromete igualmente a no hacerlo.",
  },
  {
    title: "9. Testimonios",
    body: "El acceso a la Herramienta se otorga a cambio de que el Receptor autorice a Futuraria a publicar su testimonio. Futuraria únicamente solicitará y publicará el testimonio — el nombre, la empresa y las declaraciones del Receptor sobre su experiencia con la Herramienta —, de forma pública y con fines exclusivos de testimonio. Futuraria no publicará ni mostrará los diseños, datos ni trabajo realizado dentro de la Herramienta. El Receptor podrá revocar esta autorización en cualquier momento mediante comunicación escrita.",
  },
];
