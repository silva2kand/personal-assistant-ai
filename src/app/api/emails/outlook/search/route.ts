import { NextRequest, NextResponse } from 'next/server'
import { searchMessages } from '@/lib/outlook-graph'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages = await searchMessages({
      text: body?.text,
      fromContains: body?.fromContains,
      sinceHours: body?.sinceHours,
      top: body?.top,
    })
    return NextResponse.json({ messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search Outlook messages' },
      { status: 500 }
    )
  }
}
