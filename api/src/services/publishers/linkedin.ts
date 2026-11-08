import { type SocialProvider, type Tokens, type AccountIdentity, ProviderError, fetchJson } from "./types.js";

/**
 * LinkedIn — OAuth con la app de la persona (BYOK). Dos redes, una app:
 * · linkedin: el perfil personal (producto «Share on LinkedIn»).
 * · linkedin_page: páginas de empresa que administra (producto «Community Management API»),
 *   una cuenta por página — para agencias que llevan las páginas de sus clientes.
 * Imagen: initializeUpload → PUT del archivo → post con la imagen.
 */
const REST = "https://api.linkedin.com/rest";
const VERSION = () => process.env.LINKEDIN_VERSION || "202605";

function headers(token: string, json = true): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "LinkedIn-Version": VERSION(), "X-Restli-Protocol-Version": "2.0.0", ...(json ? { "Content-Type": "application/json" } : {}) };
}
function toTokens(j: any, prev?: Tokens): Tokens {
  if (!j?.access_token) throw new ProviderError("LinkedIn no devolvió el token", true);
  return { accessToken: j.access_token, refreshToken: j.refresh_token || prev?.refreshToken || null, expiresAt: new Date(Date.now() + (Number(j.expires_in) || 5184000) * 1000).toISOString() };
}
async function tokenCall(app: { clientId: string; clientSecret?: string | null }, f: Record<string, string>) {
  return fetchJson("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...f, client_id: app.clientId, client_secret: app.clientSecret || "" }).toString(),
  }, "LinkedIn");
}
/** El formato de texto de LinkedIn reserva estos caracteres: hay que escaparlos. */
function littleText(s: string) {
  return String(s || "").replace(/([\\|{}@[\]()<>#*_~])/g, "\\$1");
}

const shared = {
  appKey: "linkedin",
  appName: "LinkedIn",
  kind: "oauth" as const,
  group: "social" as const,
  color: "#0A66C2",
  cost: 5,
  developerUrl: "https://www.linkedin.com/developers/apps",
  limits: { maxChars: 3000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 8 * 1024 * 1024 },
  fields: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Primary Client Secret", secret: true },
  ],
  async exchangeCode({ app, code, redirectUri }: any) {
    return toTokens(await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  },
  async refresh({ app, tokens }: any) {
    if (!tokens.refreshToken) throw new ProviderError("LinkedIn venció (dura 60 días): vuelve a apretar Conectar", true);
    return toTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }).catch((e) => { throw new ProviderError(e.message, true); }), tokens);
  },
  async post(account: any, payload: any) {
    const tk = account.tokens.accessToken, author = account.options.author;
    if (!author) throw new ProviderError("Falta el autor de LinkedIn: vuelve a conectar");
    const init = await fetchJson(`${REST}/images?action=initializeUpload`, { method: "POST", headers: headers(tk), body: JSON.stringify({ initializeUploadRequest: { owner: author } }) }, "LinkedIn (imagen)");
    const uploadUrl = init?.value?.uploadUrl, image = init?.value?.image;
    if (!uploadUrl || !image) throw new ProviderError("LinkedIn no dio dónde subir la imagen");
    const up = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${tk}`, "Content-Type": payload.mediaMime }, body: await payload.media() });
    if (!up.ok) throw new ProviderError(`LinkedIn: la subida de la imagen falló (${up.status})`);
    const res = await fetch(`${REST}/posts`, {
      method: "POST", headers: headers(tk),
      body: JSON.stringify({
        author, commentary: littleText(payload.caption), visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { id: image, altText: String(payload.caption || "").slice(0, 120) } },
        lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      let m = t; try { m = JSON.parse(t).message || t; } catch {}
      throw new ProviderError(`LinkedIn ${res.status}: ${String(m).slice(0, 200)}`, res.status === 401);
    }
    const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "";
    return { externalId: urn, externalUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },
};

export const linkedin: SocialProvider = {
  ...shared,
  id: "linkedin",
  name: "LinkedIn (perfil)",
  setup: [
    "Entra a linkedin.com/developers › Create app (necesitas una página de empresa para asociarla; puede ser la tuya).",
    "En «Products» agrega «Share on LinkedIn» y «Sign In with LinkedIn using OpenID Connect».",
    "En «Auth» › «Authorized redirect URLs» pega la dirección de abajo.",
    "Copia el Client ID y el Primary Client Secret, pégalos aquí y aprieta Conectar.",
  ],
  notes: ["La conexión dura 60 días; cuando venza, aprieta Conectar de nuevo (LinkedIn no da renovación automática a la mayoría de las apps)."],
  authUrl({ app, redirectUri, state }) {
    const q = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: redirectUri, state, scope: "openid profile w_member_social" });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async identify({ tokens }) {
    const me = await fetchJson("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.accessToken}` } }, "LinkedIn");
    return { externalId: String(me.sub), displayName: me.name || "Perfil de LinkedIn", avatarUrl: me.picture || null, options: { author: `urn:li:person:${me.sub}` } };
  },
};

export const linkedinPage: SocialProvider = {
  ...shared,
  id: "linkedin_page",
  name: "LinkedIn (páginas de empresa)",
  setup: [
    "Usa la misma app de LinkedIn. En «Products» pide además «Community Management API» (LinkedIn la revisa antes de aprobarla).",
    "Cuando esté aprobada, aprieta Conectar: se agregan todas las páginas que administras, una cuenta por página.",
  ],
  notes: ["Sin «Community Management API» aprobada, LinkedIn rechaza la conexión con «unauthorized_scope_error»."],
  authUrl({ app, redirectUri, state }) {
    const q = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: redirectUri, state, scope: "openid profile w_member_social w_organization_social r_organization_admin" });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async listAccounts({ tokens }) {
    const acl = await fetchJson(`${REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50`, { headers: headers(tokens.accessToken, false) }, "LinkedIn");
    const urns: string[] = [...new Set<string>((acl?.elements || []).map((e: any) => String(e.organization || e.organizationTarget || "")).filter(Boolean))].slice(0, 15);
    if (!urns.length) throw new ProviderError("LinkedIn: tu usuario no administra ninguna página de empresa");
    const out: AccountIdentity[] = [];
    for (const urn of urns) {
      const id = urn.split(":").pop();
      const o = await fetchJson(`${REST}/organizations/${id}`, { headers: headers(tokens.accessToken, false) }, "LinkedIn").catch(() => null);
      out.push({ externalId: String(id), displayName: o?.localizedName || `Página ${id}`, username: o?.vanityName || null, options: { author: urn } });
    }
    return out;
  },
  async identify({ tokens, options }) {
    const urn = String(options?.author || ""), id = urn.split(":").pop();
    if (!id) throw new ProviderError("Falta la página de LinkedIn");
    const o = await fetchJson(`${REST}/organizations/${id}`, { headers: headers(tokens.accessToken, false) }, "LinkedIn");
    return { externalId: String(id), displayName: o?.localizedName || `Página ${id}`, username: o?.vanityName || null, options: { author: urn } };
  },
};
