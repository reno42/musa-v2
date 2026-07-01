# 🔍 Design Tool — Diagnóstico: Save no persiste + Ctrl+Z roto

> Revisado: 30 Jun 2026
> Repo: `C:\Users\Renzo\.openclaw\workspace\design-main`
> Archivos clave: `EditorV2.tsx`, `templateApi.ts`, `InfiniteHtmlCanvas.tsx`, `DesignFrame.tsx`

---

## Flujo del save (lo que entendí)

```
Usuario edita HTML/CSS
  → handleHtmlChange / handleCssChange
    → pushUndo(frames)           // stack undo
    → setFrames(updated)         // React state
    → autoSave(updated)          // persiste

autoSave:
  1. INMEDIATO: saveLocal(templateId, payload)  → localStorage
  2. DEBOUNCE 2s: apiFetch PUT /api/templates/:id → API → Supabase
  3. Muestra "Saving..." → "✓"

getTemplate (al recargar):
  1. fetch API /api/templates/:id
  2. leer localStorage
  3. Comparar timestamps (grace window 5s)
  4. Si localStorage es más nuevo → merge con API
  5. Si API vacío pero localStorage tiene contenido → usar localStorage
```

---

## Suposiciones — Save no persiste

### Suposición A: `hasContent()` descarta frames con html/css vacíos
📂 `templateApi.ts:29`
```js
const hasContent = (d: any) =>
  Boolean(d?.html) || Boolean(d?.css) || (d?.frames?.length > 0);
```
Si `payload.html` y `payload.css` son strings vacíos (el frame activo tiene CSS en blanco) PERO `payload.frames` tiene datos, `hasContent` debería devolver `true` por la tercera condición. **Baja probabilidad, pero verificable.**

### Suposición B: La API PUT retorna 200 pero no escribe en Supabase
📂 `EditorV2.tsx:282-288`
```js
const putRes = await apiFetch(`/api/templates/${templateId}`, {
    method: "PUT", body: JSON.stringify(payload),
});
console.error("[SAVE] ✓ API PUT OK", { ..., responseHasFrames: !!(putRes as any)?.data?.frames });
```
Si Supabase rechaza la escritura pero la API retorna 200 igual, el frontend asume que se guardó y limpia `isDirtyRef.current = false`. Al recargar, `getTemplate` trae datos viejos de Supabase. **Alta probabilidad.**

### Suposición C: El polling sobreescribe cambios locales con datos viejos de API
📂 `EditorV2.tsx:356-370`
```js
pollingRef.current = setInterval(async () => {
    if (isDirtyRef.current) { return; } // skip si hay cambios locales
    const tpl = await getTemplate(templateId);
    if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
        setFrames(t.frames);  // ⚠️ SOBREESCRIBE frames locales con datos de API
    }
}, pollingIntervalMs);
```
**Race condition:** Si el polling se ejecuta JUSTO después de que `isDirtyRef.current = false` (API sync completó) pero ANTES de que Supabase tenga los datos nuevos (latencia de escritura), el polling trae datos viejos y los inyecta en `setFrames`. Esto borra los cambios del usuario en memoria. **Alta probabilidad.**

### Suposición D: `getTemplate` prefiere API sobre localStorage incorrectamente
📂 `templateApi.ts:42-64`
El grace window de 5 segundos: si el timestamp de localStorage y API están dentro de 5s, prefiere localStorage. Pero si API tiene timestamp MÁS NUEVO (ej: polling acaba de escribir datos viejos con timestamp fresco), API gana y localStorage se descarta. **Probabilidad media.**

### Suposición E: localStorage está lleno o corrupto
Si `localStorage.setItem` falla silenciosamente (quota exceeded, datos corruptos), el save inmediato nunca ocurre. `saveLocal` tiene try/catch pero el catch solo loguea — no notifica al usuario. **Probabilidad baja, verificable en DevTools > Application > Local Storage.**

### Suposición F: La key de localStorage no coincide con el templateId
📂 `templateApi.ts:202-213`
```js
function saveLocalTemplate(id: string, data: any) {
  const all = getLocalTemplates();  // lee LS_KEY
  all[id] = { ...data, id, updatedAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}
export function getLocalTemplate(id: string): any | null {
  return getLocalTemplates()[id] || null;
}
```
Si `templateId` cambia entre sesiones (ej: URL params se pierden), el save va a una key y el load lee de otra. **Probabilidad baja si el ID viene de URL y no cambia.**

---

## Suposiciones — Ctrl+Z no funciona

### Suposición G: El iframe de DesignFrame no reacciona a cambios de estado
📂 `DesignFrame.tsx` y `InfiniteHtmlCanvas.tsx`
Cada frame se renderiza dentro de un iframe con `srcDoc`. Cuando `handleUndo` ejecuta `setFrames(prev)`, React actualiza la prop `frames` del canvas. Pero si el iframe tiene su propio estado interno (ej: el iframe ya cargó el HTML/CSS viejo y no se re-renderiza porque React considera que las props no cambiaron — mismo frameId, mismo html/css desde la perspectiva de React.memo), el cambio no se ve. **Alta probabilidad.**

### Suposición H: `handleUndo` usa `frames` stale por closure de useCallback
📂 `EditorV2.tsx:155-166`
```js
const handleUndo = useCallback(() => {
    const prev = undoStack.current.pop()!;
    redoStack.current.push(JSON.parse(JSON.stringify(frames)));  // ⚠️ frames es el valor al momento de crear el callback
    setFrames(prev);
    autoSaveRef.current(prev);
}, [frames]);  // se recrea cada vez que frames cambia
```
Si múltiples `setFrames` ocurren rápido (ej: keystrokes en HTML editor), React batea los updates. `handleUndo` se recrea con el valor de `frames` del último render, no del estado real del undoStack. **Probabilidad media.**

### Suposición I: `pushUndo` tiene coalesce de 800ms que descarta estados intermedios
📂 `EditorV2.tsx:398-403`
```js
const now = Date.now();
if (now - lastPushTimeRef.current > 800) {
    pushUndo(frames);
    lastPushTimeRef.current = now;
}
```
Para HTML/CSS changes, solo se pushea al undo stack cada 800ms. Si escribiste 10 caracteres en menos de 800ms, solo el estado ANTES del primer caracter está en el undo stack. Los 9 intermedios no existen. Esto hace que Ctrl+Z "salte" al estado de hace 800ms, no al inmediatamente anterior. **No es un bug, es diseño. Pero puede confundirse con "no funciona".**

### Suposición J: El `pushUndo` inicial (en load) se corrompe
📂 `EditorV2.tsx:208`
```js
pushUndo([...loaded]); // initial push after loading frames
```
Si `loaded` es un array vacío o tiene frames con referencias circulares, el `JSON.parse(JSON.stringify())` en pushUndo puede fallar silenciosamente y el undo stack queda corrupto desde el inicio. **Probabilidad baja, pero si pasa rompe todo.**

### Suposición K: El keyboard shortcut no está bindeado correctamente
📂 `KeyboardShortcuts.tsx`
Si el listener de Ctrl+Z está condicionado a `canUndo` o tiene un preventDefault que falla en ciertos contextos (ej: focus en el iframe), el evento nunca llega a `handleUndo`. **Probabilidad media.**

---

## Orden sugerido para descartar

1. **Abrir DevTools > Application > Local Storage** → verificar que `futuraria_local_templates` tiene datos con frames después de editar. Si está vacío → Suposición E.
2. **Editar, esperar 3s, mirar la pestaña Network** → ver si el PUT a `/api/templates/:id` retorna 200 y qué viene en el body. Si 200 pero response.data.frames vacío → Suposición B.
3. **Editar, recargar, mirar console logs** → buscar `[getTemplate]` y ver qué decisión tomó (API vs localStorage). Si eligió API teniendo localStorage más nuevo → Suposición D.
4. **Editar, esperar el polling interval** → buscar `[POLL] Skipping` o `[POLL]` en logs. Si ves que trae datos viejos y los inyecta → Suposición C.
5. **Probar Ctrl+Z con `console.error("[UNDO]")` visibles** → ver si el evento llega a handleUndo. Si llega pero el canvas no cambia → Suposición G.

---

> 📂 `design-main/debug/DIAGNOSTICO_SAVE_UNDO.md`

---

## Resultados de Supabase (30 Jun 2026, 22:50)

### Templates encontrados
- `tpl_bc5740a5-3ca` — "Adopcion IA - LinkedIn Carousel" — 12 frames — última actualización: **24 Jun 2026**
- `tpl_27a9fc92-b69` — "Medir Adopcion IA - LinkedIn" — 7 frames — última actualización: **24 Jun 2026**

### Observaciones críticas

**1. Los datos SÍ persisten en Supabase cuando el PUT funciona.** Los templates de Junio 24 tienen frames completos con HTML, CSS, coordenadas, etc. La estructura `data` (JSONB) contiene TODO el estado.

**2. Los timestamps son de hace 6 días.** Si editaste HOY y los cambios no están, significa que:
   - El PUT nunca llegó a Supabase (el syncLock bloqueó el estado antes del debounce)
   - El PUT llegó pero con datos vacíos/stale
   - El PUT llegó con datos correctos pero a un templateId distinto

**3. La estructura de la tabla es `data` (JSONB) + `updated_at` (timestamp).** El frontend usa `apiFetch` contra edge functions de Netlify, no directo a PostgREST. Las edge functions son las que traducen `data.metadata.updatedAt` ↔ `updated_at`.

### Suposiciones actualizadas

**B (API PUT retorna 200 pero no escribe) → DESCARTA PARCIALMENTE.** Cuando el PUT funciona, los datos SÍ se escriben bien (templates del 24 Jun lo prueban). El problema no es Supabase rechazando writes — es que el PUT probablemente **nunca se dispara con datos correctos** porque el estado de React está corrupto/bloqueado por syncLock.

**D (getTemplate prefiere API sobre localStorage) → CONFIRMADO COMO RIESGO.** Si el PUT nunca persiste a Supabase, entonces al recargar `getTemplate` recibe datos viejos del 24 Jun de la API. Como localStorage tiene timestamps más nuevos (de la sesión actual), el grace window de 5s prefiere localStorage. Pero si localStorage también está corrupto/vacío (por el syncLock), se usan los datos viejos de API y pierdes TODO.

**NUEVA: Suposición P — El autoSave guarda datos stale porque `selectedFrameId` cambió en el closure.** El `autoSave` callback depende de `selectedFrameId` y `templateName`. Si cambiás de frame mientras el debounce de 2s está pendiente, el callback se recrea con el nuevo `selectedFrameId` pero el `saveTimerRef` sigue apuntando al `setTimeout` viejo que capturó los frames del momento del cambio. Esto puede causar que se guarde el estado de frames incorrecto.

---

## Suposiciones agregadas tras investigación en internet (30 Jun 2026)

### Suposición L: `syncLockRef` bloquea permanentemente las actualizaciones del Shadow DOM
📂 `DesignFrame.tsx:72, 141-142, 165, 453, 617`

**Bug raíz probable.** El `syncLockRef` está diseñado para evitar loops DOM→code→DOM:

1. Usuario arrastra/resize en el Shadow DOM
2. `syncLockRef.current = true` (línea 453)
3. `onCssChangeRef.current(...)` llama a `handleFrameCssChange` en EditorV2
4. EditorV2 hace `setFrames(updated)` → React re-renderiza DesignFrame
5. El efecto CSS (línea 141) encuentra `syncLockRef.current === true` → lo pone a `false` → **RETORNA sin actualizar el Shadow DOM**

El Shadow DOM NUNCA recibe el CSS/HTML nuevo porque cada re-render posterior al DOM edit encuentra el lock activo y lo salta. Esto explica:
- "Saving" muestra pero el canvas no cambia visualmente
- Ctrl+Z actualiza el estado React pero el Shadow DOM no se refleja
- Los botones de undo se pintan activos (canUndo=true) pero el canvas no cambia

**Verificación rápida:** Buscar `[SHADOW CSS] BLOCKED by syncLock` en la consola. Si aparece constantemente al editar → confirmado.

**Referencia:** Stack Overflow #74964647 — "How to reliably get Iframe content body updates in react effect" documenta el mismo patrón de Shadow DOM/iframe stale content.

### Suposición M: La key de DesignFrame no fuerza remount al cambiar contenido
📂 `InfiniteHtmlCanvas.tsx` — cómo se renderiza DesignFrame

React reutiliza el componente si la `key` es el `frame.id`. Como el id no cambia al editar HTML/CSS, el Shadow DOM interno no se destruye/recree. El `syncLockRef` (useRef) sobrevive entre re-renders y mantiene su valor `true` bloqueando actualizaciones.

**Solución documentada (LogRocket, Dec 2024):** Forzar key única que cambie con cada versión del contenido, o usar `useEffect` con `requestAnimationFrame` para aplicar actualizaciones fuera del ciclo de React.
- https://blog.logrocket.com/best-practices-react-iframes/

### Suposición N: El undo de Fabric.js clásico requiere guardar estado ANTES de la modificación
📂 `EditorV2.tsx:400` — `pushUndo(frames)` se llama antes de `setFrames(updated)`

En Fabric.js estándar, el patrón correcto es:
```js
const stateBefore = canvas.toJSON(); // guardar ANTES
applyChange(); // aplicar cambio
undoStack.push(stateBefore); // push al stack
```

El código actual hace `pushUndo(frames)` → `setFrames(updated)`. Esto debería funcionar porque `frames` es el estado previo (React todavía no re-renderizó). Pero si hay batching de React 18 con transiciones automáticas, `setFrames` podría ejecutarse antes de que `pushUndo` termine de serializar, causando que frames y updated sean el mismo array.

**Referencia:** Stack Overflow #22338080 — "Undo Redo for Fabric.js" — múltiples usuarios reportan "it doesnt really work" con el canvas real aunque funcione con datos simples. GitHub Fabric.js discussions #10358.

### Suposición O: `JSON.parse(JSON.stringify())` falla silenciosamente con datos corruptos
📂 `EditorV2.tsx:147` — `undoStack.current.push(JSON.parse(JSON.stringify(current)))`

Si `FrameData` contiene objetos no serializables (funciones, undefined, referencias circulares, DOM references), `JSON.stringify` puede:
- Omitir propiedades silenciosamente (undefined → desaparece)
- Tirar error silencioso que el catch de React se traga
- Producir un objeto con campos faltantes que al hacer undo restaura frames incompletos

Esto haría que el undo "funcione" (setFrames se llama) pero con datos vacíos o corruptos, haciendo que el Shadow DOM se actualice a `html: undefined, css: undefined` y no muestre nada.

**Verificación rápida:** En consola, `JSON.stringify(frames)` y verificar que todos los campos (html, css, id, x, y, width, height) estén presentes en el output.
