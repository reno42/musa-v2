import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/tasks/[id]
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin.from('tasks').select('*').eq('id', params.id).single()
  if (error || !data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/tasks/[id]
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json()
    if (body.status === 'done' && !body.completed_at) {
      body.completed_at = new Date().toISOString()
    }
    const { data, error } = await supabaseAdmin.from('tasks').update(body).eq('id', params.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const event = body.status === 'done' ? 'task.completed' : 'task.updated'
    dispatchWebhook(event, { task_id: params.id, ...data })

    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// DELETE /api/tasks/[id]
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: task } = await supabaseAdmin.from('tasks').select('*').eq('id', params.id).single()
  const { error } = await supabaseAdmin.from('tasks').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  dispatchWebhook('task.deleted', { task_id: params.id, ...(task || {}) })

  return NextResponse.json({ success: true })
}
