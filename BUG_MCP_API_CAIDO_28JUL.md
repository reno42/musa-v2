# 🔴 Design Tool — Diagnóstico de API/MCP Caído

**Fecha:** 28 Julio 2026
**Diagnosticado por:** Mira (Hermes)

## Síntomas

1. `POST https://futuraria.netlify.app/mcp` → timeout / sin respuesta
2. `GET https://futuraria.netlify.app/api/templates` → devuelve HTML de Webflow (404 page del sitio marketing)
3. `GET https://futuraria.netlify.app/` → SÍ responde (200, 104KB, SPA de React)
4. MCP tools desde Hermes → timeout de 300s

## Diagnóstico

El sitio Netlify `futuraria.netlify.app` está vivo (la SPA carga), pero las funciones serverless (`/api/*` y `/mcp`) están devolviendo contenido del sitio Webflow de marketing (futuraria.com) en vez de procesar las peticiones.

### Causa probable
Las Netlify Functions no se están ejecutando. Las rutas `/api/*` y `/mcp` caen en el catch-all del SPA, pero en vez de servir `dist/index.html` están sirviendo HTML de Webflow. Esto sugiere una de estas causas:

1. **El deploy de Netlify está roto** — las functions no se buildearon o el build falló silenciosamente
2. **El sitio Netlify fue reclamado/sobrescrito** — otro proyecto (el Webflow) está usando el mismo subdominio
3. **Las functions existen pero crashean en startup** — error en imports (node_modules faltante, ESM/CJS mismatch)
4. **Variables de entorno faltantes** — SUPABASE_URL, SUPABASE_SECRET_KEY no configuradas en Netlify

## Archivos a revisar

```
design-main/
├── netlify.toml              → redirects: /api/* → function, /mcp → function
├── netlify/functions/
│   ├── api.mjs               → puente Express → Netlify Function
│   └── mcp.mjs               → MCP server (10,648 líneas, JSON-RPC + SSE)
├── api/
│   └── src/
│       ├── index.ts           → Express app factory
│       └── services/
│           ├── supabase.ts    → ¿SUPABASE_URL configurada?
│           └── templates.ts   → servicio de templates
└── package.json               → build scripts
```

## Pasos para el IDE Agent

1. **Verificar el último deploy en Netlify:**
   - Entrar a https://app.netlify.com
   - Buscar el sitio `futuraria`
   - Revisar Deploys → último deploy ¿falló? ¿cuándo fue?
   - Revisar Functions → ¿aparecen `api` y `mcp`?

2. **Verificar environment variables:**
   - Site Settings → Environment variables
   - Debe tener: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`

3. **Redeploy desde cero:**
   ```bash
   cd design-main
   npm install
   npm run build:functions
   npm run build
   ```
   Luego hacer deploy a Netlify (via CLI o git push)

4. **Probar localmente:**
   ```bash
   cd design-main/api
   npm run dev    # → http://localhost:3001
   ```
   Verificar que `/api/templates` responda JSON, no HTML

5. **Verificar que el subdominio no fue robado:**
   - En Netlify → Domain settings → verificar que `futuraria.netlify.app` apunte a ESTE sitio
   - Si hay conflicto con otro sitio Netlify, renombrar el subdominio
