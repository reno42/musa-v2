import { type SocialProvider, type Tokens, type AccountIdentity, ProviderError, fetchJson, titleFrom } from "./types.js";

/**
 * YouTube — video vertical/horizontal vía YouTube Data API v3.
 * Comparte la app OAuth de Google (appKey "google"): el usuario conecta UNA
 * app de Google Cloud y puede publicar a Google Business, Blogger y YouTube.
 * El video se sube con resumable upload (1 llamada init + PUT del archivo);
 * la app debe estar verificada para canales ajenos (notas del asistente).
 */
const UP = "https://www.googleapis.com/upload/youtube/v3/videos";
const API = "https://www.googleapis.com/youtube/v3";
const SCOPES_SUFFIX = "https://www.googleapis.com/auth/youtube.upload";

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

export const youtube: SocialProvider = {
  ...({} as any),
  id: "youtube",
  name: "YouTube",
  kind: "oauth",
  group: "social",
  color: "#FF0000",
  cost: 3,
  limits: { maxChars: 5000, maxMedia: 1, formats: ["video/mp4"], maxBytes: 256 * 1024 * 1024 },
  appKey: "google",
  appName: "Google",
  developerUrl: "https://console.cloud.google.com/apis/credentials",
  setup: [
    "Usa la MISMA app de Google Cloud de Google Business/Blogger (o crea una nueva): habilita la «YouTube Data API v3» en «APIs y servicios › Biblioteca».",
    "En «Pantalla de consentimiento», agrega el scope youtube.upload (si tu app está en testing, agrégate como usuario de prueba).",
    "En «Credenciales», usa el MISMO ID de cliente OAuth web (Google comparte la app). Copia ID y secreto, pégalos aquí y aprieta Conectar.",
  ],
  notes: [
    "Solo video MP4 (reels, cortes, clips). Para videos >256MB o directo por Google Drive, súbelo primero a Musa y publica desde ahí.",
    "Cuentas NO verificadas de YouTube: los videos suben como PRIVADOS hasta que el canal verifique en youtube.com/verify (SMS).",
    "Apps de Google en testing: solo puedes subir a TU canal. Para clientes, publícalos como usuarios de prueba o verifica la app.",
  ],
  fields: [
    { key: "client_id", label: "ID de cliente de OAuth" },
    { key: "client_secret", label: "Secreto del cliente", secret: true },
  ],
  authUrl({ app, redirectUri, state }: any) {
    const q = new URLSearchParams({
      client_id: app.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES_SUFFIX,
      access_type: "offline", prompt: "consent", state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async exchangeCode(ctx: any): Promise<Tokens> {
    const shared = (await import("./google.js")) as any;
    return shared.googleBusiness.exchangeCode(ctx);
  },
  async refresh(ctx: any): Promise<Tokens> {
    const shared = (await import("./google.js")) as any;
    return shared.googleBusiness.refresh(ctx);
  },
  async listAccounts({ tokens }: any): Promise<AccountIdentity[]> {
    const j = await fetchJson(`${API}/channels?part=snippet,contentDetails&mine=true&maxResults=10`, { headers: auth(tokens.accessToken) }, "YouTube");
    const out: AccountIdentity[] = [];
    for (const c of j?.items || []) {
      out.push({
        provider: "youtube", externalId: String(c.id), displayName: c.snippet?.title || "Canal",
        avatarUrl: c.snippet?.thumbnails?.default?.url || null, options: { uploads_playlist: c.contentDetails?.relatedPlaylists?.uploads || null },
      });
    }
    if (!out.length) throw new ProviderError("YouTube: tu usuario no tiene canal (crea uno en youtube.com primero)");
    return out;
  },
  async identify({ tokens, options }): Promise<AccountIdentity> {
    const j = await fetchJson(`${API}/channels?part=snippet&mine=true&maxResults=1`, { headers: auth(tokens.accessToken) }, "YouTube");
    const c = j?.items?.[0];
    if (!c) throw new ProviderError("YouTube: canal no encontrado para este token", true);
    return { provider: "youtube", externalId: String(c.id), displayName: c.snippet?.title || "Canal", avatarUrl: c.snippet?.thumbnails?.default?.url || null, options: options || {} };
  },
  async post(account, payload) {
    if (payload.mediaMime !== "video/mp4") throw new ProviderError("YouTube acepta solo video MP4");
    const meta = {
      snippet: {
        title: titleFrom(payload.caption, 100, "Video"),
        description: (payload.caption || "").slice(0, 5000),
        categoryId: "22",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    };
    // Resumable upload (init + PUT binario). El Blob lo baja dispatch una vez.
    const init = await fetch(`${UP}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: { ...auth(account.tokens.accessToken), "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4" },
      body: JSON.stringify(meta),
    });
    if (!init.ok) {
      const t = await init.text().catch(() => "");
      throw new ProviderError(`YouTube init: ${init.status} ${t.slice(0, 200)}`, init.status === 401);
    }
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new ProviderError("YouTube no devolvió la URL de upload");
    const blob = await payload.media();
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: blob });
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      throw new ProviderError(`YouTube upload: ${put.status} ${t.slice(0, 200)}`, put.status === 401);
    }
    const done = await put.json().catch(() => null);
    const vid = done?.id;
    if (!vid) throw new ProviderError("YouTube no devolvió el id del video");
    return { externalId: String(vid), externalUrl: `https://www.youtube.com/watch?v=${vid}` };
  },
};
