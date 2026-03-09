import { NextRequest, NextResponse } from 'next/server'
import { getRecentGmailMessages } from '@/lib/gmail-api'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const top = Number(req.nextUrl.searchParams.get('top') || 25)
    const messages = await getRecentGmailMessages(top)
    return NextResponse.json({ messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Gmail inbox' },
      { status: 500 }
    )
  }
}
