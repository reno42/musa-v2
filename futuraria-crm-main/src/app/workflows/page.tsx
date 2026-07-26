'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import {
  GitBranch, RefreshCw, ExternalLink, ChevronDown,
  Zap, Clock, AlertCircle, Settings, Loader2,
  Webhook, ToggleLeft, ToggleRight, CheckCircle2, Eye, EyeOff,
} from 'lucide-react'
import { useSettings } from '@/lib/settings-context'

interface N8nWorkflow {
  id: string
  name: string
  active: boolean
  nodes: Array<{ name: string; type: string }>
  connections: Record<string, unknown>
  createdAt: string
  updatedAt: string
  tags?: Array<{ name: string }>
}

function t(locale: string, es: string, en: string) {
  return locale === 'es' ? es : en
}

export default function WorkflowsPage() {
  const { locale } = useSettings()

  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [n8nBaseUrl, setN8nBaseUrl] = useState('')
  const [n8nApiKey, setN8nApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const didLoad = useRef(false)

  const loadWorkflows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/workflows')
      const data = await res.json()

      if (!data.configured) {
        setConfigured(false)
        setLoading(false)
        return
      }

      setConfigured(true)
      if (data.baseUrl) setN8nBaseUrl(data.baseUrl)
      if (data.error) {
        setError(data.error)
      } else {
        setWorkflows(data.data || [])
      }
    } catch {
      setError(t(locale, 'No se pudo conectar con el servidor', 'Could not connect to server'))
    }
    setLoading(false)
  }, [locale])

  useEffect(() => {
    if (!didLoad.current) {
      didLoad.current = true
      loadWorkflows()
    }
  }, [loadWorkflows])

  async function handleSave() {
    if (!n8nBaseUrl) return
    setSaving(true)
    setConnectError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: n8nBaseUrl, api_key: n8nApiKey || undefined }),
      })
      const data = await res.json()

      if (!res.ok) {
        setConnectError(data.error || 'Error al guardar')
      } else {
        setSaved(true)
        setTimeout(() => {
          didLoad.current = false
          loadWorkflows()
        }, 500)
      }
    } catch {
      setConnectError(t(locale, 'Error de conexión', 'Connection error'))
    }
    setSaving(false)
  }

  async function handleToggleActive(workflowId: string, currentActive: boolean) {
    setTogglingId(workflowId)
    try {
      const action = currentActive ? 'deactivate' : 'activate'
      await fetch(`/api/workflows/${workflowId}/${action}`, { method: 'POST' })
      setWorkflows(prev => prev.map(w =>
        w.id === workflowId ? { ...w, active: !currentActive } : w
      ))
    } catch {}
    setTogglingId(null)
  }

  const activeCount = workflows.filter(w => w.active).length
  const inactiveCount = workflows.filter(w => !w.active).length

  // ─── Not configured ───────────────────────────────
  if (configured === false) {
    return (
      <AppShell title={t(locale, 'Workflows', 'Workflows')} icon={<GitBranch size={20} />}>
        <div className="max-w-md mx-auto py-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gray-4 flex items-center justify-center mx-auto mb-4">
              <GitBranch size={24} className="text-gray-8" />
            </div>
            <h2 className="text-lg font-semibold text-gray-12 mb-1">
              {t(locale, 'Conecta tu n8n', 'Connect your n8n')}
            </h2>
            <p className="text-sm text-gray-9">
              {t(locale, 'Pegá tu URL y API key para ver tus workflows acá.', 'Paste your URL and API key to see your workflows here.')}
            </p>
          </div>

          <div className="bg-gray-1 border border-gray-5 rounded-lg p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-10 mb-1.5 block">
                {t(locale, 'URL de n8n', 'n8n URL')}
              </label>
              <input
                value={n8nBaseUrl}
                onChange={e => setN8nBaseUrl(e.target.value)}
                placeholder="https://tu-n8n.up.railway.app"
                className="w-full px-3 py-2.5 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-12 focus:outline-none focus:ring-2 focus:ring-gray-8 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-10 mb-1.5 block">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={n8nApiKey}
                  onChange={e => setN8nApiKey(e.target.value)}
                  placeholder="n8n_api_..."
                  className="w-full px-3 py-2.5 pr-10 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-12 focus:outline-none focus:ring-2 focus:ring-gray-8 font-mono"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-8 hover:text-gray-12 transition-colors"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-2xs text-gray-8 mt-1.5">
                {t(locale, 'Se genera en n8n → Settings → API → Create API Key', 'Generated in n8n → Settings → API → Create API Key')}
              </p>
            </div>

            {connectError && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 flex items-start gap-2">
                <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{connectError}</p>
              </div>
            )}

            {saved && (
              <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-600" />
                <p className="text-xs text-emerald-700">{t(locale, '¡Conectado! Cargando workflows...', 'Connected! Loading workflows...')}</p>
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving || !n8nBaseUrl}
              className="w-full py-2.5 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t(locale, 'Conectando...', 'Connecting...')}
                </>
              ) : (
                t(locale, 'Conectar n8n', 'Connect n8n')
              )}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ─── Main ─────────────────────────────────────────
  const action = (
    <div className="flex gap-2">
      <button onClick={loadWorkflows}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-10 hover:bg-gray-3 transition-colors">
        <RefreshCw size={14} />
        <span className="hidden sm:inline">{t(locale, 'Actualizar', 'Refresh')}</span>
      </button>
    </div>
  )

  return (
    <AppShell title={t(locale, 'Workflows', 'Workflows')} icon={<GitBranch size={20} />} action={action}>
      <div className="space-y-4">
        {/* Connection status */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-1 border border-gray-5">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-xs text-gray-10">{t(locale, 'Conectado a', 'Connected to')}</span>
          <span className="text-xs font-mono text-gray-12">{n8nBaseUrl}</span>
          <button onClick={() => { setConfigured(false); setWorkflows([]) }}
            className="ml-auto text-2xs text-gray-8 hover:text-gray-12 transition-colors">
            {t(locale, 'Cambiar', 'Change')}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold tabular-nums text-gray-12">{workflows.length}</p>
            <p className="text-xs text-gray-9">{t(locale, 'Total', 'Total')}</p>
          </div>
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold tabular-nums text-emerald-600">{activeCount}</p>
            <p className="text-xs text-gray-9">{t(locale, 'Activos', 'Active')}</p>
          </div>
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold tabular-nums text-gray-8">{inactiveCount}</p>
            <p className="text-xs text-gray-9">{t(locale, 'Inactivos', 'Inactive')}</p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-md bg-red-50 border border-red-200 flex items-center gap-3">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button onClick={() => { didLoad.current = false; loadWorkflows() }}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
              {t(locale, 'Reintentar', 'Retry')}
            </button>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 skeleton rounded-lg" />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12">
            <GitBranch size={40} className="text-gray-6 mx-auto mb-4" />
            <p className="text-sm text-gray-9">{t(locale, 'Sin workflows', 'No workflows')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {workflows.map(workflow => {
              const isExpanded = expandedId === workflow.id
              const nodeTypes = workflow.nodes?.map(n => n.type) || []
              const hasTrigger = nodeTypes.some(t => t.includes('Trigger') || t.includes('Cron'))
              const hasCode = nodeTypes.some(t => t.includes('Code') || t.includes('Function'))
              const hasHttp = nodeTypes.some(t => t.includes('Http') || t.includes('Webhook'))
              const nodeCount = workflow.nodes?.length || 0

              return (
                <div key={workflow.id}
                  className={cn(
                    'bg-gray-1 border rounded-lg transition-all',
                    isExpanded ? 'border-gray-8 col-span-1 sm:col-span-2 lg:col-span-3' : 'border-gray-5 hover:border-gray-7'
                  )}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-semibold text-gray-12 truncate">{workflow.name}</h3>
                          <span className={cn('flex-shrink-0 w-2 h-2 rounded-full',
                            workflow.active ? 'bg-emerald-500' : 'bg-gray-6')} />
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-2xs text-gray-8 font-mono">
                            {nodeCount} {t(locale, 'nodo' + (nodeCount !== 1 ? 's' : ''), 'node' + (nodeCount !== 1 ? 's' : ''))}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {hasTrigger && (
                            <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              <Zap size={10} /> {t(locale, 'Trigger', 'Trigger')}
                            </span>
                          )}
                          {hasHttp && (
                            <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                              <Webhook size={10} /> HTTP
                            </span>
                          )}
                          {hasCode && (
                            <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              {'</>'} Code
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleActive(workflow.id, workflow.active) }}
                        disabled={togglingId === workflow.id}
                        className="flex-shrink-0 p-1 rounded-md hover:bg-gray-3 transition-colors"
                      >
                        {togglingId === workflow.id ? (
                          <Loader2 size={20} className="animate-spin text-gray-8" />
                        ) : workflow.active ? (
                          <ToggleRight size={24} className="text-emerald-600" />
                        ) : (
                          <ToggleLeft size={24} className="text-gray-6" />
                        )}
                      </button>
                    </div>

                    <button
                      onClick={() => setExpandedId(isExpanded ? null : workflow.id)}
                      className="flex items-center gap-1.5 mt-3 text-2xs text-gray-8 hover:text-gray-12 transition-colors"
                    >
                      <ChevronDown size={12} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                      {isExpanded ? t(locale, 'Menos', 'Less') : t(locale, 'Más detalles', 'More details')}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-5 p-4 space-y-3">
                      <div>
                        <h4 className="text-2xs font-medium text-gray-9 uppercase tracking-wider mb-2">
                          {t(locale, 'Nodos', 'Nodes')}
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          {workflow.nodes?.map((node, i) => (
                            <span key={i}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-3 text-2xs text-gray-11 font-mono border border-gray-5">
                              {node.type.includes('Trigger') || node.type.includes('Cron') ? (
                                <Zap size={10} className="text-blue-500" />
                              ) : node.type.includes('If') || node.type.includes('Switch') ? (
                                <GitBranch size={10} className="text-amber-500" />
                              ) : node.type.includes('Error') ? (
                                <AlertCircle size={10} className="text-red-500" />
                              ) : (
                                <Settings size={10} className="text-gray-8" />
                              )}
                              {node.name}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-2xs">
                        <div>
                          <span className="text-gray-8">{t(locale, 'Creado', 'Created')}:</span>
                          <span className="ml-1 text-gray-11">{new Date(workflow.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-8">{t(locale, 'Actualizado', 'Updated')}:</span>
                          <span className="ml-1 text-gray-11">{new Date(workflow.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <a
                          href={`${n8nBaseUrl}/workflow/${workflow.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-xs font-medium hover:bg-gray-11 transition-colors"
                        >
                          <ExternalLink size={12} />
                          {t(locale, 'Editar en n8n', 'Edit in n8n')}
                        </a>
                        <a
                          href={`${n8nBaseUrl}/workflow/${workflow.id}/executions`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-5 text-xs text-gray-10 hover:bg-gray-3 transition-colors"
                        >
                          <Clock size={12} />
                          {t(locale, 'Ver ejecuciones', 'View executions')}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
