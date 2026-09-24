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
}
