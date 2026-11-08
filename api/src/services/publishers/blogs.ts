import { type SocialProvider, ProviderError, fetchJson, siteUrl, titleFrom, bodyAfterTitle, textToHtml, escHtml, basicAuth } from "./types.js";

/**
 * Blogs y newsletters con llave (token-BYOK). La primera línea del texto es el
 * título; el resto, el cuerpo debajo de la imagen.
 */
const enc = new TextEncoder();
function b64url(bytes: Uint8Array | string) {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function parse<T>(token: string, name: string): T {
  try { return JSON.parse(token) as T; } catch { throw new ProviderError(`Credenciales de ${name} dañadas: vuelve a conectar`, true); }
}
function articleHtml(url: string, caption: string) {
  return `<p><img src="${escHtml(url)}" alt="${escHtml(titleFrom(caption, 200))}" style="max-width:100%"></p>${textToHtml(bodyAfterTitle(caption))}`;
}
const blogLimits = { maxChars: 20000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 };

/* ── Ghost: Admin API key (id:secret) → JWT de 5 minutos ── */
async function ghostJwt(key: string) {
  const [id, secret] = key.split(":");
  if (!id || !secret || !/^[0-9a-f]+$/i.test(secret)) throw new ProviderError("La Admin API key de Ghost tiene la forma id:secreto");
  const raw = new Uint8Array(secret.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }))}.${b64url(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" }))}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(unsigned)));
  return `${unsigned}.${b64url(sig)}`;
}
type GhostC = { site: string; key: string };
async function ghostCall(c: GhostC, path: string, init: RequestInit = {}) {
  return fetchJson(`${c.site}/ghost/api/admin${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Ghost ${await ghostJwt(c.key)}`, "Accept-Version": "v5.0" } }, "Ghost")
    .catch((e) => { if (/401|403/.test(e.message)) throw new ProviderError("Ghost: la Admin API key no es válida", true); throw e; });
}
export const ghost: SocialProvider = {
  id: "ghost", name: "Ghost", kind: "token", group: "blog", color: "#15171A", cost: 2, limits: blogLimits,
  setup: [
    "En el panel de Ghost abre Settings › Integrations › Add custom integration, con nombre «Musa».",
    "Copia la «Admin API key» y la «API URL» y pégalas aquí.",
  ],
  fields: [
    { key: "site", label: "API URL", placeholder: "https://tublog.ghost.io" },
    { key: "key", label: "Admin API key", placeholder: "id:secreto", secret: true },
  ],
  tokensFromInput(input) { return { accessToken: JSON.stringify({ site: siteUrl(input.site), key: String(input.key || "").trim() }), refreshToken: null, expiresAt: null }; },
  async identify({ tokens }) {
    const c = parse<GhostC>(tokens.accessToken, "Ghost"), j = await ghostCall(c, "/site/");
    return { externalId: new URL(c.site).host, displayName: j?.site?.title || new URL(c.site).host, username: j?.site?.url || c.site, avatarUrl: j?.site?.icon || null };
  },
  async post(account, payload) {
    const c = parse<GhostC>(account.tokens.accessToken, "Ghost");
    const j = await ghostCall(c, "/posts/?source=html", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts: [{ title: titleFrom(payload.caption, 255), html: textToHtml(bodyAfterTitle(payload.caption)) || "<p></p>", feature_image: payload.mediaUrl, status: "published" }] }),
    });
    const p = j?.posts?.[0];
    return { externalId: String(p?.id || ""), externalUrl: p?.url || null };
  },
};

/* ── WordPress (propio o con plan que permita contraseñas de aplicación) ── */
type WpC = { site: string; user: string; password: string };
const wpAuth = (c: WpC) => ({ Authorization: basicAuth(c.user, c.password) });
export const wordpress: SocialProvider = {
  id: "wordpress", name: "WordPress", kind: "token", group: "blog", color: "#21759B", cost: 3, limits: blogLimits,
  setup: [
    "En tu WordPress abre Usuarios › Perfil › Contraseñas de aplicación, escribe «Musa» y aprieta «Añadir nueva».",
    "Pega aquí la dirección del sitio, tu usuario y esa contraseña de aplicación (no tu contraseña real).",
  ],
  notes: ["Funciona con WordPress propio y con WordPress.com en planes que permiten plugins."],
  fields: [
    { key: "site", label: "Dirección del sitio", placeholder: "https://tusitio.com" },
    { key: "user", label: "Usuario" },
    { key: "password", label: "Contraseña de aplicación", placeholder: "xxxx xxxx xxxx xxxx", secret: true },
  ],
  tokensFromInput(input) {
    if (!input.user || !input.password) throw new ProviderError("Falta el usuario o la contraseña de aplicación");
    return { accessToken: JSON.stringify({ site: siteUrl(input.site), user: input.user.trim(), password: input.password.trim() }), refreshToken: null, expiresAt: null };
  },
  async identify({ tokens }) {
    const c = parse<WpC>(tokens.accessToken, "WordPress");
    const me = await fetchJson(`${c.site}/wp-json/wp/v2/users/me?context=edit`, { headers: wpAuth(c) }, "WordPress").catch((e) => { if (/401|403/.test(e.message)) throw new ProviderError("WordPress: usuario o contraseña de aplicación incorrectos", true); throw e; });
    const site = await fetchJson(`${c.site}/wp-json`, {}, "WordPress").catch(() => null);
    return { externalId: `${new URL(c.site).host}:${me.id}`, displayName: site?.name || new URL(c.site).host, username: me.name || c.user, avatarUrl: site?.site_icon_url || null };
  },
  async post(account, payload) {
    const c = parse<WpC>(account.tokens.accessToken, "WordPress");
    const ext = payload.mediaMime === "image/png" ? "png" : "jpg";
    const media = await fetchJson(`${c.site}/wp-json/wp/v2/media`, {
      method: "POST", headers: { ...wpAuth(c), "Content-Type": payload.mediaMime, "Content-Disposition": `attachment; filename="musa-${Date.now()}.${ext}"` }, body: await payload.media(), timeoutMs: 40000,
    }, "WordPress (imagen)");
    const img = media.source_url || payload.mediaUrl;
    const p = await fetchJson(`${c.site}/wp-json/wp/v2/posts`, {
      method: "POST", headers: { ...wpAuth(c), "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleFrom(payload.caption, 200), content: articleHtml(img, payload.caption), status: "publish", featured_media: media.id }),
    }, "WordPress");
    return { externalId: String(p.id), externalUrl: p.link || null };
  },
};

/* ── Dev.to ── */
export const devto: SocialProvider = {
  id: "devto", name: "DEV (dev.to)", kind: "token", group: "blog", color: "#0A0A0A", cost: 1, limits: blogLimits,
  setup: ["En dev.to abre Settings › Extensions › DEV Community API Keys, escribe «Musa» y genera la llave.", "Pégala aquí."],
  fields: [{ key: "token", label: "API key", secret: true }],
  tokensFromInput(input) { const t = String(input.token || "").trim(); if (t.length < 10) throw new ProviderError("Esa API key de DEV es muy corta"); return { accessToken: t, refreshToken: null, expiresAt: null }; },
  async identify({ tokens }) {
    const me = await fetchJson("https://dev.to/api/users/me", { headers: { "api-key": tokens.accessToken, "User-Agent": "musa-publisher" } }, "DEV").catch((e) => { if (/401/.test(e.message)) throw new ProviderError("DEV: la API key no es válida", true); throw e; });
    return { externalId: String(me.id), displayName: me.name || me.username, username: me.username, avatarUrl: me.profile_image || null };
  },
  async post(account, payload) {
    const md = `![${titleFrom(payload.caption, 120)}](${payload.mediaUrl})\n\n${bodyAfterTitle(payload.caption)}`;
    const a = await fetchJson("https://dev.to/api/articles", {
      method: "POST", headers: { "api-key": account.tokens.accessToken, "Content-Type": "application/json", "User-Agent": "musa-publisher" },
      body: JSON.stringify({ article: { title: titleFrom(payload.caption, 128), body_markdown: md, published: true, main_image: payload.mediaUrl } }),
    }, "DEV");
    return { externalId: String(a.id), externalUrl: a.url || null };
  },
};

/* ── Hashnode (GraphQL) ── */
async function hashnode(token: string, query: string, variables: Record<string, unknown> = {}) {
  const j = await fetchJson("https://gql.hashnode.com", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }, "Hashnode");
  if (j?.errors?.length) throw new ProviderError(`Hashnode: ${j.errors.map((e: any) => e.message).join("; ")}`, /auth|token/i.test(JSON.stringify(j.errors)));
  return j.data;
}
export const hashnodeProvider: SocialProvider = {
  id: "hashnode", name: "Hashnode", kind: "token", group: "blog", color: "#2962FF", cost: 1, limits: blogLimits,
  setup: ["En hashnode.com abre Settings › Developer y genera un «Personal Access Token».", "Pégalo aquí. Si tienes varios blogs, escribe la dirección del que quieres usar (o conecta uno por cada blog)."],
  fields: [{ key: "token", label: "Personal Access Token", secret: true }, { key: "publication", label: "Blog (opcional)", placeholder: "tublog.hashnode.dev" }],
  tokensFromInput(input) { const t = String(input.token || "").trim(); if (t.length < 10) throw new ProviderError("Ese token de Hashnode es muy corto"); return { accessToken: t, refreshToken: null, expiresAt: null }; },
  async identify({ tokens, input, options }) {
    const d = await hashnode(tokens.accessToken, "query { me { id username name profilePicture publications(first: 20) { edges { node { id title url } } } } }");
    const pubs = (d?.me?.publications?.edges || []).map((e: any) => e.node);
    const want = String(input?.publication || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const pub = pubs.find((p: any) => p.id === options?.publication_id) || (want ? pubs.find((p: any) => String(p.url).toLowerCase().includes(want)) : null) || pubs[0];
    if (!pub) throw new ProviderError("Tu cuenta de Hashnode no tiene blogs");
    return { externalId: pub.id, displayName: pub.title, username: pub.url, avatarUrl: d.me.profilePicture || null, options: { publication_id: pub.id } };
  },
  async post(account, payload) {
    const d = await hashnode(account.tokens.accessToken, "mutation P($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }", {
      input: { title: titleFrom(payload.caption, 250), contentMarkdown: `![](${payload.mediaUrl})\n\n${bodyAfterTitle(payload.caption) || " "}`, publicationId: account.options.publication_id, coverImageOptions: { coverImageURL: payload.mediaUrl } },
    });
    const p = d?.publishPost?.post;
    return { externalId: String(p?.id || ""), externalUrl: p?.url || null };
  },
};

/* ── Listmonk (newsletter propio): crea la campaña y la envía a tus listas ── */
type LmC = { site: string; user: string; token: string; lists: number[] };
const lmAuth = (c: LmC) => ({ Authorization: basicAuth(c.user, c.token) });
export const listmonk: SocialProvider = {
  id: "listmonk", name: "Listmonk", kind: "token", group: "blog", color: "#0055D4", cost: 2, limits: blogLimits,
  setup: [
    "En tu Listmonk abre Admin › Users › New y crea un usuario de API con rol que pueda gestionar campañas.",
    "Pega aquí la dirección, el usuario, el token y los números (id) de las listas a las que se enviará, separados por comas.",
  ],
  notes: ["Publicar aquí ENVÍA un correo a todas las personas de esas listas. Prueba primero con una lista de prueba."],
  fields: [
    { key: "site", label: "Dirección de Listmonk", placeholder: "https://news.tumarca.com" },
    { key: "user", label: "Usuario de API" },
    { key: "token", label: "Token", secret: true },
    { key: "lists", label: "Listas (ids)", placeholder: "3, 7" },
  ],
  tokensFromInput(input) {
    const lists = String(input.lists || "").split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!lists.length) throw new ProviderError("Escribe al menos un id de lista");
    if (!input.user || !input.token) throw new ProviderError("Falta el usuario o el token");
    return { accessToken: JSON.stringify({ site: siteUrl(input.site), user: input.user.trim(), token: input.token.trim(), lists }), refreshToken: null, expiresAt: null };
  },
  async identify({ tokens }) {
    const c = parse<LmC>(tokens.accessToken, "Listmonk");
    const j = await fetchJson(`${c.site}/api/lists?per_page=all`, { headers: lmAuth(c) }, "Listmonk").catch((e) => { if (/401|403/.test(e.message)) throw new ProviderError("Listmonk: usuario o token incorrectos", true); throw e; });
    const all = j?.data?.results || [];
    const names = c.lists.map((id) => all.find((l: any) => l.id === id)).filter(Boolean).map((l: any) => `${l.name} (${l.subscriber_count ?? "?"})`);
    if (names.length !== c.lists.length) throw new ProviderError("Alguna lista no existe en tu Listmonk");
    return { externalId: `${new URL(c.site).host}:${c.lists.join(",")}`, displayName: `Listmonk · ${names.join(", ")}`, username: new URL(c.site).host };
  },
  async post(account, payload) {
    const c = parse<LmC>(account.tokens.accessToken, "Listmonk"), title = titleFrom(payload.caption, 200);
    const camp = await fetchJson(`${c.site}/api/campaigns`, {
      method: "POST", headers: { ...lmAuth(c), "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Musa · ${title}`, subject: title, lists: c.lists, type: "regular", content_type: "html", body: articleHtml(payload.mediaUrl, payload.caption) }),
    }, "Listmonk");
    const id = camp?.data?.id;
    if (!id) throw new ProviderError("Listmonk no creó la campaña");
    await fetchJson(`${c.site}/api/campaigns/${id}/status`, { method: "PUT", headers: { ...lmAuth(c), "Content-Type": "application/json" }, body: JSON.stringify({ status: "running" }) }, "Listmonk");
    return { externalId: String(id), externalUrl: `${c.site}/admin/campaigns/${id}` };
  },
};
