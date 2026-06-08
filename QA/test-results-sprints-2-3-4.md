# QA Test Results — Sprints 2, 3, 4

**Date:** 2026-06-08 03:59 UTC-5  
**Endpoint:** `https://bejewelled-llama-a6719d.netlify.app/mcp`  
**Test Template:** `tpl_58633f45-dee` (QA-Sprints-2-3-4)  
**Alt Template:** `tpl_31018aa1-c67` (QA-Sprints-Alt)  
**Tester:** Lara (Design Engineer @ Futuraria)  
**Result:** 🔴 **19/19 FAIL — None of the 19 tools are deployed to production** (20 calls, ghost_show tested with 2 variant args)

---

## Summary

| Sprint | Tools Tested | ✅ PASS | ❌ FAIL | ⚠️ PARCIAL |
|--------|-------------|---------|---------|------------|
| Sprint 2 — Ghost System | 5 | 0 | 5 | 0 | (6 calls incl. dual ghost_show)
| Sprint 3 — Clone Skills | 5 | 0 | 5 | 0 |
| Sprint 4 — New Tools | 9 | 0 | 9 | 0 |
| **TOTAL** | **19** | **0** | **19** | **0** |

---

## Root Cause

All 19 tools return the same error:

```
MCP error -32601: Method not found: <tool_name>
```

The production MCP server currently exposes **100 tools** — all from the core canvas/web/design/AI toolkit. None of the Sprint 2/3/4 tools are registered in the server's tool registry.

The server was deployed from a codebase that includes only the core tools. The 19 new tools (ghost system, clone skills, batch design, aesthetic/Lint, observe, smart_layout, remix, design_diff, color palette, auto_polish) have not been merged/deployed.

---

## Sprint 2 — GHOST SYSTEM (6 tools)

| # | Tool | Status | Error |
|---|------|--------|-------|
| 1 | `ghost_show` (type=human, opacity=0.3) | ❌ FAIL | `-32601 Method not found: ghost_show` |
| 2 | `ghost_show` (type=ia, opacity=0.3) | ❌ FAIL | `-32601 Method not found: ghost_show` |
| 3 | `ghost_diff` | ❌ FAIL | `-32601 Method not found: ghost_diff` |
| 4 | `ghost_timeline` | ❌ FAIL | `-32601 Method not found: ghost_timeline` |
| 5 | `ghost_merge` | ❌ FAIL | `-32601 Method not found: ghost_merge` |
| 6 | `ghost_compare` | ❌ FAIL | `-32601 Method not found: ghost_compare` |

---

## Sprint 3 — CLONE SKILLS (5 tools)

| # | Tool | Status | Error |
|---|------|--------|-------|
| 7 | `skill_extract` | ❌ FAIL | `-32601 Method not found: skill_extract` |
| 8 | `skill_clone` | ❌ FAIL | `-32601 Method not found: skill_clone` |
| 9 | `skill_apply` | ❌ FAIL | `-32601 Method not found: skill_apply` |
| 10 | `brand_analyze` | ❌ FAIL | `-32601 Method not found: brand_analyze` |
| 11 | `brand_apply` | ❌ FAIL | `-32601 Method not found: brand_apply` |

---

## Sprint 4 — NEW TOOLS (9 tools)

| # | Tool | Status | Error |
|---|------|--------|-------|
| 12 | `batch_design_from_csv` | ❌ FAIL | `-32601 Method not found: batch_design_from_csv` |
| 13 | `aesthetic_score` | ❌ FAIL | `-32601 Method not found: aesthetic_score` |
| 14 | `design_lint` | ❌ FAIL | `-32601 Method not found: design_lint` |
| 15 | `observe_session` | ❌ FAIL | `-32601 Method not found: observe_session` |
| 16 | `smart_layout` | ❌ FAIL | `-32601 Method not found: smart_layout` |
| 17 | `remix_template` | ❌ FAIL | `-32601 Method not found: remix_template` |
| 18 | `design_diff` | ❌ FAIL | `-32601 Method not found: design_diff` |
| 19 | `suggest_color_palette` | ❌ FAIL | `-32601 Method not found: suggest_color_palette` |
| 20 | `auto_polish` | ❌ FAIL | `-32601 Method not found: auto_polish` |

---

## Recommendation

1. **Deploy Sprint 2/3/4 code to production** — These tools exist in the codebase but haven't been built/deployed to the Netlify function.
2. **Verify the build includes all tool registrations** — Check that `src/tools/ghost/`, `src/tools/skills/`, `src/tools/batch/`, etc. are correctly imported in the main MCP server entry point.
3. **Add integration tests** in CI/CD to prevent regressions — a smoke test that calls each tool after deploy would catch this.
4. **Re-run this QA suite** after deployment to confirm all 19 tools respond correctly.
