# Cómo ampliar las rutas de Musa

El router de ChatFAB elige **esquemas iniciales**, no limita permisos ni reemplaza el razonamiento del agente. `src/lib/musaToolRouting.ts` reconoce los módulos y su orden; `src/components/ChatFAB.tsx` arma los perfiles iniciales y ofrece `musa_find_tools` para abrir herramientas adicionales. El servidor MCP y su `tools/list` son la fuente de verdad para nombres y parámetros.

Las rutas concretas, sus entradas/salidas y su prioridad de implementación están en [MUSA_RECIPE_CATALOG.md](MUSA_RECIPE_CATALOG.md). El mapa de GraphForge aporta ideas de acciones; no ejecuta estas recetas.

## Una acción nueva en un módulo existente

1. Implementa y registra la herramienta en MCP.
2. Comprueba que una búsqueda concreta en `musa_find_tools` la encuentre. No la añadas al perfil inicial salvo que sea frecuente en casi todos los pedidos de ese módulo.
3. Actualiza el skill del módulo si cambia el procedimiento o la verificación; agrega una prueba de la acción. El catálogo completo sigue generándose con `node scripts/sync-skill-tools.mjs`.

## Un módulo nuevo

1. Agrega su intención y posición de ejecución en `src/lib/musaToolRouting.ts`.
2. Agrega un perfil inicial pequeño en `MUSA_MODULE_TOOL_NAMES` y conserva la búsqueda bajo demanda.
3. Crea `.agents/skills/musa-<modulo>/SKILL.md`, una fila en `MUSA_START.md` y una prueba de pedido simple y combinado en `QA/musa-tool-routing.test.mjs`.
4. Define la verificación del resultado real. Si el módulo usa tarjetas del Kanban, respeta el cierre C1-C5 que exige el servidor.

Ejemplo: “arma una grilla y diseña los posts” ejecuta copywriting y después diseño usando los IDs del calendario. “Anima este diseño” entra a motion con el template existente; “diseña y anima” pasa por diseño y después motion.
