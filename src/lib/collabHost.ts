/**
 * collabHost.ts — lado HOST del multiplayer (F1): canal Supabase Realtime por documento.
 *
 * El iframe (public/musa/collab.js) pide salas por window.__musaBridge.collab.join(...).
 * El host es quien tiene el cliente supabase-js con la sesión del usuario (browserSupabase),
 * la key publishable y el JWT — el iframe nunca toca credenciales.
 *
 * Presencia + broadcast: cursores, bloqueo suave de capas, cambios por capa («ops») y aviso de guardado.
 * Nada persiste aquí: los guardados siguen por REST. Un websocket por pestaña (singleton de supabase-js).
 */
import { initializeBrowserSupabase, browserSupabase } from "./supabaseClient";

export type CollabPeer = {
  clientId: string;
  self?: boolean;
  userId?: string;
  name: string;
  color: string;
  role?: "editor" | "viewer";
  at?: string;
};

export type CollabRoom = {
  role: "editor" | "viewer";
  clientId: string;
  send: (msg: Record<string, unknown>) => void;
  leave: () => void;
};

type Handlers = {
  onPresence: (peers: CollabPeer[]) => void;
  onCursor: (msg: Record<string, any>) => void;
  onGrab: (msg: Record<string, any>) => void;
  onOps?: (msg: Record<string, any>) => void;
  onSaved?: (msg: Record<string, any>) => void;
  onLeave: (clientId: string) => void;
};

const EVENTS = ["cursor", "grab", "ops", "saved"] as const;

/* Un solo canal activo por pestaña: al cambiar de documento se sale del anterior. */
let active: {
  key: string;
  channel: any;
  role: "editor" | "viewer";
  handlers: Handlers;
  me: { id: string; name: string; color: string };
  clientId: string;
} | null = null;

/** Id estable por usuario + pestaña: la presencia de esta pestaña se reconoce como propia y no se duplica al reconectar. */
function presenceKey(userId: string): string {
  let tab = "";
  try {
    tab = sessionStorage.getItem("collab-tab") || "";
    if (!tab) {
      tab = Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem("collab-tab", tab);
    }
  } catch { tab = Math.random().toString(36).slice(2, 8); }
  return `${userId}:${tab}`;
}

export function collabJoin(
  roomKey: string,
  me: { id: string; name: string; color: string },
  handlers: Handlers
): Promise<CollabRoom> {
  if (active && active.key !== roomKey) collabLeave();
  if (active && active.key === roomKey) {
    active.handlers = handlers;
    return Promise.resolve({ role: active.role, clientId: active.clientId, send: activeSend, leave: collabLeave });
  }
  const client = browserSupabase || null;
  if (!client) return initializeBrowserSupabase().then(() => (browserSupabase ? collabJoin(roomKey, me, handlers) : Promise.reject(new Error("supabase no configurado"))));

  const clientId = presenceKey(me.id);
  /* la presencia usa el id de pestaña como llave: así «self» se reconoce (antes la llave era aleatoria y uno se veía a sí mismo como otra persona) */
  const channel = client.channel(roomKey, { config: { broadcast: { self: false }, presence: { key: clientId } } });

  return new Promise<CollabRoom>((resolve, reject) => {
    const timeout = setTimeout(() => { try { client.removeChannel(channel); } catch { /* noop */ } reject(new Error("realtime timeout")); }, 10000);
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, any[]>;
      const peers: CollabPeer[] = [];
      for (const [key, entries] of Object.entries(state)) {
        const e = (entries as any[])[0] || {};
        peers.push({ clientId: key, self: key === clientId, userId: e.userId, name: e.name || "?", color: e.color || "#888", role: e.role, at: e.online_at });
      }
      (active?.handlers || handlers).onPresence(peers);
    });
    channel.on("presence", { event: "leave" }, ({ key }: { key: string }) => { if (key !== clientId) (active?.handlers || handlers).onLeave(key); });
    for (const ev of EVENTS) {
      channel.on("broadcast", { event: ev }, ({ payload }: { payload: any }) => {
        const h = active?.handlers || handlers, m = payload || {};
        if (ev === "cursor") h.onCursor(m); else if (ev === "grab") h.onGrab(m); else if (ev === "ops") h.onOps?.(m); else h.onSaved?.(m);
      });
    }
    channel.subscribe(async (status: string) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error("realtime " + status)); return; }
      if (status !== "SUBSCRIBED") return;
      clearTimeout(timeout);
      const role: "editor" | "viewer" = "editor";
      active = { key: roomKey, channel, role, handlers, me, clientId };
      try { await channel.track({ userId: me.id, name: me.name, color: me.color, role, online_at: new Date().toISOString() }); } catch { /* presencia best-effort */ }
      resolve({ role, clientId, send: activeSend, leave: collabLeave });
    });
  });
}

function activeSend(msg: Record<string, unknown>) {
  if (!active) return;
  const event = (EVENTS as readonly string[]).includes(String(msg.t)) ? String(msg.t) : "cursor";
  const payload = { ...msg, from: active.clientId, userId: active.me.id, name: active.me.name, color: active.me.color };
  void active.channel.send({ type: "broadcast", event, payload });
}

/** Cambia el rol anunciado (editor ↔ espectador cuando la sala está llena). */
export function collabSetRole(role: "editor" | "viewer") {
  if (!active || active.role === role) return;
  active.role = role;
  try { void active.channel.track({ userId: active.me.id, name: active.me.name, color: active.me.color, role, online_at: new Date().toISOString() }); } catch { /* noop */ }
}

export function collabLeave() {
  if (!active) return;
  const ch = active.channel;
  active = null;
  try { void ch.untrack(); } catch { /* noop */ }
  try { void browserSupabase?.removeChannel(ch); } catch { /* noop */ }
}

/** Estado de la sesión para el iframe (quién soy). */
export function collabIdentity(): { userId: string | null; name: string | null } {
  const b = (window as any).__musaBridge;
  return { userId: b?.userId || null, name: b?.accountName || null };
}
