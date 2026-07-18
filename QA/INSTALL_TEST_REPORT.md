# INSTALL_TEST_REPORT — Prueba de instalación fría

**Autor:** Opus 4.8 (agente de verificación) · **Fecha:** 2026-07-16
**Método:** análisis estático exhaustivo de la landing (`src/components/Landing.tsx`),
`INSTALL.md`, `package.json`, `api/package.json`, `.env.example` y `vite.config.ts`,
más validación en vivo de los síntomas de arranque. Cada hallazgo cita evidencia
`archivo:línea`. El objetivo (PLAN_PRODUCTO §4.2): *de máquina limpia a un deck creado
vía MCP sin ayuda humana salvo pegar credenciales.*

---

## Veredicto

🔴 **Un usuario fresco NO llega al editor siguiendo la landing.** Hay 6 bloqueadores,
5 de ellos confirmados por inspección con evidencia directa. El más grave (B0) no estaba
en el diagnóstico previo del jefe.

---

## Bloqueadores (paso ✅/❌ del recorrido)

### ❌ B0 — El api server (:3001) es obligatorio y NADIE lo arranca (CRÍTICO, nuevo)
- **Evidencia**: `package.json:7` → `"dev": "vite"` (solo vite). `vite.config.ts:11-16`
  proxea `/api` y `/mcp` a `http://localhost:3001`. El server vive en `api/` con su propio
  `"dev": "tsx watch src/server.ts"` (`api/package.json`). Ningún script raíz arranca ambos.
- **Síntoma**: `npm run dev` levanta la UI, pero cada llamada del dashboard
  (`/api/workspaces`, `/api/templates`) va al proxy → `:3001` → **ECONNREFUSED** → dashboard
  vacío/muerto. Validado en vivo: con `:3001` abajo, `curl localhost:3001/api/health` = sin
  respuesta; el dashboard no carga workspaces.
- **Matiz importante**: el `.env.example` dice "Without Supabase, the app uses in-memory
  storage" — pero ese almacenamiento en memoria vive DENTRO del api server. Sin `:3001`
  NO hay ni modo memoria. La doc confunde "sin Supabase" con "sin api server".
- **Fix**: script raíz que levante ambos + toda la doc apuntando a él.
  ```jsonc
  // package.json scripts
  "dev:all": "concurrently -k -n vite,api \"vite\" \"npm --prefix api run dev\""
  // requiere: npm i -D concurrently   (o un scripts/dev.mjs sin dependencia)
  ```
  `INSTALL.md` Fase 1 y la landing paso 2 deben usar `npm run dev:all` y verificar
  AMBOS puertos (200 en :5173 **y** en :3001/api/health).

### ❌ B1 — La landing referencia un README.md inexistente
- **Evidencia**: `Landing.tsx:426` (prompt de una línea) y `:414` dicen "Follow the README
  for configuration". No existe `README.md` en la raíz (confirmado: `ls README.md` → ausente).
- **Impacto**: el prompt estrella de onboarding ("pégalo en tu IA") manda a un archivo que
  no existe → la IA improvisa o se detiene.
- **Fix**: crear `README.md` raíz (qué es, quickstart de 5 líneas con `dev:all`, enlaces a
  `INSTALL.md` y `SKILL.md`).

### ❌ B2 — La landing pide las variables de entorno equivocadas
- **Evidencia**: `Landing.tsx:448` → "Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`".
  Esas son **solo de realtime** (`src/lib/supabaseRealtime.ts:3-4`). La persistencia real la
  usa el server con `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (`api/src/services/supabase.ts:39-43`).
  El `.env.example` sí trae las correctas.
- **Impacto**: el usuario configura VITE_* , reinicia, y NADA persiste (el server sigue en
  memoria porque nunca recibió `SUPABASE_URL`/`SERVICE_KEY`). Confusión garantizada — es el
  mismo origen del "Settings dice no conectado pero veo datos" (ver PLAN_PRODUCTO §0).
- **Fix**: landing paso 3 debe listar `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (datos) y
  mencionar `VITE_*` como opcional para realtime.

### ❌ B3 — Promesa falsa: "auto-initialize your database schema"
- **Evidencia**: `Landing.tsx:447` → "the MCP server will auto-initialize your database
  schema". No existe auto-init: el schema es un SQL manual (`supabase_schema_complete.sql`);
  `getSupabase()` (`api/src/services/supabase.ts:38`) solo crea el cliente, no corre DDL.
  (INSTALL.md Path A Step 5 SÍ lo corre, pero vía Management API con PAT — no es el server.)
- **Impacto**: el usuario espera tablas mágicas; hace CRUD; el server responde pero las
  tablas no existen en Supabase → errores 500 al persistir.
- **Fix**: quitar la frase, o implementar `scripts/setup-supabase.mjs` que corra el SQL vía
  PAT (ya hay patrón en INSTALL.md `_run_sql.mjs`) y referenciarlo.

### 🟡 B4 — INSTALL.md es sólido pero omite el api server y contradice a la landing
- **Evidencia**: `INSTALL.md:35` `npm run dev &` + checkpoint en `:157` "Create workspace +
  template, refresh — persists" — imposible sin `:3001`. La guía por fases (PAT, SQL desde
  archivo, Netlify) es buena y correcta en lo demás.
- **Fix**: misma corrección de B0 en Fase 1; añadir verificación de `:3001`.

### 🟡 B5 — El prompt de una línea es insuficiente para una IA sin contexto
- **Evidencia**: `Landing.tsx:424-426` → "Clone …, install dependencies, set up Supabase, and
  launch the dev server. Follow the README for configuration." Combinado con B0-B3, una IA
  fresca no puede: no hay README, "the dev server" es singular (pierde el api), y "set up
  Supabase" no dice cómo (el detalle real está en INSTALL.md, que el prompt no menciona).
- **Fix**: el prompt debe apuntar a `INSTALL.md` explícitamente ("clone y sigue INSTALL.md
  paso a paso") en vez de a un README fantasma.

---

## Diff mínimo para poner el recorrido en verde

1. **`package.json`**: agregar `"dev:all"` (arriba). Dependencia: `concurrently` (devDep) o
   `scripts/dev.mjs` con `child_process` (cero deps).
2. **`README.md`** (nuevo): quickstart con `dev:all` + enlaces.
3. **`Landing.tsx`**:
   - `:424-426` prompt → "Clone https://github.com/reno42/design y sigue INSTALL.md."
   - `:447-449` paso 3 → `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`; quitar "auto-initialize";
     `VITE_*` como opcional (realtime).
4. **`INSTALL.md`**: Fase 1 usa `npm run dev:all`; checkpoint verifica `:3001/api/health`.
5. (Opcional, cierra B3 de verdad) **`scripts/setup-supabase.mjs`** que corra el SQL vía PAT.

---

## Camino feliz una vez aplicado el diff (el que Qoder debe dejar funcionando)

```
git clone https://github.com/reno42/design && cd design
npm install
cp .env.example .env            # modo memoria: sirve para probar YA
npm run dev:all                 # vite :5173 + api :3001  ← el fix de B0
# → editor vivo en http://localhost:5173, todo en memoria, CERO cuentas
#   (checkpoint: crear workspace + template funciona)

# persistencia (2º momento humano — única credencial):
#   crear proyecto Supabase, correr supabase_schema_complete.sql, llenar .env, reiniciar
node scripts/agent-design.mjs deck deck.json   # deck creado vía MCP → link del editor
```

---

## Estado de validación

| Hallazgo | Método | Estado |
|---|---|---|
| B0 api server obligatorio | inspección + prueba en vivo (`:3001` abajo → dashboard muerto) | ✅ confirmado |
| B1 README ausente | inspección (`ls README.md` ausente; `Landing.tsx:426`) | ✅ confirmado |
| B2 env vars equivocadas | inspección (`Landing.tsx:448` vs `supabase.ts:39`) | ✅ confirmado |
| B3 auto-init falso | inspección (`Landing.tsx:447` vs `supabase.ts:38`) | ✅ confirmado |
| B4 INSTALL omite api | inspección (`INSTALL.md:35,157`) | ✅ confirmado |
| B5 prompt insuficiente | inspección (`Landing.tsx:424`) | ✅ confirmado |
| Clon fresco end-to-end en carpeta temporal | ejecución real en `%TEMP%/futuraria-fresh` | ⏳ pendiente (correr tras aplicar el diff, para confirmar el camino feliz completo) |

*La ejecución real del clon fresco se hará una vez el diff esté aplicado en una rama, para
confirmar el camino feliz completo de punta a punta; los 6 bloqueadores ya están probados y
son accionables sin esperar a esa corrida.*
