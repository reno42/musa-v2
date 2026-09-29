# Catálogo propuesto de recetas de Musa

Este catálogo convierte las acciones de `graphforge/graphs/musa-router.md` y sus módulos en contratos ejecutables. GraphForge sigue siendo un mapa visual; el runtime usa `src/lib/musaToolRouting.ts`, `src/lib/recipes.ts`, los skills de `.agents/skills/` y el catálogo MCP. **Propuesta no significa herramienta ya disponible.** Antes de implementar una receta, confirmar los nombres y parámetros en `tools/list`.

## Contrato común

Cada receta declara: intención y módulo; entradas obligatorias; salida e IDs; pasos deterministas; paso creativo, si existe; lectura de verificación; estado recuperable por lote. Una receta solo toma la ruta directa si dispone de todas las entradas y no debe adivinar contenido. En caso contrario pide un dato concreto o pasa el brief a un único modelo. Una lectura puede ejecutarse en paralelo con otra lectura; las escrituras con dependencia de IDs siguen en orden. El resultado de una herramienta no sustituye la lectura final del artefacto.

**Calidad antes de velocidad.** La parte determinista decide fechas, dependencias, validaciones, persistencia, exportación y comprobación de IDs. No fija la idea creativa, el tono, la composición ni la conclusión de un reporte: esos pasos siguen siendo del modelo cuando el tipo es H. Una ruta directa no debe activarse por una palabra clave o por un valor supuesto. Requiere intención inequívoca, entradas completas, compatibilidad de herramientas y una verificación que pueda fallar. Si el pedido combina módulos, se compone una secuencia y se pasan IDs entre fases; si es ambiguo, vuelve al modelo con el estado ya realizado. No se debe marcar una salida parcial como éxito completo.

Antes de activar una receta nueva: acordar con el usuario el **resultado esperado** y las restricciones que importan (por ejemplo, tono, frecuencia, formatos y criterios visuales), no pedirle que escriba cada llamada MCP. Probar briefs simples, compuestos, ambiguos y con fallos de herramientas; comparar artefactos y costo contra el flujo general; empezar en piloto con posibilidad de volver al flujo general. Las seis rutas regex existentes son experimentales y requieren esa misma auditoría: `matchTempRecipe` puede elegir la primera coincidencia y no interpreta bien un encargo compuesto.

Tipos: **D** = encadenado determinista sin LLM; **H** = LLM una vez para texto, composición o juicio creativo, con ejecución y verificación deterministas; **E** = estrategia para trabajo amplio que se activa solo por umbral. Orden sugerido: **P0** alto volumen o ahorro; **P1** siguiente; **P2** posterior. `src/lib/recipes.ts` contiene hoy seis rutas experimentales, algunas parciales; las entradas de esta lista no indican que ya estén listas para producción.

Las seis rutas actuales son `recipe_style_transfer` (D14, fuente y destino todavía son el mismo diseño), `recipe_publish_instagram` (D13, exporta pero puede terminar sin publicar), `recipe_post_from_brand` (D01, crea dentro del contexto abierto), `recipe_deck_from_template` (D12), `recipe_animate_frame` (M01) y `recipe_carrusel_content` (D06). Sus expresiones regulares temporales no deben convertirse en un router general: solo hacen match con frases concretas y pueden confundir pedidos compuestos. Cada una necesita el contrato de entradas, salida y verificación de este catálogo antes de ampliarse.

## Copywriting y calendario

| ID | Pedido | Entrada → salida | Camino y verificación | Tipo / prioridad |
| --- | --- | --- | --- | --- |
| C01 | Redactar publicación | tema, canal, tono/marca → copy + ID opcional | Leer marca una vez; generar una versión; revisar longitud, tono, CTA y texto requerido; guardar solo si se pidió. | H / P0 |
| C02 | Copy para diseño existente | templateId + canal → copy asociado | Leer textos y contexto del diseño; redactar sin cambiarlo; comprobar que nombres, oferta y CTA coinciden. | H / P0 |
| C03 | Semana de contenido | marca, canales, frecuencia, semana → entradas | Calcular fechas y huecos; generar textos por lote; guardar IDs; releer cobertura, duplicados y orden. | H / P0 |
| C04 | Grilla de N meses | periodo, frecuencia, canales, marca → calendario + IDs | Calcular todos los slots sin IA; generar en lotes; guardar checkpoint tras cada lote; verificar cobertura de fechas y ausencia de duplicados. | H / P0 |
| C05 | Calendarizar orgánico y ads | entradas existentes + canal + fechas → publicaciones programadas | Validar zona horaria, cuentas y colisiones; escribir por lote; releer cada estado y fecha. | D / P1 |
| C06 | Variantes de una pieza | ID de entrada + cantidad/objetivo → alternativas | Generar solo la pieza pedida; conservar original; revisar diferencias y restricciones. | H / P1 |
| C07 | Iterar rechazadas | IDs rechazados + feedback → revisiones | Leer solo IDs rechazados; editar esas entradas; comparar versión anterior y nueva. | H / P1 |
| C08 | Reglas de copywriting | marca/campaña + reglas → guía versionada | Validar conflictos y alcance; guardar configuración; releer versión activa. | H / P1 |
| C09 | Tono de comunicación | marca + ejemplos + audiencia → tono versionado | Sintetizar guía; guardar; probar con un ejemplo corto y verificar asociación a marca. | H / P1 |
| C10 | Framework para redactar | nombre/pasos/ejemplos → receta reusable | Validar campos; crear o actualizar por ID; releer definición y alcance. | D / P1 |
| C11 | Reporte mensual de contenido | periodo + entradas → resumen/export | Consultar paginado; contar publicados, pendientes y fallidos; generar tabla/export con fuentes e IDs. | D / P1 |
| C12 | Reporte de campaña | campaña + periodo → métricas y conclusiones | Agregar métricas deterministas; contrastar con periodo/base; usar modelo solo para interpretación si se pide. | D/H / P1 |

## Diseño y marca

| ID | Pedido | Entrada → salida | Camino y verificación | Tipo / prioridad |
| --- | --- | --- | --- | --- |
| D01 | Diseñar una pieza nueva | brief, formato, textos, marca → templateId | Elegir solo `create-from-scratch`; crear; releer frames, dimensiones y textos; lint y render cuando importe calidad visual. | H / P0 |
| D02 | Diseñar grilla existente | IDs de calendario + formato/template → IDs de diseños | Pasar IDs, no toda la grilla; procesar lotes; mapear entrada→template; verificar cantidad, textos y render de muestras, corregir fallos. | H / P0 |
| D03 | Adaptar a varios formatos | templateId + formatos → variantes | Leer origen una vez; cambiar tamaños y ajustar composición; verificar dimensiones, textos y recortes de cada variante. | H / P0 |
| D04 | Automatizar desde plantilla | templateId + datos tabulares → lote | Perfilar slots; validar columnas; `csv-batch`/relleno determinista; comprobar número de frames, textos y errores por fila. | D / P0 |
| D05 | Editar diseño existente | templateId explícito + cambio → mismo ID/version | Leer estado; aplicar cambio acotado; releer diff, lint y render si afecta visual. Nunca elegir un template solo porque está abierto. | D/H / P0 |
| D06 | Carrusel | tema + slides + marca → templateId + frames | Generar contenido primero si falta; componer frames; verificar orden, textos, dimensiones y continuidad visual. | H / P1 |
| D07 | Replicar HTML/CSS | fuente HTML/CSS + tamaño → templateId | Elegir solo `replicate-html`; importar; comparar DOM/textos y render con la referencia. | D/H / P1 |
| D08 | Crear plantilla reusable | brief + slots + marca → templateId | Diseñar base; marcar slots; probar con dos juegos de datos; lint y render. | H / P1 |
| D09 | Crear design system | templates/brand IDs → guidelineId | Elegir `design-system`; extraer tokens; detectar conflictos; guardar y releer guideline; probar aplicación sobre copia. | H / P1 |
| D10 | Documentar assets de marca | asset IDs + marca → inventario/guía | Leer metadatos; agrupar versiones, usos y licencias; verificar enlaces y registros fuente. | D/H / P1 |
| D11 | Convertir imagen a editable | imagen + alcance → templateId con capas | Segmentar/vectorizar según herramienta real; comparar render y editabilidad de elementos clave. No prometer capas editables si solo existe una imagen plana. | H / P2 |
| D12 | Deck/presentación | brief o template + secciones → deckId | Reusar template o playbook; crear páginas; verificar conteo, orden, textos y render. | H / P1 |
| D13 | Exportar/publicar diseño | templateId + formato/destino → archivo/URL | Validar formato y destino; exportar; comprobar que el archivo existe y corresponde al ID. Publicar solo con cuenta y pieza correctas. | D / P1 |
| D14 | Transferir estilo | sourceId + targetId explícitos → target actualizado | Extraer sistema fuente; previsualizar aplicación; actualizar destino; comparar tokens y render. La receta actual en `src/lib/recipes.ts` usa el mismo template como fuente y destino, por lo que requiere ampliar contrato antes de ofrecer transferencia entre dos diseños. | D/H / P2 |

## Motion y video

| ID | Pedido | Entrada → salida | Camino y verificación | Tipo / prioridad |
| --- | --- | --- | --- | --- |
| M01 | Animar diseño existente | templateId/frameId + duración + preset → animaciónId | Leer fuente; aplicar preset/timeline; exportar; verificar duración, formato y referencia a la fuente. | D/H / P0 |
| M02 | Diseñar y animar | brief + formato + duración → templateId→animaciónId | Ejecutar D01 y pasar su ID a M01; guardar estado entre fases y no volver a generar el diseño. | H / P1 |
| M03 | Adaptar motion a formatos | animaciónId + tamaños → variantes | Reusar timeline; adaptar viewport y safe areas; verificar dimensiones, duración y export de cada variante. | D/H / P1 |
| M04 | Video con IA | brief + assets + duración + modelo → videoId | Validar proveedor y presupuesto; generar job asíncrono; reportar estado; comprobar salida real y metadatos. | H / P2 |
| M05 | Exportar motion | animaciónId + codec/resolución → archivo | Validar compatibilidad; exportar; comprobar URL, tamaño y duración. | D / P1 |

## CRM y configuración

| ID | Pedido | Entrada → salida | Camino y verificación | Tipo / prioridad |
| --- | --- | --- | --- | --- |
| T01 | Crear prospecto/cliente | entidad + campos mínimos → recordId | Buscar duplicados; crear; releer registro y comparar campos. | D / P0 |
| T02 | Cambiar etapa de venta | dealId inequívoco + etapa → estado nuevo | Leer actual y transiciones válidas; escribir una vez; releer y mostrar diff. | D / P0 |
| T03 | Agregar nota | recordId + texto → noteId | Resolver entidad; guardar; releer nota y asociación. | D / P0 |
| T04 | Reagendar seguimiento | recordId + fecha/zona → followupId | Validar fecha; escribir; releer fecha exacta y estado. | D / P0 |
| T05 | Consultar ficha | ID/nombre inequívoco → ficha breve | Buscar y desambiguar si hay coincidencias; devolver campos relevantes y fuente. | D / P1 |
| G01 | Conectar proveedor IA | proveedor + credencial → conexión activa | Probar credencial con una llamada real; guardar de forma segura; releer estado sin mostrar secreto. | D / P1 |
| G02 | Configurar MCP | URL + credencial → conexión activa | Validar endpoint y auth; guardar; ejecutar healthcheck; releer estado. | D / P1 |
| G03 | Workspace/API key Musa | workspace + cambio explícito → configuración | Verificar permisos; mutar; releer configuración saneada. | D / P1 |
| G04 | Automatización/cron | regla + zona horaria + alcance → automationId | Validar horario y destinatario; guardar; releer próxima ejecución/estado. No exigir una prueba de credencial si la regla no usa credenciales. | D / P1 |

## Operación y rutas compuestas

| ID | Pedido | Entrada → salida | Camino y verificación | Tipo / prioridad |
| --- | --- | --- | --- | --- |
| O01 | Desglosar tareas trazables | objetivo + criterios → task IDs | Crear dependencias y criterios concretos; confirmar IDs, estados y ausencia de duplicados. | H / P1 |
| O02 | Descargar reporte de tareas hechas | periodo/workspace → archivo | Leer estados e IDs verificados; exportar tabla con evidencias y errores; comprobar archivo. | D / P1 |
| O03 | Grilla de 3 meses y diseños | periodo, frecuencia, marca, formatos → calendario IDs→template IDs | C04 por lotes; entregar solo IDs y textos finales a D02; verificar ambos recuentos y mapa 1:1; avisar cuando todos los lotes estén confirmados. | H / P0 |
| O04 | Diseño + motion + publicación | brief, canal, fecha, duración → cadena de IDs | D01→M01→D13/publicación; cada fase recibe ID de la anterior y tiene checkpoint propio. | H / P2 |
| O05 | Trabajo amplio por secciones | brief con partes independientes → artefactos | Estrategia E opcional: particionar por artefactos, ejecutar en paralelo solo si ahorra tiempo, reunir IDs y hacer verificación final. No es una receta de producto separada. | E / P2 |

## Orden de implementación coordinado

1. **P0:** C04, D02 y O03 dan el mayor ahorro en campañas largas. Añadir persistencia por lote, mapa de IDs y reanudación antes de activar la ruta directa.
2. **P0:** D03, D04, T01–T04 y M01 tienen entradas/validaciones claras. Implementar primero las que ya cuenten con herramientas MCP completas.
3. **P1:** C05–C12, D06–D13, M02/M03/M05 y configuración, agrupando rutas que compartan el mismo contrato.
4. **P2:** conversión editable, video con IA y estrategia de paralelismo solo después de demostrar calidad en una muestra de pedidos reales.

Para cada receta nueva: prueba con pedido simple, compuesto y ambiguo; registrar tokens, tiempo p50/p95 y porcentaje de artefactos verificados; comparar contra el flujo de un modelo. El umbral para activar una receta en producción es **misma calidad de salida y menos costo o espera**. No entrenar el router con filas `tool_used = '__run_metrics__'`: son telemetría agregada, no acciones del usuario.
