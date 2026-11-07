---
name: musa-anunciar
description: Anunciar (pauta pagada) en Musa. Planificar campañas de ads por marca, ver campañas reales de Meta, TikTok, LinkedIn y Google con su gasto y resultados, sincronizar métricas, crear campañas en Meta o TikTok y pausar o reactivar campañas. Úsala para todo lo de publicidad pagada.
module: anunciar
---

# Anunciar · pauta pagada

## Qué hay en el módulo

- **Campañas planificadas**: lo que la agencia planea por marca (red, objetivo, presupuesto en USD, notas). Viven en Musa.
- **Campañas reales**: las que existen en las cuentas publicitarias conectadas (Meta, TikTok, LinkedIn, Google Ads), con gasto, impresiones, clics y conversiones. Se traen al sincronizar.
- **Cuentas**: cada persona conecta sus propias credenciales de ads en Configuración › Integraciones (BYOK) y vincula la cuenta al espacio.

## Flujos

**Planificar la pauta de una marca**
1. `resolve_brand` para la marca; `list_ad_campaigns({ workspaceId, brandId })` para no duplicar.
2. `ad_campaign_plan_save({ workspaceId, brandId, name, network: "meta", objective, budgetUsd, notes })`.
3. Ajustes: `ad_campaign_plan_save({ id, ... })`; `status: "pausada"` o `"finalizada"` para cerrarla.

**Ver resultados reales**
1. `list_ad_accounts({ workspaceId })` → cuentas conectadas (y su último error si lo hay).
2. `ads_sync({ workspaceId, days: 30 })` → trae campañas y métricas.
3. `list_ad_campaigns({ workspaceId, brandId? })` → `real` con gasto y resultados. Para el informe, skill `musa-medir`.

**Crear una campaña en la red**
- `ad_campaign_create({ workspaceId, accountRef, name, objective, dailyBudget, campaignId?, brandId? })`: solo Meta y TikTok; se crea **pausada** para que la persona la revise en su administrador. Google y LinkedIn se crean en su administrador y llegan con `ads_sync`.

**Pausar o reactivar**
- `ad_campaign_status({ workspaceId, id, action: "pause" | "resume", confirm: true })`, solo cuando la persona lo pidió: cambia gasto real.

**Conectar una cuenta nueva**
- La credencial la pone la persona (Configuración › Integraciones); luego vincula la cuenta en Anunciar. Si `list_ad_accounts` está vacío, díselo.

## Herramientas

- `list_ad_campaigns`: campañas planificadas y reales.
- `ad_campaign_plan_save`: crear o editar una campaña planificada.
- `list_ad_accounts`: cuentas publicitarias conectadas.
- `ads_sync`: traer campañas y métricas reales.
- `ad_campaign_create`: crear una campaña (pausada) en Meta o TikTok.
- `ad_campaign_status`: pausar o reactivar una campaña real.

## Reglas

- Nada que mueva dinero real sin pedido explícito y `confirm: true`.
- Los presupuestos los define la persona; puedes recomendar, no decidir.
- Si una red responde error de credencial, pide que la persona revise su conexión; no reintentes en bucle.

## Ejemplos

- "Planifica la pauta de diciembre de Café Altura: 1500 USD en Meta para ventas"
- "¿Cuánto llevamos gastado en ads este mes y qué campaña rinde mejor?"
- "Pausa la campaña de TikTok de Kuna"
