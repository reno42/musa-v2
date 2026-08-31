# REQ-011 — Aceptar la API key por query string (desbloquear Claude "Conectores")

Status: Done (deployed `d88f214`, 25 ago 2026)
Priority: Alta
File: netlify/functions/mcp.mjs
Lines: ~4441 (getUserId), ~4600 (checkAuth)

## Problema

El endpoint MCP (`https://design.futuraria.com/mcp`) solo acepta la llave en el
header `x-api-key`. El formulario "Agregar conector personalizado" de Claude (web
y el nuevo UI de escritorio) NO tiene campo para headers arbitrarios — solo pide
URL + nombre (y en avanzado, OAuth Client ID/Secret). Resultado: Claude no puede
mandar `x-api-key` y recibe 401 en `tools/call`.

Evidencia (probado empíricamente el 25 ago 2026):

| Método | Resultado |
|---|---|
| header `x-api-key` | 200 OK |
| header `Authorization: Bearer` con la key | 401 |
| `?key=`, `?api_key=`, `?token=`, `?x-api-key=` en la URL | 401 (no se leen hoy) |
| sin auth | 401 |

## Solución

Leer la key también desde el query string, como FALLBACK del header (el header
sigue teniendo prioridad).

1. Agregar un helper al lado de las funciones de auth:

```js
function getApiKey(event) {
  const headers = event.headers || {};
  if (headers["x-api-key"]) return headers["x-api-key"];
  const qs = event.queryStringParameters || {};
  return qs["x-api-key"] || qs.key || qs.api_key || qs.token || "";
}
```

2. En `getUserId` (~línea 4441), reemplazar:

```js
const apiKey = headers["x-api-key"];
```
por:
```js
const apiKey = getApiKey(event);
```

3. En `checkAuth` (~línea 4600), reemplazar:

```js
const apiKey = headers["x-api-key"] || "";
```
por:
```js
const apiKey = getApiKey(event);
```

## Notas de seguridad

- El header `x-api-key` sigue teniendo prioridad; query es solo fallback.
- Las keys en URL pueden quedar en logs de Netlify → usar keys por workspace,
  dedicadas, y rotarlas si quedan expuestas (ya hay `create_api_key` /
  `revoke_api_key` / `list_api_keys` y el tool público `verify_api_key`).
- NO tocar la lógica de validación actual (`validateApiKey` contra la tabla
  `api_keys`, ni el admin key). Solo cambia DE DÓNDE se lee la key.

## Verificación

1. Deploy a Netlify.
2. POST `https://design.futuraria.com/mcp?key=<key_válida>` con
   `tools/call { name: "list_workspaces" }` SIN header → esperado 200 y devuelve
   el workspace del dueño de la key.
3. POST sin key ni header → sigue 401 (no romper el camino actual).
4. POST con header `x-api-key` → sigue 200 (header con prioridad).

## Resultado esperado para el usuario

Gabriela conecta Claude (web o escritorio) con:
- URL: `https://design.futuraria.com/mcp?key=SU_KEY_DE_WORKSPACE`
- Nombre: `Futuraria Design`

Y Claude puede llamar las tools de diseño directamente.
