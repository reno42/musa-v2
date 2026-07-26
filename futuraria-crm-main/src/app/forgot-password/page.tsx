'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Mail, ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setError('No se pudo enviar el correo. Verifica tu email.')
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-2 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-green-50 mb-4">
            <Mail size={24} className="text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-12 tracking-tight mb-2">
            Revisa tu correo
          </h1>
          <p className="text-sm text-gray-9 mb-6">
            Enviamos un enlace a <strong className="text-gray-12">{email}</strong> para que crees tu nueva contraseña.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-gray-10 hover:text-gray-12 transition-colors"
          >
            <ArrowLeft size={14} /> Volver al login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-2 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-3 mb-4">
            <Mail size={24} className="text-gray-9" />
          </div>
          <h1 className="text-xl font-semibold text-gray-12 tracking-tight">
            Recuperar contraseña
          </h1>
          <p className="text-sm text-gray-9 mt-1">
            Ingresa tu email y te enviaremos un enlace para crear tu nueva contraseña.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-11 uppercase tracking-wider mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoComplete="email"
              autoFocus
              className="w-full px-3 py-2.5 rounded-md border border-gray-5 bg-gray-1 text-sm text-gray-12 placeholder:text-gray-8 focus:outline-none focus:ring-2 focus:ring-gray-7 focus:border-transparent transition-colors"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Enviando...' : 'Enviar enlace'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-gray-10 hover:text-gray-12 transition-colors"
          >
            <ArrowLeft size={14} /> Volver al login
          </Link>
        </div>
      </div>
    </div>
  )
}
