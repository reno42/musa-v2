# Playbook: Content Calendar — Propose → Approve → Design → Attach

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    C1[C1: Context<br/>list_workspaces → list_copy_recipes]
    C2[C2: Read calendar<br/>list_calendar_entries]
    P1[P1: Draft proposal<br/>topics × dates × recipes]
    P2[P2: Insert ideas<br/>add_content_idea ×N · status: idea]
    G1{G1: HUMAN GATE<br/>user reviews in the UI<br/>drag and drop · sheet · copys}
    P3[P3: Adjust<br/>update_content / delete_content]
    S1[S1: Reference style<br/>get_design_system]
    D1[D1: Design per piece<br/>create_template + import_design]
    D2{D2: Lint gate<br/>lint_design score ≥ 80}
    A1[A1: Attach<br/>update_content templateId]
    A2[A2: Verify batch<br/>list_calendar_entries]
    T[T: Terminal<br/>report + links]

    C1 --> C2
    C2 --> P1
    P1 --> P2
    P2 --> G1
    G1 -->|changes requested| P3
    P3 --> G1
    G1 -->|approved| S1
    S1 --> D1
    D1 --> D2
    D2 -->|issues| D1
    D2 -->|pass| A1
    A1 --> A2
    A2 --> T

    %% @pos C1 40 40
    %% @pos C2 40 210
    %% @pos P1 40 380
    %% @pos P2 40 550
    %% @pos G1 40 720
    %% @pos P3 40 890
    %% @pos S1 313 890
    %% @pos D1 40 1060
    %% @pos D2 40 1230
    %% @pos A1 40 1400
    %% @pos A2 40 1570
    %% @pos T 40 1740
```
