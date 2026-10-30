// apiV2/agentes.ts — datos de la vista AGENTES del shell-v2.
// Endpoints reales: GET /api/ghost/jobs, /api/ghost/jobs/:id, /api/ghost/summary
// (router aditivo nuevo en api/src/routes/ghostJobs.ts — solo lectura; la escritura
//  de jobs sigue siendo el MCP ghost_perform, no se duplica).
import { getData } from "./client";

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export interface GhostJob {
  id: string;
  workspace_id: string;
  task?: string;
  mode?: string;
  status?: string;
  link?: string | null;
  created_at?: string;
}

export async function fetchGhostJobs(workspaceId: string, limit = 50): Promise<GhostJob[]> {
  const qs = new URLSearchParams({ workspaceId, limit: String(limit) });
  const res = await getData<Envelope<GhostJob[]>>(`/api/ghost/jobs?${qs}`);
  if (!res.success) throw new Error(res.error || "ghost jobs failed");
  return res.data;
}

export interface GhostJobDetail extends GhostJob {
  result?: unknown;
  user_id?: string;
}

export async function fetchGhostJob(id: string): Promise<GhostJobDetail> {
  const res = await getData<Envelope<GhostJobDetail>>(`/api/ghost/jobs/${id}`);
  if (!res.success) throw new Error(res.error || "ghost job failed");
  return res.data;
}

export interface GhostSummary {
  byStatus: Record<string, number>;
  total: number;
}

export async function fetchGhostSummary(workspaceId: string): Promise<GhostSummary> {
  const res = await getData<Envelope<GhostSummary>>(
    `/api/ghost/summary?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "ghost summary failed");
  return res.data;
}

/** Paquete de la vista AGENTES. */
export interface AgentesData {
  jobs: GhostJob[];
  summary: GhostSummary;
}

export async function loadAgentes(workspaceId: string): Promise<AgentesData> {
  const [jobs, summary] = await Promise.all([
    fetchGhostJobs(workspaceId),
    fetchGhostSummary(workspaceId),
  ]);
  return { jobs, summary };
}

// ── F2: chats de agentes (GET /api/chat/messages — tabla chat_messages) ──
export interface ChatMessage {
  id: string;
  role?: string;
  content?: string;
  meta?: unknown;
  ts?: string;
  workspace_id?: string;
}

/** GET /api/chat/messages?workspaceId=…&limit=… (endpoint real de chatHistory). */
export async function fetchAgentChats(workspaceId: string, limit = 100): Promise<ChatMessage[]> {
  const qs = new URLSearchParams({ workspaceId, limit: String(limit) });
  const res = await getData<Envelope<ChatMessage[]>>(`/api/chat/messages?${qs}`);
  if (!res.success) throw new Error(res.error || "chat history failed");
  return res.data;
}
