import { supabaseAdmin } from './supabase-admin'

/**
 * Dispatch webhook events to all active webhooks subscribed to the given event.
 * Fire-and-forget — never blocks or throws.
 */
export async function dispatchWebhook(
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    // 1. Find active webhooks that subscribe to this event
    const { data: webhooks, error } = await supabaseAdmin
      .from('webhooks')
      .select('*')
      .eq('active', true)

    if (error || !webhooks || webhooks.length === 0) return

    // Filter webhooks whose events array includes this event or wildcard '*'
    const matching = webhooks.filter(
      (w: { events: string[] }) =>
        Array.isArray(w.events) && (w.events.includes(event) || w.events.includes('*'))
    )

    if (matching.length === 0) return

    // 2. Fire all webhooks in parallel (don't await individual failures)
    const payload = {
      event,
      data,
      timestamp: new Date().toISOString(),
    }

    const promises = matching.map(async (webhook: { id: string; url: string; secret: string | null; name: string }) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (webhook.secret) headers['x-webhook-signature'] = webhook.secret

      let responseStatus = 0
      let responseBody: string | null = null
      let errorMessage: string | null = null

      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000), // 10s timeout
        })
        responseStatus = res.status
        try {
          responseBody = await res.text()
          // Truncate to 2KB for storage
          if (responseBody.length > 2048) responseBody = responseBody.slice(0, 2048) + '...'
        } catch {}
      } catch (err) {
        responseStatus = 0
        errorMessage = err instanceof Error ? err.message : String(err)
      }

      // 3. Log to webhook_logs
      try {
        await supabaseAdmin.from('webhook_logs').insert({
          webhook_id: webhook.id,
          event_type: event,
          payload,
          response_status: responseStatus,
          response_body: responseBody,
          error_message: errorMessage,
          processed_at: new Date().toISOString(),
        })
      } catch {
        // Fallback: webhook_id column may not exist yet
        try {
          await supabaseAdmin.from('webhook_logs').insert({
            event_type: event,
            payload,
            response_status: responseStatus,
            response_body: responseBody,
            error_message: errorMessage,
            processed_at: new Date().toISOString(),
          })
        } catch {}
      }
    })

    await Promise.allSettled(promises)
  } catch {
    // Silent — webhook failures must never break the main flow
  }
}
