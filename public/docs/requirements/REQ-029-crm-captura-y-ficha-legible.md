# REQ-029 — Contactos/CRM: detalle legible + pipeline Zernio→CRM para el community manager

> **Prioridad:** P1 — el CRM "funciona" pero no acompaña el flujo real del community manager.
> **Problema (palabras de Ren):** el detalle de contactos no se entiende ni por su dueño; y el flujo "el CM anota todos los comentarios de Zernio y registra a todos los que interactúan con sus timelines" HOY depende de que el CM haga todo a mano — el sistema lo permite pero no lo AYUDA.
> **Verificado en repo (no re-diagnosticar):**
> - El CRM vive en `src/components/CrmWorkspace.tsx` con 4 vistas: `pipeline | personas | accounts | embudo` (línea 141), montado vía `GraphTab.tsx` bajo el tab Contactos.
> - La ficha de persona (`PersonDetail`, línea ~2314) SÍ tiene: bloque Comercial (relación, salud, prioridad, último contacto, contador de interacciones), formulario "Registrar interacción", datos personales, embudo personal y un **Timeline comercial** (`crm-interaction-list`).
> - Existe el tool MCP `capture_social_inbox_item` (mcp.mjs:5362): convierte el autor de un comentario/mensaje de la Bandeja en contacto (status lead, tags zernio/plataforma, notas con origen+texto, item queda 'capturado' con link, 409 si ya capturado — no duplica). También `list_social_inbox`, `reply_social` (mcp.mjs:11138-11180).
> - Existen `log_interaction` / `list_interactions` (mcp.mjs:5488/5504, case 11360/11380) y tabla `crm_interactions` (migración v45).
> - **Lo que NO existe:** ingesta masiva/automática de comentarios de Zernio a la Bandeja ni vista de Bandeja integrada al flujo diario del CM; la ficha de persona no cuenta la historia "quién es, de dónde vino, qué ha hecho" de forma legible; no hay "una pantalla del CM" que responda ¿a quién capturé hoy, a quién me falta capturar, qué timelines están vivos?

---

## 1. Objetivo (criterio del dueño)

1. Ren abre el detalle de un contacto y ENTIENDE la persona en ≤10 segundos sin que nadie le explique la pantalla.
2. El CM tiene un flujo diario apoyado por el sistema: ver comentarios nuevos de Zernio → capturar autores al CRM en 1 click (ya existe) → ver automáticamente quién ya está capturado, quién falta, y cada contacto con su timeline completo (origen del comentario incluido) — sin escribir nada a mano salvo lo que el CM quiera anotar.
3. Cada comentario capturado deja rastro: origen (post/comentario, plataforma, fecha, texto) queda en el contacto y en su timeline.

## 2. Items de trabajo (un item = un commit con verificación citada)

### Item 1 — Reescribir la ficha de persona (PersonDetail) como "historia de la persona"
Reorganizar `PersonDetail` (CrmWorkspace.tsx ~2314) en bloques narrativos, no en un form de datos:
1. **Header-resumen arriba (lo primero que se lee):** nombre + foto/avatar + 3 chips: `Lead/Cliente` · `origen (zernio/instagram/manual/…)` · `última interacción hace N días`. Una línea de "historia" autogenerada: ej. "Comentó 3 veces en posts de {marca} (primera 12-sep, última 24-sep). Capturado desde Bandeja el 24-sep. Sin deals."
2. **Timeline comercial prominente** (hoy queda abajo, línea ~2416): orden cronológico INVERSO, cada entrada con: fecha legible, tipo (comentario/llamada/nota/deal), texto completo del comentario original (con "ver en Bandeja" si viene de social), y autor del registro. Paginado o "mostrar más" si >15.
3. **Acciones en contexto:** el form "Registrar interacción" vive DENTRO del timeline (como composer al inicio de la lista), no como bloque aparte.
4. **Bloques colapsables** debajo: Datos de la persona, Comercial, Embudo personal — abiertos por defecto solo si tienen contenido.
5. Cero datos inventados: si un campo está vacío, "—" o "Sin registro" (ya existe el patrón, línea ~2359).
Verificación: screenshot del antes/después en el PR/commit; `tsc` limpio.

### Item 2 — Vista "Bandeja del CM" integrada al CRM (una pantalla del flujo diario)
Nueva sub-vista en CrmNavTabs (o panel dentro de `personas` — el agente elige lo menos invasivo y lo documenta): **"Captura"**.
1. Lista los items de la Bandeja social (usa los endpoints Zernio ya existentes: `/api/content/integrations/social/zernio/inbox`) con estado de captura VISIBLE por item: `Nuevo` / `Ya capturado → nombre del contacto` (link a su ficha) / `Respondido`.
2. Acciones por item (reusar `capture_social_inbox_item` y `reply_social` — NO reimplementar backend): **Capturar al CRM** (1 click), **Responder**, **Descartar** (nuevo estado local, opcional), y "Ver contacto" cuando ya está capturado.
3. Barra de resumen arriba: `12 nuevos · 8 capturados hoy · 3 pendientes de responder` — el CM ve su día de un vistazo.
4. Filtros: plataforma (zernio/buffer), estado de captura, fecha.
5. Si el item menciona a una persona YA capturada (mismo autor), el botón dice "Ver contacto" y el item suma la interacción al timeline existente (verificar que capture no duplique — el 409 ya protege; mostrar el contacto real en vez del error).
Verificación: flujo completo en dev con 1 item real de la Bandeja de Ren; screenshots.

### Item 3 — El comentario capturado alimenta el timeline automáticamente
Garantizar la cadena completa (hoy probablemente parcial — verificar y completar):
1. Capture crea contacto + registra 1 interacción con: tipo `comentario`, texto original del comentario, metadata de origen (plataforma, postId/url, fecha del comentario).
2. `PersonDetail` muestra esa interacción con su origen clicable ("ver en Instagram/Bandeja").
3. Interacciones subsiguientes del MISMO autor (nuevos comentarios en la Bandeja del mismo email/autor-id): se suman al timeline del contacto existente (match por autor, no crear segundo contacto). Si el match no es confiable, documentar la regla de matching usada (autor-id de plataforma).
4. Test: capturar 2 comentarios del mismo autor → 1 contacto, 2 interacciones con sus orígenes.
Verificación: test unitario de la cadena + query de verificación a `crm_interactions`.

### Item 4 — Higiene y tests
1. Tests: cadena capture→contacto→timeline (Item 3), y de la barra de resumen (conteos correctos con dataset mock).
2. `tsc` + `node --check` en lo tocado.
3. Sin dependencias nuevas. Sin tocar `express-shim.js`, `llmProxy.ts`, BYOK, ni `ghost_perform`.

## 3. Fuera de alcance (explícito)
- Ingesta AUTOMÁTICA programada de comentarios (webhook/cron que traiga comentarios sin que el CM abra la Bandeja) — es el siguiente paso natural, se plantea como REQ aparte si Ren lo quiere; aquí el flujo es: CM abre Captura → ve lo nuevo.
- Sincronización de DMs privados (privacidad; solo comentarios/menciones públicas de la Bandeja existente).
- Scoring de leads, dedup por email/teléfono (match solo por autor-id de plataforma).
- Cambios al pipeline/embudo (las 4 vistas actuales quedan intactas salvo la ficha del Item 1).

## 4. Definición de Done
- [ ] Ficha de persona: header-resumen + historia autogenerada + timeline con orígenes clicables + composer de interacción dentro del timeline.
- [ ] Vista Captura: lista de items de Bandeja con estado de captura, botones Capturar/Responder/Ver contacto, barra de resumen, filtros.
- [ ] Cadena completa: comentario de Zernio → captura → contacto con timeline que muestra el comentario original + origen clicable.
- [ ] 2 comentarios del mismo autor = 1 contacto con 2 interacciones (test verde).
- [ ] tsc limpio; commits organizados; NADA pusheado sin orden de Ren.

---

## 5. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-029-crm-captura-y-ficha-legible.md` completo. El objetivo de producto: (a) que la ficha de detalle de un contacto se entienda sola en ≤10 segundos, y (b) que el community manager tenga una vista "Captura" donde el flujo diario de comentarios de Zernio → contactos CRM con timelines sea 1 click, no escritura manual.

Contexto verificado que NO debes re-descubrir (todo en el repo):
- CRM: `src/components/CrmWorkspace.tsx` (vistas pipeline/personas/accounts/embudo, línea 141; PersonDetail ~2314 — ya tiene timeline `crm-interaction-list`, form "Registrar interacción", contador de interacciones; tu trabajo es REORGANIZARLO como historia, §2 Item 1).
- Bandeja social: endpoints Zernio `/api/content/integrations/social/zernio/inbox` ya usados por mcp.mjs:11138-11180.
- Tools existentes a REUSAR (no reimplementar backend): `capture_social_inbox_item` (mcp.mjs:5362 — ya crea contacto lead con tags y protege contra duplicados con 409), `reply_social`, `log_interaction`/`list_interactions` (mcp.mjs:5488/5504), tabla `crm_interactions` (v45).
- El backend probablemente ya registra la interacción al capturar: VERIFÍCALO primero (leer el handler de capture); si ya lo hace, el Item 3 es solo UI + matching de autor; si no, agrega el insert con metadata de origen.

Ejecuta los 4 items del §2 EN ORDEN (un item = un commit con verificación citada). Reglas: sin dependencias nuevas; sin tocar `express-shim.js`, `llmProxy.ts`, BYOK, `ghost_perform`; las 4 vistas CRM existentes quedan intactas salvo PersonDetail; NADA pusheado sin orden explícita de Ren.

DoD §4: verifica cada punto con evidencia real (screenshots del antes/después de la ficha, test de la cadena captura→timeline, query de crm_interactions). Si algo requiere datos reales de la Bandeja de Ren que no tienes, decláralo bloqueado con lo verificado hasta ahí — no lo inventes. Reporta: commits + resultado de cada punto del DoD.
