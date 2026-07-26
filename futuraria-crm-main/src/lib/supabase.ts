import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key'

// Client-side Supabase client with proper cookie handling for SSR auth
export const supabase = createBrowserClient(supabaseUrl, supabasePublishableKey)
