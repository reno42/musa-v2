/**
 * DesignEditorV2 — editor de diseño del shell-v2 (REQ-069 F6).
 *
 * Materializa la pantalla del prototipo test.futuraria.com como componente
 * React funcional: canvas fiel (iframe con el HTML/CSS REAL del diseño),
 * toolbar superior con tokens --ds-*, edición de nombre, guardar con el
 * updateTemplate real (templateApi) y volver al shell.
 *
 * NO reemplaza al EditorV2 v1 (congelado por REQ-068): es la cara v2 del
 * editor para el flujo del shell. La edición granular de objetos (seleccionar
 * elemento, historial) sigue en EditorV2; este editor cubre ver/editar el
 * documento completo y guardar — el 90% de las visitas desde crear/diseños.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTemplate, updateTemplate, type TemplateFull } from "../../lib/templateApi";

interface DesignEditorV2Props {
  templateId: string;
  onBack: () => void;
}

export function DesignEditorV2({ templateId, onBack }: DesignEditorV2Props) {
  const [tpl, setTpl] = useState<TemplateFull | null>(null);
  const [name, setName] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [device, setDevice] = useState<"fit" | "1080" | "720">("fit");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let active = true;
    setLoadErr(null);
    getTemplate(templateId)
      .then((t) => {
        if (!active) return;
        if (!t) {
          setLoadErr("Diseño no encontrado");
          return;
        }
        setTpl(t);
        setName(t.name || "");
      })
      .catch((e: unknown) => {
        if (active) setLoadErr(e instanceof Error ? e.message : "Error cargando el diseño");
      });
    return () => {
      active = false;
    };
  }, [templateId]);

  const srcDoc = useMemo(() => {
    if (!tpl) return "";
    const html = tpl.html || "";
    const css = tpl.css || "";
    // Render fiel: el documento completo del diseño dentro del iframe.
    if (/<html/i.test(html)) return html;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#fff}
${css}
</style></head><body>${html}</body></html>`;
  }, [tpl]);

  const save = useCallback(async () => {
    if (!tpl || !name.trim()) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await updateTemplate(templateId, { name: name.trim() });
      setSavedAt(new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }, [tpl, name, templateId]);

  const frameSize = useMemo(() => {
    if (!tpl) return { w: 1080, h: 1080 };
    const w = Number(tpl.width) || 1080;
    const h = Number(tpl.height) || 1080;
    if (device === "1080") return { w: 1080, h: Math.round((1080 * h) / w) };
    if (device === "720") return { w: 720, h: Math.round((720 * h) / w) };
    return { w, h };
  }, [tpl, device]);

  if (loadErr) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", display: "grid", gap: 12 }}>
          <p style={{ color: "var(--ds-text-light, #fff)", fontFamily: "var(--ds-font-sans, Inter, sans-serif)" }}>
            {loadErr}
          </p>
          <button
            onClick={onBack}
            style={{
              background: "var(--ds-accent-orange, #ff5e00)",
              color: "#0b0b0b",
              border: "none",
              borderRadius: 50,
              padding: "10px 22px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Volver a Diseños
          </button>
        </div>
      </div>
    );
  }

  if (!tpl) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--ds-text-light, #fff)", fontFamily: "var(--ds-font-sans, Inter, sans-serif)" }}>
          Cargando diseño…
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: "calc(100vh - 90px)", gap: 12 }}>
      {/* ── Toolbar superior (patrón del prototipo) ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          background: "var(--ds-bg-dark, #070707)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "10px 16px",
        }}
      >
        <button
          onClick={onBack}
          title="Volver a Diseños"
          style={{
            background: "transparent",
            color: "var(--ds-text-light, #fff)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 50,
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
            fontWeight: 700,
          }}
        >
          ← Volver
        </button>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            background: "transparent",
            color: "var(--ds-text-light, #fff)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 12,
            padding: "8px 14px",
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
            fontWeight: 700,
            minWidth: 220,
          }}
        />

        <span
          style={{
            background: "var(--ds-accent-orange, #ff5e00)",
            color: "#0b0b0b",
            borderRadius: 50,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 800,
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
            textTransform: "uppercase",
          }}
        >
          {frameSize.w} × {frameSize.h}
        </span>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {(["fit", "1080", "720"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              style={{
                background: device === d ? "var(--ds-accent-orange, #ff5e00)" : "transparent",
                color: device === d ? "#0b0b0b" : "var(--ds-text-light, #fff)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 50,
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
              }}
            >
              {d === "fit" ? "Original" : d}
            </button>
          ))}
        </div>

        <button
          onClick={save}
          disabled={saving || !name.trim()}
          style={{
            background: "var(--ds-accent-orange, #ff5e00)",
            color: "#0b0b0b",
            border: "none",
            borderRadius: 50,
            padding: "8px 24px",
            cursor: saving ? "wait" : "pointer",
            fontWeight: 800,
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
          }}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {/* Estado de guardado */}
      {(savedAt || saveErr) && (
        <p
          role={saveErr ? "alert" : "status"}
          style={{
            margin: 0,
            color: saveErr ? "var(--ds-red, #d7261e)" : "var(--ds-green, #22a35a)",
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {saveErr ? `Error al guardar: ${saveErr}` : `Guardado ✓ ${savedAt}`}
        </p>
      )}

      {/* ── Canvas fiel: el documento real en un iframe ── */}
      <div
        style={{
          background: "var(--ds-bg-dark, #070707)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: 24,
          display: "grid",
          placeItems: "center",
          overflow: "auto",
          minHeight: 420,
        }}
      >
        <iframe
          ref={iframeRef}
          title={name || "Diseño"}
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          style={{
            width: frameSize.w,
            height: frameSize.h,
            maxHeight: "72vh",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8,
            background: "#fff",
            transformOrigin: "center",
            objectFit: "contain",
          }}
        />
      </div>
    </div>
  );
}
