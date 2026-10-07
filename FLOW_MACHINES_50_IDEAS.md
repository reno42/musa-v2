# Flow Machines — Biblioteca de 50 ideas

> Análisis para decidir qué machines del Flow Builder construimos. El builder ya no es
> solo la content machine de noticias: con los ~370 tools MCP de Musa, cualquier
> combinación fuente → IA → pieza de diseño/video/foto/CRM es replicable como flow.
>
> Cada idea indica: qué entra y qué sale, las piezas reales del catálogo que usa, y qué
> falta para armarla. Etiquetas:
>
> - **[Hoy]** — armable con los nodos actuales (source / ai / template / map / condition / text / report).
> - **[Tool-node]** — requiere UN solo nodo nuevo genérico: `tool` (llama cualquier tool MCP
>   con params con placeholders `{{item.x}}` / `{{steps.id.y}}`). Es LA palanca estratégica:
>   un solo nodo desbloquea ~35 de estas ideas sin desarrollar nodos dedicados.
> - **[Nodo nuevo]** — conviene un nodo dedicado (foto, video, publish…) porque el tool
>   es asíncrono (polling), maneja binarios o necesita UX propia.

## Criterios para decidir (propuesta)

1. **Valor por clic**: ¿la machine reemplaza horas repetitivas o es demo?
2. **Esfuerzo**: [Hoy] < [Tool-node] < [Nodo nuevo].
3. **Demostrabilidad**: ¿se entiende el valor en 30 segundos?
4. **Frecuencia**: diaria/semanal > una vez al año.

---

## A. Machines de diseño (motor de templates — el corazón)

**1. Event Assets Machine** *(tu seed #1)* — [Hoy]/[Tool-node]
Un dato de evento (webhook, formulario o texto) genera el kit completo: banners, posts,
stories, landing y stickers, todo maquetado con la marca.
*Entrada → Salida:* datos del evento → template con N frames + PNGs exportados.
*Piezas:* trigger webhook + ai_generate_text (copy del evento) + nodos template (post/story/banner/landing) + render_batch + export_batch.

**2. Animación propagada** *(tu seed #2)* — [Tool-node]
Elegís un frame animado del editor y aplica LA MISMA animación a cualquier otra pieza.
*Entrada → Salida:* frame con animación → N frames con la misma animación aplicada.
*Piezas:* get_animation + set_animation (o apply_transition) sobre frames/clones; con el nodo `tool` se encadena hoy mismo.

**3. Generador de Manual de Marca** *(tu seed #3)* — [Tool-node]
Elegís un frame con el logotipo y genera tipografía, paleta y assets maquetados como
manual horizontal, manual vertical y plantillas de social media.
*Entrada → Salida:* template con logo → extract_design_system + generate_brand_manual → deck horizontal + vertical + kit social.
*Piezas:* extract_design_system, generate_brand_manual, create_deck, adapt_all_formats, ai_palette/match_font para completar huecos.

**4. Carousel Factory** — [Hoy]
Un texto largo (blog, hilo, guion) se convierte en carrusel IG/LI con slides maquetadas.
*Piezas:* ai (divide en slides con copy) + create_html_carousel o nodos template slide × N.

**5. Deck/Proposal Generator** — [Hoy]/[Tool-node]
Brief o datos de un deal → presentación completa con charts.
*Piezas:* create_deck + ai_generate_text + create_chart + export_pdf.

**6. CSV → Frames (catálogos)** — [Tool-node]
CSV de productos/propiedades/menú → un frame maquetado por fila.
*Piezas:* apply_csv_to_frames + generate_csv_template; ideal inmobiliarias, e-commerce, cartas.

**7. Multi-formato 1-click** — [Tool-node]
Un post maestro → story, banner web, header de LinkedIn, miniatura de YouTube.
*Piezas:* detect_structure + adapt_all_formats + compare_adaptations (QA visual del adaptado).

**8. Localización de campañas** — [Tool-node]
Template en ES → clones traducidos y adaptados por mercado.
*Piezas:* duplicate_template + ai_translate + adapt_format.

**9. Variantes A/B automáticas** — [Tool-node]
Un frame → 3 variantes de layout/copy para testear.
*Piezas:* duplicate_frame + ai_suggest_layout + ai_generate_text (tonos distintos).

**10. Chart Engine** — [Hoy]
Datos (API, CSV, report) → charts maquetados en frames de reporte.
*Piezas:* source_http + map + create_chart + template reporte.

**11. Figma → Sistema** — [Tool-node]
Importás un archivo de Figma y sale design system + tokens + guideline.
*Piezas:* import_figma_file + extract_design_system + export_design_tokens + create_brand_guideline.

**12. Optimizador de assets** — [Tool-node]
Recorre las imágenes del workspace y las optimiza/reemplaza en masa.
*Piezas:* list_assets + optimize_image + replace_asset.

**13. Iconografía consistente** — [Hoy]
Tema + lista de conceptos → set de íconos del mismo estilo insertados en frames.
*Piezas:* ai (elige conceptos) + search_icons + insert_icon / get_icon_svg.

**14. Sticker / Asset Pack** — [Tool-node]/[Nodo nuevo]
Tema → pack de stickers/ilustraciones vectorizadas y recortadas.
*Piezas:* ai_generate_image + vectorize_image + remove_background + export_frame.

**15. Mockups por dispositivo** — [Tool-node]
Un diseño web → renders desktop/tablet/mobile para presentar.
*Piezas:* render_to_formats + render_frame_png + template de presentación.

## B. Marca

**16. Guardián de marca (cron)** — [Tool-node]
Cada noche revisa templates nuevos contra la marca y repara lo auto-reparable.
*Piezas:* trigger schedule + lint_design + validate_brand + check_contrast + auto_fix_brand + report.

**17. Onboarding de marca express** — [Tool-node]
Subís un logo/captura → tokens + guideline + playbook + kit social inicial.
*Piezas:* image_to_design + extract_design_system + create_brand_guideline + get_brand_playbook.

**18. Kit de franquicia / white label** — [Tool-node]
Biblioteca de plantillas blancas → aplicadas a la marca de cada cliente en masa.
*Piezas:* find_templates + apply_brand_to_template + validate_brand.

**19. Auditoría de accesibilidad** — [Tool-node]
Batch de contrastes/tamaños/alt sobre los templates activos con reporte.
*Piezas:* check_accessibility + report + export_pdf.

**20. Migrador de tokens** — [Tool-node]
Detecta estilos duplicados/desviados y propone la migración canónica.
*Piezas:* find_duplicate_styles + diff_brand_tokens + resolve_brand_token_proposal.

## C. Motion / Video

**21. Campaña de video desde template** — [Nodo nuevo]
Cada frame de una campaña se anima en video con el motion de la marca.
*Piezas:* generate_image_video (+check de polling) + set_video_project + video_export.

**22. Reel de productos** — [Nodo nuevo]
Catálogo (CSV/RSS) → reel con transiciones, música y texto.
*Piezas:* set_video_reel + set_video_audio + set_video_text + video_export.

**23. Video de evento (countdown/announce)** — [Nodo nuevo]
Datos del evento → video anuncio con textos animados.
*Piezas:* set_video_text + set_take_effects + generate_text_video.

**24. Foto → video (Ken Burns)** — [Nodo nuevo]
Fotos del workspace → clips con movimiento sutil para reels/stories.
*Piezas:* photo_create_variant + generate_image_video_check.

**25. Video multi-formato** — [Nodo nuevo]
Un master video → exports 9:16, 1:1, 16:9 con crops inteligentes.
*Piezas:* video_export por formato + set_video_project.

## D. Foto

**26. Foto de producto e-commerce** — [Nodo nuevo]
Foto cruda → fondo removido → variantes por canal (ficha, banner, social).
*Piezas:* remove_background + photo_create_mask + photo_create_variant + photo_apply_preset.

**27. Foto → diseño** — [Tool-node]
Captura/inspiración → diseño editable con el sistema de la marca.
*Piezas:* image_to_design + extract_variables + apply_variables.

**28. Composición con stock** — [Nodo nuevo]
Producto + fondo/props de stock → composición final.
*Piezas:* search_stock_image + photo_compose_add_layer + photo_compose_set_layer_mask.

**29. Watermark / resize en masa** — [Nodo nuevo]
Carpeta de fotos → versiones con marca de agua y tamaños por canal.
*Piezas:* photo_apply_operation (batch) + photo_create_variant.

**30. UGC → brand-ready** — [Nodo nuevo]
Contenido de usuarios → recorte/limpieza + montaje en template de marca.
*Piezas:* separate_image_layers + photo ops + template nodo.

## E. Copy / Contenido

**31. Calendario mensual automático** — [Tool-node]
Fuentes (RSS, X, blog) → ideas redactadas directo al calendario de contenidos.
*Piezas:* source_rss/nitter + ai + add_content_idea + list_calendar_entries/update_content.

**32. 1 post → 8 canales** — [Hoy]
Un texto largo → hilo, post LI, caption IG, newsletter, guion de reel (copy recipes de la casa).
*Piezas:* ai + text nodes (o list_copy_recipes para usar las recetas existentes).

**33. Newsletter machine** — [Hoy]
Fuentes de la semana → digest redactado → template email maquetado.
*Piezas:* source_rss × N + ai (digest) + template newsletter + report.

**34. SEO brief machine** — [Tool-node]
Keyword → brief completo + landing esqueleto maquetada.
*Piezas:* ai_generate_text (estructura, headings, FAQs) + create_frame + set_html.

**35. Trans-creation de campañas** — [Tool-node]
Campaña master → mercados con copy traducido Y diseño adaptado.
*Piezas:* ai_translate + duplicate_template + adapt_format (combina 7 y 8).

## F. CRM / Ventas

**36. Lead magnet instantáneo** — [Tool-node]
Webhook del formulario → contacto creado + asset personalizado (con nombre/logo) enviado.
*Piezas:* trigger webhook + create_crm_contact + template (personalización) + render_frame_png.

**37. Propuesta express** — [Tool-node]
Deal con datos → deck de propuesta con la marca → PDF al deliverable del deal.
*Piezas:* get/list datos del deal + create_deck + export_pdf + update_crm_deliverable.

**38. Reporte semanal de proyecto** — [Tool-node]
Kanban/harness del cliente → página de estado maquetada cada viernes.
*Piezas:* get_weekly_report_csv / studio_list_cards + template reporte + export_pdf.

**39. Campaña win-back** — [Tool-node]
Interacciones viejas → segmento → piezas personalizadaS + entradas al calendario.
*Piezas:* list_interactions + condition + ai + add_content_idea.

**40. Deal ganado → onboarding** — [Tool-node]
Deal cerrado → checklist Kanban del proyecto + manual de marca + kit de arranque.
*Piezas:* create_crm_deal (evento) + studio_create_card × N + idea #3 + create_template.

## G. Social / Publicación

**41. Inbox respondedor** — [Tool-node]
Menciones/DMs → respuesta sugerida por IA (aprobación humana) → reply + contacto capturado.
*Piezas:* list_social_inbox + ai + reply_social + capture_social_contact.

**42. Repurpose master** — [Tool-node]
1 asset publicado → versiones para todos los canales + publicación programada.
*Piezas:* adapt_all_formats + publish_content + set_publish_defaults.

**43. Reporte de campaña** — [Tool-node]
Al cerrar la campaña → deck con atribución y métricas maquetado solo.
*Piezas:* list_campaign_report + get_attribution_report + template reporte + export_pdf.

**44. Social kit en vivo** — [Tool-node]
Webhook del evento (hora/agenda) → stories y posts del día listos para publicar.
*Piezas:* trigger webhook + template story × N + publish_content.

**45. Curador de UGC** — [Nodo nuevo]
Menciones con foto → limpieza + permiso logueado + montaje en template de repost.
*Piezas:* list_social_inbox + photo ops + template + log_interaction.

## H. Ops / Datos / Misc

**46. Dashboard semanal de marca** — [Tool-node]
Lunes 8am: métricas del workspace → dashboard maquetado → PDF a tu correo/CRM.
*Piezas:* trigger schedule + get_metrics + get_dashboard_summary + template + export_pdf.

**47. Second brain visual** — [Tool-node]
Notas del brain → frameworks/diagramas maquetados (mapas mentales de tu conocimiento).
*Piezas:* search_notes + brain_digest + create_chart + template.

**48. Webhook universal (bridge n8n/Zapier)** — [Hoy]
Cualquier flow expone webhook: sistemas externos disparan machines de Musa.
*Piezas:* trigger webhook + manage_webhooks + flow_webhook_rotate. Es el pegamento para vender Musa como capa de diseño de otras automatizaciones.

**49. Caja nocturna** — [Tool-node]
Cola de trabajos: de noche corre las machines pesadas (renders, videos) en batch.
*Piezas:* task_queue_add/list + process_daily_batch + musa_batch_run + flow_due_check.

**50. Design QA nocturno** — [Tool-node]
Cada noche: adapta formatos nuevos, compara contra el master y reporta hallazgos.
*Piezas:* trigger schedule + adapt_all_formats + compare_adaptations + lint_design + report.

---

## Shortlist sugerida (valor/esfuerzo para empezar)

| # | Machine | Etiqueta | Por qué primero |
|---|---------|----------|-----------------|
| 1 | Event Assets Machine | [Hoy] | Tu seed; demo perfecta, 0 nodos nuevos |
| 3 | Manual de Marca | [Tool-node] | Tu seed; argumento de venta enorme, 1 nodo `tool` lo habilita |
| 2 | Animación propagada | [Tool-node] | Tu seed; diferenciador motion |
| 48 | Webhook universal | [Hoy] | Ya existe; desbloquea ventas "integraciones" |
| 31 | Calendario mensual | [Tool-node] | Usa el calendar de la casa; uso de alta frecuencia |
| 6 | CSV → Frames | [Tool-node] | Casos verticales (inmobiliaria, e-com) |
| 16 | Guardián de marca | [Tool-node] | Cron + tools de brand ya existentes |
| 33 | Newsletter machine | [Hoy] | Armable HOY con nodos actuales |
| 26 | Foto producto e-com | [Nodo nuevo] | Cuando toquemos el nodo foto |
| 21 | Campaña de video | [Nodo nuevo] | Cuando toquemos el nodo video |

**Recomendación de ruta:** 1) construir el nodo genérico `tool` (desbloquea ~35 ideas),
2) armables [Hoy] ya (1, 4, 5, 10, 32, 33, 48), 3) nodos dedicados foto (26-30) y
video (21-25) como siguiente fase de motor.
