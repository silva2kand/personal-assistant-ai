import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
].join(' ')

function isPlaceholder(value?: string): boolean {
  if (!value) return true
  return value.startsWith('your_') || value.includes('replace_me')
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim()
  if (isPlaceholder(clientId)) {
    return NextResponse.json(
      {
        error:
          'GMAIL_CLIENT_ID is missing or placeholder. Set a real Google OAuth client ID in .env.',
      },
      { status: 500 }
    )
  }

  const origin = req.nextUrl.origin
  const redirectUri = process.env.GMAIL_REDIRECT_URI || `${origin}/api/auth/gmail/callback`
  const state = crypto.randomBytes(16).toString('hex')
  const safeClientId = clientId as string

  const params = new URLSearchParams({
    client_id: safeClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: process.env.GMAIL_SCOPE || DEFAULT_SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent select_account',
    state,
  })

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  )
  res.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 10 * 60,
  })
  return res
}
