import { type SocialProvider, ProviderError, fetchJson } from "./types.js";

/**
 * Telegram — token-BYOK: la persona crea su bot con @BotFather, lo agrega como
 * administrador de su canal o grupo y pega el token + el canal.
 * sendPhoto acepta la URL pública de la imagen: Telegram la descarga solo.
 */
const API = "https://api.telegram.org/bot";

function chatParam(raw: string) {
  const v = String(raw || "").trim().replace(/^https?:\/\/t\.me\//i, "");
  if (!v) throw new ProviderError("Falta el canal o grupo de Telegram");
  return /^-?\d+$/.test(v) ? v : v.startsWith("@") ? v : "@" + v;
}

async function call(token: string, method: string, body: Record<string, unknown>) {
  const j = await fetchJson(`${API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "Telegram").catch((e: ProviderError) => {
    if (/401|404: Not Found/.test(e.message)) throw new ProviderError("Telegram: el token del bot no es válido", true);
    throw e;
  });
  if (!j?.ok) throw new ProviderError(`Telegram: ${j?.description || "respuesta inesperada"}`);
  return j.result;
}

export const telegram: SocialProvider = {
  id: "telegram",
  name: "Telegram",
  kind: "token",
  group: "chat",
  cost: 1,
  color: "#229ED9",
  limits: { maxChars: 1024, maxMedia: 1, formats: ["image/png", "image/jpeg"], maxBytes: 10 * 1024 * 1024 },
  developerUrl: "https://t.me/BotFather",
  setup: [
    "Abre @BotFather en Telegram, escribe /newbot y sigue los pasos. Te da un token del tipo 123456:ABC…",
    "Agrega ese bot como administrador de tu canal o grupo, con permiso para publicar mensajes.",
    "Pega aquí el token y el canal (@nombre_del_canal, o el id numérico si es privado).",
  ],
  fields: [
    { key: "token", label: "Token del bot", placeholder: "123456789:AA…", secret: true },
    { key: "chat", label: "Canal o grupo", placeholder: "@mi_canal o -100123456789" },
  ],
  tokensFromInput(input) {
    const token = String(input.token || "").trim();
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw new ProviderError("Ese no parece un token de bot de Telegram (123456:ABC…)");
    return { accessToken: token, refreshToken: null, expiresAt: null };
  },
  async identify({ tokens, input, options }) {
    const me = await call(tokens.accessToken, "getMe", {});
    const chatId = chatParam(String(input?.chat || options?.chat_id || ""));
    const chat = await call(tokens.accessToken, "getChat", { chat_id: chatId });
    const admin = await call(tokens.accessToken, "getChatMember", { chat_id: chat.id, user_id: me.id }).catch(() => null);
    if (chat.type === "channel" && admin && !["administrator", "creator"].includes(admin.status)) {
      throw new ProviderError(`Telegram: @${me.username} no es administrador de «${chat.title}». Agrégalo como admin con permiso para publicar.`);
    }
    return {
      externalId: String(chat.id),
      displayName: chat.title || chat.username || String(chat.id),
      username: chat.username || null,
      options: { chat_id: chat.id, chat_type: chat.type, bot: me.username },
    };
  },
  async post(account, payload) {
    const chatId = account.options.chat_id ?? account.externalId;
    const msg = await call(account.tokens.accessToken, "sendPhoto", { chat_id: chatId, photo: payload.mediaUrl, caption: payload.caption || undefined });
    const user = account.username || msg.chat?.username;
    const url = user ? `https://t.me/${user}/${msg.message_id}` : null;
    return { externalId: String(msg.message_id), externalUrl: url };
  },
};
