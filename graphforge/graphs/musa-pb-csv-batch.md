# Playbook: CSV Batch → Variants

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    E1[E1: Objective<br/>CSV source + template]
    S1[S1: Source<br/>parse CSV → rows]
    P1[P1: Plan<br/>chunk size + concurrency]
    D1[D1: get_design_system<br/>read base template tokens]
    V1{V1: Template valid?}
    ER1[ER1: Fix template<br/>ensure engine=html]
    C1[C1: claim_section<br/>lock template for batch]
    F1[F1: Fan-out<br/>for each CSV row]
    FR1[FR1: create_html_frame<br/>row 1]
    FR2[FR2: create_html_frame<br/>row 2]
    FRN[FRN: create_html_frame<br/>row N]
    FL1[FL1: set_frame_layers<br/>variant 1]
    FL2[FL2: set_frame_layers<br/>variant 2]
    FLN[FLN: set_frame_layers<br/>variant N]
    VF1[VF1: lint_design<br/>variant 1]
    VF2[VF2: lint_design<br/>variant 2]
    VFN[VFN: lint_design<br/>variant N]
    G1{G1: Aggregate<br/>all scores >= 70?}
    R1[R1: Repair phase<br/>fix failing variants only]
    A1[A1: batch_render_html<br/>export all frames]
    C2[C2: release_section<br/>unlock template]
    T1[T1: Terminal<br/>batch report + HTML export]
    PG[PG: Provenance graph<br/>CSV row → frameId trace]

    E1 --> S1
    S1 --> P1
    P1 --> D1
    D1 --> V1
    V1 -->|no| ER1
    V1 -->|yes| C1
    ER1 --> D1
    C1 --> F1
    F1 --> FR1
    F1 --> FR2
    F1 --> FRN
    FR1 --> FL1
    FR2 --> FL2
    FRN --> FLN
    FL1 --> VF1
    FL2 --> VF2
    FLN --> VFN
    VF1 --> G1
    VF2 --> G1
    VFN --> G1
    G1 -->|fail| R1
    G1 -->|pass| A1
    R1 --> G1
    A1 --> C2
    C2 --> T1
    T1 --> PG

    %% @pos E1 40 40
    %% @pos S1 40 210
    %% @pos P1 40 380
    %% @pos D1 40 550
    %% @pos V1 40 720
    %% @pos ER1 40 890
    %% @pos C1 243 890
    %% @pos F1 40 1060
    %% @pos FR1 40 1230
    %% @pos FR2 259 1230
    %% @pos FRN 478 1230
    %% @pos FL1 40 1400
    %% @pos FL2 246 1400
    %% @pos FLN 452 1400
    %% @pos VF1 40 1570
    %% @pos VF2 216 1570
    %% @pos VFN 392 1570
    %% @pos G1 40 1740
    %% @pos R1 40 1910
    %% @pos A1 254 1910
    %% @pos C2 40 2080
    %% @pos T1 40 2250
    %% @pos PG 40 2420
```
