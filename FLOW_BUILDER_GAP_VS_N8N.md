# Flow Builder vs n8n — Gap analysis y plan de paridad

> Pregunta: ¿qué le falta al Flow Builder de Musa para ser "tal cual n8n"?
> Método: inventario verificado de n8n (docs.n8n.io/build/flow-logic + feature breakdown
> de sep 2026) contra el estado real del builder (FlowEditor.tsx + flows-core.mjs).
> Conclusión corta: **no nos falta un clon de n8n; nos faltan ~3 capas del motor y
> ~4 power-features del editor.** Y tenemos cosas que n8n no tiene (diseño, brand,
> library de machines) que NO debemos sacrificar.

## Fuentes

- https://docs.n8n.io/build/flow-logic/ (oficial: branching, merge, loop, wait, sub-workflows, errores)
- "n8n Features: What Can It Actually Do in 2026?" (lowcode.agency, sep 2026)
- Inventario propio del repo: `FlowEditor.tsx`, `netlify/functions/flows-core.mjs`, `src/data/flowLibrary.ts`

---

## 1. Lo que YA tenemos (paridad alcanzada)

| Capacidad n8n | En Musa |
|---|---|
| Canvas infinito con pan/zoom | [OK] lienzo 3×3, zoom ctrl+rueda, trackpad |
| Triggers: manual / webhook / cron | [OK] declarativos + `flow_webhook_rotate` |
| Credentials vault (secretos fuera del flow) | [OK] `flow_credentials_*` |
| Branching condicional | [OK] condition con aristas true/false |
| Historial de ejecuciones con pasos | [OK] `flow_history` |
| Plantillas/prebuilt workflows | [OK] `flow_library_list/instantiate` |
| Import/export de workflows | [OK] `flow_export/import` (JSON) |
| Ejecutar subconjunto con límite de items | Parcial: `maxItems` por nodo |
| Templating de datos entre nodos | [OK] `{{item.x}}` / `{{steps.id.y}}` |
| Habilitar/deshabilitar nodo sin borrarlo | [OK] switch por nodo |
| Ejecución agendada del lado servidor | [OK] `flow_due_check` + cronjobs del harness |

## 2. Lo que nos FALTA (los gaps, por capa)

### Capa A — Editor (canvas power-features) — esfuerzo BAJO, impacto inmediato

| # | Gap en Musa | Cómo lo hace n8n | Prioridad |
|---|---|---|---|
| A1 | Undo/redo solo borra el último elemento | Historial completo: mover, conectar, editar config, borrar | P0 |
| A2 | Sin multi-selección (shift/box) | Box-select, shift-click, mover N nodos juntos | P0 |
| A3 | Sin copiar/pegar/duplicar nodo | Ctrl+C/V, Alt+drag para duplicar | P0 |
| A4 | Sin notas adhesivas | Sticky notes como nodos (documentan el flow) | P1 |
| A5 | Sin buscar nodo en el canvas | Tecla Tab abre búsqueda de nodos; palette filtrable | P0 |
| A6 | Sin grupos colapsables | Seleccionar N → agrupar en caja colapsable | P2 |
| A7 | Atajos de teclado mínimos | Atajos: Supr, Ctrl+Z/Y, Ctrl+C/V, Tab, espacio=pan | P0 |
| A8 | Sin duplicar flow completo | "Duplicar flow" en el board | P1 |
| A9 | Sin mini-mapa ni auto-layout | Mini-mapa, snap a grid, alinear/separar | P2 |

### Capa B — Motor de ejecución (el núcleo de n8n) — esfuerzo MEDIO, es "ser n8n"

| # | Gap en Musa | Cómo lo hace n8n | Prioridad |
|---|---|---|---|
| B1 | Sin retry por nodo | "Retry on fail": N intentos, backoff | P0 |
| B2 | Sin continue-on-fail por nodo | El fallo de un nodo no mata el run; sigue con error como dato | P0 |
| B3 | Sin rama de error por nodo | Cada nodo tiene salida "error" en el canvas (try/catch visual) | P1 |
| B4 | Sin error workflow global | Un flow designado corre cuando cualquier otro falla (+ trigger "error") | P1 |
| B5 | Sin nodo wait/delay | Pausa por tiempo, o esperar callback webhooks, o aprobación humana (human-in-the-loop) | P1 |
| B6 | Sin inspección input/output por nodo EN el canvas | Click en nodo ejecutado → ver JSON de entrada y salida; badge de estado por nodo | P0 |
| B7 | Sin data pinning | Congelar la salida de un nodo para desarrollar río abajo sin re-fetch | P1 |
| B8 | Sin re-run parcial | Re-ejecutar desde un nodo usando datos de la ejecución anterior | P1 |
| B9 | Sin nodo code | Código JS (y Python en n8n) inline con acceso al payload | P2 |
| B10 | Sin variables de entorno/workflow | `$vars`, static data persistente entre runs | P2 |

### Capa C — Lógica de flujo avanzada — esfuerzo MEDIO

| # | Gap en Musa | Cómo lo hace n8n | Prioridad |
|---|---|---|---|
| C1 | Fan-in implícito (ai/report) pero sin Merge real | Nodo Merge con modos: append, combinar por clave, elegir rama | P1 |
| C2 | Sin loop/batches | "Loop Over Items": procesar en lotes de N con salida loop/done | P1 |
| C3 | Sin Switch multi-rama | Rutas 1..N por valor (condition solo es binaria) | P1 |
| C4 | Sin sub-workflows | Nodo "Execute Workflow" + trigger de sub-workflow; y "convertir selección a sub-flow" | P2 |
| C5 | Sin comparar datasets | Compare Datasets para diffs entre fuentes | P3 |
| C6 | Sin semántica de orden de ramas | Regla documentada de ejecución (profundidad, rama 1 primero) | P2 |

### Capa D — Gestión y equipo — esfuerzo BAJO/MEDIO

| # | Gap en Musa | Cómo lo hace n8n | Prioridad |
|---|---|---|---|
| D1 | Sin tags/carpetas de flows | Organizar por equipo/proyecto/cliente | P1 |
| D2 | Sin versionado DE EDICIÓN de flows | History + rollback (tenemos versiones de templates, no de flows) | P1 |
| D3 | Sin re-run de ejecución fallida | Abrir run fallido → "retry" con los mismos datos | P1 |
| D4 | Sin permisos por flow | Owner/Admin/Member por workflow (nosotros: workspace roles + share por flow) | P2 |
| D5 | Sin cola/workers | Queue mode para volumen: workers consumen ejecuciones | P3 (cuando haya volumen real) |
| D6 | Sin notificación de fallos | Alertas (Slack/email) cuando un cron falla — podemos usar `harness_report_error` + report | P1 |

### Capa E — IA e integraciones (donde vamos a SUPERAR a n8n)

| # | Gap en Musa | Referencia n8n | Prioridad |
|---|---|---|---|
| E1 | Nodo ai solo genera texto | LLM nodes + structured output (JSON schema validado) | P1 |
| E2 | Sin agente con tools | AI Agent node: el modelo llama tools en loop | P2 — pero con el nodo `tool` genérico (ideas doc) podemos dar el salto antes |
| E3 | Sin memoria de agente | Memory short/long-term entre runs | P2 |
| E4 | Sin más triggers de apps | Triggers de apps (polling). Nosotros: fuente RSS/HTTP/X ya; sumar inbox social, calendar, CRM como triggers | P1 — son MÓDULOS PROPIOS, ventaja vertical |
| E5 | Sin nodo HTTP con auth completa | HTTP Request con headers/OAuth/paginación | P1 |

## 3. Lo que NO copiamos (nuestra diferenciación)

1. **Nodo template/render**: en n8n no existe generar piezas de diseño ejecutables.
2. **Brand system en el motor**: validate/auto_fix/apply_brand como nodos — nadie lo tiene.
3. **Library de machines** (doc FLOW_MACHINES_50_IDEAS.md): n8n tiene templates estáticos, no machines verticales de diseño.
4. **Editor de diseño + builder en el mismo producto**: el flow produce archivos editables, no solo datos.

El objetivo no es parity total: es **paridad de motor + UX estándar**, y ganar en la capa de diseño.

---

## 4. Plan de construcción (fases)

### Fase 0 — Editor power-features (1 semana aprox) → Capa A
1. A1+A7: undo/redo completo (stack de snapshots del grafo: nodes+edges+entry+trigger) + atajos (Supr, Ctrl+Z/Y, Ctrl+C/V, Tab).
2. A3: duplicar nodo (Ctrl+D / Alt+drag) y A8 duplicar flow en el board.
3. A2: multi-selección (shift-click + box-select) con drag grupal.
4. A5: búsqueda de nodos en palette (filtro + Tab para abrir).
5. A4: sticky notes (nodo visual sin ejecución).
Criterio de aceptación: armar y retocar un flow de 10 nodos sin tocar el mouse más de lo necesario; req027 sigue 29/2.

### Fase 1 — Motor de confiabilidad (1-2 semanas) → Capa B (el corazón)
1. B1+B2: `retry` (N intentos, backoff) y `continueOnFail` por nodo en flow_save + engine (`flows-core.mjs`).
2. B3: salida de error por nodo (arista roja punteada) + B4 error workflow (trigger tipo "error").
3. B6: inspección por nodo: al abrir un run del Historial, click en nodo → input/output JSON; badge verde/rojo por nodo en el canvas del run.
4. B7: data pinning (congelar salida de nodo, flag en flow_run).
5. D6: alerta de fallo de cron vía report + harness_report_error.
Criterio de aceptación: un flow con fetch inestable se recupera solo; un run fallido se depura sin salir del editor.

### Fase 2 — Lógica avanzada (1-2 semanas) → Capa C + resto B
1. C3: nodo switch multi-rama.
2. C2: nodo loop (batches de N, salidas loop/done).
3. C1: nodo merge (append / por clave).
4. B5: nodo wait (segundos, o "esperar webhook de continuación") → habilita human-in-the-loop.
5. C4: nodo sub-flow (ejecutar otro flow por id, con inputs) + "convertir selección en sub-flow".
6. B9: nodo code (JS, sandbox: sin red salvo fetch con timeout, sin require).
Criterio de aceptación: la machine "propuesta express" (ideas #37) corre completa con loop por slides y sub-flow de marca.

### Fase 3 — Gestión (1 semana) → Capa D
1. D1 tags/carpetas + D2 versionado de flows con rollback (snapshot por save, diff visual).
2. D3 re-run de ejecución fallida desde el Historial.
3. D4 permisos por flow (roles de workspace) + compartir por enlace.
Criterio de aceptación: un equipo de 3 edita el mismo workspace sin pisarse; rollback a la versión de ayer en 2 clics.

### Fase 4 — IA agéntica y escala (posterior) → Capa E
1. E1 structured output en nodo ai (JSON schema).
2. E2 nodo agent con tools = el nodo `tool` genérico de las 50 ideas + loop de tool-calling con nuestros MCP tools.
3. E3 memoria por flow (últimos N runs / notas del brain).
4. D5 queue mode si aparece volumen (hoy Netlify functions + cron alcanzan).
Criterio de aceptación: "Inbox respondedor" (ideas #41) funciona end-to-end con aprobación humana (wait node).

## 5. Resumen de esfuerzo

| Fase | Qué desbloquea | Esfuerzo | Depende de |
|---|---|---|---|
| 0 Editor | Comodidad de armado (A1-A9) | ~1 semana | nada |
| 1 Motor | Confiabilidad de producción (B1-B7) | 1-2 semanas | nada (paralelizable con 0) |
| 2 Lógica | Flows complejos reales (C1-C4, B5, B9) | 1-2 semanas | Fase 1 (engine de errores) |
| 3 Gestión | Trabajo en equipo + versionado (D1-D4) | ~1 semana | nada |
| 4 IA/Escala | Agentes con tools (E1-E3) | 2+ semanas | nodo `tool` (ideas doc) |

Ruta recomendada: **Fase 0 y Fase 1 primero** (la 0 hace que armar flujos dé gusto; la 1 es
lo que hace que un cliente confíe en dejarlos corriendo solos). Fase 2 habilita las ideas
"complejas" de la biblioteca; Fase 4 convierte al builder en plataforma de agentes.
