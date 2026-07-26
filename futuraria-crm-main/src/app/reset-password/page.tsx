'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase handles the token from the URL hash automatically
    // We just need to check if there's a session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true)
      } else {
        // The recovery token might still be processing
        // Listen for auth change
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (session) setReady(true)
          }
        )
        // Timeout after 3 seconds if no session
        setTimeout(() => {
          if (!ready) setError('El enlace es inválido o ya expiró. Solicita uno nuevo.')
        }, 3000)
        return () => subscription.unsubscribe()
      }
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError('No se pudo actualizar la contraseña. Intenta de nuevo.')
      setLoading(false)
      return
    }

    setSuccess(true)
    setTimeout(() => router.push('/login'), 3000)
  }

  if (!ready && !error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-2 px-4">
        <div className="text-sm text-gray-9">Verificando enlace...</div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-2 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-green-50 mb-4">
            <CheckCircle size={24} className="text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-12 tracking-tight mb-2">
            Contraseña actualizada
          </h1>
          <p className="text-sm text-gray-9">
            Tu contraseña se cambió correctamente. Redirigiendo al login...
          </p>
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
            <Lock size={24} className="text-gray-9" />
          </div>
          <h1 className="text-xl font-semibold text-gray-12 tracking-tight">
            Nueva contraseña
          </h1>
          <p className="text-sm text-gray-9 mt-1">
            Crea tu nueva contraseña para Futuraria CRM.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-11 uppercase tracking-wider mb-1.5">
              Nueva contraseña
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                required
                minLength={8}
                autoFocus
                className="w-full px-3 py-2.5 pr-10 rounded-md border border-gray-5 bg-gray-1 text-sm text-gray-12 placeholder:text-gray-8 focus:outline-none focus:ring-2 focus:ring-gray-7 focus:border-transparent transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-8 hover:text-gray-11 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirm" className="block text-xs font-medium text-gray-11 uppercase tracking-wider mb-1.5">
              Confirmar contraseña
            </label>
            <input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite la contraseña"
              required
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
            {loading ? 'Actualizando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
