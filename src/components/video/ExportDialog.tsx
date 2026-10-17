/**
 * ExportDialog — G17: MP4 H.264 export with a real export dialog. Format
 * (MP4/WebM/GIF), resolution, FPS, rango, honest pre-flight codec verdict
 * (probeExportSupport over the EXACT combo), size estimate and a
 * re-downloadable result. The browser is the render engine — nothing uploads.
 */
import { estimateExportBytes, type ExportSupport } from "../../lib/videoExport";

export interface ExportSettings {
  format: "mp4" | "webm" | "gif";
  /** Output scale over the project canvas: 0.5 | 1 | 2. */
  scale: number;
  fps: number;
  /** null = todo el reel; otherwise the [start, end] window in seconds. */
  rangeStart: number | null;
  rangeEnd: number | null;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: "mp4", scale: 1, fps: 30, rangeStart: null, rangeEnd: null,
};

export interface ExportDialogProps {
  project: { width: number; height: number };
  /** Full reel length in seconds (rango clamps against it). */
  durationSec: number;
  /** Timeline fps — offered as an FPS option alongside the standards. */
  defaultFps: number;
  hasAudio: boolean;
  settings: ExportSettings;
  onSettingsChange: (s: ExportSettings) => void;
  /** Probe for the CURRENT combo (null = still probing). */
  support: ExportSupport | null;
  exporting: boolean;
  progress: number;
  lastExport: { filename: string; size: number; durationSec: number; method: string } | null;
  onDownloadLast: () => void;
  onRender: () => void;
  onClose: () => void;
}

const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "3px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const chip = (active: boolean): React.CSSProperties => ({
  ...smallBtn, flex: 1, padding: "4px 0", textAlign: "center",
  ...(active ? { borderColor: "rgba(200,184,152,0.6)", background: "rgba(200,184,152,0.14)" } : {}),
});
const inp: React.CSSProperties = {
  background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)",
  color: "#f0ebe0", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontFamily: "monospace",
  width: 58,
};
const label: React.CSSProperties = { fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", margin: "10px 0 4px" };
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#96917f" };

const fmtS = (t: number) => `${t.toFixed(1)}s`;
const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
/** H.264 4:2:0 needs even dimensions — round to the nearest even pixel. */
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

export function ExportDialog({
  project, durationSec, defaultFps, hasAudio, settings, onSettingsChange,
  support, exporting, progress, lastExport, onDownloadLast, onRender, onClose,
}: ExportDialogProps) {
  const outW = even(project.width * settings.scale);
  const outH = even(project.height * settings.scale);
  const fullRange = settings.rangeStart === null || settings.rangeEnd === null;
  const rangeStart = fullRange ? 0 : settings.rangeStart ?? 0;
  const rangeEnd = fullRange ? durationSec : settings.rangeEnd ?? durationSec;
  const windowSec = Math.max(0.1, Math.min(durationSec, rangeEnd) - Math.max(0, rangeStart));
  const fpsOpts = [...new Set([defaultFps, 24, 30, 60])].filter(f => f >= 12 && f <= 60).sort((a, b) => a - b);
  // exportReelGif caps GIF at 20fps (centisecond delays) and 1200 frames —
  // the estimate must show the render it will ACTUALLY produce.
  const effFps = settings.format === "gif" ? Math.min(settings.fps, 20) : settings.fps;
  const frames = settings.format === "gif"
    ? Math.min(Math.max(1, Math.round(windowSec * effFps)), 1200)
    : Math.max(1, Math.round(windowSec * settings.fps));
  const outSec = settings.format === "gif" ? frames / effFps : windowSec;
  const estimate = estimateExportBytes(settings.format, outW, outH, settings.fps, windowSec);

  const patch = (p: Partial<ExportSettings>) => onSettingsChange({ ...settings, ...p });

  return (
    <div
      data-qa="export-dialog"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget && !exporting) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Exportar reel"
        style={{ width: 340, maxHeight: "86vh", overflowY: "auto", background: "#141414", border: "1px solid rgba(200,184,152,0.3)", borderRadius: 8, padding: 14, boxShadow: "0 10px 30px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: 4 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 12, color: "#f0ebe0", letterSpacing: 0.5 }}>Exportar reel</div>
          <button type="button" onClick={onClose} disabled={exporting} style={{ ...smallBtn, padding: "1px 7px" }} aria-label="Cerrar">✕</button>
        </div>

        <div style={label}>Formato</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["mp4", "webm", "gif"] as const).map(f => (
            <button key={f} type="button" data-qa={`fmt-${f}`} onClick={() => patch({ format: f })} style={chip(settings.format === f)}
              title={f === "mp4" ? "H.264 — universal (WhatsApp/Instagram)" : f === "webm" ? "VP9/VP8 — liviano, web" : "256 colores — sin audio, para compartir"}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={label}>Resolución</div>
        <div style={{ display: "flex", gap: 4 }}>
          {[0.5, 1, 2].map(s => (
            <button key={s} type="button" data-qa={`scale-${s}`} onClick={() => patch({ scale: s })} style={chip(settings.scale === s)}>
              {s === 1 ? "1×" : `${s}×`}
            </button>
          ))}
        </div>
        <div style={muted}>{project.width}×{project.height} → <span style={{ color: "#c8b898" }}>{outW}×{outH}</span></div>

        <div style={label}>FPS</div>
        <div style={{ display: "flex", gap: 4 }}>
          {fpsOpts.map(f => (
            <button key={f} type="button" data-qa={`fps-${f}`} onClick={() => patch({ fps: f })} style={chip(settings.fps === f)}>
              {f}
            </button>
          ))}
        </div>

        <div style={label}>Rango</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ ...muted, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" data-qa="range-all" checked={fullRange} disabled={exporting}
              onChange={e => patch(e.target.checked ? { rangeStart: null, rangeEnd: null } : { rangeStart: 0, rangeEnd: Math.min(durationSec, 3) })} />
            Todo el reel
          </label>
          {!fullRange && (
            <>
              <input type="number" data-qa="range-start" min={0} max={durationSec} step={0.1} style={inp} disabled={exporting}
                value={settings.rangeStart ?? 0}
                onChange={e => patch({ rangeStart: Math.max(0, Math.min(durationSec - 0.1, Number(e.target.value) || 0)) })} />
              <span style={muted}>→</span>
              <input type="number" data-qa="range-end" min={0} max={durationSec} step={0.1} style={inp} disabled={exporting}
                value={settings.rangeEnd ?? durationSec}
                onChange={e => patch({ rangeEnd: Math.max(0.1, Math.min(durationSec, Number(e.target.value) || 0)) })} />
              <span style={muted}>s</span>
            </>
          )}
        </div>

        {hasAudio && <div style={muted}>El reel lleva audio{settings.format === "gif" ? " — el GIF no lo incluye" : ""}.</div>}

        {/* Honest pre-flight: the verified route for THIS combo, or the way out. */}
        <div data-qa="route" style={{ fontSize: 10, lineHeight: 1.4, marginTop: 8 }} aria-live="polite">
          {support === null && <span style={{ color: "#96917f" }}>Verificando codec…</span>}
          {support?.ok && <span style={{ color: "#8fae8f" }}>✓ {support.route}</span>}
          {support && !support.ok && <span style={{ color: "#e08a6a" }}>✗ {support.reason}</span>}
        </div>

        <div data-qa="estimate" style={{ ...muted, marginTop: 2 }}>
          ~{mb(estimate)} · {frames} frames · {fmtS(outSec)}
          {settings.format === "gif" ? " — el GIF pesa; para video largo usa MP4" : ""}
        </div>
        {settings.format === "gif" && (settings.fps > 20 || Math.round(windowSec * effFps) > 1200) && (
          <div style={{ ...muted, color: "#c8b898" }}>GIF limitado a 20 fps y 1200 frames — aquí se renderiza a {frames} frames · {fmtS(outSec)}.</div>
        )}

        <button type="button" data-qa="render" onClick={onRender} disabled={exporting || support?.ok === false}
          title={support?.ok === false ? support.reason : undefined}
          style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, marginTop: 8, opacity: exporting || support?.ok === false ? 0.6 : 1 }}>
          {exporting ? `Renderizando… ${Math.round(progress * 100)}%` : `⬇ Renderizar ${settings.format.toUpperCase()} ${outW}×${outH}`}
        </button>
        {exporting && (
          <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: "#c8b898", transition: "width 120ms linear" }} />
          </div>
        )}

        {lastExport && !exporting && (
          <div data-qa="result" style={{ marginTop: 10, padding: 8, borderRadius: 4, background: "rgba(143,174,143,0.07)", border: "1px solid rgba(143,174,143,0.25)" }}>
            <div style={{ fontSize: 10, color: "#8fae8f" }}>Listo — {lastExport.filename}</div>
            <div style={muted}>{mb(lastExport.size)} · {fmtS(lastExport.durationSec)} · {lastExport.method}</div>
            <button type="button" onClick={onDownloadLast} style={{ ...smallBtn, marginTop: 4 }}>Descargar de nuevo</button>
          </div>
        )}

        <div style={{ ...muted, marginTop: 8, fontSize: 9 }}>El render ocurre en tu navegador — nada se sube.</div>
      </div>
    </div>
  );
}
