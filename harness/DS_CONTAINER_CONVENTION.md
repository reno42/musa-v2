# DS Container Convention — una marca = su contenedor

> Spec v1 (2026-09-05). Fuente de verdad de la regla "una marca = su contenedor
> de marca". Toda creación de Design Systems —CRM, MCP, agentes, UI— sigue esta
> convención.

## 1. La ley

1. **No existe Design System sin marca.** El primer dato que se pide al crear
   uno es la marca (existente o nueva, creada inline). Nunca se piden medidas.
2. **Una marca = tres archivos**, creados atómicamente al crear la marca:

| Archivo | `brand_container_kind` | Contenido |
|---|---|---|
| `DS — {Marca}` | `ds` | Identidad visual (frames 01–08 + libres) |
| `Plantillas — {Marca}` | `plantillas` | Frames curados por el humano (copias; los originales nunca se retiran) |
| `Comunicación — {Marca}` | `communication` | Render del Brand Strategy Canvas (tono, esencia, personas) |

3. **El archivo es el contenedor; agregar algo = nuevo frame.** Nunca un
   archivo nuevo para "más cosas de la marca".
4. Los tres archivos viven SOLO en el tab **Diseño → Design Systems** (y en la
   Papelera si se eliminan). No aparecen en la grilla de Archivos.
5. El vínculo marca↔DS es por **ID** (`crm_brand_id` / `design_system_template_id`,
   v35). El nombre compartido es solo fallback para filas legacy.

## 2. Frames canónicos del DS

Nomenclatura `NN — Nombre` (dos dígitos, guión em). El sistema parsea la
sección desde el prefijo:

```
01 — Portada          05 — Espaciado y Grid
02 — Logo             06 — Componentes
03 — Paleta           07 — Fotografía e ilustración
04 — Tipografía       08 — Do & Don't
09+ — Secciones libres (tablas, gráficos, moodboards del humano)
```

- Frames **sin número** = extras; no participan del completeness.
- `generateManualFrames` nace con 01–08 con placeholders visibles
  ("pendiente") — el humano ve qué falta y lo pinta/llena.

## 3. Curaduría de plantillas (frame-level)

- Acción del editor sobre UN frame: *"Guardar como plantilla de marca"* →
  **copia** el frame a `Plantillas — {Marca}` con nombre
  `"{nombre original} — de {archivo origen}"`.
- Los originales jamás se modifican ni se retiran de sus archivos.
- El batchamator apunta a `Plantillas — {Marca}`: clona frames curados N veces.
- MCP: `add_frame_to_brand` con `collection: "ds" | "plantillas"`.

## 4. Comunicación: JSON es la fuente, frames son el render

- `brands.strategy_json` (BRAND_STRATEGY_V1) es la fuente de verdad.
- Los frames del archivo Comunicación son **render regenerable**; la edición
  amigable va por el Canvas (formulario), no pintando el frame.
- Los frames `V-NN` quedan **excluidos** de la extracción visual
  (`extract_design_system` los ignora por convención de nombre).

## 5. Completitud (determinista, sin LLM)

- `dsCompleteness`: 01–08 llenos (frame existe Y sin placeholder) → score n/8.
- `plantillasCompleteness`: nº de frames curados (sugerido: ≥ 3).
- `strategyCompleteness`: secciones de BRAND_STRATEGY_V1 (Nivel 1–2 = must).
- Expuesto como badge por archivo en el tab y en `get_brand_playbook`.
