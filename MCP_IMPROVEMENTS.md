# 🎯 MCP Improvements + Design Skills Roadmap

**Fecha:** 2026-06-01 | **Autoras:** Lara + Ren

---

## 🧠 Visión: Skills de diseño personal

Cada diseñador tiene su propio "estilo". La IA debe aprenderlo para trabajar a la par.

```
Ren refina 20 estilos → Lara analiza patrones → Skill "Estilo Ren"
→ Futuros diseños de Lara heredan automáticamente el estilo de Ren
→ Si hay 2 diseñadores, cada uno tiene su skill
→ La IA adapta su output según el skill activo
```

**Esto NO está mal.** Es el mismo principio que los LLMs con fine-tuning. La IA aprende de datos reales (las refinaciones de Ren) y los aplica. El humano sigue siendo el director creativo.

---

## 🔴 P0: Lo que bloquea el workflow

| # | Gap | Herramienta | Fix |
|---|------|------------|-----|
| 1 | **Persistencia Supabase** | Templates perdidos en cold-start | `handleSelectTemplate` use `getTemplate()` |
| 2 | **Snapshot/Diff** | Lara no ve cambios de Ren | `snapshot_template` + `diff_template` MCP tools |
| 3 | **Gradientes** | Branding Futuraria es verde→púrpura | `transform_object` con gradientes |
| 4 | **Texto con gradiente** | Fabric.js no soporta gradient en texto | SVG text con gradiente o workaround |

---

## 🟡 P1: Granularidad de diseño

| # | Gap | Qué limita | MCP Tool necesaria |
|---|------|-----------|-------------------|
| 5 | **Font weight range** | Solo 400/500/700 disponibles | Cargar weights 100-900 en render HTML |
| 6 | **Italic/Bold/Underline** | `fontStyle`, `fontWeight`, `underline` inconsistentes | `transform_object` con soporte completo |
| 7 | **Letter spacing fino** | `charSpacing` funciona pero sin verificación visual | Preview en render |
| 8 | **Text shadows** | Texto ilegible sobre fondos claros | `transform_object` con `shadow` en texto |
| 9 | **Image backgrounds** | La mayoría de posts usan imágenes | `add_image` con URLs + render HTML soporte |
| 10 | **SVG Path preciso** | Logo Futuraria necesita path exacto | `add_svg_path` ya existe, falta testear |

---

## 🟢 P2: Calidad de diseño

| # | Gap | MCP Tool necesaria |
|---|------|-------------------|
| 11 | **Grid system** | `auto_layout` con grid 12-columnas |
| 12 | **Design tokens sync** | Variables globales (verde → todos los templates) |
| 13 | **Component variants** | Un componente con estados (default, hover, active) |
| 14 | **Auto-save con diff** | Guardar solo lo que cambió, no todo el canvas |
| 15 | **Export preset** | `export_frame(id, preset='instagram')` auto-dimensiona |

---

## 🧠 Skills de Diseñador (Plan Futuro)

### Cómo funciona

```
1. Ren diseña/refina N templates → Lara los analiza → extrae reglas
2. Reglas se guardan como skill: "estilo-ren.md"
3. Cuando Lara crea, aplica: "diseñar con skill estilo-ren + futuraria-design-system"
4. Si hay otro diseñador (ej: Andrea), se crea "estilo-andrea.md"
5. Cada skill es independiente, la IA adapta su output
```

### Lo que un skill de diseñador contiene

```json
{
  "name": "Estilo Ren",
  "typography": {
    "headings": { "fontFamily": "Syne", "fontWeight": 700, "lineHeight": 1.08 },
    "body": { "fontFamily": "Inter", "fontWeight": 500, "lineHeight": 1.4 },
    "labels": { "charSpacing": 150, "textTransform": "uppercase" }
  },
  "layout": {
    "padding": 80,
    "ctaPosition": "bottom-center",
    "ctaStyle": "pill-green-black"
  },
  "colors": {
    "darkBg": "#0a0a0f",
    "accent": "#d2ff02",
    "bodyText": "#999999",
    "footer": "#555555"
  },
  "patterns": [
    "Siempre usa acento en top-bar de 4px",
    "CTA pill con rx:32 centrado abajo",
    "Footer 'futuraria.com' en Inter 600 #555555",
    "Headlines grandes (56-72px) con lineHeight apretado"
  ]
}
```

### Cómo se construye automáticamente

```
Lara: analizar_refinamientos(templateId)
→ Compara todos los frames del template vs original
→ Extrae diferencias recurrentes (>2 ocurrencias = patrón)
→ Genera skill JSON automáticamente
```

---

## 📊 Total de MCP Tools sugeridas nuevas

| Tool | Propósito |
|------|-----------|
| `snapshot_template(id)` | Guarda estado de referencia |
| `diff_template(id)` | Compara actual vs referencia, retorna cambios |
| `apply_style(id, styleName)` | Aplica un skill de diseñador al template |
| `extract_patterns(id)` | Analiza refinamientos y genera reglas |
| `export_preset(id, preset)` | Exporta con dimensiones predefinidas |

---

## 📂 Relacionado
- `LICENSE.md` — Dual licensing
- `ARCHITECTURE.md` — Documentación técnica
- `20_PRIORIDADES_MCP.md` — Roadmap original
- `GAPS_FRAMES.md` — Sistema de frames
