import type { SocialProvider } from "./types.js";
import { telegram } from "./telegram.js";
import { reddit } from "./reddit.js";
import { x } from "./x.js";
import { facebook, instagram } from "./meta.js";
import { threads } from "./threads.js";
import { bluesky } from "./bluesky.js";
import { linkedin, linkedinPage } from "./linkedin.js";
import { pinterest } from "./pinterest.js";
import { mastodon } from "./mastodon.js";
import { googleBusiness, blogger } from "./google.js";
import { ghost, wordpress, devto, hashnodeProvider, listmonk } from "./blogs.js";
import { slack, discord } from "./chat.js";

/** Redes del Publisher. Agregar una red = un archivo + una línea aquí. */
const LIST: SocialProvider[] = [
  instagram, facebook, linkedin, linkedinPage, x, threads, bluesky, pinterest, reddit, googleBusiness, mastodon,
  telegram, discord, slack,
  wordpress, ghost, blogger, devto, hashnodeProvider, listmonk,
];
export const PROVIDERS: Record<string, SocialProvider> = Object.fromEntries(LIST.map((p) => [p.id, p]));

/** Redes que todavía no se pueden ofrecer, con el motivo (se muestran en el asistente). */
export const NOT_YET = [
  { name: "TikTok", why: "Para publicar fotos exige verificar el dominio de las imágenes y una auditoría de la app; llega junto con video en los planes pagos." },
  { name: "YouTube", why: "Solo acepta videos: llega con video en los planes pagos." },
  { name: "WhatsApp", why: "La API no publica en canales ni estados; solo manda mensajes uno a uno (eso es otro producto)." },
  { name: "Medium", why: "Medium cerró su API a integraciones nuevas." },
];

export function getProvider(id: string): SocialProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}
export function appKeyOf(p: SocialProvider) {
  return p.appKey || p.id;
}
/** Redes que usan una app (por su clave). */
export function providersOfApp(appKey: string) {
  return LIST.filter((p) => p.kind === "oauth" && appKeyOf(p) === appKey);
}

/** Catálogo público para el asistente (sin nada secreto). */
export function providerCatalog() {
  return LIST.map((p) => ({
    id: p.id, name: p.name, kind: p.kind, color: p.color, group: p.group || "social", limits: p.limits,
    appKey: p.kind === "oauth" ? appKeyOf(p) : null, appName: p.appName || p.name,
    setup: p.setup, notes: p.notes || [], fields: p.fields, developerUrl: p.developerUrl || null,
  }));
}
