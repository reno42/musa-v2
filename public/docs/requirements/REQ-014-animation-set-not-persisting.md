# REQ-014 — `set_animation` no persiste: `frame.animation` se pierde por race en `autoSnapshot`

- **Status:** Done (implementado 27 Ago 2026)
- **Priority:** P1 (alta) — rompe la feature de animación de punta a punta
- **Files:**
  - `netlify/functions/mcp.mjs` — case `set_animation` (~L6078–6127) y `autoSnapshot` (~L5034–5065)
  - `api/src/services/templates.ts` — `updateTemplate` (~L479–514), `upsertSupabase` (~L160)
  - Frontend **ya correcto** (no tocar): `src/pages/EditorV2.tsx` `handleFrameAnimationChange` (~L1624), render de `AnimationPanel` (~L7597); `src/components/AnimationPanel.tsx`

---

## Problema

`set_animation` responde éxito y devuelve el schema (clips, timeline, `hasAnimation:true`), pero la animación **no sobrevive**: un `get_animation` inmediato devuelve `hasAnimation:false` y `get_template` devuelve el frame **sin** campo `animation` y con `lastModifiedBy:"human"`.

Reproducción (verificado 27 Ago 2026 con `tpl_dabc40b3-c64`, frame `frame_mtblsk82_2`):

1. `set_animation({templateId, frameId, animation})` → `{ hasAnimation:true, clips:9 }` ✔
2. `get_animation({templateId, frameId})` → `{ hasAnimation:false, animation:null }` ✘
3. `get_template` → el frame no tiene `animation`, `lastModifiedBy` sigue `"human"`.

Consecuencia en el editor: `AnimationPanel` recibe `animation={selectedFrame.animation ?? null}` = `null` → no hay clips que reproducir, no hay botón ▶, y no hay ningún indicador de que el frame "tiene animación". El usuario ve un frame estático y asume que la tool no funciona.

## Causa raíz

`autoSnapshot` (en `set_animation`, L6125 y L6089) dispara un **read-modify-write fire-and-forget** contra Supabase que **pisa** la escritura de `updateTemplate`:

```
autoSnapshot (L5041-5063):
  1. select data from templates where id=...   ← lee el data VIEJO (antes de que aterrice el upsert)
  2. existing._snapshots.push(...)
  3. update templates set data=existing         ← escribe el data VIEJO por encima del nuevo
     .catch(()=>{})                              ← falla en silencio
```

Secuencia de carrera:

1. `set_animation` lee el template (sin `animation`), le setea `frame.animation = schema` en memoria.
2. `updateTemplate` → `upsertSupabase` escribe el template **con** `animation` (async, timeout 8s).
3. En paralelo, `autoSnapshot` hace su `select` (que puede leer el `data` **previo** al upsert) y luego su `update` **después** de que el upsert aterrizó → sobreescribe `data` con la copia vieja, **borrando `frame.animation`**.

Es el clásico *lost update*: `autoSnapshot` relee y reescribe el `data` completo sin re-leer tras la escritura concurrente, y `set_animation` no chequea el retorno de `updateTemplate` (si el upsert o el snapshot fallan, igual responde éxito).

Evidencia que lo confirma: tras `set_animation`, `metadata.updatedAt` cambia (el upsert corrió), pero `frames[].lastModifiedAt`/`lastModifiedBy` quedan en los valores viejos (`14:29:37`, `"human"`) y `frame.animation` ausente — el `data` final es la copia vieja que reescribió `autoSnapshot`.

## Solución

Opciones (de menor a mayor alcance; recomiendo 1 + 3):

1. **No releer en `autoSnapshot`.** Si `set_animation` ya tiene el template mutado, pasarlo como `tplData` a `autoSnapshot(templateId, trigger, tpl)` y que la rama de persistencia a Supabase use ese `tplData` en vez de hacer `select` del `data` actual. Así el snapshot persiste la MISMA versión con `animation`.

2. **Ordenar el snapshot ANTES del upsert** (o dentro de `updateTemplate`, sobre el mismo objeto), para que no exista una escritura posterior con datos viejos.

3. **Atomicidad mínima:** que `autoSnapshot` no haga `update` del `data` completo para guardar `_snapshots`. Guardar los snapshots en una columna/tabla separada (o un RPC atómico de append), o directamente **quitar la persistencia a Supabase de `autoSnapshot`** (dejarlo solo en memoria) — el snapshot es accesorio y no debe competir con el estado real del diseño.

4. **Chequear el retorno** en `set_animation`: si `updateTemplate` devuelve `null` (upsert timeout/fallo), devolver error en vez de éxito, para no reportar una animación que no se guardó.

## Verificación

1. `set_animation` sobre un frame → `get_animation` inmediato → `hasAnimation:true` y schema idéntico.
2. `get_template` → el frame incluye el campo `animation` con los clips.
3. Recargar el editor (`design.futuraria.com/#editor/<id>`) → seleccionar el frame → sub-tab contextual **Animación** → se listan los clips y ▶ reproduce (WAAPI).
4. Repetir el test **N veces** y con un template grande (7+ frames, ej. `tpl_dabc40b3-c64`) para descartar que la carrera sea intermitente (el upsert lento la hace más probable).

## Nota (mejora de UX, opcional — no bloquea)

Aunque se arregle la persistencia, conviene un indicador de que un frame tiene animación (badge/ícono en el frame del canvas o resaltar el sub-tab "Animación") para que no pase desapercibido. Se puede separar en otro REQ.

## Implementación (27 Ago 2026)

Aplicadas las opciones 3 + 4 (la 1 queda obsoleta al eliminar la persistencia):

1. `autoSnapshot` ya no escribe a Supabase — snapshot solo en memoria (`store`). Muere la clase entera de lost-update, no solo el caso de `set_animation` (también protege `delete_html_content` y el resto de los callers).
2. `set_animation` (ambas ramas) chequea el retorno de `updateTemplate`; si el upsert falla/timeoutea responde `ANIMATION_SAVE_FAILED` en vez de éxito falso.
3. `upsertSupabase` strippea `_snapshots` de `data` antes de escribir (shallow copy) — la columna deja de crecer con hasta 10 copias completas del diseño y los upserts vuelven a entrar en los 8s.
4. `getFromSupabase` strippea `_snapshots` al leer — los GET del editor dejan de transportar el bloat. Trade-off: el fallback 3 de `restore_version` (legacy `_snapshots`) queda histórico, aplica solo a filas pre-existentes.

Bug conexo detectado (separar en otro REQ): `GhostPanel.tsx` L105 llama `list_snapshots`, tool que no existe en `mcp.mjs`.
