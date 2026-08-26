# REQ-012 — OAuth 2.1 (MCP Authorization) para conectar ChatGPT y Claude web nativo

Status: Done (deployed `a823556` + `a7c9b8f`, migración v31 aplicada, 25 ago 2026)
Priority: Alta (desbloquea ChatGPT + Claude web, que exigen OAuth)
Files:
- netlify/functions/oauth-register.mjs (nuevo)
- netlify/functions/oauth-authorize.mjs (nuevo)
- netlify/functions/oauth-token.mjs (nuevo)
- public/.well-known/oauth-protected-resource (nuevo, estático)
- public/.well-known/oauth-authorization-server (nuevo, estático)
- public/.well-known/mcp.json (editar sección auth)
- netlify/functions/mcp.mjs (editar: WWW-Authenticate en 401)
- netlify.toml (agregar redirects de /oauth/*)
- supabase_migrations/oauth_mcp.sql (nuevo)

## Problema

El endpoint MCP solo autentica con `x-api-key` (header o, desde REQ-011, query
string). ChatGPT y Claude web conectan servidores MCP remotos siguiendo el
estándar OAuth 2.1 de MCP (spec 2025-06-18, Authorization). No mandan headers
arbitrarios ni siempre conservan el query string, así que sin OAuth no pueden
autenticarse de forma nativa.

Evidencia:
- Claude web: form de conector = URL + OAuth (sin campo de headers).
- ChatGPT: conector MCP remoto tiende a exigir OAuth (OpenAI co-escribe el spec).
- La spec MCP: Authorization es OPTIONAL, pero cuando se soporta, el ÚNICO
  estándar es OAuth 2.1 (RFC8414 discovery + RFC7591 dynamic client registration
  + RFC9728 protected resource metadata).

## Qué ya existe (no reinventar)

- `mcp.mjs` YA valida JWT de Supabase como Bearer (`sb.auth.getUser(bearer)` en
  `checkAuth`, ~línea 4604). O sea, el "resource server" ya acepta tokens.
- Supabase Auth ya está configurado (`getSupabaseAdmin`). Sirve como emisor de
  tokens (JWTs) y para el login del usuario en el consentimiento.
- `public/.well-known/mcp.json` ya es el archivo de descubrimiento del server
  (netlify.toml sirve `/.well-known/*` como estático, status 200).
- `supabase_migrations/` ya existe para la migración nueva.

## Solución

### 1. Discovery (archivos estáticos en public/.well-known/)

`oauth-protected-resource` (RFC9728):
```json
{
  "resource": "https://design.futuraria.com/mcp",
  "authorization_servers": ["https://design.futuraria.com/.well-known/oauth-authorization-server"],
  "scopes_supported": ["design.read", "design.write"],
  "bearer_methods_supported": ["header"]
}
```

`oauth-authorization-server` (RFC8414):
```json
{
  "issuer": "https://design.futuraria.com",
  "authorization_endpoint": "https://design.futuraria.com/oauth/authorize",
  "token_endpoint": "https://design.futuraria.com/oauth/token",
  "registration_endpoint": "https://design.futuraria.com/oauth/register",
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"]
}
```

Actualizar la sección `auth` de `mcp.json` para mencionar OAuth como alternativa
a `api_key` (los clientes leen este archivo al descubrir el server).

### 2. Endpoints OAuth (Netlify Functions)

**`oauth-register.mjs`** — RFC7591 dynamic client registration:
- POST → crea `client_id` (y `client_secret` si el cliente es confidential).
- Guarda en `oauth_clients`. Responde 201 con el client metadata.

**`oauth-authorize.mjs`** — authorization endpoint (code flow + PKCE):
- GET `?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...&code_challenge_method=S256`
- Si no hay sesión → redirige al login de Supabase Auth (o muestra form).
- Tras login → página de consentimiento ("permitir que <client> acceda a tu workspace").
- Genera un `code` de un solo uso, lo guarda en `oauth_codes` (con code_challenge),
  y redirige a `redirect_uri?code=...&state=...`.

**`oauth-token.mjs`** — token endpoint:
- POST (application/x-www-form-urlencoded) con `grant_type=authorization_code`,
  `code`, `redirect_uri`, `code_verifier`.
- Valida PKCE (`code_challenge` + `code_verifier` con SHA-256/S256).
- Emite un access token: JWT de Supabase para ese usuario (usando Supabase Auth,
  p. ej. un token de sesión o un JWT firmado con scope limitado).
- Responde `{ access_token, token_type: "Bearer", expires_in, refresh_token }`.

### 3. Migración Supabase (supabase_migrations/oauth_mcp.sql)

- `oauth_clients`: client_id (PK), client_secret_hash, name, redirect_uris (text[]),
  grant_types, created_at.
- `oauth_codes`: code (PK), client_id (FK), user_id (FK), redirect_uri,
  code_challenge, code_challenge_method, scope, expires_at, used (bool).
- RLS: solo el service role toca estas tablas (las funciones usan la service key).

### 4. Cambios en mcp.mjs

- En el 401 de auth, agregar el header `WWW-Authenticate` apuntando al metadata
  (RFC9728 §5.1). Formato sugerido:
  `WWW-Authenticate: Bearer resource_metadata="https://design.futuraria.com/.well-known/oauth-protected-resource"`
- Verificar end-to-end el path Bearer JWT que ya existe (~4604): que un token de
  Supabase devuelva el `userId` correcto y autorice tools/call.
- NO quitar x-api-key (header + query) — OAuth es alterno, no reemplazo.

### 5. Redirects (netlify.toml)

Agregar redirects `/oauth/*` → `/.netlify/functions/oauth-*` (patrón igual al de
`/mcp` → `/.netlify/functions/mcp`).

## Notas de seguridad

- Nunca emitir el `MCP_ADMIN_KEY` por OAuth. OAuth emite tokens de USUARIO
  (Supabase), con scope limitado, no keys de workspace admin.
- PKCE obligatorio (S256), no "plain".
- Los codes expiran en minutos y son de un solo uso.

## Verificación

1. Deploy + correr la migración.
2. `GET /.well-known/oauth-protected-resource` → 200 con `authorization_servers`.
3. `GET /.well-known/oauth-authorization-server` → 200 con metadata completa.
4. `POST /oauth/register` → 201 con client_id.
5. Flujo completo PKCE: authorize → login → consent → code → token → access_token.
6. `POST /mcp` con `Authorization: Bearer <access_token>` → `tools/call
   list_workspaces` → 200 + el workspace del usuario logueado.
7. `POST /mcp` sin auth → 401 CON header `WWW-Authenticate`.
8. `x-api-key` (header y `?key=`) sigue funcionando (regresión).

## Resultado esperado

ChatGPT y Claude web pueden "Agregar servidor MCP" pegando
`https://design.futuraria.com/mcp`, el cliente descubre OAuth, redirige a
login/consent, y queda autenticado. Hermes/Claude desktop siguen usando
`x-api-key` sin cambios.
