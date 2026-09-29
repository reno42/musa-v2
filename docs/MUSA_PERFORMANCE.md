# Medir costo y espera de Musa

La reducción de texto fijo anterior al cambio fue ~76% en diseño (leader + implementer + reviewer). No representa el ahorro facturado de una tarea completa. La medición agregada nueva se guarda sin prompts ni resultados en `chatfab_decisions.notes` cuando `tool_used = '__run_metrics__'`. El campo `message` conserva el mensaje ya registrado por la telemetría del router; el export para entrenamiento debe excluir estas filas. Si Supabase no está disponible, la telemetría falla suave y el trabajo del usuario continúa.

## Estimación antes de reunir una cohorte comparable

Comparación estática entre `9e3e214` y `8dad432`, usando un primer request de cada rol de diseño (leader, implementer, reviewer). Se midieron los caracteres literales de los tres prompts y el JSON de las herramientas que cada rol recibe por defecto; `caracteres / 4` es una aproximación de tokens, no el conteo de un proveedor.

| Material fijo de los tres requests | Antes | Ahora | Reducción |
| --- | ---: | ---: | ---: |
| Prompts | ~5.660 tokens | ~1.183 tokens | ~79% |
| Esquemas de herramientas | ~23.926 tokens | ~6.031 tokens | ~75% |
| **Total fijo inicial** | **~29.586 tokens** | **~7.214 tokens** | **~76%** |

Se eliminan ~22.372 tokens aproximados de material fijo en ese escenario. Para estimar la tarea completa, sumar los tokens **variables** (conversación, respuestas de herramientas, HTML/CSS y salida del modelo) a ambas columnas. Si fueran iguales en ambos flujos, 15.000 variables darían ~50% de reducción total; 30.000, ~38%; 60.000, ~25%. **Titular provisional para una tarea de diseño con 30.000 tokens variables: ~35–40% menos tokens totales.** Es un escenario de planificación, no un resultado observado ni un promedio de todos los módulos. Variaciones en rondas, rutas directas, reintentos y calidad pueden moverlo bastante.

La telemetría nueva mide el flujo actual; por sí sola no reconstruye el contrafactual anterior. Para validar el porcentaje hay que comparar tareas equivalentes en el mismo modelo/proveedor contra trazas anteriores completas o reproducir una muestra fija con el commit anterior, y contar solo entregas verificadas. `cachedInputTokens` permite calcular costo facturado con la tarifa de caché; paralelismo y streaming pueden reducir espera sin reducir tokens.

## Campos de cada turno

`latency_ms` mide el turno completo; `notes.firstModelResponseMs` mide la primera respuesta **completa** del modelo. `notes.firstTokenMs` mide el primer fragmento visible cuando el proveedor usa streaming (DeepSeek, OpenAI, Gemini y Anthropic en el ChatFAB); es `null` cuando no hay streaming o no llega texto parcial. `notes.inputTokens`, `outputTokens` y `cachedInputTokens` suman leader y delegaciones. `tokenCountKind = partial` señala que faltó `usage` de algún proveedor. `leaderRounds`, `toolCalls` y `delegatedRuns` muestran dónde se gastan viajes. `completed` significa que el turno terminó sin error de proveedor, límite de rondas o cancelación; para evaluar calidad se debe comprobar aparte el artefacto y sus checkpoints.

## Experimento local de latencia y contexto (29 de septiembre de 2026)

Con `QA/router-cold-latency-benchmark.mjs` y el bootstrap del modelo artificialmente pendiente en Chromium, el primer pedido con LLM disponible esperó 1.509 ms antes del cambio y 1 ms después. Sin llave de LLM conserva hasta 1.500 ms de espera para no perder acciones directas que el router resuelve localmente. La inferencia con el router ya cargado conserva su presupuesto de 1.500 ms. El benchmark requiere el servidor Vite local; no mide tiempo de proveedor ni calidad de respuesta.

Con `QA/musa-performance-benchmark.mjs` se simularon 28 rondas consecutivas con resultados de herramienta de 5.200 caracteres. La política anterior (~70.000 tokens por request antes de compactar) acumuló 869.327 tokens **aproximados de entrada**; la nueva (~28.000 como objetivo, preservando intercambios atómicos y el manifest) acumuló 509.611: 41,4% menos en ese fixture. No es ahorro medido en facturación ni extrapolable a tareas cortas. Una respuesta reciente grande puede superar el objetivo para conservar información necesaria.

El cambio no elimina el reviewer exigido por el cierre C1-C5. Para probar un flujo de diseño con menos modelos hace falta una muestra pareada de artefactos reales con comprobaciones visuales y de persistencia; un benchmark sintético de tokens no demuestra equivalencia de calidad.

Las sesiones del harness siguen registrando eventos por subagente en `harness_runtime_events`; su evento final incluye `cachedInputTokens` en metadata. Las filas de métricas están marcadas `variant = optimized-v2` para comparaciones futuras.

## Consulta de referencia

```sql
select
  notes::jsonb->>'variant' as variant,
  count(*) as turns,
  round(avg((notes::jsonb->>'inputTokens')::numeric)) as avg_input_tokens,
  round(avg((notes::jsonb->>'outputTokens')::numeric)) as avg_output_tokens,
  percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from public.chatfab_decisions
where tool_used = '__run_metrics__'
  and notes::jsonb->>'tokenCountKind' = 'actual'
group by notes::jsonb->>'variant';
```

Comparar por módulo, proveedor y tamaño de tarea. Para calidad, usar una muestra fija de briefs: post único, grilla de tres meses, grilla→diseños, edición de template, motion y CRM. Contar solo tareas con entrega verificada, no respuestas narradas. Medir costo por tarea terminada, tiempo p50/p95 y duración hasta el primer avance visible. No prometer porcentajes adicionales hasta disponer de esta comparación.

## Decisiones de arquitectura

- Un modelo con herramientas ya resuelve copywriting, motion, contactos y configuración. Un pedido compuesto pasa IDs entre módulos.
- Diseño estático conserva implementer y reviewer mientras `harness_complete_feature` exija sus sesiones y C1–C5. El leader debe limitarse a decidir la ruta y el contrato, sin generar por segunda vez la pieza. Quitar el reviewer requiere una verificación automática equivalente y cambiar el gate del servidor con pruebas de calidad.
- Las lecturas independientes se pueden paralelizar; las mutaciones y el descubrimiento de herramientas no. Los listados paginables de templates y calendario se compactan solo en el contexto del modelo; si faltan filas, el agente debe repetir la consulta con `search`/`offset` o un rango de fechas más estrecho.
- El leader muestra texto conforme llega por SSE para DeepSeek, OpenAI, Gemini y Anthropic. Acumula por completo las llamadas a herramientas y ejecuta sus argumentos solo al terminar el stream; una interrupción deja el turno en error sin ejecutar JSON parcial. Los proveedores restantes mantienen el flujo JSON actual.
- El siguiente experimento es una cohorte de diseño simple con orquestación más directa y checks automáticos, comparada con el flujo actual. No activar por defecto hasta comprobar calidad y ahorro.
