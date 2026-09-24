# Musa — Router de intención (1 prompt → 4 módulos)

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    P1(Prompt del usuario)
    C1{Qué quiere hacer el usuario}
    MD[Módulo DISEÑO]
    MC[Módulo COPYWRITING]
    MG[Módulo CONFIGURACIÓN]
    MT[Módulo CONTACTOS]
    OUT(Ejecutar módulo y reportar resultado)
    n1[Módulo AGENTES]
    n2[Diseñar]
    n3[Armar grillas<br/>de contenido]
    n4[Redactar contenido<br/>para los diseños]
    n5[Agregar reglas<br/>de Copywriting]
    n6[Preparar reportes con<br/>el contenido del mes]
    n7[Animar Motion<br/>Graphics]
    n8[Crear Design <br/>Sytems]
    n9[Convertir imágenes<br/>a editables]
    n10[Crear plantillas<br/>de diseño]
    n11[Documentar assets<br/>de marca]
    n12[Generar videos<br/>con IA]
    n13[Agregar frameworks<br/>para redactar]
    n14[Hacer una semana<br/>de contenido]
    n15[Armar reportes<br/>de campaña]
    n16[New step]
    n17[Calendarizar contenido<br/>orgánico y ads]
    n19[Automatizar diseños<br/>usando plantillas]
    n18[Adaptar un diseño<br/>a varios formatos]
    n20[Redactar<br/>publicaciones]
    n21[Redactar copys que<br/>acompañan diseños]
    n22[Agregar tonos<br/>de comunicación]
    n23[Desglosar<br/>tareas trazables]
    n27[Descargar reporte<br/>con las tareas hechas]

    P1 --> C1
    C1 --> n2
    C1 --> n8
    C1 --> n9
    C1 --> n12
    C1 --> n7
    C1 --> n11
    C1 --> n10
    C1 --> n19
    C1 --> n18
    C1 --> n3
    C1 --> n5
    C1 --> n4
    C1 --> n6
    C1 --> n17
    C1 --> n15
    C1 --> n20
    C1 --> n14
    C1 --> n21
    C1 --> n13
    n2 --> MD
    n8 --> MD
    n9 --> MD
    n10 --> MD
    n11 --> MD
    n7 --> MD
    n12 --> MD
    n19 --> MD
    n18 --> MD
    C1 --> n22
    n3 --> MC
    n5 --> MC
    n4 --> MC
    n6 --> MC
    n17 --> MC
    n15 --> MC
    n20 --> MC
    n14 --> MC
    n21 --> MC
    n13 --> MC
    n22 --> MC
    n23 --> n1
    n27 --> n1
    C1 --> n23
    C1 --> n27

    %% @pos P1 790 -114
    %% @pos C1 741 22
    %% @pos MD -349 487
    %% @pos MC 1104 473
    %% @pos MG 2308 878
    %% @pos MT 2428 638
    %% @pos OUT 598 781
    %% @pos n1 2124 472
    %% @pos n2 -798 233
    %% @pos n3 423 233
    %% @pos n4 671 235
    %% @pos n5 540 233
    %% @pos n6 827 233
    %% @pos n7 -154 235
    %% @pos n8 -703 233
    %% @pos n9 -587 233
    %% @pos n10 -432 233
    %% @pos n11 -307 233
    %% @pos n12 -29 234
    %% @pos n13 1731 234
    %% @pos n14 1422 235
    %% @pos n15 1167 236
    %% @pos n16 1517 673
    %% @pos n17 992 235
    %% @pos n19 102 232
    %% @pos n18 261 233
    %% @pos n20 1299 235
    %% @pos n21 1571 235
    %% @pos n22 1893 232
    %% @pos n23 2052 232
    %% @pos n27 2184 232
    %% @link MD musa-mod-diseno
    %% @link MC musa-mod-copywriting
    %% @link MG musa-mod-config
    %% @link MT musa-mod-contactos
    %% @lane C1 n2 y 162
    %% @sides C1 n2 bottom top
    %% @sides C1 n8 bottom top
    %% @sides C1 n9 bottom top
    %% @sides C1 n12 bottom top
    %% @sides C1 n7 bottom top
    %% @sides C1 n11 bottom top
    %% @sides C1 n10 bottom top
    %% @sides C1 n19 bottom top
    %% @sides C1 n18 bottom top
    %% @sides C1 n3 bottom top
    %% @sides C1 n5 bottom top
    %% @sides C1 n4 bottom top
    %% @sides C1 n6 bottom top
    %% @sides C1 n17 bottom top
    %% @sides C1 n15 bottom top
    %% @sides C1 n20 bottom top
    %% @sides C1 n14 bottom top
    %% @sides C1 n21 bottom top
    %% @sides C1 n13 bottom top
    %% @lane n2 MD y 385
    %% @sides n2 MD bottom top
    %% @sides n8 MD bottom top
    %% @sides n9 MD bottom top
    %% @sides n10 MD bottom top
    %% @sides n11 MD bottom top
    %% @sides n7 MD bottom top
    %% @sides n12 MD bottom top
    %% @sides n19 MD bottom top
    %% @sides n18 MD bottom top
    %% @sides C1 n22 bottom top
    %% @sides n3 MC bottom top
    %% @sides n5 MC bottom top
    %% @sides n4 MC bottom top
    %% @sides n6 MC bottom top
    %% @sides n17 MC bottom top
    %% @sides n15 MC bottom top
    %% @sides n20 MC bottom top
    %% @sides n14 MC bottom top
    %% @sides n21 MC bottom top
    %% @sides n13 MC bottom top
    %% @sides n22 MC bottom top
    %% @sides n23 n1 bottom top
    %% @sides n27 n1 bottom top
    %% @sides C1 n23 bottom top
    %% @sides C1 n27 bottom top
```
