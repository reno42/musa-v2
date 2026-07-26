import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, unauthorizedResponse } from "@/lib/api-auth"
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/companies/[id]
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data, error } = await supabaseAdmin.from('companies').select('*').eq('id', params.id).single()
  if (error || !data) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/companies/[id]
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  try {
    const body = await request.json()
    const { data, error } = await supabaseAdmin.from('companies').update(body).eq('id', params.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// DELETE /api/companies/[id]
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { error } = await supabaseAdmin.from('companies').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
