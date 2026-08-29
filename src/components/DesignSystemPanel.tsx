import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/supabase";
import { downloadBlob } from "../lib/download";

// ═══════════════════════════════════════════════════════════════
// DesignSystemPanel — the brand's Design System file, in one place.
//
// The rule is "one brand = ONE Design System file" (v35): everything the
// user extracts or adds goes to that single file, and the AI reads it when
// working for that brand. This panel is the editor-side surface for that:
// pick the brand, see the file everything lands in, extract the selected
// frames' style into it, or append the frames themselves.
// ═══════════════════════════════════════════════════════════════

interface BrandRow {
  id: string;
  name: string;
  design_system_template_id: string | null;
  brand_guideline_id: string | null;
  has_design_system: boolean;
}

interface Props {
  workspaceId?: string;
  templateId?: string;
  templateName?: string;
  frames: Array<{ id: string; name: string }>;
  selectedFrameIds: Set<string>;
  selectedFrameId?: string | null;
  onToast?: (msg: string, type?: "info" | "success" | "error") => void;
  /** Opens a template in the editor — used by "Abrir archivo" on the DS file. */
  onOpenTemplate?: (id: string) => void;
}

const panelStyle: React.CSSProperties = {
  color: "#e0e0e0", fontSize: 13, display: "flex", flexDirection: "column",
  height: "100%", overflowY: "auto", padding: 14, gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.08)", padding: 12,
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
  padding: "8px 14px", minHeight: 40, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: "rgba(200,184,152,0.16)", color: "#e8dcc0",
  border: "1px solid rgba(200,184,152,0.35)",
};

const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 40, padding: "8px 12px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 6, color: "#e0e0e0", fontSize: 12,
  fontFamily: "inherit",
};

async function callMcp<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await apiFetch<any>("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: method, arguments: params }, id: 1 }),
  });
  if (response?.error) throw new Error(response.error.message || "MCP error");
  const result = response?.result;
  if (result?.isError) throw new Error(result?.content?.[0]?.text || "MCP error");
  const text = result?.content?.[0]?.text;
  if (typeof text === "string") {
    try { return JSON.parse(text) as T; } catch { throw new Error(`Respuesta inválida de ${method}`); }
  }
  if (result === undefined) throw new Error(`Sin respuesta de ${method}`);
  return result as T;
}

export function DesignSystemPanel({
  workspaceId, templateId, templateName, frames,
  selectedFrameIds, selectedFrameId, onToast, onOpenTemplate,
}: Props) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [busy, setBusy] = useState<"" | "create" | "extract" | "add" | "export">("");

  const selectedBrand = brands.find(b => b.id === selectedBrandId) || null;
  const selectedFrameNames = React.useMemo(() => {
    const ids = selectedFrameIds.size > 0 ? [...selectedFrameIds] : selectedFrameId ? [selectedFrameId] : [];
    return ids.map(id => frames.find(f => f.id === id)?.name || id);
  }, [selectedFrameIds, selectedFrameId, frames]);

  const loadBrands = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: BrandRow[] }>(`/api/workspaces/${workspaceId}/brands`);
      const list = Array.isArray(res?.data) ? res.data : [];
      setBrands(list);
      // Keep the current selection valid; prefer a brand that still lacks its DS
      // so the "crear con un click" flow is front and center.
      setSelectedBrandId(cur => {
        if (cur && list.some(b => b.id === cur)) return cur;
        const missing = list.find(b => !b.has_design_system);
        return (missing || list[0])?.id || "";
      });
    } catch (e: any) {
      onToast?.("No se pudieron cargar las marcas: " + (e?.message || "error"), "error");
    } finally { setLoading(false); }
  }, [workspaceId, onToast]);

  useEffect(() => { loadBrands(); }, [loadBrands]);

  const createDesignSystem = useCallback(async () => {
    if (!workspaceId || !selectedBrand) return;
    setBusy("create");
    try {
      const res = await apiFetch<{ success: boolean; templateId?: string; data?: any; message?: string }>(
        `/api/workspaces/${workspaceId}/brands/${selectedBrand.id}/design-system`,
        { method: "POST" },
      );
      const templateId = res?.templateId || res?.data?.designSystemTemplateId || res?.data?.design_system_template_id || null;
      onToast?.(templateId
        ? `✓ Design System listo para "${selectedBrand.name}".`
        : `✓ ${res?.message || "Design System creado."}`, "success");
      await loadBrands();
    } catch (e: any) {
      onToast?.("No se pudo crear el Design System: " + (e?.message || "error"), "error");
    } finally { setBusy(""); }
  }, [workspaceId, selectedBrand, loadBrands, onToast]);

  const extractStyle = useCallback(async () => {
    const ids = selectedFrameIds.size > 0 ? [...selectedFrameIds] : selectedFrameId ? [selectedFrameId] : [];
    if (!templateId || !selectedBrand) return;
    if (ids.length === 0) { onToast?.("Selecciona uno o varios frames primero.", "error"); return; }
    setBusy("extract");
    try {
      await callMcp("generate_design_artifacts", {
        templateId, action: "publish", brandName: selectedBrand.name, frameIds: ids,
      });
      onToast?.(`✓ Estilo extraído y guardado en el Design System de "${selectedBrand.name}".`, "success");
    } catch (e: any) {
      onToast?.("No se pudo extraer el estilo: " + (e?.message || "error"), "error");
    } finally { setBusy(""); }
  }, [templateId, selectedBrand, selectedFrameIds, selectedFrameId, onToast]);

  const addFrames = useCallback(async () => {
    const ids = selectedFrameIds.size > 0 ? [...selectedFrameIds] : selectedFrameId ? [selectedFrameId] : [];
    if (!workspaceId || !templateId || !selectedBrand) return;
    if (!selectedBrand.brand_guideline_id) { onToast?.("La marca aún no tiene archivo Design System — créalo primero.", "error"); return; }
    if (ids.length === 0) { onToast?.("Selecciona uno o varios frames primero.", "error"); return; }
    setBusy("add");
    try {
      let ok = 0;
      for (const frameId of ids) {
        const label = frames.find(f => f.id === frameId)?.name || undefined;
        await callMcp("add_frame_to_brand", {
          workspaceId, brandId: selectedBrand.brand_guideline_id, sourceTemplateId: templateId, sourceFrameId: frameId, label,
        });
        ok += 1;
      }
      onToast?.(`✓ ${ok} frame${ok === 1 ? "" : "s"} agregado${ok === 1 ? "" : "s"} al archivo Design System.`, "success");
    } catch (e: any) {
      onToast?.("No se pudo agregar al Design System: " + (e?.message || "error"), "error");
    } finally { setBusy(""); }
  }, [workspaceId, templateId, selectedBrand, selectedFrameIds, selectedFrameId, frames, onToast]);

  const exportLocalCopy = useCallback(async () => {
    if (!templateId || !templateName) return;
    setBusy("export");
    try {
      const data = await callMcp("generate_design_artifacts", { templateId, action: "generate" });
      const safe = templateName.replace(/[<>:"/\\|?* ]/g, "_");
      const downloads = [
        { name: `${safe}_DESIGN.md`, content: data.designMd, type: "text/markdown" },
        { name: `${safe}_tokens.json`, content: data.tokensJson, type: "application/json" },
        { name: `${safe}_shared.css`, content: data.sharedCss, type: "text/css" },
      ];
      for (const d of downloads) {
        if (!d.content) continue;
        downloadBlob(new Blob([d.content], { type: d.type }), d.name);
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (e: any) {
      onToast?.("No se pudo exportar la copia local: " + (e?.message || "error"), "error");
    } finally { setBusy(""); }
  }, [templateId, templateName, onToast]);

  const noBrands = !loading && brands.length === 0;

  return (
    <div style={panelStyle} data-tour="design-system-panel">
      <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#7a7668" }}>
        Design System de la marca
      </div>

      {noBrands && (
        <div style={{ ...cardStyle, color: "#7a7668", fontSize: 12, lineHeight: 1.6 }}>
          Este workspace todavía no tiene marcas. Crea una desde el CRM o desde
          el panel <strong>Info</strong> de este archivo — cada marca nueva nace
          con su archivo Design System.
        </div>
      )}

      {brands.length > 0 && (
        <>
          <div>
            <label htmlFor="dsp-brand" style={{ fontSize: 11, color: "#aaa", marginBottom: 4, display: "block" }}>
              Marca
            </label>
            <select
              id="dsp-brand"
              value={selectedBrandId}
              onChange={e => setSelectedBrandId(e.target.value)}
              style={inputStyle}
            >
              {brands.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.has_design_system ? "" : "  · sin Design System"}
                </option>
              ))}
            </select>
          </div>

          {selectedBrand && !selectedBrand.has_design_system && (
            <div style={{ ...cardStyle, borderColor: "rgba(252,165,165,0.35)" }}>
              <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8, lineHeight: 1.5 }}>
                ⚠️ <strong>{selectedBrand.name}</strong> aún no tiene archivo Design System.
                Tu IA no tendrá de dónde sacar colores, tipografías ni recursos al
                diseñar para esta marca.
              </div>
              <button type="button" style={primaryBtnStyle} disabled={busy !== ""}
                onClick={createDesignSystem}>
                {busy === "create" ? "Creando…" : "Crear Design System (1 click)"}
              </button>
            </div>
          )}

          {selectedBrand?.has_design_system && (
            <div style={cardStyle}>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#7a7668", marginBottom: 6 }}>
                Archivo Design System
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                🎨 DesignSystem_{selectedBrand.name}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedBrand.design_system_template_id && (
                  <button type="button" style={btnStyle}
                    onClick={() => onOpenTemplate?.(selectedBrand.design_system_template_id!)}>
                    Abrir archivo
                  </button>
                )}
                <button type="button" style={btnStyle} disabled={busy !== ""}
                  onClick={exportLocalCopy}>
                  {busy === "export" ? "Exportando…" : "Exportar copia local"}
                </button>
              </div>
            </div>
          )}

          <div style={{ ...cardStyle, color: "#a8a294", fontSize: 11.5, lineHeight: 1.65 }}>
            💡 Puedes alimentar el Design System <strong>constantemente</strong>:
            selecciona uno o varios frames en el canvas, elige la marca arriba y
            guarda ahí lo extraído. Todo lo que agregues queda en ESTE archivo, y
            tu IA lo lee automáticamente cada vez que trabaja para la marca.
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 12, marginBottom: 10, color: "#ccc" }}>
              {selectedFrameNames.length > 0
                ? `${selectedFrameNames.length} frame${selectedFrameNames.length === 1 ? "" : "s"} seleccionado${selectedFrameNames.length === 1 ? "" : "s"}: ${selectedFrameNames.slice(0, 3).join(", ")}${selectedFrameNames.length > 3 ? "…" : ""}`
                : "Sin frames seleccionados — selecciona frames en el canvas."}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" style={primaryBtnStyle}
                disabled={busy !== "" || !templateId || !selectedBrand || selectedFrameNames.length === 0}
                onClick={extractStyle}>
                {busy === "extract" ? "Extrayendo…" : "Extraer estilo y guardar en el Design System"}
              </button>
              <button type="button" style={btnStyle}
                disabled={busy !== "" || !templateId || !selectedBrand || selectedFrameNames.length === 0}
                onClick={addFrames}>
                {busy === "add" ? "Agregando…" : "Agregar los frames al archivo Design System"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#7a7668", marginTop: 8, lineHeight: 1.5 }}>
              "Extraer" guarda colores/tipografías/CSS como tokens; "Agregar" copia
              los frames como diseños de referencia dentro del archivo. El original
              nunca se modifica.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
