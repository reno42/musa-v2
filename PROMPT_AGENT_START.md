# 🚀 Futuraria MCP — Agent Starter Prompt

Copy this entire block and give it to any AI agent. It is self-contained, idempotent, and produces a knowledge graph + documentation every time.

---

```
You are an AI agent connecting to the Futuraria Design MCP for the first time.
Your goal is to discover, document, and graph the entire MCP tool ecosystem.

## Connection

Endpoint: https://design.futuraria.com/mcp
Protocol: JSON-RPC 2.0 over SSE + HTTP POST
Auth: tools/call requires x-api-key header. get_agent_guide and get_playbook are public (no auth).

## Phase 1 — Discover (no auth needed)

1. Send `initialize` request. Read `_agentGuide` from the response — it contains the playbook index, auth instructions, docs URLs, and memory instructions.

2. Call `get_agent_guide` (tools/call with method get_agent_guide, no auth required). This returns the full onboarding guide with playbook index, key tools quick reference, memory instructions, and docs URLs.

3. Call `tools/list` to see ALL available tools with their input schemas. Count them. Group them by category (read each tool's description to infer categories like: Template CRUD, Frame Management, HTML/CSS Editing, Design System, Brand, Batch, Rendering, AI Generation, Fonts, Icons, Versioning, Collaboration, Assets, Export).

## Phase 2 — Learn the Playbooks (no auth needed)

4. Call `get_playbook` for EACH of these five playbooks (one at a time):
   - "replicate-html"
   - "create-from-scratch"
   - "csv-batch"
   - "design-system"
   - "multi-agent"

   For each playbook, extract:
   - The intent it solves
   - The DAG of tool calls (which tools does it call, in what order)
   - The validation gates (which tools verify correctness)
   - The error recovery paths

## Phase 3 — Build the Knowledge Graph

5. Produce a Mermaid graph with this structure:

   ```mermaid
   graph TB
     subgraph EntryPoints["🚪 Entry Points"]
       initialize["initialize (public)"]
       get_agent_guide["get_agent_guide (public)"]
       get_playbook["get_playbook (public)"]
     end

     subgraph Auth["🔐 Auth Required"]
       tools_call["tools/call (x-api-key)"]
     end

     subgraph Playbooks["📖 Playbooks"]
       replicate["replicate-html"]
       from_scratch["create-from-scratch"]
       csv_batch["csv-batch"]
       design_system["design-system"]
       multi_agent["multi-agent"]
     end

     subgraph Core["🏗️ Core Tools"]
       create_template["create_template"]
       create_html_frame["create_html_frame"]
       set_frame_layers["set_frame_layers"]
       set_html["set_html"]
       set_css["set_css"]
       lint_design["lint_design"]
     end

     subgraph DesignSystem["🎨 Design System"]
       get_design_system["get_design_system"]
       get_design_artifacts["get_design_artifacts"]
       extract_design_system["extract_design_system"]
       generate_brand_manual["generate_brand_manual"]
       register_brand["register_brand"]
       validate_brand["validate_brand"]
     end

     subgraph Batch["📦 Batch"]
       batch_render_html["batch_render_html"]
       generate_csv_template["generate_csv_template"]
       claim_section["claim_section"]
       release_section["release_section"]
     end

     subgraph Versioning["🕐 Versioning"]
       save_version["save_version"]
       list_versions["list_versions"]
       diff_versions["diff_versions"]
       restore_version["restore_version"]
     end

     subgraph Export["📤 Export"]
       export_frame["export_frame"]
       export_template["export_template"]
       export_pdf["export_pdf"]
       render_html_template["render_html_template"]
       adapt_format["adapt_format"]
       adapt_all_formats["adapt_all_formats"]
     end

     subgraph Collaboration["🤝 Collaboration"]
       claim_section
       release_section
       broadcast_section_change["broadcast_section_change"]
       subscribe_template["subscribe_template"]
       assemble_template["assemble_template"]
     end

     subgraph Utilities["🧰 Utilities"]
       color_picker["color_picker"]
       suggest_color_palette["suggest_color_palette"]
       search_icons["search_icons"]
       insert_icon["insert_icon"]
       add_font_to_template["add_font_to_template"]
       get_font_details["get_font_details"]
       search_stock_image["search_stock_image"]
       optimize_image["optimize_image"]
     end

     initialize --> get_agent_guide
     get_agent_guide --> get_playbook
     get_playbook --> Playbooks

     Playbooks --> Core
     Core --> DesignSystem
     Core --> Batch
     Core --> Versioning
     Core --> Export
     Batch --> Collaboration
     Core --> Utilities

     lint_design -->|validates| Core
     validate_brand -->|validates| DesignSystem
     diff_versions -->|validates| Versioning
   ```

   Expand this with ALL tools discovered in tools/list. Every tool should appear in the graph. Connect tools that call each other (infer from descriptions and playbook DAGs).

## Phase 4 — Document

6. Write a summary document with:
   - Total tool count by category
   - Public vs auth-gated tools
   - Playbook-to-tool mapping (which playbook uses which tools)
   - Common pitfalls (parameter name mismatches, auth requirements, engine requirements)
   - The auth reality: initialize + tools/list are public, get_agent_guide + get_playbook are public, everything else needs x-api-key

## Rules

- If you get a 401 on tools/call: stop and tell me. You need an API key. I will provide it.
- If a tool returns {} or an error: document it but keep going. Don't get stuck.
- After Phase 3: show me the Mermaid graph. I will review it.
- After Phase 4: save your documentation so I can reuse it.

## Memory Instructions

After this session, store in your persistent memory:
- The MCP endpoint URL
- The workspace IDs and template IDs you discover
- The playbook index and which playbook to use for each intent
- Which tools are public vs auth-gated
- The knowledge graph you built
```
