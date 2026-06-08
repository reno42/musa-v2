# 📄 Paper Full Capabilities — Research para MCP-First Design Tool

> **Fecha:** 2026-06-07  
> **Fuentes:** Checklist existente, docs oficiales, experiencia con Paper/Notion/Craft  
> **Objetivo:** Catálogo exhaustivo de funcionalidades de herramientas tipo "documento-canvas inteligente" para diseño colaborativo con IA  
> **Output para:** Diseño de MCP tools en Mini-Figma / Futuraria Design Tool

---

## 📊 Comparativa Rápida

| Categoría | Dropbox Paper | Notion | Craft |
|-----------|:---:|:---:|:---:|
| Canvas inteligente | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Estructura de documento | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Colaboración | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Integraciones & Automation | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Media & Archivos | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| IA & Smart Features | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Publicación & Export | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Organización | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 1. 🖼️ CANVAS INTELIGENTE

### Paper: Infinite Scroll Canvas
**Categoría:** CANVAS  
**Descripción:** Paper usa un lienzo de scroll vertical infinito, no paginado. Todo el contenido fluye en una sola columna ancha con máximo ancho (~900px). No hay "páginas", todo es un scroll continuo. La experiencia es más cercana a un documento web que a un canvas de diseño.  
**MCP Tool necesaria:** `canvas.setMode` (scroll vs infinite vs paged)  
**Complejidad:** Baja  
**Free tier viable:** Sí — implementable con CSS overflow + virtual scrolling

### Notion: Block-Based Infinite Canvas
**Categoría:** CANVAS  
**Descripción:** Notion organiza TODO como bloques arrastrables dentro de una página de scroll infinito. Cada bloque es independiente: párrafo, heading, imagen, tabla, database, embed, etc. Los bloques se pueden arrastrar para reordenar, indentar, o mover entre páginas. El canvas no es "infinito" en 2D como Figma, sino infinito vertical con ancho fijo.  
**MCP Tool necesaria:** `block.create`, `block.move`, `block.reorder`, `block.indent`  
**Complejidad:** Media  
**Free tier viable:** Sí — sistema de bloques drag & drop

### Notion: Side-by-Side Columns
**Categoría:** CANVAS  
**Descripción:** Drag & drop de bloques para crear layouts de 2, 3, 4 o 5 columnas. Dentro de cada columna, los bloques siguen el flujo vertical normal. Muy usado para dashboards, comparaciones, y layouts de documentación.  
**MCP Tool necesaria:** `layout.setColumns`, `layout.addColumn`, `layout.resizeColumn`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Craft: Page-Based Canvas con Spreads
**Categoría:** CANVAS  
**Descripción:** Craft organiza contenido en "pages" (documentos) que pueden contener "spreads" (secciones expandibles horizontalmente). Cada spread puede tener múltiples columnas. La experiencia es más cercana a un documento de revista digital. Soporta arrastre de tarjetas/bloques entre spreads.  
**MCP Tool necesaria:** `page.create`, `spread.create`, `spread.layout`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Drag & Drop Universal
**Categoría:** CANVAS  
**Descripción:** Absolutamente todo en Notion es drag & drop: bloques dentro de una página, páginas en la sidebar, items en una database, archivos desde el desktop, imágenes desde el navegador. El sistema de drag & drop es el core UX de Notion. Soporta drag entre ventanas y tabs.  
**MCP Tool necesaria:** `dnd.move`, `dnd.reorder`, `dnd.import`, `dnd.crossPage`  
**Complejidad:** Alta  
**Free tier viable:** Sí — pero complejo de implementar bien

### Paper: Media Embeds (Rich)
**Categoría:** CANVAS  
**Descripción:** Paper permite embedir imágenes, videos (YouTube, Vimeo), archivos de audio, bloques de código con syntax highlighting, y archivos de Dropbox directamente en el documento. Los embeds son "live" — el video se reproduce inline. Soporta paste de URLs que se expanden automáticamente a previews (YouTube → video embed, Twitter → tweet embed, etc.).  
**MCP Tool necesaria:** `embed.create`, `embed.expandUrl`, `embed.preview`  
**Complejidad:** Media  
**Free tier viable:** Sí — usando oEmbed + iframe sandbox

### Notion: Embeds Universe (60+ servicios)
**Categoría:** CANVAS  
**Descripción:** Notion soporta embeds de 60+ servicios: Figma, Google Drive, Google Maps, Twitter/X, YouTube, Vimeo, Loom, Miro, Whimsical, Typeform, CodePen, Framer, InVision, Sketch, Abstract, Marvel, etc. También tiene un bloque "Embed" genérico que acepta cualquier URL con oEmbed.  
**MCP Tool necesaria:** `embed.create`, `embed.fromUrl`, `embed.resize`, `embed.refresh`  
**Complejidad:** Alta (requiere integración oEmbed + providers específicos)  
**Free tier viable:** Sí — core, pero 60+ providers es ambicioso. Priorizar top 10.

### Craft: Cards & Rich Blocks
**Categoría:** CANVAS  
**Descripción:** Craft usa "cards" como unidad de contenido. Cada card puede ser texto, imagen, archivo, link preview, code block, table, etc. Las cards se pueden arrastrar, agrupar, y convertir entre tipos (ej: texto → checklist). Soporta "/" slash command para insertar cualquier tipo de bloque.  
**MCP Tool necesaria:** `card.create`, `card.convert`, `card.group`, `slashCommand.trigger`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Code Blocks con Syntax Highlight
**Categoría:** CANVAS  
**Descripción:** Bloques de código con syntax highlighting para múltiples lenguajes (JS, Python, HTML, CSS, Ruby, Go, etc.). Se puede elegir el lenguaje desde un dropdown en el bloque. Soporta line numbers.  
**MCP Tool necesaria:** `codeBlock.create`, `codeBlock.setLanguage`, `codeBlock.highlight`  
**Complejidad:** Baja (usando Prism.js o Shiki)  
**Free tier viable:** Sí

### Notion: Code Blocks + Mermaid Diagrams
**Categoría:** CANVAS  
**Descripción:** Code blocks con syntax highlighting para 60+ lenguajes. Soporta Mermaid.js para diagramas inline (flowchart, sequence, class, state, ER, Gantt, pie). También soporta Math equations (LaTeX/KaTeX) inline y en bloque.  
**MCP Tool necesaria:** `codeBlock.create`, `codeBlock.setLanguage`, `diagram.mermaid`, `math.render`  
**Complejidad:** Media  
**Free tier viable:** Sí — Mermaid.js es open source

### Notion: Databases (Tablas Dinámicas)
**Categoría:** CANVAS  
**Descripción:** La killer feature de Notion. Databases son colecciones de páginas con propiedades tipadas (texto, número, select, multi-select, fecha, persona, archivo, checkbox, URL, email, phone, fórmula, relación, rollup, status, etc.). Se visualizan como Table, Board (Kanban), Timeline (Gantt), Calendar, List, Gallery. Cada item es una página Notion completa.  
**MCP Tool necesaria:** `database.create`, `database.addProperty`, `database.setView`, `database.query`, `database.filter`, `database.sort`  
**Complejidad:** Muy Alta  
**Free tier viable:** Sí (básico) — la versión completa es compleja

### Paper: Tablas Básicas
**Categoría:** CANVAS  
**Descripción:** Tablas simples editables con filas y columnas. Sin fórmulas, sin relaciones, sin vistas alternativas. Solo datos tabulares básicos con formato de texto en celdas. Similar a una tabla de Google Docs simplificada.  
**MCP Tool necesaria:** `table.create`, `table.addRow`, `table.addColumn`, `table.formatCell`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: Tablas Estilizadas
**Categoría:** CANVAS  
**Descripción:** Tablas con formato rico, soporte para imágenes en celdas, y estilos visuales. Más orientadas a presentación que a datos. Sin fórmulas ni relaciones como Notion.  
**MCP Tool necesaria:** `table.create`, `table.styleCell`, `table.insertMedia`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Markdown Support
**Categoría:** CANVAS  
**Descripción:** Paper soporta atajos de Markdown para formateo rápido: `#` para headings, `*` para bullets, `- [ ]` para checklists, `>` para quotes, `` ` `` para código inline, ```` ``` ```` para code blocks. También permite pegar Markdown que se convierte automáticamente. Export a Markdown disponible.  
**MCP Tool necesaria:** `markdown.parse`, `markdown.import`, `markdown.export`, `shortcuts.register`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Markdown + Slash Commands
**Categoría:** CANVAS  
**Descripción:** Soporte completo de Markdown shortcuts (`#`, `##`, `*`, `-`, `>`, `[]`, `1.`, `---`, etc.) + `/` slash command menu para insertar cualquier bloque. Import/export Markdown con soporte de frontmatter.  
**MCP Tool necesaria:** `markdown.parse`, `markdown.export`, `slashCommand.menu`, `slashCommand.search`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Sincronización en Tiempo Real
**Categoría:** CANVAS  
**Descripción:** Cambios se sincronizan en tiempo real entre todos los usuarios. Usa Conflict-Free Replicated Data Types (CRDTs) para resolución de conflictos offline-first. Los cambios aparecen en milisegundos. Soporta offline mode con sync al reconectar.  
**MCP Tool necesaria:** `sync.realtime`, `sync.offline`, `sync.conflict`, `sync.status`  
**Complejidad:** Muy Alta  
**Free tier viable:** Parcial — WebSockets + CRDT es complejo. Básico con polling es viable.

### Notion: Synced Blocks
**Categoría:** CANVAS  
**Descripción:** Bloques que se sincronizan en múltiples ubicaciones. Editar en un lugar actualiza todas las copias. Similar a "component instances" de Figma pero para contenido. Muy útil para precios, disclaimer legales, información de contacto que aparece en múltiples páginas.  
**MCP Tool necesaria:** `syncedBlock.create`, `syncedBlock.reference`, `syncedBlock.update`, `syncedBlock.unlink`  
**Complejidad:** Alta  
**Free tier viable:** Sí

### Craft: Native Performance + Offline First
**Categoría:** CANVAS  
**Descripción:** Craft es nativo (Swift en macOS/iOS) con rendimiento excepcional. Offline-first: todo funciona sin conexión, se sincroniza cuando hay red. La experiencia de edición es instantánea, sin lag.  
**MCP Tool necesaria:** `offline.cache`, `offline.sync`, `offline.queue`, `offline.status`  
**Complejidad:** Alta (offline-first con CRDT)  
**Free tier viable:** Parcial — solo con Service Workers + IndexedDB

### Paper: Offline Mode
**Categoría:** CANVAS  
**Descripción:** La app móvil de Paper soporta modo offline completo. Los documentos se cachean localmente y se sincronizan al reconectar. La experiencia es limitada pero funcional sin conexión.  
**MCP Tool necesaria:** `offline.cache`, `offline.sync`  
**Complejidad:** Media  
**Free tier viable:** Parcial

---

## 2. 📐 ESTRUCTURA DE DOCUMENTO

### Paper: Jerarquía de Headers (H1-H3)
**Categoría:** ESTRUCTURA  
**Descripción:** Paper soporta H1, H2, H3 con estilos visuales claros. El H1 es grande y bold, H2 mediano, H3 más pequeño. No tiene H4-H6. Los headers se usan para estructurar documentos y generar la tabla de contenidos automática en la sidebar izquierda.  
**MCP Tool necesaria:** `heading.create`, `heading.setLevel` (1-6), `heading.style`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Jerarquía de Headers (H1-H3)
**Categoría:** ESTRUCTURA  
**Descripción:** H1, H2, H3 con estilos distintivos. Los headers colapsan/expanden todo el contenido debajo de ellos (toggle implícito). Esto es una de las features más amadas de Notion: click en un H2 colapsa toda la sección.  
**MCP Tool necesaria:** `heading.create`, `heading.toggle`, `heading.collapseAll`, `heading.expandAll`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Craft: Headers con Estilo Editorial
**Categoría:** ESTRUCTURA  
**Descripción:** H1-H3 con tipografía cuidada y estilos visuales premium. Los headers en Craft tienen un diseño editorial muy pulido, con espaciado generoso y jerarquía tipográfica clara.  
**MCP Tool necesaria:** `heading.create`, `heading.setStyle`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Listas (Bullet, Numbered, Checklist)
**Categoría:** ESTRUCTURA  
**Descripción:** Bullet lists, numbered lists, y checklists con checkboxes interactivos. Las checklists pueden tener items completados (tachados) y pendientes. Soporte para nesting (sublistas) con indentación.  
**MCP Tool necesaria:** `list.createBullet`, `list.createNumbered`, `list.createChecklist`, `list.indent`, `list.toggleCheck`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Toggle Blocks / Accordion
**Categoría:** ESTRUCTURA  
**Descripción:** Bloques colapsables que ocultan/muestran contenido hijo. Funcionan como acordeones. Pueden contener cualquier otro bloque de Notion dentro (texto, imágenes, databases enteras, etc.). Los headings también son toggles implícitos.  
**MCP Tool necesaria:** `toggle.create`, `toggle.expand`, `toggle.collapse`, `toggle.setLabel`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Callout Blocks
**Categoría:** ESTRUCTURA  
**Descripción:** Bloques con fondo de color, ícono, y texto. Similar a "admonitions" en docs técnicos. Muy usados para tips, warnings, info boxes, notas importantes. 15+ colores de fondo y emoji personalizable.  
**MCP Tool necesaria:** `callout.create`, `callout.setIcon`, `callout.setColor`, `callout.setContent`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Quote Blocks
**Categoría:** ESTRUCTURA  
**Descripción:** Bloque de cita con barra vertical a la izquierda y texto en itálica/estilo diferenciado. Simple pero efectivo para destacar citas o extractos.  
**MCP Tool necesaria:** `quote.create`, `quote.setAttribution`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Quote Blocks
**Categoría:** ESTRUCTURA  
**Descripción:** Citas con barra vertical. Pueden ser grandes (large quote style) para destacar. El texto dentro soporta todo el rich text de Notion (bold, italic, links, mentions, etc.).  
**MCP Tool necesaria:** `quote.create`, `quote.setSize` (small/large)  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Separadores / Divider
**Categoría:** ESTRUCTURA  
**Descripción:** Línea horizontal simple (---) para separar secciones. Sin opciones de estilo (siempre es una línea gris fina).  
**MCP Tool necesaria:** `divider.create`, `divider.setStyle`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Divider con Estilo
**Categoría:** ESTRUCTURA  
**Descripción:** Línea horizontal con opción de estilo: thin, medium, thick, dotted. Separador visual entre secciones.  
**MCP Tool necesaria:** `divider.create`, `divider.setThickness`, `divider.setStyle`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Table of Contents (Auto)
**Categoría:** ESTRUCTURA  
**Descripción:** Bloque que genera automáticamente una tabla de contenidos basada en los headings de la página. Se actualiza dinámicamente. Los items son links clickeables que hacen scroll al heading correspondiente.  
**MCP Tool necesaria:** `toc.generate`, `toc.refresh`, `toc.setDepth`, `toc.setStyle`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Columns Layout (2-5 columnas)
**Categoría:** ESTRUCTURA  
**Descripción:** Sistema de columnas drag & drop. Se crean arrastrando un bloque al lado de otro. Hasta 5 columnas. Cada columna es independiente y puede contener cualquier bloque. Las columnas se pueden redimensionar.  
**MCP Tool necesaria:** `layout.setColumns`, `layout.addColumn`, `layout.removeColumn`, `layout.resizeColumn`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Templates de Documento
**Categoría:** ESTRUCTURA  
**Descripción:** Templates predefinidos para tipos comunes de documentos: meeting notes, project plan, brainstorming, product spec, etc. Cada template incluye estructura pre-armada con headers, secciones, y placeholders.  
**MCP Tool necesaria:** `template.list`, `template.apply`, `template.create`, `template.save`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Templates (Galería + Marketplace)
**Categoría:** ESTRUCTURA  
**Descripción:** Miles de templates gratuitos y de pago en la Notion Template Gallery. Templates para TODO: product management, design, engineering, marketing, personal, education, startups. Los templates pueden incluir databases, relaciones, fórmulas, y vistas preconfiguradas.  
**MCP Tool necesaria:** `template.gallery`, `template.import`, `template.publish`, `template.duplicate`  
**Complejidad:** Alta  
**Free tier viable:** Sí — galería de templates es un feature diferencial

### Notion: Page Properties (Metadatos)
**Categoría:** ESTRUCTURA  
**Descripción:** Cada página puede tener propiedades en la parte superior: título, ícono, cover image, y propiedades de database (si está dentro de una). Las propiedades son visibles siempre en el top de la página.  
**MCP Tool necesaria:** `page.setIcon`, `page.setCover`, `page.setProperties`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: Daily Notes
**Categoría:** ESTRUCTURA  
**Descripción:** Craft tiene un sistema de Daily Notes integrado con calendario. Cada día tiene su propia nota con fecha automática. Ideal para journaling, design logs, y notas de reuniones diarias. Se navega por calendario.  
**MCP Tool necesaria:** `dailyNote.open`, `dailyNote.create`, `dailyNote.navigate`, `dailyNote.linkCalendar`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Wiki / Knowledge Base
**Categoría:** ESTRUCTURA  
**Descripción:** Notion funciona como wiki gracias a: páginas anidadas infinitamente, backlinks automáticos, sidebar con jerarquía de páginas, search global, y "@" mentions que crean links bidireccionales.  
**MCP Tool necesaria:** `page.nest`, `backlink.show`, `backlink.create`, `page.breadcrumb`  
**Complejidad:** Media  
**Free tier viable:** Sí

---

## 3. 🤝 COLABORACIÓN

### Paper: Multiplayer Real-Time
**Categoría:** COLABORACIÓN  
**Descripción:** Múltiples personas pueden editar el mismo documento simultáneamente. Los cambios aparecen en tiempo real. Es la core feature de Paper — la colaboración es fluida y sin conflictos visibles. Similar a Google Docs.  
**MCP Tool necesaria:** `collab.join`, `collab.sync`, `collab.cursor`, `collab.leave`  
**Complejidad:** Muy Alta (OT/CRDT)  
**Free tier viable:** Parcial — básico con WebSockets

### Paper: Comentarios Inline + Anclados a Texto
**Categoría:** COLABORACIÓN  
**Descripción:** Comentarios que se anclan a texto específico o a bloques completos. Los comentarios pueden resolverse (marcar como done). Se notifica a los participantes. Hilos de conversación dentro de cada comentario.  
**MCP Tool necesaria:** `comment.create`, `comment.reply`, `comment.resolve`, `comment.reopen`, `comment.delete`, `comment.anchor`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Menciones (@user)
**Categoría:** COLABORACIÓN  
**Descripción:** @nombre para mencionar a colaboradores. La mención notifica al usuario (email/in-app) y lo agrega al documento automáticamente. También se puede usar para asignar tareas en checklists.  
**MCP Tool necesaria:** `mention.user`, `mention.notify`, `mention.assign`, `mention.search`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Comentarios en Databases y Páginas
**Categoría:** COLABORACIÓN  
**Descripción:** Comentarios en páginas (anclados a bloques) y en items de database. Los comentarios pueden mencionar usuarios, páginas, o fechas. Se pueden filtrar comentarios abiertos/cerrados. Integración con Slack para notificaciones de comentarios.  
**MCP Tool necesaria:** `comment.create`, `comment.thread`, `comment.filter`, `comment.notifySlack`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Historial de Versiones
**Categoría:** COLABORACIÓN  
**Descripción:** Historial completo de cambios con autor y timestamp. Se puede navegar entre versiones anteriores y ver quién hizo qué cambio. Posibilidad de restaurar versiones anteriores (no hay branching como en Figma).  
**MCP Tool necesaria:** `history.list`, `history.view`, `history.restore`, `history.diff`, `history.compare`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Version History (Premium)
**Categoría:** COLABORACIÓN  
**Descripción:** Historial de versiones con vista previa de cada versión. Se puede restaurar cualquier versión anterior. En planes pagos, historial extendido (30 días en Plus, 90 días en Business, ilimitado en Enterprise).  
**MCP Tool necesaria:** `history.list`, `history.preview`, `history.restore`, `history.export`  
**Complejidad:** Alta  
**Free tier viable:** Sí — 7 días de historial en free tier

### Paper: Permisos (View / Comment / Edit)
**Categoría:** COLABORACIÓN  
**Descripción:** Tres niveles de acceso: View (solo lectura), Comment (puede comentar), Edit (puede modificar). Los permisos se asignan por persona o por link compartido. El dueño del documento puede cambiar permisos en cualquier momento.  
**MCP Tool necesaria:** `permission.set`, `permission.get`, `permission.revoke`, `permission.inherit`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Permisos Granulares
**Categoría:** COLABORACIÓN  
**Descripción:** Permisos a nivel de workspace, folder/teamspace, página individual, y hasta bloque (en planes Enterprise). Roles: Admin, Can edit, Can comment, Can view. Permisos heredables y permisos específicos que rompen la herencia.  
**MCP Tool necesaria:** `permission.set`, `permission.inherit`, `permission.blockLevel`, `permission.audit`  
**Complejidad:** Alta  
**Free tier viable:** Parcial — permisos básicos sí, granulares no

### Paper: Links Compartibles
**Categoría:** COLABORACIÓN  
**Descripción:** Cada documento tiene un link único compartible. Se puede configurar el nivel de acceso del link: cualquiera con el link puede ver/comentar/editar, o solo miembros del equipo. Links se pueden desactivar/regenerar.  
**MCP Tool necesaria:** `share.createLink`, `share.setAccess`, `share.revoke`, `share.regenerate`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Share + Guest Access + Public
**Categoría:** COLABORACIÓN  
**Descripción:** Links compartibles con permisos configurables. Guest access para usuarios externos (limitado en free tier). Páginas públicas en la web. Se puede compartir una página individual o una database entera.  
**MCP Tool necesaria:** `share.createLink`, `share.setGuest`, `share.publish`, `share.revoke`  
**Complejidad:** Media  
**Free tier viable:** Sí — con límites

### Craft: Team Spaces + Sharing
**Categoría:** COLABORACIÓN  
**Descripción:** Team spaces para colaboración en equipo. Compartir documentos individuales o spaces completos. Permisos de view/edit. Links compartibles. Los cambios se sincronizan entre dispositivos.  
**MCP Tool necesaria:** `space.create`, `space.share`, `space.setPermission`, `space.invite`  
**Complejidad:** Media  
**Free tier viable:** Sí — con límites de team size

### Notion: Presencia (Avatares)
**Categoría:** COLABORACIÓN  
**Descripción:** Avatares de usuarios que están viendo/Editando la misma página aparecen en el top-right. En páginas con mucha gente, se agrupan. Indica quién está online en ese documento en tiempo real.  
**MCP Tool necesaria:** `presence.show`, `presence.list`, `presence.subscribe`, `presence.update`  
**Complejidad:** Media  
**Free tier viable:** Sí — WebSocket presence es estándar

### Paper: Presence en Documento
**Categoría:** COLABORACIÓN  
**Descripción:** Avatares de colaboradores activos aparecen en la parte superior del documento. Indica quién más está viendo/editando. Sin cursor presence (no se ve dónde está el cursor de otros).  
**MCP Tool necesaria:** `presence.show`, `presence.list`  
**Complejidad:** Media  
**Free tier viable:** Sí

---

## 4. 🔌 INTEGRACIONES & AUTOMATION

### Paper: Dropbox File Embed
**Categoría:** INTEGRACIONES  
**Descripción:** Embeds nativos de archivos de Dropbox. Los archivos aparecen con preview inline (PDF, imágenes, documentos). Al estar en el ecosistema Dropbox, la integración es profunda: cualquier archivo de tu Dropbox se puede embedir con un par de clicks.  
**MCP Tool necesaria:** `integration.dropbox.embed`, `integration.dropbox.browse`, `integration.dropbox.preview`  
**Complejidad:** Alta (requiere OAuth + API de Dropbox)  
**Free tier viable:** Sí — con API key de Dropbox

### Notion: Connections (Integraciones Nativas)
**Categoría:** INTEGRACIONES  
**Descripción:** Notion Connections permite integrar herramientas externas como propiedades de database o contenido embedido: GitHub (PRs, issues), Jira (tickets), Slack (canales), Google Drive, Figma, Linear, Asana, etc. Las connections son bidireccionales — cambios en una herramienta se reflejan en Notion y viceversa.  
**MCP Tool necesaria:** `connection.create`, `connection.configure`, `connection.sync`, `connection.list`  
**Complejidad:** Muy Alta (requiere OAuth + webhooks + polling por servicio)  
**Free tier viable:** No — requiere infraestructura de integraciones

### Notion: REST API Pública
**Categoría:** INTEGRACIONES  
**Descripción:** API REST completa para interactuar con pages, databases, blocks, users, comments, search. Autenticación vía OAuth 2.0 o Internal Integration Tokens. Rate limits generosos. SDKs oficiales en JavaScript y Python. Documentación excelente.  
**MCP Tool necesaria:** `api.request`, `api.auth`, `api.rateLimit`, `api.sdk`  
**Complejidad:** Alta  
**Free tier viable:** Sí — la API en sí es el producto. Mini-Figma ya tiene API ✅

### Notion: Webhooks
**Categoría:** INTEGRACIONES  
**Descripción:** Webhooks para eventos en databases y páginas. Eventos: page.created, page.updated, page.archived, database.updated, etc. Los webhooks permiten triggers en tiempo real para flujos de automatización.  
**MCP Tool necesaria:** `webhook.create`, `webhook.list`, `webhook.delete`, `webhook.eventTypes`, `webhook.test`  
**Complejidad:** Media  
**Free tier viable:** Sí — webhooks REST estándar. Mini-Figma ya tiene ✅

### Notion: Database Automations
**Categoría:** INTEGRACIONES  
**Descripción:** Automatizaciones nativas dentro de databases: triggers (al crear/editar página, al cambiar propiedad), acciones (enviar notificación, editar propiedad, crear página, enviar webhook). Similar a Zapier pero nativo.  
**MCP Tool necesaria:** `automation.create`, `automation.trigger`, `automation.action`, `automation.log`  
**Complejidad:** Alta  
**Free tier viable:** Parcial — automatizaciones básicas en free tier

### Notion + Zapier/Make/n8n
**Categoría:** INTEGRACIONES  
**Descripción:** Notion tiene integraciones oficiales con Zapier, Make (Integromat), y soporte comunitario para n8n. Triggers: new/updated database item, new page. Actions: create page, update database, create comment, search.  
**MCP Tool necesaria:** `integration.zapier`, `integration.make`, `integration.n8n`  
**Complejidad:** Media (conectar a plataformas existentes)  
**Free tier viable:** Sí — n8n es self-hosted y gratuito

### Paper: Integraciones Limitadas
**Categoría:** INTEGRACIONES  
**Descripción:** Paper no tiene API pública. Las integraciones son principalmente via Dropbox ecosystem (archivos, previews) y embeds básicos (YouTube, etc.). No hay webhooks, no hay Zapier, no hay API. Es la mayor debilidad de Paper para automation.  
**MCP Tool necesaria:** N/A — Paper no es extensible  
**Complejidad:** N/A  
**Free tier viable:** N/A

### Craft: API + Integraciones (Limitado)
**Categoría:** INTEGRACIONES  
**Descripción:** Craft tiene API para extensiones y algunas integraciones vía Zapier. Menos extenso que Notion pero más que Paper. Soporta widgets de iOS/macOS. Integración con Things, Reminders, Calendar.  
**MCP Tool necesaria:** `api.craft`, `integration.widget`, `integration.calendar`  
**Complejidad:** Media  
**Free tier viable:** Parcial

### Notion: Calendar Integration
**Categoría:** INTEGRACIONES  
**Descripción:** Notion Calendar (app separada) se integra con Google Calendar y muestra databases con vista de calendario. Bidireccional: eventos de Google Calendar aparecen en Notion y viceversa. Soporta multiple cuentas de Google.  
**MCP Tool necesaria:** `calendar.connect`, `calendar.sync`, `calendar.createEvent`, `calendar.showInPage`  
**Complejidad:** Alta  
**Free tier viable:** Parcial

### Notion: Task Assignment + Notifications
**Categoría:** INTEGRACIONES  
**Descripción:** Propiedad "Person" en databases permite asignar tareas. Los asignados reciben notificaciones. Se puede filtrar por "My tasks" para ver solo las tareas propias. Las menciones @user en páginas también crean notificaciones y agregan a la página.  
**MCP Tool necesaria:** `task.assign`, `task.notify`, `task.filterMine`, `task.due`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Task Assignment
**Categoría:** INTEGRACIONES  
**Descripción:** Asignación de tareas vía @mentions en checklists y texto. Los items de checklist se pueden asignar a personas. Las tareas asignadas aparecen en la vista de "Tareas" global de Paper. Notificaciones por email.  
**MCP Tool necesaria:** `task.assign`, `task.viewAll`, `task.complete`, `task.notify`  
**Complejidad:** Baja  
**Free tier viable:** Sí

---

## 5. 📁 MEDIA & ARCHIVOS

### Paper: Imagen (Upload, URL, Drag & Drop)
**Categoría:** MEDIA  
**Descripción:** Insertar imágenes vía upload desde computadora, paste desde clipboard, drag & drop desde desktop o web, o URL. Las imágenes se muestran inline con opciones de alineación (left, center, full-width). Soporta gallery view (múltiples imágenes en grid).  
**MCP Tool necesaria:** `media.uploadImage`, `media.pasteImage`, `media.dragImage`, `media.imageUrl`, `media.resizeImage`, `media.alignImage`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Galería de Imágenes
**Categoría:** MEDIA  
**Descripción:** Múltiples imágenes se organizan automáticamente en una galería/grid. Las imágenes se pueden reordenar por drag & drop. Click en una imagen abre lightbox para vista ampliada con navegación entre imágenes.  
**MCP Tool necesaria:** `gallery.create`, `gallery.addImage`, `gallery.reorder`, `gallery.lightbox`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Imágenes + Unsplash Integration
**Categoría:** MEDIA  
**Descripción:** Upload, URL, drag & drop. Integración nativa con Unsplash: buscar y seleccionar imágenes de stock directamente desde Notion. Las imágenes se pueden redimensionar, alinear, y convertir en cover de página. Soporte para GIFs animados.  
**MCP Tool necesaria:** `media.upload`, `media.unsplash`, `media.setCover`, `media.resize`, `media.caption`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Video Embed (YouTube, Vimeo, Dropbox)
**Categoría:** MEDIA  
**Descripción:** Videos de YouTube y Vimeo se embeben con reproductor inline. También videos subidos a Dropbox. Se pega la URL del video y Paper automáticamente la expande a un embed interactivo. Se reproduce directamente en el documento.  
**MCP Tool necesaria:** `media.embedVideo`, `media.expandVideoUrl`, `media.playInline`, `media.videoResize`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Video Embeds + Upload
**Categoría:** MEDIA  
**Descripción:** Embeds de YouTube, Vimeo, Loom, y más. También soporta upload directo de archivos de video (con límite de tamaño según plan: 5MB free, 5GB+ en pagos). Los videos uploaded se reproducen con reproductor nativo.  
**MCP Tool necesaria:** `media.embedVideo`, `media.uploadVideo`, `media.streamVideo`, `media.videoCaption`  
**Complejidad:** Alta (upload + encoding es costoso)  
**Free tier viable:** Parcial — embeds sí, uploads limitados

### Paper: Audio Embeds
**Categoría:** MEDIA  
**Descripción:** Archivos de audio (.mp3, .wav) se pueden embedir con reproductor inline. Útil para notas de voz, podcasts, o grabaciones de reuniones. También soporta embeds de SoundCloud y Spotify.  
**MCP Tool necesaria:** `media.embedAudio`, `media.playAudio`, `media.audioUpload`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: PDF Preview Inline
**Categoría:** MEDIA  
**Descripción:** Archivos PDF se muestran con preview inline. Se puede hacer scroll dentro del PDF sin salir del documento. La preview muestra las páginas del PDF navegables.  
**MCP Tool necesaria:** `media.previewPdf`, `media.scrollPdf`, `media.downloadPdf`  
**Complejidad:** Media (requiere PDF.js o similar)  
**Free tier viable:** Sí

### Notion: File Uploads + File Manager
**Categoría:** MEDIA  
**Descripción:** Upload de cualquier tipo de archivo como propiedad de database o como bloque en página. File manager para ver todos los archivos subidos al workspace. Límites: 5MB free, 5GB+ pagos. Los archivos se pueden descargar, previsualizar (imagen, PDF, video), y referenciar.  
**MCP Tool necesaria:** `file.upload`, `file.list`, `file.download`, `file.preview`, `file.delete`  
**Complejidad:** Media  
**Free tier viable:** Parcial — 5MB limit

### Craft: Attachments & Files
**Categoría:** MEDIA  
**Descripción:** Archivos adjuntos con preview. Integración con Files app en iOS/macOS. Soporte para iCloud Drive. Los archivos se sincronizan entre dispositivos.  
**MCP Tool necesaria:** `file.attach`, `file.preview`, `file.sync`  
**Complejidad:** Media  
**Free tier viable:** Parcial

---

## 6. 🤖 IA & SMART FEATURES

### Notion AI: Writing Assistant
**Categoría:** IA  
**Descripción:** El Notion AI puede generar, editar, mejorar, resumir, traducir, y transformar texto. Se accede vía espacio en blanco + "/AI" o seleccionando texto + "Ask AI". Opciones: Improve writing, Fix spelling & grammar, Make shorter/longer, Simplify language, Change tone (Professional, Casual, Friendly, Direct, Confident), Explain this, Translate (14 idiomas).  
**MCP Tool necesaria:** `ai.write`, `ai.improve`, `ai.fixGrammar`, `ai.shorten`, `ai.lengthen`, `ai.simplify`, `ai.changeTone`, `ai.explain`, `ai.translate`  
**Complejidad:** Alta (requiere integración con LLMs via API)  
**Free tier viable:** Parcial — costo de API LLM, pero se puede ofrecer como add-on

### Notion AI: Summarization
**Categoría:** IA  
**Descripción:** Resume páginas enteras, extractos, o documentos con un click. Genera resúmenes de diferentes longitudes y estilos. Muy útil para meeting notes largas, research docs, y documentación extensa. También tiene "Find action items" que extrae tareas pendientes de un texto.  
**MCP Tool necesaria:** `ai.summarize`, `ai.extractActionItems`, `ai.summarizeByLength`  
**Complejidad:** Alta  
**Free tier viable:** Parcial — costo de API

### Notion AI: Content Generation (Templates Inteligentes)
**Categoría:** IA  
**Descripción:** Generación de contenido desde prompts: "Write a PRD for X feature", "Create a meeting agenda for design review", "Draft an email to stakeholders". Los templates de IA incluyen: Brainstorm ideas, Pros and cons list, Social media post, Creative story, Poem, Essay, Meeting agenda, Press release, etc.  
**MCP Tool necesaria:** `ai.generate`, `ai.brainstorm`, `ai.templateContent`, `ai.draftEmail`, `ai.createDoc`  
**Complejidad:** Alta  
**Free tier viable:** Parcial

### Notion AI: Q&A sobre tu Workspace
**Categoría:** IA  
**Descripción:** El Notion AI puede responder preguntas basándose en el contenido de tu workspace: "What's our Q2 marketing strategy?", "When is the next product launch?", "Who is responsible for the onboarding redesign?". Search + LLM combinados.  
**MCP Tool necesaria:** `ai.qa`, `ai.searchWorkspace`, `ai.contextQuery`, `ai.knowledgeBase`  
**Complejidad:** Muy Alta (requiere RAG pipeline)  
**Free tier viable:** No — extremadamente complejo

### Notion AI: Autofill en Databases
**Categoría:** IA  
**Descripción:** IA puede llenar propiedades de database automáticamente: "Summarize this page in one sentence" → propiedad Text, "Translate title to Spanish" → propiedad Text, "Extract key topics" → propiedad Multi-select. Procesa datos en lote.  
**MCP Tool necesaria:** `ai.autofill`, `ai.extract`, `ai.translateProperty`, `ai.categorize`  
**Complejidad:** Alta  
**Free tier viable:** Parcial

### Paper: Auto-Formatting Básico
**Categoría:** IA  
**Descripción:** Paper tiene auto-formato para listas (detecta bullets y numbering), checklists, y headings via Markdown shortcuts. También convierte URLs pegadas en embeds automáticamente (YouTube, Twitter, etc.). No tiene IA generativa.  
**MCP Tool necesaria:** `auto.format`, `auto.detectList`, `auto.expandUrl`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Smart Suggestions (Limitado)
**Categoría:** IA  
**Descripción:** Paper sugiere emojis al escribir ":" y sugiere personas al escribir "@". No hay sugerencias de contenido, formato, o estructura.  
**MCP Tool necesaria:** `suggest.emoji`, `suggest.mention`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: AI Assistant (Craft AI)
**Categoría:** IA  
**Descripción:** Craft AI puede generar contenido, resumir, traducir, y mejorar texto. Similar a Notion AI pero más limitado. Integrado en el editor: seleccionar texto y pedir a AI que lo mejore, expanda, o transforme.  
**MCP Tool necesaria:** `ai.craftWrite`, `ai.craftImprove`, `ai.craftSummarize`, `ai.craftTranslate`  
**Complejidad:** Alta  
**Free tier viable:** Parcial

### Notion: Auto-Save Permanente
**Categoría:** IA  
**Descripción:** Todo se guarda automáticamente en tiempo real. No hay botón de "save". Los cambios son inmediatos y persistentes. Si se cierra el navegador, todo está guardado.  
**MCP Tool necesaria:** `autoSave.enable`, `autoSave.status`, `autoSave.recover`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### MCP-First Design: IA + Canvas (Nuestra Oportunidad)
**Categoría:** IA (Diferenciador MCP)  
**Descripción:** Ninguna de estas herramientas tiene IA que pueda modificar directamente el canvas de diseño. Un MCP tool podría permitir: "Generate a landing page hero section with a headline, subheadline, CTA button, and hero image" → crea objetos en el canvas. "Make this card component responsive with auto-layout" → aplica constraints. "Generate 5 color palette variations of this frame" → modifica fill colors con IA.  
**MCP Tool necesaria:** `ai.design`, `ai.generateLayout`, `ai.createComponent`, `ai.variantColors`, `ai.responsiveLayout`, `ai.designSystem`  
**Complejidad:** Muy Alta — Es el santo grial del design + AI  
**Free tier viable:** No en free tier — sería el core del producto

---

## 7. 📤 PUBLICACIÓN & EXPORT

### Notion: Publish to Web
**Categoría:** PUBLICACIÓN  
**Descripción:** Cualquier página de Notion se puede publicar en la web con un click. URL pública estilo `notion.so/workspace/page-slug`. La página publicada es responsive y mantiene todo el formato. Se puede configurar: permitir comentarios, permitir duplicate como template, SEO settings (title, description), y custom domain (en planes pagos).  
**MCP Tool necesaria:** `publish.enable`, `publish.disable`, `publish.setSeo`, `publish.setDomain`, `publish.setPermissions`  
**Complejidad:** Media  
**Free tier viable:** Sí — sin custom domain

### Craft: Publish to Web
**Categoría:** PUBLICACIÓN  
**Descripción:** Publicación de documentos como páginas web con diseño elegante. URLs estilo `craft.me/username/doc-slug`. Las páginas publicadas mantienen el estilo editorial de Craft. SEO settings y custom domain disponibles.  
**MCP Tool necesaria:** `publish.enable`, `publish.setSeo`, `publish.setDomain`, `publish.getUrl`  
**Complejidad:** Media  
**Free tier viable:** Sí — sin custom domain

### Paper: Share as Web Link
**Categoría:** PUBLICACIÓN  
**Descripción:** Paper no tiene "publish to web" tradicional, pero los links compartibles funcionan como páginas web accesibles. Cualquiera con el link puede ver el documento en un navegador sin necesidad de cuenta de Dropbox. La vista es limpia y responsive.  
**MCP Tool necesaria:** `share.createLink`, `share.setAccess`, `share.publicView`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Export (Markdown, PDF, Word)
**Categoría:** PUBLICACIÓN  
**Descripción:** Export de documentos Paper a Markdown (.md), PDF, y Microsoft Word (.docx). El export a Markdown preserva estructura de headers, listas, y bloques de código. El PDF mantiene el layout visual del documento.  
**MCP Tool necesaria:** `export.toMarkdown`, `export.toPdf`, `export.toDocx`, `export.configure`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Export (PDF, HTML, Markdown & CSV)
**Categoría:** PUBLICACIÓN  
**Descripción:** Export de páginas y databases a múltiples formatos. Páginas: PDF, HTML, Markdown & CSV. Databases: CSV, Markdown (con frontmatter). Export puede incluir sub-páginas y archivos. Opciones de formato: tamaño de página, márgenes, incluir imágenes.  
**MCP Tool necesaria:** `export.toPdf`, `export.toHtml`, `export.toMarkdown`, `export.toCsv`, `export.includeSubpages`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Craft: Export (PDF, Markdown, Text, Print)
**Categoría:** PUBLICACIÓN  
**Descripción:** Export a PDF con diseño editorial profesional, Markdown, texto plano, y formato de impresión. El PDF de Craft es particularmente bueno — mantiene la tipografía, colores, y layout visual.  
**MCP Tool necesaria:** `export.toPdf`, `export.toMarkdown`, `export.toText`, `export.print`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Print Layout
**Categoría:** PUBLICACIÓN  
**Descripción:** Vista previa de impresión con opciones de layout. Se pueden ocultar elementos como cover image, page icon, propiedades, y comentarios antes de imprimir. Soporta márgenes personalizados y escala.  
**MCP Tool necesaria:** `print.preview`, `print.setOptions`, `print.hideElements`, `print.scale`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Responsive Preview
**Categoría:** PUBLICACIÓN  
**Descripción:** Las páginas publicadas de Notion son responsive por defecto. Se adaptan a desktop, tablet, y mobile. La vista de database se ajusta según el ancho de pantalla.  
**MCP Tool necesaria:** `preview.responsive`, `preview.mobile`, `preview.tablet`, `preview.desktop`  
**Complejidad:** Media  
**Free tier viable:** Sí

---

## 8. 📂 ORGANIZACIÓN

### Notion: Sidebar Jerárquica con Drag & Drop
**Categoría:** ORGANIZACIÓN  
**Descripción:** Sidebar izquierda con jerarquía completa de páginas. Drag & drop para reordenar, anidar, y mover páginas entre workspaces. Las páginas pueden anidarse infinitamente. Se puede colapsar/expandir cada nivel. La sidebar es el file manager de Notion.  
**MCP Tool necesaria:** `sidebar.render`, `sidebar.reorder`, `sidebar.nest`, `sidebar.collapse`, `sidebar.search`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Paper: Sidebar con Docs + Folders
**Categoría:** ORGANIZACIÓN  
**Descripción:** Sidebar con lista de documentos organizados en folders. Los folders son planos (no anidables como Notion). Se puede hacer drag & drop de documentos entre folders. La sidebar tiene búsqueda, recientes, y starred.  
**MCP Tool necesaria:** `sidebar.folders`, `sidebar.reorder`, `sidebar.search`, `sidebar.recent`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: Spaces + Folders
**Categoría:** ORGANIZACIÓN  
**Descripción:** Organización por Spaces (áreas de trabajo) que contienen folders y documentos. Los spaces pueden ser personales o de equipo. Estructura: Space > Folder > Document > Sub-documents. Los documentos se pueden mover entre spaces y folders.  
**MCP Tool necesaria:** `space.create`, `folder.create`, `document.move`, `document.organize`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Search Global Full-Text
**Categoría:** ORGANIZACIÓN  
**Descripción:** Search global (Cmd+K / Ctrl+K) con resultados instantáneos. Busca en títulos, contenido de páginas, propiedades de databases, y archivos. Soporta filtros por tipo (page, database, comment), por workspace, y por fecha. Search as you type con resultados en tiempo real.  
**MCP Tool necesaria:** `search.global`, `search.filter`, `search.recent`, `search.quickOpen`  
**Complejidad:** Alta (search index + relevance)  
**Free tier viable:** Sí

### Paper: Search Full-Text
**Categoría:** ORGANIZACIÓN  
**Descripción:** Búsqueda de texto completo en todos los documentos Paper del usuario. Busca en títulos y contenido. Resultados agrupados por documento. Sin filtros avanzados.  
**MCP Tool necesaria:** `search.fulltext`, `search.results`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Favorites + Pinned Pages
**Categoría:** ORGANIZACIÓN  
**Descripción:** Páginas y databases se pueden marcar como favoritas. Los favoritos aparecen en una sección especial en la sidebar. Se pueden reordenar drag & drop. Funciona como "bookmarks" de acceso rápido.  
**MCP Tool necesaria:** `favorite.add`, `favorite.remove`, `favorite.reorder`, `favorite.list`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Starred/Favorites
**Categoría:** ORGANIZACIÓN  
**Descripción:** Documentos se pueden "estrellar" (star) para acceso rápido. Los starred docs aparecen en una sección dedicada en la sidebar. Funciona como favoritos/pins.  
**MCP Tool necesaria:** `favorite.star`, `favorite.unstar`, `favorite.list`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Recent Pages
**Categoría:** ORGANIZACIÓN  
**Descripción:** Sección de páginas recientemente visitadas. Se actualiza automáticamente. Muy útil para retomar trabajo donde se dejó. Accesible desde la sidebar y desde el search global.  
**MCP Tool necesaria:** `recent.list`, `recent.visit`, `recent.clear`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Paper: Recent Docs
**Categoría:** ORGANIZACIÓN  
**Descripción:** Lista de documentos recientemente abiertos/editados. Aparece en la home de Paper y en el menú de creación rápida.  
**MCP Tool necesaria:** `recent.list`, `recent.open`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Templates Gallery (Team + Personal)
**Categoría:** ORGANIZACIÓN  
**Descripción:** Templates organizados por categoría: Design, Engineering, Marketing, Product, Sales, HR, Personal, Education, etc. Los usuarios pueden crear templates de equipo y personales. Los templates pueden ser páginas completas o bloques específicos (template buttons).  
**MCP Tool necesaria:** `template.list`, `template.categories`, `template.create`, `template.share`, `template.install`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Workspace / Home Dashboard
**Categoría:** ORGANIZACIÓN  
**Descripción:** Vista "Home" con: quick links, tareas asignadas, páginas recientes, favoritos, y actividad del equipo. Personalizable por usuario. También tiene "Inbox" de notificaciones integrado.  
**MCP Tool necesaria:** `home.dashboard`, `home.customize`, `home.widgets`, `home.inbox`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Tags & Labels (vía Properties)
**Categoría:** ORGANIZACIÓN  
**Descripción:** No tiene "tags" globales como Evernote, pero las databases usan propiedades Select/Multi-select que funcionan como tags. Se pueden filtrar, agrupar, y ordenar por tags. Los tags se pueden gestionar centralizadamente desde la database.  
**MCP Tool necesaria:** `tag.create`, `tag.assign`, `tag.filter`, `tag.manage`, `tag.color`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: Tags & Backlinks
**Categoría:** ORGANIZACIÓN  
**Descripción:** Sistema de tags para documentos. Backlinks automáticos: cuando un documento referencia a otro, Craft muestra "linked to this page" y "mentioned in". Similar a Roam Research/Obsidian en concepto de bidirectional linking.  
**MCP Tool necesaria:** `tag.create`, `tag.assign`, `backlink.show`, `backlink.graph`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: Breadcrumbs & Navigation
**Categoría:** ORGANIZACIÓN  
**Descripción:** Breadcrumbs en el top de cada página mostrando la jerarquía completa. Click en cualquier nivel del breadcrumb navega a esa página. También tiene "Backlinks" (páginas que linkean a esta) visibles en el top.  
**MCP Tool necesaria:** `breadcrumb.show`, `breadcrumb.navigate`, `backlink.show`, `backlink.count`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Notion: Trash / Archivo
**Categoría:** ORGANIZACIÓN  
**Descripción:** Las páginas eliminadas van a Trash. Se pueden recuperar de Trash dentro de 30 días (free) o más (planes pagos). Pasado ese tiempo, se eliminan permanentemente. También existe "Archive" para databases (soft delete).  
**MCP Tool necesaria:** `trash.list`, `trash.restore`, `trash.empty`, `trash.autoDelete`  
**Complejidad:** Baja  
**Free tier viable:** Sí

---

## 9. 📝 FUNCIONALIDADES ESPECÍFICAS DE NOTION (Avanzadas)

### Notion: Database Relations & Rollups
**Categoría:** ESTRUCTURA (Avanzado)  
**Descripción:** Relations conectan items entre databases diferentes (ej: Tasks → Projects). Rollups agregan datos de items relacionados: count, sum, average, min, max, date range, earliest/latest date. Esto permite construir sistemas de datos relacionales completos sin código.  
**MCP Tool necesaria:** `database.relate`, `database.rollup`, `database.linkedView`, `database.filterByRelation`  
**Complejidad:** Muy Alta  
**Free tier viable:** No — extremadamente complejo de implementar

### Notion: Formulas (2.0)
**Categoría:** ESTRUCTURA (Avanzado)  
**Descripción:** Lenguaje de fórmulas completo con 100+ funciones: matemáticas, texto, fechas, lógicas, arrays, condicionales. Soporta variables, funciones anidadas, y tipo de retorno tipado (número, texto, fecha, checkbox). Similar a Excel formulas pero más moderno.  
**MCP Tool necesaria:** `formula.create`, `formula.parse`, `formula.evaluate`, `formula.functions`  
**Complejidad:** Muy Alta  
**Free tier viable:** No — requiere engine de fórmulas completo

### Notion: Button Blocks
**Categoría:** ESTRUCTURA (Avanzado)  
**Descripción:** Botones que ejecutan acciones predefinidas: crear página, editar propiedades, insertar bloques, enviar webhook. Similar a macros. Muy útil para workflows repetitivos: "Create weekly report", "Log meeting notes", "Add design task".  
**MCP Tool necesaria:** `button.create`, `button.setAction`, `button.execute`, `button.log`  
**Complejidad:** Media  
**Free tier viable:** Parcial

### Notion: Views (Database Views)
**Categoría:** ESTRUCTURA (Avanzado)  
**Descripción:** Una database puede tener múltiples vistas con diferentes: tipo (table/board/timeline/calendar/list/gallery), filtros, ordenamiento, propiedades visibles, y agrupamiento. Las vistas se pueden enlazar en cualquier página. Cada vista es independiente.  
**MCP Tool necesaria:** `view.create`, `view.configure`, `view.link`, `view.share`, `view.filter`  
**Complejidad:** Alta  
**Free tier viable:** Sí — implementación gradual por tipo de vista

### Notion: Conditional Formatting (vía Filtros)
**Categoría:** ESTRUCTURA (Avanzado)  
**Descripción:** Filtros condicionales en databases funcionan como formato condicional: "Mostrar solo tareas vencidas", "Agrupar por prioridad", "Filtrar por status != Done". Las vistas guardan estos filtros y se actualizan automáticamente.  
**MCP Tool necesaria:** `filter.byProperty`, `filter.byDate`, `filter.byStatus`, `filter.saveView`  
**Complejidad:** Media  
**Free tier viable:** Sí

---

## 10. 🎨 FUNCIONALIDADES ESPECÍFICAS DE CRAFT (Diseño Editorial)

### Craft: Estilos de Texto Editorial (Typography-First)
**Categoría:** ESTILOS  
**Descripción:** Craft tiene un sistema tipográfico excepcional con fuentes premium (Inter, system fonts). Soporta: Title, Subtitle, Heading 1-3, Body, Caption, Quote (large y small). El espaciado, kerning, y line-height están cuidadosamente diseñados para legibilidad.  
**MCP Tool necesaria:** `type.setStyle`, `type.setFont`, `type.setSize`, `type.setLineHeight`, `type.preset`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: Page Styling (Backgrounds, Covers)
**Categoría:** ESTILOS  
**Descripción:** Fondos de página personalizables (sólidos, gradientes, imágenes). Cover images con efectos de parallax. Las páginas pueden tener "mood" visual: dark pages, colorful backgrounds, minimal layouts.  
**MCP Tool necesaria:** `page.setBackground`, `page.setCover`, `page.setTheme`, `page.setMood`  
**Complejidad:** Baja  
**Free tier viable:** Sí

### Craft: Cards Visual System
**Categoría:** CANVAS  
**Descripción:** Las cards en Craft tienen bordes redondeados, sombras sutiles, y padding generoso. Visualmente son "tarjetas" flotando en el canvas. Se pueden agrupar visualmente. El diseño de cards es uno de los sellos distintivos de Craft.  
**MCP Tool necesaria:** `card.setStyle`, `card.setShadow`, `card.setBorderRadius`, `card.setPadding`  
**Complejidad:** Baja  
**Free tier viable:** Sí

---

## 11. 🏗️ ARQUITECTURA TÉCNICA (Referencia para MCP Tools)

### Notion: Block Data Model
**Categoría:** ARQUITECTURA  
**Descripción:** Todo en Notion es un bloque. Cada bloque tiene: id, type, parent (page/database/block), children (bloques anidados), created_time, last_edited_time, created_by, last_edited_by. Los bloques son la unidad atómica de contenido y se pueden consultar, crear, actualizar, y eliminar individualmente vía API.  
**MCP Tool necesaria:** `block.get`, `block.list`, `block.create`, `block.update`, `block.delete`, `block.children`  
**Complejidad:** Alta  
**Free tier viable:** Sí — el modelo de datos es el core

### Notion: Rich Text Object
**Categoría:** ARQUITECTURA  
**Descripción:** El texto en Notion es un objeto "rich_text" que contiene un array de anotaciones: bold, italic, strikethrough, underline, code, color, link (URL + text). Cada segmento puede tener diferentes anotaciones. Soporta mentions (@page, @user, @date) embebidas en el texto.  
**MCP Tool necesaria:** `richtext.parse`, `richtext.render`, `richtext.annotations`, `richtext.mention`  
**Complejidad:** Media  
**Free tier viable:** Sí

### Notion: CRDT Sync Engine
**Categoría:** ARQUITECTURA  
**Descripción:** Notion usa Conflict-Free Replicated Data Types para sincronización offline-first y colaboración en tiempo real. Cada cambio es una operación atómica en el CRDT. El engine resuelve conflictos automáticamente sin necesidad de bloqueos.  
**MCP Tool necesaria:** `sync.crdt`, `sync.merge`, `sync.operation`, `sync.serialize`  
**Complejidad:** Muy Alta  
**Free tier viable:** No — requiere expertise en CRDTs

---

## 12. 🔑 RESUMEN: TOP FEATURES PARA MCP-FIRST DESIGN TOOL

### Prioridad P0 — Core Diferenciador (debe tener)
1. **Block-Based Canvas** — como Notion: todo es un bloque arrastrable
2. **AI-Powered Design** — IA que crea/modifica objetos en el canvas (diferenciador MCP)
3. **Real-Time Sync** — colaboración en tiempo real (WebSocket básico)
4. **Slash Commands + Markdown** — inserción rápida de bloques
5. **API First** — todo accesible vía API REST + MCP tools

### Prioridad P1 — Valor Inmediato
6. **Comments + Mentions** — colaboración asíncrona
7. **Version History** — navegación temporal de cambios
8. **Templates** — galería de templates de diseño
9. **Embeds (Figma, YouTube, etc.)** — integración con herramientas existentes
10. **Export (PNG/SVG/PDF/MD)** — ya existe en Mini-Figma ✅
11. **Dark Mode + Themes** — ya existe en Mini-Figma ✅

### Prioridad P2 — Completitud
12. **Databases (simplificado)** — tablas con propiedades tipadas
13. **Toggle Blocks / Accordion** — contenido colapsable
14. **Callout Blocks** — tips, warnings, info boxes
15. **Columns Layout** — layouts multi-columna
16. **Publish to Web** — compartir diseños públicamente
17. **Search Full-Text** — búsqueda global en documentos
18. **Favorites + Recent** — acceso rápido

### Prioridad P3 — Nice to Have / Futuro
19. **Offline Mode** — editar sin conexión
20. **Synced Blocks** — bloques sincronizados en múltiples documentos
21. **Database Relations** — relaciones entre tablas
22. **Notion-like Calendar** — vista de calendario
23. **Craft-like Editorial Design** — tipografía premium
24. **Custom Domain Publishing** — publicación en dominio propio

---

## 📊 TOTAL DE FUNCIONALIDADES DOCUMENTADAS

| Categoría | Paper | Notion | Craft | Total Únicas |
|-----------|:---:|:---:|:---:|:---:|
| Canvas Inteligente | 5 | 9 | 4 | 12 |
| Estructura Documento | 5 | 12 | 4 | 14 |
| Colaboración | 6 | 7 | 2 | 8 |
| Integraciones & Automation | 3 | 10 | 3 | 12 |
| Media & Archivos | 6 | 6 | 2 | 8 |
| IA & Smart Features | 3 | 8 | 3 | 10 |
| Publicación & Export | 3 | 6 | 3 | 7 |
| Organización | 5 | 12 | 4 | 14 |
| Arquitectura Técnica | 0 | 4 | 0 | 4 |
| **TOTAL** | **36** | **74** | **25** | **89** |

---

> **Conclusión:** Notion es el más completo con 74 funcionalidades, seguido de Paper (36) y Craft (25).  
> **La oportunidad MCP-first:** Ninguna de estas herramientas tiene IA que manipule objetos en un canvas de diseño. Combinar el modelo de datos de Notion (bloques, databases, API) con capacidades de canvas visual (Figma-like) y control vía IA a través de MCP tools es el espacio blanco que estamos atacando. 🎯
