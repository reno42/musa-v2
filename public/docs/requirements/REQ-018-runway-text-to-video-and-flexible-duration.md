# REQ-018 — Runway: text-to-video, duración flexible 2-10s y 7 medidas

**Fecha:** 2026-08-27 · **Estado:** implementado

## Problema

1. El panel de video (🎬) solo animaba una imagen seleccionada — no existía
   generación desde prompt puro ("que la IA arme todo desde texto").
2. La duración estaba clavada en 5s/10s pese a que Runway soporta cualquier
   entero 2-10s desde oct-2025 ("Flexible Generation Length").
3. El panel solo ofrecía 3 de las 7 medidas de salida que acepta la API.
4. Nota de alcance: Runway **no permite minutos** — el máximo por generación
   es 10 segundos; para piezas más largas se generan escenas separadas.

## Solución

- **Nuevo MCP tool `generate_text_video`** (catálogo 249 → 250): POST
  `/v1/text_to_video` de Runway con `prompt` (obligatorio), `model`
  (gen4_turbo|gen4.5), `duration` 2-10, `ratio` (7 medidas) y `seed`. Misma
  cadena BYOK que `generate_image_video`; se polea con el mismo
  `generate_image_video_check` (las tareas son agnósticas del modelo).
- **`generate_image_video`**: duración validada como entero 2-10 (antes solo
  5|10); descripciones actualizadas.
- **Panel derecho del editor (videoGen)**: toggle de modo
  "🖼️ Animar imagen" / "✍️ Solo texto". En modo texto el prompt es
  obligatorio (label y placeholder propios), no se requiere imagen, y el
  frame resultante se coloca junto al último frame del lienzo (sin poster).
  Selects de Formato ampliados a las 7 medidas y Duración a 2-10s con hints
  de precio por segundo. El botón y la validación se adaptan al modo.
- **Retry**: el reintento ante "unexpected error" de Runway reusa el tool y
  params del modo activo.

## Seguridad

Sin nuevas tablas ni rutas. La key de Runway sigue la cadena existente
(param por request → BYOK cifrada en servidor → env); nada se almacena nuevo.

## Verificación

- `node --check netlify/functions/mcp.mjs` ✓
- `npm run sync:skill` → "Parsed 250 tools" ✓ (warning live 249→250 esperado
  hasta el deploy)
- `public/.well-known/mcp.json` JSON válido ✓
- `npm run build` verde ✓
- En producción: panel 🎬 → modo "Solo texto" → prompt + duración + formato →
  Generar; y vía IA: `generate_text_video({ prompt, duration: 8, ratio:
  "720:1280" })` → polear con `generate_image_video_check`.
