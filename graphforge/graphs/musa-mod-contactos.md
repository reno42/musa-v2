# Módulo CONTACTOS — CRM: ventas, clientes, prospectos

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    T1(Petición sobre contacto/venta)
    T2{¿Entidad?}
    T3[Venta (deal)]
    T4[Cliente]
    T5[Prospecto (lead)]
    T6{¿Acción?}
    T7[Actualizar etapa / estado]
    T8[Agregar nota]
    T9[Reagendar follow-up]
    T10[Crear nuevo]
    T11[Escribir en CRM]
    T12[Readback: releer el registro y comparar]
    T13{¿Coincide?}
    T14(Confirmar al humano con el diff exacto)

    T1 --> T2
    T2 --> T3
    T2 --> T4
    T2 --> T5
    T3 --> T6
    T4 --> T6
    T5 --> T6
    T6 --> T7
    T6 --> T8
    T6 --> T9
    T6 --> T10
    T7 --> T11
    T8 --> T11
    T9 --> T11
    T10 --> T11
    T11 --> T12
    T12 --> T13
    T13 -->|ok| T14
    T13 -->|mismatch: 1 retry| T11

    %% @pos T1 0 0
    %% @pos T2 0 150
    %% @pos T3 -260 330
    %% @pos T4 0 330
    %% @pos T5 260 330
    %% @pos T6 0 490
    %% @pos T7 -390 670
    %% @pos T8 -130 670
    %% @pos T9 130 670
    %% @pos T10 390 670
    %% @pos T11 0 830
    %% @pos T12 0 980
    %% @pos T13 0 1130
    %% @pos T14 0 1280
```
