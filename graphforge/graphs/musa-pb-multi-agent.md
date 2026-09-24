# Playbook: Multi-Agent Collaborative Edit

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    E1[E1: Objective<br/>template + agents + sections]
    P1[P1: Plan<br/>assign agents to sections]
    S1[S1: Snapshot<br/>capture pre-edit state]
    S2[S2: subscribe_template<br/>realtime channel open]
    OR1[OR1: Orchestrator<br/>dispatch claims]
    C1[C1: claim_section<br/>Agent A → Frame 1]
    C2[C2: claim_section<br/>Agent B → Frame 2]
    C3[C3: claim_section<br/>Agent C → Frame 3]
    E1A[E1A: Agent A edit<br/>set_frame_layers]
    E1B[E1B: Agent B edit<br/>set_html / set_css]
    E1C[E1C: Agent C edit<br/>set_frame_layers]
    W1[W1: Wait + retry<br/>backoff 2s]
    V1A[V1A: lint_design<br/>Agent A frame]
    V1B[V1B: lint_design<br/>Agent B frame]
    V1C[V1C: lint_design<br/>Agent C frame]
    B1A[B1A: broadcast_section_change<br/>notify peers]
    B1B[B1B: broadcast_section_change<br/>notify peers]
    B1C[B1C: broadcast_section_change<br/>notify peers]
    R1A[R1A: release_section<br/>Agent A]
    R1B[R1B: release_section<br/>Agent B]
    R1C[R1C: release_section<br/>Agent C]
    G1{G1: All sections<br/>validated + released?}
    A1[A1: assemble_template<br/>merge all sections]
    W2[W2: Force-release<br/>expired claims]
    VF{VF: Final lint<br/>assembled template}
    RF[RF: Repair<br/>fix assembly conflicts]
    A2[A2: unsubscribe_template<br/>close channel]
    T1[T1: Terminal<br/>collaboration report]
    PG[PG: Provenance graph<br/>agent → claim → edit → assembly]

    E1 --> P1
    P1 --> S1
    S1 --> S2
    S2 --> OR1
    OR1 --> C1
    OR1 --> C2
    OR1 --> C3
    C1 -->|acquired| E1A
    C2 -->|acquired| E1B
    C3 -->|acquired| E1C
    C1 -->|409 conflict| W1
    E1A --> V1A
    E1B --> V1B
    E1C --> V1C
    V1A --> B1A
    V1B --> B1B
    V1C --> B1C
    B1A --> R1A
    B1B --> R1B
    B1C --> R1C
    R1A --> G1
    R1B --> G1
    R1C --> G1
    G1 -->|yes| A1
    G1 -->|timeout| W2
    W2 --> G1
    A1 --> VF
    VF -->|fail| RF
    VF -->|pass| A2
    RF --> VF
    A2 --> T1
    T1 --> PG

    %% @pos E1 40 40
    %% @pos P1 40 210
    %% @pos S1 40 380
    %% @pos S2 40 550
    %% @pos OR1 40 720
    %% @pos C1 40 890
    %% @pos C2 237 890
    %% @pos C3 433 890
    %% @pos E1A 40 1060
    %% @pos E1B 407 1060
    %% @pos E1C 593 1060
    %% @pos W1 227 1060
    %% @pos V1A 40 1230
    %% @pos V1B 218 1230
    %% @pos V1C 395 1230
    %% @pos B1A 40 1400
    %% @pos B1B 306 1400
    %% @pos B1C 571 1400
    %% @pos R1A 40 1570
    %% @pos R1B 242 1570
    %% @pos R1C 444 1570
    %% @pos G1 40 1740
    %% @pos A1 40 1910
    %% @pos W2 258 1910
    %% @pos VF 40 2080
    %% @pos RF 40 2250
    %% @pos A2 247 2250
    %% @pos T1 40 2420
    %% @pos PG 40 2590
```
