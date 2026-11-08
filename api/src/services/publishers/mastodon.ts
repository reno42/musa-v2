import { type SocialProvider, ProviderError, fetchJson, siteUrl } from "./types.js";

/**
 * Mastodon — cualquier instancia. token-BYOK: la persona crea una «aplicación» en
 * Preferencias › Desarrollo de SU instancia y pega la dirección + el token de acceso.
 */
function creds(token: string) {
  try { return JSON.parse(token) as { instance: string; token: string }; }
  catch { throw new ProviderError("Credenciales de Mastodon dañadas: vuelve a conectar", true); }
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

export const mastodon: SocialProvider = {
  id: "mastodon",
  name: "Mastodon",
  kind: "token",
  group: "social",
  color: "#6364FF",
  cost: 3,
  limits: { maxChars: 500, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 8 * 1024 * 1024 },
  setup: [
    "En tu instancia (por ejemplo mastodon.social) abre Preferencias › Desarrollo › Nueva aplicación, con nombre «Musa».",
    "Deja marcados solo los permisos read:accounts, write:statuses y write:media, y guarda.",
    "Abre la aplicación, copia «Tu token de acceso» y pégalo aquí junto con la dirección de tu instancia.",
  ],
  fields: [
    { key: "instance", label: "Instancia", placeholder: "mastodon.social" },
    { key: "token", label: "Token de acceso", secret: true },
  ],
  tokensFromInput(input) {
    const token = String(input.token || "").trim();
    if (token.length < 20) throw new ProviderError("Ese token de Mastodon es muy corto");
    return { accessToken: JSON.stringify({ instance: siteUrl(input.instance), token }), refreshToken: null, expiresAt: null };
  },
  async identify({ tokens }) {
    const c = creds(tokens.accessToken);
    const me = await fetchJson(`${c.instance}/api/v1/accounts/verify_credentials`, { headers: auth(c.token) }, "Mastodon").catch((e) => { if (/401/.test(e.message)) throw new ProviderError("Mastodon: el token no es válido", true); throw e; });
    const host = new URL(c.instance).host;
    return { externalId: `${host}:${me.id}`, displayName: me.display_name || me.username, username: `${me.username}@${host}`, avatarUrl: me.avatar || null };
  },
  async post(account, payload) {
    const c = creds(account.tokens.accessToken);
    const fd = new FormData();
    fd.append("file", await payload.media(), payload.mediaMime === "image/png" ? "musa.png" : "musa.jpg");
    fd.append("description", (payload.caption || "").slice(0, 1500));
    const media = await fetchJson(`${c.instance}/api/v2/media`, { method: "POST", headers: auth(c.token), body: fd, timeoutMs: 30000 }, "Mastodon (imagen)");
    const st = await fetchJson(`${c.instance}/api/v1/statuses`, {
      method: "POST", headers: { ...auth(c.token), "Content-Type": "application/json", "Idempotency-Key": `musa-${media.id}` },
      body: JSON.stringify({ status: payload.caption || "", media_ids: [media.id], visibility: "public" }),
    }, "Mastodon");
    return { externalId: String(st.id), externalUrl: st.url || null };
  },
};
