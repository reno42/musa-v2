import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { id } = await params

  const { data, error } = await supabaseAdmin.from('webhooks').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { id } = await params

  try {
    const body = await request.json()
    const { error } = await supabaseAdmin.from('webhooks').update(body).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { id } = await params

  const { error } = await supabaseAdmin.from('webhooks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
