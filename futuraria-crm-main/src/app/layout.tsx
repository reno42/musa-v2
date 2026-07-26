import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SettingsProvider } from '@/lib/settings-context'
import { ToastProvider } from '@/components/ui/Toast'
import { CommandMenu } from '@/components/ui/CommandMenu'
import { AuthProvider } from '@/lib/auth-context'

export const metadata: Metadata = {
  title: 'Futuraria CRM',
  description: 'Lead management and sales pipeline',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FFFFFF',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-dvh bg-gray-2 font-sans antialiased">
        <AuthProvider>
          <SettingsProvider>
            <ToastProvider>
              <CommandMenu />
              {children}
            </ToastProvider>
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
