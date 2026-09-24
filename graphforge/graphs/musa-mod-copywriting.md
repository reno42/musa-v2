# Módulo COPYWRITING — posts y grillas de contenido

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    K1(Brief de contenido)
    K2{¿Qué formato?}
    K3[Post único (1 pieza)]
    K4[Grilla (semana / mes)]
    K5[Cargar contexto de marca: design system + brand manual (1 lectura, cachear)]
    K6[Redactar 3 opciones por pieza (tono de la marca)]
    K7{Humano elige/edita en UI}
    K8[Iterar solo las piezas rechazadas]
    K9[Grilla aprobada → calendario / CSV]
    K10(Diseñar piezas → pasa a módulo DISEÑO)

    K1 --> K2
    K2 -->|1 pieza| K3
    K2 -->|varias| K4
    K3 --> K5
    K4 --> K5
    K5 --> K6
    K6 --> K7
    K7 -->|rechazo parcial| K8
    K8 --> K7
    K7 -->|aprobado (solo si es grilla)| K9
    K9 --> K10

    %% @pos K1 0 0
    %% @pos K2 0 150
    %% @pos K3 -200 330
    %% @pos K4 200 330
    %% @pos K5 0 490
    %% @pos K6 0 640
    %% @pos K7 0 790
    %% @pos K8 260 790
    %% @pos K9 0 940
    %% @pos K10 0 1090
    %% @link K9 musa-pb-content-calendar
    %% @link K10 musa-mod-diseno
```
