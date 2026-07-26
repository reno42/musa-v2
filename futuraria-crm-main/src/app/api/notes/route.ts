import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  const { data, error, count } = await supabaseAdmin
    .from('notes')
    .select('*', { count: 'exact' })
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, count })
}

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  try {
    const body = await request.json()
    if (!body.title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('notes')
      .insert({
        title: body.title,
        body: body.body || null,
        pinned: body.pinned || false,
        color: body.color || 'default',
        tags: body.tags || [],
        lead_id: body.lead_id || null,
        contact_id: body.contact_id || null,
        company_id: body.company_id || null,
        deal_id: body.deal_id || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
