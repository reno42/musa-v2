# INFORME: Análisis de Viabilidad SaaS — Futuraria Design (design-main)

**Fecha:** 30 de julio de 2026
**Repositorio analizado:** `C:/Users/Renzo/.openclaw/workspace/design-main/`
**Modelo objetivo:** Evolución de "harness de desarrollo" a "producto SaaS comercial"
**Referencias externas:** GitLab CI, Vercel, Netlify, Replit, GitHub Copilot, Devin (Cognition), Bolt.new (StackBlitz), Lovable, Claude Code, Cursor

---

## RESUMEN EJECUTIVO

El repositorio `design-main` (Futuraria Design) es un **harness de orquestación multi-agente con capacidades de diseño gráfico** excepcionalmente avanzado para ser un proyecto open-source. Su arquitectura Leader→Implementer→Reviewer con delegación real de subagentes vía LLM calls separadas, su MCP server con 193+ tools, su multi-tenancy vía Supabase RLS, y su editor WYSIWYG HTML/CSS representan una base técnica impresionante.

Sin embargo, el repositorio está en **Fase 0 de SaaS readiness**: es un producto técnico, no un negocio. Faltan TODOS los componentes comerciales que definen a un SaaS viable. El producto es, hoy, lo que GitLab CI era en 2013 o lo que Netlify era en 2015: un excelente harness de desarrollo que DA valor técnico pero NO está preparado para cobrar, medir, retener, ni escalar comercialmente.

---

## PARTE I: ANÁLISIS DEL ESTADO ACTUAL DEL REPO

### 1. Lo que SÍ tiene (fortalezas)

| Área | Componente | Madurez |
|------|-----------|:-------:|
| **Orquestación** | Sistema Leader→Implementer→Reviewer con delegación real (spawnSubagent con tool loops aislados) | ✅ Avanzado |
| **MCP Server** | 193+ tools en `netlify/functions/mcp.mjs` (11K+ líneas) cubriendo CRUD de templates, frames, HTML/CSS, IA, export, Kanban, fonts, assets, brands, diseño, colaboración | ✅ Completo |
| **Multi-tenancy** | Supabase RLS con `account_id` en todas las tablas del harness | ✅ Implementado |
| **Auth** | Supabase Auth con signin/signup/forgot, Google OAuth listo, API keys con JWKS | ✅ Básico |
| **Realtime** | Supabase Realtime Broadcast + Presence para colaboración en vivo | ✅ Implementado |
| **Frontend** | React + Vite: Dashboard, EditorV2 (HTML/CSS con Shadow DOM), Kanban, Graph, Storage, CoverFlow | ✅ Sólido |
| **DevOps** | Netlify Functions, Supabase, scripts de migración, build pipeline | ✅ Funcional |
| **Onboarding UX** | Spotlight tour de 9 pasos + toggle en Settings | ✅ Básico |
| **Cron Jobs** | `harness_cronjobs` con programación de tareas automáticas | ✅ Sólido |
| **Rate Limiting** | `checkRateLimit` en MCP (200 req/min por IP) | ✅ Básico |
| **Error Tracking** | `harness_report_error` con logs a Supabase | ✅ Básico |

### 2. Matriz de features clave de SaaS harnesses exitosos

Los siguientes patrones emergen del estudio de harnesses que evolucionaron a SaaS:

| Harness → SaaS | Año pivote | Modelo inicial | Cómo monetizaron | Tiempo hasta billing |
|---|---|---|---|---|
| **GitLab CI** | 2015 | CI runner auto-hosted | SaaS tiers + EE license | ~2 años |
| **Vercel** | 2016 | Zeit Now (deploy CLI) | Pro/Enterprise por usage (bandwidth, build mins) | ~1.5 años |
| **Netlify** | 2015 | Static deploy CLI | Free tier → Pro ($19) → Business ($99) → Enterprise | ~1 año |
| **Replit** | 2016 | IDE online colaborativo | Free → Hacker ($7) → Pro ($20) por compute | ~2 años |
| **GitHub Copilot** | 2021 | Autocompletado en IDE | Individual ($10/mes) → Business ($19) → Enterprise ($39) | Desde día 1 |
| **Devin (Cognition)** | 2024 | Agente autónomo de código | $500/mes por seat (enterprise-first) | Desde día 1 |
| **Bolt.new** | 2024 | Prompt→app en browser | Free tokens → Pro ($20) → Team | Desde día 1 |
| **Lovable** | 2024 | GPT Engineer visual | Free → Starter ($20) → Pro ($50) → Scale ($100) | Desde día 1 |

**Patrón clave:** Los harnesses modernos (2024+) monetizan DESDE el día 1. Los de la generación anterior (2015-2018) tardaron 1-2 años en agregar billing. En ambos casos, el billing NO es opcional: es el esqueleto del negocio.

---

## PARTE II: QUÉ FALTA — ANÁLISIS POR DIMENSIÓN SaaS

### DIMENSIÓN 1: MODELO DE NEGOCIO / MONETIZACIÓN

**Estado actual:** CERO implementación.

El documento `POSICIONAMIENTO_OPEN_SOURCE.md` menciona intenciones:
- "Core: Editor + MCP + Render → open source (MIT)"
- "Premium futuro: Batch render (+50 PNGs), templates premium, analytics, white-label"
- "Enterprise: Self-hosted con soporte, SSO, audit logs"

Pero esto es una estrategia de producto, no código. No hay:
- ❌ Integración con pasarela de pagos (Stripe, Paddle, LemonSqueezy, MercadoPago)
- ❌ Definición de planes/tiers en la base de datos (no existe tabla `plans`, `subscriptions`)
- ❌ Feature gating por plan (todas las 193+ tools están disponibles sin restricción)
- ❌ Sistema de créditos/tokens para API calls de IA
- ❌ Lógica de upgrade/downgrade de planes
- ❌ Free trial con límite de tiempo/uso
- ❌ Página de pricing
- ❌ Checkout flow

**Lo que tienen los SaaS harnesses exitosos:**
- Stripe integration con webhooks para eventos de suscripción
- Tabla `subscriptions` vinculada a `accounts` con `plan_id`, `status`, `current_period_end`
- Feature flags por tier (ej: `batch_size <= 10` en free, `<= 100` en pro, `ilimitado` en enterprise)
- Métricas de uso que alimentan billing: API calls, tokens consumidos, storage usado
- Página de pricing pública con comparación de features

**Qué implementar (orden de prioridad):**
1. Tabla `plans` (id, name, price_monthly, price_yearly, features_json, limits_json)
2. Tabla `subscriptions` (account_id FK, plan_id FK, status, stripe_subscription_id, current_period_start, current_period_end)
3. Integración Stripe Checkout + Webhook handler en MCP
4. Middleware de feature gating que consulte `subscriptions.plan_id` antes de cada tool call pesada
5. Página de pricing en el frontend
6. Billing portal (Stripe Customer Portal o custom)

---

### DIMENSIÓN 2: ONBOARDING Y SELF-SERVICE

**Estado actual:** Básico — existe `OnboardingTour.tsx` (spotlight tour de 9 pasos) y `AuthScreen.tsx`.

Lo que falta para ser self-service real:

| Feature | Estado | Prioridad |
|---------|:------:|:---------:|
| **OnboardingTour visual** | ✅ Existe (9 pasos, spotlight overlay) | — |
| **Signup con email/Google** | ✅ Existe (Supabase Auth) | — |
| **Email de verificación** | ⚠️ Parcial (Supabase lo maneja pero sin customización) | Alta |
| **Welcome email** | ❌ No existe | Alta |
| **Onboarding guiado por producto** | ❌ El tour muestra features, no guía a "primer valor" | Crítica |
| **Empty states con CTAs** | ❌ No hay empty states que guíen a la acción | Alta |
| **Quickstart automático** | ❌ El setup requiere clonar repo, configurar env vars, correr SQL | Crítica |
| **Self-service deployment** | ❌ No hay "Deploy to Netlify" button ni one-click setup | Crítica |
| **Demo/trial sin registro** | ❌ No hay sandbox público ni playground | Media |
| **Progressive disclosure** | ❌ Muestra todas las features desde el inicio | Media |
| **Onboarding analytics** | ❌ No se mide dónde abandonan los usuarios | Alta |

**Cómo lo hacen los SaaS harnesses exitosos:**

- **Vercel:** One-click deploy desde GitHub. El primer deploy ES el onboarding. Sin registrarte, pegas un repo URL y ves tu sitio live en 30 segundos. El "aha moment" es inmediato.
- **Replit:** Signup instantáneo con GitHub. Templates listos para forkear. Primer "Run" en < 5 segundos. El valor es inmediato.
- **Bolt.new:** Ni siquiera necesitas cuenta para probar. Escribes un prompt, ves la app generada en segundos. El paywall aparece cuando quieres guardar/exportar.
- **Lovable:** Mismo patrón: prompt → app → "regístrate para guardar".

**Futuraria hoy:** Tienes que clonar un repo, instalar dependencias, configurar Supabase, correr migraciones SQL, configurar Netlify... ANTES de ver la primera línea de diseño. El time-to-value es horas, no segundos.

**Qué implementar:**
1. Sandbox público (read-only, sin cuenta) en `design.futuraria.com/demo`
2. "Deploy to Netlify" button en el README con env vars pre-configuradas
3. Onboarding guiado por producto (no por features): "Crea tu primer diseño en 30 segundos" → el usuario hace click en "+ New" → escribe un prompt → ve el diseño generado → ese es el aha moment
4. Secuencia de emails post-signup: día 0 (bienvenida + quickstart), día 1 (primer diseño con IA), día 3 (batch + export), día 7 (integración con agente)
5. Empty states accionables: en vez de "No templates yet", mostrar "Crea tu primer diseño →" con un prompt de ejemplo pre-llenado

---

### DIMENSIÓN 3: BILLING Y TIERS

**Estado actual:** CERO. No hay absolutamente nada.

**Lo que tiene el repo:**
- Rate limiting básico (200 req/min por IP, en memoria, no persiste)
- `get_metrics` tool stub (existe la firma pero no hay implementación real de métricas de uso)

**Lo que falta:**

| Componente | Descripción |
|-----------|-------------|
| **Planes definidos** | No existe tabla `plans`. Las menciones a "free/pro/enterprise" en docs son aspiracionales |
| **Feature gating por plan** | El MCP server expone 193+ tools sin restricción alguna. Cualquier API key puede llamar cualquier tool |
| **Límites de uso por plan** | No hay quotas de: templates/workspace, frames/template, API calls/día, storage MB, renders/mes, batch size máximo |
| **Stripe/Paddle integration** | No hay webhooks, ni checkout sessions, ni customer portal |
| **Invoice generation** | No hay facturación electrónica ni historial de pagos |
| **Trial management** | No hay free trial con expiración |
| **Credit system** | No hay sistema de créditos para AI calls (cada `generate_from_prompt`, `ai_generate_image` consume tokens de IA sin tracking) |
| **Cost tracking** | El operador del SaaS no tiene visibilidad de cuánto gasta en API calls de IA por cliente |
| **Upgrade prompts** | No hay in-app prompts de "te quedan 3 templates gratuitos, haz upgrade a Pro" |

**Referencia de tiers de SaaS harnesses AI (2024):**

| Plataforma | Free | Pro | Enterprise |
|-----------|------|-----|------------|
| **Lovable** | 5 generaciones/día, export limitado | $20/mes: 100/día, export completo | $100/mes: ilimitado, priority |
| **Bolt.new** | 200K tokens/día | $20/mes: 2M tokens | Team: $xxx |
| **Cursor** | 2K completions/mes | $20/mes: ilimitado + agent | $40/seat: admin + analytics |
| **Replit** | 3 repls públicos | $25/mes: privados + more compute | Custom |

**Qué implementar para Futuraria:**

**Tier sugerido (basado en el roadmap del producto):**

| Plan | Precio/mes | Templates | Batch size | IA calls/mes | Storage | Features clave |
|------|:---------:|-----------|------------|:-----------:|---------|---------------|
| **Free** | $0 | 10 | 5 | 20 | 100MB | Editor básico, 1 workspace, MCP básico |
| **Pro** | $29 | 100 | 50 | 200 | 1GB | Batch render, multi-agente, export avanzado, Google Fonts |
| **Agency** | $99 | Ilimitado | Ilimitado | 1000 | 10GB | Multi-workspace, white-label, API keys ilimitadas, analytics |
| **Enterprise** | Custom | Ilimitado | Ilimitado | Custom | Custom | SSO, audit logs, SLA, self-hosted option, soporte prioritario |

---

### DIMENSIÓN 4: DASHBOARD MULTI-TENANT

**Estado actual:** Multi-tenancy de DATOS implementada (Supabase RLS con `account_id`), pero NO multi-tenancy de GESTIÓN.

**Lo que tiene:**
- RLS policies en todas las tablas del harness (`account_id = auth.uid()`)
- Workspace como unidad organizativa básica
- API keys por workspace con JWKS verification

**Lo que falta:**

| Feature | Estado | Notas |
|---------|:------:|-------|
| **Team/Organization** | ❌ | Solo hay `workspace` como agrupación. No hay concepto de `organization` con múltiples workspaces |
| **RBAC (roles)** | ❌ | No hay roles de workspace (admin, editor, viewer). `AuthScreen` menciona invitation con role pero no está implementado |
| **Member invitations** | ❌ | La UI (`AuthScreen`) tiene un componente `InvitationPreview` pero no hay endpoint de invitations ni tabla |
| **Admin dashboard** | ❌ | No hay dashboard para el operador de la plataforma (ver todos los tenants, métricas agregadas) |
| **Usage per tenant** | ❌ | No hay visibilidad de uso por workspace/cliente (templates creados, API calls, storage) |
| **Billing per tenant** | ❌ | Imposible sin billing |
| **Audit logs** | ⚠️ | `harness_entries` funciona como bitácora de agentes, pero no como audit log de operaciones de usuario |
| **Cross-workspace** | ❌ | No se puede mover/copiar templates entre workspaces |
| **Tenant settings** | ⚠️ | Settings actuales son por usuario (localStorage), no por tenant en BD |

**Lo que tienen los SaaS harnesses maduros:**

- **Vercel:** Dashboard con lista de proyectos, cada proyecto tiene su propio dashboard (deployments, domains, analytics, settings, team members). Roles: Owner, Member, Viewer.
- **GitLab:** Groups → Projects. Roles: Owner, Maintainer, Developer, Reporter, Guest. Cada rol tiene permisos granulares.
- **Netlify:** Teams → Sites. Roles: Owner, Admin, Developer, Reviewer. Billing a nivel de team.
- **Replit:** Teams → Repls. Roles: Admin, Member. Billing centralizado.

**Qué implementar:**
1. Tabla `organizations` (o expandir `workspaces`): `id`, `name`, `slug`, `plan_id`, `billing_email`
2. Tabla `workspace_members`: `workspace_id`, `user_id`, `role` (admin, editor, viewer)
3. Tabla `invitations`: `email`, `workspace_id`, `role`, `token`, `expires_at`, `accepted_at`
4. Endpoint `POST /api/workspaces/:id/invite` que envía email con magic link
5. UI de team management en Settings: lista de miembros, botón invitar, cambio de roles
6. Admin dashboard (protegido por `is_platform_admin`) con métricas agregadas de todos los tenants
7. Audit log (`workspace_audit_logs`): `workspace_id`, `user_id`, `action`, `resource_type`, `resource_id`, `metadata`, `created_at`

---

### DIMENSIÓN 5: ANALYTICS Y MÉTRICAS

**Estado actual:** Embrión. Existe `get_metrics` como firma en MCP, y `harness_report_error` para errores.

**Lo que tiene:**
- `snapshot_auto`: guarda snapshots por cada operación MCP (timestamp, tipo IA/humano)
- `get_metrics` tool (definida en el catálogo, implementación mínima)
- `harness_report_error`: logs de error a Supabase
- Settings muestra `totalFrames` y `estimatedTokens` (estimados)

**Lo que falta (ORGANIZADO POR TIPO DE MÉTRICA):**

#### A. Product Analytics (comportamiento de usuario)

| Métrica | Estado | Herramienta típica |
|---------|:------:|-------------------|
| DAU/WAU/MAU | ❌ | PostHog, Mixpanel |
| Feature adoption (qué tools se usan más) | ❌ | PostHog feature flags |
| Retention (día 1, 7, 30) | ❌ | PostHog cohorts |
| Conversion funnel (visit → signup → first design → paid) | ❌ | PostHog, Amplitude |
| Session duration / pages per visit | ❌ | GA4, Plausible |
| Drop-off points (dónde abandonan) | ❌ | PostHog, LogRocket |
| NPS / CSAT | ❌ | Survey tools |

#### B. Usage Metrics (qué consume el cliente)

| Métrica | Estado | Dónde se trackearía |
|---------|:------:|-------------------|
| API calls por tool por día | ⚠️ | Rate limiter actual es solo en memoria. No hay contador persistente |
| Tokens de IA consumidos (LLM calls) | ❌ | MCP `generate_from_prompt`, `ai_generate_text`, etc. no trackean tokens |
| Storage usado por workspace | ❌ | Supabase Storage tiene métricas pero no están expuestas al frontend |
| Templates creados por workspace | ❌ | Se puede calcular con queries a `templates` table |
| Batch renders ejecutados | ❌ | No hay tracking |
| Agentes activos simultáneos | ⚠️ | `get_active_agents` tool existe pero sin persistencia |
| Uptime / errores de MCP | ⚠️ | `harness_report_error` captura errores pero no hay dashboard de errores |

#### C. Business Metrics (salud del negocio)

| Métrica | Estado | 
|---------|:------:|
| MRR (Monthly Recurring Revenue) | ❌ Sin billing, imposible |
| ARR (Annual Recurring Revenue) | ❌ |
| Churn rate | ❌ |
| LTV (Customer Lifetime Value) | ❌ |
| CAC (Customer Acquisition Cost) | ❌ |
| Conversion rate (free → paid) | ❌ |
| Expansion revenue (upgrades) | ❌ |

#### D. AI Agent Performance Metrics

| Métrica | Estado |
|---------|:------:|
| Tasa de éxito de delegación (implementer completa sin errores) | ❌ |
| Tiempo promedio de ejecución por tipo de tarea | ❌ |
| Tasa de aprobación del reviewer (APPROVED vs CHANGES_REQUESTED) | ⚠️ Se puede inferir de `harness_checkpoints` |
| Errores por tipo de tool | ⚠️ `harness_report_error` captura pero sin agregación |
| Costo promedio por diseño generado (tokens × precio del modelo) | ❌ |
| Satisfacción del resultado (el usuario modificó mucho lo que generó la IA?) | ❌ |

**Qué implementar (orden de prioridad):**

1. **Mínimo viable:** Endpoint `GET /api/metrics/workspace` que agregue datos ya existentes:
   - Templates creados, frames creados
   - Últimos 30 días de actividad (desde snapshots)
   - API calls totales (agregar contador en el rate limiter)
   
2. **Siguiente paso:** Integración con PostHog (open-source, self-hostable, gratis hasta 1M eventos/mes):
   - Identificar usuarios (user_id, workspace_id, plan)
   - Eventos clave: `template_created`, `design_generated`, `batch_executed`, `export_triggered`
   - Funnels: signup → first_template → first_ai_design → upgrade_click

3. **Dashboard de analytics en el frontend:**
   - Tab "Analytics" en el dashboard con gráficos de uso
   - Para el admin: vista agregada de todos los tenants

4. **AI cost tracking:**
   - Cada tool que hace LLM call debe reportar: `{model, prompt_tokens, completion_tokens, cost_estimate}`
   - Tabla `ai_usage_logs`: `workspace_id`, `tool_name`, `model`, `tokens_in`, `tokens_out`, `estimated_cost`, `created_at`
   - Esto alimenta tanto billing como analytics

5. **Alertas y monitoreo:**
   - Uptime monitoring del MCP server (UptimeRobot o similar, gratuito)
   - Alerta si tasa de error > 5% en ventana de 1 hora
   - Alerta si un cliente está cerca de su límite de plan

---

## PARTE III: COMPARATIVA CON SAAS HARNESSES EXITOSOS

### Tabla comparativa: "¿Qué tenía cada uno en su Fase 0?"

| Característica | GitLab CI (2015) | Vercel (2016) | Bolt/Lovable (2024) | **Futuraria HOY** |
|---|---|---|---|---|
| **Producto funcional** | ✅ | ✅ | ✅ | ✅ |
| **Auth** | ✅ OAuth | ✅ OAuth | ✅ OAuth + magic link | ✅ Supabase Auth |
| **Billing/Stripe** | ❌ (llegó en 2017) | ❌ (llegó en 2017) | ✅ FROM DAY 1 | ❌ |
| **Pricing page** | ❌ | ❌ | ✅ | ❌ |
| **Free tier con límites** | ✅ (auto-hosted) | ✅ (static only) | ✅ (token limits) | ❌ (sin límites) |
| **Analytics integrado** | ❌ | ❌ | ✅ (PostHog) | ❌ |
| **Teams/Organizations** | ❌ | ❌ | ⚠️ (básico) | ❌ |
| **Onboarding self-service** | ❌ (manual) | ⚠️ (CLI) | ✅ (prompt→app) | ❌ (git clone) |
| **Dashboard multi-tenant** | ⚠️ (básico) | ✅ | ✅ | ⚠️ (RLS, sin gestión) |
| **Docs públicas** | ✅ | ✅ | ✅ | ⚠️ (parcial) |
| **Time-to-first-value** | 30 min (install) | 30 seg (deploy) | 10 seg (prompt) | **2-4 horas** |

### Lecciones aprendidas de los que pivotaron

1. **Vercel/Netlify (2016-2017):** Agregaron billing ~1.5 años después del lanzamiento. Sobrevivieron porque tenían VC funding. Sin funding, ese gap es letal.

2. **GitLab (2015-2017):** Usó modelo open-core: CE gratuito, EE de pago. Inicialmente solo vendían licenses anuales a enterprises. El SaaS llegó después.

3. **Bolt.new / Lovable (2024):** Monetizaron desde día 1. El "wow moment" (escribir prompt → ver app funcionando) es GRATIS. El paywall está en guardar/exportar/iterar. Este es el modelo correcto para Futuraria: **prompt → diseño → "guarda tu diseño (gratis con registro)" → "genera 50 variantes (Pro)"**.

---

## PARTE IV: RECOMENDACIONES — HOJA DE RUTA SAAS

### Fase 0: SaaS Foundation (Semanas 1-2, ~$0)

Esto es lo MÍNIMO para poder cobrar:

1. **Tabla `plans` + `subscriptions`** en Supabase
   ```sql
   CREATE TABLE plans (id TEXT PK, name TEXT, price_monthly INT, features JSONB, limits JSONB);
   CREATE TABLE subscriptions (id TEXT PK, account_id UUID FK, plan_id TEXT FK, status TEXT, stripe_subscription_id TEXT, current_period_end TIMESTAMPTZ);
   ```
2. **Stripe Checkout integración** (webhook en MCP)
3. **Página de pricing** en el frontend (`/pricing`)
4. **Feature gating middleware** en MCP (cada tool verifica el plan del caller)
5. **Límites por plan aplicados** (templates máximos, batch size, AI calls)
6. **`ai_usage_logs` table** para trackear costos de IA por workspace

**Resultado:** Ya puedes cobrar. Aunque sea $9/mes, ya tienes un SaaS.

### Fase 1: Growth Engine (Semanas 3-4, ~$0-50/mes)

7. **PostHog integración** (eventos clave, funnels, feature flags)
8. **Onboarding guiado por producto** (no por features)
9. **Sandbox público** en `design.futuraria.com/demo` sin registro
10. **Welcome email sequence** (Resend, 100 emails/día gratis)
11. **Team management** (workspace members + invitations)

### Fase 2: Enterprise Ready (Semanas 5-8)

12. **Admin dashboard** para el operador
13. **Analytics dashboard** para el cliente (uso, costos, actividad)
14. **Audit logs** completos
15. **SSO** (SAML/OIDC vía Supabase Enterprise o WorkOS)
16. **White-label** option
17. **SLA + status page** (status.futuraria.com)

---

## PARTE V: DIAGRAMA DE LO QUE FALTA

```
Futuraria Design HOY:
┌──────────────────────────────────────────────┐
│  ✅ Editor WYSIWYG (HTML/CSS)                │
│  ✅ MCP Server (193+ tools)                   │
│  ✅ Multi-agent harness (Leader→Impl→Reviewer)│
│  ✅ Supabase RLS multi-tenancy                │
│  ✅ Auth (email/Google)                       │
│  ✅ Realtime collaboration                    │
│  ✅ Kanban task management                    │
│  ✅ Cron jobs                                 │
│  ✅ Onboarding tour (spotlight)               │
│  ✅ Rate limiting (básico)                    │
│  ✅ Error logging                             │
└──────────────────────────────────────────────┘
                    ↓ FALTA ↓
┌──────────────────────────────────────────────┐
│  ❌ Stripe/Pagos              ← DINERO       │
│  ❌ Plans & Subscriptions     ← DINERO       │
│  ❌ Feature gating por tier   ← DINERO       │
│  ❌ Usage quotas              ← CONTROL      │
│  ❌ AI cost tracking          ← CONTROL      │
│  ❌ PostHog/Mixpanel          ← DATOS        │
│  ❌ Product analytics         ← DATOS        │
│  ❌ Business metrics (MRR)    ← DATOS        │
│  ❌ Team/Org management       ← GESTIÓN      │
│  ❌ RBAC + invitations        ← GESTIÓN      │
│  ❌ Admin dashboard           ← GESTIÓN      │
│  ❌ Audit logs                ← GESTIÓN      │
│  ❌ Self-service onboarding   ← CRECIMIENTO  │
│  ❌ Sandbox público           ← CRECIMIENTO  │
│  ❌ Email automation          ← CRECIMIENTO  │
│  ❌ Pricing page              ← VENTAS       │
│  ❌ Checkout flow             ← VENTAS       │
└──────────────────────────────────────────────┘
```

---

## CONCLUSIÓN

**Futuraria Design es un harness de desarrollo extraordinario, pero NO es un SaaS.** Tiene el 100% de lo técnico (orquestación, MCP, multi-tenancy, colaboración) y el 0% de lo comercial (billing, analytics, onboarding self-service, gestión de equipos, pricing).

La buena noticia: el hard part (el producto técnico diferenciado) YA ESTÁ HECHO. Lo que falta — billing, analytics, onboarding, team management — es commodity. Hay herramientas open-source y freemium para cada pieza: Stripe para billing, PostHog para analytics, Resend para emails, Supabase Auth para SSO.

**Tiempo estimado para SaaS readiness:** 4-6 semanas de desarrollo con 1 agente IDE.

**Lo que NO deberían hacer:** lanzar sin billing. El patrón de 2024 es claro: si no monetizas desde día 1, regalas tu trabajo y financias los costos de infraestructura de tus usuarios. Bolt.new y Lovable lo entendieron: el wow moment es gratis, el valor recurrente es de pago.

---

> **Preparado por:** Agente de investigación (Hermes Agent + Nous Research)
> **Fecha:** 30 de julio de 2026
> **Repositorio:** `C:/Users/Renzo/.openclaw/workspace/design-main/`
