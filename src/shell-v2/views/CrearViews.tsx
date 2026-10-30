/**
 * CrearViews.tsx — vistas de CREAR con datos reales (apiV2/crear.ts).
 * crear/disenos ← GET /api/templates · crear/automatizaciones ← GET /api/recipes.
 * El resto de subs de CREAR sigue en placeholder hasta que su módulo exista
 * (necesidades registradas en shell-v2/NEEDS.md).
 */
import type { ReactNode } from "react";
import { loadCrear } from "../../lib/apiV2";
import type { Recipe } from "../../lib/apiV2/crear";
import { DataState, DsCard, DsCardTitle, DsTable, ViewHeader } from "../../components/v2/ds";
import { requireWs, useApiData } from "../useApiData";
import { fmtDate, pick, str } from "./helpers";
import type { V2ViewProps } from "../router";

/** Botón fantasma de fila (abrir diseño, ver job). Reusado por otras vistas. */
export function RowAction({ label, onClick }: { label: string; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "1px solid var(--ds-border-2)",
        color: "var(--ds-bright)",
        borderRadius: "var(--ds-radius-pill)",
        padding: "4px 12px",
        cursor: "pointer",
        font: `400 11px/1 var(--ds-font-sans)`,
      }}
    >
      {label}
    </button>
  );
}

/** crear/disenos — inventario completo de diseños del workspace. */
export function CrearDisenos({ meta, workspaceId, onOpenTemplate }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadCrear), [workspaceId]);
  const items = data ? data.templates.items : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {error ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : null}

      {data ? (
        items.length === 0 ? (
          <DsCard span={12}>
            <DataState state="empty" message="Todavía no hay diseños en este espacio." />
          </DsCard>
        ) : (
          <DsCard span={12}>
            <DsCardTitle hint={`${data.templates.total} en total`}>Diseños del espacio</DsCardTitle>
            <DsTable
              rows={items}
              rowKey={(r, i) => str(pick(r as Record<string, unknown>, ["id"]), `fila-${i}`)}
              cols={[
                { label: "Título", cell: r => str(pick(r as Record<string, unknown>, ["title", "name", "id"])) },
                { label: "Actualizado", cell: r => fmtDate(pick(r as Record<string, unknown>, ["updatedAt", "updated_at", "createdAt"])) },
                {
                  label: "",
                  cell: r => {
                    const id = pick(r as Record<string, unknown>, ["id"]);
                    return typeof id === "string" ? <RowAction label="Abrir" onClick={() => onOpenTemplate(id)} /> : "—";
                  },
                },
              ]}
            />
          </DsCard>
        )
      ) : null}
    </div>
  );
}

/** crear/automatizaciones — flows del workspace (hoy: recipes de /api/recipes). */
export function CrearAutomatizaciones({ meta, workspaceId }: V2ViewProps) {
  const { data, error, reload } = useApiData(() => requireWs(workspaceId, loadCrear), [workspaceId]);
  const recipes: Recipe[] = data ? data.recipes : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      <ViewHeader meta={meta} />

      {error ? (
        <DsCard span={12}>
          <DataState state="error" message={error} onRetry={reload} />
        </DsCard>
      ) : !data ? (
        <DsCard span={12}>
          <DataState state="loading" />
        </DsCard>
      ) : null}

      {data ? (
        recipes.length === 0 ? (
          <DsCard span={12}>
            <DataState state="empty" message="Sin automatizaciones todavía: las flows del workspace aparecen aquí." />
          </DsCard>
        ) : (
          <DsCard span={12}>
            <DsCardTitle hint={`${recipes.length} flows`}>Automatizaciones</DsCardTitle>
            <DsTable
              rows={recipes}
              rowKey={r => r.id}
              cols={[
                { label: "Nombre", cell: r => str(pick(r, ["name", "title", "id"])) },
                { label: "Estado", cell: r => str(pick(r, ["status"])) },
                { label: "Actualizado", cell: r => fmtDate(pick(r, ["updatedAt", "updated_at"])) },
              ]}
            />
          </DsCard>
        )
      ) : null}
    </div>
  );
}
