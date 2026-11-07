/**
 * useV2Enabled.ts — Flag v2_enabled por workspace (REQ-069 F0).
 *
 * Se lee de la SESIÓN actual: el valor vive en la fila del workspace que
 * devuelve GET /api/workspaces (vía apiV2). La columna ya está desplegada en
 * producción y los workspaces activos la tienen ON; el escape de QA
 * (?v2=1 + sessionStorage) se retiró en F3 tras la verificación en vivo.
 *
 * Fail-closed: campo ausente o false → OFF (workspace sin v2). Si la API está
 * caída NO hay degradación a v1 — un blip de red nunca debe mostrar el
 * dashboard viejo (incidente 2026-11-06): quedamos en "failed" y la UI ofrece
 * Reintentar. */
import { useEffect, useState } from "react";
import { fetchWorkspaces } from "../lib/apiV2/inicio";

export type V2Flag = "pending" | "on" | "off" | "failed";

/** Cache por workspace para no repetir la lectura en cada render de App. */
const resolvedFlags = new Map<string, boolean>();

/**
 * Resuelve el flag del workspace de la sesión. "pending" solo mientras la
 * lectura está en curso; los estados resueltos son "on"/"off".
 */
/**
 * Última confirmación del flag en este navegador. Sin ella, mientras la sesión
 * resolvía el workspace se pintaba el dashboard v1 (y su onboarding) varios
 * segundos antes del shell v2. Con ella, la visita siguiente abre v2 al instante.
 */
const LAST_KEY = "musa-v2-last-flag";
const readLast = (): V2Flag => {
  try { return localStorage.getItem(LAST_KEY) === "on" ? "on" : "pending"; } catch { return "pending"; }
};
const writeLast = (on: boolean) => {
  try { localStorage.setItem(LAST_KEY, on ? "on" : "off"); } catch { /* sin storage */ }
};

export function useV2Enabled(workspaceId: string | null, retryNonce = 0): V2Flag {
  const [flag, setFlag] = useState<V2Flag>(readLast);

  useEffect(() => {
    if (!workspaceId) {
      // Workspace aún sin resolver: nunca "off" (eso pintaba v1 de paso).
      setFlag(readLast());
      return;
    }
    const known = resolvedFlags.get(workspaceId);
    if (known !== undefined) {
      setFlag(known ? "on" : "off");
      return;
    }
    // Reintento manual tras "failed": vuelve a modo espera mientras consulta.
    // Sin esto, la primera carga de la sesión conserva su camino rápido
    // (readLast "on" renderiza v2 al instante mientras se revalida).
    setFlag(f => (f === "failed" ? "pending" : f));
    let active = true;
    fetchWorkspaces()
      .then(list => {
        const current = list.find(w => w.id === workspaceId);
        // El endpoint mapea la columna a camelCase (v2Enabled); se acepta también
        // v2_enabled por compatibilidad mientras los dos lados coexistan.
        const raw = current as (typeof current & { v2Enabled?: unknown }) | undefined;
        const enabled = raw?.v2Enabled === true || raw?.v2_enabled === true;
        resolvedFlags.set(workspaceId, enabled);
        writeLast(enabled);
        if (active) setFlag(enabled ? "on" : "off");
      })
      .catch(() => {
        // API caída: sin flag confirmado NO se activa v2, pero tampoco se
        // degrada a v1 — "failed" mantiene la pantalla de reintento.
        if (active) setFlag("failed");
      });
    return () => { active = false; };
  }, [workspaceId, retryNonce]);

  return flag;
}
