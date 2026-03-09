import { NextResponse } from 'next/server'
import { listOutlookAccounts } from '@/lib/outlook-store'

export const runtime = 'nodejs'

export async function GET() {
  const accounts = await listOutlookAccounts()
  return NextResponse.json({
    connected: accounts.length > 0,
    accounts: accounts.map((a) => ({
      email: a.email,
      displayName: a.displayName || a.email,
      expiresAt: a.expiresAt,
    })),
    // NOTE:
    // We intentionally do not run a live Graph mailbox probe here.
    // A transient API failure should not flip saved OAuth connections to "disconnected".
    // Mailbox read/send routes will surface reconnect needs when an operation actually fails.
  })
}
