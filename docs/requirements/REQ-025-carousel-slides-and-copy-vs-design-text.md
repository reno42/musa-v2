# REQ-025 — Carruseles: texto por slide + separación visual copy-caption vs texto-del-diseño

**Fecha:** 2026-09-25 · **Estado:** propuesto · **Prioridad:** alta
**Reportado por:** Ren (campaña real "Neti x Futuraria 90d", 38 fichas, grilla 90 días)

## Problema

En el Calendario de Contenidos, una ficha de carrusel tiene N piezas de texto que
hoy NO caben en el modelo de datos, y la UI no distingue dos textos distintos:

1. **Caption** (el texto que ACOMPAÑA el diseño al publicar) → existe: columna
   `content_calendar.copy`.
2. **Texto que va DENTRO de cada slide del carrusel** → NO existe ninguna columna
   ni tabla. Hoy los agentes lo incrustan como texto plano dentro del `copy`
   con un separador (`— SLIDES DEL CARRUSEL —`), que es un hack no estructurado:
   no se puede editar slide por slide, no alimenta el export PPT por slide, y no
   puede sincronizarse con los frames del diseño.

Evidencia (25 Sep 2026, producción):
- Schema `content_calendar` (supabase_migrations_v22.sql L21-72): no hay columna
  de slides ni JSON para texto por página.
- `update_content` MCP (netlify/functions/mcp.mjs ~L5197+): acepta `copy` plano,
  sin estructura por slide.
- La ficha en la UI (src/components/ContentTab.tsx) muestra un solo bloque de
  texto: el usuario no puede distinguir "esto es el caption" de "esto va en el
  diseño". El sub-tab "Copys" (Biblioteca de textos) lista los textos de las
  PLANTILLAS, pero no está conectado a la ficha del calendario — no hay nada que
  diga "estos son los textos del diseño vinculado a ESTA pieza".
- La hora (`scheduled_time`) sí existe y funciona (chip en la vista calendario),
  el reporte original era falta de dato, no de feature. Ya resuelto con datos.

## Solución

### 1. Migración: `content_slides`

```sql
CREATE TABLE IF NOT EXISTS content_slides (
  id          TEXT PRIMARY KEY DEFAULT ('cs_' || substr(md5(random()::text), 1, 16)),
  entry_id    TEXT NOT NULL REFERENCES content_calendar(id) ON DELETE CASCADE,
  slide_no    INT  NOT NULL,             -- 1 = portada
  text        TEXT NOT NULL DEFAULT '', -- texto que va DENTRO del slide
  design_note TEXT,                     -- nota visual para el diseñador/IA (opcional)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entry_id, slide_no)
);
CREATE INDEX IF NOT EXISTS idx_slides_entry ON content_slides(entry_id, slide_no);
-- RLS igual que content_calendar: aislado por workspace vía join a content_calendar.
```

### 2. API REST (api/src/routes/contentCalendar.ts)

- `GET /api/content/:id` devuelve `slides: [{slide_no, text, design_note}]`.
- `PUT /api/content/:id/slides` — reemplaza la lista completa (upstream simple,
  borra e inserta en transacción). Body: `{slides:[{slide_no,text,design_note?}]}`.

### 3. MCP (netlify/functions/mcp.mjs)

- `update_content` acepta parámetro nuevo opcional `slides`: array de
  `{slideNo, text}` → escribe a `content_slides` (misma transacción lógica que
  el patch REST). `slides: ""` (string vacío) borra todos los slides de la ficha.
- `list_calendar_entries` incluye `slideCount` por ficha (subquery count) para
  que un agente detecte carruseles sin slides.
- Tool nueva `list_slides({contentId})` → devuelve los slides en orden.

### 4. UI (src/components/ContentTab.tsx — detalle de ficha)

Separar VISUALMENTE los dos textos, en este orden:

```
┌─ COPY DE PUBLICACIÓN (caption) ────────────────┐
│  textarea multilínea → content_calendar.copy   │
│  hint: "Texto que acompaña el post al publicar"│
└────────────────────────────────────────────────┘
┌─ SLIDES DEL CARRUSEL (texto dentro del diseño) ┐
│  1. [textarea]  [+ añadir slide] [↑][↓][🗑]     │
│  2. [textarea]                                  │
│  → content_slides                               │
└────────────────────────────────────────────────┘
┌─ TEXTOS DEL DISEÑO VINCULADO (solo lectura) ───┐
│  si templateId+frameId: lista los data-layer   │
│  texts del frame (GET frame existente) con     │
│  botón "Editar en el editor" → abre el frame.  │
│  hint: "Texto pixelado en el arte — se edita   │
│  en el archivo, no aquí"                       │
└────────────────────────────────────────────────┘
```

Regla de migración de datos: si `copy` contiene el separador histórico
`— SLIDES DEL CARRUSEL (texto que va DENTRO del diseño) —` (puesto por los
agentes antes de este req), parsear los bloques `S<n> — ...` a filas de
`content_slides` UNA vez (script idempotente) y dejar el caption limpio.

### 5. Export PPT (ContentTab.tsx ~L513-634)

Hoy el slide del deck pone el `copy` completo como texto nativo al lado del arte.
Extender: si la ficha tiene slides, el caption nativo muestra SOLO el caption y
añade debajo una línea por slide (`S1: ...`, `S2: ...`), para que el cliente vea
el texto de cada página del carrusel sin abrir el diseño.

## Verificación

1. `npm run build` verde.
2. Crear ficha de carrusel en la UI → añadir 5 slides → recargar: persisten.
3. Desde MCP: `update_content({id, slides:[{slideNo:1,text:"..."}]})` →
   `list_slides({contentId})` los devuelve; `list_calendar_entries` muestra
   `slideCount:1`.
4. Export PPT de la campaña: el slide de la pieza muestra caption + S1..Sn.
5. Ficha con diseño vinculado: el bloque "TEXTOS DEL DISEÑO" lista los textos
   reales del frame (probar con tpl_94e04b22-466, frame Mes 1).
6. Script de migración corre 2 veces sin duplicar slides.
