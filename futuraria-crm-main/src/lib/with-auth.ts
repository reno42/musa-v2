import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, unauthorizedResponse, hasPermission, forbiddenResponse } from '@/lib/api-auth'

type RouteHandler = (request: NextRequest, context?: unknown) => Promise<NextResponse>

export function withAuth(handler: RouteHandler, permission = 'read'): RouteHandler {
  return async (request: NextRequest, context?: unknown) => {
    const auth = await validateApiKey(request)
    if (!auth.valid) return unauthorizedResponse(auth.error)
    if (!hasPermission(auth, permission) && !hasPermission(auth, '*')) {
      return forbiddenResponse()
    }
    return handler(request, context)
  }
}
