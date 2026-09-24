# FASE 2 — Ghost Cursor Agéntico + Modos de Operación en Musa

Req para IDE agent. Contexto: fase 1 del ghost ya entregada (coreografía fija, video 44s en `.tmp/mouse-demo/`). Esta fase lo vuelve agéntico (lee la UI y decide paso a paso) y agrega los modos teacher/full + la elección pestaña/paralelo.

# PARTE 0 — Arquitectura validada con Ren (leer antes de tocar nada)

Tres actores operan Musa:
1. **Humano directo** — normal, sin cambios.
2. **Chat de Musa (ChatFAB)** — router clasifica (9ms, ya vivo) → gate ejecuta. Con cursor fantasma visible opcional.
3. **IA propia del usuario** (API/MCP) — server-side, invisible, sin mouse; el usuario refresca para ver cambios. NO es parte de este req (ya existe vía MCP).

El ghost **NO es un segundo agente con sesión aparte** — es un MODO DE PRESENTACIÓN del mismo gate. El chat es la única interfaz. Corrección de diseño validada con Ren: nada de workspaces paralelos con fusión manual.

## Reglas de archivos (crítico — anti-duplicación)
- EDICIÓN sobre lo existente ("agranda el frame 2", "pinta de azul") → edita el archivo actual. CERO archivos nuevos.
- CREACIÓN ("arma un carrusel", "hazme un poster") → 1 archivo nuevo. Como un humano en Canva.
- Recetas largas sobre diseño terminado → editar directo + undo vía tools de versionado existentes. NUNCA copias paralelas que se fusionan después.

## Modos de ritmo (switch fijo en el dock)
```
TEACHER = { cursorMove: 400ms, typingDelay: 80ms/char, pauseRead: 1200ms }
FULL    = { cursorMove: 80ms,  typingDelay: 0 (paste),  pauseRead: 0 }
```
Mismo router, misma ejecución, mismo log — SOLO cambia el ritmo del teatro. Default: TEACHER. Toggle visible en el dock, persistido en localStorage.

## Elección pestaña/paralelo (por pedido, NO switch permanente)
- Pedido de EDICIÓN → siempre tu pestaña, sin preguntar.
- Pedido de CREACIÓN → el gate muestra 2 chips: `[Aquí, viendo a Musa]` / `[En paralelo, mándame el link]`.
- Si la frase contiene intención explícita ("aparte", "en paralelo", "en otro archivo") → ejecutar directo sin preguntar (el router v3+ clasificará esa intención; mientras tanto, regex TEMP como en las recetas).
- Cuando el ghost opera la pestaña: badge flotante `Musa está operando — no toques nada` + botón ABORTAR que cancela la coreografía al instante.

# PARTE 1 — uiObserver.ts

Función que extrae el estado de la UI como TEXTO estructurado (el modelo NUNCA ve screenshots):

```ts
// src/lib/uiObserver.ts
export interface UIElement {
  role: 'button' | 'input' | 'tab' | 'link' | 'canvas' | 'frame' | 'menu' | 'other';
  label: string;        // texto visible / aria-label / title
  selector: string;     // selector CSS estable para ejecutar
  bbox: { x, y, w, h }  // para mover el cursor fantasma
}
export function observeUI(): UIElement[]  // querySelectorAll sobre roles+aria, filtrado a la zona relevante
export function uiToText(els: UIElement[]): string  // "[botón] Enviar\n[input] Pídele algo a Musa\n..."
```

Reglas:
- Selectores estables: preferir `[data-testid]`, `aria-label`, `title` sobre clases generadas. Si un elemento no tiene ninguno, agregárselo al componente React (cambios mínimos permitidos SOLO para esto).
- Límite ~60 elementos por observación (priorizar visibles en viewport + dock).
- Corrida < 20ms (es solo DOM query — nada de layout thrashing).

# PARTE 2 — Loop agéntico

```
observar (uiObserver) → decidir (router v3 cuando exista / LLM hoy) → actuar (clic/type con teatro) → log (chatfab_decisions) → repetir
```

- **Decisor temporal**: mientras el router no tenga clases de acciones-UI, la decisión corre por LLM (el keyless actual sirve para pruebas estructuradas; para QA usar la cuenta QA con key vía `netlify dev`). El prompt del LLM recibe `uiToText()` + el objetivo del paso y devuelve `{action: click|type|scroll|done, selector, text?}`. Toda la lógica del decisor en UN archivo (`src/lib/ghostBrain.ts`) para intercambiarlo por el router ONNX cuando el modelo v3 tenga las clases nuevas.
- **Presupuesto**: máximo 25 pasos por tarea; si no termina, reportar honesto en el chat qué logró y dónde se atascó (con el último uiToText como evidencia).
- **Cada paso se loguea** a `chatfab_decisions` con `session_id` propio del ghost (`ghost_<timestamp>`) — el trace del estilo Jev+Muse sale gratis de ahí.

# PARTE 3 — Teatro del cursor (extensión de la fase 1)

- Reusar el `#ghost-cursor` de `.tmp/mouse-demo/choreography.mjs` — moverlo a `src/lib/ghostCursor.ts` para que sea parte de la app y no solo del script de pruebas.
- Leer timings del objeto TEACHER/FULL según el modo activo.
- Badge de "Musa está operando" + ABORTAR (cancela con limpieza: cursor fade out, badge fuera, log del abort).

# PARTE 4 — Flujo de creación en paralelo (chips)

Cuando el gate clasifica CREACIÓN y no hay intención explícita de "aparte":
1. Responder en el chat con los 2 chips: `[Aquí, viendo a Musa]` / `[En paralelo, mándame el link]`.
2. "Aquí" → coreografía con cursor en la pestaña actual (badge activo).
3. "En paralelo" → ejecutar la MISMA receta headless (sin teatro, mismo gate) y al terminar mandar al chat: `Listo: <nombre> — <link>`.
   - La ejecución paralela usa el mismo usuario/supabase (misma sesión, es su cuenta) — solo sin UI. No requiere segundo browser: el teatro es la única parte que necesita pantalla.

# PARTE 5 — Testing (obligatorio, estándar visible de la casa)

1. **Teacher vs Full**: misma tarea en ambos modos, 2 videos — verificar que SOLO cambia el ritmo (mismos pasos, mismo resultado, logs idénticos).
2. **Creación con chips**: "arma un carrusel de 5 frames del taller" → chips aparecen → probar AMBOS caminos (aquí con video; paralelo con verificación por API del archivo nuevo + mensaje de link).
3. **Edición sin preguntar**: "agranda el frame 2" con ghost activo → edita directo, 0 archivos nuevos (verificar por API que no se creó nada).
4. **Abort**: lanzar coreografía, abortar a mitad → UI limpia, log del abort, sin estado roto.
5. **Límite de pasos**: tarea imposible (pedir algo que requiere 40 pasos) → reporte honesto al chat, sin loop infinito.
6. **Regresión**: la batería de 5 frases instantáneas + los tests de recetas del req anterior siguen en verde.
7. **ghost_perform vía MCP**: con la cuenta QA + key (netlify dev), llamar `ghost_perform({task: "arma un carrusel de 3 frames", mode: "teacher"})` desde un cliente MCP externo → verificar que el cursor actúa en la pestaña abierta (video) y que sin pestaña abierta responde headless + link.

# PARTE 6 — Ghost como tool: `ghost_perform` (cualquier actor puede "enseñar")

El teatro del ghost se expone como tool MCP para que NO solo el chat pueda invocarlo:

```ts
ghost_perform({ task: string, mode: 'teacher' | 'full' })
```

- **Quién lo usa**: la IA propia del usuario (vía MCP con su API key) — resuelve la tarea compleja server-side y luego llama `ghost_perform` en modo teacher para ENSEÑAR al usuario cómo se hace, con el cursor visible en su pestaña.
- **"Enseñar" es un verbo first-class**: los 3 actores (humano por chat, IA por API, y futuras integraciones) pueden pedir "muéstrame cómo se hace X" → ghost sale a escena.
- **Implementación**: envuelve el loop de la Parte 2 + teatro de la Parte 3 con modo como parámetro. La tool es SOLO la capa de presentación — la ejecución real sigue siendo el gate (misma sesión, mismo usuario, mismos logs).
- **Seguridad**: `ghost_perform` vía MCP respeta las mismas reglas de Parte 0 (edición vs creación, badge + abort). Si el usuario no tiene la pestaña abierta, la tool responde con el resultado headless + link (degrada a paralelo, nunca falla raro).

# REGLAS GENERALES

- NO tocar el modelo ONNX, labels.json, ni umbrales.
- El decisor LLM del ghost vive SOLO en `ghostBrain.ts` (intercambiable por router v3).
- Build limpio + cero regresiones. Reportar con videos/screenshots por caso (estándar de la casa: la DB confirma el cerebro; solo los ojos confirman el cuerpo).
- Si algo de la arquitectura de Parte 0 no se puede implementar como está descrito, PARAR y reportar el conflicto — no improvisar una variante silenciosa.
