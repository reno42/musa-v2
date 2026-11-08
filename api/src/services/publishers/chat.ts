import { type SocialProvider, ProviderError, fetchJson } from "./types.js";

/**
 * Canales de equipo o comunidad por webhook (token-BYOK): Slack y Discord.
 * La URL del webhook ES la credencial: se guarda cifrada y nunca se muestra.
 */
async function shortHash(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const slack: SocialProvider = {
  id: "slack", name: "Slack", kind: "token", group: "chat", color: "#4A154B", cost: 1,
  limits: { maxChars: 3000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  developerUrl: "https://api.slack.com/apps",
  setup: [
    "En api.slack.com/apps crea una app «From scratch» en tu espacio de trabajo.",
    "Activa «Incoming Webhooks», aprieta «Add New Webhook to Workspace» y elige el canal.",
    "Copia la «Webhook URL» y pégala aquí con un nombre para reconocerla.",
  ],
  fields: [
    { key: "url", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/…", secret: true },
    { key: "name", label: "Nombre del canal", placeholder: "#lanzamientos" },
  ],
  tokensFromInput(input) {
    const url = String(input.url || "").trim();
    if (!/^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(url)) throw new ProviderError("Esa no parece una Webhook URL de Slack (https://hooks.slack.com/services/…)");
    return { accessToken: url, refreshToken: null, expiresAt: null };
  },
  async identify({ tokens, input }) {
    return { externalId: await shortHash(tokens.accessToken), displayName: `Slack · ${String(input?.name || "canal").trim() || "canal"}` };
  },
  async post(account, payload) {
    const text = payload.caption || " ";
    await fetchJson(account.tokens.accessToken, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks: [...(payload.caption ? [{ type: "section", text: { type: "mrkdwn", text: payload.caption.slice(0, 3000) } }] : []), { type: "image", image_url: payload.mediaUrl, alt_text: text.slice(0, 200) }] }),
    }, "Slack").catch((e) => { if (/404|410|403|invalid_token|no_service/.test(e.message)) throw new ProviderError("Slack: el webhook ya no existe o fue revocado", true); throw e; });
    return { externalId: `slack-${Date.now()}`, externalUrl: null };
  },
};

export const discord: SocialProvider = {
  id: "discord", name: "Discord", kind: "token", group: "chat", color: "#5865F2", cost: 1,
  limits: { maxChars: 2000, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  setup: [
    "En Discord abre la configuración del canal › Integraciones › Webhooks › Nuevo webhook.",
    "Ponle nombre (por ejemplo «Musa»), aprieta «Copiar URL del webhook» y pégala aquí.",
  ],
  fields: [{ key: "url", label: "URL del webhook", placeholder: "https://discord.com/api/webhooks/…", secret: true }],
  tokensFromInput(input) {
    const url = String(input.url || "").trim().replace("discordapp.com", "discord.com");
    if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) throw new ProviderError("Esa no parece una URL de webhook de Discord");
    return { accessToken: url, refreshToken: null, expiresAt: null };
  },
  async identify({ tokens }) {
    const w = await fetchJson(tokens.accessToken, {}, "Discord").catch((e) => { if (/401|404/.test(e.message)) throw new ProviderError("Discord: el webhook no existe o fue borrado", true); throw e; });
    return { externalId: String(w.id), displayName: `Discord · ${w.name}`, avatarUrl: w.avatar ? `https://cdn.discordapp.com/avatars/${w.id}/${w.avatar}.png` : null, options: { guild_id: w.guild_id, channel_id: w.channel_id } };
  },
  async post(account, payload) {
    const m = await fetchJson(`${account.tokens.accessToken}?wait=true`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: payload.caption || "", embeds: [{ image: { url: payload.mediaUrl } }], allowed_mentions: { parse: [] } }),
    }, "Discord");
    const { guild_id: g, channel_id: ch } = account.options;
    return { externalId: String(m.id), externalUrl: g && ch ? `https://discord.com/channels/${g}/${ch}/${m.id}` : null };
  },
};
