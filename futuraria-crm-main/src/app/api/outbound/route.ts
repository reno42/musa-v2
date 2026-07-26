import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/*
 * POST /api/outbound
 * Send outbound webhook to n8n when CRM events happen.
 * Called by internal CRM logic (triggers, API routes, etc.)
 * 
 * This endpoint fires a webhook TO n8n with the event data.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { event, data } = body

    if (!event) return NextResponse.json({ error: 'event required' }, { status: 400 })

    const n8nWebhookUrl = process.env.N8N_OUTBOUND_WEBHOOK_URL
    if (!n8nWebhookUrl) {
      return NextResponse.json({
        error: 'N8N_OUTBOUND_WEBHOOK_URL not configured',
        hint: 'Set this env var to your n8n webhook URL',
      }, { status: 503 })
    }

    // Fire webhook to n8n
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString(),
        source: 'futuraria-crm',
      }),
    })

    const responseBody = await response.text()

    // Log the outbound webhook
    await supabaseAdmin.from('webhook_logs').insert({
      event_type: `outbound.${event}`,
      payload: { event, data, n8n_response: responseBody },
      response_status: response.status,
    })

    return NextResponse.json({
      success: true,
      event,
      n8n_status: response.status,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to send outbound webhook' }, { status: 500 })
  }
}
