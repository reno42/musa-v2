'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings-context'
import { Globe, Moon, Sun } from 'lucide-react'

export function BottomNav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const { locale, setLocale, theme, setTheme, t } = useSettings()

  const navItems = [
    {
      label: t('nav.dashboard'),
      href: '/dashboard',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
      ),
    },
    {
      label: t('nav.leads'),
      href: '/leads',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label: t('common.create'),
      href: '/leads/new',
      icon: (
        <div className="w-10 h-10 -mt-4 rounded-full bg-gray-12 flex items-center justify-center shadow-md">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
      ),
    },
    {
      label: t('nav.tasks'),
      href: '/tasks',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'More',
      href: '#',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      ),
      children: [
        { label: t('nav.opportunities'), href: '/opportunities' },
        { label: t('nav.people'), href: '/people' },
        { label: t('nav.companies'), href: '/companies' },
        { label: t('nav.pipeline'), href: '/deals' },
        { label: t('nav.webhookLogs'), href: '/webhook-logs' },
        { label: t('sidebar.settings'), href: '/settings' },
      ],
    },
  ]

  const moreItem = navItems.find((i) => i.children)

  return (
    <>
      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setMenuOpen(false)}>
          <div className="absolute bottom-20 right-4 bg-gray-1 rounded-lg shadow-lg border border-gray-5 p-1.5 min-w-[160px]">
            {moreItem?.children?.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'block px-3 py-2 rounded-md text-sm transition-colors',
                  pathname.startsWith(child.href)
                    ? 'bg-gray-3 text-gray-12 font-medium'
                    : 'text-gray-10 hover:bg-gray-3 hover:text-gray-12'
                )}
              >
                {child.label}
              </Link>
            ))}
            {/* Mobile toggles in More menu */}
            <div className="border-t border-gray-5 mt-1 pt-1">
              <button
                onClick={() => { setLocale(locale === 'es' ? 'en' : 'es'); setMenuOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-gray-10 hover:bg-gray-3 hover:text-gray-12 transition-colors"
              >
                <Globe size={14} />
                {locale === 'es' ? 'English' : 'Español'}
              </button>
              <button
                onClick={() => { setTheme(theme === 'light' ? 'dark' : 'light'); setMenuOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-gray-10 hover:bg-gray-3 hover:text-gray-12 transition-colors"
              >
                {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
                {theme === 'light' ? t('settings.dark') : t('settings.light')}
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-1/80 backdrop-blur-md border-t border-gray-5 pb-safe">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href) && item.href !== '#'
            const isNewButton = item.label === t('common.create')
            const hasChildren = item.children !== undefined && item.children.length > 0

            if (hasChildren) {
              return (
                <button
                  key={item.href}
                  onClick={() => setMenuOpen(!menuOpen)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors',
                    menuOpen ? 'text-gray-12' : 'text-gray-9'
                  )}
                >
                  {item.icon}
                  <span className={cn('text-2xs font-medium', menuOpen ? 'text-gray-12' : 'text-gray-9')}>
                    {item.label}
                  </span>
                </button>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors',
                  isNewButton ? '' : isActive ? 'text-gray-12' : 'text-gray-9'
                )}
              >
                {item.icon}
                {!isNewButton && (
                  <span className={cn('text-2xs font-medium', isActive ? 'text-gray-12' : 'text-gray-9')}>
                    {item.label}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
