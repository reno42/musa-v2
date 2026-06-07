# 🔴 P0 CRÍTICO — Save no persiste en el editor

**Fecha:** 2026-06-01 | **Template:** Test 7 (tpl_731433d9-8ee)  
**Descubierto por:** Ren | **Diagnosticado por:** Lara (vía Supabase directo + código)

---

## 🐛 El bug

Ren abrió Test 7, hizo modificaciones (eliminó, movió, redimensionó, cambió colores y fuentes), navegó back/forward → **100% de los cambios perdidos.**

---

## 🔍 Diagnóstico (confirmado con Supabase)

1. ✅ Test 7 SÍ existe en Supabase (`qqqcmtwzyaejlzffivri.supabase.co`)
2. ✅ El dual-write Supabase FUNCIONA (los templates creados por MCP persisten)
3. ✅ `useAutoSave.ts` guarda correctamente en localStorage
4. ✅ `getTemplate()` en `templateApi.ts` tiene lógica para preferir localStorage si es más nuevo
5. ❌ **PERO `handleSelectTemplate` en `App.tsx` NUNCA llama a `getTemplate()`**

---

## 🔴 Causa Raíz: `App.tsx` línea ~159

```typescript
// ACTUAL — usa fetch directo, SIN localStorage:
const handleSelectTemplate = async (id: string) => {
    const res = await fetch(`/api/templates/${id}`, {
      headers: { "x-api-key": "***" },
    });
    const json = await res.json();
    // ... carga datos de API (SIEMPRE datos viejos de Supabase)
};

// DEBERÍA usar getTemplate() que SÍ compara localStorage:
import { getTemplate } from "./lib/templateApi";

const handleSelectTemplate = async (id: string) => {
    const data = await getTemplate(id);  // ← Esta función compara localStorage vs API
    // ... carga la versión más reciente
};
```

**El flujo roto:**
1. Ren edita → autoSave guarda en localStorage ✅
2. Ren navega back/forward → página recarga
3. `handleSelectTemplate` → `fetch(/api/templates/:id)` → carga datos viejos de Supabase ❌
4. localStorage IGNORADO → cambios perdidos ❌

**`getTemplate()` (NO usado) SÍ tiene la lógica correcta:**
```typescript
if (localUpdated > apiUpdated && localData.canvas?.objects?.length > 0) {
    console.log("[getTemplate] Local version is newer, using localStorage");
    return { ...apiData, ...localData, canvas: localData.canvas };
}
```

---

## 🔧 Fix (1 línea)

```typescript
// App.tsx - handleSelectTemplate
// Cambiar:
const res = await fetch(`/api/templates/${id}`, { headers: { "x-api-key": "***" } });
const json = await res.json();
// Por:
const data = await getTemplate(id);
```

Ya está importado (`import { getTemplate } from "./lib/templateApi"` en línea 11), solo hay que usarlo.

---

## ⚠️ Teoría del FK — DESCARTADA

Verifiqué Supabase directamente. Los templates persisten con `user_id: null`. El FK no está bloqueando nada. Mi diagnóstico anterior fue incorrecto — estaba asumiendo.

---

## 📂 Relacionado
- `src/App.tsx` — handleSelectTemplate (línea ~159)
- `src/lib/templateApi.ts` — getTemplate() (tiene la lógica correcta, no se usa)
- `src/hooks/useAutoSave.ts` — guarda en localStorage (funciona bien)
