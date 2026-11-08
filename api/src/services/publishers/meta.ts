import { type SocialProvider, type Tokens, type AccountIdentity, ProviderError, fetchJson } from "./types.js";

/**
 * Meta — una sola app de developer (BYOK) conecta Páginas de Facebook y cuentas
 * profesionales de Instagram ligadas a esas páginas. Un inicio de sesión trae
 * TODAS las páginas que la persona administra (ideal para agencias con Business Manager).
 * Cada página/perfil queda como cuenta propia con el token de su página (no vence
 * si viene de un token de usuario de larga duración).
 */
const V = () => process.env.META_GRAPH_VERSION || "v23.0";
const G = () => `https://graph.facebook.com/${V()}`;
const SCOPES = "pages_show_list,pages_manage_posts,pages_read_engagement,business_management,instagram_basic,instagram_content_publish";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function form(o: Record<string, string>) {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() };
}

const shared = {
  appKey: "meta",
  appName: "Meta (Facebook + Instagram)",
  kind: "oauth" as const,
  group: "social" as const,
  developerUrl: "https://developers.facebook.com/apps/",
  setup: [
    "Entra a developers.facebook.com › Mis apps › Crear app, tipo «Empresa» (Business).",
    "Agrega los productos «Inicio de sesión con Facebook para empresas» e «Instagram (API con inicio de sesión de Facebook)».",
    "En la configuración del inicio de sesión, en «URI de redireccionamiento de OAuth válidos», pega la dirección de abajo.",
    "En Configuración › Básica copia el «Identificador de la app» y la «Clave secreta», pégalos aquí y aprieta Conectar. Con un solo inicio de sesión se conectan todas tus páginas y sus Instagram.",
  ],
  notes: [
    "Mientras la app esté en «modo desarrollo» solo puedes publicar en páginas donde tu usuario es administrador. Para clientes cuyas páginas no administras, pide los permisos en la revisión de apps de Meta o pídeles acceso en tu Business Manager.",
    "Instagram: solo cuentas profesionales (empresa o creador) vinculadas a una página de Facebook.",
  ],
  fields: [
    { key: "client_id", label: "Identificador de la app (App ID)" },
    { key: "client_secret", label: "Clave secreta de la app", secret: true },
  ],
  authUrl({ app, redirectUri, state }: any) {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, state, response_type: "code", scope: SCOPES });
    return `https://www.facebook.com/${V()}/dialog/oauth?${q}`;
  },
  async exchangeCode({ app, code, redirectUri }: any): Promise<Tokens> {
    const q = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret || "", redirect_uri: redirectUri, code });
    const j = await fetchJson(`${G()}/oauth/access_token?${q}`, {}, "Meta");
    return { accessToken: j.access_token, expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null };
  },
  async longLived({ app, tokens }: any): Promise<Tokens> {
    const q = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.clientId, client_secret: app.clientSecret || "", fb_exchange_token: tokens.accessToken });
    const j = await fetchJson(`${G()}/oauth/access_token?${q}`, {}, "Meta");
    return { accessToken: j.access_token, expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null };
  },
  async listAccounts({ tokens }: any): Promise<AccountIdentity[]> {
    const fields = "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}";
    const j = await fetchJson(`${G()}/me/accounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(tokens.accessToken)}`, {}, "Meta");
    const out: AccountIdentity[] = [];
    for (const p of j?.data || []) {
      if (!p.access_token) continue;
      const pageTokens = { accessToken: p.access_token, refreshToken: null, expiresAt: null };
      out.push({ provider: "facebook", externalId: String(p.id), displayName: p.name, avatarUrl: p.picture?.data?.url || null, options: { page_id: p.id }, tokens: pageTokens });
      const ig = p.instagram_business_account;
      if (ig?.id) out.push({ provider: "instagram", externalId: String(ig.id), displayName: ig.name || `@${ig.username}`, username: ig.username || null, avatarUrl: ig.profile_picture_url || null, options: { ig_id: ig.id, page_id: p.id, page_name: p.name }, tokens: pageTokens });
    }
    if (!out.length) throw new ProviderError("Meta no devolvió ninguna página. Revisa que tu usuario administre al menos una página y que aceptaste todas en la ventana de permisos.");
    return out;
  },
};

export const facebook: SocialProvider = {
  ...shared,
  id: "facebook",
  name: "Facebook (páginas)",
  color: "#1877F2",
  cost: 2,
  limits: { maxChars: 5000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 10 * 1024 * 1024 },
  async identify({ tokens, options }) {
    const id = options?.page_id || "me";
    const j = await fetchJson(`${G()}/${id}?fields=id,name,picture{url}&access_token=${encodeURIComponent(tokens.accessToken)}`, {}, "Facebook");
    return { externalId: String(j.id), displayName: j.name, avatarUrl: j.picture?.data?.url || null, options: { page_id: j.id } };
  },
  async post(account, payload) {
    const pageId = account.options.page_id || account.externalId;
    const j = await fetchJson(`${G()}/${pageId}/photos`, form({ url: payload.mediaUrl, caption: payload.caption || "", published: "true", access_token: account.tokens.accessToken }), "Facebook");
    const postId = j.post_id || j.id;
    return { externalId: String(postId), externalUrl: `https://www.facebook.com/${postId}` };
  },
};

export const instagram: SocialProvider = {
  ...shared,
  id: "instagram",
  name: "Instagram",
  color: "#E1306C",
  cost: 6,
  limits: { maxChars: 2200, maxMedia: 1, formats: ["image/jpeg"], maxBytes: 8 * 1024 * 1024 },
  async identify({ tokens, options }) {
    const id = options?.ig_id || options?.external_id;
    if (!id) throw new ProviderError("Falta el id de la cuenta de Instagram");
    const j = await fetchJson(`${G()}/${id}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(tokens.accessToken)}`, {}, "Instagram");
    return { externalId: String(j.id), displayName: j.name || `@${j.username}`, username: j.username, avatarUrl: j.profile_picture_url || null, options: { ...(options || {}), ig_id: j.id } };
  },
  async post(account, payload) {
    const ig = account.options.ig_id || account.externalId, tk = account.tokens.accessToken;
    const c = await fetchJson(`${G()}/${ig}/media`, form({ image_url: payload.mediaUrl, caption: payload.caption || "", access_token: tk }), "Instagram");
    if (!c?.id) throw new ProviderError("Instagram no creó el contenedor de la imagen");
    for (let i = 0; i < 4; i++) {
      const s = await fetchJson(`${G()}/${c.id}?fields=status_code&access_token=${encodeURIComponent(tk)}`, {}, "Instagram");
      if (s?.status_code === "FINISHED") break;
      if (s?.status_code === "ERROR" || s?.status_code === "EXPIRED") throw new ProviderError(`Instagram no pudo procesar la imagen (${s.status_code}). Revisa que sea JPG y de proporción entre 4:5 y 1.91:1.`);
      await sleep(1500);
    }
    const p = await fetchJson(`${G()}/${ig}/media_publish`, form({ creation_id: c.id, access_token: tk }), "Instagram");
    const link = await fetchJson(`${G()}/${p.id}?fields=permalink&access_token=${encodeURIComponent(tk)}`, {}, "Instagram").catch(() => null);
    return { externalId: String(p.id), externalUrl: link?.permalink || (account.username ? `https://www.instagram.com/${account.username}/` : null) };
  },
};
