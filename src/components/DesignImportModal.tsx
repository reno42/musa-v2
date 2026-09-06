import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importDesignFileResults, resultsFromDocument, sourceFingerprint, SUPPORTED_IMPORT_FORMATS, type ImportResult } from "../lib/designImport";
import { findMissingImportFonts, replaceImportFonts, type DesignImportDocument } from "../../shared/designImport.ts";
import { apiFetch } from "../lib/supabase";
import { prepareImageForUpload } from "../lib/imageCompress";
import { GoogleFontPicker } from "./GoogleFontPicker";
import { cssFontFamily } from "../lib/fontFamily";
import { customFontFaceCss, listCustomFonts, type CustomFont } from "../lib/customFonts";
import { ensureGoogleFontImport } from "../lib/googleFonts";

interface DesignImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (results: ImportResult[]) => void | Promise<void>;
  initialFiles?: File[] | null;
  workspaceId?: string;
}

const DATA_IMAGE = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g;

/** Upload every embedded bitmap before a frame is persisted. */
async function persistEmbeddedImages(result: ImportResult, workspaceId?: string, signal?: AbortSignal): Promise<ImportResult> {
  signal?.throwIfAborted();
  const sources = [...new Set(result.html.match(DATA_IMAGE) || [])];
  if (!sources.length) return result;
  if (!workspaceId) throw new Error("No se pudo guardar la imagen importada porque el diseño no tiene workspace.");
  let html = result.html;
  for (let index = 0; index < sources.length; index++) {
    const blob = await (await fetch(sources[index])).blob();
    const prepared = await prepareImageForUpload(blob, { targetBytes: 4_500_000, maxEdge: 4096 });
    const payload = await apiFetch<{ url: string }>("/api/assets/upload", {
      method: "POST",
      signal,
      body: JSON.stringify({ workspaceId, name: `${result.name || "Importación"} · capa ${index + 1}`, data: prepared.dataUrl, tags: ["design-import"] }),
    });
    if (!payload.url) throw new Error("El servidor no devolvió la URL de una capa importada.");
    html = html.split(sources[index]).join(payload.url);
  }
  if (/data:image\//i.test(html)) throw new Error("Quedó una imagen embebida sin guardar; la importación se detuvo para no inflar el diseño.");
  return { ...result, html };
}

export function DesignImportModal({ open, onClose, onImport, initialFiles, workspaceId }: DesignImportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const consumedInitialRef = useRef("");
  const operationRef = useRef<AbortController | null>(null);
  const pendingFinishRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [figmaUrl, setFigmaUrl] = useState("");
  const [replacePrevious, setReplacePrevious] = useState(false);
  const [report, setReport] = useState<{ frames: number; editable: number; approximate: number; raster: number } | null>(null);
  const [pendingFigma, setPendingFigma] = useState<{ document: DesignImportDocument; sourceKey: string; fontCss: string } | null>(null);
  const [fontReplacements, setFontReplacements] = useState<Record<string, { family: string; variants?: string[]; custom?: CustomFont }>>({});
  const [fontError, setFontError] = useState("");

  useEffect(() => {
    if (!open) { consumedInitialRef.current = ""; operationRef.current?.abort(); }
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open) {
      if (dialog.open) dialog.close();
      consumedInitialRef.current = "";
    }
  }, [open]);

  const closeModal = useCallback(() => {
    setPendingFigma(null);
    setFontReplacements({});
    setFontError("");
    onClose();
  }, [onClose]);

  const finish = useCallback(async (rawResults: ImportResult[], signal?: AbortSignal) => {
    const results: ImportResult[] = [];
    for (let index = 0; index < rawResults.length; index++) {
      results.push(await persistEmbeddedImages(rawResults[index], workspaceId, signal));
      setProgress(Math.round(((index + 1) / rawResults.length) * 100));
    }
    signal?.throwIfAborted();
    await onImport(results.map(result => ({ ...result, replacePrevious })));
    setReport(results.reduce((value, item) => ({
      frames: value.frames + 1,
      editable: value.editable + (item.report?.editable || 0),
      approximate: value.approximate + (item.report?.approximate || 0),
      raster: value.raster + (item.report?.raster || 0),
    }), { frames: 0, editable: 0, approximate: 0, raster: 0 }));
  }, [onImport, workspaceId, replacePrevious]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length || processing) return;
    const operation = new AbortController();
    operationRef.current = operation;
    setProcessing(true);
    setProgress(5);
    setError(null);
    setReport(null);
    setPendingFigma(null);
    try {
      const converted: ImportResult[] = [];
      const failures: string[] = [];
      for (let index = 0; index < selected.length; index++) {
        operation.signal.throwIfAborted();
        try { converted.push(...await importDesignFileResults(selected[index])); }
        catch (error) { failures.push(`${selected[index].name}: ${error instanceof Error ? error.message : "No se pudo convertir"}`); }
        setProgress(Math.max(5, Math.round(((index + 1) / selected.length) * 70)));
      }
      if (converted.length) await finish(converted, operation.signal);
      if (failures.length) setError(failures.join("\n"));
    } catch (caught) {
      setError(operation.signal.aborted ? "Importación cancelada; no se agregaron frames." : caught instanceof Error ? caught.message : "No se pudo importar el diseño.");
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [finish, processing]);

  useEffect(() => {
    if (!open || !initialFiles?.length) return;
    const key = initialFiles.map(file => `${file.name}:${file.size}:${file.lastModified}`).join("|");
    if (consumedInitialRef.current === key) return;
    consumedInitialRef.current = key;
    queueMicrotask(() => void handleFiles(initialFiles));
  }, [handleFiles, initialFiles, open]);

  const importFigma = useCallback(async () => {
    if (!workspaceId) return setError("Abre un diseño dentro de un workspace para importar Figma.");
    const url = figmaUrl.trim();
    if (!url) return setError("Pega un enlace de archivo o frame de Figma.");
    const operation = new AbortController();
    operationRef.current = operation;
    setProcessing(true);
    setProgress(15);
    setError(null);
    setReport(null);
    try {
      const response = await apiFetch<{ data: { result: DesignImportDocument } }>("/api/design-imports/figma", {
        method: "POST",
        signal: operation.signal,
        timeoutMs: 55_000,
        body: JSON.stringify({ workspaceId, url }),
      });
      if (!response.data?.result) throw new Error("Figma no devolvió ningún frame importable.");
      const used = response.data.result.fonts?.used || [];
      const custom = await listCustomFonts().catch(() => []);
      const catalogs = await Promise.all(used.map(async family => {
        try {
          const response = await fetch(`/api/fonts/catalog?search=${encodeURIComponent(family)}&limit=20`);
          if (!response.ok) return null;
          const result = await response.json();
          return (result.data?.fonts || []).find((font: any) => String(font.family).toLowerCase() === family.toLowerCase()) || null;
        } catch { return null; }
      }));
      const available = [...custom.map(font => font.familyName), ...catalogs.filter(Boolean).map((font: any) => font.family)];
      const missing = findMissingImportFonts(used, available);
      response.data.result.fonts = { used, missing };
      let fontCss = "";
      for (const font of custom) if (used.some(family => family.toLowerCase() === font.familyName.toLowerCase())) fontCss += `${customFontFaceCss(font)}\n`;
      catalogs.filter(Boolean).forEach((font: any) => { fontCss = ensureGoogleFontImport(fontCss, font.stack || font.family, font.variants || []); });
      if (missing.length) {
        setPendingFigma({ document: response.data.result, sourceKey: `figma-${sourceFingerprint(url)}`, fontCss });
        setFontReplacements({});
        setProgress(100);
        return;
      }
      await finish(resultsFromDocument(response.data.result).map((result, index) => ({ ...result, css: `${fontCss}${result.css}`, sourceKey: `figma-${sourceFingerprint(url)}-${index}` })), operation.signal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo importar el enlace de Figma.");
    } finally { setProcessing(false); }
  }, [figmaUrl, finish, workspaceId]);

  const finishPendingFigma = useCallback(async () => {
    if (!pendingFigma || pendingFinishRef.current) return;
    const missing = pendingFigma.document.fonts?.missing || [];
    const unresolved = missing.filter(family => !fontReplacements[family]?.family);
    if (unresolved.length) return setFontError("Elige un reemplazo para cada fuente antes de importar.");
    pendingFinishRef.current = true;
    const operation = new AbortController();
    operationRef.current = operation;
    setProcessing(true);
    setFontError("");
    try {
      const replacements = Object.fromEntries(Object.entries(fontReplacements).map(([source, value]) => [source, cssFontFamily(value.family)]));
      const resolved = replaceImportFonts(pendingFigma.document, replacements);
      let resolvedCss = pendingFigma.fontCss;
      for (const value of Object.values(fontReplacements)) resolvedCss = value.custom ? `${customFontFaceCss(value.custom)}\n${resolvedCss}` : ensureGoogleFontImport(resolvedCss, value.family, value.variants || []);
      await finish(resultsFromDocument(resolved).map((result, index) => ({ ...result, css: `${resolvedCss}${result.css}`, sourceKey: `${pendingFigma.sourceKey}-${index}` })), operation.signal);
      setPendingFigma(null);
    } catch (caught) {
      setFontError(caught instanceof Error ? caught.message : "No se pudieron aplicar los reemplazos de fuente.");
    } finally { pendingFinishRef.current = false; setProcessing(false); }
  }, [finish, fontReplacements, pendingFigma]);

  const statusText = useMemo(() => processing ? `Convirtiendo y guardando recursos… ${progress}%` : null, [processing, progress]);
  if (!open) return null;

  return (
    <dialog ref={dialogRef} aria-labelledby="design-import-title" aria-describedby="design-import-description" onCancel={event => { event.preventDefault(); if (!processing) closeModal(); }} style={{ padding: 0, border: 0, borderRadius: 12, background: "transparent", maxWidth: 600, width: "min(92vw, 600px)" }}>
      <div role="presentation" onClick={event => { if (event.target === event.currentTarget && !processing) closeModal(); }} style={{ background: "var(--editor-bg-2, #16162a)", border: "1px solid var(--editor-border, #333346)", borderRadius: 12, padding: 24, color: "var(--editor-text, #e0e0f0)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 id="design-import-title" style={{ margin: 0, fontSize: 18 }}>Importar diseño</h2>
          <button type="button" onClick={closeModal} disabled={processing} aria-label="Cerrar importación" style={{ background: "none", border: 0, color: "inherit", fontSize: 20, cursor: "pointer" }}>×</button>
        </header>
        <p id="design-import-description" style={{ margin: "0 0 16px", color: "var(--editor-text-dim, #aaa)", fontSize: 13 }}>Importa SVG, capas de Photoshop o páginas de PDF/Illustrator. Para Figma, pega el enlace del diseño. Los elementos complejos pueden conservarse como imagen.</p>

        <label htmlFor="design-import-files" onDrop={event => { event.preventDefault(); setDragOver(false); void handleFiles(event.dataTransfer.files); }} onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} style={{ display: "block", border: `2px dashed ${dragOver ? "#c8b898" : "var(--editor-border, #444)"}`, borderRadius: 8, padding: "28px 20px", textAlign: "center", cursor: processing ? "wait" : "pointer", background: dragOver ? "rgba(200,184,152,0.08)" : "transparent" }}>
          <input id="design-import-files" ref={fileInputRef} type="file" accept={SUPPORTED_IMPORT_FORMATS} multiple disabled={processing} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} onChange={event => event.target.files && void handleFiles(event.target.files)} />
          <span aria-hidden="true" style={{ display: "block", fontSize: 28, marginBottom: 6 }}>📎</span>
          <span style={{ display: "block", fontSize: 14 }}>Suelta uno o varios archivos, o selecciónalos</span>
          <span style={{ display: "block", color: "var(--editor-text-dim, #888)", fontSize: 12, marginTop: 4 }}>PSD · AI/PDF · FIG · SVG · PNG/JPG/WEBP · máximo 50 MB por archivo</span>
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <label htmlFor="figma-design-url" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Enlace de Figma</label>
          <input id="figma-design-url" type="url" value={figmaUrl} onChange={event => setFigmaUrl(event.target.value)} disabled={processing} placeholder="Pega un enlace de Figma (opcional)" style={{ flex: 1, minWidth: 0, borderRadius: 6, border: "1px solid var(--editor-border, #444)", background: "var(--editor-bg, #0e0e1a)", color: "inherit", padding: "9px 10px" }} />
          <button type="button" onClick={() => void importFigma()} disabled={processing || !figmaUrl.trim()} style={{ borderRadius: 6, border: "1px solid #c8b898", background: "rgba(200,184,152,.12)", color: "inherit", padding: "9px 12px", cursor: "pointer" }}>Importar enlace</button>
        </div>
        <p style={{ margin: "8px 0 0", color: "var(--editor-text-dim, #888)", fontSize: 11 }}>El enlace usa la conexión privada de Figma configurada para este workspace.</p>
        <details style={{ marginTop: 10, color: "var(--editor-text-dim, #aaa)", fontSize: 11, lineHeight: 1.45 }}>
          <summary style={{ cursor: "pointer", color: "var(--editor-text, #e0e0f0)" }}>Límites de la importación desde Figma</summary>
          <div style={{ marginTop: 8 }}>
            <p style={{ margin: "0 0 6px" }}>Se importan todos los frames superiores de la página o sección seleccionada; Futuraria no impone hoy un máximo numérico de frames. El resultado admite hasta 8 MB, 16 384 px por lado, 5 MB por imagen incrustada y 80 subárboles complejos exportados como SVG. Figma limita cada export renderizado a 32 megapíxeles y reduce los que superan ese tamaño.</p>
            <p style={{ margin: "0 0 6px" }}>Cada intento espera hasta 50 s en el servidor y cada llamada o descarga de Figma tiene un límite interno de 20 s.</p>
            <p style={{ margin: "0 0 4px" }}>Consumo habitual por importación: 1 solicitud Tier 1 para leer el archivo; +1 Tier 1 si hay fallbacks SVG (se agrupan); +1 Tier 2 si hay imágenes raster.</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <caption style={{ textAlign: "left", marginBottom: 3 }}>Cuotas publicadas por Figma para endpoints Tier 1 / Tier 2</caption>
              <tbody>
                <tr><td style={{ padding: "2px 6px 2px 0" }}>Viewer/Collab</td><td>20/mes · 5/min</td></tr>
                <tr><td style={{ padding: "2px 6px 2px 0" }}>Dev/Full · Starter</td><td>10/min · 25/min</td></tr>
                <tr><td style={{ padding: "2px 6px 2px 0" }}>Dev/Full · Professional</td><td>15/min · 50/min</td></tr>
                <tr><td style={{ padding: "2px 6px 2px 0" }}>Dev/Full · Organization/Enterprise</td><td>20/min · 100/min</td></tr>
              </tbody>
            </table>
            <p style={{ margin: "6px 0 0" }}>La cantidad de diseños varía según su contenido, tu asiento, plan y uso compartido de la cuota. Figma puede indicar una espera distinta al responder 429.</p>
          </div>
        </details>
        <label style={{ display: "flex", gap: 8, marginTop: 12, fontSize: 12 }}><input type="checkbox" checked={replacePrevious} disabled={processing} onChange={event => setReplacePrevious(event.target.checked)} />Actualizar la importación anterior del mismo archivo (reemplaza sus cambios)</label>

        {pendingFigma && <section aria-labelledby="missing-fonts-title" style={{ marginTop: 14, padding: 12, border: "1px solid rgba(200,184,152,.4)", borderRadius: 6 }}>
          <h3 id="missing-fonts-title" style={{ margin: "0 0 6px", fontSize: 14 }}>Fuentes que necesitan reemplazo</h3>
          <p style={{ margin: "0 0 10px", color: "var(--editor-text-dim, #aaa)", fontSize: 12 }}>El diseño todavía no se ha insertado. Elige una fuente disponible para cada familia ausente.</p>
          {(pendingFigma.document.fonts?.missing || []).map(family => <div key={family} style={{ marginTop: 10 }}>
            <span style={{ display: "block", marginBottom: 4, fontSize: 12 }}>{family}</span>
            <GoogleFontPicker ariaLabel={`Reemplazo para ${family}`} ariaDescribedBy={!fontReplacements[family]?.family ? `font-error-${sourceFingerprint(family)}` : undefined} value={fontReplacements[family]?.family || ""} onChange={(replacement, meta) => {
              setFontError("");
              setFontReplacements(current => ({ ...current, [family]: { family: replacement, variants: meta?.variants, custom: meta?.custom } }));
            }} />
            {!fontReplacements[family]?.family && <div id={`font-error-${sourceFingerprint(family)}`} style={{ marginTop: 4, color: "#ff8b8b", fontSize: 11 }}>Selecciona un reemplazo para {family}.</div>}
          </div>)}
          {fontError && <div role="alert" style={{ marginTop: 8, color: "#ff8b8b", fontSize: 12 }}>{fontError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button type="button" disabled={processing} onClick={() => { setPendingFigma(null); setFontReplacements({}); setFontError(""); }}>Cancelar</button>
            <button type="button" disabled={processing || (pendingFigma.document.fonts?.missing || []).some(family => !fontReplacements[family]?.family)} onClick={() => void finishPendingFigma()}>Aplicar e importar</button>
          </div>
        </section>}

        {statusText && <div role="status" aria-live="polite" aria-busy="true" style={{ marginTop: 14, fontSize: 13 }}>{statusText} <button type="button" onClick={() => operationRef.current?.abort()}>Cancelar</button></div>}
        {error && <div role="alert" style={{ marginTop: 14, padding: "10px 12px", border: "1px solid rgba(255,100,100,.35)", borderRadius: 6, color: "#ff8b8b", fontSize: 12 }}>{error}</div>}
        {report && <div role="status" style={{ marginTop: 14, padding: "10px 12px", border: "1px solid rgba(120,220,170,.3)", borderRadius: 6, fontSize: 12 }}>
          {report.frames} frame(s) importados · {report.editable} capas editables · {report.approximate} aproximadas · {report.raster} conservadas como imagen.
          <div style={{ marginTop: 10, textAlign: "right" }}><button type="button" onClick={closeModal}>Listo</button></div>
        </div>}
      </div>
    </dialog>
  );
}
