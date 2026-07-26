import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/*
 * POST /api/webhooks/n8n
 * Mega webhook endpoint — receives events from n8n and processes them.
 * PUBLIC ENDPOINT (secured by n8n webhook URL, not API key)
 * 
 * For direct API access to leads/contacts/deals/etc, use the /api/* endpoints
 * which require X-API-Key header.
 * ─────────────────────────────────────────────
 * LEADS:     lead.created, lead.updated, lead.enriched, lead.qualified,
 *            lead.advanced, lead.assigned, lead.scored, lead.contacted,
 *            lead.lost, lead.won
 * DEALS:     deal.created, deal.updated, deal.stage_changed, deal.won, deal.lost
 * CONTACTS:  contact.created, contact.updated
 * TASKS:     task.created, task.completed, task.overdue
 * ACTIVITIES: activity.logged
 * SYSTEM:    system.health_check, system.bulk_import
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.event && !body.action) {
      return NextResponse.json({ error: 'event or action is required' }, { status: 400 })
    }

    // Support both "event" and "action" formats
    const eventType = body.event || body.action
    const data = body.data || {}

    // Verify webhook secret if configured (extra layer)
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET
    if (webhookSecret) {
      const signature = request.headers.get('x-webhook-signature')
      if (signature !== webhookSecret) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    // Log the webhook event
    const { data: log } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        event_type: eventType,
        payload: body,
        response_status: 200,
      })
      .select('id')
      .single()

    let result: Record<string, unknown> = { processed: true }

    // ─── LEAD EVENTS ────────────────────────────────
    if (eventType === 'lead.created') {
      if (!data.full_name && !data.email) {
        return NextResponse.json({ error: 'full_name or email required' }, { status: 400 })
      }
      const { data: lead, error } = await supabaseAdmin
        .from('leads')
        .insert({
          full_name: data.full_name,
          email: data.email || null,
          phone: data.phone || null,
          whatsapp: data.whatsapp || null,
          company_name: data.company_name || null,
          company_role: data.company_role || null,
          industry: data.industry || null,
          source: data.source || 'other',
          source_detail: data.source_detail || null,
          stage: data.stage || 'new',
          priority: data.priority || 'medium',
          tags: data.tags || [],
          notes: data.notes || null,
        })
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      result = { lead_id: lead.id, ...result }
    }

    else if (eventType === 'lead.updated') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      const { lead_id, ...updates } = data
      const { error } = await supabaseAdmin.from('leads').update(updates).eq('id', lead_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    else if (eventType === 'lead.enriched') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      const { lead_id, enrichment, digital_presence, ...rest } = data
      const updates: Record<string, unknown> = {}
      if (enrichment) updates.enrichment = enrichment
      if (digital_presence) updates.digital_presence = digital_presence
      if (Object.keys(updates).length > 0) {
        await supabaseAdmin.from('leads').update(updates).eq('id', lead_id)
      }
      await supabaseAdmin.from('activities').insert({
        lead_id, type: 'enrichment', title: 'Lead enriched by agent',
        description: `Enrichment data updated via n8n`, metadata: { source: 'n8n' },
      })
    }

    else if (eventType === 'lead.qualified') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      const updates: Record<string, unknown> = { stage: 'qualified' }
      if (data.score !== undefined) updates.score = data.score
      if (data.budget_range) updates.budget_range = data.budget_range
      if (data.timeline) updates.timeline = data.timeline
      if (data.pain_points) updates.pain_points = data.pain_points
      await supabaseAdmin.from('leads').update(updates).eq('id', data.lead_id)
      await supabaseAdmin.from('activities').insert({
        lead_id: data.lead_id, type: 'status_change',
        title: 'Lead qualified by agent',
        metadata: { source: 'n8n', score: data.score },
      })
    }

    else if (eventType === 'lead.advanced') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      const { data: lead } = await supabaseAdmin.from('leads').select('stage').eq('id', data.lead_id).single()
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      const STAGE_ORDER = ['new', 'researching', 'contacted', 'qualified', 'demo_scheduled', 'proposal_sent', 'negotiation', 'won']
      const idx = STAGE_ORDER.indexOf(lead.stage)
      if (idx < STAGE_ORDER.length - 1) {
        const next = STAGE_ORDER[idx + 1]
        await supabaseAdmin.from('leads').update({ stage: next }).eq('id', data.lead_id)
        await supabaseAdmin.from('activities').insert({
          lead_id: data.lead_id, type: 'status_change',
          title: `Stage: ${lead.stage} → ${next}`,
          metadata: { source: 'n8n' },
        })
        result = { previous_stage: lead.stage, current_stage: next }
      }
    }

    else if (eventType === 'lead.contacted') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      await supabaseAdmin.from('leads').update({
        last_contacted_at: new Date().toISOString(),
        stage: data.stage || 'contacted',
      }).eq('id', data.lead_id)
      await supabaseAdmin.from('activities').insert({
        lead_id: data.lead_id, type: data.channel || 'call',
        title: `Contact via ${data.channel || 'call'}`,
        description: data.description || null,
        metadata: { source: 'n8n', channel: data.channel },
      })
    }

    else if (eventType === 'lead.lost') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      await supabaseAdmin.from('leads').update({ stage: 'lost' }).eq('id', data.lead_id)
      await supabaseAdmin.from('activities').insert({
        lead_id: data.lead_id, type: 'status_change',
        title: 'Lead marked as lost',
        description: data.reason || null,
        metadata: { source: 'n8n', reason: data.reason },
      })
    }

    else if (eventType === 'lead.won') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      await supabaseAdmin.from('leads').update({ stage: 'won' }).eq('id', data.lead_id)
      await supabaseAdmin.from('activities').insert({
        lead_id: data.lead_id, type: 'status_change',
        title: 'Lead won!',
        metadata: { source: 'n8n' },
      })
    }

    else if (eventType === 'lead.deleted') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      await supabaseAdmin.from('leads').delete().eq('id', data.lead_id)
    }

    else if (eventType === 'lead.scored') {
      if (!data.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      const updates: Record<string, unknown> = {}
      if (data.score !== undefined) updates.score = data.score
      if (data.score_breakdown) updates.score_breakdown = data.score_breakdown
      if (Object.keys(updates).length > 0) {
        await supabaseAdmin.from('leads').update(updates).eq('id', data.lead_id)
      }
    }

    // ─── DEAL EVENTS ────────────────────────────────
    else if (eventType === 'deal.created') {
      if (!data.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
      const { data: deal, error } = await supabaseAdmin.from('deals').insert({
        title: data.title, description: data.description || null,
        lead_id: data.lead_id, contact_id: data.contact_id || null,
        stage: data.stage || 'discovery', value: data.value || null,
        currency: data.currency || 'USD', probability: data.probability || 10,
        services: data.services || [], notes: data.notes || null,
      }).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      result = { deal_id: deal.id }
    }

    else if (eventType === 'deal.stage_changed') {
      if (!data.deal_id || !data.stage) return NextResponse.json({ error: 'deal_id and stage required' }, { status: 400 })
      await supabaseAdmin.from('deals').update({ stage: data.stage }).eq('id', data.deal_id)
    }

    else if (eventType === 'deal.won') {
      if (!data.deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })
      await supabaseAdmin.from('deals').update({
        stage: 'closed_won', actual_close_date: new Date().toISOString().slice(0, 10),
      }).eq('id', data.deal_id)
    }

    else if (eventType === 'deal.lost') {
      if (!data.deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })
      await supabaseAdmin.from('deals').update({ stage: 'closed_lost' }).eq('id', data.deal_id)
    }

    else if (eventType === 'deal.deleted') {
      if (!data.deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })
      await supabaseAdmin.from('deals').delete().eq('id', data.deal_id)
    }

    // ─── CONTACT EVENTS ─────────────────────────────
    else if (eventType === 'contact.created') {
      if (!data.full_name) return NextResponse.json({ error: 'full_name required' }, { status: 400 })
      const { data: contact, error } = await supabaseAdmin.from('contacts').insert({
        full_name: data.full_name, email: data.email || null,
        phone: data.phone || null, whatsapp: data.whatsapp || null,
        lead_id: data.lead_id || null, role: data.role || 'other',
        company_name: data.company_name || null, title: data.title || null,
      }).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      result = { contact_id: contact.id }
    }

    else if (eventType === 'contact.updated') {
      if (!data.contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })
      const { contact_id, ...updates } = data
      await supabaseAdmin.from('contacts').update(updates).eq('id', contact_id)
    }

    else if (eventType === 'contact.deleted') {
      if (!data.contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })
      await supabaseAdmin.from('contacts').delete().eq('id', data.contact_id)
    }

    // ─── TASK EVENTS ────────────────────────────────
    else if (eventType === 'task.created') {
      if (!data.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
      const { data: task, error } = await supabaseAdmin.from('tasks').insert({
        title: data.title, description: data.description || null,
        status: data.status || 'todo', priority: data.priority || 'medium',
        lead_id: data.lead_id || null, due_date: data.due_date || null,
      }).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      result = { task_id: task.id }
    }

    else if (eventType === 'task.completed') {
      if (!data.task_id) return NextResponse.json({ error: 'task_id required' }, { status: 400 })
      await supabaseAdmin.from('tasks').update({
        status: 'done', completed_at: new Date().toISOString(),
      }).eq('id', data.task_id)
    }

    else if (eventType === 'task.deleted') {
      if (!data.task_id) return NextResponse.json({ error: 'task_id required' }, { status: 400 })
      await supabaseAdmin.from('tasks').delete().eq('id', data.task_id)
    }

    // ─── SYSTEM EVENTS ──────────────────────────────
    else if (eventType === 'system.health_check') {
      const tables = ['leads', 'contacts', 'companies', 'deals', 'tasks', 'activities']
      const counts: Record<string, number> = {}
      for (const t of tables) {
        const { count } = await supabaseAdmin.from(t).select('id', { count: 'exact', head: true })
        counts[t] = count || 0
      }
      result = { counts }
    }

    else if (eventType === 'system.bulk_import') {
      if (!data.leads || !Array.isArray(data.leads)) {
        return NextResponse.json({ error: 'leads array required' }, { status: 400 })
      }
      const { data: inserted, error } = await supabaseAdmin
        .from('leads')
        .insert(data.leads.map((l: Record<string, unknown>) => ({
          full_name: l.full_name,
          email: l.email || null,
          phone: l.phone || null,
          company_name: l.company_name || null,
          source: l.source || 'other',
          stage: l.stage || 'new',
          priority: l.priority || 'medium',
          tags: l.tags || [],
        })))
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      result = { imported: inserted?.length || 0, ids: inserted?.map(l => l.id) }
    }

    else {
      result = { processed: true, note: `Unknown event "${eventType}" logged` }
    }

    return NextResponse.json({
      success: true,
      webhook_id: log?.id,
      event: eventType,
      ...result,
    })
  } catch (err) {
    console.error('[webhook error]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  // Health check doesn't need auth
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/n8n',
    version: '2.0',
    auth_required: true,
    events: {
      leads: ['lead.created', 'lead.updated', 'lead.enriched', 'lead.qualified', 'lead.advanced', 'lead.contacted', 'lead.lost', 'lead.won'],
      deals: ['deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost'],
      contacts: ['contact.created', 'contact.updated'],
      tasks: ['task.created', 'task.completed', 'task.overdue'],
      system: ['system.health_check', 'system.bulk_import'],
    },
  })
}
