'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { cn, formatRelativeDate } from '@/lib/utils'
import type { Activity } from '@/types/database'

const ACTIVITY_ICONS: Record<string, string> = {
  note: '📝', email: '📧', call: '📞', meeting: '📅', whatsapp: '💬',
  demo: '🖥️', proposal: '📄', follow_up: '🔔', status_change: '🔄', enrichment: '🔍',
}

const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'note', label: 'Notes' },
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Calls' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'follow_up', label: 'Follow-ups' },
]

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => { loadActivities() }, [typeFilter])

  async function loadActivities() {
    setLoading(true)
    let query = supabase.from('activities').select('*').order('created_at', { ascending: false }).limit(50)
    if (typeFilter !== 'all') query = query.eq('type', typeFilter)
    const { data } = await query
    setActivities(data || [])
    setLoading(false)
  }

  const filters = (
    <div className="flex gap-2 overflow-x-auto pipeline-scroll">
      {TYPE_FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => setTypeFilter(f.value)}
          className={cn(
            'flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all border',
            typeFilter === f.value ? 'bg-gray-12 text-white border-gray-12' : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  )

  return (
    <AppShell title="Activities" filters={filters}>
      <div className="space-y-4">
        <p className="text-xs text-gray-9">{activities.length} activities</p>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-md" />)}
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-gray-9">No activities</p>
          </div>
        ) : (
          <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
            {activities.map((act) => (
              <div key={act.id} className="flex gap-3 px-4 py-3 hover:bg-gray-3 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gray-4 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">{ACTIVITY_ICONS[act.type] || '•'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-12">{act.title}</p>
                    <span className="text-2xs px-1.5 py-0.5 rounded-md bg-gray-4 text-gray-9 capitalize">{act.type.replace('_', ' ')}</span>
                  </div>
                  {act.description && (
                    <p className="text-xs text-gray-9 mt-0.5 line-clamp-2">{act.description}</p>
                  )}
                </div>
                <span className="text-2xs text-gray-8 whitespace-nowrap flex-shrink-0">{formatRelativeDate(act.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
