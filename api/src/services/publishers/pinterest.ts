import { type SocialProvider, type Tokens, ProviderError, fetchJson, basicAuth, titleFrom, bodyAfterTitle } from "./types.js";

/**
 * Pinterest — OAuth con la app de la persona (BYOK). Pin con la imagen por URL
 * (Pinterest la descarga). Tablero: se elige en la tarjeta de la cuenta.
 */
const API = "https://api.pinterest.com/v5";

function toTokens(j: any, prev?: Tokens): Tokens {
  if (!j?.access_token) throw new ProviderError("Pinterest no devolvió el token", true);
  return { accessToken: j.access_token, refreshToken: j.refresh_token || prev?.refreshToken || null, expiresAt: new Date(Date.now() + (Number(j.expires_in) || 2592000) * 1000).toISOString() };
}
async function tokenCall(app: { clientId: string; clientSecret?: string | null }, f: Record<string, string>) {
  return fetchJson(`${API}/oauth/token`, {
    method: "POST", headers: { Authorization: basicAuth(app.clientId, app.clientSecret || ""), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(f).toString(),
  }, "Pinterest");
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

export const pinterest: SocialProvider = {
  id: "pinterest",
  name: "Pinterest",
  kind: "oauth",
  group: "social",
  color: "#E60023",
  cost: 3,
  limits: { maxChars: 500, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  developerUrl: "https://developers.pinterest.com/apps/",
  setup: [
    "Entra a developers.pinterest.com › My apps › Connect app (con una cuenta de empresa de Pinterest).",
    "En la app, en «Redirect URIs», agrega la dirección de abajo.",
    "Copia el App ID y el App secret key, pégalos aquí y aprieta Conectar.",
  ],
  notes: ["Las apps nuevas empiezan con «Trial access»: pide «Standard access» en el portal para que los pines sean públicos."],
  fields: [
    { key: "client_id", label: "App ID" },
    { key: "client_secret", label: "App secret key", secret: true },
  ],
  authUrl({ app, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, response_type: "code", scope: "boards:read,pins:read,pins:write,user_accounts:read", state });
    return `https://www.pinterest.com/oauth/?${q}`;
  },
  async exchangeCode({ app, code, redirectUri }) {
    return toTokens(await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  },
  async refresh({ app, tokens }) {
    if (!tokens.refreshToken) throw new ProviderError("Pinterest: vuelve a conectar la cuenta", true);
    return toTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }).catch((e) => { throw new ProviderError(e.message, true); }), tokens);
  },
  async identify({ tokens, options }) {
    const me = await fetchJson(`${API}/user_account`, { headers: auth(tokens.accessToken) }, "Pinterest");
    const b = await fetchJson(`${API}/boards?page_size=100`, { headers: auth(tokens.accessToken) }, "Pinterest").catch(() => ({ items: [] }));
    const boards = (b?.items || []).map((x: any) => ({ id: String(x.id), name: x.name }));
    const keep = options?.board_id && boards.some((x: any) => x.id === options.board_id) ? options.board_id : boards[0]?.id || null;
    return { externalId: String(me.id || me.username), displayName: me.business_name || me.username, username: me.username, avatarUrl: me.profile_image || null, options: { boards, board_id: keep } };
  },
  async post(account, payload) {
    const board = account.options.board_id;
    if (!board) throw new ProviderError("Elige un tablero de Pinterest en la tarjeta de la cuenta (o crea uno en Pinterest y aprieta Revisar)");
    const desc = bodyAfterTitle(payload.caption) || payload.caption || "";
    const pin = await fetchJson(`${API}/pins`, {
      method: "POST", headers: { ...auth(account.tokens.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ board_id: board, title: titleFrom(payload.caption, 100), description: desc.slice(0, 500), alt_text: titleFrom(payload.caption, 500), media_source: { source_type: "image_url", url: payload.mediaUrl } }),
    }, "Pinterest");
    return { externalId: String(pin.id), externalUrl: `https://www.pinterest.com/pin/${pin.id}/` };
  },
};
