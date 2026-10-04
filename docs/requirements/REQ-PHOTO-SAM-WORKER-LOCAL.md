# REQ-PHOTO — Runner local del worker de segmentación (MobileSAM / CLIPSeg / u2netp)

> Instrucciones para el agente implementador ("hermes"). El objetivo es que la
> herramienta **Selección rápida (SAM)** del Modo Foto — y también
> remove-background y segmentación por texto — terminen sus jobs en local.
> **NO se necesita escribir ningún motor de inferencia: ya existe completo en
> el repo.** Solo falta exponerlo como proceso Node de larga duración.

---

## 1. Contexto: qué YA existe (verificado, no reescribir)

### Motor de inferencia completo — `netlify/segment/segment-core.mjs` (586 líneas)
- `export async function processJobById(jobId)` — claim con guard de estado
  (`queued` o `running` viejo) sobre la fila y la lleva a `done | error`.
- `export async function sweepQueuedJobs(limit = 5, minAgeMs = 15_000)` —
  procesa los `segment_jobs` en `queued` con más de 15s. **Este es el punto
  de entrada ideal para un poller local** (es el mismo mecanismo self-heal
  que usa el background function de Netlify).
- `export async function selfTest(engines = ["u2netp","sam","clipseg"])` —
  prueba los 3 motores con un SVG sintético (path puro de inferencia, NO
  necesita Supabase).
- Motores: `remove_background` → u2netp (320, ~1s) · `segment_click` →
  MobileSAM encoder+decoder (1024, points+box, ~2-4s) · `segment_text` →
  CLIPSeg int8 (352, ~5-15s). Runtime: onnxruntime-web WASM (numThreads=1)
  + sharp. **Cero tokens de LLM.**
- Modelos: carga PRIMERO `./models-cache/` (gitignored) y ya están
  descargados los 5 archivos: `u2netp.onnx`, `mobile_sam_encoder.onnx`,
  `mobile_sam_decoder.onnx`, `clipseg-rd64-int8.onnx`, `clipseg-vocab.json`,
  `clipseg-merges.txt`. (Fallback: bucket `ml-models` de Supabase, con
  `scripts/fetch-segment-models.mjs` para provisionarlo.)

### La cola — tabla `segment_jobs` (Supabase)
- REST `api/src/routes/segmentation.ts`: `POST /api/segment/click` inserta la
  fila `queued` (service role; la tabla tiene RLS **sin policies** → SOLO
  service role sirve) e intenta dispatch al background function de Netlify
  (`dispatchSegmentJob`). En local ese dispatch SIEMPRE falla (SITE_URL apunta
  a un dominio público) → la fila queda `queued` → **el sweep la recoge**.
  Ese es el diseño self-heal explícito del servicio: NO "arreglar" el
  dispatch, no tocar `api/src/services/segmentation.ts`.
- Contrato de resultado (`result_json` al llegar a `done`):
  `{ cutoutAssetId, cutoutUrl, maskAssetId, maskUrl, svgPath, imageWidth,
  imageHeight, origWidth, origHeight, engine }` — el cliente ya consume
  `result.maskUrl`.

### El cliente — ya operativo
- `src/components/PhotoModeOverlay.tsx` → `samQuickSelect()`: POST
  `/api/segment/click` con points normalizados 0..1 → poll de
  `/api/segment/jobs/:id` 16 veces × 1.5s (24s) → dibuja maskUrl en la
  selección. Con el worker local arriba, el flujo completo entra en la
  ventana de polling (sweep 15s + inferencia 2-4s), salvo el primer clic con
  el runtime frío (carga del encoder) — en ese caso aparece el toast honesto
  y el job IGUAL se completa; el usuario repite el clic. No cambiar el cliente.

### Dependencias — ya instaladas
- `onnxruntime-web@1.22.0`, `sharp@0.35.3` (en package.json actual).
- Node v24 en esta máquina (soporta `--env-file=.env` nativo).
- **No agregar dependencias nuevas.**

---

## 2. Lo único que falta: crear el runner local

### Archivo nuevo: `scripts/segment-worker-local.mjs`

```js
// Poller local del engine de segmentación (ver REQ-PHOTO-SAM-WORKER-LOCAL.md).
// Corre junto a dev:all y procesa los segment_jobs en queued (self-heal).
import { sweepQueuedJobs } from "../netlify/segment/segment-core.mjs";

const INTERVAL_MS = 3_000;
console.log("[segment-worker] poller local iniciado — sweep cada 3s");
for (;;) {
  try {
    const results = await sweepQueuedJobs();
    for (const r of results) {
      console.log(`[segment-worker] job ${r.jobId ?? "?"}: ${r.status ?? "?"}${r.skipped ? " (skipped)" : ""}`);
    }
  } catch (e) {
    console.error("[segment-worker] sweep error (sigue):", e?.message || e);
  }
  await new Promise(r => setTimeout(r, INTERVAL_MS));
}
```

(Es una guía — hermes puede mejorar logging, backoff y stale-running
requeue; NO cambiar la firma ni el comportamiento de segment-core.mjs.)

### Cómo ejecutarlo (crítico — leer el porqué)

`segment-core.mjs` importa `../../api/src/services/supabase.js` — un
specifier `.js` que en realidad apunta a un `.ts` (el bridge de esbuild de
Netlify). Bajo `node` puro eso NO resuelve. Solución elegida:

```
npx tsx --env-file=.env scripts/segment-worker-local.mjs
```

- `npx tsx` resuelve specifiers `.js` → `.ts` (usar npx; **no** instalar tsx
  como dependencia del repo).
- `--env-file=.env` carga el `.env` de la raíz (mismas env que la API local:
  `SUPABASE_URL` + `SUPABASE_SECRET_KEY` o sus variantes — ver
  `supabaseConfig()` en `api/src/services/supabase.ts`).

### Integración en package.json (quirúrgica)

Agregar SOLO un script: `"dev:segment": "tsx scripts/segment-worker-local.mjs"`.
- Repo multiagente: **re-leer package.json justo antes de editar** (suele
  tener WIP sin commitear de otros agentes) y usar un SearchReplace mínimo
  dentro del bloque `scripts`. No reordenar ni tocar nada más.

### Arranque completo del entorno local

1. `npm run dev:all`  (API :3001 + Vite :5173, ya inyecta el .env raíz)
2. `npm run dev:segment`  (en otra terminal)

---

## 3. Criterios de aceptación (todos verificables)

1. **Smoke de motores sin Supabase** (inferencia pura):
   `npx tsx -e "import('./netlify/segment/segment-core.mjs').then(m => m.selfTest(['sam']).then(r => console.log(r)))"`
   → reporta ms y foreground ratio sin throw. Si falla por modelos, correr
   `node scripts/fetch-segment-models.mjs` (en local no debería hacer falta:
   models-cache ya está completo).
2. **Flujo E2E**: con `dev:all` + `dev:segment` arriba → Modo Foto →
   Selección rápida (flyout "Selección rápida (SAM)") → clic sobre un objeto
   → toast "SAM analizando…" → en <10s la selección aparece (hormigas
   animadas). Shift añade / Alt resta. Probar también el modo texto si se
   desea (`segment_text` vía CLIPSeg).
3. **remove-background** (si se dispara desde la Librería de Fotos) pasa de
   `queued` → `done` igual por el sweep.
4. **Sin regresiones**: `npx tsc --noEmit` = 0; `npm run test:regression` =
   899/896/3 (solo los fallos foráneos conocidos). El runner no toca código
   de src/ ni de QA.

---

## 4. Pitfalls (leídos del código, no adivinar)

- **NO usar `netlify dev`**: las background functions no corren de forma
  fiable ahí. El runner Node directo es el camino.
- **NO intentar ONNX en el worker de Cloudflare**: `wrangler.toml` aliasa
  `onnxruntime-web`/`sharp` a stubs a propósito (Workers no puede). Por eso
  el runner vive en Node. La cola está en Supabase → el MISMO runner con las
  env de producción procesa los jobs de producción desde cualquier máquina
  (VPS, cron de GH Actions, la PC del usuario). En CF-prod el dispatch REST
  tampoco encuentra el background function de Netlify → mismas filas
  `queued` esperando un runner.
- **`segment_jobs` RLS sin policies** → solo service role. Si el sweep loguea
  0 jobs para siempre, verificar con la service key leyendo la tabla directo.
- **Windows**: sharp funciona con prebuilt; onnxruntime-web WASM con
  `numThreads=1` ya está forzado en segment-core (no tocar).
- **Archivos sensibles del repo (multiagente)**: no commitear WIP ajeno
  (package.json, netlify/functions/mcp.mjs, docs/MCP_TOOL_CATALOG*,
  public/docs/*, dogfood-report.md, QA/mcp-pattern-fill.test.mjs);
  `docs/requirements/*` y `models-cache/` NO se commitean.
- El job queda reclamado en `running` si el proceso muere a mitad: el
  siguiente sweep lo reclama de nuevo (el claim acepta `running` viejo).
  No inventar un mecanismo distinto.

## 5. Fuera de alcance de este req

- Producción: decidir dónde vive el runner permanente (VPS/cron) o
  rehabilitar Netlify solo para funciones — decisión de producto, no de este
  req. El requisito aquí es local.
