import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

/*
 * GET /api/keys/generate — Generate a new API key
 * This is a helper endpoint for setup. In production, use env vars.
 * 
 * Usage: GET /api/keys/generate?name=agent1
 * Returns: { key: "ftr_...", name: "agent1", hint: "Add to CRM_API_KEY_AGENT env var" }
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name') || 'default'

  // Generate a random key with ftr_ prefix
  const randomPart = crypto.randomBytes(32).toString('hex')
  const key = `ftr_${randomPart}`

  return NextResponse.json({
    key,
    name,
    hint: `Add this to your Netlify env vars as CRM_API_KEY_${name.toUpperCase()}`,
    env_var: `CRM_API_KEY_${name.toUpperCase()}=${key}`,
    instructions: [
      '1. Go to Netlify Dashboard → Site Settings → Environment Variables',
      `2. Add: CRM_API_KEY_${name.toUpperCase()}=${key}`,
      '3. Redeploy the site',
      '4. Use this key in X-API-Key header or ?api_key= query param',
    ],
  })
}
