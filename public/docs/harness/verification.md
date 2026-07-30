# Verificación — Cómo demostrar que el trabajo funciona

> Regla de oro: **el agente no dice "funciona", lo demuestra**.
> Toda feature termina con evidencia ejecutable, no con afirmaciones.

## Niveles de verificación

### Nivel 1 — harness_healthcheck (obligatorio)

```js
// MCP call
harness_healthcheck()
// → { ok: true, checks: [{ name: "mcp_reachable", passed: true, ... }, ...] }
```

Si `ok: false`, la feature NO puede marcarse `done`. Corregir el entorno antes.

### Nivel 2 — lint_design sobre el template (obligatorio para features de diseño)

```js
harness_healthcheck({ templateId: "tpl_xxx" })
// Incluye un check "lint_design_template" que pasa si no hay overlaps,
// clippedText, ni outsideFrame issues.
```

### Nivel 3 — render_frame visual (recomendado)

```js
// Via Agent Bridge en el navegador:
window.futurariaAgent.renderFrame("frame_xxx", 0.5)
// → data:image/png;base64,...
```

Si no hay navegador, el MCP puede invocar `render_frame` directamente.

### Nivel 4 — Acceptance criteria uno por uno (obligatorio)

El reviewer recorre cada item del array `acceptance` de la task y lo marca como
checkpoint:

```
acceptance: [
  "Existe el botón Publicar en topbar",
  "Al click llama generate_design_artifacts con action=publish",
  "Muestra toast con brandId",
  "Build pasa sin errores TS"
]
→
harness_evaluate_checkpoint({ taskId, checkpointId: "C2_item_1", description: "...", passed: true, notes: "src/pages/EditorV2.tsx:2743" })
harness_evaluate_checkpoint({ taskId, checkpointId: "C2_item_2", description: "...", passed: true, notes: "Network log confirms POST /mcp" })
...
```

## Anti-patrones (no hacer)

- ❌ "He añadido el botón, debería funcionar." → falta evidence.
- ❌ Marcar `done` sin `harness_healthcheck` verde.
- ❌ Aprobar con `lint_design` reportando issues.
- ❌ "Funciona en mi máquina" — no hay máquina. Todo es cloud.
- ❌ Confiar en el agente sin verificación. **Nunca confíes en la IA. Dale
  herramientas para que te demuestre lo que hizo.**

## Verificación final antes de cerrar

```
1. harness_healthcheck({ templateId: "tpl_xxx" })   → ok: true
2. Por cada item de acceptance → harness_evaluate_checkpoint
3. harness_complete_feature({ taskId })
4. Status pasa a "done" → visible en Kanban UI en tiempo real
```

Si algo falla, no marques `done`. Usa `harness_release_feature` con
`toStatus: "feedback"` y loguea el blocker.
