# Chart Recipes — Canon del Harness (v1)

> **Qué es:** recetario determinístico de gráficos y composición vertical para templates 1920x1080.
> **Para:** toda IA que genere templates en la Design Tool. No es opcional ni exclusiva de una IA.
> **Kit vivo:** recipe `Harness Chart Kit v1 — Futuraria dark (R1-R6)` (template `tpl_c233aa49-d74`) — instanciar con `create_from_recipe`.
> **Spec server-side:** ver `SPEC_CREATE_CHART.md` (tool nativa `create_chart` — pendiente de implementar).

---

## Reglas de composición (aplican a TODO slide, con o sin chart)

### R-V1 · Presupuesto vertical
La zona de contenido de un slide deck es **1728x760** (1920x1080, margen 96px, título arriba).
1. Antes de escribir CSS, declara el presupuesto: `alto total = Σ filas + gaps` y debe caer entre **532px (70%) y 760px (100%)** de la zona.
2. El contenedor raíz declara `height` explícito (ej. `height:640px`) o `height:100%` con `display:flex/grid`.
3. Las filas se reparten el espacio con `grid-template-rows: 1fr …` o `flex:1` — nunca altura natural ("document flow").
4. Si la suma queda < 70%: sube tipografía o distribuye (`justify-content:center` en columna). Vacío masivo abajo = bug.

### R-V2 · Piso tipográfico en 1920px
Proyectado, 16px de web es ilegible. Mínimos:
- Cuerpo/labels: **≥ 20px** (ejes y fuentes de chart: ≥ 16px)
- Títulos de card: ≥ 22px · Subtítulos: ≥ 26px
- Numerals de stats: **56–96px**, `font-weight:800`, `letter-spacing:-1 a -2px`
- Valores sobre barras: ≥ 24px

### R-V3 · Chart obligatorio
Todo slide cuyo claim central sea numérico (mercado, fondos, proyección, growth, pricing comparativo) debe llevar **≥ 1 receta R1–R6**. "Número grande + bullets" solo si el slide es cualitativo.

### R-V4 · Math determinística, nunca a ojo
Toda proporción se calcula: `pct = valor ÷ max × 100`. En barras, aplicar **headroom 1.15×** sobre el valor máximo (que no toque el techo). En líneas SVG: `y = H − (valor ÷ max) × (H − 2×padding)`.

### R-V5 · Datos placeholder marcados
Rango o dato sin confirmar → la pieza gráfica lo delata: stroke `#854be8`, `stroke-dasharray:10 12` (líneas), borde violet (barras/donut) + tag `[FILL]`. Nunca dibujar precisión falsa como si fuera real.

---

## Tabla de decisión — qué receta usar

| Slide类型 | Receta |
|---|---|
| Use of funds, split de %, pricing mix | **R1 donut** |
| Proyección ARR/MRR, crecimiento por período, comparativa de unidades | **R2 vertical bars** |
| TAM/SAM/SOM, jerarquías anidadas, benchmarks | **R3 horizontal bars** |
| Roadmap, milestones, historia/fases | **R4 timeline** |
| Curva de tracción/growth, series temporales | **R5 line chart** |
| KPIs cualitativos, antes/después, stats duros | **R6 stat grid** |

---

## R1 · Donut / conic — splits de %

```css
.chart{width:430px;height:430px;border-radius:50%;
  background:conic-gradient(#d2ff02 0 40%, #854be8 40% 70%, #4a5058 70% 90%, #2e2e2e 90% 100%);
  display:flex;align-items:center;justify-content:center}
.hole{width:250px;height:250px;border-radius:50%;background:#0a0a0a; /* = bg del slide */
  display:flex;flex-direction:column;align-items:center;justify-content:center}
```
**Math:** cada stop = % acumulado. 40/70/90/100 = 40%, 30%, 20%, 10%.
**Leyenda:** fila por segmento — swatch (22px, radius 6px) + etiqueta + descripción + valor a la derecha.
**Máx:** 5 segmentos. Más = tabla, no donut.

## R2 · Vertical bars — proyecciones

```css
.plot{height:540px;display:flex;align-items:flex-end;gap:64px;border-bottom:2px solid #2e2e2e;padding:0 56px}
.col{flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:14px}
.bar{width:100%;max-width:180px;border-radius:14px 14px 0 0;background:#141414;border:1px solid #242424}
```
**Math:** `height% = valor ÷ (max × 1.15) × 100`. Valor (≥24px, sobre la barra) → barra → eje X (label bajo la barra, fuera del plot).
**Highlight:** la barra del "ahora"/meta lleva `background:#d2ff02` y valor lime.
**Contenedor con altura explícita siempre.** 3–5 barras ideal.

## R3 · Horizontal bars — TAM/SAM/SOM

```css
.track{height:66px;background:#141414;border:1px solid #242424;border-radius:999px;overflow:hidden}
.fill{height:100%;border-radius:999px;display:flex;align-items:center;padding:0 26px;font-weight:800;font-size:22px;white-space:nowrap}
```
**Math:** `width% = valor ÷ TAM × 100` (la barra mayor = 100% del track).
**Label** arriba del track (label izquierda, contexto derecha, `em` muted).
**Si fill < 30% del track:** el valor va fuera (a la derecha) o el fill es solo borde lime 2px (transparente por dentro).
TAM lime sólido · SAM violet · SOM borde lime.

## R4 · Timeline — roadmap

```css
.line{position:absolute;left:24px;right:24px;top:50%;height:3px;background:#2e2e2e}
.prog{position:absolute;left:24px;top:50%;height:3px;background:#d2ff02;width:24%} /* hasta el nodo actual */
.node{position:absolute;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;
  background:#0a0a0a;border:3px solid #d2ff02}
.card{position:absolute;width:370px;background:#141414;border:1px solid #242424;border-radius:16px;padding:24px 28px}
```
**Posicionamiento:** nodos en `left: 8–92%` (n datos). Cards alternan arriba (`bottom:56%`) y abajo (`top:58%`), offset horizontal ≈ posición del nodo − 8%.
**Nunca timeline en document-flow** — todo absoluto sobre un contenedor con altura explícita.
Nodo completado = relleno lime; resto = borde lime.

## R5 · Line chart — curva de crecimiento

```html
<svg viewBox="0 0 1200 500" preserveAspectRatio="none">
  <line x1="0" y1="125" x2="1200" y2="125" stroke="#242424" stroke-dasharray="4 8"/> <!-- gridlines -->
  <path d="M0,440 C180,425 320,390 480,330 S820,190 960,120 S1120,50 1200,35 L1200,465 L0,465 Z"
        fill="rgba(210,255,2,0.07)"/> <!-- área -->
  <path d="M0,440 C180,425 320,390 480,330 S820,190 960,120 S1120,50 1200,35"
        fill="none" stroke="#d2ff02" stroke-width="5" stroke-linecap="round"/>
</svg>
```
**Math:** `y = H − (valor ÷ max) × (H − 2×padding)` con H=500, padding≈35. Gridlines cada 25%.
**Curva suave:** comandos `C`/`S` entre puntos consecutivos (control points a ⅓ de distancia).
**Área** = mismo path + cierre a baseline (`L x_max,465 L x_0,465 Z`), fill del acento al 7%.
**Dots** en cada punto (r=9, fill bg, stroke acento); último dot r=13 relleno + label en caja.
**Placeholder (R-V5):** stroke `#854be8` + `stroke-dasharray:10 12` + tag `[FILL]`.

## R6 · Stat grid — KPIs

```css
.stats{display:grid;grid-template-rows:1fr 1fr 1fr;gap:24px} /* filas se reparten la altura */
.card{background:#141414;border:1px solid #242424;border-radius:16px;display:flex;flex-direction:column;justify-content:center}
```
Numeral 56–96px lime + descriptor 18–20px muted. 2–4 stats. En vez de columna puede ser `grid-template-columns` para fila horizontal.
**Este patrón es el único donde "número grande" es la receta correcta** (y igual requiere fill vertical).

---

## Anti-patrones (rechazar en review)

- ❌ Composición que ocupa < 70% de la zona de contenido ("slide flotando arriba")
- ❌ Cuerpo < 20px en canvas 1920
- ❌ Slide de mercado/fondos/proyección sin chart (solo bullets)
- ❌ Proporciones "a ojo" (barra del 40% dibujada al 55%)
- ❌ Datos inventados dibujados con precisión real (sin marca violet/[FILL])
- ❌ Timeline o scatter en document-flow (sin posicionamiento absoluto)
