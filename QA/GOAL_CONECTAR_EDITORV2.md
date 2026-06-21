# 🎯 GOAL: Conectar EditorV2 al Dashboard

> **Auditoría:** `QA/AUDIT_EDITORV2_DISCONNECTED.md`
> **Obsidian:** `2-Infraestructura/Auditoria Design Tool - EditorV2 Desconectado.md`
> **Template prueba:** `tpl_69b206a5-b70` (HTML, 1080×1080, engine: "html")

---

## Contexto

EditorV2 (editor HTML/CSS con CodePanel + HtmlCanvas + Google Fonts + AutoSave + Realtime) está completamente construido y funcional. App.tsx lo importa y tiene routing `view: "editor-v2"`. Pero el Dashboard nunca rutea a él — solo abre el editor Fabric.js viejo.

Ren abre la herramienta, la UI se ve exactamente igual. Porque nadie conectó EditorV2 a los flujos normales.

---

## Tareas

### P0 — Conectar Dashboard a EditorV2

**1. `src/components/Dashboard.tsx` — Agregar `engine` al tipo Template (línea ~8)**

```tsx
interface Template {
  id: string;
  name: string;
  width: number;
  height: number;
  workspaceId: string;
  engine?: string;  // ← AGREGAR: "html" | undefined (fabric)
  metadata: { createdAt: string; updatedAt: string };
}
```

**2. `src/App.tsx:167` — Detectar `engine: "html"` en `handleSelectTemplate`**

Cuando un template tiene `engine: "html"`, rutear a EditorV2 en vez de Fabric.js:

```tsx
const handleSelectTemplate = async (id: string) => {
  try {
    const d = await getTemplate(id);
    if (d) {
      if ((d as any).engine === "html") {
        dispatch({ type: "OPEN_TEMPLATE_V2", id });
        return;
      }
      dispatch({ type: "OPEN_TEMPLATE", id, json: { ... } });
      return;
    }
  } catch { /* ignore */ }
  dispatch({ type: "OPEN_TEMPLATE", id, json: { width: 1080, height: 1080 } });
};
```

**3. `src/App.tsx:153` — `handleCreateTemplate`: permitir crear HTML templates**

Agregar un parámetro opcional `engine` o un botón separado en Dashboard. Opción más limpia: agregar un botón "New HTML Template" en el header del Dashboard que llame a `handleCreateTemplate` con `engine: "html"` y dispare `OPEN_TEMPLATE_V2`.

Si se prefiere un solo botón: dropdown "New → Fabric / New → HTML".

**4. `src/components/Dashboard.tsx` — Mostrar badge de tipo en la card de template**

```tsx
// En la card del template (~línea 270):
{template.engine === "html" && (
  <span style={htmlBadgeStyle}>HTML</span>
)}
```

---

### P1 — Template list endpoint: incluir `engine`

**5. `api/src/routes/templates.ts` — Asegurar que GET /api/templates devuelve `engine`**

Verificar que el campo `engine` del row de Supabase se incluye en la respuesta. El template `tpl_69b206a5-b70` sí lo devuelve (`"engine": "html"`), pero confirmar que todos los templates lo incluyen (aunque sea `null` para Fabric).

---

### P2 (opcional) — Render server-side

**6. `netlify/functions/render.mjs` — El render es browser-side**

Actualmente `render_html_template` MCP tool devuelve URL vacía porque el pipeline genera HTML pages con auto-descarga, no PNG server-side. Si se necesita PNG real en servidor: implementar Puppeteer en un endpoint separado o usar un servicio externo.

---

## Verificación

1. Crear un template HTML desde la UI → debe abrir EditorV2
2. Seleccionar template existente con `engine: "html"` → debe abrir EditorV2
3. Seleccionar template Fabric.js → debe abrir editor Fabric.js (sin cambios)
4. El badge "HTML" debe aparecer en la card del Dashboard para templates HTML
5. `render_html_template` MCP tool debe devolver URL de PNG o al menos no URL vacía

---

## Template de prueba disponible

- **ID:** `tpl_69b206a5-b70`
- **Nombre:** "AI: De idea a producto en 5 semanas - Bootca"
- **Engine:** `html`
- **HTML:** 426 bytes (10 elementos: post, bg-grid, glow-orb, logo, hero, highlight, subtitle, tagline, accent-bar, footer)
- **CSS:** 2236 bytes (12 reglas: *, body, .post, .bg-grid, .glow-orb, .logo, .hero, .highlight, .subtitle, .tagline, .accent-bar, .footer)
- **URL test:** `/?template=tpl_69b206a5-b70&v=2` (EditorV2 funciona con este template)
