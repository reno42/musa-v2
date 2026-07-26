import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/deals — List deals/opportunities
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const stage = searchParams.get('stage')
  const leadId = searchParams.get('lead_id')

  let query = supabaseAdmin
    .from('deals')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (stage) query = query.eq('stage', stage)
  if (leadId) query = query.eq('lead_id', leadId)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, count })
}

// POST /api/deals — Create deal
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()
    if (!body.title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('deals')
      .insert({
        title: body.title,
        description: body.description || null,
        lead_id: body.lead_id,
        contact_id: body.contact_id || null,
        stage: body.stage || 'discovery',
        value: body.value || null,
        currency: body.currency || 'USD',
        probability: body.probability || 10,
        services: body.services || [],
        expected_close_date: body.expected_close_date || null,
        assigned_to: body.assigned_to || null,
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Log activity
    if (body.lead_id) {
      await supabaseAdmin.from('activities').insert({
        lead_id: body.lead_id,
        deal_id: data.id,
        type: 'note',
        title: 'Oportunidad creada',
        description: `Deal "${data.title}" creado via API`,
      })
    }

    dispatchWebhook('deal.created', { deal_id: data.id, ...data })

    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
