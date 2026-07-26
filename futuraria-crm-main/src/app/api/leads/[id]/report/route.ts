import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'

/*
 * GET /api/leads/[id]/report — Generate audit report for a lead
 * Returns markdown report based on enrichment + digital_presence data
 */

function val(v: unknown, fallback = 'No disponible'): string {
  if (v === null || v === undefined || v === '') return fallback
  if (Array.isArray(v) && v.length === 0) return fallback
  return String(v)
}

function boolIcon(v: boolean | undefined | null): string {
  return v ? '✅ Sí' : '❌ No'
}

function maturityEmoji(level: string | undefined): string {
  if (level === 'advanced') return '🟢 Avanzado'
  if (level === 'intermediate') return '🟡 Intermedio'
  if (level === 'beginner') return '🔴 Principiante'
  return '⚪ No evaluado'
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  // Allow from browser (same origin) without API key, or require API key for external access
  const auth = await validateApiKey(request)
  const referer = request.headers.get('referer') || ''
  const isFromBrowser = referer.includes('futuraria-crm.netlify.app') || referer.includes('localhost')
  if (!auth.valid && !isFromBrowser) return unauthorizedResponse(auth.error)

  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const e = (lead.enrichment || {}) as Record<string, unknown>
  const dp = (lead.digital_presence || {}) as Record<string, unknown>
  const sm = (e.social_media_stats || {}) as Record<string, Record<string, unknown>>

  const report = `# REPORTE DE AUDITORÍA
## Estatus de Infraestructura Digital
**EXCLUSIVO PARA:** ${lead.full_name}${lead.company_name ? ` / ${lead.company_name}` : ''}  
**EMITIDO POR:** Futuraria  
**FECHA:** ${new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' })}

---

## I. INTRODUCCIÓN
Este documento es un análisis de "Infraestructura Silenciosa" diseñado para exponer las fugas de capital y autoridad que actualmente limitan el escalamiento de tu marca.

---

## II. ANÁLISIS DE HUELLA DIGITAL Y TECH STACK

| Item | Descripción |
|---|---|
| **Nombre completo** | ${lead.full_name} |
| **Rubro** | ${val(lead.industry)}${lead.company_role ? `. ${lead.company_role}` : ''} |
| **Ecosistema digital** | ${(dp.ecosystem as string[])?.join(', ') || val(e.channels_found)} |
| **Dominio** | ${val(e.domain || e.website)} |
| **Registrado el** | ${val(e.domain_registered)} |
| **Válido hasta** | ${val(e.domain_expires)} |
| **Page Builder** | ${val(e.page_builder)} |
| **Servidor** | ${val(e.server)}${e.cdn ? ` sobre ${e.cdn}` : ''} |
| **SSL** | ${e.has_ssl ? `Activo${Array.isArray(e.ssl_issues) && e.ssl_issues.length ? `, pero con fallas: ${(e.ssl_issues as string[]).join(', ')}` : ''}` : '❌ No detectado'} |
| **Contenido web** | ${e.footer_copyright_year ? `Copyright ${e.footer_copyright_year} (visible desde el footer)${Number(e.footer_copyright_year) < new Date().getFullYear() ? ' — ⚠️ ESTANCADO' : ''}` : 'No evaluado'} |
| **Automatización** | ${Array.isArray(e.automation_tools) && e.automation_tools.length ? (e.automation_tools as string[]).join(', ') : 'No se detectan herramientas de automatización'} |
| **Redes Sociales** | ${sm.instagram ? `Instagram: ${(sm.instagram.posts || 0).toLocaleString()} publicaciones / ${(sm.instagram.followers || 0).toLocaleString()} seguidores` : ''}${sm.facebook ? `. Facebook: ${(sm.facebook.followers || 0).toLocaleString()} seguidores` : ''}${sm.tiktok ? `. TikTok: ${(sm.tiktok.followers || 0).toLocaleString()} seguidores` : ''} |
| **Mensajería** | ${e.whatsapp_type === 'business_with_bot' ? 'WhatsApp Business con bot' : e.whatsapp_type === 'business' ? 'WhatsApp Business (sin bot)' : e.chatbots_detected ? 'Chatbot detectado' : 'No se detectan agentes de IA o chatbots'} |

---

## III. DIAGNÓSTICO DE FUGAS Y HALLAZGOS CRÍTICOS

| # | Hallazgo | Detalle | Impacto en el negocio |
|---|---|---|---|
| 1 | **Visibilidad (SEO)** | ${e.seo_score !== undefined ? `Puntaje: ${e.seo_score}/100` : 'No evaluado'}. ${Array.isArray(e.seo_issues) && e.seo_issues.length ? (e.seo_issues as string[]).join('. ') : ''} | Los prospectos abandonan el sitio antes de que termine de cargar. Google no entiende tu oferta. |
| 2 | **Visibilidad (GEO)** | ${e.geo_ready ? 'Infraestructura amigable para IAs' : 'Infraestructura NO amigable para IAs'}. ${Array.isArray(e.blocked_bots) && e.blocked_bots.length ? `Bloquea: ${(e.blocked_bots as string[]).join(', ')}` : ''} | ${e.geo_ready ? 'Tu marca es visible para IAs.' : 'Tu marca no existe para las IAs. Pierdes tráfico de alta intención que convierte 6x más.'} |
| 3 | **Operaciones** | ${Array.isArray(dp.operational_islands) && dp.operational_islands.length ? `Islas tecnológicas: ${(dp.operational_islands as string[]).join(', ')}` : 'No evaluado'}. ${Array.isArray(dp.missing_automations) && dp.missing_automations.length ? `Automatizaciones faltantes: ${(dp.missing_automations as string[]).join(', ')}` : ''} | Cada venta, cita y descargable depende de un humano. Se pierde momentum por no contestar rápido. |
| 4 | **Estrategia y Marca** | ${dp.brand_focus ? `Foco: ${dp.brand_focus === 'unclear' ? 'Sin foco claro entre B2B y B2C' : String(dp.brand_focus).toUpperCase()}` : 'No evaluado'}. ${dp.content_quality ? `Calidad de contenido: ${dp.content_quality}` : ''} | La gente no conecta con las publicaciones. Disminuyen leads nuevos y conversiones. |

---

## IV. MAPA DE SOLUCIONES (One-Off Projects)

Para que tu negocio opere al nivel de un "Pro", necesitas ejecutar esta hoja de ruta en orden de prioridad:

${(e.seo_score !== undefined && (e.seo_score as number) < 50) || e.uses_elementor ? `**1. Migración de WordPress a Código + SEO/GEO:** Reconstruir la web con código limpio para alcanzar Performance de 90+, optimizar para GEO (Generative Engine Optimization).` : ''}

${!e.chatbots_detected || e.whatsapp_type !== 'business_with_bot' ? `**2. Omnicanalidad Agentica:** Conectar WhatsApp, Instagram, Facebook y Web a un CRM centralizado con un Agente de IA que califique y atienda por ti 24/7.` : ''}

${(Array.isArray(dp.missing_automations) && dp.missing_automations.length) || !e.has_email_automation ? `**3. Implementación de Flujos Automáticos (Mailing & WhatsApp):**
- Descargables: Captura de prospectos en base de datos.
- Eventos: Captura y seguimiento automático para webinars/talleres.
- Recuperación: Para leads que no compraron (carritos abandonados).
- Post-Venta: Para retención y expansión de LTV (compradores).` : ''}

${!e.has_landing_pages ? `**4. Landings de Ventas por segmento B2B / B2C por campaña:** Creación de páginas de venta específicas para webinars y eventos, optimizadas para capturar leads y cerrar ventas en caliente.` : ''}

**5. Servidor con tu propio CRM y N8N:** Independencia total. Ahorro de hasta 20x en costos de automatización y $280+ en costos anuales de CRM.

**6. Content Machines:** Tu propia IA que investiga, redacta y publica contenido orientado a los dolores del usuario.
- Para Blogs: Artículos que optimicen tu SEO constantemente.
- Para Carruseles: Contenido evergreen dirigiendo al blog.
- Para Videos: Automatizados alineados al guión del usuario.

**7. IA Consultant (Paywalled):** Una versión entrenada de tu contenido (clon) para clientes de pago (Revenue recurrente de alta utilidad).

---

## V. SCORING DIGITAL

| Dimensión | Puntaje | Nivel |
|---|---|---|
| Madurez Digital General | ${lead.score || 0}/100 | ${maturityEmoji(e.digital_maturity_level as string)} |
| SEO | ${val(e.seo_score, '0')}/100 | |
| GEO (AI-ready) | ${e.geo_ready ? '80' : '20'}/100 | |
| Automatización | ${Array.isArray(e.automation_tools) && e.automation_tools.length ? '60' : '10'}/100 | |
| Social Media | ${e.social_media_active ? '50' : '10'}/100 | |

---

**PRÓXIMO PASO:** Revisar estos datos juntos y decidir qué solución ejecutamos primero.

---
*Reporte generado automáticamente por Futuraria CRM — ${new Date().toISOString()}*
`

  // Return as markdown
  const format = new URL(request.url).searchParams.get('format')

  if (format === 'json') {
    return NextResponse.json({
      lead_id: lead.id,
      full_name: lead.full_name,
      company_name: lead.company_name,
      report_markdown: report,
      enrichment: lead.enrichment,
      digital_presence: lead.digital_presence,
      score: lead.score,
    })
  }

  return new NextResponse(report, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="auditoria-${lead.full_name?.replace(/\s+/g, '-').toLowerCase() || lead.id}.md"`,
    },
  })
}
