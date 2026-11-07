---
name: musa-medir
description: Medir en Musa. Reportes por marca y campaña (plan contra real), embudos reales de publicación a venta, growth loops, KPIs del espacio, actividad y reporte semanal en CSV. Úsala para reportes, análisis de resultados y preparar reuniones con clientes.
module: medir
---

# Medir · reportes, embudos y loops

## Qué hay en el módulo

- **Reportes**: métricas por campaña (plan contra real: inversión, impresiones, alcance, clics, vistas) desde el calendario.
- **Embudos**: datos reales por marca: piezas publicadas → contactos nuevos → oportunidades → ganadas.
- **Loops**: la mecánica de crecimiento de cada marca (adquisición, retención, monetización).
- **Ads · pauta**: resultados de Meta, TikTok, LinkedIn y Google Ads conectados.

## Flujos

**Reporte mensual de una marca**
1. `get_dashboard_summary({ workspaceId, brandId, range })` → KPIs.
2. `list_campaign_report({ workspaceId, brandId, from, to })` → plan contra real por campaña.
3. `get_funnel({ workspaceId, brandName, days: 30 })` → embudo real.
4. `get_attribution_report({ from, to })` → qué piezas trajeron conversaciones.
5. Escribe los hallazgos (3-5 conclusiones y próximos pasos). Si piden documento, arma un deck con `create_deck` (skill `musa-diseno`) y expórtalo con `export_pdf`.

**Reporte semanal para el equipo**
- `get_weekly_report_csv({ workspaceId, range })`: KPIs por marca, embudo por etapa y más, en CSV.

**Actividad del espacio**
- `get_metrics({ workspaceId, from, to })`: operaciones de diseño, frames y archivos creados por día.
- `get_recent_activity`: qué se movió.

**Cargar resultados reales en una pieza**
- `update_content({ id, actualSpend, actualImpressions, actualReach, actualClicks, actualViews })` (y los `plan*` para el plan).

**Growth loops**
- `list_growth_loops({ workspaceId, brandName?, macro? })`; `save_growth_loop({ brandName, macro, sub, values })` para registrar los valores que corre cada loop.

## Pauta pagada

Para el reporte de pauta: `ads_sync` trae los números reales y `list_ad_campaigns` los muestra (gasto, impresiones, clics, conversiones). Planificar, crear, pausar o reactivar campañas está en la skill `musa-anunciar`.

## Herramientas

- `get_dashboard_summary`: KPIs del espacio o de una marca.
- `list_campaign_report`: plan contra real por campaña.
- `get_funnel`: embudo real por marca.
- `get_attribution_report`: atribución pieza → conversación.
- `get_weekly_report_csv`: reporte semanal en CSV.
- `get_metrics`: actividad diaria del espacio.
- `get_recent_activity`: actividad reciente.
- `list_growth_loops`, `save_growth_loop`: loops de crecimiento.
- `update_content`: cargar métricas plan/real en una pieza.
- `list_ad_campaigns`, `ads_sync`: resultados reales de la pauta.

## Reglas

- Solo datos reales: si una métrica no existe, dilo; no la estimes como si fuera medida.
- Separa siempre lo medido de tus interpretaciones.
- Compara contra el periodo anterior cuando sea posible.

## Ejemplos

- "Hazme el reporte de octubre de Café Altura para presentárselo al cliente"
- "¿Cuál es el embudo de Kuna en los últimos 90 días?"
- "Mándame el reporte semanal en CSV"
