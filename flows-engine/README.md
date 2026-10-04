# flows-engine — port del flow builder (xiaozhi-musa) para Musa Workers

Motor extraído del bridge local de Ren (`xiaozhi-musa`): builder de flujos visual + newsroom.
Cero dependencias de Windows/bridge: los nodos son puras llamadas de red (HTTP, RSS, IA cloud, MCP de Musa).

## Contenido (src/)
- `automation-flow-engine.mjs` — motor del builder: flujos JSON (triggers manual/webhook/schedule), nodos http / ai / tool / map / condition / text, credenciales BYOK, historial de runs, SSRF-guard (bloquea IPs internas, exige HTTPS público), cron (croner).
- `automation-ai.mjs` — nodos IA cloud-native (Gemini / DeepSeek / GLM por HTTP, BYOK).
- `newsroom-pipeline.mjs` — pipeline de noticias: RSS/Nitter → redacción → diseños en Musa (via MCP tools musa__*).
- `newsroom-flows.mjs`, `newsroom-nitter-source.mjs` — config y fuente Nitter del newsroom.
- `runtime-store.mjs` — store atómico JSON (en Workers se reemplaza por D1/KV, ver REQ-027).
- `config.mjs` — stub (en Workers: env vars).
- `flows-mcp.mjs` — servidor MCP de referencia (stdio) que expone flow_list/flow_get/flow_run/flow_history + newsroom_*. En Musa esto vive dentro del endpoint /mcp existente.

## Status
- Probado local en Node 22: engine carga, flow_list OK, newsroom build E2E hasta Musa (RSS BBC → 2 noticias → diseño) con fix de contrato callTool (devolver {content, isError} bruto).
- Pendiente para Workers: parser RSS propio (rss-parser usa XML DSM, no corre en CF), storage D1/KV en vez de fs, MCP HTTP tools en /mcp.
