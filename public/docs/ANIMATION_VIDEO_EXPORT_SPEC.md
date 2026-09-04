# Spec: Animación y exportación a video — Design Tool (freemium)

> **Canonical:** `design-main/docs/ANIMATION_VIDEO_EXPORT_SPEC.md` (repo reno42/design, rama `main`)
> **Fecha:** 2026-08-19
> **Stack objetivo:** Netlify FREEMIUM + Supabase FREEMIUM + GitHub FREEMIUM. Nada que exija plan pago.
> **Origen:** dos usuarios pidieron "animar los diseños" y "editar video". El editor ya renderiza código animado en vivo (WYSIWYG), pero no hay modelo de animación ni export a video.

---

## 1. Contexto / estado actual (verificado en el código)

- Editor React + Vite, HTML/CSS-first. Layers = elementos HTML.
- Ya existe el tab **"Animation"**: `src/components/HtmlContextualPanel.tsx`, `subTab: "properties" | "code" | "animation"` (render en línea ~1396), gobernado desde `src/pages/EditorV2.tsx` (línea ~6337). Hoy el tab es un placeholder.
- El editor ya anima en vivo cualquier código con CSS `@keyframes` / `transition` porque es un navegador. Ese es el punto de partida: **WYSIWYG garantizado**.

## 2. Decisión de arquitectura (NO negociable)

1. **UNA fuente de verdad**: esquema declarativo de animación en JSON (timeline + clips + tweens). Nada de animaciones escondidas en código suelto.
2. **Preview = el esquema se compila a Web Animations API (WAAPI)** → el editor anima en vivo, con scrub/play.
3. **Export = WYSIWYG, con el navegador del propio usuario como motor de render (Fase 1)**. El render server-side (Fase 2) es opcional y está gated por los límites freemium.
4. **NO usar Remotion como motor principal**: Remotion PROHÍBE CSS animations/transitions (no renderizan) y exige re-expresar todo en `useCurrentFrame + interpolate` → un segundo motor de render que diverge del preview. (Solo como referencia de easing/composición.)
5. **CERO tokens LLM** en animar/exportar: es matemática declarativa + render, no IA.

## 3. Restricciones FREEMIUM (límites que mandan el diseño)

**Netlify free (aprox):**
- ~125K invocations de funciones/mes.
- **~50MB comprimido por función** (muro ya visto con ONNX/Chromium).
- Función sync: ~10s. Background function: 15 min (solo si el plan la permite).
- ~100GB bandwidth/mes, ~300 min de build/mes.

**Supabase free (aprox):**
- DB ~500MB, **Storage ~1GB total**, **~5GB bandwidth/mes**.
- Edge Functions ~2MB bundle → NO sirve para Chromium/ONNX.

**GitHub free:**
- Repo ~1GB, archivo ≤100MB (LFS 1GB) → **NO commitear** Chromium, modelos ONNX ni videos al repo.

**Consecuencia directa:** el export a video NO puede depender de Chromium serverless ni de subir videos grandes sin control. **La Fase 1 (render en el navegador) es el camino primario y es 100% freemium** (cero invocations, cero bandwidth de Supabase, cero bundle).

## 4. Modelo de datos (esquema de animación)

```jsonc
{
  "animation": {
    "timeline": { "durationSec": 5, "fps": 30, "width": 1080, "height": 1080, "loop": "once|loop|pingpong" },
    "clips": [
      {
        "layerId": "l_123",
        "startSec": 0.5,
        "endSec": 3.0,
        "tweens": [
          {
            "prop": "transform|opacity|filter|color|backgroundColor|backgroundPosition|clipPath|width|height|top|left",
            "keyframes": [ { "t": 0, "value": "translateX(0) opacity(1)" }, { "t": 1, "value": "translateX(-40px) opacity(0)" } ],
            "easing": "linear|cubic-bezier(x1,y1,x2,y2)|spring(damping,stiffness)"
          }
        ]
      }
    ],
    "transitions": [ { "fromFrameId": "f_1", "toFrameId": "f_2", "type": "fade|slide|zoom|wipe", "durationSec": 0.6 } ]
  }
}
```

- **Presets** (para no-técnicos): `fade-in`, `slide-in`, `zoom-in`, `blur-in`, `rotate`, `pop/bounce`, `typewriter`, `fade-out`, `float`.
- **Transiciones entre frames**: un template multi-frame se vuelve un video encadenando frames con transiciones.

## 5. Fases

### Fase 0 — Modelo + UI (sin export, 0 servidor)
- Tipos TS + migración (guardar `animation` en layer/frame/template; patrón de persistencia existente en Supabase).
- Panel "Animation": timeline simple (play/scrub), selector de presets, editor de keyframes por capa, easing presets.
- Compilador esquema → WAAPI para preview en vivo.
- **Costo freemium: 0** (todo frontend).

### Fase 1 — Export CLIENTE (PRIMARIO en freemium)
- `canvas.captureStream()` / `MediaRecorder` (o WebCodecs + muxer para frame-perfect) → **WebM** en el navegador; MP4 solo si WebCodecs/muxer disponible.
- El usuario descarga el video o lo sube a Supabase Storage voluntariamente.
- Limitación aceptada: captura en tiempo real (posible drift). Suficiente para posts sociales.
- **Costo freemium: 0 invocations, 0 bandwidth de Supabase, 0 bundle.** No toca Netlify Functions en absoluto.

### Fase 2 — Export SERVIDOR (OPTATIVO, gated por freemium)
- Función Netlify `video-render`: Playwright + `@sparticuz/chromium` (Lambda-optimizado) + ffmpeg → MP4 determinista a FPS/resolución exactos, vía `animation.currentTime`.
- **Gate obligatorio antes de hacerla:** (a) medir `.netlify/functions/video-render.zip` < 50MB (lección del calado), y (b) confirmar que el plan permite background functions (15 min) porque un video de 10s@30fps = 300 frames >> 10s sync.
- Si NO cabe en freemium → se pospone; el camino de agentes queda en Fase 1 (el agente compone la animación por MCP y el usuario exporta desde la UI) o se decide hosting externo aparte.
- Salida a Supabase Storage con **política de expiración/cleanup** (1GB total es poco para videos): expirar renders a los N días.

### Fase 3 — Edición de video real (OUT OF SCOPE de este spec)
Importar clips, cortar, audio, multi-pista. Producto aparte; spec propio si se confirma demanda. Este spec cubre **animar piezas diseñadas y exportar a video**, no un editor de video.

## 6. MCP (agent-first, mismo patrón `mcp.mjs`)

| Tool | Acción | Coste freemium |
|---|---|---|
| `set_animation` | Aplicar/actualizar esquema de animación a capa/frame/template | 1 invocation, trivial |
| `get_animation` | Leer animación de un template/frame | 1 invocation |
| `list_animation_presets` | Listar presets | 1 invocation |
| `apply_transition` | Transición entre frames | 1 invocation |
| `render_video` | Export server-side (Fase 2, gated) | alto; opcional |
| `render_video_status` | Poll del job | trivial |

En freemium, el flujo agente→video es: agente compone la animación con `set_animation`/`apply_transition` → el humano exporta en la UI (Fase 1). `render_video` solo si Fase 2 pasa los gates.

## 7. Criterios de aceptación

- Animar cualquier capa/frame con presets Y keyframes custom; preview en vivo (play/scrub/loop) — F0, 0 servidor.
- Export a WebM (y MP4 donde el navegador lo soporte) a resolución del formato y 30fps reproduciendo el preview — F1, 0 invocations.
- Loop once/ping-pong funcionan.
- 0 tokens LLM en el flujo (verificable en logs).
- NINGÚN binario pesado (Chromium/modelos) entra al repo de GitHub ni al bundle de Netlify en F0/F1.
- Fase 2 solo si: zip < 50MB + background function disponible; si no, queda pospuesta sin bloquear F0/F1.

## 8. Riesgos / pitfalls

- **Chromium vs 50MB Netlify** (F2): medir zip antes; @sparticuz/chromium; background function; si no, posponer.
- **Determinismo de captura** (F2): esperar `document.fonts.ready` + assets; fijar `animation.currentTime` (no wall-clock).
- **MediaRecorder drift** (F1): aceptable; frame-perfect solo si WebCodecs+muxer.
- **Supabase 1GB Storage / 5GB bandwidth**: videos pesan; export cliente por defecto descarga local, subir a Storage solo a pedido + expiración.
- **GitHub**: nunca commitear videos/Chromium; si se necesita, LFS (1GB free).

## 9. Referencias en el repo

- `src/components/HtmlContextualPanel.tsx` (subTab `animation`, ~1396)
- `src/pages/EditorV2.tsx` (~6337, control del subTab)
- `netlify/functions/render.mjs` (pipeline HTML→PNG, base para `video-render` en F2)
- `netlify/functions/mcp.mjs` (patrón de tools MCP)
- `docs/PLAYBOOK_MCP_MIRA.md` y `docs/MCP_TOOL_CATALOG_V2.md` (documentar los tools nuevos)
