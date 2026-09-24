# Módulo CONFIGURACIÓN — conectar IAs, claves, automatización

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    G1(Petición de configuración)
    G2{¿Qué configuras?}
    G3[Conectar IA (API key de proveedor: OpenAI, Z.ai, etc.)]
    G4[MCP server (URL + x-api-key fdr_ws_*)]
    G5[Workspace / claves API de Musa]
    G6[Cronjobs / automatizaciones]
    G7[Validar credencial con 1 llamada real (nunca guardar a ciegas)]
    G8{¿Validó?}
    G9[Reportar error exacto al humano (no reintentar en loop)]
    G10(Guardar + confirmar qué quedó activo)

    G1 --> G2
    G2 --> G3
    G2 --> G4
    G2 --> G5
    G2 --> G6
    G3 --> G7
    G4 --> G7
    G5 --> G7
    G6 --> G7
    G7 --> G8
    G8 -->|fail| G9
    G8 -->|ok| G10

    %% @pos G1 0 0
    %% @pos G2 0 150
    %% @pos G3 -420 330
    %% @pos G4 -140 330
    %% @pos G5 140 330
    %% @pos G6 400 330
    %% @pos G7 0 510
    %% @pos G8 0 660
    %% @pos G9 260 660
    %% @pos G10 0 810
```
