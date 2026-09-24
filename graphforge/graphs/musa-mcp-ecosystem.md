# Musa MCP Tool Ecosystem — 287 tools audited

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    subgraph ENTRY["Public entry points · no auth"]
        INIT[initialize: server info + playbook index]
        TL[tools/list: full catalog + schemas]
        AG[get_agent_guide: onboarding]
        PB[get_playbook: read playbook DAG]
    end
    subgraph CORE["Core design pipeline"]
        CW[list_workspaces]
        CT[create_template engine html]
        CF[create_html_frame auto-positioned]
        SL[set_frame_layers editable layers]
        SH[set_html]
        SC[set_css]
        LD[lint_design score gate]
    end
    subgraph SYS["Design system and brand"]
        DS[get_design_system]
        EX[extract_design_system]
        GB[generate_brand_manual]
        RB[register_brand]
        AB[apply_brand]
        VB{validate_brand}
        AF[auto_fix_brand]
    end
    subgraph SCALE["Scale and delivery"]
        PR[profile_template_pool]
        CSV[generate_csv_template]
        AC[apply_csv_to_frames]
        BR[batch_render_html]
        CO[claim_section 60s lock]
        PE[parallel set_html set_css edits]
        BC[broadcast_section_change]
    end
    GATE{tools/call needs x-api-key}
    REN[render_html_template]
    FIX[Fix and retry]
    AF2[adapt_all_formats story post linkedin]
    XP[export_frame and export_pdf]

    INIT --> TL
    TL --> AG
    AG --> PB
    CW --> CT
    CT --> CF
    CF --> SL
    CF --> SH
    SH --> SC
    SL --> LD
    SH --> LD
    SC --> LD
    DS --> EX
    EX --> GB
    GB --> RB
    RB --> AB
    AB --> VB
    VB -->|fail| AF
    PR --> CSV
    CSV --> AC
    AC --> BR
    CO --> PE
    PE --> BC
    PB --> GATE
    GATE --> CW
    LD -->|pass| REN
    LD -->|fail| FIX
    FIX --> SH
    LD -.->|extract tokens| DS
    REN --> AF2
    REN --> XP

    %% @pos INIT 40 40
    %% @pos TL 40 210
    %% @pos AG 40 380
    %% @pos PB 40 550
    %% @pos CW 40 890
    %% @pos CT 40 1060
    %% @pos CF 40 1230
    %% @pos SL 40 1400
    %% @pos SH 254 1910
    %% @pos SC 264 2080
    %% @pos LD 40 1570
    %% @pos DS 40 1740
    %% @pos EX 40 1910
    %% @pos GB 40 2080
    %% @pos RB 40 2250
    %% @pos AB 40 2420
    %% @pos VB 40 2590
    %% @pos AF 40 2760
    %% @pos PR 343 40
    %% @pos CSV 311 210
    %% @pos AC 295 380
    %% @pos BR 322 550
    %% @pos CO 554 40
    %% @pos PE 528 210
    %% @pos BC 498 380
    %% @pos GATE 40 720
    %% @pos REN 234 1740
    %% @pos FIX 446 1740
    %% @pos AF2 390 1910
    %% @pos XP 686 1910
```
