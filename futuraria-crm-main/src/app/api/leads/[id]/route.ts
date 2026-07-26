import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/leads/[id] — Get lead by ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  return NextResponse.json({ data })
}

// PATCH /api/leads/[id] — Update lead
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  try {
    const body = await request.json()

    const { data, error } = await supabaseAdmin
      .from('leads')
      .update(body)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    dispatchWebhook('lead.updated', { lead_id: params.id, ...data })

    return NextResponse.json({ data })
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// DELETE /api/leads/[id] — Delete lead
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  // Fetch lead before deleting for webhook payload
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single()

  const { error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  dispatchWebhook('lead.deleted', { lead_id: params.id, ...(lead || {}) })

  return NextResponse.json({ success: true })
}
