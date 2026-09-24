// creationActivity — FASE 2 (gate de demo): marca si hay coreografía en
// vuelo (receta vía chips "Aquí, viendo a Musa", loop agéntico manual o job
// del bridge) y la usa para vetar que la pestaña se recargue o cierre
// mientras el fantasma actúa.
//
// Motivo: take 2 del dogfood — si la pestaña se recarga a mitad de una
// receta, la demo muere frente al cliente sin dejar rastro (ni burbuja ✕).

let active = 0;

export function beginCreation(): void { active++; }
export function endCreation(): void { active = Math.max(0, active - 1); }
export function isCreationActive(): boolean { return active > 0; }

let installed = false;

/** Una vez por pestaña: beforeunload pide confirmación antes de salir con
 *  receta activa (F5, cerrar, redirects con location.href), y en dev el HMR
 *  de vite no hace full-reload mientras actúa el ghost. En build productivo
 *  no hay HMR: queda solo el guard de salida. */
export function installCreationUnloadGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("beforeunload", (e) => {
    if (!isCreationActive()) return;
    e.preventDefault();
    e.returnValue = ""; // sin esto Chrome no muestra el diálogo
  });
  if (import.meta.env?.DEV) {
    try {
      const hot = (import.meta as any).hot;
      hot?.on?.("vite:beforeFullReload", () => {
        if (isCreationActive()) {
          // Lanzar dentro del handler de vite cancela el full-reload.
          throw new Error("creation-activity: coreografía en vuelo — full-reload bloqueado");
        }
      });
    } catch { /* sin HMR: noop */ }
  }
}
