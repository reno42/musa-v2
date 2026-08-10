import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { IconFolder } from "../shared/icons";
import { apiFetch } from "../lib/supabase";
import { downloadBlob } from "../lib/download";
import { TARGET_BYTES, recompressStoredImage } from "../lib/imageCompress";
import {
  ID_COLUMN, allColumns, emptyRow, looksLikeUrl, parseCSV, rowsFromCsv, toCSV, type SheetRow,
} from "../lib/contentSheet";
import type { FrameData } from "./DesignFrame";

interface BatchAMatorProps {
  frames: FrameData[];
  /** Controlled by the parent so the canvas can highlight checked frames. */
  checkedFrameIds: Set<string>;
  onCheckedFrameIdsChange: (ids: Set<string>) => void;
  /** Reports which frame (if any) the mouse is hovering in the list, so the parent can highlight it on canvas. */
  onFrameHover?: (frameId: string | null) => void;
  /** Called with the full new frames array (existing + generated duplicates) to commit. */
  onGenerate: (newFrames: FrameData[]) => void;
  /** Needed to re-host images the sheet points at. Without it links are left as typed. */
  workspaceId?: string | null;
  /** The file being worked on — its brand is what generated assets get tagged with. */
  templateId?: string | null;
}

const FRAME_GAP = 100;
const MAX_ROWS = 30;
let generatedFrameSeq = 0;
function createFrameId(): string {
  generatedFrameSeq++;
  return `frame_b${Date.now().toString(36)}_${generatedFrameSeq.toString(36)}`;
}

interface LayerRef {
  frameId: string;
  layerId: string;
}

interface SheetColumn {
  column: string;
  /** text fills textContent; image replaces an <img> src. */
  type: "text" | "image";
  sample: string;
  refs: LayerRef[];
}

/**
 * Auto-detects every text and image layer inside the given frames — no manual
 * `{{slot}}` markup required. Layers sharing a `data-layer-name` become one
 * column, so one value fills every same-named layer across every checked
 * frame (duplicated frames share names like "Headline").
 */
function detectColumns(frames: FrameData[]): SheetColumn[] {
  const byLabel = new Map<string, SheetColumn>();
  const wrapper = document.createElement("div");
  for (const f of frames) {
    if (!f.html) continue;
    wrapper.innerHTML = f.html;
    const collect = (selector: string, type: "text" | "image", read: (el: Element) => string) => {
      wrapper.querySelectorAll(selector).forEach(el => {
        const layerId = el.getAttribute("data-layer-id");
        if (!layerId) return;
        const fallback = type === "image" ? "Imagen" : "Text";
        const label = (el.getAttribute("data-layer-name") || fallback).trim() || fallback;
        const existing = byLabel.get(label);
        if (existing) existing.refs.push({ frameId: f.id, layerId });
        else byLabel.set(label, { column: label, type, sample: read(el), refs: [{ frameId: f.id, layerId }] });
      });
    };
    collect('[data-layer-kind="text"]', "text", el => (el.textContent || "").trim());
    // An <img> is classified as kind="image" by htmlMutations; a photo is as
    // much part of a variant as its headline, so it gets a column too.
    collect('img[data-layer-id]', "image", el => el.getAttribute("src") || "");
  }
  return [...byLabel.values()];
}

/** Writes text into textContent and image URLs into src, by layer id. */
function applyReplacements(
  html: string,
  textByLayerId: Record<string, string>,
  imageByLayerId: Record<string, string>,
): string {
  const entries = Object.entries(textByLayerId).length + Object.entries(imageByLayerId).length;
  if (entries === 0) return html;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  let changed = false;
  for (const [layerId, value] of Object.entries(textByLayerId)) {
    const el = wrapper.querySelector(`[data-layer-id="${CSS.escape(layerId)}"]`);
    if (el) { el.textContent = value; changed = true; }
  }
  for (const [layerId, value] of Object.entries(imageByLayerId)) {
    if (!value) continue;
    const el = wrapper.querySelector(`[data-layer-id="${CSS.escape(layerId)}"]`);
    if (el) { el.setAttribute("src", value); changed = true; }
  }
  return changed ? wrapper.innerHTML : html;
}

export function BatchAMator({
  frames, checkedFrameIds, onCheckedFrameIdsChange, onFrameHover, onGenerate, workspaceId, templateId,
}: BatchAMatorProps) {
  /**
   * The brand every image this run pulls in gets tagged with.
   *
   * An asset is filed under a brand by carrying its name in tags — that is the
   * rule the graph and the table both read. Content Machine uploaded untagged,
   * so a run that pulled twenty photos produced twenty assets nobody could
   * find under the brand they plainly belong to. Read once from the file this
   * panel is working on.
   */
  const [assetBrand, setAssetBrand] = useState("");
  /**
   * The kind an image inherits from the file it was first pulled into.
   *
   * A photo that started as an ad and did well often becomes an organic post
   * later; the asset keeps the label of its FIRST use, and the calendar row
   * carries what it is doing now. So this is provenance, and nothing rewrites
   * it afterwards.
   */
  const [assetKind, setAssetKind] = useState("");
  useEffect(() => {
    if (!templateId) { setAssetBrand(""); return; }
    let cancelled = false;
    void apiFetch<{ success?: boolean; data?: { brand?: string; content_kind?: string } }>(`/api/meta/${templateId}`)
      .then(res => {
        if (cancelled) return;
        setAssetBrand(res?.data?.brand || "");
        setAssetKind(res?.data?.content_kind || "");
      })
      .catch(() => { /* untagged is survivable; unfindable is the old behaviour */ });
    return () => { cancelled = true; };
  }, [templateId]);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checkedFrames = useMemo(() => frames.filter(f => checkedFrameIds.has(f.id)), [frames, checkedFrameIds]);
  const columns = useMemo(() => detectColumns(checkedFrames), [checkedFrames]);
  const columnNames = useMemo(() => columns.map(c => c.column), [columns]);
  const imageColumns = useMemo(
    () => new Set(columns.filter(c => c.type === "image").map(c => c.column)),
    [columns],
  );
  /** Detected columns plus anything a returned CSV brought with it. */
  const sheetColumns = useMemo(() => allColumns(columnNames, rows), [columnNames, rows]);

  // Start the sheet with one row seeded from the frame's own text, so the
  // table is usable the moment the panel opens rather than being an empty
  // grid the user has to guess the shape of.
  useEffect(() => {
    if (columns.length === 0 || rows.length > 0) return;
    const values: Record<string, string> = {};
    for (const c of columns) values[c.column] = c.sample;
    setRows([{ id: emptyRow([]).id, values }]);
  }, [columns, rows.length]);

  const toggleFrame = useCallback((id: string) => {
    const next = new Set(checkedFrameIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onCheckedFrameIdsChange(next);
  }, [checkedFrameIds, onCheckedFrameIdsChange]);

  const setCell = useCallback((rowId: string, column: string, value: string) => {
    setRows(cur => cur.map(r => (r.id === rowId ? { ...r, values: { ...r.values, [column]: value } } : r)));
  }, []);

  const addRow = useCallback(() => {
    setRows(cur => (cur.length >= MAX_ROWS ? cur : [...cur, emptyRow(sheetColumns)]));
  }, [sheetColumns]);

  const removeRow = useCallback((rowId: string) => {
    setRows(cur => cur.filter(r => r.id !== rowId));
  }, []);

  const handleDownloadCsv = useCallback(() => {
    if (sheetColumns.length === 0) {
      setMessage({ text: "Los frames seleccionados no tienen texto ni imágenes detectables.", kind: "error" });
      return;
    }
    const csv = toCSV(sheetColumns, rows.length ? rows : [emptyRow(sheetColumns)]);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "content-machine.csv");
  }, [sheetColumns, rows]);

  /** Load a CSV into the sheet. `andGenerate` skips the review step. */
  const loadCsv = useCallback((text: string, andGenerate: boolean) => {
    const parsed = parseCSV(text);
    if (parsed.rows.length === 0) {
      setMessage({ text: "Ese CSV no tiene filas de datos.", kind: "error" });
      return;
    }
    const loaded = rowsFromCsv(parsed, columnNames);
    const capped = loaded.length > MAX_ROWS;
    setRows(capped ? loaded.slice(0, MAX_ROWS) : loaded);
    setMessage(capped
      ? { text: `Se cargaron las primeras ${MAX_ROWS} filas (máximo soportado).`, kind: "error" }
      : { text: `✓ ${loaded.length} fila${loaded.length === 1 ? "" : "s"} cargada${loaded.length === 1 ? "" : "s"}.`, kind: "success" });
    if (andGenerate) pendingGenerateRef.current = true;
  }, [columnNames]);

  // "Subir y crear" has to wait for the rows to be in state before generating,
  // so the click sets a flag and the effect below runs once they land.
  const pendingGenerateRef = useRef(false);

  const readFile = useCallback((file: File, andGenerate: boolean) => {
    const reader = new FileReader();
    reader.onload = () => loadCsv(reader.result as string, andGenerate);
    reader.readAsText(file);
  }, [loadCsv]);

  /**
   * Re-hosts an image the sheet points at.
   *
   * The server fetches it and puts it in the workspace bucket, so the design
   * stops depending on someone else's link staying alive — and so export,
   * which reads pixels, is not blocked by another origin. Only direct image
   * URLs work: a Drive or SharePoint "share" link answers with an HTML login
   * page, not an image, and no amount of trying changes that.
   */
  const rehostCache = useRef(new Map<string, string>());
  const rehostImage = useCallback(async (rawUrl: string, name: string): Promise<string> => {
    const url = rawUrl.trim();
    if (!looksLikeUrl(url) || !workspaceId) return url;
    const cached = rehostCache.current.get(url);
    if (cached) return cached;
    try {
      const res = await apiFetch<{ success?: boolean; url?: string; assetId?: string; sizeBytes?: number; error?: string }>(
        "/api/assets/upload",
        { method: "POST", body: JSON.stringify({ name, url, workspaceId, tags: [assetBrand, assetKind].filter(Boolean) }) },
      );
      let hosted = res?.url;
      if (!hosted) throw new Error(res?.error || "El servidor no devolvió una URL");

      // Second pass. The server has no image library, and hosts that do not
      // resize on request hand over whatever they had. Now that the bytes are
      // in our own bucket the browser can finally read them, so it shrinks the
      // image and overwrites the stored copy under the same id. Best effort —
      // a failure here leaves the working original alone.
      if (res.assetId && (res.sizeBytes ?? 0) > TARGET_BYTES) {
        const smaller = await recompressStoredImage(hosted);
        if (smaller) {
          const replaced = await apiFetch<{ url?: string }>("/api/assets/upload", {
            method: "POST",
            body: JSON.stringify({
              name, workspaceId, data: smaller.dataUrl, replaceAssetId: res.assetId,
              tags: [assetBrand, assetKind].filter(Boolean),
            }),
          });
          if (replaced?.url) hosted = replaced.url;
        }
      }

      rehostCache.current.set(url, hosted);
      return hosted;
    } catch (e) {
      // Keep the original link rather than dropping the image: a design with a
      // hotlinked photo still looks right on screen, and the message says which
      // one could not be brought in.
      const detail = e instanceof Error ? e.message : String(e);
      failedImagesRef.current.push(`${name}: ${detail}`);
      return url;
    }
  }, [workspaceId, assetBrand, assetKind]);
  const failedImagesRef = useRef<string[]>([]);

  const handleGenerate = useCallback(async () => {
    if (checkedFrames.length === 0) {
      setMessage({ text: "Selecciona al menos un frame para duplicar.", kind: "error" });
      return;
    }
    const usable = rows.filter(r => Object.values(r.values).some(v => (v || "").trim() !== ""));
    if (usable.length === 0) {
      setMessage({ text: "Llena al menos una fila de la tabla.", kind: "error" });
      return;
    }
    setGenerating(true);
    setMessage(null);
    failedImagesRef.current = [];

    try {
      const groupMinX = Math.min(...checkedFrames.map(f => f.x));
      const groupMinY = Math.min(...checkedFrames.map(f => f.y));
      const groupMaxY = Math.max(...checkedFrames.map(f => f.y + f.height));
      const groupHeight = groupMaxY - groupMinY;
      const startX = Math.max(...frames.map(f => f.x + f.width), 0) + FRAME_GAP;
      const dx = startX - groupMinX;

      const newFrames: FrameData[] = [];
      for (let rowIdx = 0; rowIdx < usable.length; rowIdx++) {
        const row = usable[rowIdx];
        setProgress(`Fila ${rowIdx + 1} de ${usable.length}`);
        const dy = rowIdx * (groupHeight + FRAME_GAP);
        const label = row.values.name || row.values.title || row.values.headline
          || (columnNames[0] && row.values[columnNames[0]]) || row.id;

        const textByFrame = new Map<string, Record<string, string>>();
        const imageByFrame = new Map<string, Record<string, string>>();
        for (const col of columns) {
          const value = row.values[col.column];
          if (value === undefined || value === "") continue;
          const resolved = col.type === "image"
            ? await rehostImage(value, `${col.column} — ${label}`)
            : value;
          const target = col.type === "image" ? imageByFrame : textByFrame;
          for (const ref of col.refs) {
            if (!target.has(ref.frameId)) target.set(ref.frameId, {});
            target.get(ref.frameId)![ref.layerId] = resolved;
          }
        }

        for (const f of checkedFrames) {
          newFrames.push({
            ...f,
            id: createFrameId(),
            name: `${f.name} — ${label}`,
            x: f.x + dx,
            y: f.y + dy,
            html: applyReplacements(f.html, textByFrame.get(f.id) || {}, imageByFrame.get(f.id) || {}),
          });
        }
      }

      onGenerate([...frames, ...newFrames]);
      const failed = failedImagesRef.current;
      setMessage(failed.length
        ? {
          text: `✓ ${newFrames.length} frames generados. ${failed.length} imagen${failed.length === 1 ? "" : "es"} no se pudo traer y quedó como enlace externo — ${failed[0]}`,
          kind: "error",
        }
        : {
          text: `✓ ${newFrames.length} frame${newFrames.length === 1 ? "" : "s"} generado${newFrames.length === 1 ? "" : "s"} a partir de ${usable.length} fila${usable.length === 1 ? "" : "s"}.`,
          kind: "success",
        });
    } catch (e) {
      setMessage({ text: `No se pudo generar: ${e instanceof Error ? e.message : String(e)}`, kind: "error" });
    } finally {
      setGenerating(false);
      setProgress("");
    }
  }, [checkedFrames, rows, frames, columns, columnNames, onGenerate, rehostImage]);

  // Runs the generation that "Subir y crear" asked for, once the rows landed.
  useEffect(() => {
    if (!pendingGenerateRef.current || rows.length === 0) return;
    pendingGenerateRef.current = false;
    void handleGenerate();
  }, [rows, handleGenerate]);

  const filledRows = rows.filter(r => Object.values(r.values).some(v => (v || "").trim() !== "")).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, overflow: "auto", flex: 1 }}>
      <div style={{ fontSize: 11.5, color: "#9a9484", lineHeight: 1.5 }}>
        Una fila por diseño. Escribe aquí, o descarga el CSV para que alguien más lo llene
        y vuelve a subirlo — cada fila lleva su <code style={{ color: "#c8b898" }}>id</code> para
        reconocerla cuando regrese.
      </div>

      {/* Frame selection */}
      <div>
        <div style={batchSectionLabelStyle}>Frames a duplicar ({checkedFrameIds.size} de {frames.length} seleccionados)</div>
        {frames.length === 0 ? (
          <div style={{ fontSize: 12, color: "#7a7668" }}>Este template no tiene frames todavía.</div>
        ) : (
          <div className="batch-frame-list" style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: 4 }}>
            {frames.map(f => {
              const checked = checkedFrameIds.has(f.id);
              return (
                <label
                  key={f.id}
                  onMouseEnter={() => onFrameHover?.(f.id)}
                  onMouseLeave={() => onFrameHover?.(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", fontSize: 12,
                    color: "#f0ebe0", cursor: "pointer", borderRadius: 4,
                    background: checked ? "rgba(200,184,152,0.16)" : "transparent",
                    transition: "background 0.1s ease",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleFrame(f.id)} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ color: "#7a7668", fontSize: 10, flexShrink: 0 }}>{f.width}×{f.height}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The sheet ── */}
      <div>
        <div style={batchSectionLabelStyle}>
          Tabla de contenido ({filledRows} de {rows.length} fila{rows.length === 1 ? "" : "s"} con datos)
        </div>
        {sheetColumns.length === 0 ? (
          <div style={{ fontSize: 12, color: "#7a7668" }}>
            Selecciona un frame con texto o imágenes para armar la tabla.
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
                <thead>
                  <tr style={{ background: "rgba(15,15,15,0.6)" }}>
                    <th style={sheetHeadStyle} title="Identificador de la fila. Viaja en el CSV.">id</th>
                    {sheetColumns.map(c => (
                      <th key={c} style={{ ...sheetHeadStyle, minWidth: 130 }}>
                        {c}
                        {imageColumns.has(c) && (
                          <span style={{ color: "#c8b898", marginLeft: 4 }} title="Pega el enlace directo de la imagen">
                            ◧
                          </span>
                        )}
                      </th>
                    ))}
                    <th style={{ ...sheetHeadStyle, width: 26 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}>
                      <td style={{ ...sheetCellStyle, color: "#7a7668", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                        {row.id}
                      </td>
                      {sheetColumns.map(c => (
                        <td key={c} style={sheetCellStyle}>
                          <input
                            value={row.values[c] ?? ""}
                            onChange={e => setCell(row.id, c, e.target.value)}
                            placeholder={imageColumns.has(c) ? "https://…" : ""}
                            aria-label={`${c} fila ${row.id}`}
                            style={sheetInputStyle}
                          />
                        </td>
                      ))}
                      <td style={sheetCellStyle}>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          title="Eliminar fila"
                          aria-label={`Eliminar fila ${row.id}`}
                          style={{
                            background: "transparent", border: "none", color: "#7a7668",
                            cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px",
                          }}
                        >×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_ROWS}
              style={{
                marginTop: 6, width: "100%", padding: "6px 0", fontSize: 12,
                border: "1px dashed rgba(200,184,152,0.25)", borderRadius: 6,
                background: "transparent", color: rows.length >= MAX_ROWS ? "#5a5648" : "#c8b898",
                cursor: rows.length >= MAX_ROWS ? "not-allowed" : "pointer",
              }}
            >
              + Agregar fila{rows.length >= MAX_ROWS ? ` (máximo ${MAX_ROWS})` : ""}
            </button>
          </>
        )}
      </div>

      {/* CSV in and out */}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={handleDownloadCsv} disabled={sheetColumns.length === 0} style={batchSecondaryBtnStyle(sheetColumns.length === 0)}>
          ⇩ Descargar CSV
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} style={batchSecondaryBtnStyle(false)}>
          ⇧ Subir CSV
        </button>
      </div>
      <button
        type="button"
        aria-label="Subir CSV y generar"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) readFile(file, false);
        }}
        style={batchDropZoneStyle}
        onClick={() => { pendingGenerateRef.current = false; fileRef.current?.click(); }}
      >
        <div style={{ marginBottom: 4 }}><IconFolder size={22} color="#7a7668" /></div>
        <div style={{ fontSize: 12, color: "#7a7668" }}>Suelta aquí el CSV que te devolvieron</div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          aria-label="CSV file input"
          style={{ display: "none" }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) readFile(file, generateOnUploadRef.current);
            generateOnUploadRef.current = false;
            e.target.value = "";
          }}
        />
      </button>

      {message && (
        <div style={{
          padding: "8px 12px", borderRadius: 6, fontSize: 12, lineHeight: 1.5,
          background: message.kind === "error" ? "rgba(248,113,113,0.08)" : "rgba(74,222,128,0.08)",
          color: message.kind === "error" ? "#f87171" : "#4ade80",
        }}>
          {message.text}
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={checkedFrameIds.size === 0 || filledRows === 0 || generating}
        style={batchGenerateBtnStyle(checkedFrameIds.size === 0 || filledRows === 0, generating)}
      >
        {generating ? (progress || "Generando…") : `Generar ${filledRows || ""} diseño${filledRows === 1 ? "" : "s"}`.trim()}
      </button>
      <button
        type="button"
        onClick={() => { generateOnUploadRef.current = true; fileRef.current?.click(); }}
        disabled={checkedFrameIds.size === 0 || generating}
        style={batchSecondaryBtnStyle(checkedFrameIds.size === 0 || generating)}
        title="Carga el CSV y genera de inmediato, sin revisar la tabla"
      >
        Subir CSV y crear de una
      </button>
    </div>
  );
}

/** Set just before opening the picker, read once the file arrives. */
const generateOnUploadRef = { current: false };

const batchSectionLabelStyle: React.CSSProperties = {
  fontSize: 11, color: "#7a7668", marginBottom: 6,
  textTransform: "uppercase", letterSpacing: 1,
};
const sheetHeadStyle: React.CSSProperties = {
  padding: "5px 8px", textAlign: "left", color: "#7a7668", fontWeight: 400,
  borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap",
};
const sheetCellStyle: React.CSSProperties = {
  padding: "2px 4px", borderBottom: "1px solid rgba(255,255,255,0.03)",
  color: "#f0ebe0", verticalAlign: "middle",
};
const sheetInputStyle: React.CSSProperties = {
  width: "100%", minWidth: 120, background: "transparent",
  border: "1px solid transparent", borderRadius: 4, padding: "3px 5px",
  color: "#f0ebe0", fontSize: 11, fontFamily: "inherit", outline: "none",
};
const batchDropZoneStyle: React.CSSProperties = {
  border: "1px dashed rgba(200, 184, 152, 0.12)", borderRadius: 8, padding: 14,
  textAlign: "center", cursor: "pointer", width: "100%", background: "transparent",
};
function batchSecondaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "8px 0", border: "1px solid rgba(200,184,152,0.2)", borderRadius: 6,
    background: "rgba(200,184,152,0.06)", color: disabled ? "#5a5648" : "#c8b898",
    fontSize: 12, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer",
  };
}
function batchGenerateBtnStyle(disabled: boolean, generating: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "10px 0", border: "none", borderRadius: 8,
    background: disabled ? "rgba(200, 184, 152, 0.05)" : "#c8b898",
    color: "#fff", fontSize: 13, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: generating ? 0.7 : 1,
  };
}
