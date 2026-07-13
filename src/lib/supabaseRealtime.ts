import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!supabaseClient && supabaseUrl && supabaseAnonKey) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseClient;
}

/** Subscribe to template changes via Supabase Realtime Broadcast */
export function subscribeTemplate(
  templateId: string,
  onHtmlCssChange: (frameId: string | null, html: string, css: string) => void
): RealtimeChannel | null {
  const client = getClient();
  if (!client) return null;

  const channel = client.channel(`template:${templateId}:changes`, {
    config: { broadcast: { self: false } },
  });

  channel
    .on("broadcast", { event: "html_css_change" }, (payload: any) => {
      onHtmlCssChange(
        payload.payload?.frameId || null,
        payload.payload?.html ?? "",
        payload.payload?.css ?? "",
      );
    })
    .subscribe();

  return channel;
}

/** Broadcast html/css changes to all subscribers */
export function broadcastChange(
  channel: RealtimeChannel | null,
  templateId: string,
  frameId: string,
  html: string,
  css: string
) {
  if (!channel) return;
  channel.send({
    type: "broadcast",
    event: "html_css_change",
    payload: { templateId, frameId, html, css },
  });
}

/** Subscribe to agent presence for a template */
export function subscribePresence(
  templateId: string,
  onAgentsChange: (agents: { agentId: string; sectionId: string; onlineAt: string }[]) => void
): RealtimeChannel | null {
  const client = getClient();
  if (!client) return null;

  const channel = client.channel(`template:${templateId}:presence`);

  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const agents: { agentId: string; sectionId: string; onlineAt: string }[] = [];
      for (const [, entries] of Object.entries(state)) {
        for (const entry of entries as any[]) {
          agents.push({
            agentId: entry.agent_id || entry.user_id || "unknown",
            sectionId: entry.section_id || "all",
            onlineAt: entry.online_at || new Date().toISOString(),
          });
        }
      }
      onAgentsChange(agents);
    })
    .subscribe();

  return channel;
}

/** Announce agent presence */
export function trackPresence(
  channel: RealtimeChannel | null,
  agentId: string,
  sectionId: string
) {
  if (!channel) return;
  channel.track({
    agent_id: agentId,
    section_id: sectionId,
    online_at: new Date().toISOString(),
  });
}
