import { NextRequest, NextResponse } from 'next/server'
import { enqueueNotification } from '@/lib/notification-center'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ ok: false, error: 'Webhook verification failed' }, { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawText =
      body?.message?.text ||
      body?.text ||
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ||
      ''
    const from =
      body?.from ||
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ||
      'unknown'
    const text = String(rawText || '').trim()

    if (text) {
      await enqueueNotification({
        title: `WhatsApp inbound from ${from}`,
        body: text,
        channel: 'chat',
        priority: 'medium',
        source: 'whatsapp-webhook',
        meta: { from, raw: body },
      })
    }

    return NextResponse.json({ ok: true, received: !!text })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
