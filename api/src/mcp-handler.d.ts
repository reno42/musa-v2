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
}
