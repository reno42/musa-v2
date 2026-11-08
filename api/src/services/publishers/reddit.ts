import { type SocialProvider, type Tokens, ProviderError, fetchJson, basicAuth } from "./types.js";

/**
 * Reddit — OAuth con la app «web app» de la persona (BYOK).
 * Imagen nativa: pedir un espacio de subida (media/asset), subir el archivo al
 * bucket que indica Reddit y enviar el post kind=image con esa URL.
 * Sub por defecto: el perfil de la cuenta (u_<usuario>); se cambia en la tarjeta.
 */
const UA = "web:musa-publisher:1.0";
const WWW = "https://www.reddit.com";
const OAUTH = "https://oauth.reddit.com";

function toTokens(j: any, prev?: Tokens): Tokens {
  if (!j?.access_token) throw new ProviderError("Reddit no devolvió el token", true);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || prev?.refreshToken || null,
    expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(),
  };
}

async function tokenCall(app: { clientId: string; clientSecret?: string | null }, form: Record<string, string>) {
  return fetchJson(`${WWW}/api/v1/access_token`, {
    method: "POST",
    headers: { Authorization: basicAuth(app.clientId, app.clientSecret || ""), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams(form).toString(),
  }, "Reddit");
}

function api(token: string, path: string, form?: Record<string, string>) {
  return fetchJson(`${OAUTH}${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  }, "Reddit");
}

function titleFrom(caption: string) {
  const first = (caption || "").split(/\r?\n/).find((l) => l.trim()) || "Nueva publicación";
  return first.trim().slice(0, 300);
}

export const reddit: SocialProvider = {
  id: "reddit",
  name: "Reddit",
  kind: "oauth",
  color: "#FF4500",
  limits: { maxChars: 300, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  developerUrl: "https://www.reddit.com/prefs/apps",
  setup: [
    "Entra a reddit.com/prefs/apps con tu cuenta y aprieta «create another app…».",
    "Elige el tipo «web app». En «redirect uri» pega la dirección de abajo, tal cual.",
    "Copia el id (debajo del nombre de la app) y el «secret», pégalos aquí y aprieta Conectar.",
  ],
  notes: ["El texto se usa como título del post (máx. 300 caracteres). Por defecto publica en tu perfil; puedes elegir un subreddit en la tarjeta de la cuenta."],
  fields: [
    { key: "client_id", label: "Client ID", placeholder: "debajo del nombre de la app" },
    { key: "client_secret", label: "Secret", secret: true },
  ],
  authUrl({ app, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: app.clientId, response_type: "code", state, redirect_uri: redirectUri, duration: "permanent", scope: "identity submit" });
    return `${WWW}/api/v1/authorize?${q}`;
  },
  async exchangeCode({ app, code, redirectUri }) {
    return toTokens(await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  },
  async refresh({ app, tokens }) {
    if (!tokens.refreshToken) throw new ProviderError("Reddit: no hay refresh token, vuelve a conectar la cuenta", true);
    return toTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }).catch((e) => { throw new ProviderError(e.message, true); }), tokens);
  },
  async identify({ tokens }) {
    const me = await api(tokens.accessToken, "/api/v1/me");
    return {
      externalId: String(me.id),
      displayName: `u/${me.name}`,
      username: me.name,
      avatarUrl: (me.icon_img || me.snoovatar_img || "").split("?")[0] || null,
      options: { subreddit: `u_${me.name}` },
    };
  },
  async post(account, payload) {
    const token = account.tokens.accessToken;
    const sr = String(account.options.subreddit || `u_${account.username}`).replace(/^\/?r\//i, "").trim();
    const ext = payload.mediaMime === "image/png" ? "png" : "jpg";
    const lease = await api(token, "/api/media/asset.json", { filepath: `musa.${ext}`, mimetype: payload.mediaMime });
    const action: string = lease?.args?.action || "";
    const fields: { name: string; value: string }[] = lease?.args?.fields || [];
    if (!action || !fields.length) throw new ProviderError("Reddit no dio un espacio para subir la imagen");
    const uploadUrl = action.startsWith("//") ? `https:${action}` : action;
    const form = new FormData();
    for (const f of fields) form.append(f.name, f.value);
    form.append("file", await payload.media(), `musa.${ext}`);
    const up = await fetch(uploadUrl, { method: "POST", body: form });
    if (!up.ok && up.status !== 201) throw new ProviderError(`Reddit: la subida de la imagen falló (${up.status})`);
    const key = fields.find((f) => f.name === "key")?.value;
    const imageUrl = `${uploadUrl}/${key}`;
    const res = await api(token, "/api/submit", { sr, kind: "image", title: titleFrom(payload.caption), url: imageUrl, resubmit: "true", api_type: "json", sendreplies: "true" });
    const errors = res?.json?.errors || [];
    if (errors.length) throw new ProviderError(`Reddit: ${errors.map((e: any[]) => e.slice(1).join(" ")).join("; ")}`);
    const page: string | null = res?.json?.data?.user_submitted_page || res?.json?.data?.url || null;
    const name = res?.json?.data?.name || res?.json?.data?.id || lease?.asset?.asset_id || "";
    return { externalId: String(name), externalUrl: page || `https://www.reddit.com/${sr.startsWith("u_") ? "user/" + sr.slice(2) : "r/" + sr}/` };
  },
};
