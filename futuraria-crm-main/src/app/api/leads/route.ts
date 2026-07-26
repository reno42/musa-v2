import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/leads — List leads with optional filters
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { searchParams } = new URL(request.url)
  const stage = searchParams.get('stage')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  let query = supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (stage) {
    query = query.eq('stage', stage)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, count })
}

// Notify n8n webhook about new lead (fire-and-forget)
async function notifyN8n(leadId: string) {
  const n8nWebhookUrl = process.env.N8N_OUTBOUND_WEBHOOK_URL
  if (!n8nWebhookUrl) return

  try {
    await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'lead.created',
        data: { lead_id: leadId },
      }),
    })
  } catch {
    // Silently fail — don't break lead creation if n8n is down
  }
}

// POST /api/leads — Create a new lead
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()

    if (!body.full_name) {
      return NextResponse.json(
        { error: 'full_name is required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert({
        full_name: body.full_name,
        email: body.email || null,
        phone: body.phone || null,
        whatsapp: body.whatsapp || null,
        company_name: body.company_name || null,
        company_role: body.company_role || null,
        industry: body.industry || null,
        source: body.source || 'other',
        source_detail: body.source_detail || null,
        stage: body.stage || 'new',
        priority: body.priority || 'medium',
        score: body.score || 0,
        tags: body.tags || [],
        notes: body.notes || null,
        enrichment: body.enrichment || {},
        digital_presence: body.digital_presence || {},
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log activity
    await supabaseAdmin.from('activities').insert({
      lead_id: data.id,
      type: 'note',
      title: 'Lead creado',
      description: `Lead ${data.full_name} creado via API`,
    })

    // Fire webhook to n8n (non-blocking)
    notifyN8n(data.id)

    // Dispatch to all active webhooks
    dispatchWebhook('lead.created', { lead_id: data.id, ...data })

    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
