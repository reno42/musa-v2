# 🪟 Aave Glass — Design System Reference

> **Fuente:** Aave "Building Glass for the Web" + Glassmorphism patterns
> **Aplicación:** Design Editor panels — 15 paneles
> **Tecnología:** CSS puro — cero dependencias, cero descargas

---

## 🎨 Principios del Glass Effect

### 1. Backdrop Filter (el core)
```css
backdrop-filter: blur(16px) saturate(180%);
```
- `blur()` — difumina lo que está DETRÁS del panel
- `saturate()` — intensifica colores detrás del vidrio para que se vea "vivo"

### 2. Fondo translúcido
```css
background: rgba(10, 10, 20, 0.65);
```
- Opacidad ~0.6-0.75 para balance entre legibilidad y transparencia
- Color del theme (#0a0a14 oscuro)

### 3. Borde sutil
```css
border: 1px solid rgba(255, 255, 255, 0.08);
```
- Borde casi invisible que define el edge del vidrio
- En light mode: `rgba(0, 0, 0, 0.06)`

### 4. Sombras (opcional)
```css
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
```
- Sombra profunda para sensación de elevación
- El blur del backdrop-filter ya da profundidad por sí solo

---

## 🎨 Palette de Glass

| Token | Dark Glass | Light Glass | Uso |
|-------|-----------|-------------|-----|
| `--glass-bg` | `rgba(10,10,20,0.65)` | `rgba(255,255,255,0.7)` | Fondo panel |
| `--glass-border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` | Borde panel |
| `--glass-blur` | `16px` | `12px` | Intensidad blur |
| `--glass-saturate` | `180%` | `150%` | Saturación backdrop |
| `--glass-shadow` | `0 8px 32px rgba(0,0,0,0.3)` | `0 4px 16px rgba(0,0,0,0.08)` | Sombra |
| `--glass-radius` | `16px` | `12px` | Border radius |

---

## 📐 Implementación en el Design Editor

### Clase CSS compartida (agregar a `src/index.css`):
```css
.glass-panel {
  background: var(--glass-bg, rgba(10, 10, 20, 0.65));
  backdrop-filter: blur(var(--glass-blur, 16px)) saturate(var(--glass-saturate, 180%));
  -webkit-backdrop-filter: blur(var(--glass-blur, 16px)) saturate(var(--glass-saturate, 180%));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--glass-radius, 16px);
  box-shadow: var(--glass-shadow, 0 8px 32px rgba(0, 0, 0, 0.3));
}

.glass-topbar {
  background: rgba(10, 10, 20, 0.8);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
```

### Paneles a aplicar:
| Panel | Prioridad | Notas |
|-------|:---:|-------|
| PropertiesPanel | P0 | Siempre visible |
| LayersPanel | P0 | Siempre visible |
| Toolbar | P0 | Siempre visible |
| GovernancePanel | P1 | Glass modal |
| ComponentsPanel | P1 | Glass panel |
| PrototypePanel | P1 | Glass panel |
| PagesPanel | P1 | Glass panel |
| AIPanel | P1 | Glass panel |
| GhostPanel | P1 | Glass panel |
| SkillPanel | P1 | Glass panel |
| BatchPanel | P1 | Glass panel |
| QualityPanel | P1 | Glass panel |
| CreativePanel | P1 | Glass panel |
| StylesPanel | P2 | Glass overlay |
| VariablesPanel | P2 | Glass overlay |

---

## 🔗 CSS Variables — Dark Theme Default

```css
:root {
  --glass-bg: rgba(10, 10, 20, 0.65);
  --glass-bg-hover: rgba(10, 10, 20, 0.8);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: 16px;
  --glass-saturate: 180%;
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  --glass-radius: 16px;
}
```

---

**Cero dependencias. Cero descargas. CSS puro.**
