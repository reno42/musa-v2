import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface LandingProps {
  onEnter: () => void;
}

export function Landing({ onEnter }: LandingProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // ── Exit animation: button stretch → brand appears → hero fades → navigate ──
  const handleEnter = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => onEnter(), 900);
  }, [isExiting, onEnter]);

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
        </motion.div>
      </nav>

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

      {/* ── Footer ── */}
      <AnimatePresence>
        {videoReady && (
          <motion.div
            className="landing-footer"
            initial={{ opacity: 0 }}
            animate={{ opacity: isExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {[
              { label: "GitHub", href: "https://github.com/reno42/design" },
              { label: "Docs", href: "#" },
              { label: "Open Source", href: "#" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="liquid-glass landing-footer-btn"
                style={{ width: "auto", padding: "12px 24px", borderRadius: 100, textDecoration: "none", fontSize: 13 }}
              >
                {label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
