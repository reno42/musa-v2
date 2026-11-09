import { type SocialProvider, ProviderError, fetchJson, titleFrom, bodyAfterTitle } from "./types.js";

/**
 * Luma (luma.com): API pública con la API key de un calendario (exige Luma Plus).
 * Con un evento elegido, publicar manda un mensaje (blast) a sus invitados con la imagen y el texto.
 * Sin evento, crea un evento nuevo PRIVADO con la imagen de portada, para que la persona le ponga
 * fecha y lugar en Luma y lo haga público. https://docs.luma.com
 */
const API = "https://public-api.luma.com";
type LumaC = { key: string };
function creds(token: string): LumaC {
  try { return JSON.parse(token) as LumaC; } catch { throw new ProviderError("Credenciales de Luma dañadas: vuelve a conectar", true); }
}
async function luma(key: string, path: string, init: RequestInit = {}) {
  return fetchJson(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), "x-luma-api-key": key, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) } }, "Luma")
    .catch((e) => {
      if (/ 401| 403/.test(e.message)) throw new ProviderError("Luma: la API key no es válida o tu calendario no tiene Luma Plus", true);
      throw e;
    });
}
/** Acepta evt-xxxx, luma.com/slug o lu.ma/slug. */
async function findEvent(key: string, raw: string) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const q = /^evt-/i.test(v) ? `event_id=${encodeURIComponent(v)}` : `url=${encodeURIComponent(/^https?:\/\//i.test(v) ? v : "https://" + v)}`;
  const look = await luma(key, `/v1/calendars/events/lookup?${q}`).catch(() => null);
  const id = look?.event?.id || (/^evt-/i.test(v) ? v : null);
  if (!id) throw new ProviderError("No encontré ese evento en tu calendario de Luma. Pega el enlace del evento (luma.com/…) o su id (evt-…)");
  const j = await luma(key, `/v1/events/get?event_id=${encodeURIComponent(id)}`);
  const ev = j?.event || j || {};
  return { id: String(ev.id || id), name: String(ev.name || "Evento"), url: ev.url ? String(ev.url) : null };
}
/** Sube la imagen al CDN de Luma (Luma solo acepta portadas e imágenes de su CDN). */
async function upload(key: string, blob: Blob, mime: string) {
  const type = mime === "image/png" ? "image/png" : "image/jpeg";
  const u = await luma(key, "/v1/images/create-upload-url", { method: "POST", body: JSON.stringify({ content_type: type }) });
  if (!u?.upload_url || !u?.file_url) throw new ProviderError("Luma no dio dónde subir la imagen");
  const put = await fetch(u.upload_url, { method: "PUT", headers: { "Content-Type": type }, body: blob });
  if (!put.ok) throw new ProviderError(`Luma: no se pudo subir la imagen (${put.status})`);
  return String(u.file_url);
}

export const lumaProvider: SocialProvider = {
  id: "luma", name: "Luma", kind: "token", group: "blog", color: "#000000", cost: 4,
  limits: { maxChars: 10000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 10 * 1024 * 1024 },
  setup: [
    "En luma.com abre tu calendario › Settings › Developer (API) y crea una API key. La API de Luma requiere Luma Plus.",
    "Pega la API key aquí.",
    "Opcional: pega el enlace de un evento (luma.com/…) para mandar cada publicación como mensaje a sus invitados. Si lo dejas vacío, cada publicación crea un evento nuevo en privado con tu diseño de portada.",
  ],
  notes: [
    "Con un evento elegido, publicar ENVÍA un correo a los invitados confirmados de ese evento.",
    "Sin evento, se crea un evento PRIVADO con fecha tentativa (en 7 días). Ponle la fecha y el lugar reales en Luma antes de hacerlo público.",
  ],
  fields: [
    { key: "key", label: "API key", secret: true },
    { key: "event", label: "Evento (opcional)", placeholder: "luma.com/mi-evento o evt-…", help: "Vacío = cada publicación crea un evento privado." },
  ],
  developerUrl: "https://luma.com/calendar/manage",
  tokensFromInput(input) {
    const key = String(input.key || "").trim();
    if (key.length < 10) throw new ProviderError("Esa API key de Luma es muy corta");
    return { accessToken: JSON.stringify({ key }), refreshToken: null, expiresAt: null };
  },
  async identify({ tokens, input, options }) {
    const { key } = creds(tokens.accessToken);
    const cal = await luma(key, "/v1/calendars/get");
    const c = cal?.calendar || cal || {};
    const ev = await findEvent(key, String(input?.event || options?.event_id || ""));
    const calName = String(c.name || "Calendario de Luma");
    return {
      externalId: `${c.id || "cal"}${ev ? ":" + ev.id : ""}`,
      displayName: ev ? `${calName} · ${ev.name}` : calName,
      username: ev ? ev.url || ev.id : c.slug ? `luma.com/${c.slug}` : null,
      avatarUrl: c.avatar_url || null,
      options: { event_id: ev ? ev.id : null, event_url: ev ? ev.url : null, timezone: c.timezone || "America/Lima" },
    };
  },
  async post(account, payload) {
    const { key } = creds(account.tokens.accessToken);
    const img = await upload(key, await payload.media(), payload.mediaMime);
    const title = titleFrom(payload.caption, 200), body = bodyAfterTitle(payload.caption);
    if (account.options.event_id) {
      const b = await luma(key, "/v1/events/blasts/create", { method: "POST", body: JSON.stringify({ event_id: account.options.event_id, subject: title, content_md: `![](${img})\n\n${body || title}` }) });
      const id = b?.id || b?.blast?.id;
      return { externalId: String(id || ""), externalUrl: account.options.event_url || null };
    }
    const start = new Date(Date.now() + 7 * 86400000); start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600000);
    const e = await luma(key, "/v1/events/create", {
      method: "POST",
      body: JSON.stringify({ name: title, start_at: start.toISOString(), end_at: end.toISOString(), timezone: account.options.timezone || "America/Lima", description_md: body || title, cover_url: img, visibility: "private" }),
    });
    const id = String(e?.id || e?.event?.id || "");
    if (!id) throw new ProviderError("Luma no creó el evento");
    const ev = await luma(key, `/v1/events/get?event_id=${encodeURIComponent(id)}`).catch(() => null);
    return { externalId: id, externalUrl: (ev?.event || ev)?.url || null };
  },
};
