import type { ComponentType, CSSProperties, ReactNode } from "react";

/**
 * Landing feature demos — mini UIs with looping CSS animations that show a
 * cursor moving, pressing a button, and the action happening.
 *
 * Timing model: every animated element inside a demo shares the demo cycle
 * `--fd-t`. Generic keyframes (fd-pop, fd-fade, fd-fill…) put their "event"
 * at ~0% of the cycle, so a negative `animation-delay` of -(T - t) phases the
 * event to second `t` of the loop. Cursor paths are per-demo keyframes
 * (fd-move-<id>). Base styles show the "finished" composition so users with
 * prefers-reduced-motion still see a complete static UI.
 */

/** Negative delay that phases a 0%-event keyframe to second `t` of a `cycle`-second loop. */
const at = (cycle: number, t: number): CSSProperties => ({
  animationDelay: `${(-(cycle - t)).toFixed(2)}s`,
});

/** Sets the demo cycle on the screen element (CSS var drives every animation). */
const cyc = (seconds: number): CSSProperties =>
  ({ "--fd-t": `${seconds}s` } as CSSProperties);

/* ── Shared primitives ────────────────────────────────────────────────── */

function Screen({ title, cycle, children }: { title?: string; cycle: number; children: ReactNode }) {
  return (
    <div className="fd" style={cyc(cycle)}>
      <div className="fd-chrome">
        <span className="fd-dot" /><span className="fd-dot" /><span className="fd-dot" />
        {title && <span className="fd-chrome-title">{title}</span>}
      </div>
      <div className="fd-stage">{children}</div>
    </div>
  );
}

/** Animated cursor. The per-demo keyframes (fd-move-<id>) move + press it;
 *  the ripple ring is a generic keyframe phased with a negative delay. */
function Cur({ id, cycle, press, origin }: { id: string; cycle: number; press: number; origin: CSSProperties }) {
  return (
    <div className={`fd-cur fd-cur--${id}`} style={origin}>
      <span className="fd-cur-ring" style={at(cycle, press)} />
    </div>
  );
}

/* ── 1 · Batchamator ───────────────────────────────────────────────────── */

const BATCH_T = 9;
const BatchDemo = () => (
  <Screen title="Batchamator" cycle={BATCH_T}>
    <div className="fd-card fd-batch-src">
      <div className="fd-card-bar" />
      <div className="fd-card-lines"><i /><i /></div>
    </div>
    <button className="fd-btn fd-batch-btn" type="button" style={at(BATCH_T, 1.35)}>Batch ×24</button>
    <div className="fd-batch-grid">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="fd-tile" style={at(BATCH_T, 1.8 + i * 0.12)}>
          <i style={{ background: i % 3 === 0 ? "#22d3ee" : i % 3 === 1 ? "#a78bfa" : "#f472b6" }} />
        </div>
      ))}
    </div>
    <div className="fd-badge" style={at(BATCH_T, 3.6)}>24 diseños ✓</div>
    <Cur id="batch" cycle={BATCH_T} press={1.35} origin={{ left: "34%", top: 20 }} />
  </Screen>
);

/* ── 2 · Código en tiempo real ─────────────────────────────────────────── */

const CODE_T = 10;
const CodeDemo = () => (
  <Screen title="editor — 0 ms" cycle={CODE_T}>
    <div className="fd-split">
      <div className="fd-canvas">
        <div className="fd-sq" style={at(CODE_T, 3.2)} />
        <div className="fd-badge fd-badge--tl" style={at(CODE_T, 3.4)}>0 ms · sin IA</div>
      </div>
      <div className="fd-code">
        <div className="fd-codeline"><span className="fd-code-k">background</span>: <span className="fd-hex" style={at(CODE_T, 3.2)} />;</div>
        <div className="fd-codeline"><span className="fd-code-k">border-radius</span>: 14px;</div>
        <div className="fd-codeline"><span className="fd-code-k">font-family</span>: Instrument;</div>
      </div>
    </div>
    <Cur id="code" cycle={CODE_T} press={3.1} origin={{ left: "55%", top: 34 }} />
  </Screen>
);

/* ── 3 · Software espejo ───────────────────────────────────────────────── */

const MIRROR_T = 9;
const MirrorDemo = () => (
  <Screen title="software espejo" cycle={MIRROR_T}>
    <div className="fd-mirror-grid">
      <div className="fd-mini-panel">
        <div className="fd-mini-head">🧑 Tú</div>
        <button className="fd-btn fd-btn--sm" type="button" style={at(MIRROR_T, 1.5)}>Publicar</button>
        <div className="fd-mini-card" style={at(MIRROR_T, 2.1)} />
      </div>
      <div className="fd-mirror-arrow">⇄</div>
      <div className="fd-mini-panel">
        <div className="fd-mini-head">🤖 Tu IA</div>
        <button className="fd-btn fd-btn--sm fd-btn--ai" type="button" style={at(MIRROR_T, 1.5)}>publicar()</button>
        <div className="fd-mini-card fd-mini-card--ai" style={at(MIRROR_T, 2.1)} />
      </div>
    </div>
    <div className="fd-badge" style={at(MIRROR_T, 3.4)}>con o sin tokens</div>
    <Cur id="mirror" cycle={MIRROR_T} press={1.5} origin={{ left: "16%", top: 52 }} />
  </Screen>
);

/* ── 4 · MCP first ─────────────────────────────────────────────────────── */

const MCP_T = 10;
const MCP_AGENTS = [
  { name: "Codex", left: "6%", top: 12 },
  { name: "Claude", left: "68%", top: 8 },
  { name: "Hermes", left: "4%", top: 66 },
  { name: "OpenClaw", left: "72%", top: 62 },
  { name: "Kimi", left: "36%", top: 2 },
];
const McpDemo = () => (
  <Screen title="MCP" cycle={MCP_T}>
    {MCP_AGENTS.map((a, i) => (
      <div key={a.name} className="fd-agent" style={{ left: a.left, top: a.top, animationDelay: `${i * -0.5}s` }}>
        {a.name}
      </div>
    ))}
    <button className="fd-btn fd-mcp-core" type="button" style={at(MCP_T, 2.0)}>⚡ tools/list</button>
    <div className="fd-mcp-tools">
      {["import_design", "render_frame", "studio_create_card"].map((t, i) => (
        <div key={t} className="fd-toolrow" style={at(MCP_T, 2.5 + i * 0.25)}>{t}</div>
      ))}
      <div className="fd-toolrow fd-toolrow--more" style={at(MCP_T, 3.3)}>+145 más…</div>
    </div>
    <Cur id="mcp" cycle={MCP_T} press={2.0} origin={{ left: "44%", top: 8 }} />
  </Screen>
);

/* ── 5 · Múltiples IAs ─────────────────────────────────────────────────── */

const KEYS_T = 10;
const KEYS_ROWS = [
  { emoji: "🟣", name: "Codex — Renzo" },
  { emoji: "🟠", name: "Claude — Laura" },
];
const KeysDemo = () => (
  <Screen title="Configuración → API Keys" cycle={KEYS_T}>
    <div className="fd-keylist">
      {KEYS_ROWS.map(r => (
        <div key={r.name} className="fd-keyrow">
          <span className="fd-avatar">{r.emoji}</span>
          <span className="fd-keyname">{r.name}</span>
          <span className="fd-keysecret">fdr_ws_••••</span>
          <i className="fd-live" />
        </div>
      ))}
      <div className="fd-keyrow" style={at(KEYS_T, 1.9)}>
        <span className="fd-avatar">🔵</span>
        <span className="fd-keyname">Hermes — Dev</span>
        <span className="fd-keysecret">fdr_ws_••••</span>
        <i className="fd-live" />
      </div>
    </div>
    <button className="fd-btn fd-keys-btn" type="button" style={at(KEYS_T, 1.3)}>+ Nueva clave</button>
    {KEYS_ROWS.map((r, i) => (
      <div key={r.name} className="fd-prog" style={{ ...at(KEYS_T, 3.2), top: 58 + i * 22 }}>
        <i />
      </div>
    ))}
    <div className="fd-badge" style={at(KEYS_T, 5.4)}>3 IAs diseñando a la vez</div>
    <Cur id="keys" cycle={KEYS_T} press={1.3} origin={{ left: "70%", top: 16 }} />
  </Screen>
);

/* ── 6 · Data propietaria ──────────────────────────────────────────────── */

const DATA_T = 10;
const DataDemo = () => (
  <Screen title="tu cuenta" cycle={DATA_T}>
    <div className="fd-tabs">
      <button className="fd-tab" type="button" style={at(DATA_T, 0.2)}>🗂 Tabla</button>
      <button className="fd-tab" type="button" style={at(DATA_T, 4.2)}>🕸 Grafo</button>
      <button className="fd-tab" type="button" style={at(DATA_T, 7.2)}>🗑 Papelera</button>
    </div>
    <div className="fd-pane fd-pane--table" style={{ animationName: "fd-win-a", animationDuration: "var(--fd-t)", animationIterationCount: "infinite" }}>
      <div className="fd-trow"><i style={{ width: "62%" }} /><i style={{ width: "38%" }} /></div>
      <div className="fd-trow"><i style={{ width: "48%" }} /><i style={{ width: "52%" }} /></div>
      <div className="fd-trow"><i style={{ width: "70%" }} /><i style={{ width: "30%" }} /></div>
    </div>
    <div className="fd-pane fd-pane--graph" style={{ animationName: "fd-win-b", animationDuration: "var(--fd-t)", animationIterationCount: "infinite" }}>
      <span className="fd-node" style={{ left: "14%", top: 8 }} />
      <span className="fd-node" style={{ left: "52%", top: 2 }} />
      <span className="fd-node" style={{ left: "78%", top: 26 }} />
      <span className="fd-node" style={{ left: "34%", top: 44 }} />
      <i className="fd-edge" style={{ left: "24%", top: 16, width: 34, transform: "rotate(24deg)" }} />
      <i className="fd-edge" style={{ left: "60%", top: 14, width: 30, transform: "rotate(52deg)" }} />
      <i className="fd-edge" style={{ left: "44%", top: 30, width: 38, transform: "rotate(-18deg)" }} />
    </div>
    <div className="fd-pane fd-pane--trash" style={{ animationName: "fd-win-c", animationDuration: "var(--fd-t)", animationIterationCount: "infinite" }}>
      <div className="fd-trashitem"> post-viernes.png <span className="fd-restore">↩ restaurar</span></div>
      <div className="fd-trashitem" style={{ opacity: 0.55 }}>banner-q3.jpg <span className="fd-restore">↩ restaurar</span></div>
    </div>
    <div className="fd-badge fd-badge--lock">🔒 solo tu cuenta</div>
    <Cur id="data" cycle={DATA_T} press={0.2} origin={{ left: "10%", top: 2 }} />
  </Screen>
);

/* ── 7 · Second brain ──────────────────────────────────────────────────── */

const BRAIN_T = 10;
const BrainDemo = () => (
  <Screen title="second brain" cycle={BRAIN_T}>
    <div className="fd-mini-head fd-brain-a">Marca A</div>
    <div className="fd-mini-head fd-brain-b">Marca B</div>
    <div className="fd-brain-pane fd-brain-pane--a">
      <span className="fd-node" style={{ left: "8%", top: 6 }} />
      <span className="fd-node" style={{ left: "40%", top: 0 }} />
      <span className="fd-node" style={{ left: "18%", top: 40 }} />
      <span className="fd-node" style={{ left: "62%", top: 34 }} />
      <i className="fd-edge" style={{ left: "16%", top: 12, width: 26, transform: "rotate(34deg)" }} />
      <i className="fd-edge" style={{ left: "26%", top: 20, width: 36, transform: "rotate(38deg)" }} />
      <i className="fd-edge" style={{ left: "48%", top: 12, width: 22, transform: "rotate(58deg)" }} />
    </div>
    <div className="fd-brain-pane fd-brain-pane--b">
      <span className="fd-node fd-node--b" style={{ left: "10%", top: 10 }} />
      <span className="fd-node fd-node--b" style={{ left: "58%", top: 4 }} />
      <span className="fd-node fd-node--b fd-brain-new1" style={{ left: "20%", top: 42, ...at(BRAIN_T, 2.8) }} />
      <span className="fd-node fd-node--b fd-brain-new2" style={{ left: "64%", top: 38, ...at(BRAIN_T, 3.0) }} />
      <i className="fd-edge fd-edge--b fd-brain-e1" style={{ left: "20%", top: 16, width: 34, transform: "rotate(34deg)", ...at(BRAIN_T, 2.9) }} />
      <i className="fd-edge fd-edge--b fd-brain-e2" style={{ left: "44%", top: 14, width: 28, transform: "rotate(42deg)", ...at(BRAIN_T, 3.1) }} />
    </div>
    <button className="fd-btn fd-btn--sm fd-brain-btn" type="button" style={at(BRAIN_T, 1.5)}>Replicar →</button>
    <span className="fd-flydot" style={at(BRAIN_T, 2.2)} />
    <span className="fd-flydot fd-flydot--2" style={at(BRAIN_T, 2.5)} />
    <div className="fd-badge" style={at(BRAIN_T, 3.6)}>mismo proceso · otro estilo</div>
    <Cur id="brain" cycle={BRAIN_T} press={1.5} origin={{ left: "18%", top: 88 }} />
  </Screen>
);

/* ── 8 · De imagen a diseño ────────────────────────────────────────────── */

const IMG_T = 9;
const ImgDemo = () => (
  <Screen title="imagen → diseño" cycle={IMG_T}>
    <div className="fd-jpg">
      <span className="fd-jpg-art">🏔️</span>
      <span className="fd-filetype">foto.jpg</span>
    </div>
    <button className="fd-btn fd-btn--sm fd-img-btn" type="button" style={at(IMG_T, 1.4)}>→ Editable</button>
    <div className="fd-editable">
      <div className="fd-edit-frame">
        <span className="fd-corner fd-corner--tl" /><span className="fd-corner fd-corner--tr" />
        <span className="fd-corner fd-corner--bl" /><span className="fd-corner fd-corner--br" />
        <span className="fd-edit-art">🏔️</span>
      </div>
      <div className="fd-layers">
        {["🖼 Imagen", "✏️ Texto", "🔘 Botón"].map((l, i) => (
          <div key={l} className="fd-layerchip" style={at(IMG_T, 2.1 + i * 0.25)}>{l}</div>
        ))}
      </div>
    </div>
    <div className="fd-badge" style={at(IMG_T, 3.4)}>HTML + CSS</div>
    <Cur id="img" cycle={IMG_T} press={1.4} origin={{ left: "30%", top: 44 }} />
  </Screen>
);

/* ── 9 · Chat incluido ─────────────────────────────────────────────────── */

const CHAT_T = 9;
const ChatDemo = () => (
  <Screen title="chat" cycle={CHAT_T}>
    <div className="fd-bubble fd-bubble--user" style={at(CHAT_T, 2.5)}>Haz un post para el viernes 🌴</div>
    <div className="fd-bubble fd-bubble--ai" style={at(CHAT_T, 3.4)}>
      <span className="fd-bubble-thumb" /> listo ✓ edita el copy aquí →
    </div>
    <div className="fd-chatbar">
      <span className="fd-typing" style={at(CHAT_T, 0.7)}>
        <i /><i /><i />
      </span>
      <span className="fd-chat-ph">Escribe con tu API…</span>
      <button className="fd-send" type="button" style={at(CHAT_T, 2.2)}>▲</button>
    </div>
    <div className="fd-badge" style={at(CHAT_T, 4.4)}>tu API dentro de Musa</div>
    <Cur id="chat" cycle={CHAT_T} press={2.2} origin={{ left: "78%", top: 96 }} />
  </Screen>
);

/* ── 10 · Animaciones y video ──────────────────────────────────────────── */

const VIDEO_T = 10;
const VideoDemo = () => (
  <Screen title="animación → reel" cycle={VIDEO_T}>
    <div className="fd-canvas fd-video-canvas">
      <span className="fd-vidshape" />
      <span className="fd-badge fd-badge--tl" style={at(VIDEO_T, 1.6)}>▶ animando</span>
    </div>
    <button className="fd-btn fd-btn--sm fd-play" type="button" style={at(VIDEO_T, 1.2)}>▶</button>
    <button className="fd-btn fd-btn--sm fd-export" type="button" style={at(VIDEO_T, 5.2)}>⬇ Reel</button>
    <div className="fd-timeline"><i style={at(VIDEO_T, 1.4)} /></div>
    <div className="fd-filechip" style={at(VIDEO_T, 5.7)}>🎬 reel-1080x1920.mp4 ✓</div>
    <Cur id="video" cycle={VIDEO_T} press={1.2} origin={{ left: "74%", top: 10 }} />
  </Screen>
);

/* ── 11 · Comentarios ──────────────────────────────────────────────────── */

const COMM_T = 9;
const CommentsDemo = () => (
  <Screen title="acceso invitado" cycle={COMM_T}>
    <div className="fd-phone">
      <span className="fd-notch" />
      <div className="fd-phone-art">
        <i className="fd-phone-line" style={{ width: "70%" }} />
        <i className="fd-phone-line" style={{ width: "45%" }} />
        <i className="fd-phone-cta" />
      </div>
      <span className="fd-pindot" style={{ ...at(COMM_T, 1.6), left: "26%", top: 18 }}>1</span>
      <span className="fd-pindot fd-pindot--2" style={{ ...at(COMM_T, 3.2), left: "62%", top: 56 }}>2</span>
      <div className="fd-phone-bubble" style={at(COMM_T, 1.9)}>más contraste 👀</div>
      <div className="fd-phone-bubble fd-phone-bubble--2" style={at(COMM_T, 3.5)}>cambia el CTA ↗</div>
    </div>
    <div className="fd-badge" style={at(COMM_T, 4.8)}>desde el móvil · sin cuenta</div>
    <Cur id="comments" cycle={COMM_T} press={1.5} origin={{ left: "22%", top: 30 }} />
  </Screen>
);

/* ── 12 · Drag and drop ────────────────────────────────────────────────── */

const DROP_T = 9;
const DropDemo = () => (
  <Screen title="editor" cycle={DROP_T}>
    <div className="fd-zone">
      <span className="fd-zone-label">Suelta aquí</span>
      <div className="fd-dropped fd-dropped--1" style={at(DROP_T, 1.9)}>
        <span className="fd-card-bar" /><div className="fd-card-lines"><i /><i /></div>
      </div>
      <div className="fd-dropped fd-dropped--2" style={at(DROP_T, 4.3)}>
        <span className="fd-dropped-img">🏔️</span>
      </div>
    </div>
    <span className="fd-filechip fd-drag1" style={{ ...at(DROP_T, 1.1), left: "6%", top: 4 }}>📄 index.html</span>
    <span className="fd-filechip fd-drag2" style={{ ...at(DROP_T, 3.5), left: "70%", top: 4 }}>🏔️ foto.jpg</span>
    <div className="fd-badge" style={at(DROP_T, 5.2)}>interpretado como diseño</div>
    <Cur id="drop" cycle={DROP_T} press={1.1} origin={{ left: "8%", top: 8 }} />
  </Screen>
);

/* ── 13 · Borradores multi item ────────────────────────────────────────── */

const ERASE_T = 8;
const EraseDemo = () => (
  <Screen title="borrador" cycle={ERASE_T}>
    <div className="fd-canvas">
      <span className="fd-erase-el fd-erase-photo" style={at(ERASE_T, 1.2)}>🏔️<small>foto.jpg</small></span>
      <span className="fd-erase-el fd-erase-star" style={at(ERASE_T, 1.2)}>✆<small>vector</small></span>
      <span className="fd-sweep" />
    </div>
    <div className="fd-badge" style={at(ERASE_T, 3.6)}>foto + vector · un trazo</div>
    <Cur id="erase" cycle={ERASE_T} press={1.4} origin={{ left: "6%", top: 46 }} />
  </Screen>
);

/* ── 14 · Kanban de tareas ─────────────────────────────────────────────── */

const KANBAN_T = 10;
const KanbanDemo = () => (
  <Screen title="kanban" cycle={KANBAN_T}>
    <div className="fd-kb-col" style={{ left: "3%" }}><span className="fd-kb-head">Backlog</span></div>
    <div className="fd-kb-col" style={{ left: "36%" }}><span className="fd-kb-head">Design</span></div>
    <div className="fd-kb-col fd-kb-col--review" style={{ left: "69%" }}><span className="fd-kb-head">Review ✨</span></div>
    <button className="fd-btn fd-btn--sm fd-kb-add" type="button" style={at(KANBAN_T, 1.3)}>+ ✨ IA</button>
    <div className="fd-kb-card fd-kb-card--1" style={{ animationName: "fd-win-k1", animationDuration: "var(--fd-t)", animationIterationCount: "infinite" }}>
      <b>post viernes</b><span className="fd-kb-tag">✨ por IA</span>
    </div>
    <div className="fd-kb-card fd-kb-card--2" style={{ animationName: "fd-win-k2", animationDuration: "var(--fd-t)", animationIterationCount: "infinite" }}>
      <b>post viernes</b><span className="fd-kb-tag">🎨 diseñando</span>
    </div>
    <div className="fd-kb-card fd-kb-card--3" style={{ animationName: "fd-win-k3", animationDuration: "var(--fd-t)", animationIterationCount: "infinite" }}>
      <b>post viernes</b><span className="fd-kb-tag fd-kb-tag--done">✓ tu review</span>
    </div>
    <Cur id="kanban" cycle={KANBAN_T} press={1.3} origin={{ left: "6%", top: 4 }} />
  </Screen>
);

/* ── Catalog ───────────────────────────────────────────────────────────── */

export interface LandingFeature {
  id: string;
  icon: string;
  title: string;
  desc: string;
  Demo: ComponentType;
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    id: "batch", icon: "⚡", title: "Batchamator", Demo: BatchDemo,
    desc: "Automatiza contenido: descarga cada diseño como CSV y produce 20, 30, 40 piezas usando tu diseño como plantilla — o pide a tu IA que haga todo.",
  },
  {
    id: "code", icon: "💻", title: "Código en tiempo real", Demo: CodeDemo,
    desc: "Lo que ves es lo que obtienes en código. Modificas algo y no esperas ni un segundo: el sistema lo interpreta como código, sin depender de una IA.",
  },
  {
    id: "mirror", icon: "🪞", title: "Software espejo", Demo: MirrorDemo,
    desc: "Absolutamente todo lo que puedes hacer, lo puede hacer tu IA — y viceversa. Usa la plataforma con o sin tokens.",
  },
  {
    id: "mcp", icon: "🔌", title: "MCP first", Demo: McpDemo,
    desc: "Conecta cualquier agente de IA que uses — Codex, Claude, Hermes, OpenClaw, Kimi — y aprovéchalo al 100%.",
  },
  {
    id: "keys", icon: "🔑", title: "Múltiples IAs", Demo: KeysDemo,
    desc: "Crea claves MCP y da acceso a todo tu equipo con sus respectivas IAs para diseñar a la vez.",
  },
  {
    id: "data", icon: "🔐", title: "Data propietaria", Demo: DataDemo,
    desc: "Tu data es tuya: gestiónala en tablas, grafos e incluso papelera de reciclaje. Nada se pierde, todo se almacena en tu propia cuenta y nadie más tiene acceso.",
  },
  {
    id: "brain", icon: "🧠", title: "Second brain", Demo: BrainDemo,
    desc: "Encuentra patrones replicables: cuando entra una marca nueva, indicas a tus IAs replicar el proceso completo siguiendo el estilo de la otra marca.",
  },
  {
    id: "img", icon: "🖼️", title: "De imagen a diseño", Demo: ImgDemo,
    desc: "Sube una imagen con drag and drop y con un solo clic conviértela en un diseño editable con su código.",
  },
  {
    id: "chat", icon: "💬", title: "Chat incluido", Demo: ChatDemo,
    desc: "Conecta tu API dentro de la plataforma si no tienes agentes como Codex, Claude, Hermes, OpenClaw o Replit.",
  },
  {
    id: "video", icon: "🎬", title: "Animaciones y video", Demo: VideoDemo,
    desc: "Diseña tus piezas, anímalas y expórtalas como reels y videos.",
  },
  {
    id: "comments", icon: "📌", title: "Comentarios", Demo: CommentsDemo,
    desc: "Comparte accesos de invitado para recibir comentarios desde el móvil.",
  },
  {
    id: "drop", icon: "📥", title: "Drag and drop", Demo: DropDemo,
    desc: "Suelta HTMLs, JPGs y más en el editor: el sistema los interpreta como diseño.",
  },
  {
    id: "erase", icon: "🧽", title: "Borradores multi item", Demo: EraseDemo,
    desc: "Borra vectores y fotos como si fueran un mismo tipo de archivo. Olvídate de Photoshop.",
  },
  {
    id: "kanban", icon: "📋", title: "Kanban de tareas", Demo: KanbanDemo,
    desc: "Desglosa tareas para que tus IAs las realicen: crean sus tareas, actualizan la información y las dejan en tu columna de review.",
  },
];
