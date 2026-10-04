# REQ-027 — Flows: flow builder MCP-first dentro de Musa (pestaña Flows)

**Fecha:** 2026-10-03 · **Estado:** propuesto · **Prioridad:** alta (demo Ren lunes 5-oct)
**Reportado por:** Ren
**Motor de referencia:** `flows-engine/` (port del builder xiaozhi-musa, probado local en Node 22: engine OK, newsroom E2E hasta Musa con fix de contrato callTool)

## Visión

Los usuarios de Musa arman **flujos** (pipelines deterministas) que combinan
fuentes (RSS, Nitter, HTTP), nodos IA (BYOK), y **sus propias plantillas de
Musa** (elección visual de archivo + frame). Sus IAs (Claude, Eco, la que sea,
vía MCP) ejecutan, revisan logs, corrigen y crean flujos a voluntad. El flujo
de noticias es el caso de uso bandera: RSS → redactar → carrusel en el editor.

Principios:
1. **MCP-first**: TODO lo que hace la UI existe primero como tool del endpoint
   `/mcp`. La UI es un cliente más de esas tools.
2. **Sin cron del server** (Ren: "el cronjob me gasta recursos"): los horarios
   los manejan las IAs del usuario (sus cronjobs externos llaman `flow_run`).
   El trigger `schedule` queda en el schema como metadata informativa; NO hay
   scheduler server-side en v1.
3. Free-tier safe: ejecuciones cortas (ver "Límites CPU Workers" abajo); el
   trabajo grande se parte en varias llamadas orquestadas por la IA.

## Alcance v1

### 1. Pestaña Flows (entre Contactos y Configuración)

- `src/lib/appRoute.ts`: agregar `"flows"` a `WORKSPACE_TABS` (entre
  `"contactos"` y `"configuracion"`).
- `src/components/Dashboard.tsx`: nueva entrada en la lista de tabs (mismo
  patrón que Contactos), con subs:
  - `flows` (**Mis Flows**): grid de cards de flows del workspace, MISMA lógica
    que Diseño → Archivos: ver todos, click → editor de flow, botón nuevo,
    renombrar, duplicar, borrar, chip de estado (activo/pausado), chip del
    trigger (manual/webhook/horario informativo), último run + estado.
  - `library` (**Biblioteca**): 10 flows plantilla listos para clonar al
    workspace (ver §6).
  - `runs` (**Ejecuciones**): historial global del workspace (tabla: flow,
    fecha, estado, duración, nº nodos OK/error, botón "ver detalle" con el
    log paso a paso — mismo dato que expone `flow_history`).
- Ruta URL: `/#workspace/flows` (+ pane), persistida como las demás tabs.

### 2. Editor de flow (click en un flow del grid)

- Canvas de nodos con edges (la UI de referencia YA EXISTE: Control Room del
  bridge xiaozhi-musa, panel Automatizaciones; portar ese canvas a React del
  repo). Nodo = card con título, tipo, icono, estado; edge = línea con flecha.
- Panel de propiedades del nodo seleccionado (right panel, como el contextual
  del editor de diseños).
- Tipos de nodo v1: `source_rss`, `source_nitter`, `source_http`, `ai`
  (proveedor/modelo/prompt BYOK del usuario — reusar patrón BYOK existente),
  `template` (ver §5), `http`, `map`, `condition`, `text`, `report`.
- Trigger: `manual` | `webhook` | `schedule` (metadata; sin scheduler server).
- Acciones: guardar, validar (schema + grafo conexo), ejecutar ahora, ver
  historial de ESTE flow, exportar JSON (§7).

### 3. Storage (migración v58)

```sql
CREATE TABLE IF NOT EXISTS flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT false,
  trigger jsonb,                -- {type: manual|webhook|schedule, cron?, timezone?}
  nodes jsonb NOT NULL,         -- [{id, type, label, enabled, config, position}]
  edges jsonb NOT NULL,         -- [{from, to}]
  created_by text,              -- 'user' | 'ai:<model>' (para saber quién lo creó)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  status text NOT NULL,         -- running|success|failed
  input jsonb,
  steps jsonb NOT NULL,         -- [{nodeId, ok, ms, outputRef, error?}]
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
-- RLS: workspace_id IN (workspaces del usuario) — mismo patrón que templates.
CREATE INDEX flow_runs_flow_idx ON flow_runs(flow_id, started_at DESC);
```

Validación de schema/grafo: portar `validateAutomationFlowStore` +
`validateNewsroomFlowStore` de `flows-engine/src/` (límites: 20 flows por
workspace, 40 nodos, 60 edges, grafo conexo, tipos de edge válidos).

### 4. Tools MCP (netlify/functions/mcp.mjs + worker)

MCP-first: estas tools son LA API. La UI las llama vía `mcpCall`.

| Tool | Input | Hace |
|---|---|---|
| `flow_save` | `{id?, name, enabled, trigger, nodes, edges}` | crea/actualiza (valida antes). `id` ausente = crea. Devuelve `{id}`. |
| `flow_list` | `{}` | flows del workspace + último run resumido |
| `flow_get` | `{id}` | definición completa (nodes/edges) |
| `flow_delete` | `{id}` | borra (cascade runs) |
| `flow_run` | `{id, input?}` | ejecuta AHORA (async: crea run `running`, procesa, persiste steps). Devuelve run resumido. |
| `flow_history` | `{flowId?, limit?}` | últimos runs con steps (esto es el "log de ejecución" que las IAs leen para autocorregirse) |
| `flow_export` | `{id}` | JSON portable del flow (sin credenciales) |
| `flow_import` | `{json, name?}` | crea flow desde JSON exportado (valida; re-apunta workspace) |
| `flow_library_list` | `{}` | los 10 presets §6 |
| `flow_library_instantiate` | `{presetId, name?}` | clona un preset al workspace (sin credenciales ni workspaceId: quedan a completar por el usuario o su IA) |

Auth = la misma key de workspace del endpoint (ya resuelto: x-api-key / ?key= /
OAuth). El `workspaceId` se deriva de la key — NUNCA del input (no cross-tenant).

Ejecución (`flow_run`): portar el runtime de `flows-engine/src/
automation-flow-engine.mjs` (`executeNode`, `deepResolve`, SSRF-guard
`assertPublicHttps`/`blockedIp`, timeouts, límite de output). El nodo
`template` llama a las tools internas existentes (`get_html_frames`,
`create_template`, `import_design`...). El nodo `ai` usa BYOK guardado del
usuario (misma tabla/credenciales que el ChatFAB).

**Límite CPU Workers (real, no inventado):** free = 10ms CPU POR INVOCACIÓN.
El motor vive de esperas de red (no quema CPU), pero parsear XML/HTML sí suma.
Presupuesto: flujos ≤10 nodos y batches ≤3 noticias por invocación caben
holgado. Patrón oficial para cargas grandes: la IA parte el trabajo en varias
`flow_run` (ej. 9 noticias = 3 corridas de 3) — documentado en la descripción
de la tool `flow_run` para que cualquier IA lo sepa.

**Nitter:** `fetchNitterSource` ya maneja múltiples instancias con fallback;
si todas fallan, el nodo reporta error de fuente y el run sigue con las otras
fuentes (comportamiento ya implementado — conservar).

### 5. Nodo `template` — elegir diseño y frame EXACTO visualmente

El requisito de Ren: "si tengo un archivo con post y story, el flow me deja
elegir el archivo Y el frame".

- En el editor de flow, el nodo `template` muestra un picker de 2 niveles:
  1. **Archivo**: grid mini de templates del workspace (mismo fetch que
     Diseño → Archivos: thumbnails incluidos).
  2. **Frame**: al elegir archivo, lista sus frames (`get_html_frames`: nombre,
     w×h, thumbnail del frame si existe) → click selecciona
     `{templateId, frameId}` y lo guarda en `config` del nodo.
- Config resultante: `{templateId, frameId, format: 'post'|'story'|'custom'}`.
- En runtime el nodo clona ese frame como base y aplica el contenido que viene
  de nodos anteriores (título, resumen, imagen vía `upload_image` → URL firmada,
  NUNCA base64 — pitfall #9 conocido).
- Varios nodos `template` por flow permitidos (post + story del mismo archivo
  = 2 nodos apuntando a frames distintos).

### 6. Biblioteca — 10 presets

Semilla en `src/data/flowLibrary.ts` (y servida por `flow_library_list`):

1. **Noticias (RSS → carrusel)** — la bandera: 2-3 RSS + AI redactor + 2 nodos
   template (post+story) + report. Preset apunta a frames placeholder; al
   instanciar, el wizard/IA pide elegir archivo+frame.
2. Noticias tech EN inglés → traducidas (nodo ai translate) → carrusel.
3. Vigilancia de competencia (RSS/Nitter de X cuentas → digest semanal a
   nowhere-yet: solo template documento-resumen).
4. Chisme de X (Nitter) → hot takes IA → post opinion.
5. Monitor de precio/API (http node con jsonpath + condition + post si umbral).
6. SEO/Geo: keyword → título+desc → 3 variantes de post con templates propios.
7. Testimonio → card quote con template.
8. Calendario: evento ICS/http → recordatorio visual (post).
9. Newsletter: digest de N feeds → template documento largo.
10. Blank (canvas vacío, para armar desde cero).

Estructura de un preset = JSON de flow sin credenciales; los nodos `ai` llevan
`credentialId: null` y la UI pide conectar proveedor al ejecutar la 1ª vez
(suave: toast "este flow necesita una IA conectada").

### 7. Export/import entre cuentas

- `flow_export` devuelve JSON `{version:1, name, trigger, nodes, edges}`
  (SIN workspaceId ni credenciales — portabilidad limpia).
- `flow_import` valida y crea en el workspace de la key que llama.
- UI: botones Exportar (descarga .json) e Importar (pegar JSON / subir
  archivo) en Mis Flows.
- Los presets de la biblioteca SON JSON exportados — mismo formato, cero
  código extra.

### 8. IAs: usar, revisar, corregir, crear

Ya cubierto por las tools (MCP-first). Flujos de uso reales:
- **Usar a voluntad**: la IA del usuario (conectada al /mcp con su key) llama
  `flow_run` cuando quiera — "usa mi flujo de noticias" → 1 llamada.
- **Revisar logs**: `flow_history` devuelve steps con error por nodo.
- **Corregir**: lee history → ajusta el JSON (ej. reemplaza feed caído) →
  `flow_save` con el mismo `id` → `flow_run` de nuevo. Cada save conserva
  `updated_at`; la IA firma `created_by: 'ai:<model>'` al CREAR.
- **Crear**: describe el flow en JSON → `flow_save` sin `id`. El schema de
  nodos es estable y documentado en la tool description (prompt-friendly).
- Sin scheduler server: los horarios son responsabilidad de la IA del usuario
  (su cronjob externo llama `flow_run`) — decisión de Ren por costo.

## Fuera de alcance v1 (explícito)

- Scheduler server-side (cron en Netlify/Worker): NO (costo/recursos).
- Marketplace público de flows: la biblioteca interna cubre el demo.
- Nodos con estado entre runs (memoización): no.
- UI de credenciales BYOK nueva: reusar la existente.

## Plan de implementación (orden sugerido)

1. Migración v58 (tablas + RLS + índices).
2. Tools MCP CRUD + validate (port de los validators de flows-engine).
3. Runtime de ejecución en el Worker (port executeNode + SSRF-guard + timeouts;
   parser RSS propio chico — rss-parser NO corre en Workers).
4. Nodo template + wiring con tools internas de Musa.
5. Tab Flows: Mis Flows (grid) → click → Editor de flow (canvas + panel).
6. Biblioteca (10 presets) + Ejecuciones (runs log).
7. Export/import + library instantiate.
8. QA dogfood: flujo de noticias end-to-end con 1 feed + 2 noticias → template
   en el editor + run visible en Ejecuciones.

## Verificación

1. `flow_save` + `flow_run` vía curl al /mcp (como cualquier IA) → template
   creado en el workspace + `flow_history` con steps OK.
2. En la UI: pestaña Flows visible entre Contactos y Configuración; grid
   muestra el flow; click abre el editor; export → import en otra cuenta OK.
3. Nodo template: elegir archivo con 2 frames → post y story ambos creados.
4. Biblioteca: instantiate "Noticias" → flow clonado ejecutable.
5. IA externa (Claude/Eco): con la key del workspace, lista, ejecuta, lee
   history, corrige un feed caído y re-guarda — todo sin UI.
