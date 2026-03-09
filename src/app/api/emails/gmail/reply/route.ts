import { NextRequest, NextResponse } from 'next/server'
import { replyToGmailMessage } from '@/lib/gmail-api'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.messageId || !body?.body) {
      return NextResponse.json({ error: 'messageId and body are required' }, { status: 400 })
    }

    await replyToGmailMessage({
      messageId: body.messageId,
      body: body.body,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reply to Gmail message' },
      { status: 500 }
    )
  }
}
