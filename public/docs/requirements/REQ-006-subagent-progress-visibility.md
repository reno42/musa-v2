# REQ-006: Visibilidad y auditoría del progreso de subagentes

**Estado:** implementado; migración v17 aplicada manualmente en Supabase
**Prioridad:** P1 alta
**Fecha:** 7 de agosto de 2026

## Diagnóstico

`harness_delegate_task` no estaba necesariamente muerto. El implementer seguía
haciendo requests y tools, pero el `await` del Leader ocultaba toda actividad
intermedia. Un timeout seguido de backoff, quince rondas o una compactación se
veían igual: una fila en `running` durante varios minutos.

Eso explica la sensación de cuelgue, pero no explica por sí solo la degradación
del diseño. El caso observado —un post blanco en lugar de tres slides, medidas
incorrectas, sin contenido y sin el estilo solicitado— es un fallo de
completitud/calidad distinto. REQ-006 hace ese fallo auditable; no lo corrige por
el mero hecho de mostrar logs.

## Alcance implementado

### Progreso local en tiempo real

`spawnSubagent` emite un callback tipado en las transiciones:

- `starting`
- `thinking`
- `executing_tool`
- `retrying`
- `compacted`
- `done`
- `error`
- `cancelled`

Cada evento incluye `runId`, rol, ronda, máximo de rondas, tiempo, provider,
modelo, tool/call actual, intento, tokens de entrada/salida/acumulados,
`actual | estimated`, sesión y artifacts conocidos. La UI actualiza la misma
fila mediante un ID estable; nunca modifica “el último elemento” por índice.

El reloj visible avanza cada segundo mientras el request está activo. No genera
heartbeats persistentes. Al finalizar, el chat conserva un resumen compacto con
duración, tokens, rondas y cantidad de artifacts.

### Retry, timeout, deadline y cancelación

- Timeout máximo por request al provider: 75 segundos.
- Como máximo un retry después de timeout.
- Como máximo dos retries totales para errores reintentables.
- Deadline total: 5 minutos para implementer y 3 minutos para reviewer.
- El backoff reserva tiempo real para ejecutar el siguiente intento.
- `Detener` propaga `AbortSignal` a provider y MCP.
- Error, cancelación y deadline cierran la sesión best-effort sin cancelar la
  escritura terminal de telemetría.

### Auditoría durable

La migración v17 crea `harness_runtime_events`, un stream append-only con cursor
monótono e idempotencia por `(account_id, client_event_id)`. También amplía los
estados terminales de `harness_sessions` con `failed`, `cancelled` y
`timed_out`.

Tools MCP nuevas:

- `harness_record_runtime_event`
- `harness_get_runtime_events`
- `harness_list_sessions`
- `harness_finish_session`

El cliente persiste transiciones importantes en segundo plano. Si la migración
todavía no está aplicada o Supabase no responde, el diseño continúa con
visibilidad local; la telemetría durable es best-effort y no bloquea el loop.

## Seguridad y multiusuario

- Ninguna tool acepta `accountId`; el servidor lo deriva de la sesión
  autorizada.
- Todo acceso pasa por `assertHarnessAccess` y por RLS de cuenta.
- Los eventos no guardan prompts, instrucciones, argumentos de tools, HTML,
  CSS, credenciales ni API keys.
- Los strings permitidos se limitan, sanean y redactan también en servidor.
- `metadata` usa una allowlist de campos escalares.
- Solo existen policies RLS de `SELECT` e `INSERT`; no hay update/delete de
  eventos.

Los writes se serializan por `runId`: el cursor durable conserva el orden
lógico start → requests/tools/retries → terminal, aunque una llamada de red
tarde más que otra. `done` significa que terminó el loop del subagente; no
equivale a que el contrato P0 haya pasado. La verificación posterior actualiza
la misma fila visible de `delegate_task` a `done` o `error` según el resultado
contractual final.

`harness_finish_session(completed)` es exclusivo del reviewer. El implementer
solo puede cerrar con éxito mediante `harness_submit_for_review`, que crea el
marker durable usado para definir la frescura del ciclo de review. Un reviewer
solo se autocierra cuando emite el veredicto explícito `CHANGES_REQUESTED`;
`APPROVED` o un texto ambiguo conserva la sesión activa para que el Leader llame
`harness_complete_feature`.

## UX y accesibilidad

Las filas de actividad usan botones nativos de disclosure con
`aria-expanded`/`aria-controls`. El estado activo usa `role=status` y
`aria-live=polite`. “Copiar logs” espera el resultado del clipboard y comunica
éxito o error junto al botón. Los detalles permanecen seleccionables y no
incluyen payloads sensibles.

## Relación con la recuperación P0

La recuperación P0 se implementó por separado y no debe confundirse con esta
observabilidad. Incluye contrato fail-closed, conteo exacto de artifacts/frames,
provenance de creators, validación de texto visible por frame, aplicación real
del estilo solicitado, carrusel atómico, compactación que conserva pares de
tool calls/results y verificación posterior del artifact.

REQ-006 permite comprobar en qué ronda se consultó un estilo, qué tools se
ejecutaron, cuándo hubo retry/compactación y con qué resultado terminal. Los
gates P0 son los que impiden declarar éxito cuando solo existe un cuadrado
blanco o falta cualquiera de los tres slides.

## Criterios de aceptación

- [x] Una delegación muestra rol, estado, tiempo, ronda y tokens mientras corre.
- [x] Se distingue conteo real del estimado.
- [x] Retry y compactación son transiciones visibles y persistibles.
- [x] Las actualizaciones concurrentes usan IDs estables.
- [x] Timeout, deadline y cancelación tienen resultado terminal explícito.
- [x] El resumen final queda en el chat y los logs no se borran al terminar.
- [x] Los logs se pueden expandir y copiar con feedback accesible.
- [x] Los eventos durable son idempotentes, paginables por cursor y aislados por
  cuenta.
- [x] No se persiste contenido de diseño ni secretos.
- [x] Hay pruebas adversariales para timeout/retry, abort, usage, sanitización,
  schemas, tenancy, cursor, idempotencia, migración y RLS.

## Puesta en producción

1. Desplegar MCP y frontend del mismo commit.
2. Ejecutar una delegación implementer y una reviewer.
3. Confirmar progreso local, eventos ordenados por cursor y cierre terminal.
4. Auditar el siguiente fallo de calidad comparando el contrato con la
   secuencia de tools; no asumir que “hubo actividad” equivale a “diseño
   completo”.
