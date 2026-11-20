import { type SocialProvider, type Tokens, type AccountIdentity, ProviderError, fetchJson } from "./types.js";

/**
 * TikTok (fotos/carrousel) — OAuth v2 BYOK por workspace.
 * La app del usuario (developers.tiktok.com) pide los scopes photo_publish y
 * user.info.basic. La publicación usa PULL_FROM_URL: TikTok descarga la imagen
 * pública de Musa; el dominio de storage debe estar VERIFICADO en el portal de
 * TikTok (Configuration → Domains) — está en las notas del asistente.
 */
const K = "https://www.tiktok.com/v2/auth/authorize/";
const T = "https://open.tiktokapis.com/v2";
const SCOPES = "user.info.basic,photo.publish";

function form(o: Record<string, string>) {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() };
}

export const tiktok: SocialProvider = {
  id: "tiktok",
  name: "TikTok",
  kind: "oauth",
  group: "social",
  color: "#FE2C55",
  cost: 2,
  limits: { maxChars: 2200, maxMedia: 1, formats: ["image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  developerUrl: "https://developers.tiktok.com/apps",
  setup: [
    "En developers.tiktok.com crea una app (tipo «Web») y agrega el producto «Content Posting API» (fotos) y «User Info Basics».",
    "En la configuración del producto, activa «Photo publish». En «Domains», verifica el dominio que te mostramos abajo (verificación por archivo o meta-tag).",
    "En «Redirect URIs» pega la dirección de abajo. Copia el «Client key» y el «Client secret», pégalos aquí y aprieta Conectar.",
  ],
  notes: [
    "TikTok exige verificar el dominio de las imágenes (PULL_FROM_URL). Sigue el paso 2 o la publicación devolverá access_token error 403 (verify_domain_fail).",
    "La app en auditoría (no verificada) solo puede publicar en cuentas propias. Para clientes, agrega sus TikTok como usuarios de la app o completa la auditoría de TikTok.",
    "El video de TikTok llega con el uploader dedicado (v2/post/publish/video) — este provider publica FOTOS y carrouseles.",
  ],
  fields: [
    { key: "client_id", label: "Client key de la app" },
    { key: "client_secret", label: "Client secret", secret: true },
  ],
  authUrl({ app, redirectUri, state, codeChallenge }: any) {
    const q = new URLSearchParams({
      client_key: app.clientId, scope: SCOPES, response_type: "code", redirect_uri: redirectUri, state,
      code_challenge: codeChallenge, code_challenge_method: "S256",
    });
    return `${K}?${q}`;
  },
  async exchangeCode({ app, code, redirectUri, codeVerifier }: any): Promise<Tokens> {
    const j = await fetchJson(`${T}/oauth/token/`, form({
      client_key: app.clientId, client_secret: app.clientSecret || "", code, grant_type: "authorization_code",
      redirect_uri: redirectUri, code_verifier: codeVerifier,
    }), "TikTok");
    if (!j?.access_token) throw new ProviderError(`TikTok no devolvió token (${j?.error || "sin detalle"})`, true);
    return {
      accessToken: j.access_token, refreshToken: j.refresh_token || null,
      expiresAt: new Date(Date.now() + (Number(j.expires_in) || 86400) * 1000).toISOString(),
      options: { open_id: j.open_id },
    };
  },
  async refresh({ app, tokens }: any): Promise<Tokens> {
    if (!tokens.refreshToken) throw new ProviderError("TikTok: vuelve a conectar la cuenta (el refresh token venció)", true);
    const j = await fetchJson(`${T}/oauth/token/`, form({
      client_key: app.clientId, client_secret: app.clientSecret || "", grant_type: "refresh_token", refresh_token: tokens.refreshToken,
    }), "TikTok").catch((e) => { throw new ProviderError(e.message, true); });
    return {
      accessToken: j.access_token, refreshToken: j.refresh_token || tokens.refreshToken,
      expiresAt: new Date(Date.now() + (Number(j.expires_in) || 86400) * 1000).toISOString(),
    };
  },
  async listAccounts({ tokens }: any): Promise<AccountIdentity[]> {
    const id = await tiktok.identify({ tokens });
    return [id];
  },
  async identify({ tokens, options }): Promise<AccountIdentity> {
    const j = await fetchJson(`${T}/user/info/?fields=open_id,union_id,display_name,avatar_url`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }, "TikTok");
    const u = j?.data?.user;
    if (!u?.open_id) throw new ProviderError("TikTok no devolvió el usuario (token sin scope user.info.basic)", true);
    return { provider: "tiktok", externalId: String(u.open_id), displayName: u.display_name || "TikTok", avatarUrl: u.avatar_url || null, options: { ...(options || {}), open_id: u.open_id } };
  },
  async post(account, payload) {
    const tk = account.tokens.accessToken;
    const body = {
      post_info: {
        title: (payload.caption || "").split(/\r?\n/)[0]?.slice(0, 90) || "Nueva publicación",
        description: (payload.caption || "").slice(0, 2200),
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duets: false, disable_comments: false, disable_stitch: false,
        auto_add_music: false,
      },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [payload.mediaUrl] },
    };
    const j = await fetchJson(`${T}/post/publish/content/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    }, "TikTok");
    if (j?.error?.code && j.error.code !== "ok") throw new ProviderError(`TikTok: ${j.error.message || j.error.code}`);
    const pid = j?.data?.publish_id;
    if (!pid) throw new ProviderError("TikTok no devolvió publish_id");
    return { externalId: String(pid), externalUrl: "https://www.tiktok.com/" };
  },
};
