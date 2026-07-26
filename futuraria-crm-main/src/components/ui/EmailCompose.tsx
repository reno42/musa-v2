'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { X, Send } from 'lucide-react'

interface EmailComposeProps {
  to: string
  leadName: string
  onClose: () => void
  onSent?: () => void
}

export function EmailCompose({ to, leadName, onClose, onSent }: EmailComposeProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: subject.trim(), body: body.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to send')
      }
      onSent?.()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Error sending email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-lg bg-gray-1 rounded-xl shadow-2xl border border-gray-5 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-5">
          <h2 className="text-sm font-semibold text-gray-12">Email to {leadName}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-3 text-gray-9"><X size={16} /></button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-2xs font-medium text-gray-9 uppercase tracking-wider">To</label>
            <input type="email" value={to} disabled
              className="mt-1 w-full px-3 py-2 bg-gray-3 border border-gray-5 rounded-md text-sm text-gray-9" />
          </div>
          <div>
            <label className="text-2xs font-medium text-gray-9 uppercase tracking-wider">Subject</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject..."
              className="mt-1 w-full px-3 py-2 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" autoFocus />
          </div>
          <div>
            <label className="text-2xs font-medium text-gray-9 uppercase tracking-wider">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message..." rows={6}
              className="mt-1 w-full px-3 py-2 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-y" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-gray-5 text-gray-10 hover:bg-gray-3 transition-colors">
            Cancel
          </button>
          <button onClick={handleSend} disabled={!subject.trim() || !body.trim() || sending}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              subject.trim() && body.trim() ? 'bg-gray-12 text-white hover:bg-gray-11' : 'bg-gray-4 text-gray-8')}>
            <Send size={14} />
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
