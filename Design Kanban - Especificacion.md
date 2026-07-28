# 🎨 Design Kanban — Especificación de Requerimiento

**Autor:** Mira (Hermes Agent)
**Fecha:** Julio 2026
**Versión:** 1.0

---

## 1. Propósito

Un tablero Kanban especializado para la producción de diseños (templates, banners, posts, presentaciones, decks) para las marcas del ecosistema Futuraria. Cada tarjeta representa una pieza de diseño que debe ser investigada, redactada, diseñada y aprobada. El Kanban se integra con la Design Tool vía MCP y con cronjobs de Hermes para que la IA produzca diseños automáticamente.

---

## 2. Marcas a incluir en el sistema

| Marca | Workspace Design Tool | Activa |
|-------|----------------------|--------|
| Futuraria | ws_futuraria | ✅ |
| Diatta | ws_diatta | ✅ |
| Plaza Aurora | ws_plazaaurora | ✅ |
| Mirella Bartra | ws_mirellabartra | ✅ |
| Hilda Ayme | ws_hildaayme | ✅ |
| Tocki Studio | ws_tocki | ✅ |
| Boring Studios | ws_boring | ✅ |
| GHCoin | ws_ghcoin | ✅ |
| FoodPrice | ws_foodprice | ✅ |
| Polimi | ws_polimi | ✅ |
| Xiaomi (ex-ejecutivo) | ws_xiaomi | ✅ |
| Jockey Plaza | ws_jockey | ✅ |
| Isela Bartra (Chef) | ws_isela | ⏸️ |

---

## 3. Estados del Kanban

```
[BACKLOG] → [RESEARCH] → [DRAFT] → [DESIGN] → [REVIEW] → [DONE]
                ↑            ↓         ↓          ↓
                └── [FEEDBACK] ←────────┘──────────┘
```

| Estado | Significado | Responsable |
|--------|-------------|-------------|
| **Backlog** | Idea de diseño pendiente. Solo título + marca. | Ren / Mira |
| **Research** | Investigando tema, referencias, copy, assets. | Mira (cronjob) |
| **Draft** | Contenido redactado. Listo para diseñar. | Mira → Design Tool |
| **Design** | Diseño en progreso en Design Tool. Template creado, frames poblándose. | Mira vía MCP |
| **Review** | Diseño completado. Ren revisa y da feedback. | Ren |
| **Feedback** | Cambios solicitados. Vuelve a Design. | Mira (con feedback de Ren) |
| **Done** | Aprobado. Publicado/entregado. | Sistema |

---

## 4. Estructura de cada tarjeta

```yaml
id: dk_001
title: "Banner LinkedIn — Futuraria: Cómo la IA reduce costos operativos"
brand: futuraria
type: banner  # banner | post | deck | template | landing | factura | cotizacion
format: linkedin_post  # 1200x627
status: backlog
priority: 1  # 1=urgente, 2=normal, 3=cuando haya tiempo
deadline: 2026-08-01

# Contenido
brief: "Post sobre ROI de automatización con IA. Enfocado a gerentes de operaciones."
copy_draft: null  # Se llena en fase Research
tone: profesional
cta: "Calcula tu ahorro en futuraria.com"

# Diseño
template_id: null  # ID del template en Design Tool cuando se cree
frame_id: null
render_url: null

# Metadata
created_by: mira
created_at: 2026-07-28
updated_at: 2026-07-28
assigned_to: default  # Perfil de Hermes que lo trabaja
cronjob_id: null  # Si fue generado por un cronjob
```

---

## 5. Integración con Cronjobs

### Cronjob 1: Content Researcher (diario, 6am)
1. Lee el Kanban de Diseño → busca tarjetas en `backlog`
2. Para cada una: investiga tema, escribe copy, guarda en `draft`
3. Mueve tarjeta a `draft`

### Cronjob 2: Design Producer (diario, 7am)
1. Lee tarjetas en `draft`
2. Por cada una: crea template en Design Tool vía MCP
3. Puebla frames con copy + assets
4. Renderiza preview
5. Mueve a `review`

### Cronjob 3: Design Kanban Sync (cada 30 min)
1. Lee estado de templates en Design Tool
2. Sincroniza con el Kanban (si un template se completó manualmente, actualiza la tarjeta)
3. Notifica a Ren si hay tarjetas en `review` hace más de 24h

---

## 6. Integración con Design Tool MCP

```
Tarjeta "draft" → Design Tool
  ├── get_workspace(brand) → ws_id
  ├── create_template(título, ws_id) → template_id
  ├── create_frame(template_id, formato) → frame_id
  ├── set_frame_layers(frame_id, contenido HTML/CSS)
  ├── render_html_template(template_id) → preview_url
  └── Actualizar tarjeta → "review"
```

---

## 7. Vistas del Kanban

### Vista 1: Por Marca
Agrupa tarjetas por `brand`. Ren ve qué marcas tienen más/menos contenido.

### Vista 2: Por Estado
Columnas Kanban estándar. Visualiza el flujo de producción.

### Vista 3: Por Tipo
Agrupa por `type` (banners, posts, decks, etc.).

### Vista 4: Urgente
Solo tarjetas con `priority=1` o `deadline` cercano.

---

## 8. Implementación técnica

### Opción A: Kanban de Hermes nativo
- Usar `hermes kanban boards create design`
- Cada tarjeta tiene metadatos en `--body` como YAML
- Ventaja: integración nativa con cronjobs + workers
- Desventaja: no tiene campos personalizados (tipo, marca, formato)

### Opción B: Kanban en Supabase
- Tabla `design_tasks` con campos tipados
- Interfaz web ligera (o usar Design Tool como frontend)
- Ventaja: campos personalizados, queries por marca/estado
- Desventaja: requiere desarrollo adicional

### Opción C: Híbrido
- Kanban Hermes para el flujo de trabajo (estados, workers)
- Supabase para metadata enriquecida (marca, tipo, formato)
- Sincronización bidireccional vía cronjob

---

## 9. MVP — Lo que necesitamos YA

1. **Crear tablero** `hermes kanban boards create design`
2. **Template de tarjeta** — estandarizar el formato YAML en el body
3. **Cronjob Content Researcher** — que lea backlog y produzca drafts
4. **Cronjob Design Producer** — que lea drafts y diseñe vía MCP
5. **Dashboard mínimo** — `hermes kanban ls` con filtro por marca

Fase 2: Supabase + UI web.
Fase 3: Vista cliente (cada marca ve solo sus diseños).

---

## 10. Métricas de éxito

- Tarjetas movidas de backlog → done por semana
- Tiempo promedio backlog → done
- Tasa de aprobación (review → done sin feedback)
- Diseños producidos por cronjob vs manuales
