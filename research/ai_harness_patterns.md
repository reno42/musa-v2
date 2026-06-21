# AI Harness Patterns for Collaborative Design Tools

> **Research Date:** 2026-06-18
> **Context:** Futuraria Design MCP — multi-agent harness for template-based design.
> **Goal:** Understand concurrency patterns when multiple AI agents edit the same canvas/template simultaneously.

---

## 1. How Existing AI-Powered Design Tools Handle Multi-Agent Editing

### 1.1 v0.dev (Vercel)

**Model: Single-agent, sequential chat.** v0 is fundamentally a single-user chat-to-code tool. Each `v0 chat` is a session with one AI agent. There is no concept of "multiple agents editing simultaneously" — it's a 1:1 relationship between user and agent. The collaboration happens at the _human_ level (Product Managers, Designers, Engineers each using their own chat), but each generates a snapshot/PR that gets reviewed, not concurrently edited.

**Key Architectural Insight:** v0 generates _code_ (React/Next.js components), not a central canvas state. Two different chats could generate different versions of the same file, but they'd produce separate git branches — the human handles merge conflicts. This is essentially **Git-based conflict resolution**, not real-time concurrency.

### 1.2 Bolt.new (StackBlitz)

**Model: Single-agent, full-stack sandbox.** Bolt.new provides a WebContainer-based environment where an AI agent generates and edits files. It's an agent-in-a-sandbox model. Like v0, it's a 1:1 session. The sandbox is ephemeral — you fork/remix, don't concurrently edit. No multi-agent concurrency needed.

**Architectural Pattern:** File-level atomic writes. The agent generates entire files or uses targeted file edits (via code editing tools), but there's only one agent per sandbox. If multiple humans collaborate, they'd use git branching.

### 1.3 Cursor AI / Windsurf

**Model: Multiple agents, file-system concurrency.** Both use the IDE as the "canvas." Cursor's Composer agent and Windsurf's Cascade agent operate on the file system:

- **Cursor**: The agent uses a file-diff approach — it reads files, plans changes, applies diffs. If multiple agent sessions ran on the same file, they'd use **last-write-wins** at the file system level.
- **Windsurf (Cascade)**: Similar approach — reads context, makes edits. Cascade's "multi-agent" is _sequential_ within a session (analyze → plan → execute), not truly concurrent.

**The "Agent + Human" Pattern:** Both tools solve the problem by having the _human_ as the gatekeeper. The agent proposes changes (diffs), the human accepts/rejects. This is a **human-mediated conflict resolution** model.

### 1.4 Figma AI / Uizard / Galileo AI (now Stitch)

These tools follow different paradigms:

- **Figma AI**: Generates _starting points_ (layouts, auto-layout, content), not continuous editing. Human takes over after generation. Figma's real-time collaboration uses **Operational Transform** (proprietary, based on their C++/WASM engine), but the AI doesn't participate in that real-time layer — it's a one-shot generator.
- **Uizard**: AI generates from prompt/screenshot. After generation, it becomes a human-editable UI. No multi-agent editing. The "Autodesigner" generates, humans refine.
- **Galileo AI → Stitch** (acquired by Google): Generates designs from prompts. Single-shot generation, not multi-agent.
- **Locofy**: Design-to-code. Converts Figma designs to React/Next.js/Vue. One-shot conversion, not collaborative editing.

**The Common Pattern:** Most AI design tools are **generator + human editor**, not multi-agent collaborative editors. The AI does the initial heavy lifting, then the human refines. This avoids concurrency entirely.

### 1.5 Paper.design

Paper.design was an AI-powered collaborative design canvas. It was closer to a Figma-with-AI model. However, it was acquired/shut down (domain now redirects). Their approach was likely canvas-based with real-time collaboration using CRDTs or OT, but details are scarce.

---

## 2. Concurrency Patterns for Multi-Agent Writing

### 2.1 Operational Transform (OT)

**What it is:** A concurrency control algorithm where operations (insert, delete, move) are transformed relative to concurrent operations. Each client sends operations to a server; the server transforms and broadcasts.

**Who uses it:**
- Google Docs (custom OT implementation)
- Figma (proprietary, C++/WASM-based OT engine)
- Etherpad
- ShareJS (open-source OT library)

**How it works:**
```
Site 1: insert("a", 0) → "abc"  ──→  Site 2 receives insert("a", 0)
Site 2: delete(2, 1)   → "ab"   ──→  Site 1 receives delete(2, 1) → transforms to delete(3, 1)
Result: Both sites converge to "ab"
```

**Pros:**
- Mature, battle-tested (30+ years)
- Works well for linear documents (text, ordered lists)
- Central server can enforce ordering

**Cons:**
- Requires a central server for ordering (single source of truth)
- Complex to implement correctly for rich data structures
- Every new operation type needs a transformation function against every other type (O(n²) complexity)
- Google/Figma implementations are proprietary; open-source OT libraries are limited

**For template-based design:** OT works well if your template is a flat list of elements with ordering. Gets exponentially harder with nested groups, styling, constraints. Figma spent years on their OT engine.

### 2.2 CRDTs (Conflict-free Replicated Data Types)

**What it is:** Data structures designed so that concurrent updates automatically converge to the same state without a central server. Uses mathematical properties (commutativity, associativity, idempotence) to guarantee convergence.

**Key Libraries:**
- **Yjs** — Fastest CRDT implementation. Used by Liveblocks, Tiptap, many collaborative editors. Written from scratch in JS. Supports Y.Map, Y.Array, Y.Text, Y.XmlElement, Y.XmlFragment.
- **Automerge** — Built by Ink & Switch (Heroku founders + Martin Kleppmann of Cambridge). More academic rigor; formal proofs using Isabelle theorem prover. JSON-like document model.

**How Yjs works:**
```javascript
import * as Y from 'yjs'

// Agent 1
const ydoc1 = new Y.Doc()
const ymap1 = ydoc1.getMap('template')
ymap1.set('backgroundColor', '#FF0000')
ymap1.set('title', 'Hello')

// Agent 2 (simultaneous)
const ydoc2 = new Y.Doc()
const ymap2 = ydoc2.getMap('template')
ymap2.set('backgroundColor', '#0000FF') // Conflict with Agent 1!
ymap2.set('subtitle', 'World')

// Merge — CRDT handles the conflict
const update1 = Y.encodeStateAsUpdate(ydoc1)
const update2 = Y.encodeStateAsUpdate(ydoc2)
Y.applyUpdate(ydoc1, update2)
Y.applyUpdate(ydoc2, update1)

// Both now have: { backgroundColor: '#0000FF', title: 'Hello', subtitle: 'World' }
// backgroundColor resolved by logical timestamp (last write wins within CRDT framework)
```

**Pros:**
- No central server needed (decentralized)
- Network agnostic — works over WebSocket, WebRTC, HTTP, or even file sync
- Rich data types: maps, arrays, text, XML-like structures
- Handles offline editing naturally
- Merging is deterministic and automatic
- Yjs scales indefinitely (proven via y-redis)

**Cons:**
- For a single key, concurrent updates use LWW (last-write-wins) within the CRDT — same as OT
- Complex nested operations (e.g., "move element from group A to group B while changing its color") need careful data modeling
- Memory grows with document history (need garbage collection)
- Initial document load can be large

**For template-based design:** CRDTs are the **best fit** for canvas/element-based design. Yjs's Y.Map works naturally for template properties. Y.Array works for ordered element lists. The challenge is modeling complex element relationships (parent-child, constraints, z-order).

### 2.3 Lock-Based (Pessimistic Concurrency)

**What it is:** Before editing, an agent acquires a lock. Other agents must wait. Database-level or application-level locks.

**Patterns:**
- **Row-level locks (Postgres):** `SELECT ... FOR UPDATE` — locks the row until the transaction commits
- **Advisory locks (Postgres):** `pg_advisory_xact_lock(template_id)` — application-defined lock
- **Distributed locks (Redis):** `SET lock:template:123 agent_id NX EX 30` — TTL-based lock
- **Optimistic locking:** Version column + `WHERE version = :expected_version`

**Example — Optimistic Locking in Supabase:**
```sql
-- Template table with version column
ALTER TABLE templates ADD COLUMN version INTEGER DEFAULT 1;

-- Agent A reads
SELECT * FROM templates WHERE id = 'abc';
-- version = 5

-- Agent A tries to update
UPDATE templates
SET data = '{"background": "#000"}', version = 6
WHERE id = 'abc' AND version = 5;
-- If 0 rows affected → someone else updated → retry
```

**Pros:**
- Simple to understand and implement
- Strong consistency guarantees
- Works with any database (Postgres, Supabase, etc.)
- Prevents all conflicts (by preventing concurrency)

**Cons:**
- Blocks other agents — terrible UX for human collaboration
- Deadlocks possible with multiple locks
- High latency if agent A holds a lock while calling an LLM (could be 5-30 seconds!)
- Doesn't scale well
- Single point of failure (lock server)

**For AI agent design:** Locks work **if agents are fast** (sub-second operations). But if an agent calls an LLM while holding a lock, that lock is held for 5-30 seconds. This is a **bad fit** for AI-powered design where LLM round-trips are slow.

### 2.4 Last-Write-Wins (LWW)

**What it is:** Simplest approach. No conflict resolution. Whichever agent writes last wins. The previous write is silently overwritten.

**How Supabase REST API handles it (default):**
```javascript
// Agent A reads template
const { data } = await supabase.from('templates').select('*').eq('id', 'abc').single()

// Agent A modifies and writes
await supabase.from('templates').update({ data: newData }).eq('id', 'abc')
// Agent B does the same thing 2ms later → Agent A's changes are GONE
```

**Pros:**
- Dead simple
- No infrastructure needed
- Fast — no waiting

**Cons:**
- **Silent data loss** — this is the worst-case for design work
- Agent A spends 10 seconds generating a beautiful layout → Agent B overwrites it without knowing
- Invisible conflicts — neither agent knows their work was lost

**When it's acceptable:** When agents operate on _different parts_ of the template (agent A edits header, agent B edits footer). But this requires application-level partitioning, not true LWW.

### 2.5 Field-Level Merging (Hybrid)

**What it is:** Agents only update specific fields, not the entire document. The application merges field-level updates.

```javascript
// Template data stored as separate columns or as JSON with field-level tracking
{
  "id": "abc",
  "header": { "content": "...", "updated_by": "agent-a", "updated_at": "..." },
  "hero": { "image": "...", "updated_by": "agent-b", "updated_at": "..." },
  "footer": { "content": "...", "updated_by": "agent-a", "updated_at": "..." }
}

// Agent A updates header
await supabase.from('templates').update({
  header: newHeader,
  updated_by: 'agent-a'
}).eq('id', 'abc')

// Agent B updates hero (doesn't touch header)
await supabase.from('templates').update({
  hero: newHero,
  updated_by: 'agent-b'
}).eq('id', 'abc')
// Both updates survive!
```

**Pros:**
- No conflict resolution needed for disjoint field updates
- Works with any database
- Easy to reason about
- Agents can work in parallel on different template sections

**Cons:**
- Requires template to be partitioned into independent sections
- Agents can't modify the same section simultaneously
- If two agents edit the same field, we're back to LWW
- Adds complexity to the template data model

### 2.6 Agent-Friendly Pattern: Task Decomposition + Section Locking

**The pattern that works best for multi-agent design:**

1. **Coordinator agent** decomposes the design task into independent sections
2. Each section is assigned to a **worker agent** with a **section lock**
3. Worker agents generate their section independently
4. Coordinator **merges** the results (no conflicts because sections are disjoint)

```
Template: Landing Page
├── Section A (Header/Nav)   → Agent Alpha (locked)
├── Section B (Hero)         → Agent Beta  (locked)
├── Section C (Features)     → Agent Gamma (locked)
├── Section D (CTA)          → Agent Delta (locked)
└── Section E (Footer)       → Agent Alpha (locked, after Header done)
```

**Supabase implementation:**
```sql
-- Section locks table
CREATE TABLE section_locks (
  template_id UUID NOT NULL,
  section_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes',
  PRIMARY KEY (template_id, section_id)
);

-- Acquire lock (atomic)
INSERT INTO section_locks (template_id, section_id, agent_id)
VALUES ('abc', 'header', 'agent-alpha')
ON CONFLICT (template_id, section_id)
DO UPDATE SET agent_id = 'agent-alpha', locked_at = NOW(), expires_at = NOW() + INTERVAL '5 minutes'
WHERE section_locks.expires_at < NOW(); -- only if expired
```

---

## 3. Supabase Realtime — Deep Dive

### 3.1 Architecture

Supabase Realtime is built on:
- **Elixir + Phoenix Framework** — Erlang VM, known for massive WebSocket concurrency
- **Postgres logical replication** — for database change events (CDC)
- **Phoenix Channels** — for Broadcast and Presence

Everything is a **Channel**. Channels are like rooms — clients join, subscribe to events, leave.

### 3.2 Three Features

#### Broadcast (Pub/Sub)
Send low-latency, ephemeral messages between clients. **Bypasses the database entirely.** Ideal for cursor positions, typing indicators, real-time notifications.

```javascript
const channel = supabase.channel('template-abc')

// Subscribe
channel
  .on('broadcast', { event: 'element-updated' }, (payload) => {
    applyElementUpdate(payload)
  })
  .subscribe()

// Send (from any agent)
channel.send({
  type: 'broadcast',
  event: 'element-updated',
  payload: { elementId: 'btn-1', color: '#FF0000' }
})
```

**Limits (Free Tier):**
- Payload size: 256 KB max
- Messages per second: 100 total across all clients
- Binary payloads supported (ArrayBuffer) from supabase-js 2.91.0+

#### Presence
Track shared state across clients. "Who's online / what are they editing?" State is persisted in the channel so late joiners see current state immediately.

```javascript
const channel = supabase.channel('template-abc', {
  config: { presence: { key: 'agent-alpha' } }
})

channel
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    // state = { 'agent-alpha': [{ editing: 'header' }], 'agent-beta': [{ editing: 'hero' }] }
  })
  .subscribe()

// Track what this agent is doing
channel.track({ editing: 'header', progress: 0.75 })
```

**⚠️ Important Warning (from Supabase docs):**
> Presence syncs state through the server and notifies ALL subscribers on every change. Calling `track()` rapidly — for example on every mouse move to share cursor positions — will flood the channel and cause performance problems.

Use Presence for **slow-changing state** (online/offline, active section, progress). Use Broadcast for high-frequency updates (cursor positions, real-time element changes).

**Limits (Free Tier):**
- Presence keys per object: 10
- Presence messages per second: 20
- Presence calls per client per 30 seconds: 5

#### Postgres Changes (CDC)
Listen to database INSERT/UPDATE/DELETE in real-time. Uses Postgres logical replication (WAL-based).

```javascript
const channel = supabase.channel('db-changes')
channel
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'templates',
    filter: `id=eq.abc`
  }, (payload) => {
    // payload.new = new row data
    // payload.old = old row data
    applyTemplateUpdate(payload.new)
  })
  .subscribe()
```

**Setup required:**
1. Enable replication on the table via Supabase Dashboard → Publications → `supabase_realtime`
2. Or via SQL: `ALTER PUBLICATION supabase_realtime ADD TABLE templates;`
3. Row Level Security (RLS) works — respect auth policies

**Limits (Free Tier):**
- Payload size: 1,024 KB
- When exceeded, only fields ≤ 64 bytes are included in payload

### 3.3 Full Limits by Plan

| Limit | Free | Pro | Pro (No Spend Cap) |
|-------|------|-----|--------------------|
| **Concurrent connections** | 200 | 500 | 10,000 |
| **Messages per second** | 100 | 500 | 2,500 |
| **Channel joins per second** | 100 | 500 | 2,500 |
| **Channels per connection** | 100 | 100 | 100 |
| **Presence keys per object** | 10 | 10 | 10 |
| **Presence messages/sec** | 20 | 50 | 1,000 |
| **Presence calls per client/30s** | 5 | 5 | 5 |
| **Broadcast payload size** | 256 KB | 3,000 KB | 3,000 KB |
| **Postgres change payload** | 1,024 KB | 1,024 KB | 1,024 KB |

### 3.4 What Free Tier CAN Support

| Use Case | Feasible? | Notes |
|----------|-----------|-------|
| 5-10 human users editing simultaneously | ✅ Yes | Well within 200 connection limit |
| 2-5 AI agents watching templates | ✅ Yes | Agents consume 1 connection each |
| Real-time element updates via Broadcast | ✅ Yes | 100 msg/s is plenty for deliberate edits |
| Showing who's editing what (Presence) | ✅ Yes | 20 updates/s, 5 calls/30s per client |
| Live preview of template changes | ✅ Yes | Postgres Changes handles this |
| Cursor tracking for 50+ users | ❌ No | 20 presence msg/s won't handle rapid mouse moves |
| Hundreds of simultaneous agents | ❌ No | 200 connection limit, 100 msg/s |
| High-frequency element manipulation (drag) | ⚠️ Careful | Use Broadcast, throttle to <100 msg/s |

### 3.5 Can multiple subscribers watch/edit the same row concurrently?

**Yes, absolutely.** Postgres MVCC already handles this at the database level. Multiple clients can:

1. **Watch the same row:** Subscribe to Postgres Changes filtered by `id=eq.XYZ`. All clients receive the UPDATE payload when any client writes.

2. **Edit the same row concurrently:** Postgres handles concurrent writes via its transaction system. The last committed write "wins" — but previous writes aren't lost; they're just superseded. You get the full audit trail via the WAL.

3. **The real challenge:** Two agents read the same row, both modify it, both write. The second write overwrites the first. This is an application-level problem, not a database problem.

**Solution for concurrent row editing:**
```javascript
// Optimistic concurrency with version column
const { data } = await supabase
  .from('templates')
  .select('*, version')
  .eq('id', templateId)
  .single()

// Agent modifies...
const { error } = await supabase
  .from('templates')
  .update({ data: newData, version: data.version + 1 })
  .eq('id', templateId)
  .eq('version', data.version) // ← This prevents overwrites

if (error?.code === 'P0002') {
  // No rows matched → someone else updated → re-fetch and retry
}
```

---

## 4. Netlify — What It Can & Can't Do

### 4.1 Serverless Functions

**What they are:** AWS Lambda under the hood. Request → Response. Stateless. Ephemeral.

**Free Tier (Credit-based):**
- 300 credits/month total
- Compute: 10 credits per GB-hour → ~30 GB-hours free equivalent
- Default memory: 1024 MB (1 GB)
- Max execution time: 10 seconds (synchronous), 15 minutes (background)
- Not WebSocket-capable — HTTP request/response only

**What they CAN do:**
- REST API endpoints for CRUD operations on templates
- Call Supabase (or any API) from the backend
- Process AI requests (call OpenAI, Claude, etc.)
- Image processing (sharp, etc.)

**What they CAN'T do:**
- **WebSocket connections** — serverless functions are ephemeral, no persistent connections
- **Server-Sent Events (SSE)** — execution time limits make long-lived connections impossible
- **Long-running AI workflows** — 10s sync timeout, 15min background max

### 4.2 Edge Functions

**What they are:** Deno runtime at the network edge. Even MORE constrained.

**Limits (All Plans):**
- CPU execution time per request: **50 milliseconds** (not a typo!)
- Response header timeout: 40 seconds
- Memory: 512 MB total across ALL deployed edge functions
- No WebSocket support
- No SSE support

**Edge Functions are for:**
- Auth checks
- A/B testing
- Geolocation-based content
- URL rewrites/redirects
- **NOT for AI processing or real-time communication**

### 4.3 What This Means for Design Harness

**Netlify CANNOT be the real-time transport layer.** You have two options:

#### Option A: Supabase Realtime Directly from Client (Recommended)
```
Browser/Agent → Supabase Realtime (WebSocket) → Postgres Changes
                    ↑
           Direct connection, no Netlify involved
```
- Supabase Realtime handles the WebSocket connections
- Netlify serves the static frontend (React/Vite app)
- Netlify Functions handle REST API calls (CRUD, AI generation triggers)
- No real-time dependency on Netlify at all

#### Option B: Separate WebSocket Service
```
Browser/Agent → Custom WebSocket Server (Railway, Fly.io, Render, etc.)
                    ↓
               Supabase Postgres
```
- Full control over WebSocket behavior
- Can implement custom concurrency logic
- More infrastructure to manage
- Higher cost

#### Option C: Polling (Fallback)
```
Browser → setInterval(poll supabase REST API, 500ms)
```
- Works everywhere, no WebSocket needed
- Higher latency, more requests
- Simple to implement
- Good for low-frequency updates (<2 updates/sec)

### 4.4 Netlify Free Tier Limits Summary

| Resource | Free Limit |
|----------|-----------|
| Credits/month | 300 |
| Bandwidth | 100 GB/month |
| Build minutes | 300 min/month |
| Serverless function execution | ~30 GB-hours (at 1GB default) |
| Edge function invocations | Included in credits |
| Concurrent builds | 1 |
| Team members | 1 |

**Translation for Design Harness:** 300 credits covers ~30 GB-hours of serverless compute. If each AI-assisted template generation takes 5 seconds and uses 1GB, that's ~21,600 generations/month. This is more than sufficient for MVP/scaling.

---

## 5. Multiple Agents → Same Template via REST API: Conflict Resolution

### 5.1 Scenario: The Core Problem

```
Time 0: Template "landing-page-123" = { bg: "white", title: "Hello" }

T=1s: Agent A reads template → decides to change bg to "black"
T=2s: Agent B reads template → decides to change title to "Welcome"
T=3s: Agent A writes: UPDATE templates SET data = { bg: "black", title: "Hello" }
T=4s: Agent B writes: UPDATE templates SET data = { bg: "white", title: "Welcome" }

Result: { bg: "white", title: "Welcome" }
Agent A's bg:"black" change is LOST!
```

### 5.2 Strategy 1: Field-Level Patching (Postgres JSONB)

Instead of replacing the entire `data` column, only update specific fields:

```sql
-- Agent A updates only background
UPDATE templates
SET data = jsonb_set(data, '{background}', '"#000000"')
WHERE id = 'landing-page-123';

-- Agent B updates only title (different field → no conflict!)
UPDATE templates
SET data = jsonb_set(data, '{title}', '"Welcome"')
WHERE id = 'landing-page-123';

-- Result: { bg: "#000000", title: "Welcome" }  ✅ Both changes preserved!
```

**Field-level update via Supabase RPC:**
```sql
CREATE OR REPLACE FUNCTION update_template_field(
  template_id UUID,
  field_path TEXT,
  field_value JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE templates
  SET data = jsonb_set(data, string_to_array(field_path, '.'), field_value),
      updated_at = NOW()
  WHERE id = template_id;
END;
$$ LANGUAGE plpgsql;
```

```javascript
// Agent A
await supabase.rpc('update_template_field', {
  template_id: 'abc',
  field_path: 'hero.background',
  field_value: '#000000'
})

// Agent B — different field, no conflict
await supabase.rpc('update_template_field', {
  template_id: 'abc',
  field_path: 'hero.title',
  field_value: 'Welcome'
})
```

**Limitation:** Two agents updating `hero.title` simultaneously still conflict. Need conflict detection at a finer granularity.

### 5.3 Strategy 2: CRDT via Yjs + Postgres Persistence

Use Yjs for in-memory conflict resolution, persist to Supabase:

```javascript
import * as Y from 'yjs'
import { createClient } from '@supabase/supabase-js'

// Each agent has its own Y.Doc
const ydoc = new Y.Doc()
const templateMap = ydoc.getMap('template')

// Load from Supabase (initial state)
const { data } = await supabase.from('templates').select('yjs_state').eq('id', 'abc').single()
if (data?.yjs_state) {
  Y.applyUpdate(ydoc, data.yjs_state) // binary Yjs update
}

// Agent modifies
templateMap.set('background', '#000000')

// Sync via Supabase Realtime Broadcast
const channel = supabase.channel('template-abc')
channel.on('broadcast', { event: 'yjs-update' }, ({ payload }) => {
  Y.applyUpdate(ydoc, new Uint8Array(payload))
})
channel.subscribe()

// When local changes happen, broadcast
ydoc.on('update', (update) => {
  channel.send({
    type: 'broadcast',
    event: 'yjs-update',
    payload: Array.from(update) // Convert Uint8Array for JSON transport
  })
})

// Periodically persist to Postgres
setInterval(async () => {
  const state = Y.encodeStateAsUpdate(ydoc)
  await supabase.from('templates').update({
    yjs_state: Array.from(state),
    updated_at: new Date()
  }).eq('id', 'abc')
}, 5000)
```

**This is the gold standard for multi-agent collaboration** but adds complexity:
- Need a `yjs_state` BYTEA column in Postgres
- Need to manage Yjs document lifecycle (GC, snapshots)
- Broadcast payload limit is 256KB on free tier (Yjs updates are usually small, but large template changes could approach this)

### 5.4 Strategy 3: Optimistic Locking with Retry

Classic approach. Add a `version` column. Retry on conflict.

```javascript
async function updateTemplateWithRetry(templateId, updateFn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Read with version
    const { data: template } = await supabase
      .from('templates')
      .select('data, version')
      .eq('id', templateId)
      .single()

    // Apply changes
    const newData = updateFn(template.data)

    // Write with version check
    const { error } = await supabase
      .from('templates')
      .update({
        data: newData,
        version: template.version + 1
      })
      .eq('id', templateId)
      .eq('version', template.version)

    if (!error) return { success: true, data: newData }

    // Conflict — someone else updated. Retry.
    console.log(`Conflict detected, retry ${attempt + 1}/${maxRetries}`)
    await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt))) // exponential backoff
  }
  return { success: false, error: 'Max retries exceeded' }
}
```

**Best for:** Low-concurrency scenarios (2-3 agents modifying the same template). Becomes problematic with high contention (many retries, wasted work).

### 5.5 Strategy 4: Agent Coordinator Model

Introduce a coordinator that serializes all writes to a specific template:

```javascript
// Coordinator agent (can be a Supabase Edge Function or a dedicated process)
async function coordinateTemplateUpdate(templateId, agentId, update) {
  // Acquire advisory lock (Postgres)
  const { data } = await supabase.rpc('acquire_template_lock', {
    p_template_id: templateId,
    p_agent_id: agentId,
    p_timeout_ms: 30000
  })

  if (!data) return { error: 'Template busy, try again later' }

  try {
    // Read latest state under lock
    const { data: template } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .single()

    // Apply update
    const result = await supabase
      .from('templates')
      .update({ data: update.data, updated_by: agentId })
      .eq('id', templateId)

    return { success: true, data: result }
  } finally {
    await supabase.rpc('release_template_lock', {
      p_template_id: templateId
    })
  }
}
```

```sql
-- Postgres advisory lock function
CREATE OR REPLACE FUNCTION acquire_template_lock(
  p_template_id UUID,
  p_agent_id TEXT,
  p_timeout_ms INTEGER DEFAULT 30000
) RETURNS BOOLEAN AS $$
DECLARE
  lock_id BIGINT;
BEGIN
  -- Convert UUID to a bigint for advisory lock
  lock_id := abs(hashtext(p_template_id::TEXT))::BIGINT;

  -- Try to acquire lock with timeout
  RETURN pg_try_advisory_xact_lock(lock_id);
END;
$$ LANGUAGE plpgsql;
```

**Best for:** When you need strong consistency and agents are fast. Not ideal if agents call LLMs (long wait times).

### 5.6 Strategy 5: Append-Only Event Log

Instead of updating state, append events. State is derived by replaying the event log.

```sql
CREATE TABLE template_events (
  id BIGSERIAL PRIMARY KEY,
  template_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'element.created', 'element.updated', 'element.deleted', etc.
  event_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent A creates a button
INSERT INTO template_events (template_id, agent_id, event_type, event_data)
VALUES ('abc', 'agent-alpha', 'element.created', '{"id":"btn-1","type":"button","label":"Click"}');

-- Agent B updates the button label (no conflict — different event!)
INSERT INTO template_events (template_id, agent_id, event_type, event_data)
VALUES ('abc', 'agent-beta', 'element.updated', '{"id":"btn-1","label":"Buy Now"}');

-- State is derived:
SELECT template_id, derive_state(template_id) FROM templates WHERE id = 'abc';
```

**Pros:**
- No conflicts on write (inserts are append-only, never conflict)
- Full audit trail
- Time-travel debugging
- Agents can write simultaneously

**Cons:**
- State derivation gets slow as events accumulate (need snapshots)
- Conflicting intent still possible (Agent A deletes btn-1, Agent B updates btn-1 — the update arrives after the delete)
- Complex to implement state derivation
- Higher storage costs
- Queries are complex (JSON event log aggregation)

---

## 6. Recommended Architecture for Futuraria Design MCP

### 6.1 Current State

- **14 MCP tools** for template management (create, read, update, delete, duplicate, etc.)
- **Fabric.js canvas** for WYSIWYG editing
- **Supabase** for persistence
- **Netlify** for frontend + serverless functions

### 6.2 Recommended Pattern: Field-Level Patching + Supabase Realtime

**Phase 1 (MVP — single agent, human review):**
No concurrency needed. Agent generates → human reviews → agent refines. Sequential, simple.

**Phase 2 (Multi-agent, different sections):**
Task decomposition with section-level locking:
- Section locks prevent agents from editing the same section
- Supabase Realtime Broadcast for live preview
- Field-level JSONB patching for safe updates

**Phase 3 (Full multi-agent collaboration):**
- Yjs CRDT for element-level real-time sync
- Supabase Realtime as transport (Broadcast for Yjs updates)
- Postgres persistence for Yjs document state
- Supabase Presence to show which agents are working on which sections
- Netlify Functions as REST API gateway (CRUD, AI trigger)

### 6.3 Free Tier Viability

| Component | Free Tier Limit | Design Harness Needs | Viable? |
|-----------|----------------|---------------------|---------|
| Supabase DB | 500 MB | ~50 MB template data | ✅ |
| Supabase Realtime connections | 200 | 5-10 users + 5 agents = 15 | ✅ |
| Supabase Realtime msg/s | 100 | <50 for deliberate edits | ✅ |
| Supabase Broadcast payload | 256 KB | Yjs updates <10KB typically | ✅ |
| Supabase Presence msg/s | 20 | Status updates only = ~5/s | ✅ |
| Netlify Credits | 300/month | ~30 GB-hours compute | ✅ |
| Netlify Bandwidth | 100 GB | Frontend + API traffic | ✅ |

**Bottom line: The free tier of Supabase + Netlify is MORE than sufficient for a multi-agent collaborative design tool at MVP/early scale.** The limiting factors will be:
- Supabase: 200 concurrent connections (fine for hundreds of users)
- Netlify: 300 credits/month (fine for moderate serverless usage)
- Database: 500 MB (fine for template data; store images in Supabase Storage)

---

## 7. Key Takeaways

1. **No existing AI design tool does true multi-agent concurrent editing.** They're all single-agent, sequential. Figma has real-time collaboration (OT) but no AI in the real-time loop. v0/Bolt/Cursor are single-agent sessions. This is a **greenfield** opportunity.

2. **CRDTs (Yjs) are the right technical foundation** for multi-agent canvas editing. They handle offline, network agnosticism, and automatic conflict resolution. Yjs specifically has the best performance and ecosystem.

3. **Supabase Realtime on free tier can fully support multi-agent collaboration** at prototype-to-early-production scale. The limits (200 connections, 100 msg/s) are generous for design tool usage patterns.

4. **Netlify cannot handle real-time connections** (no WebSocket, no SSE). Use it for REST API + static hosting. Real-time transport goes through Supabase Realtime directly from the client.

5. **Start with field-level patching + section locks** for Phase 1/2. Evolve to Yjs CRDTs for Phase 3. Don't prematurely optimize for CRDTs if agents are working on disjoint sections.

6. **The "agent coordinator" model** naturally fits the design workflow: decompose → dispatch → merge → review. This avoids most concurrency issues by design.

---

## References

- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime)
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase Realtime: Multiplayer Edition (GA Announcement)](https://supabase.com/blog/supabase-realtime-multiplayer-general-availability)
- [Yjs Documentation](https://docs.yjs.dev)
- [Automerge](https://automerge.org)
- [Netlify Functions Overview](https://docs.netlify.com/build/functions/overview)
- [Netlify Edge Functions Limits](https://docs.netlify.com/build/edge-functions/limits)
- [Netlify Pricing](https://www.netlify.com/pricing)
- [Operational Transformation (Wikipedia)](https://en.wikipedia.org/wiki/Operational_transformation)
- [v0 Docs](https://v0.app/docs)
- [Liveblocks + Yjs](https://liveblocks.io/yjs)
