# REQ-073 — request_account: una IA puede crearle la cuenta a su humano

**Fecha:** 2026-11-20 · **Dueño:** Hermes · **Estado:** en producción (deploy 6d08d3e6)
**Pedido de Ren:** que la IA de cada usuario pueda ofrecer "te creo la cuenta" y ejecutarlo. Escala objetivo: 1,000+ usuarios de golpe.

## Diseño (ruta A — sin email externo)
1. El agente pregunta el correo a su humano (jamás lo elige ella) y llama el tool público `request_account({ email })`.
2. El server crea el usuario sin password (`email_confirm: false`) via `createUser` admin y genera un link nativo de activación (`generateLink signup`, token de un solo uso).
3. El link se CANJEA server-side (patrón del auto-login) y se reescribe a `https://musaworks.com/activar#access_token=…` — no depende de la Redirect URLs config de Supabase (que ignora `redirect_to` custom, verificado 20-nov).
4. El humano abre el link, define SU password en la página (PUT /auth/v1/user con la sesión del fragment) y entra con sesión a Musa. El trigger existente le crea perfil + workspace personal.
5. La IA nunca ve ni toca un password. Instrucción explícita en tool, SKILL.md, llms.txt, llms-full.txt y mcp.json.

## Superficies
- `worker/runtime/functions/request-account.mjs` — core `requestAccountCore` + handler HTTP.
- `POST /api/request-account` (route en worker/index.js, fuera del tracking del segundo cerebro: el email jamás entra a logs de actividad).
- `GET /activar` — página servida por el worker (CSP por nonce, noindex, sb-config embebido server-side).
- Tool MCP `request_account` en PUBLIC_TOOLS (sin llave) + docs: SKILL.md, llms.txt, llms-full.txt (generador scripts/geo/build.mjs), .well-known/mcp.json.

## Seguridad (verificada en prod, 20-nov)
- Email ya confirmado → 200 sin link, mensaje "ya tiene cuenta activa" (nadie dispara logins a cuentas existentes). Sonda: `generateLink(signup)` falla 422 `email_exists` con usuario confirmado (probe real).
- Cooldown 10 min por email (429 `email_cooldown`) + rate-limit por IP (antispam.mjs) + cupo global del isolate (40/10 min ≈ 5,760/día).
- Email inválido → 400 `invalid_email`. Emails en respuestas SIEMPRE enmascarados (`qa*********@…`).
- Passwords jamás pasan por chat ni por el endpoint; solo viajan browser↔Supabase directo.

## QA E2E contra prod (20-nov, deploy 6d08d3e6)
- Request → link → password definida → LOGIN real OK → workspace del trigger creado (1 membership). ✓
- B1 ya-confirmado sin link ✓ · B2 cooldown 429 ✓ · B3 inválido 400 ✓ · B4 tool MCP sin auth crea cuenta+link ✓ · tools/list lo expone (con sesión) ✓
- Usuarios de prueba: 6 creados y BORRADOS (membership+workspace+perfil+auth), verificación final 0 QA. Los usuarios reales no se tocaron.
- Nota: `getUserByEmail` NO existe en supabase-js 2.108 y el filtro `?email=` del REST admin es IGNORADO por este GoTrue (devolvía 50 sin filtrar) — por eso la sonda es generateLink. UA de navegador obligatorio contra el worker (python-urllib → 403).

## Pendiente (solo si escala lo pide)
- Resend/SMTP para password-reset por email (el sender gratis de Supabase no da para volumen; el signup NO lo necesita — va por chat). DNS records en musaworks.com los agrega Hermes; cuenta la crea Ren (2 min).
