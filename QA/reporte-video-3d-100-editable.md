# Prueba final: video creado por la IA, 100 % editable por una persona

Fecha: 2026-11-15 · Producción: `e5e938dd` · Rama: `prod-2026-11-14`

## Resultado

| Navegador | Resultado | Cómo se corrió |
|---|---|---|
| Chrome | **498 de 498** | Una sola pasada completa |
| Safari (WebKit) | **516 de 516** | Siete tramos seguidos (por clip y sección) |

Las dos pasadas se hicieron sobre la versión definitiva y con el video en su estado original. Safari suma más comprobaciones porque cada tramo repite las de carga y cierre.

## Qué se probó

- **Video:** «Video final · 100% editable (Three.js + Remotion)», `vidproj_b4620ff96239`, creado solo con herramientas MCP públicas (`video_project_create`, `video_live_add` ×2, pista de texto y 2 títulos).
- **Contenido:** un clip Three.js (planeta, anillo, luna, cubo, 3 luces, estrellas, cámara), un clip Remotion con React Three Fiber (nudo, cubo, esfera, 3 luces, cámara) y 2 textos.
- **Cómo:** en la web publicada, con mouse y teclado reales (Playwright). Cada control parte del video tal como lo creó la IA. Pasa si el control existe, acepta el valor, cambia el código o el clip, y el clip sigue dibujándose.
- **Script:** `t_audit.cjs` (scratchpad de la sesión 8388a47c). Se niega a correr si el video no está en su estado original.

## Detalle por sección (Chrome)

| Sección | Qué cubre | Resultado |
|---|---|---|
| A | Cada valor del código (parámetros y valores) con su control | 84 de 84 |
| B | Cada propiedad de cada objeto 3D y de la cámara | 147 de 147 |
| C | Tiempo del código (inicio, velocidad, repetir) | 6 de 6 |
| D | Lienzo: elegir con clic, arrastrar, agrandar, color, duplicar, quitar, ocultar; luces; cámara | 86 de 86 |
| E | Textos: elegir, arrastrar y cada propiedad | 60 de 60 |
| F | El clip como capa (posición, tamaño, opacidad, animación…) | 52 de 52 |
| G | Línea de tiempo: mover y recortar cada clip | 8 de 8 |
| H | Deshacer | 1 de 1 |
| T | Herramientas con botón (trayectoria, anillo, pila, keyframes, editar varios, presets, dibujar recorrido, morph, marca, duplicar, dividir, borrar) | 50 de 50 |
| Z | El video queda guardado como lo creó la IA; sin errores de página | 2 de 2 |

Del código quedan fuera solo 11 valores de estructura del clip Three.js (índices de arreglos, contadores de bucle, π/180, ms→s): no son partes del video y cambiarlos rompe el código.

### Controles cuyo cambio no se ve en el cuadro probado

De los 231 controles de las secciones A y B, en 192 el cambio se vio en el cuadro y en 23 no (los otros 16 son las comprobaciones de que cada objeto se puede elegir). Una corrida anterior tenía 7 más, que eran controles sin efecto y se quitaron (bug 6). Los 23:

- 14 nombres de objetos (no se dibujan).
- 2 distancias de recorte de la cámara (todo está dentro del rango).
- 4 giros de 0,07° en esferas lisas.
- 1 cantidad de estrellas (900 → 901).
- 1 amortiguación del resorte de entrada, ya asentado en ese cuadro.
- 1 duración en cuadros de la composición.

## Bugs encontrados por la prueba (todos corregidos y en producción)

| # | Bug |
|---|---|
| 1 | Arrastrar un objeto 3D movía también el clip entero |
| 2 | Un clic seguido de un arrastre sobre un texto abría la edición en vez de moverlo |
| 3 | «Dibujar recorrido» no recibía los clics sobre un clip 3D |
| 4 | El texto que se estaba escribiendo no se confirmaba al hacer clic en un objeto 3D |
| 5 | «Apilarse» sobre un texto suelto respondía «Elige un clip de Media o un grupo» |
| 6 | Se ofrecían controles que no hacían nada: posición de la luz ambiente y brillo propio en materiales sin esa propiedad |
| 7 | Al soltar un arrastre, el editor usaba la última posición recibida y no la del momento de soltar: el objeto, el texto o el clip quedaba a mitad de camino (visible en Safari) |
| 8 | Tras «Duplicar», la barra del lienzo no mostraba la copia elegida hasta el siguiente redibujado (visible en Safari) |
| 9 | Al abrir un video y hacer clic enseguida en un campo del inspector, el inspector se redibujaba (llegaban presets y marca), el campo perdía el foco y lo escrito se perdía |

## Specs nuevos implementados

1. **Cada valor del código con control.** `codeValues` lee cada número, color, sí/no y nombre del código y `setCodeValue` reescribe solo ese literal. Inspector: «Forma / Material / Animación» por objeto y «Todos los valores del código».
2. **Edición en el lienzo.** Clic elige, arrastrar mueve, esquinas escalan; barra con lista de todos los objetos, color, tamaño, duplicar, quitar u ocultar.
3. **Luces y cámara en el lienzo.** Las luces con posición son puntos arrastrables; la cámara se elige en la lista y se mueve arrastrando el lienzo.
4. **Duplicar como código real.** La copia repite las sentencias del objeto, hereda su animación y se puede volver a duplicar; quitarla devuelve el código original.
5. **Paridad MCP.** `video_live_get` devuelve `values`; `video_live_update` acepta `values`, `duplicateObjects` y `removeObjects`.

## Observaciones que no son fallas de edición

- En una corrida de Safari el clip de Remotion no cargó sus librerías en 135 s (tras el reintento automático). Cargó bien en todas las demás; la conexión del equipo de pruebas se cortó varias veces durante el día.
- La prueba solo restaura el video si termina. Una corrida cortada dejó textos duplicados; se limpió con `clean_final.cjs` y la prueba ahora verifica el estado inicial.

## Alcance

La prueba cubre el video creado (dos clips 3D y dos textos). No cubre audio, tomas de video grabadas ni videos 2D hechos con HTML/GSAP, que este video no contiene.
