/**
 * useV2Enabled.ts — Flag v2_enabled por workspace (REQ-069 F0).
 *
 * Se lee de la SESIÓN actual: el valor vive en la fila del workspace que
 * devuelve GET /api/workspaces (vía apiV2). La columna ya está desplegada en
 * producción y los workspaces activos la tienen ON; el escape de QA
 * (?v2=1 + sessionStorage) se retiró en F3 tras la verificación en vivo.
 *
 * Fail-closed: campo ausente, false o API caída → OFF, y la app v1 queda
 * 100% intacta y sin coste de espera (el dashboard v1 pinta de inmediato;
 * el shell solo aparece cuando la lectura confirma el flag).
 */
import { useEffect, useState } from "react";
import { fetchWorkspaces } from "../lib/apiV2/inicio";

export type V2Flag = "pending" | "on" | "off";

/** Cache por workspace para no repetir la lectura en cada render de App. */
const resolvedFlags = new Map<string, boolean>();

/**
 * Resuelve el flag del workspace de la sesión. "pending" solo mientras la
 * lectura está en curso; los estados resueltos son "on"/"off".
 */
export function useV2Enabled(workspaceId: string | null): V2Flag {
  const [flag, setFlag] = useState<V2Flag>("pending");

  useEffect(() => {
    if (!workspaceId) {
      setFlag("off");
      return;
    }
    const known = resolvedFlags.get(workspaceId);
    if (known !== undefined) {
      setFlag(known ? "on" : "off");
      return;
    }
    let active = true;
    fetchWorkspaces()
      .then(list => {
        const current = list.find(w => w.id === workspaceId);
        // El endpoint mapea la columna a camelCase (v2Enabled); se acepta también
        // v2_enabled por compatibilidad mientras los dos lados coexistan.
        const raw = current as (typeof current & { v2Enabled?: unknown }) | undefined;
        const enabled = raw?.v2Enabled === true || raw?.v2_enabled === true;
        resolvedFlags.set(workspaceId, enabled);
        if (active) setFlag(enabled ? "on" : "off");
      })
      .catch(() => {
        // API caída: sin flag confirmado NO se activa v2 (fail-closed).
        if (active) setFlag("off");
      });
    return () => { active = false; };
  }, [workspaceId]);

  return flag;
}
