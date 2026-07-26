'use client'

import { useState, useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Key, Plus, Copy, Trash2, Eye, EyeOff, FileText, ExternalLink } from 'lucide-react'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  permissions: string[]
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showGenerate, setShowGenerate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPerms, setNewKeyPerms] = useState<string[]>(['read', 'write'])
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchKeys()
  }, [])

  async function fetchKeys() {
    const res = await fetch('/api/keys')
    const data = await res.json()
    setKeys(data.data || [])
    setLoading(false)
  }

  async function generateKey() {
    setGenerating(true)
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName, permissions: newKeyPerms }),
    })
    const data = await res.json()
    if (data.key) {
      setGeneratedKey(data.key)
      fetchKeys()
    }
    setGenerating(false)
  }

  async function revokeKey(id: string) {
    if (!confirm('¿Revocar esta API key? No se podrá usar más.')) return
    await fetch(`/api/keys?id=${id}`, { method: 'DELETE' })
    fetchKeys()
  }

  function copyKey() {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <AppShell
      title="API Keys"
      subtitle="Gestiona las llaves de acceso a la API del CRM"
      icon={<Key size={20} />}
      action={
        <button
          onClick={() => { setShowGenerate(true); setGeneratedKey(null); setNewKeyName(''); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
        >
          <Plus size={14} strokeWidth={2} />
          <span className="hidden sm:inline">Nueva Key</span>
        </button>
      }
    >
      {/* Generated key alert */}
      {generatedKey && (
        <div className="mb-6 p-4 rounded-lg border border-green-200 bg-green-50">
          <p className="text-sm font-medium text-green-800 mb-2">
            ✅ Key generada correctamente. Cópiala ahora — no podrás verla de nuevo.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-md bg-white border border-green-200 text-xs font-mono text-gray-12 break-all">
              {generatedKey}
            </code>
            <button
              onClick={copyKey}
              className="px-3 py-2 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors flex-shrink-0"
            >
              {copied ? '✓ Copiado' : <><Copy size={14} className="inline mr-1" />Copiar</>}
            </button>
          </div>
        </div>
      )}

      {/* Generate form */}
      {showGenerate && !generatedKey && (
        <div className="mb-6 p-4 rounded-lg border border-gray-5 bg-gray-1">
          <h3 className="text-sm font-medium text-gray-12 mb-3">Nueva API Key</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-gray-11 uppercase tracking-wider mb-1">Nombre</label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="ej: n8n-production"
                className="w-full px-3 py-2 rounded-md border border-gray-5 bg-gray-2 text-sm text-gray-12 focus:outline-none focus:ring-2 focus:ring-gray-7"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-11 uppercase tracking-wider mb-1">Permisos</label>
              <div className="flex gap-3 pt-1">
                {['read', 'write'].map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-sm text-gray-11 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newKeyPerms.includes(p)}
                      onChange={(e) => {
                        setNewKeyPerms(e.target.checked
                          ? [...newKeyPerms, p]
                          : newKeyPerms.filter(x => x !== p)
                        )
                      }}
                      className="rounded border-gray-6"
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={generateKey}
              disabled={!newKeyName || generating || newKeyPerms.length === 0}
              className="px-4 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Generando...' : 'Generar Key'}
            </button>
            <button
              onClick={() => setShowGenerate(false)}
              className="px-4 py-2 rounded-md text-sm text-gray-10 hover:bg-gray-3 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="text-center py-12 text-gray-9">Cargando...</div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12">
          <Key size={32} className="mx-auto text-gray-7 mb-3" />
          <p className="text-sm text-gray-9">No hay API keys configuradas</p>
          <p className="text-xs text-gray-8 mt-1">Crea una para conectar n8n u otros servicios</p>
        </div>
      ) : (
        <div className="border border-gray-5 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-5 bg-gray-3">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-11 uppercase tracking-wider">Nombre</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-11 uppercase tracking-wider">Key</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-11 uppercase tracking-wider hidden sm:table-cell">Permisos</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-11 uppercase tracking-wider hidden md:table-cell">Último uso</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-11 uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-gray-5 last:border-0 hover:bg-gray-3 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-12">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-gray-10">{k.key_prefix}••••••••</code>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex gap-1">
                      {k.permissions.map((p) => (
                        <span key={p} className="px-1.5 py-0.5 rounded text-2xs bg-gray-4 text-gray-10">{p}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-9 hidden md:table-cell">
                    {k.last_used_at
                      ? new Date(k.last_used_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : 'Nunca'
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    {k.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs bg-green-50 text-green-700 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs bg-red-50 text-red-600 font-medium">
                        Revocada
                      </span>
                    )}
                    {k.is_active && (
                      <button
                        onClick={() => revokeKey(k.id)}
                        className="ml-2 p-1 rounded text-gray-8 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Revocar"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Docs link */}
      <div className="mt-6 p-4 rounded-lg border border-gray-5 bg-gray-1">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={16} className="text-gray-9" />
          <h3 className="text-sm font-medium text-gray-12">Documentación de la API</h3>
        </div>
        <p className="text-xs text-gray-9 mb-2">
          Consulta los endpoints disponibles, ejemplos de uso y cómo conectar con n8n.
        </p>
        <a
          href="/docs"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-11 hover:text-gray-12 transition-colors"
        >
          Ver documentación <ExternalLink size={12} />
        </a>
      </div>
    </AppShell>
  )
}
