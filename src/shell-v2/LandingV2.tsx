/**
 * LandingV2.tsx — Landing de Musa v2 con la piel de la maqueta.
 * "Entrar" y "Crear cuenta" llevan al acceso (AuthScreen) en el modo elegido.
 */
import { useEffect, useRef, useState } from "react";
import "./auth-v2.css";
import { PlansTable, usePlans } from "../components/PlansTable";

// Comparativas estáticas en /comparar/ (generadas por scripts/comparativas/build.mjs).
const COMPARE: [string, string][] = [
  ["canva", "Canva"], ["adobe", "Adobe"], ["figma", "Figma"], ["pencil", "Pencil"], ["paper", "Paper"],
  ["vectorcraft", "VectorCraft"], ["kittl", "Kittl"], ["lovart", "Lovart"], ["pomelli", "Pomelli"],
  ["hootsuite", "Hootsuite"], ["sprout-social", "Sprout Social"], ["metricool", "Metricool"],
  ["buffer", "Buffer"], ["later", "Later"], ["hubspot", "HubSpot"], ["jasper", "Jasper"],
];

const MODS: [string, string, string, string?][] = [
  ["Planear", "Investiga temas, arma briefs y playbooks, y organiza el calendario de cada marca.", "Calendario"],
  ["Crear", "Diseños, video y motion, tomas, clones IA, eventos, mailing y formularios con las plantillas de tu marca.", "Editor", "alt"],
  ["Conversar", "Responde mensajes y comentarios de todos los canales desde una sola bandeja.", "Bandeja", "dark"],
  ["Anunciar", "Campañas de pauta en Meta, TikTok, LinkedIn y Google, con audiencias y presupuesto por marca.", "Ads"],
  ["Vender", "Tu CRM: oportunidades, cotizaciones, personas, empresas, embudo y loops.", "CRM", "dark"],
  ["Agentes", "Agentes de IA con su propia computadora, operando Musa con los permisos que les das.", "IA", "alt"],
  ["Medir", "Alcance, embudos, loops y resultados de cada una de tus marcas.", "Reportes"],
];

// Resumen de la tabla de /comparar/ (mismos valores que scripts/comparativas/data.mjs).
// Las 9 primeras se ven siempre; el resto aparece con «Ver todas las funciones» (ya está en el HTML para buscadores).
const CMP_COLS = ["Canva", "Adobe", "Figma", "Hootsuite", "Metricool", "HubSpot"];
const CMP_CORE = 9;
const CMP_ROWS: [string, ...string[]][] = [
  ["Editor de diseño", "y", "y", "y", "p", "p", "p"],
  ["Editor de video", "y", "y", "n", "n", "n", "p"],
  ["Calendario y publicación en redes", "y", "y", "n", "y", "y", "p"],
  ["Bandeja de mensajes y comentarios", "n", "n", "n", "y", "y", "p"],
  ["Campañas de pauta (ads)", "p", "p", "n", "p", "p", "y"],
  ["CRM y embudo comercial", "n", "n", "n", "n", "n", "y"],
  ["Intranet para tus clientes", "n", "n", "n", "n", "p", "p"],
  ["Agentes de IA vía MCP", "p", "p", "y", "n", "p", "y"],
  ["Tu propia llave de IA (BYOK)", "n", "n", "n", "n", "n", "n"],
  ["Editor de fotos", "y", "y", "p", "n", "n", "n"],
  ["Motion y animación", "p", "y", "p", "n", "n", "n"],
  ["Visual y código en el mismo archivo", "p", "n", "p", "n", "n", "p"],
  ["Producción masiva", "y", "y", "y", "n", "n", "n"],
  ["Manual de marca y validación", "p", "p", "n", "n", "n", "n"],
  ["Eventos", "n", "n", "n", "n", "n", "p"],
  ["Formularios", "n", "n", "n", "n", "n", "y"],
  ["Landings", "y", "p", "y", "n", "p", "y"],
  ["Mailing", "p", "p", "n", "n", "n", "y"],
  ["Clones de IA", "p", "n", "n", "n", "n", "n"],
  ["Tomas con teleprompter", "p", "n", "n", "n", "n", "n"],
  ["Cotizaciones con firma del cliente", "n", "n", "n", "n", "n", "p"],
  ["Simulador de embudos", "n", "n", "n", "n", "n", "p"],
  ["Loops de crecimiento", "n", "n", "n", "n", "n", "n"],
];

// Selector EN | ES de public/i18n/i18n.js (el mismo que usa la plataforma).
function LangSwitch() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const i18n = (window as unknown as { musaI18n?: { switcher: () => HTMLElement } }).musaI18n;
    if (!el || !i18n || el.firstChild) return;
    el.appendChild(i18n.switcher());
  }, []);
  return <span ref={ref} className="mv2-lang" data-no-i18n="" />;
}

// Las comparativas existen en inglés (/compare/) y español (/comparar/).
const cmpDir = () => ((window as unknown as { musaI18n?: { lang: string } }).musaI18n?.lang === "es" ? "comparar" : "compare");

/** Planes a la venta: la misma tabla que la pantalla de planes de la cuenta. */
function Pricing({ onPick }: { onPick: (code: string) => void }) {
  const data = usePlans();
  if (!data || !data.plans.length) return null;
  return (
    <section className="mv2-price" id="planes" aria-labelledby="mv2-price-t">
      <h2 id="mv2-price-t">Todo tu stack <em>en un plan</em></h2>
      <p>Musa reemplaza tu herramienta de diseño, tu programador de redes, tu CRM, tu mailing y tu portal de clientes, y su IA hace el trabajo por ti. Pruébalo 3 meses a precio de oferta.</p>
      <PlansTable data={data} onPick={onPick} dark />
      <p className="mv2-price-code">¿Tienes un código de acceso? Crea tu cuenta y escríbelo en el registro.</p>
    </section>
  );
}

export function LandingV2({ onEnter }: { onEnter: () => void }) {
  const [cmpAll, setCmpAll] = useState(false);
  const go = (mode: "signin" | "signup") => {
    try { sessionStorage.setItem("musa-auth-mode", mode); } catch { /* sin storage */ }
    onEnter();
  };
  // Los enlaces de las páginas estáticas llegan como /?signup=1 o /?signin=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const mode = q.has("signup") ? "signup" : q.has("signin") ? "signin" : null;
    if (!mode) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    go(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="mv2-land">
      <nav className="mv2-nav">
        <div className="mv2-logo">MUSA<i>#</i><small>by Futuraria</small></div>
        <div className="mv2-nav-act">
          <LangSwitch />
          <button type="button" className="mv2-btn ghost" onClick={() => go("signin")}>Entrar</button>
          <button type="button" className="mv2-btn solid" onClick={() => go("signup")}>Crear cuenta</button>
        </div>
      </nav>

      <header className="mv2-hero">
        <h1>Todo tu contenido,<br />en <em>un solo lugar</em></h1>
        <p>Musa es la plataforma de contenido de Futuraria: planea, crea, publica, vende y mide para todas tus marcas, con tu equipo y tus agentes de IA trabajando en el mismo espacio.</p>
        <div className="mv2-hero-act">
          <button type="button" className="mv2-btn solid big tilt" onClick={() => go("signup")}>Empezar</button>
          <a className="mv2-btn ghost big" href="#planes" onClick={(e) => { e.preventDefault(); document.getElementById("planes")?.scrollIntoView({ behavior: "smooth" }); }}>Ver planes</a>
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

      <Pricing onPick={(code) => { try { localStorage.setItem("musa:plan", code); } catch { /* */ } go("signup"); }} />

      <section className="mv2-cmp" aria-labelledby="mv2-cmp-t">
        <h2 id="mv2-cmp-t">Una plataforma <em>en vez de cinco</em></h2>
        <p>Diseñar, programar redes, responder mensajes, pautar y vender suele costar una herramienta distinta por paso. Así se compara Musa.</p>
        <div className="mv2-cmp-wrap">
          <table>
            <thead><tr><th scope="col">Función</th><th scope="col" className="musa">Musa</th>{CMP_COLS.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {CMP_ROWS.map(([f, ...v], i) => (
                <tr key={f} className={i >= CMP_CORE && !cmpAll ? "mv2-cmp-more" : undefined}><th scope="row">{f}</th><td className="musa"><span className="m y">Sí</span></td>
                  {v.map((x, i) => <td key={i}><span className={`m ${x}`}>{x === "y" ? "Sí" : x === "p" ? "Parcial" : "No"}</span></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="mv2-cmp-toggle" aria-expanded={cmpAll} onClick={() => setCmpAll((x) => !x)}>{cmpAll ? "Ver menos" : `Ver todas las funciones (${CMP_ROWS.length})`}</button>
        <div className="mv2-cmp-links">
          <a className="mv2-btn solid" href={`/${cmpDir()}/`}>Ver la comparativa completa</a>
          {COMPARE.slice(0, 6).map(([slug, name]) => <a key={slug} className="chip" href={`/${cmpDir()}/musa-vs-${slug}/`}>Musa vs {name}</a>)}
        </div>
      </section>

      <section className="mv2-band">
        <div>
          <h2>Tu marca, tu equipo<br />y tus agentes. Juntos.</h2>
          <button type="button" className="mv2-btn big" onClick={() => go("signup")}>Crear cuenta</button>
        </div>
      </section>

      <footer className="mv2-foot">
        <div className="mv2-foot-brand">
          <div className="mv2-logo">MUSA<i>#</i><small>by Futuraria</small></div>
          <p>La plataforma de contenido de Futuraria: planea, crea, publica, conversa, pauta, vende y mide para todas tus marcas, con tu equipo y tus agentes de IA.</p>
        </div>
        <nav aria-label="Producto">
          <h4>Producto</h4>
          <ul>
            <li><a href="/?signup=1" onClick={(e) => { e.preventDefault(); go("signup"); }}>Crear cuenta</a></li>
            <li><a href="/?signin=1" onClick={(e) => { e.preventDefault(); go("signin"); }}>Entrar</a></li>
            <li><a href="/agents/">Para agentes de IA</a></li>
            <li><a href="/llms.txt">llms.txt</a></li>
          </ul>
        </nav>
        <nav aria-label="Comparativas" className="mv2-foot-cmp">
          <h4>Comparar</h4>
          <ul>
            <li><a href={`/${cmpDir()}/`}>Musa vs todos</a></li>
            {COMPARE.map(([slug, name]) => <li key={slug}><a href={`/${cmpDir()}/musa-vs-${slug}/`}>Musa vs {name}</a></li>)}
          </ul>
        </nav>
        <nav aria-label="Futuraria">
          <h4>Futuraria</h4>
          <ul>
            <li><a href="mailto:soporte@futuraria.com">soporte@futuraria.com</a></li>
            <li><a href="https://futuraria.com">futuraria.com</a></li>
          </ul>
        </nav>
        <p className="mv2-foot-legal">© 2026 Futuraria. Las marcas mencionadas pertenecen a sus respectivos dueños.</p>
      </footer>
    </div>
  );
}
