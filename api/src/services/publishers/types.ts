/**
 * Musa Publisher — contrato único por red social.
 * Cada proveedor sabe conectar una cuenta (OAuth o token pegado) y publicar
 * una imagen con texto. Todo lo demás (estados por destino, reintentos,
 * cifrado, UI) es genérico y vive en dispatch.ts / routes/publisher.ts.
 * Worker-native: solo fetch y WebCrypto, nada de APIs de Node.
 */

export type Tokens = {
  accessToken: string;
  refreshToken?: string | null;
  /** ISO; null = no vence */
  expiresAt?: string | null;
};

export type OAuthApp = { clientId: string; clientSecret?: string | null };

export type AccountIdentity = {
  externalId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  options?: Record<string, unknown>;
};

export type PublisherAccount = {
  id: string;
  provider: string;
  externalId: string;
  displayName: string | null;
  username: string | null;
  options: Record<string, any>;
  tokens: Tokens;
};

export type PostPayload = {
  mediaUrl: string;
  mediaMime: string;
  caption: string;
  /** Imagen ya descargada (la baja dispatch una sola vez y la comparte). */
  media: () => Promise<Blob>;
};

export type PostResult = { externalId: string; externalUrl: string | null };

export type ProviderLimits = {
  /** Largo máximo del texto que acompaña a la imagen. */
  maxChars: number;
  maxMedia: number;
  formats: string[];
  maxBytes: number;
};

export type ProviderField = { key: string; label: string; placeholder?: string; secret?: boolean; help?: string };

export interface SocialProvider {
  id: string;
  name: string;
  kind: "oauth" | "token";
  color: string;
  limits: ProviderLimits;
  /** Pasos del asistente, en lenguaje simple. */
  setup: string[];
  /** Advertencias (p. ej. plan pago de la red). */
  notes?: string[];
  /** Campos que pega la persona (token-BYOK) o que pide la app (OAuth). */
  fields: ProviderField[];
  developerUrl?: string;
  /** OAuth: arma la URL de consentimiento. */
  authUrl?(ctx: { app: OAuthApp; redirectUri: string; state: string; codeChallenge: string }): string;
  /** OAuth: canjea el code. */
  exchangeCode?(ctx: { app: OAuthApp; code: string; redirectUri: string; codeVerifier: string }): Promise<Tokens>;
  refresh?(ctx: { app: OAuthApp; tokens: Tokens }): Promise<Tokens>;
  /** Quién es la cuenta (después del OAuth o al validar un token). */
  identify(ctx: { tokens: Tokens; input?: Record<string, string> }): Promise<AccountIdentity>;
  /** token-BYOK: arma los tokens a partir de lo que pegó la persona. */
  tokensFromInput?(input: Record<string, string>): Tokens;
  post(account: PublisherAccount, payload: PostPayload): Promise<PostResult>;
}

export class ProviderError extends Error {
  /** true = el token ya no sirve (marca la cuenta como expired). */
  auth: boolean;
  constructor(message: string, auth = false) {
    super(message);
    this.auth = auth;
  }
}

/** fetch que corta a los 20 s y devuelve el JSON o lanza un error legible. */
export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}, label = "red"): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    throw new ProviderError(`${label}: no respondió (${e?.name === "AbortError" ? "tiempo agotado" : e?.message || "error de red"})`);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.description || body.detail || body.error_description || body.message || body.title || (typeof body.error === "string" ? body.error : null))) || String(text).slice(0, 200) || res.statusText;
    throw new ProviderError(`${label} ${res.status}: ${msg}`, res.status === 401 || res.status === 403 && /token|auth/i.test(String(msg)));
  }
  return body;
}

export function basicAuth(user: string, pass: string) {
  return "Basic " + btoa(`${user}:${pass}`);
}
