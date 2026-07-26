'use client'

import { AppShell } from '@/components/layout/AppShell'
import { useSettings } from '@/lib/settings-context'
import { cn } from '@/lib/utils'
import { Globe, Moon, Sun, Check } from 'lucide-react'

export default function SettingsPage() {
  const { locale, setLocale, theme, setTheme, t } = useSettings()

  return (
    <AppShell title={t('settings.title')}>
      <div className="max-w-2xl space-y-8">
        {/* Language */}
        <div className="p-5 rounded-md bg-gray-1 border border-gray-5">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={18} className="text-gray-9" />
            <h2 className="text-sm font-semibold text-gray-12">{t('settings.languageRegion')}</h2>
          </div>
          <p className="text-xs text-gray-9 mb-4">{t('settings.currentLanguage')}: <span className="text-gray-12 font-medium">{locale === 'es' ? 'Español' : 'English'}</span></p>
          <div className="flex gap-2">
            <button
              onClick={() => setLocale('es')}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all border',
                locale === 'es'
                  ? 'bg-gray-12 text-white border-gray-12'
                  : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
              )}
            >
              {locale === 'es' && <Check size={14} />}
              Español
            </button>
            <button
              onClick={() => setLocale('en')}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all border',
                locale === 'en'
                  ? 'bg-gray-12 text-white border-gray-12'
                  : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
              )}
            >
              {locale === 'en' && <Check size={14} />}
              English
            </button>
          </div>
        </div>

        {/* Theme */}
        <div className="p-5 rounded-md bg-gray-1 border border-gray-5">
          <div className="flex items-center gap-2 mb-4">
            {theme === 'light' ? <Sun size={18} className="text-gray-9" /> : <Moon size={18} className="text-gray-9" />}
            <h2 className="text-sm font-semibold text-gray-12">{t('settings.appearance')}</h2>
          </div>
          <p className="text-xs text-gray-9 mb-4">{t('settings.currentTheme')}: <span className="text-gray-12 font-medium">{theme === 'light' ? t('settings.light') : t('settings.dark')}</span></p>
          <div className="flex gap-2">
            <button
              onClick={() => setTheme('light')}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all border',
                theme === 'light'
                  ? 'bg-gray-12 text-white border-gray-12'
                  : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
              )}
            >
              <Sun size={14} />
              {t('settings.light')}
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all border',
                theme === 'dark'
                  ? 'bg-gray-12 text-white border-gray-12'
                  : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
              )}
            >
              <Moon size={14} />
              {t('settings.dark')}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
