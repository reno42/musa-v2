import { v4 as uuid } from "uuid";
import type {
  Workspace, Frame, DesignTemplate, FabricCanvas,
  Webhook, RenderJob,
} from "../types.js";

class Store {
  workspaces = new Map<string, Workspace>();
  templates = new Map<string, DesignTemplate>();
  webhooks = new Map<string, Webhook>();
  renderJobs = new Map<string, RenderJob>();

  // ─── Workspaces ─────────────────────────────────

  createWorkspace(data: { name: string; description?: string; ownerId: string }): Workspace {
    const now = new Date().toISOString();
    const ws: Workspace = {
      id: `ws_${uuid().slice(0, 12)}`,
      name: data.name,
      description: data.description,
      ownerId: data.ownerId,
      memberIds: [data.ownerId],
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(ws.id, ws);
    return ws;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  listWorkspaces(userId: string): Workspace[] {
    return [...this.workspaces.values()]
      .filter(w => w.ownerId === userId || w.memberIds.includes(userId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  updateWorkspace(id: string, data: Partial<Pick<Workspace, "name" | "description">>): Workspace | undefined {
    const ws = this.workspaces.get(id);
    if (!ws) return undefined;
    Object.assign(ws, data, { updatedAt: new Date().toISOString() });
    return ws;
  }

  deleteWorkspace(id: string): boolean {
    for (const [tid, tpl] of this.templates) {
      if (tpl.workspaceId === id) this.templates.delete(tid);
    }
    return this.workspaces.delete(id);
  }

  addMember(workspaceId: string, userId: string): Workspace | undefined {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return undefined;
    if (!ws.memberIds.includes(userId)) {
      ws.memberIds.push(userId);
      ws.updatedAt = new Date().toISOString();
    }
    return ws;
  }

  // ─── Templates ─────────────────────────────────

  createTemplate(data: {
    workspaceId: string; name: string; width?: number; height?: number;
    canvas?: FabricCanvas; userId: string;
  }): DesignTemplate {
    const now = new Date().toISOString();
    const tpl: DesignTemplate = {
      id: `tpl_${uuid().slice(0, 12)}`,
      workspaceId: data.workspaceId,
      name: data.name || "Untitled",
      width: data.width || 1080,
      height: data.height || 1080,
      canvas: data.canvas || { objects: [], viewport: { x: 0, y: 0, zoom: 1 } },
      frames: [],
      styles: [],
      comments: [],
      versions: [],
      variables: { collections: [], variables: [], bindings: {} },
      components: [],
      metadata: { createdAt: now, updatedAt: now, createdBy: data.userId },
    };
    this.templates.set(tpl.id, tpl);
    return tpl;
  }

  getTemplate(id: string): DesignTemplate | undefined {
    return this.templates.get(id);
  }

  listTemplates(workspaceId?: string, limit = 50, offset = 0): { data: DesignTemplate[]; total: number } {
    let entries = [...this.templates.values()];
    if (workspaceId) entries = entries.filter(t => t.workspaceId === workspaceId);
    entries.sort((a, b) =>
      new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime()
    );
    const total = entries.length;
    return { data: entries.slice(offset, offset + limit), total };
  }

  updateTemplate(id: string, data: Partial<DesignTemplate>): DesignTemplate | undefined {
    const tpl = this.templates.get(id);
    if (!tpl) return undefined;
    Object.assign(tpl, data, {
      metadata: { ...tpl.metadata, updatedAt: new Date().toISOString() },
    });
    return tpl;
  }

  deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  // ─── Frames ─────────────────────────────────────

  createFrame(templateId: string, data: {
    name: string; x: number; y: number; width: number; height: number; fill?: string;
  }): Frame | undefined {
    const tpl = this.templates.get(templateId);
    if (!tpl) return undefined;
    const frame: Frame = {
      id: `frame_${uuid().slice(0, 12)}`,
      templateId, name: data.name, x: data.x, y: data.y,
      width: data.width, height: data.height,
      fill: data.fill || "#ffffff", opacity: 1,
      order: tpl.frames.length, objects: [],
    };
    tpl.frames.push(frame);
    tpl.metadata.updatedAt = new Date().toISOString();
    return frame;
  }

  updateFrame(templateId: string, frameId: string, data: Partial<Frame>): Frame | undefined {
    const tpl = this.templates.get(templateId);
    if (!tpl) return undefined;
    const frame = tpl.frames.find(f => f.id === frameId);
    if (!frame) return undefined;
    Object.assign(frame, data);
    tpl.metadata.updatedAt = new Date().toISOString();
    return frame;
  }

  deleteFrame(templateId: string, frameId: string): boolean {
    const tpl = this.templates.get(templateId);
    if (!tpl) return false;
    const idx = tpl.frames.findIndex(f => f.id === frameId);
    if (idx === -1) return false;
    tpl.frames.splice(idx, 1);
    tpl.metadata.updatedAt = new Date().toISOString();
    return true;
  }

  // ─── Webhooks ───────────────────────────────────

  registerWebhook(data: { url: string; events: string[]; userId: string; secret?: string }): Webhook {
    const webhook: Webhook = {
      id: `wh_${uuid().slice(0, 12)}`,
      url: data.url, events: data.events,
      secret: data.secret || uuid(), userId: data.userId,
      active: true, createdAt: new Date().toISOString(),
    };
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  listWebhooks(userId: string): Webhook[] {
    return [...this.webhooks.values()].filter(w => w.userId === userId);
  }

  deleteWebhook(id: string, userId: string): boolean {
    const wh = this.webhooks.get(id);
    if (!wh || wh.userId !== userId) return false;
    return this.webhooks.delete(id);
  }

  // ─── Render Jobs ────────────────────────────────

  createRenderJob(templateId: string, format: string, scale: number): RenderJob {
    const job: RenderJob = {
      id: `render_${uuid().slice(0, 12)}`,
      templateId, status: "pending", format: format as any, scale,
      createdAt: new Date().toISOString(),
    };
    this.renderJobs.set(job.id, job);
    return job;
  }

  getRenderJob(id: string): RenderJob | undefined {
    return this.renderJobs.get(id);
  }
}

export const store = new Store();
