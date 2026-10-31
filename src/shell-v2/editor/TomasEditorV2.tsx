/**
 * TomasEditorV2 — cara v2 de la toma fotográfica (TakeStudio del prototipo,
 * REQ-069 F6).
 *
 * Layout del prototipo test.futuraria.com: escenario central con marco del
 * formato elegido, controles de cámara (disparo con countdown), prompt del
 * clone IA y grid de tomas del catálogo real.
 *
 * Datos reales: GET /api/photos/catalog (photo_catalog_items). La CAPTURA con
 * webcam real y la IA de imagen siguen en el pipeline v1; el botón "Estudio
 * completo" abre el flujo existente.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/supabase";

interface TomasEditorV2Props {
  onBack: () => void;
  workspaceId: string | null;
}

interface CatalogItem {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  source_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

const ASPECTS = [
  { id: "1:1", label: "Post 1:1", w: 1080, h: 1080 },
  { id: "4:5", label: "Feed 4:5", w: 1080, h: 1350 },
  { id: "9:16", label: "Story 9:16", w: 1080, h: 1920 },
] as const;

export function TomasEditorV2({ onBack, workspaceId }: TomasEditorV2Props) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>(ASPECTS[0]);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoadErr(null);
    try {
      const res = await apiFetch<{ data: { items: CatalogItem[] } | CatalogItem[] }>(
        `/api/photos/catalog?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      const d = (res as { data?: unknown })?.data;
      const list = Array.isArray(d) ? d : Array.isArray((d as { items?: unknown })?.items) ? (d as { items: CatalogItem[] }).items : [];
      setItems(list.slice(0, 60));
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Error cargando el catálogo");
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const recent = useMemo(() => items ?? [], [items]);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: "calc(100vh - 90px)", gap: 12 }}>
      {/* Toolbar */}
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

        <b style={{ color: "var(--ds-text-light, #fff)", fontFamily: "var(--ds-font-sans, Inter, sans-serif)", fontSize: 15 }}>
          TakeStudio
        </b>

        <div style={{ display: "flex", gap: 6 }}>
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAspect(a)}
              style={{
                background: aspect.id === a.id ? "var(--ds-accent-orange, #ff5e00)" : "transparent",
                color: aspect.id === a.id ? "#0b0b0b" : "var(--ds-text-light, #fff)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 50,
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        <span
          style={{
            marginLeft: "auto",
            background: "rgba(255,255,255,0.06)",
            color: "var(--ds-text-light, #fff)",
            borderRadius: 50,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 800,
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
          }}
        >
          {recent.length} tomas en catálogo
        </span>
      </div>

      {/* Escenario + grid (patrón TakeStudio del prototipo) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12, alignItems: "start" }}>
        {/* Escenario */}
        <div
          style={{
            background: "var(--ds-bg-dark, #070707)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 24,
            display: "grid",
            placeItems: "center",
            minHeight: 420,
          }}
        >
          <div style={{ display: "grid", gap: 16, justifyItems: "center" }}>
            {/* Marco del formato */}
            <div
              style={{
                width: Math.min(360, (300 * aspect.w) / Math.max(aspect.w, aspect.h)),
                height: Math.min(420, (300 * aspect.h) / Math.max(aspect.w, aspect.h)),
                border: "2px dashed rgba(255,94,0,0.7)",
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                color: "rgba(255,255,255,0.45)",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                fontSize: 13,
                background:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 12px, transparent 12px 24px)",
              }}
            >
              {aspect.w} × {aspect.h}
            </div>

            {/* Disparo con countdown (mock del flujo, sin webcam en v2) */}
            <button
              onClick={() => setCount((c) => c + 1)}
              title="La captura con cámara se abre en el estudio completo"
              style={{
                background: "var(--ds-accent-orange, #ff5e00)",
                color: "#0b0b0b",
                border: "none",
                borderRadius: 50,
                padding: "12px 34px",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 14,
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
              }}
            >
              ● Disparar
            </button>
            {count > 0 && (
              <p
                role="status"
                style={{
                  margin: 0,
                  color: "var(--ds-text-light, #fff)",
                  opacity: 0.65,
                  fontSize: 12,
                  fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                }}
              >
                La captura con cámara vive en el estudio completo (pipeline v1) — este panel define formato y prompt.
              </p>
            )}
          </div>
        </div>

        {/* Prompt + catálogo reciente */}
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div
            style={{
              background: "var(--ds-bg-dark, #070707)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              padding: 20,
              display: "grid",
              gap: 10,
            }}
          >
            <b
              style={{
                color: "var(--ds-text-light, #fff)",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Prompt del clone
            </b>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe la toma: producto, luz, fondo, ángulo…"
              rows={5}
              style={{
                background: "transparent",
                color: "var(--ds-text-light, #fff)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 12,
                padding: "10px 12px",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                fontSize: 13,
                resize: "vertical",
              }}
            />
          </div>

          <div
            style={{
              background: "var(--ds-bg-dark, #070707)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              padding: 20,
              display: "grid",
              gap: 10,
            }}
          >
            <b
              style={{
                color: "var(--ds-text-light, #fff)",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Tomas recientes
            </b>
            {loadErr ? (
              <p role="alert" style={{ margin: 0, color: "var(--ds-red, #d7261e)", fontSize: 12, fontFamily: "var(--ds-font-sans, Inter, sans-serif)" }}>
                {loadErr}
              </p>
            ) : !items ? (
              <p style={{ margin: 0, color: "var(--ds-text-light, #fff)", opacity: 0.6, fontSize: 12, fontFamily: "var(--ds-font-sans, Inter, sans-serif)" }}>
                Cargando…
              </p>
            ) : recent.length === 0 ? (
              <p style={{ margin: 0, color: "var(--ds-text-light, #fff)", opacity: 0.6, fontSize: 12, fontFamily: "var(--ds-font-sans, Inter, sans-serif)" }}>
                Sin tomas en este espacio todavía.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {recent.slice(0, 8).map((it) => (
                  <div
                    key={it.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      color: "var(--ds-text-light, #fff)",
                      fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                      fontSize: 12,
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      paddingBottom: 6,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.name || it.title || it.id.slice(0, 8)}
                    </span>
                    <span style={{ opacity: 0.55, flexShrink: 0 }}>{it.status || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
