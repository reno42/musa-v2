import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// GET /api/tasks — List tasks with optional filters
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const leadId = searchParams.get('lead_id')
  const limit = parseInt(searchParams.get('limit') || '50')

  let query = supabaseAdmin
    .from('tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (leadId) query = query.eq('lead_id', leadId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// POST /api/tasks — Create task
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        title: body.title,
        description: body.description || null,
        status: body.status || 'todo',
        priority: body.priority || 'medium',
        lead_id: body.lead_id || null,
        contact_id: body.contact_id || null,
        deal_id: body.deal_id || null,
        due_date: body.due_date || null,
        tags: body.tags || [],
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    dispatchWebhook('task.created', { task_id: data.id, ...data })

    return NextResponse.json({ data }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// PATCH /api/tasks — Update task
export async function PATCH(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.valid) return unauthorizedResponse(auth.error)
  try {
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const { id, ...updates } = body

    if (updates.status === 'done' && !updates.completed_at) {
      updates.completed_at = new Date().toISOString()
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const event = updates.status === 'done' ? 'task.completed' : 'task.updated'
    dispatchWebhook(event, { task_id: id, ...data })

    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
