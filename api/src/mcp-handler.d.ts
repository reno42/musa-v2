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
