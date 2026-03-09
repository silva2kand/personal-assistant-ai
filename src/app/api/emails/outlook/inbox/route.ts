import { NextRequest, NextResponse } from 'next/server'
import { getRecentMessages } from '@/lib/outlook-graph'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const top = Number(req.nextUrl.searchParams.get('top') || 25)
    const messages = await getRecentMessages(top)
    return NextResponse.json({ messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Outlook inbox' },
      { status: 500 }
    )
  }
}
