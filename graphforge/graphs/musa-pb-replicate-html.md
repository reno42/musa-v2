# Playbook: Replicate HTML+CSS → Frame → Multi-Format

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    subgraph ENTRY["Entry · receive objective"]
        E1[entry: receive_objective<br/>user provides HTML+CSS + template name hint]
    end
    subgraph DISCOVERY["Phase 1 · discovery"]
        D1{decision: auth_valid?}
        A1[action: ask_user_for_key]
        A2[action: list_workspaces<br/>tool: list_workspaces]
        V1{validate: workspaces > 0?}
        A3[action: create_workspace<br/>tool: create_workspace]
        A4[action: create_template<br/>tool: create_template{engine:'html'}]
        A5[action: create_html_frame + set_html/set_css]
        A6[action: list_templates<br/>tool: list_templates{workspaceId, search}]
        D2{decision: template found?}
        A7[action: ask_user_choose<br/>present top 5 matches by updatedAt]
        A8[action: get_template<br/>tool: get_template{templateId}]
    end
    subgraph FRAME["Phase 2 · frame creation"]
        A9[action: import_design<br/>tool: import_design{templateId, document}]
        V3{validate: frame has html + css?}
        A14[loop: retry import_design<br/>max_retries=2]
        A15[action: get_template<br/>verify frame position non-overlapping]
    end
    subgraph ADAPT["Phase 3 · format adaptation"]
        P3[phase: adapt_formats]
        D3{decision: which formats?}
        F1[action: adapt_format<br/>tool: adapt_format{targetFormat:{name:'story',w:1080,h:1920}}]
        F2[action: adapt_format<br/>tool: adapt_format{targetFormat:{name:'post',w:1080,h:1080}}]
        F3[action: adapt_format<br/>tool: adapt_format{targetFormat:{name:'linkedin',w:1200,h:627}}]
        F4[action: adapt_all_formats<br/>tool: adapt_all_formats{formats:[story,post,linkedin]}]
        F5[action: set_html + set_css<br/>on each adaptation template]
        V4{validate: all adaptations have html?}
        A16[loop: retry per-format<br/>max_retries=2 each]
        T1[terminal: report_results<br/>return all templateIds + editorUrls]
    end

    E1 --> D1
    D1 -->|no key| A1
    A1 --> D1
    D1 -->|yes| A2
    A2 --> V1
    V1 -->|no| A3
    A3 --> A4
    A4 --> A5
    A5 --> P3
    V1 -->|yes| A6
    A6 --> D2
    D2 -->|no| A3
    D2 -->|multiple matches| A7
    A7 --> A8
    D2 -->|exact match| A8
    A8 --> A9
    A9 --> V3
    V3 -->|no| A14
    A14 --> V3
    V3 -->|yes| A15
    A15 --> D3
    D3 -->|story| F1
    D3 -->|post| F2
    D3 -->|linkedin| F3
    D3 -->|all| F4
    F1 --> F5
    F2 --> F5
    F3 --> F5
    F4 --> F5
    F5 --> V4
    V4 -->|no| A16
    A16 --> V4
    V4 -->|yes| T1

    %% @pos E1 40 40
    %% @pos D1 40 210
    %% @pos A1 40 380
    %% @pos A2 263 380
    %% @pos V1 40 550
    %% @pos A3 40 1060
    %% @pos A4 40 1230
    %% @pos A5 40 1400
    %% @pos A6 40 720
    %% @pos D2 40 890
    %% @pos A7 269 1060
    %% @pos A8 329 1230
    %% @pos A9 382 1400
    %% @pos V3 249 1570
    %% @pos A14 40 1740
    %% @pos A15 271 1740
    %% @pos P3 40 1570
    %% @pos D3 40 1910
    %% @pos F1 40 2080
    %% @pos F2 479 2080
    %% @pos F3 915 2080
    %% @pos F4 1364 2080
    %% @pos F5 40 2250
    %% @pos V4 40 2420
    %% @pos A16 40 2590
    %% @pos T1 252 2590
```
