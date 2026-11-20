# REQ-074 — Medios generativos multi-modelo + storyboards + matriz de clientes IA

**Fecha:** 2026-11-20 · **Dueño:** Hermes · **Estado:** en producción (deploy 8a4ffc4d)

## Pedido de Ren (verbatim)
«Ok vamos con los tres primeros huecos, implementa todo lo que necesites y tambien las
integraciones a todos esos modelos y apis que luego en conecta tu ia vas a agregar prompts
para Instinct, Replit y realmente todas las IAs que existen que se pueden conectar a MCPs».

## Qué se construyó
1. **Video generativo (hueco Higgsfield)** — `generate_video_pro` + `generate_video_pro_check`:
   cola multi-modelo de fal.ai (Wan 2.2 Apache-2.0, LTX-2.5 audio nativo, Kling 2.5, MiniMax H3,
   o cualquier queue id de fal). ASYNC submit→poll; el mp4 se persiste solo al bucket
   design-assets (las URLs de proveedores expiran). Resolución de key BYOK estándar:
   `falApiKey` param → BYOK provider `fal` → `FAL_KEY` env.
2. **Edición de imagen (hueco Ideogram)** — `edit_image_pro`: Gemini/Nano Banana por defecto
   (instrucción); `provider:'fal'` habilita Qwen-Image-Edit (Apache-2.0, texto-en-imagen),
   FLUX Kontext (consistencia de personaje) y FLUX Fill (inpaint/outpaint con máscara real).
3. **Guiones + bocetos (hueco storyboard)** — `storyboard_create` (guion → escenas con
   narración/visualPrompt/copy/duración; split auto o escenas explícitas) y
   `storyboard_scene_generate` (visual de una escena: video Wan/LTX/Kling/Runway o keyframe;
   estado del job y resultado viven EN la escena). Tabla `musa_storyboards`
   (supabase_migrations_v87.sql) con RLS espejo de transcripts.
4. **Matriz de clientes IA (hueco Conecta tu IA)** — `ai_connect_prompts` devuelve
   `clientGuides` con 19 clientes (Claude Code/Desktop, Cursor, Windsurf, VS Code, Codex,
   Gemini CLI, Antigravity, ChatGPT, Grok, Copilot Studio, Gemini Enterprise, Hermes,
   OpenClaw, Replit, n8n, LangChain, OpenAI Agents SDK, Vercel AI SDK, genérico), cada uno
   con snippet de conexión + prompt de arranque. La UI de Conecta tu IA tiene tabs nuevos
   y el Paso 4 "Pegá el prompt de arranque".

## Infraestructura
- `worker/runtime/functions/ai-providers.mjs` — módulo nuevo: falSubmit/falPoll/resolveFalKey/
  resolveImageEditKey/persistVideoToAssets (detecta content-type real; mp4/png/jpeg/webp).
- Poll global de fal sin statusUrl: `queue.fal.run/requests/{id}` (no requiere path de modelo).
- SKILL.md catálogo regenerado (503 tools; sync-skill-tools ahora corre en prebuild).
- llms-full.txt: sección "Generative media (multi-model, BYOK)".

## Pendiente (no bloqueado por código)
- **SQL v87**: Ren aplica `supabase_migrations_v87.sql` (Dashboard → SQL Editor, 30 s).
  Sin la tabla, los tools de storyboard responden STORYBOARD_TABLE_MISSING con instrucción.
- **FAL_KEY**: Ren crea cuenta gratis en fal.ai y la guarda como BYOK (provider `fal`) o
  se pasa como env — sin key los tools responden NO_FAL_KEY con instrucción clara.
- Limpieza: borrar la cuenta probe `probe-no-send@futuraria.com` (Authentication → Users).

## Lección registrada
Probar tools de escritura contra prod crea filas reales: usar emails marcados y limpiar
después, o mover el QA a un workspace desechable.
