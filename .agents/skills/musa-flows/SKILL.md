---
name: musa-flows
description: Crear, ejecutar, programar o depurar flujos automatizados en Musa. Úsalo para flujos con fuentes, IA y plantillas; no para piezas sueltas sin automatización.
---

# Flows en Musa

Identifica el resultado que el flujo produce (carrusel de noticias, vigilancia, digest) y la plantilla con frame exacto que lo materializa; si el usuario no los eligió, lista sus archivos y frames antes de guardar. Los triggers `schedule` son declarativos: el servidor no agenda nada. Si el usuario pide horario, programa tú la ejecución con tu propio cron y llama `flow_run` al disparar, con `requestId` `cron:<flowId>:<slot de 5 min>` para que los reintentos no dupliquen runs.

Guarda con `flow_save` validando el grafo conexo y los contratos de nodo; usa `credentialId` en lugar de secretos en la config. Divide cargas grandes en corridas de pocos ítems: cada `flow_run` es una invocación corta y varias corridas orquestadas escalan mejor que una enorme. Tras ejecutar, lee `flow_history` nodo por nodo; corrige el nodo fallido con `flow_save` sobre el mismo id y repite. Un run que termina reporta ids y enlace reales; si `flow_history` muestra un feed vacío, propón fuente alterna en vez de reintentar igual.

## Ejemplos

- "Crea un flow que tome las noticias del RSS de hoy y genere carruseles con mi plantilla de noticias"
- "Ejecuta ahora el flow de testimonios y enséñame qué produjo y si algo falló"
- "Programa el flow de noticias para que corra todos los días a las 8 am hora de Lima"
