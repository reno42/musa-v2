# Módulo DISEÑO — reusa los 6 playbooks canónicos

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    D1(Brief visual del usuario)
    D2{Clasificar entrega}
    DR[replicate-html (trajo HTML+CSS)]
    DC[create-from-scratch (idea/referencia)]
    DB[csv-batch (filas + template base)]
    DS[design-system (templateIds + marca)]
    DM[multi-agent (paralelo por secciones)]
    D3[Ejecutar playbook SOLO del match (no cargar los otros 5)]
    D4{lint_design ≥ 70}
    D5[Fix y retry (máx 2 ciclos)]
    D6[Render + QA visual (screenshot)]
    D7{Humano aprueba en UI}
    D8(Export / publicar)

    D1 --> D2
    D2 --> DR
    D2 --> DC
    D2 --> DB
    D2 --> DS
    D2 --> DM
    DR --> D3
    DC --> D3
    DB --> D3
    DS --> D3
    DM --> D3
    D3 --> D4
    D4 -->|fail| D5
    D5 --> D4
    D4 -->|pass| D6
    D6 --> D7
    D7 -->|ok| D8
    D7 -->|cambios| D3

    %% @pos D1 0 0
    %% @pos D2 0 150
    %% @pos DR -560 330
    %% @pos DC -340 330
    %% @pos DB -90 330
    %% @pos DS 170 330
    %% @pos DM 410 330
    %% @pos D3 0 510
    %% @pos D4 0 660
    %% @pos D5 260 660
    %% @pos D6 0 810
    %% @pos D7 0 960
    %% @pos D8 0 1110
    %% @link DR musa-pb-replicate-html
    %% @link DC musa-pb-create-from-scratch
    %% @link DB musa-pb-csv-batch
    %% @link DS musa-pb-design-system
    %% @link DM musa-pb-multi-agent
```
