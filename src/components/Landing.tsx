import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LANDING_FEATURES } from "./landing/FeatureDemos";

interface LandingProps {
  onEnter: () => void;
}

/** Prompt que el usuario le pega a su IA (Claude, Codex, Hermes, Kimi…) para
 *  que ella misma lea el discovery de Musa y le diga cómo entrar. */
const CONNECT_PROMPT = `Andá a https://design.futuraria.com y leé /.well-known/mcp.json
y /SKILL.md. Decime cómo entrás a manejar el 100% del editor:
yo creo la cuenta, te genero la llave MCP y vos empezás a diseñar.`;

export function Landing({ onEnter }: LandingProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Exit animation: button stretch → brand appears → hero fades → navigate ──
  const handleEnter = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => onEnter(), 900);
  }, [isExiting, onEnter]);

  // ── Scroll to a section by id (no hash pollution) ──
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  // ── Copy the "connect your AI" prompt (clipboard + execCommand fallback) ──
  const handleCopyPrompt = useCallback(() => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(CONNECT_PROMPT).then(done).catch(() => {});
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = CONNECT_PROMPT;
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
  }, []);

  // ── Video fade-in/fade-out loop ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number;

    const fade = (
      start: number,
      end: number,
      duration: number,
      callback?: () => void
    ) => {
      const startTime = performance.now();
      const animate = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        video.style.opacity = String(start + (end - start) * progress);
        if (progress < 1) {
          animFrameId = requestAnimationFrame(animate);
        } else if (callback) {
          callback();
        }
      };
      animFrameId = requestAnimationFrame(animate);
    };

    const handleCanPlay = () => {
      setVideoReady(true);
      video.play().catch(() => {});
      fade(0, 1, 500);
    };

    const handleTimeUpdate = () => {
      const remaining = video.duration - video.currentTime;
      if (remaining <= 0.55 && video.style.opacity !== "0" && !(video as any).dataset.fadingOut) {
        (video as any).dataset.fadingOut = "true";
        fade(parseFloat(video.style.opacity) || 1, 0, 500);
      }
    };

    const handleEnded = () => {
      video.style.opacity = "0";
      delete (video as any).dataset.fadingOut;
      setTimeout(() => {
        video.currentTime = 0;
        video.play().catch(() => {});
        fade(0, 1, 500);
      }, 100);
    };

    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
      cancelAnimationFrame(animFrameId);
    };
  }, []);

  return (
    <div className="landing-root">
      {/* ═══════════════════════════════════════════ HERO ═══════════════════════════════════════════ */}
      <section className="landing-hero-section">
      {/* ── Background video ── */}
      <video
        ref={videoRef}
        src="/animated-bg.mp4"
        muted
        autoPlay
        playsInline
        preload="auto"
        className="landing-video"
        style={{ opacity: 0 }}
      />

      {/* ── Overlay — darkens on exit for transition ── */}
      <motion.div
        animate={{
          background: isExiting
            ? "radial-gradient(ellipse at center, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.85) 100%)"
            : "radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.65) 100%)",
        }}
        transition={{ duration: 0.5 }}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />

      {/* ── Navbar with exit morph ── */}
      <nav className={`landing-nav${isExiting ? " landing-nav--exiting" : ""}`}>
        <motion.div layout className="landing-nav-inner">
          {/* Brand — fades in during exit as the bar expands */}
          <motion.div
            className="landing-brand"
            animate={{
              opacity: isExiting ? 1 : 1,
              scale: isExiting ? 1.05 : 1,
            }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <motion.span
              animate={{ opacity: isExiting ? 1 : 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              Musa <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>by Futuraria</span>
            </motion.span>
          </motion.div>

          {/* Desktop nav links — hidden on mobile, inline on desktop */}
          <nav className="landing-nav-links">
            <button onClick={() => scrollToSection("harness")} className="landing-nav-link">Harness</button>
            <button onClick={() => scrollToSection("connect")} className="landing-nav-link">Conecta tu IA</button>
            <button onClick={() => scrollToSection("features")} className="landing-nav-link">Features</button>
            <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)", borderRadius: 1 }} />
            <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer" className="landing-nav-link">GitHub</a>
            <button onClick={() => scrollToSection("features")} className="landing-nav-link">Docs</button>
          </nav>

          {/* Tab buttons — fade in on exit with stagger, matching dashboard */}
          <AnimatePresence>
            {isExiting && (
              <motion.div
                style={{ display: "flex", gap: 8, justifyContent: "center", flex: 1 }}
                initial="hidden"
                animate="visible"
              >
                {[
                  { label: "Templates", delay: 0.15 },
                  { label: "Key Visuals", delay: 0.25 },
                  { label: "Data", delay: 0.35 },
                ].map(tab => (
                  <motion.button
                    key={tab.label}
                    className="liquid-glass"
                    variants={{
                      hidden: { opacity: 0, y: 8, scale: 0.95 },
                      visible: { opacity: 1, y: 0, scale: 1 },
                    }}
                    transition={{ duration: 0.35, delay: tab.delay, ease: [0.25, 0.1, 0.25, 1] }}
                    style={{
                      borderRadius: 100, padding: "8px 18px", fontSize: 13,
                      fontWeight: 500, color: "rgba(255,255,255,0.6)",
                      cursor: "default", background: "transparent",
                      border: "none",
                    }}
                  >
                    {tab.label}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* CTA button — stretches, shows nav placeholder, then fades */}
          <motion.button
            layout
            onClick={handleEnter}
            className="liquid-glass landing-cta"
            animate={{
              borderRadius: isExiting ? 14 : 100,
              padding: isExiting ? "8px 20px" : "10px 28px",
              width: isExiting ? "100%" : undefined,
              maxWidth: isExiting ? 600 : undefined,
              justifyContent: isExiting ? "flex-start" : "center",
              opacity: isExiting ? 0 : 1,
            }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ display: "flex", alignItems: "center", cursor: isExiting ? "default" : "pointer" }}
            disabled={isExiting}
          >
            <motion.span
              animate={{ opacity: isExiting ? 0 : 1 }}
              transition={{ duration: 0.2 }}
            >
              Entrar al workspace
            </motion.span>

            {/* Nav placeholder text — appears after button stretches */}
            {isExiting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.35 }}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  marginLeft: "auto",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                <span>Templates</span>
                <span>Key Visuals</span>
                <span>Data</span>
              </motion.div>
            )}
          </motion.button>

          {/* Search bar — fades in where the CTA button was */}
          <AnimatePresence>
            {isExiting && (
              <motion.input
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, delay: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="liquid-glass"
                placeholder="Search…"
                readOnly
                style={{
                  borderRadius: 100, padding: "8px 20px", fontSize: 13,
                  color: "#ffffff", outline: "none",
                  width: 180, flexShrink: 0,
                  background: "rgba(255,255,255,0.01)",
                  border: "none",
                }}
              />
            )}
          </AnimatePresence>

          {/* Hamburger — visible on tablet/mobile, hidden on desktop ≥1024 */}
          <button
            className="landing-hamburger"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </motion.div>
      </nav>

      {/* ── Slide-out menu (mobile/tablet) ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="landing-menu-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMenuOpen(false)}
          >
            <motion.div
              className="landing-menu-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 26, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="landing-menu-header">
                <span className="font-instrument" style={{ fontSize: 18, color: "rgba(255,255,255,0.8)" }}>Musa <span style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.55 }}>by Futuraria</span></span>
                <button
                  className="landing-menu-close"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <nav className="landing-menu-nav">
                <button onClick={() => { scrollToSection("harness"); setMenuOpen(false); }} className="landing-menu-link">Harness</button>
                <button onClick={() => { scrollToSection("connect"); setMenuOpen(false); }} className="landing-menu-link">Conecta tu IA</button>
                <button onClick={() => { scrollToSection("features"); setMenuOpen(false); }} className="landing-menu-link">Features</button>
                <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer" className="landing-menu-link">GitHub</a>
                <button onClick={() => { scrollToSection("features"); setMenuOpen(false); }} className="landing-menu-link">Docs</button>
              </nav>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hero content ── */}
      <AnimatePresence>
        {videoReady && (
          <motion.div
            className="landing-hero"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? -20 : 0 }}
            transition={{ duration: isExiting ? 0.4 : 1.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <motion.h1
              className="landing-title font-instrument"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.3 }}
            >
              Diseñá con <em style={{ fontWeight: 400, fontStyle: "italic" }}>intención</em>.
            </motion.h1>

            <motion.p
              className="landing-subtitle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7 }}
            >
              Tu workspace de diseño MCP-first: vos y tu IA crean,
              iteran y automatizan con las mismas herramientas.
            </motion.p>

            <motion.button
              onClick={handleEnter}
              className="liquid-glass landing-cta"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? -10 : 0 }}
              transition={{ duration: 0.6, delay: 1 }}
              disabled={isExiting}
            >
              Empezar a crear
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hero footer links (visible on desktop) ── */}
      <div className="landing-hero-footer">
        <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer" className="landing-hero-footer-link">GitHub</a>
        <button onClick={() => scrollToSection("features")} className="landing-hero-footer-link">Docs</button>
        <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer" className="landing-hero-footer-link">Open Source</a>
      </div>

      {/* ── Scroll-down indicator ── */}
      <div className="landing-scroll-hint">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      </section>

      {/* ═══════════════════════════════ DESIGN HARNESS ═══════════════════════════════ */}
      <section id="harness" className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-badge">¿Qué es un Design Harness?</div>
          <h2 className="landing-section-title font-instrument">
            Armadura para tu IA.
          </h2>
          <p className="landing-section-text">
            Un <strong>Design Harness</strong> no es un modelo de IA: es la armadura que envuelve a <em>cualquier</em>{" "}
            modelo y le da capacidades de diseño de precisión. Pensalo como un caballero: la IA es el guerrero
            y el Harness es la armadura — forjada con sistemas de layout, reglas de tipografía, tokenización
            de color, gestión de frames y render determinístico.
          </p>
          <p className="landing-section-text">
            Sin el Harness, una IA genera HTML suelto. Con él, <strong>cada salida es un documento de diseño
            estructurado, editable y persistente</strong> — frames, capas, variables CSS, tokens de marca y assets
            listos para exportar. El Harness no reemplaza a tu IA: la <em>canaliza</em> para que diseñe como un profesional.
          </p>
          <div className="landing-compat-grid">
            {[
              { name: "Claude Code", desc: "La herramienta agéntica de Anthropic" },
              { name: "Hermes", desc: "Gateway MCP open source" },
              { name: "OpenClaw", desc: "Workspace multi-agente" },
              { name: "Tu IDE", desc: "Cualquier editor compatible con MCP" },
            ].map(c => (
              <div key={c.name} className="liquid-glass" style={{ padding: "16px 20px", borderRadius: 14, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ CONECTA TU IA ═══════════════════════════════ */}
      <section id="connect" className="landing-section landing-section--alt">
        <div className="landing-section-inner">
          <div className="landing-section-badge">Get Started</div>
          <h2 className="landing-section-title font-instrument">
            Tu IA lee Musa y entra sola.
          </h2>
          <p className="landing-section-text">
            No tenés que instalar nada. Mandale este prompt a tu IA — Claude, Codex, Hermes, OpenClaw,
            Kimi, la que uses — y <strong>ella lee la documentación de la plataforma y te dice exactamente qué
            hacer</strong>: creás tu cuenta, generás tu llave MCP, se la pasás, y queda manejando el 100% del editor.
          </p>

          <div className="landing-steps">
            <div className="landing-step">
              <div className="landing-step-num">1</div>
              <div>
                <div className="landing-step-title">Pegale este prompt a tu IA</div>
                <p className="landing-step-desc">Tu IA abre el discovery de Musa y te explica cómo entrar:</p>
                <pre className="landing-code-block landing-copy-wrap">{CONNECT_PROMPT}<button type="button" onClick={handleCopyPrompt} className="landing-copy-btn">{copied ? "✓ Copiado" : "Copiar"}</button></pre>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">2</div>
              <div>
                <div className="landing-step-title">Creá tu cuenta y tu llave</div>
                <p className="landing-step-desc">
                  Entrá al workspace, andá a <strong>Configuración → API Keys</strong> y generá una llave MCP
                  (<code>fdr_ws_…</code>). Una por IA y por persona del equipo: todos diseñan a la vez,
                  cada uno con su propia IA.
                </p>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">3</div>
              <div>
                <div className="landing-step-title">Tu IA maneja el 100%</div>
                <p className="landing-step-desc">
                  Con la llave, tu IA crea archivos, diseña, edita código, exporta, arma tarjetas en el
                  Kanban y te deja todo en tu columna de review. Como cuando le mandás a tu IA a revisar
                  un sitio y se empieza a crear todo — pero acá diseña de verdad.
                </p>
              </div>
            </div>
          </div>

          <div className="landing-connect-note liquid-glass">
            <strong>Lo que tu IA descubre sola</strong> en <code>/.well-known/mcp.json</code>: endpoint{" "}
            <code>POST /mcp</code> · auth por header <code>x-api-key</code> · <strong>148+ tools</strong> de
            diseño (frames, tokens, export, Kanban, brand graph) · <code>tools/list</code> público ·
            guías <code>get_agent_guide</code> y <code>get_playbook</code> listas para leer.
          </div>

          <p className="landing-selfhost">
            ¿Preferís tu propia infra? Musa sigue siendo open source: cloná el repo y conectá tu
            Supabase desde{" "}
            <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer">GitHub</a>.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════ FEATURES ═══════════════════════════════ */}
      <section id="features" className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-badge">Features</div>
          <h2 className="landing-section-title font-instrument">
            Todo lo que vos y tu IA pueden hacer.
          </h2>
          <p className="landing-section-text">
            Mini-UIs en loop: el cursor se mueve, aprieta el botón y la acción pasa. Y cada feature
            también es una herramienta MCP — la UI y tu IA hacen exactamente lo mismo.
          </p>
          <div className="landing-demo-grid">
            {LANDING_FEATURES.map(f => (
              <div key={f.id} className="liquid-glass landing-feature-card2">
                <f.Demo />
                <div className="landing-feature-title"><span>{f.icon}</span>{f.title}</div>
                <div className="landing-feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ FOOTER ═══════════════════════════════ */}
      <footer className="landing-footer-section">
        <div className="landing-section-inner" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
          <div className="landing-footer-grid">
            <div>
              <div className="landing-footer-brand font-instrument">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.45, alignSelf: "center" }}>
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                Musa <span className="landing-footer-by">by Futuraria</span>
              </div>
              <p className="landing-footer-tag">
                Tu workspace de diseño MCP-first. Vos diseñás, tu IA diseña, o los dos a la vez —
                con las mismas 148+ herramientas, y tu data solo en tu cuenta.
              </p>
            </div>
            <div className="landing-footer-col">
              <h5>Producto</h5>
              <button onClick={() => scrollToSection("features")}>Features</button>
              <button onClick={() => scrollToSection("harness")}>¿Qué es el Harness?</button>
              <button onClick={() => scrollToSection("connect")}>Conecta tu IA</button>
              <button onClick={handleEnter} style={{ color: "rgba(167,139,250,0.85)" }}>Entrar al workspace</button>
            </div>
            <div className="landing-footer-col">
              <h5>Para tu IA</h5>
              <a href="https://design.futuraria.com/.well-known/mcp.json" target="_blank" rel="noopener noreferrer">mcp.json · discovery</a>
              <a href="https://design.futuraria.com/SKILL.md" target="_blank" rel="noopener noreferrer">SKILL.md · catálogo</a>
              <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer">GitHub · open source</a>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", width: "100%", textAlign: "center" }}>
            © {new Date().getFullYear()} Musa by Futuraria — MIT License
          </div>
        </div>
      </footer>

    </div>
  );
}
