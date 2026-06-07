# 🤖 Agent IDE — Prompt: render_frame + Cierre de Gaps

**De:** Lara | **Fecha:** 2026-06-01 03:15 GMT-5

---

## 🔴 P0: render_frame — Exportar frames individuales a PNG

**Contexto:** Lara creó mega-template con 24 slides (8 carruseles × 3) en un solo template. Necesita exportar cada slide a PNG individual.

**Lo que YA existe:** `POST /api/templates/:id/render` con `{frameId}` devuelve HTML ✅. Solo falta exponerlo como MCP tool.

**Nuevo MCP tool:**
```
render_frame(templateId, frameId, format="png", scale=1)
→ Retorna HTML page con el frame renderizado + botón Download PNG
→ Usa el mismo pipeline de render que ya existe (Fabric.js StaticCanvas)
→ $0, todo client-side
```

---

## 🟡 Quedan estos gaps (ya documentados)

| # | Gap | Archivo |
|---|------|---------|
| 1 | `handleSelectTemplate` usa fetch() en vez de getTemplate() | `App.tsx` ~línea 153 |
| 2 | create_frame almacena en frames[] → editor no renderiza | `GAPS_FRAMES.md` |
| 3 | Supabase dual-write (templates no persisten a Supabase) | `BUG_SAVE_NO_PERSISTE.md` |
| 4 | Server-side PNG (Puppeteer no anda en Netlify) | Documentado, no blocker |

---

## 📂 Documentación actualizada

- `design-main/GAPS_FRAMES.md` — diagnóstico frames
- `design-main/BUG_SAVE_NO_PERSISTE.md` — save no persiste (causa real)
- `design-main/BUGS_DESIGN_REPLICATION.md` — bugs replicación
- `design-main/PROMPT_AGENT_IDE_2026-06-01.md` — prompt anterior

---

**Prioridad:** render_frame (P0) > handleSelectTemplate (P1) > Supabase dual-write (P2)
