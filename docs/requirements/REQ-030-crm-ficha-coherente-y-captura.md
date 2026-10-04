# REQ-030 — CRM: ficha coherente (header = timeline), Registrar interacción sin marca, y entrada Captura desde Contactos

> Fuente: dogfood CRM (ChatGPT, 25-sep) contrastado con repo + DB por Hermes. Extiende REQ-029 (que ya define la vista Captura y la ficha-historia) con las causas raíz NUEVAS encontradas en código/DB. Los items de REQ-029 siguen vigentes; este req agrega 3 bugs concretos y precisa el orden.

---

## 1. Causas raíz verificadas (no re-diagnosticar)

### CRM-002 — Header dice "Interacciones 3 · hace 1 día" pero Timeline dice "0 · Sin interacciones"
Verificado en código y DB — el header y el timeline usan DOS FUENTES DISTINTAS:
- El header de la ficha pinta `brand.interaction_count` (CrmWorkspace.tsx:2359): el conteo de interacciones **DE LA MARCA** (saas.ts:1755 — `interactionRows.filter(i => i.brand_id === brand.id)`), no de la persona.
- El timeline consulta `?contactId={id}` (CrmWorkspace.tsx:~2264), que filtra `contact_id` exacto (saas.ts:1486).
- En la DB: QA Hermes tiene 4 interacciones de su marca, pero solo **1 con su `contact_id`** — las otras 3 tienen `contact_id: NULL` (interacciones logueadas a nivel de deal sin contacto principal). Header=4(marca) vs Timeline=1(persona). La ficha no miente por bug de datos: miente porque mezcla métricas de marca y de persona.
- `last_contacted_at` también es de la MARCA (daysSince(brand?.last_contacted_at), línea ~2269) — por eso "hace 1 día" cuando la persona no tiene touchpoints recientes.

### CRM-001 — "Registrar interacción" en Personas no hace nada visible
Verificado en código (CrmWorkspace.tsx:2289): `logInteraction` empieza con `if (!brand) return;` — si el contacto no tiene marca (ej. QA_Contacto Exploracion, brand_id NULL en DB), el submit **muere en silencio**: ni error, ni aviso, ni contador de loading que termine. Además el POST exige `brandId` obligatorio (el endpoint lo requiere para `last_contacted_at`).

### CRM-005 — `get_dashboard_summary workspaceId is required` al cargar Contactos
MISMA causa raíz que BUG-002 del dogfood anterior: `activeWorkspaceId` es null durante el boot (Dashboard.tsx:672) y algún widget del home llama igual. Ya resuelto estructuralmente por REQ-026 Item 2 (`useMcpWidget` con gate `enabled`) — este hallazgo del dogfood es la MISMA raza corriendo en PROD viejo. **No re-arreglar: verificación pendiente del deploy REQ-026.** El agente solo confirma que ningún componente del CRM llame a `get_dashboard_summary` sin gate.

### CRM-003 — Sin entrada a Bandeja/Zernio desde Contactos
Confirmado: las 4 vistas (pipeline/personas/accounts/embudo) no tienen link a Bandeja ni flujo de captura visible. **Ya está resuelto por diseño en REQ-029 Item 2 (vista "Captura")** — este req solo pide verificar que quede registrada en el menú "Secciones de Contactos".

### CRM-004 — Cambio de etapa sin confirmación
El cambio de etapa aplica inmediato por diseño (patrón kanban estándar). PERO el reporte tiene razón en el fondo: no hay feedback de guardado ni undo. Solución ligera: toast "Etapa actualizada: Discovery → Propuesta (Deshacer)" con undo de 5s, en vez de modal de confirmación que frenaría el flujo.

## 2. Items (un item = un commit con verificación citada)

### Item 1 — Una sola fuente de verdad por ficha (mata CRM-002)
En `PersonDetail` (CrmWorkspace.tsx ~2212-2470):
1. El bloque Comercial deja de pintar `brand.interaction_count`: usar SIEMPRE `interactions.length` (el dato de la persona que ya está en estado). Eliminar el fallback `|| interactions.length` (línea 2359) — es lo que permite mentir.
2. "Último contacto" de la PERSONA: computarlo de `interactions[0]?.interaction_date` (la lista ya viene ordenada desc del server); si no hay, "Sin registro". Dejar el "último contacto de la marca" SOLO en la ficha de marca, etiquetado como tal.
3. Etiquetar explícitamente: "Interacciones (de {nombre})" en el header, y en la ficha de marca "Interacciones de la marca".
4. La historia del header (REQ-029 Item 1) debe construirse con la MISMA lista `interactions` — un solo fetch, una sola verdad.
Verificación: con QA Hermes en pantalla, header y timeline muestran el mismo número. Screenshot antes/después.

### Item 2 — Registrar interacción sin marca + feedback completo (mata CRM-001)
En `logInteraction` (línea ~2288):
1. Si `contact.brand_id` es null: pedir marca mínima en el form (select de marcas del workspace, default "Sin marca") O crear interacción con `brandId: null` si el endpoint lo permite — la ruta recomendada: relajar el endpoint POST `/:id/interactions` (saas.ts:1510) para que `brandId` sea opcional (crear el insert con brand_id null; `last_contacted_at` solo se actualiza si hay marca). Decisión documentada en el commit.
2. Eliminar el `return` silencioso: si no hay marca, el form se muestra deshabilitado con explicación ("Esta persona no tiene marca — elige una o crea la interacción general") — nunca un submit que no hace nada.
3. Feedback completo: estado `logging` deshabilita el botón, éxito → toast + timeline optimista (la interacción aparece de inmediato), error → mensaje con el texto del fallo + reintento. Sin estados mudos en ninguna rama.
Verificación: registrar interacción sobre QA_Contacto Exploracion (sin marca) → aparece en timeline y persiste tras reabrir. Screenshot.

### Item 3 — Toast + undo para cambio de etapa (mejora CRM-004)
1. En el cambio de etapa del deal drawer: toast de éxito con la transición y acción Deshacer de 5 segundos ("Etapa: Discovery → Propuesta · Deshacer"). El undo re-aplica la etapa anterior por la misma vía (PATCH existente).
2. Nada de modales de confirmación: el flujo kanban queda igual de rápido, solo con red de seguridad.
Verificación: cambiar etapa → toast visible → Deshacer funciona → el estado vuelve. Screenshot.

### Item 4 — REQ-029 integración + verificación CRM-003/005
1. Ejecutar los items de REQ-029 pendientes (vista Captura, ficha-historia, cadena capture→timeline) — este req NO los duplica, los absorbe en el orden: REQ-029 Item 1 (ficha) ya cubierto arriba, aquí falta su **Item 2 (vista Captura)** y **Item 3 (cadena)**.
2. Registrar la vista Captura en el menú "Secciones de Contactos" (CRM-003): entrada visible "Captura (Bandeja social)" con contador de items nuevos.
3. Confirmar que ningún path del CRM llama `get_dashboard_summary` sin gate (CRM-005) — grep + lectura; el fix raíz ya está en REQ-026.
Verificación: desde Contactos se llega a la Bandeja en 1 click; grep sin llamadas sin gate.

### Item 5 — Tests
1. Test de coherencia: dado un contacto con interacciones de marca pero pocas propias, header y timeline pintan el mismo número (regression de CRM-002).
2. Test del endpoint POST con brandId null (si se relajó).
3. Test del undo de etapa (el PATCH inverso se dispara con los valores correctos).
4. `tsc` + `node --check` limpios.

## 3. Reglas (no negociables)
- Un item = un commit con verificación citada. Sin dependencias nuevas.
- NO tocar: `express-shim.js`, `llmProxy.ts`, BYOK/DeepSeek, `ghost_perform`, las 38 piezas del calendario.
- Datos QA existentes en prod (`QA Hermes`, `QA_Contacto Exploracion`, `QA_Contactos_Deal`) son evidencia de dogfood — NO borrarlos por código.
- NADA pusheado sin orden explícita de Ren.

## 4. Definición de Done
- [ ] Ficha de persona: header y timeline SIEMPRE muestran el mismo conteo; "último contacto" es de la persona; etiquetas explícitas persona vs marca.
- [ ] Registrar interacción funciona en contactos sin marca; cero submits mudos; feedback completo éxito/error.
- [ ] Cambio de etapa con toast + Deshacer funcional.
- [ ] Vista Captura accesible desde el menú de Contactos con contador de nuevos.
- [ ] Cadena Zernio→captura→timeline del REQ-029 verificada (2 comentarios mismo autor = 1 contacto, 2 interacciones con origen).
- [ ] Grep confirma cero llamadas sin gate a get_dashboard_summary en paths del CRM.
- [ ] Tests Item 5 verdes; tsc limpio; commits organizados; nada pusheado.

---

## 5. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-030-crm-ficha-coherente-y-captura.md` completo, que absorbe los items pendientes de `REQ-029-crm-captura-y-ficha-legible.md` (vista Captura + cadena capture→timeline). Ambos docs son tuyos; si hay conflicto, manda este.

Causas raíz YA verificadas en código y DB — no re-diagnostiques:
- CRM-002: el header pinta `brand.interaction_count` (conteo DE LA MARCA, computado en saas.ts:1755) mientras el timeline filtra `contact_id` (saas.ts:1486). QA Hermes en DB: 4 interacciones de marca, 1 con su contact_id — por eso header≠timeline. Fix: una sola fuente (`interactions.length` del fetch por contacto), ver §2 Item 1.
- CRM-001: `logInteraction` arranca con `if (!brand) return;` (CrmWorkspace.tsx:2289) — submit mudo para contactos sin marca (QA_Contacto Exploracion tiene brand_id NULL en DB). Fix en §2 Item 2, incluyendo relajar el POST `/:id/interactions` (saas.ts:1510) si decides que brandId sea opcional — documenta la decisión.
- CRM-005: mismo bug de boot que REQ-026 ya arregló (gate `enabled` en useMcpWidget) — solo GREP-verifica que el CRM no tenga llamadas sin gate.
- REQ-029 ya mapeó las tools/endpoints de Bandeja a reusar: `capture_social_inbox_item` (mcp.mjs:5362), `reply_social`, endpoints `/api/content/integrations/social/zernio/inbox*` (mcp.mjs:11138-11180), tabla `crm_interactions` (v45).

Ejecuta: §2 Item 1 → Item 2 → Item 3 → Item 4 (que absorbe REQ-029 Items 2 y 3) → Item 5 (tests). Un item = un commit con verificación citada (comandos + resultados + screenshots cuando aplique). Reglas: sin dependencias nuevas; NO tocar `express-shim.js`, `llmProxy.ts`, BYOK, `ghost_perform`; los datos `QA_*` en prod son evidencia — no borrarlos; NADA pusheado sin orden explícita de Ren.

DoD §4: verifica cada punto con evidencia real. Si algo requiere la Bandeja con datos reales que no puedes ver, decláralo bloqueado con lo verificado hasta ahí — no lo inventes. Reporta: commits + resultado de cada punto del DoD.
