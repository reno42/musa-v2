import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, unauthorizedResponse } from "@/lib/api-auth"
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/companies — List companies
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const search = searchParams.get('search')

  let query = supabaseAdmin
    .from('companies')
    .select('*')
    .order('name', { ascending: true })
    .limit(limit)

  if (search) {
    query = query.ilike('name', `%${search}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// POST /api/companies — Create company
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  try {
    const body = await request.json()

    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('companies')
      .insert({
        name: body.name,
        domain: body.domain || null,
        industry: body.industry || null,
        size: body.size || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        city: body.city || null,
        country: body.country || null,
        linkedin_url: body.linkedin_url || null,
        twitter_url: body.twitter_url || null,
        website: body.website || null,
        revenue_range: body.revenue_range || null,
        description: body.description || null,
        tags: body.tags || [],
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
