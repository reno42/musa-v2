# REQ-027 — Dogfood QA editor full-tools: fix Ctrl+D, PDF CMYK sin salida, y visibilidad de features

> Fuente: dogfood de cobertura 41 ítems (24-sep, sesión `QA_Explorador_Total`, tpl_34450318-e8b) contrastado con el repo por Hermes.
> Veredicto del contraste: los 2 bugs confirmados son REALES y con causa raíz localizada. Los ⚠ "no localizado" de la matriz son en su mayoría features QUE SÍ EXISTEN pero están escondidas en el menú contextual (click derecho) — el problema es de descubribilidad, no de ausencia. BUG-003 (DeepSeek 401) es dueño de REQ-025.1: NO se toca aquí.

---

## 1. Verificación de los hallazgos (no re-diagnosticar)

### BUG-001 — PDF CMYK se queda en "Preparando motor de imprenta…" — CONFIRMADO como riesgo de hang sin timeout ni salida
Causa raíz (verificada en código y prod):
- El motor es Ghostscript WASM de 16MB (`public/assets/print-engine/gs.wasm`, 16,177,271 bytes) que se descarga y compila en un Web Worker la PRIMERA vez que se exporta CMYK (`src/workers/ghostscript.worker.ts:42-75`, `src/lib/cmykEngine.ts:29-56`).
- Los assets SÍ están en prod y con MIME correcto (verificado: manifest.json ok:true, gs.wasm → 200 `application/wasm`, ISOcoated_v2_300_eci.icc → 200 `application/vnd.iccprofile`). NO es problema de deploy.
- El fallo: si la compilación del WASM tarda (hardware modesto: 10-30s es NORMAL para 16MB) o si `WebAssembly.instantiate` falla sin rechazar la promesa (patrón fire-and-forget en `ghostscript.worker.ts:69-72` — el `success()` callback puede no llamarse nunca), NO HAY NINGÚN timeout: `postJob` (`cmykEngine.ts:60-73`) queda colgado para siempre. `busy` queda true → el botón ✕ está `disabled={busy}` (`PrintExportDialog.tsx:234`) → el modal es irrecuperable sin recargar. Exactamente lo que vio el QA.
- Agravante: el progreso real (porcentaje de descarga que el worker SÍ emite vía `engine-progress`) se descarta en la UI — `PrintExportDialog.tsx:475` muestra "Preparando motor de imprenta…" estático e ignora `progress.message` que trae el %.

### BUG-002 — Ctrl+D duplica el frame en vez del objeto — CONFIRMADO, línea exacta
- `src/pages/EditorV2.tsx:4255`: `if (mod && e.key === "d" && !e.shiftKey) { duplicateFrame(); return; }` — corre SIEMPRE, aunque haya un `selectedElement`.
- El duplicado de elemento existe pero está relegado a Ctrl+Shift+D (línea 4258). Comportamiento estándar de la industria (Figma/Illustrator): Ctrl+D duplica la SELECCIÓN, sea objeto o frame.

### Matriz de cobertura — los "no localizado" contrastados contra el repo
| Ítem QA | Veredicto repo |
|---|---|
| Boolean ops (#32) | SÍ EXISTE: menú contextual → "Unir/Restar/Intersecar/Excluir formas" (`CanvasContextMenu.tsx:149-152`, atajos Ctrl+Alt+U/S/I/E) |
| Agrupar (#27) | SÍ EXISTE: menú contextual → Agrupar/Desagrupar/Desagrupar todo (`CanvasContextMenu.tsx:143-145`, Ctrl+G) |
| Orden Z (#28) | SÍ EXISTE: menú contextual → Bring forward/backward/front/back (`CanvasContextMenu.tsx:138-141`) |
| Bloquear (#30) | SÍ EXISTE: menú contextual → Lock/Unlock (`CanvasContextMenu.tsx:156`); lógica en `EditorV2.tsx:5440` |
| Máscara (#22) | SÍ EXISTE: menú contextual → bloque "Crear selección/Invertir/Eliminar exterior/Rellenar" (`CanvasContextMenu.tsx:126-129`) |
| Blend modes (#21) | PARCIAL: solo checkbox "Sobreimprimir" (multiply) en `HtmlContextualPanel.tsx:2303`; no hay selector de los 16 modos. Gap real de UI |
| Dashed stroke (#20) | El modelo de datos lo soporta (`strokeDasharray` en `EditorV2.tsx:224,831,2792`) pero NO hay control en el panel. Gap real de UI |
| Sombra interior (#17) | Pendiente confirmar en `HtmlContextualPanel.tsx` (existe box-shadow/inset en el modelo CSS) |
| Zoom máx 500 (#35) | INTENCIONAL: `MAX_ZOOM = 5` en `EditorV2.tsx:172`. No es bug — decidir si se sube el tope |
| Filtro de capas (#34) | No encontrado en el repo. Gap real |
| Escala numérica (#24) | Campos X/Y/W/H existen; "escala %" dedicada no. Gap menor de UX |

**Conclusión:** el editor tiene las features pero viven escondidas en el menú contextual. El QA de ChatGPT no las encontró porque no hay puntos de entrada visibles (sin botones en toolbar/panel para boolean/group/z-order/lock/mask).

## 2. Items para el IDE agent (en orden de prioridad)

### Item 1 — Matar el hang del motor de imprenta (BUG-001)
En `src/lib/cmykEngine.ts` + `src/components/PrintExportDialog.tsx`:
1. **Timeout de init:** envolver `ensurePrintEngine` con timeout de 60s → si no termina, rechazar con error claro: "El motor de imprenta tardó demasiado en prepararse (descarga 16MB + compilación WASM). Intenta de nuevo — la segunda vez es instantánea."
2. **Fix del patrón fire-and-forget:** en `ghostscript.worker.ts:69-72`, `instantiateWasm` debe capturar el rechazo de `WebAssembly.instantiate(...).catch(err => /* post job-error con jobId -1 */)` — hoy si falla, nadie rechaza la promesa y el modal cuelga.
3. **Mostrar el progreso real:** en `PrintExportDialog.tsx:475`, usar `progress.message` cuando phase==="preparing" y exista (ya llega "42%"): `Preparando motor de imprenta… ${progress.message}`. Y añadir tip fijo: "Primera vez: descarga 16MB (~10-30s según conexión)".
4. **Modal siempre cerrable:** quitar `disabled={busy}` del botón ✕ (línea 234) — cerrar el modal debe abortar/ignorar el job en curso, no quedarse atrapado. Si el job termina tras cerrar, guardar el resultado en cache silenciosamente o descartarlo.
5. **Cache del engine ready:** tras un init exitoso, persistir un flag en localStorage (`print_engine_ready`) para mostrar "Motor listo" instantáneo en las siguientes visitas (el worker igual re-valida).

### Item 2 — Ctrl+D duplica la selección (BUG-002)
En `src/pages/EditorV2.tsx:4255`: si `selectedElement` existe → `handleDuplicateElement(selectedElement.layerId)`; solo si no hay elemento → `duplicateFrame()`. Ctrl+Shift+D mantiene su comportamiento actual (duplicar elemento explícitamente). Verificación: con un rectángulo seleccionado, Ctrl+D crea OTRO rectángulo (contador de frames sin cambio); sin selección, Ctrl+D duplica el frame.

### Item 3 — Descubribilidad de features existentes (los ⚠ de la matriz)
1. Añadir a la toolbar o al panel contextual botones/accesos directos VISIBLES para: boolean ops (unición/resta/intersección/exclusión), agrupar/desagrupar, orden Z (4 botones), lock/unlock, y crear máscara. Hoy todo vive solo en click derecho (`CanvasContextMenu.tsx`).
2. Añadir control de **stroke dashed** en el panel de propiedades (el dato ya existe: `strokeDasharray`; falta el input — presets: none / 4,4 / 8,8 / 2,6).
3. Añadir **selector de blend mode** completo (dropdown con los modos CSS: normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity) — hoy solo existe el checkbox multiply (`HtmlContextualPanel.tsx:2303`).
4. **Filtro/buscador de capas** en el panel Layers (input que filtra por nombre).
5. Cada ítem genera commit aparte o un commit agrupado con lista explícita — citar el grep de verificación.

### Item 4 — Descarga verificable (arreglo prioritario #4 del QA)
Al terminar cualquier export (PNG/PDF RGB/CMYK): toast de confirmación con nombre de archivo + tamaño en KB/MB (`triggerDownload` ya sabe el bytes length — pasarlo a la UI). Si bytes === 0 → error en vez de toast de éxito.

### Item 5 — Tests
1. Test del timeout de init del motor (mock de worker que nunca responde → promesa rechaza a los 60s con mensaje claro).
2. Test de Ctrl+D: elemento seleccionado → duplica elemento; sin selección → duplica frame.
3. `tsc` limpio.

## 3. Reglas (no negociables)
- Un item = un commit con verificación citada (comandos y resultados).
- Sin dependencias nuevas. Sin tocar `llmProxy.ts`, BYOK/DeepSeek (dueño: REQ-025.1) ni `express-shim.js`.
- NO pushear sin orden explícita de Ren.
- Zoom máximo: NO tocar (decisión de producto aparte).
- El archivo `QA_Explorador_Total` en prod es evidencia — no borrarlo desde código/migraciones.

## 4. Fuera de alcance de este req (quedan anotados como gaps de producto)
- Sombra interior: verificar y si no existe, REQ aparte.
- Escala numérica % dedicada: UX menor, REQ aparte.
- Revisar tope de zoom MAX_ZOOM=5: decisión de producto, no bug.
- BUG-003 DeepSeek: dueño REQ-025.1 (preflight + telemetría). Aquí solo aplica su conclusión: los errores históricos del chat no deben re-mostrarse como ejecuciones nuevas (si el equipo de REQ-025.1 quiere, Item 2 de ese req ya cubre el preflight).

---

## 5. Definición de Done
- [ ] Export CMYK: modal muestra % real de descarga del motor; timeout a los 60s con mensaje accionable; ✕ siempre cerrable; segundo intento no re-descarga.
- [ ] Ctrl+D con elemento seleccionado duplica el ELEMENTO (contador de frames sin cambio); sin selección duplica frame.
- [ ] Toolbar/panel tiene entrada visible para: boolean, agrupar, orden Z, lock, máscara.
- [ ] Panel de propiedades tiene control dashed y selector de blend mode completo.
- [ ] Panel Layers tiene filtro por nombre.
- [ ] Todo export muestra toast con nombre + tamaño real del archivo.
- [ ] Tests Items 1-2 pasando; tsc limpio.
- [ ] Commits organizados; nada pusheado.

---

## 6. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-027-dogfood-editor-fulltools-fixes.md` completo. Los 2 bugs tienen causa raíz verificada en código (líneas citadas en §1) — no re-diagnostiques, ve directo a los items del §2.

Alcance exacto (§2):
- **Item 1 (prioritario):** motor de imprenta — timeout de 60s en `ensurePrintEngine` (`src/lib/cmykEngine.ts`), fix del fire-and-forget de `instantiateWasm` (`src/workers/ghostscript.worker.ts:69-72`, hoy si falla nadie rechaza la promesa), mostrar el % real que ya llega en `progress.message` (`PrintExportDialog.tsx:475`), botón ✕ nunca `disabled={busy}` (línea 234), y flag `print_engine_ready` en localStorage tras init exitoso.
- **Item 2:** `EditorV2.tsx:4255` — Ctrl+D debe duplicar `selectedElement` si existe; `duplicateFrame()` solo si no hay selección. Ctrl+Shift+D se queda igual.
- **Item 3:** descubribilidad — entradas visibles (toolbar/panel) para boolean/agrupar/orden-Z/lock/máscara (todo ya existe en `CanvasContextMenu.tsx`, solo faltan puntos de entrada), control dashed (`strokeDasharray` ya está en el modelo), dropdown de blend modes completo (hoy solo checkbox multiply en `HtmlContextualPanel.tsx:2303`), y filtro de capas en Layers.
- **Item 4:** toast post-export con nombre + tamaño real (KB/MB); bytes===0 → error.
- **Item 5:** tests del timeout (worker mock que no responde → rechaza a 60s) y de Ctrl+D; `tsc` limpio.

Reglas: un item = un commit con verificación citada (comandos corridos y resultados). Sin dependencias nuevas. NO tocar `llmProxy.ts`, BYOK/DeepSeek (dueño: REQ-025.1), `express-shim.js`, ni `MAX_ZOOM`. NO hacer push sin orden explícita de Ren. No borrar el archivo `QA_Explorador_Total` de prod.

DoD (verifica cada punto antes de reportar done, con evidencia):
1. Export CMYK muestra % de descarga; timeout 60s con mensaje; ✕ cerrable siempre.
2. Ctrl+D con rectángulo seleccionado → duplica rectángulo, frames sin cambio; sin selección → duplica frame.
3. Entradas visibles para boolean/agrupar/orden Z/lock/máscara en toolbar o panel.
4. Control dashed + dropdown blend completo en panel de propiedades.
5. Filtro de capas funcionando.
6. Toast de export con nombre + tamaño; bytes 0 → error.
7. Tests pasando; tsc limpio; commits organizados; nada pusheado.

Al terminar: lista de commits con su verificación y el resultado de cada punto del DoD.
