import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/*
 * POST /api/workflows/[id]/activate
 * POST /api/workflows/[id]/deactivate
 * Reads n8n connection from app_settings table
 */

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single()
  return data?.value || null
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/')
  const action = pathParts[pathParts.length - 1] as 'activate' | 'deactivate'

  if (action !== 'activate' && action !== 'deactivate') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const baseUrl = await getSetting('n8n_url')
  const apiKey = await getSetting('n8n_api_key')

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: 'n8n no configurado' }, { status: 503 })
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows/${params.id}/${action}`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': apiKey },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `n8n respondió con ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({ success: true, workflow: data })
  } catch {
    return NextResponse.json({ error: 'No se puede conectar con n8n' }, { status: 502 })
  }
}
