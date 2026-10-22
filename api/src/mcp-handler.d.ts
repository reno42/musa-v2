declare module "*.mjs" {
  export const handler: (event: {
    httpMethod: string;
    headers: Record<string, string>;
    body: string;
  }) => Promise<{
    statusCode?: number;
    headers?: Record<string, string>;
    body?: string;
  }>;
  // netlify/functions/keys.mjs también exporta helpers BYOK que el router
  // local (routes/keysStub.ts) importa para no duplicar crypto.
  export const encrypt: (plaintext: string) => string;
  export const getUserKey: (userId: string, provider: string) => Promise<{ key: string | null; model: string | null }>;
  // netlify/functions/musa-batch-core.mjs exporta el mapa de endpoints por
  // proveedor que routes/llmProxy.ts reutiliza como única fuente de verdad.
  export const PROVIDER_ENDPOINTS: Record<string, string>;
  // netlify/functions/ghostLlmChain.mjs — cadena plataforma→BYOK del Ghost
  // (REQ-028): el pick de plataforma que llmProxy usa para relayar con la
  // key del server cuando el body trae tier: "platform".
  export const pickPlatformLlm: (endpoints: Record<string, string>, env?: Record<string, string | undefined>) => {
    provider: string;
    endpoint: string;
    model: string;
    headers: Record<string, string>;
    extraBody: Record<string, unknown>;
  } | null;
  // netlify/functions/quota.mjs — cuota freemium (REQ-028 Item 2): peek
  // check-only (null = error técnico → fail-closed) para el relay platform y
  // el header X-Musa-Quota-Remaining.
  export const peekQuota: (sb: unknown, userId: string, limit?: number) => Promise<{
    ok: boolean;
    used: number;
    limit: number;
    remaining: number;
  } | null>;
  export const platformFreeRunLimit: (env?: Record<string, string | undefined>) => number;
  // REQ-027 — Flows builder: puente MCP-first al dispatcher real de mcp.mjs
  // (el nodo template del engine ejecuta herramientas Musa por el MISMO
  // camino que una IA vía /mcp) y runtime compartido con el webhook
  // (netlify/functions/flows-runtime.mjs + flows-core.mjs).
  export const createFlowToolBridge: () => (name: string, args: Record<string, unknown>) => Promise<any>;
  export const createFlowRuntime: (deps: {
    sb: unknown;
    callTool?: (name: string, args: Record<string, unknown>) => Promise<any>;
    resolveTemplateWorkspace?: (templateId: string) => Promise<string | null>;
    resolveDns?: (hostname: string) => Promise<string[]>;
  }) => {
    store: any;
    runFlow: (flow: any, opts?: { input?: unknown; requestId?: string | null }) => Promise<{
      runId: string;
      status: string;
      steps: unknown[];
      error: string | null;
      outputs: Record<string, unknown>;
      idempotent: boolean;
    }>;
    getCredentialDecrypted: (workspaceId: string, id: string) => Promise<any>;
  };
  export const flowsDisabled: () => boolean;
  export const webhookTriggerMatches: (flow: any, rawSecret: string) => { ok: boolean; status?: number; code?: string; message?: string };
  export const flowWebhookUrl: (flow: any, rawSecret: string) => string;
  export const stableWebhookMatches: (flow: any, rawBody: string, signatureHeader: string) => { ok: boolean; status?: number; code?: string; message?: string };
  export const oauth2StateDecode: (state: string) => Record<string, unknown> | null;
  export const sha256Hex: (value: string) => string;
  export const newWebhookSecret: () => string;
  export const flowsBaseUrl: () => string;
  export const LIMITS: Record<string, number>;
  // shared/skillsCatalog.mjs — parser del catálogo de skills que consumen la
  // ruta de vitrina (routes/skillsCatalog.ts) y el prebuild
  // (scripts/generate-skills-catalog.mjs → public/skills-catalog.json).
  export const buildSkillsCatalog: (filesById: Record<string, string>) => {
    total: number;
    skills: Array<{
      id: string;
      title: string;
      icon: string;
      description: string;
      examples: string[];
      method: string[] | null;
    }>;
  };
}
