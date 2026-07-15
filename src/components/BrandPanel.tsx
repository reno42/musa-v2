import React, { useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface Props {
  templateId: string;
  workspaceId?: string;
  onCssUpdated: (css: string) => void;
}

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)", padding: 12,
  color: "#e0e0e0", fontSize: 12, overflow: "auto",
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
  padding: "6px 10px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", width: "100%", textAlign: "left" as const,
};

export function BrandPanel({ templateId, workspaceId, onCssUpdated }: Props) {
  const [brandCheck, setBrandCheck] = useState<any>(null);
  const [contrast, setContrast] = useState<any>(null);
  const [a11y, setA11y] = useState<any>(null);
  const [loading, setLoading] = useState("");
  const [saveBrandName, setSaveBrandName] = useState("");
  const [showSaveBrand, setShowSaveBrand] = useState(false);
  const [savedBrands, setSavedBrands] = useState<any[]>([]);
  const [brandsLoaded, setBrandsLoaded] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [extraction, setExtraction] = useState<any>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const runCheck = useCallback(async (method: string) => {
    setLoading(method);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method,
          params: method === "validate_brand"
            ? { templateId, brandId: "default" }
            : { templateId },
          id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
      if (method === "validate_brand") setBrandCheck(data);
      if (method === "check_contrast") setContrast(data);
      if (method === "check_accessibility") setA11y(data);
    } catch { /* ignore */ }
    setLoading("");
  }, [templateId]);

  const loadBrands = useCallback(async () => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "get_brands",
          params: {},
          id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
      setSavedBrands(data?.brands || []);
    } catch { setSavedBrands([]); }
    setBrandsLoaded(true);
  }, []);

  const handleSaveBrand = useCallback(async () => {
    const name = saveBrandName.trim();
    if (!name) return;
    setLoading("save");
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "register_brand",
          params: { templateId, name, brandId: "brand_" + Date.now() },
          id: 0,
        }),
      });
      setSaveBrandName("");
      setShowSaveBrand(false);
      setApplyMsg("✓ Brand saved!");
      setTimeout(() => setApplyMsg(""), 2000);
    } catch { setApplyMsg("✗ Save failed"); }
    setLoading("");
  }, [saveBrandName, templateId]);

  const handleApplyBrand = useCallback(async (brandId: string) => {
    setLoading("apply_" + brandId);
    setApplyMsg("");
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "apply_brand",
          params: { templateId, brandId },
          id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
      if (data?.css) {
        onCssUpdated(data.css);
        setApplyMsg("✓ Brand applied!");
        setTimeout(() => setApplyMsg(""), 2000);
      }
    } catch { setApplyMsg("✗ Apply failed"); }
    setLoading("");
  }, [templateId, onCssUpdated]);

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Brand & A11y</div>

      {applyMsg && (
        <div style={{ fontSize: 11, marginBottom: 4, color: applyMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>
          {applyMsg}
        </div>
      )}

      {/* Save Brand */}
      {showSaveBrand ? (
        <div style={{ marginBottom: 4 }}>
          <input
            value={saveBrandName}
            onChange={e => setSaveBrandName(e.target.value)}
            placeholder="Brand name..."
            onKeyDown={e => { if (e.key === "Enter") handleSaveBrand(); if (e.key === "Escape") setShowSaveBrand(false); }}
            style={{
              width: "100%", padding: "4px 8px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
              color: "#e0e0e0", fontSize: 11, outline: "none", marginBottom: 4,
            }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={handleSaveBrand} disabled={loading === "save"} style={{ ...btnStyle, width: "auto", flex: 1, fontSize: 10 }}>
              {loading === "save" ? "..." : "Save"}
            </button>
            <button onClick={() => setShowSaveBrand(false)} style={{ ...btnStyle, width: "auto", flex: 1, fontSize: 10 }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowSaveBrand(true)} style={btnStyle} title="Save current CSS as a reusable brand system">
          💾 Save as Brand
        </button>
      )}

      {/* Load/Apply Brands */}
      {!brandsLoaded ? (
        <button onClick={loadBrands} style={{ ...btnStyle, marginTop: 4 }}>
          📂 Load Brands
        </button>
      ) : savedBrands.length > 0 ? (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>Apply brand:</div>
          {savedBrands.slice(0, 5).map((b: any) => (
            <button
              key={b.id || b.brandId}
              onClick={() => handleApplyBrand(b.id || b.brandId)}
              disabled={loading === "apply_" + (b.id || b.brandId)}
              style={{ ...btnStyle, fontSize: 10, padding: "4px 8px", marginBottom: 2 }}
            >
              {loading === "apply_" + (b.id || b.brandId) ? "..." : "🎨"} {b.name || "Brand"}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>No brands saved yet.</div>
      )}

      <button onClick={() => runCheck("check_contrast")} disabled={loading !== ""} style={btnStyle}>
        {loading === "check_contrast" ? "..." : "Check Contrast"}
      </button>
      {contrast && (
        <div style={{ marginTop: 4, fontSize: 11 }}>
          {contrast.passes ? (
            <span style={{ color: "#4ade80" }}>All elements pass WCAG contrast</span>
          ) : (
            <span style={{ color: "#f87171" }}>{(contrast.elements || []).filter((e: any) => !e.passesAA).length} elements fail AA</span>
          )}
          {(contrast.elements || []).slice(0, 3).map((e: any, i: number) => (
            <div key={i} style={{ color: e.passesAA ? "#4ade80" : "#f87171", fontSize: 10, marginTop: 2 }}>
              {e.selector}: {e.ratio}:1 {e.passesAA ? "AA" : "FAIL"}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => runCheck("check_accessibility")} disabled={loading !== ""} style={{ ...btnStyle, marginTop: 4 }}>
        {loading === "check_accessibility" ? "..." : "Check Accessibility"}
      </button>
      {a11y && (
        <div style={{ marginTop: 4, fontSize: 11 }}>
          <span style={{ color: a11y.score >= 80 ? "#4ade80" : "#fbbf24" }}>Score: {a11y.score}/100</span>
          {(a11y.issues || []).slice(0, 3).map((is: any, i: number) => (
            <div key={i} style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
              {is.severity === "error" ? "Err" : "Warn"}: {is.description} [{is.wcag}]
            </div>
          ))}
        </div>
      )}

      <button onClick={() => runCheck("validate_brand")} disabled={loading !== ""} style={{ ...btnStyle, marginTop: 4 }}>
        {loading === "validate_brand" ? "..." : "Validate Brand"}
      </button>
      {brandCheck && (
        <div style={{ marginTop: 4, fontSize: 11, color: brandCheck.passed ? "#4ade80" : "#fbbf24" }}>
          Score: {brandCheck.score}% · {brandCheck.passed ? "Passed" : "Issues found"}
        </div>
      )}

      {/* Auto-fix brand */}
      <button onClick={async () => {
        setLoading("autofix");
        try {
          await apiFetch<any>("/mcp", {
            method: "POST",
            body: JSON.stringify({ jsonrpc: "2.0", method: "auto_fix_brand", params: { templateId, brandId: "default" }, id: 0 }),
          });
          setApplyMsg("✓ Auto-fix applied!");
          setTimeout(() => setApplyMsg(""), 2000);
        } catch { setApplyMsg("✗ Auto-fix failed"); }
        setLoading("");
      }} disabled={loading !== ""} style={{ ...btnStyle, marginTop: 4 }}>
        {loading === "autofix" ? "..." : "🔧 Auto-Fix Brand"}
      </button>

      {/* Generate brand manual */}
      <button onClick={async () => {
        setLoading("manual");
        try {
          const res = await apiFetch<any>("/mcp", {
            method: "POST",
            body: JSON.stringify({ jsonrpc: "2.0", method: "generate_brand_manual", params: { templateId }, id: 0 }),
          });
          const text = res?.result?.content?.[0]?.text;
          const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
          if (data?.manual || data?.markdown) {
            const md = data.manual || data.markdown;
            const blob = new Blob([md], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "brand_manual.md"; a.click();
            URL.revokeObjectURL(url);
            setApplyMsg("✓ Manual downloaded!");
          }
          setTimeout(() => setApplyMsg(""), 2000);
        } catch { setApplyMsg("✗ Manual failed"); }
        setLoading("");
      }} disabled={loading !== ""} style={{ ...btnStyle, marginTop: 4 }}>
        {loading === "manual" ? "..." : "📖 Brand Manual"}
      </button>

      {/* Suggest color palette */}
      <button onClick={async () => {
        setLoading("palette");
        try {
          const res = await apiFetch<any>("/mcp", {
            method: "POST",
            body: JSON.stringify({ jsonrpc: "2.0", method: "suggest_color_palette", params: { templateId, mode: "complementary" }, id: 0 }),
          });
          const text = res?.result?.content?.[0]?.text;
          const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
          const palette = data?.palette || data?.colors || [];
          if (palette.length > 0) {
            const swatches = palette.map((c: any) => typeof c === "string" ? c : c.hex || "").filter(Boolean).join(", ");
            setApplyMsg(`✓ Palette: ${swatches}`);
          } else {
            setApplyMsg("✓ Palette generated");
          }
          setTimeout(() => setApplyMsg(""), 3000);
        } catch { setApplyMsg("✗ Palette failed"); }
        setLoading("");
      }} disabled={loading !== ""} style={{ ...btnStyle, marginTop: 4 }}>
        {loading === "palette" ? "..." : "🎨 Suggest Palette"}
      </button>

      {/* Extract Design System */}
      <button onClick={async () => {
        setExtractLoading(true);
        setExtraction(null);
        setApplyMsg("");
        try {
          const res = await apiFetch<any>("/mcp", {
            method: "POST",
            body: JSON.stringify({
              jsonrpc: "2.0", method: "extract_design_system",
              params: { templateIds: [templateId], workspaceId: workspaceId || undefined, name: "Current Template" },
              id: 0,
            }),
          });
          const text = res?.result?.content?.[0]?.text;
          const data = text ? (typeof text === "string" ? JSON.parse(text) : text) : null;
          if (data?.extraction) {
            setExtraction({ extraction: data.extraction, artifacts: data.artifacts || {} });
            setManualUrl(data.manualUrl || null);
            const colorCount = (data.extraction.colors || []).filter((c: any) => c.role).length;
            const compCount = (data.extraction.components || []).length;
            setApplyMsg(`✓ Extracted: ${colorCount} colors, ${compCount} components`);
          } else {
            setApplyMsg("✓ Design system extracted");
          }
          setTimeout(() => setApplyMsg(""), 4000);
        } catch { setApplyMsg("✗ Extraction failed"); }
        setExtractLoading(false);
      }} disabled={extractLoading} style={{ ...btnStyle, marginTop: 4, background: extractLoading ? undefined : "rgba(139,92,246,0.1)", borderColor: extractLoading ? undefined : "rgba(139,92,246,0.2)" }}>
        {extractLoading ? "Analyzing…" : "🔬 Extract Design System"}
      </button>

      {/* Extraction Result */}
      {extraction && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <div style={{ color: "#4ade80", marginBottom: 4 }}>
            {extraction.extraction.colors.filter((c: any) => c.role).length} semantic colors · {extraction.extraction.components.length} components
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {extraction.artifacts.tokensJson && (
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([extraction.artifacts.tokensJson], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = "tokens.json"; a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", color: "#8B5CF6", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}
              >
                tokens.json
              </button>
            )}
            {extraction.artifacts.sharedCss && (
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([extraction.artifacts.sharedCss], { type: "text/css" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = "shared.css"; a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#22c55e", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}
              >
                shared.css
              </button>
            )}
            {extraction.artifacts.designMd && (
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([extraction.artifacts.designMd], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = "DESIGN.md"; a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}
              >
                DESIGN.md
              </button>
            )}
          </div>

          {/* Open Manual */}
          {manualUrl && (
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                onClick={() => window.open(manualUrl, "_blank")}
                style={{ background: "linear-gradient(135deg, #8B5CF6, #6D28D9)", border: "none", color: "#fff", borderRadius: 6, padding: "6px 14px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
              >
                📖 Open Brand Manual
              </button>
            </div>
          )}

          {/* Color preview swatches */}
          {(extraction.extraction.colors || []).filter((c: any) => c.role && c.role !== "other").length > 0 && (
            <div style={{ marginTop: 6, display: "flex", gap: 3, flexWrap: "wrap" }}>
              {extraction.extraction.colors.filter((c: any) => c.role && c.role !== "other").slice(0, 12).map((c: any, i: number) => (
                <div key={i} style={{
                  width: 16, height: 16, borderRadius: 4, background: c.value,
                  border: "1px solid rgba(255,255,255,0.1)",
                }} title={`${c.token}: ${c.value} (${c.role})`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
