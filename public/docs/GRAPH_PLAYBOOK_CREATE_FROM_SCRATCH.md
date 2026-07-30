# GRAPH PLAYBOOK: Create Design from Scratch

> **Intent**: "Create a new design from scratch — I have an idea/description but no existing template."
> **Graph type**: DAG (design lineage + validation gates)
> **Agent scope**: IDE agent, Codex, Claude Cowork, Claude Code, Hermes, OpenClaw

---

## Schema

### Entity Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `Objective` | User intent + constraints | `description`, `targetFormats`, `brandName` (optional) |
| `Plan` | Tool sequence branching based on context | `steps[]`, `validationGate`, `fallback` |
| `Artifact` | Design output produced by a tool | `templateId`, `frameId`, `layerIds[]`, `sourceHash` |
| `Run` | Single tool invocation | `tool`, `params`, `duration_ms`, `status` |
| `Evaluation` | Validation gate verdict | `score`, `issues[]`, `pass/fail` |
| `Claim` | Lock on a frame (multi-agent) | `agentId`, `frameId`, `expiresAt` |
| `Source` | Input reference (prompt, brand guide, image) | `type`, `content`, `provenance` |

### Relation Types

| Relation | From → To | Meaning |
|----------|-----------|---------|
| `HAS_PLAN` | Objective → Plan | This objective follows this plan |
| `PRODUCED` | Run → Artifact | Run created this artifact |
| `EVALUATES` | Evaluation → Artifact | This gate validates this artifact |
| `PARENT_OF` | Artifact → Artifact | Adaptation/derivative |
| `DEPENDS_ON` | Artifact → Artifact | Must exist before this can be created |
| `CLAIMS` | Claim → Artifact | This agent holds the lock |
| `VALIDATES_AGAINST` | Evaluation → Plan | Gate maps to plan validation contract |

---

## Node Contract (TypeScript Interface)

```ts
interface ScratchNode {
  id: string;
  phase: "intent" | "discovery" | "creation" | "validation" | "adaptation" | "terminal";
  tool: string | null;
  params: Record<string, unknown>;
  expected: Record<string, unknown>;  // shape of expected output
  on_success: string;                 // next node id
  on_failure: string;                 // error recovery node id
  max_retries: number;
  timeout_ms: number;
  contract: string;                   // validation contract id (V1-V5)
}
```

---

## DAG: Create Design from Scratch

```mermaid
graph TB
    E1["E1: Objective<br/>user prompt + constraints"] --> P1["P1: Plan<br/>which creation path?"]

    P1 -->|"has complete HTML+CSS<br/>(Gemini/ChatGPT/Claude)"| D0["D0: import_design<br/>ONE call, auto-parses document"]
    P1 -->|"has reference/description"| D1["D1: list_workspaces<br/>find workspace"]
    P1 -->|"blank slate"| D1

    D0 --> V0{"V0: Frame created?"}
    V0 -->|"yes"| T1["T1: Terminal<br/>report + URLs"]
    V0 -->|"no"| D1

    D1 --> A2["A2: list_templates<br/>check for brand match"]
    A2 --> V1{"V1: Brand exists?"}
    V1 -->|yes| A3["A3: get_design_system<br/>read tokens"]
    V1 -->|no| A4["A4: create_workspace<br/>(if needed)"]

    A3 --> A5["A5: create_html_frame<br/>empty frame, 1080x1080"]
    A4 --> A6["A6: create_html_frame<br/>empty frame, 1080x1080"]

    A5 --> A7["A7: set_frame_layers<br/>build from intent"]
    A6 --> A7

    A7 --> V2{"V2: Lint gate<br/>score >= 70?"}
    V2 -->|fail| A8["A8: Repair<br/>analyze issues → fix"]
    V2 -->|pass| A9["A9: export_design_tokens<br/>extract CSS vars"]

    A8 --> A7

    A9 --> V3{"V3: Multi-format needed?"}
    V3 -->|yes| P2["P2: Adaptation plan<br/>Stories, Posts, LinkedIn"]
    V3 -->|no| T1["T1: Terminal<br/>report + URLs"]

    P2 --> F1["F1: create_html_frame<br/>1080x1920 Story"]
    P2 --> F2["F2: create_html_frame<br/>1080x1080 Post"]
    P2 --> F3["F3: create_html_frame<br/>1200x627 LinkedIn"]

    F1 --> D2["D2: get_design_system<br/>read tokens for adaptation"]
    F2 --> D2
    F3 --> D2

    D2 --> F4["F4: set_frame_layers<br/>adapt to Story"]
    D2 --> F5["F5: set_frame_layers<br/>adapt to Post"]
    D2 --> F6["F6: set_frame_layers<br/>adapt to LinkedIn"]

    F4 --> V4{"V4: Format lint<br/>all pass?"}
    F5 --> V4
    F6 --> V4

    V4 -->|fail| A10["A10: Repair per format<br/>fix failing frames"]
    V4 -->|pass| T1

    A10 --> V4

    T1 --> PG["PG: Provenance graph<br/>traceability chain"]
```

---

## Phase-by-Phase Node Guide

### Phase 1: Intent → Discovery

| Node | Tool | Params | Expected Output |
|------|------|--------|-----------------|
| D1 | `tools/list` | `{}` | Available tools, server version |
| D1 | `list_workspaces` | `{}` | `[{ id, name, owner_id }]` |
| A2 | `list_templates` | `{ workspaceId }` | `[{ id, name, engine, frames }]` |
| V1 | — | Manual check | Does any template share brandName? |
| A3 | `get_design_system` | `{ templateId }` | `{ tokens, components, frames, brand, cssRoot }` |
| A4 | `create_workspace` | `{ name }` | `{ workspaceId }` |

**Branch logic**:
- If user provides **complete HTML+CSS document** (from Gemini, ChatGPT, Claude, etc.) → `import_design({ templateId, document })` — ONE call, auto-parses, returns frameId. Skip to Terminal.
- If `brandName` provided AND matching template exists → branch A3 (inherit design system)
- If `brandName` provided AND no match → branch A4 (create fresh, register brand later)
- If no `brandName` → branch A4 (blank canvas)

### Phase 2: Frame Creation

| Node | Tool | Params | Expected Output |
|------|------|--------|-----------------|
| D0 | `import_design` | `{ templateId, document: "<complete HTML from Gemini>" }` — OR `{ templateId, html: "...", css: "..." }` | `{ templateId, frameId, htmlLength, cssLength, detectedWidth, detectedHeight, mode: "created" }` |
| A5/A6 | `create_html_frame` | `{ templateId, name, width: 1080, height: 1080 }` | `{ frameId, x, y }` |
| A7 | `set_frame_layers` | `{ templateId, frameId, layers, fontImports? }` | `{ success, layerIds[] }` |

**`set_frame_layers` layer schema**:
```ts
interface EditableLayer {
  id: string;           // unique id within frame
  name: string;         // semantic name
  kind: "text" | "image" | "shape" | "container";
  position: { left: number; top: number };
  size: { width: number; height: number };
  // text-specific
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  // image-specific
  src?: string;
  // shape-specific
  backgroundColor?: string;
  borderRadius?: number;
  boxShadow?: string;
  // container
  children?: EditableLayer[];
}
```

**Positioning**:
- First frame: `computeFramePosition(existing=[], …)` → `{ x: 0, y: 0 }`
- Subsequent frames: auto-placed by `create_html_frame` using cascade algorithm (max row width 4000px, 100px gap)
- Override with `update_html_frame` `{ x, y }` if manual placement needed

### Phase 3: Validation Gates

| Gate | Contract | Tool | Threshold | On Fail |
|------|----------|------|-----------|---------|
| V1 | Brand detection | Manual check | — | Proceed without brand |
| V2 | Lint gate | `lint_design` | `score >= 70` | A8: Read issues → apply fixes → re-lint |
| V3 | Multi-format | Manual check | User intent | Branch to adaptation OR terminal |
| V4 | Format lint | `lint_design` per frame | `score >= 70` | A10: Repair per failing frame |

### Phase 4: Adaptation (Conditional)

| Node | Tool | Params | Expected Output |
|------|------|--------|-----------------|
| F1 | `create_html_frame` | `{ templateId, name: "IG Story", width: 1080, height: 1920 }` | `{ frameId, x, y }` |
| F2 | `create_html_frame` | `{ templateId, name: "IG Post", width: 1080, height: 1080 }` | `{ frameId, x, y }` |
| F3 | `create_html_frame` | `{ templateId, name: "LinkedIn", width: 1200, height: 627 }` | `{ frameId, x, y }` |
| D2 | `get_design_system` | `{ templateId }` | Design tokens for consistent styling |
| F4-F6 | `set_frame_layers` | `{ templateId, frameId, layers }` | `{ success, layerIds[] }` |

**Adaptation constraints**:
- Maintain color palette (from design system)
- Maintain font hierarchy (from design system)
- Adjust layout to fit new aspect ratio
- Re-scale images proportionally
- Reposition CTAs for new dimensions

### Phase 5: Terminal Report

```ts
interface ScratchReport {
  objective: string;
  templateId: string;
  templateName: string;
  editorUrl: string;          // https://design.futuraria.com/?template={id}&v=2
  frames: {
    id: string;
    name: string;
    width: number;
    height: number;
    format: "square" | "story" | "linkedin" | "banner" | "custom";
    layerCount: number;
    lintScore: number | null;
  }[];
  designTokens?: {
    colors: number;
    fonts: number;
    components: number;
  };
  sourceHash?: string;
  generatedAt: string;
}
```

---

## Validation Contracts

### V1: Brand Detection
```yaml
check: |
  If brandName in intent:
    Scan list_templates result for name match
    If match → use get_design_system on that template
    If no match → proceed without brand (will use defaults)
on_fail: proceed_without_brand
```

### V2: Lint Gate
```yaml
check: |
  lint_design({ templateId, frameId })
  assert: score >= 70
  assert: no critical issues (severity === "error")
on_fail: |
  1. Parse issues[] from lint_design response
  2. For each issue: identify fix (CSS adjustment, layer reposition, font import)
  3. Apply fixes via set_frame_layers or update_html_frame
  4. Re-run lint_design
  max_retries: 3
```

### V3: Multi-Format Decision
```yaml
check: |
  User explicitly asked for multiple formats?
  OR template serves social media use case?
on_fail: skip_adaptation → terminal
```

### V4: Format Lint
```yaml
check: |
  For each adaptation frame:
    lint_design({ templateId, frameId })
    assert: score >= 70
    assert: no layout breakage from aspect ratio change
on_fail: |
  1. Identify failing frames only
  2. Repair each independently (parallel safe)
  3. Re-lint
  max_retries: 2 per frame
```

---

## Error Recovery Paths

### ER1: Workspace Not Found
```
Symptom: list_workspaces returns empty or error
Recovery:
  1. create_workspace({ name: "Scratch Workspace" })
  2. Store workspaceId
  3. Retry list_templates with new workspaceId
```

### ER2: Frame Creation Fails
```
Symptom: create_html_frame returns error
Recovery:
  1. Check template exists and engine === "html"
  2. If template missing: create_template first
  3. If engine mismatch: update_template({ engine: "html" })
  4. Retry create_html_frame
```

### ER3: set_frame_layers Rejected
```
Symptom: _editability.errors present in response
Recovery:
  1. Read errors[] (identifies which layers violate flat editability contract)
  2. Fix: remove nested containers, flatten groups, add explicit position to each layer
  3. Retry set_frame_layers
```

### ER4: Font Not Available
```
Symptom: fontImports URL invalid or font not rendering
Recovery:
  1. Use system-ui fallback in set_frame_layers fontFamily
  2. OR: search Google Fonts for nearest match
  3. Update fontImports with valid CDN URL
  4. Retry set_frame_layers
```

---

## Ratchet Loop (per frame)

```
while frame.lintScore < 70:
  issues = lint_design(templateId, frameId)
  if no issues: break
  for each issue:
    fix = generateFix(issue, frame)
    set_frame_layers(templateId, frameId, fix.layers)
  newScore = lint_design(templateId, frameId)
  if newScore <= frame.lintScore: break  // no improvement
  frame.lintScore = newScore
```

**Ratchet principle**: Only keep changes that improve the score. Revert if score drops.

---

## Agent Quick-Start (Copy-Paste)

### If you have complete HTML+CSS from Gemini/ChatGPT/Claude:
```json
{ "method": "tools/call", "params": { "name": "import_design", "arguments": { "templateId": "tpl_...", "document": "<!DOCTYPE html>..." } } }
```
→ Single call. Auto-parses <style>, <body>, font imports. Returns frameId. Done.

### If you're building from a description (no existing HTML):

### Step 1: Discovery
```json
{ "method": "tools/list" }
{ "method": "tools/call", "params": { "name": "list_workspaces" } }
```

### Step 2: Create Template
```json
{ "method": "tools/call", "params": { "name": "create_template", "arguments": { "workspaceId": "ws_...", "name": "My Design", "width": 1080, "height": 1080, "engine": "html" } } }
```

### Step 3: Create Frame
```json
{ "method": "tools/call", "params": { "name": "create_html_frame", "arguments": { "templateId": "tpl_...", "name": "Main Square", "width": 1080, "height": 1080 } } }
```

### Step 4: Build Layers
```json
{ "method": "tools/call", "params": { "name": "set_frame_layers", "arguments": { "templateId": "tpl_...", "frameId": "frm_...", "layers": [ { "id": "h1", "name": "Heading", "kind": "text", "position": { "left": 100, "top": 80 }, "size": { "width": 880, "height": 120 }, "text": "Hello World", "fontFamily": "Inter, sans-serif", "fontSize": 64, "fontWeight": 700, "color": "#1a1a2e" } ], "fontImports": ["https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700"] } } }
```

### Step 5: Validate
```json
{ "method": "tools/call", "params": { "name": "lint_design", "arguments": { "templateId": "tpl_...", "frameId": "frm_..." } } }
```

### Step 6: Adapt (optional)
```json
{ "method": "tools/call", "params": { "name": "create_html_frame", "arguments": { "templateId": "tpl_...", "name": "IG Story", "width": 1080, "height": 1920 } } }
// Then set_frame_layers with adapted layout
```

### Step 7: Report
```
editorUrl: https://design.futuraria.com/?template=tpl_...&v=2
frameCount: N
lintScores: [...]
```

---

## Principles Cross-Reference

| Graph Engineering Principle | Implementation |
|----------------------------|----------------|
| DAG as work lineage | Nodes E1→P1→D1→A2→V1→… form acyclical causal chain |
| Ratchet (only improve) | Lint loop: keep only score-improving changes |
| Provenance (every claim has source) | PG node: trace prompt → design system → frames → adaptations |
| Bounded context (no transcript dumping) | Each node contract has max 3 fields of context; raw source in Source entity |
| Evaluation gates at boundaries | V1-V4 at each phase boundary before proceeding |
| Multi-branch by context | P1 branches on reference/brand presence; V3 branches on format intent |
| Idempotent tool design | set_frame_layers fully replaces frame content; same inputs → same output |
| Human-in-the-loop as gate | V1 (brand match) and V3 (format decision) can pause for user input |
| Cost-aware batching | Frame creation batched by format; lint run per-frame not whole-template |
