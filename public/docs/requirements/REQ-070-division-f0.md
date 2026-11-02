# REQ-070 — Division de trabajo F0: IDE agent vs Hermes (trabajo en paralelo sin choques)

Regla obligatoria e innegociable: **la UI nueva (shell-v2 con los 10 modulos) es la unica cara de Musa v2.**
Prohibido reusar la navegacion/paginas viejas. Toda funcionalidad existente se CONECTA a la UI nueva,
nunca al reves (no se viste la UI vieja con estilos nuevos).

## Frontera de archivos (los dos trabajan en el mismo repo, cero conflicto)

### Carril del IDE agent (UI + routing)
- `src/shell-v2/` — shell nuevo, sidebar de 10 modulos, routing de las 41 vistas
- `src/components/v2/` — componentes visuales de las vistas nuevas
- `src/styles/tokens.css` — design system congelado desde el prototipo publicado (tarea 0)
- NO toca: `src/lib/apiV2/`, `worker/runtime/functions/v2/`, `src/pages/EditorV2.tsx`, `src/pages/VideoProjectEditor.tsx`

### Carril de Hermes (conexiones backend, sin UI)
- `src/lib/apiV2/` — clientes de datos: un modulo TS por vista con las funciones tipadas que la vista necesita
- `worker/runtime/functions/v2/` — endpoints nuevos SOLO aditivos (regla REQ-069)
- `QA/v2/` — probes de datos por vista (pass/fail con numeros reales)
- NO toca: shell-v2, componentes visuales, tokens.css, rutas existentes (solo agrega archivos nuevos)

## Contrato entre carriles (git es el unico punto de encuentro)

Hermes define primero, en `src/lib/apiV2/README.md`, la lista de funciones por vista:
`[vista] -> [funciones exportadas] -> [endpoint que usa]`.
El agent consume esas funciones en sus vistas. Si una vista necesita algo que no existe,
el agent lo declara en `src/shell-v2/NEEDS.md` (vista + dato + formato) y Hermes lo implementa.
Nadie edita los archivos del otro.

## Secuencia de arranque (orden estricto)

1. **T0 (agent, ~1h):** tokens.css congelado desde test.futuraria.com + NEEDS.md vacio. PROHIBIDO
   color/font fuera de tokens.css. Referencia historica NO usable: Downloads/gemini-code-1793086849133.html
   (exploracion vieja, otra paleta: Anton/Inter/#1616ff — no confundir).
2. **T1 (Hermes):** apiV2/README.md con el mapa vista->funciones para las 41 vistas
   (empezando por inicio/crear/vender/configuracion que son las de mayor cobertura).
3. **T2 en adelante:** ambos en paralelo. Agent: vistas. Hermes: clientes + endpoints faltantes + probes.
4. **Sync:** cada push es revisado por el otro carril SOLO si cruza la frontera (un archivo compartido
   = violation, se revierte).

## Funcionalidades sin conexion prevista (donde entra Renzo a coordinar)

Cobertura actual por modulo (analisis REQ-069): anunciar ~15%, organizacion ~10%, conversar ~50%,
agentes ~70%. Esas vistas se construyen con la estructura visual completa y datos parciales;
lo faltante queda listado en NEEDS.md como backlog para decidir: construir / integrar tercero / diferir.

## Definition of Done compartido

- `npx tsc --noEmit` limpio en cada push (cualquier carril rompe = revertir)
- Probes de datos PASS (Hermes) / vistas navegables con datos reales (agent)
- Editor #template/<id> intacto (ventana de gracia L35-54, REQ-068 vigente)
- Deploy: Hermes hace pull + wrangler deploy a musa-v2.renzo-08c.workers.dev (cuenta renzo@futuraria.com)
