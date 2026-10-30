/**
 * useApiData.ts — hook de carga para las vistas del shell v2 (F1).
 *
 * Encapsula el patrón cargar → data | error-con-reintento que las vistas
 * comparten. El loader SIEMPRE es una función de src/lib/apiV2 (PROHIBIDO
 * mock data y fetch propio). Recarga cuando cambian `deps` o vía reload().
 * F4: al cambiar `deps` (p. ej. otro workspace) la data anterior se descarta
 * para nunca mostrar filas del espacio equivocado; reload() la conserva.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiData<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

export function useApiData<T>(loader: () => Promise<T>, deps: unknown[]): ApiData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const prevDeps = useRef<unknown[] | null>(null);
  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    const prev = prevDeps.current;
    const depsChanged =
      prev === null ||
      prev.length !== deps.length ||
      deps.some((d, i) => !Object.is(d, prev[i]));
    prevDeps.current = deps;
    if (depsChanged) {
      // Cambio de workspace (u otra dep): la data vieja ya no representa la vista.
      setData(null);
    }
    let active = true;
    setError(null);
    loader()
      .then(d => { if (active) setData(d); })
      .catch(e => {
        if (active) setError(e instanceof Error ? e.message : "La API no respondió");
      });
    return () => { active = false; };
    // `loader` se recrea en cada render; `deps` define cuándo se recarga.
  }, [...deps, tick]);

  return { data, error, reload };
}

/** Exige workspace resuelto; sin él la vista muestra un error honesto. */
export function requireWs<T>(workspaceId: string | null, fn: (id: string) => Promise<T>): Promise<T> {
  return workspaceId
    ? fn(workspaceId)
    : Promise.reject(new Error("Sin espacio activo: la sesión aún no resolvió el workspace"));
}
