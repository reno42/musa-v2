import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/*
 * API Key Authentication Middleware
 * 
 * Checks keys in this order:
 * 1. Environment variable keys (CRM_API_KEY, CRM_API_KEY_AGENT, CRM_API_KEY_N8N)
 * 2. Database-stored keys (api_keys table)
 * 
 * Header: X-API-Key: ftr_xxx
 * Or query param: ?api_key=ftr_xxx
 * Or Bearer token: Authorization: Bearer ftr_xxx
 */

const ENV_KEYS: Record<string, { name: string; permissions: string[] }> = {}

function loadEnvKeys() {
  if (Object.keys(ENV_KEYS).length > 0) return
  const mainKey = process.env.CRM_API_KEY
  if (mainKey) ENV_KEYS[mainKey] = { name: 'main', permissions: ['*'] }
  const agentKey = process.env.CRM_API_KEY_AGENT
  if (agentKey) ENV_KEYS[agentKey] = { name: 'agent', permissions: ['*'] }
  const n8nKey = process.env.CRM_API_KEY_N8N
  if (n8nKey) ENV_KEYS[n8nKey] = { name: 'n8n', permissions: ['*'] }
  const readOnlyKey = process.env.CRM_API_KEY_READONLY
  if (readOnlyKey) ENV_KEYS[readOnlyKey] = { name: 'readonly', permissions: ['read'] }
}

function extractKey(request: NextRequest): string | null {
  let key = request.headers.get('x-api-key')
  if (!key) {
    const url = new URL(request.url)
    key = url.searchParams.get('api_key')
  }
  if (!key) {
    const auth = request.headers.get('authorization')
    if (auth?.startsWith('Bearer ')) key = auth.slice(7)
  }
  return key
}

export interface ApiKeyInfo {
  valid: boolean
  name?: string
  permissions?: string[]
  error?: string
}

export async function validateApiKey(request: NextRequest): Promise<ApiKeyInfo> {
  loadEnvKeys()

  // If no env keys AND no DB keys configured, allow all (dev mode)
  // We check env keys first for speed
  const key = extractKey(request)

  if (!key) {
    if (Object.keys(ENV_KEYS).length === 0) {
      // No env keys — check if DB has keys
      const hasDbKeys = await checkDbHasKeys()
      if (!hasDbKeys) return { valid: true, name: 'dev', permissions: ['*'] }
    }
    return { valid: false, error: 'Missing API key. Use X-API-Key header or ?api_key= query param.' }
  }

  // Check env keys first (fast, no DB call)
  const envMatch = ENV_KEYS[key]
  if (envMatch) {
    return { valid: true, name: envMatch.name, permissions: envMatch.permissions }
  }

  // Check database keys
  const dbKey = await checkDbKey(key)
  if (dbKey) {
    // Update last_used_at (fire and forget)
    updateLastUsed(dbKey.id).catch(() => {})
    return { valid: true, name: dbKey.name, permissions: dbKey.permissions }
  }

  return { valid: false, error: 'Invalid API key' }
}

async function checkDbHasKeys(): Promise<boolean> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SECRET_KEY || ''
    )
    const { count } = await supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    return (count || 0) > 0
  } catch {
    return false
  }
}

async function checkDbKey(key: string): Promise<{ id: string; name: string; permissions: string[] } | null> {
  try {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SECRET_KEY || ''
    )
    const { data } = await supabase
      .from('api_keys')
      .select('id, name, permissions')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()
    return data
  } catch {
    return null
  }
}

async function updateLastUsed(id: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SECRET_KEY || ''
  )
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
}

export function hasPermission(keyInfo: ApiKeyInfo, permission: string): boolean {
  if (!keyInfo.valid) return false
  if (keyInfo.permissions?.includes('*')) return true
  return keyInfo.permissions?.includes(permission) ?? false
}

export function unauthorizedResponse(error?: string) {
  return NextResponse.json(
    { error: error || 'Unauthorized', hint: 'Provide a valid API key via X-API-Key header' },
    { status: 401 }
  )
}

export function forbiddenResponse() {
  return NextResponse.json(
    { error: 'Forbidden', hint: 'Your API key does not have permission for this action' },
    { status: 403 }
  )
}
