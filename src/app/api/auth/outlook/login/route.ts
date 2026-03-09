import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const DEFAULT_SCOPES = 'offline_access openid profile User.Read Mail.Read Mail.ReadWrite Mail.Send'

function isPlaceholder(value?: string): boolean {
  if (!value) return true
  return value.startsWith('your_') || value.includes('replace_me')
}

function createSignedStateToken() {
  const payload = JSON.stringify({
    provider: 'outlook',
    nonce: crypto.randomBytes(16).toString('hex'),
    iat: Date.now(),
  })
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url')
  const secret =
    process.env.OUTLOOK_OAUTH_STATE_SECRET ||
    process.env.OUTLOOK_CLIENT_SECRET ||
    process.env.OUTLOOK_CLIENT_ID ||
    'outlook-state-fallback'
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export async function GET(req: NextRequest) {
  const clientId = process.env.OUTLOOK_CLIENT_ID?.trim()
  if (isPlaceholder(clientId)) {
    return NextResponse.json(
      {
        error:
          'OUTLOOK_CLIENT_ID is missing or placeholder. Set a real Azure App Registration client ID in .env.',
      },
      { status: 500 }
    )
  }

  const origin = req.nextUrl.origin
  const tenant = process.env.OUTLOOK_TENANT?.trim() || 'common'
  const authorizeUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI || `${origin}/api/auth/outlook/callback`
  const state = createSignedStateToken()
  const safeClientId = clientId as string

  const params = new URLSearchParams({
    client_id: safeClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: process.env.OUTLOOK_SCOPE || DEFAULT_SCOPES,
    state,
    prompt: 'select_account',
  })

  const res = NextResponse.redirect(`${authorizeUrl}?${params.toString()}`)
  res.cookies.set('outlook_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 10 * 60,
  })
  return res
}
