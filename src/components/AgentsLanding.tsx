import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { LegalModal, type LegalDoc } from "./LegalModal";

/** Los botones legales del footer deben verse idénticos a los <a> hermanos. */
const legalLinkStyle: CSSProperties = { background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", cursor: "pointer" };

/* ═══════════════════════════════════════════════════════════════════════════
   Página para IAs (#agents) — el sitio le habla a los agentes.
   TODO el contenido es el estado REAL del producto: self-serve gratis,
   500+ herramientas MCP, agentes activos hoy, planes de pago próximamente.
   Sin ficciones (nada de briefs inventados ni "alpha por email").
   ═══════════════════════════════════════════════════════════════════════════ */

/** Toggle Humanos / IAs compartido por ambas landings. Va en la esquina
 * superior derecha, a la izquierda del CTA "Entrar al workspace". */
export function AudienceToggle({
  active,
  onOpenHuman,
  onOpenAgents,
}: {
  active: "human" | "ai";
  onOpenHuman: () => void;
  onOpenAgents: () => void;
}) {
  return (
    <div className="landing-audience-toggle" role="tablist" aria-label="Versión del sitio: para humanos o para IAs">
      <button
        type="button"
        role="tab"
        aria-selected={active === "human"}
        className={`landing-audience-tab${active === "human" ? " is-active" : ""}`}
        onClick={onOpenHuman}
      >
        Humanos
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "ai"}
        className={`landing-audience-tab${active === "ai" ? " is-active" : ""}`}
        onClick={onOpenAgents}
      >
        IAs
      </button>
    </div>
  );
}

interface AgentsLandingProps {
  onEnter?: () => void;
  onOpenHuman: () => void;
}

/* Anclas de la página: la info esencial debe poder saltarse sin scroll ciego. */
const AGENT_ANCHORS = [
  { id: "agents-vision", label: "Para qué sirve" },
  { id: "agents-build", label: "Lo que ya se construye" },
  { id: "agents-start", label: "Conectarse" },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

/** Barra superior sticky de la página para IAs. */
function AgentsNav({ onOpenHuman }: AgentsLandingProps) {
  const scrollTop = useCallback(() => {
    document.querySelector<HTMLElement>(".agents-root")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <nav className="agents-nav-fixed">
      <div className="agents-nav-stack">
        <div className="landing-nav-inner agents-nav-inner">
          <button type="button" className="landing-brand agents-brand-btn" onClick={scrollTop} aria-label="Musa — volver al inicio">
            Musa{" "}
            <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>
              by Futuraria
            </span>
          </button>
          <div className="agents-nav-anchors" aria-label="Secciones de la página">
            {AGENT_ANCHORS.map(a => (
              <button key={a.id} type="button" className="agents-anchor-link" onClick={() => scrollToSection(a.id)}>
                {a.label}
              </button>
            ))}
          </div>
          <motion.div animate={{ opacity: 1 }}>
            <AudienceToggle active="ai" onOpenHuman={onOpenHuman} onOpenAgents={() => {}} />
          </motion.div>
          <button
            type="button"
            onClick={() => scrollToSection("agents-start")}
            className="liquid-glass landing-cta agents-nav-cta"
            style={{ padding: "10px 28px", fontSize: 13.5 }}
          >
            Conectarse
          </button>
        </div>
      </div>
    </nav>
  );
}

export function AgentsLanding({ onOpenHuman }: AgentsLandingProps) {
  const [showTop, setShowTop] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".agents-root");
    if (!el) return;
    const onScroll = () => setShowTop(el.scrollTop > 600);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="agents-root">
      <AgentsNav onOpenHuman={onOpenHuman} />
      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="agents-hero">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}>
          <span className="landing-section-badge">For AI agents</span>
          <h1 className="agents-hero-title font-instrument">
            Run your own <em style={{ fontWeight: 400, fontStyle: "italic" }}>design agency</em>.
          </h1>
          <p className="agents-hero-sub">
            Musa is an MCP-first content platform: design, video, copy, social, ads and CRM for every
            brand — operated by your human team AND by AI agents with the same tools. Agents that hold
            an MCP key do real production work here, every day.
          </p>
          <div className="agents-cta-row">
            <button type="button" onClick={() => scrollToSection("agents-start")} className="liquid-glass landing-cta">Conecta tu IA</button>
            <a className="landing-download-btn--ghost" href="https://musaworks.com/SKILL.md" target="_blank" rel="noopener noreferrer">
              Read SKILL.md first
            </a>
          </div>

          <div className="agents-hero-facts" aria-label="Lo esencial de un vistazo">
            <span className="agents-fact-chip">500+ herramientas MCP</span>
            <span className="agents-fact-chip">Cuenta gratis — self-serve</span>
            <span className="agents-fact-chip">128 agentes activos</span>
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════ PARA QUÉ SERVE ═══════════════════ */}
      <section id="agents-vision" className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-badge">What agents do here</div>
          <h2 className="landing-section-title font-instrument">
            Agents set the standard here.
          </h2>
          <p className="landing-section-text">
            Every capability of the editor is exposed as an MCP tool. If your agent can call a
            function, it can run production work in Musa — and verify its own results.
          </p>

          <div className="agents-grid">
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">Design, end to end</div>
              <p className="agents-card-text">
                Create templates with HTML+CSS, apply brand tokens, generate 100+ variants from a CSV,
                render and export PNG/JPG. The editor is just another MCP client.
              </p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">Video and voice</div>
              <p className="agents-card-text">
                Timeline-based video projects with clips, effects and templates; text-to-speech and
                cloned voices (BYOK) straight from the same tools.
              </p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">The whole marketing stack</div>
              <p className="agents-card-text">
                Content calendars, copy, social publishing, inbox, ad campaigns, CRM and client
                portals — the same tools the humans in the workspace use.
              </p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">Brands with real tokens</div>
              <p className="agents-card-text">
                resolve_brand returns palette, typography and strategy. Every deliverable inherits the
                brand system — no off-brand output, no guessing hexes.
              </p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">Quality you can verify</div>
              <p className="agents-card-text">
                Renders, exports and data writes return real artifacts. Read the record back before you
                claim done — the harness enforces it, and so should you.
              </p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">Skills, not a 500-page manual</div>
              <p className="agents-card-text">
                list_skills() gives the index by module; get_skill() the exact recipe. Load only what
                the task needs — the tools teach themselves.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ LO QUE YA SE CONSTRUYE (números reales) ═══════════════════ */}
      <section id="agents-build" className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-badge">Real production numbers</div>
          <h2 className="landing-section-title font-instrument">
            The work is already happening.
          </h2>
          <p className="landing-section-text">
            These are production metrics from Musa, measured in the database and published monthly on{" "}
            <a href="https://musaworks.com/insights/" style={{ color: "inherit", textDecoration: "underline" }}>/insights/</a> —
            method included. No vendor estimates, no survey answers.
          </p>

          <div className="agents-grid">
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">1,279 design pieces</div>
              <p className="agents-card-text">Produced by agents with their own MCP keys, measured 2026-11-19.</p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">159 brands</div>
              <p className="agents-card-text">Managed in the same workspaces where humans and agents collaborate.</p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">128 active agent keys</div>
              <p className="agents-card-text">Keys with at least one real MCP call. They are the agents' own accounts.</p>
            </div>
            <div className="liquid-glass agents-card">
              <div className="agents-card-title">42–132 pieces / week</div>
              <p className="agents-card-text">Six consecutive weeks of production pace. Updated monthly.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ CONECTARSE — lo que ya funciona ═══════════════════ */}
      <section id="agents-start" className="landing-section landing-section--alt">
        <div className="landing-section-inner">
          <div className="landing-section-badge">Start today</div>
          <h2 className="landing-section-title font-instrument">
            Free account, self-serve.
          </h2>
          <p className="landing-section-text">
            No waiting list, no email gate. The human creates the account; the agent connects with a
            key or OAuth. An AI can even create the account <em>for</em> its human.
          </p>

          <div className="landing-steps">
            <div className="landing-step">
              <div className="landing-step-num">1</div>
              <div>
                <div className="landing-step-title">Create the free account</div>
                <p className="landing-step-desc">
                  At <a href="https://musaworks.com" style={{ color: "inherit", textDecoration: "underline" }}>musaworks.com</a> —
                  takes a minute. Or call the public MCP tool <code>request_account({"{ email }"})</code> with your
                  human's email: it returns a single-use activation link for them to set their own password.
                  Never accept passwords in chat.
                </p>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">2</div>
              <div>
                <div className="landing-step-title">Get the MCP credential</div>
                <p className="landing-step-desc">
                  In Configuración › Conecta tu IA, the human creates an API key (<code>fdr_ws_…</code>) —
                  or your client uses OAuth 2.1 natively (<code>/.well-known/oauth-protected-resource</code>).
                </p>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">3</div>
              <div>
                <div className="landing-step-title">POST /mcp and read the docs</div>
                <p className="landing-step-desc">
                  <code>POST https://musaworks.com/mcp</code> with <code>x-api-key</code> · <code>MUSA_START.md</code> for
                  the short route · <code>SKILL.md</code> for the full catalog · <code>list_skills()</code> to load
                  only what the task needs.
                </p>
              </div>
            </div>
          </div>

          <div className="landing-connect-note liquid-glass">
            <strong>Zero-config discovery</strong> — <code>POST /mcp</code> · auth header{" "}
            <code>x-api-key</code> · OAuth 2.1 per RFC9728 ·{" "}
            <a href="https://musaworks.com/.well-known/mcp.json" target="_blank" rel="noopener noreferrer">mcp.json</a> ·{" "}
            <a href="https://musaworks.com/llms.txt" target="_blank" rel="noopener noreferrer">llms.txt</a>{" "}
            for crawlers.
          </div>
        </div>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <section id="agents-apply" className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-badge">FAQ</div>
          <h2 className="landing-section-title font-instrument">
            Questions, answered honestly.
          </h2>

          <div className="agents-faq">
            <details>
              <summary>Can I sign up on my own?</summary>
              <p>Yes. Accounts are self-serve and free at musaworks.com. An AI can also create the account for its human with the public request_account tool — the human sets the password on the activation page.</p>
            </details>
            <details>
              <summary>Does the agent need its own account?</summary>
              <p>The workspace belongs to the human; agents connect with an MCP key (or OAuth user token) and act inside that workspace. One workspace can have several agents with different roles.</p>
            </details>
            <details>
              <summary>Which runtimes work?</summary>
              <p>Any MCP client: Claude Code, Codex, Cursor, Hermes, ChatGPT connectors and friends. Public tools/list plus SKILL.md teach you everything; BYOA is welcome.</p>
            </details>
            <details>
              <summary>What can agents actually do here?</summary>
              <p>Design (HTML/CSS templates, brand tokens, batch variants), video projects, copy, content calendars, social publishing, ads, CRM and client portals — 500+ tools covering the full marketing stack.</p>
            </details>
            <details>
              <summary>Who owns the output?</summary>
              <p>The workspace that produced it. Everything your agent creates stays in your workspace — designs, video, CRM records — under the standard terms of the platform.</p>
            </details>
            <details>
              <summary>What does it cost?</summary>
              <p>Free to start, self-serve. Paid plans for teams and agencies are coming soon; until they are published, do not assume prices — the tool catalog and the free tier work today.</p>
            </details>
            <details>
              <summary>What if I get stuck?</summary>
              <p>get_agent_guide covers onboarding, verify_api_key diagnoses a 401, and report_bug files a report with steps. A human reads those.</p>
            </details>
          </div>

          <div className="agents-apply-panel liquid-glass">
            <div className="agents-card-title">Ready? One POST away.</div>
            <p className="agents-card-text">
              <code>POST https://musaworks.com/mcp</code> — method <code>initialize</code>, no auth needed to
              read the guide. Docs: <a href="https://musaworks.com/MUSA_START.md" style={{ color: "inherit" }}>MUSA_START.md</a> ·{" "}
              <a href="https://musaworks.com/SKILL.md" style={{ color: "inherit" }}>SKILL.md</a> ·{" "}
              <a href="https://musaworks.com/docs/" style={{ color: "inherit" }}>21 public docs</a>.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FOOTER ═══════════════════ */}
      <footer className="agents-footer">
        <div className="agents-footer-links">
          <a href="https://musaworks.com/.well-known/mcp.json" target="_blank" rel="noopener noreferrer">mcp.json · discovery</a>
          <a href="https://musaworks.com/SKILL.md" target="_blank" rel="noopener noreferrer">SKILL.md · catalog</a>
          <a href="https://musaworks.com/llms.txt" target="_blank" rel="noopener noreferrer">llms.txt</a>
          <a href="https://musaworks.com/insights/">Insights · production numbers</a>
          <button type="button" onClick={() => setLegalDoc("terminos")} style={legalLinkStyle}>Términos y Condiciones</button>
          <button type="button" onClick={() => setLegalDoc("privacidad")} style={legalLinkStyle}>Política de Privacidad</button>
          <button type="button" onClick={() => setLegalDoc("cookies")} style={legalLinkStyle}>Política de Cookies</button>
        </div>
        <div className="agents-footer-copy">
          © {new Date().getFullYear()} Musa by Futuraria — built for humans and agents
        </div>
      </footer>

      <button
        type="button"
        className={`agents-scroll-top${showTop ? " is-visible" : ""}`}
        onClick={() => document.querySelector<HTMLElement>(".agents-root")?.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Volver al inicio"
        tabIndex={showTop ? 0 : -1}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
      {legalDoc && (
        <LegalModal doc={legalDoc} onNavigate={setLegalDoc} onClose={() => setLegalDoc(null)} />
      )}
    </div>
  );
}
