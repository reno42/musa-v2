# 🔬 Análisis: Figma MCP — ¿Replicable con Servicios Freemium?

**Fecha:** 2026-07-02 | **Autora:** Lara ✨  
**Fuente:** Texto compartido por Ren sobre funcionalidades del Figma MCP  
**Pregunta:** ¿Podemos lograr esto mismo con servicios freemium?  
**Última actualización:** Corregido tras revisión del codebase real (sin Fabric.js, sin Puppeteer server-side)

---

## 📋 Las 3 Capacidades del Figma MCP (según el texto)

### 1. Conexión con OpenClaw, Hermes o Claude Code
### 2. Uso de assets propios vs diseño desde cero
### 3. Medición de calidad + traducción interna (JSON, CSS, Markdown)

---

## 1. CONEXIÓN: ¿Podemos conectar OpenClaw, Hermes, Claude Code?

### Lo que hace Figma MCP

| Cliente | Soporte | Mecanismo |
|---------|:---:|------|
| Claude Code | ✅ Nativo | Terminal + servidor oficial Figma |
| OpenClaw | ⚠️ Vía Composio | Bridge de autenticación + tools |
| Hermes | ⚠️ Vía Composio | Bridge de autenticación + tools |

> Figma solo permite clientes en su [MCP Catalog](https://www.figma.com/mcp-catalog/). Fuera de esa lista, necesitas un middleware.

### ¿Podemos con freemium?

| Cliente | A Figma MCP | A nuestro Design MCP |
|---------|:---:|:---:|
| **Claude Code** | ✅ Nativo (catálogo) | ✅ JSON-RPC estándar |
| **OpenClaw** | ⚠️ Composio ($) | ✅ Ya conectado, lo usamos a diario |
| **Hermes** | ⚠️ Composio ($) | ✅ JSON-RPC estándar |

**Conclusión:** Para conectarnos a **nuestro** Design MCP — $0, sin restricciones. Para Figma MCP oficial — Claude Code es la única ruta directa gratuita.

---

## 2. ASSETS: ¿Usa mis assets o diseña desde cero?

### Lo que hace Figma MCP

```
1. get_design_system_kit / get_variables
   → Lee componentes, variantes, estilos, tokens (color, espacio, tipografía)

2. Si encuentra "Botón Primario" → reutiliza su ID
   → "Crea una sección de comentarios usando el botón y avatar existentes"

3. Si no existe → lo crea desde cero
   → "Crea un nuevo archivo Figma llamado 'Pasarela de Pago'"

4. Code Connect
   → Mapea componentes Figma ↔ código real (src/components/ui)
```

### ¿Podemos con freemium?

| Capacidad Figma MCP | Nuestro equivalente freemium | Costo |
|---------------------|------------------------------|:---:|
| Escanear biblioteca (componentes, tokens) | Skills de diseño (`futuraria-design-system`, `frontend-design-3`, etc.) — Markdown con paleta, tipografía, componentes | $0 |
| Reutilizar componentes existentes | MCP: `get_template(id)` + `duplicate_template` → editar HTML/CSS del frame | $0 |
| Diseñar desde cero | Skills → IA genera HTML/CSS funcional directamente en frames (Shadow DOM) | $0 |
| Code Connect (diseño ↔ código) | Skills YA mapean componentes visuales a Tailwind + React. Output es HTML/CSS real. | $0 |

**Nuestra ventaja sobre Figma MCP:** "Code Connect" al revés. Figma mapea diseño → código. Nosotros generamos el código directamente. El diseño y el código son el mismo output.

**NOTA TÉCNICA (corregido):** El editor ya NO usa Fabric.js. Los frames son HTML/CSS rendered en Shadow DOM (`DesignFrame.tsx`). El renderizado es nativo del navegador, con `html2canvas` para export PNG client-side.

---

## 3. CALIDAD: ¿Cómo se mide? + El "Traductor" Interno

### Lo que dice el texto

> "La calidad del diseño depende casi en su totalidad de la IA que conectes"
> "Figma traduce el lienzo visual a JSON, CSS y Markdown para que el LLM lo procese"

### El sistema de control de calidad de Figma MCP (3 pilares)

**Pilar 1: "Inspección Primero"**
> La IA no muta sin antes leer assets existentes. Si encuentra un componente, está obligada a reutilizarlo.

**Pilar 2: Auto-corrección por screenshots**
> `take_screenshot` → visión multimodal → compara con instrucción → corrige errores visuales → repite

**Pilar 3: Auto Layout obligatorio**
> Skills prohíben position absolute. Exigen Auto Layout. Resultado: diseño responsivo.

### El "Traductor" Interno de Figma

```
Figma Canvas (visual) → MCP Server →
  • JSON tree (jerarquía de nodos)
  • CSS custom properties (tokens)
  • DTCG JSON (estándar industria)
  • SKILL.md (instrucciones Markdown)
→ LLM procesa → genera acciones
```

### Nuestro equivalente YA funcionando

| Componente Figma MCP | Nuestro equivalente | Estado | Costo |
|----------------------|---------------------|:---:|:---:|
| **JSON tree** | MCP expone templates/frames como JSON vía `get_template`, `export_template` | ✅ | $0 |
| **CSS tokens** | `futuraria-design-system` skill + variables en metadata del template | ✅ | $0 |
| **Markdown guides** | 15 skills de diseño = equivalentes a `figma-use.md` | ✅ Más completas | $0 |
| **Inspección Primero** | Skills son leídas por IA antes de generar; MCP expone `get_template` | ✅ | $0 |
| **Screenshot → Visión → Fix** | `generate_design_artifacts` → agent lo abre, screenshotea, evalúa con visión, corrige | ✅ Implementado | $0 |
| **Auto Layout** | Editor usa HTML/CSS nativo. Flexbox/grid YA funcionan. Solo falta campo `layoutMode` en FrameData para que lint rules se adapten. | ⚠️ Falta `layoutMode` field + `lint_design` tool | $0 |
| **DTCG JSON** | No implementado | ⚠️ Falta `export_design_tokens` | $0 |
| **Google Fonts** | `GoogleFontPicker.tsx` ya existe en el editor | ✅ | $0 |
| **Imágenes** | `ImageUploadModal.tsx` ya existe. html2canvas para export. | ✅ | $0 |

**CORRECCIÓN IMPORTANTE:** El renderizado NO usa Puppeteer. Netlify Functions tiene límite de 50MB de bundle — Puppeteer + Chromium pesan ~300MB, imposible en free tier. El render PNG es client-side (`html2canvas`). Los MCP renders devuelven HTML auto-renderizable, no PNGs server-side.

---

## 🎯 Lo que falta: Plan de Implementación (4 tools + layoutMode)

### Prerrequisito: `layoutMode` en FrameData

**Archivo:** `src/components/DesignFrame.tsx`

Agregar `layoutMode: "fixed" | "responsive"` a `FrameData`. Default `"fixed"` para templates existentes (social media). La IA lo define según intención del prompt. No requiere migración DB — los frames son JSON blobs en Supabase.

---

### Tool 1: `get_design_system` — Inspección Primero (~2-3h)

Devuelve snapshot completo del design system como JSON + CSS. Equivalente a `get_design_system_kit` de Figma.

```json
{
  "brand": { "name": "Diatta", "colors": {...}, "fonts": [...] },
  "tokens": [{ "id": "var_xxx", "name": "primary-color", "type": "color", "value": "#ef4d23" }],
  "tokensAsCss": ":root { --primary-color: #ef4d23; }",
  "components": [{ "id": "comp_xxx", "name": "Button/Primary" }],
  "frames": [{ "id": "frame_xxx", "layoutMode": "fixed" }],
  "instruction": "Use these tokens. Reuse these components. Do not invent new colors."
}
```

---

### Tool 2: `lint_design` — Control de Calidad (~2-3h)

Ejecuta heurísticas sobre HTML/CSS de un frame. Reglas se adaptan según `layoutMode`.

| Regla | `fixed` mode | `responsive` mode |
|-------|-------------|-------------------|
| Elementos deben tener position absolute + left/top | **Error** si falta | N/A |
| Elementos deben usar flexbox/grid | N/A | **Warn** si usan absolute |
| Colores hardcodeados fuera de brand tokens | **Error** | **Error** |
| Contraste < 4.5:1 (WCAG AA) | **Warn** | **Warn** |
| Font family fuera de brand list | **Error** | **Error** |

Usa `cheerio` (ya instalado) + parser CSS del `mcp.mjs`.

---

### Tool 3: `export_design_tokens` — Portabilidad (~1-2h)

Exporta tokens en CSS custom properties + DTCG JSON (estándar industria).

```json
{
  "css": ":root { --primary-color: #ef4d23; }",
  "dtcg": { "color": { "primary": { "$value": "#ef4d23", "$type": "color" } } }
}
```

---

### Resumen

| Tool | Propósito | Horas | Nuevas deps | Free |
|------|-----------|:---:|:---:|:---:|
| `get_design_system` | IA lee antes de diseñar | 2-3h | Ninguna | ✅ |
| `lint_design` | Quality score + issues | 2-3h | Ninguna (cheerio ya está) | ✅ |
| `export_design_tokens` | CSS + DTCG JSON | 1-2h | Ninguna | ✅ |
| `layoutMode` field | Fixed vs responsive | 30min | Ninguna | ✅ |
| **Total** | | **~6h** | **$0** | **✅** |

---

## 📊 Matriz Final: ¿Qué se puede y qué no?

### ✅ YA FUNCIONA ($0)

- Conexión de cualquier cliente MCP a nuestro Design MCP
- "Inspección Primero" vía skills + MCP `get_template`
- Assets reutilizables (templates/frames HTML/CSS)
- Diseño desde cero (texto → HTML/CSS funcional en frames)
- Code Connect inverso (output ES código)
- Traducción a JSON + CSS + Markdown para la IA
- Google Fonts (GoogleFontPicker.tsx)
- Imágenes (ImageUploadModal.tsx, html2canvas)
- Render client-side (html2canvas)
- Auto Layout básico (HTML/CSS nativo: flexbox/grid)

### ⚠️ FALTA IMPLEMENTAR (~6h, $0)

| Tool | Gap |
|------|-----|
| `get_design_system` | La IA no tiene una tool unificada para leer el design system completo |
| `lint_design` | No hay validación automática de reglas de diseño |
| `export_design_tokens` | No hay export DTCG JSON estándar |
| `layoutMode` field | FrameData no distingue fixed vs responsive |

### ❌ NO VIABLE EN FREEMIUM

| Funcionalidad | Por qué |
|---------------|---------|
| Crear archivos `.fig` nativos | Formato propietario de Figma |
| Puppeteer server-side | Netlify Functions: 50MB bundle limit. Puppeteer + Chromium: ~300MB |
| Multiplayer real-time | No es prioridad, complejidad alta |

---

## 💰 Costo del Stack Completo

| Componente | Servicio | Costo |
|-----------|----------|:---:|
| Skills (15) | Archivos locales | $0 |
| Design MCP Server | Netlify Functions (50MB limit) | $0 |
| Editor WYSIWYG | Netlify + React + Shadow DOM HTML/CSS | $0 |
| Base de datos | Supabase (500MB) | $0 |
| Storage | Supabase Storage (1GB) | $0 |
| Render PNG | html2canvas (client-side) | $0 |
| Fuentes | Google Fonts API | $0 |
| IA (agente) | DeepSeek vía OpenClaw | ~$0 |
| **TOTAL** | | **$0/mes** |

---

## 🔮 Conclusión

> **El ~70% de lo que describe el texto de Figma MCP ya funciona en nuestro stack freemium.**
>
> Los gaps reales (corregidos tras revisión del codebase): `get_design_system`, `lint_design`, `export_design_tokens`, y `layoutMode`. Todo implementable en ~8h con $0.
>
> La única funcionalidad genuinamente irremplazable es crear archivos `.fig` nativos. Puppeteer server-side también es inviable en Netlify free (50MB limit), pero no lo necesitamos — html2canvas client-side + `generate_design_artifacts` agent-side cubren el caso de uso.
>
> **Estrategia:** Implementar las 3 tools + layoutMode. Con eso cubrimos el 100% de lo que Figma MCP ofrece que sea relevante para nosotros.

---

**Preparado por Lara** ✨ | `design-main/docs/ANALISIS_FIGMA_MCP_VS_FREEMIUM.md`
