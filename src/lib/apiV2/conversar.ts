// apiV2/conversar.ts — datos de la vista CONVERSAR del shell-v2.
// Endpoints reales: /api/content (integraciones sociales + inbox de comentarios)
// NOTA REQ-070: bandeja unificada completa depende de fase 2; este módulo expone
// lo que YA existe (inbox Zernio si hay conexión social activa).
import { getData, postData } from "./client";

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export interface SocialConnection {
  provider: string;
  connected?: boolean;
  accounts?: unknown[];
  [k: string]: unknown;
}

export async function fetchSocialIntegrations(workspaceId: string): Promise<SocialConnection[]> {
  const res = await getData<Envelope<SocialConnection[]>>(
    `/api/content/integrations/social?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "social integrations failed");
  return res.data;
}

export interface InboxItem {
  id: string;
  provider?: string;
  text?: string;
  author?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export async function fetchInbox(workspaceId: string): Promise<InboxItem[]> {
  const res = await getData<Envelope<InboxItem[]>>(
    `/api/content/integrations/social/zernio/inbox?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "inbox failed");
  return res.data;
}

export async function replyInboxItem(itemId: string, body: { message: string }): Promise<unknown> {
  const res = await postData<Envelope<unknown>>(
    `/api/content/integrations/social/zernio/inbox/${itemId}/reply`,
    body
  );
  if (!res.success) throw new Error(res.error || "reply failed");
  return res.data;
}

/** Paquete de la vista CONVERSAR. */
export interface ConversarData {
  connections: SocialConnection[];
  inbox: InboxItem[];
}

export async function loadConversar(workspaceId: string): Promise<ConversarData> {
  const [connections, inbox] = await Promise.all([
    fetchSocialIntegrations(workspaceId),
    fetchInbox(workspaceId).catch(() => [] as InboxItem[]), // inbox puede 404 sin conexión Zernio
  ]);
  return { connections, inbox };
}
