import { NextResponse } from 'next/server'
import { listGmailAccounts } from '@/lib/gmail-store'

export const runtime = 'nodejs'

export async function GET() {
  const accounts = await listGmailAccounts()
  return NextResponse.json({
    connected: accounts.length > 0,
    accounts: accounts.map((a) => ({
      email: a.email,
      displayName: a.displayName || a.email,
      expiresAt: a.expiresAt,
    })),
  })
}
