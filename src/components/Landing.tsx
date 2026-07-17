import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface LandingProps {
  onEnter: () => void;
}

export function Landing({ onEnter }: LandingProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
              Futuraria
            </motion.span>
          </motion.div>

          {/* Desktop nav links — hidden on mobile, inline on desktop */}
          <nav className="landing-nav-links">
            <button onClick={() => scrollToSection("harness")} className="landing-nav-link">What is a Harness?</button>
            <button onClick={() => scrollToSection("install")} className="landing-nav-link">Installation</button>
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
              Enter Workspace
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
                <span className="font-instrument" style={{ fontSize: 18, color: "rgba(255,255,255,0.8)" }}>Futuraria</span>
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
                <button onClick={() => { scrollToSection("harness"); setMenuOpen(false); }} className="landing-menu-link">What is a Harness?</button>
                <button onClick={() => { scrollToSection("install"); setMenuOpen(false); }} className="landing-menu-link">Installation</button>
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
              Design with <em style={{ fontWeight: 400, fontStyle: "italic" }}>intention</em>.
            </motion.h1>

            <motion.p
              className="landing-subtitle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7 }}
            >
              Your open-source design workspace.
              Create, iterate, and automate with AI-powered tools.
            </motion.p>

            <motion.button
              onClick={handleEnter}
              className="liquid-glass landing-cta"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? -10 : 0 }}
              transition={{ duration: 0.6, delay: 1 }}
              disabled={isExiting}
            >
              Start Creating
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
          <div className="landing-section-badge">What is a Design Harness?</div>
          <h2 className="landing-section-title font-instrument">
            Armor for your AI.
          </h2>
          <p className="landing-section-text">
            A <strong>Design Harness</strong> is not an AI model — it's the armor that wraps around <em>any</em> model
            and gives it precision design capabilities. Think of it like a knight: the AI is the warrior,
            and the Harness is the suit of armor — forged with layout systems, typography rules, color
            tokenization, frame management, and deterministic rendering.
          </p>
          <p className="landing-section-text">
            Without the Harness, an AI generates loose HTML. With it, <strong>every output is a structured,
            editable, persistent design document</strong> — frames, layers, CSS variables, brand tokens, export-ready assets.
            The Harness doesn't replace your AI; it <em>channels</em> it into designing like a professional.
          </p>
          <div className="landing-compat-grid">
            {[
              { name: "Claude Code", desc: "Anthropic's agentic coding tool" },
              { name: "Hermes", desc: "Open-source MCP gateway" },
              { name: "OpenClaw", desc: "Multi-agent design workspace" },
              { name: "Your IDE", desc: "Any MCP-compatible editor" },
            ].map(c => (
              <div key={c.name} className="liquid-glass" style={{ padding: "16px 20px", borderRadius: 14, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ INSTALLATION ═══════════════════════════════ */}
      <section id="install" className="landing-section landing-section--alt">
        <div className="landing-section-inner">
          <div className="landing-section-badge">Get Started</div>
          <h2 className="landing-section-title font-instrument">
            Install in one command.
          </h2>
          <p className="landing-section-text">
            Tell your AI to clone the repo, install dependencies, and configure Supabase.
            It handles the entire setup autonomously.
          </p>

          <div className="landing-steps">
            <div className="landing-step">
              <div className="landing-step-num">1</div>
              <div>
                <div className="landing-step-title">Tell your AI</div>
                <p className="landing-step-desc">Paste this prompt into Claude Code, Cursor, or any MCP-compatible agent:</p>
                <pre className="landing-code-block">{`Clone https://github.com/reno42/design, install
dependencies, set up Supabase, and launch the
dev server. Follow the README for configuration.`}</pre>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">2</div>
              <div>
                <div className="landing-step-title">Or do it manually</div>
                <p className="landing-step-desc">Run these commands in your terminal:</p>
                <pre className="landing-code-block">{`git clone https://github.com/reno42/design.git
cd design
npm install
cp .env.example .env
# Edit .env with your Supabase credentials
npm run dev`}</pre>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">3</div>
              <div>
                <div className="landing-step-title">Configure Supabase</div>
                <p className="landing-step-desc">
                  Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_KEY</code> in your <code>.env</code> file for data persistence.
                  Optionally, add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> for real-time collaboration.
                  <br /><br />
                  Run <code>node scripts/setup-supabase.mjs</code> to initialize your database schema using your Supabase Personal Access Token.
                  The harness connects automatically — your AI is now ready to design.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ FEATURES ═══════════════════════════════ */}
      <section id="features" className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-badge">Capabilities</div>
          <h2 className="landing-section-title font-instrument">
            Everything your AI needs to design.
          </h2>
          <div className="landing-features-grid">
            {[
              { icon: "🎨", title: "Frame-Based Canvas", desc: "Multi-frame HTML/CSS design surfaces with infinite zoom and pan — no Fabric.js, pure Shadow DOM rendering." },
              { icon: "🤖", title: "MCP-First Architecture", desc: "Every tool is an MCP endpoint. Any AI agent can create, edit, and export designs via JSON-RPC — the UI is secondary." },
              { icon: "🔄", title: "Bidirectional Sync", desc: "Edit visually or in code — the Shadow DOM and Code Panel stay in perfect sync. Drag elements or type CSS; both paths converge." },
              { icon: "🎯", title: "Brand System Engine", desc: "Extract design tokens, generate brand manuals, build style libraries with fingerprint deduplication across templates." },
              { icon: "📸", title: "Thumbnail Previews", desc: "Auto-capture or manually set preview images for every template — Cover Flow slider with zero-lag image rendering." },
              { icon: "📦", title: "Batch Generation", desc: "Generate dozens of designs from CSV data. Each row becomes a complete template with consistent branding and layout." },
              { icon: "✏️", title: "SVG Path Editing", desc: "Full vector toolchain: shape-to-path, outline stroke, offset path, pathfinder operations (union, subtract, intersect, exclude)." },
              { icon: "💾", title: "Supabase Persistence", desc: "All designs live in your own Supabase instance. Real-time collaboration, version history, workspace isolation — you own the data." },
              { icon: "🧩", title: "Design System Extraction", desc: "Feed any URL and the Harness extracts colors, typography, spacing, and components into a structured token system." },
            ].map(f => (
              <div key={f.title} className="liquid-glass landing-feature-card">
                <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ FOOTER ═══════════════════════════════ */}
      <footer className="landing-footer-section">
        <div className="landing-section-inner" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.4 }}>
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span className="font-instrument" style={{ fontSize: 16, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>Futuraria</span>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", maxWidth: 480, lineHeight: 1.7 }}>
            Open-source design harness. Compatible with any MCP-enabled AI agent.
            Built for designers and developers who want AI-assisted, deterministic design output.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer" className="liquid-glass landing-footer-btn" style={{ width: "auto", padding: "10px 20px", borderRadius: 100, textDecoration: "none", fontSize: 12 }}>GitHub</a>
            <button onClick={() => scrollToSection("features")} className="liquid-glass landing-footer-btn" style={{ width: "auto", padding: "10px 20px", borderRadius: 100, textDecoration: "none", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Docs</button>
            <a href="https://github.com/reno42/design" target="_blank" rel="noopener noreferrer" className="liquid-glass landing-footer-btn" style={{ width: "auto", padding: "10px 20px", borderRadius: 100, textDecoration: "none", fontSize: 12 }}>Open Source</a>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 8 }}>
            © {new Date().getFullYear()} Futuraria — MIT License
          </div>
        </div>
      </footer>

    </div>
  );
}
