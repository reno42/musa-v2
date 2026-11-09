---
name: musa-redes
description: Redes sociales en Musa. Publicar o programar piezas del calendario en las cuentas conectadas, responder comentarios y mensajes de la bandeja, convertir a quien escribe en contacto del CRM y ver qué piezas generaron conversaciones. Úsala para publicar y para conversar con la comunidad.
module: conversar
---

# Redes · publicar y conversar

## Qué hay en el módulo

- **Publicar**: cada pieza del calendario se publica o programa en sus destinos reales (vía Zernio o Buffer). Dos cuentas de Instagram son dos destinos distintos.
- **Musa Publisher** (publicador propio, convive con Zernio): diseños como imagen en 23 redes (Instagram, Facebook, LinkedIn, X, Threads, Bluesky, Pinterest, Reddit, Google Business, Mastodon, Telegram, Discord, Slack, WordPress, Ghost, Blogger, DEV, Hashnode, Listmonk, Notion, Gumroad, Luma). Se configura en Configuración › Publicar o por MCP con las herramientas `publisher_*` (mismo código y permisos que la pantalla). Para agencias, cada cuenta va asignada a un cliente (marca), un login trae todas sus páginas y se le puede mandar al cliente un enlace para que conecte sus cuentas.
- **Conversar › Bandeja**: comentarios y mensajes directos de todas las redes conectadas en un solo lugar.
- **Conversar › Comentarios**: comentarios internos sobre piezas y diseños (ver `comment_*` en `musa-diseno-biblioteca`).

## Flujos

**Publicar o programar una pieza**
1. La pieza debe existir en el calendario con copy (skills `musa-planear` y `musa-copy`) y, si lleva imagen o video, con su diseño o `mediaUrl`.
2. `list_social_accounts({ workspaceId })` → destinos reales con su id.
3. Confirma con la persona: pieza, cuentas, fecha y hora.
4. `publish_content({ workspaceId, contentId, mode: "now" | "schedule", accountIds, contentType: "post" | "story" | "reel", scheduledFor: "2026-11-10T09:00:00", timezone })`.
5. Stories y reels necesitan Zernio y un archivo (`mediaUrl` HTTPS de la imagen o el video).
6. Si falla y quieres reintentar, se usan los mismos destinos; para cambiarlos, duplica la pieza.
- `set_publish_defaults({ provider, accountIds, brandId? })` guarda los destinos por defecto (del espacio o de una marca).

**Conectar redes del Publisher (sin la pantalla)**
1. `list_publisher_networks()` → por red: `kind`, `fields` (claves exactas), `setup`, `notes`, `appKey`, y `redirectUri`.
2. Redes con llave (`kind: "token"`: Telegram, Discord, Slack, Bluesky, Mastodon, WordPress, Ghost, DEV, Hashnode, Listmonk, Notion, Gumroad, Luma): pide a la persona sus datos y llama `publisher_connect_token({ provider, input: { <clave>: <valor> }, brandId? })`. Musa valida contra la red, cifra y devuelve la cuenta.
3. Redes OAuth (Instagram, Facebook, LinkedIn, X, Threads, Pinterest, Reddit, Google Business, Blogger): primero `publisher_save_app({ app: appKey, client_id, client_secret })` (la persona registra `redirectUri` en el portal de la red). Luego `publisher_connect_link({ provider, brandId? })` → enlace de 7 días y un uso que el dueño de la cuenta abre y aprueba una vez (ninguna API se salta ese «Permitir»). Después `list_publisher_accounts()`.
4. Notas: Luma exige Luma Plus; con evento manda un correo a sus invitados, sin evento crea un evento privado. Gumroad envía un correo a seguidores/clientes/todos. Notion crea una página en la página o base compartida con la integración.

**Publicar con el Publisher**
1. La imagen debe ser un archivo público de Musa (`render_frame_png` o `upload_image`).
2. `list_publisher_accounts()` → ids. Confirma con la persona cuentas y texto.
3. `publisher_publish({ account_ids, media_url, media_mime: "image/png", caption, captions?, mode: "live" })` (sin `mode` = prueba). Si `remaining > 0`: `publisher_continue_job({ jobId })`. Resultado por destino: `get_publisher_job`.
4. Reintentar solo si la persona lo pide: `publisher_retry_job({ jobId })`.

**Atender la bandeja**
1. `list_social_inbox({ workspaceId, status: "pending" })`.
2. Responde con la voz de la marca (`get_brand_strategy`): `reply_social({ workspaceId, itemId, content })`.
3. Si es un posible cliente: `capture_social_contact({ workspaceId, itemId })` lo crea en el CRM; sigue en `musa-vender`.
4. Lo raro, las quejas o las crisis: no respondas; asígnalo a alguien del equipo con `inbox_update({ itemId, assignedTo })` y avísale a la persona.
5. Lo resuelto: `inbox_update({ itemId, status: "done" })`; spam o irrelevante: `status: "hidden"`.

**¿Qué pieza trajo conversaciones?**
- `get_attribution_report({ workspaceId, campaign?, contentId?, from, to })`: atribución pieza → conversación con nivel de confianza.

## Herramientas

- `list_social_accounts`: cuentas conectadas y sus destinos reales.
- `set_publish_defaults`: destinos por defecto del espacio o de una marca.
- `publish_content`: publica ahora o programa una pieza del calendario.
- `list_social_inbox`: comentarios y mensajes pendientes.
- `reply_social`: responde un comentario o mensaje.
- `capture_social_contact`: autor del mensaje → contacto del CRM.
- `inbox_update`: marcar resuelto, ocultar o asignar a una persona del equipo.
- `get_attribution_report`: qué piezas generaron conversaciones.
- `list_calendar_entries`, `update_content`: leer y ajustar la pieza antes de publicar.
- Publisher: `list_publisher_networks`, `list_publisher_apps`, `publisher_save_app`, `publisher_delete_app`, `publisher_connect_token`, `publisher_connect_link`, `list_publisher_accounts`, `publisher_update_account`, `publisher_check_account`, `publisher_disconnect_account`, `publisher_publish`, `list_publisher_jobs`, `get_publisher_job`, `publisher_continue_job`, `publisher_retry_job`.

## Reglas

- **Publicar siempre con confirmación de la persona.** Musa no publica solo (ni Zernio ni el Publisher programan envíos automáticos).
- El Publisher solo publica imágenes; video, TikTok y YouTube todavía no.
- Programar exige fecha futura y zona horaria.
- No respondas temas sensibles (reclamos, precios especiales, crisis) sin una persona.
- Conectar cuentas: Zernio/Buffer en Configuración › Integraciones; el Publisher en Configuración › Publicar o con `publisher_connect_*`. Nunca muestres de vuelta las llaves que te pasa la persona.

## Ejemplos

- "Programa las piezas aprobadas de esta semana de Kuna en Instagram y LinkedIn"
- "Responde los comentarios pendientes de Café Altura con su tono"
- "Pasa al CRM a las personas que preguntaron por precios"
- "Conecta mi Notion y mi Telegram al publicador y publica este diseño en ambos"
