# REQ-058 — Take Studio: tomas del humano con teleprompter invisible, TTL 24 h y descarga como insumo local

Fecha: 2026-10-25 · Estado: **implementado — lógica+UI+server en archivos libres; falta wiring del handler (2 líneas, archivo en sesión concurrente), migración v84 (manual) y setup R2 (manual)** · Prioridad: P1 · Esfuerzo: M · Origen: crear contenido para redes exige grabarse; el flujo pedido es grabar multi-toma con teleprompter que solo ve el presentador, guardar el video 24 h y que el usuario lo DESCARGUE para usarlo como insumo en su máquina (ediciones, HeyGen BYOK futuro, etc.).

## 1. Problema

1. No hay forma de grabarse dentro del producto: el humano graba con herramientas externas y pierde el guion de vista.
2. Los videos crudos no tienen hogar: Supabase Storage free rompe a 1 GB (límite duro del plan) y no hay carril pesado.
3. Sin política de retención, "guardar todo" llena cualquier bucket free: se necesita un contrato honesto — las tomas son INSUMO (material de trabajo), no archivo.

## 2. Alcance (implementado)

### Grabación (Take Studio)
- Multi-toma: cada "Grabar" produce una toma independiente; tope duro de **3 minutos** con auto-stop y countdown en el HUD.
- Dispositivos: selección de cámara/micrófono, on/off de audio, cuenta regresiva previa (0/3/5 s), pausa/reanudar.
- **Teleprompter invisible**: overlay DOM sobre el preview con script, velocidad (px/s), tamaño y espejo. La captura es `getUserMedia` (cámara/mic) — el prompter JAMÁS entra al stream (nunca `getDisplayMedia` de la misma pestaña).
- Al detener, la luz de la cámara se apaga (tracks liberados) y se re-arma el preview para la toma siguiente.

### Storage con TTL de 24 h (R2, carril pesado)
- Bytes en **Cloudflare R2** vía el endpoint S3-compatible con **presign SigV4 por query** (`worker/runtime/functions/r2-presign.mjs`) — sin binding (los handlers standalone no reciben `env`; solo secretos por `process.env`), sin cambios en `wrangler.toml`.
- Metadata en Supabase (`musa_video_takes`, migración **v84**): estado FSM `uploading→ready→purged`, cupo blando de **8 GB vivos** (de los 10 GB free de R2, dejando holgura) verificado en el RPC `musa_register_video_take` (rechaza `P0001 TAKE_QUOTA_EXCEEDED`).
- **Aviso explícito en la UI**: banner ámbar "Las tomas se almacenan máximo 24 horas y luego se borran automáticamente. Descargá las que quieras conservar". Cada fila muestra countdown ("Se borra en 23 h 05 min") y el botón **Descargar** es la acción primaria.
- Expiración **LAZY**: el listado filtra `expires_at > NOW()` y la descarga rechaza vencidas — la promesa de 24 h se cumple aunque la purga física no haya corrido.
- Descarga: URL firmada GET (5 min) → el navegador baja el archivo como `toma-YYYYMMDD-HHMMSS.webm|mp4`. Badge "descargada" al primer download.

### Sin cronjobs (decisión explícita)
- La purga física es un **barrido manual de fin de semana**: `node scripts/purge-expired-takes.mjs [--dry-run]` — lista vencidas, borra objetos en R2 y marca `state='purged'` (tumba de auditoría). Incluye zombies `uploading` cuyo PUT nunca llegó (DELETE 404-tolerado).
- El mismo módulo SigV4 sirve al handler y al sweep — una sola implementación de firma.

### Modo local (degradación honesta)
- Si el server no tiene el módulo montado (404) o el storage no está configurado (`TAKE_STORAGE_NOT_CONFIGURED`), el estudio sigue funcionando en **modo local**: la toma vive solo en la pestaña con aviso claro y botón de descarga inmediato. Nunca se pierde una grabación por un backend apagado.

## 3. Decisiones de diseño
- **R2 presign por secretos, no binding**: `callHandler` no pasa `env` a los handlers standalone → binding inalcanzable. SigV4 query presign con `R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_TAKES_BUCKET` funciona idéntico en Workers y Node ≥18.
- **RLS + RPCs como única fuente de verdad**: el handler corre TODA la DB por un cliente Supabase acotado al JWT del caller — `auth.uid()` resuelve dentro de los RPC SECURITY DEFINER (cupo, rol editor, dueño del complete). El handler solo firma R2 y verifica objetos (HEAD antes de `ready` — sin tomas fantasma que ocupen cupo).
- **TTL calculado por el server**: `expires_at = NOW() + 24h` lo pone el RPC `musa_register_video_take`; el cliente jamás propone vencimientos.
- **Tomas ≠ renders**: ambos comparten el carril R2; el cupo cuenta solo tomas vivas. Los MP4 finales (REQ-055) tienen su propio ciclo de vida.

## 4. Fuera de alcance (esta fase)
- HeyGen BYOK (clon del humano) — patrón REQ-047, fase siguiente.
- Edición de tomas dentro del editor de video (insumo local: se importan por URL/archivo como materiales).
- Borrado masivo, retención por workspace, transcodificación.

## 5. Análisis de escalabilidad y fallos
- R2 free: 10 GB-mes + **egreso gratis** — la descarga masiva de insumos no cuesta transferencia. Estado estable con uso diario ~3.8 GB (tomas + renders, con barrido semanal).
- PUT directo navegador→R2: el Worker nunca media bytes; solo firma (payload chico, sin I/O de video) y verifica (HEAD). Sin timeouts de body.
- Fallos: cupo lleno → 409 con mensaje accionable ("descargá y esperá el barrido"); PUT fallido → `TAKE_NOT_UPLOADED` y la fila nunca pasa a `ready`; R2 caído en DELETE → 502 y la fila NO se marca purged (sin bytes huérfanos sin rastro).
- Riesgo: que el sweep no corra nunca → el cupo se llena con vencidas lazily-invisibles; el RPC cuenta solo `expires_at > NOW()`, así que el usuario no se bloquea por bytes ya vencidos.

## 6. QA requerido
- Unit (`QA/take-ttl.test.mjs`): TTL/quota/estados derivados/countdowns/formatos + selección de mime y cronómetro del recorder.
- RPC: cupo exacto (límite ±1 byte), rol viewer rechazado, complete doble idempotente, dueño incorrecto rechazado.
- E2E browser: grabar 10 s → subir → descargar → archivo reproducible; vencer una toma (UPDATE manual de `expires_at`) → desaparece de lista y descarga 410.

## 7. Implementación
- `shared/takeTtl.ts` — lógica pura: `TAKE_TTL_MS` (24 h), `TAKES_SOFT_QUOTA_BYTES` (8 GB), `takeStatus` (derivado, nunca persistido "expired"), `humanRemaining`, `canUploadTake`, `canDownloadTake`, `computeExpiresAtMs`, `takeFilename`, `humanBytes`.
- `supabase_migrations_v84.sql` — tabla `musa_video_takes` (+CHECKs, índices de listado y sweep parcial, RLS viewer/editor), RPCs `musa_register_video_take` (rol editor + cupo vivo + TTL server-side, `P0001 TAKE_QUOTA_EXCEEDED`) y `musa_complete_video_take` (dueño + estado `uploading`, `P0001 TAKE_NOT_OPEN`).
- `worker/runtime/functions/r2-presign.mjs` — SigV4 query presign (PUT/GET/HEAD/DELETE, región `auto`, `UNSIGNED-PAYLOAD`, host-only) + `headR2Object`/`deleteR2Object`.
- `worker/runtime/functions/video-takes.mjs` — endpoints `GET list` / `POST sign` / `POST complete` / `GET :id/download` / `DELETE :id`; cliente DB acotado al JWT; errores de RPC mapeados a 400/403/409/410.
- `scripts/purge-expired-takes.mjs` — barrido manual (`--dry-run`), REST crudo PostgREST (claves `sb_secret_` no pasan por el SDK), secretos de shell o `.env.design-supabase`.
- `src/lib/takeRecorder.ts` — `pickRecorderMime` (VP9→VP8→WebM→MP4), `TakeRecorder` (timeslice, techo 3 min, pausa, abort, apagado de tracks), `uploadTake` (XHR con progreso, PUT desnudo).
- `src/components/video/TakeStudio.tsx` — estudio completo: aviso 24 h, preview+HUD, prompter overlay (rAF px/s, espejo), dispositivos, countdown, tomas server (countdown+Descargar+Borrar) y tomas locales (fallback).
- Montaje: `Dashboard.tsx` agrega sub-pane `takes` al tab Video; `VideoProjectsTab` rutea `pane === "takes"` → `<TakeStudio>` (wrapper sin hooks para respetar rules of hooks).
- **MCP (2026-10-25)**: `video_takes_list` / `video_takes_download` / `video_takes_delete` en `mcp.mjs` + implementación en `worker/runtime/functions/video-takes-mcp.mjs`. El agente NO graba: supervisa material vivo (cupo + countdowns), consigue URLs firmadas para el humano y borra con orden explícita. Schemas LITERALES en `MCP_TOOLS` (sync-skill-tools los parsea del array — un spread sería invisible para el catálogo). Gates: list/download viewer (prefijo read + `MCP_READ_METHODS`), delete editor; el tenant de delete se resuelve en DB contra `musa_video_takes` (una workspace_key no cruza tenants por takeId adivinable). Toda salida repite la política de 24 h — el agente es otro canal del aviso. Catálogo regenerado: 441 tools (prod 438 pre-deploy).

## 8. Setup del server (manual, una vez) — COMPLETO 2026-10-25

Ejecutado vía agente externo con acceso a la cuenta CF (bucket `video-takes`, ENAM/automática; token S3 scope solo ese bucket; 4 secrets en el worker `design-futuraria`; CORS guardada). **Probe E2E con el presigner del worker** (misma ruta de código, host global): PUT 200 / GET 200 contenido exacto / DELETE 204; preflight CORS 204 con `allow-origin: *`, `PUT, GET`. El hallazgo del probe: la cadena de derivación SigV4 exige BYTES CRUDOS en cada etapa (`importKey` con hex-string/TextDecoder produce `SignatureDoesNotMatch`; `keyUsages` como string lanza TypeError en Node 24 y runtimes spec-correctos) — corregido y verificado.

1. **Bucket R2**: Dashboard de Cloudflare → R2 → Create bucket (p.ej. `video-takes`). Con tarjeta registrada no hay cargo bajo 10 GB. **(hecho)**
2. **API token R2** (S3): R2 → Manage R2 API Tokens → create con Object Read & Write sobre ese bucket → anotar Access Key ID / Secret Access Key / Account ID. **(hecho, sin expiración)**
3. **Secrets del Worker**: `wrangler secret put R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TAKES_BUCKET` (y en `.env` local / `.env.design-supabase` para el sweep). **(hecho en el worker; el sweep lee `.env.r2` local del usuario)**
4. **CORS del bucket** (para el PUT/GET desde el navegador):
   ```json
   [{ "AllowedOrigins": ["*"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
   **(hecha — el readback nativo de R2 muestra `origins: [""]`; el preflight real responde `allow-origin: *`, formato interno equivalente)**
5. **Migración v84**: ejecutar `supabase_migrations_v84.sql` en el SQL Editor (flujo manual vigente). **(hecha, aplicada con success)**
6. **Wiring del handler** (2 líneas en `worker/index.js` — archivo en sesión concurrente, el shim queda documentado):
   ```js
   import { handler as videoTakesHandler } from "./runtime/functions/video-takes.mjs";
   // en el array routes: { pattern: /^\/api\/video-takes(\/|$)/, handler: videoTakesHandler },
   ```
   **(pendiente — único ítem abierto, cuando cierre la sesión concurrente)**
7. **Barrido de fin de semana**: `node scripts/purge-expired-takes.mjs --dry-run` para ver, sin flag para purgar.
