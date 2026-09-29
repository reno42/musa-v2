# Medir costo y espera de Musa

La reducción de texto fijo anterior al cambio fue ~76% en diseño (leader + implementer + reviewer). No representa el ahorro facturado de una tarea completa. La medición agregada nueva se guarda sin prompts ni resultados en `chatfab_decisions.notes` cuando `tool_used = '__run_metrics__'`. El campo `message` conserva el mensaje ya registrado por la telemetría del router; el export para entrenamiento debe excluir estas filas. Si Supabase no está disponible, la telemetría falla suave y el trabajo del usuario continúa.

## Campos de cada turno

`latency_ms` mide el turno completo; `notes.firstModelResponseMs` mide la primera respuesta **completa** del modelo. `notes.firstTokenMs` mide el primer fragmento visible cuando el proveedor usa streaming (DeepSeek en el ChatFAB); es `null` en los demás. `notes.inputTokens`, `outputTokens` y `cachedInputTokens` suman leader y delegaciones. `tokenCountKind = partial` señala que faltó `usage` de algún proveedor. `leaderRounds`, `toolCalls` y `delegatedRuns` muestran dónde se gastan viajes. `completed` significa que el turno terminó sin error de proveedor, límite de rondas o cancelación; para evaluar calidad se debe comprobar aparte el artefacto y sus checkpoints.

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
- El leader de DeepSeek muestra texto conforme llega por SSE. Acumula por completo las llamadas a herramientas y ejecuta sus argumentos solo tras `finish_reason` y `[DONE]`; una interrupción deja el turno en error sin ejecutar JSON parcial. Los demás proveedores mantienen el flujo JSON actual.
- El siguiente experimento es una cohorte de diseño simple con orquestación más directa y checks automáticos, comparada con el flujo actual. No activar por defecto hasta comprobar calidad y ahorro.
