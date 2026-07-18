# /goal — Design Knowledge Graph + File Meta (CORREGIDO por Lara, 2026-07-18)

Plan aprobado CON CORRECCIONES. Tu propuesta original tiene 5 errores verificados contra el repo.
Implementa esta versión corregida, no la original.

---

## CORRECCIONES OBLIGATORIAS

### C1. SQL — tipos reales del schema
`workspaces.id` y `templates.id` son **TEXT** (`ws_xxx`, `tpl_xxx`), NO UUID.
Verifícalo en `supabase_schema_complete.sql:11` y `:24`. Tu `workspace_id UUID REFERENCES workspaces(id)` falla la migración.

### C2. RLS — `workspace_members` NO existe
Solo aparece en `docs/SUPABASE_AUTH_TEAMS.sql` (doc aspiracional, no aplicado).
La app NO usa Supabase Auth: el frontend llama a la API de Netlify con `x-api-key`
(`src/lib/supabase.ts` es un fetch wrapper, no un cliente Supabase). El backend usa service key.
→ Replica el patrón RLS de las tablas existentes (`templates`, `assets`). Nada de `auth.uid()` ni `workspace_members`.

### C3. Capa de ejecución — Netlify Functions, NO Express
`netlify.toml` rutea `/api/*` → `netlify/functions/api.mjs` y `/mcp` → `netlify/functions/mcp.mjs`.
El folder `api/` (Express) NO corre en producción.
→ Endpoints nuevos van en `netlify/functions/api.mjs`. MCP tools nuevos van en `netlify/functions/mcp.mjs`.

### C4. Rutas reales de archivos
- Dashboard: `src/components/Dashboard.tsx` (no `src/pages/`)
- Cover Flow: NO hay `CoverFlow.tsx` — el modo `flow` vive dentro de `Dashboard.tsx` (~línea 755, `cardMode === "flow"`)
- No existe `api/src/mcp-tools/`

### C5. Reutilizar lo que ya existe
- Bucket: `design-assets` ya se crea vía SQL (`INSERT INTO storage.buckets`, patrón en `supabase_schema_complete.sql:135`). Usa prefijo `covers/{template_id}.png` o crea `design-covers` vía SQL con el mismo patrón. CERO pasos manuales en dashboard.
- Snapshot: ya existe `captureFrameToPng` + `handleCaptureThumbnail` → MCP `update_thumbnail` (`src/pages/EditorV2.tsx:1948`). El botón "Take snapshot" del cover DEBE reutilizar `captureFrameToPng`, no duplicar lógica.
- Grafo: `PLAN_PRODUCTO.md` §3 ya especifica Fase A/B con `computeStyleFingerprint` para aristas de similitud. Este feature ES Fase A+B con campos estructurados. No crear un sistema de tags paralelo.

---

## SQL CORREGIDO (base — ajusta al patrón RLS existente)

```sql
CREATE TABLE IF NOT EXISTS design_file_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  brand TEXT,
  tags TEXT[] DEFAULT '{}',
  theme TEXT,
  format TEXT,          -- "web" | "mobile" | "social" | "print" | "email"
  file_type TEXT,       -- "frame" | "deck" | "template" | "export"
  cover_image_url TEXT, -- Supabase Storage public URL (curado por humano/IA)
  obsidian_link TEXT,   -- obsidian://open?vault=...&file=...
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id)
);

CREATE INDEX IF NOT EXISTS idx_dfm_brand ON design_file_meta(brand);
CREATE INDEX IF NOT EXISTS idx_dfm_tags ON design_file_meta USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_dfm_workspace ON design_file_meta(workspace_id);
```

Clave por `template_id` (FK real, cascade), NO por `file_path` (texto libre = metadata huérfana al renombrar; en este sistema no hay file paths, hay templates en DB).
`cover_image_url` (curado) convive con `templates.thumbnail` (auto): la UI prefiere cover, fallback thumbnail.

## MCP TOOLS (en `netlify/functions/mcp.mjs`)

| Tool | Params | Nota |
|---|---|---|
| `get_file_meta` | `templateId` | |
| `set_file_meta` | `templateId` + campos opcionales | upsert |
| `query_design_graph` | `workspaceId`, `brand?`, `tag?`, `format?` | nodos + aristas (tags/brand compartidos; similitud fingerprint = fase 2) |
| `upload_cover_image` | `templateId`, `imageBase64?` | sube a Storage, guarda URL en meta. Límite 1MB como `update_thumbnail` |

## API (en `netlify/functions/api.mjs`)

- `GET /api/meta/:templateId`
- `PUT /api/meta/:templateId`
- `GET /api/graph?workspaceId=...&brand=...&tag=...`
- `POST /api/meta/:templateId/cover` (base64 PNG/JPG)

## UI

1. **Graph Tab** en `src/components/Dashboard.tsx`, al lado de Config. Canvas 2D force-layout propio (~200 líneas, sin D3 — como especifica PLAN_PRODUCTO §3 Fase B). Nodos muestran cover/thumbnail. Click nodo → abrir editor. Botón/ícono secundario → `obsidian_link`.
2. **FileInfoPanel** (nuevo, `src/components/FileInfoPanel.tsx`) en panel derecho de `src/pages/EditorV2.tsx`: brand, tags (chips), theme, format, file_type editables con autosave (debounce 2s como `useAutoSave`). Cover widget: subir PNG/JPG **o** "Usar snapshot" (reutiliza `captureFrameToPng`). Link Obsidian clickeable.
3. **Cover Flow** (`Dashboard.tsx` modo flow): preferir `cover_image_url` → `thumbnail` → placeholder. Aplicar §6 de PLAN_PRODUCTO: SOLO `<img>`, virtualización centro±4, cero iframes/shadow DOM en el carrusel.

## ORDEN

1. SQL → Supabase
2. Endpoints en `api.mjs`
3. MCP tools en `mcp.mjs` (testeables por IA de inmediato)
4. FileInfoPanel en editor
5. Graph Tab
6. Cover Flow con covers + virtualización

## ACEPTACIÓN

- [ ] Migración corre sin errores en Supabase (tipos TEXT)
- [ ] `set_file_meta` + `get_file_meta` vía MCP roundtrip OK
- [ ] Subir cover PNG desde el panel → aparece URL pública de Storage → visible en Cover Flow
- [ ] "Usar snapshot" genera cover sin duplicar código de captura
- [ ] `query_design_graph` devuelve nodos+aristas filtrando por brand/tag
- [ ] Click en `obsidian_link` abre Obsidian (protocolo `obsidian://` estándar, OK en Windows)
- [ ] Cover Flow con 100 templates: solo 9 `<img>` montadas, sin crash

/goal
