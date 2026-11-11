---
name: musa-qr
description: Códigos QR en Musa. QR dinámicos (enlace corto que redirige y cuyo destino se cambia sin reimprimir, se pausa y cuenta escaneos) y fijos (Wi‑Fi, contacto vCard, correo, llamada, SMS, texto), con los colores y el logo de la marca. El QR de cualquier cosa de Musa: un diseño o presentación para ver y descargar sin cuenta, un website, un evento, un formulario, un brief o una cotización. Úsala para flyers, stands, empaques, menús, tarjetas, eventos y todo lo impreso que lleve a algo digital.
module: crear
---

# Códigos QR

## Qué hay en el módulo

- **Crear › Códigos QR**: la biblioteca del espacio con todos los QR, sus escaneos (por día, país y tipo de equipo, sin datos de la persona) y su estado.
- **Botón «Código QR»** en cada cosa compatible: diseños y presentaciones (editor › Compartir), websites, eventos (pestaña Página), formularios, briefs y cotizaciones (al compartir el enlace). Cada cosa tiene UN QR: pedirlo otra vez devuelve el mismo, así el impreso nunca cambia.
- **Insertar QR en un diseño** (editor › Importar › Código QR): lo pega como imagen vectorial en el frame.
- **Dinámico** (`url`, `whatsapp`): el código lleva `<musa>/r/<código>`. Al escanearlo, Musa redirige al destino actual y suma el escaneo. Se cambia el destino o se pausa sin reimprimir. **Fijo** (`wifi`, `email`, `phone`, `sms`, `text`, `vcard`): el contenido va dentro del código; no pasa por Musa, no se cuenta ni se cambia.
- Un diseño o presentación se abre en `<musa>/v/<id>`: página pública para verlo y presentarlo sin cuenta. Para eso el diseño queda compartido con enlace. Al crear su QR se elige `download`: `free` (lo descarga en PNG o PDF), `lead` (deja nombre y correo para descargarlo y entra al CRM) o `view` (solo lo ve).

## QR y CRM: qué pasa con quien escanea

- Formulario, evento y website de Musa: el QR agrega `?qr=<código>` al destino. Quien envíe el formulario, se inscriba o llene un formulario de la web entra a Vender › Personas con las etiquetas `qr` y `QR · <nombre>` y, si es nueva, `origin_qr_id`.
- Diseño o presentación con `download: "lead"`: quien lo descarga deja nombre y correo y entra igual al CRM.
- Brief y cotización: no crean personas (son para un cliente que ya existe).
- Enlace a otra web y WhatsApp: solo cuentan escaneos (día, país, equipo), sin datos de la persona.
- Fijos (Wi‑Fi, contacto, correo, llamada, SMS, texto): no pasan por Musa; ni escaneos ni personas.
- `get_qr_code` trae `captured` (total, por tipo, personas nuevas y las últimas) y `whatHappens`. Díselo a la persona al crear el QR.

## Flujos

**QR de una cosa de Musa**
1. Identifica la cosa: diseño (`list_templates`), website (`list_websites`), evento (`list_events`), formulario (`list_forms`), brief (`list_briefs`) o cotización (`list_quotes`).
2. `qr_for_item({ workspaceId, targetType, targetId })`. targetType: `design`, `presentation`, `website`, `event`, `form`, `brief`, `quote`. En un diseño o presentación pregunta qué puede hacer quien escanee y pasa `download: "free" | "lead" | "view"`.
3. Un diseño privado devuelve error: pregunta a la persona si lo compartes con enlace y repite con `makePublic: true`. Un website o evento sin publicar también avisa: publícalo primero (`publish_website`, `event_save` con publicado).
4. Entrega el `shortUrl` y el `svg`. Para meterlo en un diseño, pégalo como imagen.

**QR suelto**
1. Para algo impreso que lleva a una web, usa uno dinámico: `qr_create({ workspaceId, name, type: "url", fields: { url } })`.
2. WhatsApp: `type: "whatsapp", fields: { phone: "51987654321", message }`. Wi‑Fi: `type: "wifi", fields: { ssid, password, encryption: "WPA" }`. Contacto: `type: "vcard", fields: { firstName, lastName, org, title, phone, email, web }`.
3. Para probar un contenido sin guardarlo: `preview_qr({ type, fields })` o `preview_qr({ content })`.

**Cambiar, pausar, medir**
- Nuevo destino de un QR dinámico: `qr_update({ workspaceId, id, url })`. El impreso sigue sirviendo.
- Cambiar qué puede hacer quien escanea un diseño: `qr_update({ workspaceId, id, download })`.
- Pausar: `qr_update({ workspaceId, id, active: false })`. Quien lo escanee ve que está en pausa. `active: true` lo reactiva.
- Escaneos: `get_qr_code({ workspaceId, id })` → `scans`, `lastScanAt` y `last30Days` (por día, país y equipo). `list_qr_codes` para todos.
- Estilo: `style: { fg, bg, eye, dots: "square"|"rounded", eyes: "square"|"rounded", margin, logo: true }`. `logo: true` usa el logo de la marca (`brandId`).
- Borrar: `qr_delete({ workspaceId, id, confirm: true })`. Antes, pregunta: un QR impreso borrado deja de funcionar. Para dejarlo de usar por un tiempo, mejor pausarlo.

## Reglas

- Pregunta siempre el espacio antes de crear.
- Lo impreso va con QR dinámico. Un fijo no se puede corregir después.
- Colores: oscuro sobre claro y con buen contraste. Si `preview_qr` o la pantalla avisan poco contraste, cambia los colores antes de entregar.
- Un QR nunca apunta a otro QR de Musa (`/r/…`): usa el destino real.
- No compartas un diseño privado sin permiso de la persona (`makePublic`).
- Los QR se mueven entre espacios como el resto (`preview_move` / `move_items` con `type: "qr"`).

## Ejemplos

- «Hazme un QR para el flyer del evento de diciembre»
- «Pon un QR en este diseño que lleve a mi landing»
- «Quiero que la gente escanee y descargue la presentación»
- «Cambia el QR de la mesa para que lleve a la nueva carta»
- «QR del Wi‑Fi de la oficina con nuestro logo»
- «¿Cuántas personas escanearon el QR del stand esta semana?»
- «Pausa el QR de la promo de octubre»
- «Que la presentación se descargue solo si dejan su correo»
- «¿Cuántas personas entraron al CRM por el QR del flyer?»
