import type { CSSProperties } from "react";

/**
 * MusaHero — las dos secciones narrativas de la landing:
 *
 *  1. HarnessShowcase: UN div, DOS tarjetas — "Modelo de IA" vs "Arnés para
 *     IAs". La mascota (el muñeco de Musa) aparece primero sola y perdida
 *     (HTML suelto), y en la segunda tarjeta recibe la armadura, un pincel
 *     bézier y produce un documento de diseño estructurado.
 *  2. AudienceShowcase: UN div, TRES tarjetas — el rol que Musa toma según
 *     quién la use (junior para delegar, copilot, diseñador). Sigue la misma
 *     mascota y el mismo modelo de animación.
 *
 * Timing: cada tarjeta es un escenario `.mh` con su ciclo `--mh-t`; los
 * keyframes ponen su "evento" al 0% y un `animation-delay` negativo lo
 * desfasa al segundo deseado del loop (mismo modelo que FeatureDemos).
 */

/** Desfasa un keyframe con evento al 0% al segundo `t` de un loop de `cycle` segundos. */
const at = (cycle: number, t: number): CSSProperties => ({
  animationDelay: `${(-(cycle - t)).toFixed(2)}s`,
});

/** Define el ciclo del escenario (la variable CSS maneja cada animación). */
const cyc = (seconds: number): CSSProperties =>
  ({ "--mh-t": `${seconds}s` } as CSSProperties);

/* ── Mascota de Musa ───────────────────────────────────────────────────── */

type MascotProps = {
  armored?: boolean;
  /** Ciclo del escenario (para desfasar la cascada de la armadura). */
  cycle?: number;
  /** Segundo del ciclo en que aparece la armadura (elementos en cascada). */
  armorAt?: number;
  variant?: string;
};

function Mascot({ armored = false, cycle = 9, armorAt = 0.6, variant = "" }: MascotProps) {
  const d = (offset: number) =>
    ({ animationDelay: `${(-(cycle - (armorAt + offset))).toFixed(2)}s` } as CSSProperties);
  return (
    <svg className={`mh-mascot${variant ? ` ${variant}` : ""}`} viewBox="0 0 140 140" aria-hidden="true">
      {/* Antena */}
      <line x1="70" y1="20" x2="70" y2="9" className="mh-ant" />
      <circle cx="70" cy="8" r="4.4" className="mh-ant-dot" />
      {/* Brazos */}
      <path d="M44 84 Q28 92 26 106" className="mh-arm" />
      <path d="M96 84 Q112 92 114 106" className="mh-arm" />
      {/* Cuerpo */}
      <rect x="42" y="64" width="56" height="54" rx="20" className="mh-body" />
      {/* Cabeza */}
      <circle cx="70" cy="46" r="26" className="mh-head" />
      {/* Ojos (parpadeo) */}
      <g className="mh-eyes">
        <ellipse cx="59" cy="45" rx="3.2" ry="4.2" className="mh-eye" />
        <ellipse cx="81" cy="45" rx="3.2" ry="4.2" className="mh-eye" />
      </g>
      {/* Sonrisa */}
      <path d="M61 55 Q70 62 79 55" className="mh-smile" />
      {armored && (
        <g className="mh-armor">
          {/* Visor del casco */}
          <path d="M46 43 Q70 31 94 43 L94 51 Q70 41 46 51 Z" className="mh-visor" style={d(0)} />
          {/* Hombreras */}
          <circle cx="41" cy="77" r="10" className="mh-pad" style={d(0.05)} />
          <circle cx="99" cy="77" r="10" className="mh-pad" style={d(0.05)} />
          {/* Peto */}
          <rect x="50" y="72" width="40" height="36" rx="12" className="mh-plate" style={d(0.1)} />
          <path d="M70 76 L70 104" className="mh-crest" style={d(0.15)} />
          <circle cx="60" cy="81" r="2.2" className="mh-rivet" style={d(0.2)} />
          <circle cx="80" cy="81" r="2.2" className="mh-rivet" style={d(0.2)} />
        </g>
      )}
    </svg>
  );
}

/* ── Pincel bézier + curva ─────────────────────────────────────────────── */

function PenStroke({ cycle, penAt, drawAt }: { cycle: number; penAt: number; drawAt: number }) {
  return (
    <svg className="mh-pen-svg" viewBox="0 0 140 80" aria-hidden="true">
      <g className="mh-pen" style={at(cycle, penAt)}>
        <rect x="14" y="17" width="76" height="13" rx="6.5" transform="rotate(14 52 23)" className="mh-pen-body" />
        <path d="M86 27 L107 44 L93 42 Z" className="mh-pen-nib" />
        <circle cx="15" cy="23" r="5.5" className="mh-pen-grip" />
      </g>
      <path
        d="M14 58 C 42 24, 86 24, 122 44"
        className="mh-bezier"
        style={at(cycle, drawAt)}
      />
      <circle cx="14" cy="58" r="3.4" className="mh-handle" />
      <circle cx="122" cy="44" r="3.4" className="mh-handle" />
    </svg>
  );
}

/* ── Documento de diseño (la salida del arnés) ─────────────────────────── */

function DesignDoc({ cycle, popAt }: { cycle: number; popAt: number }) {
  return (
    <div className="mh-doc" style={at(cycle, popAt)}>
      <div className="mh-doc-bar" />
      <div className="mh-doc-frame">
        <i className="mh-doc-layer" style={{ width: "76%" }} />
        <i className="mh-doc-layer" style={{ width: "54%" }} />
        <i className="mh-doc-layer" style={{ width: "64%" }} />
      </div>
      <div className="mh-doc-tokens"><i /><i /><i /><i /></div>
    </div>
  );
}

/* ── 1 · HarnessShowcase: modelo de IA vs arnés ─────────────────────────── */

const MODEL_T = 9;
const ARMOR_T = 10;

export function HarnessShowcase() {
  return (
    <div className="mh-harness-cards">
      {/* ── Tarjeta A: Modelo de IA ── */}
      <article className="mh-card">
        <div className="mh-stage mh-stage--model" style={cyc(MODEL_T)}>
          <Mascot variant="mh-mascot--lost" />
          <span className="mh-tag mh-tag--a" style={at(MODEL_T, 1.2)}>&lt;div&gt;</span>
          <span className="mh-tag mh-tag--b" style={at(MODEL_T, 2.1)}>&lt;p&gt;</span>
          <span className="mh-tag mh-tag--c" style={at(MODEL_T, 3.1)}>&lt;span&gt;</span>
          <span className="mh-q" style={at(MODEL_T, 4.3)}>?</span>
        </div>
        <h3 className="mh-card-title">Modelo de IA</h3>
        <p className="mh-card-desc">
          Lo crean los laboratorios — Anthropic, OpenAI, Google… Por sí solo
          genera HTML suelto: sin layout, sin sistema, sin persistencia.
        </p>
      </article>

      {/* ── Tarjeta B: Arnés para IAs ── */}
      <article className="mh-card mh-card--armor">
        <div className="mh-stage mh-stage--harness" style={cyc(ARMOR_T)}>
          <Mascot armored cycle={ARMOR_T} armorAt={0.7} />
          <PenStroke cycle={ARMOR_T} penAt={1.6} drawAt={2.4} />
          <DesignDoc cycle={ARMOR_T} popAt={3.2} />
          <span className="mh-spark" style={at(ARMOR_T, 4.4)}>✦</span>
          <span className="mh-spark mh-spark--2" style={at(ARMOR_T, 4.9)}>✦</span>
        </div>
        <h3 className="mh-card-title">Arnés para IAs</h3>
        <p className="mh-card-desc">
          La armadura de Musa: sistema de layout, tipografía, tokens de color,
          frames y render determinístico. Conectas cualquier IA y cada salida
          es un documento de diseño estructurado, editable y persistente —
          diseñado como un humano.
        </p>
      </article>
    </div>
  );
}

/* ── 2 · AudienceShowcase: el rol de Musa según quién la usa ───────────── */

const SENIOR_T = 9;
const JUNIOR_T = 9;
const FOUNDER_T = 10;

export function AudienceShowcase() {
  return (
    <div className="mh-audience-cards">
      {/* ── Diseñadores y creativos senior → junior para delegar ── */}
      <article className="mh-card">
        <div className="mh-stage mh-stage--senior" style={cyc(SENIOR_T)}>
          <Mascot variant="mh-mascot--eager" />
          <div className="mh-task" style={at(SENIOR_T, 1.3)}>
            <b>post viernes</b><span>por ti</span>
          </div>
          <div className="mh-task mh-task--2" style={at(SENIOR_T, 3.3)}>
            <b>banner + stories</b><span>por ti</span>
          </div>
          <span className="mh-check" style={at(SENIOR_T, 2.3)}>✓</span>
          <span className="mh-spark" style={at(SENIOR_T, 4.6)}>✦</span>
        </div>
        <h3 className="mh-card-title">Diseñadores y creativos senior</h3>
        <p className="mh-card-desc">
          Musa será tu junior: delegas lo repetitivo y te quedas con la
          dirección creativa.
        </p>
      </article>

      {/* ── Juniors → copilot ── */}
      <article className="mh-card">
        <div className="mh-stage mh-stage--junior" style={cyc(JUNIOR_T)}>
          <Mascot />
          <div className="mh-screen">
            <span className="mh-screen-dots"><i /><i /><i /></span>
            <i className="mh-screen-line" style={{ width: "66%" }} />
            <i className="mh-screen-line" style={{ width: "44%" }} />
            <i className="mh-screen-cta" />
            <span className="mh-cursor" />
          </div>
          <div className="mh-tip" style={at(JUNIOR_T, 2.9)}>pista: alinea al grid ↗</div>
          <span className="mh-check mh-check--level" style={at(JUNIOR_T, 4.4)}>↑ subes de nivel</span>
        </div>
        <h3 className="mh-card-title">Juniors</h3>
        <p className="mh-card-desc">
          Musa será tu copilot: te guía, corrige contigo y te sube de nivel
          mientras diseñas.
        </p>
      </article>

      {/* ── Emprendedores y no diseñadores → diseñador ── */}
      <article className="mh-card">
        <div className="mh-stage mh-stage--founder" style={cyc(FOUNDER_T)}>
          <Mascot variant="mh-mascot--artist" />
          <div className="mh-easel">
            <div className="mh-easel-canvas">
              <i className="mh-stroke mh-stroke--1" style={at(FOUNDER_T, 1.5)} />
              <i className="mh-stroke mh-stroke--2" style={at(FOUNDER_T, 2.4)} />
              <i className="mh-stroke mh-stroke--3" style={at(FOUNDER_T, 3.2)} />
            </div>
            <span className="mh-easel-leg mh-easel-leg--l" />
            <span className="mh-easel-leg mh-easel-leg--r" />
          </div>
          <span className="mh-piece" style={at(FOUNDER_T, 4.4)}>pieza lista ✓</span>
        </div>
        <h3 className="mh-card-title">Emprendedores y no diseñadores</h3>
        <p className="mh-card-desc">
          Musa será tu diseñador: describes la idea y la convierte en piezas
          listas para publicar.
        </p>
      </article>
    </div>
  );
}
