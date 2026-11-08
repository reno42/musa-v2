import { type SocialProvider, ProviderError, fetchJson, siteUrl } from "./types.js";

/**
 * Bluesky — token-BYOK con «contraseña de app» (nunca la contraseña real).
 * Cada publicación abre una sesión, sube la imagen como blob y crea el post con
 * enlaces y hashtags clicables (facets). Bluesky acepta imágenes de hasta ~1 MB:
 * Musa manda una versión liviana cuando eliges Bluesky.
 */
const enc = new TextEncoder();

function creds(token: string) {
  try { return JSON.parse(token) as { identifier: string; password: string; service: string }; }
  catch { throw new ProviderError("Credenciales de Bluesky dañadas: vuelve a conectar", true); }
}

async function session(c: { identifier: string; password: string; service: string }) {
  return fetchJson(`${c.service}/xrpc/com.atproto.server.createSession`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: c.identifier, password: c.password }),
  }, "Bluesky").catch((e) => {
    if (/401|AuthenticationRequired|Invalid identifier or password/i.test(e.message)) throw new ProviderError("Bluesky: usuario o contraseña de app incorrectos", true);
    throw e;
  });
}

/** Enlaces y #hashtags clicables: Bluesky los pide con posiciones en bytes UTF-8. */
function facets(text: string) {
  const out: any[] = [];
  const byteAt = (i: number) => enc.encode(text.slice(0, i)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const s = m.index!, e = s + m[0].length;
    out.push({ index: { byteStart: byteAt(s), byteEnd: byteAt(e) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const s = m.index! + m[1].length, e = s + 1 + m[2].length;
    out.push({ index: { byteStart: byteAt(s), byteEnd: byteAt(e) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }] });
  }
  return out;
}

export const bluesky: SocialProvider = {
  id: "bluesky",
  name: "Bluesky",
  kind: "token",
  group: "social",
  color: "#0085FF",
  cost: 4,
  limits: { maxChars: 300, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 976 * 1024 },
  developerUrl: "https://bsky.app/settings/app-passwords",
  setup: [
    "En Bluesky abre Configuración › Privacidad y seguridad › Contraseñas de app y crea una nueva (por ejemplo «Musa»).",
    "Pega aquí tu usuario (tu.handle.bsky.social) y esa contraseña de app. Nunca pegues tu contraseña real.",
  ],
  fields: [
    { key: "identifier", label: "Usuario", placeholder: "tumarca.bsky.social" },
    { key: "password", label: "Contraseña de app", placeholder: "xxxx-xxxx-xxxx-xxxx", secret: true },
    { key: "service", label: "Servidor (opcional)", placeholder: "https://bsky.social" },
  ],
  tokensFromInput(input) {
    const identifier = String(input.identifier || "").trim().replace(/^@/, "");
    const password = String(input.password || "").trim();
    if (!identifier || !password) throw new ProviderError("Falta el usuario o la contraseña de app");
    const service = input.service ? siteUrl(input.service) : "https://bsky.social";
    return { accessToken: JSON.stringify({ identifier, password, service }), refreshToken: null, expiresAt: null };
  },
  async identify({ tokens }) {
    const c = creds(tokens.accessToken), s = await session(c);
    const prof = await fetchJson(`${c.service}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(s.did)}`, { headers: { Authorization: `Bearer ${s.accessJwt}` } }, "Bluesky").catch(() => null);
    return { externalId: s.did, displayName: prof?.displayName || `@${s.handle}`, username: s.handle, avatarUrl: prof?.avatar || null };
  },
  async post(account, payload) {
    const c = creds(account.tokens.accessToken), s = await session(c);
    const blob = await payload.media();
    const up = await fetchJson(`${c.service}/xrpc/com.atproto.repo.uploadBlob`, { method: "POST", headers: { Authorization: `Bearer ${s.accessJwt}`, "Content-Type": blob.type || payload.mediaMime }, body: blob }, "Bluesky (imagen)");
    const text = payload.caption || "";
    const record: any = {
      $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), langs: ["es"],
      embed: { $type: "app.bsky.embed.images", images: [{ alt: text.slice(0, 300), image: up.blob }] },
    };
    const f = facets(text); if (f.length) record.facets = f;
    const r = await fetchJson(`${c.service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST", headers: { Authorization: `Bearer ${s.accessJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
    }, "Bluesky");
    const rkey = String(r.uri || "").split("/").pop();
    return { externalId: String(r.uri), externalUrl: rkey ? `https://bsky.app/profile/${s.handle}/post/${rkey}` : null };
  },
};
