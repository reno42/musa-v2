# Musa dogfood report

Fecha: 2026-09-24  
Entorno: `https://design.futuraria.com` en el navegador visible, sesión autenticada de Renzo  
Alcance: exploración solo lectura; no se crearon, editaron ni borraron templates, contactos, deals o contenido.

## Resumen ejecutivo

Se encontraron 4 bugs nuevos, deduplicados:

| Severidad | Total |
|---|---:|
| Crítico | 1 |
| Alto | 2 |
| Medio | 1 |
| Bajo | 0 |

El bloqueo principal es un crash al abrir el detalle de una tarea desde Tabla. Además, el dashboard emite un error MCP por no enviar `workspaceId`, y el chat/Ghost muestra fallos 401 de la clave DeepSeek configurada. La interfaz de editor, calendario, CRM y configuración cargó y permitió navegación de lectura.

Las capturas se tomaron en el navegador visible durante la sesión y se mostraron inline. El backend CUA utilizado para esta exploración no ofrece una ruta de persistencia local de PNG; por eso los campos de screenshot identifican la captura visual correspondiente, pero no se inventan archivos PNG inexistentes.

## Bugs

### BUG-001 — Abrir detalle de tarea derriba la aplicación

- Severidad: **Crítico**
- Categoría: Funcional / Consola / UX
- URL: `https://design.futuraria.com/#workspace`
- Screenshot: captura CUA del Error Boundary (`y.acceptance.map is not a function`)

Pasos:

1. Abrir el dashboard autenticado.
2. Seleccionar la vista **Tabla**.
3. Seleccionar el filtro de estado **Design**.
4. Abrir `Post 1080x1080 - Hola Ren soy el agente con IDE de Qoder`.

Esperado: abrir el detalle de la tarea con brief, acceptance criteria y metadatos.

Obtenido: aparece el Error Boundary `Something went wrong`; la app muestra `y.acceptance.map is not a function`. El botón `Go Home` permite recuperar la navegación, pero la acción solicitada no es usable.

Consola completa:

```text
TypeError: y.acceptance.map is not a function
    at S9 (https://design.futuraria.com/assets/index-DH9cTKDc.js:214:38939)
    at sv (https://design.futuraria.com/assets/index-DH9cTKDc.js:39:17018)
    at R0 (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:3139)
    at T_ (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:44833)
    at __ (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:39790)
    at lQ (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:39718)
    at Af (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:39570)
    at W0 (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:35934)
    at v5 (https://design.futuraria.com/assets/index-DH9cTKDc.js:41:36738)
    at Ki (https://design.futuraria.com/assets/index-DH9cTKDc.js:39:3279)
```

### BUG-002 — Dashboard llama `get_dashboard_summary` sin workspace

- Severidad: **Alto**
- Categoría: Consola / Funcional
- URL: `https://design.futuraria.com/#workspace`
- Screenshot: captura visible del dashboard con tarjetas cargadas y consola mostrando el error

Pasos:

1. Entrar al workspace autenticado.
2. Esperar la carga del dashboard.
3. Revisar la consola del navegador.

Esperado: resumen ejecutivo solicitado con el workspace activo y cero errores JS/MCP.

Obtenido: las tarjetas principales se muestran, pero cada carga conserva el fallo:

```text
[mcpCall] JSON-RPC error: Object
[mcpCall] FAILED: get_dashboard_summary workspaceId is required — llama list_workspaces y usa uno de los IDs accesibles
```

Esto deja el dashboard parcialmente funcional y hace que la telemetría de consola sea ruidosa aunque haya datos visibles.

### BUG-003 — Chat/Ghost no puede usar la clave DeepSeek configurada

- Severidad: **Alto**
- Categoría: Funcional / Contenido / Consola
- URL: `https://design.futuraria.com/?template=tpl_f9a977c5-d5c&v=2`
- Screenshot: captura del editor con el panel Chat abierto y los mensajes de error visibles

Pasos:

1. Abrir un template existente en Diseño.
2. Abrir el panel Chat.
3. Revisar los mensajes de Ghost/Leader dejados por la ejecución dogfood y la consola.

Esperado: si DeepSeek está marcado como configurado, el chat y Ghost deben responder; si la clave no es válida, la UI debe indicar provider/modelo y una acción de rotación antes de intentar operar.

Obtenido: se muestran errores 401 repetidos, sin ejecutar acciones:

```text
Error: DeepSeek 401: {"error":{"message":"Authentication Fails, Your api key: ****eb52 is invalid (request_id: abe3487b-2b0f-4fbe-848d-705c04ae25a7)","type":"authentication_error","param":null,"code":"invalid_request_error"}}. Verifica tu API key.
```

La misma causa bloqueó el job Ghost live; no se reporta de nuevo como un bug distinto en cada página. La clave completa nunca se expuso.

### BUG-004 — Back to Dashboard puede requerir doble click tras abrir paneles

- Severidad: **Medio**
- Categoría: UX / Funcional
- URL: `https://design.futuraria.com/?template=tpl_f9a977c5-d5c&v=2`
- Screenshot: captura del editor con Layers abierto

Pasos:

1. Abrir el editor de un template existente.
2. Abrir `Toggle Layers Panel`.
3. Pulsar `Back to Dashboard`.
4. Esperar la navegación.

Esperado: volver al dashboard en el primer click.

Obtenido: el primer click mantuvo el editor y la misma URL; un segundo click sí volvió a `/#workspace`. No hubo pérdida de datos porque no se editó ni guardó nada.

## Qué se probó

- Landing pública: carga, CTA, menú visible, consola y screenshot.
- Login: navegación hasta el formulario; se detuvo sin introducir credenciales. El formulario mostró campos prellenados/masked, sin tocar valores.
- Dashboard: tarjetas, rangos 7d/30d/90d, calendario, mes siguiente, tabs Dashboard/Kanban/Tabla.
- Kanban: carga de 54 tareas, controles Dry run/CSV/Importar/Nueva/Refresh visibles; no se ejecutó batch ni se creó tarjeta.
- Tabla: carga de 54 tareas, filtro Design, filas y navegación al detalle.
- Diseño: búsqueda de archivos, listado, apertura de template existente, screenshot del canvas, zoom +, entrada de zoom, herramientas Select/Hand, Layers y menú Exportar.
- Copywriting: calendario, mes siguiente, filtro Instagram, limpiar filtros y pestaña Contenidos.
- CRM: Ventas, Personas, Marcas y Embudo.
- Configuración: Mi cuenta, Mis integraciones, Invita IAs, Reportes y APIs/Webhooks.
- Consola del navegador en cada transición; el único stack nuevo reproducible del flujo fue `y.acceptance.map is not a function`.
- Confirmado una vez en el historial visible: `res.send is not a function` es un fallo antiguo ya corregido por el hotfix del Worker; no se reporta como bug nuevo.

## Qué no se probó y por qué

- Crear, renombrar, duplicar o borrar templates: solo lectura; se evitó mutar datos existentes.
- Crear contenido/personas/deals/API keys: crear datos o credenciales requiere confirmación y no era necesario para los hallazgos.
- Formularios de login, recuperación de contraseña y cambio de contraseña: requieren credenciales/acciones sensibles.
- Campos de texto con 500 caracteres, `<script>`, emojis y acciones destructivas del editor: requieren modificar o guardar un documento.
- Drag de piezas entre días y drag de elementos fuera del canvas: mutan contenido o calendario; no se ejecutaron.
- Guardar versión, undo/redo con cambios, importar/subir archivos y conexiones sociales: pueden crear o transmitir datos.
- Descargas PDF/PNG/batch: se abrió el menú Exportar, pero no se descargaron artefactos para mantener el alcance mínimo.
- Preset de Animation: no se ejecutó; el congelamiento es un known issue ya documentado.
- `/.well-known/mcp.json` y `/SKILL.md`: el navegador CUA devolvió `net::ERR_BLOCKED_BY_CLIENT`; no se atribuye a Musa sin una segunda superficie.

## Los 5 arreglos prioritarios

1. **BUG-001:** normalizar `acceptance` como array en la frontera de datos y añadir una prueba de render con tareas legacy; actualmente una fila destruye la experiencia completa.
2. **BUG-003:** validar provider/model/BYOK antes de marcar DeepSeek como configurado, registrar solo `last4` y mostrar una acción clara para rotar la clave; bloquea Chat y Ghost.
3. **BUG-002:** resolver el workspace activo antes de `get_dashboard_summary` y hacer que el error sea visible/accionable; elimina ruido de consola y evita métricas incompletas.
4. **BUG-004:** hacer idempotente el primer click de `Back to Dashboard` aunque Layers/Export estén abiertos; evita que el usuario crea que perdió el trabajo.
5. **Cobertura QA automatizada:** añadir E2E para login bloqueado, dashboard sin workspace, detalle con acceptance legacy, DeepSeek inválido, apertura/cierre de paneles y navegación; todos deben fallar con diagnóstico, no con Error Boundary genérico.

## Cierre

La sesión terminó en una vista privada de configuración, sin mutaciones. El editor y los módulos principales son navegables, pero el crash del detalle de tareas es bloqueante y los errores de workspace/BYOK deben resolverse antes de considerar Musa estable para dogfooding continuo.
