# Motor de clones de Musa (REQ-072)

Nuestro «HeyGen» propio y gratis: anima a la persona del clon (foto o cuadro de su toma) con el audio del guion.

- **Modelo**: Ditto (Ant Group, Apache-2.0) con ONNX Runtime en CPU. Sin InsightFace (pesos no comerciales): el primer recorte usa MediaPipe Face Mesh (Apache-2.0). Ver `musa_ditto.py`.
- **Voz**: la pone Musa Voz (REQ-071) antes de encolar: voz clonada (Chatterbox), voces gratis (Workers AI) o ElevenLabs.
- **Cola**: Supabase `musa_clon_jobs` (migración 45). El motor **pide** trabajo (`POST /api/musa-clon/engine/claim`) con `MUSA_CLON_ENGINE_SECRET`; no abre puertos ni guarda llaves de base de datos.
- **Archivos**: R2 `musa-voz` (`clones/<ws>/<clon>/…`), siempre con URLs firmadas.

## Instalar en Oracle A1 (o cualquier Linux)

```bash
scp -r clon-backend ubuntu@IP:~
ssh ubuntu@IP 'sudo MUSA_CLON_ENGINE_SECRET=$(cat secreto) bash ~/clon-backend/setup_clon_engine.sh'
```

El secreto está en `~/.oci/clon_engine_secret.txt` (Windows de Renzo) y en el worker como `MUSA_CLON_ENGINE_SECRET`.
**No lo cambies sin pensar**: también firma las URLs estables de los videos (`/api/musa-clon/media/...`); si cambia, los enlaces ya guardados en proyectos dejan de abrir.

## Trabajos

| Tipo | Entrada | Salida |
|---|---|---|
| `prepare` | toma (video) o foto | `portrait.png` (mejor cuadro frontal), `preview.jpg`, muestra de voz de 6–25 s → voz clonada en Musa Voz |
| `render` | retrato + audio del guion | MP4 H.264/AAC en 9:16, 1:1 o 16:9 (fondo difuminado) + póster |

## Archivos

- `engine.py` — bucle pull, latido cada 20 s, reintentos solo en fallas transitorias.
- `musa_ditto.py` — configuración sin pickle (`ditto_cfg.json` + `.npz`), parche MediaPipe, `render()`.
- `media.py` — elección del mejor cuadro (frontal, ojos abiertos, nitidez), muestra de voz, composición ffmpeg.
- `ditto_cfg.json/.npz` — convertidos una vez desde el cfg oficial con un deserializador restringido (solo numpy).
