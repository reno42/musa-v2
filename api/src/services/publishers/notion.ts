import { type SocialProvider, ProviderError, fetchJson, titleFrom, bodyAfterTitle } from "./types.js";

/**
 * Notion: publicar = crear una página nueva (imagen + texto) dentro de una página o una base de datos
 * que la persona compartió con su integración. Token: «Internal Integration Secret».
 * https://developers.notion.com/reference/post-page
 */
const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

async function notion(token: string, path: string, init: RequestInit = {}) {
  return fetchJson(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" } }, "Notion")
    .catch((e) => {
      if (/ 401/.test(e.message)) throw new ProviderError("Notion: el secreto de la integración no es válido", true);
      if (/ 404/.test(e.message)) throw new ProviderError("Notion no encuentra esa página. Ábrela en Notion › ••• › Conexiones y agrega tu integración «Musa»");
      throw e;
    });
}
/** Saca el id (32 hex) de un enlace de Notion o de un id pegado. */
function notionId(raw: string) {
  const m = String(raw || "").replace(/-/g, "").match(/([0-9a-f]{32})(?:[?#]|$)/i) || String(raw || "").replace(/-/g, "").match(/([0-9a-f]{32})/i);
  if (!m) throw new ProviderError("Pega el enlace de la página o base de datos de Notion (Compartir › Copiar enlace)");
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function plain(rt: any[]) { return (rt || []).map((x: any) => x?.plain_text || "").join(""); }
/** Párrafos de Notion: máx. 2000 caracteres por bloque de texto. */
function paragraphs(text: string) {
  const out: any[] = [];
  for (const p of String(text || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)) {
    for (let i = 0; i < p.length; i += 1900) out.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: p.slice(i, i + 1900) } }] } });
  }
  return out.slice(0, 95);
}

export const notionProvider: SocialProvider = {
  id: "notion", name: "Notion", kind: "token", group: "blog", color: "#000000", cost: 1,
  limits: { maxChars: 50000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  setup: [
    "Entra a notion.so/profile/integrations › «Nueva integración» (tipo interna, nombre «Musa») y copia el «Internal Integration Secret».",
    "En Notion abre la página o base de datos donde quieres publicar › ••• › Conexiones › agrega «Musa».",
    "Pega aquí el secreto y el enlace de esa página (Compartir › Copiar enlace).",
  ],
  notes: ["Cada publicación crea una página nueva dentro de la que elegiste, con la primera línea como título y tu diseño arriba."],
  fields: [
    { key: "token", label: "Internal Integration Secret", placeholder: "ntn_…", secret: true },
    { key: "target", label: "Página o base de datos", placeholder: "https://www.notion.so/…" },
  ],
  developerUrl: "https://www.notion.so/profile/integrations",
  tokensFromInput(input) {
    const t = String(input.token || "").trim();
    if (!/^(ntn_|secret_)/.test(t)) throw new ProviderError("El secreto de Notion empieza con ntn_ (o secret_ en integraciones antiguas)");
    return { accessToken: t, refreshToken: null, expiresAt: null };
  },
  async identify({ tokens, input, options }) {
    const id = options?.parent_id || notionId(String(input?.target || ""));
    // Puede ser una página o una base de datos: se prueba en ese orden.
    const page = await notion(tokens.accessToken, `/pages/${id}`).catch(() => null);
    if (page?.object === "page") {
      const tp = Object.values(page.properties || {}).find((p: any) => p?.type === "title") as any;
      const name = plain(tp?.title) || "Página de Notion";
      return { externalId: id, displayName: `Notion · ${name}`, username: page.url || null, avatarUrl: null, options: { parent_id: id, kind: "page" } };
    }
    const db = await notion(tokens.accessToken, `/databases/${id}`);
    const titleProp = Object.entries(db.properties || {}).find(([, p]: any) => p?.type === "title")?.[0];
    if (!titleProp) throw new ProviderError("Esa base de datos de Notion no tiene columna de título");
    const name = plain(db.title) || "Base de datos de Notion";
    return { externalId: id, displayName: `Notion · ${name}`, username: db.url || null, avatarUrl: null, options: { parent_id: id, kind: "database", title_prop: titleProp } };
  },
  async post(account, payload) {
    const o = account.options, title = titleFrom(payload.caption, 200);
    const parent = o.kind === "database" ? { database_id: o.parent_id } : { page_id: o.parent_id };
    const properties = o.kind === "database"
      ? { [o.title_prop || "Name"]: { title: [{ type: "text", text: { content: title } }] } }
      : { title: { title: [{ type: "text", text: { content: title } }] } };
    const children = [{ object: "block", type: "image", image: { type: "external", external: { url: payload.mediaUrl } } }, ...paragraphs(bodyAfterTitle(payload.caption))];
    const p = await notion(account.tokens.accessToken, "/pages", { method: "POST", body: JSON.stringify({ parent, properties, children }) });
    return { externalId: String(p?.id || ""), externalUrl: p?.url || null };
  },
};
