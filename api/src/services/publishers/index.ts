import type { SocialProvider } from "./types.js";
import { telegram } from "./telegram.js";
import { reddit } from "./reddit.js";
import { x } from "./x.js";

/** Redes del Publisher (fase 1). Agregar una red = un archivo + una línea aquí. */
export const PROVIDERS: Record<string, SocialProvider> = { telegram, reddit, x };

export function getProvider(id: string): SocialProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}

/** Catálogo público para el asistente (sin nada secreto). */
export function providerCatalog() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id, name: p.name, kind: p.kind, color: p.color, limits: p.limits,
    setup: p.setup, notes: p.notes || [], fields: p.fields, developerUrl: p.developerUrl || null,
  }));
}
