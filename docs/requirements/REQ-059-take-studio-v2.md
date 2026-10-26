# REQ-059 — Take Studio V2: teleprompter de estudio, formatos de toma, biblioteca con revisión y AI Clones (HeyGen BYOK)

Fecha: 2026-10-26 · Estado: **fase 1 implementada** (bloques A–D core, gates en verde) · Prioridad: P1 · Esfuerzo: L · Origen: dogfood del REQ-058 en producción — el humano graba y tropieza con cuatro fricciones: el teleprompter queda fuera de pantalla, el formato es "horizontal" sin proporción exacta, no puede revisar lo que grabó antes de subir, y la parada natural siguiente (clon AI con HeyGen) quedó marcada como fase siguiente en REQ-058.

Pendiente antes de dar por cerrado: dogfood con cuenta HeyGen real (el proxy `/api/heygen/*` solo existe en el worker desplegado; en local el Express de desarrollo no lo monta y la UI lo dice explícitamente).

## 1. Problema

1. El teleprompter es una sección al pie: hay que scrollear la página para escribirlo o verlo, imposible durante una grabación.
2. No hay forma de escribir el guion ahí mismo ni de importarlo (.docx/.txt/.md).
3. El formato de la toma está clavado a un preview 16:9 sin control real de medidas: los posts piden 1080×1080 o 1080×1350, reels/stories 1080×1920, YouTube 1920×1080.
4. Al detener la toma no hay play de revisión; la biblioteca mezcla scroll de página con los controles de grabación.
5. No existe forma de generar video con un clon AI propio (HeyGen) dentro del producto.

## 2. Alcance

### Bloque A — Modo estudio + teleprompter real
- **Pantalla única sin scroll de página**: panel 100vh con `overflow: hidden` — preview, controles y prompter visibles SIEMPRE. El único scroll de la pestaña vive DENTRO de la biblioteca (bloque C).
- Teleprompter anclado con 2 ubicaciones: **overlay sobre el preview** (como hoy, transparencia ajustable) o **columna lateral** permanente. Visible sin scrollear desde que tiene texto.
- **Edición in-place**: click en el prompter → textarea integrada (autoguardado en `localStorage` por workspace). Contador de palabras + duración estimada según la velocidad de scroll configurada.
- **Import de guion**: `.txt` (FileReader directo), `.md` (strip de marcadores), `.docx` (extracción client-side SIN dependencias — el repo no tiene mammoth/jszip: parser manual del ZIP (central directory) + `DecompressionStream("deflate-raw")` → `word/document.xml` → `</w:p>`→salto de línea, strip de tags y entidades). Si el navegador no soporta `deflate-raw`: mensaje honesto ("guardalo como .txt").
- Autoscroll rAF (ya existe): arranca sincronizado con el countdown de grabación, pausa/reanudar, velocidad px/s + tamaño + espejo accesibles sin scroll. Durante la grabación el prompter sigue scrolleando en tiempo real — la página no se mueve.

### Bloque B — Formatos de toma (dropdown)
- Dropdown con 4 presets (elección persistida en `localStorage`, no input manual):

  | Preset | Resolución | Ratio | Uso |
  |---|---|---|---|
  | Vertical | 1080×1920 | 9:16 | reels / stories / tiktok |
  | Post cuadrado | 1080×1080 | 1:1 | feed |
  | Post retrato | 1080×1350 | 4:5 | feed IG |
  | Horizontal | 1920×1080 | 16:9 | YouTube / landing |

- **Canvas compositing**: la webcam entrega lo que entrega — el canvas compone al formato EXACTO (center-crop "cover" por defecto; toggle "Encajar" = letterbox). `MediaRecorder` graba `canvas.captureStream()` + pista de audio mixeada. Constraints `ideal` por formato para pedir a la cámara la mejor resolución posible.
- Las tres fuentes del número tienen que decir lo mismo: **label** del dropdown, **geometría** del canvas y **`aspect_ratio`** que se manda a HeyGen (`shared/heygenMappers.ts` → `aspectForTakeFormat`). Un test lo impone (`QA/take-formats.test.mjs`): nació de un bug real donde 4:5 estaba dibujado 1350×1080 (apaisado).
- Bitrates explícitos por formato: vertical 8 Mbps, 16:9 y 4:5 6 Mbps, 1:1 5 Mbps (peso predecible, ver §5).
- **WYSIWYG**: el preview muestra el aspect-ratio real del formato elegido — lo que ves es lo que sale.
- Se mantiene TODO lo de REQ-058: techo 3 min con auto-stop, dispositivos, countdown, pausa, HUD, modo local, aviso 24 h. Pausa durante grabación = freeze-frame del canvas en el archivo (decisión documentada).

### Bloque C — Revisión + biblioteca
- **Al Detener → modo revisión**: player con el blob (play/pausa/scrub/volumen) + botones **Subir a la biblioteca** / **Descartar** / **Regrabar**. La subida pasa a ser EXPLÍCITA (no automática): evita gastar cupo en tomas malas y da el lugar natural del "play para ver lo que hice".
- **Biblioteca en panel inferior con scroll INTERNO**: tomas server + locales, players inline con poster, badges (subiendo %, lista, descargada, countdown 24 h), Descargar y Borrar como hoy. La página entera nunca scrollea.

### Bloque D — AI Clones (HeyGen, BYOK)
- Nueva sub-pestaña en Video: **proyectos / tomas / clones** (todo lo de video vive en Video).
- **Clave**: provider `heygen` en la infra BYOK existente (`user_api_keys`, AES-256-GCM, PK `user_id+provider` — cero migración; `keys.mjs` acepta provider libre). UI: tarjeta en Configuración → Claves + estado/atajo en la pestaña. La clave JAMÁS viaja al cliente: el worker resuelve con `getUserKey` y proxía todas las llamadas.
- **API v3 SIEMPRE** (base `https://api.heygen.com`, header `X-Api-Key`): v1/v2 mueren el 2026-10-31. Endpoints core: `GET /v3/users/me` (validar clave), lista de avatares y voces (filtrar clones propios vs stock con toggle), **Create Avatar** (tipos `digital_twin` desde video / `photo` desde una foto; training async con poll), **Avatar Video** (avatar+voz+guión), `GET /v3/videos/{id}` (status → `video_url`). Nombres exactos a confirmar contra `developers.heygen.com/llms.txt` al implementar.
- **Flujo pedido**: tema → nuestro LLM BYOK (el que el usuario ya tenga; pipeline `ai_generate_text` existente) genera **3 guiones** (gancho/desarrollo/CTA + duración estimada, tono opcional) → elegir uno (editable) → elegir clon + voz + formato (1080×1920 o 1080×1080) → **un click genera** → poll cada 5 s (techo 10 min) → player + **Descargar** + enlace.
- **Crear clon**: desde una toma del estudio (URL firmada R2 con TTL 3600 s — HeyGen exige URL pública descargable y nuestro bucket es privado; la URL muere en 1 h) o archivo local. Training async con poll. Verificar en implementación si v3 trae upload directo de assets (si sí, preferirlo y descartar el presign largo).
- Jobs SIN persistencia server v1: viven en memoria del cliente (un refresh pierde el progreso — el video queda en la cuenta HeyGen). Documentado en UI.
- Créditos y consumo de HeyGen corren por la cuenta del usuario (BYOK); la UI lo recuerda junto al last4.

### Otras capacidades del API de HeyGen (para analizar — entran por fases)
- **Video Agent**: prompt → video completo auto-guiado (scripts, avatar y voz él solo). Modo "rápido" sin elección de guion — fase 2.
- **HeyGen Video**: texto/imagen → clip hasta 30 s, hasta 2K (insumo para el editor — fase 2/3).
- **Templates**: plantilla → una llamada por viewer/persona (videos personalizados a escala — fase 3).
- **Instant Voice Clone**: una grabación → tu voz HeyGen; **Professional Voice Clone**: 20+ min de audio studio (requieren consentimiento de voz — fase 2/3).
- **TTS** con voz HeyGen, completo o streaming (fase 3).
- **Video Translation**: 175+ lenguajes con lip-sync y clonación de voz (fase 3).
- **HeyGen Image**: retratos con tu identidad; **Look Packs**: vestuarios del avatar (fase 3).
- **HyperFrames**: HTML/CSS/JS → video motion graphics (fase 3).
- **Webhooks** (`callback_url`): reemplazan el polling — fase 2.
- **MCP server propio de HeyGen**: para el agente conectado del usuario, fuera de nuestro server (no requiere trabajo nuestro).

## 3. Decisiones
1. **Canvas compositing** en vez de confiar en constraints: garantiza el formato EXACTO sin importar la cámara. Cover por defecto (sin bandas), letterbox opt-in.
2. **Subida explícita post-revisión**: el play de revisión pide un lugar natural y el cupo deja de pagar tomas descartadas.
3. **docx sin dependencias**: ~100 líneas de ZIP+inflate-raw vs sumar mammoth/jszip al bundle; txt/md primero, docx con fallback honesto.
4. **Guion con nuestro LLM, render con HeyGen**: control total del texto (elegir/editar) y créditos de HeyGen gastados solo en el render. Video Agent queda como modo rápido fase 2.
5. **v3 única**: el sunset de v1/v2 (2026-10-31) lo obliga — no se escribe una línea contra la API vieja.
6. **Jobs sin tabla propia v1** (YAGNI): si hay demanda de historial → migración v85 con jobs y webhooks en fase 2.
7. **Clon desde toma vía URL firmada 3600 s**: bucket privado, TTL acotado, un solo destinatario. Preferir upload directo si v3 lo ofrece.

## 4. Fuera de alcance (v1)
Streaming avatars realtime · voice cloning en UI · video translation · templates e HyperFrames · historial persistente de jobs · tools MCP `heygen_*` · guardar videos de HeyGen en la biblioteca R2 · edición de video.

## 5. Escalabilidad (cuantificada)
- **Navegador**: encode canvas 1080×1920@30 vp9 ≈ 1 núcleo; blob pico ≈ 180 MB por toma de 3 min (8 Mbps + audio) — desktop OK; en móvil el dropdown avisa "formato pesado".
- **Worker/API**: 0 estado nuevo. Sign de tomas igual (1 RPC + presign). Proxy HeyGen = passthrough stateless (~2 req por poll); los rate limits los pone HeyGen (respetar `Retry-After` en 429).
- **R2 / cupo 8 GB**: ≈ 45 tomas verticales de 3 min (183 MB c/u) vs ~350 con el bitrate actual — el indicador de cupo existente sigue siendo el guardia; el dropdown suma "peso estimado por formato".
- **HeyGen**: 1 job = create + ≤120 polls → dentro de límites free/creator; el gasto de créditos escala linealmente con videos generados (cuenta del usuario).
- **docx client-side**: memoria O(doc), <5 MB típicos — despreciable.

## 6. QA
- `QA/take-formats.test.mjs` — presets (dimensiones/bitrate/label), anti-drift label↔canvas↔aspect de HeyGen, matemática cover/contain cámara→canvas, peso estimado por formato y techo de 3 min.
- `QA/docx-text.test.mjs` — fixture ZIP real armado en el test (central directory + `deflate-raw` y `stored`), extracción de párrafos/saltos/tabs/entidades, errores explícitos (no-docx, método raro, vacío), strip de markdown y normalización CRLF.
- `QA/heygen-mappers.test.mjs` — fixtures de respuestas v3 (users/me, looks, voices, videos/{id} en todos los estados) → DTO, `videoPhaseOf` con sinónimos, `video_url` oculta hasta `completed`, builders de body con códigos de error, mapeo de errores (401 clave inválida, 402/429, `download_failed`), parseo de guiones (cerca/prosa/Anthropic/OpenAI).
- No está automatizado (y no se miente con eso): el loop de poll de `src/lib/heygen.ts` (5 s / techo 10 min) no es importable en Node porque el módulo tira de `apiFetch`; se comprueba en el dogfood manual. El proxy `/api/heygen/*` tampoco — requiere key real de HeyGen.
- Dogfood manual: grabar y descargar en los 4 formatos · revisar/descartar/subir · importar un docx real · flujo de clon end-to-end con cuenta HeyGen real.

## 7. Implementación (mapa de archivos)
- `src/lib/takeRecorder.ts` — canvas compositing, formatos, bitrates, flujo review-first (auto-upload OFF).
- `src/lib/docxText.ts` (NUEVO) — extractor zip/xml dep-free + strip de markdown.
- `shared/heygenMappers.ts` (NUEVO) — normalizadores y builders puros de v3: los importa el worker (`.ts` directo, mismo patrón que `shared/takeTtl.ts`) y el cliente, así el contrato no se duplica.
- `src/lib/heygen.ts` (NUEVO) — cliente del proxy + `pollHeygenVideo` + `generateScriptIdeas` por `/api/llm` (rol leader, caída a `tier: "platform"` si no hay BYOK de chat).
- `src/components/video/TakeStudio.tsx` — modo estudio 100vh, prompter editable + import, dropdown de formatos, revisión, biblioteca con scroll interno.
- `src/components/video/AiClonesTab.tsx` (NUEVO) — clave, clones, guiones, generación.
- `src/components/Dashboard.tsx` — sub `clones` en Video + whitelist de panes.
- `worker/runtime/functions/heygen.mjs` (NUEVO, patrón video-takes) — `/api/heygen/*`: JWT + `getUserKey(user,"heygen")` server-side; nunca loguea ni devuelve la clave.
- `worker/runtime/functions/video-takes.mjs` — `?preview=1` en `/download`: firma la misma URL de GET pero NO marca `downloaded_at`, para que el play inline de la biblioteca no mienta con el badge "descargada".
- `worker/index.js` — 1 ruta nueva (misma mecánica patch-dance si el archivo sigue compartido).
- MCP `heygen_*`: fase 2 (el patrón de schemas literales de REQ-058 ya está documentado).

## 8. Setup manual
- **Nada server-side** (BYOK puro, sin migración SQL). Ren: crear API key en `platform.heygen.com/api-keys` → Configuración → Claves → HeyGen. Sunset v1/v2 ya anotado: no hay trabajo de compatibilidad.

## 9. Fases
1. **Fase 1 (este REQ)**: bloques A+B+C+D core.
2. **Fase 2**: webhooks HeyGen, guardar videos HeyGen en biblioteca R2, Video Agent como modo rápido, tools MCP `heygen_*`, historial de jobs (migración).
3. **Fase 3**: translation, voice cloning, templates, HyperFrames, TTS, HeyGen Video como insumo del editor.
