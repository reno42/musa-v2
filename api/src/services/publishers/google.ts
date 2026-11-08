import { type SocialProvider, type Tokens, type AccountIdentity, ProviderError, fetchJson, titleFrom, bodyAfterTitle, textToHtml, escHtml } from "./types.js";

/**
 * Google — una app OAuth de Google Cloud (BYOK) para dos redes:
 * · google_business: publicaciones en Perfiles de Empresa (Google Maps), una cuenta por ubicación.
 * · blogger: entradas en tus blogs de Blogger, una cuenta por blog.
 */
function toTokens(j: any, prev?: Tokens): Tokens {
  if (!j?.access_token) throw new ProviderError("Google no devolvió el token", true);
  return { accessToken: j.access_token, refreshToken: j.refresh_token || prev?.refreshToken || null, expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString() };
}
async function tokenCall(app: { clientId: string; clientSecret?: string | null }, f: Record<string, string>) {
  return fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...f, client_id: app.clientId, client_secret: app.clientSecret || "" }).toString(),
  }, "Google");
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
function authUrl(scope: string) {
  return ({ app, redirectUri, state }: any) => {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, response_type: "code", scope, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  };
}

const shared = {
  appKey: "google",
  appName: "Google",
  kind: "oauth" as const,
  developerUrl: "https://console.cloud.google.com/apis/credentials",
  fields: [
    { key: "client_id", label: "ID de cliente de OAuth" },
    { key: "client_secret", label: "Secreto del cliente", secret: true },
  ],
  async exchangeCode({ app, code, redirectUri }: any) {
    return toTokens(await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  },
  async refresh({ app, tokens }: any) {
    if (!tokens.refreshToken) throw new ProviderError("Google: vuelve a conectar la cuenta", true);
    return toTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }).catch((e) => { throw new ProviderError(e.message, true); }), tokens);
  },
};
const googleSetup = (api: string) => [
  "En console.cloud.google.com crea un proyecto y, en «APIs y servicios › Biblioteca», habilita " + api + ".",
  "En «Pantalla de consentimiento de OAuth» configura la app (tipo Externo) y agrega tu correo como usuario de prueba.",
  "En «Credenciales › Crear credenciales › ID de cliente de OAuth», tipo «Aplicación web», y en «URI de redireccionamiento autorizados» pega la dirección de abajo.",
  "Copia el ID de cliente y el Secreto, pégalos aquí y aprieta Conectar.",
];

export const googleBusiness: SocialProvider = {
  ...shared,
  id: "google_business",
  name: "Google Business Profile",
  group: "social",
  color: "#34A853",
  cost: 2,
  limits: { maxChars: 1500, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 5 * 1024 * 1024 },
  setup: googleSetup("«My Business Account Management API», «My Business Business Information API» y «Google My Business API»"),
  notes: ["Google exige pedir acceso a las APIs de Perfil de Empresa (formulario «GBP API access») antes de que funcionen. Mientras tanto la conexión dará error 403."],
  authUrl: authUrl("https://www.googleapis.com/auth/business.manage"),
  async listAccounts({ tokens }) {
    const acc = await fetchJson("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20", { headers: auth(tokens.accessToken) }, "Google Business");
    const out: AccountIdentity[] = [];
    for (const a of (acc?.accounts || []).slice(0, 5)) {
      const locs = await fetchJson(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=100`, { headers: auth(tokens.accessToken) }, "Google Business").catch(() => ({ locations: [] }));
      for (const l of locs?.locations || []) out.push({ externalId: `${a.name}/${l.name}`, displayName: l.title || l.name, options: { account: a.name, location: l.name } });
    }
    if (!out.length) throw new ProviderError("Google no devolvió ninguna ubicación de Perfil de Empresa para tu usuario");
    return out;
  },
  async identify({ tokens, options }) {
    const loc = options?.location;
    if (!loc) throw new ProviderError("Falta la ubicación");
    const l = await fetchJson(`https://mybusinessbusinessinformation.googleapis.com/v1/${loc}?readMask=name,title`, { headers: auth(tokens.accessToken) }, "Google Business");
    return { externalId: `${options.account}/${loc}`, displayName: l.title || loc, options: { account: options.account, location: loc } };
  },
  async post(account, payload) {
    const { account: a, location: l } = account.options;
    const p = await fetchJson(`https://mybusiness.googleapis.com/v4/${a}/${l}/localPosts`, {
      method: "POST", headers: { ...auth(account.tokens.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ languageCode: "es", summary: payload.caption || "", topicType: "STANDARD", media: [{ mediaFormat: "PHOTO", sourceUrl: payload.mediaUrl }] }),
    }, "Google Business");
    return { externalId: String(p.name || ""), externalUrl: p.searchUrl || null };
  },
};

export const blogger: SocialProvider = {
  ...shared,
  id: "blogger",
  name: "Blogger",
  group: "blog",
  color: "#FF5722",
  cost: 2,
  limits: { maxChars: 20000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  setup: googleSetup("«Blogger API v3»"),
  notes: ["La primera línea del texto es el título de la entrada; el resto, el cuerpo bajo la imagen."],
  authUrl: authUrl("https://www.googleapis.com/auth/blogger"),
  async listAccounts({ tokens }) {
    const j = await fetchJson("https://www.googleapis.com/blogger/v3/users/self/blogs", { headers: auth(tokens.accessToken) }, "Blogger");
    const out = (j?.items || []).map((b: any) => ({ externalId: String(b.id), displayName: b.name, username: b.url || null, options: { blog_id: String(b.id), url: b.url } }));
    if (!out.length) throw new ProviderError("Tu cuenta de Google no tiene blogs en Blogger");
    return out;
  },
  async identify({ tokens, options }) {
    const b = await fetchJson(`https://www.googleapis.com/blogger/v3/blogs/${options?.blog_id}`, { headers: auth(tokens.accessToken) }, "Blogger");
    return { externalId: String(b.id), displayName: b.name, username: b.url || null, options: { blog_id: String(b.id), url: b.url } };
  },
  async post(account, payload) {
    const title = titleFrom(payload.caption, 200);
    const content = `<p><img src="${escHtml(payload.mediaUrl)}" alt="${escHtml(title)}" style="max-width:100%"></p>${textToHtml(bodyAfterTitle(payload.caption))}`;
    const p = await fetchJson(`https://www.googleapis.com/blogger/v3/blogs/${account.options.blog_id}/posts/`, {
      method: "POST", headers: { ...auth(account.tokens.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "blogger#post", title, content }),
    }, "Blogger");
    return { externalId: String(p.id), externalUrl: p.url || null };
  },
};
