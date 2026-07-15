# 🛡️ Design Harness Rules — Prevención de Sangrado entre Frames

> **Fecha:** Julio 2026
> **Origen:** Diagnóstico de bug visual — frames con `box-shadow`, SVGs posicionados y fondos complejos que sangran a frames vecinos
> **Repo:** `design-main`
> **Para:** Lara + Agente IDE

---

## 🐛 Problema

Al crear templates multi-frame, el contenido de un frame puede sangrar visualmente al frame adyacente. Esto es invisible en el API pero visible en el editor (líneas de color, sombras, fragmentos de SVG que aparecen donde no deberían).

### Causas identificadas

1. **`overflow: hidden` en el div interno pero no en el frame container** — el frame del editor tiene su propio contenedor que no hereda el clip
2. **`box-shadow` con blur grande** (54px+) que se extiende más allá del `overflow: hidden` si el elemento está posicionado
3. **SVGs con dimensiones fijas** que empujan el contenedor cuando el `padding` + `height` calculado excede el frame
4. **Falta de `max-width: 100%` en imágenes y SVGs** — si el SVG viewBox es más grande que el contenedor, overflow
5. **`container-type: inline-size` heredado** del CSS original del diseño que no aplica en canvas fijos

---

## 📋 Reglas Obligatorias (7 reglas)

### 1. `overflow: hidden` EXPLÍCITO en el root de cada frame

```css
.frame-root {
  overflow: hidden; /* NO NEGOCIABLE */
}
```

El `overflow: hidden` debe estar en el `data-layer-id` raíz de cada frame. No basta con ponerlo solo en el CSS global — debe estar en el style inline del div root Y en la clase CSS.

### 2. `box-sizing: border-box` redundante en el root

```css
.frame-root {
  box-sizing: border-box; /* Redundancia defensiva */
}
```

`* { box-sizing: border-box }` puede ser sobreescrito por estilos del editor. El root necesita su propia declaración explícita.

### 3. `max-width: 100%` en TODAS las imágenes y SVGs

```css
.frame-root img,
.frame-root svg {
  max-width: 100%;
  height: auto;
}
```

Previene que un asset con dimensiones intrínsecas mayores al contenedor cause overflow horizontal.

### 4. Verificación de padding + contenido

```
padding-left + content-width + padding-right === frame-width
padding-top + content-height + padding-bottom === frame-height
```

Si el frame es 1080×1920 y el padding es 70px en cada lado:
- Ancho disponible para contenido: 1080 − 140 = 940px
- Alto disponible para contenido: 1920 − 140 = 1780px

**Antes de crear el template, verifico que ningún elemento exceda estas dimensiones.**

### 5. Contención de sombras

Un `box-shadow` con blur de 54px en un elemento posicionado (`absolute` o `fixed`) PUEDE asomarse fuera del `overflow: hidden` en ciertos navegadores. Soluciones:

```css
/* Opción A: clip-path para cortar TODO */
.frame-root {
  clip-path: inset(0);
}

/* Opción B: inset en box-shadow en vez de offset */
.box {
  box-shadow: inset 0 0 54px rgba(0,0,0,0.4);
}

/* Opción C: reducir blur o mover el elemento hacia adentro */
.box {
  box-shadow: 0 11px 22px rgba(0,0,0,0.2); /* blur ≤ 2× offset */
}
```

**Preferencia: Opción A (`clip-path: inset(0)`) en el root.** Es la más segura y no afecta el diseño.

### 6. Background del frame, no solo del div interno

```css
/* MAL: solo el div interno tiene background */
.frame-inner { background: #d5ff00; }
.frame-root { /* transparente */ }

/* BIEN: el frame root tiene background OWN */
.frame-root { background: #d5ff00; }
.frame-inner { /* hereda o transparente */ }
```

Si el frame root tiene su propio `background`, cualquier fuga es inmediatamente visible durante el desarrollo.

### 7. Prueba de colores contrastantes en desarrollo

Para detectar sangrado durante el desarrollo, usar colores de fondo radicalmente distintos entre frames adyacentes:

```
Frame 0: background: magenta  → si ves magenta en Frame 1, hay fuga
Frame 1: background: cyan     → si ves cyan en Frame 0, hay fuga
```

Una vez verificado que no hay sangrado, reemplazar por los colores finales.

---

## 🧪 Checklist Pre-Creación

Antes de hacer POST del template, verificar:

- [ ] `overflow: hidden` en el div raíz de CADA frame (inline style + CSS class)
- [ ] `box-sizing: border-box` en el div raíz de cada frame
- [ ] `max-width: 100%` en reglas CSS para img y svg
- [ ] Padding total + dimensiones de contenido ≤ dimensiones del frame
- [ ] Ningún SVG tiene `width`/`height` fijo mayor al espacio disponible
- [ ] `clip-path: inset(0)` en el root de cada frame (protección extra contra sombras)
- [ ] `box-shadow` blur ≤ 2× offset (o usar inset)
- [ ] Background explícito en el frame root (no solo en divs internos)
- [ ] Frames adyacentes tienen colores de fondo distintos (visible durante dev)

---

## 📐 Template JSON Seguro — Estructura Recomendada

```json
{
  "frames": [
    {
      "x": 0, "y": 0,
      "id": "frame_0",
      "width": 1080, "height": 1920,
      "background": "#d5ff00",
      "css": ".f0-root{width:1080px;height:1920px;overflow:hidden;box-sizing:border-box;clip-path:inset(0);background:#d5ff00;border-radius:26px;position:relative;display:flex;flex-direction:column;justify-content:space-between;padding:86px 70px;} .f0-root img,.f0-root svg{max-width:100%;height:auto;}",
      "html": "<div data-layer-id=\"f0_root\" class=\"f0-root\">...</div>"
    }
  ]
}
```

---

> ⚡ Preparado por Lara ✨ — Futuraria · Julio 2026
> 📁 Ubicación: `design-main/DESIGN_HARNESS_RULES.md` + `ObsidianRen/DESIGN_HARNESS_RULES.md`
