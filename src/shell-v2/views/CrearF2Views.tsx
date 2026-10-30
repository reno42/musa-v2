/**
 * CrearF2Views.tsx — vistas CREAR de la oleada F2 (videos, marcas, tomas).
 * Fuente: apiV2/crear.ts → GET /api/video-projects, brands (JSONB de tokens),
 * GET /api/photos/documents.
 */
import { fetchVideoProjects } from "../../lib/apiV2";
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
