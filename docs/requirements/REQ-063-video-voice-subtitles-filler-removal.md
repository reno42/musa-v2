# REQ-063 — Voces IA (ElevenLabs), subtítulos y limpieza de muletillas

Fecha: 2026-10-26 · Estado: completado (local design-main; worker `/api/elevenlabs` requiere deploy CF para upstream real; migración v86 pendiente de ejecución manual)

## 1. Problema

Los videos de Musa no tienen voz ni subtítulos. Hoy agregar una locución exige
salir a ElevenLabs, descargar el MP3 y subirlo a mano; los subtítulos se
escriben clip por clip; y las muletillas ("eh", "este", "o sea") quedan en la
toma porque recortarlas a mano es inviable.

## 2. Decisiones tomadas (con el usuario)

- **Motor de transcripción: ElevenLabs Scribe** (misma BYOK que el TTS — un
  proveedor, dos capacidades, timestamps por palabra).
- **Limpieza de muletillas: estilo Descript** — saltos de corte (jump cuts)
  que quitan video + audio juntos, no solo el audio.
- **Ubicación de voces: editor de video Y Take Studio.**
- **Migraciones SQL: se entregan al usuario para ejecución manual** en el
  Supabase SQL Editor (convención del repo).

## 3. Arquitectura

- **Proxy** `/api/elevenlabs/*` (`worker/runtime/functions/elevenlabs.mjs`,
  clon del contrato de heygen.mjs): `status` (last4), `validate` (GET /v1/user),
  `voices` (GET /v1/voices), `models` (GET /v1/models, modelos TTS de la key),
  `tts` (POST /v1/text-to-speech/{voice_id}, MP3 binario base64), `stt`
  (POST /v1/speech-to-text multipart, Scribe words). La BYOK `elevenlabs` vive
  en `user_api_keys` — cero migración para la key.
- **Mappers puros** `shared/elevenlabsMappers.ts`: normalizers tolerantes +
  `elevenlabsErrorPayload` (códigos estables, misma familia que HeyGen) +
  `chunkScriptForTts` (frontera de oración, techo 5k chars por request).
- **Voz IA**: guion → voz (con preview) → MP3 → R2 vía `uploadReelAudio` →
  material+segment server-first (`/api/video-projects/:id/materials|segments`)
  en el track de audio. Guiones largos: chunks con `previous_text` para
  continuidad de prosodia. El catálogo de voces se **cachea en el cliente**
  (TTL 5 min + dedupe de llamadas en vuelo, `listElevenlabsVoices`) porque
  VoiceTab y TakeStudioVoice se montan independiente; el botón "Recargar voces"
  fuerza un refresco. Los modelos salen de `/v1/models` fusionados con los
  curados (el default nunca desaparece si el upstream falla).
- **Subtítulos**: cues = materiales `text` server-first con
  `payload.caption = true` y `payload.style` (preset inferior-centrado),
  sobre un track de texto. Import/export SRT/VTT con `shared/srtVtt.ts`.
- **Auto-transcripción**: audio del timeline → WAV mono cliente → chunks
  ≤15 min → `/api/elevenlabs/stt` → words[] → cues (3–7 palabras / puntuación)
  → materiales de subtítulos + persistencia en `musa_video_transcripts` (v86).
- **Muletillas**: `shared/fillerWords.ts` detecta fillers sobre words[] →
  regiones de corte [start-50ms, end+50ms] fundidas → `cuts` persistidos en el
  transcript. Motor de cortes **par por construcción**: `visibleSpans(start, end,
  cuts)` parte cada clip en tramos visibles (el export los re-agenda uno por uno,
  así el splice de audio/video sale solo — nada se agenda dentro de un corte) y
  `sourceTimeAt`/`outputTimeAt` remapean el reloj de playback del editor
  (`VideoProjectEditor`, loop rAF) sobre el mismo `VideoPreview` intacto (los
  `<video>`/`<audio>` seek-ean cuando el playhead salta el corte). Los cortes son
  **no-destructivos**: media original intacto, toggle "aplicar cortes" antes de
  exportar; `standaloneVideoExport` emite fidelity warning `CUTS_APPLIED` (en
  rutas sin audio como GIF solo aplica el video).

## 4. Escalabilidad y modos de falla (resumen)

- Cliente: los cortes se aplican a NIVEL DE PLAN (los clips se parten en spans
  visibles), sin pase de mix adicional — el costo de memoria es el mismo de la
  export actual (el plano aloca solo lo que agenda). WebCodecs no cambia.
- Worker: passthrough puro (TTS 90 s / STT 240 s de upstream timeout); CPU ~0.
- Supabase: transcript ≈ 150 KB JSON por 10 min (TOAST, trivial); RLS por
  `has_workspace_role`.
- R2: TTS ~1 MB/min; limpieza manual del bucket (media library existente).
- ElevenLabs upstream: cuota del usuario es el cuello — 402/429 se mapean a
  códigos estables con CTA honesta; el export NUNCA degrada en silencio
  (fidelity warnings del bridge standalone).

## 5. Alcance por fases

| Fase | Contenido |
|---|---|
| 0 | Proxy + mappers + catálogo + esta doc |
| 1 | `src/lib/elevenlabs.ts`, pestaña Voz IA en el editor, sección Voz en Take Studio |
| 2 | `shared/srtVtt.ts`, pestaña Subtítulos (cues, SRT in/out, presets) |
| 3 | Migración v86 (`musa_video_transcripts`), `videoTranscripts.ts`, "Generar automáticamente" |
| 4 | `shared/fillerWords.ts`, editor de transcript, motor de cortes + paridad preview/export |
| 5 | QA harness + build + verificación |

## 6. Criterios de cierre

- Con key configurada: guion → locución en el timeline (editor y estudio).
- SRT import/export roundtrip sin drift de tiempos.
- "Generar automáticamente" produce subtítulos alineados y transcript persistido.
- Marcar muletillas → aplicar → preview y export muestran los mismos jump cuts.
- Sin key: errores estables con mensaje accionable, jamás un 500 opaco.

## 7. Verificación (fase 5)

- **QA harness** `QA/req063-elevenlabs-subs.test.mjs` (28 tests, verde con
  `node --experimental-strip-types --test`): roundtrip SRT/VTT ±1 ms, detección
  de muletillas (single/secuencia/lista custom/trim de silencios), y el motor de
  cortes — `sourceTimeAt`↔`outputTimeAt` inversos y monótonos, `visibleSpans`
  parte clips y cubre exactamente lo visible (los puntos dentro de un corte se
  colapsan al instante de reanudación, sin zona muerta). Los contratos de los
  módulos con DOM (worker proxy, `videoTranscripts`, tabs, export) se afirman
  sobre el source (convención del repo).
- **Build**: `tsc && vite build` sin errores de tipo.
- **Pendiente del usuario**: ejecutar `supabase_migrations_v86.sql` en el
  Supabase SQL Editor (crea `musa_video_transcripts` + RLS) y desplegar el worker
  en Cloudflare para habilitar `/api/elevenlabs` contra el upstream real.
