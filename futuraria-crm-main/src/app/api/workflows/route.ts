import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/*
 * GET /api/workflows — Fetch workflows from n8n
 * Reads n8n connection from app_settings table in Supabase
 */

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single()
  return data?.value || null
}

export async function GET() {
  const baseUrl = await getSetting('n8n_url')
  const apiKey = await getSetting('n8n_api_key')

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ configured: false })
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': apiKey },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      return NextResponse.json({ configured: true, error: `n8n respondió con status ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({ configured: true, baseUrl, data: data.data || [] })
  } catch {
    return NextResponse.json({ configured: true, error: 'No se puede conectar con n8n. Verificá que la URL sea correcta y que n8n esté corriendo.' }, { status: 502 })
  }
}

/*
 * POST /api/workflows — Save n8n connection settings
 * Body: { url: string, api_key: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, api_key } = body

    if (!url) return NextResponse.json({ error: 'URL es requerida' }, { status: 400 })

    // Clean URL (remove trailing slash and common paths like /home/workflows)
    let cleanUrl = url.replace(/\/+$/, '')
    cleanUrl = cleanUrl.replace(/\/(home|workflow|workflows)(\/.*)?$/i, '')

    // Test connection if API key provided
    if (api_key) {
      try {
        const res = await fetch(`${cleanUrl}/api/v1/workflows`, {
          headers: { 'X-N8N-API-KEY': api_key },
          signal: AbortSignal.timeout(10_000),
        })

        if (!res.ok) {
          return NextResponse.json({
            error: `n8n respondió con status ${res.status}. Verificá la API key.`,
          }, { status: 400 })
        }
      } catch {
        return NextResponse.json({
          error: 'No se puede conectar con n8n. Verificá la URL.',
        }, { status: 400 })
      }
    }

    // Save settings
    await supabaseAdmin.from('app_settings').upsert([
      { key: 'n8n_url', value: cleanUrl, updated_at: new Date().toISOString() },
    ], { onConflict: 'key' })

    if (api_key) {
      await supabaseAdmin.from('app_settings').upsert([
        { key: 'n8n_api_key', value: api_key, updated_at: new Date().toISOString() },
      ], { onConflict: 'key' })
    }

    return NextResponse.json({ success: true, url: cleanUrl })
  } catch {
    return NextResponse.json({ error: 'Request inválido' }, { status: 400 })
  }
}
