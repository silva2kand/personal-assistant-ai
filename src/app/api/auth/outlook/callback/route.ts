import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { upsertOutlookAccount } from '@/lib/outlook-store'
import crypto from 'crypto'

export const runtime = 'nodejs'

const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me'

function isPlaceholder(value?: string): boolean {
  if (!value) return true
  return value.startsWith('your_') || value.includes('replace_me')
}

function verifySignedStateToken(state: string): boolean {
  const parts = state.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, signature] = parts
  if (!payloadB64 || !signature) return false

  const secret =
    process.env.OUTLOOK_OAUTH_STATE_SECRET ||
    process.env.OUTLOOK_CLIENT_SECRET ||
    process.env.OUTLOOK_CLIENT_ID ||
    'outlook-state-fallback'
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return false
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false

  try {
    const payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const payload = JSON.parse(payloadRaw) as {
      provider?: string
      nonce?: string
      iat?: number
    }
    if (payload.provider !== 'outlook') return false
    if (!payload.nonce || payload.nonce.length < 16) return false
    if (!payload.iat || !Number.isFinite(payload.iat)) return false
    const ageMs = Date.now() - payload.iat
    if (ageMs < 0 || ageMs > 10 * 60 * 1000) return false
    return true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const state = req.nextUrl.searchParams.get('state')
    const expectedState = req.cookies.get('outlook_oauth_state')?.value

    if (!code) return NextResponse.json({ error: 'Missing OAuth code' }, { status: 400 })
    const cookieStateValid = !!state && !!expectedState && state === expectedState
    const signedStateValid = !!state && verifySignedStateToken(state)
    if (!cookieStateValid && !signedStateValid) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 })
    }

    const clientId = process.env.OUTLOOK_CLIENT_ID?.trim()
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET?.trim()
    if (isPlaceholder(clientId) || isPlaceholder(clientSecret)) {
      return NextResponse.json(
        {
          error:
            'OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET are missing or placeholders in .env',
        },
        { status: 500 }
      )
    }
    const tenant = process.env.OUTLOOK_TENANT?.trim() || 'common'
    const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`

    const redirectUri =
      process.env.OUTLOOK_REDIRECT_URI || `${req.nextUrl.origin}/api/auth/outlook/callback`
    const safeClientId = clientId as string
    const safeClientSecret = clientSecret as string

    const body = new URLSearchParams({
      client_id: safeClientId,
      client_secret: safeClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    })

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      return NextResponse.json({ error: `Token exchange failed: ${text}` }, { status: 500 })
    }

    const tokenData = await tokenRes.json()

    const meRes = await fetch(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const me = meRes.ok ? await meRes.json() : {}
    const email = me.mail || me.userPrincipalName

    if (!email) {
      return NextResponse.json({ error: 'Unable to detect Outlook account email' }, { status: 500 })
    }

    await upsertOutlookAccount({
      email,
      displayName: me.displayName || email,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
      scope: tokenData.scope,
    })

    const existing = await db.emailAccount.findFirst({
      where: { provider: 'outlook', email },
    })
    if (existing) {
      await db.emailAccount.update({
        where: { id: existing.id },
        data: {
          displayName: me.displayName || null,
          status: 'connected',
          lastSync: new Date(),
        },
      })
    } else {
      await db.emailAccount.create({
        data: {
          provider: 'outlook',
          email,
          displayName: me.displayName || null,
          status: 'connected',
          lastSync: new Date(),
        },
      })
    }

    const redirectTo = process.env.OUTLOOK_POST_LOGIN_REDIRECT || '/'
    const res = NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin))
    res.cookies.delete('outlook_oauth_state')
    return res
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OAuth callback failed' },
      { status: 500 }
    )
  }
}
