# REQ-055 — Motion: render y export de entrega (MP4 frame-perfect, video_render async, paridad golden-frames)

Fecha: 2026-10-23 · Estado: **en curso — F1 implementada en `src/lib/videoExport.ts` (commit 40bff1f: WebCodecs avc1+AAC→MP4Muxer con fallback MediaRecorder MP4 y WebM; falta la verificación browser de aceptación). F2 lógica implementada (2026-10-25): `shared/renderTickets.ts` + `supabase_migrations_v83.sql`. F3 con base implementada (ver REQ-056/057). Tools MCP y cliente de claim = shims documentados** · Prioridad: P1 · Esfuerzo: M · Origen: REQ-050 fase 1 dejó export WebM desde el editor; el flujo IA-genera→humano-edita necesita un entregable social (MP4) y un render consultable por MCP. Coordinado con REQ-046 Fase 5 (comparte encoder) y con la auditoría del arnés motion.

## 1. Problema

1. El standalone exportaba solo WebM; hoy `videoExport.ts` ya tiene la ruta MP4 (ver §7 F1). `probeExportSupport` ya pre-chequea la ruta.
2. `video_render` responde `RENDER_PENDING` sin camino: un Worker no puede renderizar video (sin Chromium/FFmpeg en edge — decisión de arquitectura vigente).
3. La paridad preview/export del subconjunto motion no tiene suite golden: cada capacidad nueva (REQ-053) se suma sin red.

## 2. Alcance por fases

### F1 — Export MP4 H.264 frame-perfect (P1, esf S/M)
- Nueva ruta de encoder: WebCodecs `avc1` + AAC → `mp4-muxer` (~15 KB, chunk lazy) cuando `isConfigSupported` la habilita; WebM queda como fallback y para alpha (vp9). Mismo módulo/sampler que REQ-046 F5 — una sola implementación, dos consumidores (Video Mode y standalone).
- Timestamps exactos por frame (N frames solicitados = N samples), audio mixeado por OfflineAudioContext igual que hoy.
- Aceptación: Chrome produce .mp4 con duración/resolución/pistas esperadas y audio sincronizado ±1 frame en 60 s; Safari sin soporte cae a WebM sin regresión; `probeExportSupport` reporta la ruta elegida antes de empezar.

### F2 — `video_render` async por tickets (P1, esf M)
Sin render server-side (imposible en edge), el render es un **ticket que ejecuta el navegador de la propia cuenta**:
1. `video_render { projectId }` crea ticket `queued` y devuelve `{ ticketId, state }`.
2. Cualquier sesión del editor abierta por la cuenta reclama el ticket más viejo (claim atómico con `state: running, claimedBy, claimedAt`), renderiza client-side con el core compartido (F1) y sube el resultado a Storage.
3. El ticket pasa a `completed` con URL verificable, o `failed` con el error accionable (codec no soportado, medio inaccesible). Timeout de claim: si `claimedAt` expira sin completar, el ticket vuelve a `queued`.
4. `video_render_status { ticketId }` consulta estado/progreso/URL. Idempotente: reclamar dos veces no duplica.
- Persistencia: tabla de tickets — UNA migración nueva posterior a `v82`, coordinada con la sesión activa de motion.
- Aceptación: MCP pide render → el editor abierto de la misma cuenta lo completa → `video_render_status` devuelve URL que descarga un MP4 válido; sin sesión abierta el ticket queda `queued` con mensaje claro (no un render fantasma).

### F3 — Suite de paridad golden-frames para motion (P1, esf S)
- Fixture único por capacidad del subconjunto (texto+keyframes, filtro, tipografía, audio, y las nuevas de REQ-053): el runner samplea el estado en `t` de control (inicio/medio/fin de cada clip y de cada keyframe ±1 frame) vía `sampleAnimationAt` (la MISMA función que usa el export) y compara contra valores golden versionados.
- El export real se compara en duración/pistas y en los frames rasterizados de los mismos `t` (tolerancia documentada por codec).
- Aceptación: toda capacidad que entre al subconjunto (REQ-053) exige su fixture verde antes de mergear; un cambio que mueva un golden falla el suite con el diff exacto.
- Base implementada en este REQ: `QA/motion-parity-golden.test.mjs` fija los primeros goldens sobre `sampleAnimationAt` para presets y mapeos Lottie (ver REQ-056/057).

## 3. Decisiones de diseño
- MP4 no reemplaza WebM: se elige por soporte y por pedido (alpha ⇒ WebM/vp9). El mensaje de UI nombra el formato real elegido.
- El ticket de render es de la cuenta, no del proyecto: evita colas cruzadas entre workspaces en multi-tenant y simplifica el claim atómico.
- Sin secretos en tickets ni URLs firmadas en logs (misma regla del resto del arnés).

## 4. Fuera de alcance
- Render server-side, cola con hardware encode, ProRes/HEVC (web no los tiene sin WASM masivo — igual que REQ-046 §8).
- Reanudar un render interrumpido a mitad de encode (se reinicia; el encode es <minutos para los formatos social).

## 5. Análisis de escalabilidad y fallos
- El encode corre en el navegador del usuario: el plan freemium no paga CPU por render; el límite real es batería/ancho de banda del cliente, por eso `probeExportSupport` + duraciones documentadas ANTES de empezar.
- Tickets: volumen bajo (uno por pedido de render); el claim atómico es una UPDATE condicionada por estado — sin contention real incluso con 10 sesiones abiertas.
- Fallo abierto: si Storage falla al subir, el ticket queda `failed` con el error y el archivo local sigue disponible para descarga manual desde el editor.
- Riesgo de deriva MP4/WebM: mitigado porque los dos caminos consumen el mismo sampler; el suite F3 falla si un camino cambia sin el otro.

## 6. QA requerido
- Unit: muxer config (codecs/size/duración), ticket FSM (queued→running→completed/failed/timeout).
- Integración: claim concurrente (2 sesiones, un ticket) → exactamente un completado.
- E2E: render pedido por MCP → completado por sesión del editor → archivo válido verificado por firma (ftyp) y duración.
- Paridad: F3 en verde para TODO el subconjunto vigente.

## 7. Implementación (2026-10-25)

- **F1 — ya viva en `src/lib/videoExport.ts` (commit 40bff1f)**: ruta WebCodecs `avc1.640028/4D0028/42E028` + AAC `mp4a.40.2` → `MP4Muxer` local; fallback MediaRecorder con mime MP4 cuando AAC no es encodable; WebM queda para alpha/soporte. `probeExportSupport()` reporta `{ kind: "webcodecs", codec, aac } | { kind: "mediarecorder" }` antes de empezar. **Pendiente**: la aceptación browser (Chrome .mp4 con duración/pistas esperadas, audio ±1 frame en 60 s; Safari cae a WebM) — no reproducible en node, se verifica con harness de navegador.
- **F2 — lógica implementada**: `shared/renderTickets.ts` — FSM pura `queued→running→completed|failed` espejo exacto del RPC: claim con expiración de 10 min (`CLAIM_TIMEOUT_MS`), guards `SESSION_REQUIRED/NOT_CLAIMABLE/NOT_CLAIM_OWNER/ALREADY_COMPLETED/ALREADY_FAILED/RESULT_REQUIRED/NOT_EXPIRED`, `requeueTicket` explícito. `supabase_migrations_v83.sql` (posterior a v82, migración nueva sin tocar las en vuelo): tabla `musa_video_render_tickets` con alcance por WORKSPACE (decisión §3), CHECKs de `state`/`format`/`attempts`/prefijo `vrt_`, invariantes `running_needs_claim` y `completed_needs_result`, RLS viewer/editor vía `has_workspace_role`, índice de claim `(workspace_id, state, created_at)`, RPCs SECURITY DEFINER: `musa_claim_render_ticket` (`FOR UPDATE SKIP LOCKED` + expiración `INTERVAL '10 minutes'` + `P0001 RENDER_TICKET_NONE`), `musa_complete_render_ticket` / `musa_fail_render_ticket` con guard de dueño (`P0001 RENDER_TICKET_NOT_OWNER`), GRANT a `authenticated` + `service_role`.
- **QA**: `QA/render-tickets.test.mjs` (7 tests — ciclo feliz, doble claim, guards de dueño, expiración/robo/requeue, criterio idéntico al RPC) — verdes; `tsc --noEmit` limpio.
- **Shims pendientes** (archivos en sesión concurrente): tools MCP `video_render` / `video_render_status` en `mcp.mjs` (crea ticket, consulta estado) y el cliente del editor que reclama tickets abiertos y sube el resultado a Storage (`VideoProjectEditor.tsx`).
