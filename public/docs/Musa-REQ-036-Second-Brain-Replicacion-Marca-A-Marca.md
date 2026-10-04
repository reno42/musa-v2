# REQ-036 — Second Brain: replicar el proceso de una marca A en una marca B

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** Second Brain / Brand Graph / Design System / Batchamator / Copywriting  
**Prioridad:** P0 para plan y ejecución segura; P1 para aprendizaje, colaboración y escala

## 1. Resultado que debe prometer Musa

Cuando el usuario diga:

> «Revisa todo lo que hicimos para la marca A y aplica el mismo proceso a la marca B, usando el estilo de B»

Musa debe:

1. Resolver de forma exacta las dos marcas dentro del mismo workspace.
2. Leer la lógica de producción de A: Design System, estrategia, voz, plantillas curadas, archivos, campañas, formatos, assets y relaciones.
3. Detectar qué parte es estructura reutilizable y qué parte es identidad exclusiva de A.
4. Mostrar un plan previo con archivos, formatos, tokens, textos, assets y cantidad de salidas.
5. Esperar aprobación antes de crear una serie grande.
6. Crear nuevas piezas bajo B, manteniendo el propósito y la estructura útil de A, pero aplicando la identidad completa de B.
7. Verificar cada salida, guardar su procedencia y entregar un mapa A → B con resultados y errores.

La acción no debe clonar silenciosamente archivos de A ni tratar el grafo como si fuera un motor de ejecución.

## 2. Qué existe hoy

### 2.1 Second Brain y Brand Graph

- El grafo visual agrupa workspace → marcas → Design System, Plantillas, Assets y Archivos.
- También muestra ramas de CRM, Estrategia de Marca, Copywriting y personas sintéticas.
- El drawer puede abrir archivos, editar markdown humano, ver notas regeneradas, reconectar un archivo a otra marca y eliminar nodos.
- Las notas se regeneran desde las tablas fuente; el markdown humano queda protegido.
- El grafo es una vista de lectura y navegación. `graphforge/graphs/` documenta rutas, pero actualmente no ejecuta rutas.

Fuentes: `api/src/services/brandGraph.ts`, `src/components/BrandGraphCanvas.tsx`, `src/components/GraphTab.tsx`.

### 2.2 Playbook consultable

`get_brand_playbook` ya entrega para una marca:

- `hasDesignSystem`.
- colores, fuentes y `styleFingerprint`.
- inventario por categoría, campaña y tipo de contenido.
- archivos considerados `replicable` (Plantillas + Archivos).
- contenedores de Design System, Plantillas y Estrategia.
- counts y checks de completitud.

Esto sirve para que un agente lea una marca con poco contexto, pero todavía es un digest. No es una especificación completa de cómo reconstruir cada pieza.

### 2.3 Replicación actual

`replicate_brand_strategy` ya:

- valida que A y B existan y sean distintas;
- toma los archivos replicables de A;
- detecta si B no tiene Design System;
- crea opcionalmente una tarjeta de extracción de estilo para B;
- crea una tarjeta Kanban por archivo fuente;
- etiqueta tarjetas con `replica`, `brand:<B>` y `from:<templateId>`;
- permite `dryRun` y evita duplicar tarjetas con el mismo tag.

La implementación termina creando tarjetas en `backlog`. No transforma ni verifica diseños por sí misma.

## 3. Lo que falta para cumplir la promesa

### P0 — La acción actual planifica, pero no ejecuta

La herramienta se llama `replicate_brand_strategy`, pero su salida real es un conjunto de briefs Kanban. El usuario puede creer que ya se replicó cuando todavía no existe ningún archivo nuevo.

Debe separar claramente estos estados:

`planned → approved → extracting_target_style → transforming → rendered → review → accepted / failed`.

El resultado debe incluir IDs de jobs, tarjetas, outputs y errores; nunca solo una frase de éxito.

### P0 — El playbook de A es demasiado resumido

El digest no incluye, por frame o por plantilla:

- propósito, audiencia y canal;
- jerarquía visual y regiones semánticas;
- slots editables y contenido requerido;
- relaciones entre frames de una campaña;
- tokens usados realmente por cada capa;
- estructura de layout, spacing, grid, radios y sombras;
- reglas de imagen, recorte, logos e iconografía;
- copy, CTA, longitud y restricciones del canal;
- motion, duración y variantes de formato;
- assets con licencia, versión y sustituto permitido;
- fuente exacta y hash de la versión analizada.

Sin esa información, «mantener la lógica» significa solo copiar nombres y crear briefs.

### P0 — B no tiene una preparación bloqueante y comprobable

Si B no tiene Design System, se crea una tarjeta de extracción, pero las tarjetas de réplica también quedan en backlog. No existe una dependencia que impida transformar antes de tener tokens de B.

Antes de ejecutar debe validarse:

- Design System de B presente y completo;
- estrategia/voz de B presente cuando se replican contenidos escritos;
- Plantillas de B disponibles cuando la salida depende de formatos curados;
- assets mínimos: logo, paleta, tipografías y recursos permitidos;
- conflictos con un estilo bloqueado o con archivos existentes.

### P0 — No hay separación formal entre estructura de A e identidad de B

La réplica debe tener un contrato explícito:

**Se puede transferir:** propósito, tipo de pieza, jerarquía, número de bloques, relación entre slides, reglas de composición y lógica de campaña.

**Debe sustituirse:** colores, tipografías, logo, iconos, imágenes, copy, CTA, tono, claims, datos, referencias culturales y assets exclusivos de A.

**Requiere decisión humana:** una composición que depende de un asset de A, una oferta no válida para B, una fuente no instalada o un formato sin equivalente.

### P0 — No existe preview ni diff antes de escribir

`dryRun` devuelve títulos y tipos de tarjetas, pero no muestra:

- diferencias de tokens A vs B;
- archivos que se omitirán y por qué;
- campos que requieren contenido nuevo;
- sustituciones de assets;
- previews antes/después;
- riesgos de overflow, contraste, formato o copyright;
- estimación de piezas, tiempo y costo.

El usuario debe aprobar un plan concreto, no un listado abstracto.

### P0 — No existe ejecución idempotente por versión

La deduplicación actual usa `from:<templateId>`. Si cambia A, si cambia B o si cambia el archivo fuente, no se distingue una versión vieja de una nueva.

La clave de una réplica debe incluir:

`workspaceId + sourceBrandId + targetBrandId + sourceTemplateId + sourceHash + targetStyleFingerprint + recipeVersion`.

Una nueva versión debe producir una actualización o una nueva variante explícita, nunca duplicados silenciosos.

### P1 — Falta adaptar copywriting y estrategia

El grafo muestra Copywriting y Estrategia, pero la réplica actual no pasa esas ramas al brief de forma estructurada. Copiar una estructura visual sin adaptar voz, persona, CTA y longitud puede producir una pieza visualmente correcta pero incorrecta para B.

Debe existir un subresultado de contenido por pieza:

- texto fuente y función del bloque;
- texto propuesto para B;
- regla de tono aplicada;
- campos faltantes;
- revisión de claims y CTA.

La IA puede redactar y decidir composición; las tools deben guardar, validar y comparar.

### P1 — Falta resolver assets y formatos

No se define cómo reemplazar:

- logos y variantes;
- imágenes de producto o lifestyle;
- iconos y fuentes;
- videos y música;
- recursos con licencia restringida;
- formatos que existen en A pero no en B.

Cada asset debe tener `sourceAssetId`, `targetAssetId`, estrategia (`reuse`, `replace`, `omit`, `needs_review`) y motivo.

### P1 — Falta verificar la salida final

Cada archivo nuevo necesita:

- render de todos los frames;
- dimensiones y formato correctos;
- ausencia de placeholders;
- presencia de textos obligatorios;
- contraste y overflow;
- tokens de B realmente usados;
- ausencia de nombres, logos o colores prohibidos de A;
- vínculo con la campaña y marca B;
- comparación estructural contra la fuente.

La tarjeta no debe pasar a `done` por haber sido creada. Debe existir evidencia de la verificación.

### P1 — Falta una UI de replicación dentro del Second Brain

Hoy el drawer permite navegar y reconectar, pero no iniciar el journey A → B. Se necesita:

1. botón **Replicar proceso desde esta marca** en la ficha de A;
2. selector exacto de marca B;
3. selector de alcance: todo, campañas, categorías, archivos o plantillas;
4. selector de formatos y cantidad;
5. preview del plan y diff de estilo;
6. botón **Aprobar y ejecutar**;
7. panel de progreso y resultados;
8. enlaces a cada fuente y salida.

### P1 — Falta provenance y recuperación

Cada output debe conservar:

- fuente A, frame fuente y hash;
- marca B y fingerprint aplicado;
- recipe/version del transformador;
- agente y run;
- tokens/assets/copy usados;
- render y checks;
- aprobación humana;
- timestamp y estado.

Un fallo a mitad de lote debe poder reanudarse sin rehacer outputs aceptados.

## 4. Journey objetivo

### Paso 1 — Resolver y cargar contexto

```text
get_brand_playbook(A)
get_brand_playbook(B)
get_brand_strategy(A/B)
get_brand_assets(A/B)
```

Resolver nombres exactos. Si hay ambigüedad, detenerse y mostrar candidatos.

### Paso 2 — Validar preparación

Si B no tiene Design System o no alcanza el umbral de completitud, crear únicamente el job de extracción de B y bloquear las transformaciones dependientes. No marcar la réplica como iniciada.

### Paso 3 — Construir el plan

Para cada archivo de A:

1. clasificar estructura transferible;
2. detectar identidad que debe sustituirse;
3. resolver formato y campaña equivalente;
4. preparar mapping de texto y assets;
5. calcular riesgos;
6. producir preview y diff de tokens.

### Paso 4 — Aprobación

El usuario aprueba todo el plan o selecciona piezas. La aprobación queda registrada con scope y versión.

### Paso 5 — Ejecutar por lotes

Por cada pieza:

1. clonar estructura en un nuevo template;
2. mapear slots y contenido;
3. aplicar Design System de B;
4. sustituir assets;
5. generar/adaptar copy;
6. adaptar formatos;
7. renderizar;
8. ejecutar checks;
9. guardar solo si pasa el contrato.

### Paso 6 — Revisar y cerrar

Entregar un reporte con outputs aceptados, pendientes, errores, omisiones y links. Las piezas dudosas quedan en `review`, no se publican.

## 5. Contratos y nuevas tools sugeridas

### `get_brand_playbook`

Conservar el digest compacto para el router y añadir una opción `detail: "summary" | "replication"`. El detalle de replicación debe incluir versiones, frames, slots, reglas, assets y hashes sin cargar HTML completo si no se necesita.

### `plan_brand_replication`

Entrada:

```json
{
  "workspaceId": "…",
  "sourceBrandId": "…",
  "targetBrandId": "…",
  "scope": { "campaigns": [], "templateIds": [], "categories": [] },
  "formats": [],
  "maxItems": 30
}
```

Salida: `planId`, `items[]`, `tokenDiff`, `assetMapping`, `copyInputs`, `warnings`, `blockedReasons`, `estimatedOutputs`.

### `approve_brand_replication`

Entrada: `planId`, selección de items, decisiones sobre warnings y aprobación humana.

Salida: `runId`, dependencias, checkpoints.

### `run_brand_replication`

Procesa lotes idempotentes y devuelve `sourceTemplateId → targetTemplateId`, estado por item, renders y checks.

### `verify_brand_replication`

Compara fuente y salida en estructura, contenido, tokens, assets, dimensiones y render. Devuelve score y fallos accionables.

### `get_brand_replication_run`

Devuelve progreso, errores, checkpoints y outputs sin volver a cargar todo el contexto.

## 6. Arquitectura de ejecución

- **Determinista:** resolver IDs, cargar contexto, calcular dependencias, clonar, aplicar tokens, persistir, renderizar, verificar e idempotencia.
- **Un modelo:** redactar copy, interpretar propósito, elegir mapping semántico y resolver casos ambiguos.
- **Revisor:** solo cuando el alcance, riesgo o score lo justifique; no ejecutar leader/implementer/reviewer para cada archivo pequeño.
- **Kanban:** representar el trabajo y sus estados, no reemplazar la ejecución ni ser la única evidencia.
- **GraphForge:** documentar visualmente la ruta y sus dependencias; el runtime debe ejecutar el contrato MCP/recipe.

## 7. Criterios de aceptación

- El usuario puede iniciar A → B desde la ficha de A o desde chat con una frase natural.
- A y B se resuelven sin coincidencias difusas silenciosas.
- Si B no está listo, el sistema bloquea la réplica y explica qué falta.
- `dryRun` muestra alcance, diff de estilo, mappings, riesgos y previews.
- La aprobación crea un run reanudable con checkpoints.
- Cada output queda archivado bajo B y enlaza a su fuente A.
- Ningún output aceptado conserva por accidente logo, nombre, color, fuente, copy o asset exclusivo de A.
- Repetir el mismo run no duplica piezas.
- Cambiar la versión de A o el fingerprint de B produce una nueva revisión explícita.
- Cada pieza tiene render y checks registrados antes de pasar a `done`.

## 8. Fuera de alcance inicial

- Aprendizaje autónomo sin aprobación.
- Inferir una estrategia completa de B a partir de una sola pieza.
- Copiar assets con licencias desconocidas.
- Replicar literalmente campañas, claims o datos comerciales de A.
- Convertir el grafo visual en un motor de workflows sin un contrato de ejecución separado.

