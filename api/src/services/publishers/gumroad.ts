import { type SocialProvider, ProviderError, fetchJson, titleFrom, bodyAfterTitle, textToHtml, escHtml } from "./types.js";

/**
 * Gumroad: publicar = un «Email» (post) a tu audiencia, con la imagen arriba del texto.
 * Token: Settings › Advanced › Applications › crear app › «Generate access token» (trae los
 * permisos públicos, entre ellos edit_emails y edit_profile). API v2: https://gumroad.com/api
 */
const API = "https://api.gumroad.com/v2";
const AUD: Record<string, string> = { seguidores: "followers", followers: "followers", clientes: "customers", customers: "customers", todos: "all", all: "all" };
const AUD_ES: Record<string, string> = { followers: "seguidores", customers: "clientes", all: "seguidores y clientes" };

async function gr(token: string, path: string, init: RequestInit = {}) {
  const j = await fetchJson(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Gumroad")
    .catch((e) => { if (/ 401| 403/.test(e.message)) throw new ProviderError("Gumroad: el access token no es válido o no tiene permiso para correos", true); throw e; });
  // Gumroad responde 200 con success:false cuando algo no se pudo hacer.
  if (j && j.success === false) throw new ProviderError(`Gumroad: ${j.message || "no se pudo completar"}`, /token|scope|auth/i.test(String(j.message)));
  return j;
}
function form(o: Record<string, string>) {
  const f = new URLSearchParams(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f;
}

export const gumroad: SocialProvider = {
  id: "gumroad", name: "Gumroad", kind: "token", group: "blog", color: "#D6339E", cost: 3,
  limits: { maxChars: 20000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 10 * 1024 * 1024 },
  setup: [
    "En gumroad.com abre Settings › Advanced › Applications y crea una aplicación (nombre «Musa»; en Redirect URI puedes poner https://musa-v2.renzo-08c.workers.dev).",
    "Toca «Generate access token» y copia el token.",
    "Pégalo aquí y elige a quién le llega: seguidores, clientes o todos.",
  ],
  notes: ["Publicar aquí ENVÍA un correo a esa audiencia y queda como publicación en Gumroad."],
  fields: [
    { key: "token", label: "Access token", secret: true },
    { key: "audience", label: "Para quién", placeholder: "seguidores, clientes o todos", help: "Vacío = seguidores." },
  ],
  developerUrl: "https://gumroad.com/settings/advanced",
  tokensFromInput(input) {
    const t = String(input.token || "").trim();
    if (t.length < 10) throw new ProviderError("Ese access token de Gumroad es muy corto");
    return { accessToken: t, refreshToken: null, expiresAt: null };
  },
  async identify({ tokens, input, options }) {
    const raw = String(input?.audience || options?.audience || "seguidores").trim().toLowerCase();
    const audience = AUD[raw];
    if (!audience) throw new ProviderError("«Para quién» debe ser seguidores, clientes o todos");
    const u = (await gr(tokens.accessToken, "/user"))?.user || {};
    const name = String(u.name || u.username || u.email || "Gumroad");
    return {
      externalId: `${u.user_id || u.id || name}:${audience}`,
      displayName: `${name} · ${AUD_ES[audience]}`,
      username: u.url || (u.username ? `${u.username}.gumroad.com` : null),
      avatarUrl: u.profile_url || null,
      options: { audience },
    };
  },
  async post(account, payload) {
    const t = account.tokens.accessToken;
    // La imagen se aloja en Gumroad (biblioteca de medios del perfil) para que el correo no dependa de Musa.
    let img = payload.mediaUrl;
    const m = await gr(t, "/media", { method: "POST", body: form({ url: payload.mediaUrl, name: "musa-" + Date.now() }) }).catch(() => null);
    const hosted = m?.media?.url || m?.media?.public_url;
    if (hosted) img = String(hosted);
    const title = titleFrom(payload.caption, 200);
    const html = `<p><img src="${escHtml(img)}" alt="${escHtml(title)}"></p>${textToHtml(bodyAfterTitle(payload.caption)) || ""}`;
    const j = await gr(t, "/emails", { method: "POST", body: form({ subject: title, body: html, audience: account.options.audience || "followers", publish: "true" }) });
    const e = j?.email || {};
    return { externalId: String(e.id || e.external_id || ""), externalUrl: e.url || null };
  },
};
