# REQ-005: Subagent conversation truncation breaks message pair integrity

**Status:** `backlog`
**Priority:** `P0 — critico`
**File:** `src/components/ChatFAB.tsx`
**Lines:** 1103-1108

---

## Problema

Cuando la conversacion del subagente supera 15 mensajes, el codigo la recorta
asi (lineas 1103-1108):

```typescript
if (subConv.length > 15 && round > 3) {
    subConv = [
        subConv[0],                                          // primer msg
        { role: "user", content: "[Conversación recortada]" }, // nota
        ...subConv.slice(-10),                               // ultimos 10
    ];
}
```

Si entre los ultimos 10 mensajes hay un `role: "tool"` cuyo `assistant`
precedente (el que emitio los `tool_calls`) quedo en la parte descartada, el
array enviado a DeepSeek/OpenAI queda corrupto:

```
[user_init, nota_recorte, tool_huerfano, tool_huerfano, ...]
```

**DeepSeek rechaza el payload con 400:**
> `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`

## Evidencia (harness_error_logs, 7 Ago 2026)

5 errores identicos en ~20 minutos, todos con el mismo mensaje:
```
Subagent 400: Messages with role 'tool' must be a response to a preceding 
message with 'tool_calls'
```

## Solucion

En lugar de `slice(-10)` ciego, garantizar que el nuevo array empiece con un
mensaje `user` o `assistant` (nunca `tool`), eliminando cualquier `tool`
huerfana del inicio:

```typescript
if (subConv.length > 15 && round > 3) {
    const tail = subConv.slice(-10);
    // Eliminar tools huerfanas del inicio
    while (tail.length > 0 && tail[0].role === "tool") {
        tail.shift();
    }
    subConv = [
        subConv[0],
        { role: "user", content: "[Conversación recortada para mantener contexto. Continúa tu tarea.]" },
        ...tail,
    ];
}
```

## Alternativa mas robusta

En vez de truncar, hacer un resumen preventivo ANTES de que la conversacion
crezca. Pero el fix con `while` es inmediato, seguro, y no cambia el
comportamiento general.

## Verificacion

1. Forzar una tarea de diseno que requiera 12+ tool calls del implementer
2. Verificar que el subagente complete sin error 400
3. Verificar que `harness_error_logs` no reciba nuevos errores de "tool_calls"

## Relacionado

- REQ-004: capturedTemplateIds blind spot (mismo archivo, mismo metodo)
- Bug DeepSeek 400 reportado por Renzo 7 Ago 2026 ~03:20 UTC
