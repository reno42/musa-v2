# Database Impact Analysis — GOAL-FIX-2026-06-07

> **Audit Date:** 2026-06-07 | **Auditor:** Lara (OpenClaw subagent)
> **Reference:** `QA/GOAL-FIX-2026-06-07.md` (130 tests, target >85% pass rate)

---

## Methodology

Each P0/P1/P2 bug was analyzed against the actual DB schema inferred from code (`docs/DATABASE_SCHEMA.md`). The question for each: **Does this fix require a database migration (new column, new table, schema change)?**

**Key architectural context:** The Design Editor uses a JSONB-hybrid pattern. The `templates.data` column contains the entire document (canvas objects, frames, styles, versions, etc.). Most fixes are **pure code changes** — they operate on the JSON structure within `data`, not on the PostgreSQL schema.

---

## 🔴 P0 — CRÍTICO Impact Analysis

### P0.1: `em()` destruye precisión decimal

| Aspect | Detail |
|--------|--------|
| **Fix location** | `src/components/PropertiesPanel.tsx:12` |
| **Change** | Remove `em()` function; use `n.toFixed(1)` for display, raw `n` for commit |
| **Schema change?** | ❌ **NONE** |
| **Data format change?** | ❌ **NONE** — values are already stored as decimals in JSONB; the bug is only in the UI display/edit layer |
| **Migration needed?** | ❌ **NONE** |
| **Risk to existing data** | ✅ **ZERO** — existing JSONB values are already precise; the fix just stops the UI from rounding them |
| **Rollback** | Revert the file change. No data migration needed. |

**Verdict: Safe. Pure frontend fix. No DB touch.**

---

### P0.2: `batch_update` con `objects[]` destruye el canvas

| Aspect | Detail |
|--------|--------|
| **Fix location** | `netlify/functions/mcp.mjs` (tool `batch_update`, ~line 841) |
| **Current behavior** | When `params.objects` is provided, replaces entire canvas: `updates.canvas = { objects, viewport: { x: 0, y: 0, zoom: 1 } }` |
| **Target behavior** | If objects have `layerName`, merge by layerName into existing `canvas.objects`. If no layerName, append. |
| **Schema change?** | ❌ **NONE** |
| **Data format change?** | ❌ **NONE** — objects remain Fabric.js JSON in `data.canvas.objects[]` |
| **Migration needed?** | ❌ **NONE** |
| **Risk to existing data** | ⚠️ **MEDIUM** — the fix logic itself is safe (it changes HOW data is written, not WHAT is written), but a bug in the merge logic could corrupt canvas. **Thorough testing required.** |
| **Rollback** | Revert mcp.mjs. Old behavior was "replace", which is destructive but reversible with version history. |

**Verdict: Safe at schema level. Risk is in merge logic correctness, not in DB structure. The `data` JSONB column already stores `canvas.objects[]` — the fix only changes whether `batch_update` replaces or merges into that array.**

---

### P0.3: Frames no persisten → `render_frame` siempre falla

⚠️ **THIS IS THE ONLY P0 WITH DB IMPLICATIONS**

| Aspect | Detail |
|--------|--------|
| **Fix locations** | `api/src/services/store.ts`, `netlify/functions/mcp.mjs` (tool `create_frame`) |
| **Current architecture** | Frames stored in `data.frames[]` (separate JSON array), NOT in `data.canvas.objects[]`. Puppeteer renderer only processes `canvas.objects`. |
| **Option A: Unify frames as canvas objects** | Store frames as Fabric.js objects in `canvas.objects[]` with `isFrameVisual: true` and `frameId`. Eliminate `frames[]` array. |
| **Option B: Teach renderer about frames[]** | Modify render.mjs and renderer.ts to also process `data.frames[]` when rendering. |
| **Schema change?** | ❌ **NONE** for either option — `data` is JSONB, it can store anything |
| **Data format migration?** | ⚠️ **DEPENDS ON OPTION** |
| **Migration needed?** | ⚠️ See below |

#### Option A: Unify frames as canvas objects

```
BEFORE (current):
  data.frames = [ { id, name, x, y, w, h, objects[] }, ... ]
  data.canvas.objects = [ rect, text, image, ... ]  // frames NOT here

AFTER (proposed):
  data.frames = []  // deprecated, kept for backward compat
  data.canvas.objects = [
    { type: "rect", isFrameVisual: true, frameId: "frame_xxx", ... },
    { type: "textbox", frameId: "frame_xxx", ... },  // objects inside frame
    rect, text, image, ...  // non-frame objects
  ]
```

| Concern | Answer |
|---------|--------|
| Schema change? | ❌ No — `canvas.objects` is already `jsonb[]` |
| Migration needed? | ⚠️ **Data migration needed** for EXISTING templates that have frames in `frames[]`. A one-time script must convert `frames[]` → `canvas.objects[]` with `isFrameVisual:true`. |
| Backward compat? | ✅ Can keep `frames[]` as deprecated. Code reads from both sources with a priority rule: `canvas.objects[]` first, then fallback to `frames[]`. The `render_frame` already has this fallback (lines 1431-1434). |
| Risk | 🟡 **MEDIUM** — existing frame data must be migrated. If migration fails, old templates lose their frames. |

#### Option B: Teach renderer about frames[]

| Concern | Answer |
|---------|--------|
| Schema change? | ❌ No |
| Migration needed? | ❌ No — existing data is fine |
| Risk | 🟢 **LOW** — additive change to renderer only |
| Downside | Frames remain in a separate data structure, perpetuating the architectural gap. Future features (frame nesting, Boolean ops on frames) will still need to bridge the two data stores. |

**Verdict:** Option A (unify) is architecturally cleaner but requires data migration. Option B is a quick fix with no migration risk. **RECOMMENDATION: Start with Option B (teach renderer about frames[]) to unblock quickly. Phase Option A as a separate migration in a follow-up sprint.**

---

### P0.4: Sin validación de rangos en `transform_object`

| Aspect | Detail |
|--------|--------|
| **Fix location** | `netlify/functions/mcp.mjs` (tool `transform_object`) |
| **Change** | Add validation: opacity 0-1, angle normalize 0-360, width/height > 0, scaleX/scaleY reasonable range |
| **Schema change?** | ❌ **NONE** |
| **Data format change?** | ❌ **NONE** — validates values before writing to existing JSONB fields |
| **Migration needed?** | ❌ **NONE** |
| **Existing corrupt data?** | ⚠️ **POSSIBLE** — if invalid data was already written (e.g., opacity=-1), a cleanup query may be needed. Low priority since Fabric.js tends to clamp outliers. |

**Verdict: Safe. Pure input validation in API layer. No DB touch.**

---

## 🟡 P1 — IMPORTANTE Impact Analysis

### P1.1: `textAlign` sin UI en PropertiesPanel

| Aspect | Detail |
|--------|--------|
| **Schema change?** | ❌ NONE — textAlign is already a Fabric.js property stored in JSONB |
| **Migration needed?** | ❌ NONE |

**Verdict: Pure UI addition. No DB impact.**

### P1.2: `copy_object` tool rota

| Aspect | Detail |
|--------|--------|
| **Schema change?** | ❌ NONE — copies objects within same JSONB structure |
| **Migration needed?** | ❌ NONE |

**Verdict: Bug fix in MCP tool logic. No DB impact.**

### P1.3: `diff_template` no detecta cambios

| Aspect | Detail |
|--------|--------|
| **Schema change?** | ❌ NONE — snapshots are stored in-memory (`store.snapshots Map`), not in Supabase |
| **Migration needed?** | ❌ NONE |
| **Note** | Snapshots are NOT persisted to Supabase. They live only in server memory (or localStorage for the frontend). If diff_template is needed across server restarts, the snapshots should be stored in a Supabase table. This is a **future concern**, not addressed by P1.3. |

**Verdict: No DB impact for the fix. But the snapshot system has no DB persistence — this is a gap worth noting.**

### P1.4: `boolean_operation` no encuentra layers

| Aspect | Detail |
|--------|--------|
| **Schema change?** | ❌ NONE — operates on `canvas.objects[]` in JSONB |
| **Migration needed?** | ❌ NONE |

**Verdict: Bug fix in MCP tool. No DB impact.**

---

## 🟢 P2 — MEJORA Impact Analysis

### P2.1-2.5

All P2 items are **pure code changes** with zero database impact:
- Rate limiting (P2.1): middleware logic
- Validation (P2.2): input validation
- UI controls (P2.3-P2.5): PropertiesPanel additions, Fabric.js properties already supported in JSONB

---

## Database Impact Summary

```
┌──────────────────────┬──────────┬──────────────┬─────────────┐
│ Bug                  │ Priority │ DB Migration │ Risk Level  │
├──────────────────────┼──────────┼──────────────┼─────────────┤
│ P0.1: em() precision │ 🔴 P0    │ ❌ NONE      │ 🟢 SAFE     │
│ P0.2: batch_update   │ 🔴 P0    │ ❌ NONE      │ 🟡 MEDIUM   │
│ P0.3: frame persist  │ 🔴 P0    │ ⚠️ OPTION A  │ 🟡 MEDIUM   │
│ P0.4: validation     │ 🔴 P0    │ ❌ NONE      │ 🟢 SAFE     │
│ P1.1: textAlign UI   │ 🟡 P1    │ ❌ NONE      │ 🟢 SAFE     │
│ P1.2: copy_object    │ 🟡 P1    │ ❌ NONE      │ 🟢 SAFE     │
│ P1.3: diff_template  │ 🟡 P1    │ ❌ NONE      │ 🟢 SAFE     │
│ P1.4: boolean_op     │ 🟡 P1    │ ❌ NONE      │ 🟢 SAFE     │
│ P2.1-P2.5            │ 🟢 P2    │ ❌ NONE      │ 🟢 SAFE     │
└──────────────────────┴──────────┴──────────────┴─────────────┘
```

### 🎯 Key Conclusion

**9 out of 10 bugs require ZERO database changes.** The JSONB-hybrid architecture absorbs all fixes gracefully because:

1. **`data` column is schemaless** — any Fabric.js property is automatically storable
2. **Frames are embedded** in JSONB, so frame-related fixes don't need new tables
3. **Validation is API-layer** — doesn't touch DB schema

**Only P0.3 (frame persistence) has potential DB migration implications** if Option A (unify frames as canvas objects) is chosen. Even then, it's a **data migration within the JSONB column**, not a schema migration (no `ALTER TABLE`, no new columns).

---

## Recommendations

### For P0.3 (Frame Persistence)

**Recommended approach: Two-phase**

**Phase 1 (Day 1): Option B — Quick Fix**
- Modify `render.mjs` / `renderer.ts` to also process `data.frames[]` when rendering
- No migration needed
- Frames become renderable immediately
- Passes QA

**Phase 2 (Future Sprint): Option A — Architectural Fix**
- Unify frames as `canvas.objects[]` with `isFrameVisual: true`
- Write migration script to convert `data.frames[]` → `canvas.objects[]`
- Keep backward compat (read from both sources)
- Deprecate `data.frames[]` over time

### For Qoder (Agent IDE)

The agent can safely fix P0.1, P0.2, P0.4, and all P1/P2 bugs **without worrying about the database**. The JSONB schema is forgiving. The agent should:

1. ✅ Modify `PropertiesPanel.tsx` (P0.1, P1.1)
2. ✅ Modify `mcp.mjs` batch_update logic (P0.2)
3. ✅ Add validation to `mcp.mjs` transform_object (P0.4)
4. ⚠️ For P0.3, implement Option B first, then plan Option A migration

### Schema Verification Required

Manually verify in Supabase Dashboard (`https://npdycbfhtcccznbndrkl.supabase.co`):

- [ ] Column defaults on `templates.created_at`
- [ ] Column defaults on `workspaces.created_at`
- [ ] RLS policies state (likely disabled)
- [ ] Existing indexes
- [ ] `user_id` FK constraint on `templates`
- [ ] Row count in `templates` and `workspaces` tables
- [ ] Any additional tables not discovered in code analysis
