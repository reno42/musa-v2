# 🧪 QA REPORT — Overflow deck v5 + superficie de escritura MCP
**Fecha:** 2026-08-30 · **Por:** Hermes · **Deck fixture:** `tpl_a8265257-8a5` (12 frames, 1920×1080)
**Rol de esta sesión:** probar y documentar (no crear). Experiencia del agente = producto.

---

## ✅ RESUELTO EN ESTA SESIÓN (con medidas)

| Defecto | Medida | Causa | Fix aplicado |
|---|---|---|---|
| Slide se sale derecha+abajo | wrapper 1988×1148 vs frame 1920×1080 (**+68px X, +68px Y**) | `create_deck` inyecta chrome con content-box; slides 01–11 sin `box-sizing:border-box` (la portada sí lo tenía — por eso solo "el resto" fallaba) | `*{margin:0;padding:0;box-sizing:border-box}` en los 11 |
| Contenido desplazado 96,200 | fuga **192px X / 320px Y** | chrome content 1728×760 en (96,200) vs slides full-bleed | content redefinido a 0,0,1920×1080 |
| Tipografía delgada/chica | cuerpos 20–22px en canvas 1920 (vs posters ≥40px) | escala tipográfica de export 1080 aplicada a canvas 1920 | cuerpos ahora 21–36px mínimo por frame |
| Slide 02 desbordaba por dentro | scrollHeight **1187 vs 1068 (+119px)** tras subir tipografía | `.ft` 36px / `.fd` 26px excedían el budget de las 4 cards | `.ft`→32, `.fd`→23, `.mt`→48 → sh=1068 exacto |

**Verificación final (medida en DOM real, no visual):** los 12 frames `scrollHeight=1068/1068`, `scrollWidth=1908/1908`. Cero overflow.
**Método reproducible:** preview local `debug/preview_v5_30ago.html` + medición `getBoundingClientRect`/`scrollHeight` vía consola (script en este doc, abajo).

---

## 🔴 BUGS DE PLATAFORMA ENCONTRADOS (para Qoder)

### BUG-1 · `set_css` acepta CSS corrupto/truncado — severity: CRITICAL
El servidor devolvió `success:true` a:
1. CSS truncado a **553 chars** (2 veces: frame 07 y 09 — perdió todo el layout, solo quedó el preámbulo del chrome)
2. CSS con **2922 chars de basura** (runs de dígitos, texto `cssLength: 553` inyectado dentro del CSS)
3. Tokens corruptos: `#00b84squirrel`, `--deck-tool-font`, `font-side-things`
4. Solo rechazó cuando el `templateId` mismo estaba mal (`tpl_a8265257-8a STOP` → "Template not found")

**Por qué importa:** un agente degradado (sesión larga, payloads repetidos) corrompe producción **en silencio**. El usuario lo descubre cuando abre el editor. La defensa no puede ser "que el agente tenga cuidado".
**Fix pedido (nuevo G10):** en `set_css`/`set_html`/`update_html_frame`/`update_frame`: (a) validar llaves `{}` balanceadas, (b) parse CSS (postcss/lightningcss) — rechazar si no parsea, (c) opcional `expectedLen` param que el agente pasa y el server compara. Mínimo: (a)+(b).

### BUG-2 · No existe escritura batch ni capa CSS compartida — severity: HIGH
El cambio del chrome tocó los 11 frames = **11 llamadas `set_css` idénticas** (~10 min). Un solo typo se propaga 11 veces.
**Fix pedido:** (a) `set_css(templateId, frameIds[], css)` batch atómico, o mejor (b) CSS a nivel template + CSS por frame (cascade), que es lo que un deck necesita de verdad.

### BUG-3 · `lint_design` NO detecta overflow — severity: HIGH
Corrí el lint tras el primer fix: score 86, solo warnings `missing-position`. Cero mención del wrapper de 1988px ni del slide 02 con +119px interno. Ya flaggeado en `PRUEBAS_MCP_28JUL.md` Prueba 1 ("Agregar validación de overflow").
**Fix pedido (G9 en /goal, ya especificado):** regla OVERFLOW midiendo `scrollWidth/scrollHeight` del contenido vs caja del frame (headless), error si fuga >4px. Es exactamente lo que hice manualmente vía consola — automatizarlo es directo.

### BUG-4 · API REST deployada ≠ repo — severity: MEDIUM
- `PUT /api/templates/:id/frames/:frameId` existe en `api/src/routes/frames.ts:43` (con revision check) pero en producción devuelve **404**
- `PATCH` al mismo path devuelve cuerpo no-JSON
**Acción:** sincronizar deploy o documentar qué backend corre en prod (anti-patrón #1 del repo ya lo advierte). El MCP sí funcionó — la vía confiable hoy es `/mcp`.

### BUG-5 · `HtmlCanvas.tsx` sospechoso de dead-code con bug — severity: LOW
`src/components/HtmlCanvas.tsx` dimensiona el iframe `width*scale` y setea `transformOrigin:"top left"` **sin nunca aplicar `transform:scale()`**. Si algún panel lo usa, renderiza mal. Si no se usa: borrarlo (el editor real usa DesignFrame/Shadow DOM).

---

## 🧰 SCRIPT DE VERIFICACIÓN (reutilizable — esto es el embrión de G9)

```js
// en cualquier página que contenga los frames a escala:
document.querySelectorAll('.wr').forEach(wr => {
  const W = 1920, H = 1080, border = 6;
  const maxW = W - 2*border, maxH = H - 2*border; // 1908 × 1068 (border-box)
  const oX = wr.scrollWidth - maxW, oY = wr.scrollHeight - maxH;
  if (oX > 4 || oY > 4) console.error('OVERFLOW', wr, {oX, oY});
});
```

---

## 📋 ESTADO DEL DECK v5
- Overflow: **0px** en 12/12 (medido)
- Tipografía mínima por frame: 21–36px (antes 20px)
- Basura/corrupción: 0 tokens (escaneado por regex)
- Limpieza pendiente de diseño (no bug): slide 06 minFont 21px (badges de estado de tabla) — aceptable como etiqueta, revisar en review visual
