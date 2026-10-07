/** Detalles abiertos (ficha de tarea, ficha de deal) que sobreviven un
 *  refresh: el id vive en sessionStorage por superficie + workspace. La regla
 *  es la misma que llevó los panes a la URL (appRoute): un detalle es un
 *  lugar al que el usuario navegó — un refresh no puede botarlo al listado.
 *  A diferencia de los panes, NO va en la URL: son ids internos sin valor de
 *  enlace compartible y su cavidad profunda (drawer/peek) no es una página.
 *  Cerrar el detalle borra la llave: un refresh posterior NO reabre nada. */
export function readDetailId(surface: string, scope: string): string | null {
  try {
    return sessionStorage.getItem(`musa:detail:${surface}:${scope}`);
  } catch {
    return null; // almacenamiento no disponible (embeds, private mode)
  }
}

export function writeDetailId(surface: string, scope: string, id: string | null): void {
  try {
    const key = `musa:detail:${surface}:${scope}`;
    if (id) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
  } catch {
    /* almacenamiento no disponible */
  }
}
