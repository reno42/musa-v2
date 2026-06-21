# 🪟 /goal — Aave Glass UI + React #310 Hotfix

> **Prioridad:** P0 — Editor roto + Glass upgrade
> **Repo:** `design-main/`

---

## FASE 0: HOTFIX (YA)

```
git revert 4494269
# Commit: hotfix: revert Styles/Variables tabs causing React #310 infinite re-render
git push
```

---

## FASE 1: Aave Glass CSS

### 1.1 Agregar CSS glass a `src/index.css`:
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

.glass-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  border-radius: var(--glass-radius);
  box-shadow: var(--glass-shadow);
}

.glass-topbar {
  background: rgba(10, 10, 20, 0.8);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
```

### 1.2 Aplicar `className="glass-panel"` a estos componentes:
- PropertiesPanel, LayersPanel, Toolbar (P0)
- GovernancePanel, ComponentsPanel, PrototypePanel, PagesPanel, AIPanel, GhostPanel (P1)
- SkillPanel, BatchPanel, QualityPanel, CreativePanel (P1)

### 1.3 Toolbar con `className="glass-topbar"` (más sutil, pegado arriba)

## REGLAS
- Cero dependencias nuevas
- Cero npm install
- Cero migraciones
- CSS puro, browser nativo
- backdrop-filter tiene 97%+ soporte global

---

## 📋 Commits:
1. `hotfix: revert Styles/Variables tabs (React #310)` 
2. `feat(ui): add Aave Glass CSS variables and classes`
3. `feat(ui): apply glass-panel to core panels (Properties, Layers, Toolbar)`
4-5. `feat(ui): apply glass to remaining panels`

---

**Cero descargas. Cero dependencias. CSS puro.**
