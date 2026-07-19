# Verificación EN VIVO — Backend Express (instancia local aislada)

**Fecha:** 2026-07-19 · **Repo:** `C:/Users/Renzo/.openclaw/workspace/design-main` · **API:** `api/` (Express + tsx)

## Entorno de la instancia

- Comando de arranque (desde `api/`):
  ```bash
  PORT=3002 SUPABASE_URL= SUPABASE_KEY= SUPABASE_SERVICE_KEY= SUPABASE_ANON_KEY= \
  SUPABASE_PROJECT_URL_DE_REPO_DESIGN= SUPABASE_SECRET_KEY_DE_REPO_DESIGN= \
  VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= MCP_ADMIN_KEY= \
  ./node_modules/.bin/tsx src/server.ts
  ```
- El shell heredado tenía `SUPABASE_URL` y `SUPABASE_KEY` **seteados** → se vaciaron explícitamente junto con todas las variables fallback que lee `api/src/services/supabase.ts:42-45`.
- Puerto 3002 (libre; 3017 no fue necesario). Auth en modo dev (`MCP_ADMIN_KEY` vacío → accept-all); se usó `x-api-key: dev-key` por convención.
- Cada ítem usó un `X-Forwarded-For` distinto (`10.66.1.x`) para no compartir presupuesto de rate-limit entre pruebas.
- Comprobación de modo: `GET /api/health/storage` → `{"supabase":false,"mode":"memory","realtime":false}`; log del servidor: `[SUPABASE] Not configured — using in-memory storage`.
- Scripts y logs: este directorio (`01..05` + `server.log`). Todo desechable; nada salió de la instancia.

## Tabla de resultados

| # | Ítem | Estado | Evidencia (resumen) |
|---|------|--------|---------------------|
| 1 | PUT-BASE64-STRIP | **VERIFICADO** (con divergencia MCP confirmada) | PUT REST → `<img src="">`; MCP `update_template` → data-URI intacto |
| 2 | PAYLOAD-LIMIT-REST | **VERIFICADO** (límite 50MB; divergencia MCP 5MB confirmada) | 6MB→201; 60MB→413 `PayloadTooLargeError`; 6MB MCP→413 `Payload exceeds 5 MB limit` |
| 3 | RATE-LIMIT | **VERIFICADO** | 100 req pasan, #101→429; headers `X-RateLimit-*`, `Retry-After: 60` |
| 4 | VERSION-CAP | **VERIFICADO** | 12 PUTs→10 versiones (v1,v2 expulsadas); PUT de 210KB no crea snapshot pero sí aplica el cambio |
| 5 | RESTORE-REST | **REFUTADO para REST / VERIFICADO para MCP** | REST restore sí restaura html/css (`html` volvió a `"<div>v3</div>"`); MCP `restore_version` → error `Version has no canvas data` |
| 6 | SANITY | **VERIFICADO** | `mode:"memory"` durante toda la sesión; instancia matada (PID 8952), puerto 3002 libre |

---

## Ítem 1 — PUT-BASE64-STRIP (`01-base64-strip.mjs` / `.log`)

Template `tpl_7d741a5d-1e8` creado por REST con `<img src="data:image/png;base64,...">` (base64 de 5120 chars, generado con `crypto.randomBytes(3840)`).

**PUT REST** `PUT /api/templates/:id` con el data-URI en `html` y en `frames[0].html` → 200. Después `GET`:

```
top html: <div><img src="" alt="pixel"></div>
top html contiene "data:image"? false
frame[0].html: <section><img src="" alt="pixel"></section>
frame[0] contiene "data:image"? false
```

→ El PUT REST **destruye silenciosamente** el data-URI (regex de `api/src/routes/templates.ts:206-222`), tanto en `html` top-level como en frames. La imagen queda como `<img src="">` sin aviso al cliente (200 OK, sin warning).

**Misma operación vía MCP** (`POST /mcp`, `tools/call update_template` con el mismo html/frames) → 200, y `GET` posterior:

```
top html contiene "data:image"? true
frame[0] contiene "data:image"? true
frame[0] <img>: <img src="data:image/png;base64,Csiy4aBekiljHEi/FzNVBCZZakJrL9u8vcmaAPl/elx6yq0QwCkD6Jj992…[5166 chars]
```

→ **Divergencia MCP-vs-REST verificada**: el handler MCP (`netlify/functions/mcp.mjs:3010-3035`) no strippea base64; el dato sobrevive por esa vía.

**Observación extra:** el `POST /api/templates` (create) tampoco strippea — el `frame[0].html` tras el create conservaba el data-URI completo. Solo el PUT REST lo elimina.

## Ítem 2 — PAYLOAD-LIMIT-REST (`02-payload-limit.sh` / `.log`)

| Prueba | Resultado |
|--------|-----------|
| `POST /api/templates` body 6.291.556 bytes (~6MB) | **HTTP 201** (aceptado; `express.json({limit:"50mb"})`, `api/src/index.ts:35`) |
| `POST /api/templates` body 62.914.661 bytes (~60MB) | **HTTP 413**, `Content-Type: text/html`, cuerpo: `PayloadTooLargeError: request entity too large` + stack trace de `raw-body` |
| `POST /mcp` body 6.291.585 bytes (~6MB) | **HTTP 413**, JSON: `{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Payload exceeds 5 MB limit. Upload images separately via upload_image before embedding them in HTML."}}` |

→ **Divergencia de límites verificada**: REST acepta ~50MB (un payload de 6MB pasa); el MCP rechaza a partir de 5MB (`mcp.mjs:390`, `validatePayloadSize` → 413 JSON-RPC). El mismo body de 6MB: REST 201, MCP 413.

**Observación extra:** el 413 de Express devuelve HTML con stack trace que expone rutas absolutas del servidor (`C:\Users\...\node_modules\raw-body\index.js`) — fuga de información menor en el handler de errores por defecto.

## Ítem 3 — RATE-LIMIT (`03-rate-limit.mjs` / `.log`)

Burst de 250 `GET /api/health` secuenciales (182 ms totales) con IP fija:

```
conteo por status: {"200":100,"429":150}
request #1:   status=200  X-RateLimit-Limit=100, Remaining=99, Reset=1784455273
request #100: status=200  Remaining=0
request #101: status=429  Remaining=0, Retry-After=60
              body: {"success":false,"error":"Too many requests","retryAfter":60}
```

→ **N = 100** exactas por ventana de 60s por IP (`api/src/middleware/rateLimit.ts`: `MAX_REQUESTS=100`, `WINDOW_MS=60000`). Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (solo en el 429).

**Observación extra:** el limiter usa `req.headers["x-forwarded-for"]` sin validar (`rateLimit.ts:14`) → spoofeable trivialmente cambiando el header (así aislé los tests entre sí). El contador es en memoria: se reinicia al reiniciar el proceso y no escala a multi-instancia.

## Ítem 4 — VERSION-CAP (`04-version-cap.mjs` / `.log`)

Template `tpl_a6b71008-60a` (engine=html). 12 PUTs consecutivos (`html: "<div>vN</div>"`):

```
PUT #1..#10 → versions en respuesta: 1..10
PUT #11     → versions: 10
PUT #12     → versions: 10
GET /api/templates/:id/versions → total=10
  primera conservada: html="<div>v3</div>"   ← v1 y v2 expulsadas (slice(-9)+push)
  última conservada:  html="<div>v12</div>"
MCP list_versions → mismas 10 (legacy versions; store compartido)
```

PUT grande (`html.length=210011` > 200.000):

```
PUT grande → 200; versions en respuesta: 10; html almacenado length=210011
GET /versions tras PUT grande → total=10 (sin cambio; última sigue siendo v12)
template actual html.length=210011  ← el cambio SÍ se aplicó
```

→ **Verificado**: cap de 10 versiones por autosave REST y omisión del snapshot cuando `html+css > 200KB` (`templates.ts:237-259`). Efecto secundario real: los cambios grandes quedan **sin red de seguridad de versiones** (el dato anterior se pierde sin snapshot), exactamente el escenario donde más haría falta.

## Ítem 5 — RESTORE-REST (`05-restore.mjs` / `.log`)

Sobre las versiones del ítem 4 (canvas=null, html/css presentes):

```
[1] html actual: length=210011
[2] versión elegida: ver_3cd471a2-7ed  html="<div>v3</div>"  canvas=null
[3] POST /api/templates/:id/versions/ver_3cd471a2-7ed/restore → 200
    {"success":true,"data":{"message":"Version restored"}}
[4] html tras restore REST: "<div>v3</div>"   ← html restaurado a la versión: true
[5] MCP restore_version (misma versión) → 200 con error JSON-RPC:
    {"code":-32000,"message":"Version has no canvas data"}
```

→ **La afirmación del análisis es REFUTADA para la vía REST**: `api/src/routes/versions.ts:60-74` restaura `tpl.html`/`tpl.css` cuando existen en la versión — útil y funcional para templates engine=html.
→ **La afirmación es VERIFICADA para el tool MCP** `restore_version` (`mcp.mjs:3289-3318`): solo restaura `canvas`; como las versiones de templates HTML tienen `canvas:null`, falla con `Version has no canvas data`. (La rama de snapshots MCP —`store.getSnapshot`— no se ejercitó en vivo; por lectura de código restauraría igualmente solo `canvas`, también null en HTML.)

## Ítem 6 — SANITY

- `GET /api/health/storage` antes de apagar: `{"supabase":false,"mode":"memory","realtime":false}`.
- `server.log`: línea `[SUPABASE] Not configured — using in-memory storage` repetida en cada acceso — nunca se creó cliente Supabase.
- Ningún endpoint tocó red externa (todo Map en memoria; los templates creados mueren con el proceso).
- Apagado: TaskStop sobre la tarea del servidor + `taskkill //PID 8952 //F` (proceso `node ... tsx ... src/server.ts` propio). Verificación final: `netstat` sin listeners en 3002. No se tocó ningún proceso ajeno (5173/3001 no se usaron).

## Resumen de afirmaciones

| Afirmación del análisis estático | Veredicto en vivo |
|---|---|
| PUT REST elimina data-URIs base64 → `<img src="">` (destrucción silenciosa) | **VERIFICADO** — y además: el create y el MCP NO lo hacen (divergencia) |
| REST tiene límite de 50MB; MCP 5MB (divergencia) | **VERIFICADO** — 6MB: REST 201 / MCP 413; 60MB: REST 413 `PayloadTooLargeError` |
| Rate limit 100 req/min por IP en memoria | **VERIFICADO** — 429 exactamente desde la request #101, con headers y `Retry-After` |
| Snapshots en cada autosave, cap 10, omitidos si payload >200KB | **VERIFICADO** — 12 PUTs→10 versiones; PUT de 210KB aplicado sin snapshot |
| `restore_version` solo restaura canvas → falla/no-op en templates HTML | **MATIZADO**: VERIFICADO para el tool MCP (`Version has no canvas data`); REFUTADO para la ruta REST, que sí restaura html/css correctamente |
| Instancia en memoria pura, sin tocar producción | **VERIFICADO** — `mode:"memory"` toda la sesión; proceso propio eliminado |

## Observaciones secundarias (fuera de la lista, documentadas de paso)

1. El 413 de Express expone stack trace con rutas absolutas del servidor (fuga de info menor).
2. El rate-limiter confía en `X-Forwarded-For` sin validar → bypass trivial por spoofing de IP; además es por-proceso (no sirve multi-instancia).
3. El strip de base64 solo existe en PUT REST: crear por POST o guardar vía MCP deja data-URIs inline → el "502 prevention" que persigue el strip es esquivo según la vía de escritura.
4. Cambios >200KB no generan snapshot: el escenario de mayor riesgo queda sin historial de versiones.
