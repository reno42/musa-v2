import React, { useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface Props {
  templateId: string;
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

export function BrandPanel({ templateId, onCssUpdated }: Props) {
  const [brandCheck, setBrandCheck] = useState<any>(null);
  const [contrast, setContrast] = useState<any>(null);
  const [a11y, setA11y] = useState<any>(null);
  const [loading, setLoading] = useState("");

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

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Brand & A11y</div>

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
    </div>
  );
}
