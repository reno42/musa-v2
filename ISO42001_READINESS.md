# 📊 Dual Snapshot System + ISO 42001 Alignment

**Fecha:** 2026-06-01 | **Autores:** Lara + Ren

---

## 🧠 Sistema de Doble Snapshot

### Tipos de Snapshot

| Tipo | Quién lo crea | Trigger | Formato ID |
|------|--------------|---------|------------|
| `ia` | Lara vía MCP | `update_template`, `create_frame`, etc. | `ia_2026-06-01T13:24:00Z` |
| `human` | Ren vía Editor | autoSave, beforeunload, visibilitychange | `human_2026-06-01T13:25:30Z` |
| `system` | Automático | Lara entra/sale, idle 5min | `sys_2026-06-01T13:24:00Z` |

### Triggers automáticos en el Editor

```
Lara entra al template → [sys snapshot]
Ren empieza a editar → [human snapshot en cada autoSave]
Ren inactivo 5 min → [sys snapshot "idle"]
Ren cambia de pestaña → [sys snapshot "paused"]
Ren cierra pestaña → [human snapshot final via beforeunload]
Lara consulta → ve timeline de snapshots
```

### Triggers desde MCP

```
Lara: update_template → [ia snapshot automático]
Lara: create_frame → [ia snapshot]
Lara: transform_object → [ia snapshot]
Lara: snapshot_template (manual) → [ia snapshot manual]
```

---

## 📜 UI: Governance Panel

```
┌─────────────────────────────────────────┐
│ 🕐 Timeline — tpl_7e998238-eaf          │
│─────────────────────────────────────────│
│ 13:24 IA   Lara creó 8 objetos          │
│ 13:25 👤   Ren editó "headline"         │
│ 13:25 👤   Ren movió CTA pill ↓334px    │
│ 13:26 IA   Lara actualizó typografía    │
│ 13:27 👤   Ren refinó subtitle          │
│ 13:30 ⏸   Sistema: inactividad          │
│─────────────────────────────────────────│
│ [Ver diff] [Restaurar] [Exportar JSON]  │
└─────────────────────────────────────────┘
```

---

## 🔗 ISO 42001:2023 — Mapeo a Futuraria Design

### Lo que la ISO pide y cómo lo cumplimos

| # | Requisito ISO 42001 | Implementación Futuraria | Estado |
|---|---------------------|--------------------------|:---:|
| **5.2** | AI Policy documentada | AGENTS.md + SOUL.md + MEMORY.md definen rol de cada IA | ✅ |
| **6.1.2** | AI Risk Assessment | `GAPS_FRAMES.md`, `BUGS_DESIGN_REPLICATION.md` documentan riesgos | ✅ |
| **6.1.4** | AI Impact Assessment | Cada diseño creado por IA es revisado por humano antes de publicar | ⚠️ Parcial |
| **7.2** | Competence | Skills documentadas con propósito y triggers claros | ✅ |
| **7.3** | Awareness | UI muestra qué fue creado por IA vs humano | 🔴 Falta |
| **8.1** | Operational Control | Dual snapshot = trazabilidad completa de acciones IA/humano | 🔴 Falta |
| **8.3** | AI System Design | `ARCHITECTURE.md` documenta el sistema completo | ✅ |
| **9.1** | Monitoring | Timeline de snapshots = monitoreo continuo | 🔴 Falta |
| **10.1** | Improvement | `diff_template` detecta refinamientos → IA aprende | ✅ |
| **A.7** | Traceability | Snapshots con timestamp + autor + diff | 🔴 Falta |
| **A.8** | Human Oversight | Ren siempre revisa antes de publicar | ✅ |

---

### Lo que necesitamos para ISO 42001 compliance

| # | Feature | Descripción | Prioridad |
|---|---------|-------------|:---:|
| 1 | Dual Snapshot System | IA vs Human snapshots automáticos | 🔴 P0 |
| 2 | Governance Timeline UI | Panel visual con historial de cambios | 🔴 P0 |
| 3 | AI Impact Report | Auto-generado: "Lara modificó X, Ren aprobó Y" | 🟡 P1 |
| 4 | Human Override Log | Registro de cuándo Ren corrigió a Lara | 🟡 P1 |
| 5 | AI Confidence Score | Lara auto-evalúa calidad de su output | 🟢 P2 |
| 6 | Compliance Export | Exportar reporte ISO 42001 en PDF | 🟢 P2 |

---

## 🎯 Próximo paso

Implementar Dual Snapshot + Timeline UI. Con eso cubrimos 6 de 12 requisitos ISO de una sola vez.

```
MCP: snapshot_auto(type, trigger) → guarda en versions[]
Editor: TimelinePanel → lista snapshots con iconos IA/👤
API: GET /templates/:id/snapshots → retorna timeline
```
