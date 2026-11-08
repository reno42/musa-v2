import { type SocialProvider, type Tokens, ProviderError, fetchJson } from "./types.js";

/**
 * Threads — OAuth con el caso de uso «Threads API» de una app de Meta (BYOK).
 * Token largo de 60 días que se renueva con el mismo token (sin refresh aparte).
 * Publicar: contenedor IMAGE → esperar a que quede listo → publicar.
 */
const API = "https://graph.threads.net";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const exp = (s: number | undefined) => new Date(Date.now() + (Number(s) || 3600) * 1000).toISOString();

export const threads: SocialProvider = {
  id: "threads",
  name: "Threads",
  kind: "oauth",
  group: "social",
  color: "#101010",
  cost: 6,
  limits: { maxChars: 500, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 8 * 1024 * 1024 },
  developerUrl: "https://developers.facebook.com/apps/",
  setup: [
    "En developers.facebook.com crea una app y elige el caso de uso «Acceder a la API de Threads».",
    "Activa los permisos threads_basic y threads_content_publish.",
    "En Configuración del caso de uso, en «URL de devolución de llamada de redireccionamiento», pega la dirección de abajo.",
    "Copia el «Identificador de la app de Threads» y su «Clave secreta» (no los de la app de Facebook), pégalos aquí y aprieta Conectar.",
  ],
  notes: ["Si la app está en modo desarrollo, agrega cada cuenta de Threads como «evaluador» y acepta la invitación desde Threads › Configuración › Cuenta › Permisos de sitios web."],
  fields: [
    { key: "client_id", label: "Identificador de la app de Threads" },
    { key: "client_secret", label: "Clave secreta de Threads", secret: true },
  ],
  authUrl({ app, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, scope: "threads_basic,threads_content_publish", response_type: "code", state });
    return `https://threads.net/oauth/authorize?${q}`;
  },
  async exchangeCode({ app, code, redirectUri }): Promise<Tokens> {
    const j = await fetchJson(`${API}/oauth/access_token`, form({ client_id: app.clientId, client_secret: app.clientSecret || "", grant_type: "authorization_code", redirect_uri: redirectUri, code }), "Threads");
    return { accessToken: j.access_token, expiresAt: exp(j.expires_in) };
  },
  async longLived({ app, tokens }) {
    const q = new URLSearchParams({ grant_type: "th_exchange_token", client_secret: app.clientSecret || "", access_token: tokens.accessToken });
    const j = await fetchJson(`${API}/access_token?${q}`, {}, "Threads");
    return { accessToken: j.access_token, refreshToken: j.access_token, expiresAt: exp(j.expires_in) };
  },
  async refresh({ tokens }) {
    const q = new URLSearchParams({ grant_type: "th_refresh_token", access_token: tokens.accessToken });
    const j = await fetchJson(`${API}/refresh_access_token?${q}`, {}, "Threads").catch((e) => { throw new ProviderError(e.message, true); });
    return { accessToken: j.access_token, refreshToken: j.access_token, expiresAt: exp(j.expires_in) };
  },
  async identify({ tokens }) {
    const j = await fetchJson(`${API}/v1.0/me?fields=id,username,name,threads_profile_picture_url&access_token=${encodeURIComponent(tokens.accessToken)}`, {}, "Threads");
    return { externalId: String(j.id), displayName: j.name || `@${j.username}`, username: j.username || null, avatarUrl: j.threads_profile_picture_url || null };
  },
  async post(account, payload) {
    const tk = account.tokens.accessToken;
    const c = await fetchJson(`${API}/v1.0/me/threads`, form({ media_type: "IMAGE", image_url: payload.mediaUrl, text: payload.caption || "", access_token: tk }), "Threads");
    if (!c?.id) throw new ProviderError("Threads no creó el contenedor");
    for (let i = 0; i < 5; i++) {
      await sleep(i ? 2000 : 1500);
      const s = await fetchJson(`${API}/v1.0/${c.id}?fields=status,error_message&access_token=${encodeURIComponent(tk)}`, {}, "Threads").catch(() => null);
      if (s?.status === "FINISHED") break;
      if (s?.status === "ERROR" || s?.status === "EXPIRED") throw new ProviderError(`Threads no pudo procesar la imagen: ${s.error_message || s.status}`);
    }
    const p = await fetchJson(`${API}/v1.0/me/threads_publish`, form({ creation_id: c.id, access_token: tk }), "Threads");
    const link = await fetchJson(`${API}/v1.0/${p.id}?fields=permalink&access_token=${encodeURIComponent(tk)}`, {}, "Threads").catch(() => null);
    return { externalId: String(p.id), externalUrl: link?.permalink || (account.username ? `https://www.threads.net/@${account.username}` : null) };
  },
};
