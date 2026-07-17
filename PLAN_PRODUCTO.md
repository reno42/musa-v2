# PLAN_PRODUCTO — Métricas, grafo de diseño, onboarding, setup y Cover Flow

**Autor:** Claude (Fable 5) · **Fecha:** 2026-07-16 · **Complemento de:** PLAN_EDITOR_CORE.md
**Regla de oro:** nada de esto se lanza antes de que el editor core esté estable (Sprints 0-3).
Se puede *construir* en paralelo porque toca archivos distintos, pero la fluidez es prerequisito
del onboarding y del "editor profesional".

---

## 0. Respuesta al misterio de Supabase (resuelto, no es un bug de datos)

**Pregunta**: "Settings dice que no está conectado a Supabase, ¿cómo es que muestra los datos?"

**Respuesta**: hay DOS planos con variables distintas:

| Plano | Quién lo usa | Variables | Estado en prod |
|---|---|---|---|
| **Datos** (todo el CRUD) | Funciones de Netlify / api server | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (server-side) | ✅ Conectado — por eso ves los datos |
| **Realtime** (colaboración en vivo, presencia) | El navegador directamente | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (build-time) | ❌ No configurado — es lo único que el Settings chequea |

El navegador nunca habla con Supabase para los datos: va por `/api` y el servidor es quien
está conectado. El Settings (`Dashboard.tsx:923-925`) solo mira las `VITE_*` → mensaje engañoso.

**Fix (Agente IDE, 0.5 días):**
1. Endpoint `GET /api/health/storage` → `{ supabase: boolean, mode: "supabase"|"memory", realtime: boolean }`
   (el server ya sabe: `getSupabase() !== null`).
2. Settings muestra DOS indicadores: "Persistencia de datos: ✅ Supabase / ⚠️ memoria (se pierde
   al reiniciar)" y "Colaboración en tiempo real: ✅/—".
3. Sí, la integración directa por env vars de Netlify **ya funciona así hoy** — solo estaba mal
   reportada en la UI.

---

## 1. Texto profesional (se integra a PLAN_EDITOR_CORE)

Síntomas: "no siempre se genera el cuadro para escribir" · "no puedo crear textos fuera del frame
pero sí jalarlos afuera" · "necesito escribir, cambiar tamaño/letra/spacing y reemplazar texto rápido".

Causas conocidas:
- `#__df_content` no tiene altura explícita → en frames vacíos o de contenido corto, la mitad
  del área del frame **no recibe clicks** → el cuadro "no se genera" según dónde cliquees.
- La herramienta texto exige `target === content` → clickear sobre cualquier elemento existente
  no hace nada (debería crear encima, como Figma).
- No existe creación a nivel canvas (fuera de frames) para ninguna herramienta.

**Se agregan a PLAN_EDITOR_CORE:**
- **Sprint 0.5**: `#__df_content` con `position:relative; width/height:100%` → toda el área del
  frame recibe herramientas. (1 línea + regresión visual de plantillas existentes.)
- **Sprint 3 (junto a selección)**: texto crea SIEMPRE al click/drag con la herramienta activa,
  sin importar qué haya debajo; edición entra directo (caret visible, texto placeholder
  seleccionado para sobreescribir); `Esc` = confirmar y volver a select.
- **Sprint 3.5 — Flujo de texto rápido**: mini-barra flotante sobre el texto seleccionado
  (fuente, tamaño, peso, spacing, line-height, color) sin ir al panel lateral; atajos ya
  existentes de tamaño/tracking/leading conectados; doble-click en cualquier texto = editar.
- **Fuera del frame**: herramientas sobre canvas vacío crean un **auto-frame** del tamaño del
  elemento (transparente, sin chrome) — así "existe fuera" sin romper el modelo frame-céntrico,
  y jalarlo dentro de otro frame lo re-parenta. (El modelo actual ya soporta jalar afuera;
  esto cierra la simetría.)

---

## 2. Calendario de actividad + métricas reales

**Idea**: heatmap tipo GitHub pero de diseño — cada día pinta según cuánto se diseñó.

**Lo que ya existe** (aprovechar, no inventar):
- `snapshot_auto` guarda snapshots tipados (`ia|human|system`) con timestamp y trigger por
  CADA operación MCP → es literalmente el log de actividad.
- Settings ya calcula `totalFrames` y `estimatedTokens` (Dashboard.tsx:921-922) — embrión de métricas.

**Spec (Agente IDE, 2-3 días):**
1. `GET /api/metrics/activity?from&to` → agrega snapshots + templates creados por día:
   `[{ date, designOps, framesCreated, templatesCreated, byActor: {ia, human} }]`.
   Fuente: tabla de snapshots (ya en Supabase) — solo es un GROUP BY.
2. Heatmap en Settings (o tab "Actividad"): 52 semanas × 7 días, 5 niveles de intensidad,
   tooltip con el detalle; distinguir color humano vs IA (¡tu OPC en una imagen!).
3. Métricas del mes: frames creados, templates, renders del batch, decks.
4. **Tokens**: los tokens reales solo los conoce el agente. Nuevo MCP tool `log_usage`
   (`{tokensIn, tokensOut, model, task}`) que Lara/Opus/yo llamamos al cerrar una tarea →
   se suma por día. Mientras tanto, la estimación actual queda etiquetada como "estimado".

**Aceptación**: el calendario pinta los últimos 30 días reales (los snapshots ya existen);
un batch de 20 se ve como un pico verde ese día.

## 3. "Obsidian de diseño" — el grafo de marcas y procesos

**Idea**: cada marca/tema se etiqueta (humano + IA vía MCP) y el sistema genera conexiones;
llega una marca nueva → "reproduce este proceso con todas estas".

**Insight clave**: la mitad del grafo YA existe sin que nadie etiquete —
`computeStyleFingerprint` (extractor de qoder) da similitud de estilo entre templates, y los
`data-bezier-*`/tokens dan conexiones estructurales. Las etiquetas humanas/IA son la otra mitad.

**Spec por fases:**
- **Fase A (datos, 2 días — Agente IDE)**: campo `tags: string[]` en template
  (`brand:acme`, `tema:navidad`, `formato:story`, `proceso:replicacion-v2`) + MCP tools
  `tag_template`, `untag_template`, `find_templates({tags, similarTo})`. `find_templates`
  combina tags (exacto) + fingerprint (similitud) → "todas las piezas de esta marca y las
  que se le parecen".
- **Fase B (grafo visual, 3-4 días)**: vista "Grafo" en el dashboard — nodos = templates
  (con su thumbnail del primer frame, ya disponible por el listado lean), aristas = tags
  compartidos (color por tipo) y similitud de fingerprint (grosor). Canvas 2D con
  force-layout simple (sin dependencias pesadas; ~200 nodos es trivial en canvas).
- **Fase C (procesos reproducibles)**: un "proceso" = secuencia de snapshots etiquetada
  (`proceso:onboarding-marca`) → `replay_process(templateIds, processTag)` la reproduce
  sobre plantillas nuevas. Esto conecta con el batch existente: el proceso ES la receta.

**Aceptación Fase A**: Lara etiqueta sus 20 del batch vía MCP en una pasada;
`find_templates({tags:["brand:futuraria"]})` los devuelve; con `similarTo` encuentra 3 no etiquetados.

---

## 4. Setup sin fricción — "el usuario te manda un prompt y tú le instalas todo"

### 4.1 Diagnóstico de la landing (revisada hoy — NO publicar sin esto)

| # | Problema | Gravedad |
|---|---|---|
| L1 | La landing y INSTALL.md dicen "Follow the README" — **no existe README.md** en el repo | 🔴 |
| L2 | Paso 3 manda a configurar `VITE_SUPABASE_URL/ANON_KEY` — esas son de REALTIME; la persistencia real usa `SUPABASE_URL`+`SUPABASE_SERVICE_KEY` (`.env.example` sí lo tiene bien) | 🔴 |
| L3 | "the MCP server will auto-initialize your database schema" — no existe auto-init; el schema es SQL manual (`supabase_schema_complete.sql`) | 🔴 promesa falsa |
| L4 | `npm run dev` solo levanta vite; **nadie arranca el api server (:3001)** al que vite proxea `/api` y `/mcp` → usuario fresco = dashboard muerto. Falta `cd api && npm install && npm run dev` o un script raíz `dev:all` | 🔴 |
| L5 | INSTALL.md (guía por fases con PAT) es buena pero también omite el api server y contradice a la landing en el orden | 🟡 |

**Fix mínimo antes de publicar (1 día):**
1. Crear `README.md` raíz: qué es, quickstart de 5 líneas, link a INSTALL.md y SKILL.md.
2. Script raíz `"dev:all": "concurrently \"npm:dev\" \"npm --prefix api run dev\""` (o un
   `scripts/dev.mjs` sin dependencia) y que TODA la doc use `npm run dev:all`.
3. Landing paso 3 corregido: hablar de `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (datos) y
   `VITE_*` como opcional (realtime); quitar "auto-initialize" o implementarlo
   (`node scripts/setup-supabase.mjs` que corre el SQL vía PAT — el INSTALL.md ya pide PAT,
   así que ES implementable: Management API `POST /v1/projects/{ref}/database/query`).
4. Alinear INSTALL.md con lo anterior.

### 4.2 Protocolo de prueba EXACTO (para Opus 4.8 y para Lara)

**Opus 4.8 (Claude Code) — prueba de instalación fría:**
1. `mkdir %TEMP%/futuraria-fresh && cd` ahí (NUNCA el repo de trabajo).
2. Seguir la landing AL PIE DE LA LETRA, paso 1 (el prompt de una línea) — sin usar
   conocimiento previo. Anotar cada punto donde el prompt es insuficiente.
3. Repetir con el camino manual (paso 2): `git clone… npm install… cp .env.example .env…`
   SIN credenciales primero (modo memoria) → checkpoint: dashboard funcional, crear
   workspace + template, todo en memoria.
4. Con Supabase real (proyecto free tier nuevo): correr el SQL del schema, llenar `.env`,
   reiniciar → checkpoint: crear template, reiniciar servidor, el template persiste.
5. Probar el MCP local: `tools/list` + `create_deck` de ejemplo → checkpoint: deck aparece
   en el editor.
6. Entregar: `QA/INSTALL_TEST_REPORT.md` con cada paso ✅/❌ + el diff de doc/scripts que
   lo dejaría en verde. **Criterio de éxito: de máquina limpia a deck creado sin ayuda
   humana más allá de pegar credenciales.**

**Lara (OpenClaw) — prueba de instalación asistida (el caso real de cliente):**
1. Rol: usuario SIN Supabase/Netlify/GitHub. Solo tiene el prompt de la landing.
2. Ejecutar la instalación conversacional: en cada paso donde haga falta una cuenta o
   una credencial, REGISTRAR el momento exacto y qué se le pide al humano.
3. Entregar: el guion "momentos humanos" — la lista mínima de interrupciones (ver 4.3)
   y confirmación de que OpenClaw puede con todo lo demás.

### 4.3 ¿Cuándo se crean cuentas y accesos? (diseño del flujo)

Principio: **local-first, upgrade progresivo**. Nunca pedir cuentas antes de que el usuario
vea valor.

```
Momento 0 — "Pruébalo":   clone + dev:all → editor en memoria. CERO cuentas. (2 min)
Momento 1 — "Me gustó":   persistencia → ÚNICO paso humano real: crear cuenta Supabase
                          (OAuth con GitHub/Google, free tier) y pegar PAT o URL+keys.
                          La IA hace el resto: schema SQL, .env, verificación.
Momento 2 — "Publícalo":  Netlify → cuenta (OAuth GitHub) + `netlify init`; la IA setea
                          env vars con `netlify env:set` y despliega.
Momento 3 — "Mi agente":  API key propia (reemplazar dev-key) + SKILL.md al agente.
```

Las CUENTAS las abre el humano (son suyas: pagos, términos, recovery). TODO lo demás
(schema, env, deploy, MCP, verificación) lo hace la IA. La doc debe decir esto tal cual:
"tu IA te va a pedir exactamente 2 veces que hagas algo: crear la cuenta de Supabase y la
de Netlify. El resto lo hace ella."

---

## 5. Onboarding auto-servido (sin depender de Renzo)

Tu instinto es correcto: **guía conversacional (IA) y guía visual (spotlight) deben ser el
MISMO contenido** — si no, divergen y se pudre una de las dos.

**Arquitectura: un solo archivo de pasos, dos reproductores.**

1. `src/onboarding/tour.json` — pasos declarativos:
   ```json
   { "id": "create-frame", "anchor": "[data-tour='frame-tool']",
     "title": "Crea tu primera hoja",
     "say": "Pulsa F y arrastra en el lienzo…",
     "done_when": { "event": "frame_created" } }
   ```
2. **Reproductor visual** (Agente IDE): spotlight (recorte oscuro sobre el anchor) + popup +
   checklist flotante colapsable con progreso persistido en localStorage. `done_when` se
   valida con eventos reales del editor (no "siguiente, siguiente") → el usuario APRENDE
   HACIENDO, como pediste.
3. **Reproductor IA** (ya casi gratis): MCP tool `get_onboarding_state` → la IA del usuario
   lee el mismo tour.json + el progreso, y guía por chat ("te falta el paso 3, te muestro:
   …") pudiendo además EJECUTAR el paso como demo (crear el frame ella misma y deshacerlo).
4. Contenido v1 (7 pasos): crear frame → dibujar forma → texto y tipografía → mover con
   snap → replicar un diseño con la IA → editar lo que la IA hizo → exportar/batch.

**Dependencia dura**: Sprints 0-3 del editor core. Un tutorial sobre herramientas que fallan
enseña a desconfiar del producto.

---

## 6. Cover Flow (vista iPod) — por qué crasheaba y cómo hacerlo estable

**Diagnóstico del crash**: la versión anterior montaba **editores vivos** en el carrusel —
cada proyecto = DesignFrame completo (shadow DOM + fuentes + imágenes base64 decodificadas +
listeners). 15 proyectos × N frames = memoria/GPU fuera de presupuesto → colapso. El concepto
no es inviable; el costo por ítem lo era.

**Arquitectura estable (la propuesta):**
1. **Solo imágenes en el carrusel.** Cada proyecto se representa por el thumbnail PNG de su
   primer frame. Nada de shadow DOM, nada de iframes con srcDoc (el dashboard hoy usa
   iframes escalados — también hay que migrarlos a PNG).
2. **Pipeline de thumbnails** (pieza reutilizable para dashboard + grafo + cover flow):
   al commitear un template, generar snapshot PNG del primer frame (el mecanismo ya existe:
   `renderFrame` del agent bridge / foreignObject) → subir a Supabase Storage
   (`design-thumbs/{templateId}.png`, ~40KB) → el listado lean devuelve `thumbnailUrl`.
   Fallback: placeholder con el color de fondo.
3. **Virtualización estricta**: solo se montan `centro ± 4` (9 `<img>` máximo, los demás son
   datos). Con 500 proyectos el DOM tiene 9 imágenes.
4. **El 3D es CSS puro sobre esas imágenes**: contenedor con `perspective: 1200px`; cada
   ítem `rotateY(±55°) translateZ(-160px) translateX(i*220px)` según distancia al centro;
   transición `transform 300ms cubic-bezier` — todo composited, cero layout por scroll.
   Navegación: rueda/drag/flechas mueven un índice; snap al centro; click en el central
   abre el editor; `Enter` también.
5. **Presupuesto (assert en QA)**: 60fps con 100 proyectos; memoria < 150MB; primer render
   < 500ms con thumbnails cacheados.

**Owner**: Agente IDE (pipeline de thumbnails primero — 2 días — porque desbloquea dashboard
y grafo; el carrusel después — 2 días). Opus escribe el test de presupuesto con 100 templates
sintéticos ANTES del carrusel.

---

## 7. Orden recomendado y reparto

| Orden | Qué | Owner | Días |
|---|---|---|---|
| 1 | PLAN_EDITOR_CORE Sprints 0-1 (incluye texto 0.5) | Agente IDE + Opus | en curso |
| 2 | Fix Settings/health storage (§0) + README + dev:all + landing corregida (§4.1) | Agente IDE | 1-2 |
| 3 | Prueba de instalación fría + asistida (§4.2) | Opus + Lara | 1 |
| 4 | Pipeline de thumbnails (§6.2) | Agente IDE | 2 |
| 5 | Métricas + calendario (§2) | Agente IDE | 2-3 |
| 6 | Editor core Sprints 2-3 | Agente IDE + Opus + Lara | en curso |
| 7 | Cover Flow (§6) | Agente IDE | 2 |
| 8 | Grafo Fase A+B (§3) | Agente IDE + Lara | 4-5 |
| 9 | Onboarding (§5) — REQUIERE editor estable | Agente IDE + Lara | 4-5 |
| 10 | Grafo Fase C (procesos reproducibles) | todos | 3 |

*Los ítems 2-5 tocan archivos distintos al editor core → van en paralelo sin pisarse
(el protocolo de "zona en cirugía" de PLAN_EDITOR_CORE §6 sigue vigente).*
