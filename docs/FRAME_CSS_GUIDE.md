# Futuraria Frame CSS & HTML Guide

> **Purpose:** This document tells any AI or human exactly how to produce
> HTML + CSS that renders perfectly inside Futuraria's design editor.
>
> Share this file with Gemini, ChatGPT, Claude, or any LLM via API.
> Paste its contents as a system prompt so the AI generates frame-ready output.

---

## What Is a Futuraria Frame?

A frame is a **fixed-size canvas** (e.g. 1080×1080, 1920×1080, 1080×1920).
Your HTML + CSS will be rendered inside a Shadow DOM container with exact pixel dimensions.

Think of it as a **poster, a slide, or a social media card** — not a responsive webpage.

---

## The CSS Contract (MANDATORY)

Always start your CSS with this block. Replace `{{W}}` and `{{H}}` with the frame dimensions:

```css
body {
  width: {{W}}px;
  height: {{H}}px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  position: relative;
}
```

**Example for a 1080×1080 Instagram post:**

```css
body {
  width: 1080px;
  height: 1080px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  position: relative;
}
```

---

## Rules

### DO

| Rule | Why |
|------|-----|
| Use `px` for all dimensions | The frame is a fixed canvas — pixels are exact |
| Position elements with `top` + `left` | These always resolve correctly against the frame |
| Set explicit `width` and `height` on body | The editor needs this as the positioning reference |
| Use `position: absolute` for placed elements | Predictable placement inside the frame |
| Use `display: flex` or `display: grid` on child containers | Safe — these are inside body, not on body itself |
| Use Google Fonts via `@import url(...)` | The editor extracts and injects font links automatically |
| Wrap positioned elements in `<div>` tags | Spans with `position: absolute` behave unpredictably |
| Include `overflow: hidden` on body | Prevents content from bleeding outside the frame |

### DO NOT

| Rule | Why It Breaks |
|------|---------------|
| `vh`, `vw`, `vmin`, `vmax` units | These reference the browser viewport (e.g. laptop screen), NOT the frame. A 1920×1080 frame on a 1366px laptop gets wrong values |
| `min-height: 100vh` | Same reason — viewport-relative, not frame-relative |
| `padding` on `body` | Shrinks the available area and shifts content |
| `bottom` or `right` positioning | Use `top` and `left` instead — they are always frame-relative |
| `@media` queries | The frame is fixed-size. Media queries test the browser window, producing unpredictable results |
| `container-type: inline-size` + `cqw/cqh` units | Container queries reference the browser viewport in Shadow DOM, not the frame |
| `position: fixed` | Anchors to the viewport, not the frame. Elements will float freely |
| `<span>` with `position: absolute` | Spans default to `display: inline` — their box model is unreliable when absolutely positioned. Use `<div>` |
| `transform` on body | The editor already applies a zoom transform. Adding yours compounds it |
| `@import` after other CSS rules | CSS spec requires `@import` to be the first statements. Put them at the top |

---

## HTML Structure

Your HTML should be **only the body content** — no `<html>`, `<head>`, or `<body>` tags needed.
The editor wraps your HTML in a container automatically.

### Minimal valid frame HTML:

```html
<div class="hero" data-layer-id="hero">
  <h1 data-layer-id="title">Your Title Here</h1>
  <p data-layer-id="subtitle">Supporting text goes here.</p>
</div>
```

### Attributes that enable editor features:

| Attribute | Purpose |
|-----------|---------|
| `data-layer-id="unique-name"` | Makes the element appear in the Layers panel and selectable by click |
| `data-layer-name="Display Name"` | Human-readable label in the Layers panel |

---

## Google Fonts

Use `@import` at the **top** of your CSS (before any other rules):

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');

body {
  font-family: 'Inter', sans-serif;
  /* ... */
}
```

The editor detects `@import url(...)` lines and loads them as `<link>` tags inside the Shadow DOM.

---

## Complete Example: Instagram Post (1080×1080)

```html
<div class="container" data-layer-id="container">
  <div class="logo" data-layer-id="logo">BRAND</div>
  <h1 class="headline" data-layer-id="headline">Summer<br/>Sale</h1>
  <p class="subtitle" data-layer-id="subtitle">Up to 50% off everything</p>
  <div class="cta" data-layer-id="cta">Shop Now</div>
  <div class="badge" data-layer-id="badge">50% OFF</div>
</div>
```

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');

body {
  width: 1080px;
  height: 1080px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  position: relative;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-family: 'Inter', sans-serif;
}

.container {
  position: absolute;
  top: 0;
  left: 0;
  width: 1080px;
  height: 1080px;
}

.logo {
  position: absolute;
  top: 60px;
  left: 80px;
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 4px;
  text-transform: uppercase;
}

.headline {
  position: absolute;
  top: 320px;
  left: 80px;
  font-size: 120px;
  font-weight: 900;
  color: #ffffff;
  line-height: 1.05;
  margin: 0;
}

.subtitle {
  position: absolute;
  top: 580px;
  left: 80px;
  font-size: 32px;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
}

.cta {
  position: absolute;
  top: 700px;
  left: 80px;
  background: #ffffff;
  color: #764ba2;
  padding: 20px 48px;
  border-radius: 100px;
  font-size: 28px;
  font-weight: 700;
}

.badge {
  position: absolute;
  top: 60px;
  left: 880px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: #ff6b6b;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 900;
  transform: rotate(-15deg);
}
```

---

## How to Import Your Design

### Option A: Import HTML file (human workflow)

1. Generate your design HTML with any AI (Gemini, ChatGPT, Claude)
2. Preview it in your browser to verify it looks right
3. In the Futuraria editor, select a frame
4. Click the **Import HTML** button (`</>` icon) in the top toolbar
5. Select your `.html` file — it parses `<style>` and `<body>` automatically

### Option B: Paste into Code Panel

1. In the editor, open the Code Panel (`Ctrl+/`)
2. Paste your HTML into the HTML tab
3. Paste your CSS into the CSS tab

### Option C: JSON template (AI agent workflow)

For multi-frame templates, use the JSON format:

```json
{
  "format": "futuraria/v1",
  "template": {
    "name": "My Design",
    "width": 1080,
    "height": 1080,
    "frames": [
      {
        "id": "frame_1",
        "name": "Frame 1",
        "x": 0, "y": 0,
        "width": 1080,
        "height": 1080,
        "html": "<div>...</div>",
        "css": "body { width: 1080px; ... }",
        "background": "#ffffff"
      }
    ]
  }
}
```

Use the **Import Template JSON** button (upload icon) in the top toolbar.

---

## Common Frame Sizes

| Platform | Width | Height | Aspect Ratio |
|----------|-------|--------|-------------|
| Instagram Post | 1080 | 1080 | 1:1 |
| Instagram Story | 1080 | 1920 | 9:16 |
| LinkedIn Post | 1200 | 627 | 1.91:1 |
| Twitter Post | 1200 | 675 | 16:9 |
| Facebook Cover | 820 | 312 | 2.6:1 |
| Presentation Slide | 1920 | 1080 | 16:9 |
| A4 Print (150 DPI) | 1240 | 1754 | 1:1.41 |
| Poster | 1080 | 1527 | 1:1.41 |

---

## Checklist Before Importing

```
[ ] CSS starts with body { width: Wpx; height: Hpx; margin: 0; padding: 0; overflow: hidden; position: relative; }
[ ] Zero use of vh, vw, vmin, vmax
[ ] Zero use of min-height: 100vh
[ ] All positioning uses top + left (not bottom + right)
[ ] No @media queries
[ ] No position: fixed
[ ] No padding on body
[ ] All @import url(...) lines are at the very top of CSS
[ ] All positioned elements use <div>, not <span>
[ ] Google Fonts loaded via @import url(...)
```

---

## How the Editor Renders Your CSS

Futuraria's editor uses **Shadow DOM** to isolate each frame. Here's what happens:

1. Your CSS is injected into a `<style>` tag inside the Shadow DOM
2. `body` and `html` selectors are automatically remapped to `#__df_content` (the Shadow DOM container)
3. The container gets explicit `width` and `height` matching the frame dimensions
4. Google Fonts `@import` lines are extracted and loaded as `<link>` tags
5. Your HTML is placed inside `#__df_content`

This means:
- `body { width: 1080px; }` becomes `#__df_content { width: 1080px; }` ✅
- Your CSS is fully isolated from the editor's own styles ✅
- No external CSS can leak in or out ✅
