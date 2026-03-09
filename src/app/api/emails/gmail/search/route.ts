import { NextRequest, NextResponse } from 'next/server'
import { searchGmailMessages } from '@/lib/gmail-api'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages = await searchGmailMessages({
      text: body?.text,
      fromContains: body?.fromContains,
      sinceHours: body?.sinceHours,
      top: body?.top,
    })
    return NextResponse.json({ messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search Gmail messages' },
      { status: 500 }
    )
  }
}
