import { NextRequest, NextResponse } from 'next/server'
import { forwardGmailMessages } from '@/lib/gmail-api'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messageIds = Array.isArray(body?.messageIds) ? body.messageIds : []
    const to = body?.to

    if (!to || messageIds.length === 0) {
      return NextResponse.json({ error: 'to and messageIds are required' }, { status: 400 })
    }

    const forwarded = await forwardGmailMessages({
      messageIds,
      to,
      comment: body?.comment,
    })

    return NextResponse.json({ forwarded })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to forward Gmail messages' },
      { status: 500 }
    )
  }
}
