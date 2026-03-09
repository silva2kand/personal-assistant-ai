import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removeGmailAccount } from '@/lib/gmail-store'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  await removeGmailAccount(body?.email)
  await db.emailAccount.updateMany({
    where: {
      provider: 'gmail',
      ...(body?.email ? { email: body.email } : {}),
    },
    data: {
      status: 'disconnected',
      lastSync: null,
    },
  })
  return NextResponse.json({ success: true })
}
