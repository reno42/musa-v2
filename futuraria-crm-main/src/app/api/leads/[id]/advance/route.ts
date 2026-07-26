import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

const STAGE_ORDER = [
  'new', 'researching', 'contacted', 'qualified',
  'demo_scheduled', 'proposal_sent', 'negotiation', 'won'
]

// POST /api/leads/[id]/advance — Advance lead to next stage
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', params.id).single()
  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const currentIndex = STAGE_ORDER.indexOf(lead.stage)
  if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) {
    return NextResponse.json({
      error: `Cannot advance from stage "${lead.stage}"`,
      current_stage: lead.stage,
    }, { status: 400 })
  }

  const nextStage = STAGE_ORDER[currentIndex + 1]

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('leads')
    .update({ stage: nextStage })
    .eq('id', lead.id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await supabaseAdmin.from('activities').insert({
    lead_id: lead.id,
    type: 'status_change',
    title: `Stage advanced: ${lead.stage} → ${nextStage}`,
    description: `Lead advanced via API`,
    metadata: { old_stage: lead.stage, new_stage: nextStage, source: 'api' },
  })

  dispatchWebhook('lead.advanced', {
    lead_id: lead.id,
    previous_stage: lead.stage,
    current_stage: nextStage,
    full_name: lead.full_name,
  })

  return NextResponse.json({
    success: true,
    lead_id: lead.id,
    previous_stage: lead.stage,
    current_stage: nextStage,
    data: updated,
  })
}
