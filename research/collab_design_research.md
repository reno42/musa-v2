# Collaborative Design & Real-Time Multi-User Editing — Research

> **Date:** 2026-06-18  
> **Context:** Research for Futuraria's design-main — HTML/CSS template editor with multi-agent simultaneous editing capability.

---

## 1. Figma: How Real-Time Collaboration Works

### Architecture Overview

```
┌──────────┐   WebSocket   ┌──────────────┐   Per-Document   ┌──────────┐
│ Browser  │◄─────────────►│ Server Cluster│◄───────────────►│  Process │
│ (WASM)   │               │  (Rust)       │                 │  (Rust)  │
└──────────┘               └──────────────┘                 └──────────┘
```

### Key Technical Details

| Aspect | Implementation |
|--------|---------------|
| **Rendering** | WebGL canvas via WASM (C++ compiled to WebAssembly) |
| **Sync Algorithm** | Custom CRDT-like system (rejected OT as "too complex for design tools") |
| **Transport** | WebSocket connection to dedicated Rust backend |
| **Server Model** | One process per multiplayer document |
| **Offline** | Full offline editing → reconnect downloads fresh copy → reapplies offline edits |
| **Conflict Resolution** | Last-write-wins with fractional indexing for property ordering |
| **Non-multiplayer data** | Comments, users, teams → stored in Postgres, synced separately |

### Why Figma Didn't Use OT (Operational Transformation)

Figma explicitly rejected OT (used by Google Docs) because:
- OT requires modeling every possible operation combination → **combinatorial explosion**
- OT proofs are "very complicated and error-prone"
- Figma is NOT a text editor → don't need character-level operation transforms
- A simpler system = easier to implement, debug, test, and maintain

### Their Custom Approach

Instead of OT, Figma uses a **tree-based CRDT** approach:
- Each object in the document is a node in a tree
- Properties are key-value pairs on nodes
- Changes are atomic operations on this tree
- Fractional indexing for ordered lists (no need to shift indices)
- Server is authoritative but clients can optimistically apply changes

### Infrastructure Requirements

- **Dedicated server infrastructure required** (Rust backend)
- Per-document processes → scaling requires orchestration
- NOT feasible for a no/low-infra startup without significant investment

---

## 2. Paper.design: Agent + Human Co-Editing

### How Paper Works

Paper uses a fundamentally different approach than Figma:

| Aspect | Paper.design |
|--------|-------------|
| **Rendering** | HTML/CSS in the browser (not canvas/WebGL) |
| **Agent Integration** | MCP (Model Context Protocol) based tools |
| **Collaboration Model** | Single-user canvas — NOT multi-agent simultaneous |
| **Agent Role** | Agent acts as a "co-pilot" that can read/write elements via tool calls |
| **Sync Model** | Sequential — human and agent take turns, not simultaneous |

### Key Insight for Our Use Case

Paper's model is **sequential co-editing**, not truly concurrent:
- Human makes changes → agent observes → agent proposes changes
- Agent makes changes → human reviews → human accepts/rejects
- This avoids the complexity of CRDT/OT entirely

### What We Can Learn

- **HTML/CSS rendering in browser** is a valid approach for design tools
- **MCP-based agent tools** give agents structured access to the DOM
- **Sequential editing** simplifies the problem dramatically
- But for our use case (multiple agents simultaneously), we need more

---

## 3. Real-Time Collaboration Libraries & Services

### Comparison Matrix

| Solution | Type | Algorithm | Free Tier | Self-Hosted? | Best For |
|----------|------|-----------|-----------|-------------|----------|
| **Yjs** | Library | CRDT | Open source (MIT) | Yes | Maximum flexibility, any transport |
| **Yjs + y-websocket** | Library + Server | CRDT + WS | Open source | Yes (Node.js server) | Full control, own infra |
| **Yjs + y-webrtc** | Library | CRDT + P2P | Open source | No server needed* | Small groups, demos, P2P |
| **PartyKit** | Platform | Any (Yjs, Automerge, etc.) | Free: 5K connections, 25GB/mo | No (Cloudflare) | Serverless real-time, Cloudflare edge |
| **Liveblocks** | Platform | Proprietary + Yjs compat | Free: 1K MAU, 3K collab minutes | No | Turnkey collab + AI copilots |
| **Supabase Realtime** | Platform | Broadcast + Presence + PG CDC | Free: 200 conns, 100 msg/s | Yes (self-host option) | Already using Supabase |
| **Firebase RTDB** | Platform | Proprietary JSON sync | Free: 100 simultaneous, 1GB stored | No | Quick JSON sync, Google ecosystem |
| **Automerge** | Library | CRDT | Open source (MIT) | Yes | JSON-like document CRDT |

### Detailed Breakdown

#### Yjs (Open Source CRDT Library)

```
npm install yjs
```

**What it is:** A high-performance CRDT implementation for building collaborative apps.

**How it works:**
- `Y.Doc` → shared document container
- `Y.Map`, `Y.Array`, `Y.Text`, `Y.XmlFragment` → shared data types
- Changes automatically merge without conflicts
- Network-agnostic: you bring your own transport

**Editor bindings available:**
- Monaco Editor, CodeMirror, ProseMirror, Tiptap, Quill, Remirror

**Connection providers:**
- `y-websocket` → Classic client/server over WebSocket
- `y-webrtc` → P2P via WebRTC (no server, but unreliable for >20 peers)
- `@y/websocket-server` → Simple Node.js backend (forkable)
- `y-redis` → Scalable Redis-backed backend
- Custom providers possible

**Pricing:** Free (MIT license). You only pay for hosting the sync server.

#### y-websocket (Server-Side)

```
npm install @y/websocket-server
HOST=localhost PORT=1234 npx y-websocket
```

**Features:**
- Cross-tab communication (BroadcastChannel + localStorage fallback)
- Awareness protocol (cursor positions, user presence)
- Simple in-memory backend, can persist to databases
- For scale: `@y/hub` or `y-redis` backends

**Server options:**
- `@y/websocket-server` — simplest, forkable, in-memory
- `Hocuspocus` — popular community alternative
- `y-sweet` (Jamsocket) — managed service
- `y-redis` — scalable with Redis
- `ypy-websocket` / `pycrdt-websocket` — Python backends

**Cost to host:** ~$5/mo on Railway for a simple Node.js server

#### y-webrtc (P2P, No Server)

```
npm install y-webrtc
```

**Features:**
- P2P via WebRTC, public signaling servers available
- Encrypted communication
- Max ~20-35 peers per document (browser connection limits)

**⚠️ Not suitable for agents:**
- Each peer must connect to every other peer
- Agents are server processes, not browsers — WebRTC not natural for them
- Unreliable for production multi-agent use

#### PartyKit (Cloudflare Edge Real-Time)

```js
export default class Server {
  onMessage(message, websocket) {
    websocket.send("pong");
  }
}
```

**Features:**
- Serverless WebSocket at Cloudflare edge
- Works with Yjs, Automerge, Replicache, XState, tldraw
- Durable Objects for stateful real-time
- Web standards: WebSocket, Fetch, Request-Response

**Pricing (PartyKit):**
- Free tier: 5,000 connections, 25 GB/month
- Paid: usage-based

**Note:** PartyKit was acquired by Cloudflare. Current pricing may have changed. Check cloudflare.com for latest.

#### Liveblocks (Purpose-Built Collaborative Infrastructure)

**Features:**
- Purpose-built for collaborative apps + AI
- AI Copilots: contextual chat, AI toolbars that modify app state
- AI Collaboration: agents as room participants
- Built-in: Presence, Comments, Notifications, Storage
- Yjs compatibility via `@liveblocks/yjs`
- React, Zustand, Redux bindings

**Pricing:**
| Plan | Price | Limits |
|------|-------|--------|
| Free | $0/mo | 3,000 collab minutes, 200 comments, branding required |
| Pro | $30/mo ($25 annual) | $30 credits, PAYG overage |
| Team | From $600/mo | SSO, SOC 2, private Slack |

**Relevant for us:**
- AI Copilots feature explicitly supports agents in rooms
- `@liveblocks/yjs` — can use Yjs data structures on Liveblocks infra
- The "AI Collaboration" feature lets agents be room participants

#### Supabase Realtime

**Features:**
- **Broadcast:** Low-latency messages between clients via WebSocket
- **Presence:** Track/sync user state (online, cursors, etc.)
- **Postgres Changes:** Listen to DB changes in real-time (CDC)

**Pricing (Realtime limits):**
| Limit | Free | Pro | Pro (no cap) |
|-------|------|-----|-------------|
| Concurrent connections | 200 | 500 | 10,000 |
| Messages/sec | 100 | 500 | 2,500 |
| Channel joins/sec | 100 | 500 | 2,500 |
| Broadcast payload | 256 KB | 3 MB | 3 MB |

**Key advantage:** You're already using Supabase. Zero additional infrastructure.

**Broadcast pattern:**
```js
const channel = supabase.channel('design-room-123')
channel.on('broadcast', { event: 'code-update' }, (payload) => {
  applyChange(payload)
}).subscribe()

// Send update
channel.send({
  type: 'broadcast',
  event: 'code-update',
  payload: { html: '...', css: '...', agent: 'lara' }
})
```

**Limitation:** No built-in CRDT merge. You handle conflict resolution yourself.

#### Firebase Realtime Database

**Features:**
- Cloud-hosted JSON database, synced in real-time
- Offline persistence built-in
- Client-side SDK (no server needed)
- Security rules for access control

**Pricing:**
| Limit | Free (Spark) |
|-------|-------------|
| Simultaneous connections | 100 |
| Data stored | 1 GB |
| Downloads | 10 GB/mo |

**Limitation:** 100 simultaneous connections on free tier is tight for multi-agent + human users.

---

## 4. For Our Specific Use Case: HTML/CSS Templates + Multi-Agent Editing

### Problem Statement

Multiple AI agents simultaneously editing HTML/CSS code in a shared template, with:
- Each agent working on a different section/component
- No conflicts where possible (segmented editing)
- Real-time preview updates
- Human can observe and intervene

### Approach 1: Segmented Editing (Simplest — Recommended for MVP)

```
┌─────────────────────────────────────────┐
│  Template                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Header  │ │  Hero   │ │ Footer  │   │
│  │ Agent A │ │ Agent B │ │ Agent C │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘
         │           │           │
         ▼           ▼           ▼
    Supabase Broadcast Channel "design-123"
         │           │           │
         ▼           ▼           ▼
      Preview iframe (re-renders on change)
```

**How it works:**
1. Template is divided into named sections/components
2. Each agent "claims" a section via Presence
3. Agent edits only its section's HTML/CSS
4. Changes broadcast via Supabase channel
5. Preview iframe rebuilds from all sections

**Conflict avoidance:** No merge needed — sections don't overlap

**Pros:**
- Zero CRDT complexity
- Uses existing Supabase infra (free tier sufficient)
- Agents work truly in parallel
- Simple to implement and debug

**Cons:**
- Agents can't edit the same element
- Section boundaries must be predefined
- CSS specificity conflicts possible if agents write global styles

### Approach 2: CRDT Merge (More Flexible)

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Agent A  │  │ Agent B  │  │ Agent C  │
│ Y.Doc    │  │ Y.Doc    │  │ Y.Doc    │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
          ┌─────────▼─────────┐
          │  Yjs Sync Server  │  (Railway $5/mo or PartyKit free)
          │  (y-websocket)   │
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────┐
          │  Preview Client   │
          │  (Y.Doc → HTML)   │
          └───────────────────┘
```

**How it works:**
1. Entire HTML/CSS stored as Y.Text or Y.Map in a Y.Doc
2. All agents share the same Y.Doc via WebSocket
3. Yjs handles automatic conflict-free merging
4. Preview client renders Y.Doc → iframe

**Pros:**
- Full flexibility — agents can edit anything
- Automatic conflict resolution
- Proven technology (Yjs is battle-tested)
- Editor bindings exist (CodeMirror, Monaco)

**Cons:**
- Requires sync server ($5/mo Railway or similar)
- More complex to set up
- Agents editing same line simultaneously → CRDT merges may produce unexpected results

### Approach 3: Sequential with Locking (Hybrid)

```
┌──────────────────────────────────────────┐
│              Orchestrator                 │
│  ┌──────────────────────────────────┐    │
│  │ Lock Manager (Supabase Presence)  │    │
│  │  - Section A: Locked by Agent 1   │    │
│  │  - Section B: Locked by Agent 2   │    │
│  │  - Section C: Free                │    │
│  └──────────────────────────────────┘    │
│                    │                      │
│  ┌─────────────────▼────────────────┐    │
│  │ Template State (Supabase DB)      │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

**How it works:**
1. Lock system via Supabase Presence
2. Agent acquires lock → edits → releases lock
3. After release, broadcast update to all
4. Non-overlapping sections = no locks needed
5. Shared sections = lock required

**Pros:**
- No CRDT complexity
- No dedicated server needed (just Supabase)
- Predictable, debuggable
- Agents can dynamically negotiate sections

**Cons:**
- Lock contention if agents want same section
- Not truly "simultaneous" for shared sections
- Lock timeout/abandonment edge cases

### Cost Comparison for Each Approach

| Approach | Infrastructure | Monthly Cost | Complexity |
|----------|---------------|-------------|------------|
| Segmented Editing | Supabase Free | $0 | Low |
| CRDT Merge (Yjs + Railway) | Railway + Supabase | ~$5 | Medium |
| CRDT Merge (Yjs + PartyKit) | PartyKit Free + Supabase | $0* | Medium |
| Sequential Locking | Supabase Free | $0 | Medium |
| Liveblocks | Liveblocks Free tier | $0 | Low-Medium |
| Firebase RTDB | Firebase Free | $0 (100 conn limit) | Low |

*\*PartyKit free tier may have changed post-Cloudflare acquisition*

### Recommended Path

**For MVP:** **Segmented Editing** with Supabase Realtime Broadcast
- Fastest to build
- Uses existing infrastructure (Supabase)
- Zero cost
- Can evolve to CRDT later if needed

**For V2:** Add **Yjs + y-websocket** for sections that need shared editing
- Only add CRDT where segmentation isn't enough
- Gradual complexity increase
- Can run y-websocket server on Railway ($5/mo)

---

## 5. CodePen / CodeSandbox / StackBlitz: Live Preview + Code Editing

### Common Architecture Pattern

All three follow the same fundamental pattern:

```
┌──────────────────┐     postMessage     ┌──────────────────┐
│   Editor Panel   │──────────────────►│  Preview iframe   │
│  (Monaco/CM)     │                    │  (sandbox)        │
│                  │◄──────────────────│                   │
│  HTML | CSS | JS │    errors/events   │  Rendered output  │
└──────────────────┘                    └──────────────────┘
```

### How Each Tool Works

#### CodePen
- **Editor:** Custom CodeMirror-based editors for HTML/CSS/JS
- **Preview:** `<iframe>` with `sandbox` attribute for security
- **Update mechanism:** Debounced `postMessage` from editor → iframe rebuilds content
- **Live reload:** On each keystroke (debounced ~500ms), iframe `srcdoc` is updated
- **No collaboration** (single-user model)
- **Backend:** Minimal — pens are saved as static HTML/CSS/JS blobs

#### CodeSandbox
- **Editor:** Monaco Editor (VS Code in the browser)
- **Preview:** iframe sandbox with live dev server
- **Update mechanism:** File changes → in-browser bundler (esbuild) → HMR → iframe
- **Collaboration:** Yes — uses OT (Operational Transformation) for code, similar to Google Docs
- **Backend:** Node.js servers for advanced features; core runs in browser
- **Key tech:** Runs bundlers/transpilers in-browser via web workers

#### StackBlitz
- **Editor:** Monaco Editor
- **Preview:** WebContainers (full Node.js runtime in browser via WASM)
- **Update mechanism:** File changes → in-browser Node.js → dev server → iframe
- **Collaboration:** Yes, similar OT-based approach
- **Backend:** Almost everything runs in browser (WebContainers = browser-based Node.js)
- **Key tech:** WebContainers run npm, Node.js, Vite, etc. entirely in-browser

### Key Technical Insights for Our Editor

1. **iframe sandbox + srcdoc is the standard pattern**
   ```html
   <iframe
     sandbox="allow-scripts"
     srcdoc="<html>...compiled output...</html>"
   ></iframe>
   ```
   - `sandbox` attribute prevents iframe from accessing parent
   - `srcdoc` allows inline HTML without a separate URL
   - Updates are instant — just set `iframe.srcdoc = newHtml`

2. **postMessage for communication**
   - Parent → iframe: send code updates
   - iframe → Parent: send errors, console logs, click events
   - Secure, cross-origin safe

3. **Debounced updates prevent jank**
   - Don't re-render on every keystroke
   - 300-500ms debounce is standard

4. **Code mirroring in editor**
   - CodeMirror 6 or Monaco Editor for syntax highlighting
   - Monaco = VS Code experience (heavier, ~2MB)
   - CodeMirror 6 = lighter, extensible, ~200KB

### Our HTML/CSS Preview Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser Tab                                         │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │  Code Editor      │  │  Live Preview iframe    │  │
│  │  (CodeMirror 6)   │  │                         │  │
│  │                   │  │  ┌───────────────────┐  │  │
│  │  HTML ┌─────────┐ │  │  │  Rendered Output  │  │  │
│  │       │ <div>...│ │  │  │                   │  │  │
│  │       └─────────┘ │  │  │  Tailwind CDN     │  │  │
│  │                   │  │  │  Custom CSS       │  │  │
│  │  CSS  ┌─────────┐ │  │  │                   │  │  │
│  │       │ .hero{..│ │  │  └───────────────────┘  │  │
│  │       └─────────┘ │  │                         │  │
│  └──────────────────┘  └─────────────────────────┘  │
│           │                        ▲                 │
│           │    postMessage         │                 │
│           └────────────────────────┘                 │
│                    (debounced 300ms)                 │
└─────────────────────────────────────────────────────┘
```

---

## 6. Summary & Recommendations

### Technology Stack Recommendation

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Editor** | CodeMirror 6 | Light, extensible, good HTML/CSS support |
| **Preview** | iframe sandbox + srcdoc | Standard pattern, instant updates |
| **Agent Sync (MVP)** | Supabase Realtime Broadcast | Already using Supabase, free, simple |
| **Agent Sync (V2)** | Yjs + y-websocket on Railway | CRDT merge when needed, $5/mo |
| **Section Locking** | Supabase Presence | Free, built into Realtime |
| **Persistence** | Supabase PostgreSQL | Already in use |
| **Styling** | Tailwind CSS CDN in iframe | No build step, widely understood by agents |

### Architecture Decision: Start with Segmented Editing

**Phase 1 (MVP — Now):**
- Template = collection of named component slots
- Each agent claims a slot, edits independently
- Supabase Broadcast for sync
- Supabase Presence for slot locking
- iframe preview with srcdoc

**Phase 2 (When Needed):**
- Add Yjs + y-websocket for shared component editing
- Agents can co-edit the same section with CRDT merging
- Migration path: sections that need multi-agent → Y.Text instead of plain string

**Phase 3 (Scale):**
- Consider Liveblocks if collaboration features (cursors, comments, AI copilots) become needed
- Or scale y-websocket with Redis backend

### Key Risks Mitigated

1. **Complexity:** Segmented editing avoids CRDT entirely for MVP
2. **Cost:** $0 infrastructure for MVP (using existing Supabase)
3. **Vendor lock-in:** Yjs is open source; can always self-host
4. **Agent conflicts:** Section locking prevents overwrites
5. **CSS conflicts:** Scoped CSS per component via naming conventions or CSS modules pattern

### What NOT to Build

- ❌ Custom CRDT implementation (use Yjs if needed)
- ❌ WebGL canvas-based editor (Figma's approach is overkill for HTML/CSS)
- ❌ Custom WebSocket server from scratch (use y-websocket or Supabase)
- ❌ Real-time cursor syncing for agents (not needed for MVP)
- ❌ OT-based editing (too complex, CRDT is simpler for our case)

---

## References

- [Figma: How multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Figma: Rust in production](https://www.figma.com/blog/rust-in-production-at-figma/)
- [Yjs Documentation](https://docs.yjs.dev/)
- [y-websocket GitHub](https://github.com/yjs/y-websocket)
- [y-webrtc GitHub](https://github.com/yjs/y-webrtc)
- [PartyKit](https://www.partykit.io/)
- [Liveblocks Documentation](https://liveblocks.io/docs)
- [Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Firebase Realtime Database](https://firebase.google.com/docs/database)
- [StackBlitz WebContainers](https://webcontainers.io/)
