# 🔴 HOTFIX — React Error #310 (Infinite Re-render)

> **Fecha:** 2026-06-07 23:30 | **Severidad:** P0 — Editor inutilizable
> **Error:** `Minified React error #310` = Too many re-renders
> **Síntoma:** Templates vacíos. Al intentar crear/editar → crash.

---

## 🎯 DIAGNÓSTICO

El error ocurre al cargar el editor — NO al abrir paneles nuevos (SkillPanel, CreativePanel, etc). Los paneles nuevos usan refs y solo renderizan cuando se abren. El error viene de un componente que SIEMPRE renderiza en la vista editor.

**Candidato más probable:** PropertiesPanel (Sprint 1) — específicamente la integración de StylesPanel y VariablesPanel como tabs.

Commit que introdujo tabs: `4494269 feat(ui): Styles and Variables tabs in PropertiesPanel`

---

## 🔧 FIX

### Opción 1: Revertir tabs de PropertiesPanel (rápido)

Revertir el commit `4494269` y restaurar PropertiesPanel sin tabs. Los paneles Styles/Variables siguen existiendo como archivos — solo se desvinculan del PropertiesPanel.

```
git revert 4494269
```

Esto elimina los tabs del PropertiesPanel. StylesPanel y VariablesPanel quedan como archivos huérfanos (se pueden integrar después como paneles separados).

### Opción 2: Debuggear (más lento)

1. Agregar ErrorBoundary alrededor de PropertiesPanel en App.tsx
2. Identificar qué sección causa el loop
3. Fix específico

### Opción 3: Rollback completo de Sprint 1-5

Revertir a commit antes de Sprint 1 (solo si opciones 1-2 fallan).

---

## ⚡ RECOMENDACIÓN: Opción 1

El editor necesita funcionar YA. Los tabs de Styles/Variables se pueden reintegrar después con más testing. Revertir `4494269` es seguro porque:
- Solo toca PropertiesPanel (+33 líneas)
- StylesPanel.tsx y VariablesPanel.tsx quedan intactos
- No afecta los otros 18 paneles nuevos
- No afecta las 119 MCP tools

---

## 📋 PLAN

1. Qoder: `git revert 4494269` → commit → push
2. Netlify auto-deploy
3. Verificar editor funciona
4. Re-test Sprint 1 con PropertiesPanel limpio
