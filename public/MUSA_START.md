# Musa: guía breve para agentes

Musa opera diseño, copywriting, contactos y configuración. Conecta el servidor MCP en `https://design.futuraria.com/mcp` mediante OAuth o una clave `x-api-key` guardada en la configuración de tu cliente. No incluyas la clave en solicitudes de trabajo, archivos del proyecto o reportes.

## En cada pedido

1. Identifica el resultado, el workspace y los módulos necesarios. Un pedido puede recorrer varios: una grilla de tres meses pasa por copywriting y después por diseño; transmite los IDs de las entradas entre fases.
2. Consulta solo los datos necesarios. Para marca, template o contacto, busca el registro concreto antes de editarlo. No leas el catálogo completo de herramientas ni todos los playbooks al iniciar.
3. Descubre las herramientas pertinentes con `tools/list` y selecciona solo los esquemas que requiere el paso actual. Si tu cliente expone todo el catálogo automáticamente, usa una búsqueda local por nombre o descripción. Una nueva acción se incorpora así sin ampliar este archivo.
4. Ejecuta, relee el recurso creado o modificado y verifica el resultado. Para diseño, comprueba contenido, dimensiones, textos y salida visual cuando corresponda. Reporta IDs y enlaces reales; si falla algo, reporta el error concreto.

## Módulos

| Módulo | Se usa para | Contexto mínimo |
|---|---|---|
| Diseño | Crear, editar, adaptar y verificar piezas visuales | Workspace, brief, marca aplicable, template solo si se va a editar |
| Copywriting | Grillas, publicaciones, textos y campañas | Marca, tono, canales y periodo |
| Motion | Animación y video a partir de diseños o assets | Fuente, duración, formato de salida y destino |
| Video | Proyectos de video standalone (modelo CapCut): tracks, clips en µs, efectos como companions, templates con slots | Workspace, assets con URL pública (video/audio) y brief del reel |
| Contactos | Prospectos, clientes, deals y seguimiento | Identidad del registro y cambio solicitado |
| Flows | Pipelines automáticos: fuentes → IA o pausa-de-agente → plantillas del usuario | Flow id o preset, credenciales BYOK si el flow usa nodo `ai` |
| Configuración | Workspaces, claves, integraciones y automatizaciones | Ajuste concreto y permisos necesarios |

Para flows, carga `get_playbook({name:"flows"})` si es la primera vez que armas o depuras uno: trae contratos de nodos, las tres pausas (wait_webhook firmado, ai_task para tu IA cliente, approval humano), webSearch en nodo ai, recetas inline y el debug por pasos.

Para motion, busca herramientas de animación/video y verifica el archivo o resultado generado. Si el usuario también pide crear las piezas de partida, ejecuta diseño antes de motion y transmite sus IDs.

Para video, usa las herramientas `video_*` (`video_project_create`, `video_track_add`, `video_segment_add/move/trim/transform`, `video_effect_apply`, `video_template_register/instantiate`): TODO el tiempo va en microsegundos (1s = 1000000) y las reglas CapCut las aplica el servidor con errores de código estable (`TIME_INVALID`, `SPEED_MISMATCH`, `AUDIO_CLIP_FORBIDDEN`...) para que te autocorrijas. Lee el árbol completo con `video_project_get`. `video_render` aún es un stub honesto (`RENDER_PENDING`) hasta el pase de render standalone.

Las rutas de acciones propuestas y sus contratos están en [MUSA_RECIPE_CATALOG.md](https://design.futuraria.com/docs/MUSA_RECIPE_CATALOG.md). Consulta solo la ruta elegida; varias siguen siendo propuestas y no deben presentarse como funciones ya disponibles.

`get_playbook({name})` carga un procedimiento especial solo si aporta al trabajo: `replicate-html`, `create-from-scratch`, `csv-batch`, `design-system`, `content-calendar` o `flows`. `multi-agent` es una opción para trabajo amplio, no una etapa obligatoria. Usa un solo agente por defecto y conserva las verificaciones que exige cada operación. Si trabajas con tarjetas del Kanban, respeta los requisitos de cierre del MCP.

La guía completa y el catálogo histórico siguen en [SKILL.md](https://design.futuraria.com/SKILL.md). Para parámetros actuales, `tools/list` es la fuente de verdad; `get_agent_guide({verbose:true})` amplía la conexión y el onboarding cuando haga falta.

La reducción de esquemas depende del cliente MCP: si envía todo el catálogo al modelo en cada turno y no permite filtrarlo, esta guía reduce lecturas y llamadas, pero no ese costo de contexto. Configura un perfil de herramientas en el cliente cuando esté disponible.
