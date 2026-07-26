import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, unauthorizedResponse } from "@/lib/api-auth"
import { supabaseAdmin } from '@/lib/supabase-admin'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// POST /api/leads/[id]/assign — Assign lead to a user/agent
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  try {
    const body = await request.json()
    const { assigned_to } = body

    if (!assigned_to) {
      return NextResponse.json({ error: 'assigned_to is required' }, { status: 400 })
    }

    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .update({ assigned_to })
      .eq('id', params.id)
      .select()
      .single()

    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Log activity
    await supabaseAdmin.from('activities').insert({
      lead_id: lead.id,
      type: 'status_change',
      title: `Lead assigned to ${assigned_to}`,
      description: `Lead ${lead.full_name} assigned via API`,
      metadata: { assigned_to, source: 'api' },
    })

    dispatchWebhook('lead.assigned', { lead_id: lead.id, assigned_to, full_name: lead.full_name })

    return NextResponse.json({ success: true, data: lead })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
