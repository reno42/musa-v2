import { type SocialProvider, type Tokens, ProviderError, fetchJson, basicAuth } from "./types.js";

/**
 * X — OAuth 2.0 con PKCE y la app de la persona (BYOK). Imagen con el endpoint
 * v2 de media (scope media.write) y post con /2/tweets.
 * Publicar con imagen puede requerir un plan pago de la API de X: se avisa en el asistente.
 */
const API = "https://api.x.com/2";

function toTokens(j: any, prev?: Tokens): Tokens {
  if (!j?.access_token) throw new ProviderError("X no devolvió el token", true);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || prev?.refreshToken || null,
    expiresAt: new Date(Date.now() + (Number(j.expires_in) || 7200) * 1000).toISOString(),
  };
}

async function tokenCall(app: { clientId: string; clientSecret?: string | null }, form: Record<string, string>) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (app.clientSecret) headers.Authorization = basicAuth(app.clientId, app.clientSecret);
  return fetchJson(`${API}/oauth2/token`, { method: "POST", headers, body: new URLSearchParams({ ...form, client_id: app.clientId }).toString() }, "X");
}

export const x: SocialProvider = {
  id: "x",
  name: "X",
  kind: "oauth",
  color: "#000000",
  limits: { maxChars: 280, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 5 * 1024 * 1024 },
  developerUrl: "https://developer.x.com/en/portal/dashboard",
  setup: [
    "Entra a developer.x.com, crea un proyecto y una app.",
    "En «User authentication settings» activa OAuth 2.0, permisos «Read and write», tipo «Web App», y en «Callback URI» pega la dirección de abajo.",
    "Copia el Client ID y el Client Secret de OAuth 2.0 (no los API Key de OAuth 1), pégalos aquí y aprieta Conectar.",
  ],
  notes: ["Publicar con imagen puede requerir un plan pago de la API de X en tu cuenta de desarrollador. Si X lo rechaza, verás el motivo en el destino."],
  fields: [
    { key: "client_id", label: "Client ID (OAuth 2.0)" },
    { key: "client_secret", label: "Client Secret", secret: true },
  ],
  authUrl({ app, redirectUri, state, codeChallenge }) {
    const q = new URLSearchParams({
      response_type: "code", client_id: app.clientId, redirect_uri: redirectUri, state,
      scope: "tweet.read tweet.write users.read media.write offline.access",
      code_challenge: codeChallenge, code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },
  async exchangeCode({ app, code, redirectUri, codeVerifier }) {
    return toTokens(await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }));
  },
  async refresh({ app, tokens }) {
    if (!tokens.refreshToken) throw new ProviderError("X: no hay refresh token, vuelve a conectar la cuenta", true);
    return toTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }).catch((e) => { throw new ProviderError(e.message, true); }), tokens);
  },
  async identify({ tokens }) {
    const me = await fetchJson(`${API}/users/me?user.fields=profile_image_url`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }, "X");
    const u = me?.data || {};
    return { externalId: String(u.id), displayName: u.name || `@${u.username}`, username: u.username || null, avatarUrl: u.profile_image_url || null };
  },
  async post(account, payload) {
    const auth = { Authorization: `Bearer ${account.tokens.accessToken}` };
    const form = new FormData();
    form.append("media", await payload.media(), payload.mediaMime === "image/png" ? "musa.png" : "musa.jpg");
    form.append("media_category", "tweet_image");
    form.append("media_type", payload.mediaMime);
    const up = await fetchJson(`${API}/media/upload`, { method: "POST", headers: auth, body: form, timeoutMs: 30000 }, "X (imagen)");
    const mediaId = up?.data?.id || up?.media_id_string;
    if (!mediaId) throw new ProviderError("X no devolvió el id de la imagen");
    const tw = await fetchJson(`${API}/tweets`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: payload.caption || "", media: { media_ids: [String(mediaId)] } }),
    }, "X");
    const id = tw?.data?.id;
    if (!id) throw new ProviderError("X no devolvió el id del post");
    return { externalId: String(id), externalUrl: `https://x.com/${account.username || "i"}/status/${id}` };
  },
};
