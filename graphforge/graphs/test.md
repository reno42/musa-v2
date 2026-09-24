# test

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    n1(Usuario envía prompt)
    n2{Qué solicito el usuario?}
    n3[New step]
    n4[New step]
    n5[New step]

    n1 --> n2
    n2 --> n3
    n2 --> n4
    n2 --> n5

    %% @pos n1 365 32
    %% @pos n2 327 116
    %% @pos n3 321 242
    %% @pos n4 413 241
    %% @pos n5 515 242
    %% @sides n2 n5 bottom top
```
