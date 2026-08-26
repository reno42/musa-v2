# OAUTH-FLOW-TEST — 2026-08-25

**Veredicto: 21/21 PASS.** El flujo OAuth 2.1 completo (REQ-012) verificado
contra producción **sin ningún cliente de pago** (ni ChatGPT ni Claude) —
`QA/oauth-flow-test.mjs` es un cliente MCP headless que ejecuta exactamente la
secuencia HTTP que haría un conector real.

## Qué se probó

| # | Bloque | Checks | Resultado |
|---|---|---|---|
| 1 | Discovery RFC9728 / RFC8414 (los dos `.well-known`) | 4 | PASS |
| 2 | 401 + `WWW-Authenticate` como disparador de discovery en `/mcp` | 3 | PASS |
| 3 | Registro dinámico de cliente RFC7591 (`/oauth/register`) | 1 | PASS |
| 4 | `/oauth/authorize`: login → consent → redirect con code + state + iss | 7 | PASS |
| 5 | `/oauth/token`: `authorization_code` + PKCE S256 | 2 | PASS |
| 6 | El token emitido autoriza `tools/call` en `/mcp` como Bearer | 2 | PASS |
| 7 | `refresh_token` (pass-through a GoTrue) | 1 | PASS |
| 8 | Códigos de un solo uso (replay → `invalid_grant`) | 1 | PASS |

Regresión de los otros dos métodos de auth (mismo día, producción, con la
`MCP_ADMIN_KEY` real): `x-api-key` header → **200**, `?key=` en la URL →
**200**. Los tres métodos conviven.

## Cuenta QA

- `qa.oauth.test@design.futuraria.com` (plan friends_family, NDA aceptado vía
  `POST /api/account/nda-acceptance` — de paso, esto validó el muro NDA de la
  v30 de punta a punta).
- Credenciales en `QA/.env.qa-oauth` (git-ignored vía `.env.*`). Si se pierde:
  borrar el usuario en Supabase → Authentication → Users y re-correr el setup.
- **Cuenta huérfana a borrar cuando quieras:** `qa.oauth@design.futuraria.com`
  quedó creada con password desconocido durante el primer intento (bug de
  forma de respuesta en el setup, ya corregido en el script).

## Cómo re-correr (regresión post-deploy)

```powershell
node QA/oauth-qa-user-setup.mjs    # solo la primera vez (o si borraste la cuenta)
node QA/oauth-flow-test.mjs        # el flujo completo — 21 checks
# equivalentes: npm run test:oauth:setup / npm run test:oauth
```

Cada corrida registra un cliente descartable en `oauth_clients`
(`client_name = 'QA oauth-flow-test'`). Limpieza opcional en el SQL Editor:

```sql
delete from oauth_clients where client_name = 'QA oauth-flow-test';
```

(los `oauth_codes` asociados se borran en cascada), o
`node QA/oauth-qa-user-setup.mjs --prune-clients` con la service key del
proyecto vivo en variables de entorno.

## Hallazgos colaterales

1. **`.env.design-supabase` local está desactualizado**: apunta a
   `npdycbfhtcccznbndrkl.supabase.co`, que ya no resuelve en DNS. El proyecto
   vivo de producción es `qqqcmtwzyaejlzffivri.supabase.co` (confirmado vía el
   endpoint público `GET /api/auth/config`). Por eso el setup NO depende de
   ese archivo: descubre la URL viva desde producción. Si algún día hace
   falta la service key local, actualizar ese `.env` con el ref vivo.
2. GoTrue REST devuelve los tokens **planos** (`{access_token, ...}`), no
   envueltos en `session: {}` — esa envoltura es una construcción del cliente
   supabase-js. Costó un intento fallido y quedó documentado en el script.
3. El signup público NO requiere confirmación de email (fase alfa) — el setup
   aprovecha ese camino público (signup + `/api/account/nda-acceptance`) y no
   necesita service key para nada.
4. El usuario QA nuevo ya tiene 1 workspace tras el primer `list_workspaces`
   autenticado (resolución dinámica por usuario, sin pasos extra).

## Qué falta (cuando haya acceso)

- Prueba con un conector real (ChatGPT / Claude web). Lo único que este test
  no puede simular es el descubrimiento OAuth **disparado desde la UI del
  cliente**; toda la parte HTTP ya está verde.
- Intermedio gratuito con UI real: MCP Inspector
  (`npx @modelcontextprotocol/inspector`) apuntando a
  `https://design.futuraria.com/mcp`.
