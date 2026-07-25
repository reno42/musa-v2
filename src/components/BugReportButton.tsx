import { useState, useRef, useCallback, useEffect } from "react";
import html2canvas from "html2canvas";
import { getConsoleErrors, clearConsoleErrors } from "../lib/consoleCapture";
import { getApiHeaders } from "../lib/apiKey";

type View = "idle" | "menu" | "report" | "annotating";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff", "#000000"];
const API = "/api/bug-reports";

function getDeviceInfo() {
  const ua = navigator.userAgent;
  return {
    userAgent: ua,
    platform: navigator.platform || "",
    language: navigator.language,
    screenSize: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function BugReportButton() {
  const [view, setView] = useState<View>("idle");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Annotation state
  const [annotating, setAnnotating] = useState(false);
  const [annotateImage, setAnnotateImage] = useState<string | null>(null);
  const [penColor, setPenColor] = useState("#ef4444");
  const [penSize] = useState(3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const annotationCtx = useRef<CanvasRenderingContext2D | null>(null);

  // ── Screenshot capture ──
  const startAnnotation = useCallback(async () => {
    setAnnotating(true);
    try {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        // Exclude the bug report widget itself from the screenshot
        ignoreElements: (el) => el.id === "bug-report-root",
      });
      setAnnotateImage(canvas.toDataURL("image/png"));
    } catch {
      setAnnotating(false);
      setError("No se pudo capturar la pantalla. Describe el problema manualmente.");
    }
  }, []);

  // ── Canvas drawing ──
  useEffect(() => {
    if (!annotateImage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      annotationCtx.current = ctx;
    };
    img.src = annotateImage;
  }, [annotateImage]);

  const getCanvasPoint = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX: number, clientY: number;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getCanvasPoint(e);
  }, [getCanvasPoint]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current || !lastPos.current || !annotationCtx.current) return;
    const ctx = annotationCtx.current;
    const pos = getCanvasPoint(e);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }, [getCanvasPoint, penColor, penSize]);

  const stopDraw = useCallback(() => {
    isDrawing.current = false;
    lastPos.current = null;
  }, []);

  const clearDrawing = useCallback(() => {
    if (!canvasRef.current || !annotationCtx.current) return;
    const canvas = canvasRef.current;
    const ctx = annotationCtx.current;
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0); };
    img.src = annotateImage!;
  }, [annotateImage]);

  const finishAnnotation = useCallback(() => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    setScreenshot(dataUrl);
    setAnnotateImage(null);
    setAnnotating(false);
  }, []);

  const cancelAnnotation = useCallback(() => {
    setAnnotateImage(null);
    setAnnotating(false);
  }, []);

  // ── Submit ──
  const submitReport = useCallback(async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        description: description.trim(),
        url: window.location.href,
        deviceInfo: getDeviceInfo(),
        consoleErrors: getConsoleErrors(),
      };
      if (screenshot) body.screenshot = screenshot;

      const res = await fetch(API, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Error al enviar");
      clearConsoleErrors();
      setSuccess(true);
      setTimeout(() => {
        setView("idle");
        setDescription("");
        setScreenshot(null);
        setSuccess(false);
      }, 2500);
    } catch (e: any) {
      setError(e.message || "Error de conexión");
    }
    setLoading(false);
  }, [description, screenshot]);

  // ── Close on Escape ──
  useEffect(() => {
    if (view === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (annotating) { cancelAnnotation(); return; }
        setView("idle");
        setDescription("");
        setScreenshot(null);
        setError("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, annotating, cancelAnnotation]);

  const S = styles;

  return (
    <>
      {/* ── Floating Button ── */}
      <div id="bug-report-root" style={S.floatRoot}>
        {view === "idle" && (
          <button
            type="button"
            style={S.fab}
            onClick={() => setView("menu")}
            title="Reportar problema o consultar documentación"
            aria-label="Ayuda y reportes"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
        )}

        {/* ── Menu ── */}
        {view === "menu" && (
          <div style={S.menu}>
            <button type="button" style={S.menuItem}
              onClick={() => { setView("report"); setSuccess(false); setError(""); }}>
              <span style={S.menuIcon}>🐞</span>
              <span>Reportar problema</span>
            </button>
            <button type="button" style={S.menuItem}
              onClick={() => window.open("/SKILL.md", "_blank")}>
              <span style={S.menuIcon}>📖</span>
              <span>Documentación</span>
            </button>
            <button type="button" style={{ ...S.menuItem, borderTop: "1px solid rgba(255,255,255,0.08)" }}
              onClick={() => setView("idle")}>
              <span style={S.menuIcon}>✕</span>
              <span>Cerrar</span>
            </button>
          </div>
        )}

        {/* ── Report Modal ── */}
        {view === "report" && (
          <div style={S.backdrop} onClick={() => { setView("idle"); setDescription(""); setScreenshot(null); }}>
            <div style={S.modal} onClick={(e) => e.stopPropagation()}>
              {success ? (
                <div style={S.successBox}>
                  <span style={{ fontSize: 32 }}>✅</span>
                  <p style={{ margin: "12px 0 0", fontWeight: 600 }}>¡Gracias! Reporte enviado.</p>
                  <p style={{ margin: 4, fontSize: 13, opacity: 0.7 }}>Revisaremos tu reporte pronto.</p>
                </div>
              ) : (
                <>
                  <h3 style={S.title}>Reportar un problema</h3>
                  <p style={S.hint}>
                    Cuéntanos qué ocurrió. Incluye los pasos para replicar el error.
                    Si puedes, adjunta una captura de pantalla señalando el problema.
                  </p>

                  <textarea
                    style={S.textarea}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe el problema paso a paso…"
                    maxLength={5000}
                    rows={5}
                  />

                  {screenshot ? (
                    <div style={S.screenshotPreview}>
                      <img src={screenshot} alt="Screenshot preview" style={{ maxWidth: "100%", borderRadius: 6 }} />
                      <button type="button" style={S.linkBtn} onClick={() => setScreenshot(null)}>
                        Quitar imagen
                      </button>
                    </div>
                  ) : (
                    <button type="button" style={S.screenshotBtn} onClick={startAnnotation} disabled={annotating}>
                      {annotating ? "Capturando…" : "📸 Incluir captura de pantalla"}
                    </button>
                  )}

                  {error && <p style={S.errorMsg}>{error}</p>}

                  <div style={S.actions}>
                    <button type="button" style={S.cancelBtn}
                      onClick={() => { setView("idle"); setDescription(""); setScreenshot(null); }}>
                      Cancelar
                    </button>
                    <button type="button" style={S.submitBtn}
                      onClick={submitReport} disabled={loading || !description.trim()}>
                      {loading ? "Enviando…" : "Enviar reporte"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Annotation Overlay ── */}
        {annotateImage && (
          <div style={S.annotateOverlay}>
            {/* Toolbar */}
            <div style={S.annotateToolbar}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginRight: 16 }}>
                🖊️ Dibuja sobre la imagen para señalar el problema
              </span>
              {COLORS.map((c) => (
                <button key={c} type="button"
                  style={{
                    ...S.colorSwatch,
                    background: c,
                    border: penColor === c ? "2px solid #fff" : "2px solid rgba(255,255,255,0.3)",
                    boxShadow: penColor === c ? "0 0 8px rgba(255,255,255,0.5)" : "none",
                  }}
                  onClick={() => setPenColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
              <button type="button" style={S.toolbarBtn} onClick={clearDrawing}>🗑️ Limpiar</button>
              <button type="button" style={{ ...S.toolbarBtn, background: "#22c55e" }} onClick={finishAnnotation}>
                ✅ Listo
              </button>
              <button type="button" style={S.toolbarBtn} onClick={cancelAnnotation}>✕ Cancelar</button>
            </div>

            {/* Canvas */}
            <canvas
              ref={canvasRef}
              style={S.annotateCanvas}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
          </div>
        )}
      </div>
    </>
  );
}

// ── Styles ──
const styles: Record<string, React.CSSProperties> = {
  floatRoot: {
    position: "fixed",
    bottom: 24,
    right: 24,
    zIndex: 9990,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "rgba(30, 30, 50, 0.92)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#a78bfa",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  },
  menu: {
    position: "absolute",
    bottom: 56,
    right: 0,
    background: "rgba(24, 24, 40, 0.96)",
    backdropFilter: "blur(16px)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
    overflow: "hidden",
    width: 220,
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 16px",
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontFamily: "Inter, system-ui, sans-serif",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.1s",
  },
  menuIcon: {
    fontSize: 16,
    flexShrink: 0,
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9991,
  },
  modal: {
    background: "rgba(24, 24, 40, 0.98)",
    backdropFilter: "blur(20px)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 16px 64px rgba(0,0,0,0.7)",
    padding: 28,
    width: 480,
    maxWidth: "calc(100vw - 40px)",
    maxHeight: "calc(100vh - 80px)",
    overflowY: "auto" as const,
  },
  title: {
    margin: "0 0 8px",
    fontSize: 18,
    fontWeight: 700,
    color: "#fff",
  },
  hint: {
    margin: "0 0 16px",
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 1.5,
  },
  textarea: {
    width: "100%",
    padding: "12px 14px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter, system-ui, sans-serif",
    resize: "vertical" as const,
    boxSizing: "border-box" as const,
    outline: "none",
    transition: "border-color 0.2s",
  },
  screenshotBtn: {
    display: "block",
    width: "100%",
    marginTop: 12,
    padding: "10px",
    background: "rgba(59,130,246,0.15)",
    border: "1px dashed rgba(59,130,246,0.4)",
    borderRadius: 10,
    color: "#93c5fd",
    fontSize: 13,
    fontFamily: "Inter, system-ui, sans-serif",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  screenshotPreview: {
    marginTop: 12,
    textAlign: "center" as const,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#f87171",
    fontSize: 12,
    cursor: "pointer",
    marginTop: 8,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  actions: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 20,
  },
  cancelBtn: {
    padding: "8px 20px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: "Inter, system-ui, sans-serif",
    cursor: "pointer",
  },
  submitBtn: {
    padding: "8px 24px",
    background: "#7c3aed",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "Inter, system-ui, sans-serif",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  errorMsg: {
    color: "#f87171",
    fontSize: 13,
    marginTop: 12,
    textAlign: "center" as const,
  },
  successBox: {
    textAlign: "center" as const,
    color: "#fff",
    padding: 20,
  },
  // Annotation styles
  annotateOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.85)",
    zIndex: 9995,
    display: "flex",
    flexDirection: "column" as const,
  },
  annotateToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    background: "rgba(0,0,0,0.7)",
    backdropFilter: "blur(8px)",
    flexWrap: "wrap" as const,
    flexShrink: 0,
  },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    cursor: "pointer",
    padding: 0,
    transition: "transform 0.1s",
  },
  toolbarBtn: {
    padding: "6px 14px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 8,
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter, system-ui, sans-serif",
    cursor: "pointer",
  },
  annotateCanvas: {
    flex: 1,
    width: "100%",
    objectFit: "contain" as const,
    cursor: "crosshair",
  },
};
