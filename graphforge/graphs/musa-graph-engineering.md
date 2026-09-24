# Musa — Graph Engineering Loop

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    subgraph INTENT["1 · Intent and DAG design"]
        I1[User intent in natural language]
        I2[Decompose into DAG with typed nodes]
        I3[Define gates, provenance and recovery paths]
    end
    subgraph GATES["2 · Validation gates"]
        V1{V1 · schema valid?}
        REC[Error recovery: retry or replan]
        V2{V2 · tool contract honored?}
        V3{V3 · lint score 70+?}
        V4{V4 · visual QA clean?}
        OK[Approved artifact]
    end
    subgraph RUN["3 · Provenance and RunReport"]
        P1[Record provenance: inputs, tools, versions]
        P2[Terminal RunReport: status, artifacts, timings]
    end
    FB[Feedback hardens the playbook library]

    I1 --> I2
    I2 --> I3
    V1 -->|fail| REC
    V1 -->|pass| V2
    V2 -->|fail| REC
    V2 -->|pass| V3
    V3 -->|fail| REC
    V3 -->|pass| V4
    V4 -->|fail| REC
    V4 -->|pass| OK
    P1 --> P2
    I3 --> V1
    REC -->|replan| I2
    OK --> P1
    P2 --> FB
    FB -.->|next run starts stronger| I2

    %% @pos I1 111 222
    %% @pos I2 121 139
    %% @pos I3 -277 244
    %% @pos V1 -352 560
    %% @pos REC -250 1158
    %% @pos V2 407 674
    %% @pos V3 142 791
    %% @pos V4 157 1020
    %% @pos OK 295 1230
    %% @pos P1 294 1415
    %% @pos P2 40 1570
    %% @pos FB 40 1740
```
