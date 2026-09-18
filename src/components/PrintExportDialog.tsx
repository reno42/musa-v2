/**
 * PrintExportDialog — UI del export de imprenta (REQ F1+F2+F3). Se abre
 * desde Exportar → "PDF Impresión…". Toda la pipeline real vive en EditorV2
 * (onRunJob: raster 300dpi → jsPDF mm → [worker Ghostscript si CMYK] →
 * descarga); el dialog solo elige opciones, muestra el estado del job y el
 * soft-proof.
 *
 * Feedback de producto: las medidas son SIEMPRE las del archivo (nada de
 * A4/Carta ni orientación), el color se elige con el par RGB/CMYK que el
 * usuario reconoce (los perfiles ICC quedan como detalle de CMYK), hay
 * margen opcional, nombre de archivo editable, calidad de JPEG y un bloque
 * de medidas en vivo. Principio del pie: el diseño SIEMPRE queda en RGB —
 * el CMYK es una transformación del archivo exportado, nunca del diseño.
 */
import { useEffect, useRef, useState } from "react";
import type { FrameData } from "./DesignFrame";
import {
  PRINT_PROFILES, PRINT_DPI, DEFAULT_PRINT_OPTIONS, computePrintGeometry, printFilename,
  clampScale, MIN_SCALE, MAX_SCALE,
  type PrintOptions, type PrintProfileId, type PrintCodec,
} from "../lib/printExport";
import { PRINT_UNITS, convertUnit, formatInUnit, parseTargetValue, type PrintUnit } from "../lib/printUnits";
import type { PrintProgressInfo, SeparationsResult } from "../lib/printProtocol";
import { loadPrintManifest, engineAvailable, profileIccAvailable } from "../lib/cmykEngine";
<<<<<<< HEAD
import { auditInk, tacLimitFor } from "../lib/inkAudit";
import { scanSpotInks } from "../lib/spotColors";
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)

interface PrintExportDialogProps {
  frames: FrameData[];
  onClose: () => void;
  /** Pipeline completa por frame (render → PDF → CMYK → descarga). */
  onRunJob: (frames: FrameData[], options: PrintOptions, report: (p: PrintProgressInfo) => void) => Promise<void>;
  /** Soft-proof de un frame (Fase 3) → URL de imagen para <img>. */
  onProof: (frame: FrameData, options: PrintOptions, report: (p: PrintProgressInfo) => void) => Promise<string>;
  /** Separaciones C/M/Y/K del primer frame (paridad Separations Preview). */
  onSeparations: (frame: FrameData, options: PrintOptions, report: (p: PrintProgressInfo) => void) => Promise<SeparationsResult>;
}

const pillRow: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const pill = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: "6px 10px", borderRadius: 6, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.4 : 1,
  border: active ? "1px solid rgba(200,184,152,0.6)" : "1px solid rgba(255,255,255,0.15)",
  background: active ? "rgba(200,184,152,0.18)" : "transparent",
  color: active ? "#f0e8d8" : "#c8c8c8",
});
const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "#8a8a8a", margin: "14px 0 6px" };
const slider = { accentColor: "#c8b898" } as React.CSSProperties;
const CMYK_PROFILES = PRINT_PROFILES.filter(p => p.iccFile !== null);

const PROOF_MAX_FRAMES = 4;

const dimInput: React.CSSProperties = {
  width: 86, padding: "5px 8px", borderRadius: 5, fontSize: 12.5, textAlign: "center",
  border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#e0e0e0",
};

/** Convierte una placa (cobertura de tinta 0-255) a PNG en escala de
 *  grises: la tinta se muestra como negro sobre blanco, como en las
 *  películas/planos de imprenta. */
function plateToThumb(width: number, height: number, data: Uint8Array, name: string, key: string): { key: string; name: string; url: string } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { key, name, url: "" };
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = 255 - data[i];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { key, name, url: canvas.toDataURL("image/png") };
}

function platesToThumbs(res: SeparationsResult) {
  return [
    plateToThumb(res.width, res.height, new Uint8Array(res.plates.c), "Cian", "c"),
    plateToThumb(res.width, res.height, new Uint8Array(res.plates.m), "Magenta", "m"),
    plateToThumb(res.width, res.height, new Uint8Array(res.plates.y), "Amarillo", "y"),
    plateToThumb(res.width, res.height, new Uint8Array(res.plates.k), "Negro", "k"),
  ];
}

export function PrintExportDialog({ frames, onClose, onRunJob, onProof, onSeparations }: PrintExportDialogProps) {
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  const [engineReady, setEngineReady] = useState<boolean | null>(null); // null = manifest sin cargar
  const [iccOk, setIccOk] = useState<Partial<Record<PrintProfileId, boolean>>>({});
  const [progress, setProgress] = useState<PrintProgressInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [proofUrls, setProofUrls] = useState<{ name: string; url: string }[]>([]);
  const [proofing, setProofing] = useState(false);
  const urlsRef = useRef<string[]>([]);
  const [sepUrls, setSepUrls] = useState<{ key: string; name: string; url: string }[]>([]);
<<<<<<< HEAD
  const [sepResult, setSepResult] = useState<SeparationsResult | null>(null);
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
  const [separating, setSeparating] = useState(false);
  // Unidades + escalado (feedback de producto): la unidad es SOLO
  // visualización; editar W/H ajusta la ESCALA del trabajo (0.1×–5×).
  const [unit, setUnit] = useState<PrintUnit>("mm");
  const [dims, setDims] = useState<{ w: string; h: string }>({ w: "", h: "" });
  const [dimsDirty, setDimsDirty] = useState(false);
  const [dimsError, setDimsError] = useState<string | null>(null);

  const first = frames[0];
  // Medidas en vivo: página = frame a 300dpi × escala + anillo de papel
  // (margen / sangrado / marcas). Cada frame usa sus propias medidas; las
  // del primero son la referencia que se edita.
  const geo = first ? computePrintGeometry(first.width, first.height, options.marginMm, { scale: options.scale, bleedMm: options.bleedMm, cropMarks: options.cropMarks }) : null;

  // Los inputs W/H siguen la geometría salvo mientras el usuario edita.
  useEffect(() => {
    if (dimsDirty || !geo) return;
    setDims({ w: formatInUnit(geo.pageWmm, unit), h: formatInUnit(geo.pageHmm, unit) });
  }, [geo?.pageWmm, geo?.pageHmm, unit, dimsDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Disponibilidad real del motor/perfiles según el manifest del deploy.
  useEffect(() => {
    let alive = true;
    loadPrintManifest().then(m => {
      if (!alive) return;
      setEngineReady(engineAvailable(m));
      const map: Partial<Record<PrintProfileId, boolean>> = {};
      for (const p of PRINT_PROFILES) if (p.iccFile) map[p.id] = profileIccAvailable(m, p.id);
      setIccOk(map);
    });
    return () => { alive = false; };
  }, []);

  // object URLs del soft-proof: revocar al cerrar/cambiar.
  useEffect(() => () => { for (const u of urlsRef.current) URL.revokeObjectURL(u); }, []);

  const isCmyk = options.profile !== "srgb";
  const cmykProfile = isCmyk ? PRINT_PROFILES.find(p => p.id === options.profile) || null : null;
  const cmykUsable = Boolean(engineReady) && Boolean(iccOk[options.profile]);
  const busy = progress !== null && progress.phase !== "done" && progress.phase !== "error";
  const report = (p: PrintProgressInfo) => {
    setProgress(p);
    if (p.message) setLog(prev => [...prev.slice(-40), p.message!]);
  };

  const setColorMode = (mode: "rgb" | "cmyk") => {
<<<<<<< HEAD
    setSepResult(null); // resultado de otro perfil — la auditoría se recalcula
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
    if (mode === "rgb") { setOptions(o => ({ ...o, profile: "srgb" })); return; }
    // Entrar a CMYK: primer perfil disponible (o el actual si ya era CMYK).
    setOptions(o => {
      if (o.profile !== "srgb") return o;
      const first = CMYK_PROFILES.find(p => !p.licensed) || CMYK_PROFILES[0];
      return { ...o, profile: first.id as PrintProfileId };
    });
  };

  const runExport = async () => {
    if (busy || frames.length === 0) return;
    setLog([]);
    setProofUrls([]);
    try {
      await onRunJob(frames, options, report);
      setProgress({ phase: "done", current: frames.length, total: frames.length, message: "Listo" });
    } catch (err) {
      setProgress({ phase: "error", current: 0, total: frames.length, message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runProof = async () => {
    if (proofing || !cmykUsable) return;
    setProofing(true);
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
    setProofUrls([]);
    const targets = frames.slice(0, PROOF_MAX_FRAMES);
    try {
      for (let i = 0; i < targets.length; i++) {
        const url = await onProof(targets[i], options, p => setProgress(p));
        urlsRef.current.push(url);
        setProofUrls(prev => [...prev, { name: targets[i].name, url }]);
      }
    } catch (err) {
      setProgress({ phase: "error", current: 0, total: targets.length, message: `Soft-proof: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setProofing(false);
      setProgress(null);
    }
  };

  // Editar W/H = pedir un tamaño físico: escala RELATIVA a la geometría
  // actual (así margen/sangrado/marcas ya aplicados no se recalculan mal).
  const commitDims = (axis: "w" | "h") => {
    setDimsDirty(false);
    if (!first || !geo) return;
    const raw = parseTargetValue(dims[axis]);
    if (!Number.isFinite(raw) || raw <= 0) { setDimsError(null); return; }
    const targetMm = convertUnit(raw, unit, "mm");
    const currentMm = axis === "w" ? geo.pageWmm : geo.pageHmm;
    const next = options.scale * (targetMm / currentMm);
    if (next < MIN_SCALE - 1e-9 || next > MAX_SCALE + 1e-9) {
      setDimsError(`Escala fuera de rango (${Math.round(next * 100)}%) — límite ${MIN_SCALE * 100}%–${MAX_SCALE * 100}%`);
      return;
    }
    setDimsError(null);
    setOptions(o => ({ ...o, scale: clampScale(next) }));
  };

  const runSeparations = async () => {
    if (separating || !cmykUsable || !first) return;
    setSeparating(true);
    setSepUrls([]);
    try {
      const res = await onSeparations(first, options, p => setProgress(p));
<<<<<<< HEAD
      setSepResult(res);
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
      setSepUrls(platesToThumbs(res));
    } catch (err) {
      setProgress({ phase: "error", current: 0, total: 1, message: `Separaciones: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSeparating(false);
      setProgress(null);
    }
  };

  const customName = options.filename.trim();
  const finalName = printFilename(customName || first?.name || "frame", options.profile);

<<<<<<< HEAD
  // Auditoría de tinta (Ink Manager, mitad inspectora) + tintas planas del frame.
  const sepAudit = sepResult ? auditInk(sepResult, tacLimitFor(options.profile)) : null;
  const spotInks = first ? scanSpotInks(first.css, first.html) : [];

=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 18, width: 440, maxHeight: "86vh", overflowY: "auto", color: "#e0e0e0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Exportar para imprenta</div>
<<<<<<< HEAD
          {/* REQ-027: ✕ SIEMPRE cerrable — cerrar no cancela el job en
              curso; el archivo igual se descarga al terminar. */}
          <button type="button" onClick={onClose} title="Cerrar (el export en curso termina y guarda su archivo)" style={{ background: "transparent", border: "none", color: "#888", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
=======
          <button type="button" onClick={onClose} disabled={busy} style={{ background: "transparent", border: "none", color: "#888", fontSize: 16, cursor: busy ? "not-allowed" : "pointer", lineHeight: 1 }}>✕</button>
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
        </div>
        <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>
          {frames.length === 1
            ? `Frame "${first?.name}" · ${first?.width}×${first?.height}px`
            : `${frames.length} frames seleccionados`}
          {" · "}300 dpi fijos
        </div>

        <div style={sectionTitle}>Nombre del archivo</div>
        <input type="text" value={options.filename}
          placeholder={first?.name || "frame"}
          disabled={busy}
          onChange={e => setOptions(o => ({ ...o, filename: e.target.value }))}
          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, fontSize: 12.5,
            border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#e0e0e0" }} />
        <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>
          → {finalName}
          {customName && frames.length > 1 && ` · se numera: ${printFilename(`${customName}_1`, options.profile)}, ${printFilename(`${customName}_2`, options.profile)}…`}
        </div>

        <div style={sectionTitle}>Color</div>
        <div style={pillRow}>
          <button type="button" style={pill(!isCmyk)} disabled={busy} onClick={() => setColorMode("rgb")}>
            RGB · digital
          </button>
          <button type="button" style={pill(isCmyk)} disabled={busy || engineReady === false} onClick={() => setColorMode("cmyk")}>
            CMYK · imprenta
          </button>
        </div>
        {isCmyk && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {CMYK_PROFILES.map(p => {
              const ok = Boolean(engineReady) && Boolean(iccOk[p.id]);
              const reason = engineReady === null ? "verificando motor…"
                : !engineReady ? "motor no instalado en este deploy"
                : !iccOk[p.id] ? (p.licensed ? "perfil .icc no disponible" : "requiere .icc con licencia (colocación manual)")
                : null;
              return (
                <button key={p.id} type="button" disabled={busy || !ok}
                  onClick={() => setOptions(o => ({ ...o, profile: p.id as PrintProfileId }))}
                  style={{ textAlign: "left", padding: "7px 10px", borderRadius: 6, cursor: ok ? "pointer" : "not-allowed",
                    border: options.profile === p.id ? "1px solid rgba(200,184,152,0.6)" : "1px solid rgba(255,255,255,0.12)",
                    background: options.profile === p.id ? "rgba(200,184,152,0.14)" : "transparent", color: ok ? "#e0e0e0" : "#777" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: ok ? "#999" : "#a06a5a" }}>{reason || p.desc}</div>
                </button>
              );
            })}
          </div>
        )}

<<<<<<< HEAD
        {spotInks.length > 0 && (
          <>
            <div style={sectionTitle}>Tintas planas ({spotInks.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {spotInks.map(sp => (
                <div key={sp.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  {sp.hex && <span style={{ width: 14, height: 14, borderRadius: 3, background: sp.hex, border: "1px solid rgba(255,255,255,0.25)", flexShrink: 0 }} />}
                  <b style={{ fontWeight: 600 }}>{sp.name}</b>
                  {sp.cmyk.some(v => v > 0) && <span style={{ color: "#888", fontSize: 10.5 }}>aprox. CMYK {sp.cmyk.join(" · ")}</span>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>
              El PDF lleva la aproximación CMYK de cada tinta; para la tinta real (Pantone) pide a la imprenta imprimir esa placa aparte.
            </div>
          </>
        )}

=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
        <div style={sectionTitle}>Imagen interna del PDF</div>
        <div style={pillRow}>
          <button type="button" style={pill(options.codec === "png")} disabled={busy}
            onClick={() => setOptions(o => ({ ...o, codec: "png" as PrintCodec }))}>
            PNG · sin pérdida (recomendado)
          </button>
          <button type="button" style={pill(options.codec === "jpeg")} disabled={busy}
            onClick={() => setOptions(o => ({ ...o, codec: "jpeg" as PrintCodec }))}>
            JPEG · más liviano (con pérdida)
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>
          El codec solo cambia el peso del archivo: la conversión de color se aplica igual con ambos.
        </div>
        {options.codec === "jpeg" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "#aaa", minWidth: 52 }}>Calidad</span>
            <input type="range" min={50} max={100} step={1} style={{ ...slider, flex: 1 }} disabled={busy}
              value={Math.round(options.jpegQuality * 100)}
              onChange={e => setOptions(o => ({ ...o, jpegQuality: Number(e.target.value) / 100 }))} />
            <span style={{ fontSize: 12, color: "#e0e0e0", minWidth: 38, textAlign: "right" }}>{Math.round(options.jpegQuality * 100)}%</span>
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa", marginTop: 8, opacity: options.codec === "png" && !isCmyk ? 1 : 0.4 }}>
          <input type="checkbox" disabled={busy || options.codec !== "png" || isCmyk}
            checked={options.transparent}
            onChange={e => setOptions(o => ({ ...o, transparent: e.target.checked }))} />
          Conservar transparencia (solo PNG + RGB — imprenta lleva fondo blanco)
        </label>

        <div style={sectionTitle}>Margen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="range" min={0} max={15} step={1} style={{ ...slider, flex: 1 }} disabled={busy}
            value={options.marginMm}
            onChange={e => setOptions(o => ({ ...o, marginMm: Number(e.target.value) }))} />
          <span style={{ fontSize: 12, color: options.marginMm === 0 ? "#8a8a8a" : "#e0e0e0", minWidth: 90, textAlign: "right" }}>
            {options.marginMm === 0 ? "Sin margen" : `${options.marginMm} mm por lado`}
          </span>
        </div>

        <div style={sectionTitle}>Sangrado y marcas de corte</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="range" min={0} max={5} step={1} style={{ ...slider, flex: 1 }} disabled={busy}
            value={options.bleedMm}
            onChange={e => setOptions(o => ({ ...o, bleedMm: Number(e.target.value) }))} />
          <span style={{ fontSize: 12, color: options.bleedMm === 0 ? "#8a8a8a" : "#e0e0e0", minWidth: 90, textAlign: "right" }}>
            {options.bleedMm === 0 ? "Sin sangrado" : `${options.bleedMm} mm por lado`}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>
          El diseño se estira para cubrir corte + sangrado: la guillotina nunca deja filetes blancos.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa", marginTop: 8 }}>
          <input type="checkbox" disabled={busy} checked={options.cropMarks}
            onChange={e => setOptions(o => ({ ...o, cropMarks: e.target.checked }))} />
          Marcas de corte (el PDF crece lo necesario para alojarlas)
        </label>

        {geo && (
          <>
            <div style={sectionTitle}>Medidas de exportación</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "#8a8a8a" }}>Unidad</span>
              {PRINT_UNITS.map(u => (
                <button key={u} type="button" disabled={busy}
                  onClick={() => { setDimsDirty(false); setDimsError(null); setUnit(u); }}
                  style={{ padding: "3px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                    border: unit === u ? "1px solid rgba(200,184,152,0.6)" : "1px solid rgba(255,255,255,0.15)",
                    background: unit === u ? "rgba(200,184,152,0.18)" : "transparent", color: unit === u ? "#f0e8d8" : "#c8c8c8" }}>
                  {u}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <input type="text" inputMode="decimal" value={dims.w} aria-label="Ancho de página" disabled={busy}
                onChange={e => { setDims(d => ({ ...d, w: e.target.value })); setDimsDirty(true); }}
                onBlur={() => commitDims("w")}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={dimInput} />
              <span style={{ fontSize: 12, color: "#666" }}>×</span>
              <input type="text" inputMode="decimal" value={dims.h} aria-label="Alto de página" disabled={busy}
                onChange={e => { setDims(d => ({ ...d, h: e.target.value })); setDimsDirty(true); }}
                onBlur={() => commitDims("h")}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={dimInput} />
              <span style={{ fontSize: 11.5, color: "#8a8a8a" }}>{unit}</span>
              <span title="La proporción es siempre la del frame: la escala es uniforme" style={{ fontSize: 11, color: "#777" }}>🔒</span>
            </div>
            {dimsError && <div style={{ fontSize: 10.5, color: "#e08a7a", marginTop: 4 }}>{dimsError}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 11.5, color: options.scale !== 1 ? "#c8b898" : "#8a8a8a" }}>
                Escala: {Math.round(options.scale * 1000) / 10}%
              </span>
              {options.scale !== 1 && (
                <button type="button" disabled={busy}
                  onClick={() => { setDimsError(null); setOptions(o => ({ ...o, scale: 1 })); }}
                  style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#aaa" }}>
                  Reiniciar a 100%
                </button>
              )}
            </div>
            <div style={{ padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 11.5, color: "#bbb", lineHeight: 1.5, marginTop: 8 }}>
              <div>Página: <b style={{ color: "#e0e0e0" }}>{formatInUnit(geo.pageWmm, unit)} × {formatInUnit(geo.pageHmm, unit)} {unit}</b>{options.marginMm > 0 ? " (margen incluido)" : ""}</div>
              <div>Corte: {formatInUnit(geo.trimWmm, unit)} × {formatInUnit(geo.trimHmm, unit)} {unit}{geo.bleedMm > 0 ? ` · sangrado ${geo.bleedMm} mm` : ""}</div>
              <div>Imagen: {geo.rasterW} × {geo.rasterH} px</div>
              <div style={{ color: geo.effDpi < PRINT_DPI - 0.5 ? "#d0936a" : "#9ab88a" }}>
                {geo.effDpi < PRINT_DPI - 0.5
                  ? `⚠ ${geo.effDpi.toFixed(0)} dpi efectivos — por debajo del estándar de imprenta (300)`
                  : `✓ ${geo.effDpi.toFixed(0)} dpi efectivos`}
              </div>
              {frames.length > 1 && <div style={{ color: "#8a8a8a" }}>Cada frame usa sus propias medidas; la escala es la misma para todos.</div>}
            </div>
          </>
        )}

        {cmykProfile && (
          <>
            <div style={sectionTitle}>Soft-proof — simular imprenta</div>
            <div style={{ fontSize: 11.5, color: "#999", marginBottom: 8 }}>
              Preview ICC-preciso de cómo caerán los colores con {cmykProfile.label}. Solo previsualización: nunca modifica el diseño.
            </div>
            <button type="button" style={{ ...pill(false, proofing || !cmykUsable), width: "100%" }} disabled={proofing || !cmykUsable || busy} onClick={runProof}>
              {proofing ? "Generando preview…" : `Previsualizar${frames.length > PROOF_MAX_FRAMES ? ` (primeros ${PROOF_MAX_FRAMES})` : ""}`}
            </button>
            {proofUrls.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {proofUrls.map(pu => (
                  <div key={pu.url} style={{ width: 96 }}>
                    <img src={pu.url} alt={pu.name} style={{ width: 96, height: 96, objectFit: "contain", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, background: "#fff" }} />
                    <div style={{ fontSize: 10, color: "#888", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pu.name}</div>
                  </div>
                ))}
              </div>
            )}
            <button type="button" style={{ ...pill(false, separating || !cmykUsable || busy), width: "100%", marginTop: 8 }}
              disabled={separating || !cmykUsable || busy} onClick={() => { void runSeparations(); }}>
              {separating ? "Separando placas…" : "Ver separaciones C / M / Y / K"}
            </button>
            {sepUrls.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {sepUrls.map(sp => (
                  <div key={sp.key} style={{ width: 96 }}>
                    <img src={sp.url} alt={sp.name} style={{ width: 96, height: 96, objectFit: "contain", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, background: "#fff" }} />
                    <div style={{ fontSize: 10, color: "#888", marginTop: 3, textAlign: "center" }}>{sp.name}</div>
                  </div>
                ))}
              </div>
            )}
<<<<<<< HEAD
            {sepAudit && (
              <div style={{ padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 11.5, color: "#bbb", lineHeight: 1.6, marginTop: 8 }}>
                <div style={{ fontWeight: 600, color: "#e0e0e0" }}>Auditoría de tinta · límite TAC {sepAudit.limitPct}%</div>
                <div>
                  TAC máximo: <b style={{ color: sepAudit.maxTacPct > sepAudit.limitPct ? "#d0936a" : "#9ab88a" }}>{sepAudit.maxTacPct.toFixed(0)}%</b>
                  {" "}· promedio {sepAudit.avgTacPct.toFixed(0)}%
                </div>
                <div style={{ color: "#999" }}>
                  C {sepAudit.plates.c.avgPct.toFixed(0)}% · M {sepAudit.plates.m.avgPct.toFixed(0)}% · Y {sepAudit.plates.y.avgPct.toFixed(0)}% · K {sepAudit.plates.k.avgPct.toFixed(0)}% (media por placa)
                </div>
                {sepAudit.overLimitPct > 0
                  ? <div style={{ color: "#d0936a" }}>⚠ {sepAudit.overLimitPct.toFixed(1)}% de los píxeles supera el TAC del perfil — riesgo de embarrado/repinta.</div>
                  : <div style={{ color: "#9ab88a" }}>✓ Todo el frame dentro del límite de tinta del perfil.</div>}
              </div>
            )}
=======
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
          </>
        )}

        {(progress || log.length > 0) && (
          <div style={{ marginTop: 14, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 11.5, color: "#bbb", maxHeight: 130, overflowY: "auto" }}>
            {progress && progress.phase !== "done" && (
              <div style={{ color: progress.phase === "error" ? "#e08a7a" : "#c8b898", marginBottom: log.length ? 4 : 0 }}>
<<<<<<< HEAD
                {/* REQ-027: el % real ya llega en progress.message (EditorV2
                    lo arma desde engine-progress); mostrarlo en vez del
                    texto estático que escondía la descarga. */}
                {progress.phase === "preparing" && (progress.message || "Preparando motor de imprenta…")}
=======
                {progress.phase === "preparing" && "Preparando motor de imprenta…"}
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
                {progress.phase === "rendering" && `Renderizando ${progress.current}/${progress.total}…`}
                {progress.phase === "converting" && `Convirtiendo a CMYK ${progress.current}/${progress.total}…`}
                {progress.phase === "proofing" && "Generando soft-proof…"}
                {progress.phase === "error" && "✗ " + (progress.message || "Error")}
              </div>
            )}
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}

        <button type="button"
          style={{ width: "100%", marginTop: 14, padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(200,184,152,0.5)",
            background: "rgba(200,184,152,0.2)", color: "#f0e8d8", fontSize: 13, fontWeight: 600,
            cursor: busy || frames.length === 0 || (cmykProfile && !cmykUsable) ? "not-allowed" : "pointer",
            opacity: busy || frames.length === 0 || (cmykProfile && !cmykUsable) ? 0.45 : 1 }}
          disabled={busy || frames.length === 0 || (cmykProfile !== null && !cmykUsable)}
          onClick={() => { void runExport(); }}>
          {busy ? "Exportando…" : `Exportar ${frames.length > 1 ? `${frames.length} frames` : "frame"} · ${isCmyk ? `PDF CMYK ${cmykProfile?.suffix}` : "PDF RGB 300dpi"}`}
        </button>
        <div style={{ fontSize: 10.5, color: "#777", marginTop: 8, textAlign: "center" }}>
          El diseño permanece en RGB — el CMYK se aplica solo al archivo exportado.
        </div>
      </div>
    </div>
  );
}
