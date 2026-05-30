# QODER TASKS — Lara ↔ Agent IDE

**Leer este archivo antes de cada sesión.** Lara escribe las tareas, Agent IDE las ejecuta, Lara verifica.

---

## 🟢 TAREA ACTUAL: Arreglar render.mjs

### Contexto
- El render endpoint `POST /api/templates/:id/render` estaba funcionando (v1 con copy/paste de getTemplate)
- Intentamos mejorarlo importando el servicio compartido de templates
- Eso rompió el render para TODOS los templates
- El import `../../api/src/services/templates.js` no resuelve en el bundle de Netlify Functions
- Las funciones de Netlify se empaquetan por separado — no comparten módulos entre api.mjs y render.mjs

### Solución recomendada
Hacer que `render.mjs` llame a la API REST para obtener el template, en lugar de importar el servicio:

```javascript
// En render.mjs, reemplazar el import de templates con:
async function getTemplate(id) {
  const API_BASE = process.env.URL || "https://bejewelled-llama-a6719d.netlify.app";
  const res = await fetch(`${API_BASE}/api/templates/${id}`, {
    headers: { "x-api-key": process.env.API_KEY || "futuraria-dev-key" }
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || json;
}
```

Esto:
- ✅ No depende de imports entre funciones de Netlify
- ✅ Usa la misma API que ya funciona (REST GET templates)
- ✅ Siempre encuentra los templates que existen
- ✅ Funciona para templates creados vía REST y MCP

### Verificación
Después del deploy, Lara prueba con:
```bash
# Crear template vía REST
POST /api/templates
# Renderizar
POST /api/templates/:id/render
# Debe devolver success: true
```

---

## 📋 Historial de tareas

| # | Tarea | Estado |
|---|-------|:---:|
| 1 | Crear render.mjs con chrome-aws-lambda | ✅ Hecho |
| 2 | Arreglar FK de Supabase (user_id text→uuid) | ✅ Ren lo ejecutó |
| 3 | Sincronizar MCP con Supabase | ✅ Funciona |
| 4 | Arreglar render.mjs (imports rotos) | 🔴 Pendiente |

---

## 📍 Archivos relevantes

```
design-main/netlify/functions/render.mjs  ← arreglar este
design-main/netlify/functions/api.mjs     ← referencia (funciona bien)
design-main/netlify/functions/mcp.mjs     ← referencia (ya sincroniza Supabase)
```
