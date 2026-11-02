/**
 * LandingV2.tsx — Landing de Musa v2 con la piel de la maqueta.
 * "Entrar" y "Crear cuenta" llevan al acceso (AuthScreen) en el modo elegido.
 */
import "./auth-v2.css";

const MODS: [string, string, string, string?][] = [
  ["Planear", "Investiga temas, arma briefs y playbooks, y organiza el calendario de cada marca.", "Calendario"],
  ["Crear", "Diseños, video y motion, tomas, clones IA, eventos, mailing y formularios con las plantillas de tu marca.", "Editor", "alt"],
  ["Conversar", "Responde mensajes y comentarios de todos los canales desde una sola bandeja.", "Bandeja", "dark"],
  ["Anunciar", "Campañas de pauta en Meta, TikTok, LinkedIn y Google, con audiencias y presupuesto por marca.", "Ads"],
  ["Vender", "Tu CRM: oportunidades, cotizaciones, personas, empresas, embudo y loops.", "CRM", "dark"],
  ["Agentes", "Agentes de IA con su propia computadora, operando Musa con los permisos que les das.", "IA", "alt"],
  ["Medir", "Alcance, embudos, loops y resultados de cada una de tus marcas.", "Reportes"],
];

export function LandingV2({ onEnter }: { onEnter: () => void }) {
  const go = (mode: "signin" | "signup") => {
    try { sessionStorage.setItem("musa-auth-mode", mode); } catch { /* sin storage */ }
    onEnter();
  };
  return (
    <div className="mv2-land">
      <nav className="mv2-nav">
        <div className="mv2-logo">MUSA<i>#</i><small>by Futuraria</small></div>
        <div className="mv2-nav-act">
          <button type="button" className="mv2-btn ghost" onClick={() => go("signin")}>Entrar</button>
          <button type="button" className="mv2-btn solid" onClick={() => go("signup")}>Crear cuenta</button>
        </div>
      </nav>

      <header className="mv2-hero">
        <h1>Todo tu contenido,<br />en <em>un solo lugar</em></h1>
        <p>Musa es la plataforma de contenido de Futuraria: planea, crea, publica, vende y mide para todas tus marcas, con tu equipo y tus agentes de IA trabajando en el mismo espacio.</p>
        <div className="mv2-hero-act">
          <button type="button" className="mv2-btn solid big tilt" onClick={() => go("signup")}>Empezar gratis</button>
          <button type="button" className="mv2-btn ghost big" onClick={() => go("signin")}>Ya tengo cuenta</button>
          <small>¿Usabas Musa? Entra con tu misma cuenta.</small>
        </div>
      </header>

      <section className="mv2-grid" aria-label="Módulos de Musa">
        {MODS.map(([t, d, tag, tone]) => (
          <article key={t} className={`mv2-card ${tone ?? ""}`}>
            <span className="tag">{tag}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </article>
        ))}
      </section>

      <section className="mv2-band">
        <div>
          <h2>Tu marca, tu equipo<br />y tus agentes. Juntos.</h2>
          <button type="button" className="mv2-btn big" onClick={() => go("signup")}>Crear cuenta</button>
        </div>
      </section>

      <footer className="mv2-foot"><span>© 2026 Futuraria</span><span>Musa · by Futuraria</span></footer>
    </div>
  );
}
