import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/contacts — List contacts
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const leadId = searchParams.get('lead_id')
  const search = searchParams.get('search')

  let query = supabaseAdmin
    .from('contacts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (leadId) query = query.eq('lead_id', leadId)
  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, count })
}

// POST /api/contacts — Create contact
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()
    if (!body.full_name) return NextResponse.json({ error: 'full_name is required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        full_name: body.full_name,
        email: body.email || null,
        phone: body.phone || null,
        whatsapp: body.whatsapp || null,
        lead_id: body.lead_id || null,
        role: body.role || 'other',
        company_name: body.company_name || null,
        title: body.title || null,
        linkedin_url: body.linkedin_url || null,
        is_primary: body.is_primary || false,
        tags: body.tags || [],
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    dispatchWebhook('contact.created', { contact_id: data.id, ...data })

    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
