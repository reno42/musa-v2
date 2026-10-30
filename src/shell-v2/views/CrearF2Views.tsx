/**
 * CrearF2Views.tsx — vistas CREAR de las oleadas F2 (videos, marcas, tomas)
 * y F3 oleada 2 (clones, eventos, mailing, formularios).
 * Fuente: apiV2/crear.ts → GET /api/video-projects, brands (JSONB de tokens),
 * GET /api/photos/catalog y tablas workspace_* de Hermes.
 */
import { fetchBrandTokens, fetchClones, fetchEvents, fetchForms, fetchMailings, fetchPhotoCatalog, fetchVideoProjects } from "../../lib/apiV2";
import type { WorkspaceClone, WorkspaceEvent, WorkspaceForm, WorkspaceMailing } from "../../lib/apiV2/crear";
import type { VideoProject } from "../../lib/apiV2/crear";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, str } from "./helpers";
import type { V2ViewProps } from "../router";

/**
 * GET /api/video-projects responde { success, data: { projects, total } }
 * (api/src/routes/videoProjects.ts), pero apiV2/crear.ts tipa `data` como
 * VideoProject[]. Este normalizador acepta ambas formas sin inventar datos.
 */
function asProjectList(raw: unknown): VideoProject[] {
  if (Array.isArray(raw)) return raw as VideoProject[];
  if (raw && typeof raw === "object") {
    const projects = (raw as { projects?: unknown }).projects;
    if (Array.isArray(projects)) return projects as VideoProject[];
  }
  return [];
}

/** Color de estado de un clone IA (solo tokens). */
function cloneTone(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "activo" || s === "active") return "var(--ds-verde)";
  if (s === "entrenando" || s === "training") return "var(--ds-warn)";
  if (s === "error") return "var(--ds-rojo)";
  return "var(--ds-muted)";
}

/** crear/clones — clones IA del workspace (workspace_clones). */
export function ClonesView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchClones), [workspaceId]);
  const clones: WorkspaceClone[] = data ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : null}

      {data ? (
        <DsCard span={12}>
          <DsCardTitle hint={`${clones.length} clones`}>Clones IA</DsCardTitle>
          {clones.length === 0 ? (
            <DataState state="empty" message="Sin clones todavía: los clones IA entrenados para el workspace aparecen aquí." />
          ) : (
            <DsTable
              rows={clones}
              rowKey={(r) => r.id}
              cols={[
                { label: "Clone", cell: r => str(r.name) },
                {
                  label: "Estado",
                  cell: r => <span style={{ color: cloneTone(r.status) }}>{str(r.status, "sin estado")}</span>,
                },
                { label: "Modelo", cell: r => str(r.model) },
                { label: "Actualizado", cell: r => fmtDate(r.updated_at) },
              ]}
            />
          )}
        </DsCard>
      ) : null}
    </div>
  );
}

/** crear/videos — proyectos de video del pipeline (GET /api/video-projects). */
export function VideosView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchVideoProjects), [workspaceId]);
  const projects = data ? asProjectList(data as unknown) : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <DsCard span={12}>
          <DsCardTitle hint={`${projects.length} proyectos`}>Videos</DsCardTitle>
          {projects.length === 0 ? (
            <DataState state="empty" message="Sin proyectos de video en este espacio todavía." />
          ) : (
            <DsTable
              rows={projects}
              rowKey={r => r.id}
              cols={[
                { label: "Proyecto", cell: r => str(r.name || r.title || r.id) },
                {
                  label: "Lienzo",
                  cell: r => {
                    const w = Number(r["canvas_w"]);
                    const h = Number(r["canvas_h"]);
                    return Number.isFinite(w) && Number.isFinite(h) && w > 0 ? `${w}×${h}` : "—";
                  },
                },
                { label: "Ratio", cell: r => str(typeof r["ratio"] === "string" ? r["ratio"] : undefined) },
                {
                  label: "FPS",
                  cell: r => {
                    const f = Number(r["fps"]);
                    return Number.isFinite(f) && f > 0 ? String(f) : "—";
                  },
                },
                { label: "Plantilla", cell: r => (r["is_template"] === true ? "Sí" : "—") },
                {
                  label: "Actualizado",
                  cell: r => {
                    const upd = typeof r["updated_at"] === "string" ? r["updated_at"] : r.updatedAt;
                    return fmtDate(upd);
                  },
                },
              ]}
            />
          )}
        </DsCard>
      )}
    </div>
  );
}

/** Regex de color compartida con el digest de brandGraph (DTCG-tolerante). */
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

/**
 * Extrae colores y tipografías del JSONB real de brands (colors/fonts) sin
 * exigir una forma fija: acepta arrays planos, mapas semánticos y árboles
 * DTCG ($value). Lo malformado degrada a lista vacía, no a error.
 */
function tokenDigest(colors: unknown, fonts: unknown): { colors: string[]; fonts: string[] } {
  const outColors: string[] = [];
  const outFonts: string[] = [];
  const visit = (node: unknown, bucket: "colors" | "fonts"): void => {
    if (typeof node === "string") {
      const s = node.trim();
      if (!s) return;
      if (COLOR_RE.test(s)) {
        if (bucket === "colors" && outColors.length < 12 && !outColors.includes(s)) outColors.push(s);
      } else if (bucket === "fonts" && outFonts.length < 8) {
        const name = s.replace(/^["']|["']$/g, "");
        if (name && !outFonts.includes(name)) outFonts.push(name);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(n => visit(n, bucket));
      return;
    }
    if (node && typeof node === "object") {
      for (const child of Object.values(node as Record<string, unknown>)) visit(child, bucket);
    }
  };
  visit(colors, "colors");
  visit(fonts, "fonts");
  return { colors: outColors, fonts: outFonts };
}

/** Cuenta entradas de un JSONB de tokens (array o mapa); 0 si viene vacío. */
function countTokens(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 0;
}

/** crear/marcas — design systems del workspace (brands JSONB colors/fonts/spacing). */
export function MarcasView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchBrandTokens), [workspaceId]);
  const brands = data ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : brands.length === 0 ? (
        <DsCard span={12}>
          <DataState state="empty" message="Sin marcas con design system en este espacio todavía." />
        </DsCard>
      ) : (
        brands.map(b => {
          const digest = tokenDigest(b.colors, b.fonts);
          const spacingCount = countTokens(b.spacing);
          return (
            <DsCard key={b.id} span={4}>
              <DsCardTitle hint={fmtDate(b.updated_at)}>{b.name}</DsCardTitle>
              {digest.colors.length > 0 ? (
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {digest.colors.map((c, i) => (
                    <span
                      key={`${c}-${i}`}
                      title={c}
                      style={{ flex: 1, height: 34, borderRadius: "var(--ds-radius-sm)", background: c, border: "1px solid var(--ds-border-2)" }}
                    />
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--ds-muted)", fontSize: 12, fontFamily: "var(--ds-font-sans)", margin: "0 0 12px" }}>
                  Sin tokens de color todavía.
                </p>
              )}
              <div style={{ fontSize: 12.5, fontFamily: "var(--ds-font-sans)", color: "var(--ds-text)", lineHeight: 1.6 }}>
                {digest.fonts.length > 0 ? (
                  digest.fonts.slice(0, 3).map(f => <div key={f}>{f}</div>)
                ) : (
                  <span style={{ color: "var(--ds-muted)" }}>Sin tipografías definidas.</span>
                )}
              </div>
              {spacingCount > 0 ? (
                <div style={{ marginTop: 10, fontSize: 11, color: "var(--ds-muted)", fontFamily: "var(--ds-font-sans)" }}>
                  {spacingCount} tokens de spacing
                </div>
              ) : null}
            </DsCard>
          );
        })
      )}
    </div>
  );
}

/** crear/tomas — biblioteca de fotos del workspace (GET /api/photos/catalog). */
export function TomasView({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, fetchPhotoCatalog), [workspaceId]);
  const items = data ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {!data ? (
        <DsCard span={12}>
          <DataState state={error ? "error" : "loading"} message={error ?? undefined} onRetry={reload} />
        </DsCard>
      ) : (
        <DsCard span={12}>
          <DsCardTitle hint={`${items.length} fotos`}>Tomas</DsCardTitle>
          {items.length === 0 ? (
            <DataState state="empty" message="Sin fotos en la biblioteca de este espacio todavía." />
          ) : (
            <DsTable
              rows={items}
              rowKey={(r, i) => str(r.asset_id ?? r.id, `fila-${i}`)}
              cols={[
                {
                  label: "Foto",
                  cell: r => {
                    const url = typeof r.source_url === "string" ? r.source_url : "";
                    return url ? <span title={url}>{url}</span> : "—";
                  },
                },
                {
                  label: "Flag",
                  cell: r => r.flag === "pick"
                    ? <span style={{ color: "var(--ds-verde)", fontWeight: 600 }}>Pick</span>
                    : r.flag === "reject"
                      ? <span style={{ color: "var(--ds-rojo)", fontWeight: 600 }}>Reject</span>
                      : <span style={{ color: "var(--ds-muted)" }}>—</span>,
                },
                {
                  label: "Rating",
                  cell: r => {
                    const n = Number(r.rating);
                    return Number.isFinite(n) && n > 0 ? "★".repeat(Math.round(n)) : "—";
                  },
                },
                {
                  label: "Etiqueta",
                  cell: r => str(typeof r.color_label === "string" ? r.color_label : undefined),
                },
                {
                  label: "Keywords",
                  cell: r => (Array.isArray(r.keywords) && r.keywords.length > 0 ? r.keywords.join(", ") : "—"),
                },
                { label: "Actualizada", cell: r => fmtDate(r.updated_at) },
              ]}
            />
          )}
        </DsCard>
      )}
    </div>
  );
}
