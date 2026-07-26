'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { Locale } from './i18n'
import { t, translations, type TranslationKey } from './i18n'

type Theme = 'light' | 'dark'

interface SettingsContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  t: (key: TranslationKey) => string
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('es')
  const [theme, setThemeState] = useState<Theme>('light')

  // Load from localStorage on mount
  useEffect(() => {
    const savedLocale = localStorage.getItem('futuraria-locale') as Locale | null
    const savedTheme = localStorage.getItem('futuraria-theme') as Theme | null
    if (savedLocale && (savedLocale === 'es' || savedLocale === 'en')) {
      setLocaleState(savedLocale)
    }
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
      setThemeState(savedTheme)
    }
  }, [])

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Update html lang
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  function setLocale(newLocale: Locale) {
    setLocaleState(newLocale)
    localStorage.setItem('futuraria-locale', newLocale)
  }

  function setTheme(newTheme: Theme) {
    setThemeState(newTheme)
    localStorage.setItem('futuraria-theme', newTheme)
  }

  function translate(key: TranslationKey): string {
    return t(key, locale)
  }

  return (
    <SettingsContext.Provider value={{ locale, setLocale, theme, setTheme, t: translate }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

export function useT() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useT must be used within SettingsProvider')
  return ctx.t
}
