---
name: musa-websites
description: Websites en Musa. Crear landings y sitios con secciones, CMS propio (blog, productos, casos) para contenido dinámico, SEO, GEO (buscadores de IA) y AEO (respuestas directas), formularios que crean leads en el CRM, dominio propio, visitas y sincronización con GitHub y Supabase. Úsala para landings, páginas de captación, sitios de servicios, blogs y para mejorar el posicionamiento.
module: websites
---

# Websites

## Qué hay en el módulo

- **Mis websites**: cada website es del espacio (lo ve y edita el equipo; nunca los clientes de una agencia). Tiene páginas hechas de **secciones** (portada, beneficios, precios, preguntas, formulario, lista del CMS…), un tema (colores, tipografías, bordes) y ajustes (menú, pie, SEO, IA, analítica).
- **CMS**: colecciones con campos propios (blog, productos, casos, equipo, eventos). Las **entradas publicadas salen al instante** en la web, sin volver a publicar el sitio.
- **SEO e IA**: título, descripción e imagen por página; resumen para buscadores de IA, perfiles de la marca, `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, RSS y JSON-LD (WebSite, Organization, WebPage, BreadcrumbList, FAQPage, BlogPosting/Product) automáticos.
- **Publicar**: nada es público hasta `publish_website`. Cada publicación guarda una versión (se puede volver atrás).
- **Direcciones**: siempre `…/w/<slug>/` (dirección de Musa). Con plan Creador o superior, dominio propio. El plan gratis lleva el sello «Hecho con Musa».
- **Integraciones** (opcionales, para equipos técnicos): GitHub (sube el sitio como HTML estático en un commit) y Supabase propio (copia leads y CMS a sus tablas).

## Flujos

**Landing nueva**
1. Pregunta SIEMPRE en qué espacio va (`list_workspaces`) y con qué marca (`brands_list`).
2. `create_website({ workspaceId, name, template: "landing", brandId })` (plantillas: landing, servicios, blog, blank). Toma colores, tipografías y logo de la marca.
3. `get_website_page({ siteId, page: "/" })` y reemplaza los textos de ejemplo. Escribe con la voz de la marca (`get_brand_strategy`, skill `musa-copy`).
4. Formulario: crea o elige uno (`form_save` de la skill `musa-mailing-eventos`) y ponlo en la sección `form` con `props.formId`. Las respuestas crean el lead en el CRM.
5. `save_website_page({ siteId, path: "/", sections })`: `sections` reemplaza la lista completa.
6. `audit_website({ id })` y corrige lo que falte.
7. `publish_website({ id })` y comparte `urls.live`.

**Secciones**
- `list_website_section_types()` trae cada tipo con sus campos y un ejemplo. Forma: `{ id, type, props, style: { bg: ""|"alt"|"acc"|"drk", align: ""|"c", pad: ""|"ps"|"pl", anchor } }`.
- Enlaces internos con `/` (`/servicios`) o con ancla (`#contacto`; la sección de formulario ya es `#contacto`).
- Una sola portada (`hero`) por página; su título es el H1.

**Contenido dinámico (CMS)**
1. `save_website_collection({ siteId, name: "Casos", fields: [{ k: "cover", label: "Portada", type: "image" }, { k: "excerpt", label: "Resumen", type: "textarea" }, { k: "body", label: "Contenido", type: "richtext" }, { k: "client", label: "Cliente", type: "text" }], settings: { path: "/casos", schema: "CreativeWork" } })`.
2. Muéstrala en una página con una sección `{ type: "collection", props: { collection: "casos", limit: 6 } }` y publica una vez.
3. `save_website_entry({ siteId, collection: "casos", title, data: { … }, status: "published" })` aparece al instante en la lista, en su página `/casos/<slug>`, en el sitemap, en llms.txt y en el RSS. `publishAt` la oculta hasta esa fecha.
4. `list_website_entries({ siteId, collection })` para ver, editar o despublicar (`status: "draft"`).

**SEO, GEO y AEO**
- SEO: título de 15 a 65 caracteres, descripción de 70 a 170, una portada con H1, 250 palabras o más, texto alternativo en las imágenes, imagen para compartir y enlaces internos.
- GEO: `update_website({ id, settings: { ai: { summary: "Quién es, qué hace, para quién y dónde, en 2–3 frases" }, org: { name, sameAs: [Instagram, LinkedIn, Google Business…] } } })`. Suma cifras concretas (sección `stats`). Deja `ai.allowBots` en true para que ChatGPT, Claude o Perplexity puedan citarte.
- AEO: sección `faq` con 3 preguntas reales o más. Cada respuesta empieza con una frase corta que responde y luego detalla. Genera el schema FAQPage solo.
- `audit_website` da el puntaje por área y qué arreglar en cada página.

**Dominio propio**
- `connect_website_domain({ siteId, hostname: "www.marca.com" })` devuelve los registros DNS (TXT de verificación y CNAME). Después usa `check_website_domain({ id })` hasta que diga `active`. Con un dominio activo, la dirección de Musa redirige allí. `remove_website_domain` lo desconecta.

**Visitas y leads**
- `website_stats({ id, days: 30 })` da las visitas por día, las páginas más vistas, de dónde llegan y los leads de sus formularios. Cuenta personas, no bots, y no usa cookies.

**Versiones**
- `list_website_versions({ id })` y `restore_website_version({ siteId, version })` (vuelve y publica). `unpublish_website` lo saca de internet sin borrar nada.

**GitHub y Supabase propios**
- `website_integrations({ siteId })` muestra el estado y el SQL para Supabase.
- `connect_website_github({ siteId, repo: "usuario/repo", token, branch, siteUrl })` y luego `sync_website_github({ siteId })`: un commit con todas las páginas, el CMS, el sitemap, robots, llms.txt y el 404. Repite después de publicar o de cambiar el CMS.
- `connect_website_supabase({ siteId, url, key })`: desde ahí cada lead se copia a `musa_leads`. `sync_website_supabase({ siteId })` copia el CMS a `musa_cms_entries`. Si faltan las tablas, la respuesta trae el SQL.
- `disconnect_website_integration({ siteId, provider })` borra la llave guardada.

**Ver lo que hay**
- `list_websites({ workspaceId? })` lista los websites con su estado y sus URLs. `get_website({ id })` trae todo: tema, ajustes, páginas, colecciones con su conteo de entradas, dominios y límites del plan.

**Editar y borrar**
- `update_website` para el nombre, la dirección, el tema, el menú (`settings.nav`), el botón del menú (`settings.cta`), el pie y la analítica (`analytics.ga` G-…, `analytics.pixel`).
- `save_website_page` con un `path` nuevo crea páginas. `delete_website_page` borra una página; la portada no se puede borrar.
- `delete_website` y `delete_website_collection` piden `confirm: true` tras preguntar a la persona. `delete_website_entry` borra una entrada.

## Reglas

- Pregunta siempre el espacio antes de crear. Un website nunca se comparte con los clientes de una agencia.
- Los cambios de páginas, tema y menú se ven en la web solo después de `publish_website`. Dilo al terminar.
- No inventes testimonios, cifras ni logos de clientes reales: deja el ejemplo marcado o pídelos.
- El HTML propio (sección `html`) no admite scripts. Para analítica usa `settings.analytics`.
- Los websites se mueven entre espacios como el resto (`preview_move` / `move_items` con `type: "website"`).

## Ejemplos

- «Hazme una landing para el webinar de diciembre con formulario de inscripción y publícala»
- «Agrega un blog a mi web y publica este artículo»
- «¿Qué le falta a mi sitio para aparecer en ChatGPT y en Google?»
- «Conecta mi dominio www.cafealtura.pe a la web»
- «Sube mi web a mi repositorio de GitHub y manda los leads a mi Supabase»
