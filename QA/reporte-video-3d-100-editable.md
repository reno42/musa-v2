# Prueba final: video creado por la IA, 100 % editable por una persona

Fecha: 2026-11-15 · Producción: `a957ddce` · Rama: `prod-2026-11-14`

## Qué se probó

- **Video:** «Video final · 100% editable (Three.js + Remotion)», `vidproj_b4620ff96239`, creado solo con herramientas MCP públicas (`video_project_create`, `video_live_add` ×2, pista de texto y 2 títulos).
- **Contenido:** un clip Three.js (planeta, anillo, luna, cubo, 3 luces, estrellas, cámara), un clip Remotion con React Three Fiber (nudo, cubo, esfera, 3 luces, cámara) y 2 textos.
- **Cómo:** en la web publicada, con mouse y teclado reales (Playwright). Cada control se prueba partiendo del video tal como lo creó la IA; se verifica que el control exista, acepte el valor, cambie el código o el clip, y que el clip siga dibujándose.
- **Script:** `t_audit.cjs` (scratchpad de la sesión 8388a47c).

## Resultado en Chrome: 505 de 505

| Sección | Qué cubre | Resultado |
|---|---|---|
| A | Cada valor del código (parámetros y valores) con su control | 84 de 84 |
| B | Cada propiedad de cada objeto 3D y de la cámara | 154 de 154 |
| C | Tiempo del código (inicio, velocidad, repetir) | 6 de 6 |
| D | Lienzo: elegir con clic, arrastrar, agrandar, color, duplicar, quitar, ocultar; luces; cámara | 86 de 86 |
| E | Textos: elegir, arrastrar y cada propiedad | 60 de 60 |
| F | El clip como capa (posición, tamaño, opacidad, animación…) | 52 de 52 |
| G | Línea de tiempo: mover y recortar cada clip | 8 de 8 |
| H | Deshacer | 1 de 1 |
| T | Herramientas con botón (trayectoria, anillo, pila, keyframes, editar varios, presets, dibujar recorrido, morph, marca, duplicar, dividir, borrar) | 50 de 50 |
| Z | El video queda guardado como lo creó la IA; sin errores de página | 2 de 2 |

De los 238 controles de A y B, en 192 el cambio se vio en el cuadro probado y en 30 no. Los 30:

- 14 son nombres de objetos (no se dibujan).
- 2 son las distancias de recorte de la cámara (todo está dentro del rango).
- 6 son la posición de la luz ambiente, que no tiene efecto (ver bug 6).
- 4 son giros de 0,07° en esferas lisas.
- 1 es el brillo propio de las estrellas, que no tiene efecto (ver bug 6).
- 1 es la cantidad de estrellas (900 → 901).
- 1 es la amortiguación del resorte de entrada, ya asentado en ese cuadro.
- 1 es la duración en cuadros de la composición.

## Resultado en Safari: pendiente

- Primera corrida (prueba anterior, sin reintentos): 459 de 505. Las 46 fallas fueron «no hay control», «control oculto» o «no está en el DOM» en el clip de Remotion y «no se ocultó» en el lienzo. La hipótesis es que el inspector se redibuja entre que la prueba ubica el campo y escribe, porque en Safari la escena tarda más en recargar. No está confirmado.
- La prueba ya reintenta ubicando el control de nuevo. La corrida con ese cambio se detuvo sola por falta de memoria en el equipo antes de dar resultado.
- Textos, capa, tiempo, línea de tiempo y herramientas pasaron completos en Safari en la primera corrida (60, 52, 6, 8 y 50).

## Bugs encontrados por la prueba

| # | Bug | Estado |
|---|---|---|
| 1 | Arrastrar un objeto 3D movía también el clip entero | Corregido y en producción |
| 2 | Un clic seguido de un arrastre sobre un texto abría la edición en vez de moverlo | Corregido y en producción |
| 3 | «Dibujar recorrido» no recibía los clics sobre un clip 3D | Corregido y en producción |
| 4 | El texto que se estaba escribiendo no se confirmaba al hacer clic en un objeto 3D | Corregido y en producción |
| 5 | «Apilarse» sobre un texto suelto respondía «Elige un clip de Media o un grupo» | Corregido y en producción |
| 6 | Se ofrecen controles que no hacen nada: posición de la luz ambiente y brillo propio en materiales sin esa propiedad | Corregido en el código, **sin desplegar** (falta probarlo en navegador) |
| 7 | El clip Three.js del video final quedó distinto del original tras una corrida interrumpida | Restaurado por MCP; la prueba solo restaura si termina |

## Specs nuevos implementados

1. **Cada valor del código con control.** `codeValues` lee cada número, color, sí/no y nombre del código y `setCodeValue` reescribe solo ese literal. Inspector: «Forma / Material / Animación» por objeto y «Todos los valores del código». Quedan fuera los valores de estructura (índices, contadores de bucle, π/180).
2. **Edición en el lienzo.** Clic elige, arrastrar mueve, esquinas escalan; barra con lista de todos los objetos, color, tamaño, duplicar, quitar u ocultar.
3. **Luces y cámara en el lienzo.** Las luces con posición son puntos arrastrables; la cámara se elige en la lista y se mueve arrastrando el lienzo.
4. **Duplicar como código real.** La copia repite las sentencias del objeto, hereda su animación y se puede volver a duplicar; quitarla devuelve el código original.
5. **Paridad MCP.** `video_live_get` devuelve `values`; `video_live_update` acepta `values`, `duplicateObjects` y `removeObjects`.

## Pendiente

- Correr la prueba completa en Safari y analizar lo que falle.
- Probar en navegador y desplegar el arreglo del bug 6.
- Repetir las suites de regresión del editor después de los últimos cambios.
- Publicar la novedad en la campana.

## Alcance

La prueba cubre el video creado (dos clips 3D y dos textos). No cubre audio, tomas de video grabadas, ni videos 2D hechos con HTML/GSAP, que este video no contiene.
