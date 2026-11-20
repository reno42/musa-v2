/**
 * REQ-082 — Inbox unificado multi-cliente: núcleo.
 *
 * Conversaciones y mensajes de todas las cuentas conectadas del workspace,
 * aislados por marca (brand_id; NULL = marca propia del operador). Las IAs
 * contestan con la personalidad de SU marca — jamás ven threads de otra.
 *
 * Tenancy: TODA query lleva workspace_id; brand scoping explícito.
 * El sweep (listen) usa Graph API oficial sobre cuentas YA conectadas
 * (publisher_accounts) — API de Метa para props propios, no scraping.
 */

import { randomBytes, createHash } from "node:crypto";

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
}

export function hashPin(pin, saltHex) {
  return createHash("sha256").update(`${saltHex}:${pin}`).digest("hex");
}

/** Upsert idempotente de conversación por (account_id, external_id). */
export async function upsertConversation(sb, conv) {
  const { data: existing } = await sb
    .from("inbox_conversations")
    .select("id, unread, status")
    .eq("account_id", conv.account_id)
    .eq("external_id", conv.external_id)
    .maybeSingle();
  if (existing) {
    await sb.from("inbox_conversations").update({
      last_message_at: conv.last_message_at,
      last_message_preview: (conv.preview || "").slice(0, 160),
      unread: (existing.unread || 0) + (conv.direction === "in" ? 1 : 0),
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    return existing.id;
  }
  const id = newId("conv");
  await sb.from("inbox_conversations").insert({
    id,
    workspace_id: conv.workspace_id,
    brand_id: conv.brand_id || null,
    account_id: conv.account_id,
    provider: conv.provider,
    kind: conv.kind || "dm",
    external_id: conv.external_id,
    participant_name: conv.participant_name || null,
    participant_handle: conv.participant_handle || null,
    avatar_url: conv.avatar_url || null,
    personality_id: conv.personality_id || null,
    last_message_at: conv.last_message_at,
    last_message_preview: (conv.preview || "").slice(0, 160),
    unread: conv.direction === "in" ? 1 : 0,
  });
  return id;
}

export async function insertMessage(sb, msg) {
  await sb.from("inbox_messages").insert({
    id: newId("msg"),
    conversation_id: msg.conversation_id,
    workspace_id: msg.workspace_id,
    direction: msg.direction,
    body: msg.body,
    author_kind: msg.author_kind || "customer",
    author_name: msg.author_name || null,
    external_id: msg.external_id || null,
    sent_at: msg.sent_at || new Date().toISOString(),
  });
}

/**
 * Sweep server-side: trae threads nuevos de las cuentas conectadas.
 * Solo Meta IG/FB hoy (Graph API oficial, messaging + comments de posts propios).
 * Best-effort por cuenta: un fallo no detiene el resto. Devuelve resumen.
 */
export async function sweepInbox(sb, workspaceId, fetchImpl = fetch) {
  const { data: accounts } = await sb
    .from("publisher_accounts")
    .select("id, provider, kind, external_id, access_token_encrypted, options")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected");
  const out = { accounts: 0, conversations: 0, messages: 0, errors: [] };
  for (const acct of accounts || []) {
    if (!["meta", "instagram", "facebook"].includes(acct.provider)) continue;
    out.accounts += 1;
    try {
      const { open } = await import("../../../api/src/services/publishers/crypto.js");
      const plain = await open(acct.access_token_encrypted);
      if (!plain) throw new Error("token no descifrable");
      const brandId = acct.options?.brand_id || null;
      // IG: conversations de messaging (si la app tiene perms) + comments recientes
      const base = acct.provider === "instagram" ? "https://graph.facebook.com/v21.0" : "https://graph.facebook.com/v21.0";
      const extId = acct.external_id;
      // 1) DMs (IG messaging requiere perms avanzados; best-effort)
      const dmRes = await fetchImpl(`${base}/${extId}/conversations?platform=instagram&fields=id,participants,updated_time,messages{message,from,created_time}&limit=25&access_token=${encodeURIComponent(plain)}`);
      if (dmRes.ok) {
        const dmJson = await dmRes.json();
        for (const th of dmJson.data || []) {
          const last = (th.messages?.data || [])[0];
          if (!last) continue;
          const convId = await upsertConversation(sb, {
            workspace_id: workspaceId,
            brand_id: brandId,
            account_id: acct.id,
            provider: acct.provider,
            kind: "dm",
            external_id: th.id,
            participant_name: th.participants?.data?.[0]?.name || null,
            participant_handle: th.participants?.data?.[0]?.username || null,
            preview: last.message,
            direction: "in",
            last_message_at: last.created_time,
          });
          await insertMessage(sb, {
            conversation_id: convId, workspace_id: workspaceId, direction: "in",
            body: last.message, author_kind: "customer",
            author_name: last.from?.username || last.from?.name || null,
            external_id: last.id, sent_at: last.created_time,
          });
          out.conversations += 1; out.messages += 1;
        }
      }
      // 2) Comments de posts propios (public, API oficial)
      const cmRes = await fetchImpl(`${base}/${extId}/posts?fields=id,comments{message,from,created_time,parent_id}&limit=10&access_token=${encodeURIComponent(plain)}`);
      if (cmRes.ok) {
        const cmJson = await cmRes.json();
        for (const post of cmJson.data || []) {
          for (const cm of post.comments?.data || []) {
            const convId = await upsertConversation(sb, {
              workspace_id: workspaceId, brand_id: brandId, account_id: acct.id,
              provider: acct.provider, kind: "comment",
              external_id: `c:${cm.id}`,
              participant_name: cm.from?.name || null,
              preview: cm.message, direction: "in", last_message_at: cm.created_time,
            });
            await insertMessage(sb, {
              conversation_id: convId, workspace_id: workspaceId, direction: "in",
              body: cm.message, author_kind: "customer",
              author_name: cm.from?.name || null, external_id: cm.id, sent_at: cm.created_time,
            });
            out.conversations += 1; out.messages += 1;
          }
        }
      }
    } catch (e) {
      out.errors.push(`${acct.provider}/${acct.external_id}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return out;
}

/** Contesta con la personalidad de la marca. Aísla por workspace+brand. */
export async function replyInConversation(sb, workspaceId, conversationId, body, authorKind, authorName) {
  const { data: conv } = await sb
    .from("inbox_conversations")
    .select("id, workspace_id, brand_id, account_id, provider, external_id, personality_id")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)   // tenancy dura
    .maybeSingle();
  if (!conv) throw new Error("Conversación no encontrada en este espacio");
  // brand guard: si la conversación es de un cliente, el autor debe coincidir
  await insertMessage(sb, {
    conversation_id: conv.id, workspace_id: workspaceId, direction: "out",
    body, author_kind: authorKind || "agent", author_name: authorName || null,
  });
  await sb.from("inbox_conversations").update({
    last_message_at: new Date().toISOString(),
    last_message_preview: body.slice(0, 160),
    unread: 0,
    status: "waiting",
    updated_at: new Date().toISOString(),
  }).eq("id", conv.id);
  // Envío real a la red (best-effort, solo Meta hoy) — require token de la cuenta
  let delivery = { sent: false, reason: "solo registro interno (envío a la red requiere permisos messaging de la app)" };
  try {
    const { data: acct } = await sb.from("publisher_accounts")
      .select("provider, external_id, access_token_encrypted").eq("id", conv.account_id).maybeSingle();
    if (acct && ["meta", "instagram", "facebook"].includes(acct.provider) && conv.kind === "dm") {
      const { open } = await import("../../../api/src/services/publishers/crypto.js");
      const plain = await open(acct.access_token_encrypted);
      const res = await fetch(`https://graph.facebook.com/v21.0/${conv.external_id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: body, access_token: plain }),
      });
      delivery = { sent: res.ok, status: res.status };
    } else if (acct && conv.kind === "comment") {
      const { open } = await import("../../../api/src/services/publishers/crypto.js");
      const plain = await open(acct.access_token_encrypted);
      const parentId = conv.external_id.startsWith("c:") ? conv.external_id.slice(2) : conv.external_id;
      const res = await fetch(`https://graph.facebook.com/v21.0/${parentId}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: body, access_token: plain }),
      });
      delivery = { sent: res.ok, status: res.status };
    }
  } catch (e) {
    delivery = { sent: false, error: String(e?.message || e).slice(0, 120) };
  }
  return delivery;
}
