# Playbook: Create Design from Scratch

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    E1[E1: Objective<br/>user prompt + constraints]
    P1[P1: Plan<br/>which creation path?]
    D0[D0: import_design<br/>ONE call, auto-parses document]
    D1[D1: list_workspaces<br/>find workspace]
    V0{V0: Frame created?}
    T1[T1: Terminal<br/>report + URLs]
    A2[A2: list_templates<br/>check for brand match]
    V1{V1: Brand exists?}
    A3[A3: get_design_system<br/>read tokens]
    A4[A4: create_workspace<br/>if needed]
    A5[A5: create_html_frame<br/>empty frame, 1080x1080]
    A6[A6: create_html_frame<br/>empty frame, 1080x1080]
    A7[A7: set_frame_layers<br/>build from intent]
    V2{V2: Lint gate<br/>score >= 70?}
    A8[A8: Repair<br/>analyze issues → fix]
    A9[A9: export_design_tokens<br/>extract CSS vars]
    V3{V3: Multi-format needed?}
    P2[P2: Adaptation plan<br/>Stories, Posts, LinkedIn]
    F1[F1: create_html_frame<br/>1080x1920 Story]
    F2[F2: create_html_frame<br/>1080x1080 Post]
    F3[F3: create_html_frame<br/>1200x627 LinkedIn]
    D2[D2: get_design_system<br/>read tokens for adaptation]
    F4[F4: set_frame_layers<br/>adapt to Story]
    F5[F5: set_frame_layers<br/>adapt to Post]
    F6[F6: set_frame_layers<br/>adapt to LinkedIn]
    V4{V4: Format lint<br/>all pass?}
    A10[A10: Repair per format<br/>fix failing frames]
    PG[PG: Provenance graph<br/>traceability chain]

    E1 --> P1
    P1 -->|has complete HTML+CSS document| D0
    P1 -->|has reference or description| D1
    P1 -->|blank slate| D1
    D0 --> V0
    V0 -->|yes| T1
    V0 -->|no| D1
    D1 --> A2
    A2 --> V1
    V1 -->|yes| A3
    V1 -->|no| A4
    A3 --> A5
    A4 --> A6
    A5 --> A7
    A6 --> A7
    A7 --> V2
    V2 -->|fail| A8
    V2 -->|pass| A9
    A8 --> A7
    A9 --> V3
    V3 -->|yes| P2
    V3 -->|no| T1
    P2 --> F1
    P2 --> F2
    P2 --> F3
    F1 --> D2
    F2 --> D2
    F3 --> D2
    D2 --> F4
    D2 --> F5
    D2 --> F6
    F4 --> V4
    F5 --> V4
    F6 --> V4
    V4 -->|fail| A10
    V4 -->|pass| T1
    A10 --> V4
    T1 --> PG

    %% @pos E1 40 40
    %% @pos P1 40 210
    %% @pos D0 40 380
    %% @pos D1 40 720
    %% @pos V0 40 550
    %% @pos T1 40 3100
    %% @pos A2 40 890
    %% @pos V1 40 1060
    %% @pos A3 40 1230
    %% @pos A4 256 1230
    %% @pos A5 40 1400
    %% @pos A6 268 1400
    %% @pos A7 40 1570
    %% @pos V2 40 1740
    %% @pos A8 40 1910
    %% @pos A9 238 1910
    %% @pos V3 40 2080
    %% @pos P2 40 2250
    %% @pos F1 40 2420
    %% @pos F2 251 2420
    %% @pos F3 462 2420
    %% @pos D2 40 2590
    %% @pos F4 40 2760
    %% @pos F5 240 2760
    %% @pos F6 440 2760
    %% @pos V4 40 2930
    %% @pos A10 206 3100
    %% @pos PG 40 3270
```
