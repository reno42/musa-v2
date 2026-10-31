/**
 * VideoEditorV2 — cara v2 del editor de video (REQ-069 F6).
 *
 * Layout del prototipo test.futuraria.com: toolbar superior con tokens --ds-*,
 * timeline horizontal de clips (tracks→segments del árbol real), panel de
 * materiales. Datos reales via GET /api/video-projects/:id (tree completo).
 *
 * La EDICIÓN profunda (mover/trim/speed/transform, export) sigue en
 * VideoProjectEditor v1 (REQ-VID11, congelado): "Editar completo" abre ese
 * editor sobre el mismo proyecto.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/supabase";

interface VideoEditorV2Props {
  projectId: string;
  onBack: () => void;
  onOpenFull: (projectId: string) => void;
}

interface V2Segment {
  id: string;
  material_id: string;
  target_start_us: number;
  target_dur_us: number;
  speed: number;
}

interface V2Track {
  id: string;
  name?: string;
  kind?: string;
  z_order?: number;
  segments: V2Segment[];
}

interface V2Material {
  id: string;
  name?: string;
  kind?: string;
  duration_us?: number;
}

interface V2Tree {
  project: {
    id: string;
    name: string;
    duration_us: number;
    fps: number;
    canvas_w: number;
    canvas_h: number;
    ratio: string;
    updated_at?: string;
  };
  tracks: V2Track[];
  materials: V2Material[];
}

const fmtSec = (us: number | undefined | null): string => {
  const s = (Number(us) || 0) / 1_000_000;
  return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
};

export function VideoEditorV2({ projectId, onBack, onOpenFull }: VideoEditorV2Props) {
  const [tree, setTree] = useState<V2Tree | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadErr(null);
    apiFetch<{ data: V2Tree }>(`/api/video-projects/${projectId}`)
      .then((res) => {
        if (!active) return;
        if (!res?.data?.project) {
          setLoadErr("Proyecto de video no encontrado");
          return;
        }
        setTree(res.data);
      })
      .catch((e: unknown) => {
        if (active) setLoadErr(e instanceof Error ? e.message : "Error cargando el proyecto");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const materialName = useCallback(
    (id: string) => tree?.materials.find((m) => m.id === id)?.name || "Material",
    [tree],
  );

  // Clips ordenados por inicio en la pista (el timeline del prototipo).
  const clips = useMemo(() => {
    if (!tree) return [];
    return tree.tracks
      .flatMap((t) => (t.segments || []).map((s) => ({ ...s, trackName: t.name || t.kind || "Pista" })))
      .sort((a, b) => (a.target_start_us || 0) - (b.target_start_us || 0));
  }, [tree]);

  const totalSec = useMemo(
    () => (Number(tree?.project.duration_us) || 0) / 1_000_000,
    [tree],
  );

  const openFull = useCallback(() => onOpenFull(projectId), [onOpenFull, projectId]);

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
              fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
            }}
          >
            Volver a Videos
          </button>
        </div>
      </div>
    );
  }

  if (!tree) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--ds-text-light, #fff)", fontFamily: "var(--ds-font-sans, Inter, sans-serif)" }}>
          Cargando proyecto…
        </p>
      </div>
    );
  }

  const p = tree.project;
  const sel = clips.find((c) => c.id === selected) || null;

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
          {p.name}
        </b>

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
          {p.canvas_w}×{p.canvas_h} · {fmtSec(p.duration_us)} · {p.fps}fps{p.ratio ? ` · ${p.ratio}` : ""}
        </span>

        <button
          onClick={openFull}
          style={{
            marginLeft: "auto",
            background: "var(--ds-accent-orange, #ff5e00)",
            color: "#0b0b0b",
            border: "none",
            borderRadius: 50,
            padding: "8px 24px",
            cursor: "pointer",
            fontWeight: 800,
            fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
          }}
        >
          Editar completo
        </button>
      </div>

      {/* Timeline + panel (patrón del prototipo) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 12,
          minHeight: 0,
          alignItems: "start",
        }}
      >
        <div
          style={{
            background: "var(--ds-bg-dark, #070707)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 20,
            overflow: "auto",
          }}
        >
          {clips.length === 0 ? (
            <p
              style={{
                color: "var(--ds-text-light, #fff)",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                opacity: 0.7,
              }}
            >
              Proyecto sin clips todavía — usa "Editar completo" para agregar el primero.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {clips.map((c, i) => {
                const isSel = selected === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(isSel ? null : c.id)}
                    style={{
                      minWidth: 160,
                      textAlign: "left",
                      background: isSel ? "rgba(255,94,0,0.18)" : "rgba(255,255,255,0.04)",
                      border: isSel
                        ? "2px solid var(--ds-accent-orange, #ff5e00)"
                        : "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12,
                      padding: "12px 14px",
                      cursor: "pointer",
                      color: "var(--ds-text-light, #fff)",
                      fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                    }}
                  >
                    <b style={{ display: "block", fontSize: 13 }}>{materialName(c.material_id)}</b>
                    <span style={{ opacity: 0.65, fontSize: 11 }}>
                      #{i + 1} · {fmtSec(c.target_dur_us)}
                      {c.speed !== 1 ? ` · ${c.speed}x` : ""} · {c.trackName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Panel de propiedades del clip */}
        <div
          style={{
            background: "var(--ds-bg-dark, #070707)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 20,
            display: "grid",
            gap: 10,
            alignContent: "start",
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
            Clip
          </b>
          {sel ? (
            <div
              style={{
                color: "var(--ds-text-light, #fff)",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                fontSize: 13,
                display: "grid",
                gap: 6,
              }}
            >
              <span>{materialName(sel.material_id)}</span>
              <span style={{ opacity: 0.65 }}>Inicio: {fmtSec(sel.target_start_us)}</span>
              <span style={{ opacity: 0.65 }}>Duración: {fmtSec(sel.target_dur_us)}</span>
              <span style={{ opacity: 0.65 }}>Velocidad: {sel.speed}x</span>
            </div>
          ) : (
            <p
              style={{
                color: "var(--ds-text-light, #fff)",
                fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
                opacity: 0.6,
                fontSize: 13,
                margin: 0,
              }}
            >
              Selecciona un clip del timeline.
            </p>
          )}
          <p
            style={{
              color: "var(--ds-text-light, #fff)",
              fontFamily: "var(--ds-font-sans, Inter, sans-serif)",
              opacity: 0.55,
              fontSize: 12,
              margin: 0,
            }}
          >
            {tree.materials.length} materiales · {tree.tracks.length} pistas
          </p>
        </div>
      </div>
    </div>
  );
}
