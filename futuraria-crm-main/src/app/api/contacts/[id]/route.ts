import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/contacts/[id]
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { data, error } = await supabaseAdmin.from('contacts').select('*').eq('id', params.id).single()
  if (error || !data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/contacts/[id]
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()
    const { data, error } = await supabaseAdmin.from('contacts').update(body).eq('id', params.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    dispatchWebhook('contact.updated', { contact_id: params.id, ...data })

    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// DELETE /api/contacts/[id]
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)

  const { data: contact } = await supabaseAdmin.from('contacts').select('*').eq('id', params.id).single()
  const { error } = await supabaseAdmin.from('contacts').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  dispatchWebhook('contact.deleted', { contact_id: params.id, ...(contact || {}) })

  return NextResponse.json({ success: true })
}
