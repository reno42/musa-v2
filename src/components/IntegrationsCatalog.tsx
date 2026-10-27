/**
 * Catálogo de «Mis integraciones» (Configuración).
 *
 * v61: de rectángulos de formulario a tarjetas de marca estilo tienda — logo,
 * oneliner del superpoder que le da a la IA del usuario y una vista detalle
 * que entra desde la derecha (mismo gesto que el detalle en otras vistas,
 * sin popups). El detalle trae la lista completa de lo que se desbloquea y
 * el flujo de vinculación: botón «Vincular a mi cuenta» → pegar API key.
 * Estas integraciones son BYOK de API (no sincronización de apps): la clave
 * viaja cifrada al servidor y jamás vuelve al navegador.
 *
 * El estado y las llamadas siguen viviendo en Dashboard (container); este
 * componente es la capa visual que los consume vía props.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getProvider, NANO_BANANA_MODELS } from "../lib/aiProviders";
import type { KeyStatusMap } from "../lib/userKeys";

type SocialProvider = "buffer" | "zernio";
type SocialAccount = { id: string; platform: string; username: string; displayName: string; isActive: boolean };
type SocialConnection = { id: string; provider: SocialProvider; hasCredentials: boolean; accounts: Record<string, string>; isDefault: boolean; webhookUrl?: string | null };

type IntegrationCategory = "Chat IA" | "Editor" | "Contenidos" | "Importar";

type IntegrationDef = {
  id: string;
  name: string;
  /** Ruta pública del logo (public/logos). Sin logo → tile con inicial. */
  logo?: string;
  fallback?: { letter: string; from: string; to: string };
  category: IntegrationCategory;
  /** Oneliner del superpoder que gana la IA del usuario al vincularla. */
  tagline: string;
  description: string;
  bullets: string[];
  getKeyUrl?: string;
  getKeyLabel?: string;
  kind: "provider" | "figma" | "social";
  /** kind=provider: id en el registro de aiProviders / userKeys. */
  providerId?: string;
  /** kind=social: proveedor de publicación. */
  social?: SocialProvider;
  /** Selector extra de modelo Nano Banana (solo Google). */
  nbSelect?: boolean;
};

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "google", name: "Google Gemini", logo: "/logos/gemini.png", category: "Chat IA",
    tagline: "Ojos y manos para tu IA: ve cualquier imagen, la vuelve diseño editable y genera nuevas.",
    description: "Una sola key de Gemini alimenta tres superpoderes: el editor que mira, el editor que crea y el chat que entiende lo que le enseñas.",
    bullets: [
      "Convertir imagen a diseño: sube una captura o foto y Musa la vuelve un frame 100% editable.",
      "Generar y editar imágenes con Nano Banana sin salir del editor.",
      "Chat con visión: tu IA ve las imágenes que le mandas y responde sobre ellas.",
      "Elegir qué modelo de visión y cuál de imagen usa cada flujo.",
    ],
    getKeyUrl: "https://aistudio.google.com/apikey", getKeyLabel: "Obtener key gratis",
    kind: "provider", providerId: "google", nbSelect: true,
  },
  {
    id: "openai", name: "OpenAI", logo: "/logos/chatgpt.png", category: "Chat IA",
    tagline: "GPT-6 dentro de Musa: tu chat aprende a idear, redactar y operar la plataforma.",
    description: "Conecta tu key de OpenAI y los agentes del chat piensan, escriben y ejecutan herramientas con la familia GPT-6.",
    bullets: [
      "Chat con GPT-6: sol (equilibrio), luna (volumen barato) o astra (máxima capacidad).",
      "Asignar GPT a un rol del equipo de IA: líder, hacedor o revisor.",
      "Cambiar de modelo cuando quieras sin tocar la key.",
    ],
    getKeyUrl: "https://platform.openai.com/api-keys", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "openai",
  },
  {
    id: "anthropic", name: "Anthropic", logo: "/logos/claude.png", category: "Chat IA",
    tagline: "Claude en tu chat: razonamiento largo, código fino y redacción impecable.",
    description: "La key de Anthropic trae la familia Claude a los agentes de Musa, del Haiku más veloz al Opus más agéntico.",
    bullets: [
      "Claude Sonnet 5: el equilibrio entre velocidad e inteligencia.",
      "Claude Opus 5.5: trabajo agéntico de largo aliento.",
      "Claude Haiku 4.5: el más rápido para volumen.",
      "Asignar Claude al rol del agente que prefieras.",
    ],
    getKeyUrl: "https://console.anthropic.com/settings/keys", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "anthropic",
  },
  {
    id: "deepseek", name: "DeepSeek", logo: "/logos/deepseek.png", category: "Chat IA",
    tagline: "El cerebro económico: chat capaz y tareas en volumen sin mirar el costo.",
    description: "DeepSeek es el caballo de batalla barato del chat: perfecto para lotes, borradores y agentes que trabajan solos.",
    bullets: [
      "deepseek-chat: conversación capaz a costo mínimo.",
      "deepseek-reasoner: el modo que piensa antes de responder.",
      "Ideal para la automatización por lotes de Contenidos.",
    ],
    getKeyUrl: "https://platform.deepseek.com/api_keys", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "deepseek",
  },
  {
    id: "kimi", name: "Kimi", logo: "/logos/kimi.png", category: "Chat IA",
    tagline: "Un millón de tokens de contexto: tu IA se lee el proyecto completo de una sentada.",
    description: "Kimi K3 (plataforma internacional) acepta texto, imagen y video, y sostiene conversaciones del tamaño de una biblia.",
    bullets: [
      "Kimi K3: flagship con contexto de 1M de tokens.",
      "Visión: entiende imágenes y video que le mandes al chat.",
      "K2.7 Code para tareas de programación y estructura.",
    ],
    getKeyUrl: "https://platform.kimi.ai", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "kimi",
  },
  {
    id: "moonshot", name: "Moonshot", fallback: { letter: "M", from: "#3b3b6d", to: "#20204a" }, category: "Chat IA",
    tagline: "Kimi vía China: el mismo cerebro con una key de otra región.",
    description: "Misma familia Kimi (K3, K2.6, K2.7) servida por la plataforma de China — para cuando tu key vive en Moonshot CN.",
    bullets: [
      "Los mismos modelos Kimi con endpoint y facturación de China.",
      "Visión incluida: texto, imagen y video como entrada.",
      "Convive con Kimi internacional: usa la key de la región que te facture mejor.",
    ],
    getKeyUrl: "https://platform.moonshot.cn", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "moonshot",
  },
  {
    id: "qwen", name: "Qwen", fallback: { letter: "Q", from: "#615ced", to: "#3d3bb0" }, category: "Chat IA",
    tagline: "La familia Qwen de Alibaba: chat multilingüe con modelos plus y flash.",
    description: "Qwen (Alibaba Model Studio, endpoint internacional) suma cerebros multilingües al chat, del plus de gama al flash de volumen.",
    bullets: [
      "qwen3.5-plus: el flagship alojado para trabajo fino.",
      "qwen3.5-flash: volumen rápido y barato.",
      "Alias estables (qwen-plus, qwen-flash) para automatizaciones.",
    ],
    getKeyUrl: "https://modelstudio.console.alibabacloud.com", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "qwen",
  },
  {
    id: "zhipu", name: "Zhipu (Z.ai)", fallback: { letter: "Z", from: "#3859ff", to: "#2340c4" }, category: "Chat IA",
    tagline: "GLM de Z.ai: tu plan GLM Coding también rinde dentro de Musa.",
    description: "La serie GLM-5 de Z.ai en el chat de Musa — y si tienes el GLM Coding Plan, funciona tal cual con esta integración.",
    bullets: [
      "GLM-5.3 flash y flashx: velocidad con cabeza.",
      "Toda la gama 5.x y 4.x para elegir costo vs. talento.",
      "Tu suscripción GLM Coding Plan aplica tal cual.",
    ],
    getKeyUrl: "https://z.ai", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "zhipu",
  },
  {
    id: "openrouter", name: "OpenRouter", logo: "/logos/openrouter.png", category: "Chat IA",
    tagline: "Una sola key, todos los modelos: cambia de cerebro sin abrir otra cuenta.",
    description: "OpenRouter es el metabuscador de LLMs: una key tuya y el chat puede hablar con Claude, GPT, Gemini, Kimi o DeepSeek.",
    bullets: [
      "Claude, GPT, Gemini, Kimi y DeepSeek desde una única key.",
      "Cambias de modelo en segundos sin crear cuentas nuevas.",
      "Perfecto para probar qué cerebro le queda mejor a cada marca.",
    ],
    getKeyUrl: "https://openrouter.ai/keys", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "openrouter",
  },
  {
    id: "quiver", name: "Quiver AI", logo: "/logos/quiver.png", category: "Editor",
    tagline: "Vectoriza: cualquier imagen se vuelve SVG editable, lista para escalar infinito.",
    description: "Quiver convierte mapas de bits en vectores: tu logo rasterizado o tu boceto pasan a SVG con nodos que puedes retocar.",
    bullets: [
      "Imagen a SVG: sube un logo o boceto y obtén el vector editable.",
      "SVG desde texto: descríbelo y nace un vector (pestaña IA del panel de iconos).",
      "Elige entre arrow-1.1 y arrow-1.1-max según el detalle.",
    ],
    getKeyUrl: "https://quiver.ai", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "quiver",
  },
  {
    id: "runway", name: "RunwayML", logo: "/logos/runway.png", category: "Contenidos",
    tagline: "Ponle movimiento: tus diseños se vuelven video dentro del editor.",
    description: "La key de Runway activa el panel de Video del editor: una imagen quieta entra, un clip animado sale.",
    bullets: [
      "Imagen a video con Gen-4 Turbo y Gen-4.5.",
      "Animar tus posts y banners sin abrir otra herramienta.",
      "Elige el modelo según cueste o rinda el clip.",
    ],
    getKeyUrl: "https://runwayml.com", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "runway",
  },
  {
    id: "wavespeed", name: "WaveSpeedAI", logo: "/logos/wavespeed.png", category: "Editor",
    tagline: "Desarma cualquier imagen en capas editables en segundos.",
    description: "WaveSpeed separa una imagen en piezas (sujeto, fondo, texto) para que puedas editar cada capa por separado en el editor.",
    bullets: [
      "Separación de capas con Seedream 5.0 Pro (botón de capas del editor).",
      "Edita el fondo sin tocar el sujeto, y viceversa.",
      "Base perfecta para animaciones y variantes de campaña.",
    ],
    kind: "provider", providerId: "wavespeed",
  },
  {
    id: "unsplash", name: "Unsplash", logo: "/logos/unsplash.png", category: "Contenidos",
    tagline: "Millones de fotos de stock buscándose desde el panel de iconos.",
    description: "Con tu key de Unsplash, la pestaña Fotos del editor busca en todo el catálogo y suelta la imagen directa en tu diseño.",
    bullets: [
      "Búsqueda de fotos de stock en la pestaña Fotos del panel de iconos.",
      "La key viaja cifrada y te sigue a cualquier dispositivo.",
      "Free tier generoso: suficiente para publicar todos los días.",
    ],
    getKeyUrl: "https://unsplash.com/developers", getKeyLabel: "Obtener key gratis",
    kind: "provider", providerId: "unsplash",
  },
  {
    id: "heygen", name: "HeyGen", fallback: { letter: "H", from: "#5b6cff", to: "#2f3aa8" }, category: "Contenidos",
    tagline: "Tu clon hablando: guiones listos que se vuelven video sin grabarte otra vez.",
    description: "La key de HeyGen alimenta la pestaña AI Clones de Video: entrenás un clon desde una toma del estudio y generás videos locutando guiones escritos por tu IA.",
    bullets: [
      "Entrenar un clon (digital twin) desde una toma grabada en Musa.",
      "Tema → 3 guiones de tu IA → elegir → un click genera el video.",
      "Los créditos y el render corren por tu cuenta de HeyGen (API v3).",
    ],
    getKeyUrl: "https://platform.heygen.com/api-keys", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "heygen",
  },
  {
    id: "elevenlabs", name: "ElevenLabs", fallback: { letter: "E", from: "#1c1c1e", to: "#4b4b52" }, category: "Contenidos",
    tagline: "Voces IA y subtítulos automáticos: tu guion hablado y tus videos transcritos palabra por palabra.",
    description: "La key de ElevenLabs alimenta la pestaña Voz IA del editor de video y el estudio de tomas: convierte guiones en locuciones listas para el timeline y transcribe lo que se dice en tus videos para subtítulos y limpieza de muletillas.",
    bullets: [
      "Guion → locución MP3 con voces multilingües (es-ES incluido).",
      "Subtítulos automáticos con timestamps por palabra (Scribe).",
      "Base de la limpieza de muletillas tipo Descript.",
      "Los créditos corren por tu cuenta de ElevenLabs.",
    ],
    getKeyUrl: "https://elevenlabs.io/app/settings/api-keys", getKeyLabel: "Obtener key",
    kind: "provider", providerId: "elevenlabs",
  },
  {
    id: "figma", name: "Figma", fallback: { letter: "F", from: "#a25aff", to: "#6c2bd9" }, category: "Importar",
    tagline: "Pega un enlace de Figma y ten el diseño editable en Musa.",
    description: "Vincula el token personal del workspace una sola vez: después, importar es pegar el enlace de un archivo o frame.",
    bullets: [
      "Importa archivos y frames de Figma desde su enlace en Importar diseño.",
      "Token con permisos mínimos: current_user:read y file_content:read.",
      "Tu cuenta queda verificada y visible en la integración.",
    ],
    kind: "figma",
  },
  {
    id: "zernio", name: "Zernio", fallback: { letter: "Z", from: "#7c5cff", to: "#4f46e5" }, category: "Contenidos",
    tagline: "Publica Posts, Stories y Reels en tus redes sin salir de Musa.",
    description: "Zernio es el brazo publicador: conecta tu cuenta y Copywriting puede enviar piezas directas a tus redes.",
    bullets: [
      "Posts, Stories y Reels según la red y el medio adjunto.",
      "Calendario y Contenidos publican con tu cuenta predeterminada.",
      "Eliges qué cuentas usa Copywriting al publicar.",
      "Webhook de estados para confirmaciones en tiempo real.",
    ],
    kind: "social", social: "zernio",
  },
  {
    id: "buffer", name: "Buffer", fallback: { letter: "B", from: "#2c4bff", to: "#1c33b8" }, category: "Contenidos",
    tagline: "Programa publicaciones en tus redes con tu cuenta de Buffer.",
    description: "Buffer conecta tus redes vía su API: Posts directos desde Musa con la cuenta que elijas como predeterminada.",
    bullets: [
      "Publicación de Posts vía la API de Buffer.",
      "Calendario y Contenidos publican con tu cuenta predeterminada.",
      "Stories y Reels requieren Zernio — este canal es de Posts.",
    ],
    kind: "social", social: "buffer",
  },
];

export type IntegrationsCatalogProps = {
  keyStatuses: KeyStatusMap;
  keySaving: boolean;
  onSaveProviderKey: (providerId: string, value: string) => void;
  onProviderModel: (providerId: string, model: string) => void;
  nbModel: string;
  onNbModelChange: (model: string) => void;
  figmaConnected: boolean;
  figmaAccount: string;
  figmaToken: string;
  onFigmaTokenChange: (value: string) => void;
  figmaBusy: boolean;
  figmaMessage: string;
  onFigmaSave: () => void;
  onFigmaDisconnect: () => void;
  socialProvider: SocialProvider;
  onSocialProviderChange: (provider: SocialProvider) => void;
  socialConnections: SocialConnection[];
  socialApiKey: string;
  onSocialApiKeyChange: (value: string) => void;
  socialWebhookSecret: string;
  onSocialWebhookSecretChange: (value: string) => void;
  socialBusy: boolean;
  socialMessage: string;
  socialAccounts: SocialAccount[];
  socialSelected: Record<string, string>;
  onSocialAccountToggle: (platform: string, accountId: string, checked: boolean) => void;
  onSocialTest: () => void;
  onSocialSave: () => void;
  onSocialDisconnect: () => void;
};

function isConnected(def: IntegrationDef, props: IntegrationsCatalogProps): boolean {
  if (def.kind === "provider") return Boolean(def.providerId && props.keyStatuses[def.providerId]?.configured);
  if (def.kind === "figma") return props.figmaConnected;
  return props.socialConnections.some(item => item.provider === def.social && item.hasCredentials);
}

function LogoTile({ def, size }: { def: IntegrationDef; size: number }) {
  const tile: React.CSSProperties = {
    width: size, height: size, borderRadius: Math.round(size * 0.26), flexShrink: 0,
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
  };
  if (def.logo) {
    return (
      <span style={tile}>
        <img src={def.logo} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)}
          style={{ objectFit: "contain" }} draggable={false} />
      </span>
    );
  }
  return (
    <span style={{
      ...tile,
      background: `linear-gradient(135deg, ${def.fallback?.from ?? "#444"}, ${def.fallback?.to ?? "#222"})`,
      color: "#fff", fontWeight: 700, fontSize: Math.round(size * 0.42), letterSpacing: 0.5,
    }}>
      {def.fallback?.letter ?? def.name.charAt(0)}
    </span>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
      fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: 100,
      color: connected ? "#6ee7b7" : "#fcd34d",
      background: connected ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.1)",
      border: `1px solid ${connected ? "rgba(52,211,153,0.25)" : "rgba(251,191,36,0.25)"}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: connected ? "#34d399" : "#fbbf24" }} />
      {connected ? "Conectado" : "Sin conectar"}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="12" cy="12" r="9.5" strokeOpacity="0.45" />
      <path d="m8.5 12.2 2.4 2.4 4.8-5" />
    </svg>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.14)",
  color: "rgba(255,255,255,0.85)", borderRadius: 8, padding: "8px 14px",
  cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
};
const primaryBtn: React.CSSProperties = {
  background: "#fff", border: "1px solid #fff", color: "#141420",
  borderRadius: 8, padding: "8px 16px", cursor: "pointer",
  fontFamily: "inherit", fontSize: 12, fontWeight: 700,
};
const drawerInput: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, padding: "9px 12px", color: "#fff", fontFamily: "inherit", fontSize: 12.5, outline: "none",
};

export function IntegrationsCatalog(props: IntegrationsCatalogProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = INTEGRATIONS.find(item => item.id === selectedId) ?? null;
  return (
    <>
      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "rgba(255,255,255,0.5)", maxWidth: 720 }}>
        Cada integración le da un superpoder nuevo a tu IA. Ábrela para ver todo lo que desbloquea y
 vincúlala pegando su API key: viaja cifrada al servidor y jamás vuelve a mostrarse.
      </p>
      <div className="intg-grid">
        {INTEGRATIONS.map(def => (
          <IntegrationCard key={def.id} def={def} connected={isConnected(def, props)}
            onOpen={() => {
              if (def.social) props.onSocialProviderChange(def.social);
              setSelectedId(def.id);
            }} />
        ))}
      </div>
      {selected && (
        <IntegrationDrawer key={selected.id} def={selected} props={props} connected={isConnected(selected, props)}
          onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}

function IntegrationCard({ def, connected, onOpen }: {
  def: IntegrationDef; connected: boolean; onOpen: () => void;
}) {
  return (
    <button type="button" className="intg-card" onClick={onOpen}
      aria-haspopup="dialog" title={`Ver detalle de ${def.name}`}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <LogoTile def={def} size={46} />
        <StatusPill connected={connected} />
      </span>
      <span>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>{def.name}</span>
        <span style={{
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.52)", marginTop: 4,
        }}>{def.tagline}</span>
      </span>
      <span className="intg-details-btn">Detalles
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </span>
    </button>
  );
}

function IntegrationDrawer({ def, props, connected, onClose }: {
  def: IntegrationDef; props: IntegrationsCatalogProps; connected: boolean; onClose: () => void;
}) {
  return createPortal(
    <div className="intg-drawer-root">
      <div className="intg-drawer-backdrop" onClick={onClose} />
      <aside className="intg-drawer" role="dialog" aria-modal="true" aria-label={def.name}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 100, padding: "3px 10px",
            }}>{def.category}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle" style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.8)", cursor: "pointer",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
          </button>
        </header>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18 }}>
          <LogoTile def={def} size={58} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{
              margin: 0, fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400,
              fontSize: 27, lineHeight: 1.1, color: "#fff",
            }}>{def.name}</h2>
            <div style={{ marginTop: 7 }}><StatusPill connected={connected} /></div>
          </div>
        </div>
        <p style={{ margin: "18px 0 0", fontSize: 13, lineHeight: 1.65, color: "rgba(255,255,255,0.62)" }}>
          {def.description}
        </p>
        {def.kind === "provider" && <ProviderZone def={def} props={props} connected={connected} />}
        {def.kind === "figma" && <FigmaZone props={props} />}
        {def.kind === "social" && <SocialZone def={def} props={props} connected={connected} />}
        <section style={{ marginTop: 24 }}>
          <h3 style={{
            margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)",
          }}>Con esto tu IA puede</h3>
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 10 }}>
            {def.bullets.map(bullet => (
              <li key={bullet} style={{ display: "flex", gap: 9, fontSize: 12.5, lineHeight: 1.55, color: "rgba(255,255,255,0.78)" }}>
                <CheckIcon />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </section>
        <footer style={{
          marginTop: 26, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11, lineHeight: 1.55, color: "rgba(255,255,255,0.42)",
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>
            Tu clave viaja cifrada (AES-256-GCM) al servidor y nunca vuelve a mostrarse; Musa solo la usa
            para llamar a la API de {def.name}. Estas conexiones son por API key — no sincronizan la app,
            le dan poderes a tu IA.
          </span>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function KeyForm({ def, props, onDone }: {
  def: IntegrationDef; props: IntegrationsCatalogProps; onDone: () => void;
}) {
  const [draft, setDraft] = useState("");
  const provider = def.providerId ? getProvider(def.providerId) : undefined;
  const save = () => {
    if (!draft.trim() || !def.providerId) return;
    props.onSaveProviderKey(def.providerId, draft);
    setDraft("");
    onDone();
  };
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <input type="password" autoFocus autoComplete="off" style={drawerInput} value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onDone(); }}
        placeholder={provider?.keyPrefix ? `Pega tu key (${provider.keyPrefix}…)` : "Pega tu API key"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={{ ...primaryBtn, opacity: draft.trim() && !props.keySaving ? 1 : 0.5 }}
          disabled={!draft.trim() || props.keySaving} onClick={save}>
          {props.keySaving ? "Guardando…" : "Guardar clave"}
        </button>
        <button type="button" style={ghostBtn} onClick={onDone}>Cancelar</button>
        {def.getKeyUrl && (
          <a href={def.getKeyUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11.5, color: "#818cf8", textDecoration: "none" }}>
            {def.getKeyLabel ?? "Obtener key"} ↗
          </a>
        )}
      </div>
    </div>
  );
}

function ProviderZone({ def, props, connected }: {
  def: IntegrationDef; props: IntegrationsCatalogProps; connected: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const provider = def.providerId ? getProvider(def.providerId) : undefined;
  const status = def.providerId ? props.keyStatuses[def.providerId] : undefined;
  return (
    <div style={{ marginTop: 18, padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {connected ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <CheckIcon />
            <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)" }}>
              Cuenta vinculada — la clave está cifrada en el servidor.
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={() => setShowForm(s => !s)}>
              {showForm ? "Cerrar" : "Reemplazar clave"}
            </button>
            <button type="button" style={{ ...ghostBtn, color: "#fca5a5", borderColor: "rgba(248,113,113,0.3)" }}
              onClick={() => { if (def.providerId) props.onSaveProviderKey(def.providerId, ""); }}>
              Desvincular
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" style={primaryBtn} aria-expanded={showForm}
            onClick={() => setShowForm(true)}>
            Vincular a mi cuenta
          </button>
          <span style={{ display: "block", marginTop: 8, fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>
            Tienes que crear una API key en {def.name} y pegarla aquí.
          </span>
        </>
      )}
      {showForm && <KeyForm def={def} props={props} onDone={() => setShowForm(false)} />}
      {provider && provider.models.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo</span>
          <select style={{ ...drawerInput, flex: 1, cursor: "pointer" }} value={status?.model || provider.models[0]}
            onChange={e => props.onProviderModel(def.providerId!, e.target.value)}>
            {provider.models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
      )}
      {def.nbSelect && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo de imagen</span>
          <select style={{ ...drawerInput, flex: 1, cursor: "pointer" }} value={props.nbModel}
            onChange={e => props.onNbModelChange(e.target.value)}>
            {NANO_BANANA_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function FigmaZone({ props }: { props: IntegrationsCatalogProps }) {
  const [showForm, setShowForm] = useState(!props.figmaConnected);
  return (
    <div style={{ marginTop: 18, padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", display: "grid", gap: 10 }}>
      {props.figmaConnected && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CheckIcon />
          <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)" }}>
            Vinculada{props.figmaAccount ? ` — ${props.figmaAccount}` : ""} · token cifrado en este workspace.
          </span>
        </div>
      )}
      {!showForm ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={primaryBtn} onClick={() => setShowForm(true)}>
            {props.figmaConnected ? "Reemplazar token" : "Vincular a mi cuenta"}
          </button>
          {props.figmaConnected && (
            <button type="button" style={{ ...ghostBtn, color: "#fca5a5", borderColor: "rgba(248,113,113,0.3)" }}
              disabled={props.figmaBusy} onClick={props.onFigmaDisconnect}>
              Desvincular
            </button>
          )}
        </div>
      ) : (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Token personal de Figma</span>
            <input type="password" autoComplete="off" style={drawerInput} value={props.figmaToken}
              onChange={e => props.onFigmaTokenChange(e.target.value)}
              placeholder={props.figmaConnected ? "Guardado · escribe para reemplazar" : "Pega tu token de Figma"} />
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
              Activa current_user:read y file_content:read al crear el token: sirven para verificar tu cuenta
              y leer los diseños que importes.
            </span>
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={{ ...primaryBtn, opacity: props.figmaToken.trim() && !props.figmaBusy ? 1 : 0.5 }}
              disabled={props.figmaBusy || !props.figmaToken.trim()} onClick={props.onFigmaSave}>
              {props.figmaBusy ? "Verificando…" : props.figmaConnected ? "Reemplazar conexión" : "Vincular a mi cuenta"}
            </button>
            {props.figmaConnected && (
              <button type="button" style={ghostBtn} onClick={() => setShowForm(false)}>Cancelar</button>
            )}
          </div>
        </>
      )}
      {props.figmaMessage && (
        <span role="status" style={{ fontSize: 11.5, color: props.figmaMessage.startsWith("✓") ? "#4ade80" : "#fca5a5" }}>
          {props.figmaMessage}
        </span>
      )}
    </div>
  );
}

function SocialZone({ def, props, connected }: {
  def: IntegrationDef; props: IntegrationsCatalogProps; connected: boolean;
}) {
  const provider = def.social!;
  const isZernio = provider === "zernio";
  const actionsDisabled = props.socialBusy || (!props.socialApiKey.trim() && !connected);
  return (
    <div style={{ marginTop: 18, padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", display: "grid", gap: 10 }}>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>API key de {def.name}</span>
        <input type="password" autoComplete="off" style={drawerInput} value={props.socialApiKey}
          onChange={e => props.onSocialApiKeyChange(e.target.value)}
          placeholder={connected ? "Guardada · escribe para reemplazar" : "Pega tu API key"} />
      </label>
      {isZernio && (
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Secreto del webhook</span>
          <input type="password" autoComplete="off" style={drawerInput} value={props.socialWebhookSecret}
            onChange={e => props.onSocialWebhookSecretChange(e.target.value)}
            placeholder="Opcional para estados en tiempo real" />
        </label>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={ghostBtn} disabled={actionsDisabled}
          onClick={props.onSocialTest}>
          {props.socialBusy ? "Probando…" : "Probar y listar cuentas"}
        </button>
        <button type="button" style={{ ...primaryBtn, opacity: actionsDisabled ? 0.5 : 1 }}
          disabled={actionsDisabled} onClick={props.onSocialSave}>
          {connected ? "Guardar como predeterminado" : "Vincular a mi cuenta"}
        </button>
      </div>
      {props.socialMessage && (
        <span role="status" style={{ fontSize: 11.5, color: props.socialMessage.startsWith("✓") ? "#4ade80" : "#fca5a5" }}>
          {props.socialMessage}
        </span>
      )}
      {props.socialAccounts.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 6, padding: 0 }}>
            Cuentas que podrá usar Copywriting
          </legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6 }}>
            {props.socialAccounts.map(account => (
              <label key={account.id}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11.5, color: "rgba(255,255,255,0.75)", cursor: "pointer" }}>
                <input type="checkbox" style={{ marginTop: 2 }}
                  checked={props.socialSelected[account.platform] === account.id}
                  onChange={e => props.onSocialAccountToggle(account.platform, account.id, e.target.checked)} />
                <span>
                  <strong style={{ fontWeight: 600 }}>{account.displayName}</strong><br />
                  <span style={{ color: "rgba(255,255,255,0.45)" }}>{account.platform} {account.username}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {isZernio && connected && props.socialConnections.find(item => item.provider === "zernio")?.webhookUrl && (
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", wordBreak: "break-all" }}>
          Webhook: <code style={{ fontSize: 10.5 }}>{window.location.origin}{props.socialConnections.find(item => item.provider === "zernio")?.webhookUrl}</code>
        </span>
      )}
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.55 }}>
        {isZernio
          ? "Zernio publica Posts, Stories y Reels según la red y el medio adjunto."
          : "Buffer publica Posts vía su API; Stories y Reels requieren Zernio."}
      </span>
      {connected && (
        <button type="button" style={{ ...ghostBtn, color: "#fca5a5", borderColor: "rgba(248,113,113,0.3)", justifySelf: "start" }}
          disabled={props.socialBusy} onClick={props.onSocialDisconnect}>
          Desvincular cuenta
        </button>
      )}
    </div>
  );
}
