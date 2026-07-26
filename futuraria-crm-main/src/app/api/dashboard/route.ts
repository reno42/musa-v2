import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateApiKey, unauthorizedResponse } from '@/lib/api-auth'

// GET /api/dashboard — Aggregated stats for dashboard
export async function GET() {
  try {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

    // Parallel queries
    const [leadsRes, dealsRes, tasksRes, contactsRes, activitiesRes, recentLeadsRes, leadsByStageRes, leadsBySourceRes] = await Promise.all([
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('deals').select('id, value, stage, probability', { count: 'exact' }),
      supabaseAdmin.from('tasks').select('id, status, due_date', { count: 'exact' }),
      supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('activities').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('leads').select('id, created_at').gte('created_at', sevenDaysAgo).order('created_at', { ascending: true }),
      supabaseAdmin.from('leads').select('stage'),
      supabaseAdmin.from('leads').select('source'),
    ])

    const deals = dealsRes.data || []
    const tasks = tasksRes.data || []
    const pipeline = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage))
    const totalPipeline = pipeline.reduce((s, d) => s + (d.value || 0), 0)
    const weightedPipeline = pipeline.reduce((s, d) => s + ((d.value || 0) * (d.probability || 0) / 100), 0)
    const wonDeals = deals.filter(d => d.stage === 'closed_won')
    const wonValue = wonDeals.reduce((s, d) => s + (d.value || 0), 0)

    // Leads by stage
    const stageMap: Record<string, number> = {}
    for (const l of leadsByStageRes.data || []) {
      stageMap[l.stage] = (stageMap[l.stage] || 0) + 1
    }

    // Leads by source
    const sourceMap: Record<string, number> = {}
    for (const l of leadsBySourceRes.data || []) {
      sourceMap[l.source] = (sourceMap[l.source] || 0) + 1
    }

    // Leads over time (last 7 days, grouped by day)
    const dailyLeads: Record<string, number> = {}
    for (const l of recentLeadsRes.data || []) {
      const day = l.created_at.slice(0, 10)
      dailyLeads[day] = (dailyLeads[day] || 0) + 1
    }

    return NextResponse.json({
      stats: {
        total_leads: leadsRes.count || 0,
        total_contacts: contactsRes.count || 0,
        total_deals: deals.length,
        total_activities: activitiesRes.count || 0,
        pipeline_value: totalPipeline,
        weighted_pipeline: weightedPipeline,
        won_value: wonValue,
        won_count: wonDeals.length,
        pending_tasks: tasks.filter(t => ['todo', 'in_progress'].includes(t.status)).length,
        overdue_tasks: tasks.filter(t => t.due_date && new Date(t.due_date) < now && !['done', 'cancelled'].includes(t.status)).length,
        conversion_rate: leadsRes.count ? Math.round((wonDeals.length / leadsRes.count) * 100) : 0,
      },
      charts: {
        leads_by_stage: stageMap,
        leads_by_source: sourceMap,
        leads_over_time: dailyLeads,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
