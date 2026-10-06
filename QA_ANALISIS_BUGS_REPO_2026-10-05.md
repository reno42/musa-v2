# Análisis de la Lista consolidada de bugs QA (2026-10-05) — ubicación en el repo y corrección propuesta

Fuente: `Lista-consolidada-bugs-design-futuraria` (68 entradas: 4 críticas, 18 altas, 29 medias, 12 bajas, 5 pendientes + 4 riesgos abiertos).
Método: contraste bug por bug contra el código del worktree `design-main` (análisis estático; no se mutaron datos ni se desplegó nada). Cada entrada tiene: **Síntoma** (texto de QA), **Dónde** (archivo + líneas verificadas), **Causa raíz** y **Corrección** propuesta.

Convención: las ubicaciones fueron verificadas línea a línea. Donde el análisis estático no alcanza para cerrar el diagnóstico (C-03, A-06, A-12 en su tramo de tecleo, M-04, M-24 preview, B-07, B-08) se marca **[confirmar en runtime]** con el plan de verificación.

## Patrones transversales (arreglan varios bugs a la vez)

1. **Fetch sin credenciales en rutas `/api/*`** (C-01): cualquier `fetch()` directo sin `getApiHeaders()` recibe 401 del middleware (`api/src/middleware/auth.ts` L125). Auditar todos los `fetch("/api/...")` que no pasen por `apiFetch` (`src/lib/supabase.ts`).
2. **Layout shift por indicadores y paneles** (A-09, A-10, M-25, B-10): indicadores sin ancho reservado y paneles que son flex children en vez de overlays.
3. **Overlays de Video/Foto sin responsive** (A-14, A-18): el CSS móvil (`src/index.css` L3413-3480) solo cubre clases `.editor-v2-*`; los overlays usan anchos fijos inline sin `@media`.
4. **Scroll horizontal mal contenido** (A-04, M-06, M-08): celdas con `minWidth` (tabla de ~3077 px en ContentTab) dentro de un contenedor raíz (`.dash-atmosphere`) que queda con `scrollLeft` pegado tras navegar.
5. **Des/undo con varios dueños** (C-04, A-12): el editor, el modo Video y el modo Foto tienen historiales separados y la barra superior sólo rutea al del editor.
6. **Z-index sin portal** (M-04, M-18, M-25): modales/popovers montados inline compiten con la barra superior (z 10) y "Tu plan" (z 8000, `index.css` L3591); la casa ya resuelve esto con portal a body (ver comentario en `src/components/FlowsTab.tsx` L558-560 y `src/components/PeekPanel.tsx` L8-12).

---

## Riesgos abiertos

### R1 · Pieza programada en cola ELSA/LinkedIn (7 oct 2026 10:30)
- **Dónde:** el botón que la creó es `quickSchedule` en `src/components/ContentTab.tsx` (L282-285, L965-1010 aprox.) → `publishContent(row, { mode: "schedule" })`. La entrega real sale por las integraciones sociales (`src/lib/contentCalendar.ts` L316+ `DELETE /integrations/social/:provider` es la ruta hermanita; el envío depende de proveedor externo Zernio/Buffer/LinkedIn).
- **Acción:** la cola es externa al repo: verificar en el panel del proveedor antes del 7/10 que la pieza no salga (fue borrada de la UI; confirmar que el borrado canceló el job o cancelarla a mano).

### R2 · Fragmento de API key en errores del chat (A-02)
- **Dónde:** `api/src/routes/llmProxy.ts` L104-169: el body del upstream se reenvía verbatim (`res.send(text)` L159-167). DeepSeek devuelve 401 con eco de la clave enmascarada.
- **Acción:** aplicar el fix de A-02 (sanitizar) y **rotar la clave de DeepSeek** en Configuración por precaución.

### R3 · Miembro ajeno `qa-reminder-…@example.com` (editor)
- **Dónde:** dato en `workspace_members` (Supabase). El backend sí permite quitarlo: `DELETE /api/.../:id/members/:userId` en `api/src/routes/saas.ts` L648-655 (requiere rol admin; protege al owner).
- **Acción:** Renzo lo confirma y lo quita desde Configuración > Invita colegas (o vía Supabase SQL si la UI lo pide). Auditar cómo entró (¿invitación de prueba de un agente?).

### R4 · Datos de prueba no borrables ("Test Instinct Post", persona de prueba)
- **Dónde:** el archivo de Diseño no se borra por C-02; la persona no se borra por A-08. **El backend ya tiene ambos endpoints** (ver C-02 y A-08), así que la limpieza puede hacerse por API/MCP hoy mismo, sin esperar el fix de UI.

---

## Crítico

### C-01 · Subir audio/imagen al modo Video falla con "Unauthorized"
- **Síntoma (QA):** toast rojo `Audio/Media falló: Unauthorized: sign in or provide a valid workspace API key` con sesión abierta (POST `/api/storage/audio` y `/api/storage/media`).
- **Dónde:** `src/lib/reelUpload.ts` — `uploadReelMedia` L60-95 y `uploadReelAudio` L101-136. Primero intentan subida directa con `browserSupabase.storage.from("design-reels").upload()` envuelta en `catch { /* worker shim next */ }` (el error real se descarta), y luego caen a un `fetch("/api/storage/media" | "/api/storage/audio")` **sin headers de autenticación**. El middleware (`api/src/middleware/auth.ts` L125) responde exactamente el 401 que vio QA. El bucket `design-reels` y sus políticas están bien (`supabase_migrations_v53.sql`), por eso la subida directa del video funciona y sólo audio/media caen al shim.
- **Causa raíz:** fallback sin credenciales + error de la ruta directa tragado en silencio.
- **Corrección:** (1) en los dos fallbacks, mandar `headers: { "Content-Type": "application/json", ...getApiHeaders() }` (`src/lib/apiKey.ts` L40-47); (2) dejar de tragar el error directo: si la subida directa falla con algo que no sea "bucket inaccesible desde el worker", mostralo. En `uploadReelVideo` el mismo patrón existe pero no se dispara porque la ruta directa funciona — corregirlo igual.

### C-02 · Borrar archivo de Diseño (··· > Delete) abre el archivo en vez de borrar
- **Síntoma (QA):** clic/ref/Enter en Delete abre el editor; el archivo nunca se borra.
- **Dónde:** `src/components/Dashboard.tsx` — menú portal `TemplateActionsMenu` L534-601 (item "Delete" L594); handlers `onAction` L1917-1923 y L3493-3505; `confirmDelete` + modal L3520-3607 (checkbox con autoFocus L3563; botón "Eliminar" deshabilitado hasta confirmar L3595); `handleDelete` L1695-1706. Backend: `DELETE /templates/:id` en `api/src/routes/templates.ts` L362, `deleteFromSupabase` en `api/src/services/templates.ts` L299-313.
- **Causa raíz:** cadena de fallos encadenados: (1) la acción/confirmación queda cooptada por el click-through de la tarjeta (el `onClick` de la tarjeta → `onSelectTemplate` L1964-1968 sigue vivo: si el item del menú o la confirmación no cortan propagación/anulan el gesto, termina abriendo el editor); (2) `handleDelete` (L1695-1706) hace `fetch(DELETE)` **sin chequear `res.ok`** y filtra la tarjeta de la UI pase lo que pase (borrado fantasma); (3) el soft-delete del servidor depende de la cadena store+Supabase (`deleteTemplate` L602-608: `sbOk || storeOk`), que en serverless puede devolver `false` en cold start.
- **Corrección:** usar `apiFetch` + `if (!res.ok) throw` antes de tocar la UI; en el modal, `e.stopPropagation()` en todo el árbol y `onKeyDown` propio; loguear el resultado real (`deleteTemplate`) y reintentar la parte Supabase si el store no tuvo éxito. Agregar test E2E del flujo completo (hay base en `QA/editor-interactions/`).

### C-03 · Foto: preview se pone negro y "Aplicar a la capa" guarda imagen negra
- **Síntoma (QA):** WebGL se pone negro tras mover un slider (PNG) o tras Exportar PNG (JPG); no recupera ni reseteando; sin errores en consola; "Aplicar a la capa" persiste el negro.
- **Dónde:** `src/lib/photoEngine.ts` — renderer WebGL2: `preserveDrawingBuffer: true` (constructor L393-446), shader main L300-344 (uniforms de exposición/máscaras sin guards NaN), rutas de readback `buildVariant`/`renderToBlob`. Recuperación de contexto: `PhotoModeOverlay.tsx` L510-551 (`webglcontextlost/restored` re-crea el engine). Salida: `uploadVariant` L2702-2710, `handleApplyToLayer` L2712-2722, `handleExportPng` L2766-2783.
- **Causa raíz:** **[confirmar en runtime]** no es reproducible estáticamente. Sospechosos ordenados: (1) `webglcontextlost` sin restauración completa del contenido (la textura de fuente no se re-subte o el flag `glError` queda y el canvas pinta negro sin tirar error a consola); (2) uniforms NaN (slider o curva LUT produce NaN → fragment shader pinta 0,0,0); (3) readback antes del draw (preserveDrawingBuffer evita el clásico black-canvas de toBlob, pero un `gl.clear` extra entre draw y readback lo reproduce).
- **Corrección:** instrumentar una sola vez: log en `onLost/onRestored`, `gl.getError()` tras draw y tras readback, y validar uniforms (si `!Number.isFinite(v) → 0`). Además: "Aplicar a la capa"/"Exportar PNG" deben **validar el blob** (tamaño > umbral y no-frame-completamente-negro: muestrear píxeles del readback) antes de persistir; si el frame sale negro, abortar con toast y no guardar. Ese guard evita la destrucción de la imagen aunque la causa de fondo tarde más en cazar.

### C-04 · Foto: Deshacer/Rehacer de la barra superior no afectan los ajustes
- **Síntoma (QA):** grano/viñeta/B/N no se revierten con Deshacer/Rehacer de la topbar; sólo el historial de Componer tiene el suyo.
- **Dónde:** `src/pages/EditorV2.tsx` — el handler global de teclado sale si hay overlay abierto (L4542: `if (videoModeOpenRef.current || photoModeOpenRef.current) return;`) y los botones Deshacer/Rehacer de la topbar llaman `handleUndo`/`handleRedo` del **documento del editor** (L4565-4566). El modo Foto tiene su propio undo de receta, interno y con otro binding (`PhotoModeOverlay.tsx` L2806-2893, p.ej. L2812 Ctrl+Z → `undo()` de receta).
- **Causa raíz:** la topbar nunca rutea al historial de foto; el Ctrl+Z global además está cortado por L4542, así que en Foto "no pasa nada" (y si pasara, desharía el documento del editor, no la foto).
- **Corrección:** exponer `undo()/redo()` del overlay de foto (imperative handle por ref, igual que el resto de la casa) y en la topbar: `if (photoModeOpen) photoUndoRef.current?.undo() else handleUndo()`. Lo mismo para Video (ya tiene `onVideoTimelineChange` con undo propio en `videoDocStore.ts`).

---

## Alto

### A-01 · "Programar..." agenda al instante, sin confirmación
- **Dónde:** `src/components/ContentTab.tsx` — comentario L282-285 ("...otherwise Programar is a single click"), `openPublishDialog` L965-980, `quickSchedule` L985+ (agenda directo con `publishContent(row, { mode: "schedule" })` si la fila ya tiene fecha/hora y marca con proveedor resuelto).
- **Causa raíz:** atajo de conveniencia que bypasea el diálogo para filas "completas"; QA lo pulsó creiendo que abriría el diálogo.
- **Corrección:** que `quickSchedule` abra siempre el diálogo prellenado (sin paso extra: un solo "Confirmar"), o al menos un `window.confirm` con cuenta/canal/fecha/copy. El riesgo R1 existió exactamente por esto.

### A-02 · Errores 401 de DeepSeek exponen fragmento de API key; "res.send is not a function"
- **Dónde:** `api/src/routes/llmProxy.ts` — keys del provider adjuntas L104-110; respuesta del upstream reenviada verbatim L159-167 (`res.send(text)`); SSE vía `webResponse`. El texto "Internal error: res.send is not a function" guardado en el historial coincide con el catch del worker (`worker/index.js` L232-237). El shim actual **sí implementa** `res.send` (`worker/express-shim.js` L57-66), así que ese error viene de un bundle viejo desplegado o de otra ruta.
- **Causa raíz:** proxy transparente: cualquier 401 del upstream (con eco de clave enmascarada que DeepSeek incluye en el body) queda textual en el chat.
- **Corrección:** en el proxy, si `status >= 400`, sustituir el body por `{ error: "El proveedor rechazó la request (401). Revisá la clave en Configuración." }` + loguear el detalle server-side (sin la key). Redesplegar el worker actual (elimina el `res.send` histórico) y rotar la clave (R2).

### A-03 · Importar directo (CSV) crea contenido sin revisión
- **Dónde:** `src/components/ContentTab.tsx` — botón "⇧ Importar" L1471-1475 → input oculto L1477-1481 → `importFile` L720-745: parsea (`mapContentImport`) y hace `POST /api/content/import` inmediatamente (L730-733). El mapeo de columnas vive en `src/lib/contentCalendar.ts` (`IMPORT_COLUMNS` L597-602, alias L627-641, loop L687+).
- **Causa raíz:** el flujo directo no tiene el paso de mapeo/vista previa que sí tiene el Asistente (`wizardImport` L747+).
- **Corrección:** unificar: que "⇧ Importar" abra el mismo wizard (ya existe) con el archivo preseleccionado, o intercalar una vista previa con confirmación. Filas creadas en borrador = benigno, pero sin confirmación el usuario no ve qué se importó.

### A-04 · Contenido corrido a la izquierda (~77 px, `.dash-atmosphere` scrollLeft=77)
- **Dónde:** contenedor raíz `.dash-atmosphere` (`src/components/Dashboard.tsx` L2062; CSS `src/index.css` L1732-1749). Las tablas anchas vienen de celdas con `minWidth` que suman ~3077 px (`src/components/ContentTab.tsx` L1683-1783: Tema 170, Copy 220, etc.). El scroll interno de tabla no está contenido, y **nadie resetea `scrollLeft` al cambiar de vista** (`navToTab`/`navToPane` en Dashboard.tsx).
- **Causa raíz:** un gesto (rueda con shift / drag en una tabla 3077 px) scrollea el contenedor raíz; al navegar, el `scrollLeft=77` persiste y el nuevo módulo arranca corrido (títulos cortados, `Personas` en x=-57). Por eso el reload directo se ve bien.
- **Corrección:** (1) en cada cambio de tab/pane, `shellEl.scrollLeft = 0` (y `scrollTop`); (2) contener el scroll horizontal **dentro** del wrapper de cada tabla (el contenedor de tabla debe ser el único scrolleable, con `max-width: 100%`); (3) opcional: `overflow-x: hidden` en `.dash-atmosphere` y scroll en un hijo por vista.

### A-05 · Sin navegación entre módulos en tablet/móvil
- **Dónde:** `src/index.css` L3376-3379: `@media (max-width:1023px) { .dash-nav-tabs { display: none !important; } }`. El editor sí tiene hamburguesa (`.editor-v2-hamburger`, L3334/L3447) y el landing también (L3407), pero **el Dashboard no tiene reemplazo**.
- **Causa raíz:** se ocultó la nav para dar aire, sin menú alternativo.
- **Corrección:** para `≤1023px`, colapsar `.dash-nav-tabs` en un botón hamburguesa (mismo patrón del editor: portal con las `NAV_SECTIONS` de `src/components/Dashboard.tsx` L189-260) o barra inferior fija con las 6 secciones.

### A-06 · Barra superior cortada ~15 px arriba en tablet/móvil; menú de cuenta cortado a la derecha
- **Dónde:** `.dash-header` (estilo `dashHeaderStyle` `Dashboard.tsx` L3620-3627, padding 24px) y su override móvil (`index.css` L3415-3417: `padding: 12px 12px 0`). El menú de cuenta se ancla `position: absolute; right: 0` (L2187-2188) dentro de `.landing-nav-inner` (maxWidth 1200, L2109).
- **Causa raíz:** **[confirmar en runtime]** el recorte de 15 px no se explica por el padding; sospechosos: (1) alguna regla responsive de `.landing-*` (la nav del dashboard reutiliza clases del landing) aplicando margen/transform negativo; (2) el ancho del menú de cuenta (minWidth 200) + safe-area hace overflow a 390 px. Plan: inspeccionar en 390/820 el `getBoundingClientRect()` del header y de `.landing-nav-inner`.
- **Corrección:** quitar cualquier offset negativo heredado y, en móvil, anclar el dropdown de cuenta con `right: 0` **respecto al viewport** (portal) + `max-width: calc(100vw - 24px)`.

### A-07 · Calendario: tarjetas recortadas (40 px, overflow oculto)
- **Dónde:** `src/components/ContentTab.tsx` — grid "fit-to-viewport" L1525-1529 (`height: 100%`, filas `minmax(0,1fr)`), celda `.cal-day` con `overflow: hidden` L1552-1554, tarjetas L1577-1600.
- **Causa raíz:** decisión de diseño "el mes entero sin scroll" (comentario L1526-1528): a 720 px de alto cada semana queda en ~40 px y el `overflow: hidden` recorta las tarjetas.
- **Corrección:** dentro de la celda, permitir scroll propio (`overflow-y: auto`) o mostrar máx. 2-3 tarjetas + chip "+N"; al hacer click en "+N", abrir el peek del día. En móvil, cambiar a lista por día.

### A-08 · Contactos: no existe borrado de personas en la UI
- **Dónde:** `src/components/CrmWorkspace.tsx` — la ficha de persona (drawer, zona L2700-2812) no tiene acción Eliminar (grep "Eliminar" en el archivo: cero resultados); el **backend ya lo soporta**: `DELETE /:id/contacts/:contactId` en `api/src/routes/saas.ts` L1426-1431.
- **Causa raíz:** el endpoint nunca se cableó a la UI.
- **Corrección:** agregar "Eliminar persona" en el footer del drawer y/o menú de fila de la tabla, con confirmación que aclare qué pasa con deals/notas (hoy el delete no limpia referencias: revisar FK/cascade de `crm_contacts` ↔ `crm_deals.primary_contact` antes de exponerlo; si no hay cascade, bloquear con aviso o poner `contact_id = null`).

### A-09 · Layout salta cuando aparece "Guardando…/Guardado"
- **Dónde:** editor: `src/pages/EditorV2.tsx` L7944 (`{saving && <span className="editor-v2-saving">Saving...</span>}` — span **condicional**, sin ancho reservado; CSS L3474 `font-size: 9px`). Video: `src/components/VideoModeOverlay.tsx` L1176-1179 (span con texto que cambia "Guardando…"↔"Guardado" sin `min-width`). Foto: el botón Guardar cambia de ancho con el label.
- **Causa raíz:** nodos que entran/salen o cambian de texto dentro de flexbars → todos los vecinos se desplazan (~11 px medidos por QA).
- **Corrección:** reservar ancho fijo: en editor, render SIEMPRE el span (visibility hidden cuando no guarda) con `display:inline-block; width:64px; text-align:left`; en video/foto, `min-width` sobre el contenedor del estado (p.ej. 62 px) y `font-variant-numeric: tabular-nums`.

### A-10 · Abrir Capas desplaza el lienzo 260 px
- **Dónde:** `src/pages/EditorV2.tsx` L8837-8838 — el panel de capas se monta como **flex child** con `layersDock.panelStyle(260, ...)`; CSS `.editor-v2-layers-panel` (`index.css` L2920-2922: `width:260px; flex-shrink:0`). En móvil ya se vuelve overlay (L3450-3458) pero en desktop no.
- **Causa raíz:** al abrir, el canvas pierde 260 px de ancho → recentra el zoom/frames → todo se corre; la barra flotante (posicionada respecto al canvas) también se mueve.
- **Corrección:** montar el panel como overlay (`position: absolute; right: 0; top: 48px; bottom: 0; z-index` sobre el canvas, con sombra) o mantener el ancho del canvas y permitir solape. Alternativa: reencuadrar el zoom al abrir/cerrar (peor UX).

### A-11 · Selección y herramientas de forma inconsistentes
- **Dónde:** `src/pages/EditorV2.tsx` — `handleAddPrimitive` L3054-3104 y `handleDrawShape` L3107+: tras insertar, sólo el texto recibe tratamiento (L3095 `setAutoEditLayerId(layerId)` + L3096-3102 abre panel contextual); **las formas no se seleccionan** (`selectedLayerIds`/`multiSelectLayerIds` quedan en lo anterior → Capas sigue resaltando la forma previa y los tiradores quedan ahí). Los flyouts del tool rail exigen pre-elegir variante y la pluma no tiene labels (tool rail; agregar `title`/`aria-label`).
- **Corrección:** tras crear forma: `setSelectedLayerIds([layerId])` (o el estado equivalente de selección de capa) + abrir tab contextual, igual que texto. Etiquetar flyouts.

### A-12 · Deshacer/Rehacer incoherentes en el editor
- **Dónde:** creación de texto CON undo: `handleAddPrimitive` L3088-3095 (`store.replaceAllWithUndo`). Escrituras SIN undo conviviendo: `store.replaceAll` en L1207/1226/1677/1707/1745/1753/1758. Autosave inmediato tras cada write (L3094 y pares). Panel contextual queda pegado al layer viejo: L3095 `setAutoEditLayerId` no se limpia al deshacer.
- **Síntoma explicado:** el stack quedó `[..., antes, texto=placeholder]`; el tecleo posterior no empuja entradas propias, así que Ctrl+Z salta a "antes" (el texto desaparece) mientras el panel sigue mostrándolo; Ctrl+Shift+Z re-entra al estado de creación = placeholder ("se perdió el contenido") y el autosave persiste ese placeholder; la selección salta al frame.
- **Corrección:** (1) todo edit de contenido (tecleo/panel) debe pasar por `replaceAllWithUndo` con **coalescing por inactividad** (~500 ms) para no reventar el stack; (2) al `undo/redo`, re-sincronizar `autoEditLayerId`/selección con el documento resultante (si el layer ya no existe, cerrar el panel); (3) no autosavear estados que vengan de redo hasta que el usuario haga un cambio real. **[confirmar en runtime]** cuál es el path exacto del tecleo en canvas (los handlers de texto del shadow DOM) para asegurar que pase por (1).

### A-13 · La pluma deja trazo huérfano (Enter muerto)
- **Dónde:** `src/components/DesignFrame.tsx` — Enter está bindeado al `keydown` del `shadow.host` (L3947-3980; el branch L3977 `Enter → finalizePenPath`), pero el host no es enfocable y el canvas no lo enfoca al hacer click → **Enter nunca llega**. Escape sí cancela (L3966-3973). La ruta tardía: click en vacío / salida de scope finaliza el path (L3305-3308, L3320-3324) y `finalizePenPath` L3983-4001 llama a `onPenPathComplete` → `handleAddPenPath` en `EditorV2.tsx` L3333-3354, que inserta el SVG en **`selectedFrameId`** (L3341-3343), que puede NO ser el frame donde se dibujó → capa "Bezier" fuera del frame (a la izquierda). El preview (`penSvgRef`) sólo se limpia si el HTML del frame se actualiza (L864-867) o con Escape → queda "línea colgada" cuando el insert fue a otro frame.
- **Corrección:** (1) mientras la pluma esté activa, bindear Enter/Escape a `document` (remover al desactivar la herramienta), o `tabindex="-1"` en el host + `.focus()` en el primer click; (2) `handleAddPenPath` debe insertar en el **frame dueño de los puntos** (pasar `frameId` junto a los bounds); (3) limpiar `penPointsRef`/`penSvgRef` en TODAS las salidas (finalize, cancel, tool change, unmount).

### A-14 · Modo Video no usable en móvil/tablet
- **Dónde:** `src/components/VideoModeOverlay.tsx` — layout de columnas con anchos fijos inline (librería izquierda + preview + inspector derecho; ver además `VideoInspector.tsx`, timeline `src/components/video/VideoTimeline.tsx`). El bloque responsive global (`index.css` L3413-3480) sólo toca `.editor-v2-*`; **no hay ninguna regla `@media` para el overlay de video**. Encima, la barra "Mover/Comentar" del editor flotante sigue viva debajo (el overlay no la oculta para video: ver A-17 análogo en L9146).
- **Corrección:** media queries propias del overlay: `≤1023px` colapsar librería a drawer horizontal; `≤767px` apilar preview arriba (aspect fijo) + tabs (Tomas/Texto/Media/Audio/Effects) a pantalla completa y timeline compacta. Ocultar la toolbar flotante del editor mientras el overlay esté abierto (misma línea que A-17).

### A-15 · Foto: el panel Propiedades tapa los ajustes de foto
- **Dónde:** `src/pages/EditorV2.tsx` L9176: `{showRightPanel && !videoModeOpen && (` — el panel derecho se oculta para video pero **no para foto**.
- **Corrección:** `!videoModeOpen && !photoModeOpen` (y al entrar a Foto, recordar/restaurar el estado del panel al salir, si se quiere conservar la preferencia del usuario).

### A-16 · Foto: botones de Recortar tapados por la barra inferior y muertos
- **Dónde:** `src/components/PhotoModeOverlay.tsx` — los controles de recorte se posicionan bajo la imagen con `imgRect.top + imgRect.height + 8` (L3413 aprox.); la barra inferior de salida ("Aplicar a la capa" / "Exportar PNG", L3438-3455) es fija abajo. A 720 px, `imgRect.bottom + 8 + altoControles` cae **debajo** del viewport, bajo la barra → tapados y sin respuesta (los clics los recibe la barra).
- **Corrección:** calcular el espacio disponible: si `imgRect.bottom + ctrlH > window.innerHeight - bottomBarH`, anclar los controles encima de la barra inferior (`position: fixed; bottom: bottomBarH + 8`) o hacer scroll interno del stage. Alternativa simple: subir `imgRect` con `max-height: calc(100vh - topBar - bottomBar - ctrlH)`.

### A-17 · Foto: la barra de herramientas del diseño flota sobre el panel izquierdo
- **Dónde:** `src/pages/EditorV2.tsx` L9146: la toolbar flotante se oculta sólo cuando `videoModeOpen` (`{!videoModeOpen && ...}`); falta el mismo guard para `photoModeOpen`.
- **Corrección:** ocultar con `!videoModeOpen && !photoModeOpen` (idéntico al fix de A-15).

### A-18 · Foto: móvil inutilizable y tablet cortada
- **Dónde:** `src/components/PhotoModeOverlay.tsx` — tres columnas con anchos fijos inline (panel izquierdo de herramientas, stage, inspector `flex: "0 0 268px"` L3459) y **cero `@media`** para el overlay (mismo patrón que A-14). Los controles de recorte además dependen de `imgRect` en px (A-16).
- **Corrección:** `≤1023px`: inspector colapsable (drawer inferior); `≤767px`: apilar stage + tabs de pestañas (Luz/Color/... como chips horizontales scrollables) a full width; recorte con controles anclados al viewport (A-16).

---

## Medio

### M-01 · "Leads capturados" 7d = 0 con lead de hace 1 h
- **Dónde:** `netlify/functions/mcp.mjs` — tool `get_dashboard_summary` (~L21856): `leadsCaptured.total = leads.length` donde `leads = newContacts.filter(c => c.status === "lead")` (~L21892-21893). El lead de QA está hoy en estado **"Inactiva"** → el filtro por estado actual lo excluye aunque su `created_at` esté dentro de la ventana (`newContacts` ya está filtrada por fecha).
- **Corrección:** contar `newContacts.length` (creados en la ventana) para "capturados", y separar la métrica "activos" si interesa el estado. Toca también la tarjeta de `src/components/home/HomeDashboard.tsx` (KPI "Leads capturados" L707) sólo si cambia el contrato.

### M-02 · "+7 más" en "Necesita tu acción" no hace nada
- **Dónde:** `src/components/home/HomeDashboard.tsx` — `PendingWidget` L346+: `shown = items.slice(0,8)` y el "+N más" es un `<span>` plano (L357-359).
- **Corrección:** convertirlo en `<button>` que expanda la lista (o pagine 8/8) con `aria-expanded`; si la intención era navegar, enlazar a la vista de origen del resto.

### M-03 · Click en ficha "Kanban estancada" sólo cambia de vista
- **Dónde:** `src/components/home/HomeDashboard.tsx` L370-372: `PENDING_TARGET[it.source]` navega al módulo/pane pero no pasa el id del item.
- **Corrección:** extender `onNavigate(target, { focusId: it.id })` y en `KanbanTab` aceptar un `initialFocusId` (resaltar + abrir peek de la tarjeta). Mismo tratamiento para los demás orígenes del widget.

### M-04 · La barra de navegación tapa el título del modal "Nueva tarea de diseño"
- **Dónde:** `src/components/KanbanTab.tsx` — botón "+ Nueva" L1273-1281; modal L769-782 (`position: fixed; zIndex: 9100`, **sin portal**, altura sin clamp). La barra superior tiene `zIndex: 10` (`Dashboard.tsx` L3620-3627).
- **Causa raíz:** estáticamente 9100 > 10, pero el modal no está portalado a body (cualquier stacking context ancestro — transform de transición de pane — lo re-clampa) y su altura sin `max-height` desborda hacia arriba en 720 px, dejando el título en la franja del header. **[confirmar en runtime cuál de las dos fue la vista por QA]**
- **Corrección:** portal a `document.body` + `zIndex: 9999` + `maxHeight: calc(100vh - 96px); overflow: auto` (patrón ya documentado en `PeekPanel.tsx` L8-12 / `FlowsTab.tsx` L558-560).

### M-05 · "Ejecutar batch" en Modo REAL sin confirmación
- **Dónde:** `src/components/KanbanTab.tsx` — `runBatch` L652-655 (dispara directo), toggle "Dry run" L1226-1232, botón L1235-1251 (comunica el modo en el `title` y el color, pero en REAL **no pide confirmación**).
- **Corrección:** si `!batchDryRun`, abrir confirmación con costo estimado (nº de tareas × llamadas LLM del pipeline) y checkbox "no volver a preguntar". El DRY RUN queda sin confirmación.

### M-06 · Chat y "Tu plan" flotantes tapan contenido; tablas sin pista de scroll en móvil
- **Dónde:** Chat FAB: `src/components/ChatFAB.tsx` L3652-3680 (FAB vertical fijo `right:0; z 9100`; panel `z 9050`). "Tu plan": `src/components/PersonalizedOnboardingPlan.tsx` L48-49 + CSS `.onboarding-plan` (`index.css` L3591: `position: fixed; right: 18px; bottom: 18px; width: 174px (abierto 340px); z 8000`). No hay `padding-bottom` compensador en las vistas; las tablas mantienen `minWidth` (A-04) sin indicador de scroll.
- **Corrección:** (1) en móvil, mover ambos a una barra inferior única (chat como botón redondo, plan colapsado) con `env(safe-area-inset-bottom)`; (2) mientras existan, dar `padding-bottom: 96px` a los contenedores de vista en `≤767px`; (3) a las tablas con overflow, envolverlas en un contenedor con fade/borde derecho + hint "deslizá".

### M-07 · Calendario tablet: "Publicar" se monta sobre título y hora
- **Dónde:** `src/components/ContentTab.tsx` L1577-1600+ — la tarjeta del evento es una fila flex (`gap: 4`, L1593) con el título/hora truncados y el botón Publicar en la misma fila; sin `flexWrap` ni reservas, en ~700 px de celda el botón pisa el texto.
- **Corrección:** `flexWrap: "wrap"` + `min-width: 0` en el título con ellipsis; o icono de Publicar (SVG, sin texto) en tarjetas < ancho X.

### M-08 · Bandeja y Recetas desbordan en tablet
- **Dónde:** mismas causas que A-04: celdas `minWidth` (ContentTab L1703-1783) y tabla de recetas `src/components/CopyRecipesTab.tsx`; el scroll horizontal existe pero sin contener ni señalizar ("Capturar al CRM"/"Tags" cortados a 820).
- **Corrección:** wrapper de tabla scrolleable con fade lateral (patrón M-06.3) y/o columnas prioritarias (ocultar PROY/REAL bajo un "⋯" en ≤1023).

### M-09 · Popover de Conexiones sociales sale por el borde izquierdo
- **Dónde:** `src/components/ContentTab.tsx` L1222-1226 — popover `position: absolute; right: 0; top: calc(100% + 6px); width: 320` respecto al chip (que vive en la toolbar izquierda de Bandeja): se despliega 320 px **hacia la izquierda** → fuera del viewport.
- **Corrección:** `left: 0` en vez de `right: 0`, o clamp con `getBoundingClientRect()` del botón (patrón de menús de Dashboard: miden `menuPos` antes de abrir, L420-421).

### M-10 · El botón "Asistente" abre el importador
- **Dónde:** `src/components/ContentTab.tsx` L1467-1470 — el chip "⇧ Asistente" hace `setWizardOpen(true)` (wizard de importación asistida, por diseño).
- **Causa raíz:** naming: "Asistente" promete un asistente general.
- **Corrección:** renombrar a "⇧ Importar (asistido)" o construir el asistente real; no puede quedar el label actual.

### M-11 · Borrado de piezas y recetas sin confirmación ni deshacer
- **Dónde:** `src/components/ContentTab.tsx` L2503-2505 (`removeRow(peekRow.id)` directo) y `src/components/CopyRecipesTab.tsx` L445-447 (`remove(peekRow.id)`).
- **Corrección:** confirmación ligera (patrón del modal de delete de Dashboard L3520-3607) + soft-delete con toast "Deshacer" (10 s) llamando al restore, o al menos `window.confirm`. 

### M-12 · `#workspace/copywriting` al recargar vuelve a Inicio
- **Dónde:** routing correcto en `src/lib/appRoute.ts` L172-181; el boot lee el hash para el tab inicial (`src/components/Dashboard.tsx` L723-726). El resincronizado post-login está en `src/App.tsx` L318-345 (`restorable` exige `lastRoute !== "/#workspace"` y contiene `#workspace/` o `template=`) y `routePersistence.ts`.
- **Causa raíz:** **[confirmar en runtime]** QA lo vio en la ronda responsive tras recargar sesión; candidatos: (1) el flujo de auth reescribe la URL a un `targetUrl` guardado con el tab ya perdido (`resolvePostLoginUrl`), (2) `saveCurrentRoute` guardó `/#workspace` en algún punto intermedio (L300-303 `enterWorkspace` normaliza y **borra el tab** del hash) y el restore levantó eso.
- **Corrección:** no normalizar a `/#workspace` al entrar (preservar `#workspace/<tab>`); en `resolvePostLoginUrl`, si la URL actual ya es workspace con tab, priorizarla sobre `lastRoute`. Test: login → navegar a copywriting → recargar → debe seguir.

### M-13 · CSV por Asistente no mapea "Conjunto"
- **Dónde:** `src/lib/contentCalendar.ts` — alias L627-641: sólo `"conjunto de anuncios": "ad_set"`; el header "Conjunto" (usado por QA) no machea y la columna se ignora en silencio (loop L687+ sólo copia columnas mapeadas).
- **Corrección:** agregar `"conjunto": "ad_set"` (y `"ad set"`, `"adset"`) al mapa; y en el wizard, listar columnas **no mapeadas** con warning en la pantalla de mapeo (hoy se descartan calladas).

### M-14 · Ficha dice "Ren null"
- **Dónde:** `src/components/CrmWorkspace.tsx` — concatenación sin guard: cabecera L2130 y drawer h3 L2649 (`{contact.first_name} {contact.last_name}`); el patrón correcto ya existe en el archivo (L1451/L1521: `` `${first} ${last || ""}`.trim() ``).
- **Corrección:** aplicar el mismo helper (extraer `fullName(contact)` y usarlo en las 5 apariciones: L2130, L2649, L950, L1182, L1490).

### M-15 · Ficha de deal desborda su panel
- **Dónde:** `src/components/CrmWorkspace.tsx` — `DealDrawer` L1283+ sobre `InspectorDrawer` con ancho persistido `storageKey="crm-deal-drawer-width"` (L1322-1324); detalle del deal L1143-1172 con form `.crm-form-grid` (L1172) cuyas columnas tienen anchos mínimos pensados para desktop.
- **Corrección:** `.crm-form-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }` (apila según el **panel**, no la ventana) + `min-width: 0` en el drawer + permitir achicar hasta ~360 px. Header con `word-break` para títulos largos.

### M-16 · Ficha pide asignar marca pero no lo permite; no se edita nombre/apellido
- **Dónde:** `src/components/CrmWorkspace.tsx` — "Datos de la persona" sólo trae Cargo/Estado/Correo/Teléfono/Notas (L2795-2810) y la marca es texto de solo lectura (L2777); el Comercial dice "asígnale una" sin acción.
- **Corrección:** en el formulario de persona: input nombre/apellido (PATCH ya existe vía update), y select de marca (las marcas del workspace ya están cargadas en el CRM; usar `CrmSelect`, patrón existente) + acción "Asignar marca" en Comercial cuando `brand_id` esté vacío.

### M-17 · El embudo presenta conteos actuales como conversión
- **Dónde:** `src/lib/crmFunnel.ts` — `buildFunnel` L104-107: `conversionFromPrev = count / previousCount` sobre la **distribución actual**; `endToEnd` L112. UI: `CrmWorkspace.tsx` L2889-2909 ("Simulador del embudo ... conversión total") y tarjetas de `HomeDashboard` ("↓ 0% desde Descubrimiento").
- **Causa raíz:** no hay histórico de movimientos entre etapas; el cociente entre snapshots no es conversión.
- **Corrección corto plazo:** renombrar a "Distribución actual" y quitar el % por etapa (o llamarlo "proporción del pipeline"). Corrección real: registrar transiciones (tabla `crm_deal_stage_events` con `deal_id, from_stage, to_stage, at`) y calcular conversión por cohortes.

### M-18 · Flows: Escape no cierra el modal de Credenciales y reaparece sobre Historial
- **Dónde:** `src/components/FlowsTab.tsx` / `src/components/flows/FlowEditor.tsx` — el modal de credenciales se monta inline y su estado no se desmonta al salir del editor de flow (al cerrar el editor, el modal sigue montado y aparece sobre Historial). No hay handler `Escape` en el modal. (Nota: la casa ya aprendió esto en toasts: L558-560 portal a body z 99999.)
- **Corrección:** portal a body + `onKeyDown` Escape (y click-outside) + asegurar `unmount` al desmontar FlowEditor (el estado del modal no debe vivir por encima del editor). Mismo fix cubre B-11 (validación visible abajo).

### M-19 · Miembro ajeno `qa-reminder-…@example.com` (editor)
- **Dónde:** dato + flujo de invitaciones (`api/src/routes/saas.ts` L618-655). La UI de Invita colegas ya lista miembros; quitar usa el DELETE de L648.
- **Corrección:** acción operativa (R3): Renzo lo quita. Mejora preventiva: en Invita colegas, marcar visualmente los miembros nunca activados (>30 días sin aceptar invitación) para detectar basura.

### M-20 · Video: clips del mismo track se solapan
- **Dónde:** `src/components/video/VideoTimeline.tsx` L677-683 — la fila T (texto/stickers) pinta cada clip con `position: absolute; left: startSec*pps; top: 0`: **todos en la misma fila**, sin asignación de sub-carriles.
- **Corrección:** asignación greedy de sub-lanes por fila libre (igual que la pista de tomas): ordenar por `startSec`, apilar en el primer sub-lane libre, `top = laneIndex * clipH`; altura de la fila = `lanes * clipH`.

### M-21 · Video: panel Efectos inútil sin capas; sin keyframes ni recorte por arrastre
- **Dónde:** `src/components/video/FxLibraryPanel.tsx` L188-190 ("Selecciona una capa en el timeline (V track)"); la pista de capas sólo se llena con presets de animación (`VideoTimeline.tsx`, filas L-*); no existe editor de keyframes ni edge-trim en el doc (`src/lib/videoTimelineDoc.ts`).
- **Causa raíz:** gap de producto, no bug puntual.
- **Corrección mínimo viable:** (1) que la fila L muestre las capas del frame de la toma (no sólo presets) para que Efectos tenga objetivo; (2) edge-trim: handles en los extremos del clip con `trimInSec/trimOutSec` (el modelo de media ya tiene `trimInSec`, ver `videoExport.ts` L1253). Keyframes: funcionalidad nueva, planear aparte.

### M-22 · Video: Transiciones y duplicar toma limitados
- **Dónde:** `FxLibraryPanel.tsx` L167-170 ("Sin toma siguiente" con 1 toma); `VideoModeOverlay.tsx` L787-791 (`"Solo se duplican clips de audio/media/texto"` — duplicar TOMA no está soportado).
- **Corrección:** (1) "Duplicar toma": clonar la toma (mismo frame, `startSec` = fin de la original, offset mínimo) en `videoDocStore`; (2) crear toma nueva desde Video (usar el frame actual como base) para no obligar a volver al Diseño; (3) transición: habilitar cuando exista `nextFrame` — con (1) ya es alcanzable desde Video.

### M-23 · Video: preview chico (282 px) y panel derecho bajo el pliegue; hint pill pisa el preview
- **Dónde:** `src/components/VideoModeOverlay.tsx` — reparto vertical fijo en 720 px: mode bar (L1173+) + preview flex + timeline + inspector `VideoInspector.tsx` (sección "Toma seleccionada" L366-372 queda abajo). El hint pill es un overlay absoluto sobre el borde superior del preview.
- **Corrección:** en alto < 800 px: preview con `min-height` garantizada (~380 px), timeline colapsable a 1 fila de carriles con scroll horizontal, e inspector derecho como **columna scrolleable con las secciones acordeón** (Toma seleccionada arriba). Hint pill: anclar `top: previewTop + 8` calculado, no al borde del contenedor.

### M-24 · Video: caption blanco ilegible y subtítulo en 0 s no aparece
- **Dónde:** default del caption: `VideoModeOverlay.tsx` `addTextClip` L711-718 — `color: "#ffffff", bg: ""` (blanco sin fondo → ilegible sobre lienzo blanco). Render en export: `src/lib/videoExport.ts` L1264-1266 — el predicado `tSec < startSec || tSec >= startSec + duration → skip` **sí incluye t=0**; el faltante en 0 s está en el **preview** o en el primer frame del pipeline **[confirmar en runtime: log del primer `t` muestreado y del estado del doc en ese tick]**. El clip derecho post-split que aparece en 2.02 en vez de 1.55: `splitAtPlayhead` (VideoModeOverlay L732+) y `snap()` de `VideoTimeline` redondean a la grilla de frames — a fps bajo el snap mueve el corte.
- **Corrección:** (1) default legible: `color` auto-contraste (blanco + `bg: "rgba(0,0,0,0.55)"` con padding, o sombra fuerte + `stroke`) y no `bg: ""`; (2) preview: asegurar que el primer tick renderice con `t=0` exacto (no `t=0.04` del primer rAF) y que el doc esté hidratado antes del primer draw; (3) split: no snapear el punto de corte (conservar el playhead exacto) o mostrar el valor real resultante en el toast.

### M-25 · Panel Propiedades salta al seleccionar texto; menú Paneles semitransparente y Escape no lo cierra
- **Dónde:** `src/components/HtmlContextualPanel.tsx` L2102-2107 — la sección "Buscatrazos" sólo se renderiza cuando `!isText && !isGroup` → al seleccionar texto desaparece y el panel salta (~31 px). El cambio de ancho 170.85→181.46 es reflow por carga de fuente (webfont tardía). Nombres truncados "Re…" = ancho 260 de capas (A-10). El cluster "Paneles" (`EditorV2.tsx` L8072-8090) abre un popover inline sin Escape ni fondo opaco.
- **Corrección:** (1) reservar la altura de Buscatrazos (render con `visibility:hidden` en texto) o moverla a sección fija del panel; (2) `font-display: swap` ya debe estar — medir con la fuente precargada en el editor (preload del CSS de fuentes); (3) popover de Paneles: portal + fondo opaco (v53 ya lo hizo para los menús del dashboard, L420-422) + Escape.

### M-26 · Exportar WebM lento, preview sigue corriendo, sin confirmación
- **Dónde:** `src/lib/videoExport.ts` (`exportWithWebCodecs` L377 / `exportWithMediaRecorder` L383, `onProgress`); el caller en `VideoModeOverlay.tsx` no pausa el loop del preview ni muestra toast de éxito (los toasts de la casa: `addToast`, ya usados en split/dup L788).
- **Corrección:** al iniciar export: `setPlaying(false)` + flag `exporting` para pausar el rAF del preview (libera CPU: QA midió competencia); al terminar: `addToast("WebM exportado (nombre.webm)", "success")` + trigger de descarga verificable (`downloadBlob`, `src/lib/download.ts`). Opcional: indicador de progreso ya existe — mantenerlo en la mode bar.

### M-27 · Foto: al entrar selecciona la foto equivocada
- **Dónde:** `src/pages/EditorV2.tsx` `handleOpenPhotoMode` L4450-4475 — si la capa seleccionada no es un `<img>` con `src`, cae a `setPhotoModeTarget(null)` y el overlay elige la **primera foto** (con la receta vieja).
- **Corrección:** si la selección no es foto válida: toast "Seleccioná una imagen para editarla en Foto" y no abrir el modo (o abrir en estado vacío con picker). Nunca fallback silencioso a la primera imagen.

### M-28 · Foto: panel Componer superpuesto
- **Dónde:** `src/components/PhotoModeOverlay.tsx` L3459-3510 — inspector fijo `flex: "0 0 268px"`; en modo compose apila `PhotoComposePanel` + "Historial de la composición" (L3483-3501) en una columna con scroll; el título "Capas" (dentro del panel) y "Guardar composición" compiten por la misma altura; la barra flotante del pincel es fija sobre el stage; el Chat FAB (z 9100) tapa el slider "Peso R" del borde derecho.
- **Corrección:** (1) en compose, colapsar el historial a un acordeón cerrado por defecto; (2) "Guardar composición" como footer fijo del inspector (no flotante sobre botones); (3) barra del pincel: anclarla al borde inferior del stage con margen y ocultarla cuando el inspector recibe focus; (4) respetar el z-ladder de la casa (PeekPanel L8-12) para que nada del overlay quede bajo el FAB — o bajar el FAB en modo foto (el editor ya lo hace para otros paneles).

### M-29 · Foto: importar apila los marcos en 0,0; zoom 100% recorta
- **Dónde:** `src/lib/designImport.ts` (colocación de frames al importar: todos en x=0,y=0) y el zoom inicial del editor (100% en vez de fit) tras importar.
- **Corrección:** al crear N frames, colocarlos en grilla: `x = col * (w + 40), y = row * (h + 40)` (ancho de lienzo = datos de la primera imagen); al terminar el import, disparar `fitToContent()` (el mismo Fit del zoom) en vez de dejar 100%. Nota: el mismo fix beneficia la importación de diseño completo (frames superpuestos).

---

## Bajo

### B-01 · Dos filas sin tema preexistentes (31/08/2026)
- **Dónde:** datos + ausencia de validación: ni `importFile` (`ContentTab.tsx` L720-745) ni `addRow` exigen `topic`; el backend `POST /api/content` tampoco (`api/src/routes/contentCalendar.ts`).
- **Corrección:** requerir `topic` (o marcador "(sin tema)" visible) en creación manual e import; para los datos viejos, limpieza manual o script one-off.

### B-02 · Controles con significado ambiguo (Contactos)
- **Dónde:** `src/components/CrmWorkspace.tsx` — "Ver en embudo/Quitar del embudo" L2178-2181 y L2670-2673 (en realidad hace toggle del **foco de marca** del embudo); "Simulador del embudo" L2889-2909 (sin parámetros); Salud/Relación (datos de marca) renderizados en la ficha de persona.
- **Corrección:** renombrar a "Enfocar marca en embudo"/"Quitar foco"; "Simulador" → "Embudo por marca" u ocultarlo si no tiene parámetros; etiquetar "Salud (de la marca)" o mover al drawer de marca.

### B-03 · Etiquetas mezcladas EN/ES y voseo
- **Dónde:** ejemplos verificados: "cerrás" en la tarjeta de uso (`src/components/Dashboard.tsx` L3087); sliders de foto con labels ingleses (`PhotoModeOverlay.tsx`, pestañas Luz/Color con "Exposure/Contrast/Highlights/Texture/Clarity/Sharpen"); "Discovery" vs "Descubrimiento" (Ventas vs Inicio); "Viewer/Editor/Admin", "Dry run/Backlog/Review" en Flows/Config.
- **Corrección:** barrido de i18n con glosario (ES-419, tuteo): prioridad en labels visibles de foto y embudo; dejar términos técnicos ("Dry run") con tooltip en español.

### B-04 · Barra superior translúcida deja ver el texto debajo
- **Dónde:** `src/components/Dashboard.tsx` L3620-3627 — `dashHeaderStyle.background: "transparent"` (el header no tiene fondo propio; depende del velo L2096-2104).
- **Corrección:** `background: rgba(8,10,16,0.82)` + `backdropFilter: blur(12px)` (mismo acabado glass del resto del dashboard), o mover el header al interior del panel de contenido.

### B-05 · Rejilla de KPIs en tablet deja "Deals abiertos" huérfana
- **Dónde:** `src/components/home/HomeDashboard.tsx` L697 — `grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))`: a 820 px caben 3 → la 4ª sola.
- **Corrección:** `minmax(300px, 1fr)` (fuerza 2×2 en tablet) o media query explícita `≤1023px → repeat(2, 1fr)`.

### B-06 · Kanban titulado "de tareas" pero muestra fichas de contenido
- **Dónde:** `src/components/KanbanTab.tsx` — contador L1218-1219 (`{tasks.length} tareas · vía MCP (studio_list_cards)`) vs el tablero que pinta también las tarjetas de contenido (48 piezas); el título vive en la tarjeta compartida v54 (L1215-1216).
- **Corrección:** separar fuentes: título "Contenido y tareas" con dos contadores, o filtro explícito Contenido | Tareas al tope del tablero.

### B-07 · Foto: sliders lentos (4-12 s por automatización)
- **Dónde:** `src/lib/photoEngine.ts` — cada cambio re-renderiza el frame completo en GPU; los sliders disparan render síncrono por evento de input (sin rAF/throttle); **[confirmar en runtime con Performance panel]** si además hay readback por tick.
- **Corrección:** render en `requestAnimationFrame` coalescido (máx. 1 por frame), y durante el drag aplicar preview a resolución reducida (media resolución) con render full en `change`/pointerup.

### B-08 · Chat: saludo duplicado y fuera de contexto
- **Dónde:** `src/components/ChatFAB.tsx` — saludo hardcodeado L2003 ("Hola. Soy el Leader del Harness. ¿Qué diseño necesitas crear hoy?"); persistencia local L2383 y merge con servidor L2404-2408 (sube `localOnly` = mensajes que el server no vio por `ts+content` → un saludo regenerado con `ts` nuevo puede duplicarse en la sincronización). El texto "¿Qué diseño…?" aparece en todos los módulos.
- **Corrección:** (1) saludo por módulo (tomar el tab activo) y sin auto-guardarlo como mensaje (renderizarlo como placeholder cuando `messages.length === 0`); (2) dedupe por `content` en el merge (si el server ya tiene un asistente con ese texto, no subir el local).
- **Nota QA:** el "Leader del Harness" es contenido propio del sitio, sin instrucciones seguidas — correcto el protocolo aplicado.

### B-09 · Filtros Look duplicados (panel izquierdo y "Toma seleccionada")
- **Dónde:** la librería de Looks se lista en `FxLibraryPanel.tsx` (izquierda) y también en el inspector de la toma (`VideoInspector.tsx`): dos fuentes de la misma lista (`REEL_LOOKS`).
- **Corrección:** una sola ubicación canónica (sugerido: Filtros en el panel izquierdo; en "Toma seleccionada" dejar sólo el estado/quitary con un chip).

### B-10 · Pequeños saltos de layout en Flows/Config
- **Dónde:** Flows: al guardar aparece "Ejecutar" y la barra baja ~3 px (inserción condicional de botón sin reserva) en `FlowEditor.tsx`; Config: la fila de tabs se corre 6 px por la aparición/desaparición del scrollbar vertical (ancho del viewport cambia).
- **Corrección:** (1) reservar el slot del botón (visibility hidden); (2) `scrollbar-gutter: stable` en el contenedor de Config (CSS, 1 línea).

### B-11 · Credenciales: "mínimo 8 caracteres" sin validación visible
- **Dónde:** el modal de credenciales de Flows (M-18): el hint existe pero no hay validación on-blur/on-input.
- **Corrección:** validar `value.length >= 8` en `onChange` con borde/mensaje inline + deshabilitar Guardar hasta cumplir (junto con el fix de M-18).

### B-12 · Elemento oculto "Panel de Gobernanza - trazas de subagentes" fuera de pantalla
- **Dónde:** `src/components/ChatFAB.tsx` L3695 — es el botón de Gobernanza del **header del panel del chat**; con el panel cerrado (`width: 0`, L3676) el header sigue montado y sus hijos quedan en x≈1345 (fuera del viewport de 1280).
- **Corrección:** renderizar el header (y el botón) sólo cuando `open`, o `visibility: hidden` en el contenido cuando `width === 0` (evita también lectores de pantalla sobre contenido invisible).

---

## Pendientes (no confirmados como fallo)

### P-01 · Bandeja sincroniza sola al abrir; costo sin verificar
- **Dónde:** el auto-sync al abrir la Bandeja vive en el mount del inbox (`ContentTab`, pane `inbox` — `COPY_PANES` en `appRoute.ts` L65). **Acción:** auditar si esa sincronización consume créditos del proveedor; si consume, pedir confirmación la primera vez y caché local después.

### P-02 · Exportaciones sin feedback visible
- **Dónde:** todas las descargas usan `downloadBlob` sin toast ni chequeo: `ContentTab.tsx` L502/507/691/705 (CSV/Excel/PPT/plantilla), `HomeDashboard.tsx` L593/598 (reporte CSV/PNG), `EditorV2.tsx` L5214/5677/5703/5785/7628, `PhotoModeOverlay.tsx` export PNG, `FlowsTab.tsx` L278.
- **Corrección:** envolver con helper `downloadWithFeedback(blob, name)` que haga `downloadBlob` + `addToast("Descargado name", "success")` y valide `blob.size > 0`. Un solo punto de cambio (`src/lib/download.ts`).

### P-03 · Buscador de Copys dejó la pestaña en about:blank (1 vez)
- **Dónde:** sin ancla estática (una sola ocurrencia, no reproducida después). **Acción:** reproducir a mano buscando texto largo/vacío; si reaparece, revisar el `window.open`/target del buscador de copys.

### P-04 · Dos botones "Limpiar" superpuestos en el filtro de fechas
- **Dónde:** `src/components/ContentTab.tsx` L1370 ("Limpiar" del rango, dentro del popover) y L1425 ("Limpiar" general, en la toolbar) — pueden quedar visualmente superpuestos cuando el popover está abierto cerca de la toolbar.
- **Corrección:** renombrar el del rango a "Borrar fechas" y/z-index del popover por encima; replicar sólo si se reproduce aislado.

### P-05 · Arrastres y atajos validados sólo con eventos sintéticos
- **Dónde:** no es un bug de código; es deuda de QA. Los caminos implicados ya existen y son reales: drag-reschedule del calendario (`ContentTab.tsx` L1539-1550) y atajos del editor (L4542+).
- **Acción:** pasar de eventos sintéticos a Puppeteer con `page.mouse`/`page.keyboard` reales (los harness de `QA/editor-interactions/` ya usan gestos reales — extender ese patrón).

---

## Plan de corrección sugerido (por oleadas)

**Ola 1 — bloqueantes y riesgo (día 1):** C-01 (auth en `reelUpload.ts`, 10 líneas), A-02 (sanitizar `llmProxy.ts` + redeploy worker + rotar key), C-02 (res.ok + stopPropagation), M-01 (contar `newContacts`), A-15/A-17 (dos guards booleanos en `EditorV2.tsx`), M-27 (no fallback silencioso), R1/R3 (acción operativa).

**Ola 2 — el "mareo" (layout):** A-09 (reservar anchos), A-10 (capas overlay), A-04 (reset scrollLeft + contención de tablas), M-25 (Buscatrazos fijo + portal Paneles), M-04/M-18 (portales + z), B-10 (scrollbar-gutter).

**Ola 3 — editor:** A-11 (selección post-creación), A-13 (Enter en document + frame dueño + cleanup), A-12 (undo coalesced + resync panel), C-04 (ruteo undo/redo foto/video), A-16 (posicionamiento recorte), M-28 (compose layout).

**Ola 4 — responsive (un effort propio):** A-05 (hamburguesa dashboard), A-06, A-14/A-18 (media queries de overlays video/foto), M-06/M-07/M-08 (flotantes + tablas + calendario), A-07 (celdas scroll/+N), B-04/B-05.

**Ola 5 — video y CRM:** M-20 (sub-lanes), M-22/M-21 (duplicar toma, edge-trim), M-23/M-24/M-26 (layout 720px, caption default, export pausa+toast), B-09; M-08/M-14/M-15/M-16/M-17 + A-08 (delete persona con decisión de cascade).

**Ola 6 — pulido:** M-10/M-11/M-12/M-13, B-01..B-08, B-11/B-12, P-01/P-02 (helper de descargas).

---

*Informe generado por análisis estático del worktree; sin cambios de código. Entorno del artefacto: [local design-main]. Las líneas citadas corresponden al estado del árbol al momento del análisis; si otro agente movió código, usar los símbolos como ancla (p.ej. `quickSchedule`, `handleAddPenPath`, `buildFunnel`).*
