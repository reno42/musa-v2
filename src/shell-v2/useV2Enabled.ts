/**
 * useV2Enabled.ts — Flag v2_enabled por workspace (REQ-069 F0).
 *
 * Se lee de la SESIÓN actual, sin migraciones: el valor vive en la fila del
 * workspace que devuelve GET /api/workspaces (vía apiV2). Si la columna aún
 * no existe en la BD, `v2_enabled` no está presente → OFF, y la app v1 queda
 * 100% intacta y sin coste de espera (el dashboard v1 pinta de inmediato;
 * el shell solo aparece cuando la lectura confirma el flag).
 *
 * Escape de QA/rollout mientras la columna se despliega: `?v2=1` en la URL
 * (queda anotado en sessionStorage para sobrevivir la navegación por hash).
 * No sustituye al flag: es la vía para verificar el shell antes del ALTER.
 */
import { useEffect, useState } from "react";
import { fetchWorkspaces } from "../lib/apiV2/inicio";

export type V2Flag = "pending" | "on" | "off";

/** Cache por workspace para no repetir la lectura en cada render de App. */
const resolvedFlags = new Map<string, boolean>();

/** ¿Hay override explícito de QA en esta sesión? */
export function readV2Override(): boolean {
  try {
    if (sessionStorage.getItem("musa-v2-qa") === "1") return true;
  } catch { /* sessionStorage bloqueado */ }
  return new URLSearchParams(window.location.search).get("v2") === "1";
}

function rememberOverride(): void {
  try {
    sessionStorage.setItem("musa-v2-qa", "1");
  } catch { /* noop */ }
}

/**
 * Resuelve el flag del workspace de la sesión. "pending" solo mientras la
 * lectura está en curso y no hay override; los estados resueltos son "on"/"off".
 */
export function useV2Enabled(workspaceId: string | null): V2Flag {
  const [flag, setFlag] = useState<V2Flag>(() => (readV2Override() ? "on" : "pending"));

  useEffect(() => {
    if (readV2Override()) {
      rememberOverride();
      setFlag("on");
      return;
    }
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
        // Campo ausente (columna sin desplegar) o false → OFF: v1 intacta.
        const enabled = current?.v2_enabled === true;
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
