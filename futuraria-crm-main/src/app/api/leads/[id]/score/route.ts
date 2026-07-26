import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// POST /api/leads/[id]/score — Recalculate lead score
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', params.id).single()
  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  let score = 0
  const breakdown: Record<string, number> = {}

  if (lead.email) { score += 15; breakdown.email = 15 }
  if (lead.phone) { score += 10; breakdown.phone = 10 }
  if (lead.company_name) { score += 15; breakdown.company = 15 }
  if (lead.enrichment && Object.keys(lead.enrichment).length > 0) {
    score += 10; breakdown.enrichment = 10
  }
  if (lead.digital_presence && Object.keys(lead.digital_presence).length > 0) {
    score += 10; breakdown.digital_presence = 10
  }
  if (lead.budget_range) { score += 10; breakdown.budget = 10 }
  if (lead.timeline) { score += 10; breakdown.timeline = 10 }
  if (lead.pain_points && lead.pain_points.length > 0) { score += 10; breakdown.pain_points = 10 }
  if (lead.interests && lead.interests.length > 0) { score += 5; breakdown.interests = 5 }

  const stageScores: Record<string, number> = {
    contacted: 5, qualified: 10, demo_scheduled: 15,
    proposal_sent: 20, negotiation: 25, won: 30,
  }
  const stageBonus = stageScores[lead.stage] || 0
  if (stageBonus) { score += stageBonus; breakdown.stage = stageBonus }
  score = Math.min(score, 100)

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('leads')
    .update({ score, score_breakdown: breakdown })
    .eq('id', lead.id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  dispatchWebhook('lead.scored', { lead_id: lead.id, score, breakdown, full_name: lead.full_name })

  return NextResponse.json({ success: true, lead_id: lead.id, score, breakdown, data: updated })
}
