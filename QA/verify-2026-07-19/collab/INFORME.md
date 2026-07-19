# Verificación EN VIVO — Co-creación humano+IA sobre el mismo documento (PRODUCCIÓN)

- **Fecha**: 2026-07-19 (09:58–10:31 UTC)
- **Entorno**: https://design.futuraria.com (MCP en `/mcp`, 157 tools vivas)
- **Sujeto**: template desechable `verify-c-collab` (`tpl_d7438478-ef6`, workspace `verify-a2-ws`), 3 frames HTML con texto simple, creado y **borrado** vía MCP (verificado con `list_templates`: 1 → 0).
- **Método**: scripts `00–07,99` en este directorio (puppeteer-core sobre Chrome del sistema, MCP JSON-RPC). Screenshots numerados en `shots/`, logs con timestamps en `logs/`. No se editó código fuente.
- **Notas de setup**:
  - El `.env` del workspace **no contiene ninguna key `fdr_*`**; producción corre en **modo accept-all** (`MCP_ADMIN_KEY` no seteada → `tools/call` responde sin key; verificado con `list_workspaces` sin header). Se sembró `futuraria-api-key=dev-key` en localStorage (default documentado) y el editor funcionó. **La API key nunca se imprimió.**
  - El bundle de producción (`/assets/index-aPT1aMHh.js`) **no contiene `supabase.co`** (0 ocurrencias) → el frontend se compiló **sin `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`** → no hay canal Realtime ni de presencia en prod; el editor cae al polling de 5s.

## Tabla de resultados

| # | Ítem | Estado | Evidencia clave |
|---|------|--------|-----------------|
| 1 | AI-WRITE-NOT-LIVE | **VERIFICADO** | Probe MCP `MCP-LIVE-PROBE-1` invisible 12s en el editor abierto (6 sondeos DOM, screenshots `02` idéntico a `01` — mismo tamaño en bytes); tras `reload()` aparece (`03`). Persistido en servidor desde el primer momento. |
| 1b | (extra) ¿salva el polling? | **NO** | Con probe tardío (12s tras carga, baseline ya cebado) tampoco aparece en 20s. Causa raíz: `lastRemoteUpdate` es **stale closure** (`useState` capturado por el `setInterval`, deps `[templateId, selectedFrameId]`) → el branch que aplica cambios remotos nunca se ejecuta (`EditorV2.tsx:492-562`). MCP sí bumpea `metadata.updatedAt` (10:04:25→10:05:16, medido vía `/api/templates/:id`). |
| 2 | LAST-WRITE-WINS | **VERIFICADO** | 2 PUTs interceptados (`logs/item2b-puts.json`): ambos llevan los 3 frames completos con `frame2.html = AI-BASE` (stale) aunque el humano solo arrastró una card en frame1. `MCP-PROBE-2` existía server-side (10:14:38) y fue pisado por el PUT #2 (10:14:43, HTTP 200, sin aviso). Ningún PUT llevó `PROBE-2`. Bonus: el drag viaja en **CSS** (`left:100px !important`), no en el html inline. |
| 3 | PRESENCE | **VERIFICADO** | Panel "Active Agents → **No agents connected**" (screenshot `01-item3`); `get_active_agents` → `[]`. Estático: `trackPresence` solo se define (`supabaseRealtime.ts:87`), **0 callers** en `src/`; y sin Supabase en el bundle ni siquiera se crea el canal. |
| 4 | CLAIM-NO-ENFORCE | **VERIFICADO** | `claim_section(verify-agent)` OK (TTL 60s); `update_html_frame` **sin claim** sobre ese frame → **ÉXITO** (no 409), contenido `WRITE-SIN-CLAIM` persistido. Extra: `claim_section` de otro agente sí da **409** (los claims solo gatean otros claims). `release_section` OK. |
| 5 | BROWSER↔BROWSER | **REFUTADO** | ctx1 drag +300px (DOM 40→340); ctx2 sondeado 15×1s: **nunca se movió** (screenshots `02`/`04` idénticos en bytes). Sin Supabase en el bundle no hay broadcast; el polling está roto (1b). La infra cliente existe en código (`broadcastChange` tras el PUT, `EditorV2.tsx:460`) pero está **inerte en prod**. |
| 6 | MULTI-TAB | **VERIFICADO (comportamiento documentado)** | (a) tab2 no se actualiza en 8s tras editar tab1 (mismo perfil, sin listener `storage` ni BroadcastChannel). (b) Carrera <5s: **gana tab2 (último PUT)** — el CSS final del servidor solo tiene la regla de `tab_card`; el movimiento de `hum_card` de tab1 se perdió silenciosamente. |
| 7 | RESTORE-RESCATE | **VERIFICADO** | Tras romper frame1 (`###ROK3N###`, confirmado server-side): `restore_version(versionId=ver_0b778408-5e6)` → **`-32000 Version has no canvas data`**; `restore_version(version=1)` → **`-32000 Version not found: undefined`**. El template siguió roto. Las 25 versiones son "HTML save" pero se restaura `canvas` (null en templates HTML), no `frames` (`mcp.mjs:3289-3318`). El rescate **manual** (re-escribir frames vía `update_template`) sí funciona. |
| — | CLEANUP | **OK con nota** | `delete_template` OK; `list_templates` 1→0. Nota: es **soft-delete** (`get_template` por id aún responde) y no existe tool MCP de purge; es el máximo borrado alcanzable vía MCP. |

## Veredicto final

**No: hoy un humano y una IA NO pueden co-crear en el mismo documento sin perder datos.** La IA escribe a ciegas (el humano no ve sus cambios hasta recargar: no hay realtime en prod y el polling de respaldo está roto por un stale closure) y, peor, cualquier autosave del humano manda el template completo *stale* por PUT y **pisa el trabajo de la IA sin aviso ni conflicto** (HTTP 200). Claims y presencia son decorativos (no gatean escrituras; `trackPresence` nunca se llama) y `restore_version` no restaura frames HTML. La pieza exacta que falta es doble: **(1) que el servidor emita un evento de cambio tras cada escritura MCP** (broadcast Supabase o invalidación que el editor aplique — la infra cliente ya existe pero está apagada sin `VITE_SUPABASE_*`), y **(2) que el editor deje de hacer PUT del template completo** — escritura por frame modificado o control de versión (etag/If-Match → 409) para que un save stale nunca sobrescriba trabajo ajeno. Con solo (1)+(2), los ítems 1, 2, 5 y 6 cambian de veredicto.

## Archivos

- Scripts: `lib.mjs`, `00-setup.mjs`, `01-ai-write-not-live.mjs`, `01b-polling-timing.mjs`, `02-last-write-wins.mjs`, `02b-last-write-wins-intercept.mjs`, `03-presence.mjs`, `04-claim-no-enforce.mjs`, `05-browser-browser.mjs`, `06-multi-tab.mjs`, `07-restore-rescate.mjs`, `99-cleanup.mjs`
- Screenshots: `shots/` (21, numerados por ítem)
- Logs: `logs/run-*.log` (timestamps ISO por evento), `logs/item2b-puts.json` (payloads PUT interceptados)
