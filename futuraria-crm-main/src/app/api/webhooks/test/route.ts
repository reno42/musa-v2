import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  try {
    const { webhook_id } = await request.json()
    
    const { data: webhook, error } = await supabaseAdmin
      .from('webhooks')
      .select('*')
      .eq('id', webhook_id)
      .single()

    if (error || !webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const testPayload = {
      event: 'test.ping',
      data: { message: 'Test webhook from Futuraria CRM', timestamp: new Date().toISOString() },
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (webhook.secret) headers['x-webhook-signature'] = webhook.secret

    const res = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
    })

    return NextResponse.json({ success: res.ok, status: res.status })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
