# Playbook: Design System — Extract → Brand Manual

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    E1[E1: Objective<br/>templateIds + brandName]
    S1[S1: Source<br/>validate templates exist]
    V0{V0: Single or multi?}
    P1[P1: Plan<br/>single-template extraction]
    P2[P2: Plan<br/>merge extraction]
    D1[D1: get_design_system<br/>read tokens from template]
    D2a[D2a: get_design_system<br/>template 1]
    D2b[D2b: get_design_system<br/>template 2]
    D2n[D2n: get_design_system<br/>template N]
    A1[A1: generate_design_artifacts<br/>action=generate]
    A2[A2: extract_design_system<br/>merge all templates]
    V1{V1: Publish?}
    A3[A3: generate_design_artifacts<br/>action=publish + brandName]
    A4[A4: generate_brand_manual<br/>or use manual from extraction]
    V2{V2: Name + source valid?}
    A6[A6: Create new brand<br/>with source template]
    A5[A5: Update canonical brand<br/>preserve sourceTemplateIds]
    B1[B1: Blocked<br/>no partial write]
    A7[A7: Link template.brandId]
    A8[A8: generate_brand_manual<br/>from source template]
    V3{V3: Manual quality}
    A9[A9: Polish manual<br/>set_frame_layers updates]
    V4{V4: Brand validation}
    A10[A10: register_brand<br/>canonical colors+fonts]
    A11[A11: Fix inconsistencies<br/>css adjustments]
    A12[A12: generate_ui_components<br/>from extracted tokens]
    T1[T1: Terminal<br/>brand manual URL + tokens]
    PG[PG: Provenance graph<br/>template → extraction → manual]

    E1 --> S1
    S1 --> V0
    V0 -->|single| P1
    V0 -->|multi| P2
    P1 --> D1
    P2 --> D2a
    P2 --> D2b
    P2 --> D2n
    D1 --> A1
    D2a --> A2
    D2b --> A2
    D2n --> A2
    A1 --> V1
    A2 --> V1
    V1 -->|yes| A3
    V1 -->|no| A4
    A3 --> V2
    V2 -->|new exact name| A6
    V2 -->|exact-name recapture| A5
    V2 -->|fuzzy or invalid| B1
    A5 --> A7
    A6 --> A7
    A7 --> A8
    A4 --> A8
    A8 --> V3
    V3 -->|needs polish| A9
    V3 -->|ready| V4
    A9 --> V3
    V4 -->|pass| A10
    V4 -->|fail| A11
    A11 --> V4
    A10 --> A12
    A12 --> T1
    T1 --> PG

    %% @pos E1 40 40
    %% @pos S1 40 210
    %% @pos V0 40 380
    %% @pos P1 40 550
    %% @pos P2 277 550
    %% @pos D1 40 720
    %% @pos D2a 279 720
    %% @pos D2b 502 720
    %% @pos D2n 726 720
    %% @pos A1 40 890
    %% @pos A2 293 890
    %% @pos V1 40 1060
    %% @pos A3 40 1230
    %% @pos A4 296 1230
    %% @pos V2 40 1400
    %% @pos A6 40 1570
    %% @pos A5 250 1570
    %% @pos B1 495 1570
    %% @pos A7 40 1740
    %% @pos A8 40 1910
    %% @pos V3 40 2080
    %% @pos A9 40 2250
    %% @pos V4 270 2250
    %% @pos A10 40 2420
    %% @pos A11 256 2420
    %% @pos A12 40 2590
    %% @pos T1 40 2760
    %% @pos PG 40 2930
```
