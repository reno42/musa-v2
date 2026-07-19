# Verificación EN VIVO — Capa MCP en producción (2026-07-19)

- **Endpoint**: `https://design.futuraria.com/mcp` (JSON-RPC 2.0), también `/api` y `/render`.
- **Método**: scripts Node en este directorio (`s00`…`s99`), patrón de llamada tomado de `test_mcp.mjs` y `QA/healthcheck_mcp.mjs` (initialize → tools/call, parseo de `result.content[0].text`). Pacing de ~350 ms entre requests (máx ~3 req/s, muy por debajo del rate limit de 200 req/ventana).
- **Auth**: el repo **no tiene `.env`** (solo `.env.example`); no hay `API_KEY` ni `MCP_ADMIN_KEY` disponibles localmente. Los scripts leen vía dotenv y reportan `{API_KEY_present:false, MCP_ADMIN_KEY_present:false}`. Los ítems que requerían admin key se probaron sin key — y resultó que prod los permite igual (ver ítem 1).
- **Higiene**: solo se crearon templates `verify-b-*`; todos borrados. `list_templates(search="verify-b")` final → **0 restantes** (evidencia `99-cleanup.json`). No se tocó ningún objeto del usuario (solo se usó el `workspaceId` del primer workspace existente, en modo lectura).

## Tabla de resultados

| # | Ítem | Estado | Resultado |
|---|------|--------|-----------|
| 1 | AUTH-NOKEY | **VERIFICADO (hallazgo grave)** | 200 sin key → accept-all; `MCP_ADMIN_KEY` no está definida en prod |
| 2 | CRYPTO-BUG | **VERIFICADO** | `create_api_key` → `-32000 "crypto.createHash is not a function"` |
| 2b | Keys no-admin siempre 401 | NO VERIFICABLE | No se pudo crear ninguna key (por el mismo bug) para probarla |
| 3 | CRLF | **REFUTADO** | `create_template` con `\r\n` en css funciona (200); css se guarda con CR+LF |
| 4 | UPDATE-NOOP | **VERIFICADO** | `html`/`css` top-level no llegan a `frames[0]` (no-op silencioso 200); `frames[]` sí escribe |
| 5 | EXPORT-EMPTY | **VERIFICADO** | `export_template` devuelve solo metadata (425 bytes), sin frames/html/css |
| 6 | FRAME-IDS | **VERIFICADO** | frames guardados SIN `id` (0/2 con id) |
| 7 | STUBS | **VERIFICADO** (8/9 éxito falso; 1/9 no configurado) | Respuestas mock/estáticas; `ai_generate_image` falla por `OPENROUTER_API_KEY` ausente |
| 8 | RENDER | **VERIFICADO** | No hay PNG binario; `_links` a página HTML con html2canvas client-side |
| 9 | VERSIONS | **MIXTO** | Hay versiones; restore por `versionId` funciona pero restaura estado POST-mutación; restore con `version` numérico → error |
| 10 | COLD-DELETE | **REFUTADO-en-esta-corrida** | `delete_template` devolvió 200 tras ~5 min |
| 11 | PAYLOAD-LIMIT | **VERIFICADO (opaco)** | 6MB → HTTP 500 opaco de plataforma; el 413/-32000 limpio es inalcanzable |

---

## Detalle por ítem (con evidencia raw truncada)

### 1. AUTH-NOKEY — VERIFICADO (hallazgo grave)

`tools/call list_workspaces` **sin** header `x-api-key` → **HTTP 200** con la lista completa de workspaces.

```json
// evidence/01-auth-nokey.json
{ "httpStatus": 200, "rpcError": null,
  "textTruncated": "{\n  \"data\": [ ... workspaces del usuario ... ]" }
```

Además, en setup se crearon templates (`create_template`) sin ninguna key → 200.
→ `MCP_ADMIN_KEY` **no está definida en producción**: el gate `checkAuth` está en modo dev (accept-all, `isAdmin:true` para cualquiera). **Cualquier cliente anónimo puede leer/crear/modificar/borrar templates y llamar tools admin.** Grave.

### 2. CRYPTO-BUG — VERIFICADO

`create_api_key` (alcanzable sin key gracias al accept-all; en dev-mode `isAdmin=true` pasa el gate de admin tools) → **HTTP 200 con error JSON-RPC**:

```json
// evidence/02-crypto-bug.json
{ "httpStatus": 200,
  "rpcError": { "code": -32000, "message": "crypto.createHash is not a function" } }
```

Confirma el análisis estático: `mcp.mjs` usa `crypto.createHash` (línea 2563) sin `import node:crypto`; en ESM el global `crypto` es WebCrypto (sin `createHash`) → TypeError.
Consecuencias: **ninguna API key puede crearse**; y como `validateApiKey` usa el mismo `keyHash`, ninguna key de la tabla `api_keys` podría validarse (fail-closed) si algún día se define `MCP_ADMIN_KEY`.

- **2b NO VERIFICABLE**: la afirmación "keys no-admin siempre 401" no pudo probarse porque no existe forma de crear una key (el bug lo impide). Es además moot mientras prod esté en accept-all. No quedó nada que revocar (la excepción ocurre antes del insert).

### 3. CRLF — REFUTADO

```json
// evidence/03-crlf.json
{ "crlf":  { "httpStatus": 200, "rpcError": null },   // id=tpl_67915687-68d
  "lf":    { "httpStatus": 200, "rpcError": null },   // id=tpl_746f39c4-56a
  "crlf_stored_css": { "hasCR": true, "hasLF": true } }
```

`create_template` con css conteniendo `\r\n` → **200 OK**; el css se almacena con CR+LF intactos. No reproduce el error `css2.match is not a function`. Ambos templates de prueba borrados en el mismo script.

### 4. UPDATE-NOOP — VERIFICADO

`update_template {id, html:'<div>MARCADOR-NOOP-123</div>', css:'.x{color:red}'}` a nivel top → **HTTP 200 sin error**, pero:

```json
// evidence/04-update-noop.json
{ "after_toplevel": {
    "marker_in_frames0_html": false,     // ← NO está en frames[0].html
    "marker_in_toplevel_html": true,     // ← solo quedó en tpl.html (raíz, no se usa para render)
    "frame0html": "<div class='box'>CONTENIDO-INICIAL-NOOP</div>" },
  "after_frames": { "marker_via_frames": true } }   // ruta frames[] SÍ escribe
```

El update top-level escribe `tpl.html`/`tpl.css` en la raíz del documento pero **nunca se aplica a `frames[0]`**: no-op silencioso con 200 para el consumidor del frame. La ruta `frames[]` completa sí persiste.

### 5. EXPORT-EMPTY — VERIFICADO

```json
// evidence/05-export-empty.json — 425 bytes totales para un template CON frames y contenido
{ "format": "futuraria/v1", "exportedAt": "2026-07-19T…",
  "template": { "name": "verify-b-noop", "width": 800, "height": 600,
                "variables": {…}, "metadata": {…} } }
// keys: ["format","exportedAt","template"]; template keys: ["name","width","height","variables","metadata"]
```

Sin `frames`, `html` ni `css`: el "backup/migración" `.futuraria` **no contiene el diseño** (425 bytes; la afirmación decía ~438 — mismo orden).

### 6. FRAME-IDS — VERIFICADO

`update_template` con 2 frames sin campo `id` → 200; `get_template`:

```json
// evidence/06-frame-ids.json
{ "frames_after": [
  { "id": null, "name": "SinID-1", "hasHtml": true },
  { "id": null, "name": "SinID-2", "hasHtml": true } ] }
```

El servidor **no asigna ids** a los frames recibidos sin id. Efecto dominó observado en el ítem 7: `export_pdf` generó URLs con `/undefined` como frameId.

### 7. STUBS (éxitos falsos) — VERIFICADO

Respuestas raw (evidence/07-stubs.json):

| Tool | Respuesta (truncada) | Veredicto |
|------|----------------------|-----------|
| `enhance_template` | `{"success": true, "templateId": "tpl_91514170-0a1", "instruction": "Hazlo mas moderno"}` | Eco sin efecto (no toca el template) |
| `preview_font` | `{"created": true, "fontFamily": "Inter", "pangram": "The quick brown fox…", "note": "Font preview loaded…"}` | `created:true` sin crear nada |
| `optimize_image` | `{"optimizedUrl": "https://example.com/pic.png", "originalBytes": 0, "optimizedBytes": 0, "reduction": "0%", "_note": "Optimization requires Sharp or external service"}` | Devuelve la misma URL, 0 bytes |
| `search_stock_image` | `{"results": []}` | Siempre vacío |
| `ai_generate_image` | RPC `-32000: "OPENROUTER_API_KEY not configured."` | No éxito falso: feature **no configurada** en prod |
| `export_pdf` | `{"exported": 2, …, "pages": [{"frameName": "SinID-1", "url": "https://futuraria.app/render/tpl_91514170-0a1/undefined?format=pdf…"` | URLs mock: dominio `futuraria.app` (≠ prod) y frameId **`undefined`** (por ítem 6); no genera PDF |
| `get_font_details` | `{"family": "Zxyq Notarealfont", "category": "sans-serif", "variants": ["400","700"], "subsets": ["latin"], …}` | Datos **fijos** para una fuente inexistente |
| `subscribe_template` | `{"channelId": "template:tpl_91514170-0a1:changes", "endpoint": "Supabase Realtime"}` | Estático; sin suscripción real |
| `broadcast_section_change` | `{"broadcast": true, "channelId": "…", "sectionId": "sec1"}` | `broadcast:true` sin canal real |

8/9 devuelven éxito falso/estático; `ai_generate_image` directamente no funciona en prod (env var ausente).

### 8. RENDER — VERIFICADO

`render_batch` → solo JSON con `_links` (sin binario):

```json
{ "results": [{ "templateId": "tpl_91514170-0a1", "status": "ready",
  "_links": { "render": "/api/templates/tpl_91514170-0a1/render", "view": "/api/render/tpl_91514170-0a1" },
  "renderParams": { "format": "png", "scale": 1, "width": 800, "height": 600 } }] }
```

Siguiendo los links (evidence/08-render.json):
- `GET /api/templates/:id/render` → **400** `{"error":"POST /api/templates/:id/render to render"}` (application/json, 52 bytes).
- `POST /api/templates/:id/render` → **200** application/json: campo `html` con una página completa que carga `html2canvas@1.4.1` desde CDN jsdelivr (toolbar + auto-render en el navegador). **Render client-side confirmado.**
- `GET/POST /api/render/:id` → 400 / 404 (`{"error":"Template not found","templateId":"api"}` — la ruta matchea mal).

→ **No existe PNG binario server-side por ninguna vía**; lo que se entrega es una página HTML que renderiza en el cliente.

### 9. VERSIONS — MIXTO

Sobre `verify-b-ver` (create + 2 updates vía `frames[]`, evidence/09-versions.json):

- `list_versions` → **3 versiones** (`snap_*`, labels `ia · create_template/update_template`). Hay versiones (en memoria de la instancia que atendió las llamadas).
- `restore_version {versionId: "snap_f9bff3f4-0b6"}` → **200 `{"restored": true, …}`** → **REFUTA** el error "Version has no canvas data". Matiz: el snapshot restaurado contiene `<div>V3</div>` — se toma **después** de la mutación (`autoSnapshot` se llama post-`updateTemplate`), así que "restaurar" devuelve el estado posterior a la última mutación, no uno previo.
- `restore_version {version: 1}` (numérico, lo que envía el panel UI) → **`-32000 "Version not found: undefined"`** → roto: el handler solo lee `params.versionId`; un `version` numérico se ignora y termina en ese error.

### 10. COLD-DELETE — REFUTADO-en-esta-corrida

`verify-b-cold` creado en s00 (10:07:54Z) y borrado en s99 (~10:12:47Z, ~5 min después, decenas de requests de por medio):

```json
// evidence/99-cleanup.json
{ "cold_delete": { "httpStatus": 200, "rpcError": null,
  "textTruncated": "{\n  \"deleted\": true,\n  \"id\": \"tpl_9c1f895d-a79\"\n}" } }
```

`delete_template` devolvió 200. El 404 por instancia fría **no se reprodujo en esta corrida** (no prueba que nunca pase; depende del routing entre instancias Netlify).

### 11. PAYLOAD-LIMIT — VERIFICADO (error opaco, no limpio)

Junk generado in-script (sin archivos del usuario):

| Body total | Resultado |
|------------|-----------|
| ~6.34 MB (html 6.00MB) | **HTTP 500** `text/plain`: `Internal Error. ID: 01KXWXQ2QKQQWSYKE7VZ1WAVS7` |
| ~5.35 MB | **HTTP 500** `text/plain`: `Internal Error. ID: 01KXWXR079W3EGGKX4BNRQNFJG` |
| ~4.54 MB | **HTTP 502** `Function.ResponseSizeTooLarge` ("Response payload size exceeded maximum allowed payload size (6291556 bytes)") — y el template **quedó persistido** (`verify-b-payload3`, tpl_8708807b-d8b; barrido y borrado en cleanup) |

→ El 413 + `-32000` "Payload exceeds 5 MB limit" del handler (`validatePayloadSize`) es **inalcanzable en prod**: la plataforma Netlify corta antes, de forma opaca (500 sin JSON-RPC). Bonus: a 4.5MB el request entra, el create **persiste** (el límite de 2MB/frame no se valida en `create_template`) y la respuesta explota por tamaño (502) porque el handler devuelve el template completo.

---

## Resumen

- **Afirmaciones del análisis estático VERIFICADAS en prod: 8 de 11** — (1) accept-all sin `MCP_ADMIN_KEY`, (2) crypto.createHash roto, (4) update top-level no-op, (5) export vacío, (6) frames sin id, (7) stubs de éxito falso, (8) render sin PNG binario (html2canvas client-side), (11) payload grande → error opaco.
- **REFUTADAS: 2** — (3) el bug CRLF `.match is not a function` no reproduce (create con `\r\n` funciona y persiste CR+LF), (10) cold-delete devolvió 200 en esta corrida (matiz: una sola corrida no prueba ausencia del problema).
- **MIXTA: 1** — (9) hay versiones y el restore por `versionId` funciona (refuta "Version has no canvas data") pero restaura estado post-mutación; el restore con `version` numérico (panel UI) está roto con `-32000 "Version not found: undefined"`.
- **NO VERIFICABLE: 1 sub-afirmación** — (2b) "keys no-admin siempre 401": no se pudo crear ninguna key para probarla (consecuencia del mismo bug crypto) y es moot bajo accept-all.

### Hallazgos adicionales de esta corrida

1. **Prod está abierto (crítico)**: sin `MCP_ADMIN_KEY`, cualquier anónimo tiene acceso total, incluidas tools admin. Aunque se defina `MCP_ADMIN_KEY`, el bug crypto haría fallar toda validación contra `api_keys` (solo funcionaría la admin key por comparación directa).
2. `export_pdf` apunta a `futuraria.app` (dominio que no es el de prod) y con frameIds `undefined` si los frames no tienen id.
3. La validación de tamaño por frame (2MB HTML) no aplica en `create_template` (solo en `update_template`): un create de 4.5MB persiste.
4. Las respuestas del MCP devuelven el template completo; con frames grandes la respuesta supera el límite de 6MB de Netlify (502) aunque la escritura haya tenido éxito — escritura "fantasma" sin confirmación.
5. `POST /api/render/:id` (link `view` de render_batch) está roto: matchea `templateId:"api"` y devuelve 404.

### Limpieza

Cero objetos `verify-b-*` en el servidor, confirmado por `list_templates(search="verify-b")` → 0 restantes tras los borrados (incluido el huérfano `verify-b-payload3` del test 11). Evidencia: `evidence/99-cleanup.json`.
