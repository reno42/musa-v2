---
name: musa-marcas
description: Marcas en Musa. Identidad visual (design system, tokens, tipografías, paleta), estrategia y voz, plantillas aprobadas de cada marca, manual de marca y control de que cada pieza cumpla la guía. Úsala para crear o actualizar una marca y para revisar piezas contra su guía.
module: crear/marcas
---

# Marcas · identidad, estrategia y control de marca

## Cómo es una marca en Musa

Cada marca tiene tres archivos contenedores que se crean solos:

- **Design System**: colores, tipografías, espaciados y componentes (tokens DTCG + DESIGN.md + CSS compartido).
- **Plantillas**: frames aprobados que se clonan para producir piezas nuevas.
- **Comunicación**: la estrategia (esencia, ejes de tono 0-100, públicos y personas, voz).

Además es una fila del CRM (relación, prioridad) y una nota del Segundo cerebro.

## Flujos

**Entender una marca antes de trabajar**
1. `resolve_brand({ workspaceId, brand })`: contenedores, paleta, fuentes, resumen de estrategia, nota del cerebro.
2. `get_brand_playbook({ workspaceId, brandId })`: cómo diseña esa marca en la práctica (archivos, campañas, si tiene design system).
3. `get_brand_strategy` si el trabajo es de texto o tono.

**Marca nueva desde un logo o una pieza existente**
1. Sube o importa la pieza (skill `musa-diseno`) y crea la marca con `brands_create` si no existe.
2. `create_design_system_from_asset({ workspaceId, brandId, sourceTemplateId })`: extrae tokens, crea el Design System y la guía.
3. `update_brand_strategy({ workspaceId, brandId, strategy })` con esencia, tono, público y voz (pregúntale a la persona lo que no sepas).
4. `generate_brand_manual({ templateId, brandName })` si quieren un manual en HTML.

**Design system desde varios diseños**
1. `extract_design_system({ templateIds, workspaceId, name })`.
2. `verify_design_system` para detectar tokens huérfanos o inventados.
3. `create_brand_guideline` (o `update_brand_guideline` si ya existe) con los tokens.
4. Exportar: `export_design_tokens`, `generate_design_artifacts`, `get_design_artifacts`.
- Procedimiento completo: `get_playbook({ name: "design-system" })`.

**Actualizar tokens sin romper nada**
1. `diff_brand_tokens` compara los tokens guardados con los nuevos.
2. Muéstrale las diferencias a la persona.
3. `resolve_brand_token_proposal` aplica lo que decida.

**Producir desde las plantillas de la marca**
- `create_from_plantilla({ workspaceId, brandId, frameName, count })` clona un frame aprobado N veces para rellenarlo.
- `add_frame_to_brand` guarda un frame bueno como plantilla o en el Design System.

**Revisar una pieza contra la marca**
1. `validate_brand({ templateId, brandId })` → informe de cumplimiento.
2. `check_contrast`, `check_accessibility` para legibilidad.
3. `auto_fix_brand({ templateId, brandId })` corrige colores, fuentes y espaciados; revisa el resultado.

**Copiar la lógica de una marca a otra**
- `replicate_brand_strategy({ workspaceId, sourceBrandId, targetBrandId, dryRun: true })` primero en simulación.

**Estilos bloqueados y duplicados**
- `get_active_styles`: si hay estilos bloqueados, los agentes deben usarlos. `set_style_lock` lo activa o quita (solo si la persona lo pide).
- `find_duplicate_styles` → `merge_brand_guidelines` para unificar guías repetidas.

## Herramientas

Marca y contexto
- `resolve_brand`, `get_brands`, `brands_list`, `brands_create`, `register_brand`, `get_brand_graph`, `get_brand_playbook`.
- `get_brand_strategy`, `update_brand_strategy`, `replicate_brand_strategy`.

Guías y design system
- `create_brand_guideline`, `get_brand_guideline`, `list_brand_guidelines`, `update_brand_guideline`, `delete_brand_guideline`, `restore_brand_guideline`.
- `create_design_system_from_asset`, `extract_design_system`, `verify_design_system`, `get_design_system`.
- `export_design_tokens`, `generate_design_artifacts`, `get_design_artifacts`, `download_style_template`.
- `diff_brand_tokens`, `resolve_brand_token_proposal`.
- `generate_brand_manual`, `generate_ui_components`.
- `get_active_styles`, `set_style_lock`, `find_duplicate_styles`, `merge_brand_guidelines`.

Aplicar la marca
- `apply_brand`, `apply_brand_to_template`, `add_frame_to_brand`, `create_from_plantilla`.
- `validate_brand`, `auto_fix_brand`, `check_contrast`, `check_accessibility`.
- `create_variable`, `link_variable`, `get_css_variables`, `set_css_variable`: variables de diseño enlazadas a capas.
- `skill_clone`: guarda patrones de estilo de un diseño para reutilizarlos.

Color y tipografía
- `ai_palette`, `suggest_color_palette`, `color_picker`, `match_color` (colores exactos de una imagen).
- `search_google_fonts`, `get_font_details`, `preview_font`, `add_font_to_template`, `list_fonts`, `match_font` (identifica la fuente de una imagen).
- Fuentes propias de la cuenta: skill `musa-configuracion`.

## Reglas

- No inventes colores ni fuentes: si la marca no tiene design system, propónlo y pide aprobación.
- `delete_brand_guideline` manda a la papelera; se puede restaurar.
- Los límites de cantidad de marcas dependen del plan; si `brands_create` falla por límite, díselo a la persona.

## Ejemplos

- "Crea la marca Nativa a partir de este logo y arma su design system"
- "Revisa si el carrusel nuevo cumple la guía de Café Altura y corrígelo"
- "Dame los tokens de Kuna en CSS para pasárselos al desarrollador"
