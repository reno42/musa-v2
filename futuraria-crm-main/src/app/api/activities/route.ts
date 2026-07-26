import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'

// GET /api/activities — List activities (audit trail)
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const leadId = searchParams.get('lead_id')
  const dealId = searchParams.get('deal_id')
  const type = searchParams.get('type')

  let query = supabaseAdmin
    .from('activities')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (leadId) query = query.eq('lead_id', leadId)
  if (dealId) query = query.eq('deal_id', dealId)
  if (type) query = query.eq('type', type)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, count })
}

// POST /api/activities — Create activity (log)
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()
    if (!body.type || !body.title) {
      return NextResponse.json({ error: 'type and title are required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('activities')
      .insert({
        lead_id: body.lead_id || null,
        contact_id: body.contact_id || null,
        deal_id: body.deal_id || null,
        type: body.type,
        title: body.title,
        description: body.description || null,
        metadata: body.metadata || {},
        performed_by: body.performed_by || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
