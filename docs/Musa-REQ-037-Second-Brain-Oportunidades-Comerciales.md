# REQ-037 — Second Brain: detectar qué ofrecerle a una marca

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** Second Brain / CRM / Inteligencia comercial / Ofertas  
**Prioridad:** P0 para recomendaciones explicables; P1 para scoring y propuestas

## 1. Caso de uso

Cuando el usuario agrega una marca C y pregunta:

> «Revisa lo que hemos hecho con las marcas A y B, o con las demás marcas, y dime qué venderle a C»

Musa debe producir recomendaciones comerciales basadas en evidencia del workspace. No debe inventar necesidades ni copiar automáticamente el estilo o los datos de otras marcas.

La respuesta debe distinguir:

- **Oportunidad:** qué servicio o entregable falta o tiene sentido.
- **Evidencia:** qué datos de C y qué patrones de otras marcas la respaldan.
- **Confianza:** alta, media o baja, con la razón.
- **Siguiente acción:** propuesta, reunión, muestra, auditoría o pregunta faltante.

## 2. Estado actual verificado

### 2.1 Señales disponibles

Musa ya guarda:

- marcas, relación (`lead`/`client`) y salud (`active`/`at_risk`/`churned`);
- contactos y cargos;
- campañas;
- deals, etapas, valor, probabilidad y fechas;
- deliverables vendidos y progreso de producción;
- archivos de diseño vinculados a marca y campaña;
- tipo de asset (`key_visual`, `social_media`, `landing`, `mailing`, `deck`, `motion`, etc.);
- Design System y nivel de completitud;
- Brand Strategy: misión, propuesta, tono, audiencia, vocabulario, CTA y arquetipo;
- interacciones comerciales y fecha del último contacto;
- plantillas, archivos, campañas y recursos en el Brand Graph.

Fuentes principales: `api/src/services/crmInsights.ts`, `api/src/routes/saas.ts`, `api/src/services/brandGraph.ts`, `api/src/services/brandContainer.ts`, `src/components/CrmWorkspace.tsx`.

### 2.2 Lo que existe hoy

`buildOfferSuggestions` ya agrega sugerencias básicas por marca. Su lógica actual:

- si la cuenta está `churned`, sugiere auditoría y relanzamiento;
- si está `at_risk`, sugiere una campaña de reactivación;
- si es `lead`, busca el primer asset ausente;
- si es cliente, muestra tipos de asset que no aparecen en sus diseños.

El CRM expone esas sugerencias dentro de **Qué ofrecer** y `get_crm_overview` devuelve el contexto general.

Esto es útil como fallback, pero no revisa realmente el trabajo de las otras marcas ni explica qué patrón comercial se está transfiriendo.

## 3. Qué falta

### P0 — Comparación cross-brand

La recomendación debe comparar C contra un conjunto explícito de marcas de referencia:

- seleccionadas por el usuario: A y B;
- similares por sector, audiencia, tamaño o estrategia;
- todas las marcas del workspace cuando el usuario diga «en general».

Nunca debe tomar una marca arbitraria por orden de base de datos.

### P0 — Catálogo de servicios normalizado

Los tipos de asset actuales son señales técnicas, no necesariamente productos vendibles. Se necesita un catálogo con:

- nombre comercial;
- entregables incluidos;
- formatos y cantidades;
- dependencia de Design System, copy, motion o producción;
- tiempo estimado;
- rango de precio opcional;
- evidencia mínima para recomendarlo;
- servicios complementarios y sustitutos.

Ejemplo: `social_media` puede convertirse en «Paquete de campaña social» con 12 piezas, adaptación de formatos, copy y calendario.

### P0 — Evidencia trazable

Cada recomendación debe mostrar por qué existe:

- gap de C: «no tiene landing»;
- patrón de A/B: «6 de 8 marcas comparables compraron landing después de social»;
- madurez: «C ya tiene Design System y 14 piezas, puede pasar a campaña»;
- señal CRM: «lead sin primera propuesta» o «cliente sin contacto hace 45 días»;
- fuente exacta: IDs de marcas, deals, deliverables, campañas y archivos.

Sin IDs y conteos, la recomendación es opinión, no inteligencia comercial.

### P0 — Separar necesidad detectada de oferta propuesta

Musa debe diferenciar:

1. **Gap observado:** falta un tipo de entregable.
2. **Hipótesis:** ese gap puede ser relevante para C.
3. **Oferta:** paquete concreto que Musa puede vender.
4. **Siguiente acción:** cómo validar la hipótesis con el cliente.

No se debe crear un deal ni contactar al cliente automáticamente por detectar un gap.

### P0 — Recomendaciones con confianza y límites

La respuesta debe incluir score y explicación:

- `high`: evidencia directa en C y patrón repetido en comparables;
- `medium`: gap claro, pero poca evidencia de conversión;
- `low`: inferencia basada en una o dos referencias.

Si faltan industria, audiencia, presupuesto, objetivo o historial, debe pedir ese dato o proponer una auditoría, no afirmar una necesidad.

### P1 — Integrar Brand Strategy y Second Brain

Las recomendaciones deben usar:

- misión y propuesta de valor de C;
- audiencia/personas;
- tono y vocabulario;
- campañas actuales;
- Design System y nivel de madurez;
- notas humanas del Second Brain.

Las notas humanas sirven como contexto, nunca como sustituto de datos verificables.

### P1 — Usar resultados de otras marcas sin copiar identidad

De A y B se pueden transferir:

- secuencia de servicios;
- tipos de entregables;
- formatos y cantidades frecuentes;
- patrones de campaña;
- paquetes que se repiten.

No se deben transferir automáticamente:

- logos, colores, tipografías, claims, copy, imágenes, precios ni datos privados.

### P1 — De recomendación a propuesta

Cada recomendación aprobada debe poder convertirse en:

- brief de propuesta;
- deal con deliverables;
- tarjeta Kanban de producción;
- contenido de muestra usando el Design System de C;
- tarea de seguimiento.

El usuario debe aprobar antes de mutar CRM o generar una producción grande.

### P1 — Medir si la recomendación funcionó

Registrar:

- recomendación mostrada;
- evidencia usada;
- decisión del usuario;
- propuesta enviada;
- deal ganado/perdido;
- servicio finalmente entregado.

Con esto se puede calibrar el scoring sin convertir el sistema en una caja negra.

## 4. Journey objetivo

### Paso 1 — Resolver la marca C

Validar marca exacta, workspace, estrategia, Design System, inventario, CRM e interacciones.

### Paso 2 — Resolver referencias

Si el usuario menciona A y B, usar esas marcas. Si dice «en general», mostrar el conjunto usado y por qué se eligió cada referencia.

### Paso 3 — Construir señales

Calcular:

- assets presentes y ausentes;
- frecuencia y secuencia de entregables;
- campañas y formatos repetidos;
- madurez de diseño y estrategia;
- salud y momento comercial;
- servicios que suelen aparecer juntos;
- evidencia de valor cuando exista.

### Paso 4 — Generar recomendaciones

El modelo puede interpretar el contexto y redactar una propuesta, pero los conteos, filtros, joins y puntuaciones deben ser deterministas.

### Paso 5 — Mostrar resultado

Cada tarjeta debe tener:

- oferta;
- por qué ahora;
- evidencia de C;
- referencias A/B;
- entregables;
- confianza;
- pregunta de validación;
- acción `Preparar propuesta`.

### Paso 6 — Ejecutar solo con aprobación

`Preparar propuesta` crea un brief o deal en estado `proposal`, nunca una venta cerrada ni una campaña publicada.

## 5. Herramientas sugeridas

### `get_commercial_patterns`

Entrada: `workspaceId`, `brandIds?`, `segment?`, `limit?`.

Salida: patrones de servicios, secuencias, combinaciones, frecuencia, valor agregado disponible y fuentes.

### `score_brand_opportunities`

Entrada: `workspaceId`, `targetBrandId`, `referenceBrandIds?`, `catalogVersion`.

Salida: oportunidades con `score`, `confidence`, `evidence[]`, `gaps[]`, `suggestedOffer`, `nextAction` y `blockedReasons`.

### `prepare_brand_offer`

Entrada: `opportunityId`, decisión humana, objetivo y restricciones.

Salida: brief, deliverables, propuesta editable y opcionalmente deal en etapa `proposal`.

### `record_opportunity_outcome`

Entrada: `opportunityId`, resultado y motivo.

Salida: evento de aprendizaje auditable.

## 6. Scoring inicial explicable

Una primera versión puede calcular:

```text
score =
  30% gap de entregable
  25% frecuencia del patrón en referencias
  20% ajuste a estrategia/audiencia de C
  15% momento CRM y salud de cuenta
  10% evidencia de valor o conversión
```

El score nunca reemplaza la confianza. Si una señal está ausente, se reduce la confianza y se muestra el dato faltante.

## 7. Ejemplo de salida esperada

```text
Marca C — oportunidades sugeridas

1. Paquete de campaña social · confianza alta
   Por qué: C tiene Design System y 8 archivos estáticos, pero ninguna campaña social.
   Evidencia: A y B compraron campañas de 10–12 piezas después de crear su sistema.
   Incluye: 12 posts, 6 stories, copy, adaptación y calendario.
   Siguiente paso: preparar propuesta de campaña de lanzamiento.

2. Landing de conversión · confianza media
   Por qué: C tiene tráfico/campaña registrada, pero no landing vinculada.
   Evidencia: patrón presente en 5 marcas comparables.
   Falta validar: objetivo, oferta y fuente de tráfico.

3. Motion para campaña · confianza baja
   Por qué: referencias similares usan motion, pero C no tiene objetivo audiovisual registrado.
   Siguiente paso: preguntar si necesita awareness, ads o lanzamiento.
```

## 8. Criterios de aceptación

- Preguntar por una marca C produce recomendaciones basadas en C y en referencias declaradas.
- «En general» muestra qué marcas fueron comparadas.
- Cada recomendación tiene evidencia, IDs, confianza y siguiente acción.
- El sistema no confunde ausencia de un asset con una necesidad confirmada.
- Las recomendaciones respetan la identidad y estrategia de C.
- Preparar propuesta no crea producción ni publicación sin aprobación.
- El usuario puede convertir una oportunidad en brief, deal y deliverables.
- El resultado puede auditarse después y alimentar mejoras de scoring.

## 9. Fuera de alcance inicial

- Predecir ventas con un modelo opaco.
- Usar métricas externas que no estén conectadas.
- Enviar mensajes o cotizaciones automáticamente.
- Copiar estilos, precios, claims o datos privados entre marcas.

