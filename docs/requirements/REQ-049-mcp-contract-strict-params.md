# REQ-049 — Contrato del MCP: validación estricta de params, pathfinder duplicado, autoSave del busca-trazos

Fecha: 2026-10-15 · Estado: implementado (2026-10-16; QA 13/13, suites relacionadas 67/67, build OK) · pendiente de deploy (Hermes) · Origen: auditoría MCP-first del editor (Ren: "cuando revisas algo igual sigue malogrado"). 28 tools del editor ejercitadas en vivo contra prod con template QA. Motor sano; los bugs viven en la capa de contrato.

---

## 0. Evidencia (verificada contra prod, 2026-10-15)

| # | Bug | Evidencia |
|---|---|---|
| B1 | El server **acepta params desconocidos y escribe `undefined`/`NaN` al HTML persistido** | `draw_bezier`/`draw_path` llamados con `points:[[..]]` (no existe; el real es `pathData`): 200 OK, frame queda con `viewBox="undefined undefined NaN NaN"`, `<path d="undefined">`, `<undefined data-layer-id=...>` y selector `[data-layer-id="undefined"]` en la DB |
| B2 | **`pathfinder` registrado 2 veces** con schemas distintos: L3933 (`elementIdA/elementIdB/operation`) y L4686 (`layerIds/op/strokeColor` — el schema que ven los clientes). Ambos `case` en el MISMO switch (L16098 y L19885) → el nuevo es código muerto; toda llamada con `layerIds` falla con `Element A not found: undefined` | Repro: `pathfinder {layerIds:[a,b], op:"unite"}` → error; grep de los 2 registros y 2 cases |
| B3 | `handleTraceSelectedImage` (EditorV2:7633) es el único de los 84 `replaceAllWithUndo` que **no llama `autoSave`** → la traza del busca-trazos se ve pero desaparece al refrescar. El motor del trace está verificado sano (local: 4 presets OK, 20-55ms, colores exactos; MCP `trace_image`: idéntico) | grep de `autoSave(` dentro del handler = 0 matches |
| B4 | `render_frame_png` muere con `event is not defined` (error interno del server) | Repro con frame válido |
| B5 | `paste_style` exige `styles` como STRING (`params.styles.trim`), pero su propio `inputSchema` lo declara `object` | `styles:{color:...}` → crash |

---

## 1. Fixes (por prioridad)

### F1 — Validación estricta de params (mata la clase B1 entera)
En el dispatcher de `tools/call` (el switch de cases), ANTES de ejecutar cada tool: rechazar con código `-32602` (Invalid params) todo argumento cuyo nombre no esté en el `inputSchema.properties` de la tool, listando los válidos en el mensaje:

```
`Parámetro desconocido "points" para draw_bezier. Válidos: pathData, x, y, width, height, fill, stroke, strokeWidth, closed`
```

- Error ACCIONABLE: el agente cliente se autocorrige en el siguiente intento (así lo hacen los MCP serios).
- Addicional: en los handlers que interpolan valores en HTML/CSS (draw_path, draw_bezier, draw_shape), validar que el resultado no contenga `undefined`/`NaN` antes de persistir; si lo contiene, throw con el param culpable. (Defensa en profundidad: algún handler interno puede llamar a otro con datos ya validados.)
- Test: `QA/mcp-strict-params.test.mjs` — por cada tool del catálogo, llamada con un param inexistente → -32602; y el caso B1 exacto → error, frame intacto.

### F2 — Deduplicar pathfinder (B2)
Quedar UNO solo con el contrato nuevo (`layerIds/op/strokeColor`, L4686 + su handler L19885). Migrar el viejo handler (L16098, ops 2-elementos) al contrato nuevo: `elementIdA/B` → mapear a `layerIds:[A,B]` con `operation` → `op` (union→unite, subtract→minus_front) por compatibilidad SOLO si llega el contrato viejo, y avisar en la respuesta `"deprecated": true`.
- La UI del canvas (CanvasContextMenu) usa la lib local `pathBoolean.ts`, no la tool MCP — cero impacto en UI.
- Test: unite/minus_front/intersect/exclude/divide con `layerIds` → 200 y frame sin los originales; contrato viejo → 200 + deprecated flag.

### F3 — autoSave del busca-trazos (B3, 1 línea)
En `handleTraceSelectedImage` (EditorV2:7633), tras `store.replaceAllWithUndo(...)` agregar `autoSave(<los frames que se pasaron al store>)` — mismo patrón de los 83 handlers vecinos (ej. `handleBatchGenerate` L7702).
- Criterio: trazar una imagen → refrescar el browser → la capa `Buscatrazos` sigue ahí.

### F4 — render_frame_png (B4)
Localizar `event is not defined` (grep `event.` en la ruta del handler; variable no definida usada en catch o en progress). Criterio: PNG con `scale:0.5` sobre un frame con shapes → bytes PNG > 0.

### F5 — paste_style: alinear schema con handler (B5)
O el handler acepta objeto (preferido: `typeof styles === "string" ? JSON.parse : styles`) o el schema lo declara `string`. Preferir aceptar ambos, con trim solo si string.

---

## 2. Reglas

- `netlify/functions/mcp.mjs` se despliega vía CF Worker (netlify/ es nombre legacy) — el deploy lo hace Hermes desde design-main (ver SKILL design-main), el IDE agent NUNCA deploya.
- Los fixes F1/F2 tocan el dispatch central: probar DESPUÉS los 410 tools-list (smoke: tools/list count no cambia, y una tool de cada familia con params válidos sigue OK).
- No tocar `trace/*`, `pathOps/*`, `pathBoolean.ts` (motor, ya verificado).

## 3. Fuera de alcance (anotado para después)
- Panel Tipografía estilo Character (toggles B/I/U/S, kerning, baseline shift, sub/superíndice, pesos por familia) — REQ UI-only aparte, ya acordado con Ren.
- `offset_path` client-side ya reemplazó al fake del server en UI; el server queda para agentes.

---

## 4. Ejecución (2026-10-16)

- F1-F5 implementados en `netlify/functions/mcp.mjs` (+ F3 en `src/pages/EditorV2.tsx`). QA: `QA/mcp-strict-params.test.mjs` 13/13; suites relacionadas (corner-radius, pattern-fill, req032-visual-tools, pathfinder-boolean, scissors-knife, trace) 67/67; `npm run build` OK.
- Delta del catálogo: la auditoría contaba 410 tools-list CON el ghost duplicado del pathfinder; tras la dedup tools/list anuncia 409 únicas (pathfinder una sola vez, contrato nuevo). Pendiente post-deploy: `npm run sync:skill` para refrescar `tools_catalog.json`/SKILL.md.
- B4 también estaba en `diff_overlay` (misma clase): corregido junto a `render_frame_png`. B5 también en `set_pseudo_state`.
- `QA/req032-visual-tools.test.mjs` actualizado: asertaba el patrón bug `getApiKey(event)` como contrato.
