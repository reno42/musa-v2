# Agent Bridge — ojos y lint de layout para agentes de IA

Cuando un agente (Claude Code, Codex, OpenClaw, etc.) maneja el editor por navegador,
tiene el problema de diseñar a ciegas: puede escribir HTML/CSS perfecto y aun así
producir colisiones visuales que solo se ven renderizando. `window.futurariaAgent`
(instalado por EditorV2, implementado en `src/lib/agentBridge.ts`) resuelve eso.

## API

```js
// Frames visibles en el canvas
window.futurariaAgent.listFrames()
// → [{ frameId, width, height }, ...]

// Snapshot PNG de un frame (fuentes de Google embebidas, sin red al dibujar)
await window.futurariaAgent.renderFrame(frameId, scale /* default 0.5 */)
// → "data:image/png;base64,..."

// Lint de layout: cajas por capa + problemas detectados
window.futurariaAgent.inspectFrame(frameId)
// → { frameId, width, height, layers: [...], issues: ["Layer X overlaps text layer Y", ...] }
```

## Qué detecta `inspectFrame`

- **Capas fuera del frame** (`outsideFrame`).
- **Texto recortado** por su propia caja fija (`clippedText`).
- **Elementos decorativos sobre texto** (`overlapsText`) — para SVGs mide la unión
  de las formas dibujadas, no la caja del contenedor, así un `overflow: visible`
  no genera falsos positivos.

## Flujo recomendado para agentes

1. Diseña los frames vía MCP (`update_template` con `frames[]` de HTML/CSS por capa,
   cada capa con `data-layer-id`/`data-layer-name` para que el humano pueda editarla).
2. Abre `/?template=<id>&v=2` en el navegador.
3. `inspectFrame()` → corrige los issues reportados.
4. `renderFrame()` → mira el PNG y ajusta composición/jerarquía (el lint no opina
   de estética, solo de geometría).
5. Repite hasta que el lint esté limpio y el render te convenza.

## Publicar en segundos: `scripts/agent-design.mjs`

Para el flujo "agente escribe → humano edita" sin tocar el navegador:

```bash
# 1. Genera un starter y edítalo (o escribe tu design.json directo)
node scripts/agent-design.mjs example > design.json

# 2. Publica: crea workspace+template y devuelve el link del editor
node scripts/agent-design.mjs push design.json
#   ✔ 1 frame(s) publicados en 0.1s
#   Editor: http://localhost:5173/?template=tpl_xxx&v=2

# Contra producción u otra instancia:
node scripts/agent-design.mjs push design.json --api https://<sitio> --app https://<sitio>

# Actualizar un template existente (iteración):
node scripts/agent-design.mjs push design.json --template tpl_xxx
```

`design.json` = `{ workspace, name, frames: [{ id, name, x, y, width, height, background, html, css }] }`.
Regla de oro: cada elemento con `data-layer-id` + `data-layer-name`, posiciones
absolutas en px del frame, y tipografía proporcional al formato (1080, 1920…).

## Limitaciones

- `renderFrame` usa SVG `foreignObject`: imágenes externas del frame deben ser
  data-URIs para aparecer en el snapshot (las fuentes de Google se inlinean solas).
- El HTML del frame debe ser XML-serializable (el bridge usa `XMLSerializer`,
  así que el DOM real siempre lo es).
