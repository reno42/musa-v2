import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

/*
 * POST /api/leads/[id]/enrich — Trigger enrichment (returns lead data for n8n to research)
 * PATCH /api/leads/[id]/enrich — Save enrichment data (called by n8n after research)
 */

// POST — Trigger enrichment OR save enrichment data (dual mode)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Check if body has enrichment data (save mode) or empty (trigger mode)
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {}

  const hasEnrichmentData = body.enrichment || body.digital_presence || body.score !== undefined

  if (hasEnrichmentData) {
    // SAVE MODE: n8n/agent is pushing enrichment data
    const { enrichment, digital_presence, score, score_breakdown } = body as {
      enrichment?: Record<string, unknown>
      digital_presence?: Record<string, unknown>
      score?: number
      score_breakdown?: Record<string, number>
    }

    const currentEnrichment = (lead.enrichment as Record<string, unknown>) || {}
    const currentDigital = (lead.digital_presence as Record<string, unknown>) || {}
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (enrichment) {
      updates.enrichment = { ...currentEnrichment, ...enrichment, enriched_at: new Date().toISOString() }
    }
    if (digital_presence) {
      updates.digital_presence = { ...currentDigital, ...digital_presence }
    }
    if (score !== undefined) updates.score = score
    if (score_breakdown) updates.score_breakdown = score_breakdown

    const { error: updateError } = await supabaseAdmin.from('leads').update(updates).eq('id', params.id)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    await supabaseAdmin.from('activities').insert({
      lead_id: lead.id, type: 'enrichment', title: 'Lead enriched',
      description: `Enrichment data updated for ${lead.full_name}`,
      metadata: { source: enrichment?.enrichment_source || 'api' },
    })

    dispatchWebhook('lead.enriched', { lead_id: lead.id, enrichment, digital_presence, score })

    return NextResponse.json({ success: true, lead_id: lead.id, mode: 'saved' })
  }

  // TRIGGER MODE: return lead data for n8n to research
  if (lead.stage === 'new') {
    await supabaseAdmin.from('leads').update({ stage: 'researching' }).eq('id', lead.id)
  }

  await supabaseAdmin.from('activities').insert({
    lead_id: lead.id, type: 'enrichment', title: 'Enrichment triggered',
    description: `Enrichment process started for ${lead.full_name}`,
    metadata: { source: 'api', company: lead.company_name, email: lead.email },
  })

  return NextResponse.json({
    success: true, lead_id: lead.id, full_name: lead.full_name,
    company_name: lead.company_name, email: lead.email, industry: lead.industry,
    enrichment_queued: true,
  })
}

// PATCH — Save enrichment data (n8n/agent calls this with research results)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('id, full_name, enrichment, digital_presence')
    .eq('id', params.id)
    .single()

  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  try {
    const body = await request.json()
    const { enrichment, digital_presence, score, score_breakdown } = body

    // Merge enrichment data (deep merge to preserve existing fields)
    const currentEnrichment = (lead.enrichment as Record<string, unknown>) || {}
    const currentDigital = (lead.digital_presence as Record<string, unknown>) || {}

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (enrichment) {
      updates.enrichment = {
        ...currentEnrichment,
        ...enrichment,
        enriched_at: new Date().toISOString(),
      }
    }

    if (digital_presence) {
      updates.digital_presence = {
        ...currentDigital,
        ...digital_presence,
      }
    }

    if (score !== undefined) updates.score = score
    if (score_breakdown) updates.score_breakdown = score_breakdown

    const { error: updateError } = await supabaseAdmin
      .from('leads')
      .update(updates)
      .eq('id', params.id)

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    // Log activity
    await supabaseAdmin.from('activities').insert({
      lead_id: lead.id,
      type: 'enrichment',
      title: 'Lead enriched',
      description: `Enrichment data updated for ${lead.full_name}`,
      metadata: {
        source: enrichment?.enrichment_source || 'api',
        fields_updated: Object.keys(enrichment || {}),
      },
    })

    dispatchWebhook('lead.enriched', {
      lead_id: lead.id,
      enrichment,
      digital_presence,
      score,
      full_name: lead.full_name,
    })

    return NextResponse.json({
      success: true,
      lead_id: lead.id,
      enrichment_updated: !!enrichment,
      digital_presence_updated: !!digital_presence,
      score_updated: score !== undefined,
    })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
