import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { upsertGmailAccount } from '@/lib/gmail-store'

export const runtime = 'nodejs'

function isPlaceholder(value?: string): boolean {
  if (!value) return true
  return value.startsWith('your_') || value.includes('replace_me')
}

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const state = req.nextUrl.searchParams.get('state')
    const expectedState = req.cookies.get('gmail_oauth_state')?.value

    if (!code) return NextResponse.json({ error: 'Missing OAuth code' }, { status: 400 })
    if (!state || !expectedState || state !== expectedState) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 })
    }

    const clientId = process.env.GMAIL_CLIENT_ID?.trim()
    const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim()
    if (isPlaceholder(clientId) || isPlaceholder(clientSecret)) {
      return NextResponse.json(
        {
          error:
            'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET are missing or placeholders in .env',
        },
        { status: 500 }
      )
    }

    const redirectUri = process.env.GMAIL_REDIRECT_URI || `${req.nextUrl.origin}/api/auth/gmail/callback`
    const safeClientId = clientId as string
    const safeClientSecret = clientSecret as string
    const body = new URLSearchParams({
      client_id: safeClientId,
      client_secret: safeClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    })

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      return NextResponse.json({ error: `Token exchange failed: ${text}` }, { status: 500 })
    }

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token || !tokenData.refresh_token) {
      return NextResponse.json(
        { error: 'OAuth did not return access/refresh token. Ensure prompt=consent and offline access.' },
        { status: 500 }
      )
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profile = profileRes.ok ? await profileRes.json() : {}
    let email = (profile?.email as string | undefined) || ''
    let displayName = (profile?.name as string | undefined) || ''

    if (!email) {
      const gmailProfileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      if (gmailProfileRes.ok) {
        const gmailProfile = await gmailProfileRes.json()
        email = gmailProfile.emailAddress || ''
      }
    }

    if (!email) {
      return NextResponse.json({ error: 'Unable to detect Gmail account email' }, { status: 500 })
    }

    if (!displayName) displayName = email

    await upsertGmailAccount({
      email,
      displayName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
      scope: tokenData.scope,
    })

    const existing = await db.emailAccount.findFirst({
      where: {
        provider: 'gmail',
        email,
      },
    })

    if (existing) {
      await db.emailAccount.update({
        where: { id: existing.id },
        data: {
          displayName,
          status: 'connected',
          lastSync: new Date(),
        },
      })
    } else {
      await db.emailAccount.create({
        data: {
          provider: 'gmail',
          email,
          displayName,
          status: 'connected',
          lastSync: new Date(),
        },
      })
    }

    const redirectTo = process.env.GMAIL_POST_LOGIN_REDIRECT || '/'
    const res = NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin))
    res.cookies.delete('gmail_oauth_state')
    return res
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OAuth callback failed' },
      { status: 500 }
    )
  }
}
