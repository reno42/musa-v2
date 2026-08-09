# Gemini Prompt — Diseño con Design System Auto-Contenido

> **Para:** Gemini (o cualquier LLM con capacidad de generar HTML+CSS)
> **Objetivo:** Que cada diseño generado contenga su propio design system
>   reutilizable, no solo un diseño one-off.
> **Resultado:** El diseño se ve bien Y cualquier IA (o humano) puede leer
>   el CSS para extraer la paleta, tipografía, espaciado y patrones.

---

## Prompt base (copiar y pegar en Gemini)

```
Generá un diseño HTML+CSS con estas reglas ESTRUCTURALES (no negociables):

═══ REGLA 1: CSS AUTO-DOCUMENTADO ═══

El CSS DEBE comenzar con un bloque :root que declare TODAS las variables
del design system. Usá este formato exacto:

  :root {
    /* ═══ [NOMBRE DEL ESTILO] ═══ */
    /* ── Palette ── */
    --color-accent-1: #XXXXXX;   /* rol: accent, uso: títulos y CTAs */
    --color-accent-2: #XXXXXX;   /* rol: secondary, uso: íconos y badges */
    --color-ink: #XXXXXX;        /* rol: text, uso: cuerpo de texto */
    --color-muted: #XXXXXX;      /* rol: muted, uso: texto secundario */
    --color-canvas: #XXXXXX;     /* rol: background, uso: fondo principal */

    /* ── Typography Scale ── */
    --text-hero: 96px;           /* uso: títulos principales */
    --text-heading: 48px;        /* uso: subtítulos */
    --text-body: 18px;           /* uso: párrafos */

    /* ── Spacing Scale ── */
    --space-xl: 80px;
    --space-lg: 48px;
    --space-md: 24px;
    --space-sm: 12px;

    /* ── Borders ── */
    --radius-lg: 24px;
    --radius-md: 12px;
  }

═══ REGLA 2: UTILITY CLASSES ═══

Definí clases cortas y reutilizables para colores y tamaños:

  .c-accent  { color: var(--color-accent-1); }
  .c-ink     { color: var(--color-ink); }
  .c-muted   { color: var(--color-muted); }
  .bg-accent { background: var(--color-accent-1); }
  .bg-canvas { background: var(--color-canvas); }
  .t-hero    { font-size: var(--text-hero); font-weight: 800; line-height: 0.9; }
  .t-heading { font-size: var(--text-heading); font-weight: 700; }
  .t-body    { font-size: var(--text-body); line-height: 1.5; }

═══ REGLA 3: COMPONENTES NOMBRADOS ═══

Cada elemento visual distinto debe ser una clase con nombre semántico.
Ejemplos de lo que DEBE tener (elegí según tu diseño):

  .card      — contenedor con fondo y borde
  .stat      — número grande + label pequeño
  .tag       — etiqueta con fondo de color
  .pill      — botón redondeado con borde
  .timeline  — lista vertical con línea y puntos
  .quote     — cita con borde izquierdo
  .grid-2    — grid de 2 columnas
  .grid-3    — grid de 3 columnas

═══ REGLA 4: SIN VALORES HARDCODEADOS ═══

En el HTML, NUNCA uses style="color: #xxx" o style="font-size: Xpx".
Siempre usá las clases: class="c-accent t-hero".

═══ REGLA 5: INDEPENDENCIA ═══

El diseño debe funcionar como PIEZA INDIVIDUAL (se ve bien solo) y como
SISTEMA (cualquier persona o IA que lea SOLO el CSS puede recrear
variantes de este diseño sin ver el HTML).

═══ TEMA DEL DISEÑO ═══

[REEMPLAZAR CON EL BRIEF DEL DISEÑO]

Formato: [1080x1080 | 1920x1080 | etc.]
```

---

## Variantes por tipo de diseño

### Si es un POSTER / HERO visual
Agregar al prompt: _"El diseño debe ser tipográfico. La tipografía ES el diseño. Pocos elementos, máximo impacto. Usá Montserrat 900 o Playfair Display para el hero text."_

### Si es un DATA VISUALIZATION
Agregar: _"Incluí componentes para visualizar datos: bubbles de diferentes tamaños, dot grids de proporción, stat numbers con labels. Los números deben ser el foco visual."_

### Si es un EDITORIAL / MULTI-SLIDE
Agregar: _"Creá un sistema de slides con deck chrome: título posicionado, línea de acento, número de página, footer con nombre del deck. Cada slide debe tener la misma estructura base."_

### Si es un SOCIAL MEDIA POST
Agregar: _"El diseño debe funcionar en formato cuadrado (1080x1080). Incluí variantes de layout: hero centrado, two-column split, grid de features. Tipografía legible en móvil."_

---

## Ejemplo de output esperado

```html
<!DOCTYPE html>
<html>
<head>
<style>
:root {
  /* ═══ Futuraria Tech ═══ */
  --color-accent-1: #cdfe36;
  --color-ink: #f5f7fa;
  --color-canvas: #080808;
  --text-hero: 96px;
  --text-body: 18px;
}
.c-accent{color:var(--color-accent-1)}
.t-hero{font-size:var(--text-hero);font-weight:800}
.card{background:rgba(255,255,255,0.04);border-radius:24px;padding:30px}
</style>
</head>
<body>
<div class="slide">
  <h1 class="t-hero c-accent">Título</h1>
  <div class="grid-3">
    <div class="card"><span class="stat">85%</span></div>
  </div>
</div>
</body>
</html>
```

---

## Por qué funciona

1. **Gemini ya sabe diseñar.** No necesita instrucciones de diseño — necesita
   instrucciones de INGENIERÍA DE CSS. Las reglas 1-5 son puramente
   estructurales.

2. **El extractor de Futuraria** (`extract_design_system`) lee exactamente
   este formato. Si el CSS tiene `:root` con variables, el extractor produce
   un brand guideline completo automáticamente.

3. **Cualquier IA puede reusarlo.** Si otro agente lee este CSS, entiende
   la paleta, la escala, y los componentes sin necesidad de ver el diseño
   original.

4. **Un humano puede extenderlo.** Las clases son cortas y semánticas.
   Agregar un nuevo componente es copiar el patrón.
