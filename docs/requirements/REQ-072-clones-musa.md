# REQ-072 — Clones Musa: tu propio HeyGen dentro de Musa

> Fecha: 17-nov-2026 · Estado: **HeyGen + plan Empresa en producción (v53ab051a)**; motor propio en espera de GPU · Depende de: REQ-071 (Musa Voz, Hermes)

## Decisión del 17-nov-2026 (después de medir)

- **F0 no pasó**: Ditto en CPU (i5-12450H, 8 hilos) cuesta ~4,7 s por cuadro (warp 1,9 s en PyTorch fp32 + decoder 2,8 s en ONNX fp32) → ~1 h por cada 30 s de video; en Oracle A1 se estiman 2–3 h. El decoder SPADE de 512 px necesita GPU; ningún plan gratis la da.
- **Decisión del dueño**: los clones propios de Musa son **exclusivos del plan Empresa** (función `musa_clon_habilitado`: tier empresa, admins y cuentas corporativas). Para todos los demás, **HeyGen con la llave de cada persona**: Musa trae sus clones privados (`ownership=private`), HeyGen genera cada video y Musa lo importa a R2 y lo coloca en su editor de video (URL estable firmada).
- En la web: aviso en Crear › Clones IA («habilitado para el plan Empresa» + Conectar HeyGen / Traer mis clones de HeyGen), formulario y editor de video según el plan. El motor propio (`clon-backend/`) queda listo para cuando haya GPU para Empresa.

> Pedido: «que no dependa solo de HeyGen, sino que sea la misma plataforma de Musa la que te permita hacer tus propios clones», con Cloudflare + Oracle + Supabase en sus planes gratuitos.

---

## 1. Qué hay hoy (revisión)

| Pieza | Estado | Dónde |
|---|---|---|
| Módulo Crear › Clones IA | Lista y alta de clones en `workspace_clones` (kind voz/avatar, provider elevenlabs/heygen) | `public/musa/bridge-create.js` (`C.clon`, `registerClone`, `loadClones`) |
| Clon con avatar | **Solo HeyGen** (BYOK): toma de 24 h en R2 → `POST /api/heygen/avatars/digital-twin` | `worker/runtime/functions/heygen.mjs` |
| Video con el clon | **Solo HeyGen** (`/api/heygen/videos`) desde la pestaña Clones del editor de video | `public/musa/bridge-ai.js` |
| Voz (REQ-071, Hermes) | Librería de voces: stock gratis (Workers AI Aura-2 ES/EN) + **clon de voz gratis con Chatterbox Multilingual** (chatterbox.cpp GGUF q4 en Oracle A1) + ElevenLabs BYOK | `worker/runtime/functions/musa-voz.mjs`, `voz-backend/`, `public/musa/bridge-voces.js`, tablas `musa_voces`/`musa_voz_uso`, bucket R2 `musa-voz` |
| VM Oracle | **No existe.** El lanzador de Hermes paró tras 21 intentos: «Out of host capacity» (sa-bogota-1, única región). La cuenta es PAYG (límite A1 41 OCPU) pero lo gratis sigue siendo 4 OCPU / 24 GB. | `~/.oci/launch_musa_voz.py` |

Conclusión: falta el **video** (cara que habla). La voz ya tiene diseño gratis; su backend está esperando la VM.

## 2. Investigación de modelos (licencia comercial + CPU, porque no hay GPU gratis)

| Modelo | Qué hace | Licencia | CPU | Veredicto |
|---|---|---|---|---|
| **Ditto** (Ant Group, ACM MM 2025) — `antgroup/ditto-talkinghead` | Audio → cabeza que habla (foto **o video** de origen), movimiento de cabeza, ojos y labios; renderer tipo LivePortrait 512 px | **Apache-2.0** (código y pesos) | ONNX Runtime CPU soportado por el propio repo (`load_model` .onnx); el paper reporta tiempo real en CPU con streaming | **Motor 1.** Dos auxiliares vienen de InsightFace (`insightface_det`, `landmark106`, no comerciales): se reemplazan por MediaPipe (`blaze_face` + `face_mesh`, Apache-2.0, ya incluidos). |
| **MuseTalk 1.5** (Tencent) | Lip-sync sobre tu video real (solo cambia la boca) | MIT, pesos de uso comercial (dependencias: sd-vae OpenRAIL-M, whisper MIT, dwpose Apache) | 3–5 s por cuadro en CPU | **Motor 2** (fase 3): «gemelo de video» de máxima fidelidad, render nocturno o con GPU opcional. |
| LatentSync (ByteDance) | Lip-sync difusión | Apache-2.0 | Solo GPU | Descartado sin GPU. |
| Wav2Lip | Lip-sync | **No comercial** | Sí | Descartado por licencia. |
| Chatterbox ONNX en navegador (Transformers.js/WebGPU) | Clon de voz en el navegador | MIT | WebGPU | Solo inglés hoy; el español sigue en Chatterbox Multilingual del servidor (REQ-071). Opción futura para EN. |

Fuentes: repo y modelo de Ditto (Apache-2.0, `ditto_onnx` 2,2 GB), repack ONNX `voxta/ditto-talkinghead-onnx` (warp opset 20 para ORT), guías de licencias 2026 de lip-sync (MuseTalk MIT / Wav2Lip no comercial / LatentSync Apache).

## 3. Arquitectura (todo en planes gratuitos)

```
Navegador (Musa)                Cloudflare Worker (musa-v2, plan Free)        Supabase (Free)           Oracle A1 (Always Free)
───────────────                ─────────────────────────────────────         ───────────────           ───────────────────────
Crear › Clones IA ──POST /api/musa-clon/clones────▶ valida consentimiento,     workspace_clones           musa-clon-engine (Python)
  (toma o foto + consentimiento)                    copia la fuente a R2 ────▶ musa_clon_jobs ◀── claim ─┤  · pull cada 10 s (sin puertos abiertos)
                                                    encola job «preparar»                                │  · Ditto ONNX CPU + MediaPipe
Generar video ────POST /api/musa-clon/videos──────▶ sintetiza el audio con    (RPC claim con              │  · ffmpeg (formato 9:16/1:1/16:9)
  (guion + voz + formato)                           Musa Voz (REQ-071),         SKIP LOCKED)              │  · sube MP4/póster con URL firmada
                                                    lo guarda en R2,                                     │
                                                    encola job «render»                                  └ musa-voz (Chatterbox, REQ-071) en la misma VM
Estado / progreso ◀──GET /api/musa-clon/jobs/:id── URL firmada del MP4 (R2 musa-voz/clones/…)
```

Decisiones:
1. **Pull, no push**: el motor pide trabajo con `POST /api/musa-clon/engine/claim` (secreto `MUSA_CLON_ENGINE_SECRET`). La VM no expone puertos ni guarda llaves de Supabase; puede correr en Oracle o en cualquier otra máquina (portabilidad si Oracle no da capacidad).
2. **Voz desacoplada**: el audio lo hace Musa Voz (stock Workers AI, clon Chatterbox o ElevenLabs BYOK) antes de encolar; el motor solo hace video.
3. **R2 `musa-voz`** guarda fuentes (`clones/<ws>/<clon>/source.*`, `portrait.png`) y resultados (`clones/<ws>/<clon>/videos/<job>.mp4`). Egreso gratis en R2.
4. **HeyGen sigue** como opción «Pro» con llave propia; Musa es el proveedor por defecto (`provider = 'musa'`).

## 4. Datos (migración 45)

- `workspace_clones`: `provider` acepta `'musa'`; columnas nuevas `engine`, `source_kind` (take/photo), `source_key`, `portrait_key`, `voice_id` (voz Musa asociada), `consent_text`, `consent_at`, `preview_url`, `meta`.
- `musa_clon_jobs`: `kind` (prepare/render), `status` (queued/running/done/error/cancelled), `progress`, `script`, `audio_key`, `output_key`, `poster_key`, `aspect`, `seconds`, `error`, `attempts`, `worker`, `heartbeat_at`, timestamps. RLS: los miembros del espacio leen; escribe solo el servidor.
- RPC `musa_clon_claim(worker)` → toma el job más antiguo en cola con `FOR UPDATE SKIP LOCKED` y reencola los que perdieron latido (>10 min).
- Cuota justa: segundos de video por espacio y día (`musa_clon_uso`), por defecto 180 s/día en el motor gratis.

## 5. API (worker `musa-clon.mjs`)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/musa-clon/clones` | `{name, source:'take'|'photo', take_id?, photo_base64?, consent:true}` → copia fuente a R2, crea clon `preparando` + job prepare |
| GET | `/api/musa-clon/clones` | Clones Musa del espacio con estado |
| DELETE | `/api/musa-clon/clones/:id` | Borra clon, sus videos y archivos en R2 |
| POST | `/api/musa-clon/videos` | `{clone_id, script, voz_id?, aspect, title}` → audio con Musa Voz → R2 → job render (cuota) |
| GET | `/api/musa-clon/jobs?clone_id=` / `/jobs/:id` | Estado, progreso, posición en cola, URL firmada del MP4 |
| GET | `/api/musa-clon/estado` | ¿Motor encendido? (último latido), cola, cuota del día |
| POST | `/api/musa-clon/engine/claim` · `/progress` · `/complete` · `/fail` | Solo el motor (secreto). Devuelve URLs firmadas de entrada/salida |

## 6. Motor (`clon-backend/`, Oracle A1)

- `engine.py`: bucle claim → descarga → `prepare` (elige el mejor cuadro frontal de la toma con MediaPipe: cara centrada, ojos abiertos, nitidez; recorte 512; extrae 20 s de voz limpia para el clon de voz) o `render` (Ditto ONNX CPU con fuente foto o video + audio → frames → ffmpeg H.264 → composición al formato pedido con fondo difuminado) → sube → complete. Latido cada 15 s, progreso por porcentaje.
- `ditto_patch/`: reemplazo de InsightFace por MediaPipe en `source2info._crop` (5 puntos derivados de los 478 de face_mesh) para uso comercial limpio.
- `setup_clon_engine.sh`: deps (onnxruntime ARM64, opencv-headless, librosa, ffmpeg), modelos ONNX Ditto (hubert cuantizado int8 para bajar de 1,46 GB a ~370 MB), systemd `musa-clon`, `Nice=10` para no robar CPU a la voz.
- Convive con `musa-voz` (Chatterbox) en la misma VM: 4 OCPU / 24 GB alcanzan (Ditto ~4 GB, Chatterbox q4 ~3 GB).

## 7. Interfaz (estilo de la maqueta, sin cambiar visuales)

- **Nuevo clon**: tipo «Clon Musa (gratis)» como opción por defecto, junto a ElevenLabs y HeyGen. Fuente: toma del estudio (24 h) o foto. Consentimiento obligatorio con texto explícito.
- **Tarjeta del clon**: Preparando → Listo / Error, con póster.
- **Generar video con el clon** (detalle del clon y pestaña Clones del editor de video): guion, voz (clon de voz Musa, voces stock, ElevenLabs), formato 9:16 / 1:1 / 16:9 → cola con posición y avance → reproducir, descargar, «Llevar al editor».
- Si el motor está apagado: el job queda en cola con el aviso «el motor gratis de Musa se está encendiendo» (nada se pierde).

## 8. Paridad IA (MCP)

`clone_musa_create`, `clone_musa_list`, `clone_video_render`, `clone_job_status` en `mcp-v2-parity.mjs` + skill `musa-video`.

## 9. Presupuesto gratuito

| Recurso | Límite free | Uso estimado |
|---|---|---|
| Oracle A1 | 4 OCPU, 24 GB, 200 GB disco, 10 TB egreso | 1 VM para voz + video, 1 job a la vez |
| Workers Free | 100k req/día, 10 ms CPU por req, 50 subrequests | Polling del motor ~8,6k req/día; presign y JSON (poca CPU) |
| R2 | 10 GB, 1M clase A, 10M clase B, egreso gratis | ~5 MB por minuto de video 720p; ciclo de vida 30 días para renders no guardados |
| Supabase Free | 500 MB DB | Filas chicas de jobs |
| Workers AI | 10k neurons/día | Voces stock de REQ-071 |

## 10. Fases y criterios de aceptación

| Fase | Entrega | Criterio |
|---|---|---|
| F0 | Benchmark Ditto ONNX CPU (x86 local y A1) | ≤ 4× tiempo real en A1 (30 s de video en ≤ 2 min) |
| F1 | Migración 45 + worker `musa-clon` + secretos | Alta de clon y job en cola desde la web; claim/complete con secreto |
| F2 | Motor `clon-backend` (prepare + render Ditto) + parche MediaPipe | Clon desde toma → póster; guion → MP4 con labios sincronizados |
| F3 | UI Clones IA + editor de video + MCP | Persona real: crea clon, genera video, lo lleva al editor (Chrome y Safari) |
| F4 | Despliegue en Oracle A1 (cuando haya capacidad) | Motor con latido en `/api/musa-clon/estado` |
| F5 | MuseTalk «gemelo de video» (opcional) | Lip-sync sobre metraje propio, render nocturno |

## 11. Riesgos

- **Capacidad Oracle**: lanzador 24 h alternando 4/24, 3/18, 2/12 (`~/.oci/launch_musa_ia_24h.py`). El motor es portable (pull) y puede correr en otra máquina mientras tanto.
- **Velocidad CPU**: si A1 no llega a 4× tiempo real → render a 25 fps con hubert int8, decoder fp16→int8, y cola con ETA visible.
- **Calidad vs HeyGen**: Ditto anima una foto/cuadro (estilo «avatar de foto» de HeyGen); para fidelidad de metraje real → F5 MuseTalk. HeyGen BYOK queda disponible.
- **Ética**: consentimiento obligatorio y registrado (texto + fecha + quién), solo tomas propias, metadata «Generado con IA» en el MP4, borrar el clon borra todo en R2.
