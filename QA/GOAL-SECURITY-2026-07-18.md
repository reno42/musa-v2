# /goal — Seguridad Fase 0: cerrar /mcp + sesiones (REVISADO por Lara, 2026-07-18)

Decisiones de Ren (con correcciones de Lara tras auditar netlify/functions/mcp.mjs):

## Respuestas a tus 4 preguntas
1. **Keys server-side:** YA lo están (Netlify env vars: OPENROUTER_API_KEY línea 3589, GEMINI/OPENAI línea 5272).
   NO migrarlas a una tabla `settings` — una tabla con keys en texto plano es PEOR que env vars.
   Se quedan en Netlify env. La UI de Settings solo muestra estado (configurada/no configurada), nunca el valor.
2. **MCP access key:** SÍ, pero NO inventes una key única en `settings`. Ya existe la tabla `api_keys`
   de tu FASE 2 — el problema es que NUNCA se enforcea. El fix es enforcement, no infra nueva.
3. **Session tracking:** SÍ, versión ligera (tabla + UI en Settings). Es auditoría, no seguridad.
4. **Comentarios como Pro:** SÍ, placeholder con badge "Pro", cero código.

## Hallazgos de la auditoría (verificados, mcp.mjs)
- `validateApiKey()` (línea 2571) definida y **jamás llamada**. Sin key → `getUserId()` retorna `"dev_user_default"` → acceso anónimo total.
- `create_api_key` (línea ~8340) **sin auth**: cualquiera se crea keys.
- `keyHash()` (línea ~2560) **retorna la key cruda** → keys en texto plano en DB.
- Rate limit: solo por IP, en memoria (se resetea en cold start).
- Frontend: `x-api-key` hardcodeada en `src/lib/supabase.ts` → pública en el bundle JS.

## Implementación (todo en netlify/functions/*, NO en api/src — Express no corre en prod)

### 1. Enforcement en /mcp
- Env var nueva `MCP_ADMIN_KEY` (la configura el deployer en Netlify).
- `initialize` y `tools/list`: públicos (discovery, no queman nada).
- `tools/call`: requiere `x-api-key` válida = `MCP_ADMIN_KEY` O una row activa de `api_keys` (comparación por hash). Si no → error JSON-RPC -32001 "Unauthorized" + HTTP 401.
- Sin Supabase configurado (dev local): comportamiento actual (accept-all) SOLO si `MCP_ADMIN_KEY` no está definida.
- `create_api_key` / `revoke_api_key` / `list_api_keys`: SOLO admin key.

### 2. Hashing
- `keyHash()` → SHA-256 hex real (crypto nativo).
- Migración: script/SQL que hashea las keys crudas existentes en `api_keys` (una vez).
- `list_api_keys` sigue mostrando solo preview (`fdr_...xxxx`).

### 3. Mismo enforcement en /api
- `netlify/functions/api.mjs` y `render.mjs`: mismas reglas para endpoints que escriben o queman créditos.
  GET de lectura pública se puede discutir después; por ahora TODO tras la key.

### 4. Frontend
- Quitar la key hardcodeada de `src/lib/supabase.ts`.
- Settings → Security: campo "API Key" que se guarda en localStorage; `apiFetch` la lee de ahí.
- Primera vez sin key: banner en dashboard "Configura tu API key en Settings".
- Botón "Rotate Key" (revoke + create, solo con admin key).

### 5. Session tracking (tabla + UI)
```sql
CREATE TABLE IF NOT EXISTS client_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_label TEXT,            -- label de la api_key o 'admin'
  client_info TEXT,          -- MCP clientInfo.name/version si existe
  user_agent TEXT,
  ip TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  request_count INT DEFAULT 1,
  UNIQUE(key_label, client_info, user_agent, ip)
);
```
- Upsert barato por request (update last_seen + count). Best-effort, nunca bloquea el request.
- UI en Settings → Security: lista con icono por tipo de cliente, "última actividad", IP.
- Recordar: tipos TEXT para ids externos, patrón RLS de las tablas existentes (sin auth.uid()).

### 6. Comentarios "Pro"
- Placeholder UI con badge "Pro". Cero lógica.

## ⚠️ Textos de UI en español neutro (o inglés)
Nada de voseo en la UI pública: "configuras", "puedes", "tu clave" — no "configurás/podés/vos".

## Aceptación (Lara verifica post-deploy)
- [ ] `tools/call` sin key → 401/-32001. Con key inválida → 401. Con key válida → 200.
- [ ] `create_api_key` sin admin key → 401.
- [ ] Keys en DB hasheadas (SELECT muestra hex de 64 chars, no fdr_).
- [ ] `ai_generate_image` sin key → 401 (créditos protegidos).
- [ ] Dashboard funciona tras pegar key en Settings; sin key muestra banner, no crashea.
- [ ] client_sessions registra browser vs MCP client con timestamps.
- [ ] Rotate Key revoca la anterior y la UI vieja recibe 401.

## Nota de coordinación
Al activar enforcement, TODOS los clientes existentes necesitan key: el browser de Ren, los agentes
externos y los scripts de Lara. Antes del deploy: crear 2 keys con la admin (una "ren-browser", una
"lara-automation") y entregarlas. No deployar un viernes a las 6pm sin esto. 😄

/goal
