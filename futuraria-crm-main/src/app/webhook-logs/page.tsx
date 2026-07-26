'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { cn, formatRelativeDate } from '@/lib/utils'
import { Webhook, RefreshCw, ChevronDown, ChevronRight, Search, CheckCircle2, XCircle, BarChart3, Send, Trash2, X } from 'lucide-react'
import { useSettings } from '@/lib/settings-context'

interface WebhookLog {
  id: string
  webhook_id: string | null
  event_type: string
  payload: Record<string, unknown>
  response_status: number | null
  response_body: string | null
  error_message: string | null
  processed_at: string
}

interface Stats {
  total: number
  success: number
  errors: number
}

export default function WebhookLogsPage() {
  const [logs, setLogs] = useState<WebhookLog[]>([])
  const [loading, setLoading] = useState(true)
  const { locale } = useSettings()
  const t = (es: string, en: string) => locale === 'es' ? es : en

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [stats, setStats] = useState<Stats>({ total: 0, success: 0, errors: 0 })
  const [testingWebhook, setTestingWebhook] = useState<string | null>(null)
  const [webhooks, setWebhooks] = useState<{ id: string; name: string; url: string }[]>([])
  const [showTestPanel, setShowTestPanel] = useState(false)
  const [clearing, setClearing] = useState(false)
  const PAGE_SIZE = 50

  const loadLogs = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('webhook_logs')
      .select('*', { count: 'exact' })
      .order('processed_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (eventFilter !== 'all') {
      query = query.eq('event_type', eventFilter)
    }

    const { data, count } = await query
    setLogs(data || [])
    setTotalCount(count || 0)
    setLoading(false)
  }, [page, eventFilter])

  const loadStats = useCallback(async () => {
    const { count: total } = await supabase
      .from('webhook_logs')
      .select('id', { count: 'exact', head: true })

    const { count: errors } = await supabase
      .from('webhook_logs')
      .select('id', { count: 'exact', head: true })
      .or('response_status.gte.400,response_status.eq.0,error_message.not.is.null')

    setStats({
      total: total || 0,
      success: (total || 0) - (errors || 0),
      errors: errors || 0,
    })
  }, [])

  const loadWebhooks = useCallback(async () => {
    const { data } = await supabase.from('webhooks').select('id, name, url').eq('active', true)
    setWebhooks(data || [])
  }, [])

  useEffect(() => {
    loadLogs()
    loadStats()
    loadWebhooks()
  }, [loadLogs, loadStats, loadWebhooks])

  const eventTypes = Array.from(new Set(logs.map(l => l.event_type))).sort()

  const filtered = search
    ? logs.filter(l =>
        l.event_type.includes(search.toLowerCase()) ||
        JSON.stringify(l.payload).toLowerCase().includes(search.toLowerCase())
      )
    : logs

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  async function handleTestWebhook(webhookId: string) {
    setTestingWebhook(webhookId)
    try {
      await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: webhookId }),
      })
      // Reload logs after test
      setTimeout(() => {
        loadLogs()
        loadStats()
        setTestingWebhook(null)
      }, 1500)
    } catch {
      setTestingWebhook(null)
    }
  }

  async function handleClearOld() {
    if (!confirm(t('¿Eliminar logs con más de 7 días?', 'Delete logs older than 7 days?'))) return
    setClearing(true)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('webhook_logs').delete().lt('processed_at', sevenDaysAgo)
    loadLogs()
    loadStats()
    setClearing(false)
  }

  function getLogStatus(log: WebhookLog): 'success' | 'error' | 'unknown' {
    if (log.error_message || !log.response_status || log.response_status >= 400) return 'error'
    if (log.response_status >= 200 && log.response_status < 300) return 'success'
    return 'unknown'
  }

  const action = (
    <div className="flex gap-2">
      <button onClick={() => { loadLogs(); loadStats() }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-10 hover:bg-gray-3 transition-colors">
        <RefreshCw size={14} />
        <span className="hidden sm:inline">{t('Actualizar', 'Refresh')}</span>
      </button>
      <button onClick={handleClearOld} disabled={clearing}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-10 hover:bg-gray-3 disabled:opacity-50 transition-colors">
        <Trash2 size={14} />
        <span className="hidden sm:inline">{t('Limpiar', 'Clear old')}</span>
      </button>
      {webhooks.length > 0 && (
        <button onClick={() => setShowTestPanel(!showTestPanel)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors">
          <Send size={14} />
          <span>{t('Probar', 'Test')}</span>
        </button>
      )}
    </div>
  )

  return (
    <AppShell title="Webhook Logs" icon={<Webhook size={20} />} action={action}>
      <div className="space-y-4">
        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold tabular-nums text-gray-12">{stats.total}</p>
            <p className="text-xs text-gray-9">{t('Total', 'Total')}</p>
          </div>
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold tabular-nums text-emerald-600">{stats.success}</p>
            <p className="text-xs text-gray-9">{t('Exitosos', 'Success')}</p>
          </div>
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold tabular-nums text-red-600">{stats.errors}</p>
            <p className="text-xs text-gray-9">{t('Errores', 'Errors')}</p>
          </div>
        </div>

        {/* Test panel */}
        {showTestPanel && webhooks.length > 0 && (
          <div className="bg-gray-1 border border-gray-5 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-12">{t('Probar Webhook', 'Test Webhook')}</h3>
              <button onClick={() => setShowTestPanel(false)} className="text-gray-8 hover:text-gray-12">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-gray-9">
              {t('Envía un evento de prueba a tu webhook para verificar la conexión.', 'Send a test event to your webhook to verify the connection.')}
            </p>
            <div className="flex flex-wrap gap-2">
              {webhooks.map(wh => (
                <button key={wh.id}
                  onClick={() => handleTestWebhook(wh.id)}
                  disabled={testingWebhook === wh.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-5 bg-gray-1 hover:bg-gray-3 text-sm transition-colors disabled:opacity-50">
                  <Send size={12} />
                  <span className="font-medium">{wh.name}</span>
                  <span className="text-2xs text-gray-8 truncate max-w-[200px]">{wh.url}</span>
                  {testingWebhook === wh.id && <span className="text-2xs text-blue-600">{t('Enviando...', 'Sending...')}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-8" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('Buscar eventos o payloads...', 'Search events or payloads...')}
              className="w-full pl-9 pr-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-12 focus:outline-none focus:ring-2 focus:ring-gray-8"
            />
          </div>
        </div>

        {/* Event filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => { setEventFilter('all'); setPage(0) }}
            className={cn('flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all border',
              eventFilter === 'all' ? 'bg-gray-12 text-white border-gray-12' : 'bg-gray-1 text-gray-10 border-gray-5')}>
            All ({stats.total})
          </button>
          {eventTypes.map(et => (
            <button key={et} onClick={() => { setEventFilter(et); setPage(0) }}
              className={cn('flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all border font-mono',
                eventFilter === et ? 'bg-gray-12 text-white border-gray-12' : 'bg-gray-1 text-gray-10 border-gray-5')}>
              {et}
            </button>
          ))}
        </div>

        {/* Logs list */}
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-md" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Webhook size={40} className="text-gray-6 mx-auto mb-4" />
            <p className="text-sm text-gray-9">{t('Sin logs de webhook', 'No webhook logs')}</p>
            <p className="text-xs text-gray-8 mt-1">{t('Los logs aparecerán cuando se disparen webhooks', 'Logs will appear when webhooks fire')}</p>
          </div>
        ) : (
          <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
            {filtered.map(log => {
              const isExpanded = expandedId === log.id
              const status = getLogStatus(log)
              return (
                <div key={log.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-3 transition-colors text-left"
                  >
                    {isExpanded ? <ChevronDown size={14} className="text-gray-8" /> : <ChevronRight size={14} className="text-gray-8" />}
                    <div className={cn('flex items-center justify-center w-6 h-6 rounded-full',
                      status === 'success' ? 'bg-emerald-50 text-emerald-600' :
                      status === 'error' ? 'bg-red-50 text-red-600' : 'bg-gray-4 text-gray-8')}>
                      {status === 'success' ? <CheckCircle2 size={12} /> :
                       status === 'error' ? <XCircle size={12} /> : <BarChart3 size={12} />}
                    </div>
                    <span className="text-xs font-mono text-gray-12 flex-1">{log.event_type}</span>
                    <span className={cn('text-2xs px-2 py-0.5 rounded-md font-mono border',
                      status === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      status === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-4 text-gray-8 border-gray-5')}>
                      {log.response_status || 'ERR'}
                    </span>
                    <span className="text-2xs text-gray-8 ml-2">{formatRelativeDate(log.processed_at)}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-gray-8">{t('Payload:', 'Payload:')}</span>
                      </div>
                      <pre className="p-3 bg-gray-3 rounded-md text-2xs text-gray-11 overflow-x-auto max-h-64 overflow-y-auto font-mono">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                      {log.response_body && (
                        <>
                          <span className="text-2xs text-gray-8">{t('Respuesta:', 'Response:')}</span>
                          <pre className="p-3 bg-gray-3 rounded-md text-2xs text-gray-11 overflow-x-auto max-h-32 overflow-y-auto font-mono">
                            {log.response_body}
                          </pre>
                        </>
                      )}
                      {log.error_message && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                          <p className="text-xs text-red-700 font-mono">{log.error_message}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-8">
              {t('Mostrando', 'Showing')} {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} {t('de', 'of')} {totalCount}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded-md text-xs border border-gray-5 text-gray-10 hover:bg-gray-3 disabled:opacity-30 transition-colors">
                ← {t('Anterior', 'Prev')}
              </button>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded-md text-xs border border-gray-5 text-gray-10 hover:bg-gray-3 disabled:opacity-30 transition-colors">
                {t('Siguiente', 'Next')} →
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
