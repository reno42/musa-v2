import { useState, useRef, useCallback } from "react";
import * as fabric from "fabric";
import { useToast } from "./Toast";
import { autoRenameObjects, findAllGroups, getTemplateColumns } from "../lib/autoRename";
import { parseCSVInput, csvToJSON, generateCSVTemplate } from "../lib/csvParser";
import { batchSinglePost, batchMultiPosts, batchCarousels } from "../lib/batchEngine";

type BatchTab = "rename" | "single" | "multi" | "carousel";

interface Props {
  fabricRef: React.RefObject<fabric.Canvas | null>;
}

export function BatchPanel({ fabricRef }: Props) {
  const [tab, setTab] = useState<BatchTab>("rename");
  const [renameMode, setRenameMode] = useState<"unico" | "variable" | "carrusel">("unico");
  const [csvSingle, setCsvSingle] = useState("");
  const [csvMulti, setCsvMulti] = useState("");
  const [csvCarousel, setCsvCarousel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const { addToast } = useToast();

  // ─── Auto-Rename ──────────────────────────────────────────
  const handleRename = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const groups = findAllGroups(c);
    if (groups.length === 0) {
      addToast("warning", "No groups found", "Select some grouped objects first (⌘G)");
      return;
    }
    autoRenameObjects(groups, renameMode);
    c.renderAll();
    addToast("success", "Layers renamed!", `${groups.length} groups processed`);
  }, [fabricRef, renameMode, addToast]);

  // ─── Preview columns ──────────────────────────────────────
  const handlePreviewColumns = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const selection = c.getActiveObject();
    if (!selection || selection.type !== "group") {
      addToast("warning", "Select a group", "Select a grouped template frame first");
      return;
    }
    const cols = getTemplateColumns(selection as fabric.Group);
    setPreviewCols(cols);
    if (cols.length === 0) {
      addToast("warning", "No text layers", "This group has no text layers inside");
    } else {
      addToast("info", `${cols.length} columns found`, cols.join(", "));
    }
  }, [fabricRef, addToast]);

  // ─── Download CSV template ─────────────────────────────────
  const handleDownloadTemplate = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const selection = c.getActiveObject();
    if (!selection || selection.type !== "group") {
      addToast("warning", "Select a group", "Select a grouped template frame first");
      return;
    }
    const cols = getTemplateColumns(selection as fabric.Group);
    if (cols.length === 0) {
      addToast("warning", "No text layers", "Rename layers first with the Rename tab");
      return;
    }
    const csv = generateCSVTemplate(cols, "unico");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "template.csv"; a.click();
    URL.revokeObjectURL(url);
    addToast("success", "CSV template downloaded", "Fill it in Google Sheets and paste it back");
  }, [fabricRef, addToast]);

  // ─── Mode 1: Single Post ──────────────────────────────────
  const handleSingle = useCallback(async () => {
    const c = fabricRef.current;
    if (!c || !csvSingle.trim()) {
      addToast("warning", "Paste CSV data", "Need CSV content with matching column headers");
      return;
    }
    const selection = c.getActiveObject();
    if (!selection || selection.type !== "group") {
      addToast("warning", "Select a template group", "Select one grouped frame as template");
      return;
    }

    setGenerating(true);
    try {
      const csvText = await parseCSVInput(csvSingle);
      if (!csvText) { addToast("error", "Invalid CSV", "Could not parse the CSV data"); setGenerating(false); return; }
      const rows = csvToJSON(csvText);
      if (!rows) { addToast("error", "CSV needs headers + data", "First row = column names, rest = values"); setGenerating(false); return; }

      const result = await batchSinglePost(c, selection as fabric.Group, rows);
      if (result.errors.length > 0) {
        addToast("warning", `${result.generated} generated, ${result.skipped} skipped`, result.errors[0]);
      } else {
        addToast("success", `Batch complete!`, `${result.generated} posts generated from ${result.totalRows} rows`);
      }
      setGenerating(false);
    } catch (e) {
      addToast("error", "Batch failed", (e as Error).message);
      setGenerating(false);
    }
  }, [fabricRef, csvSingle, addToast]);

  // ─── Mode 2: Multi Posts ──────────────────────────────────
  const handleMulti = useCallback(async () => {
    const c = fabricRef.current;
    if (!c || !csvMulti.trim()) {
      addToast("warning", "Paste CSV data", "Need CSV with Plantilla column + variable columns");
      return;
    }

    setGenerating(true);
    try {
      const csvText = await parseCSVInput(csvMulti);
      if (!csvText) { addToast("error", "Invalid CSV", "Could not parse"); setGenerating(false); return; }
      const rows = csvToJSON(csvText);
      if (!rows) { addToast("error", "CSV needs headers + data", ""); setGenerating(false); return; }
      if (!rows[0] || rows[0]["Plantilla"] === undefined) {
        addToast("error", "Missing 'Plantilla' column", "First column must be named 'Plantilla'");
        setGenerating(false); return;
      }

      const result = await batchMultiPosts(c, rows);
      if (result.errors.length > 0) {
        addToast("warning", `${result.generated} generated, ${result.skipped} skipped`, result.errors[0]);
      } else {
        addToast("success", `Multi-batch complete!`, `${result.generated} posts from ${result.totalRows} rows`);
      }
      setGenerating(false);
    } catch (e) {
      addToast("error", "Batch failed", (e as Error).message);
      setGenerating(false);
    }
  }, [fabricRef, csvMulti, addToast]);

  // ─── Mode 3: Carousels ────────────────────────────────────
  const handleCarousel = useCallback(async () => {
    const c = fabricRef.current;
    if (!c || !csvCarousel.trim()) {
      addToast("warning", "Paste CSV data", "Need CSV with ID_Carrusel + Plantilla_Slide columns");
      return;
    }

    setGenerating(true);
    try {
      const csvText = await parseCSVInput(csvCarousel);
      if (!csvText) { addToast("error", "Invalid CSV", ""); setGenerating(false); return; }
      const rows = csvToJSON(csvText);
      if (!rows) { addToast("error", "CSV needs headers + data", ""); setGenerating(false); return; }
      if (!rows[0] || rows[0]["ID_Carrusel"] === undefined) {
        addToast("error", "Missing 'ID_Carrusel' column", "Need ID_Carrusel + Plantilla_Slide columns");
        setGenerating(false); return;
      }

      const result = await batchCarousels(c, rows);
      if (result.errors.length > 0) {
        addToast("warning", `${result.generated} slides, ${result.skipped} skipped`, result.errors[0]);
      } else {
        const carouselIds = new Set(rows.map((r) => r["ID_Carrusel"]).filter(Boolean));
        addToast("success", `Carousels done!`, `${result.generated} slides in ${carouselIds.size} carousels`);
      }
      setGenerating(false);
    } catch (e) {
      addToast("error", "Batch failed", (e as Error).message);
      setGenerating(false);
    }
  }, [fabricRef, csvCarousel, addToast]);

  // ─── Styles ────────────────────────────────────────────────
  const tabBtn = (id: BatchTab, label: string, emoji: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        flex: 1, padding: "8px 4px", fontSize: 10, fontWeight: 600, textAlign: "center",
        cursor: "pointer", border: "none", borderBottom: tab === id ? "2px solid var(--ac, #7c6fff)" : "2px solid transparent",
        background: "transparent", color: tab === id ? "var(--tx, #e4e4f0)" : "var(--mu, #5a5a70)",
        transition: "all 0.15s",
      }}
    >
      {emoji} {label}
    </button>
  );

  const csvExample = (mode: string) => {
    if (mode === "single") return `Unico1,Unico2,Unico3\n"Title 1","Sub 1","CTA 1"\n"Title 2","Sub 2","CTA 2"`;
    if (mode === "multi") return `Plantilla,Variable1,Variable2\nPlantilla_1,"Hello","World"\nPlantilla_2,"Foo","Bar"`;
    if (mode === "carousel") return `ID_Carrusel,Plantilla_Slide,Carrusel1,Carrusel2\n1,Slide_1,"Title","Text"\n1,Slide_2,"Next","More"`;
    return "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "8px 10px", borderBottom: "1px solid var(--bd, #1c1c26)",
        fontSize: 11, fontWeight: 600, color: "var(--ac, #7c6fff)", flexShrink: 0,
      }}>
        🪄 Batch-a-mator
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--bd, #1c1c26)", flexShrink: 0 }}>
        {tabBtn("rename", "Rename", "🏷")}
        {tabBtn("single", "Single", "📄")}
        {tabBtn("multi", "Multi", "📑")}
        {tabBtn("carousel", "Carousel", "🎠")}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {/* ── Rename Tab ── */}
        {tab === "rename" && (
          <div>
            <p style={{ fontSize: 11, color: "var(--mu2, #7a7a90)", lineHeight: 1.5, marginBottom: 12 }}>
              Select groups (⌘G) in the canvas and auto-rename their layers for batch processing.
              Text layers get named <b>#Variable1</b>, <b>#Variable2</b>… top to bottom.
            </p>

            <label style={{ fontSize: 10, color: "var(--mu, #5a5a70)", display: "block", marginBottom: 4 }}>Rename mode</label>
            <select
              value={renameMode}
              onChange={(e) => setRenameMode(e.target.value as any)}
              style={{
                width: "100%", padding: 6, borderRadius: 6, marginBottom: 10,
                background: "var(--sf, #111118)", color: "var(--tx, #e4e4f0)",
                border: "1px solid var(--bd, #1c1c26)", fontSize: 11,
              }}
            >
              <option value="unico">📄 Single Post (#Unico1, #Unico2…)</option>
              <option value="variable">📑 Multi Posts (#Variable1, #Variable2…)</option>
              <option value="carrusel">🎠 Carousels (#Carrusel1, #Carrusel2…)</option>
            </select>

            <button
              onClick={handleRename}
              style={{
                width: "100%", padding: 8, borderRadius: 6, marginBottom: 8,
                background: "var(--ac, #7c6fff)", color: "#fff", border: "none",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              🪄 Auto-Rename Layers & Frames
            </button>

            <button
              onClick={handlePreviewColumns}
              style={{
                width: "100%", padding: 6, borderRadius: 6, marginBottom: 8,
                background: "var(--sf, #111118)", color: "var(--mu2, #7a7a90)",
                border: "1px solid var(--bd, #1c1c26)", fontSize: 11, cursor: "pointer",
              }}
            >
              👁 Preview columns
            </button>

            <button
              onClick={handleDownloadTemplate}
              style={{
                width: "100%", padding: 6, borderRadius: 6,
                background: "var(--sf, #111118)", color: "var(--mu2, #7a7a90)",
                border: "1px solid var(--bd, #1c1c26)", fontSize: 11, cursor: "pointer",
              }}
            >
              ⬇ Download CSV template
            </button>

            {previewCols.length > 0 && (
              <div style={{
                marginTop: 10, padding: 8, borderRadius: 6,
                background: "var(--sf, #111118)", border: "1px solid var(--bd, #1c1c26)",
              }}>
                <div style={{ fontSize: 10, color: "var(--mu, #5a5a70)", marginBottom: 4 }}>
                  {previewCols.length} columns detected:
                </div>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "#86efac" }}>
                  {previewCols.join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Single Tab ── */}
        {tab === "single" && (
          <div>
            <p style={{ fontSize: 11, color: "var(--mu2, #7a7a90)", lineHeight: 1.5, marginBottom: 12 }}>
              Select <b>1 template group</b> in the canvas. Column names in CSV must match text layer names (ex: <b>Unico1</b>, <b>Unico2</b>).
            </p>

            <div style={{
              padding: 6, borderRadius: 4, marginBottom: 10,
              background: "#1e1e1e", fontFamily: "monospace", fontSize: 10,
              color: "#00ff00", whiteSpace: "pre-wrap",
            }}>
              {csvExample("single")}
            </div>

            <textarea
              value={csvSingle}
              onChange={(e) => setCsvSingle(e.target.value)}
              placeholder="Paste CSV data here (or Google Sheets URL)..."
              rows={5}
              style={{
                width: "100%", padding: 8, borderRadius: 6, marginBottom: 10,
                background: "var(--sf, #111118)", color: "var(--tx, #e4e4f0)",
                border: "1px solid var(--bd, #1c1c26)", fontSize: 11, resize: "vertical",
                fontFamily: "monospace",
              }}
            />

            <button
              onClick={handleSingle}
              disabled={generating}
              style={{
                width: "100%", padding: 8, borderRadius: 6,
                background: generating ? "var(--mu, #5a5a70)" : "var(--ac, #7c6fff)",
                color: "#fff", border: "none", fontSize: 11, fontWeight: 600, cursor: generating ? "default" : "pointer",
              }}
            >
              {generating ? "⏳ Generating..." : "📄 Generate Single Posts"}
            </button>
          </div>
        )}

        {/* ── Multi Tab ── */}
        {tab === "multi" && (
          <div>
            <p style={{ fontSize: 11, color: "var(--mu2, #7a7a90)", lineHeight: 1.5, marginBottom: 12 }}>
              No selection needed. CSV must have a <b>Plantilla</b> column with template names. The system finds matching groups by name.
            </p>

            <div style={{
              padding: 6, borderRadius: 4, marginBottom: 10,
              background: "#1e1e1e", fontFamily: "monospace", fontSize: 10,
              color: "#00ff00", whiteSpace: "pre-wrap",
            }}>
              {csvExample("multi")}
            </div>

            <textarea
              value={csvMulti}
              onChange={(e) => setCsvMulti(e.target.value)}
              placeholder="Paste CSV data here..."
              rows={5}
              style={{
                width: "100%", padding: 8, borderRadius: 6, marginBottom: 10,
                background: "var(--sf, #111118)", color: "var(--tx, #e4e4f0)",
                border: "1px solid var(--bd, #1c1c26)", fontSize: 11, resize: "vertical",
                fontFamily: "monospace",
              }}
            />

            <button
              onClick={handleMulti}
              disabled={generating}
              style={{
                width: "100%", padding: 8, borderRadius: 6,
                background: generating ? "var(--mu, #5a5a70)" : "var(--ac, #7c6fff)",
                color: "#fff", border: "none", fontSize: 11, fontWeight: 600, cursor: generating ? "default" : "pointer",
              }}
            >
              {generating ? "⏳ Generating..." : "📑 Generate Multi Posts"}
            </button>
          </div>
        )}

        {/* ── Carousel Tab ── */}
        {tab === "carousel" && (
          <div>
            <p style={{ fontSize: 11, color: "var(--mu2, #7a7a90)", lineHeight: 1.5, marginBottom: 12 }}>
              Group slides with <b>ID_Carrusel</b>. Each ID creates a horizontal row. Different IDs stack vertically.
            </p>

            <div style={{
              padding: 6, borderRadius: 4, marginBottom: 10,
              background: "#1e1e1e", fontFamily: "monospace", fontSize: 10,
              color: "#00ff00", whiteSpace: "pre-wrap",
            }}>
              {csvExample("carousel")}
            </div>

            <textarea
              value={csvCarousel}
              onChange={(e) => setCsvCarousel(e.target.value)}
              placeholder="Paste CSV data here..."
              rows={5}
              style={{
                width: "100%", padding: 8, borderRadius: 6, marginBottom: 10,
                background: "var(--sf, #111118)", color: "var(--tx, #e4e4f0)",
                border: "1px solid var(--bd, #1c1c26)", fontSize: 11, resize: "vertical",
                fontFamily: "monospace",
              }}
            />

            <button
              onClick={handleCarousel}
              disabled={generating}
              style={{
                width: "100%", padding: 8, borderRadius: 6,
                background: generating ? "var(--mu, #5a5a70)" : "var(--ac, #7c6fff)",
                color: "#fff", border: "none", fontSize: 11, fontWeight: 600, cursor: generating ? "default" : "pointer",
              }}
            >
              {generating ? "⏳ Generating..." : "🎠 Generate Carousels"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
