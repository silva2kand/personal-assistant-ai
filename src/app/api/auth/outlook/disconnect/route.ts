import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removeOutlookAccount } from '@/lib/outlook-store'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  await removeOutlookAccount(body?.email)
  await db.emailAccount.updateMany({
    where: {
      provider: 'outlook',
      ...(body?.email ? { email: body.email } : {}),
    },
    data: {
      status: 'disconnected',
      lastSync: null,
    },
  })
  return NextResponse.json({ success: true })
}
