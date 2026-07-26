import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  
  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  try {
    const body = await request.json()
    if (!body.name || !body.url) {
      return NextResponse.json({ error: 'name and url are required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .insert({
        name: body.name,
        url: body.url,
        events: body.events || ['lead.created'],
        active: body.active ?? true,
        secret: body.secret || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
